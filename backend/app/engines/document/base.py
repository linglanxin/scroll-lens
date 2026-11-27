from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import Any

from app.llm.base import BaseLLMAdapter, ImageAttachment, LLMMessage

VISION_OCR_SYSTEM_PROMPT = (
    "你是高精度的文档视觉 OCR 识别助手。请忠实提取图片中的全部可见文字、"
    "标题、表格（用 Markdown 表格表示）、公式及关键图表标注。"
    "保持原语言与阅读顺序，不要添加主观解释、不要编造图中不存在的内容。"
)

VISION_OCR_USER_PROMPT = (
    "请识别并转录这一页文档图片中的所有文字与表格内容，直接输出整理后的纯文本/Markdown："
)


@dataclass
class PageData:
    page_num: int
    heading: str
    content: str
    char_count: int
    text_density: float
    is_scanned_suspect: bool = False
    scanned_image: bytes | None = None
    scanned_image_mime: str = "image/png"


class BasePageExtractor(ABC):
    """Abstract document page extractor with multimodal vision OCR support."""

    @abstractmethod
    def extract_pages(self, raw: bytes, filename: str) -> list[PageData]:
        """Extract plain text pages and compute text density / scanned-page flags."""

    async def extract_with_vision(
        self,
        page_image: bytes,
        provider: Any,
        mime_type: str = "image/png",
    ) -> str:
        """Use a multimodal LLM adapter to transcribe a scanned PDF page or image-only PPTX slide."""
        if not page_image:
            raise ValueError("Empty page image provided for vision OCR")
        if provider is None or not hasattr(provider, "complete_once"):
            raise ValueError(
                "A configured multimodal LLM adapter is required for vision OCR"
            )
        adapter: BaseLLMAdapter = provider
        result = await adapter.complete_once(
            messages=[
                LLMMessage(
                    role="user",
                    content=VISION_OCR_USER_PROMPT,
                    images=[ImageAttachment(data=page_image, mime_type=mime_type)],
                )
            ],
            system_prompt=VISION_OCR_SYSTEM_PROMPT,
            temperature=0.1,
        )
        return result.strip()
