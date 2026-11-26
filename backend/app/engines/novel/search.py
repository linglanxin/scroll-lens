from __future__ import annotations

import json
import sqlite3
from typing import Sequence

from app.db.database import book_fts_table
from app.engines.novel.tokenizer import build_fts_query


def get_alias_groups(conn: sqlite3.Connection, book_id: int) -> list[list[str]]:
    rows = conn.execute(
        "SELECT canonical_name, aliases_json FROM book_aliases WHERE book_id = ?",
        (book_id,),
    ).fetchall()
    groups: list[list[str]] = []
    for r in rows:
        group = [r["canonical_name"]]
        try:
            aliases = json.loads(r["aliases_json"])
            if isinstance(aliases, list):
                group.extend(str(a) for a in aliases if str(a).strip())
        except Exception:
            pass
        groups.append(group)
    return groups


def _expand_terms_for_like(keywords: Sequence[str], alias_groups: list[list[str]]) -> list[list[str]]:
    term_map: dict[str, list[str]] = {}
    for g in alias_groups:
        for t in g:
            term_map[t] = g
    return [term_map.get(kw.strip(), [kw.strip()]) for kw in keywords if kw.strip()]


def _extract_excerpt(text: str, terms: Sequence[str], radius: int = 150) -> str:
    if not text:
        return ""
    best_idx = -1
    lower_text = text.lower()
    for t in terms:
        if not t:
            continue
        idx = lower_text.find(t.lower())
        if idx != -1 and (best_idx == -1 or idx < best_idx):
            best_idx = idx
    if best_idx == -1:
        snippet = text[: radius * 2].strip()
        return snippet + ("..." if len(text) > radius * 2 else "")
    start = max(0, best_idx - radius)
    end = min(len(text), best_idx + radius)
    prefix = "..." if start > 0 else ""
    suffix = "..." if end < len(text) else ""
    return f"{prefix}{text[start:end].strip()}{suffix}"


def list_volumes(conn: sqlite3.Connection, book_id: int, max_chapter: int) -> list[dict]:
    rows = conn.execute(
        "SELECT id, volume_num, title, start_chapter, end_chapter, summary_md, summary_status "
        "FROM volumes WHERE book_id = ? AND start_chapter <= ? ORDER BY volume_num ASC",
        (book_id, max_chapter),
    ).fetchall()
    result: list[dict] = []
    for r in rows:
        end_ch = int(r["end_chapter"])
        # Anti-spoiler lock: NEVER expose volume summary if volume extends beyond max_chapter
        summary_allowed = end_ch <= max_chapter
        result.append(
            {
                "volume_id": r["id"],
                "volume_num": r["volume_num"],
                "title": r["title"],
                "start_chapter": r["start_chapter"],
                "end_chapter": end_ch,
                "summary_status": r["summary_status"] if summary_allowed else "locked_spoiler",
                "summary_md": r["summary_md"] if summary_allowed else "",
            }
        )
    return result


def search_chapters(
    conn: sqlite3.Connection,
    book_id: int,
    keywords: Sequence[str],
    max_chapter: int,
    match_mode: str = "AND",
    volume_num: int | None = None,
    start_ch: int | None = None,
    end_ch: int | None = None,
    limit: int = 15,
) -> list[dict]:
    limit = max(1, min(limit, 30))
    eff_start = max(1, start_ch) if start_ch is not None else 1
    eff_end = min(max_chapter, end_ch) if end_ch is not None else max_chapter

    if volume_num is not None:
        vol_row = conn.execute(
            "SELECT start_chapter, end_chapter FROM volumes WHERE book_id = ? AND volume_num = ?",
            (book_id, volume_num),
        ).fetchone()
        if vol_row is None:
            return []
        eff_start = max(eff_start, int(vol_row["start_chapter"]))
        eff_end = min(eff_end, int(vol_row["end_chapter"]))

    if eff_end < eff_start:
        return []

    alias_groups = get_alias_groups(conn, book_id)
    expanded_groups = _expand_terms_for_like(keywords, alias_groups)
    flat_terms = [t for g in expanded_groups for t in g]
    fts_query = build_fts_query(keywords, alias_groups=alias_groups, match_mode=match_mode)
    fts_table = book_fts_table(book_id)

    rows = []
    if fts_query:
        try:
            sql = (
                f"SELECT c.id, c.chapter_num, c.title, c.content, v.volume_num, v.title AS volume_title, "
                f"bm25({fts_table}) AS score "
                f"FROM {fts_table} f "
                f"JOIN chapters c ON c.id = f.rowid "
                f"JOIN volumes v ON v.id = c.volume_id "
                f"WHERE {fts_table} MATCH ? AND c.book_id = ? AND c.chapter_num BETWEEN ? AND ? "
                f"ORDER BY score ASC, c.chapter_num ASC LIMIT ?"
            )
            rows = conn.execute(sql, (fts_query, book_id, eff_start, eff_end, limit)).fetchall()
        except sqlite3.OperationalError:
            rows = []

    # Fallback: LIKE scan within bounded chapter range
    if not rows and expanded_groups:
        group_clauses: list[str] = []
        params: list[object] = [book_id, eff_start, eff_end]
        for grp in expanded_groups:
            or_sub = []
            for term in grp:
                or_sub.append("(c.title LIKE ? OR c.content LIKE ?)")
                like_pat = f"%{term}%"
                params.extend([like_pat, like_pat])
            group_clauses.append("(" + " OR ".join(or_sub) + ")")
        joiner = " OR " if match_mode.upper() == "OR" else " AND "
        where_expr = joiner.join(group_clauses)
        sql = (
            f"SELECT c.id, c.chapter_num, c.title, c.content, v.volume_num, v.title AS volume_title "
            f"FROM chapters c JOIN volumes v ON v.id = c.volume_id "
            f"WHERE c.book_id = ? AND c.chapter_num BETWEEN ? AND ? AND ({where_expr}) "
            f"ORDER BY c.chapter_num ASC LIMIT ?"
        )
        params.append(limit)
        rows = conn.execute(sql, params).fetchall()

    results: list[dict] = []
    for r in rows:
        results.append(
            {
                "chapter_num": r["chapter_num"],
                "title": r["title"],
                "volume_num": r["volume_num"],
                "volume_title": r["volume_title"],
                "excerpt": _extract_excerpt(r["content"], flat_terms, radius=150),
            }
        )
    return results


