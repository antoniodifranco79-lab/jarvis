from __future__ import annotations

import os

from jarvis.config import Settings, api_key_configured, load_env_files


def test_dotenv_is_loaded_with_inline_comments(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    for var in ("JARVIS_MODEL", "JARVIS_NEWS_FEEDS", "ANTHROPIC_API_KEY", "JARVIS_USER_NAME"):
        monkeypatch.delenv(var, raising=False)
    (tmp_path / ".env").write_text(
        "ANTHROPIC_API_KEY=sk-ant-test\n"
        "JARVIS_MODEL=claude-opus-5-5          # any current model\n"
        "JARVIS_USER_NAME=Signore\n"
        "JARVIS_NEWS_FEEDS=https://a.example/rss, https://b.example/atom\n"
    )
    loaded = load_env_files()
    assert tmp_path / ".env" in loaded
    assert os.environ["ANTHROPIC_API_KEY"] == "sk-ant-test"
    assert api_key_configured()
    settings = Settings()
    assert settings.model == "claude-opus-5-5"
    assert settings.user_name == "Signore"
    assert settings.news_feed_list == ["https://a.example/rss", "https://b.example/atom"]


def test_placeholder_key_counts_as_missing(monkeypatch):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-ant-...")
    monkeypatch.delenv("ANTHROPIC_AUTH_TOKEN", raising=False)
    assert not api_key_configured()
