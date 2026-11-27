from __future__ import annotations

import contextlib
import hashlib
import io
import os
import re
import tempfile
import warnings
import zipfile
from dataclasses import dataclass, field
from pathlib import Path

from charset_normalizer import from_bytes

SUPPORTED_NOVEL_EXTENSIONS: tuple[str, ...] = (
    ".txt",
    ".epub",
    ".mobi",
    ".azw3",
    ".azw",
    ".fb2",
    ".pdf",
    ".docx",
    ".md",
    ".markdown",
    ".html",
    ".htm",
    ".zip",
)

# Regexes for Chinese and English novel volume/chapter headings
VOLUME_PATTERNS = [
    re.compile(r"^第[零一二三四五六七八九十百千万两0-9]{1,7}[卷部篇册集](?:[\s　:：\-—]+.*)?$"),
    re.compile(r"^卷[零一二三四五六七八九十百千万0-9]{1,5}(?:[\s　:：\-—]+.*)?$"),
    re.compile(r"^【[^】\n]{1,30}[卷部篇]】.*$"),
    re.compile(r"^(?:Volume|Vol\.?|Book|Part)\s+[0-9IVXLCDM]+(?:[\s:\-—]+.*)?$", re.IGNORECASE),
]

CHAPTER_PATTERNS = [
    re.compile(r"^第[零一二三四五六七八九十百千万两0-9]{1,7}[章节回集话](?:[\s　:：\-—]+.*)?$"),
    re.compile(r"^(?:序章|楔子|引子|前言|后记|尾声|终章|番外[零一二三四五六七八九十0-9]*)(?:[\s　:：\-—]+.*)?$"),
    re.compile(r"^Chapter\s+\d+(?:[\s:\-—]+.*)?$", re.IGNORECASE),
    re.compile(r"^(?:Prologue|Epilogue|Interlude)(?:[\s:\-—]+.*)?$", re.IGNORECASE),
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
    cover_bytes: bytes | None = None
    cover_ext: str = ""


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


def _normalize_image_ext(media_type: str = "", filename: str = "") -> str:
    mt = (media_type or "").lower()
    fn = (filename or "").lower()
    if "png" in mt or fn.endswith(".png"):
        return ".png"
    if "webp" in mt or fn.endswith(".webp"):
        return ".webp"
    if "jpeg" in mt or "jpg" in mt or fn.endswith((".jpg", ".jpeg")):
        return ".jpg"
    return ".jpg"


def _extract_epub_cover(book, items_by_id: dict) -> tuple[bytes | None, str]:
    from ebooklib import ITEM_COVER, ITEM_IMAGE

    candidates = []
    # 1. Explicit EPUB3 cover item
    for item in book.get_items_of_type(ITEM_COVER):
        candidates.append(item)
    # 2. EPUB2 OPF <meta name="cover" content="id"/>
    try:
        for _, attrs in book.get_metadata("OPF", "cover") or []:
            cid = (attrs or {}).get("content")
            if cid and cid in items_by_id:
                candidates.append(items_by_id[cid])
    except Exception:
        pass
    # 3. Fallback: image item whose id or filename contains "cover"
    for item in book.get_items_of_type(ITEM_IMAGE):
        ident = f"{item.get_id() or ''} {item.get_name() or ''}".lower()
        if "cover" in ident:
            candidates.append(item)

    for item in candidates:
        try:
            data = item.get_content()
            if data and 256 <= len(data) <= 5 * 1024 * 1024:
                ext = _normalize_image_ext(
                    getattr(item, "media_type", "") or "",
                    item.get_name() or "",
                )
                return data, ext
        except Exception:
            continue
    return None, ""


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
        cover_bytes, cover_ext = _extract_epub_cover(book, items_by_id)

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
                return ParsedBook(
                    title=book_title,
                    author=author,
                    volumes=parsed_vols,
                    cover_bytes=cover_bytes,
                    cover_ext=cover_ext,
                )

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
                    cover_bytes=cover_bytes,
                    cover_ext=cover_ext,
                )

        # Fallback to spine text parsed as TXT
        combined = "\n\n".join(_extract_html_text(content) for _, content in spine_docs)
        parsed = parse_txt_novel(combined.encode("utf-8"), book_title)
        parsed.author = author
        parsed.cover_bytes = cover_bytes
        parsed.cover_ext = cover_ext
        return parsed
    finally:
        if tmp_path and os.path.exists(tmp_path):
            os.unlink(tmp_path)


