from __future__ import annotations

import io
import os
import warnings
import zipfile

from docx import Document as DocxDocument
from ebooklib import epub
import pymupdf

from app.engines.novel.parser import parse_epub_novel, parse_novel_bytes, parse_txt_novel
from app.engines.novel.search import (
    get_keyword_timeline,
    list_chapter_titles,
    list_volumes,
    read_chapter,
    search_chapters,
)


def _register_alice(client) -> dict[str, str]:
    r = client.post("/api/v1/auth/register", json={"username": "alice", "password": "password123"})
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


def test_txt_parsing_gb18030_toc_filtering_and_append(app_client) -> None:
    client, app = app_client
    hdr = _register_alice(client)

    raw_novel = (
        "目录\n"
        "第一章 初入乱世\n"
        "第二章 白马义从\n"
        "第三章 风起云涌\n\n"
        "请记住本书首发域名：www.example-novel.com\n"
        "第一卷 初入乱世\n"
        "第一章 初入乱世\n"
        "陈曦穿越到了东汉末年，在泰山郡遇见了刘备，决定辅佐玄德公兴复汉室。www.biquge.com\n\n"
        "第二章 白马义从\n"
        "公孙瓒麾下白马义从驰骋幽州，陈子川在旁观战，感叹骑兵精锐之气势。\n\n"
        "第二卷 中原逐鹿\n"
        "第三章 风起云涌\n"
        "内气离体高手现身徐州战场，局势骤变。\n"
    ).encode("gb18030")

    resp = client.post(
        "/api/v1/books",
        headers=hdr,
        files={"file": ("myth_sanguo.txt", raw_novel, "text/plain")},
    )
    assert resp.status_code == 201, resp.text
    book = resp.json()
    book_id = book["id"]
    assert book["total_volumes"] == 2
    assert book["total_chapters"] == 3

    # Verify watermark cleaned
    ch1 = client.get(f"/api/v1/books/{book_id}/chapters/1?highlight=陈曦", headers=hdr).json()
    assert "biquge" not in ch1["content"]
    assert len(ch1["highlight_positions"]) == 1

    # Add alias for 陈曦 -> 陈子川, triggers FTS5 reindex
    alias_resp = client.post(
        f"/api/v1/books/{book_id}/aliases",
        headers=hdr,
        json={"canonical_name": "陈曦", "aliases": ["陈子川", "司空"], "reindex": True},
    )
    assert alias_resp.status_code == 201

    # Searching 陈曦 should now match both ch1 (陈曦) and ch2 (陈子川) via alias expansion!
    with app.state.db.session() as conn:
        hits = search_chapters(conn, book_id, ["陈曦"], max_chapter=3, match_mode="AND")
        assert [h["chapter_num"] for h in hits] == [1, 2]

        # Test spoiler lock at chapter 2
        vols_locked = list_volumes(conn, book_id, max_chapter=2)
        assert len(vols_locked) == 1
        assert vols_locked[0]["title"] == "第一卷 初入乱世"

        tl = get_keyword_timeline(conn, book_id, "陈曦", max_chapter=3, buckets=3)
        assert tl["first_chapter"] == 1
        assert tl["last_chapter"] == 2
        assert tl["matching_chapters"] == 2

        blocked = read_chapter(conn, book_id, chapter_num=3, max_chapter=2)
        assert blocked.get("blocked_by_spoiler_lock") is True

        titles = list_chapter_titles(conn, book_id, start_ch=1, end_ch=10, max_chapter=2)
        assert [t["chapter_num"] for t in titles] == [1, 2]

    # Incremental append with new chapter 4
    updated_novel = (
        "第一卷 初入乱世\n"
        "第一章 初入乱世\n"
        "陈曦穿越到了东汉末年，在泰山郡遇见了刘备，决定辅佐玄德公兴复汉室。\n\n"
        "第二章 白马义从\n"
        "公孙瓒麾下白马义从驰骋幽州，陈子川在旁观战，感叹骑兵精锐之气势。\n\n"
        "第二卷 中原逐鹿\n"
        "第三章 风起云涌\n"
        "内气离体高手现身徐州战场，局势骤变。\n\n"
        "第四章 摊丁入亩\n"
        "陈曦在青州开始推行新政与摊丁入亩，百姓大悦。\n"
    ).encode("utf-8")

    app_resp = client.post(
        f"/api/v1/books/{book_id}/append",
        headers=hdr,
        files={"file": ("myth_sanguo.txt", updated_novel, "text/plain")},
    )
    assert app_resp.status_code == 200
    assert app_resp.json()["appended_chapters"] == 1
    assert app_resp.json()["new_total_chapters"] == 4


