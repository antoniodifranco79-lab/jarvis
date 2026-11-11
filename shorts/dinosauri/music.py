"""Colonna sonora sintetizzata (numpy): drone cupo, kick, hi-hat, arpeggio in Re minore, bass hit sui tagli.

Uso: python3 music.py <durata_sec> <cuts_json> -> audio/music.wav
cuts_json: lista di secondi in cui cade un cambio scena (bass hit).
"""
import json, sys, wave
import numpy as np
from scipy.signal import lfilter

SR = 44100
dur = float(sys.argv[1])
cuts = json.loads(sys.argv[2]) if len(sys.argv) > 2 else []
n = int(SR * dur)
t = np.arange(n) / SR
out = np.zeros(n)
rng = np.random.default_rng(7)

BPM = 126.0
beat = 60.0 / BPM

def env(length, a=0.005, d=0.2, s=0.0, r=0.05):
    L = int(length * SR)
    e = np.zeros(L)
    A, D, R = int(a * SR), int(d * SR), int(r * SR)
    A = max(A, 1); D = max(D, 1)
    e[:A] = np.linspace(0, 1, A)
    e[A:A + D] = np.linspace(1, s, min(D, L - A))
    if s > 0 and L > A + D:
        e[A + D:] = s
    if R and L > R:
        e[-R:] *= np.linspace(1, 0, R)
    return e

def add(sig, start):
    i = int(start * SR)
    if i >= n:
        return
    seg = sig[: n - i]
    out[i:i + len(seg)] += seg

def lowpass(x, cutoff):
    rc = 1.0 / (2 * np.pi * cutoff)
    alpha = (1 / SR) / (rc + 1 / SR)
    return lfilter([alpha], [1, -(1 - alpha)], x)

def saw(f, length):
    tt = np.arange(int(length * SR)) / SR
    return 2 * ((tt * f) % 1) - 1

def sine(f, length):
    tt = np.arange(int(length * SR)) / SR
    return np.sin(2 * np.pi * f * tt)

# --- drone: Re (D2) + quinta, detune lento ---
D2 = 73.42
drone = 0.5 * saw(D2, dur) + 0.5 * saw(D2 * 1.005, dur) + 0.35 * saw(D2 * 1.5, dur)
drone = lowpass(drone, 180)
drone *= 0.30 * (0.8 + 0.2 * np.sin(2 * np.pi * 0.07 * t))
out += drone

# --- kick ---
def kick():
    L = 0.35
    tt = np.arange(int(L * SR)) / SR
    f = 150 * np.exp(-tt * 22) + 45
    ph = 2 * np.pi * np.cumsum(f) / SR
    return np.sin(ph) * env(L, 0.001, 0.3, 0, 0.02) * 1.0

# --- hi-hat ---
def hat(open_=False):
    L = 0.25 if open_ else 0.06
    noise = rng.standard_normal(int(L * SR))
    hp = noise - lowpass(noise, 6000)
    return hp * env(L, 0.001, L * 0.8, 0, 0.01) * 0.22

# --- snare/clap ---
def clap():
    L = 0.18
    noise = rng.standard_normal(int(L * SR))
    bp = lowpass(noise, 3500) - lowpass(noise, 900)
    return bp * env(L, 0.001, 0.15, 0, 0.02) * 0.7

# --- arpeggio: Dm (D F A) e Bb, C ---
NOTES = {"D3": 146.83, "F3": 174.61, "A3": 220.0, "D4": 293.66, "C4": 261.63, "Bb3": 233.08, "G3": 196.0}
progression = [["D3", "F3", "A3", "D4"], ["Bb3", "D4", "F3", "D3"], ["F3", "A3", "C4", "A3"], ["G3", "Bb3", "D4", "Bb3"]]

def pluck(f, length):
    s = saw(f, length) * 0.5 + saw(f * 2.0, length) * 0.2
    s = lowpass(s, 1100)
    return s * env(length, 0.003, length * 0.9, 0, 0.02) * 0.28

k = kick(); c = clap()
bar = 0
tb = 0.0
intro_bars = 2  # all'inizio solo drone + arpeggio leggero
while tb < dur:
    chord = progression[bar % 4]
    for b in range(4):
        tbeat = tb + b * beat
        if bar >= intro_bars:
            add(k, tbeat)
            add(hat(), tbeat + beat / 2)
            if b in (1, 3):
                add(c, tbeat)
        # arpeggio in sedicesimi
        for s16 in range(4):
            ts = tbeat + s16 * beat / 4
            note = chord[(b * 4 + s16) % 4]
            f = NOTES[note] * (2 if (s16 == 2 and b % 2) else 1)
            add(pluck(f, beat / 3), ts)
    tb += 4 * beat
    bar += 1

# --- bass hit sui cambi scena ---
def boom():
    L = 0.9
    tt = np.arange(int(L * SR)) / SR
    f = 90 * np.exp(-tt * 9) + 38
    ph = 2 * np.pi * np.cumsum(f) / SR
    body = np.sin(ph) * env(L, 0.002, 0.8, 0, 0.05)
    noise = lowpass(rng.standard_normal(len(tt)), 1200) * env(L, 0.001, 0.12, 0, 0.02) * 0.5
    return (body + noise) * 1.4

for ctime in cuts:
    add(boom(), max(0.0, ctime - 0.02))

# --- riser prima dell'ultimo cut (tensione) ---
# --- master: fade in/out, soft clip ---
out *= np.minimum(1, t / 0.5) * np.minimum(1, (dur - t) / 1.5)
out = np.tanh(out * 0.9) * 0.85

stereo = np.stack([out, out], axis=1)
pcm = (stereo * 32767).astype(np.int16)
with wave.open("audio/music.wav", "wb") as w:
    w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR)
    w.writeframes(pcm.tobytes())
print("music.wav", round(dur, 1), "s", "cuts", cuts)
