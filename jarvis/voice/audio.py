"""Microphone capture with simple energy-based end-pointing, plus a wake chime."""

from __future__ import annotations

import asyncio
import math
import time

SAMPLE_RATE = 16_000
FRAME_MS = 30


def _np():
    import numpy as np

    return np


def record_until_silence(
    max_seconds: float = 15.0,
    silence_seconds: float = 1.0,
    device: int | None = None,
    calibrate_seconds: float = 0.3,
):
    """Record from the microphone until the speaker pauses for ``silence_seconds``. Returns float32 PCM at 16 kHz."""
    import sounddevice as sd

    np = _np()
    frame = int(SAMPLE_RATE * FRAME_MS / 1000)
    frames: list = []
    started = time.monotonic()
    speech_started = False
    last_voice = started
    noise = 0.0
    calib_frames = max(1, int(calibrate_seconds * 1000 / FRAME_MS))
    with sd.InputStream(
        samplerate=SAMPLE_RATE, channels=1, dtype="float32", blocksize=frame, device=device
    ) as stream:
        n = 0
        while True:
            data, _ = stream.read(frame)
            chunk = data[:, 0]
            rms = float(np.sqrt(np.mean(chunk**2)) + 1e-9)
            n += 1
            if n <= calib_frames:
                noise = max(noise, rms)
                threshold = max(noise * 3.0, 0.01)
                continue
            frames.append(chunk.copy())
            now = time.monotonic()
            if rms > threshold:
                speech_started = True
                last_voice = now
            elif speech_started and now - last_voice > silence_seconds:
                break
            if now - started > max_seconds:
                break
            if not speech_started and now - started > 6.0:  # nobody spoke
                break
    if not frames:
        return np.zeros(0, dtype="float32")
    return np.concatenate(frames)


async def record_async(**kwargs):
    return await asyncio.to_thread(record_until_silence, **kwargs)


def chime(frequency: float = 880.0, duration: float = 0.12, volume: float = 0.2) -> None:
    """A short two-tone acknowledgement, like the original's listening cue."""
    try:
        import sounddevice as sd

        np = _np()
        t = np.linspace(0, duration, int(SAMPLE_RATE * duration), endpoint=False)
        tone = np.concatenate(
            [np.sin(2 * math.pi * frequency * t), np.sin(2 * math.pi * frequency * 1.5 * t)]
        )
        envelope = np.minimum(1.0, np.minimum(np.arange(tone.size), tone.size - np.arange(tone.size)) / 200.0)
        sd.play((tone * envelope * volume).astype("float32"), SAMPLE_RATE)
        sd.wait()
    except Exception:  # noqa: BLE001 - a missing speaker shouldn't stop the loop
        pass
