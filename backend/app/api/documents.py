from __future__ import annotations

import sqlite3
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, Depends, File, HTTPException, Request, UploadFile, status
from pydantic import BaseModel

from app.config import Settings
from app.core.deps import CurrentUser, get_app_settings, get_current_user, get_db
from app.db.database import Database, get_system_settings_dict
from app.engines.document.indexer import (
    delete_doc_scanned_assets,
    has_scanned_page_assets,
    ingest_document,
)
from app.engines.document.parsers import SUPPORTED_DOC_TYPES
from app.engines.document.search import DOC_DIRECT_THRESHOLD
from app.engines.document.vision_ocr import VisionOcrManager

router = APIRouter(prefix="/api/v1/docs", tags=["documents"])


class OcrTriggerRequest(BaseModel):
    provider_id: Optional[int] = None
    page_nums: Optional[list[int]] = None


def _get_vision_ocr(request: Request) -> VisionOcrManager:
    return request.app.state.vision_ocr


def _scanned_root(settings: Settings) -> Path:
    return settings.resolved_data_dir() / "doc_scanned"


def _require_owned_doc(conn: sqlite3.Connection, doc_id: int, user_id: int) -> sqlite3.Row:
    row = conn.execute(
        "SELECT * FROM documents WHERE id = ? AND user_id = ?",
        (doc_id, user_id),
    ).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="Document not found")
    return row


def _format_doc(row: sqlite3.Row) -> dict:
    d = dict(row)
    d["has_scanned_pages"] = bool(d["has_scanned_pages"])
    d["retrieval_mode"] = "direct" if int(d["total_chars"]) < DOC_DIRECT_THRESHOLD else "paginated_fts"
    return d


@router.get("")
def list_docs(
    current_user: CurrentUser = Depends(get_current_user),
    db: Database = Depends(get_db),
) -> list[dict]:
    with db.session() as conn:
        rows = conn.execute(
            "SELECT * FROM documents WHERE user_id = ? ORDER BY created_at DESC, id DESC",
            (current_user.id,),
        ).fetchall()
    return [_format_doc(r) for r in rows]


@router.post("", status_code=status.HTTP_201_CREATED)
def upload_doc(
    file: UploadFile = File(...),
    current_user: CurrentUser = Depends(get_current_user),
    db: Database = Depends(get_db),
    settings: Settings = Depends(get_app_settings),
) -> dict:
    filename = file.filename or "document.txt"
    ext = Path(filename).suffix.lower().lstrip(".")
    if ext not in SUPPORTED_DOC_TYPES:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported file type '.{ext}'. Supported: pdf, pptx, docx, md, txt",
        )

    with db.session() as conn:
        max_mb = int(get_system_settings_dict(conn)["max_upload_mb"])
    max_bytes = max_mb * 1024 * 1024
    raw = file.file.read(max_bytes + 1)
    if len(raw) > max_bytes:
        raise HTTPException(
            status_code=status.HTTP_413_CONTENT_TOO_LARGE,
            detail=f"File exceeds max upload size ({max_mb} MB)",
        )
    if not raw:
        raise HTTPException(status_code=400, detail="Uploaded file is empty")

    try:
        doc_id = ingest_document(
            db,
            current_user.id,
            filename,
            raw,
            scanned_root=_scanned_root(settings),
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    with db.session() as conn:
        row = _require_owned_doc(conn, doc_id, current_user.id)
    return _format_doc(row)


@router.get("/{doc_id}")
def get_doc(
    doc_id: int,
    current_user: CurrentUser = Depends(get_current_user),
    db: Database = Depends(get_db),
    settings: Settings = Depends(get_app_settings),
) -> dict:
    with db.session() as conn:
        row = _require_owned_doc(conn, doc_id, current_user.id)
        pages = conn.execute(
            "SELECT page_num, heading, char_count, text_density, is_scanned_suspect "
            "FROM doc_pages WHERE doc_id = ? ORDER BY page_num ASC",
            (doc_id,),
        ).fetchall()
    data = _format_doc(row)
    data["has_ocr_assets"] = has_scanned_page_assets(_scanned_root(settings), doc_id)
    data["pages_outline"] = [
        {
            "page_num": p["page_num"],
            "heading": p["heading"],
            "char_count": p["char_count"],
            "text_density": p["text_density"],
            "is_scanned_suspect": bool(p["is_scanned_suspect"]),
        }
        for p in pages
    ]
    return data


@router.delete("/{doc_id}")
def delete_doc(
    doc_id: int,
    request: Request,
    current_user: CurrentUser = Depends(get_current_user),
    db: Database = Depends(get_db),
    settings: Settings = Depends(get_app_settings),
) -> dict:
    _get_vision_ocr(request).cancel_doc(doc_id)
    with db.session() as conn:
        _require_owned_doc(conn, doc_id, current_user.id)
        db.drop_doc_fts(conn, doc_id)
        conn.execute(
            "DELETE FROM chat_sessions WHERE user_id = ? AND mode = 'document' AND target_id = ?",
            (current_user.id, doc_id),
        )
        conn.execute("DELETE FROM documents WHERE id = ? AND user_id = ?", (doc_id, current_user.id))
    delete_doc_scanned_assets(_scanned_root(settings), doc_id)
    return {"deleted": True, "doc_id": doc_id}


@router.post("/{doc_id}/ocr")
async def start_doc_ocr(
    doc_id: int,
    request: Request,
    body: OcrTriggerRequest = OcrTriggerRequest(),
    current_user: CurrentUser = Depends(get_current_user),
    db: Database = Depends(get_db),
    settings: Settings = Depends(get_app_settings),
) -> dict:
    with db.session() as conn:
        _require_owned_doc(conn, doc_id, current_user.id)
    mgr = _get_vision_ocr(request)
    try:
        queued = mgr.start_ocr(
            db,
            settings,
            _scanned_root(settings),
            current_user.id,
            doc_id,
            provider_id=body.provider_id,
            page_nums=body.page_nums,
        )
    except RuntimeError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"started": True, "queued_pages": queued, "total_pages": len(queued)}


@router.get("/{doc_id}/ocr-status")
def get_doc_ocr_status(
    doc_id: int,
    request: Request,
    current_user: CurrentUser = Depends(get_current_user),
    db: Database = Depends(get_db),
    settings: Settings = Depends(get_app_settings),
) -> dict:
    with db.session() as conn:
        _require_owned_doc(conn, doc_id, current_user.id)
    return _get_vision_ocr(request).get_status(doc_id, _scanned_root(settings))


@router.post("/{doc_id}/ocr-cancel")
def cancel_doc_ocr(
    doc_id: int,
    request: Request,
    current_user: CurrentUser = Depends(get_current_user),
    db: Database = Depends(get_db),
) -> dict:
    with db.session() as conn:
        _require_owned_doc(conn, doc_id, current_user.id)
    return {"cancel_requested": _get_vision_ocr(request).cancel_doc(doc_id)}


@router.get("/{doc_id}/pages/{page_num}")
def get_doc_page(
    doc_id: int,
    page_num: int,
    current_user: CurrentUser = Depends(get_current_user),
    db: Database = Depends(get_db),
) -> dict:
    with db.session() as conn:
        _require_owned_doc(conn, doc_id, current_user.id)
        row = conn.execute(
            "SELECT id, doc_id, page_num, heading, content, char_count, text_density, is_scanned_suspect "
            "FROM doc_pages WHERE doc_id = ? AND page_num = ?",
            (doc_id, page_num),
        ).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="Document page not found")
    data = dict(row)
    data["is_scanned_suspect"] = bool(data["is_scanned_suspect"])
    return data
