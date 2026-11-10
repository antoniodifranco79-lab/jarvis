"""The hands-free loop: wake word -> chime -> listen -> transcribe -> think -> speak, with reminders
spoken when they fire and spoken yes/no approval for dangerous actions."""

from __future__ import annotations

import asyncio
import logging
import re

from ..app import Jarvis
from ..events import Event, State
from .audio import chime, record_async
from .sentences import SentenceBuffer
from .stt import Transcriber
from .tts import Speaker

log = logging.getLogger(__name__)

YES = re.compile(
    r"\b(yes|yeah|yep|sure|go ahead|do it|proceed|confirm|ok|okay|sì|si|certo|procedi|vai|conferma|va bene)\b",
    re.I,
)
GOODBYE = re.compile(
    r"^(goodbye|good night|that'?s all|thank you jarvis|arrivederci|buonanotte|basta così|grazie jarvis)\b",
    re.I,
)


class VoiceLoop:
    def __init__(self, jarvis: Jarvis, *, push_to_talk: bool = False, follow_up_seconds: float = 6.0) -> None:
        self.jarvis = jarvis
        self.settings = jarvis.settings
        self.push_to_talk = push_to_talk
        self.follow_up_seconds = follow_up_seconds
        self.speaker = Speaker(self.settings)
        self.transcriber = Transcriber(self.settings)
        self.language = "en"
        self._speech_queue: asyncio.Queue[str | None] = asyncio.Queue()
        self._speaking_task: asyncio.Task[None] | None = None
        jarvis.approver = self.approve
        jarvis.bus.subscribe(self._on_event)

    # ------------------------------------------------------------------ speaking
    async def _speech_worker(self) -> None:
        while True:
            sentence = await self._speech_queue.get()
            if sentence is None:
                break
            await self.jarvis.bus.set_state(State.SPEAKING)
            await self.speaker.speak(sentence, self.language)

    async def say(self, text: str) -> None:
        await self.speaker.speak(text, self.language)

    async def _on_event(self, event: Event) -> None:
        if event.type == "reminder":
            await self.say(f"{self.settings.user_name}, {event.data['message']}")

    # ------------------------------------------------------------------ approval by voice
    async def approve(self, tool: str, arguments: dict) -> bool:
        detail = arguments.get("command") or arguments.get("name") or ""
        prompt = (
            f"Questo richiede la sua conferma, {self.settings.user_name}: {tool} {detail}. Procedo?"
            if self.language.startswith("it")
            else f"This needs your confirmation, {self.settings.user_name}: {tool} {detail}. Shall I proceed?"
        )
        await self.say(prompt)
        chime()
        audio = await record_async(max_seconds=5, silence_seconds=0.8, device=self.settings.mic_device)
        text, _ = await self.transcriber.transcribe_async(audio, self.language)
        log.info("approval answer: %r", text)
        return bool(YES.search(text or ""))

    # ------------------------------------------------------------------ one exchange
    async def listen(self, max_seconds: float | None = None) -> str:
        await self.jarvis.bus.set_state(State.LISTENING)
        audio = await record_async(
            max_seconds=max_seconds or self.settings.record_max_seconds,
            silence_seconds=self.settings.record_silence_seconds,
            device=self.settings.mic_device,
        )
        await self.jarvis.bus.set_state(State.TRANSCRIBING)
        text, lang = await self.transcriber.transcribe_async(audio)
        if text:
            self.language = lang
        return text

    async def exchange(self, text: str) -> str:
        buffer = SentenceBuffer()
        self._speaking_task = asyncio.create_task(self._speech_worker())
        final = ""
        try:
            async for event in self.jarvis.brain.ask(text):
                if event["type"] == "text":
                    for sentence in buffer.feed(event["text"]):
                        await self._speech_queue.put(sentence)
                elif event["type"] in ("error", "notice"):
                    await self._speech_queue.put(event["message"])
                elif event["type"] == "final":
                    final = event["text"]
            for sentence in buffer.flush():
                await self._speech_queue.put(sentence)
        finally:
            await self._speech_queue.put(None)
            await self._speaking_task
        return final

    # ------------------------------------------------------------------ main loop
    async def wait_for_trigger(self) -> None:
        if self.push_to_talk:
            await asyncio.to_thread(
                input, f"[press Enter to talk to {self.settings.user_name}'s J.A.R.V.I.S.] "
            )
            return
        from .wakeword import WakeWordListener

        if not hasattr(self, "_wake"):
            self._wake = WakeWordListener(self.settings)
        await self.jarvis.bus.set_state(State.IDLE)
        await self._wake.wait_async()

    async def run(self) -> None:
        hello = self.jarvis.greeting()
        print(f"JARVIS › {hello}")
        await self.say(hello)
        while True:
            try:
                await self.wait_for_trigger()
            except (KeyboardInterrupt, EOFError):
                break
            chime()
            text = await self.listen()
            while text:
                print(f"You › {text}")
                if GOODBYE.search(text):
                    bye = "Buonanotte." if self.language.startswith("it") else "Very good. I'll be here."
                    await self.say(bye)
                    text = ""
                    break
                answer = await self.exchange(text)
                print(f"JARVIS › {answer}")
                # a short follow-up window: no wake word needed for the next sentence
                text = await self.listen(max_seconds=self.follow_up_seconds)
            await self.jarvis.bus.set_state(State.IDLE)
