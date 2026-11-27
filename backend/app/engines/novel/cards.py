from __future__ import annotations

import json
import re
import sqlite3
from typing import Any

from app.agent.loop import run_tool_agent_loop
from app.db.database import Database, utcnow_iso
from app.engines.novel import search as novel_search
from app.engines.novel.indexer import rebuild_book_fts
from app.llm.base import BaseLLMAdapter, LLMMessage, ToolDefinition

VALID_CARD_TYPES = {"character", "faction", "item", "world"}

CARD_TOOLS: list[ToolDefinition] = [
    ToolDefinition(
        name="list_volumes",
        description="返回原书分卷目录与已读完卷纲摘要。",
        parameters={
            "type": "object",
            "properties": {"max_chapter": {"type": "integer"}},
            "required": [],
        },
    ),
    ToolDefinition(
        name="get_keyword_timeline",
        description="统计角色名/势力名在已读章节内的首次出场章、末次出场章、频次与热区分布。",
        parameters={
            "type": "object",
            "properties": {
                "keyword": {"type": "string"},
                "max_chapter": {"type": "integer"},
                "buckets": {"type": "integer", "default": 16},
            },
            "required": ["keyword"],
        },
    ),
    ToolDefinition(
        name="search_chapters",
        description="按关键词在指定章节范围检索命中摘录。",
        parameters={
            "type": "object",
            "properties": {
                "keywords": {"type": "array", "items": {"type": "string"}},
                "match_mode": {"type": "string", "enum": ["AND", "OR"], "default": "OR"},
                "start_ch": {"type": "integer"},
                "end_ch": {"type": "integer"},
                "limit": {"type": "integer", "default": 12},
            },
            "required": ["keywords"],
        },
    ),
    ToolDefinition(
        name="list_chapter_titles",
        description="浏览指定章节区间的章节标题。",
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
        description="精读指定章节原文（可围绕 focus_keyword 截取上下文）。",
        parameters={
            "type": "object",
            "properties": {
                "chapter_num": {"type": "integer"},
                "focus_keyword": {"type": "string"},
                "max_chars": {"type": "integer", "default": 2400},
            },
            "required": ["chapter_num"],
        },
    ),
]


def _safe_json_list(raw: str | None) -> list[Any]:
    if not raw:
        return []
    try:
        parsed = json.loads(raw)
        return parsed if isinstance(parsed, list) else []
    except Exception:
        return []


def _extract_json_object(raw_text: str) -> dict[str, Any]:
    text = (raw_text or "").strip()
    if not text:
        return {}
    fenced = re.search(r"```(?:json)?\s*(\{.*?\})\s*```", text, re.DOTALL)
    candidates: list[str] = []
    if fenced:
        candidates.append(fenced.group(1))
    first_brace = text.find("{")
    last_brace = text.rfind("}")
    if first_brace != -1 and last_brace > first_brace:
        candidates.append(text[first_brace : last_brace + 1])
    for cand in candidates:
        try:
            obj = json.loads(cand)
            if isinstance(obj, dict):
                return obj
        except json.JSONDecodeError:
            continue
    return {}


def _clean_str_list(items: Any, exclude: str = "", limit: int = 12) -> list[str]:
    if not isinstance(items, list):
        return []
    out: list[str] = []
    seen: set[str] = set()
    ex = exclude.strip().lower()
    for it in items:
        s = str(it).strip()
        if not s or len(s) > 40:
            continue
        low = s.lower()
        if low == ex or low in seen:
            continue
        seen.add(low)
        out.append(s)
        if len(out) >= limit:
            break
    return out


def _clean_attributes(items: Any) -> list[dict[str, str]]:
    if not isinstance(items, list):
        return []
    out: list[dict[str, str]] = []
    for it in items[:8]:
        if isinstance(it, dict):
            lbl = str(it.get("label") or "").strip()[:30]
            val = str(it.get("value") or "").strip()[:120]
            if lbl and val:
                out.append({"label": lbl, "value": val})
    return out


