from __future__ import annotations

import json
import sqlite3

from app.db.database import Database, utcnow_iso
from app.engines.novel.parser import ParsedBook, ParsedChapter, ParsedVolume
from app.engines.novel.tokenizer import segment_with_aliases


def _load_alias_terms(conn: sqlite3.Connection, book_id: int) -> list[str]:
    rows = conn.execute(
        "SELECT canonical_name, aliases_json FROM book_aliases WHERE book_id = ?",
        (book_id,),
    ).fetchall()
    terms: list[str] = []
    for row in rows:
        terms.append(row["canonical_name"])
        try:
            terms.extend(json.loads(row["aliases_json"]))
        except Exception:
            pass
    return [t for t in terms if isinstance(t, str) and t.strip()]


def _index_chapters_batch(
    conn: sqlite3.Connection,
    fts_table: str,
    rows: list[tuple[int, int, str, str]],
    alias_terms: list[str],
) -> None:
    """rows: list of (chapter_id, chapter_num, title, content)."""
    batch: list[tuple[int, str, str, int]] = []
    for ch_id, ch_num, title, content in rows:
        title_seg = segment_with_aliases(title, alias_terms)
        content_seg = segment_with_aliases(content, alias_terms)
        batch.append((ch_id, title_seg, content_seg, ch_num))
        if len(batch) >= 200:
            conn.executemany(
                f"INSERT INTO {fts_table} (rowid, title_seg, content_seg, chapter_num) VALUES (?, ?, ?, ?)",
                batch,
            )
            batch.clear()
    if batch:
        conn.executemany(
            f"INSERT INTO {fts_table} (rowid, title_seg, content_seg, chapter_num) VALUES (?, ?, ?, ?)",
            batch,
        )


def ingest_book(
    db: Database,
    user_id: int,
    parsed: ParsedBook,
    author_override: str | None = None,
) -> int:
    """Ingest a parsed novel into SQLite with contentless FTS5 index."""
    now = utcnow_iso()
    author = author_override if author_override is not None else parsed.author
    total_volumes = len(parsed.volumes)
    total_chapters = sum(len(v.chapters) for v in parsed.volumes)
    total_chars = sum(c.char_count for v in parsed.volumes for c in v.chapters)

    with db.session() as conn:
        cur = conn.execute(
            "INSERT INTO books "
            "(user_id, title, author, total_volumes, total_chapters, total_chars, read_progress_ch, created_at, updated_at) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (user_id, parsed.title, author, total_volumes, total_chapters, total_chars, total_chapters, now, now),
        )
        book_id = int(cur.lastrowid)
        fts_table = db.ensure_book_fts(conn, book_id)

        to_index: list[tuple[int, int, str, str]] = []
        for vol in parsed.volumes:
            if not vol.chapters:
                continue
            start_ch = vol.chapters[0].chapter_num
            end_ch = vol.chapters[-1].chapter_num
            v_cur = conn.execute(
                "INSERT INTO volumes (book_id, volume_num, title, start_chapter, end_chapter, summary_md, summary_status) "
                "VALUES (?, ?, ?, ?, ?, '', 'none')",
                (book_id, vol.volume_num, vol.title, start_ch, end_ch),
            )
            vol_id = int(v_cur.lastrowid)

            for ch in vol.chapters:
                c_cur = conn.execute(
                    "INSERT INTO chapters (book_id, volume_id, chapter_num, title, content, char_count, fingerprint) "
                    "VALUES (?, ?, ?, ?, ?, ?, ?)",
                    (book_id, vol_id, ch.chapter_num, ch.title, ch.content, ch.char_count, ch.fingerprint),
                )
                to_index.append((int(c_cur.lastrowid), ch.chapter_num, ch.title, ch.content))
                if len(to_index) >= 200:
                    _index_chapters_batch(conn, fts_table, to_index, [])
                    to_index.clear()

        if to_index:
            _index_chapters_batch(conn, fts_table, to_index, [])

    return book_id


