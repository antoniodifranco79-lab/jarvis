from __future__ import annotations

from datetime import datetime, timedelta
from typing import Literal

import pytest

from jarvis.events import EventBus
from jarvis.tools import ToolContext, build_registry
from jarvis.tools.base import ToolRegistry, ToolResult, build_schema
from jarvis.tools.calc import safe_eval
from jarvis.tools.files import resolve_in
from jarvis.tools.reminders_tool import parse_when


def test_schema_generation_from_signature():
    def demo(city: str, days: int = 3, unit: Literal["c", "f"] = "c", tags: list[str] | None = None) -> str:
        """Do a thing.

        Args:
            city: Where.
            days: How many.
            unit: Which unit.
        """

    description, schema = build_schema(demo)
    assert description == "Do a thing."
    assert schema["required"] == ["city"]
    assert schema["properties"]["city"] == {"type": "string", "description": "Where."}
    assert schema["properties"]["days"] == {"type": "integer", "description": "How many.", "default": 3}
    assert schema["properties"]["unit"]["enum"] == ["c", "f"]
    assert schema["properties"]["tags"]["type"] == "array"
    assert schema["additionalProperties"] is False


async def test_registry_validation_and_execution():
    reg = ToolRegistry()

    @reg.tool()
    def add(a: int, b: int = 1) -> int:
        """Add numbers."""
        return a + b

    @reg.tool(dangerous=True)
    async def boom() -> str:
        """Dangerous."""
        return "ran"

    assert reg.names() == ["add", "boom"]
    assert (await reg.execute("add", {"a": 2})).content == "3"
    bad = await reg.execute("add", {"a": "two"})
    assert bad.is_error and "INVALID_INPUT" in bad.content
    assert (await reg.execute("nope", {})).is_error
    declined = await reg.execute("boom", {})
    assert declined.is_error

    async def yes(name, args):
        return True

    assert (await reg.execute("boom", {}, approver=yes)).content == "ran"
    assert (await reg.execute("boom", {}, auto_approve=True)).content == "ran"


async def test_tool_exceptions_become_error_results():
    reg = ToolRegistry()

    @reg.tool(timeout=0.2)
    async def slow() -> str:
        """Slow."""
        import asyncio

        await asyncio.sleep(1)
        return "late"

    @reg.tool()
    def broken() -> str:
        """Broken."""
        raise RuntimeError("kaboom")

    assert "timed out" in (await reg.execute("slow", {})).content
    res = await reg.execute("broken", {})
    assert res.is_error and "kaboom" in res.content


def test_builtin_registry(settings, memory):
    reg = build_registry(ToolContext(settings, memory, EventBus()))
    names = reg.names()
    for expected in (
        "calculate",
        "get_datetime",
        "get_weather",
        "list_reminders",
        "recall",
        "remember",
        "run_shell",
        "set_reminder",
        "system_status",
        "look",
        "open_url",
        "read_file",
        "write_file",
    ):
        assert expected in names
    assert "home_assistant" not in names  # not configured
    defs = reg.definitions()
    assert all("description" in d and d["input_schema"]["type"] == "object" for d in defs)


@pytest.mark.parametrize(
    "expr,expected",
    [
        ("2+2", 4),
        ("2^10", 1024),
        ("sqrt(16)", 4),
        ("10 / 4", 2.5),
        ("150 * 0.22", 33),
        ("round(pi, 2)", 3.14),
    ],
)
def test_safe_eval(expr, expected):
    assert safe_eval(expr) == expected


def test_safe_eval_rejects_code():
    with pytest.raises((ValueError, SyntaxError)):
        safe_eval("__import__('os').system('ls')")


def test_files_sandbox(tmp_path):
    root = tmp_path / "ws"
    root.mkdir()
    assert resolve_in(root, "notes/todo.txt") == (root / "notes/todo.txt").resolve()
    with pytest.raises(PermissionError):
        resolve_in(root, "../secret.txt")
    with pytest.raises(PermissionError):
        resolve_in(root, "/etc/passwd")


async def test_file_tools_roundtrip(settings, memory):
    reg = build_registry(ToolContext(settings, memory, EventBus()))
    out = await reg.execute("write_file", {"path": "notes/a.txt", "content": "ciao"})
    assert not out.is_error
    out = await reg.execute("write_file", {"path": "notes/a.txt", "content": " mondo", "append": True})
    assert (await reg.execute("read_file", {"path": "notes/a.txt"})).content == "ciao mondo"
    listing = await reg.execute("list_files", {"path": "notes"})
    assert "a.txt" in listing.content
    assert (await reg.execute("read_file", {"path": "../../etc/passwd"})).is_error


def test_parse_when():
    now = datetime(2026, 3, 4, 10, 0, 0)
    assert parse_when("", 90, now) == now + timedelta(seconds=90)
    assert parse_when("2026-03-04T18:30:00", 0, now) == datetime(2026, 3, 4, 18, 30)
    assert parse_when("tomorrow", 0, now) is None


async def test_reminder_and_memory_tools(settings, memory):
    reg = build_registry(ToolContext(settings, memory, EventBus()))
    res = await reg.execute("set_reminder", {"message": "Tea", "delay_seconds": 60})
    assert "Reminder #1" in res.content
    assert (await reg.execute("set_reminder", {"message": "x", "at": "2001-01-01T00:00:00"})).is_error
    listing = await reg.execute("list_reminders", {})
    assert "Tea" in listing.content
    assert "cancelled" in (await reg.execute("cancel_reminder", {"reminder_id": 1})).content
    await reg.execute("remember", {"fact": "The user drinks espresso, no sugar.", "category": "preference"})
    recalled = await reg.execute("recall", {"query": "espresso"})
    assert "no sugar" in recalled.content
    assert "Forgotten" in (await reg.execute("forget", {"fact_id": 1})).content


def test_tool_result_preview():
    assert ToolResult("a" * 500).preview(20).endswith("…")
    assert ToolResult.image("AAAA", caption="shot").preview() == "[image] shot"
