from __future__ import annotations

from contextlib import asynccontextmanager
from pathlib import Path
from typing import AsyncIterator

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from app.api import admin, auth, books, chat, documents, providers
from app.config import Settings, get_settings
from app.db.database import Database
from app.engines.novel.volume_summarizer import VolumeSummarizerManager


def create_app(settings: Settings | None = None) -> FastAPI:
    cfg = settings or get_settings()
    db = Database(cfg.resolved_db_path())
    summarizer = VolumeSummarizerManager()

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        cfg.resolved_secret_key()
        db.init_schema(cfg)
        yield
        await summarizer.shutdown()

    app = FastAPI(
        title="ScrollLens (卷镜) API",
        version="0.1.0",
        lifespan=lifespan,
    )
    app.state.settings = cfg
    app.state.db = db
    app.state.summarizer = summarizer

    app.add_middleware(
        CORSMiddleware,
        allow_origins=cfg.cors_origin_list() or ["*"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.get("/api/v1/health", tags=["health"])
    def health() -> dict[str, str]:
        return {"status": "ok", "service": "scroll-lens"}

    app.include_router(auth.router)
    app.include_router(admin.router)
    app.include_router(books.router)
    app.include_router(documents.router)
    app.include_router(providers.router)
    app.include_router(chat.router)

    dist_dir = Path(cfg.frontend_dist_dir)
    if dist_dir.is_dir() and (dist_dir / "index.html").is_file():
        assets_dir = dist_dir / "assets"
        if assets_dir.is_dir():
            app.mount("/assets", StaticFiles(directory=str(assets_dir)), name="assets")

        index_file = dist_dir / "index.html"

        @app.get("/{full_path:path}", include_in_schema=False)
        def serve_spa(full_path: str) -> FileResponse:
            if full_path.startswith("api/"):
                raise HTTPException(status_code=404, detail="API endpoint not found")
            candidate = (dist_dir / full_path).resolve()
            if full_path and candidate.is_file() and dist_dir.resolve() in candidate.parents:
                return FileResponse(str(candidate))
            return FileResponse(str(index_file))

    return app


app = create_app()
