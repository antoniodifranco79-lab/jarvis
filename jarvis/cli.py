"""Command-line entry points: chat, ask, voice, serve, doctor, memory, reminders."""

from __future__ import annotations

import argparse
import asyncio
import json
import logging
import os
import sys
from typing import Any

from rich.console import Console
from rich.panel import Panel
from rich.table import Table

from . import __version__
from .config import get_settings

console = Console()
JARVIS_STYLE = "bold cyan"


def _print_event(event: dict[str, Any], buffer: list[str]) -> None:
    kind = event["type"]
    if kind == "text":
        buffer.append(event["text"])
        console.print(event["text"], end="", style="white", highlight=False, markup=False)
    elif kind == "tool_start":
        console.print(f"\n[dim]⚙ {event['name']}…[/dim]", end="")
    elif kind == "tool_end":
        mark = "[green]✓[/green]" if event["ok"] else "[red]✗[/red]"
        console.print(f" {mark} [dim]{event['preview']}[/dim]")
    elif kind in ("error", "notice"):
        console.print(f"\n[yellow]{event['message']}[/yellow]")


async def _stdin_approver(tool: str, arguments: dict[str, Any]) -> bool:
    console.print(
        Panel(
            json.dumps(arguments, ensure_ascii=False, indent=2), title=f"[red]Approval required: {tool}[/red]"
        )
    )
    answer = await asyncio.to_thread(input, "Allow? [y/N] ")
    return answer.strip().lower() in {"y", "yes", "s", "si", "sì"}


async def _chat(args: argparse.Namespace) -> None:
    from .app import Jarvis

    settings = get_settings()
    jarvis = Jarvis(settings, mode="text", approver=_stdin_approver)
    await jarvis.start()
    speaker = None
    if args.speak:
        from .voice.tts import Speaker

        speaker = Speaker(settings)

    async def on_event(event):
        if event.type == "reminder":
            console.print(f"\n[bold yellow]⏰ {event.data['message']}[/bold yellow]")
            if speaker:
                await speaker.speak(f"{settings.user_name}, a reminder: {event.data['message']}")

    jarvis.bus.subscribe(on_event)
    console.print(
        Panel(
            f"[{JARVIS_STYLE}]J.A.R.V.I.S.[/] v{__version__} · model {settings.model} · effort {settings.effort}\n"
            "Commands: /new (fresh conversation) · /memory · /reminders · /quit",
            border_style="cyan",
        )
    )
    hello = jarvis.greeting()
    console.print(f"[{JARVIS_STYLE}]JARVIS ›[/] {hello}")
    if speaker:
        await speaker.speak(hello)
    try:
        while True:
            try:
                text = await asyncio.to_thread(input, "\nYou › ")
            except (EOFError, KeyboardInterrupt):
                break
            text = text.strip()
            if not text:
                continue
            if text in {"/quit", "/exit", "/q"}:
                break
            if text == "/new":
                jarvis.brain.new_session()
                console.print("[dim]New conversation started.[/dim]")
                continue
            if text == "/memory":
                _print_facts(jarvis.memory.all_facts())
                continue
            if text == "/reminders":
                _print_reminders(jarvis.memory.pending_reminders())
                continue
            console.print(f"[{JARVIS_STYLE}]JARVIS ›[/] ", end="")
            buffer: list[str] = []
            async for event in jarvis.brain.ask(text):
                _print_event(event, buffer)
            console.print()
            if speaker and buffer:
                await speaker.speak("".join(buffer))
    finally:
        await jarvis.stop()
    console.print(f"[{JARVIS_STYLE}]JARVIS ›[/] Goodbye, {settings.user_name}.")


async def _ask(args: argparse.Namespace) -> None:
    from .app import Jarvis

    jarvis = Jarvis(get_settings(), mode="text", approver=_stdin_approver)
    await jarvis.start()
    try:
        buffer: list[str] = []
        async for event in jarvis.brain.ask(" ".join(args.text)):
            _print_event(event, buffer)
        console.print()
    finally:
        await jarvis.stop()


async def _voice(args: argparse.Namespace) -> None:
    from .app import Jarvis
    from .voice.loop import VoiceLoop

    settings = get_settings()
    jarvis = Jarvis(settings, mode="voice")
    await jarvis.start()
    loop = VoiceLoop(jarvis, push_to_talk=args.push_to_talk)
    try:
        await loop.run()
    finally:
        await jarvis.stop()


def _serve(args: argparse.Namespace) -> None:
    import uvicorn

    from .server.app import create_app

    settings = get_settings()
    host = args.host or settings.host
    port = args.port or settings.port
    console.print(Panel(f"[{JARVIS_STYLE}]J.A.R.V.I.S. HUD[/] → http://{host}:{port}", border_style="cyan"))
    uvicorn.run(create_app(settings), host=host, port=port, log_level="info")


