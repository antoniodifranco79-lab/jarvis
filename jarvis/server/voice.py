"""Hands-free voice inside the HUD server: wake word and microphone on the machine, speech through the HUD.

Used by ``jarvis app`` and ``jarvis serve --voice``. Everything heard goes through ``Hub.ask`` so the
window shows the transcript and plays the answer.
"""

from __future__ import annotations

import asyncio
import logging

from ..config import Settings
from ..events import State

log = logging.getLogger(__name__)


class ServerVoice:
    def __init__(self, hub, settings: Settings) -> None:
        self.hub = hub
        self.settings = settings
        self.jarvis = hub.jarvis
        self._wake = None
        self._transcriber = None

    def available(self) -> str | None:
        """None when the voice stack can be used, else the reason it can't."""
        try:
            import faster_whisper  # noqa: F401
            import sounddevice  # noqa: F401
        except ImportError as exc:
            return f"voice stack not installed ({exc.name}); pip install 'jarvis-ai[voice]'"
        return None

    async def run(self) -> None:
        reason = self.available()
        if reason:
            log.warning("hands-free voice disabled: %s", reason)
            return
        from ..voice.audio import chime, record_async
        from ..voice.stt import Transcriber
        from ..voice.wakeword import WakeWordListener

        self._wake = WakeWordListener(self.settings)
        self._transcriber = Transcriber(self.settings)
        log.info("hands-free voice on: say '%s'", self.settings.wake_word.replace("_", " "))
        failures = 0
        while True:
            try:
                await self.jarvis.bus.set_state(State.IDLE)
                await self._wake.wait_async()
                chime()
                await self.jarvis.bus.set_state(State.LISTENING)
                audio = await record_async(
                    max_seconds=self.settings.record_max_seconds,
                    silence_seconds=self.settings.record_silence_seconds,
                    device=self.settings.mic_device,
                )
                await self.jarvis.bus.set_state(State.TRANSCRIBING)
                text, _lang = await self._transcriber.transcribe_async(audio)
                if not text.strip():
                    await self.jarvis.bus.set_state(State.IDLE)
                    continue
                await self.hub.ask(text.strip())
                failures = 0
            except asyncio.CancelledError:
                raise
            except Exception as exc:  # noqa: BLE001 - a flaky microphone must not kill the server
                failures += 1
                log.warning("voice loop error (%s); retrying in %ds", exc, min(30, 2**failures))
                await self.jarvis.bus.publish("notice", message=f"Microphone trouble: {exc}")
                await asyncio.sleep(min(30, 2**failures))
