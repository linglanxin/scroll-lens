from __future__ import annotations

import warnings

from ebooklib import epub

from app.engines.novel.parser import parse_epub_novel, parse_txt_novel
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
