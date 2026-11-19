from __future__ import annotations

import io
import tarfile
import zipfile

import httpx
import pytest

from jarvis import engine


def test_pick_asset():
    assert engine.pick_asset("Windows", "AMD64") == "ollama-windows-amd64.zip"
    assert engine.pick_asset("Darwin", "arm64") == "ollama-darwin.tgz"
    assert engine.pick_asset("Linux", "x86_64") == "ollama-linux-amd64.tar.zst"
    assert engine.pick_asset("Linux", "aarch64") == "ollama-linux-arm64.tar.zst"
    with pytest.raises(RuntimeError):
        engine.pick_asset("Plan9", "mips")


def test_recommended_model():
    assert engine.recommended_model(4 * 1024**3) == "qwen3:1.7b"
    assert engine.recommended_model(8 * 1024**3) == "qwen3:4b"
    assert engine.recommended_model(32 * 1024**3) == "qwen3:8b"


def _zip_bytes(names: dict[str, bytes]) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        for name, data in names.items():
            zf.writestr(name, data)
    return buf.getvalue()


def test_extract_zip_and_tgz_and_zst(tmp_path):
    z = tmp_path / "a.zip"
    z.write_bytes(_zip_bytes({"ollama.exe": b"x", "../evil.txt": b"y"}))
    engine.extract_archive(z, tmp_path / "zip")
    assert (tmp_path / "zip" / "ollama.exe").exists() and not (tmp_path / "evil.txt").exists()

    tgz = tmp_path / "b.tgz"
    with tarfile.open(tgz, "w:gz") as tf:
        data = b"#!/bin/sh"
        info = tarfile.TarInfo("bin/ollama")
        info.size = len(data)
        tf.addfile(info, io.BytesIO(data))
    engine.extract_archive(tgz, tmp_path / "tgz")
    assert (tmp_path / "tgz" / "bin" / "ollama").read_bytes() == b"#!/bin/sh"

    import zstandard

    raw = io.BytesIO()
    with tarfile.open(fileobj=raw, mode="w") as tf:
        data = b"ELF"
        info = tarfile.TarInfo("bin/ollama")
        info.size = len(data)
        tf.addfile(info, io.BytesIO(data))
    zst = tmp_path / "c.tar.zst"
    zst.write_bytes(zstandard.ZstdCompressor().compress(raw.getvalue()))
    engine.extract_archive(zst, tmp_path / "zst")
    assert (tmp_path / "zst" / "bin" / "ollama").read_bytes() == b"ELF"


def test_find_ollama_prefers_our_engine(tmp_path, monkeypatch):
    monkeypatch.setattr(engine.shutil, "which", lambda name: None)
    assert engine.find_ollama(tmp_path, "Linux") is None
    binary = engine.engine_dir(tmp_path) / "bin" / "ollama"
    binary.parent.mkdir(parents=True)
    binary.write_bytes(b"x")
    assert engine.find_ollama(tmp_path, "Linux") == binary


async def test_download_engine_reports_progress_and_finds_binary(tmp_path, monkeypatch):
    payload = _zip_bytes({"ollama.exe": b"MZ fake", "lib/ollama/x.dll": b"0"})

    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path.endswith("ollama-windows-amd64.zip")
        return httpx.Response(200, content=payload, headers={"content-length": str(len(payload))})

    real_client = httpx.AsyncClient

    def fake_client(**kwargs):
        kwargs.pop("timeout", None)
        return real_client(transport=httpx.MockTransport(handler), **kwargs)

    monkeypatch.setattr(engine.httpx, "AsyncClient", fake_client)
    notices: list[str] = []

    async def notify(msg: str) -> None:
        notices.append(msg)

    binary = await engine.download_engine(tmp_path, notify, system="Windows")
    assert binary == engine.engine_dir(tmp_path) / "ollama.exe" and binary.read_bytes() == b"MZ fake"
    assert any("100%" in n for n in notices)
    assert not (engine.engine_dir(tmp_path) / "ollama-windows-amd64.zip").exists()


def _tar_zst(path, payload: bytes = b"ELF"):
    zstandard = pytest.importorskip("zstandard")
    raw = io.BytesIO()
    with tarfile.open(fileobj=raw, mode="w") as tf:
        info = tarfile.TarInfo("bin/ollama")
        info.size = len(payload)
        tf.addfile(info, io.BytesIO(payload))
    path.write_bytes(zstandard.ZstdCompressor().compress(raw.getvalue()))
    return path


def _block_zstd_modules(monkeypatch):
    import sys

    for name in ("zstandard", "compression.zstd"):
        monkeypatch.setitem(sys.modules, name, None)


def test_extract_tar_zst_without_python_zstd_explains_the_fix(tmp_path, monkeypatch):
    archive = _tar_zst(tmp_path / "e.tar.zst")
    _block_zstd_modules(monkeypatch)
    monkeypatch.setattr(engine.shutil, "which", lambda name: None)
    with pytest.raises(RuntimeError, match="zstandard"):
        engine.extract_archive(archive, tmp_path / "out")


@pytest.mark.skipif(__import__("os").name == "nt", reason="uses a POSIX shebang script")
def test_extract_tar_zst_falls_back_to_the_zstd_command(tmp_path, monkeypatch):
    import sys

    archive = _tar_zst(tmp_path / "f.tar.zst", b"ELF2")
    fake = tmp_path / "zstd"
    fake.write_text(
        f"#!{sys.executable}\n"
        "import sys, zstandard\n"
        "zstandard.ZstdDecompressor().copy_stream(sys.stdin.buffer, sys.stdout.buffer)\n"
    )
    fake.chmod(0o755)
    _block_zstd_modules(monkeypatch)
    monkeypatch.setattr(engine.shutil, "which", lambda name: str(fake) if name == "zstd" else None)
    engine.extract_archive(archive, tmp_path / "out")
    assert (tmp_path / "out" / "bin" / "ollama").read_bytes() == b"ELF2"


def test_server_extra_ships_the_engine_decompressor():
    from pathlib import Path

    tomllib = pytest.importorskip("tomllib")

    meta = tomllib.loads((Path(__file__).parents[1] / "pyproject.toml").read_text())
    extras = meta["project"]["optional-dependencies"]
    assert any(dep.startswith("zstandard") for dep in extras["server"])
