from __future__ import annotations

import sqlite3
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field

from app.config import Settings
from app.core.deps import CurrentUser, get_app_settings, get_current_user, get_db
from app.core.security import decrypt_api_key, encrypt_api_key, mask_api_key
from app.db.database import Database, utcnow_iso
from app.llm.factory import create_adapter, test_provider_connection
from app.llm.presets import PROVIDER_PRESETS

router = APIRouter(prefix="/api/v1/providers", tags=["providers"])


class ProviderCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)
    protocol: str = Field(..., pattern="^(openai_compat|anthropic|gemini)$")
    base_url: str = Field(..., min_length=1, max_length=500)
    api_key: str = Field(..., min_length=1, max_length=500)
    model_name: str = Field(..., min_length=1, max_length=150)
    is_default: bool = False
    supports_tools: bool = True
    use_react_fallback: bool = False


class ProviderUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=100)
    protocol: Optional[str] = Field(default=None, pattern="^(openai_compat|anthropic|gemini)$")
    base_url: Optional[str] = Field(default=None, min_length=1, max_length=500)
    api_key: Optional[str] = Field(default=None, min_length=1, max_length=500)
    model_name: Optional[str] = Field(default=None, min_length=1, max_length=150)
    is_default: Optional[bool] = None
    supports_tools: Optional[bool] = None
    use_react_fallback: Optional[bool] = None


class ProviderProbeRequest(BaseModel):
    provider_id: Optional[int] = None
    protocol: Optional[str] = Field(default=None, pattern="^(openai_compat|anthropic|gemini)$")
    base_url: Optional[str] = None
    api_key: Optional[str] = None
    model_name: Optional[str] = None


def _format_provider(row: sqlite3.Row, secret_key: str) -> dict:
    plain_key = decrypt_api_key(row["api_key_enc"], secret_key)
    return {
        "id": row["id"],
        "name": row["name"],
        "protocol": row["protocol"],
        "base_url": row["base_url"],
        "api_key_masked": mask_api_key(plain_key),
        "model_name": row["model_name"],
        "is_default": bool(row["is_default"]),
        "supports_tools": bool(row["supports_tools"]),
        "use_react_fallback": bool(row["use_react_fallback"]),
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
    }


def _resolve_probe_credentials(
    body: ProviderProbeRequest,
    user_id: int,
    db: Database,
    secret_key: str,
    require_model: bool = True,
) -> tuple[str, str, str, str]:
    if body.provider_id is not None:
        with db.session() as conn:
            row = conn.execute(
                "SELECT * FROM llm_providers WHERE id = ? AND user_id = ?",
                (body.provider_id, user_id),
            ).fetchone()
        if row is None:
            raise HTTPException(status_code=404, detail="Provider not found")
        protocol = body.protocol or row["protocol"]
        base_url = body.base_url or row["base_url"]
        api_key = body.api_key or decrypt_api_key(row["api_key_enc"], secret_key)
        model_name = body.model_name or row["model_name"]
        return protocol, base_url, api_key, model_name

    if not body.protocol or not body.base_url or not body.api_key or (require_model and not body.model_name):
        raise HTTPException(
            status_code=400,
            detail="Provide either provider_id or protocol, base_url, api_key (and model_name)",
        )
    return body.protocol, body.base_url, body.api_key, body.model_name or ""


@router.get("/presets")
def get_presets() -> list[dict[str, str]]:
    return PROVIDER_PRESETS


@router.get("")
def list_providers(
    current_user: CurrentUser = Depends(get_current_user),
    db: Database = Depends(get_db),
    settings: Settings = Depends(get_app_settings),
) -> list[dict]:
    secret_key = settings.resolved_secret_key()
    with db.session() as conn:
        rows = conn.execute(
            "SELECT * FROM llm_providers WHERE user_id = ? ORDER BY is_default DESC, id DESC",
            (current_user.id,),
        ).fetchall()
    return [_format_provider(r, secret_key) for r in rows]


@router.post("", status_code=status.HTTP_201_CREATED)
def create_provider(
    body: ProviderCreate,
    current_user: CurrentUser = Depends(get_current_user),
    db: Database = Depends(get_db),
    settings: Settings = Depends(get_app_settings),
) -> dict:
    secret_key = settings.resolved_secret_key()
    now = utcnow_iso()
    enc_key = encrypt_api_key(body.api_key.strip(), secret_key)

    with db.session(immediate=True) as conn:
        existing_cnt = conn.execute(
            "SELECT COUNT(*) FROM llm_providers WHERE user_id = ?", (current_user.id,)
        ).fetchone()[0]
        is_def = 1 if (body.is_default or existing_cnt == 0) else 0
        if is_def:
            conn.execute(
                "UPDATE llm_providers SET is_default = 0 WHERE user_id = ?",
                (current_user.id,),
            )
        cur = conn.execute(
            "INSERT INTO llm_providers "
            "(user_id, name, protocol, base_url, api_key_enc, model_name, is_default, supports_tools, use_react_fallback, created_at, updated_at) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (
                current_user.id,
                body.name.strip(),
                body.protocol,
                body.base_url.strip().rstrip("/"),
                enc_key,
                body.model_name.strip(),
                is_def,
                1 if body.supports_tools else 0,
                1 if body.use_react_fallback else 0,
                now,
                now,
            ),
        )
        row = conn.execute("SELECT * FROM llm_providers WHERE id = ?", (cur.lastrowid,)).fetchone()
    return _format_provider(row, secret_key)


