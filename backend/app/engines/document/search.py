from __future__ import annotations

import sqlite3
from typing import Sequence

from app.db.database import doc_fts_table
from app.engines.novel.search import _extract_excerpt
from app.engines.novel.tokenizer import build_plain_fts_query

DOC_DIRECT_THRESHOLD = 40_000


def list_doc_outline(conn: sqlite3.Connection, doc_id: int) -> list[dict]:
    rows = conn.execute(
        "SELECT page_num, heading, char_count, text_density, is_scanned_suspect "
        "FROM doc_pages WHERE doc_id = ? ORDER BY page_num ASC",
        (doc_id,),
    ).fetchall()
    return [
        {
            "page_num": r["page_num"],
            "heading": r["heading"],
            "char_count": r["char_count"],
            "text_density": r["text_density"],
            "is_scanned_suspect": bool(r["is_scanned_suspect"]),
        }
        for r in rows
    ]


def search_doc_pages(
    conn: sqlite3.Connection,
    doc_id: int,
    keywords: Sequence[str],
    match_mode: str = "AND",
    limit: int = 10,
) -> list[dict]:
    limit = max(1, min(limit, 25))
    clean_kws = [k.strip() for k in keywords if k.strip()]
    if not clean_kws:
        return []

    fts_query = build_plain_fts_query(clean_kws, match_mode=match_mode)
    fts_table = doc_fts_table(doc_id)

    rows = []
    if fts_query:
        try:
            rows = conn.execute(
                f"SELECT p.page_num, p.heading, p.content, p.is_scanned_suspect, bm25({fts_table}) AS score "
                f"FROM {fts_table} f JOIN doc_pages p ON p.id = f.rowid "
                f"WHERE {fts_table} MATCH ? AND p.doc_id = ? "
                f"ORDER BY score ASC, p.page_num ASC LIMIT ?",
                (fts_query, doc_id, limit),
            ).fetchall()
        except sqlite3.OperationalError:
            rows = []

    if not rows:
        joiner = " OR " if match_mode.upper() == "OR" else " AND "
        clauses = joiner.join("(heading LIKE ? OR content LIKE ?)" for _ in clean_kws)
        params: list[object] = [doc_id]
        for kw in clean_kws:
            pat = f"%{kw}%"
            params.extend([pat, pat])
        params.append(limit)
        rows = conn.execute(
            f"SELECT page_num, heading, content, is_scanned_suspect "
            f"FROM doc_pages WHERE doc_id = ? AND ({clauses}) ORDER BY page_num ASC LIMIT ?",
            params,
        ).fetchall()

    return [
        {
            "page_num": r["page_num"],
            "heading": r["heading"],
            "is_scanned_suspect": bool(r["is_scanned_suspect"]),
            "excerpt": _extract_excerpt(r["content"], clean_kws, radius=180),
        }
        for r in rows
    ]


def read_doc_page(
    conn: sqlite3.Connection,
    doc_id: int,
    page_num: int,
    max_chars: int = 4000,
) -> dict:
    row = conn.execute(
        "SELECT page_num, heading, content, char_count, text_density, is_scanned_suspect "
        "FROM doc_pages WHERE doc_id = ? AND page_num = ?",
        (doc_id, page_num),
    ).fetchone()
    if row is None:
        return {"error": f"Page {page_num} not found."}
    content = str(row["content"])
    truncated = False
    if len(content) > max_chars:
        content = content[:max_chars] + "\n...[后略]..."
        truncated = True
    return {
        "page_num": row["page_num"],
        "heading": row["heading"],
        "char_count": row["char_count"],
        "text_density": row["text_density"],
        "is_scanned_suspect": bool(row["is_scanned_suspect"]),
        "truncated": truncated,
        "content": content,
    }