def append_book_chapters(db: Database, book_id: int, parsed: ParsedBook) -> dict[str, int]:
    """Incrementally append newly published chapters by matching trailing chapter fingerprints."""
    flat_new: list[tuple[str, ParsedChapter]] = [
        (vol.title, ch) for vol in parsed.volumes for ch in vol.chapters
    ]
    if not flat_new:
        return {"appended_chapters": 0, "new_total_chapters": 0}

    with db.session(immediate=True) as conn:
        book_row = conn.execute(
            "SELECT total_chapters, total_chars, read_progress_ch FROM books WHERE id = ?",
            (book_id,),
        ).fetchone()
        if book_row is None:
            raise ValueError("Book not found")

        old_total_chapters = int(book_row["total_chapters"])
        old_total_chars = int(book_row["total_chars"])
        old_progress = int(book_row["read_progress_ch"])

        # Fetch last 20 chapter fingerprints/titles to reliably align overlap
        tail_rows = conn.execute(
            "SELECT chapter_num, title, fingerprint FROM chapters "
            "WHERE book_id = ? ORDER BY chapter_num DESC LIMIT 20",
            (book_id,),
        ).fetchall()
        tail_fps = {r["fingerprint"]: r["chapter_num"] for r in tail_rows}
        last_existing = tail_rows[0] if tail_rows else None

        start_idx = 0
        if last_existing is not None:
            matched_idx = None
            # Search from end backwards for the last existing chapter's fingerprint
            for i in range(len(flat_new) - 1, -1, -1):
                if flat_new[i][1].fingerprint == last_existing["fingerprint"]:
                    matched_idx = i
                    break
            if matched_idx is not None:
                start_idx = matched_idx + 1
            else:
                # Fallback: match any of last 20 fingerprints
                for i in range(len(flat_new) - 1, -1, -1):
                    if flat_new[i][1].fingerprint in tail_fps:
                        matched_idx = i
                        break
                if matched_idx is not None:
                    start_idx = matched_idx + 1
                else:
                    # Fallback by exact title match with last chapter
                    for i in range(len(flat_new) - 1, -1, -1):
                        if flat_new[i][1].title == last_existing["title"]:
                            start_idx = i + 1
                            break

        new_entries = flat_new[start_idx:]
        if not new_entries:
            return {"appended_chapters": 0, "new_total_chapters": old_total_chapters}

        last_vol = conn.execute(
            "SELECT id, volume_num, title, start_chapter, end_chapter FROM volumes "
            "WHERE book_id = ? ORDER BY volume_num DESC LIMIT 1",
            (book_id,),
        ).fetchone()

        alias_terms = _load_alias_terms(conn, book_id)
        fts_table = db.ensure_book_fts(conn, book_id)

        cur_vol_id = int(last_vol["id"]) if last_vol else None
        cur_vol_title = str(last_vol["title"]) if last_vol else ""
        cur_vol_num = int(last_vol["volume_num"]) if last_vol else 0
        next_ch_num = old_total_chapters
        added_chars = 0
        to_index: list[tuple[int, int, str, str]] = []

        for vol_title, ch in new_entries:
            next_ch_num += 1
            added_chars += ch.char_count

            # Create new volume only if incoming volume title differs meaningfully from last volume
            # and isn't just the generic default when last_vol already exists
            should_create_vol = cur_vol_id is None or (
                vol_title != cur_vol_title and vol_title != "第一卷 正文"
            )
            if should_create_vol:
                cur_vol_num += 1
                v_cur = conn.execute(
                    "INSERT INTO volumes (book_id, volume_num, title, start_chapter, end_chapter, summary_md, summary_status) "
                    "VALUES (?, ?, ?, ?, ?, '', 'none')",
                    (book_id, cur_vol_num, vol_title, next_ch_num, next_ch_num),
                )
                cur_vol_id = int(v_cur.lastrowid)
                cur_vol_title = vol_title
            else:
                conn.execute(
                    "UPDATE volumes SET end_chapter = ? WHERE id = ?",
                    (next_ch_num, cur_vol_id),
                )

            c_cur = conn.execute(
                "INSERT INTO chapters (book_id, volume_id, chapter_num, title, content, char_count, fingerprint) "
                "VALUES (?, ?, ?, ?, ?, ?, ?)",
                (book_id, cur_vol_id, next_ch_num, ch.title, ch.content, ch.char_count, ch.fingerprint),
            )
            to_index.append((int(c_cur.lastrowid), next_ch_num, ch.title, ch.content))
            if len(to_index) >= 200:
                _index_chapters_batch(conn, fts_table, to_index, alias_terms)
                to_index.clear()

        if to_index:
            _index_chapters_batch(conn, fts_table, to_index, alias_terms)

        new_total_vols = conn.execute(
            "SELECT COUNT(*) FROM volumes WHERE book_id = ?", (book_id,)
        ).fetchone()[0]
        new_progress = next_ch_num if old_progress >= old_total_chapters else old_progress
        conn.execute(
            "UPDATE books SET total_volumes = ?, total_chapters = ?, total_chars = ?, "
            "read_progress_ch = ?, updated_at = ? WHERE id = ?",
            (
                new_total_vols,
                next_ch_num,
                old_total_chars + added_chars,
                new_progress,
                utcnow_iso(),
                book_id,
            ),
        )
        return {
            "appended_chapters": len(new_entries),
            "new_total_chapters": next_ch_num,
        }


