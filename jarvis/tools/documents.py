"""Document search over Jarvis' workspace: PDFs, Word files and text, indexed and searched locally with BM25.

Nothing leaves the machine. PDF text needs the optional ``pypdf`` package (``pip install jarvis-ai[docs]``);
Word (.docx) and plain-text formats need nothing beyond the standard library.
"""

from __future__ import annotations

import html
import math
import re
import unicodedata
import zipfile
from collections import Counter
from dataclasses import dataclass, field
from pathlib import Path

from . import ToolContext
from .base import ToolRegistry, ToolResult

TEXT_EXT = {".txt", ".md", ".csv", ".tsv", ".json", ".xml", ".html", ".htm", ".eml", ".log", ".rtf", ".yaml", ".yml"}
DOC_EXT = TEXT_EXT | {".pdf", ".docx"}
MAX_BYTES = 40 * 1024 * 1024
MAX_FILES = 3000

_STOP_WORDS = (
    "a ad al alla alle allo agli ai anche avere che chi ci con come cosa da dal dalla dalle dei del della delle "
    "dello degli di e ed era essere gli ha hanno ho i il in io la le lei li lo loro lui ma mi mia mio ne nei nel "
    "nella nelle no noi non nostro o per perche più piu poi quale quali quando quanto quello questa questo se sei "
    "si sia siamo sono su sua sue sui sul sulla suo tra fra tu tua tuo un una uno vi voi è "
    "the of and to in is it that for on as with was be by are this an or at from which not have has can will you "
    "your what who how"
)
STOP = set(_STOP_WORDS.split())


def _fold(s: str) -> str:
    return "".join(c for c in unicodedata.normalize("NFD", s.lower()) if unicodedata.category(c) != "Mn")


def _stem(w: str) -> str:
    if len(w) > 5:
        w = re.sub(r"(zioni|zione|mente|menti|ità|ita)$", "", w)
        return re.sub(r"[aeiou]$", "", w)
    if len(w) >= 4:
        return re.sub(r"[aeio]$", "", w)
    return w


def tokens(text: str) -> list[str]:
    """Lower-case, accent-folded, stop-word-free, lightly stemmed words (Italian and English)."""
    return [_stem(w) for w in re.split(r"[^a-z0-9]+", _fold(text)) if w and w not in STOP and (len(w) > 1 or w.isdigit())]


# ---------------------------------------------------------------- extraction
def _docx_text(path: Path) -> str:
    with zipfile.ZipFile(path) as z:
        xml = z.read("word/document.xml").decode("utf-8", errors="replace")
    xml = re.sub(r"</w:p>", "\n", xml)
    xml = re.sub(r"<w:tab/>", "\t", xml)
    xml = re.sub(r"<w:br[^>]*/>", "\n", xml)
    return html.unescape(re.sub(r"<[^>]+>", "", xml))


def _pdf_pages(path: Path) -> list[str]:
    try:
        from pypdf import PdfReader
    except ImportError as exc:  # pragma: no cover - depends on the optional extra
        raise RuntimeError("reading PDFs needs the 'pypdf' package: pip install 'jarvis-ai[docs]'") from exc
    reader = PdfReader(str(path))
    return [(page.extract_text() or "") for page in reader.pages]


def extract_pages(path: Path) -> list[str]:
    """Text of a document, one string per page (a single string for formats without pages)."""
    ext = path.suffix.lower()
    if ext == ".pdf":
        return _pdf_pages(path)
    if ext == ".docx":
        return [_docx_text(path)]
    text = path.read_text(encoding="utf-8", errors="replace")
    if ext in {".html", ".htm", ".xml"}:
        text = html.unescape(re.sub(r"<(script|style)[\s\S]*?</\1>|<[^>]+>", " ", text))
    elif ext == ".rtf":
        text = re.sub(r"\\par[d]?", "\n", text)
        text = re.sub(r"\{\\[^{}]*\}|\\[a-z]+-?\d* ?|[{}]", "", text)
    return [text]


def chunk(pages: list[str], size: int = 900, overlap: int = 150) -> list[tuple[int | None, str]]:
    """Split pages into ~``size``-character passages that overlap, cutting at sentence ends when possible."""
    out: list[tuple[int | None, str]] = []
    for index, raw in enumerate(pages):
        text = re.sub(r"\n{3,}", "\n\n", re.sub(r"[ \t]+", " ", raw)).strip()
        start = 0
        while start < len(text):
            end = min(len(text), start + size)
            if end < len(text):
                cut = max(text.rfind(". ", start, end), text.rfind("\n", start, end))
                if cut > start + size * 0.5:
                    end = cut + 1
            out.append((index + 1 if len(pages) > 1 else None, text[start:end].strip()))
            if end >= len(text):
                break
            start = max(end - overlap, start + 1)
    return out


