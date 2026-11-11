"""Mixa voce + musica e la monta sul video.

Uso: python3 mix.py frames/video.mp4 output/dinosauri_10_anni.mp4
Legge audio/timeline.json (scritto da render.js) per posizionare ogni traccia vocale e i bass hit sui tagli.
"""
import json, os, subprocess, sys

HERE = os.path.dirname(os.path.abspath(__file__))
video, out = sys.argv[1], sys.argv[2]
tl = json.load(open(os.path.join(HERE, "audio", "timeline.json")))
total = tl["total"]
cuts = [s["start"] for s in tl["scenes"] if s["start"] > 0]

# 1) musica della durata giusta, con bass hit sui cambi scena
subprocess.check_call([sys.executable, "-I", os.path.join(HERE, "music.py"), f"{total:.2f}", json.dumps(cuts)], cwd=HERE)

# 2) filtro ffmpeg: ogni voce ritardata al suo istante, sommate; musica abbassata sotto la voce (sidechain)
inputs = ["-i", os.path.join(HERE, "audio", "music.wav")]
parts = []
for i, s in enumerate(tl["scenes"]):
    inputs += ["-i", os.path.join(HERE, "audio", f"scene{s['i']:02d}.mp3")]
    ms = int(round(s["audioAt"] * 1000))
    parts.append(f"[{i+2}:a]aresample=44100,aformat=channel_layouts=stereo,adelay={ms}|{ms},apad=whole_dur={total:.2f}[v{i}]")
n = len(tl["scenes"])
voice_mix = "".join(f"[v{i}]" for i in range(n)) + f"amix=inputs={n}:normalize=0,volume=1.6,acompressor=threshold=-14dB:ratio=3:attack=5:release=120[voice]"
fc = ";".join(parts + [voice_mix,
    "[voice]asplit=2[vo][vsc]",
    "[1:a]volume=0.55[mu]",
    "[mu][vsc]sidechaincompress=threshold=0.05:ratio=6:attack=20:release=400:makeup=1[duck]",
    "[duck][vo]amix=inputs=2:normalize=0,loudnorm=I=-14:TP=-1.5:LRA=11[aout]"])
cmd = ["ffmpeg", "-y", "-loglevel", "error", "-i", video] + inputs + ["-filter_complex", fc, "-map", "0:v", "-map", "[aout]",
       "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-shortest", "-movflags", "+faststart", out]
subprocess.check_call(cmd)
print("ok", out)
