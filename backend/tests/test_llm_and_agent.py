from __future__ import annotations

import asyncio
import json
from typing import Any, AsyncIterator

import httpx
import pytest

from app.engines.novel.volume_summarizer import VolumeSummarizerManager
from app.llm.base import BaseLLMAdapter, LLMMessage, StreamEvent, ToolCall, ToolDefinition
from app.llm.factory import create_adapter, test_provider_connection as probe_provider_connection


class _MockTransport(httpx.AsyncBaseTransport):
    """Deterministic mock transport for OpenAI-compat, Anthropic, and Gemini protocols."""

    def __init__(self, handler) -> None:
        self._handler = handler

    async def handle_async_request(self, request: httpx.Request) -> httpx.Response:
        return self._handler(request)


def _sse_bytes(events: list[tuple[str | None, str]]) -> bytes:
    lines: list[str] = []
    for ev_name, payload in events:
        if ev_name:
            lines.append(f"event: {ev_name}")
        lines.append(f"data: {payload}")
        lines.append("")
    return "\n".join(lines).encode("utf-8")


@pytest.mark.asyncio
async def test_three_protocol_adapters_and_models(monkeypatch: pytest.MonkeyPatch) -> None:
    def handler(req: httpx.Request) -> httpx.Response:
        url = str(req.url)
        if req.method == "GET" and url.endswith("/models"):
            if "generativelanguage" in url:
                return httpx.Response(200, json={"models": [{"name": "models/gemini-2.5-flash"}]})
            return httpx.Response(200, json={"data": [{"id": "deepseek-chat"}, {"id": "gpt-4o-mini"}]})

        if "chat/completions" in url:
            body = _sse_bytes(
                [
                    (None, json.dumps({"choices": [{"delta": {"content": "你好"}}]})),
                    (
                        None,
                        json.dumps(
                            {
                                "choices": [
                                    {
                                        "delta": {
                                            "tool_calls": [
                                                {"index": 0, "id": "call_1", "function": {"name": "ping_probe", "arguments": '{"val'}}
                                            ]
                                        }
                                    }
                                ]
                            }
                        ),
                    ),
                    (
                        None,
                        json.dumps(
                            {
                                "choices": [
                                    {
                                        "delta": {"tool_calls": [{"index": 0, "function": {"arguments": 'ue":"pong"}'}}]},
                                        "finish_reason": "tool_calls",
                                    }
                                ]
                            }
                        ),
                    ),
                    (None, "[DONE]"),
                ]
            )
            return httpx.Response(200, content=body, headers={"content-type": "text/event-stream"})

        if "/v1/messages" in url:
            body = _sse_bytes(
                [
                    ("content_block_delta", json.dumps({"type": "content_block_delta", "index": 0, "delta": {"type": "text_delta", "text": "Claude回答"}})),
                    ("content_block_start", json.dumps({"type": "content_block_start", "index": 1, "content_block": {"type": "tool_use", "id": "tu_1", "name": "read_chapter"}})),
                    ("content_block_delta", json.dumps({"type": "content_block_delta", "index": 1, "delta": {"type": "input_json_delta", "partial_json": '{"chapter_num": 1}'}})),
                    ("content_block_stop", json.dumps({"type": "content_block_stop", "index": 1})),
                ]
            )
            return httpx.Response(200, content=body, headers={"content-type": "text/event-stream"})

        if "streamGenerateContent" in url:
            body = _sse_bytes(
                [
                    (None, json.dumps({"candidates": [{"content": {"parts": [{"text": "Gemini回答"}, {"functionCall": {"name": "list_volumes", "args": {"max_chapter": 10}}}]}}]})),
                ]
            )
            return httpx.Response(200, content=body, headers={"content-type": "text/event-stream"})

        return httpx.Response(404)

    orig_client = httpx.AsyncClient

    def patched_client(*args, **kwargs):
        kwargs["transport"] = _MockTransport(handler)
        return orig_client(*args, **kwargs)

    monkeypatch.setattr(httpx, "AsyncClient", patched_client)

    # OpenAI compat
    oai = create_adapter("openai_compat", "https://api.deepseek.com/v1", "sk-x", "deepseek-chat")
    assert "deepseek-chat" in await oai.fetch_models()
    oai_events = [e async for e in oai.stream_chat([LLMMessage(role="user", content="hi")])]
    assert any(e.type == "text_delta" and e.text == "你好" for e in oai_events)
    assert any(e.type == "tool_call" and e.tool_call.arguments == {"value": "pong"} for e in oai_events)

    probe = await probe_provider_connection("openai_compat", "https://api.deepseek.com/v1", "sk-x", "deepseek-chat")
    assert probe["connectivity_ok"] is True
    assert probe["supports_tools"] is True
    assert probe["recommended_react_fallback"] is False

    # Anthropic
    ant = create_adapter("anthropic", "https://api.anthropic.com", "sk-ant", "claude-sonnet-4-20250514")
    ant_events = [e async for e in ant.stream_chat([LLMMessage(role="user", content="hi")])]
    assert any(e.type == "text_delta" and e.text == "Claude回答" for e in ant_events)
    assert any(e.type == "tool_call" and e.tool_call.name == "read_chapter" for e in ant_events)

    # Gemini
    gem = create_adapter("gemini", "https://generativelanguage.googleapis.com", "gm-key", "gemini-2.5-flash")
    assert await gem.fetch_models() == ["gemini-2.5-flash"]
    gem_events = [e async for e in gem.stream_chat([LLMMessage(role="user", content="hi")])]
    assert any(e.type == "text_delta" and e.text == "Gemini回答" for e in gem_events)
    assert any(e.type == "tool_call" and e.tool_call.name == "list_volumes" for e in gem_events)


