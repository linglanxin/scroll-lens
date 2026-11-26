from __future__ import annotations

from pathlib import Path
from typing import Iterator

import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app


@pytest.fixture()
def app_client(tmp_path: Path) -> Iterator[tuple[TestClient, object]]:
    settings = Settings(
        app_secret_key="test-secret-key-for-scroll-lens-pytest",
        data_dir=tmp_path,
        db_path=tmp_path / "test_scroll_lens.db",
        allow_registration=True,
        invite_code="",
        max_upload_mb=50,
    )
    app = create_app(settings)
    with TestClient(app) as client:
        yield client, app