def test_volumeless_fallback_and_manual_split(app_client) -> None:
    client, _ = app_client
    hdr = _register_alice(client)

    raw = (
        "第一章 起点\n主角在小镇醒来。\n"
        "第二章 启程\n主角踏上旅途。\n"
        "第三章 试炼\n主角参加宗门大比。\n"
    ).encode("utf-8")
    book_id = client.post(
        "/api/v1/books",
        headers=hdr,
        files={"file": ("plain.txt", raw, "text/plain")},
    ).json()["id"]

    vols = client.get(f"/api/v1/books/{book_id}/volumes", headers=hdr).json()
    assert len(vols) == 1
    assert vols[0]["title"] == "第一卷 正文"

    # Manual split into 2 volumes
    split_resp = client.post(
        f"/api/v1/books/{book_id}/volumes/split",
        headers=hdr,
        json={
            "volumes": [
                {"title": "卷一 启程篇", "start_chapter": 1, "end_chapter": 2},
                {"title": "卷二 宗门篇", "start_chapter": 3, "end_chapter": 3},
            ]
        },
    )
    assert split_resp.status_code == 200
    assert len(split_resp.json()) == 2
    assert split_resp.json()[1]["title"] == "卷二 宗门篇"


def test_epub_two_level_toc_parsing(tmp_path) -> None:
    book = epub.EpubBook()
    book.set_identifier("id-scroll-lens-test")
    book.set_title("测试EPUB小说")
    book.set_language("zh")
    book.add_author("测试作者")

    c1 = epub.EpubHtml(title="第一章 相识", file_name="chap_01.xhtml", lang="zh")
    c1.content = "<h1>第一章 相识</h1><p>陈曦与刘备初遇泰山。</p>"
    c2 = epub.EpubHtml(title="第二章 结盟", file_name="chap_02.xhtml", lang="zh")
    c2.content = "<h1>第二章 结盟</h1><p>二人共谋大业，招募关张。</p>"
    c3 = epub.EpubHtml(title="第三章 北伐", file_name="chap_03.xhtml", lang="zh")
    c3.content = "<h1>第三章 北伐</h1><p>兵发冀州，大破袁军。</p>"

    for c in (c1, c2, c3):
        book.add_item(c)

    book.toc = (
        (epub.Section("第一卷 泰山风云"), (c1, c2)),
        (epub.Section("第二卷 河北争雄"), (c3,)),
    )
    book.add_item(epub.EpubNcx())
    book.add_item(epub.EpubNav())
    book.spine = ["nav", c1, c2, c3]

    epub_file = tmp_path / "test_novel.epub"
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        epub.write_epub(str(epub_file), book)

    parsed = parse_epub_novel(epub_file.read_bytes(), "fallback")
    assert parsed.title == "测试EPUB小说"
    assert parsed.author == "测试作者"
    assert len(parsed.volumes) == 2
    assert parsed.volumes[0].title == "第一卷 泰山风云"
    assert [c.title for c in parsed.volumes[0].chapters] == ["第一章 相识", "第二章 结盟"]
    assert parsed.volumes[1].title == "第二卷 河北争雄"
    assert parsed.volumes[1].chapters[0].chapter_num == 3


def test_fb2_novel_upload_preserves_nested_volumes(app_client) -> None:
    client, _ = app_client
    hdr = _register_alice(client)

    fb2_xml = """<?xml version="1.0" encoding="UTF-8"?>
<FictionBook xmlns="http://www.gribuser.ru/xml/fictionbook/2.0">
  <description>
    <title-info>
      <author><first-name>齐佩甲</first-name></author>
      <book-title>超神机械师测试版</book-title>
    </title-info>
  </description>
  <body>
    <section>
      <title><p>第一卷 萌芽</p></title>
      <section>
        <title><p>第一章 实验室醒来</p></title>
        <p>韩萧在萌芽组织实验基地中醒来，发现自己穿越进了星海游戏。</p>
      </section>
      <section>
        <title><p>第二章 逃离基地</p></title>
        <p>韩萧利用机械师知识制造简陋武器，成功突破封锁线。</p>
      </section>
    </section>
    <section>
      <title><p>第二卷 星龙阵营</p></title>
      <section>
        <title><p>第三章 结识星龙</p></title>
        <p>来到西都后，韩萧与十三局展开合作，踏入超能世界。</p>
      </section>
    </section>
  </body>
</FictionBook>""".encode("utf-8")

    resp = client.post(
        "/api/v1/books",
        headers=hdr,
        files={"file": ("mech.fb2", fb2_xml, "application/xml")},
    )
    assert resp.status_code == 201, resp.text
    book = resp.json()
    assert book["title"] == "超神机械师测试版"
    assert book["author"] == "齐佩甲"
    assert book["total_volumes"] == 2
    assert book["total_chapters"] == 3

    vols = client.get(f"/api/v1/books/{book['id']}/volumes", headers=hdr).json()
    assert [v["title"] for v in vols] == ["第一卷 萌芽", "第二卷 星龙阵营"]


