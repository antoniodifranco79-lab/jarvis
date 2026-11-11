"""The local AI engine, set up by the app itself: finds, downloads, extracts and starts Ollama.

Nothing is asked of the user. On first launch the app fetches the official Ollama package for this
platform into the Jarvis data folder, then pulls the model; later launches just start it.
"""

from __future__ import annotations

import logging
import os
import platform
import shutil
import subprocess
import sys
import tarfile
import zipfile
from collections.abc import Awaitable, Callable
from pathlib import Path

import httpx

log = logging.getLogger(__name__)
Notify = Callable[[str], Awaitable[None]]

DOWNLOAD_BASE = "https://github.com/ollama/ollama/releases/latest/download"
ASSETS = {
    ("Windows", "amd64"): "ollama-windows-amd64.zip",
    ("Windows", "arm64"): "ollama-windows-arm64.zip",
    ("Darwin", "amd64"): "ollama-darwin.tgz",
    ("Darwin", "arm64"): "ollama-darwin.tgz",
    ("Linux", "amd64"): "ollama-linux-amd64.tar.zst",
    ("Linux", "arm64"): "ollama-linux-arm64.tar.zst",
}


def machine_arch(machine: str | None = None) -> str:
    m = (machine or platform.machine()).lower()
    return "arm64" if m in ("arm64", "aarch64") else "amd64"


def pick_asset(system: str | None = None, machine: str | None = None) -> str:
    key = (system or platform.system(), machine_arch(machine))
    try:
        return ASSETS[key]
    except KeyError as exc:
        raise RuntimeError(f"no Ollama package for {key[0]} {key[1]}") from exc


def engine_dir(data_dir: Path) -> Path:
    return data_dir / "engine"


def models_dir(data_dir: Path) -> Path:
    return data_dir / "models"


def binary_name(system: str | None = None) -> str:
    return "ollama.exe" if (system or platform.system()) == "Windows" else "ollama"


def find_ollama(data_dir: Path, system: str | None = None) -> Path | None:
    """The engine we downloaded, or an Ollama already installed on this machine."""
    system = system or platform.system()
    name = binary_name(system)
    candidates = [engine_dir(data_dir) / name, engine_dir(data_dir) / "bin" / name]
    found = shutil.which("ollama")
    if found:
        candidates.append(Path(found))
    if system == "Darwin":
        candidates.append(Path("/Applications/Ollama.app/Contents/Resources/ollama"))
        candidates.append(Path("/usr/local/bin/ollama"))
    elif system == "Windows":
        local = os.environ.get("LOCALAPPDATA")
        if local:
            candidates.append(Path(local) / "Programs" / "Ollama" / "ollama.exe")
    else:
        candidates += [Path("/usr/local/bin/ollama"), Path("/usr/bin/ollama")]
    for path in candidates:
        if path.is_file():
            return path
    return None


def extract_archive(archive: Path, dest: Path) -> None:
    """Unpack .zip, .tgz/.tar.gz or .tar.zst into dest (safe paths only)."""
    dest.mkdir(parents=True, exist_ok=True)
    name = archive.name.lower()

    def safe(member_name: str) -> bool:
        target = (dest / member_name).resolve()
        return target == dest.resolve() or dest.resolve() in target.parents

    if name.endswith(".zip"):
        with zipfile.ZipFile(archive) as zf:
            for info in zf.infolist():
                if safe(info.filename):
                    zf.extract(info, dest)
        return
    if name.endswith(".tar.zst"):
        import zstandard

        with (
            open(archive, "rb") as fh,
            zstandard.ZstdDecompressor().stream_reader(fh) as reader,
            tarfile.open(fileobj=reader, mode="r|") as tf,
        ):
            for member in tf:
                if safe(member.name):
                    tf.extract(member, dest)
        return
    with tarfile.open(archive, mode="r:*") as tf:
        for member in tf.getmembers():
            if safe(member.name):
                tf.extract(member, dest)


def _locate_binary(root: Path, system: str) -> Path | None:
    name = binary_name(system)
    for path in (root / name, root / "bin" / name):
        if path.is_file():
            return path
    for path in root.rglob(name):
        if path.is_file():
            return path
    return None


async def download_engine(data_dir: Path, notify: Notify, *, system: str | None = None) -> Path:
    """Fetch the official Ollama package for this platform into the data folder and return its binary."""
    system = system or platform.system()
    asset = pick_asset(system)
    target_dir = engine_dir(data_dir)
    target_dir.mkdir(parents=True, exist_ok=True)
    archive = target_dir / asset
    url = f"{DOWNLOAD_BASE}/{asset}"
    await notify("First start: downloading the AI engine. This happens only once.")
    last_step = -1
    async with (
        httpx.AsyncClient(follow_redirects=True, timeout=httpx.Timeout(600.0, connect=20.0)) as client,
        client.stream("GET", url) as r,
    ):
        r.raise_for_status()
        total = int(r.headers.get("content-length") or 0)
        done = 0
        with open(archive, "wb") as fh:
            async for chunk in r.aiter_bytes(1 << 20):
                fh.write(chunk)
                done += len(chunk)
                if total:
                    step = int(done * 100 / total) // 10 * 10
                    if step > last_step:
                        last_step = step
                        await notify(f"Downloading the AI engine: {step}% of {total / 1e9:.1f} GB")
    await notify("Unpacking the AI engine…")
    extract_archive(archive, target_dir)
    archive.unlink(missing_ok=True)
    binary = _locate_binary(target_dir, system)
    if binary is None:
        raise RuntimeError("the engine package didn't contain an ollama executable")
    if system != "Windows":
        binary.chmod(binary.stat().st_mode | 0o755)
    return binary


def start_engine(binary: Path, data_dir: Path, host: str = "127.0.0.1:11434") -> subprocess.Popen:
    env = dict(os.environ)
    env.setdefault("OLLAMA_MODELS", str(models_dir(data_dir)))
    env.setdefault("OLLAMA_HOST", host)
    models_dir(data_dir).mkdir(parents=True, exist_ok=True)
    kwargs: dict = {
        "stdout": subprocess.DEVNULL,
        "stderr": subprocess.DEVNULL,
        "env": env,
        "cwd": str(binary.parent),
    }
    if sys.platform == "win32":
        kwargs["creationflags"] = getattr(subprocess, "CREATE_NO_WINDOW", 0) | getattr(
            subprocess, "DETACHED_PROCESS", 0
        )
    else:
        kwargs["start_new_session"] = True
    return subprocess.Popen([str(binary), "serve"], **kwargs)


def recommended_model(total_ram_bytes: int | None = None) -> str:
    """Pick a Qwen3 size the machine can actually run."""
    if total_ram_bytes is None:
        try:
            import psutil

            total_ram_bytes = psutil.virtual_memory().total
        except Exception:  # noqa: BLE001
            total_ram_bytes = 16 * 1024**3
    gb = total_ram_bytes / 1024**3
    if gb < 6:
        return "qwen3:1.7b"
    if gb < 12:
        return "qwen3:4b"
    return "qwen3:8b"
