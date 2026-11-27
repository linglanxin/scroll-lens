from __future__ import annotations

import json
import sqlite3
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, Request, UploadFile, status
from pydantic import BaseModel, Field

from app.config import Settings
from app.core.deps import CurrentUser, get_app_settings, get_current_user, get_db
from app.db.database import Database, get_system_settings_dict, utcnow_iso
from app.engines.novel.indexer import (
    append_book_chapters,
    ingest_book,
    rebuild_book_fts,
    split_book_volumes,
)
from app.engines.novel.parser import SUPPORTED_NOVEL_EXTENSIONS, parse_novel_bytes
from app.engines.novel.volume_summarizer import VolumeSummarizerManager

router = APIRouter(prefix="/api/v1/books", tags=["books"])


def _require_owned_book(conn: sqlite3.Connection, book_id: int, user_id: int) -> sqlite3.Row:
    row = conn.execute(
        "SELECT * FROM books WHERE id = ? AND user_id = ?",
        (book_id, user_id),
    ).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="Book not found")
    return row


def _get_summarizer(request: Request) -> VolumeSummarizerManager:
    return request.app.state.summarizer


def _read_upload_with_limit(file: UploadFile, db: Database) -> tuple[str, bytes, int]:
    filename = file.filename or "novel.txt"
    ext = Path(filename).suffix.lower()
    if ext not in SUPPORTED_NOVEL_EXTENSIONS:
        supported = ", ".join(SUPPORTED_NOVEL_EXTENSIONS)
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported novel format '{ext or '(none)'}'. Supported: {supported}",
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
    return filename, raw, max_bytes


