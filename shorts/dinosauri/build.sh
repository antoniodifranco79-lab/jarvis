#!/usr/bin/env bash
# Pipeline completa: voce -> render video -> mix audio -> MP4 finale (1080x1920, 30 fps)
set -euo pipefail
cd "$(dirname "$0")"
export SHORT_LANG="${SHORT_LANG:-it}"   # it | en
[ -d node_modules/three ] || npm install --no-audit --no-fund
python3 -I tts.py
node render.js video 30 1
mkdir -p output
python3 -I mix.py "frames/video_${SHORT_LANG}.mp4" "output/dinosauri_10_anni_${SHORT_LANG}.mp4"
echo "pronto: output/dinosauri_10_anni_${SHORT_LANG}.mp4"