def _clean_timeline(items: Any, max_chapter: int) -> list[dict[str, Any]]:
    if not isinstance(items, list):
        return []
    out: list[dict[str, Any]] = []
    for it in items[:12]:
        if not isinstance(it, dict):
            continue
        stage = str(it.get("stage") or "").strip()[:40]
        event = str(it.get("event") or "").strip()[:300]
        if not event:
            continue
        ch_range = str(it.get("chapter_range") or "").strip()[:32]
        anchor = 0
        raw_anchor = it.get("anchor_chapter")
        if isinstance(raw_anchor, (int, float)) and int(raw_anchor) >= 1:
            anchor = int(raw_anchor)
        elif isinstance(raw_anchor, str) and raw_anchor.strip().isdigit():
            anchor = int(raw_anchor.strip())
        elif ch_range:
            m = re.search(r"\d+", ch_range)
            if m:
                anchor = int(m.group(0))
        if anchor > max_chapter > 0:
            continue
        out.append(
            {
                "stage": stage or "阶段节点",
                "chapter_range": ch_range or (f"第{anchor}章" if anchor > 0 else ""),
                "anchor_chapter": anchor,
                "event": event,
            }
        )
    out.sort(key=lambda x: x["anchor_chapter"] if x["anchor_chapter"] > 0 else 10**9)
    return out


def _clean_relations(items: Any, max_chapter: int) -> list[dict[str, Any]]:
    if not isinstance(items, list):
        return []
    out: list[dict[str, Any]] = []
    seen: set[str] = set()
    for it in items[:10]:
        if not isinstance(it, dict):
            continue
        target = str(it.get("target") or "").strip()[:40]
        relation = str(it.get("relation") or "").strip()[:80]
        if not target or not relation or target.lower() in seen:
            continue
        seen.add(target.lower())
        anchor = 0
        raw_anchor = it.get("anchor_chapter")
        if isinstance(raw_anchor, (int, float)) and 1 <= int(raw_anchor) <= max_chapter:
            anchor = int(raw_anchor)
        out.append({"target": target, "relation": relation, "anchor_chapter": anchor})
    return out


def serialize_card_row(
    row: sqlite3.Row,
    conn: sqlite3.Connection | None = None,
    max_chapter: int | None = None,
    include_activity: bool = False,
) -> dict[str, Any]:
    raw_timeline = _safe_json_list(row["timeline_json"])
    raw_relations = _safe_json_list(row["relations_json"])
    raw_sources = [
        int(x)
        for x in _safe_json_list(row["source_chapters_json"])
        if isinstance(x, (int, float)) or str(x).isdigit()
    ]
    as_of = int(row["as_of_chapter"])

    hidden_count = 0
    if max_chapter is not None and max_chapter > 0:
        visible_timeline = []
        for item in raw_timeline:
            anchor = int(item.get("anchor_chapter") or 0) if isinstance(item, dict) else 0
            if anchor > max_chapter:
                hidden_count += 1
            else:
                visible_timeline.append(item)
        visible_sources = sorted({c for c in raw_sources if 1 <= c <= max_chapter})
        visible_relations = [
            rel
            for rel in raw_relations
            if isinstance(rel, dict) and int(rel.get("anchor_chapter") or 0) <= max_chapter
        ]
    else:
        visible_timeline = raw_timeline
        visible_sources = sorted(set(raw_sources))
        visible_relations = raw_relations

    data: dict[str, Any] = {
        "id": int(row["id"]),
        "book_id": int(row["book_id"]),
        "card_type": str(row["card_type"]),
        "real_name": str(row["real_name"]),
        "role_badge": str(row["role_badge"]),
        "aliases": _safe_json_list(row["aliases_json"]),
        "titles": _safe_json_list(row["titles_json"]),
        "status_summary": str(row["status_summary"]),
        "summary": str(row["summary"]),
        "attributes": _safe_json_list(row["attributes_json"]),
        "timeline": visible_timeline,
        "relations": visible_relations,
        "source_chapters": visible_sources,
        "as_of_chapter": as_of,
        "spoiler_hidden_count": hidden_count,
        "created_at": str(row["created_at"]),
        "updated_at": str(row["updated_at"]),
    }

    if include_activity and conn is not None and max_chapter and max_chapter > 0:
        tl = novel_search.get_keyword_timeline(
            conn, int(row["book_id"]), str(row["real_name"]), max_chapter=max_chapter, buckets=16
        )
        data["activity"] = {
            "first_chapter": tl["first_chapter"],
            "last_chapter": tl["last_chapter"],
            "matching_chapters": tl["matching_chapters"],
            "total_occurrences": tl["total_occurrences"],
            "buckets": tl["buckets"],
        }
    return data


