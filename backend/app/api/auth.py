from __future__ import annotations

import sqlite3
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field

from app.config import Settings
from app.core.deps import CurrentUser, get_app_settings, get_current_user, get_db
from app.core.security import create_access_token, hash_password, verify_password
from app.db.database import Database, get_system_settings_dict, utcnow_iso

router = APIRouter(prefix="/api/v1/auth", tags=["auth"])


class RegisterRequest(BaseModel):
    username: str = Field(..., min_length=2, max_length=64)
    password: str = Field(..., min_length=6, max_length=128)
    invite_code: str = ""


class LoginRequest(BaseModel):
    username: str = Field(..., min_length=1, max_length=64)
    password: str = Field(..., min_length=1, max_length=128)


class UserOut(BaseModel):
    id: int
    username: str
    role: str
    is_active: bool
    created_at: str


class AuthResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserOut


class RegistrationStatusOut(BaseModel):
    allow_registration: bool
    invite_code_required: bool
    has_admin: bool


@router.get("/registration-status", response_model=RegistrationStatusOut)
def registration_status(db: Database = Depends(get_db)) -> RegistrationStatusOut:
    with db.session() as conn:
        sys_cfg = get_system_settings_dict(conn)
        user_count = conn.execute("SELECT COUNT(*) FROM users").fetchone()[0]
    return RegistrationStatusOut(
        allow_registration=bool(sys_cfg["allow_registration"]),
        invite_code_required=bool(sys_cfg["invite_code"]),
        has_admin=user_count > 0,
    )


@router.post("/register", response_model=AuthResponse, status_code=status.HTTP_201_CREATED)
def register(
    body: RegisterRequest,
    db: Database = Depends(get_db),
    settings: Settings = Depends(get_app_settings),
) -> AuthResponse:
    username = body.username.strip()
    if not username:
        raise HTTPException(status_code=400, detail="Username cannot be blank")

    now = utcnow_iso()
    pw_hash = hash_password(body.password)

    with db.session(immediate=True) as conn:
        user_count = conn.execute("SELECT COUNT(*) FROM users").fetchone()[0]
        is_first_user = user_count == 0
        if not is_first_user:
            sys_cfg = get_system_settings_dict(conn)
            if not sys_cfg["allow_registration"]:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="Registration is currently disabled by administrator",
                )
            expected_invite = str(sys_cfg["invite_code"])
            if expected_invite and body.invite_code != expected_invite:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="Invalid invite code",
                )

        role = "admin" if is_first_user else "user"
        try:
            cur = conn.execute(
                "INSERT INTO users (username, password_hash, role, is_active, created_at) "
                "VALUES (?, ?, ?, 1, ?)",
                (username, pw_hash, role, now),
            )
        except sqlite3.IntegrityError:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Username already exists",
            )
        user_id = int(cur.lastrowid)

    token = create_access_token(
        user_id=user_id,
        username=username,
        role=role,
        secret_key=settings.resolved_secret_key(),
        expire_hours=settings.jwt_expire_hours,
    )
    return AuthResponse(
        access_token=token,
        user=UserOut(
            id=user_id,
            username=username,
            role=role,
            is_active=True,
            created_at=now,
        ),
    )


@router.post("/login", response_model=AuthResponse)
def login(
    body: LoginRequest,
    db: Database = Depends(get_db),
    settings: Settings = Depends(get_app_settings),
) -> AuthResponse:
    username = body.username.strip()
    with db.session() as conn:
        row = conn.execute(
            "SELECT id, username, password_hash, role, is_active, created_at "
            "FROM users WHERE username = ?",
            (username,),
        ).fetchone()
    if row is None or not verify_password(body.password, row["password_hash"]):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect username or password",
        )
    if not row["is_active"]:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Account is deactivated",
        )

    token = create_access_token(
        user_id=row["id"],
        username=row["username"],
        role=row["role"],
        secret_key=settings.resolved_secret_key(),
        expire_hours=settings.jwt_expire_hours,
    )
    return AuthResponse(
        access_token=token,
        user=UserOut(
            id=row["id"],
            username=row["username"],
            role=row["role"],
            is_active=bool(row["is_active"]),
            created_at=row["created_at"],
        ),
    )


@router.get("/me", response_model=UserOut)
def get_me(
    current_user: CurrentUser = Depends(get_current_user),
    db: Database = Depends(get_db),
) -> UserOut:
    with db.session() as conn:
        row = conn.execute(
            "SELECT id, username, role, is_active, created_at FROM users WHERE id = ?",
            (current_user.id,),
        ).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="User not found")
    return UserOut(
        id=row["id"],
        username=row["username"],
        role=row["role"],
        is_active=bool(row["is_active"]),
        created_at=row["created_at"],
    )
