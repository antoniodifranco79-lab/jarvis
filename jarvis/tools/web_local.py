"""Local web search and page reading, for brains without Anthropic's server-side web tools (Ollama).

Search uses DuckDuckGo through the ``ddgs`` package when installed, else DuckDuckGo's HTML endpoint.
"""

from __future__ import annotations

import asyncio
import html
import json
import re
from urllib.parse import unquote

import httpx

from . import ToolContext
from .base import ToolRegistry, ToolResult

UA = "Mozilla/5.0 (compatible; jarvis-ai/1.0)"
MAX_PAGE = 8000
_RESULT = re.compile(r'<a rel="nofollow" class="result__a" href="([^"]+)"[^>]*>(.*?)</a>', re.S)
_SNIPPET = re.compile(r'<a class="result__snippet"[^>]*>(.*?)</a>', re.S)
_TAGS = re.compile(r"<[^>]+>")


def _clean(fragment: str) -> str:
    return html.unescape(_TAGS.sub("", fragment)).strip()


def _ddg_href(href: str) -> str:
    m = re.search(r"uddg=([^&]+)", href)
    return unquote(m.group(1)) if m else href


async def search(query: str, max_results: int = 5) -> list[dict[str, str]]:
    try:
        try:
            from ddgs import DDGS  # type: ignore[import-not-found]
        except ImportError:
            from duckduckgo_search import DDGS  # type: ignore[import-not-found]

        raw = await asyncio.to_thread(lambda: list(DDGS().text(query, max_results=max_results)))
        return [
            {"title": r.get("title", ""), "url": r.get("href", ""), "snippet": r.get("body", "")} for r in raw
        ]
    except ImportError:
        pass
    async with httpx.AsyncClient(timeout=20, follow_redirects=True, headers={"User-Agent": UA}) as client:
        r = await client.post("https://html.duckduckgo.com/html/", data={"q": query})
        r.raise_for_status()
    results = []
    snippets = _SNIPPET.findall(r.text)
    for i, (href, title) in enumerate(_RESULT.findall(r.text)[:max_results]):
        results.append(
            {
                "title": _clean(title),
                "url": _ddg_href(href),
                "snippet": _clean(snippets[i]) if i < len(snippets) else "",
            }
        )
    return results


async def fetch_text(url: str, max_chars: int = MAX_PAGE) -> str:
    async with httpx.AsyncClient(timeout=25, follow_redirects=True, headers={"User-Agent": UA}) as client:
        r = await client.get(url)
        r.raise_for_status()
        body = r.text
    body = re.sub(r"<(script|style|noscript)[^>]*>.*?</\1>", " ", body, flags=re.S | re.I)
    body = re.sub(r"<br\s*/?>|</p>|</div>|</li>|</h\d>", "\n", body, flags=re.I)
    text = html.unescape(_TAGS.sub(" ", body))
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r"\n\s*\n+", "\n", text).strip()
    return text[:max_chars] + (
        f"\n… [truncated, {len(text) - max_chars} more characters]" if len(text) > max_chars else ""
    )


def register(registry: ToolRegistry, ctx: ToolContext) -> None:
    if ctx.settings.resolved_provider == "anthropic":
        return  # Claude uses Anthropic's server-side web_search / web_fetch instead

    @registry.tool(timeout=40)
    async def web_search(query: str, max_results: int = 5) -> ToolResult:
        """Search the web. Call it for anything current or factual you aren't sure about: news, prices,
        scores, opening hours, "what is X", recent events. Then read a result with web_fetch if the
        snippets aren't enough.

        Args:
            query: Search terms, in the user's language or English.
            max_results: How many results to return (1-10).
        """
        results = await search(query, max(1, min(max_results, 10)))
        if not results:
            return ToolResult.error("No results.")
        return ToolResult(json.dumps(results, ensure_ascii=False))

    @registry.tool(timeout=40)
    async def web_fetch(url: str) -> ToolResult:
        """Read a web page and return its text. Call it after web_search to read an article, or when the
        user gives you a link.

        Args:
            url: The page's full URL.
        """
        return ToolResult(await fetch_text(url))
