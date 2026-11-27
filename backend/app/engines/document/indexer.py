from __future__ import annotations

import shutil
import sqlite3
from pathlib import Path

from app.db.database import Database, utcnow_iso
from app.engines.document.parsers import extract_document
from app.engines.novel.tokenizer import segment_with_aliases


def doc_scanned_dir(scanned_root: Path, doc_id: int) -> Path:
    return scanned_root / str(doc_id)


def find_scanned_page_image(scanned_root: Path, doc_id: int, page_num: int) -> tuple[bytes, str] | None:
    folder = doc_scanned_dir(scanned_root, doc_id)
    if not folder.is_dir():
        return None
    for ext, mime in (("png", "image/png"), ("jpg", "image/jpeg"), ("jpeg", "image/jpeg"), ("webp", "image/webp")):
        candidate = folder / f"page_{page_num}.{ext}"
        if candidate.is_file():
            return candidate.read_bytes(), mime
    return None


def has_scanned_page_assets(scanned_root: Path, doc_id: int) -> bool:
    folder = doc_scanned_dir(scanned_root, doc_id)
    return folder.is_dir() and any(folder.glob("page_*.*"))


def delete_doc_scanned_assets(scanned_root: Path, doc_id: int) -> None:
    folder = doc_scanned_dir(scanned_root, doc_id)
    if folder.exists():
        shutil.rmtree(folder, ignore_errors=True)


def rebuild_doc_fts(conn: sqlite3.Connection, db: Database, doc_id: int) -> int:
    db.drop_doc_fts(conn, doc_id)
    fts_table = db.ensure_doc_fts(conn, doc_id)
    rows = conn.execute(
        "SELECT id, page_num, heading, content FROM doc_pages WHERE doc_id = ? ORDER BY page_num ASC",
        (doc_id,),
    ).fetchall()
    batch = [
        (
            int(r["id"]),
            segment_with_aliases(str(r["heading"] or "")),
            segment_with_aliases(str(r["content"] or "")),
            int(r["page_num"]),
        )
        for r in rows
    ]
    if batch:
        conn.executemany(
            f"INSERT INTO {fts_table} (rowid, heading_seg, content_seg, page_num) VALUES (?, ?, ?, ?)",
            batch,
        )
    return len(batch)


def ingest_document(
    db: Database,
    user_id: int,
    filename: str,
    raw: bytes,
    scanned_root: Path | None = None,
) -> int:
    file_type, pages = extract_document(raw, filename)
    now = utcnow_iso()
    total_pages = len(pages)
    total_chars = sum(p.char_count for p in pages)
    scanned_count = sum(1 for p in pages if p.is_scanned_suspect)
    has_scanned = 1 if scanned_count > 0 else 0

    with db.session() as conn:
        cur = conn.execute(
            "INSERT INTO documents "
            "(user_id, filename, file_type, total_pages, total_chars, has_scanned_pages, scanned_page_count, created_at) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            (user_id, filename, file_type, total_pages, total_chars, has_scanned, scanned_count, now),
        )
        doc_id = int(cur.lastrowid)
        fts_table = db.ensure_doc_fts(conn, doc_id)

        batch: list[tuple[int, str, str, int]] = []
        for p in pages:
            p_cur = conn.execute(
                "INSERT INTO doc_pages (doc_id, page_num, heading, content, char_count, text_density, is_scanned_suspect) "
                "VALUES (?, ?, ?, ?, ?, ?, ?)",
                (
                    doc_id,
                    p.page_num,
                    p.heading,
                    p.content,
                    p.char_count,
                    p.text_density,
                    1 if p.is_scanned_suspect else 0,
                ),
            )
            batch.append(
                (
                    int(p_cur.lastrowid),
                    segment_with_aliases(p.heading),
                    segment_with_aliases(p.content),
                    p.page_num,
                )
            )
        if batch:
            conn.executemany(
                f"INSERT INTO {fts_table} (rowid, heading_seg, content_seg, page_num) VALUES (?, ?, ?, ?)",
                batch,
            )

    if scanned_root is not None:
        asset_dir: Path | None = None
        for p in pages:
            if p.is_scanned_suspect and p.scanned_image:
                if asset_dir is None:
                    asset_dir = doc_scanned_dir(scanned_root, doc_id)
                    asset_dir.mkdir(parents=True, exist_ok=True)
                ext = "jpg" if p.scanned_image_mime == "image/jpeg" else "png"
                (asset_dir / f"page_{p.page_num}.{ext}").write_bytes(p.scanned_image)
            p.scanned_image = None

    return doc_id
