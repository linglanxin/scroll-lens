from __future__ import annotations

from app.core.security import decrypt_api_key


def _register(client, username: str, password: str = "secret123", invite_code: str = "") -> dict:
    resp = client.post(
        "/api/v1/auth/register",
        json={"username": username, "password": password, "invite_code": invite_code},
    )
    assert resp.status_code == 201, resp.text
    return resp.json()


def _auth_header(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def test_first_user_admin_and_registration_controls(app_client) -> None:
    client, _ = app_client

    status_before = client.get("/api/v1/auth/registration-status").json()
    assert status_before["has_admin"] is False

    admin_res = _register(client, "alice")
    assert admin_res["user"]["role"] == "admin"
    admin_hdr = _auth_header(admin_res["access_token"])

    # Disable registration
    r = client.patch(
        "/api/v1/admin/settings",
        headers=admin_hdr,
        json={"allow_registration": False},
    )
    assert r.status_code == 200
    assert r.json()["allow_registration"] is False

    blocked = client.post(
        "/api/v1/auth/register",
        json={"username": "bob", "password": "secret123"},
    )
    assert blocked.status_code == 403

    # Re-enable with invite code
    client.patch(
        "/api/v1/admin/settings",
        headers=admin_hdr,
        json={"allow_registration": True, "invite_code": "MAGIC-2026"},
    )
    bad_inv = client.post(
        "/api/v1/auth/register",
        json={"username": "bob", "password": "secret123", "invite_code": "WRONG"},
    )
    assert bad_inv.status_code == 403

    bob_res = _register(client, "bob", invite_code="MAGIC-2026")
    assert bob_res["user"]["role"] == "user"
    bob_hdr = _auth_header(bob_res["access_token"])

    # Non-admin forbidden on admin routes
    assert client.get("/api/v1/admin/settings", headers=bob_hdr).status_code == 403
    assert client.get("/api/v1/admin/users", headers=bob_hdr).status_code == 403

    # Sole admin cannot deactivate self
    self_demote = client.patch(
        f"/api/v1/admin/users/{admin_res['user']['id']}",
        headers=admin_hdr,
        json={"is_active": False},
    )
    assert self_demote.status_code == 400


def test_multi_user_isolation_and_provider_encryption(app_client) -> None:
    client, app = app_client
    alice = _register(client, "alice")
    bob = _register(client, "bob")
    alice_hdr = _auth_header(alice["access_token"])
    bob_hdr = _auth_header(bob["access_token"])

    # Alice uploads a novel & a document & a provider
    novel_txt = (
        "第一卷 初入乱世\n"
        "第一章 相遇\n陈曦在城门口遇见了刘备，二人畅谈天下大势，十分投契。\n"
    ).encode("utf-8")
    book_resp = client.post(
        "/api/v1/books",
        headers=alice_hdr,
        files={"file": ("sanguo.txt", novel_txt, "text/plain")},
    )
    assert book_resp.status_code == 201
    book_id = book_resp.json()["id"]

    doc_resp = client.post(
        "/api/v1/docs",
        headers=alice_hdr,
        files={"file": ("notes.md", b"# Note\nHello secret doc", "text/markdown")},
    )
    assert doc_resp.status_code == 201
    doc_id = doc_resp.json()["id"]

    prov_resp = client.post(
        "/api/v1/providers",
        headers=alice_hdr,
        json={
            "name": "Alice DeepSeek",
            "protocol": "openai_compat",
            "base_url": "https://api.deepseek.com/v1",
            "api_key": "sk-alice-super-secret-9876",
            "model_name": "deepseek-chat",
        },
    )
    assert prov_resp.status_code == 201
    prov_json = prov_resp.json()
    assert prov_json["api_key_masked"] == "****9876"
    assert "sk-alice-super-secret-9876" not in str(prov_json)
    prov_id = prov_json["id"]

    # Verify DB stores Fernet-encrypted key, not plaintext
    with app.state.db.session() as conn:
        raw_enc = conn.execute(
            "SELECT api_key_enc FROM llm_providers WHERE id = ?", (prov_id,)
        ).fetchone()["api_key_enc"]
    assert raw_enc != "sk-alice-super-secret-9876"
    assert decrypt_api_key(raw_enc, app.state.settings.resolved_secret_key()) == "sk-alice-super-secret-9876"

    # Bob sees empty lists and gets 404 on every Alice resource
    assert client.get("/api/v1/books", headers=bob_hdr).json() == []
    assert client.get("/api/v1/docs", headers=bob_hdr).json() == []
    assert client.get("/api/v1/providers", headers=bob_hdr).json() == []

    assert client.get(f"/api/v1/books/{book_id}", headers=bob_hdr).status_code == 404
    assert client.get(f"/api/v1/books/{book_id}/volumes", headers=bob_hdr).status_code == 404
    assert client.get(f"/api/v1/books/{book_id}/chapters/1", headers=bob_hdr).status_code == 404
    assert client.delete(f"/api/v1/books/{book_id}", headers=bob_hdr).status_code == 404

    assert client.get(f"/api/v1/docs/{doc_id}", headers=bob_hdr).status_code == 404
    assert client.get(f"/api/v1/docs/{doc_id}/pages/1", headers=bob_hdr).status_code == 404
    assert client.delete(f"/api/v1/docs/{doc_id}", headers=bob_hdr).status_code == 404

    assert client.patch(f"/api/v1/providers/{prov_id}", headers=bob_hdr, json={"name": "hack"}).status_code == 404
    assert client.delete(f"/api/v1/providers/{prov_id}", headers=bob_hdr).status_code == 404