def _build_parsed_book(
    title: str,
    author: str,
    raw_volumes: list[tuple[str, list[tuple[str, str]]]],
) -> ParsedBook:
    parsed_volumes: list[ParsedVolume] = []
    global_ch_num = 0
    for vol_title, ch_list in raw_volumes:
        parsed_chapters: list[ParsedChapter] = []
        for ch_title, body in ch_list:
            cleaned = clean_novel_text(body)
            if len(re.sub(r"\s+", "", cleaned)) < 5:
                continue
            global_ch_num += 1
            final_ch_title = (ch_title or "").strip() or f"第{global_ch_num}章"
            parsed_chapters.append(
                ParsedChapter(
                    chapter_num=global_ch_num,
                    title=final_ch_title,
                    content=cleaned,
                    char_count=len(cleaned),
                    fingerprint=chapter_fingerprint(final_ch_title, cleaned),
                )
            )
        if parsed_chapters:
            parsed_volumes.append(
                ParsedVolume(
                    volume_num=len(parsed_volumes) + 1,
                    title=(vol_title or "").strip() or "第一卷 正文",
                    chapters=parsed_chapters,
                )
            )
    return ParsedBook(title=title, author=author, volumes=parsed_volumes)


def _is_unsplit_fallback(parsed: ParsedBook) -> bool:
    return (
        len(parsed.volumes) == 1
        and len(parsed.volumes[0].chapters) == 1
        and parsed.volumes[0].chapters[0].title == "正文"
    )


def _extract_opf_metadata(opf_bytes: bytes) -> tuple[str, str]:
    from bs4 import BeautifulSoup

    try:
        soup = BeautifulSoup(opf_bytes, "xml")
        title_tag = soup.find("title")
        creator_tag = soup.find("creator")
        title = title_tag.get_text(" ", strip=True) if title_tag else ""
        author = creator_tag.get_text(" ", strip=True) if creator_tag else ""
        return title, author
    except Exception:
        return "", ""


def parse_mobi_novel(raw: bytes, fallback_title: str, ext: str = ".mobi") -> ParsedBook:
    from mobi.kindleunpack import unpackBook

    safe_ext = ext if ext in (".mobi", ".azw3", ".azw", ".kf8", ".prc") else ".mobi"
    with tempfile.TemporaryDirectory(prefix="sl_mobi_") as tempdir:
        infile = os.path.join(tempdir, f"book{safe_ext}")
        with open(infile, "wb") as f:
            f.write(raw)

        try:
            with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
                unpackBook(infile, tempdir, epubver="A")
        except Exception as exc:
            msg = str(exc).lower()
            if "drm" in msg or "encrypt" in msg:
                raise ValueError(
                    "该电子书受 DRM 加密保护，暂不支持直接导入，请先转换为无加密版本。"
                ) from exc
            raise ValueError(
                f"无法解析该 {safe_ext.upper().lstrip('.')} 文件，请确认文件完整且未加密。"
            ) from exc

        epub_path = os.path.join(tempdir, "mobi8", "book.epub")
        if os.path.isfile(epub_path):
            return parse_epub_novel(Path(epub_path).read_bytes(), fallback_title)

        mobi8_dir = os.path.join(tempdir, "mobi8")
        if os.path.isdir(mobi8_dir):
            for fname in os.listdir(mobi8_dir):
                if fname.lower().endswith(".epub"):
                    return parse_epub_novel(
                        Path(os.path.join(mobi8_dir, fname)).read_bytes(), fallback_title
                    )

        html_path = os.path.join(tempdir, "mobi7", "book.html")
        if os.path.isfile(html_path):
            opf_title, opf_author = "", ""
            opf_path = os.path.join(tempdir, "mobi7", "content.opf")
            if os.path.isfile(opf_path):
                opf_title, opf_author = _extract_opf_metadata(Path(opf_path).read_bytes())
            parsed = parse_html_novel(
                Path(html_path).read_bytes(), opf_title or fallback_title
            )
            if opf_title and parsed.title in ("", "book", fallback_title):
                parsed.title = opf_title
            if opf_author and not parsed.author:
                parsed.author = opf_author
            return parsed

        for fname in os.listdir(tempdir):
            if fname.lower().endswith(".pdf"):
                return parse_pdf_novel(
                    Path(os.path.join(tempdir, fname)).read_bytes(), fallback_title
                )

        raise ValueError(f"未能从 {safe_ext.upper().lstrip('.')} 文件中提取到可读正文内容。")


