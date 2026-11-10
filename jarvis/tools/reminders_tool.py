from __future__ import annotations

from datetime import datetime, timedelta

from . import ToolContext
from .base import ToolRegistry, ToolResult


def parse_when(at: str, delay_seconds: int, now: datetime | None = None) -> datetime | None:
    now = now or datetime.now()
    if delay_seconds and delay_seconds > 0:
        return now + timedelta(seconds=delay_seconds)
    if at:
        try:
            dt = datetime.fromisoformat(at.strip())
        except ValueError:
            return None
        if dt.tzinfo is not None:
            dt = dt.astimezone().replace(tzinfo=None)
        return dt
    return None


def register(registry: ToolRegistry, ctx: ToolContext) -> None:
    @registry.tool()
    def set_reminder(message: str, at: str = "", delay_seconds: int = 0) -> ToolResult:
        """Schedule a reminder or a timer. Jarvis will announce ``message`` aloud when it is due.
        Call it for "remind me to…", "set a timer for 10 minutes", "wake me at 7", "in two hours tell me…".
        Give either an absolute time (computed from the current date/time in the context) or a delay.

        Args:
            message: What to say when the reminder fires, e.g. "Call the dentist" or "Timer: pasta is ready".
            at: Absolute local date-time in ISO 8601, e.g. "2026-03-04T18:30:00". Leave empty when using delay_seconds.
            delay_seconds: Fire this many seconds from now (timers). Leave 0 when using ``at``.
        """
        due = parse_when(at, delay_seconds)
        if due is None:
            return ToolResult.error(
                "Provide either a valid ISO date-time in 'at' or a positive 'delay_seconds'."
            )
        if due <= datetime.now():
            return ToolResult.error(f"{due.isoformat(timespec='minutes')} is already in the past.")
        reminder = ctx.memory.add_reminder(message.strip(), due)
        return ToolResult(
            f"Reminder #{reminder.id} set for {due.strftime('%A %d %B %Y at %H:%M:%S')}: {message}"
        )

    @registry.tool()
    def list_reminders() -> dict:
        """List pending reminders and timers. Call it for "what reminders do I have", "any timers running?"."""
        return {
            "now": datetime.now().isoformat(timespec="seconds"),
            "reminders": [
                {"id": r.id, "message": r.message, "due_at": r.due_at.isoformat(timespec="seconds")}
                for r in ctx.memory.pending_reminders()
            ],
        }

    @registry.tool()
    def cancel_reminder(reminder_id: int) -> ToolResult:
        """Cancel a pending reminder or timer by its id (use list_reminders to find it).

        Args:
            reminder_id: The reminder's numeric id.
        """
        if ctx.memory.cancel_reminder(reminder_id):
            return ToolResult(f"Reminder #{reminder_id} cancelled.")
        return ToolResult.error(f"No pending reminder with id {reminder_id}.")
