from __future__ import annotations

import io

import pymupdf
import pytest
from docx import Document as DocxDocument
from PIL import Image
from pptx import Presentation
from pptx.util import Inches

from app.engines.document.base import BasePageExtractor
from app.engines.document.search import DOC_DIRECT_THRESHOLD, list_doc_outline, read_doc_page, search_doc_pages


def _register_alice(client) -> dict[str, str]:
    r = client.post("/api/v1/auth/register", json={"username": "alice", "password": "password123"})
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


def _make_sample_pdf() -> bytes:
    doc = pymupdf.open()
    p1 = doc.new_page()
    p1.insert_text((72, 72), "Quarterly Financial Report\nRevenue grew by 35% in Q3 2026.")
    p2 = doc.new_page()
    # Image-only page (<20 chars + embedded image) -> triggers is_scanned_suspect=True
    img = Image.new("RGB", (100, 100), color=(200, 200, 200))
    img_buf = io.BytesIO()
    img.save(img_buf, format="PNG")
    p2.insert_image(pymupdf.Rect(50, 50, 150, 150), stream=img_buf.getvalue())
    out = doc.tobytes()
    doc.close()
    return out


def _make_sample_pptx() -> bytes:
    prs = Presentation()
    slide1 = prs.slides.add_slide(prs.slide_layouts[1])
    slide1.shapes.title.text = "System Architecture"
    slide1.placeholders[1].text = "FastAPI backend with SQLite FTS5"
    slide1.notes_slide.notes_text_frame.text = "Remember to highlight 180MB RAM budget."

    # Slide 2: picture only, no text -> is_scanned_suspect=True
    slide2 = prs.slides.add_slide(prs.slide_layouts[6])
    img = Image.new("RGB", (80, 80), color=(100, 150, 200))
    img_buf = io.BytesIO()
    img.save(img_buf, format="PNG")
    img_buf.seek(0)
    slide2.shapes.add_picture(img_buf, Inches(1), Inches(1), width=Inches(2))

    buf = io.BytesIO()
    prs.save(buf)
    return buf.getvalue()


def _make_sample_docx() -> bytes:
    doc = DocxDocument()
    doc.add_heading("Project Proposal", level=1)
    doc.add_paragraph("ScrollLens provides zero-cost indexing for ultra-long documents.")
    tbl = doc.add_table(rows=2, cols=2)
    tbl.cell(0, 0).text = "Metric"
    tbl.cell(0, 1).text = "Target"
    tbl.cell(1, 0).text = "RAM"
    tbl.cell(1, 1).text = "<= 180 MiB"
    buf = io.BytesIO()
    doc.save(buf)
    return buf.getvalue()


