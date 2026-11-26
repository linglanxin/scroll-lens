from __future__ import annotations

import base64
import hashlib
from datetime import datetime, timedelta, timezone

import jwt
from argon2 import PasswordHasher
from argon2.exceptions import VerifyMismatchError
from cryptography.fernet import Fernet, InvalidToken

_ph = PasswordHasher()


def hash_password(password: str) -> str:
    return _ph.hash(password)


def verify_password(password: str, password_hash: str) -> bool:
    try:
        return _ph.verify(password_hash, password)
    except (VerifyMismatchError, Exception):
        return False


def _fernet_from_secret(secret_key: str) -> Fernet:
    digest = hashlib.sha256(secret_key.encode("utf-8")).digest()
    return Fernet(base64.urlsafe_b64encode(digest))


def encrypt_api_key(plain_key: str, secret_key: str) -> str:
    if not plain_key:
        return ""
    return _fernet_from_secret(secret_key).encrypt(plain_key.encode("utf-8")).decode("ascii")


def decrypt_api_key(cipher_text: str, secret_key: str) -> str:
    if not cipher_text:
        return ""
    try:
        return _fernet_from_secret(secret_key).decrypt(cipher_text.encode("ascii")).decode("utf-8")
    except InvalidToken as exc:
        raise ValueError("Failed to decrypt stored API key") from exc


def mask_api_key(plain_key: str) -> str:
    if not plain_key:
        return ""
    if len(plain_key) <= 4:
        return "*" * len(plain_key)
    return "****" + plain_key[-4:]


def create_access_token(
    user_id: int,
    username: str,
    role: str,
    secret_key: str,
    expire_hours: int = 168,
) -> str:
    now = datetime.now(timezone.utc)
    payload = {
        "sub": str(user_id),
        "username": username,
        "role": role,
        "iat": int(now.timestamp()),
        "exp": int((now + timedelta(hours=expire_hours)).timestamp()),
    }
    return jwt.encode(payload, secret_key, algorithm="HS256")


def decode_access_token(token: str, secret_key: str) -> dict:
    return jwt.decode(token, secret_key, algorithms=["HS256"])
