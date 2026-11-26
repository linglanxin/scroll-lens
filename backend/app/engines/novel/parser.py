from __future__ import annotations

import hashlib
import os
import re
import tempfile
import warnings
from dataclasses import dataclass, field

from charset_normalizer import from_bytes

# Regexes for Chinese and English novel volume/chapter headings
VOLUME_PATTERNS = [
    re.compile(r"^第[零一二三四五六七八九十百千万两0-9]{1,7}[卷部篇册集](?:[\s　:：\-—]+.*)?$"),
    re.compile(r"^卷[零一二三四五六七八九十百千万0-9]{1,5}(?:[\s　:：\-—]+.*)?$"),
    re.compile(r"^【[^】\n]{1,30}[卷部篇]】.*$"),
]

CHAPTER_PATTERNS = [
    re.compile(r"^第[零一二三四五六七八九十百千万两0-9]{1,7}[章节回集话](?:[\s　:：\-—]+.*)?$"),
    re.compile(r"^(?:序章|楔子|引子|前言|后记|尾声|终章|番外[零一二三四五六七八九十0-9]*)(?:[\s　:：\-—]+.*)?$"),
    re.compile(r"^Chapter\s+\d+(?:[\s:\-—]+.*)?$", re.IGNORECASE),
]

WATERMARK_RE = re.compile(
    r"(?:https?://\S+|www\.\S+|"
    r"请记住本书首发域名.*|手机版阅读网址.*|"
    r"天才一秒记住本站地址.*|笔趣阁.*最快更新.*|"
    r"本章未完，请点击下一页继续阅读.*|投推荐票.*|"
    r"\(本章完\))",
    re.IGNORECASE,
)

CONTROL_CHARS_RE = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]")


@dataclass
class ParsedChapter:
    chapter_num: int
    title: str
    content: str
    char_count: int
    fingerprint: str


@dataclass
class ParsedVolume:
    volume_num: int
    title: str
    chapters: list[ParsedChapter] = field(default_factory=list)


@dataclass
class ParsedBook:
    title: str
    author: str = ""
    volumes: list[ParsedVolume] = field(default_factory=list)


def decode_text_bytes(raw: bytes) -> str:
    for enc in ("utf-8-sig", "utf-8", "gb18030", "gbk"):
        try:
            return raw.decode(enc)
        except UnicodeDecodeError:
            continue
    match = from_bytes(raw).best()
    if match is not None:
        return str(match)
    return raw.decode("utf-8", errors="replace")


