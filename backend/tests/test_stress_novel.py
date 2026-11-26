from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path


def test_large_novel_ingestion_memory_disk_and_query_latency(tmp_path: Path) -> None:
    """
    Stress test in a clean backend process with a 5,000,000+ character (~1,200 chapters, 12 volumes) Chinese novel.
    Verifies:
    - Ingestion time < 25s
    - Zero-redundancy content='' FTS5 DB overhead < 1.8x raw text bytes
    - Search & timeline query latency < 100ms
    - Real server process RSS memory <= 180 MiB
    """
    script = """
import gc, json, os, sys, time
from pathlib import Path
import jieba
import psutil

from app.main import app  # simulate full FastAPI backend server loaded
from app.config import Settings
from app.db.database import Database
from app.engines.novel.indexer import ingest_book
from app.engines.novel.parser import parse_txt_novel
from app.engines.novel.search import get_keyword_timeline, search_chapters

tmp_path = Path(sys.argv[1])
jieba.initialize()

paragraphs = (
    "建安元年秋，泰山郡秋风萧瑟，陈曦与刘备站在城头远眺东方青州方向。\\n"
    "白马义从的斥候疾驰而来，禀报袁绍大军动向，帐中诸将神色凝重。\\n"
    "郭嘉轻摇折扇，微笑道出天下三分之势与内气离体武者之妙。\\n"
)
chapter_body = paragraphs * 32
lines = []
ch_num = 0
for vol in range(1, 13):
    lines.append(f"第{vol}卷 风云卷{vol}")
    for _ in range(100):
        ch_num += 1
        extra = " 特别暗号玄武阵图 " if ch_num in (120, 650, 1180) else ""
        lines.append(f"第{ch_num}章 卷{vol}之战{ch_num}")
        lines.append(chapter_body + extra)

raw_bytes = "\\n".join(lines).encode("utf-8")
raw_len = len(raw_bytes)
del lines
gc.collect()

db_path = tmp_path / "stress.db"
settings = Settings(data_dir=tmp_path, db_path=db_path)
db = Database(db_path)
db.init_schema(settings)
with db.session() as conn:
    conn.execute(
        "INSERT INTO users (username, password_hash, role, is_active, created_at) "
        "VALUES ('stress_user', 'hash', 'admin', 1, '2026-01-01T00:00:00Z')"
    )
    uid = conn.execute("SELECT id FROM users WHERE username = 'stress_user'").fetchone()["id"]

t0 = time.perf_counter()
parsed = parse_txt_novel(raw_bytes, "超长压测小说")
del raw_bytes
gc.collect()
vol_count = len(parsed.volumes)
ch_count = sum(len(v.chapters) for v in parsed.volumes)
book_id = ingest_book(db, uid, parsed)
del parsed
gc.collect()
ingest_sec = time.perf_counter() - t0

with db.session() as conn:
    conn.execute("PRAGMA wal_checkpoint(TRUNCATE)")
db_size_bytes = db_path.stat().st_size

with db.session() as conn:
    q0 = time.perf_counter()
    hits = search_chapters(conn, book_id, ["玄武阵图"], max_chapter=1200, limit=15)
    search_ms = (time.perf_counter() - q0) * 1000

    q1 = time.perf_counter()
    tl = get_keyword_timeline(conn, book_id, "玄武阵图", max_chapter=1200, buckets=12)
    tl_ms = (time.perf_counter() - q1) * 1000

rss_mib = psutil.Process(os.getpid()).memory_info().rss / (1024 * 1024)
print(json.dumps({
    "vol_count": vol_count,
    "ch_count": ch_count,
    "raw_bytes": raw_len,
    "db_size_bytes": db_size_bytes,
    "size_ratio": db_size_bytes / raw_len,
    "ingest_sec": ingest_sec,
    "hit_chapters": [h["chapter_num"] for h in hits],
    "search_ms": search_ms,
    "tl_matching_chapters": tl["matching_chapters"],
    "tl_ms": tl_ms,
    "rss_mib": rss_mib,
}))
"""
    backend_root = Path(__file__).resolve().parent.parent
    proc = subprocess.run(
        [sys.executable, "-c", script, str(tmp_path)],
        cwd=str(backend_root),
        capture_output=True,
        text=True,
        timeout=60,
    )
    assert proc.returncode == 0, f"Subprocess failed:\nSTDOUT: {proc.stdout}\nSTDERR: {proc.stderr}"
    metrics = json.loads(proc.stdout.strip().splitlines()[-1])

    assert metrics["vol_count"] == 12
    assert metrics["ch_count"] == 1200
    assert metrics["ingest_sec"] < 25.0, f"Ingestion took {metrics['ingest_sec']:.2f}s"
    assert metrics["size_ratio"] < 1.8, f"DB size ratio {metrics['size_ratio']:.2f}x >= 1.8x"
    assert metrics["hit_chapters"] == [120, 650, 1180]
    assert metrics["search_ms"] < 100.0, f"Search took {metrics['search_ms']:.1f}ms"
    assert metrics["tl_matching_chapters"] == 3
    assert metrics["tl_ms"] < 100.0, f"Timeline took {metrics['tl_ms']:.1f}ms"
    assert metrics["rss_mib"] <= 180.0, f"Server RSS {metrics['rss_mib']:.1f} MiB exceeded 180 MiB budget"
