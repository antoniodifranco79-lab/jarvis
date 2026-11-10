"""Text-to-speech. Default engine: Microsoft Edge neural voices (free, no key) - ``en-GB-RyanNeural``
is the closest thing to the original. ElevenLabs and the offline pyttsx3 engine are alternatives."""

from __future__ import annotations

import asyncio
import logging
import re
import shutil
import subprocess
import tempfile
from pathlib import Path

from ..config import Settings
from .sentences import guess_language

log = logging.getLogger(__name__)

_MARKDOWN = re.compile(r"[*_`#>]+|\[([^\]]+)\]\([^)]+\)")


def clean_for_speech(text: str) -> str:
    text = _MARKDOWN.sub(lambda m: m.group(1) or "", text)
    text = re.sub(r"https?://\S+", "", text)
    return re.sub(r"\s+", " ", text).strip()


def find_player() -> list[str] | None:
    for name, args in (
        ("afplay", []),
        ("ffplay", ["-nodisp", "-autoexit", "-loglevel", "quiet"]),
        ("mpv", ["--no-video", "--really-quiet"]),
        ("mpg123", ["-q"]),
        ("cvlc", ["--play-and-exit", "--quiet"]),
    ):
        path = shutil.which(name)
        if path:
            return [path, *args]
    return None


async def play_file(path: Path) -> None:
    player = find_player()
    if player is None:
        try:  # pure-python fallback: sounddevice + soundfile (needs libsndfile with mp3 support)
            import sounddevice as sd
            import soundfile as sf

            data, rate = await asyncio.to_thread(sf.read, str(path), dtype="float32")
            await asyncio.to_thread(sd.play, data, rate)
            await asyncio.to_thread(sd.wait)
            return
        except Exception as exc:  # noqa: BLE001
            raise RuntimeError("no audio player found: install ffmpeg (ffplay) or mpv") from exc
    proc = await asyncio.create_subprocess_exec(
        *player, str(path), stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL
    )
    await proc.wait()


class Speaker:
    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self.engine = settings.tts_engine
        self._pyttsx = None

    def voice_for(self, text: str, language: str | None = None) -> str:
        lang = language or guess_language(text)
        return self.settings.tts_voice_it if lang.startswith("it") else self.settings.tts_voice_en

    async def synthesize(self, text: str, language: str | None = None) -> bytes | None:
        """Return MP3 bytes (or None when the engine speaks directly / is disabled)."""
        text = clean_for_speech(text)
        if not text or self.engine == "none":
            return None
        if self.engine == "edge":
            import edge_tts

            communicate = edge_tts.Communicate(
                text, self.voice_for(text, language), rate=self.settings.tts_rate
            )
            chunks = bytearray()
            async for chunk in communicate.stream():
                if chunk["type"] == "audio":
                    chunks.extend(chunk["data"])
            return bytes(chunks)
        if self.engine == "elevenlabs":
            import httpx

            if not (self.settings.elevenlabs_api_key and self.settings.elevenlabs_voice_id):
                raise RuntimeError(
                    "ElevenLabs needs JARVIS_ELEVENLABS_API_KEY and JARVIS_ELEVENLABS_VOICE_ID"
                )
            async with httpx.AsyncClient(timeout=60) as client:
                r = await client.post(
                    f"https://api.elevenlabs.io/v1/text-to-speech/{self.settings.elevenlabs_voice_id}",
                    headers={"xi-api-key": self.settings.elevenlabs_api_key, "accept": "audio/mpeg"},
                    json={"text": text, "model_id": "eleven_multilingual_v2"},
                )
                r.raise_for_status()
                return r.content
        return None  # pyttsx3 speaks directly, no bytes

    async def speak(self, text: str, language: str | None = None) -> None:
        text = clean_for_speech(text)
        if not text or self.engine == "none":
            return
        try:
            if self.engine == "pyttsx3":
                await asyncio.to_thread(self._speak_pyttsx3, text)
                return
            audio = await self.synthesize(text, language)
            if not audio:
                return
            with tempfile.NamedTemporaryFile(suffix=".mp3", delete=False) as tmp:
                tmp.write(audio)
                path = Path(tmp.name)
            try:
                await play_file(path)
            finally:
                path.unlink(missing_ok=True)
        except Exception as exc:  # noqa: BLE001 - speech must never crash the assistant
            log.warning("speech failed: %s", exc)

    def _speak_pyttsx3(self, text: str) -> None:
        import pyttsx3

        if self._pyttsx is None:
            self._pyttsx = pyttsx3.init()
            for voice in self._pyttsx.getProperty("voices"):
                if "english" in voice.name.lower() and (
                    "gb" in voice.id.lower() or "british" in voice.name.lower()
                ):
                    self._pyttsx.setProperty("voice", voice.id)
                    break
        self._pyttsx.say(text)
        self._pyttsx.runAndWait()
