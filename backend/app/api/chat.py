from __future__ import annotations

import json
import re
import sqlite3
from typing import Any, AsyncIterator, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from app.agent.doc_agent import stream_document_agent
from app.agent.novel_agent import stream_novel_agent
from app.config import Settings
from app.core.deps import CurrentUser, get_app_settings, get_current_user, get_db
from app.core.security import decrypt_api_key
from app.db.database import Database, utcnow_iso
from app.llm.base import LLMMessage
from app.llm.factory import create_adapter

router = APIRouter(prefix="/api/v1/chat", tags=["chat"])


class ChatStreamRequest(BaseModel):
    mode: str = Field(..., pattern="^(novel|document)$")
    target_id: int = Field(..., ge=1)
    message: str = Field(..., min_length=1, max_length=12000)
    session_id: Optional[int] = None
    provider_id: Optional[int] = None
    max_chapter: Optional[int] = Field(default=None, ge=1)
    scenario: Optional[str] = Field(default="verify", pattern="^(verify|recap|discuss)$")


class SessionUpdateRequest(BaseModel):
    title: str = Field(..., min_length=1, max_length=120)


class SessionSummarizeRequest(BaseModel):
    provider_id: Optional[int] = None


def _clean_one_line(text: str, max_len: int) -> str:
    cleaned = re.sub(r"\s+", " ", (text or "")).strip()
    if len(cleaned) <= max_len:
        return cleaned
    return cleaned[: max(1, max_len - 1)].rstrip() + "…"


def _build_local_summary(questions: list[dict[str, Any]], title: str) -> str:
    count = len(questions)
    if count == 0:
        return _clean_one_line(title, 60)
    if count == 1:
        return _clean_one_line(questions[0]["question"], 70)
    if count == 2:
        q1 = _clean_one_line(questions[0]["question"], 26)
        q2 = _clean_one_line(questions[1]["question"], 26)
        return f"围绕「{q1}」与「{q2}」等 2 个问题展开"
    first_q = _clean_one_line(questions[0]["question"], 22)
    last_q = _clean_one_line(questions[-1]["question"], 22)
    return f"共 {count} 轮问答：从「{first_q}」到「{last_q}」"


def _enrich_sessions(
    conn: sqlite3.Connection,
    session_rows: list[sqlite3.Row],
) -> list[dict[str, Any]]:
    if not session_rows:
        return []

    session_ids = [int(r["id"]) for r in session_rows]
    placeholders = ",".join("?" for _ in session_ids)
    msg_rows = conn.execute(
        f"SELECT id, session_id, role, content, citations_json, created_at "
        f"FROM chat_messages WHERE session_id IN ({placeholders}) ORDER BY session_id ASC, id ASC",
        session_ids,
    ).fetchall()

    grouped: dict[int, list[sqlite3.Row]] = {sid: [] for sid in session_ids}
    for mr in msg_rows:
        grouped.setdefault(int(mr["session_id"]), []).append(mr)

    enriched: list[dict[str, Any]] = []
    for row in session_rows:
        sid = int(row["id"])
        msgs = grouped.get(sid, [])
        questions: list[dict[str, Any]] = []
        total_citations = 0
        pending_q: dict[str, Any] | None = None

        for m in msgs:
            role = m["role"]
            if role == "user":
                pending_q = {
                    "message_id": int(m["id"]),
                    "index": len(questions) + 1,
                    "question": _clean_one_line(m["content"], 160),
                    "answer_preview": "",
                    "citations_count": 0,
                    "created_at": m["created_at"],
                }
                questions.append(pending_q)
            elif role == "assistant":
                try:
                    cits = json.loads(m["citations_json"] or "[]")
                except json.JSONDecodeError:
                    cits = []
                cit_len = len(cits) if isinstance(cits, list) else 0
                total_citations += cit_len
                if pending_q is not None and not pending_q["answer_preview"]:
                    pending_q["answer_preview"] = _clean_one_line(m["content"], 120)
                    pending_q["citations_count"] = cit_len
                    pending_q = None

        item = dict(row)
        stored_summary = str(item.get("summary") or "").strip()
        stored_source = str(item.get("summary_source") or "none")

        if stored_source == "ai" and stored_summary:
            eff_summary = stored_summary
            eff_source = "ai"
        elif questions:
            eff_summary = _build_local_summary(questions, str(item.get("title") or ""))
            eff_source = "local"
        else:
            eff_summary = _clean_one_line(str(item.get("title") or ""), 60)
            eff_source = "none"

        item["summary"] = eff_summary
        item["summary_source"] = eff_source
        item["question_count"] = len(questions)
        item["message_count"] = len(msgs)
        item["total_citations"] = total_citations
        item["last_question"] = questions[-1]["question"] if questions else ""
        item["questions"] = questions
        enriched.append(item)

    return enriched


