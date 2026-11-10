"""Model providers. The brain speaks the Anthropic Messages API; Claude is the native backend and
``OllamaClient`` is an adapter that lets a free local model answer in the same shape."""

from __future__ import annotations

from typing import Any

from ..config import Settings


def make_client(settings: Settings) -> Any:
    if settings.resolved_provider == "ollama":
        from .ollama import OllamaClient

        return OllamaClient(settings.ollama_url, num_ctx=settings.ollama_num_ctx, think=settings.ollama_think)
    import anthropic

    return anthropic.AsyncAnthropic()