class _ScriptedAdapter(BaseLLMAdapter):
    def __init__(self, turns: list[list[StreamEvent]]) -> None:
        super().__init__("http://mock", "key", "mock-model")
        self.turns = list(turns)
        self.calls = 0

    async def stream_chat(
        self,
        messages: list[LLMMessage],
        tools: list[ToolDefinition] | None = None,
        system_prompt: str = "",
        temperature: float = 0.3,
    ) -> AsyncIterator[StreamEvent]:
        idx = min(self.calls, len(self.turns) - 1)
        self.calls += 1
        for ev in self.turns[idx]:
            yield ev

    async def fetch_models(self) -> list[str]:
        return ["mock-model"]


def test_sse_chat_novel_agent_and_react_fallback(app_client, monkeypatch: pytest.MonkeyPatch) -> None:
    client, app = app_client
    reg = client.post("/api/v1/auth/register", json={"username": "alice", "password": "password123"}).json()
    hdr = {"Authorization": f"Bearer {reg['access_token']}"}

    novel = (
        "第一卷 初入乱世\n"
        "第一章 相遇\n陈曦在泰山遇见刘备，定下青州之策。\n"
        "第二章 剧透章\n隐藏大结局秘密不应该被看到。\n"
    ).encode("utf-8")
    book_id = client.post("/api/v1/books", headers=hdr, files={"file": ("b.txt", novel, "text/plain")}).json()["id"]
    # Set spoiler lock to chapter 1
    client.patch(f"/api/v1/books/{book_id}/settings", headers=hdr, json={"read_progress_ch": 1})

    prov_id = client.post(
        "/api/v1/providers",
        headers=hdr,
        json={
            "name": "Mock Relay",
            "protocol": "openai_compat",
            "base_url": "https://mock.local/v1",
            "api_key": "sk-mock",
            "model_name": "mock-model",
            "use_react_fallback": True,
        },
    ).json()["id"]

    # ReAct fallback scripted adapter: turn 1 emits <tool_call>, turn 2 answers with [ch:1] and [ch:2]
    # [ch:2] must NOT appear in citations due to spoiler lock at chapter 1!
    scripted = _ScriptedAdapter(
        [
            [
                StreamEvent(
                    type="text_delta",
                    text='<tool_call>{"name": "search_chapters", "arguments": {"keywords": ["青州"]}}</tool_call>',
                ),
                StreamEvent(type="done"),
            ],
            [
                StreamEvent(type="text_delta", text="陈曦在泰山定下青州之策 [ch:1]。关于 [ch:2] 暂不可见。"),
                StreamEvent(type="done"),
            ],
        ]
    )
    monkeypatch.setattr("app.api.chat.create_adapter", lambda **kwargs: scripted)

    with client.stream(
        "POST",
        "/api/v1/chat/stream",
        headers=hdr,
        json={"mode": "novel", "target_id": book_id, "provider_id": prov_id, "message": "青州之策在哪一章？"},
    ) as resp:
        assert resp.status_code == 200
        raw_sse = resp.read().decode("utf-8")

    assert "event: session" in raw_sse
    assert "event: tool_start" in raw_sse
    assert "event: tool_done" in raw_sse
    assert "event: delta" in raw_sse
    assert "event: citations" in raw_sse
    assert "event: done" in raw_sse
    assert '"chapter_num": 1' in raw_sse
    assert '"chapter_num": 2' not in raw_sse

    # Verify session persisted
    sessions = client.get(f"/api/v1/chat/sessions?mode=novel&target_id={book_id}", headers=hdr).json()
    assert len(sessions) == 1
    msgs = client.get(f"/api/v1/chat/sessions/{sessions[0]['id']}/messages", headers=hdr).json()
    assert len(msgs) == 2
    assert msgs[1]["citations"][0]["chapter_num"] == 1


