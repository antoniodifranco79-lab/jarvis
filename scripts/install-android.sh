#!/data/data/com.termux/files/usr/bin/bash
# J.A.R.V.I.S. on Android, inside Termux (install Termux from F-Droid, open it, paste):
#   curl -fsSL https://raw.githubusercontent.com/antoniodifranco79-lab/jarvis/HEAD/scripts/install-android.sh | bash
# Everything is pure Python: no compilers, no API keys. The model runs on the tablet through Ollama.
set -euo pipefail
REPO="https://github.com/antoniodifranco79-lab/jarvis.git"
BRANCH="${JARVIS_BRANCH:-}"
DIR="${JARVIS_HOME:-$HOME/jarvis}"
MODEL="${JARVIS_OLLAMA_MODEL:-qwen3:4b}"
say()  { printf '\033[1;36m[jarvis]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[jarvis]\033[0m %s\n' "$*"; }

say "updating Termux packages"
pkg update -y >/dev/null 2>&1 || true
say "installing python, git, ollama"
pkg install -y python git ollama python-psutil >/dev/null
if [ -z "$BRANCH" ]; then
  BRANCH="$(git ls-remote --symref "$REPO" HEAD 2>/dev/null | awk '/^ref:/ {sub("refs/heads/", "", $2); print $2; exit}')"
  BRANCH="${BRANCH:-main}"
fi
if [ -d "$DIR/.git" ]; then
  git -C "$DIR" fetch -q origin "$BRANCH" && git -C "$DIR" checkout -q "$BRANCH" && git -C "$DIR" pull -q --ff-only origin "$BRANCH"
else
  git clone -q --branch "$BRANCH" "$REPO" "$DIR"
fi
say "installing Jarvis (pure Python, a minute or two)"
pip install -q --upgrade pip >/dev/null 2>&1 || true
pip install -q -e "$DIR"

mkdir -p "$HOME/.jarvis/models" "$HOME/bin" "$HOME/.shortcuts"
if [ ! -f "$HOME/.jarvis/.env" ]; then
  cat > "$HOME/.jarvis/.env" <<ENV
JARVIS_PROVIDER=ollama
JARVIS_OLLAMA_MODEL=$MODEL
JARVIS_OLLAMA_NUM_CTX=8192
JARVIS_TTS_ENGINE=none
JARVIS_USER_NAME=Signore
JARVIS_LANGUAGE=auto
JARVIS_SHELL_ENABLED=false
ENV
fi

cat > "$HOME/bin/jarvis-start" <<'START'
#!/data/data/com.termux/files/usr/bin/bash
# Start the engine and the HUD, then open it in the browser.
export OLLAMA_MODELS="$HOME/.jarvis/models"
termux-wake-lock 2>/dev/null || true
if ! curl -sf http://127.0.0.1:11434/api/tags >/dev/null 2>&1; then
  nohup ollama serve > "$HOME/.jarvis/ollama.log" 2>&1 &
  for i in $(seq 1 60); do curl -sf http://127.0.0.1:11434/api/tags >/dev/null 2>&1 && break; sleep 0.5; done
fi
if ! curl -sf http://127.0.0.1:8765/api/status >/dev/null 2>&1; then
  nohup jarvis serve --host 127.0.0.1 --port 8765 > "$HOME/.jarvis/server.log" 2>&1 &
  for i in $(seq 1 60); do curl -sf http://127.0.0.1:8765/api/status >/dev/null 2>&1 && break; sleep 0.5; done
fi
termux-open-url "http://localhost:8765" 2>/dev/null || echo "open http://localhost:8765 in Chrome"
START
chmod +x "$HOME/bin/jarvis-start"
cp "$HOME/bin/jarvis-start" "$HOME/.shortcuts/JARVIS" && chmod +x "$HOME/.shortcuts/JARVIS"
grep -q 'HOME/bin' "$HOME/.bashrc" 2>/dev/null || echo 'export PATH="$HOME/bin:$PATH"' >> "$HOME/.bashrc"

say "downloading the $MODEL language model (a few GB, only once)"
export OLLAMA_MODELS="$HOME/.jarvis/models"
if ! curl -sf http://127.0.0.1:11434/api/tags >/dev/null 2>&1; then
  nohup ollama serve > "$HOME/.jarvis/ollama.log" 2>&1 &
  for i in $(seq 1 60); do curl -sf http://127.0.0.1:11434/api/tags >/dev/null 2>&1 && break; sleep 0.5; done
fi
ollama pull "$MODEL" || warn "model download interrupted: run 'ollama pull $MODEL' later"

say "done. Starting J.A.R.V.I.S. now..."
"$HOME/bin/jarvis-start"
say "next time: type  jarvis-start  in Termux, or tap the JARVIS widget (Termux:Widget app)."