def get_keyword_timeline(
    conn: sqlite3.Connection,
    book_id: int,
    keyword: str,
    max_chapter: int,
    buckets: int = 20,
) -> dict:
    kw = keyword.strip()
    if not kw or max_chapter < 1:
        return {
            "keyword": kw,
            "first_chapter": None,
            "last_chapter": None,
            "matching_chapters": 0,
            "total_occurrences": 0,
            "buckets": [],
        }

    alias_groups = get_alias_groups(conn, book_id)
    expanded_groups = _expand_terms_for_like([kw], alias_groups)
    variants = expanded_groups[0] if expanded_groups else [kw]

    fts_query = build_fts_query([kw], alias_groups=alias_groups, match_mode="OR")
    fts_table = book_fts_table(book_id)

    rows = []
    if fts_query:
        try:
            rows = conn.execute(
                f"SELECT c.chapter_num, c.title, c.content "
                f"FROM {fts_table} f "
                f"JOIN chapters c ON c.id = f.rowid "
                f"WHERE {fts_table} MATCH ? AND c.book_id = ? AND c.chapter_num <= ? "
                f"ORDER BY c.chapter_num ASC",
                (fts_query, book_id, max_chapter),
            ).fetchall()
        except sqlite3.OperationalError:
            rows = []

    if not rows:
        or_clauses = " OR ".join("(title LIKE ? OR content LIKE ?)" for _ in variants)
        params: list[object] = [book_id, max_chapter]
        for v in variants:
            pat = f"%{v}%"
            params.extend([pat, pat])
        rows = conn.execute(
            f"SELECT chapter_num, title, content FROM chapters "
            f"WHERE book_id = ? AND chapter_num <= ? AND ({or_clauses}) ORDER BY chapter_num ASC",
            params,
        ).fetchall()

    # Exact substring count per chapter for high-precision timeline
    matched_chapters: list[tuple[int, int]] = []
    total_occ = 0
    for r in rows:
        haystack = f"{r['title']}\n{r['content']}"
        cnt = sum(haystack.count(v) for v in variants)
        if cnt > 0:
            matched_chapters.append((int(r["chapter_num"]), cnt))
            total_occ += cnt

    if not matched_chapters:
        return {
            "keyword": kw,
            "expanded_terms": variants,
            "first_chapter": None,
            "last_chapter": None,
            "matching_chapters": 0,
            "total_occurrences": 0,
            "buckets": [],
        }

    buckets = max(1, min(buckets, 40))
    span = max(1, max_chapter)
    bucket_size = max(1, (span + buckets - 1) // buckets)
    bucket_list: list[dict] = []
    for b_idx in range(buckets):
        b_start = b_idx * bucket_size + 1
        if b_start > max_chapter:
            break
        b_end = min(max_chapter, (b_idx + 1) * bucket_size)
        ch_hits = 0
        occ_hits = 0
        for ch_num, cnt in matched_chapters:
            if b_start <= ch_num <= b_end:
                ch_hits += 1
                occ_hits += cnt
        bucket_list.append(
            {
                "start_ch": b_start,
                "end_ch": b_end,
                "matching_chapters": ch_hits,
                "occurrences": occ_hits,
            }
        )

    return {
        "keyword": kw,
        "expanded_terms": variants,
        "first_chapter": matched_chapters[0][0],
        "last_chapter": matched_chapters[-1][0],
        "matching_chapters": len(matched_chapters),
        "total_occurrences": total_occ,
        "buckets": bucket_list,
    }


def list_chapter_titles(
    conn: sqlite3.Connection,
    book_id: int,
    start_ch: int,
    end_ch: int,
    max_chapter: int,
) -> list[dict]:
    eff_start = max(1, start_ch)
    eff_end = min(max_chapter, end_ch, eff_start + 99)
    if eff_end < eff_start:
        return []
    rows = conn.execute(
        "SELECT c.chapter_num, c.title, c.char_count, v.volume_num, v.title AS volume_title "
        "FROM chapters c JOIN volumes v ON v.id = c.volume_id "
        "WHERE c.book_id = ? AND c.chapter_num BETWEEN ? AND ? "
        "ORDER BY c.chapter_num ASC LIMIT 100",
        (book_id, eff_start, eff_end),
    ).fetchall()
    return [dict(r) for r in rows]


def read_chapter(
    conn: sqlite3.Connection,
    book_id: int,
    chapter_num: int,
    max_chapter: int,
    focus_keyword: str | None = None,
    max_chars: int = 2500,
) -> dict:
    if chapter_num > max_chapter:
        return {
            "error": f"Chapter {chapter_num} exceeds your anti-spoiler progress limit ({max_chapter}).",
            "blocked_by_spoiler_lock": True,
        }
    row = conn.execute(
        "SELECT c.chapter_num, c.title, c.content, c.char_count, v.volume_num, v.title AS volume_title "
        "FROM chapters c JOIN volumes v ON v.id = c.volume_id "
        "WHERE c.book_id = ? AND c.chapter_num = ?",
        (book_id, chapter_num),
    ).fetchone()
    if row is None:
        return {"error": f"Chapter {chapter_num} not found."}

    content = str(row["content"])
    max_chars = max(500, min(max_chars, 6000))
    truncated = False
    if len(content) > max_chars:
        truncated = True
        if focus_keyword and focus_keyword.strip():
            idx = content.lower().find(focus_keyword.strip().lower())
            if idx != -1:
                half = max_chars // 2
                start = max(0, idx - half)
                end = min(len(content), start + max_chars)
                if end - start < max_chars:
                    start = max(0, end - max_chars)
                excerpt = content[start:end]
                content = (
                    ("...[前略]...\n" if start > 0 else "")
                    + excerpt
                    + ("\n...[后略]..." if end < len(row["content"]) else "")
                )
            else:
                content = content[:max_chars] + "\n...[后略]..."
        else:
            content = content[:max_chars] + "\n...[后略]..."

    return {
        "chapter_num": row["chapter_num"],
        "title": row["title"],
        "volume_num": row["volume_num"],
        "volume_title": row["volume_title"],
        "char_count": row["char_count"],
        "truncated": truncated,
        "content": content,
    }


def query_wiki_notes(conn: sqlite3.Connection, book_id: int, entity_name: str) -> list[dict]:
    name = entity_name.strip()
    if not name:
        rows = conn.execute(
            "SELECT id, entity_name, category, content_md, source_chapters_json, updated_at "
            "FROM wiki_notes WHERE book_id = ? ORDER BY updated_at DESC LIMIT 20",
            (book_id,),
        ).fetchall()
    else:
        alias_groups = get_alias_groups(conn, book_id)
        expanded = _expand_terms_for_like([name], alias_groups)
        terms = expanded[0] if expanded else [name]
        clauses = " OR ".join("(entity_name LIKE ? OR content_md LIKE ?)" for _ in terms)
        params: list[object] = [book_id]
        for t in terms:
            pat = f"%{t}%"
            params.extend([pat, pat])
        rows = conn.execute(
            f"SELECT id, entity_name, category, content_md, source_chapters_json, updated_at "
            f"FROM wiki_notes WHERE book_id = ? AND ({clauses}) ORDER BY updated_at DESC LIMIT 10",
            params,
        ).fetchall()

    results: list[dict] = []
    for r in rows:
        try:
            src_chs = json.loads(r["source_chapters_json"])
        except Exception:
            src_chs = []
        results.append(
            {
                "id": r["id"],
                "entity_name": r["entity_name"],
                "category": r["category"],
                "content_md": r["content_md"],
                "source_chapters": src_chs,
                "updated_at": r["updated_at"],
            }
        )
    return results
