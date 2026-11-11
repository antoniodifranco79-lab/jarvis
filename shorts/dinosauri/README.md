# Short "E se i dinosauri tornassero per 10 anni?"

Video verticale 1080×1920 a 30 fps in stile TikTok / YouTube Shorts, con animazione 3D low-poly generata
interamente via codice (Three.js), voce narrante italiana, sottotitoli karaoke parola per parola e colonna
sonora sintetizzata. Nessun asset esterno: dinosauri, città, pterosauri, mura, neve e scheletri sono costruiti
proceduralmente in `scene_lib.js`.

## Struttura

| File | Ruolo |
|---|---|
| `script.json` | Copione: 8 scene (hook, anni 1-2-3-5-7-10, call to action) con titolo e narrazione |
| `tts.py` | Voce `it-IT-DiegoNeural` (edge-tts) per ogni scena + tempi di ogni parola (`audio/timing.json`) |
| `scene_lib.js` | Libreria 3D procedurale: T-Rex, brachiosauro, pterosauro, umani, auto, bus, elicottero, drone, aereo, scheletro, alberi, cielo |
| `scene.js` | Regia: ambienti, animazioni, inquadrature, timeline sincronizzata con la voce, sottotitoli e overlay |
| `scene.html` | Palco 9:16 con stile dei sottotitoli (Inter Display Black, parola attiva in giallo) |
| `render.js` | Server locale + Chromium headless: cattura ogni fotogramma e lo invia a ffmpeg (H.264) |
| `music.py` | Musica: drone in Re minore, kick/hat/clap a 126 BPM, arpeggio, bass hit su ogni cambio scena |
| `mix.py` | Mix voce + musica (ducking sidechain, loudness -14 LUFS) e montaggio sul video |
| `build.sh` | Pipeline completa |

## Uso

```bash
cd shorts/dinosauri
npm install                      # three.js
pip install edge-tts numpy scipy # voce e musica
./build.sh                       # -> output/dinosauri_10_anni.mp4
```

Anteprime rapide di singoli istanti: `node render.js stills 2,17,33` → `frames/still_*.png`.
Render a segmenti in parallelo: `node render.js video 30 1 <da_frame> <a_frame> <file.mp4>`, poi concatena con ffmpeg.

Per cambiare il copione basta modificare `script.json` e rilanciare: la durata delle scene e i sottotitoli
si adattano da soli ai tempi della voce.
