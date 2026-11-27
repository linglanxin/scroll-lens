from __future__ import annotations

import asyncio
import logging
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from app.config import Settings
from app.core.security import decrypt_api_key
from app.db.database import Database
from app.engines.document.indexer import (
    find_scanned_page_image,
    has_scanned_page_assets,
    rebuild_doc_fts,
)
from app.engines.document.parsers import PdfExtractor, PptxExtractor
from app.llm.factory import create_adapter

logger = logging.getLogger(__name__)


@dataclass
class OcrJobState:
    running: bool = False
    total_pages: int = 0
    completed_pages: int = 0
    failed_pages: int = 0
    current_page: int | None = None
    last_error: str = ""


class VisionOcrManager:
    """Manages asynchronous multimodal Vision OCR jobs for scanned PDF/PPTX pages."""

    def __init__(self) -> None:
        self._tasks: dict[int, asyncio.Task[None]] = {}
        self._states: dict[int, OcrJobState] = {}
        self._cancel_flags: set[int] = set()

    def is_running(self, doc_id: int) -> bool:
        task = self._tasks.get(doc_id)
        return task is not None and not task.done()

    def get_status(self, doc_id: int, scanned_root: Path) -> dict[str, Any]:
        st = self._states.get(doc_id) or OcrJobState()
        return {
            "running": self.is_running(doc_id),
            "total_pages": st.total_pages,
            "completed_pages": st.completed_pages,
            "failed_pages": st.failed_pages,
            "current_page": st.current_page,
            "last_error": st.last_error,
            "has_ocr_assets": has_scanned_page_assets(scanned_root, doc_id),
        }

    def cancel_doc(self, doc_id: int) -> bool:
        if self.is_running(doc_id):
            self._cancel_flags.add(doc_id)
            return True
        return False

    async def shutdown(self) -> None:
        for doc_id, task in list(self._tasks.items()):
            self._cancel_flags.add(doc_id)
            if not task.done():
                task.cancel()
        if self._tasks:
            await asyncio.gather(*self._tasks.values(), return_exceptions=True)
        self._tasks.clear()

    def start_ocr(
        self,
        db: Database,
        settings: Settings,
        scanned_root: Path,
        user_id: int,
        doc_id: int,
        provider_id: int | None = None,
        page_nums: list[int] | None = None,
    ) -> list[int]:
        if self.is_running(doc_id):
            raise RuntimeError("该文档的视觉 OCR 识图任务正在运行中")
        self._cancel_flags.discard(doc_id)

        with db.session() as conn:
            doc = conn.execute(
                "SELECT id, file_type FROM documents WHERE id = ? AND user_id = ?",
                (doc_id, user_id),
            ).fetchone()
            if doc is None:
                raise ValueError("Document not found")
            file_type = str(doc["file_type"])

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
                raise ValueError("请先在设置页配置支持视觉识图的大模型 API Key")
            provider_cfg = dict(prov)

            if page_nums:
                placeholders = ",".join("?" for _ in page_nums)
                rows = conn.execute(
                    f"SELECT page_num FROM doc_pages WHERE doc_id = ? AND page_num IN ({placeholders}) ORDER BY page_num ASC",
                    [doc_id, *page_nums],
                ).fetchall()
            else:
                rows = conn.execute(
                    "SELECT page_num FROM doc_pages WHERE doc_id = ? AND is_scanned_suspect = 1 ORDER BY page_num ASC",
                    (doc_id,),
                ).fetchall()

            target_pages = [
                int(r["page_num"])
                for r in rows
                if find_scanned_page_image(scanned_root, doc_id, int(r["page_num"])) is not None
            ]
            if not target_pages:
                raise ValueError(
                    "未找到可识别的扫描页图片缓存（如为旧版上传的文档，请重新上传后再启用视觉 OCR）"
                )

        self._states[doc_id] = OcrJobState(
            running=True,
            total_pages=len(target_pages),
            completed_pages=0,
            failed_pages=0,
            current_page=target_pages[0],
            last_error="",
        )
        task = asyncio.create_task(
            self._run_job(db, settings, scanned_root, doc_id, file_type, target_pages, provider_cfg)
        )
        self._tasks[doc_id] = task
        return target_pages

    async def _run_job(
        self,
        db: Database,
        settings: Settings,
        scanned_root: Path,
        doc_id: int,
        file_type: str,
        page_nums: list[int],
        provider_cfg: dict[str, Any],
    ) -> None:
        state = self._states[doc_id]
        api_key = decrypt_api_key(provider_cfg["api_key_enc"], settings.resolved_secret_key())
        adapter = create_adapter(
            protocol=provider_cfg["protocol"],
            base_url=provider_cfg["base_url"],
            api_key=api_key,
            model_name=provider_cfg["model_name"],
            timeout=120.0,
        )
        extractor = PptxExtractor() if file_type == "pptx" else PdfExtractor()
        updated_any = False

        try:
            for p_num in page_nums:
                if doc_id in self._cancel_flags:
                    break
                state.current_page = p_num
                asset = find_scanned_page_image(scanned_root, doc_id, p_num)
                if asset is None:
                    state.failed_pages += 1
                    continue
                img_bytes, mime_type = asset
                try:
                    ocr_text = await extractor.extract_with_vision(
                        img_bytes, adapter, mime_type=mime_type
                    )
                except asyncio.CancelledError:
                    raise
                except Exception as exc:
                    logger.warning("Vision OCR failed for doc=%s page=%s: %s", doc_id, p_num, exc)
                    state.failed_pages += 1
                    state.last_error = f"第 {p_num} 页识图失败：{str(exc)[:200]}"
                    continue

                cleaned = ocr_text.strip()
                non_ws = len(re.sub(r"\s+", "", cleaned))
                if cleaned:
                    with db.session() as conn:
                        existing = conn.execute(
                            "SELECT heading, content FROM doc_pages WHERE doc_id = ? AND page_num = ?",
                            (doc_id, p_num),
                        ).fetchone()
                        if existing is not None:
                            old_content = str(existing["content"] or "").strip()
                            merged = (
                                f"{old_content}\n\n[视觉 OCR]\n{cleaned}"
                                if old_content and "[视觉 OCR]" not in old_content
                                else cleaned
                            )
                            merged_cc = len(re.sub(r"\s+", "", merged))
                            old_heading = str(existing["heading"] or "")
                            new_heading = old_heading
                            if not old_heading or "[疑似扫描页]" in old_heading or "[疑似纯图页]" in old_heading:
                                first_ln = next(
                                    (ln.strip().lstrip("#").strip() for ln in cleaned.splitlines() if ln.strip()),
                                    "",
                                )
                                new_heading = (first_ln[:80] if first_ln else f"第 {p_num} 页 [OCR]")
                            still_scanned = 0 if non_ws >= 10 else 1
                            conn.execute(
                                "UPDATE doc_pages SET heading = ?, content = ?, char_count = ?, "
                                "text_density = ?, is_scanned_suspect = ? "
                                "WHERE doc_id = ? AND page_num = ?",
                                (
                                    new_heading,
                                    merged,
                                    merged_cc,
                                    round(merged_cc / 500.0, 4),
                                    still_scanned,
                                    doc_id,
                                    p_num,
                                ),
                            )
                            updated_any = True
                state.completed_pages += 1

            if updated_any:
                with db.session() as conn:
                    agg = conn.execute(
                        "SELECT COALESCE(SUM(char_count), 0) AS tc, "
                        "COALESCE(SUM(CASE WHEN is_scanned_suspect = 1 THEN 1 ELSE 0 END), 0) AS sc "
                        "FROM doc_pages WHERE doc_id = ?",
                        (doc_id,),
                    ).fetchone()
                    total_chars = int(agg["tc"])
                    scanned_cnt = int(agg["sc"])
                    conn.execute(
                        "UPDATE documents SET total_chars = ?, has_scanned_pages = ?, scanned_page_count = ? WHERE id = ?",
                        (total_chars, 1 if scanned_cnt > 0 else 0, scanned_cnt, doc_id),
                    )
                    rebuild_doc_fts(conn, db, doc_id)
        finally:
            state.running = False
            state.current_page = None
            self._cancel_flags.discard(doc_id)
            self._tasks.pop(doc_id, None)
