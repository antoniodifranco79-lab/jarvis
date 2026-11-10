"""Speech-to-text with faster-whisper (local, private, multilingual)."""

from __future__ import annotations

import asyncio
import logging

from ..config import Settings

log = logging.getLogger(__name__)


class Transcriber:
    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self._model = None

    def _load(self):
        if self._model is None:
            from faster_whisper import WhisperModel

            device = self.settings.stt_device
            compute = "float16" if device == "cuda" else "int8"
            log.info("loading whisper model %s on %s", self.settings.stt_model, device)
            self._model = WhisperModel(self.settings.stt_model, device=device, compute_type=compute)
        return self._model

    def transcribe(self, audio, language: str | None = None) -> tuple[str, str]:
        """Return (text, language code). ``audio`` is float32 PCM at 16 kHz."""
        if audio is None or getattr(audio, "size", 0) < 1600:
            return "", language or "en"
        model = self._load()
        lang = (
            None
            if (language or self.settings.language) in (None, "", "auto")
            else (language or self.settings.language)
        )
        segments, info = model.transcribe(audio, language=lang, vad_filter=True, beam_size=3)
        text = " ".join(s.text.strip() for s in segments).strip()
        return text, info.language or "en"

    async def transcribe_async(self, audio, language: str | None = None) -> tuple[str, str]:
        return await asyncio.to_thread(self.transcribe, audio, language)
