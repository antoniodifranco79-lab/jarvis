#!/usr/bin/env bash
# Build a drag-to-Applications disk image from dist/JARVIS.app.
#   bash packaging/macos/build-dmg.sh [version]   ->  dist/JARVIS-<version>-macos.dmg
set -euo pipefail
cd "$(dirname "$0")/../.."
VERSION="${1:-${JARVIS_VERSION:-1.0.0}}"
STAGE="build/dmg"
rm -rf "$STAGE" && mkdir -p "$STAGE"
cp -R dist/JARVIS.app "$STAGE/JARVIS.app"
ln -s /Applications "$STAGE/Applications"
hdiutil create -volname "J.A.R.V.I.S." -srcfolder "$STAGE" -ov -format UDZO "dist/JARVIS-${VERSION}-macos.dmg"
echo "built dist/JARVIS-${VERSION}-macos.dmg"