def parse_fb2_novel(raw: bytes, fallback_title: str) -> ParsedBook:
    from bs4 import BeautifulSoup

    soup = BeautifulSoup(raw, "xml")
    title = fallback_title
    author = ""

    title_info = soup.find("title-info")
    if title_info is not None:
        bt = title_info.find("book-title")
        if bt and bt.get_text(" ", strip=True):
            title = bt.get_text(" ", strip=True)
        auth_tag = title_info.find("author")
        if auth_tag is not None:
            parts = [
                auth_tag.find(tag).get_text(" ", strip=True)
                for tag in ("first-name", "middle-name", "last-name")
                if auth_tag.find(tag) and auth_tag.find(tag).get_text(" ", strip=True)
            ]
            if not parts:
                nick = auth_tag.find("nickname")
                if nick and nick.get_text(" ", strip=True):
                    parts = [nick.get_text(" ", strip=True)]
            author = " ".join(parts).strip()

    bodies = soup.find_all("body")
    main_body = None
    for b in bodies:
        if (b.get("name") or "").lower() != "notes":
            main_body = b
            break
    if main_body is None and bodies:
        main_body = bodies[0]

    def section_title(sec) -> str:
        t = sec.find("title", recursive=False)
        if t is None:
            return ""
        return " ".join(t.get_text(" ", strip=True).split())

    def section_own_text(sec) -> str:
        lines: list[str] = []
        for child in sec.children:
            name = getattr(child, "name", None)
            if name in (None, "title", "section", "image"):
                continue
            txt = child.get_text("\n", strip=True)
            if txt:
                lines.append(txt)
        return clean_novel_text("\n\n".join(lines))

    if main_body is not None:
        top_sections = main_body.find_all("section", recursive=False)
        if top_sections:
            has_nested = any(s.find("section", recursive=False) is not None for s in top_sections)
            if has_nested:
                raw_vols: list[tuple[str, list[tuple[str, str]]]] = []
                for idx, sec in enumerate(top_sections, start=1):
                    v_title = section_title(sec) or f"第{idx}卷"
                    sub_secs = sec.find_all("section", recursive=False)
                    chs: list[tuple[str, str]] = []
                    if sub_secs:
                        for c_idx, sub in enumerate(sub_secs, start=1):
                            c_title = section_title(sub) or f"第{c_idx}章"
                            body_txt = clean_novel_text(
                                "\n\n".join(
                                    p.get_text(" ", strip=True)
                                    for p in sub.find_all(["p", "v", "subtitle"])
                                    if p.find_parent("title") is None
                                    and p.get_text(" ", strip=True)
                                )
                            )
                            if body_txt:
                                chs.append((c_title, body_txt))
                    else:
                        own = section_own_text(sec)
                        if own:
                            chs.append((v_title, own))
                    if chs:
                        raw_vols.append((v_title, chs))
                built = _build_parsed_book(title, author, raw_vols)
                if built.volumes:
                    return built
            else:
                raw_vols = []
                cur_vol_title = "第一卷 正文"
                cur_chs: list[tuple[str, str]] = []
                for idx, sec in enumerate(top_sections, start=1):
                    s_title = section_title(sec)
                    body_txt = section_own_text(sec)
                    if s_title and _is_volume_heading(s_title) and not body_txt:
                        if cur_chs:
                            raw_vols.append((cur_vol_title, cur_chs))
                            cur_chs = []
                        cur_vol_title = s_title
                        continue
                    if body_txt:
                        cur_chs.append((s_title or f"第{idx}章", body_txt))
                if cur_chs:
                    raw_vols.append((cur_vol_title, cur_chs))
                built = _build_parsed_book(title, author, raw_vols)
                if built.volumes:
                    return built

    plain = clean_novel_text(main_body.get_text("\n") if main_body is not None else soup.get_text("\n"))
    parsed = parse_txt_novel(plain.encode("utf-8"), title)
    parsed.author = author
    return parsed


