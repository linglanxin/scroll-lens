from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from app.api.auth import UserOut
from app.core.deps import CurrentUser, get_db, require_admin
from app.db.database import Database, get_system_settings_dict

router = APIRouter(prefix="/api/v1/admin", tags=["admin"])


class AdminSettingsOut(BaseModel):
    allow_registration: bool
    invite_code: str
    max_upload_mb: int


class AdminSettingsUpdate(BaseModel):
    allow_registration: Optional[bool] = None
    invite_code: Optional[str] = Field(default=None, max_length=128)
    max_upload_mb: Optional[int] = Field(default=None, ge=1, le=1024)


class AdminUserUpdate(BaseModel):
    is_active: Optional[bool] = None
    role: Optional[str] = Field(default=None, pattern="^(admin|user)$")


@router.get("/settings", response_model=AdminSettingsOut)
def get_settings_endpoint(
    _: CurrentUser = Depends(require_admin),
    db: Database = Depends(get_db),
) -> AdminSettingsOut:
    with db.session() as conn:
        cfg = get_system_settings_dict(conn)
    return AdminSettingsOut(**cfg)


@router.patch("/settings", response_model=AdminSettingsOut)
def update_settings_endpoint(
    body: AdminSettingsUpdate,
    _: CurrentUser = Depends(require_admin),
    db: Database = Depends(get_db),
) -> AdminSettingsOut:
    with db.session() as conn:
        if body.allow_registration is not None:
            conn.execute(
                "INSERT INTO system_settings (key, value) VALUES ('allow_registration', ?) "
                "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                ("true" if body.allow_registration else "false",),
            )
        if body.invite_code is not None:
            conn.execute(
                "INSERT INTO system_settings (key, value) VALUES ('invite_code', ?) "
                "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                (body.invite_code.strip(),),
            )
        if body.max_upload_mb is not None:
            conn.execute(
                "INSERT INTO system_settings (key, value) VALUES ('max_upload_mb', ?) "
                "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                (str(body.max_upload_mb),),
            )
        cfg = get_system_settings_dict(conn)
    return AdminSettingsOut(**cfg)


@router.get("/users", response_model=list[UserOut])
def list_users(
    _: CurrentUser = Depends(require_admin),
    db: Database = Depends(get_db),
) -> list[UserOut]:
    with db.session() as conn:
        rows = conn.execute(
            "SELECT id, username, role, is_active, created_at FROM users ORDER BY id ASC"
        ).fetchall()
    return [
        UserOut(
            id=r["id"],
            username=r["username"],
            role=r["role"],
            is_active=bool(r["is_active"]),
            created_at=r["created_at"],
        )
        for r in rows
    ]


@router.patch("/users/{user_id}", response_model=UserOut)
def update_user(
    user_id: int,
    body: AdminUserUpdate,
    admin: CurrentUser = Depends(require_admin),
    db: Database = Depends(get_db),
) -> UserOut:
    with db.session(immediate=True) as conn:
        target = conn.execute(
            "SELECT id, username, role, is_active, created_at FROM users WHERE id = ?",
            (user_id,),
        ).fetchone()
        if target is None:
            raise HTTPException(status_code=404, detail="User not found")

        new_role = body.role if body.role is not None else target["role"]
        new_active = (1 if body.is_active else 0) if body.is_active is not None else target["is_active"]

        if target["role"] == "admin" and target["is_active"] == 1 and (new_role != "admin" or new_active == 0):
            active_admins = conn.execute(
                "SELECT COUNT(*) FROM users WHERE role = 'admin' AND is_active = 1"
            ).fetchone()[0]
            if active_admins <= 1:
                raise HTTPException(
                    status_code=400,
                    detail="Cannot deactivate or demote the sole active administrator",
                )

        conn.execute(
            "UPDATE users SET role = ?, is_active = ? WHERE id = ?",
            (new_role, new_active, user_id),
        )
        updated = conn.execute(
            "SELECT id, username, role, is_active, created_at FROM users WHERE id = ?",
            (user_id,),
        ).fetchone()
    return UserOut(
        id=updated["id"],
        username=updated["username"],
        role=updated["role"],
        is_active=bool(updated["is_active"]),
        created_at=updated["created_at"],
    )
