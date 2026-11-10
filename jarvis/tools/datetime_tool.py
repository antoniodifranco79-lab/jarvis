from __future__ import annotations

from datetime import datetime
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from . import ToolContext
from .base import ToolRegistry


def current_time(tz_name: str = "") -> datetime:
    if tz_name:
        try:
            return datetime.now(ZoneInfo(tz_name))
        except (ZoneInfoNotFoundError, ValueError):
            pass
    return datetime.now().astimezone()


def register(registry: ToolRegistry, ctx: ToolContext) -> None:
    @registry.tool()
    def get_datetime(timezone: str = "") -> dict:
        """Get the current date and time. Call it for "what time is it", "what day is today",
        time differences between cities, or whenever you need the exact current moment.

        Args:
            timezone: IANA time zone such as "Europe/Rome" or "America/New_York". Empty = the user's local zone.
        """
        now = current_time(timezone or ctx.settings.timezone)
        return {
            "iso": now.isoformat(timespec="seconds"),
            "date": now.strftime("%A %d %B %Y"),
            "time": now.strftime("%H:%M"),
            "timezone": str(now.tzinfo),
            "utc_offset": now.strftime("%z"),
            "week_number": now.isocalendar().week,
            "unix": int(now.timestamp()),
        }