def _parse_novel_bytes(
    filename: str,
    raw: bytes,
    title_override: str | None = None,
    max_uncompressed_bytes: int = 256 * 1024 * 1024,
):
    try:
        return parse_novel_bytes(
            filename,
            raw,
            title_override=title_override,
            max_uncompressed_bytes=max_uncompressed_bytes,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


class BookSettingsUpdate(BaseModel):
    title: Optional[str] = Field(default=None, min_length=1, max_length=200)
    author: Optional[str] = Field(default=None, max_length=120)
    read_progress_ch: Optional[int] = Field(default=None, ge=0)


class VolumeSplitItem(BaseModel):
    title: str = Field(..., min_length=1, max_length=120)
    start_chapter: int = Field(..., ge=1)
    end_chapter: int = Field(..., ge=1)


class VolumeSplitRequest(BaseModel):
    volumes: list[VolumeSplitItem]


class SummarizeTriggerRequest(BaseModel):
    provider_id: Optional[int] = None


class AliasCreateRequest(BaseModel):
    canonical_name: str = Field(..., min_length=1, max_length=80)
    aliases: list[str] = Field(default_factory=list)
    reindex: bool = True


class WikiUpsertRequest(BaseModel):
    entity_name: str = Field(..., min_length=1, max_length=100)
    category: str = Field(default="人物", max_length=40)
    content_md: str = Field(..., min_length=1)
    source_chapters: list[int] = Field(default_factory=list)


@router.get("")
def list_books(
    current_user: CurrentUser = Depends(get_current_user),
    db: Database = Depends(get_db),
) -> list[dict]:
    with db.session() as conn:
        rows = conn.execute(
            "SELECT id, title, author, total_volumes, total_chapters, total_chars, "
            "read_progress_ch, created_at, updated_at FROM books "
            "WHERE user_id = ? ORDER BY updated_at DESC, id DESC",
            (current_user.id,),
        ).fetchall()
    return [dict(r) for r in rows]


@router.post("", status_code=status.HTTP_201_CREATED)
def upload_book(
    file: UploadFile = File(...),
    title: Optional[str] = Form(default=None),
    author: Optional[str] = Form(default=None),
    current_user: CurrentUser = Depends(get_current_user),
    db: Database = Depends(get_db),
) -> dict:
    filename, raw, max_bytes = _read_upload_with_limit(file, db)
    parsed = _parse_novel_bytes(
        filename,
        raw,
        title,
        max_uncompressed_bytes=max(max_bytes * 3, 256 * 1024 * 1024),
    )
    book_id = ingest_book(db, current_user.id, parsed, author_override=author)
    with db.session() as conn:
        row = _require_owned_book(conn, book_id, current_user.id)
    return dict(row)


@router.get("/{book_id}")
def get_book(
    book_id: int,
    current_user: CurrentUser = Depends(get_current_user),
    db: Database = Depends(get_db),
) -> dict:
    with db.session() as conn:
        row = _require_owned_book(conn, book_id, current_user.id)
        alias_cnt = conn.execute(
            "SELECT COUNT(*) FROM book_aliases WHERE book_id = ?", (book_id,)
        ).fetchone()[0]
        wiki_cnt = conn.execute(
            "SELECT COUNT(*) FROM wiki_notes WHERE book_id = ?", (book_id,)
        ).fetchone()[0]
    data = dict(row)
    data["alias_count"] = alias_cnt
    data["wiki_count"] = wiki_cnt
    return data


@router.delete("/{book_id}")
def delete_book(
    book_id: int,
    request: Request,
    current_user: CurrentUser = Depends(get_current_user),
    db: Database = Depends(get_db),
) -> dict:
    _get_summarizer(request).pause_book(book_id)
    with db.session() as conn:
        _require_owned_book(conn, book_id, current_user.id)
        db.drop_book_fts(conn, book_id)
        conn.execute(
            "DELETE FROM chat_sessions WHERE user_id = ? AND mode = 'novel' AND target_id = ?",
            (current_user.id, book_id),
        )
        conn.execute("DELETE FROM books WHERE id = ? AND user_id = ?", (book_id, current_user.id))
    return {"deleted": True, "book_id": book_id}


@router.post("/{book_id}/append")
def append_book(
    book_id: int,
    file: UploadFile = File(...),
    current_user: CurrentUser = Depends(get_current_user),
    db: Database = Depends(get_db),
) -> dict:
    with db.session() as conn:
        book = _require_owned_book(conn, book_id, current_user.id)
        existing_title = str(book["title"])

    filename, raw, max_bytes = _read_upload_with_limit(file, db)
    parsed = _parse_novel_bytes(
        filename,
        raw,
        existing_title,
        max_uncompressed_bytes=max(max_bytes * 3, 256 * 1024 * 1024),
    )
    result = append_book_chapters(db, book_id, parsed)
    with db.session() as conn:
        updated = _require_owned_book(conn, book_id, current_user.id)
    return {**result, "book": dict(updated)}


@router.patch("/{book_id}/settings")
def update_book_settings(
    book_id: int,
    body: BookSettingsUpdate,
    current_user: CurrentUser = Depends(get_current_user),
    db: Database = Depends(get_db),
) -> dict:
    with db.session() as conn:
        book = _require_owned_book(conn, book_id, current_user.id)
        new_title = body.title.strip() if body.title is not None else book["title"]
        new_author = body.author.strip() if body.author is not None else book["author"]
        new_progress = (
            min(body.read_progress_ch, int(book["total_chapters"]))
            if body.read_progress_ch is not None
            else book["read_progress_ch"]
        )
        conn.execute(
            "UPDATE books SET title = ?, author = ?, read_progress_ch = ?, updated_at = ? WHERE id = ?",
            (new_title, new_author, new_progress, utcnow_iso(), book_id),
        )
        updated = _require_owned_book(conn, book_id, current_user.id)
    return dict(updated)


@router.get("/{book_id}/volumes")
def get_volumes(
    book_id: int,
    current_user: CurrentUser = Depends(get_current_user),
    db: Database = Depends(get_db),
) -> list[dict]:
    with db.session() as conn:
        book = _require_owned_book(conn, book_id, current_user.id)
        progress = int(book["read_progress_ch"])
        rows = conn.execute(
            "SELECT id, volume_num, title, start_chapter, end_chapter, summary_md, summary_status, summary_progress "
            "FROM volumes WHERE book_id = ? ORDER BY volume_num ASC",
            (book_id,),
        ).fetchall()
    out: list[dict] = []
    for r in rows:
        locked = int(r["end_chapter"]) > progress
        prog_obj = None
        if r["summary_progress"]:
            try:
                prog_obj = json.loads(r["summary_progress"])
            except Exception:
                prog_obj = None
        out.append(
            {
                "id": r["id"],
                "volume_num": r["volume_num"],
                "title": r["title"],
                "start_chapter": r["start_chapter"],
                "end_chapter": r["end_chapter"],
                "summary_status": r["summary_status"],
                "summary_locked": locked,
                "summary_md": "" if locked else r["summary_md"],
                "summary_progress": prog_obj,
            }
        )
    return out


@router.post("/{book_id}/volumes/split")
def split_volumes_endpoint(
    book_id: int,
    body: VolumeSplitRequest,
    current_user: CurrentUser = Depends(get_current_user),
    db: Database = Depends(get_db),
) -> list[dict]:
    with db.session() as conn:
        _require_owned_book(conn, book_id, current_user.id)
    try:
        return split_book_volumes(
            db,
            book_id,
            [v.model_dump() for v in body.volumes],
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.post("/{book_id}/volumes/{volume_id}/summarize")
async def summarize_single_volume(
    book_id: int,
    volume_id: int,
    request: Request,
    body: SummarizeTriggerRequest = SummarizeTriggerRequest(),
    current_user: CurrentUser = Depends(get_current_user),
    db: Database = Depends(get_db),
    settings: Settings = Depends(get_app_settings),
) -> dict:
    with db.session() as conn:
        _require_owned_book(conn, book_id, current_user.id)
    mgr = _get_summarizer(request)
    try:
        queued = mgr.start_volumes(
            db, settings, current_user.id, book_id, [volume_id], provider_id=body.provider_id
        )
    except RuntimeError as exc:
        raise HTTPException(status_code=409, detail=str(exc))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    return {"started": True, "queued_volume_ids": queued}


@router.post("/{book_id}/volumes/summarize-all")
async def summarize_all_volumes(
    book_id: int,
    request: Request,
    body: SummarizeTriggerRequest = SummarizeTriggerRequest(),
    current_user: CurrentUser = Depends(get_current_user),
    db: Database = Depends(get_db),
    settings: Settings = Depends(get_app_settings),
) -> dict:
    with db.session() as conn:
        _require_owned_book(conn, book_id, current_user.id)
        rows = conn.execute(
            "SELECT id FROM volumes WHERE book_id = ? AND summary_status != 'ready' ORDER BY volume_num ASC",
            (book_id,),
        ).fetchall()
        vol_ids = [int(r["id"]) for r in rows]
    if not vol_ids:
        return {"started": False, "queued_volume_ids": [], "message": "All volumes already summarized"}
    mgr = _get_summarizer(request)
    try:
        queued = mgr.start_volumes(
            db, settings, current_user.id, book_id, vol_ids, provider_id=body.provider_id
        )
    except RuntimeError as exc:
        raise HTTPException(status_code=409, detail=str(exc))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    return {"started": True, "queued_volume_ids": queued}


@router.post("/{book_id}/volumes/summarize-pause")
def pause_summarization(
    book_id: int,
    request: Request,
    current_user: CurrentUser = Depends(get_current_user),
    db: Database = Depends(get_db),
) -> dict:
    with db.session() as conn:
        _require_owned_book(conn, book_id, current_user.id)
    paused = _get_summarizer(request).pause_book(book_id)
    return {"pause_requested": paused}


@router.get("/{book_id}/volumes/summarize-status")
def summarize_status(
    book_id: int,
    request: Request,
    current_user: CurrentUser = Depends(get_current_user),
    db: Database = Depends(get_db),
) -> dict:
    with db.session() as conn:
        _require_owned_book(conn, book_id, current_user.id)
        rows = conn.execute(
            "SELECT id, volume_num, title, summary_status, summary_progress "
            "FROM volumes WHERE book_id = ? ORDER BY volume_num ASC",
            (book_id,),
        ).fetchall()
    volumes = []
    for r in rows:
        prog = None
        if r["summary_progress"]:
            try:
                prog = json.loads(r["summary_progress"])
            except Exception:
                prog = None
        volumes.append(
            {
                "id": r["id"],
                "volume_num": r["volume_num"],
                "title": r["title"],
                "summary_status": r["summary_status"],
                "summary_progress": prog,
            }
        )
    return {"running": _get_summarizer(request).is_running(book_id), "volumes": volumes}


@router.get("/{book_id}/chapters")
def list_chapters(
    book_id: int,
    volume_id: Optional[int] = Query(default=None),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=200),
    current_user: CurrentUser = Depends(get_current_user),
    db: Database = Depends(get_db),
) -> dict:
    with db.session() as conn:
        _require_owned_book(conn, book_id, current_user.id)
        offset = (page - 1) * page_size
        if volume_id is not None:
            total = conn.execute(
                "SELECT COUNT(*) FROM chapters WHERE book_id = ? AND volume_id = ?",
                (book_id, volume_id),
            ).fetchone()[0]
            rows = conn.execute(
                "SELECT id, volume_id, chapter_num, title, char_count FROM chapters "
                "WHERE book_id = ? AND volume_id = ? ORDER BY chapter_num ASC LIMIT ? OFFSET ?",
                (book_id, volume_id, page_size, offset),
            ).fetchall()
        else:
            total = conn.execute(
                "SELECT COUNT(*) FROM chapters WHERE book_id = ?",
                (book_id,),
            ).fetchone()[0]
            rows = conn.execute(
                "SELECT id, volume_id, chapter_num, title, char_count FROM chapters "
                "WHERE book_id = ? ORDER BY chapter_num ASC LIMIT ? OFFSET ?",
                (book_id, page_size, offset),
            ).fetchall()
    return {
        "total": total,
        "page": page,
        "page_size": page_size,
        "items": [dict(r) for r in rows],
    }


@router.get("/{book_id}/chapters/{chapter_num}")
def read_chapter_endpoint(
    book_id: int,
    chapter_num: int,
    highlight: Optional[str] = Query(default=None),
    current_user: CurrentUser = Depends(get_current_user),
    db: Database = Depends(get_db),
) -> dict:
    with db.session() as conn:
        _require_owned_book(conn, book_id, current_user.id)
        row = conn.execute(
            "SELECT c.id, c.book_id, c.volume_id, c.chapter_num, c.title, c.content, c.char_count, "
            "v.volume_num, v.title AS volume_title "
            "FROM chapters c JOIN volumes v ON v.id = c.volume_id "
            "WHERE c.book_id = ? AND c.chapter_num = ?",
            (book_id, chapter_num),
        ).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="Chapter not found")
    data = dict(row)
    positions: list[dict[str, int]] = []
    if highlight and highlight.strip():
        kw = highlight.strip()
        content_lower = data["content"].lower()
        kw_lower = kw.lower()
        pos = 0
        while len(positions) < 50:
            idx = content_lower.find(kw_lower, pos)
            if idx == -1:
                break
            positions.append({"start": idx, "end": idx + len(kw)})
            pos = idx + len(kw)
    data["highlight_positions"] = positions
    return data


