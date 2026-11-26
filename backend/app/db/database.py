from __future__ import annotations

import sqlite3
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterator

from app.config import Settings


def utcnow_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def validate_positive_id(value: int, name: str = "id") -> int:
    if not isinstance(value, int) or isinstance(value, bool) or value <= 0:
        raise ValueError(f"Invalid positive integer for {name}: {value!r}")
    return value


def book_fts_table(book_id: int) -> str:
    bid = validate_positive_id(book_id, "book_id")
    return f"chapters_fts_b{bid}"


def doc_fts_table(doc_id: int) -> str:
    did = validate_positive_id(doc_id, "doc_id")
    return f"doc_pages_fts_d{did}"


SCHEMA_SQL = """
CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('admin', 'user')),
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS system_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS books (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    author TEXT NOT NULL DEFAULT '',
    total_volumes INTEGER NOT NULL DEFAULT 0,
    total_chapters INTEGER NOT NULL DEFAULT 0,
    total_chars INTEGER NOT NULL DEFAULT 0,
    read_progress_ch INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_books_user_id ON books(user_id);

CREATE TABLE IF NOT EXISTS volumes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    book_id INTEGER NOT NULL REFERENCES books(id) ON DELETE CASCADE,
    volume_num INTEGER NOT NULL,
    title TEXT NOT NULL,
    start_chapter INTEGER NOT NULL,
    end_chapter INTEGER NOT NULL,
    summary_md TEXT NOT NULL DEFAULT '',
    summary_status TEXT NOT NULL DEFAULT 'none' CHECK (summary_status IN ('none', 'generating', 'paused', 'ready', 'error')),
    summary_progress TEXT NOT NULL DEFAULT '',
    UNIQUE(book_id, volume_num)
);
CREATE INDEX IF NOT EXISTS idx_volumes_book_id ON volumes(book_id);

CREATE TABLE IF NOT EXISTS chapters (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    book_id INTEGER NOT NULL REFERENCES books(id) ON DELETE CASCADE,
    volume_id INTEGER NOT NULL REFERENCES volumes(id) ON DELETE CASCADE,
    chapter_num INTEGER NOT NULL,
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    char_count INTEGER NOT NULL,
    fingerprint TEXT NOT NULL,
    UNIQUE(book_id, chapter_num)
);
CREATE INDEX IF NOT EXISTS idx_chapters_book_vol ON chapters(book_id, volume_id, chapter_num);

CREATE TABLE IF NOT EXISTS book_aliases (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    book_id INTEGER NOT NULL REFERENCES books(id) ON DELETE CASCADE,
    canonical_name TEXT NOT NULL,
    aliases_json TEXT NOT NULL DEFAULT '[]',
    UNIQUE(book_id, canonical_name)
);
CREATE INDEX IF NOT EXISTS idx_book_aliases_book_id ON book_aliases(book_id);

CREATE TABLE IF NOT EXISTS wiki_notes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    book_id INTEGER NOT NULL REFERENCES books(id) ON DELETE CASCADE,
    entity_name TEXT NOT NULL,
    category TEXT NOT NULL DEFAULT '人物',
    content_md TEXT NOT NULL,
    source_chapters_json TEXT NOT NULL DEFAULT '[]',
    updated_at TEXT NOT NULL,
    UNIQUE(book_id, entity_name)
);
CREATE INDEX IF NOT EXISTS idx_wiki_notes_book_id ON wiki_notes(book_id);

CREATE TABLE IF NOT EXISTS documents (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    filename TEXT NOT NULL,
    file_type TEXT NOT NULL CHECK (file_type IN ('pdf', 'pptx', 'docx', 'md', 'txt')),
    total_pages INTEGER NOT NULL DEFAULT 0,
    total_chars INTEGER NOT NULL DEFAULT 0,
    has_scanned_pages INTEGER NOT NULL DEFAULT 0,
    scanned_page_count INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_documents_user_id ON documents(user_id);

CREATE TABLE IF NOT EXISTS doc_pages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    doc_id INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    page_num INTEGER NOT NULL,
    heading TEXT NOT NULL DEFAULT '',
    content TEXT NOT NULL,
    char_count INTEGER NOT NULL DEFAULT 0,
    text_density REAL NOT NULL DEFAULT 0.0,
    is_scanned_suspect INTEGER NOT NULL DEFAULT 0,
    UNIQUE(doc_id, page_num)
);
CREATE INDEX IF NOT EXISTS idx_doc_pages_doc_id ON doc_pages(doc_id, page_num);

CREATE TABLE IF NOT EXISTS llm_providers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    protocol TEXT NOT NULL CHECK (protocol IN ('openai_compat', 'anthropic', 'gemini')),
    base_url TEXT NOT NULL,
    api_key_enc TEXT NOT NULL,
    model_name TEXT NOT NULL,
    is_default INTEGER NOT NULL DEFAULT 0,
    supports_tools INTEGER NOT NULL DEFAULT 1,
    use_react_fallback INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_llm_providers_user_id ON llm_providers(user_id);

CREATE TABLE IF NOT EXISTS chat_sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    mode TEXT NOT NULL CHECK (mode IN ('novel', 'document')),
    target_id INTEGER NOT NULL,
    title TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_chat_sessions_user ON chat_sessions(user_id, mode, target_id);

CREATE TABLE IF NOT EXISTS chat_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id INTEGER NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
    role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
    content TEXT NOT NULL,
    tool_trace_json TEXT NOT NULL DEFAULT '[]',
    citations_json TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_chat_messages_session ON chat_messages(session_id, id);
"""


