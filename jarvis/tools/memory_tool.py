from __future__ import annotations

from . import ToolContext
from .base import ToolRegistry, ToolResult


def register(registry: ToolRegistry, ctx: ToolContext) -> None:
    @registry.tool()
    def remember(fact: str, category: str = "general") -> str:
        """Store a durable fact about the user for future conversations. Call it, unprompted, whenever the user
        shares something worth keeping: preferences, names of people, dates, plans, decisions, how they like
        things done. Write the fact as a complete, self-contained sentence.

        Args:
            fact: The fact, e.g. "The user's daughter is called Giulia and her birthday is 12 May."
            category: A short label: personal, work, preference, health, project, people, place, other.
        """
        fact_id = ctx.memory.remember(fact, category)
        return f"Remembered (#{fact_id})."

    @registry.tool()
    def recall(query: str = "") -> dict:
        """Search long-term memory for facts about the user. Call it before answering anything about the user's
        life, people, preferences, past instructions or earlier decisions. An empty query returns the latest facts.

        Args:
            query: Keywords to look for, e.g. "birthday", "coffee", "project deadline".
        """
        facts = ctx.memory.recall(query)
        return {
            "query": query,
            "facts": [{"id": f["id"], "fact": f["fact"], "category": f["category"]} for f in facts],
        }

    @registry.tool()
    def forget(fact_id: int) -> ToolResult:
        """Delete a remembered fact by id (use recall to find it). Call it when the user says a fact is wrong
        or asks you to forget something.

        Args:
            fact_id: The fact's numeric id.
        """
        return (
            ToolResult(f"Forgotten (#{fact_id}).")
            if ctx.memory.forget(fact_id)
            else ToolResult.error("No such fact.")
        )

    @registry.tool()
    def search_conversations(query: str) -> dict:
        """Search past conversations with the user. Call it for "what did we talk about…", "what did I ask you
        yesterday", or to find details from an earlier session.

        Args:
            query: Keywords to look for.
        """
        return {"query": query, "matches": ctx.memory.search_conversations(query)}