# ---------------------------------------------------------------- index
@dataclass
class Passage:
    file: str
    page: int | None
    text: str
    tf: Counter = field(repr=False)
    length: int = 0


class DocumentIndex:
    """BM25 index of the workspace, refreshed incrementally: only new or changed files are re-read."""

    def __init__(self, root: Path) -> None:
        self.root = root
        self._files: dict[str, tuple[float, int, list[Passage]]] = {}
        self.errors: dict[str, str] = {}

    def refresh(self) -> None:
        seen: set[str] = set()
        count = 0
        if not self.root.exists():
            self._files.clear()
            return
        for path in sorted(self.root.rglob("*")):
            rel = path.relative_to(self.root).as_posix()
            if any(part.startswith(".") for part in path.relative_to(self.root).parts):
                continue
            if not path.is_file() or path.suffix.lower() not in DOC_EXT:
                continue
            count += 1
            if count > MAX_FILES:
                break
            stat = path.stat()
            if stat.st_size > MAX_BYTES:
                self.errors[rel] = "larger than 40 MB"
                continue
            seen.add(rel)
            cached = self._files.get(rel)
            if cached and cached[0] == stat.st_mtime and cached[1] == stat.st_size:
                continue
            try:
                passages = [Passage(rel, page, text, Counter(tokens(text))) for page, text in chunk(extract_pages(path))]
            except Exception as exc:  # noqa: BLE001 - one unreadable file must not break the index
                self.errors[rel] = str(exc)
                passages = []
            else:
                self.errors.pop(rel, None)
            for p in passages:
                p.length = sum(p.tf.values())
            self._files[rel] = (stat.st_mtime, stat.st_size, passages)
        for rel in set(self._files) - seen:
            del self._files[rel]

    @property
    def files(self) -> list[str]:
        return sorted(self._files)

    def search(self, query: str, limit: int = 5, file: str = "") -> list[tuple[float, Passage]]:
        self.refresh()
        passages = [p for _, _, ps in self._files.values() for p in ps]
        terms = set(tokens(query))
        if not terms or not passages:
            return []
        df: Counter = Counter()
        for p in passages:
            df.update(set(p.tf))
        n = len(passages)
        avg = sum(p.length for p in passages) / n or 1
        k1, b = 1.4, 0.75
        wanted = _fold(file)
        scored = []
        for p in passages:
            if wanted and wanted not in _fold(p.file):
                continue
            name = set(tokens(Path(p.file).stem))
            score = 0.0
            for term in terms:
                f = p.tf.get(term, 0)
                if f:
                    idf = math.log(1 + (n - df[term] + 0.5) / (df[term] + 0.5))
                    score += idf * f * (k1 + 1) / (f + k1 * (1 - b + b * p.length / avg))
                if term in name:
                    score += 0.6
            if score > 0:
                scored.append((score, p))
        scored.sort(key=lambda sp: sp[0], reverse=True)
        return scored[:limit]


def register(registry: ToolRegistry, ctx: ToolContext) -> None:
    index = DocumentIndex(ctx.settings.workspace)

    @registry.tool()
    def search_documents(query: str, file: str = "", limit: int = 5) -> ToolResult:
        """Search the user's documents in the workspace (PDF, Word .docx, text, Markdown, CSV, HTML, email) and
        return the most relevant passages with file name and page. Call it whenever the user asks what a contract,
        report, invoice, letter or any of their files says, asks for a clause, a figure or a date in their papers,
        or wants a summary of a document. Answer from the passages and cite them as (file, p. N).

        Args:
            query: What to look for, in the user's words (e.g. "preavviso per il recesso", "fatturato 2025").
            file: Optional part of a file name to restrict the search to one document.
            limit: How many passages to return (1-10).
    """
        hits = index.search(query, max(1, min(int(limit), 10)), file)
        if not hits:
            if not index.files:
                return ToolResult(
                    f"No documents in the workspace ({index.root}). Ask the user to copy PDF, Word or text files there."
                )
            return ToolResult(f"No passage matches '{query}'. Documents available: {', '.join(index.files[:30])}.")
        lines = []
        for i, (score, p) in enumerate(hits, 1):
            where = p.file + (f", p. {p.page}" if p.page else "")
            lines.append(f"[{i}] ({where}; score {score:.1f})\n{p.text}")
        return ToolResult("\n\n".join(lines))

    @registry.tool()
    def list_documents() -> ToolResult:
        """List the documents Jarvis can search in the workspace, with any that could not be read.
        Call it when the user asks which documents or files you have access to."""
        index.refresh()
        if not index.files:
            return ToolResult(f"No documents in the workspace ({index.root}).")
        out = "Documents: " + "; ".join(index.files[:200])
        if index.errors:
            out += "\nUnreadable: " + "; ".join(f"{k} ({v})" for k, v in list(index.errors.items())[:20])
        return ToolResult(out)