def _format_sse(event: str, data: dict[str, Any]) -> str:
    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"


def _require_owned_session(conn: sqlite3.Connection, session_id: int, user_id: int) -> sqlite3.Row:
    row = conn.execute(
        "SELECT * FROM chat_sessions WHERE id = ? AND user_id = ?",
        (session_id, user_id),
    ).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="Chat session not found")
    return row


@router.get("/sessions")
def list_sessions(
    mode: Optional[str] = Query(default=None, pattern="^(novel|document)$"),
    target_id: Optional[int] = Query(default=None, ge=1),
    current_user: CurrentUser = Depends(get_current_user),
    db: Database = Depends(get_db),
) -> list[dict]:
    clauses = ["user_id = ?"]
    params: list[object] = [current_user.id]
    if mode is not None:
        clauses.append("mode = ?")
        params.append(mode)
    if target_id is not None:
        clauses.append("target_id = ?")
        params.append(target_id)
    where = " AND ".join(clauses)
    with db.session() as conn:
        rows = conn.execute(
            f"SELECT * FROM chat_sessions WHERE {where} ORDER BY updated_at DESC, id DESC",
            params,
        ).fetchall()
        return _enrich_sessions(conn, rows)


@router.patch("/sessions/{session_id}")
def rename_session(
    session_id: int,
    body: SessionUpdateRequest,
    current_user: CurrentUser = Depends(get_current_user),
    db: Database = Depends(get_db),
) -> dict:
    with db.session() as conn:
        _require_owned_session(conn, session_id, current_user.id)
        conn.execute(
            "UPDATE chat_sessions SET title = ?, updated_at = ? WHERE id = ?",
            (body.title.strip(), utcnow_iso(), session_id),
        )
        row = _require_owned_session(conn, session_id, current_user.id)
        return _enrich_sessions(conn, [row])[0]


@router.post("/sessions/{session_id}/summarize")
async def summarize_session(
    session_id: int,
    body: SessionSummarizeRequest = SessionSummarizeRequest(),
    current_user: CurrentUser = Depends(get_current_user),
    db: Database = Depends(get_db),
    settings: Settings = Depends(get_app_settings),
) -> dict:
    secret_key = settings.resolved_secret_key()

    with db.session() as conn:
        sess = _require_owned_session(conn, session_id, current_user.id)
        if body.provider_id is not None:
            prov = conn.execute(
                "SELECT * FROM llm_providers WHERE id = ? AND user_id = ?",
                (body.provider_id, current_user.id),
            ).fetchone()
        else:
            prov = conn.execute(
                "SELECT * FROM llm_providers WHERE user_id = ? ORDER BY is_default DESC, id ASC LIMIT 1",
                (current_user.id,),
            ).fetchone()
        if prov is None:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Please configure an LLM provider API key first",
            )
        prov_dict = dict(prov)

        msg_rows = conn.execute(
            "SELECT role, content FROM chat_messages WHERE session_id = ? ORDER BY id ASC",
            (session_id,),
        ).fetchall()
        dialog_rows = [r for r in msg_rows if r["role"] in ("user", "assistant")]
        if not any(r["role"] == "user" for r in dialog_rows):
            return _enrich_sessions(conn, [sess])[0]

        if sess["mode"] == "novel":
            target_row = conn.execute("SELECT title FROM books WHERE id = ?", (sess["target_id"],)).fetchone()
            target_label = f"小说《{target_row['title']}》" if target_row else "当前小说"
        else:
            target_row = conn.execute("SELECT filename FROM documents WHERE id = ?", (sess["target_id"],)).fetchone()
            target_label = f"文档「{target_row['filename']}」" if target_row else "当前文档"

    recent = dialog_rows[-16:]
    transcript_lines: list[str] = []
    q_idx = 0
    for r in recent:
        if r["role"] == "user":
            q_idx += 1
            transcript_lines.append(f"Q{q_idx}: {_clean_one_line(r['content'], 200)}")
        else:
            transcript_lines.append(f"A{q_idx}: {_clean_one_line(r['content'], 260)}")

    api_key = decrypt_api_key(prov_dict["api_key_enc"], secret_key)
    adapter = create_adapter(
        protocol=prov_dict["protocol"],
        base_url=prov_dict["base_url"],
        api_key=api_key,
        model_name=prov_dict["model_name"],
        timeout=60.0,
    )

    system_prompt = (
        "你是阅读工作台的对话历史整理助手。请根据多轮问答记录，"
        "生成一句高度凝练的中文摘要，概括本会话讨论的核心主题或线索演进（20~55字）。"
        "严格要求：只输出这一句纯文本摘要，不要加引号、序号、Markdown 符号或“总结：”等前缀。"
    )
    user_prompt = f"阅读对象：{target_label}\n\n对话记录：\n" + "\n".join(transcript_lines)

    raw = await adapter.complete_once(
        messages=[LLMMessage(role="user", content=user_prompt)],
        system_prompt=system_prompt,
        temperature=0.2,
    )
    cleaned = re.sub(r"\s+", " ", (raw or "")).strip()
    cleaned = cleaned.strip("\"'“”‘’「」`*_ ")
    cleaned = re.sub(r"^(?:本?会话(?:总结|摘要)|对话(?:总结|摘要)|总结|摘要)\s*[：:]\s*", "", cleaned)
    cleaned = cleaned.strip("\"'“”‘’「」`*_ ")
    cleaned = _clean_one_line(cleaned, 80)

    with db.session() as conn:
        _require_owned_session(conn, session_id, current_user.id)
        if cleaned:
            conn.execute(
                "UPDATE chat_sessions SET summary = ?, summary_source = 'ai' WHERE id = ? AND user_id = ?",
                (cleaned, session_id, current_user.id),
            )
        updated = _require_owned_session(conn, session_id, current_user.id)
        return _enrich_sessions(conn, [updated])[0]