def clean_novel_text(text: str) -> str:
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    text = CONTROL_CHARS_RE.sub("", text)
    text = WATERMARK_RE.sub("", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def chapter_fingerprint(title: str, content: str) -> str:
    norm_title = re.sub(r"\s+", "", title)
    norm_body = re.sub(r"\s+", "", content)
    sample = f"{norm_title}|{norm_body[:120]}|{norm_body[-120:]}|{len(norm_body)}"
    return hashlib.sha256(sample.encode("utf-8")).hexdigest()[:24]


def _is_volume_heading(line: str) -> bool:
    if len(line) > 55:
        return False
    return any(p.match(line) for p in VOLUME_PATTERNS)


def _is_chapter_heading(line: str) -> bool:
    if len(line) > 65:
        return False
    return any(p.match(line) for p in CHAPTER_PATTERNS)


def parse_txt_novel(raw: bytes, fallback_title: str) -> ParsedBook:
    text = clean_novel_text(decode_text_bytes(raw))
    lines = text.split("\n")
    del text

    raw_volumes: list[tuple[str, list[tuple[str, list[str]]]]] = []
    current_vol_title: str | None = None
    current_vol_chapters: list[tuple[str, list[str]]] = []
    current_ch_title: str | None = None
    current_ch_lines: list[str] = []
    preamble_lines: list[str] = []

    def flush_chapter() -> None:
        nonlocal current_ch_title, current_ch_lines
        if current_ch_title is not None:
            body = "\n".join(current_ch_lines).strip()
            # Filter out TOC listing entries (heading immediately followed by next heading with < 5 chars)
            if len(re.sub(r"\s+", "", body)) >= 5:
                current_vol_chapters.append((current_ch_title, [body]))
            current_ch_title = None
            current_ch_lines = []

    def flush_volume() -> None:
        nonlocal current_vol_title, current_vol_chapters
        flush_chapter()
        if current_vol_chapters:
            vol_name = current_vol_title or "第一卷 正文"
            raw_volumes.append((vol_name, current_vol_chapters))
        current_vol_title = None
        current_vol_chapters = []

    for line in lines:
        stripped = line.strip()
        if not stripped:
            if current_ch_title is not None:
                current_ch_lines.append("")
            continue

        if _is_volume_heading(stripped):
            flush_volume()
            current_vol_title = stripped
            continue

        if _is_chapter_heading(stripped):
            flush_chapter()
            current_ch_title = stripped
            continue

        if current_ch_title is not None:
            current_ch_lines.append(line.rstrip())
        else:
            preamble_lines.append(line.rstrip())

    flush_volume()

    # Handle case where no chapter headings were found at all
    if not raw_volumes:
        body = "\n".join(preamble_lines).strip()
        del lines, preamble_lines
        if not body:
            body = "(空文件)"
        ch = ParsedChapter(
            chapter_num=1,
            title="正文",
            content=body,
            char_count=len(body),
            fingerprint=chapter_fingerprint("正文", body),
        )
        return ParsedBook(
            title=fallback_title,
            volumes=[ParsedVolume(volume_num=1, title="第一卷 正文", chapters=[ch])],
        )

    del lines, preamble_lines
    parsed_volumes: list[ParsedVolume] = []
    global_ch_num = 0
    for vol_idx, (vol_title, ch_list) in enumerate(raw_volumes, start=1):
        parsed_chapters: list[ParsedChapter] = []
        for ch_title, ch_parts in ch_list:
            global_ch_num += 1
            body = ch_parts[0] if len(ch_parts) == 1 else "\n".join(ch_parts)
            parsed_chapters.append(
                ParsedChapter(
                    chapter_num=global_ch_num,
                    title=ch_title,
                    content=body,
                    char_count=len(body),
                    fingerprint=chapter_fingerprint(ch_title, body),
                )
            )
        parsed_volumes.append(
            ParsedVolume(volume_num=vol_idx, title=vol_title, chapters=parsed_chapters)
        )

    return ParsedBook(title=fallback_title, volumes=parsed_volumes)


def _extract_html_text(html_bytes: bytes) -> str:
    from bs4 import BeautifulSoup

    soup = BeautifulSoup(html_bytes, "lxml")
    for tag in soup(["script", "style"]):
        tag.decompose()
    text = soup.get_text("\n")
    return clean_novel_text(text)


def _extract_fragment_texts(
    html_bytes: bytes, fragments: list[str]
) -> dict[str, str]:
    """Split a single HTML document into sections keyed by fragment id when multiple TOC entries share a file."""
    from bs4 import BeautifulSoup

    soup = BeautifulSoup(html_bytes, "lxml")
    for tag in soup(["script", "style"]):
        tag.decompose()
    body = soup.body or soup
    elements = body.find_all(["h1", "h2", "h3", "h4", "p", "div", "section"], recursive=True)
    # Build ordered text chunks anchored by element id
    anchors = {frag for frag in fragments if frag}
    if not anchors:
        return {"": clean_novel_text(body.get_text("\n"))}

    # Simple linear scan over top-level block elements or elements with matching ids
    result: dict[str, list[str]] = {frag: [] for frag in anchors}
    result[""] = []
    current_frag = ""

    for node in body.descendants:
        node_id = getattr(node, "attrs", {}).get("id") if hasattr(node, "attrs") else None
        if node_id and node_id in anchors:
            current_frag = node_id
        if isinstance(node, str):
            txt = node.strip()
            if txt and getattr(node.parent, "name", "") not in ("script", "style"):
                result[current_frag].append(txt)

    return {k: clean_novel_text("\n".join(v)) for k, v in result.items()}


def parse_epub_novel(raw: bytes, fallback_title: str) -> ParsedBook:
    from ebooklib import ITEM_DOCUMENT, epub

    tmp_path: str | None = None
    try:
        with tempfile.NamedTemporaryFile(suffix=".epub", delete=False) as tf:
            tf.write(raw)
            tmp_path = tf.name

        with warnings.catch_warnings():
            warnings.simplefilter("ignore")
            book = epub.read_epub(tmp_path)

        titles = book.get_metadata("DC", "title")
        book_title = titles[0][0].strip() if titles and titles[0][0] else fallback_title
        creators = book.get_metadata("DC", "creator")
        author = creators[0][0].strip() if creators and creators[0][0] else ""

        # Build href -> bytes lookup (normalized without leading ./)
        doc_items: dict[str, bytes] = {}
        spine_docs: list[tuple[str, bytes]] = []
        items_by_id = {item.get_id(): item for item in book.get_items()}

        for item in book.get_items_of_type(ITEM_DOCUMENT):
            name = item.get_name().lstrip("./")
            content = item.get_content()
            doc_items[name] = content
            doc_items[os.path.basename(name)] = content

        for sp_id, _ in book.spine:
            item = items_by_id.get(sp_id)
            if item is not None and item.get_type() == ITEM_DOCUMENT:
                spine_docs.append((item.get_name().lstrip("./"), item.get_content()))

        def resolve_doc(href: str) -> tuple[str, str]:
            base, _, frag = href.partition("#")
            base_clean = base.lstrip("./")
            return base_clean, frag

        def get_bytes(base: str) -> bytes | None:
            return doc_items.get(base) or doc_items.get(os.path.basename(base))

        # Inspect two-level TOC
        toc_entries = list(book.toc or [])
        nested_volumes: list[tuple[str, list[tuple[str, str]]]] = []
        flat_links: list[tuple[str, str]] = []

        for entry in toc_entries:
            if isinstance(entry, tuple) and len(entry) == 2:
                section, children = entry
                sec_title = getattr(section, "title", "") or "未命名分卷"
                sec_href = getattr(section, "href", "") or ""
                child_links: list[tuple[str, str]] = []
                for child in children:
                    if isinstance(child, tuple) and len(child) == 2:
                        c_sec, c_sub = child
                        if getattr(c_sec, "href", None):
                            child_links.append((getattr(c_sec, "title", "") or "章节", c_sec.href))
                        for sub in c_sub:
                            if getattr(sub, "href", None):
                                child_links.append((getattr(sub, "title", "") or "章节", sub.href))
                    elif getattr(child, "href", None):
                        child_links.append((getattr(child, "title", "") or "章节", child.href))
                if child_links:
                    nested_volumes.append((sec_title.strip(), child_links))
                elif sec_href:
                    flat_links.append((sec_title.strip(), sec_href))
            elif getattr(entry, "href", None):
                flat_links.append(((getattr(entry, "title", "") or "章节").strip(), entry.href))

        # Precompute fragment maps for shared HTML files
        all_links = [lnk for _, links in nested_volumes for lnk in links] + flat_links
        frags_by_file: dict[str, list[str]] = {}
        for _, href in all_links:
            base, frag = resolve_doc(href)
            if frag:
                frags_by_file.setdefault(base, []).append(frag)

        frag_cache: dict[str, dict[str, str]] = {}
        for base, frags in frags_by_file.items():
            raw_html = get_bytes(base)
            if raw_html and len(frags) > 1:
                frag_cache[base] = _extract_fragment_texts(raw_html, frags)

        def read_link_text(href: str) -> str:
            base, frag = resolve_doc(href)
            if base in frag_cache and frag in frag_cache[base]:
                return frag_cache[base][frag]
            raw_html = get_bytes(base)
            if raw_html is None:
                return ""
            return _extract_html_text(raw_html)

        if nested_volumes:
            parsed_vols: list[ParsedVolume] = []
            ch_counter = 0
            for v_idx, (v_title, links) in enumerate(nested_volumes, start=1):
                chs: list[ParsedChapter] = []
                for c_title, href in links:
                    body = read_link_text(href)
                    if not body or len(body) < 5:
                        continue
                    ch_counter += 1
                    chs.append(
                        ParsedChapter(
                            chapter_num=ch_counter,
                            title=c_title or f"第{ch_counter}章",
                            content=body,
                            char_count=len(body),
                            fingerprint=chapter_fingerprint(c_title, body),
                        )
                    )
                if chs:
                    parsed_vols.append(
                        ParsedVolume(volume_num=len(parsed_vols) + 1, title=v_title, chapters=chs)
                    )
            if parsed_vols:
                return ParsedBook(title=book_title, author=author, volumes=parsed_vols)

        if flat_links:
            chs = []
            ch_counter = 0
            for c_title, href in flat_links:
                body = read_link_text(href)
                if not body or len(body) < 5:
                    continue
                ch_counter += 1
                chs.append(
                    ParsedChapter(
                        chapter_num=ch_counter,
                        title=c_title or f"第{ch_counter}章",
                        content=body,
                        char_count=len(body),
                        fingerprint=chapter_fingerprint(c_title, body),
                    )
                )
            if chs:
                return ParsedBook(
                    title=book_title,
                    author=author,
                    volumes=[ParsedVolume(volume_num=1, title="第一卷 正文", chapters=chs)],
                )

        # Fallback to spine text parsed as TXT
        combined = "\n\n".join(_extract_html_text(content) for _, content in spine_docs)
        parsed = parse_txt_novel(combined.encode("utf-8"), book_title)
        parsed.author = author
        return parsed
    finally:
        if tmp_path and os.path.exists(tmp_path):
            os.unlink(tmp_path)
