from __future__ import annotations

import json

from app.llm.base import BaseLLMAdapter, StreamEvent, ToolCall


def _register_alice(client) -> dict[str, str]:
    r = client.post(
        "/api/v1/auth/register",
        json={"username": "alice", "password": "password123"},
    )
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


def _upload_sample_novel(client, hdr) -> int:
    novel_text = (
        "第一卷 萌芽时代\n"
        "第一章 觉醒\n"
        "韩萧在萌芽组织的实验基地醒来，作为零号实验体意外获得了机械师面板。\n\n"
        "第二章 突围\n"
        "主角韩萧在逃离基地途中结识了海拉，萌芽组织派出追兵拦截。\n\n"
        "第二卷 星海起航\n"
        "第三章 西都风云\n"
        "韩萧以黑星为代号在海蓝星崭露头角，接受十三局委托。\n\n"
        "第四章 黑星军团\n"
        "黑星阁下正式组建黑星军团，与帝国势力展开深入合作。\n"
    ).encode("utf-8")
    resp = client.post(
        "/api/v1/books",
        headers=hdr,
        files={"file": ("sample_mech.txt", novel_text, "text/plain")},
    )
    assert resp.status_code == 201, resp.text
    return resp.json()["id"]


def test_novel_cards_lifecycle_spoiler_lock_and_alias_sync(app_client, monkeypatch) -> None:
    client, app = app_client
    hdr = _register_alice(client)
    book_id = _upload_sample_novel(client, hdr)

    prov_resp = client.post(
        "/api/v1/providers",
        headers=hdr,
        json={
            "name": "MockProvider",
            "protocol": "openai_compat",
            "base_url": "https://mock.local/v1",
            "api_key": "sk-test",
            "model_name": "mock-chat",
            "is_default": True,
        },
    )
    assert prov_resp.status_code == 201

    # Lower read progress to chapter 2
    prog_resp = client.patch(
        f"/api/v1/books/{book_id}/settings",
        headers=hdr,
        json={"read_progress_ch": 2},
    )
    assert prog_resp.status_code == 200

    class FakeCardAdapter(BaseLLMAdapter):
        calls = 0

        async def stream_chat(self, messages, tools=None, system_prompt="", temperature=0.3):
            FakeCardAdapter.calls += 1
            if tools and len(messages) == 1:
                yield StreamEvent(
                    type="tool_call",
                    tool_call=ToolCall(
                        id="c1",
                        name="get_keyword_timeline",
                        arguments={"keyword": "韩萧"},
                    ),
                )
                yield StreamEvent(type="done", finish_reason="tool_calls")
                return

            # On incremental update (max_chapter == 4), return updated stage
            if "第 4 章" in system_prompt:
                payload = {
                    "card_type": "character",
                    "real_name": "韩萧",
                    "role_badge": "主角",
                    "aliases": ["零号实验体", "黑星"],
                    "titles": ["黑星阁下"],
                    "status_summary": "黑星军团缔造者，已步入星际舞台",
                    "summary": "从实验基地逃出的机械师，逐步建立黑星军团。",
                    "attributes": [
                        {"label": "主职业", "value": "机械师"},
                        {"label": "所属势力", "value": "黑星军团"},
                    ],
                    "timeline": [
                        {
                            "stage": "实验基地逃亡",
                            "chapter_range": "第1-2章",
                            "anchor_chapter": 1,
                            "event": "在萌芽基地觉醒面板并携海拉突围。",
                        },
                        {
                            "stage": "组建军团",
                            "chapter_range": "第3-4章",
                            "anchor_chapter": 4,
                            "event": "以黑星之名建立黑星军团。",
                        },
                    ],
                    "relations": [
                        {"target": "海拉", "relation": "早期同行战友", "anchor_chapter": 2},
                        {"target": "十三局", "relation": "合作势力", "anchor_chapter": 3},
                    ],
                    "source_chapters": [1, 2, 4],
                }
            else:
                payload = {
                    "card_type": "character",
                    "real_name": "韩萧",
                    "role_badge": "主角",
                    "aliases": ["零号实验体"],
                    "titles": [],
                    "status_summary": "刚逃出萌芽组织基地的流浪机械师",
                    "summary": "穿越后在萌芽基地觉醒的机械师。",
                    "attributes": [{"label": "主职业", "value": "机械师"}],
                    "timeline": [
                        {
                            "stage": "实验基地逃亡",
                            "chapter_range": "第1-2章",
                            "anchor_chapter": 1,
                            "event": "在萌芽基地觉醒面板并突围。",
                        }
                    ],
                    "relations": [
                        {"target": "海拉", "relation": "早期同行战友", "anchor_chapter": 2}
                    ],
                    "source_chapters": [1, 2],
                }
            yield StreamEvent(type="text_delta", text=json.dumps(payload, ensure_ascii=False))
            yield StreamEvent(type="done", finish_reason="stop")

        async def fetch_models(self):
            return ["mock-chat"]

    monkeypatch.setattr(
        "app.api.books.create_adapter",
        lambda **kwargs: FakeCardAdapter("https://mock.local/v1", "sk", "mock-chat"),
    )

    # 1. Generate initial card at ch 2
    gen_resp = client.post(
        f"/api/v1/books/{book_id}/cards/generate",
        headers=hdr,
        json={"query_name": "主角"},
    )
    assert gen_resp.status_code == 201, gen_resp.text
    card = gen_resp.json()
    card_id = card["id"]
    assert card["real_name"] == "韩萧"
    assert card["as_of_chapter"] == 2
    assert card["activity"]["first_chapter"] == 1
    assert len(card["timeline"]) == 1

    # 2. Advance progress to ch 4 & incrementally update card
    client.patch(
        f"/api/v1/books/{book_id}/settings",
        headers=hdr,
        json={"read_progress_ch": 4},
    )
    upd_resp = client.post(
        f"/api/v1/books/{book_id}/cards/generate",
        headers=hdr,
        json={"query_name": "韩萧", "card_id": card_id},
    )
    assert upd_resp.status_code == 201, upd_resp.text
    upd_card = upd_resp.json()
    assert upd_card["as_of_chapter"] == 4
    assert len(upd_card["timeline"]) == 2
    assert "黑星" in upd_card["aliases"]

    # 3. Roll back progress lock to ch 2 -> future timeline (ch 4) & relation (ch 3) must hide!
    client.patch(
        f"/api/v1/books/{book_id}/settings",
        headers=hdr,
        json={"read_progress_ch": 2},
    )
    locked_view = client.get(f"/api/v1/books/{book_id}/cards/{card_id}", headers=hdr).json()
    assert locked_view["spoiler_hidden_count"] == 1
    assert [t["anchor_chapter"] for t in locked_view["timeline"]] == [1]
    assert [r["target"] for r in locked_view["relations"]] == ["海拉"]

    # Restore progress to 4 for alias sync & discover checks
    client.patch(
        f"/api/v1/books/{book_id}/settings",
        headers=hdr,
        json={"read_progress_ch": 4},
    )

    # 4. Sync aliases from card -> FTS5 should now match "黑星" -> 韩萧 across chapters
    sync_resp = client.post(
        f"/api/v1/books/{book_id}/cards/{card_id}/sync-aliases", headers=hdr
    )
    assert sync_resp.status_code == 200
    assert "黑星" in sync_resp.json()["aliases"]
    aliases_list = client.get(f"/api/v1/books/{book_id}/aliases", headers=hdr).json()
    assert any(a["canonical_name"] == "韩萧" and "黑星" in a["aliases"] for a in aliases_list)

    # 5. Manual edit & discover & delete
    put_resp = client.put(
        f"/api/v1/books/{book_id}/cards/{card_id}",
        headers=hdr,
        json={"status_summary": "手动修订：海蓝星最强机械师"},
    )
    assert put_resp.status_code == 200
    assert put_resp.json()["status_summary"] == "手动修订：海蓝星最强机械师"

    class FakeDiscoverAdapter(BaseLLMAdapter):
        async def stream_chat(self, messages, tools=None, system_prompt="", temperature=0.3):
            yield StreamEvent(
                type="text_delta",
                text=json.dumps(
                    {
                        "candidates": [
                            {
                                "name": "韩萧",
                                "card_type": "character",
                                "role_badge": "主角",
                                "reason": "核心主角",
                            },
                            {
                                "name": "萌芽组织",
                                "card_type": "faction",
                                "role_badge": "反派势力",
                                "reason": "早期主要敌对组织",
                            },
                        ]
                    },
                    ensure_ascii=False,
                ),
            )
            yield StreamEvent(type="done", finish_reason="stop")

        async def fetch_models(self):
            return ["mock-chat"]

    monkeypatch.setattr(
        "app.api.books.create_adapter",
        lambda **kwargs: FakeDiscoverAdapter("https://mock.local/v1", "sk", "mock-chat"),
    )
    disc_resp = client.post(
        f"/api/v1/books/{book_id}/cards/discover", headers=hdr, json={}
    )
    assert disc_resp.status_code == 200
    cands = disc_resp.json()["candidates"]
    assert cands[0]["existing_card_id"] == card_id
    assert cands[1]["existing_card_id"] is None

    del_resp = client.delete(f"/api/v1/books/{book_id}/cards/{card_id}", headers=hdr)
    assert del_resp.status_code == 200


