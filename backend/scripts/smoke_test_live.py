"""Standalone CLI smoke test for real novel ingestion/search and optional live LLM probe."""
from __future__ import annotations

import argparse
import asyncio
import json
import os
import sys
import tempfile
import time
from pathlib import Path

import psutil

BACKEND_ROOT = Path(__file__).resolve().parent.parent
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from app.config import Settings  # noqa: E402
from app.db.database import Database  # noqa: E402
from app.engines.novel.indexer import ingest_book  # noqa: E402
from app.engines.novel.parser import parse_epub_novel, parse_txt_novel  # noqa: E402
from app.engines.novel.search import get_keyword_timeline, search_chapters  # noqa: E402
from app.llm.factory import test_provider_connection  # noqa: E402


def run_novel_smoke(novel_path: Path, keyword: str | None) -> dict:
    raw = novel_path.read_bytes()
    ext = novel_path.suffix.lower()
    if ext not in (".txt", ".epub"):
        raise ValueError(f"Unsupported novel extension: {ext}")

    with tempfile.TemporaryDirectory() as tmp:
        tmp_dir = Path(tmp)
        db_path = tmp_dir / "smoke.db"
        db = Database(db_path)
        db.init_schema(Settings(data_dir=tmp_dir, db_path=db_path))
        with db.session() as conn:
            conn.execute(
                "INSERT INTO users (username, password_hash, role, is_active, created_at) "
                "VALUES ('smoke', 'hash', 'admin', 1, '2026-01-01T00:00:00Z')"
            )
            uid = conn.execute("SELECT id FROM users WHERE username='smoke'").fetchone()["id"]

        t0 = time.perf_counter()
        parsed = (
            parse_epub_novel(raw, novel_path.stem)
            if ext == ".epub"
            else parse_txt_novel(raw, novel_path.stem)
        )
        t1 = time.perf_counter()
        book_id = ingest_book(db, uid, parsed)
        t2 = time.perf_counter()

        with db.session() as conn:
            conn.execute("PRAGMA wal_checkpoint(TRUNCATE)")
            query_info = {}
            if keyword:
                q0 = time.perf_counter()
                hits = search_chapters(conn, book_id, [keyword], max_chapter=10_000_000, limit=5)
                tl = get_keyword_timeline(conn, book_id, keyword, max_chapter=10_000_000, buckets=10)
                query_info = {
                    "keyword": keyword,
                    "query_ms": round((time.perf_counter() - q0) * 1000, 2),
                    "matching_chapters": tl["matching_chapters"],
                    "first_chapter": tl["first_chapter"],
                    "last_chapter": tl["last_chapter"],
                    "top_hits": [h["chapter_num"] for h in hits],
                }

        db_bytes = db_path.stat().st_size
        rss_mib = psutil.Process(os.getpid()).memory_info().rss / (1024 * 1024)
        return {
            "file": str(novel_path),
            "raw_mb": round(len(raw) / (1024 * 1024), 2),
            "db_mb": round(db_bytes / (1024 * 1024), 2),
            "size_ratio": round(db_bytes / max(1, len(raw)), 3),
            "volumes": len(parsed.volumes),
            "chapters": sum(len(v.chapters) for v in parsed.volumes),
            "parse_sec": round(t1 - t0, 2),
            "ingest_sec": round(t2 - t1, 2),
            "rss_mib": round(rss_mib, 1),
            "query": query_info,
        }


def main() -> int:
    parser = argparse.ArgumentParser(
        description="ScrollLens live smoke test for real novels and LLM providers."
    )
    parser.add_argument("--novel", type=Path, help="Path to a real .txt or .epub novel file")
    parser.add_argument("--keyword", type=str, default=None, help="Optional keyword to benchmark search & timeline")
    parser.add_argument("--protocol", choices=["openai_compat", "anthropic", "gemini"], help="LLM protocol")
    parser.add_argument("--base-url", type=str, help="LLM API base URL")
    parser.add_argument("--api-key", type=str, help="LLM API key")
    parser.add_argument("--model", type=str, help="Model name")
    args = parser.parse_args()

    if not args.novel and not args.protocol:
        parser.print_help()
        return 1

    output: dict = {}
    if args.novel:
        output["novel_smoke"] = run_novel_smoke(args.novel, args.keyword)

    if args.protocol:
        if not (args.base_url and args.api_key and args.model):
            print("Error: --protocol requires --base-url, --api-key, and --model", file=sys.stderr)
            return 2
        output["llm_probe"] = asyncio.run(
            test_provider_connection(args.protocol, args.base_url, args.api_key, args.model)
        )

    print(json.dumps(output, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
