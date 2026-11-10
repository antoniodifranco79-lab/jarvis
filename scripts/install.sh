#!/usr/bin/env bash
# J.A.R.V.I.S. installer for Linux, macOS and WSL.
#
#   curl -fsSL https://raw.githubusercontent.com/antoniodifranco79-lab/jarvis/HEAD/scripts/install.sh | bash
#
# Environment overrides:
#   JARVIS_HOME    where to install            (default: ~/jarvis)
#   JARVIS_BRANCH  git branch to install       (default: the repository's default branch)
#   JARVIS_EXTRAS  pip extras                  (default: server,voice,vision)
set -euo pipefail

REPO="https://github.com/antoniodifranco79-lab/jarvis.git"
BRANCH="${JARVIS_BRANCH:-}"
DIR="${JARVIS_HOME:-$HOME/jarvis}"
EXTRAS="${JARVIS_EXTRAS:-server,voice,vision}"

say()  { printf '\033[1;36m[jarvis]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[jarvis]\033[0m %s\n' "$*"; }
die()  { printf '\033[1;31m[jarvis]\033[0m %s\n' "$*" >&2; exit 1; }

command -v git >/dev/null 2>&1 || die "git is required (apt install git / brew install git)."
PY=""
for candidate in python3.13 python3.12 python3.11 python3.10 python3; do
  if command -v "$candidate" >/dev/null 2>&1 && "$candidate" -c 'import sys; sys.exit(0 if sys.version_info >= (3, 10) else 1)' 2>/dev/null; then
    PY="$candidate"; break
  fi
done
[ -n "$PY" ] || die "Python 3.10 or newer is required."
say "using $($PY --version) at $(command -v "$PY")"

if [ -z "$BRANCH" ]; then
  BRANCH="$(git ls-remote --symref "$REPO" HEAD 2>/dev/null | awk '/^ref:/ {sub("refs/heads/", "", $2); print $2; exit}')"
  BRANCH="${BRANCH:-main}"
fi
say "branch: $BRANCH"

if ! command -v ffmpeg >/dev/null 2>&1; then
  warn "ffmpeg not found: speech playback needs it (apt install ffmpeg / brew install ffmpeg)."
fi
if [ "$(uname -s)" = "Linux" ] && ! ldconfig -p 2>/dev/null | grep -q libportaudio; then
  warn "PortAudio not found: the microphone needs it (apt install portaudio19-dev). The HUD works without it."
fi

if [ -d "$DIR/.git" ]; then
  say "updating existing install in $DIR"
  git -C "$DIR" fetch -q origin "$BRANCH" && git -C "$DIR" checkout -q "$BRANCH" && git -C "$DIR" pull -q --ff-only origin "$BRANCH"
else
  say "cloning into $DIR"
  git clone -q --branch "$BRANCH" "$REPO" "$DIR"
fi
cd "$DIR"

[ -d .venv ] || "$PY" -m venv .venv
# shellcheck disable=SC1091
. .venv/bin/activate
python -m pip install -q --upgrade pip wheel
say "installing jarvis-ai[$EXTRAS] (this can take a few minutes the first time)"
if ! pip install -q -e ".[$EXTRAS]"; then
  warn "full install failed; retrying with the core + HUD only"
  pip install -q -e ".[server]"
fi

if [ ! -f .env ]; then
  cp .env.example .env
  KEY=""
  if { exec 3< /dev/tty; } 2>/dev/null; then
    printf 'Anthropic API key (sk-ant-..., leave empty to add later): '
    read -r KEY <&3 || KEY=""
    exec 3<&-
  fi
  if [ -n "$KEY" ]; then
    sed -i.bak "s|^ANTHROPIC_API_KEY=.*|ANTHROPIC_API_KEY=$KEY|" .env && rm -f .env.bak
  else
    warn "no key entered: add ANTHROPIC_API_KEY to $DIR/.env before the first conversation"
  fi
fi

mkdir -p "$HOME/.local/bin"
ln -sf "$DIR/.venv/bin/jarvis" "$HOME/.local/bin/jarvis"
case ":$PATH:" in *":$HOME/.local/bin:"*) ;; *) warn "add ~/.local/bin to your PATH to run 'jarvis' from anywhere";; esac

say "installed. Next:"
echo "    cd $DIR && jarvis doctor      # check the setup"
echo "    jarvis                        # chat in the terminal"
echo "    jarvis serve                  # HUD at http://127.0.0.1:8765"
echo "    jarvis voice                  # hands-free with the wake word"
