"""Jarvis' hands: every built-in tool, assembled into one registry."""

from __future__ import annotations

from dataclasses import dataclass

from ..config import Settings
from ..events import EventBus
from ..memory import Memory
from .base import Approver, Tool, ToolRegistry, ToolResult

__all__ = ["Approver", "Tool", "ToolContext", "ToolRegistry", "ToolResult", "build_registry"]


@dataclass
class ToolContext:
    settings: Settings
    memory: Memory
    bus: EventBus


def build_registry(ctx: ToolContext) -> ToolRegistry:
    """Register every built-in tool that the configuration allows."""
    from . import (
        apps,
        calc,
        datetime_tool,
        documents,
        drafts,
        files,
        home,
        knowledge,
        memory_tool,
        news,
        reminders_tool,
        system,
        vision,
        weather,
        web_local,
    )

    registry = ToolRegistry()
    for module in (
        datetime_tool,
        weather,
        system,
        files,
        documents,
        drafts,
        knowledge,
        reminders_tool,
        memory_tool,
        calc,
        news,
        apps,
        home,
        vision,
        web_local,
    ):
        module.register(registry, ctx)
    return registry
