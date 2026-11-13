from __future__ import annotations

from pathlib import Path

from . import ToolContext
from .base import ToolRegistry, ToolResult

MAX_READ = 20_000


def resolve_in(root: Path, path: str) -> Path:
    """Resolve ``path`` inside ``root``; refuse anything that escapes it (``..``, absolute paths, symlinks)."""
    root = root.resolve()
    candidate = Path(path).expanduser()
    target = (candidate if candidate.is_absolute() else root / candidate).resolve()
    if target != root and root not in target.parents:
        raise PermissionError(f"'{path}' is outside the workspace {root}")
    return target


def register(registry: ToolRegistry, ctx: ToolContext) -> None:
    root = ctx.settings.workspace

    @registry.tool()
    def list_files(path: str = ".") -> dict:
        """List files and folders inside Jarvis' workspace (the only directory file tools can touch).
        Call it when the user asks what files exist, or before reading/writing to check names.

        Args:
            path: Folder relative to the workspace root.
        """
        target = resolve_in(root, path)
        if not target.exists():
            return {"path": path, "exists": False}
        entries = sorted(target.iterdir(), key=lambda p: (not p.is_dir(), p.name.lower()))
        return {
            "workspace": str(root),
            "path": path,
            "entries": [
                {
                    "name": p.name,
                    "type": "dir" if p.is_dir() else "file",
                    "size": p.stat().st_size if p.is_file() else None,
                }
                for p in entries[:200]
            ],
        }

    @registry.tool()
    def read_file(path: str) -> ToolResult:
        """Read a file from the workspace (text, PDF or Word .docx). Call it when the user asks to open, read, summarise
        or check a specific file; to find something across many documents use search_documents instead.

        Args:
            path: File path relative to the workspace root.
        """
        target = resolve_in(root, path)
        if not target.is_file():
            return ToolResult.error(f"No such file: {path}")
        if target.suffix.lower() in {".pdf", ".docx"}:
            from .documents import extract_pages

            try:
                pages = extract_pages(target)
            except Exception as exc:  # noqa: BLE001
                return ToolResult.error(f"Cannot read {path}: {exc}")
            text = "\n\n".join(f"[p. {i}] {t.strip()}" if len(pages) > 1 else t.strip() for i, t in enumerate(pages, 1))
        else:
            text = target.read_text(encoding="utf-8", errors="replace")
        if len(text) > MAX_READ:
            text = text[:MAX_READ] + f"\n… [truncated, {len(text) - MAX_READ} more characters]"
        return ToolResult(text)

    @registry.tool()
    def write_file(path: str, content: str, append: bool = False) -> str:
        """Create or overwrite a text file in the workspace (notes, lists, drafts, scripts). Call it when the
        user asks you to save, write down, note, draft, or append something to a file.

        Args:
            path: File path relative to the workspace root; folders are created as needed.
            content: The full text to write.
            append: True to add to the end of an existing file instead of replacing it.
        """
        target = resolve_in(root, path)
        target.parent.mkdir(parents=True, exist_ok=True)
        with open(target, "a" if append else "w", encoding="utf-8") as fh:
            fh.write(content)
        return f"{'Appended to' if append else 'Wrote'} {target.relative_to(root.resolve())} ({len(content)} characters)."