def list_book_cards(
    conn: sqlite3.Connection,
    book_id: int,
    max_chapter: int,
    card_type: str | None = None,
    include_activity: bool = False,
) -> list[dict[str, Any]]:
    if card_type and card_type in VALID_CARD_TYPES:
        rows = conn.execute(
            "SELECT * FROM novel_cards WHERE book_id = ? AND card_type = ? ORDER BY updated_at DESC, id DESC",
            (book_id, card_type),
        ).fetchall()
    else:
        rows = conn.execute(
            "SELECT * FROM novel_cards WHERE book_id = ? ORDER BY updated_at DESC, id DESC",
            (book_id,),
        ).fetchall()
    return [
        serialize_card_row(r, conn=conn, max_chapter=max_chapter, include_activity=include_activity)
        for r in rows
    ]


def match_cards_for_query(
    conn: sqlite3.Connection,
    book_id: int,
    query_text: str,
    max_chapter: int,
    limit: int = 3,
) -> list[dict[str, Any]]:
    """Find saved cards relevant to the user's question (by real_name, alias, title, or role_badge)."""
    q = (query_text or "").strip().lower()
    if not q:
        return []
    rows = conn.execute(
        "SELECT * FROM novel_cards WHERE book_id = ? ORDER BY updated_at DESC",
        (book_id,),
    ).fetchall()
    matched: list[dict[str, Any]] = []
    for r in rows:
        terms = [str(r["real_name"])]
        terms.extend(str(x) for x in _safe_json_list(r["aliases_json"]))
        terms.extend(str(x) for x in _safe_json_list(r["titles_json"]))
        role_badge = str(r["role_badge"] or "").strip()
        if role_badge and len(role_badge) >= 2:
            terms.append(role_badge)

        hit = False
        for t in terms:
            t_clean = t.strip().lower()
            if len(t_clean) >= 2 and t_clean in q:
                hit = True
                break
        if not hit and role_badge:
            if ("主角" in q or "男主" in q) and ("主角" in role_badge or "男主" in role_badge):
                hit = True
            elif ("女主" in q or "女主角" in q) and "女主" in role_badge:
                hit = True
        if hit:
            matched.append(serialize_card_row(r, max_chapter=max_chapter, include_activity=False))
            if len(matched) >= limit:
                break
    return matched