def test_docx_markdown_html_and_zip_novel_formats(app_client) -> None:
    client, _ = app_client
    hdr = _register_alice(client)

    # 1. DOCX with Heading 1 (volume) & Heading 2 (chapter)
    doc = DocxDocument()
    doc.core_properties.title = "诡秘测试卷"
    doc.core_properties.author = "乌贼测试"
    doc.add_heading("第一卷 小丑", level=1)
    doc.add_heading("第一章 绯红", level=2)
    doc.add_paragraph("痛！好痛！周明瑞在绯红月光下醒来，打量着陌生的房间。")
    doc.add_heading("第二章 情况", level=2)
    doc.add_paragraph("翻开克莱恩的笔记，诡异的字迹映入眼帘。")
    doc.add_heading("第二卷 无面人", level=1)
    doc.add_heading("第三章 贝克兰德", level=2)
    doc.add_paragraph("蒸汽与机械的雾都贝克兰德迎来了一位神秘侦探。")
    docx_buf = io.BytesIO()
    doc.save(docx_buf)

    r_docx = client.post(
        "/api/v1/books",
        headers=hdr,
        files={"file": ("lotm.docx", docx_buf.getvalue(), "application/octet-stream")},
    )
    assert r_docx.status_code == 201, r_docx.text
    assert r_docx.json()["title"] == "诡秘测试卷"
    assert r_docx.json()["total_volumes"] == 2
    assert r_docx.json()["total_chapters"] == 3

    # 2. Markdown with YAML frontmatter + H1/H2 structure
    md_bytes = (
        "---\n"
        "title: 剑来测试版\n"
        "author: 烽火测试\n"
        "---\n\n"
        "# 第一卷 笼中雀\n\n"
        "## 第一章 二月二\n"
        "骊珠洞天小镇上，少年陈平安在泥瓶巷修补瓦片。\n\n"
        "## 第二章 齐静春\n"
        "齐静春走过石拱桥，对小镇少年报以温和一笑。\n\n"
        "# 第二卷 山水郎\n\n"
        "## 第三章 远游\n"
        "背起剑匣离开小镇，少年踏上千里护送之路。\n"
    ).encode("utf-8")

    r_md = client.post(
        "/api/v1/books",
        headers=hdr,
        files={"file": ("jianlai.md", md_bytes, "text/markdown")},
    )
    assert r_md.status_code == 201, r_md.text
    assert r_md.json()["title"] == "剑来测试版"
    assert r_md.json()["author"] == "烽火测试"
    assert r_md.json()["total_volumes"] == 2
    assert r_md.json()["total_chapters"] == 3

    # 3. HTML encoded in GB18030
    html_bytes = (
        "<html><head><title>凡人修仙传测试</title><meta name='author' content='忘语'></head>"
        "<body><h1>第一卷 七玄门风云</h1>"
        "<h2>第一章 山边小村</h2><p>韩立出生在青牛镇五里沟，被三叔推荐去七玄门参加考核。</p>"
        "<h2>第二章 墨大夫</h2><p>进入神手谷后，韩立拜入墨居仁门下修炼长春功。</p>"
        "</body></html>"
    ).encode("gb18030")
    r_html = client.post(
        "/api/v1/books",
        headers=hdr,
        files={"file": ("fanren.html", html_bytes, "text/html")},
    )
    assert r_html.status_code == 201, r_html.text
    assert r_html.json()["title"] == "凡人修仙传测试"
    assert r_html.json()["author"] == "忘语"
    assert r_html.json()["total_chapters"] == 2

    # 4. ZIP containing multi-chapter txt files in volume subdirectories
    zip_buf = io.BytesIO()
    with zipfile.ZipFile(zip_buf, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("第一卷 起航/1_初遇.txt", "少年在海港边捡到一枚古老罗盘，光芒微弱却十分温暖。")
        zf.writestr("第一卷 起航/2_登船.txt", "清晨薄雾散去，远航号扬帆离开码头驶向深海。")
        zf.writestr("第二卷 迷雾海/10_风暴.txt", "巨大的漩涡在海面旋转，船长下令全员紧握缆绳。")

    r_zip = client.post(
        "/api/v1/books",
        headers=hdr,
        files={"file": ("voyage_archive.zip", zip_buf.getvalue(), "application/zip")},
    )
    assert r_zip.status_code == 201, r_zip.text
    assert r_zip.json()["total_volumes"] == 2
    assert r_zip.json()["total_chapters"] == 3


def test_pdf_novel_with_toc_and_empty_pdf_rejection(app_client) -> None:
    client, _ = app_client
    hdr = _register_alice(client)

    pdf = pymupdf.open()
    pdf.set_metadata({"title": "PDF Novel Sample", "author": "Tester"})
    for idx, body in enumerate(
        [
            "Chapter 1 Beginning. The hero wakes up in the northern tower at dawn.",
            "Chapter 2 Journey. Crossing the iron bridge toward the capital city.",
            "Chapter 3 Citadel. Entering the grand library to search the archives.",
        ],
        start=1,
    ):
        page = pdf.new_page()
        page.insert_text((72, 72), body, fontsize=12)

    pdf.set_toc(
        [
            [1, "Volume 1 Awakening", 1],
            [2, "Chapter 1 Beginning", 1],
            [2, "Chapter 2 Journey", 2],
            [1, "Volume 2 Capital", 3],
            [2, "Chapter 3 Citadel", 3],
        ]
    )
    pdf_bytes = pdf.tobytes()
    pdf.close()

    r_pdf = client.post(
        "/api/v1/books",
        headers=hdr,
        files={"file": ("sample_novel.pdf", pdf_bytes, "application/pdf")},
    )
    assert r_pdf.status_code == 201, r_pdf.text
    assert r_pdf.json()["title"] == "PDF Novel Sample"
    assert r_pdf.json()["total_volumes"] == 2
    assert r_pdf.json()["total_chapters"] == 3

    # Scanned/blank PDF with no extractable text should return 400
    blank_pdf = pymupdf.open()
    blank_pdf.new_page()
    blank_bytes = blank_pdf.tobytes()
    blank_pdf.close()
    r_blank = client.post(
        "/api/v1/books",
        headers=hdr,
        files={"file": ("scanned.pdf", blank_bytes, "application/pdf")},
    )
    assert r_blank.status_code == 400
    assert "扫描" in r_blank.json()["detail"]


def test_mobi_azw3_unpack_and_drm_error_handling(app_client, monkeypatch) -> None:
    client, _ = app_client
    hdr = _register_alice(client)

    # Mock mobi.kindleunpack.unpackBook to simulate a real unpacked mobi7 HTML + OPF output
    import mobi.kindleunpack as ku

    def fake_unpack_html(_infile: str, outdir: str, epubver: str = "A") -> None:
        mobi7 = os.path.join(outdir, "mobi7")
        os.makedirs(mobi7, exist_ok=True)
        with open(os.path.join(mobi7, "content.opf"), "w", encoding="utf-8") as f:
            f.write(
                "<package><metadata xmlns:dc='http://purl.org/dc/elements/1.1/'>"
                "<dc:title>道诡异仙测试</dc:title><dc:creator>狐尾的笔</dc:creator>"
                "</metadata></package>"
            )
        with open(os.path.join(mobi7, "book.html"), "w", encoding="utf-8") as f:
            f.write(
                "<html><body>"
                "<p>第一卷 坐忘道</p>"
                "<p>第一章 白玉京</p><p>李火旺睁开双眼，看着眼前斑驳的丹炉与道士。</p>"
                "<p>第二章 幻觉</p><p>病房的灯光闪烁，分不清究竟哪一边才是真实世界。</p>"
                "</body></html>"
            )

    monkeypatch.setattr(ku, "unpackBook", fake_unpack_html)
    resp = client.post(
        "/api/v1/books",
        headers=hdr,
        files={"file": ("daogui.mobi", b"FAKE_MOBI_BYTES", "application/octet-stream")},
    )
    assert resp.status_code == 201, resp.text
    assert resp.json()["title"] == "道诡异仙测试"
    assert resp.json()["author"] == "狐尾的笔"
    assert resp.json()["total_volumes"] == 1
    assert resp.json()["total_chapters"] == 2

    # Simulate DRM error on .azw3
    def fake_unpack_drm(_infile: str, _outdir: str, epubver: str = "A") -> None:
        raise RuntimeError("This book is DRM encrypted")

    monkeypatch.setattr(ku, "unpackBook", fake_unpack_drm)
    r_drm = client.post(
        "/api/v1/books",
        headers=hdr,
        files={"file": ("locked.azw3", b"DRM_BYTES", "application/octet-stream")},
    )
    assert r_drm.status_code == 400
    assert "DRM" in r_drm.json()["detail"]

    # Unsupported extension still rejected cleanly
    r_bad = client.post(
        "/api/v1/books",
        headers=hdr,
        files={"file": ("slides.pptx", b"not-a-novel", "application/octet-stream")},
    )
    assert r_bad.status_code == 400