@pytest.mark.asyncio
async def test_novel_agent_5_round_fuse(app_client) -> None:
    from app.agent.novel_agent import stream_novel_agent
    from app.engines.novel.parser import parse_txt_novel
    from app.engines.novel.indexer import ingest_book

    client, app = app_client
    uid = client.post("/api/v1/auth/register", json={"username": "alice", "password": "password123"}).json()["user"]["id"]
    book_id = ingest_book(app.state.db, uid, parse_txt_novel("第一章 开端\n正文内容。".encode("utf-8"), "书"))

    # Model endlessly requests tools on every turn -> must stop at 5 rounds + final synthesis
    loop_turns = [
        [StreamEvent(type="tool_call", tool_call=ToolCall(id=f"c{i}", name="list_volumes", arguments={})), StreamEvent(type="done")]
        for i in range(5)
    ] + [[StreamEvent(type="text_delta", text="熔断后总结回答 [ch:1]"), StreamEvent(type="done")]]

    adapter = _ScriptedAdapter(loop_turns)
    with app.state.db.session() as conn:
        book_row = conn.execute("SELECT * FROM books WHERE id = ?", (book_id,)).fetchone()
        events = [ev async for ev in stream_novel_agent(conn, adapter, book_row, [], "测试熔断", max_chapter=1)]

    tool_starts = [e for e in events if e["event"] == "tool_start"]
    assert len(tool_starts) == 5
    complete = [e for e in events if e["event"] == "_complete"][0]
    assert "熔断后总结回答" in complete["answer"]


