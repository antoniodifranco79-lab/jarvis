"""Wake-word detection with openWakeWord (ships a pre-trained "hey jarvis" model)."""

from __future__ import annotations

import asyncio
import logging

from ..config import Settings
from .audio import SAMPLE_RATE

log = logging.getLogger(__name__)
CHUNK = 1280  # 80 ms at 16 kHz, what openWakeWord expects


class WakeWordListener:
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

    async def wait_async(self) -> float:
        return await asyncio.to_thread(self.wait_for_wake)
