from __future__ import annotations

import logging
import secrets
from functools import lru_cache
from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

logger = logging.getLogger(__name__)


class Settings(BaseSettings):
    """Application settings loaded from environment variables or .env."""

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    app_name: str = "ScrollLens"
    app_secret_key: str = ""
    data_dir: Path = Field(default=Path("data"))
    db_path: Path | None = None
    allow_registration: bool = True
    invite_code: str = ""
    max_upload_mb: int = 100
    jwt_expire_hours: int = 168
    cors_origins: str = "http://localhost:5173,http://127.0.0.1:5173"
    frontend_dist_dir: Path = Field(default=Path("../frontend/dist"))
    host: str = "0.0.0.0"
    port: int = 8000

    def resolved_data_dir(self) -> Path:
        self.data_dir.mkdir(parents=True, exist_ok=True)
        return self.data_dir

    def resolved_db_path(self) -> Path:
        if self.db_path is not None:
            self.db_path.parent.mkdir(parents=True, exist_ok=True)
            return self.db_path
        return self.resolved_data_dir() / "scroll_lens.db"

    def resolved_secret_key(self) -> str:
        if self.app_secret_key:
            return self.app_secret_key
        secret_file = self.resolved_data_dir() / ".secret_key"
        if secret_file.exists():
            stored = secret_file.read_text(encoding="utf-8").strip()
            if stored:
                self.app_secret_key = stored
                return stored
        generated = secrets.token_urlsafe(48)
        secret_file.write_text(generated, encoding="utf-8")
        logger.warning(
            "APP_SECRET_KEY was not set; generated and persisted a key to %s. "
            "Set APP_SECRET_KEY in .env for production.",
            secret_file,
        )
        self.app_secret_key = generated
        return generated

    def cors_origin_list(self) -> list[str]:
        return [origin.strip() for origin in self.cors_origins.split(",") if origin.strip()]


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()
