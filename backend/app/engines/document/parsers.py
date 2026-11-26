from __future__ import annotations

import io
import re
from pathlib import Path

from app.engines.document.base import BasePageExtractor, PageData
from app.engines.novel.parser import decode_text_bytes

SUPPORTED_DOC_TYPES = {"pdf", "pptx", "docx", "md", "txt"}


def _non_ws_len(text: str) -> int:
    return len(re.sub(r"\s+", "", text))


def _first_heading(text: str, fallback: str) -> str:
    for line in text.splitlines():
        s = line.strip().lstrip("#").strip()
        if s:
            return s[:80]
    return fallback


class PdfExtractor(BasePageExtractor):
    def extract_pages(self, raw: bytes, filename: str) -> list[PageData]:
        import pymupdf

        pages: list[PageData] = []
        with pymupdf.open(stream=raw, filetype="pdf") as pdf:
            for idx, page in enumerate(pdf, start=1):
                text = (page.get_text("text") or "").strip()
                char_count = _non_ws_len(text)
                has_images = len(page.get_images(full=False)) > 0
                rect = page.rect
                area_units = max(1.0, (rect.width * rect.height) / 10000.0)
                density = round(char_count / area_units, 3)
                is_scanned = char_count < 20 and has_images
                heading = _first_heading(text, f"第 {idx} 页" + (" [疑似扫描页]" if is_scanned else ""))
                pages.append(
                    PageData(
                        page_num=idx,
                        heading=heading,
                        content=text,
                        char_count=char_count,
                        text_density=density,
                        is_scanned_suspect=is_scanned,
                    )
                )
        return pages


class PptxExtractor(BasePageExtractor):
    def extract_pages(self, raw: bytes, filename: str) -> list[PageData]:
        from pptx import Presentation
        from pptx.enum.shapes import MSO_SHAPE_TYPE

        prs = Presentation(io.BytesIO(raw))
        pages: list[PageData] = []
        for idx, slide in enumerate(prs.slides, start=1):
            parts: list[str] = []
            title_text = ""
            has_picture = False
            has_text_box_content = False

            if slide.shapes.title and slide.shapes.title.has_text_frame:
                title_text = slide.shapes.title.text_frame.text.strip()

            for shape in slide.shapes:
                if shape.shape_type == MSO_SHAPE_TYPE.PICTURE:
                    has_picture = True
                if shape.has_text_frame:
                    t = shape.text_frame.text.strip()
                    if t:
                        has_text_box_content = True
                        parts.append(t)
                if shape.has_table:
                    table_lines: list[str] = []
                    for row in shape.table.rows:
                        cells = [c.text.strip().replace("\n", " ") for c in row.cells]
                        if any(cells):
                            table_lines.append(" | ".join(cells))
                    if table_lines:
                        has_text_box_content = True
                        parts.append("\n".join(table_lines))

            if slide.has_notes_slide and slide.notes_slide.notes_text_frame:
                notes = slide.notes_slide.notes_text_frame.text.strip()
                if notes:
                    parts.append(f"[备注] {notes}")

            content = "\n".join(parts).strip()
            char_count = _non_ws_len(content)
            is_scanned = (not has_text_box_content and has_picture) or (char_count < 20 and has_picture)
            density = round(char_count / 500.0, 4)
            heading = title_text[:80] if title_text else _first_heading(
                content, f"幻灯片 {idx}" + (" [疑似纯图页]" if is_scanned else "")
            )
            pages.append(
                PageData(
                    page_num=idx,
                    heading=heading,
                    content=content,
                    char_count=char_count,
                    text_density=density,
                    is_scanned_suspect=is_scanned,
                )
            )
        return pages


