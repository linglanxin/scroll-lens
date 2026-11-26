from __future__ import annotations

import re
import sqlite3
from typing import Any, AsyncIterator

from app.agent.loop import run_tool_agent_loop
from app.engines.novel import search as novel_search
from app.llm.base import BaseLLMAdapter, LLMMessage, ToolDefinition

CH_CITATION_RE = re.compile(r"\[ch:(\d+)\]")

NOVEL_TOOLS: list[ToolDefinition] = [
    ToolDefinition(
        name="list_volumes",
        description="返回原书分卷目录（含起止章号；若已生成卷纲且整卷在当前阅读进度内，则附带卷纲摘要）。",
        parameters={
            "type": "object",
            "properties": {
                "max_chapter": {
                    "type": "integer",
                    "description": "最大允许检索章号（受防剧透进度锁限制）",
                }
            },
            "required": [],
        },
    ),
    ToolDefinition(
        name="get_keyword_timeline",
        description="统计关键词首次出场章、末次出场章、总频次及全书热区分布，定位跨千章演变节点。",
        parameters={
            "type": "object",
            "properties": {
                "keyword": {"type": "string", "description": "角色名、势力名或关键设定词"},
                "max_chapter": {"type": "integer"},
                "buckets": {"type": "integer", "default": 20},
            },
            "required": ["keyword"],
        },
    ),
    ToolDefinition(
        name="search_chapters",
        description="精准检索单关键词、多关键词交集（AND）或并集（OR），支持按分卷或章节区间过滤，返回命中前后150字摘录。",
        parameters={
            "type": "object",
            "properties": {
                "keywords": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "关键词列表",
                },
                "match_mode": {"type": "string", "enum": ["AND", "OR"], "default": "AND"},
                "volume_num": {"type": "integer"},
                "start_ch": {"type": "integer"},
                "end_ch": {"type": "integer"},
                "limit": {"type": "integer", "default": 15},
            },
            "required": ["keywords"],
        },
    ),
    ToolDefinition(
        name="list_chapter_titles",
        description="浏览指定章节区间的章节标题（单次最多100条）。",
        parameters={
            "type": "object",
            "properties": {
                "start_ch": {"type": "integer"},
                "end_ch": {"type": "integer"},
            },
            "required": ["start_ch", "end_ch"],
        },
    ),
    ToolDefinition(
        name="read_chapter",
        description="精读指定章节原文；若提供 focus_keyword 且正文较长，则围绕关键词截取上下文。",
        parameters={
            "type": "object",
            "properties": {
                "chapter_num": {"type": "integer"},
                "focus_keyword": {"type": "string"},
                "max_chars": {"type": "integer", "default": 2500},
            },
            "required": ["chapter_num"],
        },
    ),
    ToolDefinition(
        name="query_wiki_notes",
        description="检索本地已保存的人物/军团/势力/物品/事件设定卡片。",
        parameters={
            "type": "object",
            "properties": {
                "entity_name": {"type": "string", "description": "实体名称（留空返回最近卡片）"},
            },
            "required": ["entity_name"],
        },
    ),
]


def _build_novel_system_prompt(book_title: str, total_chapters: int, max_chapter: int) -> str:
    return (
        f"你是 ScrollLens（卷镜）网文阅读助手，正在协助用户查证超长连载小说《{book_title}》"
        f"（全书共 {total_chapters} 章，当前防剧透进度锁限制在 **第 {max_chapter} 章** 及以前）。\n\n"
        "请严格遵守以下规则：\n"
        "1. **防剧透绝对红线**：严禁检索、引用或剧透第 {max_chapter} 章之后的任何内容。\n"
        "2. **先结构/时间轴，再精读**：面对宏观问题先调用 `list_volumes` 或 `get_keyword_timeline` 定位热区，"
        "再用 `search_chapters` 锁定具体章节，最后按需用 `read_chapter` 核对原文细节。\n"
        "3. **真实引用**：回答中提及具体事件、设定或原话时，必须使用 `[ch:章节号]` 格式标注依据"
        "（例如 `[ch:128]`），切勿编造不存在的章号或剧情；若在进度范围内未查到证据，请诚实说明。\n"
    ).replace("{max_chapter}", str(max_chapter))


