from __future__ import annotations

import platform
import shutil
import subprocess
import webbrowser

from . import ToolContext
from .base import ToolRegistry, ToolResult


def open_app_command(name: str) -> list[str]:
    system = platform.system()
    if system == "Darwin":
        return ["open", "-a", name]
    if system == "Windows":
        return ["cmd", "/c", "start", "", name]
    exe = shutil.which(name) or shutil.which(name.lower())
    return [exe] if exe else ["xdg-open", name]


def register(registry: ToolRegistry, ctx: ToolContext) -> None:
    @registry.tool()
    def open_url(url: str) -> ToolResult:
        """Open a web page in the user's default browser. Call it for "open YouTube", "go to…", "show me the site".

        Args:
            url: Full URL including https://.
        """
        if not url.lower().startswith(("http://", "https://")):
            url = "https://" + url
        ok = webbrowser.open(url)
        return ToolResult(f"Opened {url}." if ok else f"Could not open a browser for {url}.")

    @registry.tool(dangerous=True)
    def open_application(name: str) -> ToolResult:
        """Launch an application on the user's computer (e.g. "Spotify", "Visual Studio Code", "calculator").
        Call it when the user asks to open, launch or start a program. Requires the user's approval.

        Args:
            name: The application's name or executable.
        """
        cmd = open_app_command(name)
        try:
            subprocess.Popen(
                cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=True
            )
        except (OSError, FileNotFoundError) as exc:
            return ToolResult.error(f"Could not launch {name}: {exc}")
        return ToolResult(f"Launching {name}.")
