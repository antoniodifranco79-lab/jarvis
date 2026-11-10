"""Wake-word detection.

Preferred engine: openWakeWord, which ships a pre-trained "hey jarvis" model. On machines where it can't be
installed (Linux with Python 3.12+, where its tflite dependency has no wheels) Jarvis falls back to listening in
two-second windows and transcribing the loud ones with Whisper's tiny model, looking for his name.
"""

from __future__ import annotations

import asyncio
import logging

from ..config import Settings
from .audio import SAMPLE_RATE

log = logging.getLogger(__name__)
CHUNK = 1280  # 80 ms at 16 kHz, what openWakeWord expects
WAKE_WORDS = ("jarvis", "jarvi", "jervis", "giarvis", "charvis", "jarves", "dervis")


def openwakeword_available() -> bool:
    try:
        import openwakeword  # noqa: F401
    except ImportError:
        return False
    return True


class OpenWakeWordListener:
    engine = "openwakeword"

    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self._model = None

    def _load(self):
        if self._model is None:
            import openwakeword
            from openwakeword.model import Model

            try:
                openwakeword.utils.download_models([self.settings.wake_word])
            except Exception as exc:  # noqa: BLE001 - already downloaded, or offline
                log.debug("wake model download skipped: %s", exc)
            self._model = Model(wakeword_models=[self.settings.wake_word], inference_framework="onnx")
        return self._model

    def wait_for_wake(self) -> float:
        """Block until the wake word is heard; return the detection score."""
        import numpy as np
        import sounddevice as sd

        model = self._load()
        model.reset()
        with sd.InputStream(
            samplerate=SAMPLE_RATE,
            channels=1,
            dtype="int16",
            blocksize=CHUNK,
            device=self.settings.mic_device,
        ) as stream:
            while True:
                data, _ = stream.read(CHUNK)
                prediction = model.predict(np.frombuffer(data.tobytes(), dtype=np.int16))
                score = max(prediction.values()) if prediction else 0.0
                if score >= self.settings.wake_threshold:
                    model.reset()
                    return float(score)


class WhisperWakeListener:
    """Listens in two-second windows; when a window is loud enough, Whisper (tiny) checks for the name."""

    engine = "whisper"
    WINDOW_SECONDS = 2.0
    OVERLAP_SECONDS = 0.5
    SILENCE_RMS = 0.008

    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self._model = None

    def _load(self):
        if self._model is None:
            from faster_whisper import WhisperModel

            device = self.settings.stt_device
            self._model = WhisperModel(
                "tiny", device=device, compute_type="float16" if device == "cuda" else "int8"
            )
        return self._model

    @staticmethod
    def heard_name(text: str) -> bool:
        text = text.lower()
        return any(word in text for word in WAKE_WORDS)

    def wait_for_wake(self) -> float:
        import numpy as np
        import sounddevice as sd

        model = self._load()
        window = int(SAMPLE_RATE * self.WINDOW_SECONDS)
        overlap = int(SAMPLE_RATE * self.OVERLAP_SECONDS)
        previous = np.zeros(0, dtype="float32")
        with sd.InputStream(
            samplerate=SAMPLE_RATE,
            channels=1,
            dtype="float32",
            blocksize=window,
            device=self.settings.mic_device,
        ) as stream:
            while True:
                data, _ = stream.read(window)
                chunk = data[:, 0].copy()
                audio = np.concatenate([previous[-overlap:], chunk])
                previous = chunk
                if float(np.sqrt(np.mean(chunk**2))) < self.SILENCE_RMS:
                    continue  # nobody is talking: don't burn CPU
                segments, _ = model.transcribe(audio, beam_size=1, without_timestamps=True, vad_filter=False)
                text = " ".join(s.text for s in segments)
                if self.heard_name(text):
                    return 1.0


class WakeWordListener:
    """Picks the best available engine and exposes one interface."""

    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self._impl = (
            OpenWakeWordListener(settings) if openwakeword_available() else WhisperWakeListener(settings)
        )
        log.info("wake word engine: %s", self.engine)

    @property
    def engine(self) -> str:
        return self._impl.engine

    def wait_for_wake(self) -> float:
        return self._impl.wait_for_wake()

    async def wait_async(self) -> float:
        return await asyncio.to_thread(self.wait_for_wake)
