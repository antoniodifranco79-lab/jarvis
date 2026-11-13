"""Wiring: one object that owns settings, memory, tools, brain and the reminder ticker."""

from __future__ import annotations

import logging
from typing import Any

from .brain import Brain
from .config import Settings, get_settings
from .events import EventBus
from .memory import Memory
from .persona import greeting
from .reminders import ReminderService
from .tools import Approver, ToolContext, build_registry

log = logging.getLogger(__name__)


class Jarvis:
    def __init__(
        self,
        settings: Settings | None = None,
        *,
        mode: str = "voice",
        approver: Approver | None = None,
        client: Any | None = None,
        memory: Memory | None = None,
    ) -> None:
        self.settings = settings or get_settings()
        self.settings.ensure_dirs()
        self.bus = EventBus()
        self.memory = memory or Memory(self.settings.db_path)
        self.registry = build_registry(ToolContext(self.settings, self.memory, self.bus))
        self.brain = Brain(
            self.settings, self.memory, self.bus, self.registry, client=client, mode=mode, approver=approver
        )
        self.reminders = ReminderService(self.memory, self.bus)

    async def start(self) -> None:
        self.reminders.start()
        await self.connect_mcp()

    async def connect_mcp(self) -> int:
        """Register the tools of the MCP servers in ~/.jarvis/mcp.json (any server of the MCP ecosystem)."""
        from .mcp_client import MCPHub, load_config

        try:
            config = load_config(self.settings.data_dir)
        except (OSError, ValueError) as exc:
            log.warning("invalid MCP config: %s", exc)
            return 0
        if not config:
            return 0
        self.mcp = MCPHub(self.registry)
        added = await self.mcp.connect(config)
        if added:
            self.brain.refresh_tools()
        log.info("MCP: %d tools from %d servers", added, len(self.mcp.servers))
        return added

    async def stop(self) -> None:
        if getattr(self, "mcp", None):
            await self.mcp.close()
        await self.reminders.stop()
        self.memory.close()

    def greeting(self, language: str | None = None) -> str:
        return greeting(self.settings, language=language)

    @property
    def approver(self) -> Approver | None:
        return self.brain.approver

    @approver.setter
    def approver(self, value: Approver | None) -> None:
        self.brain.approver = value
