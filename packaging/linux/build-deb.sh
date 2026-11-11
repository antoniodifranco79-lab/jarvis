#!/usr/bin/env bash
# Build a Debian/Ubuntu package from the PyInstaller folder dist/JARVIS.
#   bash packaging/linux/build-deb.sh [version]   ->  dist/jarvis_<version>_amd64.deb
set -euo pipefail
cd "$(dirname "$0")/../.."
VERSION="${1:-${JARVIS_VERSION:-1.0.0}}"
ARCH="$(dpkg --print-architecture 2>/dev/null || echo amd64)"
ROOT="build/deb"
rm -rf "$ROOT"
mkdir -p "$ROOT/DEBIAN" "$ROOT/opt/jarvis" "$ROOT/usr/share/applications" "$ROOT/usr/share/icons/hicolor/512x512/apps" "$ROOT/usr/bin"
cp -r dist/JARVIS/. "$ROOT/opt/jarvis/"
cp jarvis/assets/icon.png "$ROOT/usr/share/icons/hicolor/512x512/apps/jarvis.png"
cat > "$ROOT/usr/share/applications/jarvis.desktop" <<DESKTOP
[Desktop Entry]
Type=Application
Name=J.A.R.V.I.S.
Comment=Just A Rather Very Intelligent System
Exec=/opt/jarvis/JARVIS
Icon=jarvis
Terminal=false
Categories=Utility;AudioVideo;
Keywords=assistant;voice;ai;
StartupWMClass=jarvis
DESKTOP
ln -sf /opt/jarvis/JARVIS "$ROOT/usr/bin/jarvis"
cat > "$ROOT/DEBIAN/control" <<CONTROL
Package: jarvis
Version: $VERSION
Section: utils
Priority: optional
Architecture: $ARCH
Depends: libc6
Recommends: libportaudio2, ffmpeg, gir1.2-webkit2-4.1, python3-gi
Maintainer: Antonio Di Franco <antoniodifranco.79@gmail.com>
Homepage: https://github.com/antoniodifranco79-lab/jarvis
Description: J.A.R.V.I.S. - Just A Rather Very Intelligent System
 A personal AI butler with voice, memory, tools and an arc-reactor HUD.
 Runs on Claude (API key) or on a free local model that the app sets up itself.
CONTROL
cat > "$ROOT/DEBIAN/postinst" <<'POST'
#!/bin/sh
set -e
chmod +x /opt/jarvis/JARVIS
command -v update-desktop-database >/dev/null 2>&1 && update-desktop-database -q /usr/share/applications || true
command -v gtk-update-icon-cache >/dev/null 2>&1 && gtk-update-icon-cache -q /usr/share/icons/hicolor || true
exit 0
POST
chmod 755 "$ROOT/DEBIAN/postinst"
mkdir -p dist
fakeroot dpkg-deb --build "$ROOT" "dist/jarvis_${VERSION}_${ARCH}.deb" 2>/dev/null || dpkg-deb --build --root-owner-group "$ROOT" "dist/jarvis_${VERSION}_${ARCH}.deb"
echo "built dist/jarvis_${VERSION}_${ARCH}.deb"
