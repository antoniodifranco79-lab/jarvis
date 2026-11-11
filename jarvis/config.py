"""Runtime configuration, loaded from environment variables and optional .env files.

Pure standard library on purpose: Jarvis also runs on Android (Termux), where compiled
dependencies such as pydantic-core cannot be built.
"""

from __future__ import annotations

import dataclasses
import os
import typing
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Literal, Union, get_args, get_origin, get_type_hints

from dotenv import find_dotenv, load_dotenv

Effort = Literal["low", "medium", "high", "xhigh", "max"]

DEFAULT_NEWS_FEEDS = (
    "https://feeds.bbci.co.uk/news/world/rss.xml,https://www.ansa.it/sito/notizie/topnews/topnews_rss.xml"
)
PLACEHOLDER_KEYS = {"", "sk-ant-...", "your-api-key"}
ENV_PREFIX = "JARVIS_"


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


def anthropic_credentials_available() -> bool:
    """A key/token in the environment, or a profile from ``ant auth login`` on disk."""
    if api_key_configured():
        return True
    config_dir = os.environ.get("ANTHROPIC_CONFIG_DIR")
    roots = [Path(config_dir)] if config_dir else [Path.home() / ".config" / "anthropic"]
    appdata = os.environ.get("APPDATA")
    if appdata:
        roots.append(Path(appdata) / "Anthropic")
    return any(
        (root / "credentials").is_dir() and any((root / "credentials").glob("*.json")) for root in roots
    )


class SettingsError(ValueError):
    pass


def _coerce(name: str, annotation: Any, raw: str) -> Any:
    """Turn an environment string into the field's type."""
    origin = get_origin(annotation)
    if origin in (Union, getattr(typing, "UnionType", Union)) or str(origin) == "<class 'types.UnionType'>":
        args = [a for a in get_args(annotation) if a is not type(None)]
        if raw.strip() == "" and len(args) < len(get_args(annotation)):
            return None
        return _coerce(name, args[0], raw)
    if origin is Literal:
        allowed = get_args(annotation)
        value = raw.strip()
        if value not in allowed:
            raise SettingsError(f"{ENV_PREFIX}{name.upper()} must be one of {list(allowed)}, got {value!r}")
        return value
    if annotation is bool:
        value = raw.strip().lower()
        if value in ("1", "true", "yes", "on"):
            return True
        if value in ("0", "false", "no", "off", ""):
            return False
        raise SettingsError(f"{ENV_PREFIX}{name.upper()} must be true or false, got {raw!r}")
    if annotation is int:
        return int(raw.strip())
    if annotation is float:
        return float(raw.strip())
    if annotation is Path:
        return Path(raw.strip()).expanduser()
    return raw


@dataclass
class Settings:
    """Every knob Jarvis exposes. Environment variables are prefixed with ``JARVIS_``;
    ``ANTHROPIC_API_KEY`` is read by the Anthropic SDK itself."""

    # --- brain ---
    provider: Literal["auto", "anthropic", "ollama"] = "auto"
    model: str = "claude-opus-5-5"
    ollama_url: str = "http://127.0.0.1:11434"
    ollama_model: str = "auto"  # auto = pick a Qwen3 size from the machine's RAM
    ollama_num_ctx: int = 16384
    ollama_think: bool = False
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
    data_dir: Path = field(default_factory=lambda: Path.home() / ".jarvis")
    workspace: Path = field(default_factory=lambda: Path.home() / "jarvis-workspace")

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

    # --- HUD server / desktop app ---
    host: str = "127.0.0.1"
    port: int = 8765
    app_voice: bool = True  # the desktop app listens for the wake word

    # --- integrations ---
    home_assistant_url: str = ""
    home_assistant_token: str = ""
    news_feeds: str = DEFAULT_NEWS_FEEDS  # comma-separated

    def __post_init__(self) -> None:
        self.data_dir = Path(str(self.data_dir)).expanduser()
        self.workspace = Path(str(self.workspace)).expanduser()

    @classmethod
    def from_env(cls, environ: dict[str, str] | None = None, **overrides: Any) -> Settings:
        """Build settings from ``JARVIS_*`` variables (explicit keyword overrides win)."""
        environ = os.environ if environ is None else environ
        hints = get_type_hints(cls)
        values: dict[str, Any] = {}
        for f in dataclasses.fields(cls):
            raw = environ.get(ENV_PREFIX + f.name.upper())
            if raw is not None:
                values[f.name] = _coerce(f.name, hints[f.name], raw)
        values.update(overrides)
        return cls(**values)

    @property
    def news_feed_list(self) -> list[str]:
        return [v.strip() for v in self.news_feeds.split(",") if v.strip()]

    @property
    def db_path(self) -> Path:
        return self.data_dir / "jarvis.db"

    @property
    def resolved_provider(self) -> Literal["anthropic", "ollama"]:
        """``auto`` means: Claude when any Anthropic credential is around, otherwise the local Ollama model."""
        if self.provider != "auto":
            return self.provider
        return "anthropic" if anthropic_credentials_available() else "ollama"

    @property
    def local_model(self) -> str:
        if self.ollama_model.strip().lower() in ("", "auto"):
            from .engine import recommended_model

            return recommended_model()
        return self.ollama_model

    @property
    def active_model(self) -> str:
        return self.model if self.resolved_provider == "anthropic" else self.local_model

    def ensure_dirs(self) -> None:
        self.data_dir.mkdir(parents=True, exist_ok=True)
        self.workspace.mkdir(parents=True, exist_ok=True)


_settings: Settings | None = None


def get_settings(reload: bool = False) -> Settings:
    """Return the process-wide settings (cached)."""
    global _settings
    if _settings is None or reload:
        load_env_files()
        _settings = Settings.from_env()
    return _settings
