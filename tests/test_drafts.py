"""Word drafts: a valid .docx in the workspace, readable by Word and by Jarvis' own document search."""

from __future__ import annotations

import zipfile
from datetime import datetime

from jarvis.events import EventBus
from jarvis.tools import ToolContext, build_registry
from jarvis.tools.documents import extract_pages
from jarvis.tools.drafts import document_xml, file_name, italian_date


def test_file_name_and_date():
    assert file_name("Lettera al Dott. Rossi (figli)") == "Lettera-al-Dott-Rossi-figli.docx"
    assert file_name("Perché è così?") == "Perche-e-cosi.docx"
    assert file_name("") == "bozza.docx"
    assert italian_date(datetime(2026, 12, 16)) == "16 dicembre 2026"


def test_document_xml_formats_and_escapes():
    xml = document_xml("A & B", "# Oggetto\n- primo punto\nTesto con **grassetto** e <tag>")
    assert "A &amp; B" in xml and "&lt;tag&gt;" in xml and "<w:b/>" in xml and "**" not in xml


async def test_write_draft_creates_docx(settings, memory):
    reg = build_registry(ToolContext(settings, memory, EventBus()))
    assert "write_draft" in reg.names()
    out = await reg.execute("write_draft", {"title": "Sollecito Rossi Srl", "text": "Gentili signori,\n\n- fattura n. 12 del 3/10\n- importo 1.250,00 €\n\nCordiali saluti"})
    assert not out.is_error and "bozze/Sollecito-Rossi-Srl.docx" in out.content
    path = settings.workspace / "bozze" / "Sollecito-Rossi-Srl.docx"
    with zipfile.ZipFile(path) as z:
        assert z.testzip() is None
        assert {"[Content_Types].xml", "_rels/.rels", "word/document.xml"} <= set(z.namelist())
    text = "\n".join(extract_pages(path))
    assert "Sollecito Rossi Srl" in text and "1.250,00 €" in text
    again = await reg.execute("write_draft", {"title": "Sollecito Rossi Srl", "text": "seconda versione"})
    assert "Sollecito-Rossi-Srl-2.docx" in again.content, "never overwrites an existing draft"
    assert (await reg.execute("write_draft", {"title": " ", "text": "x"})).is_error