@pytest.mark.asyncio
async def test_volume_summarizer_chunked_pause_and_resume(app_client, monkeypatch: pytest.MonkeyPatch) -> None:
    client, app = app_client
    reg = client.post("/api/v1/auth/register", json={"username": "alice", "password": "password123"}).json()
    hdr = {"Authorization": f"Bearer {reg['access_token']}"}
    uid = reg["user"]["id"]

    # Create a >150,000-char volume (~30 chapters * 5,500 chars = 165,000 chars)
    parts = ["第一卷 巨卷\n"]
    for i in range(1, 31):
        parts.append(f"第{i}章 测试章节{i}\n" + ("大军出征泰山青州战局胶着。" * 390) + "\n")
    novel_bytes = "".join(parts).encode("utf-8")

    book_id = client.post("/api/v1/books", headers=hdr, files={"file": ("big.txt", novel_bytes, "text/plain")}).json()["id"]
    client.post(
        "/api/v1/providers",
        headers=hdr,
        json={
            "name": "DeepSeek",
            "protocol": "openai_compat",
            "base_url": "https://api.deepseek.com/v1",
            "api_key": "sk-test",
            "model_name": "deepseek-chat",
        },
    )

    class _SumAdapter(BaseLLMAdapter):
        def __init__(self) -> None:
            super().__init__("http://mock", "k", "m")

        async def stream_chat(self, messages, tools=None, system_prompt="", temperature=0.3):
            await asyncio.sleep(0.01)
            yield StreamEvent(type="text_delta", text="这是卷纲阶段总结内容。")
            yield StreamEvent(type="done")

        async def fetch_models(self):
            return ["m"]

    monkeypatch.setattr("app.engines.novel.volume_summarizer.create_adapter", lambda **kw: _SumAdapter())

    vols = client.get(f"/api/v1/books/{book_id}/volumes", headers=hdr).json()
    vol_id = vols[0]["id"]

    mgr: VolumeSummarizerManager = app.state.summarizer
    mgr.start_volumes(app.state.db, app.state.settings, uid, book_id, [vol_id])

    # Wait for completion
    for _ in range(50):
        await asyncio.sleep(0.05)
        if not mgr.is_running(book_id):
            break

    vols_after = client.get(f"/api/v1/books/{book_id}/volumes", headers=hdr).json()
    assert vols_after[0]["summary_status"] == "ready"
    assert "卷纲阶段总结" in vols_after[0]["summary_md"]


def test_health_openapi_and_document_sse_chat(app_client, monkeypatch: pytest.MonkeyPatch) -> None:
    client, _ = app_client

    h = client.get("/api/v1/health")
    assert h.status_code == 200
    assert h.json()["status"] == "ok"

    spec = client.get("/openapi.json")
    assert spec.status_code == 200
    assert "/api/v1/chat/stream" in spec.json()["paths"]

    reg = client.post("/api/v1/auth/register", json={"username": "alice", "password": "password123"}).json()
    hdr = {"Authorization": f"Bearer {reg['access_token']}"}

    doc_id = client.post(
        "/api/v1/docs",
        headers=hdr,
        files={"file": ("brief.md", b"# Summary\nScrollLens uses under 180 MiB RAM.", "text/markdown")},
    ).json()["id"]
    prov_id = client.post(
        "/api/v1/providers",
        headers=hdr,
        json={
            "name": "Doc Mock",
            "protocol": "openai_compat",
            "base_url": "https://mock.local/v1",
            "api_key": "sk-mock",
            "model_name": "mock-model",
        },
    ).json()["id"]

    scripted = _ScriptedAdapter(
        [[StreamEvent(type="text_delta", text="文档指出内存预算低于 180 MiB [p:1]。"), StreamEvent(type="done")]]
    )
    monkeypatch.setattr("app.api.chat.create_adapter", lambda **kwargs: scripted)

    with client.stream(
        "POST",
        "/api/v1/chat/stream",
        headers=hdr,
        json={"mode": "document", "target_id": doc_id, "provider_id": prov_id, "message": "内存预算多少？"},
    ) as resp:
        assert resp.status_code == 200
        raw_sse = resp.read().decode("utf-8")

    assert "event: delta" in raw_sse
    assert "event: citations" in raw_sse
    assert '"page_num": 1' in raw_sse
    assert "event: done" in raw_sse

    sessions = client.get(f"/api/v1/chat/sessions?mode=document&target_id={doc_id}", headers=hdr).json()
    assert len(sessions) == 1
    msgs = client.get(f"/api/v1/chat/sessions/{sessions[0]['id']}/messages", headers=hdr).json()
    assert len(msgs) == 2
    assert msgs[1]["citations"][0]["page_num"] == 1
