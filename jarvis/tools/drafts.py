"""Drafts in Word: letters, emails, client notices and minutes written by Jarvis become ``.docx`` files in
``<workspace>/bozze``, ready to open in Word or LibreOffice. No extra dependency: a .docx is a ZIP of XML parts.
Lines starting with ``#`` become headings, ``- `` bullet points, ``**text**`` bold (the same rules as the web app)."""

from __future__ import annotations

import re
import unicodedata
import zipfile
from datetime import datetime
from pathlib import Path
from xml.sax.saxutils import escape

from . import ToolContext
from .base import ToolRegistry, ToolResult

FOLDER = "bozze"
MONTHS = ["gennaio", "febbraio", "marzo", "aprile", "maggio", "giugno", "luglio", "agosto", "settembre", "ottobre", "novembre", "dicembre"]

CONTENT_TYPES = (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>'
    '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'
)
RELS = (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'
)


def file_name(title: str) -> str:
    text = unicodedata.normalize("NFKD", title or "").encode("ascii", "ignore").decode()
    text = re.sub(r"[^\w\- ]+", "", text).strip()
    return (re.sub(r"\s+", "-", text)[:60] or "bozza") + ".docx"


def _run(text: str, bold: bool = False, size: int = 0) -> str:
    props = '<w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/>' + ("<w:b/>" if bold else "") + (f'<w:sz w:val="{size}"/>' if size else "")
    return f'<w:r><w:rPr>{props}</w:rPr><w:t xml:space="preserve">{escape(text)}</w:t></w:r>'


def _runs(line: str, bold: bool = False, size: int = 0) -> str:
    parts = [p for p in re.split(r"(\*\*[^*]+\*\*)", line) if p]
    return "".join(_run(p[2:-2], True, size) if p.startswith("**") and p.endswith("**") and len(p) > 4 else _run(p, bold, size) for p in parts)


def _para(inner: str, after: int = 120, indent: int = 0) -> str:
    ind = f'<w:ind w:left="{indent}" w:hanging="240"/>' if indent else ""
    return f'<w:p><w:pPr><w:spacing w:after="{after}"/>{ind}</w:pPr>{inner}</w:p>'


def document_xml(title: str, body: str, date_line: str = "") -> str:
    out = [_para(_run(title, True, 32), after=80)]
    if date_line:
        out.append(_para(_run(date_line, size=18), after=240))
    for raw in (body or "").replace("\r", "").split("\n"):
        line = raw.rstrip()
        heading = re.match(r"^(#{1,3})\s+(.*)$", line)
        bullet = re.match(r"^\s*(?:[-*•]|\d+[.)])\s+(.*)$", line)
        if not line.strip():
            out.append(_para("", after=60))
        elif heading:
            out.append(_para(_runs(heading.group(2), True, 28 if len(heading.group(1)) == 1 else 24), after=100))
        elif bullet:
            out.append(_para(_run("• ") + _runs(bullet.group(1)), indent=360))
        else:
            out.append(_para(_runs(line)))
    section = '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1417" w:right="1134" w:bottom="1134" w:left="1134" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr>'
    return (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
        f"<w:body>{''.join(out)}{section}</w:body></w:document>"
    )


def write_docx(path: Path, title: str, body: str, date_line: str = "") -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("[Content_Types].xml", CONTENT_TYPES)
        z.writestr("_rels/.rels", RELS)
        z.writestr("word/document.xml", document_xml(title, body, date_line))
    return path


def italian_date(now: datetime | None = None) -> str:
    now = now or datetime.now()
    return f"{now.day} {MONTHS[now.month - 1]} {now.year}"


def register(registry: ToolRegistry, ctx: ToolContext) -> None:
    workspace = ctx.settings.workspace

    @registry.tool()
    def write_draft(title: str, text: str) -> ToolResult:
        """Save a ready-to-use Word draft (.docx) in the workspace folder "bozze": letters, emails, client notices,
        minutes, reports. Use it whenever the user asks you to write, draft or prepare a text they will send or
        print. In the text, lines starting with "# " are headings, "- " bullet points, **text** is bold.

        Args:
            title: Document title, e.g. "Lettera di sollecito - Rossi Srl".
            text: The full text of the draft.
        """
        title, text = title.strip()[:140], text.strip()
        if not title or not text:
            return ToolResult.error("title and text are required")
        folder = workspace / FOLDER
        path = folder / file_name(title)
        n = 2
        while path.exists():
            path = folder / file_name(f"{title} {n}")
            n += 1
        write_docx(path, title, text, italian_date())
        return ToolResult(f"Draft saved: {FOLDER}/{path.name} ({len(text)} characters). Tell the user where to find it.")