@router.delete("/sessions/{session_id}")
def delete_session(
    session_id: int,
    current_user: CurrentUser = Depends(get_current_user),
    db: Database = Depends(get_db),
) -> dict:
    with db.session() as conn:
        _require_owned_session(conn, session_id, current_user.id)
        conn.execute("DELETE FROM chat_sessions WHERE id = ? AND user_id = ?", (session_id, current_user.id))
    return {"deleted": True, "session_id": session_id}


@router.get("/sessions/{session_id}/messages")
def list_session_messages(
    session_id: int,
    current_user: CurrentUser = Depends(get_current_user),
    db: Database = Depends(get_db),
) -> list[dict]:
    with db.session() as conn:
        _require_owned_session(conn, session_id, current_user.id)
        rows = conn.execute(
            "SELECT id, session_id, role, content, tool_trace_json, citations_json, created_at "
            "FROM chat_messages WHERE session_id = ? ORDER BY id ASC",
            (session_id,),
        ).fetchall()
    return [
        {
            "id": r["id"],
            "session_id": r["session_id"],
            "role": r["role"],
            "content": r["content"],
            "tool_trace": json.loads(r["tool_trace_json"] or "[]"),
            "citations": json.loads(r["citations_json"] or "[]"),
            "created_at": r["created_at"],
        }
        for r in rows
    ]


