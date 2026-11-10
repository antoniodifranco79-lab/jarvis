# -*- mode: python ; coding: utf-8 -*-
"""PyInstaller recipe: `pyinstaller packaging/jarvis.spec --noconfirm` -> dist/JARVIS (JARVIS.app on macOS)."""

import sys
from pathlib import Path

from PyInstaller.utils.hooks import collect_all

ROOT = Path(SPECPATH).parent  # noqa: F821 - SPECPATH is injected by PyInstaller
datas = [
    (str(ROOT / "jarvis" / "server" / "static"), "jarvis/server/static"),
    (str(ROOT / "jarvis" / "assets"), "jarvis/assets"),
]
binaries: list = []
hiddenimports = ["jarvis.server.voice", "jarvis.voice.loop", "jarvis.voice.wakeword", "jarvis.voice.stt"]
# Optional stacks: bundle whichever is installed in the build environment.
for package in (
    "jsonschema_specifications", "edge_tts", "webview", "openwakeword", "faster_whisper", "ctranslate2", "av",
    "onnxruntime", "sounddevice", "_sounddevice_data", "soundfile", "_soundfile_data", "ddgs", "tokenizers",
    "huggingface_hub",
):
    try:
        d, b, h = collect_all(package)
    except Exception:  # noqa: BLE001 - package not installed
        continue
    datas += d
    binaries += b
    hiddenimports += h

a = Analysis(  # noqa: F821
    [str(ROOT / "packaging" / "launcher.py")],
    pathex=[str(ROOT)],
    binaries=binaries,
    datas=datas,
    hiddenimports=hiddenimports,
    excludes=["tkinter", "matplotlib", "IPython", "pytest"],
    noarchive=False,
)
pyz = PYZ(a.pure)  # noqa: F821
icon = str(ROOT / "jarvis" / "assets" / ("icon.icns" if sys.platform == "darwin" else "icon.ico"))
exe = EXE(  # noqa: F821
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name="JARVIS",
    debug=False,
    strip=False,
    upx=False,
    console=sys.platform == "linux",  # a terminal on Linux helps diagnostics; windowed elsewhere
    icon=icon,
)
coll = COLLECT(exe, a.binaries, a.datas, strip=False, upx=False, name="JARVIS")  # noqa: F821
if sys.platform == "darwin":
    app = BUNDLE(  # noqa: F821
        coll,
        name="JARVIS.app",
        icon=icon,
        bundle_identifier="ai.jarvis.hud",
        info_plist={
            "CFBundleDisplayName": "J.A.R.V.I.S.",
            "CFBundleShortVersionString": "1.0.0",
            "NSHighResolutionCapable": True,
            "NSMicrophoneUsageDescription": "Jarvis listens for the wake word and your questions.",
            "NSCameraUsageDescription": "Jarvis can look through the camera when you ask.",
        },
    )