def test_scenario_chat_resets_tool_preamble_and_emits_matched_cards(app_client, monkeypatch) -> None:
    client, app = app_client
    hdr = _register_alice(client)
    book_id = _upload_sample_novel(client, hdr)

    client.post(
        "/api/v1/providers",
        headers=hdr,
        json={
            "name": "MockProvider",
            "protocol": "openai_compat",
            "base_url": "https://mock.local/v1",
            "api_key": "sk-test",
            "model_name": "mock-chat",
            "is_default": True,
        },
    )

    # Seed a saved card directly to test chat card matching + SSE cards event
    with app.state.db.session() as conn:
        conn.execute(
            "INSERT INTO novel_cards (book_id, card_type, real_name, role_badge, aliases_json, titles_json, status_summary, summary, attributes_json, timeline_json, relations_json, source_chapters_json, as_of_chapter, created_at, updated_at) "
            "VALUES (?, 'character', '韩萧', '主角', '[\"黑星\"]', '[]', '海蓝星机械师', '主角小传', '[]', '[]', '[]', '[1,3]', 4, '2026-01-01', '2026-01-01')",
            (book_id,),
        )

    class FakeChatAdapter(BaseLLMAdapter):
        async def stream_chat(self, messages, tools=None, system_prompt="", temperature=0.3):
            if tools and len(messages) == 1:
                assert "严谨考据" in system_prompt
                assert "韩萧" in system_prompt
                yield StreamEvent(type="text_delta", text="好的，我先帮您检索一下……")
                yield StreamEvent(
                    type="tool_call",
                    tool_call=ToolCall(
                        id="tc_1",
                        name="search_chapters",
                        arguments={"keywords": ["韩萧"]},
                    ),
                )
                yield StreamEvent(type="done", finish_reason="tool_calls")
                return

            yield StreamEvent(
                type="text_delta",
                text="韩萧在萌芽基地觉醒了机械师面板 [ch:1]，后以黑星为代号活跃于西都 [ch:3]。",
            )
            yield StreamEvent(type="done", finish_reason="stop")

        async def fetch_models(self):
            return ["mock-chat"]

    monkeypatch.setattr(
        "app.api.chat.create_adapter",
        lambda **kwargs: FakeChatAdapter("https://mock.local/v1", "sk", "mock-chat"),
    )

    resp = client.post(
        "/api/v1/chat/stream",
        headers=hdr,
        json={
            "mode": "novel",
            "target_id": book_id,
            "message": "黑星是谁？",
            "scenario": "verify",
        },
    )
    assert resp.status_code == 200, resp.text
    raw_sse = resp.text
    assert "event: cards" in raw_sse
    assert "event: reset_draft" in raw_sse
    assert '"focus_keyword": "韩萧"' in raw_sse

    sessions = client.get(f"/api/v1/chat/sessions?mode=novel&target_id={book_id}", headers=hdr).json()
    msgs = client.get(f"/api/v1/chat/sessions/{sessions[0]['id']}/messages", headers=hdr).json()
    assistant_msg = [m for m in msgs if m["role"] == "assistant"][-1]
    assert "我先帮您检索" not in assistant_msg["content"]
    assert "韩萧在萌芽基地觉醒了机械师面板 [ch:1]" in assistant_msg["content"]
    assert assistant_msg["citations"][0]["focus_keyword"] == "韩萧"