def parse_pdf_novel(raw: bytes, fallback_title: str) -> ParsedBook:
    import pymupdf

    try:
        pdf = pymupdf.open(stream=raw, filetype="pdf")
    except Exception as exc:
        raise ValueError("无法打开该 PDF 文件，请确认文件完整且未加密。") from exc

    with pdf:
        meta = pdf.metadata or {}
        pdf_title = (meta.get("title") or "").strip()
        pdf_author = (meta.get("author") or "").strip()
        book_title = pdf_title if pdf_title and len(pdf_title) <= 120 else fallback_title

        page_texts: list[str] = []
        total_non_ws = 0
        for page in pdf:
            txt = (page.get_text("text") or "").strip()
            page_texts.append(txt)
            total_non_ws += len(re.sub(r"\s+", "", txt))

        if total_non_ws == 0:
            raise ValueError(
                "该 PDF 未检测到可提取的纯文本内容（可能为纯扫描图片版），暂不支持作为小说导入。"
            )

        cover_bytes: bytes | None = None
        cover_ext = ""
        try:
            if len(pdf) > 0:
                pix = pdf[0].get_pixmap(matrix=pymupdf.Matrix(0.75, 0.75), alpha=False)
                cover_bytes = pix.tobytes("jpeg")
                cover_ext = ".jpg"
        except Exception:
            cover_bytes = None
            cover_ext = ""

        num_pages = len(page_texts)
        toc_raw = pdf.get_toc(simple=True) or []
        valid_toc = [
            (int(lvl), (t or "").strip(), int(p))
            for lvl, t, p in toc_raw
            if (t or "").strip() and 1 <= int(p) <= num_pages
        ]

        distinct_pages = {p for _, _, p in valid_toc}
        if len(valid_toc) >= 2 and len(distinct_pages) >= 2 and len(distinct_pages) >= len(valid_toc) * 0.5:
            min_level = min(lvl for lvl, _, _ in valid_toc)
            has_second_level = any(lvl == min_level + 1 for lvl, _, _ in valid_toc)
            raw_vols: list[tuple[str, list[tuple[str, str]]]] = []

            if has_second_level:
                # Two-level outline: min_level -> volume, min_level + 1 -> chapter
                vol_blocks: list[tuple[str, list[tuple[str, int]]]] = []
                cur_v_title = "第一卷 正文"
                cur_entries: list[tuple[str, int]] = []
                for lvl, t, p in valid_toc:
                    if lvl == min_level:
                        if cur_entries:
                            vol_blocks.append((cur_v_title, cur_entries))
                            cur_entries = []
                        cur_v_title = t
                    elif lvl == min_level + 1:
                        cur_entries.append((t, p))
                if cur_entries:
                    vol_blocks.append((cur_v_title, cur_entries))

                flat_pages = [p for _, entries in vol_blocks for _, p in entries]
                flat_idx = 0
                for v_title, entries in vol_blocks:
                    chs: list[tuple[str, str]] = []
                    for c_title, start_p in entries:
                        end_p = (
                            flat_pages[flat_idx + 1] - 1
                            if flat_idx + 1 < len(flat_pages)
                            else num_pages
                        )
                        if end_p < start_p:
                            end_p = start_p
                        body = "\n\n".join(page_texts[start_p - 1 : end_p])
                        chs.append((c_title, body))
                        flat_idx += 1
                    if chs:
                        raw_vols.append((v_title, chs))
            else:
                # Flat outline: treat entries as chapters, grouping volumes if heading matches
                cur_v_title = "第一卷 正文"
                cur_chs: list[tuple[str, str]] = []
                for idx, (_, t, start_p) in enumerate(valid_toc):
                    end_p = valid_toc[idx + 1][2] - 1 if idx + 1 < len(valid_toc) else num_pages
                    if end_p < start_p:
                        end_p = start_p
                    body = "\n\n".join(page_texts[start_p - 1 : end_p])
                    if _is_volume_heading(t) and len(re.sub(r"\s+", "", body)) < 80:
                        if cur_chs:
                            raw_vols.append((cur_v_title, cur_chs))
                            cur_chs = []
                        cur_v_title = t
                        continue
                    cur_chs.append((t, body))
                if cur_chs:
                    raw_vols.append((cur_v_title, cur_chs))

            built = _build_parsed_book(book_title, pdf_author, raw_vols)
            if built.volumes:
                built.cover_bytes = cover_bytes
                built.cover_ext = cover_ext
                return built

        combined = "\n".join(page_texts)
        parsed = parse_txt_novel(combined.encode("utf-8"), book_title)
        parsed.author = pdf_author
        parsed.cover_bytes = cover_bytes
        parsed.cover_ext = cover_ext
        return parsed