def _build_card_system_prompt(
    book_title: str,
    total_chapters: int,
    max_chapter: int,
    existing_card: dict[str, Any] | None = None,
) -> str:
    base = (
        f"你是 ScrollLens（卷镜）小说设定档案师，正在为小说《{book_title}》构建结构化人物/势力档案卡"
        f"（全书共 {total_chapters} 章，当前防剧透进度锁：**第 {max_chapter} 章** 及以前）。\n\n"
        "【硬性红线】\n"
        f"1. **绝对禁止剧透**：只允许基于工具检索到的第 1~{max_chapter} 章原文作答；**严禁使用你的预训练记忆补全未读剧情或后期身份/结局**。\n"
        "2. **先查后写**：必须先调用工具核实对象：\n"
        "   - 若用户输入泛指（如“主角”“女主”“最大势力”），先调用 `list_volumes`、`list_chapter_titles(1, 20)` 或 `read_chapter(1)` 确认其真名，再用 `get_keyword_timeline` 与 `search_chapters` 采样早期出场、高热区与接近当前进度的最新章节。\n"
        "   - 若用户输入具体名称，先用 `get_keyword_timeline` 摸清首次出场与热区，再分段调用 `search_chapters` / `read_chapter` 核对别名、地位变化与关键发展节点。\n"
        "3. **题材自适应**：`attributes` 字段的 `label` 必须贴合本书实际题材（例如修仙用“境界/宗门/功法”，历史用“字号/官职/阵营”，星际科幻用“阶位/军团/专长”，势力卡用“首领/据点/核心成员”）。\n"
    )
    if existing_card is not None:
        old_ch = int(existing_card.get("as_of_chapter") or 0)
        base += (
            f"\n【增量更新任务】\n"
            f"已有旧档案截至第 {old_ch} 章，现在用户已读至第 {max_chapter} 章。\n"
            f"请重点检索第 {old_ch + 1}~{max_chapter} 章的新动态，保留旧档案中仍成立的事实与历史节点，"
            "合并新增的别名/称呼，更新最新身份地位，并在 `timeline` 中追加新阶段。\n"
            f"现有旧档案 JSON：\n{json.dumps(existing_card, ensure_ascii=False)}\n"
        )

    base += (
        "\n【最终输出格式（严格只输出一个 JSON 对象，不要包含额外解释文字）】\n"
        "```json\n"
        "{\n"
        '  "card_type": "character | faction | item | world",\n'
        '  "real_name": "真名或势力全称",\n'
        '  "role_badge": "简短定位，如 主角 / 女主 / 核心配角 / 反派 / 顶级势力",\n'
        '  "aliases": ["外号、化名、代号等（不含真名）"],\n'
        '  "titles": ["官职、封号、尊称等"],\n'
        '  "status_summary": "截至当前进度的一句话身份与地位概括",\n'
        '  "summary": "2~3句贴合原书内容的人物/势力核心小传",\n'
        '  "attributes": [{"label": "贴合题材的维度名", "value": "具体内容"}],\n'
        '  "timeline": [\n'
        '    {"stage": "阶段名", "chapter_range": "第1-30章", "anchor_chapter": 1, "event": "该阶段核心经历与转折"}\n'
        "  ],\n"
        '  "relations": [\n'
        '    {"target": "关联人物或势力名", "relation": "关系描述", "anchor_chapter": 12}\n'
        "  ],\n"
        '  "source_chapters": [1, 12, 30]\n'
        "}\n"
        "```"
    )
    return base


