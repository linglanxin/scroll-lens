from __future__ import annotations

import json
import re
import sqlite3
from typing import Any, AsyncIterator

from app.agent.loop import run_tool_agent_loop
from app.engines.novel import search as novel_search
from app.engines.novel.cards import match_cards_for_query
from app.llm.base import BaseLLMAdapter, LLMMessage, ToolDefinition

CH_CITATION_RE = re.compile(r"\[ch:(\d+)\]")

NOVEL_SCENARIO_CONFIG: dict[str, dict[str, Any]] = {
    "verify": {
        "label": "严谨考据",
        "temperature": 0.15,
        "instructions": (
            "【当前情景：严谨考据】\n"
            "- 输出规范：先给简洁「核心结论」，再按章节先后列出原文依据（每条必带 `[ch:章节号]`）。\n"
            "- 证据边界：若截至第 {max_chapter} 章未检索到依据，必须明确声明未查到相关记载，严禁猜补。\n"
        ),
    },
    "recap": {
        "label": "前情回顾",
        "temperature": 0.25,
        "instructions": (
            "【当前情景：前情回顾（停更重拾）】\n"
            "- 优先查看 `list_volumes` 与接近第 {max_chapter} 章的章节标题及原文，帮读者快速接上进度。\n"
            "- 输出规范：按「当前所处卷与主线进展 → 关键人物当前状态 → 尚未回收的悬念」三段梳理，附 `[ch:章节号]`。\n"
        ),
    },
    "discuss": {
        "label": "防剧透推演",
        "temperature": 0.45,
        "instructions": (
            "【当前情景：防剧透推演】\n"
            "- 允许像同好陪读一样分析伏笔、人物动机与后续走向，但必须清晰分层：\n"
            "  1. 「已读事实」：严格带 `[ch:章节号]` 出处；\n"
            "  2. 「基于已读内容的推演」：明确标注为推测，绝不借推演泄露第 {max_chapter} 章之后的真实剧情。\n"
        ),
    },
}

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


def _build_novel_system_prompt(
    book_title: str,
    total_chapters: int,
    max_chapter: int,
    scenario: str = "verify",
    matched_cards: list[dict[str, Any]] | None = None,
) -> str:
    cfg = NOVEL_SCENARIO_CONFIG.get(scenario, NOVEL_SCENARIO_CONFIG["verify"])
    scenario_block = str(cfg["instructions"]).replace("{max_chapter}", str(max_chapter))

    cards_block = ""
    if matched_cards:
        compact_cards = [
            {
                "real_name": c["real_name"],
                "role_badge": c["role_badge"],
                "aliases": c["aliases"],
                "titles": c["titles"],
                "status_summary": c["status_summary"],
                "as_of_chapter": c["as_of_chapter"],
            }
            for c in matched_cards
        ]
        cards_block = (
            "\n【本地已存档人物/势力档案（已按当前进度过滤）】\n"
            + json.dumps(compact_cards, ensure_ascii=False)
            + "\n"
        )

    return (
        f"你是 ScrollLens（卷镜）网文阅读助手，正在协助用户查证长篇小说《{book_title}》"
        f"（全书共 {total_chapters} 章，当前防剧透进度锁限制在 **第 {max_chapter} 章** 及以前）。\n\n"
        "请严格遵守以下规则：\n"
        f"1. **防剧透绝对红线**：严禁检索、引用或暗示第 {max_chapter} 章之后的任何内容；"
        f"**严禁调用你自身预训练记忆来补全本书第 {max_chapter} 章之后的剧情、隐藏身份或结局**。\n"
        "2. **先结构/时间轴，再精读**：面对宏观问题先调用 `list_volumes` 或 `get_keyword_timeline` 定位热区，"
        "再用 `search_chapters` 锁定具体章节，最后按需用 `read_chapter` 核对原文细节。\n"
        "3. **真实引用**：回答中提及具体事件、设定或原话时，必须使用 `[ch:章节号]` 格式标注依据"
        "（例如 `[ch:128]`），切勿编造不存在的章号或剧情。\n\n"
        f"{scenario_block}"
        f"{cards_block}"
    )