def extract_chapter_citations(conn: sqlite3.Connection, book_id: int, answer_text: str, max_chapter: int) -> list[dict]:
    nums = sorted({int(m.group(1)) for m in CH_CITATION_RE.finditer(answer_text) if int(m.group(1)) <= max_chapter})
    if not nums:
        return []
    placeholders = ",".join("?" for _ in nums)
    rows = conn.execute(
        f"SELECT c.chapter_num, c.title, v.volume_num, v.title AS volume_title "
        f"FROM chapters c JOIN volumes v ON v.id = c.volume_id "
        f"WHERE c.book_id = ? AND c.chapter_num IN ({placeholders}) ORDER BY c.chapter_num ASC",
        [book_id, *nums],
    ).fetchall()
    return [
        {
            "type": "chapter",
            "chapter_num": r["chapter_num"],
            "title": r["title"],
            "volume_num": r["volume_num"],
            "volume_title": r["volume_title"],
        }
        for r in rows
    ]


async def stream_novel_agent(
    conn: sqlite3.Connection,
    adapter: BaseLLMAdapter,
    book_row: sqlite3.Row,
    history_messages: list[LLMMessage],
    user_query: str,
    max_chapter: int,
    use_react_fallback: bool = False,
) -> AsyncIterator[dict[str, Any]]:
    book_id = int(book_row["id"])
    total_chapters = int(book_row["total_chapters"])
    eff_max = max(1, min(max_chapter, total_chapters)) if total_chapters > 0 else 0

    def execute_tool(name: str, args: dict[str, Any]) -> Any:
        # Hard enforcement of eff_max regardless of what the LLM asks for
        req_max = int(args.get("max_chapter", eff_max)) if args.get("max_chapter") is not None else eff_max
        clamped_max = min(eff_max, max(1, req_max)) if eff_max > 0 else 0

        if name == "list_volumes":
            return novel_search.list_volumes(conn, book_id, clamped_max)
        if name == "get_keyword_timeline":
            return novel_search.get_keyword_timeline(
                conn,
                book_id,
                keyword=str(args.get("keyword", "")),
                max_chapter=clamped_max,
                buckets=int(args.get("buckets", 20)),
            )
        if name == "search_chapters":
            kws = args.get("keywords") or []
            if isinstance(kws, str):
                kws = [kws]
            return novel_search.search_chapters(
                conn,
                book_id,
                keywords=[str(k) for k in kws],
                max_chapter=eff_max,
                match_mode=str(args.get("match_mode", "AND")),
                volume_num=int(args["volume_num"]) if args.get("volume_num") is not None else None,
                start_ch=int(args["start_ch"]) if args.get("start_ch") is not None else None,
                end_ch=int(args["end_ch"]) if args.get("end_ch") is not None else None,
                limit=int(args.get("limit", 15)),
            )
        if name == "list_chapter_titles":
            return novel_search.list_chapter_titles(
                conn,
                book_id,
                start_ch=int(args.get("start_ch", 1)),
                end_ch=int(args.get("end_ch", 50)),
                max_chapter=eff_max,
            )
        if name == "read_chapter":
            return novel_search.read_chapter(
                conn,
                book_id,
                chapter_num=int(args.get("chapter_num", 1)),
                max_chapter=eff_max,
                focus_keyword=args.get("focus_keyword"),
                max_chars=int(args.get("max_chars", 2500)),
            )
        if name == "query_wiki_notes":
            return novel_search.query_wiki_notes(
                conn, book_id, entity_name=str(args.get("entity_name", ""))
            )
        return {"error": f"Unknown tool: {name}"}

    messages = [*history_messages, LLMMessage(role="user", content=user_query)]
    system_prompt = _build_novel_system_prompt(str(book_row["title"]), total_chapters, eff_max)

    final_answer = ""
    tool_trace: list[dict[str, Any]] = []
    async for ev in run_tool_agent_loop(
        adapter=adapter,
        messages=messages,
        tools=NOVEL_TOOLS,
        system_prompt=system_prompt,
        executor=execute_tool,
        use_react_fallback=use_react_fallback,
    ):
        if ev["event"] == "_final":
            final_answer = ev["answer"]
            tool_trace = ev["tool_trace"]
        else:
            yield ev

    citations = extract_chapter_citations(conn, book_id, final_answer, eff_max)
    yield {"event": "citations", "data": {"citations": citations}}
    yield {
        "event": "_complete",
        "answer": final_answer,
        "tool_trace": tool_trace,
        "citations": citations,
    }