def parse_docx_novel(raw: bytes, fallback_title: str) -> ParsedBook:
    from docx import Document as DocxDocument

    try:
        doc = DocxDocument(io.BytesIO(raw))
    except Exception as exc:
        raise ValueError("无法解析该 DOCX 文件，请确认文件完整且未加密。") from exc

    doc_title = (doc.core_properties.title or "").strip()
    doc_author = (doc.core_properties.author or "").strip()
    book_title = doc_title if doc_title and len(doc_title) <= 120 else fallback_title

    paragraphs: list[tuple[str, int]] = []
    for para in doc.paragraphs:
        txt = para.text.strip()
        if not txt:
            continue
        style_name = (para.style.name or "").lower() if para.style else ""
        level = 0
        if style_name in ("heading 1", "标题 1", "title"):
            level = 1
        elif style_name in ("heading 2", "标题 2"):
            level = 2
        elif style_name.startswith("heading ") or style_name.startswith("标题"):
            level = 2
        paragraphs.append((txt, level))

    if not paragraphs:
        raise ValueError("该 DOCX 文件未包含可读正文内容。")

    has_h1 = any(lvl == 1 for _, lvl in paragraphs)
    has_h2 = any(lvl == 2 for _, lvl in paragraphs)

    # 1. Explicit 2-level Word headings: Heading 1 = volume, Heading 2 = chapter
    if has_h1 and has_h2:
        raw_vols: list[tuple[str, list[tuple[str, str]]]] = []
        cur_v_title = "第一卷 正文"
        cur_chs: list[tuple[str, str]] = []
        cur_c_title: str | None = None
        cur_lines: list[str] = []

        def flush_c() -> None:
            nonlocal cur_c_title, cur_lines
            if cur_c_title is not None:
                cur_chs.append((cur_c_title, "\n".join(cur_lines)))
                cur_c_title = None
                cur_lines = []

        for txt, lvl in paragraphs:
            if lvl == 1:
                flush_c()
                if cur_chs:
                    raw_vols.append((cur_v_title, cur_chs))
                    cur_chs = []
                cur_v_title = txt
            elif lvl == 2:
                flush_c()
                cur_c_title = txt
            else:
                if cur_c_title is not None:
                    cur_lines.append(txt)
        flush_c()
        if cur_chs:
            raw_vols.append((cur_v_title, cur_chs))

        built = _build_parsed_book(book_title, doc_author, raw_vols)
        if sum(len(v.chapters) for v in built.volumes) >= 2:
            return built

    # 2. Try standard Chinese/English volume & chapter regex parsing on plain text
    plain_text = "\n".join(txt for txt, _ in paragraphs)
    txt_parsed = parse_txt_novel(plain_text.encode("utf-8"), book_title)
    txt_parsed.author = doc_author
    if not _is_unsplit_fallback(txt_parsed):
        return txt_parsed

    # 3. Fallback: single-level Word headings as chapter boundaries
    if has_h1 or has_h2:
        raw_vols = []
        cur_v_title = "第一卷 正文"
        cur_chs = []
        cur_c_title = None
        cur_lines = []
        for txt, lvl in paragraphs:
            if lvl in (1, 2):
                if cur_c_title is not None:
                    cur_chs.append((cur_c_title, "\n".join(cur_lines)))
                    cur_lines = []
                if _is_volume_heading(txt):
                    if cur_chs:
                        raw_vols.append((cur_v_title, cur_chs))
                        cur_chs = []
                    cur_v_title = txt
                    cur_c_title = None
                else:
                    cur_c_title = txt
            else:
                if cur_c_title is not None:
                    cur_lines.append(txt)
        if cur_c_title is not None:
            cur_chs.append((cur_c_title, "\n".join(cur_lines)))
        if cur_chs:
            raw_vols.append((cur_v_title, cur_chs))
        built = _build_parsed_book(book_title, doc_author, raw_vols)
        if built.volumes:
            return built

    return txt_parsed


