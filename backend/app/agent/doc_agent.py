from __future__ import annotations

import re
import sqlite3
from typing import Any, AsyncIterator

from app.agent.loop import run_tool_agent_loop
from app.engines.document import search as doc_search
from app.llm.base import BaseLLMAdapter, LLMMessage, ToolDefinition

PAGE_CITATION_RE = re.compile(r"\[p:(\d+)\]")

DOC_TOOLS: list[ToolDefinition] = [
    ToolDefinition(
        name="list_doc_outline",
        description="获取文档完整目录结构（每页页码、标题、字数及是否为疑似扫描/纯图页）。",
        parameters={"type": "object", "properties": {}, "required": []},
    ),
    ToolDefinition(
        name="search_doc_pages",
        description="在长文档中按关键词分页检索，返回匹配页码及上下文摘录。",
        parameters={
            "type": "object",
            "properties": {
                "keywords": {"type": "array", "items": {"type": "string"}},
                "match_mode": {"type": "string", "enum": ["AND", "OR"], "default": "AND"},
                "limit": {"type": "integer", "default": 10},
            },
            "required": ["keywords"],
        },
    ),
    ToolDefinition(
        name="read_doc_page",
        description="精读文档指定页码的完整纯文字内容。",
        parameters={
            "type": "object",
            "properties": {
                "page_num": {"type": "integer"},
                "max_chars": {"type": "integer", "default": 4000},
            },
            "required": ["page_num"],
        },
    ),
]


def extract_page_citations(conn: sqlite3.Connection, doc_id: int, answer_text: str) -> list[dict]:
    nums = sorted({int(m.group(1)) for m in PAGE_CITATION_RE.finditer(answer_text)})
    if not nums:
        return []
    placeholders = ",".join("?" for _ in nums)
    rows = conn.execute(
        f"SELECT page_num, heading, is_scanned_suspect FROM doc_pages "
        f"WHERE doc_id = ? AND page_num IN ({placeholders}) ORDER BY page_num ASC",
        [doc_id, *nums],
    ).fetchall()
    return [
        {
            "type": "page",
            "page_num": r["page_num"],
            "heading": r["heading"],
            "is_scanned_suspect": bool(r["is_scanned_suspect"]),
        }
        for r in rows
    ]


async def stream_document_agent(
    conn: sqlite3.Connection,
    adapter: BaseLLMAdapter,
    doc_row: sqlite3.Row,
    history_messages: list[LLMMessage],
    user_query: str,
    use_react_fallback: bool = False,
) -> AsyncIterator[dict[str, Any]]:
    doc_id = int(doc_row["id"])
    filename = str(doc_row["filename"])
    total_chars = int(doc_row["total_chars"])
    total_pages = int(doc_row["total_pages"])
    scanned_count = int(doc_row["scanned_page_count"])

    scanned_note = (
        f"注意：本文件共有 {scanned_count} 页为低文字密度/疑似扫描图页，当前 v1.0 仅包含纯文字内容。"
        if scanned_count > 0
        else ""
    )

    if total_chars < doc_search.DOC_DIRECT_THRESHOLD:
        # Small document (< 40,000 chars): direct lossless full-text injection
        pages = conn.execute(
            "SELECT page_num, heading, content FROM doc_pages WHERE doc_id = ? ORDER BY page_num ASC",
            (doc_id,),
        ).fetchall()
        doc_body = "\n\n".join(
            f"--- [p:{p['page_num']}] {p['heading']} ---\n{p['content']}" for p in pages
        )
        system_prompt = (
            f"你是 ScrollLens（卷镜）文档问答助手，正在解析文档《{filename}》（共 {total_pages} 页，约 {total_chars} 字）。\n"
            f"{scanned_note}\n"
            "请基于以下完整文档正文准确作答，并在引用对应页面内容时使用 `[p:页码]` 格式标注出处（如 `[p:3]`）。"
            "不要编造文档中没有的内容。\n\n"
            f"【文档正文】\n{doc_body}"
        )
        messages = [*history_messages, LLMMessage(role="user", content=user_query)]
        chunks: list[str] = []
        async for ev in adapter.stream_chat(
            messages=messages,
            tools=None,
            system_prompt=system_prompt,
            temperature=0.2,
        ):
            if ev.type == "text_delta" and ev.text:
                chunks.append(ev.text)
                yield {"event": "delta", "data": {"text": ev.text}}

        final_answer = "".join(chunks).strip()
        citations = extract_page_citations(conn, doc_id, final_answer)
        yield {"event": "citations", "data": {"citations": citations}}
        yield {
            "event": "_complete",
            "answer": final_answer,
            "tool_trace": [{"mode": "direct_full_text", "total_chars": total_chars}],
            "citations": citations,
        }
        return

    # Large document (>= 40,000 chars): paginated FTS5 + tool-calling agent
    def execute_tool(name: str, args: dict[str, Any]) -> Any:
        if name == "list_doc_outline":
            return doc_search.list_doc_outline(conn, doc_id)
        if name == "search_doc_pages":
            kws = args.get("keywords") or []
            if isinstance(kws, str):
                kws = [kws]
            return doc_search.search_doc_pages(
                conn,
                doc_id,
                keywords=[str(k) for k in kws],
                match_mode=str(args.get("match_mode", "AND")),
                limit=int(args.get("limit", 10)),
            )
        if name == "read_doc_page":
            return doc_search.read_doc_page(
                conn,
                doc_id,
                page_num=int(args.get("page_num", 1)),
                max_chars=int(args.get("max_chars", 4000)),
            )
        return {"error": f"Unknown tool: {name}"}

    system_prompt = (
        f"你是 ScrollLens（卷镜）长文档检索助手，正在解析大型文档《{filename}》（共 {total_pages} 页，约 {total_chars} 字）。\n"
        f"{scanned_note}\n"
        "请先用 `list_doc_outline` 或 `search_doc_pages` 定位相关页码，再用 `read_doc_page` 精读原文。\n"
        "回答时必须在关键事实后附上 `[p:页码]` 格式引用（如 `[p:12]`），严禁编造页码或内容。"
    )
    messages = [*history_messages, LLMMessage(role="user", content=user_query)]

    final_answer = ""
    tool_trace: list[dict[str, Any]] = []
    async for ev in run_tool_agent_loop(
        adapter=adapter,
        messages=messages,
        tools=DOC_TOOLS,
        system_prompt=system_prompt,
        executor=execute_tool,
        use_react_fallback=use_react_fallback,
    ):
        if ev["event"] == "_final":
            final_answer = ev["answer"]
            tool_trace = ev["tool_trace"]
        else:
            yield ev

    citations = extract_page_citations(conn, doc_id, final_answer)
    yield {"event": "citations", "data": {"citations": citations}}
    yield {
        "event": "_complete",
        "answer": final_answer,
        "tool_trace": tool_trace,
        "citations": citations,
    }