async def generate_or_update_card(
    conn: sqlite3.Connection,
    adapter: BaseLLMAdapter,
    book_row: sqlite3.Row,
    query_name: str,
    max_chapter: int,
    card_type_hint: str | None = None,
    existing_card: dict[str, Any] | None = None,
    use_react_fallback: bool = False,
) -> dict[str, Any]:
    book_id = int(book_row["id"])
    total_chapters = int(book_row["total_chapters"])
    eff_max = max(1, min(max_chapter, total_chapters)) if total_chapters > 0 else 1

    def execute_tool(name: str, args: dict[str, Any]) -> Any:
        req_max = int(args.get("max_chapter", eff_max)) if args.get("max_chapter") is not None else eff_max
        clamped_max = min(eff_max, max(1, req_max))
        if name == "list_volumes":
            return novel_search.list_volumes(conn, book_id, clamped_max)
        if name == "get_keyword_timeline":
            return novel_search.get_keyword_timeline(
                conn,
                book_id,
                keyword=str(args.get("keyword", "")),
                max_chapter=clamped_max,
                buckets=int(args.get("buckets", 16)),
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
                match_mode=str(args.get("match_mode", "OR")),
                start_ch=int(args["start_ch"]) if args.get("start_ch") is not None else None,
                end_ch=int(args["end_ch"]) if args.get("end_ch") is not None else None,
                limit=int(args.get("limit", 12)),
            )
        if name == "list_chapter_titles":
            return novel_search.list_chapter_titles(
                conn,
                book_id,
                start_ch=int(args.get("start_ch", 1)),
                end_ch=int(args.get("end_ch", 40)),
                max_chapter=eff_max,
            )
        if name == "read_chapter":
            return novel_search.read_chapter(
                conn,
                book_id,
                chapter_num=int(args.get("chapter_num", 1)),
                max_chapter=eff_max,
                focus_keyword=args.get("focus_keyword"),
                max_chars=int(args.get("max_chars", 2400)),
            )
        return {"error": f"Unknown tool: {name}"}

    system_prompt = _build_card_system_prompt(
        str(book_row["title"]), total_chapters, eff_max, existing_card=existing_card
    )
    hint_text = f"（类型偏向：{card_type_hint}）" if card_type_hint in VALID_CARD_TYPES else ""
    if existing_card:
        user_msg = (
            f"请将「{existing_card['real_name']}」的档案卡从第 {existing_card['as_of_chapter']} 章"
            f"增量更新至当前进度第 {eff_max} 章，输出完整更新后的 JSON 对象。"
        )
    else:
        user_msg = (
            f"请为小说中的「{query_name.strip()}」{hint_text}生成截至第 {eff_max} 章的完整档案卡 JSON 对象。"
        )

    final_answer = ""
    async for ev in run_tool_agent_loop(
        adapter=adapter,
        messages=[LLMMessage(role="user", content=user_msg)],
        tools=CARD_TOOLS,
        system_prompt=system_prompt,
        executor=execute_tool,
        use_react_fallback=use_react_fallback,
        temperature=0.15,
    ):
        if ev["event"] == "_final":
            final_answer = ev["answer"]

    parsed = _extract_json_object(final_answer)
    if not parsed:
        repaired = await adapter.complete_once(
            messages=[
                LLMMessage(role="user", content=user_msg),
                LLMMessage(role="assistant", content=final_answer or "未生成内容"),
                LLMMessage(
                    role="user",
                    content="请将上述信息严格整理为一个合法的 JSON 对象（包含 real_name, card_type, role_badge, aliases, titles, status_summary, summary, attributes, timeline, relations, source_chapters），只输出 JSON。",
                ),
            ],
            system_prompt="你是严谨的 JSON 格式化器，只输出合法 JSON。",
            temperature=0.0,
        )
        parsed = _extract_json_object(repaired)

    fallback_name = existing_card["real_name"] if existing_card else query_name.strip()
    real_name = str(parsed.get("real_name") or fallback_name).strip()[:80] or fallback_name
    card_type = str(
        parsed.get("card_type")
        or card_type_hint
        or (existing_card["card_type"] if existing_card else "character")
    ).strip().lower()
    if card_type not in VALID_CARD_TYPES:
        card_type = "character"

    role_badge = str(
        parsed.get("role_badge") or (existing_card["role_badge"] if existing_card else "")
    ).strip()[:30]
    aliases = _clean_str_list(parsed.get("aliases"), exclude=real_name)
    titles = _clean_str_list(parsed.get("titles"), exclude=real_name)
    status_summary = str(parsed.get("status_summary") or "").strip()[:220]
    summary = str(parsed.get("summary") or final_answer[:320]).strip()[:800]
    attributes = _clean_attributes(parsed.get("attributes"))
    timeline = _clean_timeline(parsed.get("timeline"), eff_max)
    relations = _clean_relations(parsed.get("relations"), eff_max)

    raw_src = parsed.get("source_chapters")
    src_set: set[int] = set()
    if isinstance(raw_src, list):
        for s in raw_src:
            if isinstance(s, (int, float)) and 1 <= int(s) <= eff_max:
                src_set.add(int(s))
    for t in timeline:
        if 1 <= int(t.get("anchor_chapter") or 0) <= eff_max:
            src_set.add(int(t["anchor_chapter"]))
    source_chapters = sorted(src_set)

    now = utcnow_iso()
    if existing_card is not None:
        card_id = int(existing_card["id"])
        conn.execute(
            "UPDATE novel_cards SET card_type = ?, real_name = ?, role_badge = ?, "
            "aliases_json = ?, titles_json = ?, status_summary = ?, summary = ?, "
            "attributes_json = ?, timeline_json = ?, relations_json = ?, "
            "source_chapters_json = ?, as_of_chapter = ?, updated_at = ? "
            "WHERE id = ? AND book_id = ?",
            (
                card_type,
                real_name,
                role_badge,
                json.dumps(aliases, ensure_ascii=False),
                json.dumps(titles, ensure_ascii=False),
                status_summary,
                summary,
                json.dumps(attributes, ensure_ascii=False),
                json.dumps(timeline, ensure_ascii=False),
                json.dumps(relations, ensure_ascii=False),
                json.dumps(source_chapters),
                eff_max,
                now,
                card_id,
                book_id,
            ),
        )
        row = conn.execute(
            "SELECT * FROM novel_cards WHERE id = ? AND book_id = ?", (card_id, book_id)
        ).fetchone()
    else:
        conn.execute(
            "INSERT INTO novel_cards "
            "(book_id, card_type, real_name, role_badge, aliases_json, titles_json, "
            "status_summary, summary, attributes_json, timeline_json, relations_json, "
            "source_chapters_json, as_of_chapter, created_at, updated_at) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) "
            "ON CONFLICT(book_id, real_name) DO UPDATE SET "
            "card_type = excluded.card_type, role_badge = excluded.role_badge, "
            "aliases_json = excluded.aliases_json, titles_json = excluded.titles_json, "
            "status_summary = excluded.status_summary, summary = excluded.summary, "
            "attributes_json = excluded.attributes_json, timeline_json = excluded.timeline_json, "
            "relations_json = excluded.relations_json, source_chapters_json = excluded.source_chapters_json, "
            "as_of_chapter = excluded.as_of_chapter, updated_at = excluded.updated_at",
            (
                book_id,
                card_type,
                real_name,
                role_badge,
                json.dumps(aliases, ensure_ascii=False),
                json.dumps(titles, ensure_ascii=False),
                status_summary,
                summary,
                json.dumps(attributes, ensure_ascii=False),
                json.dumps(timeline, ensure_ascii=False),
                json.dumps(relations, ensure_ascii=False),
                json.dumps(source_chapters),
                eff_max,
                now,
                now,
            ),
        )
        row = conn.execute(
            "SELECT * FROM novel_cards WHERE book_id = ? AND real_name = ?",
            (book_id, real_name),
        ).fetchone()

    return serialize_card_row(row, conn=conn, max_chapter=eff_max, include_activity=True)