def rebuild_book_fts(db: Database, book_id: int) -> int:
    """Drop and rebuild per-book contentless FTS5 table using current book aliases."""
    with db.session() as conn:
        db.drop_book_fts(conn, book_id)
        fts_table = db.ensure_book_fts(conn, book_id)
        alias_terms = _load_alias_terms(conn, book_id)

        cur = conn.execute(
            "SELECT id, chapter_num, title, content FROM chapters WHERE book_id = ? ORDER BY chapter_num ASC",
            (book_id,),
        )
        count = 0
        while True:
            rows = cur.fetchmany(200)
            if not rows:
                break
            payload = [(r["id"], r["chapter_num"], r["title"], r["content"]) for r in rows]
            _index_chapters_batch(conn, fts_table, payload, alias_terms)
            count += len(payload)
        return count


def split_book_volumes(db: Database, book_id: int, splits: list[dict]) -> list[dict]:
    """Redefine custom volume boundaries covering 1..total_chapters contiguously."""
    if not splits:
        raise ValueError("At least one volume split is required")

    ordered = sorted(splits, key=lambda s: int(s["start_chapter"]))
    with db.session(immediate=True) as conn:
        book = conn.execute("SELECT total_chapters FROM books WHERE id = ?", (book_id,)).fetchone()
        if book is None:
            raise ValueError("Book not found")
        total_chapters = int(book["total_chapters"])

        expected_start = 1
        for item in ordered:
            sc = int(item["start_chapter"])
            ec = int(item["end_chapter"])
            if sc != expected_start or ec < sc or ec > total_chapters:
                raise ValueError(
                    f"Volume splits must form a contiguous range covering 1..{total_chapters}"
                )
            expected_start = ec + 1
        if expected_start != total_chapters + 1:
            raise ValueError(f"Volume splits must end at chapter {total_chapters}")

        # Temporarily detach chapters via temp volume or delete after inserting new volumes
        # Since chapters.volume_id has FK ON DELETE CASCADE, insert new volumes first, re-point chapters, then delete old volumes!
        old_vol_ids = [
            r["id"]
            for r in conn.execute("SELECT id FROM volumes WHERE book_id = ?", (book_id,)).fetchall()
        ]
        # Shift old volume_num negative to avoid UNIQUE(book_id, volume_num) collisions
        for vid in old_vol_ids:
            conn.execute("UPDATE volumes SET volume_num = -id WHERE id = ?", (vid,))

        new_vols: list[dict] = []
        for idx, item in enumerate(ordered, start=1):
            sc = int(item["start_chapter"])
            ec = int(item["end_chapter"])
            title = str(item["title"]).strip() or f"第{idx}卷"
            v_cur = conn.execute(
                "INSERT INTO volumes (book_id, volume_num, title, start_chapter, end_chapter, summary_md, summary_status) "
                "VALUES (?, ?, ?, ?, ?, '', 'none')",
                (book_id, idx, title, sc, ec),
            )
            new_vid = int(v_cur.lastrowid)
            conn.execute(
                "UPDATE chapters SET volume_id = ? WHERE book_id = ? AND chapter_num BETWEEN ? AND ?",
                (new_vid, book_id, sc, ec),
            )
            new_vols.append(
                {
                    "id": new_vid,
                    "volume_num": idx,
                    "title": title,
                    "start_chapter": sc,
                    "end_chapter": ec,
                }
            )

        if old_vol_ids:
            placeholders = ",".join("?" for _ in old_vol_ids)
            conn.execute(f"DELETE FROM volumes WHERE id IN ({placeholders})", old_vol_ids)

        conn.execute(
            "UPDATE books SET total_volumes = ?, updated_at = ? WHERE id = ?",
            (len(new_vols), utcnow_iso(), book_id),
        )
        return new_vols
