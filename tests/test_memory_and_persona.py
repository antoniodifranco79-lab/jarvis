from __future__ import annotations

from datetime import datetime, timedelta

from jarvis.events import EventBus, State
from jarvis.memory import Memory, fingerprint
from jarvis.persona import build_system_prompt, greeting
from jarvis.reminders import ReminderService


def test_sessions_resume_rules():
    m = Memory(":memory:")
    fp = fingerprint("sys", "model", ["a", "b"])
    assert fp == fingerprint("sys", "model", ["b", "a"])
    s1, new = m.resume_or_start("voice", fp, idle_hours=6)
    assert new
    s2, new = m.resume_or_start("voice", fp, idle_hours=6)
    assert not new and s2.id == s1.id
    s3, new = m.resume_or_start("voice", "other-fp", idle_hours=6)
    assert new and s3.id != s1.id
    s4, new = m.resume_or_start("voice", "other-fp", idle_hours=0)
    assert new


def test_messages_and_search():
    m = Memory(":memory:")
    s = m.new_session("text", "fp")
    m.append_message(
        s.id,
        "user",
        [{"type": "text", "text": "Remind me about the dentist"}],
        text="Remind me about the dentist",
    )
    m.append_message(s.id, "assistant", [{"type": "text", "text": "Done."}])
    assert m.load_messages(s.id)[1] == {"role": "assistant", "content": [{"type": "text", "text": "Done."}]}
    assert m.transcript(s.id)[0]["text"].startswith("Remind")
    assert m.search_conversations("dentist")[0]["role"] == "user"
    assert m.estimate_tokens(s.id) > 0


def test_facts():
    m = Memory(":memory:")
    a = m.remember("Likes jazz", "preference")
    m.remember("Works at ACME", "work")
    assert [f["fact"] for f in m.recall("jazz")] == ["Likes jazz"]
    assert len(m.recall("")) == 2
    assert m.forget(a) and not m.forget(a)


async def test_reminder_service_fires_due_items():
    m = Memory(":memory:")
    bus = EventBus()
    seen = []
    bus.subscribe(lambda e: seen.append(e) if e.type == "reminder" else None)
    m.add_reminder("past", datetime.now() - timedelta(seconds=1))
    m.add_reminder("future", datetime.now() + timedelta(hours=1))
    svc = ReminderService(m, bus)
    assert await svc.tick() == 1
    assert seen[0].data["message"] == "past"
    assert [r.message for r in m.pending_reminders()] == ["future"]
    assert await svc.tick() == 0


async def test_event_bus_state_and_queues():
    bus = EventBus()
    q = bus.queue()
    await bus.set_state(State.THINKING)
    await bus.set_state(State.THINKING)  # no duplicate
    await bus.publish("text", text="hi")
    assert q.get_nowait().data["state"] == "thinking"
    assert q.get_nowait().type == "text"
    assert q.empty()


def test_persona_prompt(settings):
    settings.user_name = "Signore"
    settings.language = "it"
    prompt = build_system_prompt(settings, mode="voice")
    assert "Signore" in prompt and "Italian" in prompt and "no markdown" in prompt
    assert "Milano" in prompt
    text_prompt = build_system_prompt(settings, mode="text")
    assert "light markdown" in text_prompt
    assert build_system_prompt(settings, "voice") == prompt  # deterministic: cache-friendly


def test_greeting(settings):
    hello = greeting(settings, now=datetime(2026, 1, 1, 8, 0), language="en")
    assert hello.startswith("Good morning, Sir")
    ciao = greeting(settings, now=datetime(2026, 1, 1, 21, 0), language="it")
    assert "Buonasera" in ciao
