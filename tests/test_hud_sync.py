"""The holographic HUD files must be identical in the desktop HUD, the browser app and the site."""

from __future__ import annotations

import importlib.util
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "jarvis" / "server" / "static" / "hud"


def load_sync():
    spec = importlib.util.spec_from_file_location("sync_hud", ROOT / "scripts" / "sync-hud.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_web_copies_match_source():
    for name in ("hud.css", "reactor.js"):
        assert (ROOT / "web" / "hud" / name).read_bytes() == (SRC / name).read_bytes(), f"run scripts/sync-hud.py ({name})"


def test_site_inlines_current_reactor():
    html = (ROOT / "site" / "index.html").read_text(encoding="utf-8")
    sync = load_sync()
    if sync.START in html:
        assert sync.inline_block() in html, "run scripts/sync-hud.py (site reactor)"


def test_desktop_hud_serves_shared_files(settings):
    from conftest import FakeClient, text_message
    from starlette.testclient import TestClient

    from jarvis.app import Jarvis
    from jarvis.memory import Memory
    from jarvis.server.app import create_app

    settings.tts_engine = "none"
    jarvis = Jarvis(settings, client=FakeClient([text_message("ok")]), memory=Memory(":memory:"))
    with TestClient(create_app(settings, jarvis=jarvis)) as c:
        assert "JarvisReactor" in c.get("/hud/reactor.js").text
        assert "--holo" in c.get("/hud/hud.css").text
