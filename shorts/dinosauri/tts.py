"""Genera la voce narrante (edge-tts, it-IT) per ogni scena e salva i tempi delle parole.

Uso: python3 tts.py  -> audio/sceneNN.mp3 + audio/timing.json
"""
import asyncio, json, os, sys

import certifi

# Il proxy di rete re-termina TLS: aggiungo la sua CA al bundle di certifi usato da edge-tts.
_CA = os.environ.get("JARVIS_EXTRA_CA", "/root/.ccr/ca-bundle.crt")
if os.path.exists(_CA):
    _combined = os.path.join(os.path.dirname(os.path.abspath(__file__)), "_ca.pem")
    with open(_combined, "wb") as out:
        out.write(open(certifi.where(), "rb").read() + b"\n" + open(_CA, "rb").read())
    certifi.where = lambda: _combined  # type: ignore[assignment]

import edge_tts  # noqa: E402

LANG = os.environ.get("SHORT_LANG", "it")
VOICES = {"it": "it-IT-DiegoNeural", "en": "en-US-AndrewNeural"}
VOICE = VOICES.get(LANG, VOICES["it"])
RATE = "+10%"
HERE = os.path.dirname(os.path.abspath(__file__))
AUDIO = os.path.join(HERE, "audio" if LANG == "it" else f"audio_{LANG}")
os.makedirs(AUDIO, exist_ok=True)

SCENES = json.load(open(os.path.join(HERE, "script.json" if LANG == "it" else f"script.{LANG}.json"), encoding="utf-8"))


async def synth(idx, text, attempts=4):
    path = os.path.join(AUDIO, f"scene{idx:02d}.mp3")
    for attempt in range(1, attempts + 1):
        words = []
        try:
            com = edge_tts.Communicate(text, VOICE, rate=RATE, boundary="WordBoundary")
            with open(path, "wb") as f:
                async for chunk in com.stream():
                    if chunk["type"] == "audio":
                        f.write(chunk["data"])
                    elif chunk["type"] == "WordBoundary":
                        words.append({
                            "w": chunk["text"],
                            "t": chunk["offset"] / 1e7,
                            "d": chunk["duration"] / 1e7,
                        })
            if words:
                return path, words
            raise RuntimeError("nessuna parola ricevuta")
        except Exception as exc:  # il servizio a volte risponde vuoto: riprova
            print(f"  scena {idx}: tentativo {attempt} fallito ({exc.__class__.__name__}), riprovo", file=sys.stderr)
            await asyncio.sleep(2 * attempt)
    raise SystemExit(f"TTS fallito per la scena {idx}")


async def main():
    timing = []
    for i, sc in enumerate(SCENES):
        path, words = await synth(i, sc["narration"])
        # durata reale del file
        import subprocess
        dur = float(subprocess.check_output([
            "ffprobe", "-v", "error", "-show_entries", "format=duration",
            "-of", "csv=p=0", path]).decode().strip())
        timing.append({"index": i, "file": os.path.basename(path), "duration": dur, "words": words})
        print(f"scene {i:02d}: {dur:5.2f}s  {len(words)} parole  | {sc['narration'][:50]}")
    json.dump(timing, open(os.path.join(AUDIO, "timing.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)


asyncio.run(main())