@router.get("/{book_id}/aliases")
def list_aliases(
    book_id: int,
    current_user: CurrentUser = Depends(get_current_user),
    db: Database = Depends(get_db),
) -> list[dict]:
    with db.session() as conn:
        _require_owned_book(conn, book_id, current_user.id)
        rows = conn.execute(
            "SELECT id, canonical_name, aliases_json FROM book_aliases WHERE book_id = ? ORDER BY id ASC",
            (book_id,),
        ).fetchall()
    return [
        {
            "id": r["id"],
            "canonical_name": r["canonical_name"],
            "aliases": json.loads(r["aliases_json"]),
        }
        for r in rows
    ]


@router.post("/{book_id}/aliases", status_code=status.HTTP_201_CREATED)
def upsert_alias(
    book_id: int,
    body: AliasCreateRequest,
    current_user: CurrentUser = Depends(get_current_user),
    db: Database = Depends(get_db),
) -> dict:
    canonical = body.canonical_name.strip()
    clean_aliases = sorted({a.strip() for a in body.aliases if a.strip() and a.strip() != canonical})
    with db.session() as conn:
        _require_owned_book(conn, book_id, current_user.id)
        conn.execute(
            "INSERT INTO book_aliases (book_id, canonical_name, aliases_json) VALUES (?, ?, ?) "
            "ON CONFLICT(book_id, canonical_name) DO UPDATE SET aliases_json = excluded.aliases_json",
            (book_id, canonical, json.dumps(clean_aliases, ensure_ascii=False)),
        )
        row = conn.execute(
            "SELECT id, canonical_name, aliases_json FROM book_aliases WHERE book_id = ? AND canonical_name = ?",
            (book_id, canonical),
        ).fetchone()
    if body.reindex:
        rebuild_book_fts(db, book_id)
    return {
        "id": row["id"],
        "canonical_name": row["canonical_name"],
        "aliases": json.loads(row["aliases_json"]),
    }