def parse_markdown_novel(raw: bytes, fallback_title: str) -> ParsedBook:
    text = decode_text_bytes(raw).replace("\r\n", "\n").replace("\r", "\n")
    title = fallback_title
    author = ""

    # Parse optional YAML frontmatter
    if text.startswith("---\n"):
        end_fm = text.find("\n---\n", 4)
        if end_fm != -1:
            fm = text[4:end_fm]
            text = text[end_fm + 5 :]
            for line in fm.splitlines():
                if ":" not in line:
                    continue
                k, _, v = line.partition(":")
                key = k.strip().lower()
                val = v.strip().strip("\"'")
                if key == "title" and val:
                    title = val
                elif key == "author" and val:
                    author = val

    lines = text.split("\n")
    in_code = False
    headings: list[tuple[int, int, str]] = []  # (line_idx, level, heading_text)
    for idx, line in enumerate(lines):
        stripped = line.strip()
        if stripped.startswith("```"):
            in_code = not in_code
            continue
        if in_code:
            continue
        m = re.match(r"^(#{1,3})\s+(.+?)\s*#*$", stripped)
        if m:
            headings.append((idx, len(m.group(1)), m.group(2).strip()))

    if headings:
        h1_list = [h for h in headings if h[1] == 1]
        h2_list = [h for h in headings if h[1] == 2]
        h3_list = [h for h in headings if h[1] == 3]

        # Single top-level H1 acting as book title
        vol_lvl: int | None = None
        ch_lvl: int | None = None
        if len(h1_list) == 1 and h1_list[0][0] <= 5 and len(h2_list) >= 2:
            if not _is_volume_heading(h1_list[0][2]) and not _is_chapter_heading(h1_list[0][2]):
                title = h1_list[0][2]
            if len(h3_list) >= 2:
                vol_lvl, ch_lvl = 2, 3
            else:
                ch_lvl = 2
        elif len(h1_list) >= 2 and len(h2_list) >= 2:
            vol_lvl, ch_lvl = 1, 2
        elif len(h1_list) >= 2:
            ch_lvl = 1
        elif len(h2_list) >= 2:
            ch_lvl = 2

        if vol_lvl is not None and ch_lvl is not None:
            raw_vols: list[tuple[str, list[tuple[str, str]]]] = []
            cur_v_title = "第一卷 正文"
            cur_chs: list[tuple[str, str]] = []
            cur_c_title: str | None = None
            cur_buf: list[str] = []
            heading_by_line = {ln: (lvl, txt) for ln, lvl, txt in headings}
            for idx, line in enumerate(lines):
                if idx in heading_by_line:
                    lvl, h_txt = heading_by_line[idx]
                    if lvl == vol_lvl:
                        if cur_c_title is not None:
                            cur_chs.append((cur_c_title, "\n".join(cur_buf)))
                            cur_c_title = None
                            cur_buf = []
                        if cur_chs:
                            raw_vols.append((cur_v_title, cur_chs))
                            cur_chs = []
                        cur_v_title = h_txt
                        continue
                    if lvl == ch_lvl:
                        if cur_c_title is not None:
                            cur_chs.append((cur_c_title, "\n".join(cur_buf)))
                            cur_buf = []
                        cur_c_title = h_txt
                        continue
                if cur_c_title is not None:
                    cur_buf.append(line)
            if cur_c_title is not None:
                cur_chs.append((cur_c_title, "\n".join(cur_buf)))
            if cur_chs:
                raw_vols.append((cur_v_title, cur_chs))
            built = _build_parsed_book(title, author, raw_vols)
            if built.volumes:
                return built

        if ch_lvl is not None:
            raw_vols = []
            cur_v_title = "第一卷 正文"
            cur_chs = []
            cur_c_title = None
            cur_buf = []
            heading_by_line = {ln: (lvl, txt) for ln, lvl, txt in headings if lvl == ch_lvl}
            for idx, line in enumerate(lines):
                if idx in heading_by_line:
                    _, h_txt = heading_by_line[idx]
                    if cur_c_title is not None:
                        cur_chs.append((cur_c_title, "\n".join(cur_buf)))
                        cur_buf = []
                    if _is_volume_heading(h_txt):
                        if cur_chs:
                            raw_vols.append((cur_v_title, cur_chs))
                            cur_chs = []
                        cur_v_title = h_txt
                        cur_c_title = None
                    else:
                        cur_c_title = h_txt
                    continue
                if cur_c_title is not None:
                    cur_buf.append(line)
            if cur_c_title is not None:
                cur_chs.append((cur_c_title, "\n".join(cur_buf)))
            if cur_chs:
                raw_vols.append((cur_v_title, cur_chs))
            built = _build_parsed_book(title, author, raw_vols)
            if built.volumes:
                return built

    # Strip leading '#' from markdown heading lines and delegate to TXT parser
    normalized_lines = [re.sub(r"^#{1,6}\s+", "", ln.strip()) for ln in lines]
    parsed = parse_txt_novel("\n".join(normalized_lines).encode("utf-8"), title)
    parsed.author = author
    return parsed


