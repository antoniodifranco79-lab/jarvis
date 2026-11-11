from __future__ import annotations

from conftest import FakeClient, text_message
from starlette.testclient import TestClient

from jarvis.app import Jarvis
from jarvis.memory import Memory
from jarvis.server.app import create_app


def make_app(settings):
    settings.tts_engine = "none"
    jarvis = Jarvis(
        settings, client=FakeClient([text_message("Good evening, Sir.")]), memory=Memory(":memory:")
    )
    return create_app(settings, jarvis=jarvis)


def test_routes(settings):
    with TestClient(make_app(settings)) as c:
        assert "J.A.R.V.I.S." in c.get("/").text
        assert c.get("/manifest.webmanifest").json()["name"] == "J.A.R.V.I.S."
        assert c.get("/icon.png").headers["content-type"] == "image/png"
        assert c.get("/favicon.ico").status_code == 200
        status = c.get("/api/status").json()
        assert status["model"] == "claude-opus-5-5" and "calculate" in status["tools"]
        assert c.get("/api/reminders").json() == []
        assert c.get("/api/memory").json() == []


def test_websocket_round_trip(settings):
    with TestClient(make_app(settings)) as c, c.websocket_connect("/ws") as ws:
        hello = ws.receive_json()
        assert hello["type"] == "hello" and hello["user_name"] == "Sir" and hello["greeting"]
        ws.send_json({"type": "ask", "text": "hello"})
        seen = []
        for _ in range(30):
            msg = ws.receive_json()
            seen.append(msg)
            if {"final", "speak"} <= {m["type"] for m in seen}:
                break
        kinds = [m["type"] for m in seen]
        assert "user" in kinds and "text" in kinds and "final" in kinds
        assert next(m for m in seen if m["type"] == "final")["text"] == "Good evening, Sir."
        assert next(m for m in seen if m["type"] == "speak")["text"] == "Good evening, Sir."