@router.delete("/{book_id}/aliases/{alias_id}")
def delete_alias(
    book_id: int,
    alias_id: int,
    current_user: CurrentUser = Depends(get_current_user),
    db: Database = Depends(get_db),
) -> dict:
    with db.session() as conn:
        _require_owned_book(conn, book_id, current_user.id)
        cur = conn.execute(
            "DELETE FROM book_aliases WHERE id = ? AND book_id = ?",
            (alias_id, book_id),
        )
        if cur.rowcount == 0:
            raise HTTPException(status_code=404, detail="Alias entry not found")
    return {"deleted": True, "alias_id": alias_id}


@router.post("/{book_id}/aliases/reindex")
def reindex_book_aliases(
    book_id: int,
    current_user: CurrentUser = Depends(get_current_user),
    db: Database = Depends(get_db),
) -> dict:
    with db.session() as conn:
        _require_owned_book(conn, book_id, current_user.id)
    count = rebuild_book_fts(db, book_id)
    return {"reindexed_chapters": count}


@router.get("/{book_id}/wiki")
def list_wiki_notes(
    book_id: int,
    current_user: CurrentUser = Depends(get_current_user),
    db: Database = Depends(get_db),
) -> list[dict]:
    with db.session() as conn:
        _require_owned_book(conn, book_id, current_user.id)
        rows = conn.execute(
            "SELECT id, entity_name, category, content_md, source_chapters_json, updated_at "
            "FROM wiki_notes WHERE book_id = ? ORDER BY updated_at DESC, id DESC",
            (book_id,),
        ).fetchall()
    return [
        {
            "id": r["id"],
            "entity_name": r["entity_name"],
            "category": r["category"],
            "content_md": r["content_md"],
            "source_chapters": json.loads(r["source_chapters_json"]),
            "updated_at": r["updated_at"],
        }
        for r in rows
    ]


