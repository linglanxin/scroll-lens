from __future__ import annotations

import sqlite3
from pathlib import Path

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status

from app.core.deps import CurrentUser, get_current_user, get_db
from app.db.database import Database, get_system_settings_dict
from app.engines.document.indexer import ingest_document
from app.engines.document.parsers import SUPPORTED_DOC_TYPES
from app.engines.document.search import DOC_DIRECT_THRESHOLD

router = APIRouter(prefix="/api/v1/docs", tags=["documents"])


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
        doc_id = ingest_document(db, current_user.id, filename, raw)
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
) -> dict:
    with db.session() as conn:
        row = _require_owned_doc(conn, doc_id, current_user.id)
        pages = conn.execute(
            "SELECT page_num, heading, char_count, text_density, is_scanned_suspect "
            "FROM doc_pages WHERE doc_id = ? ORDER BY page_num ASC",
            (doc_id,),
        ).fetchall()
    data = _format_doc(row)
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
    current_user: CurrentUser = Depends(get_current_user),
    db: Database = Depends(get_db),
) -> dict:
    with db.session() as conn:
        _require_owned_doc(conn, doc_id, current_user.id)
        db.drop_doc_fts(conn, doc_id)
        conn.execute(
            "DELETE FROM chat_sessions WHERE user_id = ? AND mode = 'document' AND target_id = ?",
            (current_user.id, doc_id),
        )
        conn.execute("DELETE FROM documents WHERE id = ? AND user_id = ?", (doc_id, current_user.id))
    return {"deleted": True, "doc_id": doc_id}


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