def _doctor(_: argparse.Namespace) -> None:
    settings = get_settings()
    table = Table(title="J.A.R.V.I.S. diagnostics", show_lines=False)
    table.add_column("Check")
    table.add_column("Status")

    def row(name: str, ok: bool | None, detail: str = "") -> None:
        mark = (
            "[green]OK[/green]"
            if ok
            else ("[yellow]optional[/yellow]" if ok is None else "[red]MISSING[/red]")
        )
        table.add_row(name, f"{mark} {detail}".strip())

    row(
        "ANTHROPIC_API_KEY",
        bool(os.environ.get("ANTHROPIC_API_KEY")),
        "" if os.environ.get("ANTHROPIC_API_KEY") else "export it or put it in .env",
    )
    row("model", True, f"{settings.model} (effort {settings.effort})")
    row("data dir", True, str(settings.data_dir))
    row("workspace", True, str(settings.workspace))
    for module, label in (
        ("anthropic", "anthropic SDK"),
        ("fastapi", "HUD server (pip install 'jarvis-ai[server]')"),
        ("edge_tts", "edge-tts voice"),
        ("sounddevice", "microphone/speaker (voice extra)"),
        ("faster_whisper", "speech-to-text (voice extra)"),
        ("openwakeword", "wake word (voice extra)"),
        ("mss", "screen vision (vision extra)"),
        ("cv2", "camera vision (vision extra)"),
    ):
        try:
            __import__(module)
            row(label, True)
        except Exception:  # noqa: BLE001
            row(label, None if module != "anthropic" else False)
    import shutil

    player = next((p for p in ("ffplay", "mpv", "afplay", "mpg123", "cvlc") if shutil.which(p)), None)
    row("audio player", bool(player) or None, player or "install ffmpeg for playback")
    row(
        "Home Assistant",
        None if not settings.home_assistant_url else True,
        settings.home_assistant_url or "not configured",
    )
    console.print(table)


def _memory(args: argparse.Namespace) -> None:
    from .memory import Memory

    memory = Memory(get_settings().db_path)
    if args.action == "forget":
        console.print("Forgotten." if memory.forget(args.id) else "No such fact.")
    else:
        _print_facts(memory.all_facts())


def _reminders(_: argparse.Namespace) -> None:
    from .memory import Memory

    _print_reminders(Memory(get_settings().db_path).pending_reminders())


def _print_facts(facts: list[dict[str, Any]]) -> None:
    if not facts:
        console.print("[dim]Nothing remembered yet.[/dim]")
        return
    table = Table(title="Long-term memory")
    table.add_column("id", justify="right")
    table.add_column("category")
    table.add_column("fact")
    for f in facts:
        table.add_row(str(f["id"]), f["category"], f["fact"])
    console.print(table)


def _print_reminders(reminders) -> None:
    if not reminders:
        console.print("[dim]No pending reminders.[/dim]")
        return
    table = Table(title="Pending reminders")
    table.add_column("id", justify="right")
    table.add_column("due")
    table.add_column("message")
    for r in reminders:
        table.add_row(str(r.id), r.due_at.strftime("%a %d %b %H:%M"), r.message)
    console.print(table)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="jarvis", description="J.A.R.V.I.S. - Just A Rather Very Intelligent System"
    )
    parser.add_argument("--version", action="version", version=f"jarvis {__version__}")
    parser.add_argument("-v", "--verbose", action="store_true", help="debug logging")
    sub = parser.add_subparsers(dest="command")

    chat = sub.add_parser("chat", help="text conversation in the terminal (default)")
    chat.add_argument("--speak", action="store_true", help="also read answers aloud")
    chat.set_defaults(func=lambda a: asyncio.run(_chat(a)))

    ask = sub.add_parser("ask", help="one question, one answer")
    ask.add_argument("text", nargs="+")
    ask.set_defaults(func=lambda a: asyncio.run(_ask(a)))

    voice = sub.add_parser("voice", help="hands-free: wake word, microphone, speech")
    voice.add_argument(
        "--push-to-talk", action="store_true", help="press Enter instead of saying the wake word"
    )
    voice.set_defaults(func=lambda a: asyncio.run(_voice(a)))

    serve = sub.add_parser("serve", help="start the HUD web interface")
    serve.add_argument("--host")
    serve.add_argument("--port", type=int)
    serve.set_defaults(func=_serve)

    doctor = sub.add_parser("doctor", help="check configuration and optional components")
    doctor.set_defaults(func=_doctor)

    memory = sub.add_parser("memory", help="inspect long-term memory")
    memory.add_argument("action", nargs="?", default="list", choices=["list", "forget"])
    memory.add_argument("id", nargs="?", type=int)
    memory.set_defaults(func=_memory)

    reminders = sub.add_parser("reminders", help="list pending reminders")
    reminders.set_defaults(func=_reminders)
    return parser


def main(argv: list[str] | None = None) -> None:
    parser = build_parser()
    args = parser.parse_args(argv)
    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.WARNING, format="%(name)s: %(message)s"
    )
    if not args.command:
        args.speak = False
        asyncio.run(_chat(args))
        return
    try:
        args.func(args)
    except KeyboardInterrupt:
        console.print("\n[dim]Interrupted.[/dim]")
        sys.exit(130)
