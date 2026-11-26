from __future__ import annotations

import asyncio
import json
import logging
from typing import Any

from app.config import Settings
from app.core.security import decrypt_api_key
from app.db.database import Database
from app.llm.base import LLMMessage
from app.llm.factory import create_adapter

logger = logging.getLogger(__name__)

SINGLE_PASS_CHAR_LIMIT = 150_000
DIGEST_BUDGET_CHARS = 24_000
CHUNK_CHAPTER_COUNT = 25


class VolumeSummarizerManager:
    """Manages optional asynchronous volume summarization tasks with pause/resume."""

    def __init__(self) -> None:
        self._tasks: dict[int, asyncio.Task[None]] = {}
        self._pause_flags: set[int] = set()

    def is_running(self, book_id: int) -> bool:
        task = self._tasks.get(book_id)
        return task is not None and not task.done()

    def pause_book(self, book_id: int) -> bool:
        if self.is_running(book_id):
            self._pause_flags.add(book_id)
            return True
        return False

    async def shutdown(self) -> None:
        for book_id, task in list(self._tasks.items()):
            self._pause_flags.add(book_id)
            if not task.done():
                task.cancel()
        if self._tasks:
            await asyncio.gather(*self._tasks.values(), return_exceptions=True)
        self._tasks.clear()

    def start_volumes(
        self,
        db: Database,
        settings: Settings,
        user_id: int,
        book_id: int,
        volume_ids: list[int],
        provider_id: int | None = None,
    ) -> list[int]:
        if self.is_running(book_id):
            raise RuntimeError("A summarization job is already running for this book")
        self._pause_flags.discard(book_id)

        with db.session() as conn:
            if provider_id is not None:
                prov = conn.execute(
                    "SELECT * FROM llm_providers WHERE id = ? AND user_id = ?",
                    (provider_id, user_id),
                ).fetchone()
            else:
                prov = conn.execute(
                    "SELECT * FROM llm_providers WHERE user_id = ? ORDER BY is_default DESC, id ASC LIMIT 1",
                    (user_id,),
                ).fetchone()
            if prov is None:
                raise ValueError("No configured LLM provider found for user")
            provider_cfg = dict(prov)

            placeholders = ",".join("?" for _ in volume_ids)
            vols = conn.execute(
                f"SELECT id FROM volumes WHERE book_id = ? AND id IN ({placeholders}) ORDER BY volume_num ASC",
                [book_id, *volume_ids],
            ).fetchall()
            valid_ids = [int(v["id"]) for v in vols]
            if not valid_ids:
                raise ValueError("No matching volumes found")

            for vid in valid_ids:
                conn.execute(
                    "UPDATE volumes SET summary_status = 'generating' WHERE id = ?",
                    (vid,),
                )

        task = asyncio.create_task(
            self._run_queue(db, settings, book_id, valid_ids, provider_cfg)
        )
        self._tasks[book_id] = task
        return valid_ids

    async def _run_queue(
        self,
        db: Database,
        settings: Settings,
        book_id: int,
        volume_ids: list[int],
        provider_cfg: dict[str, Any],
    ) -> None:
        api_key = decrypt_api_key(provider_cfg["api_key_enc"], settings.resolved_secret_key())
        adapter = create_adapter(
            protocol=provider_cfg["protocol"],
            base_url=provider_cfg["base_url"],
            api_key=api_key,
            model_name=provider_cfg["model_name"],
            timeout=120.0,
        )
        try:
            for vid in volume_ids:
                if book_id in self._pause_flags:
                    with db.session() as conn:
                        conn.execute(
                            "UPDATE volumes SET summary_status = 'paused' "
                            "WHERE id = ? AND summary_status = 'generating'",
                            (vid,),
                        )
                    continue
                try:
                    await self._summarize_one_volume(db, book_id, vid, adapter)
                except asyncio.CancelledError:
                    with db.session() as conn:
                        conn.execute(
                            "UPDATE volumes SET summary_status = 'paused' WHERE id = ?",
                            (vid,),
                        )
                    raise
                except Exception as exc:
                    logger.exception("Volume summarization failed for volume_id=%s", vid)
                    with db.session() as conn:
                        prog = json.dumps({"error": str(exc)}, ensure_ascii=False)
                        conn.execute(
                            "UPDATE volumes SET summary_status = 'error', summary_progress = ? WHERE id = ?",
                            (prog, vid),
                        )
        finally:
            self._pause_flags.discard(book_id)
            self._tasks.pop(book_id, None)

    async def _summarize_one_volume(
        self,
        db: Database,
        book_id: int,
        volume_id: int,
        adapter: Any,
    ) -> None:
        with db.session() as conn:
            vol = conn.execute(
                "SELECT id, volume_num, title, start_chapter, end_chapter, summary_progress "
                "FROM volumes WHERE id = ? AND book_id = ?",
                (volume_id, book_id),
            ).fetchone()
            if vol is None:
                return
            chapters = conn.execute(
                "SELECT chapter_num, title, content, char_count FROM chapters "
                "WHERE book_id = ? AND volume_id = ? ORDER BY chapter_num ASC",
                (book_id, volume_id),
            ).fetchall()
            vol_dict = dict(vol)
            ch_list = [dict(c) for c in chapters]

        if not ch_list:
            with db.session() as conn:
                conn.execute(
                    "UPDATE volumes SET summary_md = '（本卷暂无章节）', summary_status = 'ready' WHERE id = ?",
                    (volume_id,),
                )
            return

        total_chars = sum(int(c["char_count"]) for c in ch_list)
        vol_title = vol_dict["title"]

        if total_chars <= SINGLE_PASS_CHAR_LIMIT:
            digest = _build_chapters_digest(ch_list, DIGEST_BUDGET_CHARS)
            prompt = (
                f"请为小说分卷《{vol_title}》（第{vol_dict['start_chapter']}–{vol_dict['end_chapter']}章）"
                f"撰写一份结构化中文卷纲，涵盖：\n"
                f"1. 核心主线剧情脉络\n2. 关键登场人物与重要变动\n3. 重要势力/战力/道具节点\n"
                f"请严格基于以下章节摘要客观总结，不要编造未出现内容：\n\n{digest}"
            )
            summary_md = await adapter.complete_once(
                messages=[LLMMessage(role="user", content=prompt)],
                system_prompt="你是严谨的小说编辑，擅长提炼长篇网文分卷大纲。",
            )
            with db.session() as conn:
                conn.execute(
                    "UPDATE volumes SET summary_md = ?, summary_status = 'ready', summary_progress = '' WHERE id = ?",
                    (summary_md.strip(), volume_id),
                )
            return

        # Hierarchical chunked compression for huge volumes (> 150k chars)
        chunks = [
            ch_list[i : i + CHUNK_CHAPTER_COUNT]
            for i in range(0, len(ch_list), CHUNK_CHAPTER_COUNT)
        ]
        state = {"completed_chunks": 0, "total_chunks": len(chunks), "chunk_summaries": []}
        if vol_dict["summary_progress"]:
            try:
                loaded = json.loads(vol_dict["summary_progress"])
                if isinstance(loaded, dict) and loaded.get("total_chunks") == len(chunks):
                    state = loaded
            except Exception:
                pass

        done_count = int(state.get("completed_chunks", 0))
        chunk_summaries: list[str] = list(state.get("chunk_summaries", []))

        for idx in range(done_count, len(chunks)):
            if book_id in self._pause_flags:
                with db.session() as conn:
                    conn.execute(
                        "UPDATE volumes SET summary_status = 'paused', summary_progress = ? WHERE id = ?",
                        (json.dumps(state, ensure_ascii=False), volume_id),
                    )
                return

            chunk = chunks[idx]
            c_start = chunk[0]["chapter_num"]
            c_end = chunk[-1]["chapter_num"]
            digest = _build_chapters_digest(chunk, 18_000)
            prompt = (
                f"请概括小说分卷《{vol_title}》第{c_start}–{c_end}章的阶段剧情要点、"
                f"核心人物行动与势力/能力变化（300字以内）：\n\n{digest}"
            )
            chunk_sum = await adapter.complete_once(
                messages=[LLMMessage(role="user", content=prompt)],
                system_prompt="你是严谨的小说编辑，擅长压缩分段剧情。",
            )
            chunk_summaries.append(f"【第{c_start}–{c_end}章】\n{chunk_sum.strip()}")
            state = {
                "completed_chunks": idx + 1,
                "total_chunks": len(chunks),
                "chunk_summaries": chunk_summaries,
            }
            with db.session() as conn:
                conn.execute(
                    "UPDATE volumes SET summary_progress = ? WHERE id = ?",
                    (json.dumps(state, ensure_ascii=False), volume_id),
                )

        merged_input = "\n\n".join(chunk_summaries)
        merge_prompt = (
            f"以下是小说分卷《{vol_title}》（第{vol_dict['start_chapter']}–{vol_dict['end_chapter']}章）"
            f"各分段剧情小结，请归并整理为一份结构化总卷纲（1.主线剧情 2.核心人物 3.重要势力/战力变化）：\n\n"
            f"{merged_input}"
        )
        final_summary = await adapter.complete_once(
            messages=[LLMMessage(role="user", content=merge_prompt)],
            system_prompt="你是严谨的小说编辑，擅长将分段大纲归并为清晰卷纲。",
        )
        with db.session() as conn:
            conn.execute(
                "UPDATE volumes SET summary_md = ?, summary_status = 'ready', summary_progress = '' WHERE id = ?",
                (final_summary.strip(), volume_id),
            )


def _build_chapters_digest(chapters: list[dict], budget_chars: int) -> str:
    if not chapters:
        return ""
    per_chapter_budget = max(60, min(600, budget_chars // len(chapters)))
    lines: list[str] = []
    used = 0
    for ch in chapters:
        content = str(ch["content"]).strip()
        if len(content) <= per_chapter_budget:
            snippet = content
        else:
            head = max(40, per_chapter_budget // 2)
            tail = max(20, per_chapter_budget - head)
            snippet = f"{content[:head]} ... {content[-tail:]}"
        entry = f"第{ch['chapter_num']}章 {ch['title']}：{snippet}"
        if used + len(entry) > budget_chars and lines:
            lines.append(f"第{ch['chapter_num']}章 {ch['title']}")
        else:
            lines.append(entry)
            used += len(entry)
    return "\n".join(lines)