def extract_chapter_citations(
    conn: sqlite3.Connection,
    book_id: int,
    answer_text: str,
    max_chapter: int,
    focus_keyword: str = "",
) -> list[dict]:
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
            **({"focus_keyword": focus_keyword} if focus_keyword else {}),
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
    scenario: str = "verify",
) -> AsyncIterator[dict[str, Any]]:
    book_id = int(book_row["id"])
    total_chapters = int(book_row["total_chapters"])
    eff_max = max(1, min(max_chapter, total_chapters)) if total_chapters > 0 else 0

    matched_cards = (
        match_cards_for_query(conn, book_id, user_query, eff_max, limit=3)
        if eff_max > 0
        else []
    )
    if matched_cards:
        yield {"event": "cards", "data": {"cards": matched_cards}}

    tracked_keywords: list[str] = []

    def execute_tool(name: str, args: dict[str, Any]) -> Any:
        # Hard enforcement of eff_max regardless of what the LLM asks for
        req_max = int(args.get("max_chapter", eff_max)) if args.get("max_chapter") is not None else eff_max
        clamped_max = min(eff_max, max(1, req_max)) if eff_max > 0 else 0

        if name == "list_volumes":
            return novel_search.list_volumes(conn, book_id, clamped_max)
        if name == "get_keyword_timeline":
            kw = str(args.get("keyword", "")).strip()
            if kw:
                tracked_keywords.append(kw)
            return novel_search.get_keyword_timeline(
                conn,
                book_id,
                keyword=kw,
                max_chapter=clamped_max,
                buckets=int(args.get("buckets", 20)),
            )
        if name == "search_chapters":
            kws = args.get("keywords") or []
            if isinstance(kws, str):
                kws = [kws]
            clean_kws = [str(k).strip() for k in kws if str(k).strip()]
            if clean_kws:
                tracked_keywords.append(clean_kws[0])
            return novel_search.search_chapters(
                conn,
                book_id,
                keywords=clean_kws,
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
            fk = args.get("focus_keyword")
            if isinstance(fk, str) and fk.strip():
                tracked_keywords.append(fk.strip())
            return novel_search.read_chapter(
                conn,
                book_id,
                chapter_num=int(args.get("chapter_num", 1)),
                max_chapter=eff_max,
                focus_keyword=fk,
                max_chars=int(args.get("max_chars", 2500)),
            )
        if name == "query_wiki_notes":
            return novel_search.query_wiki_notes(
                conn, book_id, entity_name=str(args.get("entity_name", ""))
            )
        return {"error": f"Unknown tool: {name}"}

    messages = [*history_messages, LLMMessage(role="user", content=user_query)]
    eff_scenario = scenario if scenario in NOVEL_SCENARIO_CONFIG else "verify"
    scenario_temp = float(NOVEL_SCENARIO_CONFIG[eff_scenario]["temperature"])
    system_prompt = _build_novel_system_prompt(
        str(book_row["title"]),
        total_chapters,
        eff_max,
        scenario=eff_scenario,
        matched_cards=matched_cards,
    )

    final_answer = ""
    tool_trace: list[dict[str, Any]] = []
    async for ev in run_tool_agent_loop(
        adapter=adapter,
        messages=messages,
        tools=NOVEL_TOOLS,
        system_prompt=system_prompt,
        executor=execute_tool,
        use_react_fallback=use_react_fallback,
        temperature=scenario_temp,
    ):
        if ev["event"] == "_final":
            final_answer = ev["answer"]
            tool_trace = ev["tool_trace"]
        else:
            yield ev

    focus_kw = tracked_keywords[0] if tracked_keywords else (matched_cards[0]["real_name"] if matched_cards else "")
    citations = extract_chapter_citations(conn, book_id, final_answer, eff_max, focus_keyword=focus_kw)
    yield {"event": "citations", "data": {"citations": citations}}
    yield {
        "event": "_complete",
        "answer": final_answer,
        "tool_trace": tool_trace,
        "citations": citations,
    }