@router.post("/{book_id}/wiki", status_code=status.HTTP_201_CREATED)
def upsert_wiki_note(
    book_id: int,
    body: WikiUpsertRequest,
    current_user: CurrentUser = Depends(get_current_user),
    db: Database = Depends(get_db),
) -> dict:
    now = utcnow_iso()
    entity = body.entity_name.strip()
    with db.session() as conn:
        _require_owned_book(conn, book_id, current_user.id)
        conn.execute(
            "INSERT INTO wiki_notes (book_id, entity_name, category, content_md, source_chapters_json, updated_at) "
            "VALUES (?, ?, ?, ?, ?, ?) "
            "ON CONFLICT(book_id, entity_name) DO UPDATE SET "
            "category = excluded.category, content_md = excluded.content_md, "
            "source_chapters_json = excluded.source_chapters_json, updated_at = excluded.updated_at",
            (
                book_id,
                entity,
                body.category.strip() or "人物",
                body.content_md.strip(),
                json.dumps(sorted(set(body.source_chapters))),
                now,
            ),
        )
        row = conn.execute(
            "SELECT id, entity_name, category, content_md, source_chapters_json, updated_at "
            "FROM wiki_notes WHERE book_id = ? AND entity_name = ?",
            (book_id, entity),
        ).fetchone()
    return {
        "id": row["id"],
        "entity_name": row["entity_name"],
        "category": row["category"],
        "content_md": row["content_md"],
        "source_chapters": json.loads(row["source_chapters_json"]),
        "updated_at": row["updated_at"],
    }


@router.delete("/{book_id}/wiki/{wiki_id}")
def delete_wiki_note(
    book_id: int,
    wiki_id: int,
    current_user: CurrentUser = Depends(get_current_user),
    db: Database = Depends(get_db),
) -> dict:
    with db.session() as conn:
        _require_owned_book(conn, book_id, current_user.id)
        cur = conn.execute(
            "DELETE FROM wiki_notes WHERE id = ? AND book_id = ?",
            (wiki_id, book_id),
        )
        if cur.rowcount == 0:
            raise HTTPException(status_code=404, detail="Wiki note not found")
    return {"deleted": True, "wiki_id": wiki_id}
