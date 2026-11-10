from __future__ import annotations

import asyncio
import re
import xml.etree.ElementTree as ET

import httpx

from . import ToolContext
from .base import ToolRegistry, ToolResult

_TAGS = re.compile(r"<[^>]+>")


def parse_feed(xml_text: str, limit: int) -> list[dict]:
    root = ET.fromstring(xml_text)
    items: list[dict] = []
    ns = {"atom": "http://www.w3.org/2005/Atom"}
    for item in root.iter("item"):  # RSS 2.0
        title = (item.findtext("title") or "").strip()
        desc = _TAGS.sub("", item.findtext("description") or "").strip()
        if title:
            items.append(
                {"title": title, "summary": desc[:240], "link": (item.findtext("link") or "").strip()}
            )
    if not items:  # Atom
        for entry in root.findall("atom:entry", ns):
            title = (entry.findtext("atom:title", default="", namespaces=ns) or "").strip()
            summary = _TAGS.sub("", entry.findtext("atom:summary", default="", namespaces=ns) or "").strip()
            link_el = entry.find("atom:link", ns)
            if title:
                items.append(
                    {
                        "title": title,
                        "summary": summary[:240],
                        "link": link_el.get("href", "") if link_el is not None else "",
                    }
                )
    return items[:limit]


async def fetch_feed(url: str, limit: int) -> dict:
    async with httpx.AsyncClient(
        timeout=15, follow_redirects=True, headers={"User-Agent": "jarvis-ai/1.0"}
    ) as client:
        r = await client.get(url)
        r.raise_for_status()
    return {"feed": url, "items": parse_feed(r.text, limit)}


def register(registry: ToolRegistry, ctx: ToolContext) -> None:
    @registry.tool(timeout=30)
    async def get_news(limit: int = 5, feed_url: str = "") -> ToolResult:
        """Latest headlines from the configured news feeds (RSS). Call it for "what's in the news", "headlines",
        "any news this morning". For news about a *specific* topic, prefer web_search.

        Args:
            limit: Headlines per feed (1-15).
            feed_url: Optional specific RSS/Atom feed URL instead of the configured ones.
        """
        urls = [feed_url] if feed_url else ctx.settings.news_feeds
        if not urls:
            return ToolResult.error("No news feeds configured.")
        results = await asyncio.gather(
            *(fetch_feed(u, max(1, min(limit, 15))) for u in urls), return_exceptions=True
        )
        feeds = []
        for url, res in zip(urls, results, strict=True):
            feeds.append({"feed": url, "error": str(res)} if isinstance(res, Exception) else res)
        import json

        return ToolResult(json.dumps(feeds, ensure_ascii=False))