class Database:
    """Thread-safe SQLite manager using per-operation connections with WAL mode."""

    def __init__(self, db_path: Path) -> None:
        self.db_path = Path(db_path)
        self.db_path.parent.mkdir(parents=True, exist_ok=True)

    def connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(str(self.db_path), timeout=30.0, check_same_thread=False)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("PRAGMA foreign_keys=ON")
        conn.execute("PRAGMA synchronous=NORMAL")
        conn.execute("PRAGMA busy_timeout=5000")
        return conn

    @contextmanager
    def session(self, immediate: bool = False) -> Iterator[sqlite3.Connection]:
        conn = self.connect()
        try:
            if immediate:
                conn.execute("BEGIN IMMEDIATE")
            yield conn
            conn.commit()
        except Exception:
            conn.rollback()
            raise
        finally:
            conn.close()

    def init_schema(self, settings: Settings) -> None:
        with self.session() as conn:
            conn.executescript(SCHEMA_SQL)
            defaults = {
                "allow_registration": "true" if settings.allow_registration else "false",
                "invite_code": settings.invite_code,
                "max_upload_mb": str(settings.max_upload_mb),
            }
            for key, val in defaults.items():
                conn.execute(
                    "INSERT OR IGNORE INTO system_settings (key, value) VALUES (?, ?)",
                    (key, val),
                )

    @staticmethod
    def ensure_book_fts(conn: sqlite3.Connection, book_id: int) -> str:
        table = book_fts_table(book_id)
        conn.execute(
            f"CREATE VIRTUAL TABLE IF NOT EXISTS {table} "
            "USING fts5(title_seg, content_seg, chapter_num UNINDEXED, content='', tokenize='unicode61')"
        )
        return table

    @staticmethod
    def drop_book_fts(conn: sqlite3.Connection, book_id: int) -> None:
        table = book_fts_table(book_id)
        conn.execute(f"DROP TABLE IF EXISTS {table}")

    @staticmethod
    def ensure_doc_fts(conn: sqlite3.Connection, doc_id: int) -> str:
        table = doc_fts_table(doc_id)
        conn.execute(
            f"CREATE VIRTUAL TABLE IF NOT EXISTS {table} "
            "USING fts5(heading_seg, content_seg, page_num UNINDEXED, content='', tokenize='unicode61')"
        )
        return table

    @staticmethod
    def drop_doc_fts(conn: sqlite3.Connection, doc_id: int) -> None:
        table = doc_fts_table(doc_id)
        conn.execute(f"DROP TABLE IF EXISTS {table}")


def get_system_settings_dict(conn: sqlite3.Connection) -> dict[str, object]:
    rows = conn.execute("SELECT key, value FROM system_settings").fetchall()
    raw = {row["key"]: row["value"] for row in rows}
    return {
        "allow_registration": raw.get("allow_registration", "true").lower() == "true",
        "invite_code": raw.get("invite_code", ""),
        "max_upload_mb": int(raw.get("max_upload_mb", "100")),
    }