@router.patch("/{provider_id}")
def update_provider(
    provider_id: int,
    body: ProviderUpdate,
    current_user: CurrentUser = Depends(get_current_user),
    db: Database = Depends(get_db),
    settings: Settings = Depends(get_app_settings),
) -> dict:
    secret_key = settings.resolved_secret_key()
    with db.session(immediate=True) as conn:
        row = conn.execute(
            "SELECT * FROM llm_providers WHERE id = ? AND user_id = ?",
            (provider_id, current_user.id),
        ).fetchone()
        if row is None:
            raise HTTPException(status_code=404, detail="Provider not found")

        if body.is_default is True:
            conn.execute(
                "UPDATE llm_providers SET is_default = 0 WHERE user_id = ?",
                (current_user.id,),
            )

        enc_key = (
            encrypt_api_key(body.api_key.strip(), secret_key)
            if body.api_key is not None
            else row["api_key_enc"]
        )
        conn.execute(
            "UPDATE llm_providers SET name = ?, protocol = ?, base_url = ?, api_key_enc = ?, "
            "model_name = ?, is_default = ?, supports_tools = ?, use_react_fallback = ?, updated_at = ? "
            "WHERE id = ?",
            (
                body.name.strip() if body.name is not None else row["name"],
                body.protocol if body.protocol is not None else row["protocol"],
                body.base_url.strip().rstrip("/") if body.base_url is not None else row["base_url"],
                enc_key,
                body.model_name.strip() if body.model_name is not None else row["model_name"],
                (1 if body.is_default else 0) if body.is_default is not None else row["is_default"],
                (1 if body.supports_tools else 0) if body.supports_tools is not None else row["supports_tools"],
                (1 if body.use_react_fallback else 0)
                if body.use_react_fallback is not None
                else row["use_react_fallback"],
                utcnow_iso(),
                provider_id,
            ),
        )
        updated = conn.execute("SELECT * FROM llm_providers WHERE id = ?", (provider_id,)).fetchone()
    return _format_provider(updated, secret_key)


@router.delete("/{provider_id}")
def delete_provider(
    provider_id: int,
    current_user: CurrentUser = Depends(get_current_user),
    db: Database = Depends(get_db),
) -> dict:
    with db.session() as conn:
        cur = conn.execute(
            "DELETE FROM llm_providers WHERE id = ? AND user_id = ?",
            (provider_id, current_user.id),
        )
        if cur.rowcount == 0:
            raise HTTPException(status_code=404, detail="Provider not found")
    return {"deleted": True, "provider_id": provider_id}


@router.post("/fetch-models")
async def fetch_models_endpoint(
    body: ProviderProbeRequest,
    current_user: CurrentUser = Depends(get_current_user),
    db: Database = Depends(get_db),
    settings: Settings = Depends(get_app_settings),
) -> dict:
    protocol, base_url, api_key, model_name = _resolve_probe_credentials(
        body, current_user.id, db, settings.resolved_secret_key(), require_model=False
    )
    adapter = create_adapter(protocol, base_url, api_key, model_name or "default", timeout=30.0)
    try:
        models = await adapter.fetch_models()
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Failed to fetch models: {exc}")
    return {"models": models}


@router.post("/test")
async def test_provider_endpoint(
    body: ProviderProbeRequest,
    current_user: CurrentUser = Depends(get_current_user),
    db: Database = Depends(get_db),
    settings: Settings = Depends(get_app_settings),
) -> dict:
    protocol, base_url, api_key, model_name = _resolve_probe_credentials(
        body, current_user.id, db, settings.resolved_secret_key(), require_model=True
    )
    result = await test_provider_connection(protocol, base_url, api_key, model_name)
    if body.provider_id is not None and result["connectivity_ok"]:
        with db.session() as conn:
            conn.execute(
                "UPDATE llm_providers SET supports_tools = ?, updated_at = ? WHERE id = ? AND user_id = ?",
                (1 if result["supports_tools"] else 0, utcnow_iso(), body.provider_id, current_user.id),
            )
    return result