class DocxExtractor(BasePageExtractor):
    def extract_pages(self, raw: bytes, filename: str) -> list[PageData]:
        from docx import Document as DocxDocument
        from docx.oxml.table import CT_Tbl
        from docx.oxml.text.paragraph import CT_P
        from docx.table import Table
        from docx.text.paragraph import Paragraph

        doc = DocxDocument(io.BytesIO(raw))
        blocks: list[tuple[str, bool, bool]] = []  # (text, is_heading, has_page_break)

        for child in doc.element.body.iterchildren():
            if isinstance(child, CT_P):
                para = Paragraph(child, doc)
                has_break = bool(
                    child.xpath(".//w:br[@w:type='page']")
                    or child.xpath(".//w:sectPr")
                )
                txt = para.text.strip()
                style_name = (para.style.name or "").lower() if para.style else ""
                is_heading = style_name.startswith("heading") or style_name.startswith("标题")
                if txt or has_break:
                    blocks.append((txt, is_heading, has_break))
            elif isinstance(child, CT_Tbl):
                tbl = Table(child, doc)
                rows_txt: list[str] = []
                for row in tbl.rows:
                    cells = [c.text.strip().replace("\n", " ") for c in row.cells]
                    if any(cells):
                        rows_txt.append(" | ".join(cells))
                if rows_txt:
                    blocks.append(("\n".join(rows_txt), False, False))

        pages: list[PageData] = []
        buf: list[str] = []
        buf_chars = 0
        current_heading = ""

        def flush() -> None:
            nonlocal buf, buf_chars, current_heading
            content = "\n".join(x for x in buf if x).strip()
            if not content:
                buf = []
                buf_chars = 0
                current_heading = ""
                return
            cc = _non_ws_len(content)
            p_num = len(pages) + 1
            heading = current_heading or _first_heading(content, f"第 {p_num} 节")
            pages.append(
                PageData(
                    page_num=p_num,
                    heading=heading[:80],
                    content=content,
                    char_count=cc,
                    text_density=round(cc / 1000.0, 4),
                    is_scanned_suspect=False,
                )
            )
            buf = []
            buf_chars = 0
            current_heading = ""

        for txt, is_heading, has_break in blocks:
            if is_heading and buf_chars >= 600:
                flush()
            if is_heading and not current_heading:
                current_heading = txt
            if txt:
                buf.append(txt)
                buf_chars += len(txt)
            if has_break or buf_chars >= 2500:
                flush()

        flush()
        if not pages:
            pages.append(PageData(page_num=1, heading="空白文档", content="", char_count=0, text_density=0.0))
        return pages


class TextMarkdownExtractor(BasePageExtractor):
    def extract_pages(self, raw: bytes, filename: str) -> list[PageData]:
        text = decode_text_bytes(raw).replace("\r\n", "\n").replace("\r", "\n").strip()
        if not text:
            return [PageData(page_num=1, heading="空白文档", content="", char_count=0, text_density=0.0)]

        ext = Path(filename).suffix.lower()
        chunks: list[tuple[str, str]] = []

        if ext == ".md":
            cur_heading = ""
            cur_lines: list[str] = []
            cur_len = 0
            for line in text.split("\n"):
                is_h = bool(re.match(r"^#{1,2}\s+\S+", line))
                if is_h and cur_lines and cur_len >= 400:
                    body = "\n".join(cur_lines).strip()
                    chunks.append((cur_heading or _first_heading(body, "片段"), body))
                    cur_lines = []
                    cur_len = 0
                    cur_heading = line.lstrip("#").strip()[:80]
                elif is_h and not cur_heading:
                    cur_heading = line.lstrip("#").strip()[:80]
                cur_lines.append(line)
                cur_len += len(line)
                if cur_len >= 3200:
                    body = "\n".join(cur_lines).strip()
                    chunks.append((cur_heading or _first_heading(body, "片段"), body))
                    cur_lines = []
                    cur_len = 0
                    cur_heading = ""
            if cur_lines:
                body = "\n".join(cur_lines).strip()
                chunks.append((cur_heading or _first_heading(body, "片段"), body))
        else:
            cur_lines = []
            cur_len = 0
            for para in re.split(r"\n\s*\n", text):
                para_s = para.strip()
                if not para_s:
                    continue
                if cur_len + len(para_s) > 3000 and cur_lines:
                    body = "\n\n".join(cur_lines).strip()
                    chunks.append((_first_heading(body, f"第 {len(chunks)+1} 段"), body))
                    cur_lines = []
                    cur_len = 0
                cur_lines.append(para_s)
                cur_len += len(para_s)
            if cur_lines:
                body = "\n\n".join(cur_lines).strip()
                chunks.append((_first_heading(body, f"第 {len(chunks)+1} 段"), body))

        pages: list[PageData] = []
        for idx, (heading, body) in enumerate(chunks, start=1):
            cc = _non_ws_len(body)
            pages.append(
                PageData(
                    page_num=idx,
                    heading=heading[:80],
                    content=body,
                    char_count=cc,
                    text_density=round(cc / 1000.0, 4),
                    is_scanned_suspect=False,
                )
            )
        return pages


def extract_document(raw: bytes, filename: str) -> tuple[str, list[PageData]]:
    ext = Path(filename).suffix.lower().lstrip(".")
    if ext not in SUPPORTED_DOC_TYPES:
        raise ValueError(f"Unsupported document type: .{ext or '(none)'}")

    extractor_map: dict[str, BasePageExtractor] = {
        "pdf": PdfExtractor(),
        "pptx": PptxExtractor(),
        "docx": DocxExtractor(),
        "md": TextMarkdownExtractor(),
        "txt": TextMarkdownExtractor(),
    }
    pages = extractor_map[ext].extract_pages(raw, filename)
    return ext, pages
