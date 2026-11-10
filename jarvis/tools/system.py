from __future__ import annotations

import asyncio
import platform
import shutil
import time
from datetime import timedelta

import psutil

from . import ToolContext
from .base import ToolRegistry, ToolResult

MAX_OUTPUT = 8000


def status_snapshot() -> dict:
    vm = psutil.virtual_memory()
    disk = psutil.disk_usage("/")
    info: dict = {
        "hostname": platform.node(),
        "os": f"{platform.system()} {platform.release()}",
        "machine": platform.machine(),
        "cpu_percent": psutil.cpu_percent(interval=0.3),
        "cpu_cores": psutil.cpu_count(logical=True),
        "memory_used_pct": vm.percent,
        "memory_used_gb": round(vm.used / 1e9, 1),
        "memory_total_gb": round(vm.total / 1e9, 1),
        "disk_used_pct": disk.percent,
        "disk_free_gb": round(disk.free / 1e9, 1),
        "uptime": str(timedelta(seconds=int(time.time() - psutil.boot_time()))),
    }
    try:
        batt = psutil.sensors_battery()
        if batt:
            info["battery_pct"] = batt.percent
            info["plugged_in"] = batt.power_plugged
    except Exception:  # noqa: BLE001 - not every platform has sensors
        pass
    try:
        temps = psutil.sensors_temperatures()
        if temps:
            first = next(iter(temps.values()))
            if first:
                info["temperature_c"] = first[0].current
    except Exception:  # noqa: BLE001
        pass
    procs = []
    for p in psutil.process_iter(["name", "cpu_percent", "memory_percent"]):
        try:
            procs.append(p.info)
        except (psutil.NoSuchProcess, psutil.AccessDenied):
            continue
    procs.sort(key=lambda p: p.get("cpu_percent") or 0, reverse=True)
    info["top_processes"] = [
        {"name": p["name"], "cpu": p.get("cpu_percent"), "mem_pct": round(p.get("memory_percent") or 0, 1)}
        for p in procs[:5]
    ]
    return info


async def run_command(command: str, timeout: float = 30.0) -> ToolResult:
    shell = shutil.which("bash") or None
    proc = await asyncio.create_subprocess_shell(
        command,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.STDOUT,
        executable=shell,
    )
    try:
        out, _ = await asyncio.wait_for(proc.communicate(), timeout=timeout)
    except asyncio.TimeoutError:
        proc.kill()
        return ToolResult.error(f"Command timed out after {timeout:.0f}s and was killed.")
    text = out.decode(errors="replace")
    if len(text) > MAX_OUTPUT:
        text = text[:MAX_OUTPUT] + f"\n… [truncated, {len(text) - MAX_OUTPUT} more characters]"
    result = f"exit code: {proc.returncode}\n{text}".strip()
    return ToolResult(result, is_error=proc.returncode != 0)


def register(registry: ToolRegistry, ctx: ToolContext) -> None:
    @registry.tool()
    def system_status() -> dict:
        """Diagnostics of the machine Jarvis runs on: CPU, memory, disk, battery, uptime, busiest processes.
        Call it for "run diagnostics", "how is the system", "battery?", "what's eating my CPU"."""
        return status_snapshot()

    if ctx.settings.shell_enabled:

        @registry.tool(dangerous=True, timeout=120)
        async def run_shell(command: str, timeout: int = 30) -> ToolResult:
            """Run a shell command on the user's machine and return its output. Use it for anything the other
            tools don't cover: listing processes, checking the network, git, package managers, opening files
            with system utilities. The user is asked to approve each command first.

            Args:
                command: The exact command line to execute.
                timeout: Seconds to wait before killing it (max 120).
            """
            return await run_command(command, timeout=min(max(timeout, 1), 120))
