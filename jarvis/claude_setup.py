"""Use Claude as Jarvis' brain: check an Anthropic API key, save it for the next starts and pin the
provider to Claude, so the local engine (Ollama) is never downloaded or started."""

from __future__ import annotations

import os
import re
from pathlib import Path

from .config import Settings, anthropic_credentials_available

USER_ENV = Path.home() / ".jarvis" / ".env"
KEY_PATTERN = re.compile(r"^sk-ant-[A-Za-z0-9_\-]{10,}$")


def save_user_env(updates: dict[str, str], path: Path | None = None) -> Path:
    """Set ``KEY=value`` lines in a .env file, replacing existing ones and keeping everything else.
    The file holds a secret, so it is readable by its owner only."""
    path = path or USER_ENV
    path.parent.mkdir(parents=True, exist_ok=True)
    lines = path.read_text(encoding="utf-8").splitlines() if path.exists() else []
    pending = dict(updates)
    out: list[str] = []
    for line in lines:
        name = line.split("=", 1)[0].strip().removeprefix("export ").strip()
        if name in pending:
            out.append(f"{name}={pending.pop(name)}")
        else:
            out.append(line)
    out += [f"{name}={value}" for name, value in pending.items()]
    path.write_text("\n".join(out) + "\n", encoding="utf-8")
    try:
        path.chmod(0o600)
    except OSError:  # pragma: no cover - Windows ignores POSIX modes
        pass
    return path


async def check_key(key: str, model: str) -> str | None:
    """None if the key works for ``model``; otherwise a short message saying what is wrong."""
    key = key.strip()
    if not KEY_PATTERN.match(key):
        return "That doesn't look like an Anthropic API key (it starts with sk-ant-)."
    import anthropic

    client = anthropic.AsyncAnthropic(api_key=key, max_retries=1)
    try:
        await client.models.retrieve(model)
    except anthropic.AuthenticationError:
        return "The key is not valid or has been revoked."
    except anthropic.PermissionDeniedError:
        return f"The key has no access to {model}."
    except anthropic.NotFoundError:
        return f"The model {model} is not available to this key."
    except anthropic.RateLimitError:
        return "Rate limited or out of credit: check console.anthropic.com."
    except anthropic.APIConnectionError:
        return "Cannot reach api.anthropic.com: check the connection."
    except anthropic.APIStatusError as exc:
        return f"Anthropic API error ({exc.status_code})."
    finally:
        await client.close()
    return None


def activate(key: str, settings: Settings, path: Path | None = None) -> Path:
    """Save the key and pin the provider to Claude, for this process and for every next start."""
    saved = save_user_env({"ANTHROPIC_API_KEY": key.strip(), "JARVIS_PROVIDER": "anthropic"}, path)
    os.environ["ANTHROPIC_API_KEY"] = key.strip()
    os.environ["JARVIS_PROVIDER"] = "anthropic"
    settings.provider = "anthropic"
    return saved


def setup_state(settings: Settings) -> str | None:
    """What the HUD should offer: ``required`` (Claude chosen, no key), ``optional`` (no key, so the
    local engine would be used) or None (Claude ready)."""
    if anthropic_credentials_available():
        return None
    return "required" if settings.provider == "anthropic" else "optional"
