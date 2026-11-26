from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import Any


@dataclass
class PageData:
    page_num: int
    heading: str
    content: str
    char_count: int
    text_density: float
    is_scanned_suspect: bool = False


class BasePageExtractor(ABC):
    """Abstract document page extractor with a v1.1 vision OCR extension hook."""

    @abstractmethod
    def extract_pages(self, raw: bytes, filename: str) -> list[PageData]:
        """Extract plain text pages and compute text density / scanned-page flags."""

    async def extract_with_vision(self, page_image: bytes, provider: Any) -> str:
        """Reserved hook for v1.1 multimodal OCR on scanned PDF / image-only PPTX pages."""
        raise NotImplementedError("Vision OCR extraction is planned for v1.1")
