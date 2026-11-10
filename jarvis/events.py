"""A tiny async event bus. The brain, the voice loop and the HUD talk through it."""

from __future__ import annotations

import asyncio
import contextlib
import logging
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from enum import Enum
from typing import Any

log = logging.getLogger(__name__)


class State(str, Enum):
    """What Jarvis is doing right now (drives the HUD's arc reactor)."""

    IDLE = "idle"
    LISTENING = "listening"
    TRANSCRIBING = "transcribing"
    THINKING = "thinking"
    TOOL = "tool"
    SPEAKING = "speaking"
    AWAITING_APPROVAL = "awaiting_approval"


@dataclass
class Event:
    type: str
    data: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return {"type": self.type, **self.data}


Listener = Callable[[Event], Awaitable[None] | None]


class EventBus:
    """Fan-out publish/subscribe. Listeners may be sync or async; failures never propagate."""

    def __init__(self) -> None:
        self._listeners: list[Listener] = []
        self._queues: list[asyncio.Queue[Event]] = []
        self.state: State = State.IDLE

    def subscribe(self, listener: Listener) -> Callable[[], None]:
        self._listeners.append(listener)

        def unsubscribe() -> None:
            with contextlib.suppress(ValueError):
                self._listeners.remove(listener)

        return unsubscribe

    def queue(self) -> asyncio.Queue[Event]:
        """A queue that receives every event (handy for WebSocket consumers)."""
        q: asyncio.Queue[Event] = asyncio.Queue()
        self._queues.append(q)
        return q

    def drop_queue(self, q: asyncio.Queue[Event]) -> None:
        with contextlib.suppress(ValueError):
            self._queues.remove(q)

    async def publish(self, type: str, **data: Any) -> None:
        event = Event(type, data)
        for q in list(self._queues):
            q.put_nowait(event)
        for listener in list(self._listeners):
            try:
                result = listener(event)
                if asyncio.iscoroutine(result):
                    await result
            except Exception:  # noqa: BLE001 - a broken listener must not break Jarvis
                log.exception("event listener failed for %s", type)

    async def set_state(self, state: State, **extra: Any) -> None:
        if state != self.state or extra:
            self.state = state
            await self.publish("state", state=state.value, **extra)