def parse_html_novel(raw: bytes, fallback_title: str) -> ParsedBook:
    from bs4 import BeautifulSoup

    html_str = decode_text_bytes(raw)
    soup = BeautifulSoup(html_str, "lxml")
    for tag in soup(["script", "style", "noscript"]):
        tag.decompose()

    title = fallback_title
    if soup.title and soup.title.string:
        t = soup.title.string.strip()
        if t and t.lower() not in ("book", "index", "document", "untitled") and len(t) <= 120:
            title = t

    author = ""
    meta_author = soup.find("meta", attrs={"name": re.compile(r"^author$", re.IGNORECASE)})
    if meta_author and meta_author.get("content"):
        author = str(meta_author.get("content")).strip()

    body = soup.body or soup
    plain = clean_novel_text(body.get_text("\n"))
    parsed = parse_txt_novel(plain.encode("utf-8"), title)
    parsed.author = author
    if not _is_unsplit_fallback(parsed):
        return parsed

    # Fallback: split by HTML heading tags (h1/h2/h3) if present
    heading_tags = body.find_all(["h1", "h2", "h3"])
    if len(heading_tags) >= 2:
        raw_vols: list[tuple[str, list[tuple[str, str]]]] = []
        cur_v_title = "第一卷 正文"
        cur_chs: list[tuple[str, str]] = []
        cur_c_title: str | None = None
        cur_buf: list[str] = []

        for elem in body.find_all(["h1", "h2", "h3", "p", "div"], recursive=True):
            # Avoid duplicating parent divs that wrap inner block elements
            if elem.name == "div" and elem.find(["h1", "h2", "h3", "p", "div"]) is not None:
                continue
            txt = elem.get_text(" ", strip=True)
            if not txt:
                continue
            if elem.name in ("h1", "h2", "h3"):
                if cur_c_title is not None:
                    cur_chs.append((cur_c_title, "\n\n".join(cur_buf)))
                    cur_buf = []
                if _is_volume_heading(txt):
                    if cur_chs:
                        raw_vols.append((cur_v_title, cur_chs))
                        cur_chs = []
                    cur_v_title = txt
                    cur_c_title = None
                else:
                    cur_c_title = txt
            elif cur_c_title is not None:
                cur_buf.append(txt)

        if cur_c_title is not None:
            cur_chs.append((cur_c_title, "\n\n".join(cur_buf)))
        if cur_chs:
            raw_vols.append((cur_v_title, cur_chs))
        built = _build_parsed_book(title, author, raw_vols)
        if built.volumes:
            return built

    return parsed


def _decode_zip_filename(info: zipfile.ZipInfo) -> str:
    if info.flag_bits & 0x800:
        return info.filename
    try:
        raw_name = info.filename.encode("cp437")
        for enc in ("utf-8", "gb18030", "gbk"):
            try:
                return raw_name.decode(enc)
            except UnicodeDecodeError:
                continue
    except UnicodeEncodeError:
        pass
    return info.filename


def _natural_sort_key(text: str) -> list[int | str]:
    return [int(tok) if tok.isdigit() else tok.lower() for tok in re.split(r"(\d+)", text)]


