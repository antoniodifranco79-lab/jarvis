#!/usr/bin/env bash
# Build a standalone J.A.R.V.I.S. app with PyInstaller (run from the repository root).
#   bash scripts/build-app.sh            -> dist/JARVIS/  (dist/JARVIS.app on macOS)
set -euo pipefail
cd "$(dirname "$0")/.."
python -m pip install -q -e ".[server,voice,local,app]" pyinstaller
pyinstaller packaging/jarvis.spec --noconfirm --clean
echo "built: $(ls -d dist/JARVIS* | tr '\n' ' ')"
echo "the standalone app reads its settings from ~/.jarvis/.env"
