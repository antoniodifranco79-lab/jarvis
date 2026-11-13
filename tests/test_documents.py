"""Local document search: extraction (text, Word, PDF), chunking, BM25 ranking and the registered tools."""

from __future__ import annotations

import zipfile
from pathlib import Path

import pytest

from jarvis.events import EventBus
from jarvis.tools import ToolContext, build_registry
from jarvis.tools.documents import DocumentIndex, chunk, extract_pages, tokens


def make_docx(path: Path, paragraphs: list[str]) -> None:
    body = "".join(f"<w:p><w:r><w:t>{p}</w:t></w:r></w:p>" for p in paragraphs)
    with zipfile.ZipFile(path, "w") as z:
        z.writestr(
            "[Content_Types].xml",
            '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
            '<Default Extension="xml" ContentType="application/xml"/></Types>',
        )
        z.writestr(
            "word/document.xml",
            '<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
            f"<w:body>{body}</w:body></w:document>",
        )


def make_pdf(path: Path, pages: list[str]) -> None:
    """A minimal, valid PDF with one line of Helvetica text per page."""
    objs: list[bytes] = []
    n = len(pages)
    kids = " ".join(f"{3 + 2 * i} 0 R" for i in range(n))
    objs.append(b"<< /Type /Catalog /Pages 2 0 R >>")
    objs.append(f"<< /Type /Pages /Kids [{kids}] /Count {n} >>".encode())
    font_id = 3 + 2 * n
    for i, text in enumerate(pages):
        content = f"BT /F1 12 Tf 40 760 Td ({text}) Tj ET".encode("latin-1")
        objs.append(
            f"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 {font_id} 0 R >> >> "
            f"/Contents {4 + 2 * i} 0 R >>".encode()
        )
        objs.append(b"<< /Length %d >>\nstream\n" % len(content) + content + b"\nendstream")
    objs.append(b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>")
    out = bytearray(b"%PDF-1.4\n")
    offsets = []
    for i, body in enumerate(objs, 1):
        offsets.append(len(out))
        out += f"{i} 0 obj\n".encode() + body + b"\nendobj\n"
    xref = len(out)
    out += f"xref\n0 {len(objs) + 1}\n0000000000 65535 f \n".encode()
    out += b"".join(f"{o:010d} 00000 n \n".encode() for o in offsets)
    out += f"trailer\n<< /Size {len(objs) + 1} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n".encode()
    path.write_bytes(bytes(out))


def test_tokens_fold_accents_and_stem():
    assert tokens("Il Recesso è possibile") == tokens("recessi possibili")
    assert "conduttor" in tokens("del conduttore")


def test_chunk_overlaps_and_keeps_pages():
    pages = ["A" * 50 + ". " + "B" * 2000, "short page"]
    parts = chunk(pages, size=900, overlap=150)
    assert parts[0][0] == 1 and parts[-1] == (2, "short page")
    assert all(len(t) <= 900 for _, t in parts)


def test_extract_docx_and_text(tmp_path):
    make_docx(tmp_path / "bilancio.docx", ["Bilancio 2025 della Bianchi Srl.", "Fatturato 1.250.000 euro."])
    assert "Fatturato 1.250.000 euro." in extract_pages(tmp_path / "bilancio.docx")[0]
    (tmp_path / "page.html").write_text("<html><style>x{}</style><p>Ciao &amp; benvenuti</p></html>")
    assert "Ciao & benvenuti" in extract_pages(tmp_path / "page.html")[0]


def test_extract_pdf_pages(tmp_path):
    pytest.importorskip("pypdf")
    make_pdf(tmp_path / "contratto.pdf", ["Art. 1 Oggetto della locazione", "Art. 7 Recesso con preavviso di sei mesi"])
    pages = extract_pages(tmp_path / "contratto.pdf")
    assert len(pages) == 2 and "preavviso di sei mesi" in pages[1]


def test_index_ranks_and_refreshes(tmp_path):
    (tmp_path / "locazione Rossi.txt").write_text(
        "Art. 7 Recesso. Il conduttore può recedere con preavviso di sei mesi. Canone mensile 850 euro."
    )
    make_docx(tmp_path / "bilancio Bianchi.docx", ["Il fatturato 2025 è stato di 1.250.000 euro."])
    (tmp_path / ".hidden").mkdir()
    (tmp_path / ".hidden" / "secret.txt").write_text("preavviso segreto")
    index = DocumentIndex(tmp_path)
    top = index.search("quanto è il preavviso di recesso?")
    assert top and top[0][1].file == "locazione Rossi.txt"
    assert all(".hidden" not in p.file for _, p in top)
    assert index.search("fatturato Bianchi")[0][1].file == "bilancio Bianchi.docx"
    assert index.search("canone", file="bianchi") == []
    (tmp_path / "locazione Rossi.txt").unlink()
    assert index.search("preavviso recesso") == []
    assert index.files == ["bilancio Bianchi.docx"]


async def test_document_tools_registered(settings, memory):
    reg = build_registry(ToolContext(settings, memory, EventBus()))
    assert "search_documents" in reg.names() and "list_documents" in reg.names()
    empty = await reg.execute("search_documents", {"query": "recesso"})
    assert "No documents" in empty.content
    settings.workspace.mkdir(parents=True, exist_ok=True)
    make_docx(settings.workspace / "verbale.docx", ["Verbale di assemblea: approvato il bilancio 2025 all'unanimità."])
    hit = await reg.execute("search_documents", {"query": "assemblea bilancio approvato"})
    assert "verbale.docx" in hit.content and "unanimità" in hit.content
    assert "verbale.docx" in (await reg.execute("list_documents", {})).content
    read = await reg.execute("read_file", {"path": "verbale.docx"})
    assert "approvato il bilancio" in read.content