@router.post("/stream")
async def chat_stream(
    body: ChatStreamRequest,
    current_user: CurrentUser = Depends(get_current_user),
    db: Database = Depends(get_db),
    settings: Settings = Depends(get_app_settings),
) -> StreamingResponse:
    secret_key = settings.resolved_secret_key()
    now = utcnow_iso()

    with db.session() as conn:
        # 1. Verify target ownership
        if body.mode == "novel":
            target = conn.execute(
                "SELECT * FROM books WHERE id = ? AND user_id = ?",
                (body.target_id, current_user.id),
            ).fetchone()
            if target is None:
                raise HTTPException(status_code=404, detail="Book not found")
            progress_ch = int(target["read_progress_ch"]) or int(target["total_chapters"])
            eff_max_chapter = (
                min(body.max_chapter, progress_ch)
                if body.max_chapter is not None
                else progress_ch
            )
        else:
            target = conn.execute(
                "SELECT * FROM documents WHERE id = ? AND user_id = ?",
                (body.target_id, current_user.id),
            ).fetchone()
            if target is None:
                raise HTTPException(status_code=404, detail="Document not found")
            eff_max_chapter = 0

        # 2. Resolve LLM provider
        if body.provider_id is not None:
            prov = conn.execute(
                "SELECT * FROM llm_providers WHERE id = ? AND user_id = ?",
                (body.provider_id, current_user.id),
            ).fetchone()
        else:
            prov = conn.execute(
                "SELECT * FROM llm_providers WHERE user_id = ? ORDER BY is_default DESC, id ASC LIMIT 1",
                (current_user.id,),
            ).fetchone()
        if prov is None:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Please configure an LLM provider API key first",
            )
        prov_dict = dict(prov)

        # 3. Create or verify session, load recent history, persist user message
        if body.session_id is not None:
            sess = _require_owned_session(conn, body.session_id, current_user.id)
            if sess["mode"] != body.mode or int(sess["target_id"]) != body.target_id:
                raise HTTPException(status_code=400, detail="Session mode/target mismatch")
            session_id = int(sess["id"])
        else:
            title_preview = body.message.strip().splitlines()[0][:40]
            s_cur = conn.execute(
                "INSERT INTO chat_sessions (user_id, mode, target_id, title, created_at, updated_at) "
                "VALUES (?, ?, ?, ?, ?, ?)",
                (current_user.id, body.mode, body.target_id, title_preview, now, now),
            )
            session_id = int(s_cur.lastrowid)

        hist_rows = conn.execute(
            "SELECT role, content FROM chat_messages WHERE session_id = ? ORDER BY id DESC LIMIT 10",
            (session_id,),
        ).fetchall()
        history_messages = [
            LLMMessage(role=r["role"], content=r["content"])
            for r in reversed(hist_rows)
            if r["role"] in ("user", "assistant")
        ]

        conn.execute(
            "INSERT INTO chat_messages (session_id, role, content, tool_trace_json, citations_json, created_at) "
            "VALUES (?, 'user', ?, '[]', '[]', ?)",
            (session_id, body.message, now),
        )
        conn.execute(
            "UPDATE chat_sessions SET updated_at = ? WHERE id = ?",
            (now, session_id),
        )

    api_key = decrypt_api_key(prov_dict["api_key_enc"], secret_key)
    adapter = create_adapter(
        protocol=prov_dict["protocol"],
        base_url=prov_dict["base_url"],
        api_key=api_key,
        model_name=prov_dict["model_name"],
        timeout=120.0,
    )
    use_react = bool(prov_dict["use_react_fallback"]) or not bool(prov_dict["supports_tools"])

    async def event_generator() -> AsyncIterator[str]:
        yield _format_sse("session", {"session_id": session_id})
        final_answer = ""
        tool_trace: list[dict[str, Any]] = []
        citations: list[dict[str, Any]] = []

        try:
            with db.session() as conn:
                if body.mode == "novel":
                    stream = stream_novel_agent(
                        conn=conn,
                        adapter=adapter,
                        book_row=target,
                        history_messages=history_messages,
                        user_query=body.message,
                        max_chapter=eff_max_chapter,
                        use_react_fallback=use_react,
                        scenario=body.scenario or "verify",
                    )
                else:
                    stream = stream_document_agent(
                        conn=conn,
                        adapter=adapter,
                        doc_row=target,
                        history_messages=history_messages,
                        user_query=body.message,
                        use_react_fallback=use_react,
                    )

                async for ev in stream:
                    if ev["event"] == "_complete":
                        final_answer = ev["answer"]
                        tool_trace = ev["tool_trace"]
                        citations = ev["citations"]
                    else:
                        yield _format_sse(ev["event"], ev["data"])

            done_time = utcnow_iso()
            with db.session() as conn:
                m_cur = conn.execute(
                    "INSERT INTO chat_messages (session_id, role, content, tool_trace_json, citations_json, created_at) "
                    "VALUES (?, 'assistant', ?, ?, ?, ?)",
                    (
                        session_id,
                        final_answer,
                        json.dumps(tool_trace, ensure_ascii=False),
                        json.dumps(citations, ensure_ascii=False),
                        done_time,
                    ),
                )
                conn.execute(
                    "UPDATE chat_sessions SET updated_at = ? WHERE id = ?",
                    (done_time, session_id),
                )
                msg_id = int(m_cur.lastrowid)

            yield _format_sse(
                "done",
                {"session_id": session_id, "message_id": msg_id},
            )
        except Exception as exc:
            yield _format_sse("error", {"detail": str(exc)})

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )
