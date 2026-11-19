from __future__ import annotations

from jarvis.desktop import free_port, install_shortcuts


def test_linux_launcher(tmp_path):
    files = install_shortcuts(home=tmp_path, system="Linux")
    entry = tmp_path / ".local" / "share" / "applications" / "jarvis.desktop"
    assert entry in files
    text = entry.read_text()
    assert "-m jarvis app" in text and "Icon=" in text and "Terminal=false" in text
    assert (tmp_path / ".local/share/icons/hicolor/512x512/apps/jarvis.png").stat().st_size > 1000


def test_macos_bundle(tmp_path):
    bundle = install_shortcuts(home=tmp_path, system="Darwin")[0]
    plist = (bundle / "Contents" / "Info.plist").read_text()
    assert "NSMicrophoneUsageDescription" in plist and "ai.jarvis.hud" in plist
    launcher = bundle / "Contents" / "MacOS" / "jarvis"
    assert launcher.stat().st_mode & 0o111 and "-m jarvis app" in launcher.read_text()
    assert (bundle / "Contents" / "Resources" / "icon.icns").exists()


def test_free_port():
    port = free_port(0)
    assert 1024 < port < 65536


def test_windowed_app_without_console_streams_logs_to_a_file(tmp_path, monkeypatch):
    """A windowed PyInstaller build on Windows has sys.stdout/sys.stderr = None; uvicorn must still start."""
    import sys

    import uvicorn

    from jarvis.desktop import ensure_streams

    monkeypatch.setattr(sys, "stdout", None)
    monkeypatch.setattr(sys, "stderr", None)
    log_file = ensure_streams(tmp_path)
    assert sys.stdout is not None and sys.stderr is not None
    uvicorn.Config(lambda scope, receive, send: None, log_level="warning")  # crashed before the fix
    print("hello from a windowed app")
    sys.stderr.write("an error line\n")
    sys.stdout.flush()
    sys.stderr.flush()
    text = log_file.read_text(encoding="utf-8")
    assert "hello from a windowed app" in text and "an error line" in text


def test_ensure_streams_leaves_a_real_console_alone(tmp_path):
    import sys

    from jarvis.desktop import ensure_streams

    before = (sys.stdout, sys.stderr)
    assert ensure_streams(tmp_path) is None
    assert (sys.stdout, sys.stderr) == before
    assert not list(tmp_path.iterdir())
