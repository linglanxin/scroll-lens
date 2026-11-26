from __future__ import annotations

from app.db.database import Database, utcnow_iso
from app.engines.document.parsers import extract_document
from app.engines.novel.tokenizer import segment_with_aliases


def ingest_document(
    db: Database,
    user_id: int,
    filename: str,
    raw: bytes,
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

    return doc_id