async def discover_key_entities(
    conn: sqlite3.Connection,
    adapter: BaseLLMAdapter,
    book_row: sqlite3.Row,
    max_chapter: int,
) -> list[dict[str, Any]]:
    """Suggest 6-8 core characters & factions from read chapters so users can generate cards in 1 click."""
    book_id = int(book_row["id"])
    total_chapters = int(book_row["total_chapters"])
    eff_max = max(1, min(max_chapter, total_chapters)) if total_chapters > 0 else 1

    vols = novel_search.list_volumes(conn, book_id, eff_max)
    vol_lines = []
    for v in vols[:12]:
        line = f"- {v['title']}（第{v['start_chapter']}–{v['end_chapter']}章）"
        if v["summary_md"]:
            vol_lines.append(line + f"：{v['summary_md'][:260]}")
        else:
            vol_lines.append(line)

    sample_nums = sorted({1, min(2, eff_max), min(3, eff_max), max(1, eff_max // 2), eff_max})
    samples: list[str] = []
    for num in sample_nums[:5]:
        ch = novel_search.read_chapter(conn, book_id, num, max_chapter=eff_max, max_chars=1200)
        if ch.get("content"):
            samples.append(f"【第{num}章 {ch.get('title', '')}】\n{ch['content'][:900]}")

    prompt = (
        f"请从小说《{book_row['title']}》已读范围（第 1~{eff_max} 章）的以下抽样文本与分卷信息中，"
        "识别出最值得建立档案卡的 6~8 个核心人物与核心势力（优先包括主角、重要女主/核心同伴、主要对手与核心组织/宗门/势力）。\n"
        f"严禁使用预训练记忆补充第 {eff_max} 章之后才出场的角色。\n\n"
        "分卷信息：\n" + ("\n".join(vol_lines) or "（无分卷摘要）") + "\n\n"
        "正文抽样：\n" + "\n\n".join(samples) + "\n\n"
        '请严格只输出 JSON：{"candidates": [{"name": "真名或势力名", "card_type": "character|faction|item|world", "role_badge": "主角/女主/关键配角/势力", "reason": "一句话简介"}]}'
    )

    raw = await adapter.complete_once(
        messages=[LLMMessage(role="user", content=prompt)],
        system_prompt="你是严谨的小说档案编辑，只输出合法 JSON。",
        temperature=0.2,
    )
    parsed = _extract_json_object(raw)
    cands = parsed.get("candidates") if isinstance(parsed.get("candidates"), list) else []

    existing_rows = conn.execute(
        "SELECT id, real_name, aliases_json FROM novel_cards WHERE book_id = ?", (book_id,)
    ).fetchall()
    existing_map: dict[str, int] = {}
    for er in existing_rows:
        existing_map[str(er["real_name"]).strip().lower()] = int(er["id"])
        for al in _safe_json_list(er["aliases_json"]):
            existing_map[str(al).strip().lower()] = int(er["id"])

    out: list[dict[str, Any]] = []
    seen: set[str] = set()
    for it in cands[:10]:
        if not isinstance(it, dict):
            continue
        name = str(it.get("name") or "").strip()[:40]
        if not name or name.lower() in seen:
            continue
        seen.add(name.lower())
        ct = str(it.get("card_type") or "character").strip().lower()
        if ct not in VALID_CARD_TYPES:
            ct = "character"
        out.append(
            {
                "name": name,
                "card_type": ct,
                "role_badge": str(it.get("role_badge") or "").strip()[:20],
                "reason": str(it.get("reason") or "").strip()[:100],
                "existing_card_id": existing_map.get(name.lower()),
            }
        )
    return out


def sync_card_to_aliases(db: Database, book_id: int, card_id: int) -> dict[str, Any]:
    """Merge a card's aliases/titles into book_aliases and rebuild FTS5 index."""
    with db.session() as conn:
        row = conn.execute(
            "SELECT real_name, aliases_json, titles_json FROM novel_cards WHERE id = ? AND book_id = ?",
            (card_id, book_id),
        ).fetchone()
        if row is None:
            raise ValueError("Card not found")
        canonical = str(row["real_name"]).strip()
        incoming = _safe_json_list(row["aliases_json"]) + _safe_json_list(row["titles_json"])
        existing_row = conn.execute(
            "SELECT aliases_json FROM book_aliases WHERE book_id = ? AND canonical_name = ?",
            (book_id, canonical),
        ).fetchone()
        merged = list(_safe_json_list(existing_row["aliases_json"])) if existing_row else []
        merged.extend(str(a).strip() for a in incoming)
        clean_aliases = sorted({a for a in merged if a and a != canonical})
        conn.execute(
            "INSERT INTO book_aliases (book_id, canonical_name, aliases_json) VALUES (?, ?, ?) "
            "ON CONFLICT(book_id, canonical_name) DO UPDATE SET aliases_json = excluded.aliases_json",
            (book_id, canonical, json.dumps(clean_aliases, ensure_ascii=False)),
        )
    reindexed = rebuild_book_fts(db, book_id)
    return {
        "canonical_name": canonical,
        "aliases": clean_aliases,
        "reindexed_chapters": reindexed,
    }