def parse_zip_novel(
    raw: bytes,
    fallback_title: str,
    max_uncompressed_bytes: int = 256 * 1024 * 1024,
) -> ParsedBook:
    try:
        zf = zipfile.ZipFile(io.BytesIO(raw))
    except zipfile.BadZipFile as exc:
        raise ValueError("无法打开该 ZIP 压缩包，请确认文件完整有效。") from exc

    inner_exts = set(SUPPORTED_NOVEL_EXTENSIONS) - {".zip"}
    text_exts = {".txt", ".md", ".markdown", ".html", ".htm"}
    ebook_priority = {".epub": 6, ".azw3": 5, ".mobi": 4, ".azw": 4, ".fb2": 3, ".docx": 2, ".pdf": 1}

    with zf:
        candidates: list[tuple[zipfile.ZipInfo, str, str]] = []
        for info in zf.infolist():
            if info.is_dir():
                continue
            decoded_name = _decode_zip_filename(info).replace("\\", "/")
            parts = [p for p in decoded_name.split("/") if p]
            if not parts or any(p == "__MACOSX" or p.startswith(".") for p in parts):
                continue
            ext = Path(parts[-1]).suffix.lower()
            if ext in inner_exts:
                candidates.append((info, decoded_name, ext))

        if not candidates:
            raise ValueError(
                "压缩包内未找到支持的小说文件（支持 TXT/EPUB/MOBI/AZW3/FB2/PDF/DOCX/MD/HTML）。"
            )

        if len(candidates) == 1:
            info, decoded_name, _ = candidates[0]
            if info.file_size > max_uncompressed_bytes:
                raise ValueError("压缩包内文件解压后超过允许大小上限。")
            inner_raw = zf.read(info)
            inner_stem = Path(decoded_name).stem
            chosen_title = fallback_title if inner_stem.lower() in ("book", "index", "novel") else inner_stem
            return parse_novel_bytes(decoded_name, inner_raw, title_override=None, fallback_title=chosen_title)

        # If archive contains a primary ebook format alongside readme/etc., pick highest priority ebook
        ebook_candidates = [c for c in candidates if c[2] in ebook_priority]
        if ebook_candidates:
            ebook_candidates.sort(key=lambda c: (ebook_priority[c[2]], c[0].file_size), reverse=True)
            info, decoded_name, _ = ebook_candidates[0]
            if info.file_size > max_uncompressed_bytes:
                raise ValueError("压缩包内文件解压后超过允许大小上限。")
            return parse_novel_bytes(decoded_name, zf.read(info))

        # Multiple text/markdown/html files (e.g., chapter-per-file archive)
        text_candidates = [c for c in candidates if c[2] in text_exts]
        text_candidates.sort(key=lambda c: _natural_sort_key(c[1]))
        total_uncompressed = sum(c[0].file_size for c in text_candidates)
        if total_uncompressed > max_uncompressed_bytes:
            raise ValueError("压缩包内文本解压总大小超过允许上限。")

        # Group by parent directory if multiple subdirectories exist
        raw_vols_map: dict[str, list[tuple[str, str]]] = {}
        vol_order: list[str] = []
        for info, decoded_name, ext in text_candidates:
            path_parts = [p for p in decoded_name.split("/") if p]
            vol_name = path_parts[-2] if len(path_parts) >= 2 else "第一卷 正文"
            ch_stem = Path(path_parts[-1]).stem
            inner_bytes = zf.read(info)
            parsed_piece = parse_novel_bytes(decoded_name, inner_bytes, fallback_title=ch_stem)
            if vol_name not in raw_vols_map:
                raw_vols_map[vol_name] = []
                vol_order.append(vol_name)
            for v in parsed_piece.volumes:
                for ch in v.chapters:
                    c_title = ch_stem if ch.title == "正文" else ch.title
                    raw_vols_map[vol_name].append((c_title, ch.content))

        raw_vols = [(v_name, raw_vols_map[v_name]) for v_name in vol_order if raw_vols_map[v_name]]
        built = _build_parsed_book(fallback_title, "", raw_vols)
        if built.volumes:
            return built
        raise ValueError("压缩包内未提取到有效小说正文内容。")


def parse_novel_bytes(
    filename: str,
    raw: bytes,
    title_override: str | None = None,
    fallback_title: str | None = None,
    max_uncompressed_bytes: int = 256 * 1024 * 1024,
) -> ParsedBook:
    ext = Path(filename).suffix.lower()
    if ext not in SUPPORTED_NOVEL_EXTENSIONS:
        supported_str = ", ".join(SUPPORTED_NOVEL_EXTENSIONS)
        raise ValueError(f"不支持的小说格式 '{ext or '(无扩展名)'}'。当前支持：{supported_str}")

    resolved_fallback = (
        (title_override or "").strip()
        or (fallback_title or "").strip()
        or Path(filename).stem
        or "未命名小说"
    )

    if ext == ".epub":
        parsed = parse_epub_novel(raw, resolved_fallback)
    elif ext in (".mobi", ".azw3", ".azw"):
        parsed = parse_mobi_novel(raw, resolved_fallback, ext=ext)
    elif ext == ".fb2":
        parsed = parse_fb2_novel(raw, resolved_fallback)
    elif ext == ".pdf":
        parsed = parse_pdf_novel(raw, resolved_fallback)
    elif ext == ".docx":
        parsed = parse_docx_novel(raw, resolved_fallback)
    elif ext in (".md", ".markdown"):
        parsed = parse_markdown_novel(raw, resolved_fallback)
    elif ext in (".html", ".htm"):
        parsed = parse_html_novel(raw, resolved_fallback)
    elif ext == ".zip":
        parsed = parse_zip_novel(
            raw, resolved_fallback, max_uncompressed_bytes=max_uncompressed_bytes
        )
    else:
        parsed = parse_txt_novel(raw, resolved_fallback)

    if title_override and title_override.strip():
        parsed.title = title_override.strip()
    return parsed
