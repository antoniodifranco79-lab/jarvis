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
