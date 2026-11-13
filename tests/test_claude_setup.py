"""Claude as the brain: saving the key, pinning the provider, the HUD endpoint and the CLI command."""

from __future__ import annotations

import os
import stat

from conftest import FakeClient, text_message
from starlette.testclient import TestClient

from jarvis import claude_setup, cli
from jarvis.app import Jarvis
from jarvis.memory import Memory
from jarvis.server.app import create_app

GOOD = "sk-ant-api03-" + "x" * 40


def test_save_user_env_replaces_and_keeps_lines(tmp_path):
    env = tmp_path / ".env"
    env.write_text("# my settings\nJARVIS_USER_NAME=Leonardo\nANTHROPIC_API_KEY=old\n")
    claude_setup.save_user_env({"ANTHROPIC_API_KEY": GOOD, "JARVIS_PROVIDER": "anthropic"}, env)
    lines = env.read_text().splitlines()
    assert lines == ["# my settings", "JARVIS_USER_NAME=Leonardo", f"ANTHROPIC_API_KEY={GOOD}", "JARVIS_PROVIDER=anthropic"]
    if os.name == "posix":
        assert stat.S_IMODE(env.stat().st_mode) == 0o600


async def test_check_key_rejects_malformed_keys_without_network():
    assert "sk-ant-" in await claude_setup.check_key("not-a-key", "claude-opus-5-5")


def test_activate_pins_provider(settings, tmp_path, monkeypatch):
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    monkeypatch.delenv("JARVIS_PROVIDER", raising=False)
    settings.provider = "auto"
    path = claude_setup.activate(GOOD, settings, tmp_path / ".env")
    assert settings.provider == "anthropic" and settings.resolved_provider == "anthropic"
    assert os.environ["ANTHROPIC_API_KEY"] == GOOD and "JARVIS_PROVIDER=anthropic" in path.read_text()


def test_setup_state(settings, monkeypatch):
    monkeypatch.setattr(claude_setup, "anthropic_credentials_available", lambda: False)
    settings.provider = "anthropic"
    assert claude_setup.setup_state(settings) == "required"
    settings.provider = "auto"
    assert claude_setup.setup_state(settings) == "optional"
    monkeypatch.setattr(claude_setup, "anthropic_credentials_available", lambda: True)
    assert claude_setup.setup_state(settings) is None


def test_hud_endpoint_saves_key_and_switches_brain(settings, tmp_path, monkeypatch):
    settings.tts_engine = "none"
    monkeypatch.setattr(claude_setup, "USER_ENV", tmp_path / ".env")
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    monkeypatch.setenv("JARVIS_PROVIDER", "auto")

    async def fake_check(key, model):
        return None if key == GOOD else "The key is not valid or has been revoked."

    monkeypatch.setattr("jarvis.server.app.check_key", fake_check)
    monkeypatch.setattr("jarvis.server.app.activate", lambda key, s: claude_setup.activate(key, s, tmp_path / ".env"))
    jarvis = Jarvis(settings, client=FakeClient([text_message("ok")]), memory=Memory(":memory:"))
    reloaded = []
    monkeypatch.setattr(jarvis.brain, "reload_provider", lambda: reloaded.append(True))
    with TestClient(create_app(settings, jarvis=jarvis)) as c:
        bad = c.post("/api/claude-key", json={"key": "sk-ant-api03-wrongwrongwrong"})
        assert bad.status_code == 400 and "not valid" in bad.json()["error"]
        ok = c.post("/api/claude-key", json={"key": GOOD})
        assert ok.status_code == 200 and ok.json()["ok"] is True
    assert reloaded == [True] and settings.provider == "anthropic"
    assert f"ANTHROPIC_API_KEY={GOOD}" in (tmp_path / ".env").read_text()


def test_cli_claude_command(settings, tmp_path, monkeypatch, capsys):
    monkeypatch.setattr(claude_setup, "USER_ENV", tmp_path / ".env")
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    monkeypatch.delenv("JARVIS_PROVIDER", raising=False)

    async def fake_check(key, model):
        return None

    monkeypatch.setattr(claude_setup, "check_key", fake_check)
    monkeypatch.setattr(cli, "get_settings", lambda: settings)
    cli.main(["claude", "--key", GOOD])
    assert "JARVIS_PROVIDER=anthropic" in (tmp_path / ".env").read_text()
    assert settings.provider == "anthropic"