def test_pdf_pptx_docx_md_extraction_and_scanned_flags(app_client) -> None:
    client, app = app_client
    hdr = _register_alice(client)

    # PDF with 1 text page + 1 scanned-suspect page
    pdf_resp = client.post(
        "/api/v1/docs",
        headers=hdr,
        files={"file": ("report.pdf", _make_sample_pdf(), "application/pdf")},
    )
    assert pdf_resp.status_code == 201, pdf_resp.text
    pdf_doc = pdf_resp.json()
    assert pdf_doc["total_pages"] == 2
    assert pdf_doc["has_scanned_pages"] is True
    assert pdf_doc["scanned_page_count"] == 1
    assert pdf_doc["retrieval_mode"] == "direct"

    page2 = client.get(f"/api/v1/docs/{pdf_doc['id']}/pages/2", headers=hdr).json()
    assert page2["is_scanned_suspect"] is True

    # PPTX with notes + image-only slide
    pptx_resp = client.post(
        "/api/v1/docs",
        headers=hdr,
        files={
            "file": (
                "deck.pptx",
                _make_sample_pptx(),
                "application/vnd.openxmlformats-officedocument.presentationml.presentation",
            )
        },
    )
    assert pptx_resp.status_code == 201
    pptx_doc = pptx_resp.json()
    assert pptx_doc["total_pages"] == 2
    assert pptx_doc["has_scanned_pages"] is True
    s1 = client.get(f"/api/v1/docs/{pptx_doc['id']}/pages/1", headers=hdr).json()
    assert "180MB RAM budget" in s1["content"]

    # DOCX with heading + table
    docx_resp = client.post(
        "/api/v1/docs",
        headers=hdr,
        files={
            "file": (
                "proposal.docx",
                _make_sample_docx(),
                "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            )
        },
    )
    assert docx_resp.status_code == 201
    docx_doc = docx_resp.json()
    assert docx_doc["has_scanned_pages"] is False
    d1 = client.get(f"/api/v1/docs/{docx_doc['id']}/pages/1", headers=hdr).json()
    assert "<= 180 MiB" in d1["content"]

    # Large MD (>= 40,000 chars) -> paginated_fts mode + FTS5 search
    large_md = "\n\n".join(
        f"## Section {i}\n" + ("Detailed engineering specification content. " * 25)
        for i in range(1, 55)
    )
    large_md += "\n\n## Section 55\nUnique needle: QuantumFluxCapacitor2026.\n"
    md_resp = client.post(
        "/api/v1/docs",
        headers=hdr,
        files={"file": ("spec.md", large_md.encode("utf-8"), "text/markdown")},
    )
    assert md_resp.status_code == 201
    md_doc = md_resp.json()
    assert md_doc["total_chars"] >= DOC_DIRECT_THRESHOLD
    assert md_doc["retrieval_mode"] == "paginated_fts"

    with app.state.db.session() as conn:
        outline = list_doc_outline(conn, md_doc["id"])
        assert len(outline) >= 2
        hits = search_doc_pages(conn, md_doc["id"], ["QuantumFluxCapacitor2026"])
        assert len(hits) == 1
        assert "QuantumFluxCapacitor2026" in hits[0]["excerpt"]
        page_read = read_doc_page(conn, md_doc["id"], hits[0]["page_num"])
        assert "QuantumFluxCapacitor2026" in page_read["content"]


@pytest.mark.asyncio
async def test_vision_ocr_multimodal_adapters_and_end_to_end(app_client, monkeypatch) -> None:
    import asyncio

    from app.engines.document.parsers import PdfExtractor
    from app.llm.anthropic import AnthropicAdapter
    from app.llm.base import BaseLLMAdapter, ImageAttachment, LLMMessage, StreamEvent
    from app.llm.gemini import GeminiAdapter
    from app.llm.openai_compat import OpenAICompatAdapter

    # 1. Verify all 3 protocol adapters serialize multimodal ImageAttachment properly
    img_msg = [LLMMessage(role="user", content="OCR this", images=[ImageAttachment(data=b"PNGDATA", mime_type="image/png")])]
    oai_fmt = OpenAICompatAdapter._format_messages(img_msg, "")
    assert isinstance(oai_fmt[0]["content"], list)
    assert oai_fmt[0]["content"][1]["type"] == "image_url"
    assert oai_fmt[0]["content"][1]["image_url"]["url"].startswith("data:image/png;base64,")

    anth_fmt = AnthropicAdapter._format_messages(img_msg)
    assert anth_fmt[0]["content"][0]["type"] == "image"
    assert anth_fmt[0]["content"][0]["source"]["media_type"] == "image/png"

    gem_fmt = GeminiAdapter._format_contents(img_msg)
    assert "inlineData" in gem_fmt[0]["parts"][0]
    assert gem_fmt[0]["parts"][0]["inlineData"]["mimeType"] == "image/png"

    # 2. Verify extract_with_vision validates provider and invokes complete_once
    extractor = PdfExtractor()
    assert isinstance(extractor, BasePageExtractor)
    with pytest.raises(ValueError):
        await extractor.extract_with_vision(b"fake-img", None)

    class FakeVisionAdapter(BaseLLMAdapter):
        async def stream_chat(self, messages, tools=None, system_prompt="", temperature=0.3):
            assert len(messages) == 1 and len(messages[0].images) == 1
            yield StreamEvent(
                type="text_delta",
                text="扫描页标题\n本页视觉 OCR 识别结果：2026年净利润增长48%，关键指标QuantumVisionVerified。",
            )
            yield StreamEvent(type="done", finish_reason="stop")

        async def fetch_models(self):
            return ["fake-vision"]

    # 3. End-to-end API flow on scanned PDF
    client, app = app_client
    hdr = _register_alice(client)
    prov_resp = client.post(
        "/api/v1/providers",
        headers=hdr,
        json={
            "name": "VisionModel",
            "protocol": "openai_compat",
            "base_url": "https://mock.local/v1",
            "api_key": "sk-vision-test",
            "model_name": "gpt-4o-mini",
            "is_default": True,
        },
    )
    assert prov_resp.status_code == 201

    pdf_resp = client.post(
        "/api/v1/docs",
        headers=hdr,
        files={"file": ("scanned_report.pdf", _make_sample_pdf(), "application/pdf")},
    )
    assert pdf_resp.status_code == 201
    doc_id = pdf_resp.json()["id"]

    detail_before = client.get(f"/api/v1/docs/{doc_id}", headers=hdr).json()
    assert detail_before["has_scanned_pages"] is True
    assert detail_before["has_ocr_assets"] is True

    monkeypatch.setattr(
        "app.engines.document.vision_ocr.create_adapter",
        lambda **kwargs: FakeVisionAdapter("https://mock.local/v1", "sk", "gpt-4o-mini"),
    )

    ocr_resp = client.post(f"/api/v1/docs/{doc_id}/ocr", headers=hdr, json={})
    assert ocr_resp.status_code == 200, ocr_resp.text
    assert ocr_resp.json()["queued_pages"] == [2]

    # Wait for background OCR task to finish
    for _ in range(40):
        st = client.get(f"/api/v1/docs/{doc_id}/ocr-status", headers=hdr).json()
        if not st["running"]:
            break
        await asyncio.sleep(0.05)

    assert st["running"] is False
    assert st["completed_pages"] == 1
    assert st["failed_pages"] == 0

    detail_after = client.get(f"/api/v1/docs/{doc_id}", headers=hdr).json()
    assert detail_after["has_scanned_pages"] is False
    assert detail_after["scanned_page_count"] == 0

    page2_after = client.get(f"/api/v1/docs/{doc_id}/pages/2", headers=hdr).json()
    assert page2_after["is_scanned_suspect"] is False
    assert "QuantumVisionVerified" in page2_after["content"]

    with app.state.db.session() as conn:
        hits = search_doc_pages(conn, doc_id, ["QuantumVisionVerified"])
        assert len(hits) == 1
        assert hits[0]["page_num"] == 2

    # Deleting doc cleans up cached scanned page images
    del_resp = client.delete(f"/api/v1/docs/{doc_id}", headers=hdr)
    assert del_resp.status_code == 200
    scanned_dir = app.state.settings.resolved_data_dir() / "doc_scanned" / str(doc_id)
    assert not scanned_dir.exists()
