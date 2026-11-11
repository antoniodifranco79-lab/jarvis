"""The desktop app: the HUD in its own window, plus launchers for the app menu, Dock or Start menu."""

from __future__ import annotations

import logging
import platform
import shutil
import socket
import subprocess
import sys
import threading
import time
import webbrowser
from pathlib import Path

from .config import Settings

log = logging.getLogger(__name__)
ASSETS = Path(__file__).parent / "assets"
APP_NAME = "J.A.R.V.I.S."
BUNDLE_ID = "ai.jarvis.hud"
REPO_ROOT = Path(__file__).resolve().parents[1]


def free_port(preferred: int) -> int:
    for port in (preferred, 0):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            try:
                s.bind(("127.0.0.1", port))
                return s.getsockname()[1]
            except OSError:
                continue
    raise RuntimeError("no free TCP port")


def start_server(settings: Settings, *, voice: bool):
    """Run the HUD server on a background thread; return (server, thread, url) once it answers."""
    import uvicorn

    from .server.app import create_app

    port = free_port(settings.port)
    config = uvicorn.Config(
        create_app(settings, voice=voice), host="127.0.0.1", port=port, log_level="warning"
    )
    server = uvicorn.Server(config)
    thread = threading.Thread(target=server.run, daemon=True, name="jarvis-server")
    thread.start()
    deadline = time.monotonic() + 30
    while not server.started and thread.is_alive() and time.monotonic() < deadline:
        time.sleep(0.05)
    if not server.started:
        raise RuntimeError("the HUD server did not start")
    return server, thread, f"http://127.0.0.1:{port}"


def open_window(url: str) -> bool:
    """Show the HUD in a native window (pywebview). Returns False when no window toolkit is available."""
    try:
        import webview
    except ImportError:
        log.warning("pywebview is not installed (pip install 'jarvis-ai[app]'); opening the browser instead")
        return False
    try:
        webview.create_window(
            APP_NAME,
            url,
            width=1200,
            height=800,
            min_size=(420, 640),
            background_color="#04080f",
            text_select=True,
        )
        webview.start(private_mode=False)
    except Exception as exc:  # noqa: BLE001 - e.g. Linux without GTK/Qt WebKit
        log.warning("native window unavailable (%s); opening the browser instead", exc)
        return False
    return True


def run_app(settings: Settings, *, voice: bool = True, browser: bool = False) -> None:
    try:
        ensure_desktop_shortcut()
    except Exception as exc:  # noqa: BLE001 - cosmetic
        log.debug("desktop shortcut skipped: %s", exc)
    server, thread, url = start_server(settings, voice=voice)
    try:
        if browser or not open_window(url):
            webbrowser.open(url)
            print(f"J.A.R.V.I.S. is running at {url}  (Ctrl+C to quit)")
            while thread.is_alive():
                time.sleep(0.5)
    except KeyboardInterrupt:
        pass
    finally:
        server.should_exit = True
        thread.join(timeout=10)


# ---------------------------------------------------------------- launchers


def python_for_launcher() -> Path:
    exe = Path(sys.executable)
    if platform.system() == "Windows":
        quiet = exe.with_name("pythonw.exe")
        if quiet.exists():
            return quiet
    return exe


def is_frozen() -> bool:
    return bool(getattr(sys, "frozen", False))


def launch_command() -> tuple[Path, str]:
    """(executable, arguments) that open the app: the frozen binary itself, or python -m jarvis app."""
    if is_frozen():
        return Path(sys.executable), ""
    return python_for_launcher(), "-m jarvis app"


def ensure_desktop_shortcut(home: Path | None = None) -> Path | None:
    """Linux: put a launcher on the user's Desktop once (the installers do this on Windows and macOS)."""
    if platform.system() != "Linux":
        return None
    home = home or Path.home()
    desktop = home / "Desktop"
    try:
        out = subprocess.run(["xdg-user-dir", "DESKTOP"], capture_output=True, text=True, timeout=5)
        if out.returncode == 0 and out.stdout.strip():
            desktop = Path(out.stdout.strip())
    except (OSError, subprocess.SubprocessError):
        pass
    if not desktop.is_dir():
        return None
    entry = desktop / "jarvis.desktop"
    if entry.exists():
        return entry
    exe, args = launch_command()
    icon = ASSETS / "icon.png"
    entry.write_text(
        "[Desktop Entry]\nType=Application\nName=J.A.R.V.I.S.\nComment=Just A Rather Very Intelligent System\n"
        f'Exec="{exe}" {args}\nIcon={icon}\nTerminal=false\nCategories=Utility;AudioVideo;\n',
        encoding="utf-8",
    )
    entry.chmod(0o755)
    subprocess.run(["gio", "set", str(entry), "metadata::trusted", "true"], check=False, capture_output=True)
    return entry


