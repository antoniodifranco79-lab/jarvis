"""Runtime configuration, loaded from environment variables and an optional .env file."""

from __future__ import annotations

import os
from pathlib import Path
from typing import Literal

from dotenv import find_dotenv, load_dotenv
from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

Effort = Literal["low", "medium", "high", "xhigh", "max"]

DEFAULT_NEWS_FEEDS = (
    "https://feeds.bbci.co.uk/news/world/rss.xml,https://www.ansa.it/sito/notizie/topnews/topnews_rss.xml"
)
PLACEHOLDER_KEYS = {"", "sk-ant-...", "your-api-key"}


def load_env_files() -> list[Path]:
    """Load ``.env`` files into the process environment so both Jarvis and the Anthropic SDK see them.

    Looked up in order: the current directory (and its parents), ``~/.jarvis/.env`` and the
    repository root of an editable install. Real environment variables always win.
    """
    candidates: list[Path] = []
    found = find_dotenv(usecwd=True)
    if found:
        candidates.append(Path(found))
    candidates.append(Path.home() / ".jarvis" / ".env")
    candidates.append(Path(__file__).resolve().parents[1] / ".env")
    loaded: list[Path] = []
    for candidate in candidates:
        if candidate.is_file() and candidate not in loaded:
            load_dotenv(candidate, override=False)
            loaded.append(candidate)
    return loaded


def api_key_configured() -> bool:
    return os.environ.get("ANTHROPIC_API_KEY", "").strip() not in PLACEHOLDER_KEYS or bool(
        os.environ.get("ANTHROPIC_AUTH_TOKEN")
    )


class Settings(BaseSettings):
    """Every knob Jarvis exposes. All variables are prefixed with ``JARVIS_``.

    ``ANTHROPIC_API_KEY`` is read directly by the Anthropic SDK and is not listed here.
    """

    model_config = SettingsConfigDict(env_prefix="JARVIS_", extra="ignore")

    # --- brain ---
    model: str = "claude-opus-5-5"
    effort: Effort = "medium"
    max_tokens: int = 16000
    user_name: str = "Sir"
    user_full_name: str = ""
    language: str = "auto"
    location: str = ""
    timezone: str = ""
    auto_approve: bool = False
    shell_enabled: bool = True
    web_search: bool = True
    web_fetch: bool = True
    web_search_max_uses: int = 5
    fallbacks: bool = True
    server_compaction: bool = False
    session_token_budget: int = 120_000
    session_idle_hours: float = 6.0
    tool_timeout: float = 60.0

    # --- storage ---
    data_dir: Path = Field(default_factory=lambda: Path.home() / ".jarvis")
    workspace: Path = Field(default_factory=lambda: Path.home() / "jarvis-workspace")

    # --- voice ---
    tts_engine: Literal["edge", "elevenlabs", "pyttsx3", "none"] = "edge"
    tts_voice_en: str = "en-GB-RyanNeural"
    tts_voice_it: str = "it-IT-DiegoNeural"
    tts_rate: str = "+5%"
    elevenlabs_api_key: str = ""
    elevenlabs_voice_id: str = ""
    stt_model: str = "small"
    stt_device: str = "auto"
    wake_word: str = "hey_jarvis"
    wake_threshold: float = 0.5
    mic_device: int | None = None
    record_max_seconds: float = 15.0
    record_silence_seconds: float = 1.0

    # --- HUD server ---
    host: str = "127.0.0.1"
    port: int = 8765

    # --- integrations ---
    home_assistant_url: str = ""
    home_assistant_token: str = ""
    news_feeds: str = DEFAULT_NEWS_FEEDS  # comma-separated

    @property
    def news_feed_list(self) -> list[str]:
        return [v.strip() for v in self.news_feeds.split(",") if v.strip()]

    @field_validator("data_dir", "workspace", mode="before")
    @classmethod
    def _expand(cls, value):
        return Path(str(value)).expanduser() if value else value

    @property
    def db_path(self) -> Path:
        return self.data_dir / "jarvis.db"

    def ensure_dirs(self) -> None:
        self.data_dir.mkdir(parents=True, exist_ok=True)
        self.workspace.mkdir(parents=True, exist_ok=True)


_settings: Settings | None = None


def get_settings(reload: bool = False) -> Settings:
    """Return the process-wide settings (cached)."""
    global _settings
    if _settings is None or reload:
        load_env_files()
        _settings = Settings()
    return _settings
