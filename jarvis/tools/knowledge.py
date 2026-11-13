"""Jarvis' growing knowledge base: what he learns from the web, documents and the user, kept as Markdown notes
in ``<workspace>/conoscenza``. The notes are ordinary files, so ``search_documents`` finds them, the user can read
and edit them, and they survive a reinstall."""

from __future__ import annotations

import re
import unicodedata
from datetime import datetime
from pathlib import Path

from . import ToolContext
from .base import ToolRegistry, ToolResult

FOLDER = "conoscenza"
MAX_CONTENT = 8000


def slugify(title: str) -> str:
    text = unicodedata.normalize("NFKD", title).encode("ascii", "ignore").decode().lower()
    return re.sub(r"[^a-z0-9]+", "-", text).strip("-")[:80] or "voce"


def knowledge_dir(workspace: Path) -> Path:
    return workspace / FOLDER


def read_note(path: Path) -> dict:
    text = path.read_text(encoding="utf-8", errors="replace")
    title = text.splitlines()[0].lstrip("# ").strip() if text else path.stem
    source = re.search(r"^Fonte: (.*)$", text, re.M)
    body = text.split("\n\n", 2)[-1] if text.count("\n\n") >= 2 else text
    return {"title": title, "source": source.group(1).strip() if source else "", "content": body.strip(), "file": path.name}


def list_notes(workspace: Path) -> list[dict]:
    folder = knowledge_dir(workspace)
    if not folder.is_dir():
        return []
    notes = [read_note(p) | {"updated": p.stat().st_mtime} for p in folder.glob("*.md")]
    return sorted(notes, key=lambda n: n["updated"], reverse=True)


def register(registry: ToolRegistry, ctx: ToolContext) -> None:
    workspace = ctx.settings.workspace

    @registry.tool()
    def learn(title: str, content: str, source: str = "") -> ToolResult:
        """Save something you have learned into your knowledge base, so it is there in future conversations.
        Call it whenever you learn something useful and lasting: from a web search or a page you read, from a
        document, or from what the user teaches you (office procedures, clients, rules, decisions). Do not save
        small talk. Saving again with the same title updates the note.

        Args:
            title: Short, unique title (e.g. "Scadenze IMU 2026").
            content: Concise but self-contained note, with exact dates and figures.
            source: Where it comes from: a URL, a document name, or "the user".
        """
        title, content = title.strip()[:140], content.strip()[:MAX_CONTENT]
        if not title or not content:
            return ToolResult.error("title and content are required")
        folder = knowledge_dir(workspace)
        folder.mkdir(parents=True, exist_ok=True)
        path = folder / f"{slugify(title)}.md"
        existed = path.exists()
        stamp = datetime.now().strftime("%Y-%m-%d %H:%M")
        header = f"# {title}\n\nFonte: {source.strip() or 'non indicata'} · Aggiornato: {stamp}"
        path.write_text(f"{header}\n\n{content}\n", encoding="utf-8")
        count = len(list(folder.glob("*.md")))
        return ToolResult(f"{'Updated' if existed else 'Learned'}: {title} ({FOLDER}/{path.name}; {count} notes in the knowledge base).")

    @registry.tool()
    def list_knowledge(limit: int = 30) -> ToolResult:
        """List the notes in your knowledge base, most recent first. Call it when the user asks what you have
        learned or know about. To find notes on a topic, use search_documents (it searches the notes too).

        Args:
            limit: How many notes to list.
        """
        notes = list_notes(workspace)
        if not notes:
            return ToolResult("The knowledge base is empty.")
        lines = [f"- {n['title']} (source: {n['source'] or 'n/a'})" for n in notes[: max(1, min(int(limit), 200))]]
        return ToolResult(f"{len(notes)} notes:\n" + "\n".join(lines))

    @registry.tool()
    def forget_knowledge(title: str) -> ToolResult:
        """Delete a note from your knowledge base, when the user asks or when it is outdated.

        Args:
            title: The note's title (or its file name).
        """
        folder = knowledge_dir(workspace)
        for candidate in (folder / f"{slugify(title)}.md", folder / title):
            if candidate.is_file() and candidate.parent == folder:
                candidate.unlink()
                return ToolResult(f"Forgotten: {title}.")
        return ToolResult.error(f"No note titled '{title}'.")
