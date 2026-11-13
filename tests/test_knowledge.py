"""Jarvis learns: notes saved in the workspace, updated by title, listed, forgotten and found by document search."""

from __future__ import annotations

from jarvis.events import EventBus
from jarvis.tools import ToolContext, build_registry
from jarvis.tools.knowledge import list_notes, slugify


def test_slugify():
    assert slugify("Scadenze IMU 2026: acconto & saldo") == "scadenze-imu-2026-acconto-saldo"
    assert slugify("!!!") == "voce"


async def test_learn_update_list_forget_and_search(settings, memory):
    reg = build_registry(ToolContext(settings, memory, EventBus()))
    assert {"learn", "list_knowledge", "forget_knowledge"} <= set(reg.names())
    out = await reg.execute("learn", {"title": "Scadenze IMU 2026", "content": "Acconto entro il 16 giugno 2026.", "source": "https://www.finanze.gov.it"})
    assert "Learned" in out.content
    out = await reg.execute("learn", {"title": "Scadenze IMU 2026", "content": "Acconto entro il 16 giugno, saldo entro il 16 dicembre 2026."})
    assert "Updated" in out.content and "1 notes" in out.content
    notes = list_notes(settings.workspace)
    assert len(notes) == 1 and notes[0]["title"] == "Scadenze IMU 2026" and "16 dicembre" in notes[0]["content"]
    assert "Scadenze IMU 2026" in (await reg.execute("list_knowledge", {})).content
    hit = await reg.execute("search_documents", {"query": "saldo IMU dicembre"})
    assert "conoscenza/scadenze-imu-2026.md" in hit.content
    assert "Forgotten" in (await reg.execute("forget_knowledge", {"title": "Scadenze IMU 2026"})).content
    assert list_notes(settings.workspace) == []
    assert (await reg.execute("forget_knowledge", {"title": "../../etc/passwd"})).is_error
