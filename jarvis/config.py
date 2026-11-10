"""Runtime configuration, loaded from environment variables and an optional .env file."""

from __future__ import annotations

from pathlib import Path
from typing import Literal

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

Effort = Literal["low", "medium", "high", "xhigh", "max"]

DEFAULT_NEWS_FEEDS = [
    "https://feeds.bbci.co.uk/news/world/rss.xml",
    "https://www.ansa.it/sito/notizie/topnews/topnews_rss.xml",
]


class Settings(BaseSettings):
    """Every knob Jarvis exposes. All variables are prefixed with ``JARVIS_``.

    ``ANTHROPIC_API_KEY`` is read directly by the Anthropic SDK and is not listed here.
    """

    model_config = SettingsConfigDict(
        env_prefix="JARVIS_", env_file=".env", env_file_encoding="utf-8", extra="ignore"
    )

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
    news_feeds: list[str] = Field(default_factory=lambda: list(DEFAULT_NEWS_FEEDS))

    @field_validator("news_feeds", mode="before")
    @classmethod
    def _split_feeds(cls, value):
        if isinstance(value, str):
            return [v.strip() for v in value.split(",") if v.strip()]
        return value

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
        _settings = Settings()
    return _settings
