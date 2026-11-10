"""Reminders and timers: a background ticker that fires due reminders onto the event bus."""

from __future__ import annotations

import asyncio
import contextlib
import logging
from datetime import datetime

from .events import EventBus
from .memory import Memory

log = logging.getLogger(__name__)


class ReminderService:
    def __init__(self, memory: Memory, bus: EventBus, poll_seconds: float = 1.0) -> None:
        self.memory = memory
        self.bus = bus
        self.poll_seconds = poll_seconds
        self._task: asyncio.Task[None] | None = None

    def start(self) -> None:
        if self._task is None or self._task.done():
            self._task = asyncio.create_task(self._run(), name="jarvis-reminders")

    async def stop(self) -> None:
        if self._task:
            self._task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await self._task
            self._task = None

    async def tick(self, now: datetime | None = None) -> int:
        """Fire everything that is due. Returns how many reminders fired."""
        fired = 0
        for reminder in self.memory.due_reminders(now):
            self.memory.mark_fired(reminder.id)
            fired += 1
            await self.bus.publish(
                "reminder", id=reminder.id, message=reminder.message, due_at=reminder.due_at.isoformat()
            )
        return fired

    async def _run(self) -> None:
        while True:
            try:
                await self.tick()
            except Exception:  # noqa: BLE001
                log.exception("reminder tick failed")
            await asyncio.sleep(self.poll_seconds)