def install_shortcuts(home: Path | None = None, system: str | None = None) -> list[Path]:
    """Create an app launcher for the current OS. Returns the files written."""
    home = home or Path.home()
    system = system or platform.system()
    exe, args = launch_command()
    if system == "Darwin":
        return [_macos_bundle(home / "Applications" / "JARVIS.app", exe, args)]
    if system == "Windows":
        return _windows_shortcuts(home, exe, args)
    return _linux_desktop_entry(home, exe, args)


def _linux_desktop_entry(home: Path, exe: Path, args: str) -> list[Path]:
    apps = home / ".local" / "share" / "applications"
    icons = home / ".local" / "share" / "icons" / "hicolor" / "512x512" / "apps"
    apps.mkdir(parents=True, exist_ok=True)
    icons.mkdir(parents=True, exist_ok=True)
    icon = icons / "jarvis.png"
    shutil.copyfile(ASSETS / "icon.png", icon)
    entry = apps / "jarvis.desktop"
    entry.write_text(
        "[Desktop Entry]\n"
        "Type=Application\n"
        f"Name={APP_NAME}\n"
        "Comment=Just A Rather Very Intelligent System\n"
        f'Exec="{exe}" {args}\n'
        f"Path={REPO_ROOT}\n"
        f"Icon={icon}\n"
        "Terminal=false\n"
        "Categories=Utility;AudioVideo;\n"
        "Keywords=assistant;voice;ai;\n"
        "StartupWMClass=jarvis\n",
        encoding="utf-8",
    )
    entry.chmod(0o755)
    if shutil.which("update-desktop-database"):
        subprocess.run(["update-desktop-database", str(apps)], check=False, capture_output=True)
    return [entry, icon]


def _macos_bundle(bundle: Path, exe: Path, args: str) -> Path:
    (bundle / "Contents" / "MacOS").mkdir(parents=True, exist_ok=True)
    (bundle / "Contents" / "Resources").mkdir(parents=True, exist_ok=True)
    shutil.copyfile(ASSETS / "icon.icns", bundle / "Contents" / "Resources" / "icon.icns")
    launcher = bundle / "Contents" / "MacOS" / "jarvis"
    launcher.write_text(f'#!/bin/sh\ncd "{REPO_ROOT}"\nexec "{exe}" {args}\n', encoding="utf-8")
    launcher.chmod(0o755)
    (bundle / "Contents" / "Info.plist").write_text(
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n'
        '<plist version="1.0"><dict>\n'
        f"<key>CFBundleName</key><string>{APP_NAME}</string>\n"
        f"<key>CFBundleDisplayName</key><string>{APP_NAME}</string>\n"
        f"<key>CFBundleIdentifier</key><string>{BUNDLE_ID}</string>\n"
        "<key>CFBundleExecutable</key><string>jarvis</string>\n"
        "<key>CFBundleIconFile</key><string>icon.icns</string>\n"
        "<key>CFBundlePackageType</key><string>APPL</string>\n"
        "<key>CFBundleVersion</key><string>1.0.0</string>\n"
        "<key>CFBundleShortVersionString</key><string>1.0.0</string>\n"
        "<key>LSMinimumSystemVersion</key><string>11.0</string>\n"
        "<key>NSHighResolutionCapable</key><true/>\n"
        "<key>NSMicrophoneUsageDescription</key><string>Jarvis listens for the wake word and your questions.</string>\n"
        "<key>NSCameraUsageDescription</key><string>Jarvis can look through the camera when you ask.</string>\n"
        "</dict></plist>\n",
        encoding="utf-8",
    )
    return bundle


def _windows_shortcuts(home: Path, exe: Path, args: str) -> list[Path]:
    desktop = home / "Desktop" / "JARVIS.lnk"
    start = home / "AppData" / "Roaming" / "Microsoft" / "Windows" / "Start Menu" / "Programs" / "JARVIS.lnk"
    icon = ASSETS / "icon.ico"
    script = "\n".join(
        f'$s = (New-Object -ComObject WScript.Shell).CreateShortcut("{target}"); '
        f'$s.TargetPath = "{exe}"; $s.Arguments = "{args}"; $s.WorkingDirectory = "{REPO_ROOT}"; '
        f'$s.IconLocation = "{icon}"; $s.Description = "Just A Rather Very Intelligent System"; $s.Save()'
        for target in (desktop, start)
    )
    subprocess.run(
        ["powershell", "-NoProfile", "-NonInteractive", "-Command", script], check=True, capture_output=True
    )
    return [desktop, start]
