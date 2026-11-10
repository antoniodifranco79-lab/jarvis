"""FastAPI application: serves the HUD, streams brain events over WebSocket, speaks through edge-tts."""

from __future__ import annotations

import asyncio
import base64
import contextlib
import logging
import uuid
from pathlib import Path
from typing import Any

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel

from .. import __version__
from ..app import Jarvis
from ..config import Settings, get_settings
from ..events import Event
from ..tools.system import status_snapshot
from ..voice.sentences import SentenceBuffer
from ..voice.tts import Speaker

log = logging.getLogger(__name__)
STATIC = Path(__file__).parent / "static"
ASSETS = Path(__file__).parent.parent / "assets"
MANIFEST = {
    "name": "J.A.R.V.I.S.",
    "short_name": "JARVIS",
    "description": "Just A Rather Very Intelligent System",
    "start_url": "/",
    "display": "standalone",
    "background_color": "#04080f",
    "theme_color": "#04080f",
    "icons": [
        {"src": "/icon-192.png", "sizes": "192x192", "type": "image/png"},
        {"src": "/icon.png", "sizes": "512x512", "type": "image/png"},
    ],
}


class AskBody(BaseModel):
    text: str


class Hub:
    """Fans brain events out to every connected HUD and routes approvals back."""

    def __init__(self, jarvis: Jarvis, speaker: Speaker) -> None:
        self.jarvis = jarvis
        self.speaker = speaker
        self.clients: set[WebSocket] = set()
        self.pending: dict[str, asyncio.Future[bool]] = {}
        self.busy = False
        jarvis.bus.subscribe(self.on_event)
        jarvis.approver = self.approve

    async def broadcast(self, payload: dict[str, Any]) -> None:
        dead = []
        for ws in list(self.clients):
            try:
                await ws.send_json(payload)
            except Exception:  # noqa: BLE001
                dead.append(ws)
        for ws in dead:
            self.clients.discard(ws)

    async def on_event(self, event: Event) -> None:
        if event.type in ("state", "tool_end", "reminder", "session", "notice"):
            await self.broadcast(event.to_dict())
            if event.type == "reminder":
                await self.speak_text(f"{self.jarvis.settings.user_name}, {event.data['message']}")

    async def approve(self, tool: str, arguments: dict[str, Any]) -> bool:
        request_id = str(uuid.uuid4())
        fut: asyncio.Future[bool] = asyncio.get_running_loop().create_future()
        self.pending[request_id] = fut
        await self.broadcast({"type": "approval_request", "id": request_id, "tool": tool, "input": arguments})
        try:
            return await asyncio.wait_for(fut, timeout=90)
        except asyncio.TimeoutError:
            return False
        finally:
            self.pending.pop(request_id, None)

    def resolve(self, request_id: str, allowed: bool) -> None:
        fut = self.pending.get(request_id)
        if fut and not fut.done():
            fut.set_result(allowed)

    async def speak_text(self, text: str) -> None:
        try:
            audio = await self.speaker.synthesize(text)
        except Exception as exc:  # noqa: BLE001
            log.warning("tts failed: %s", exc)
            audio = None
        if audio:
            await self.broadcast(
                {"type": "audio", "mime": "audio/mpeg", "b64": base64.b64encode(audio).decode(), "text": text}
            )
        else:
            await self.broadcast({"type": "speak", "text": text})  # the browser falls back to speechSynthesis

    async def ask(self, text: str) -> None:
        if self.busy:
            await self.broadcast({"type": "notice", "message": "One thing at a time, please."})
            return
        self.busy = True
        buffer = SentenceBuffer()
        speech: asyncio.Queue[str | None] = asyncio.Queue()

        async def speech_worker() -> None:
            while True:
                sentence = await speech.get()
                if sentence is None:
                    return
                await self.speak_text(sentence)

        worker = asyncio.create_task(speech_worker())
        await self.broadcast({"type": "user", "text": text})
        try:
            async for event in self.jarvis.brain.ask(text):
                if event["type"] == "text":
                    await self.broadcast(event)
                    for sentence in buffer.feed(event["text"]):
                        await speech.put(sentence)
                elif event["type"] in ("error", "notice"):
                    await self.broadcast(event)
                    await speech.put(event["message"])
                elif event["type"] == "final":
                    for sentence in buffer.flush():
                        await speech.put(sentence)
                    await self.broadcast(event)
        except Exception as exc:  # noqa: BLE001
            log.exception("ask failed")
            await self.broadcast({"type": "error", "message": f"Something went wrong: {exc}"})
        finally:
            await speech.put(None)
            with contextlib.suppress(Exception):
                await worker
            self.busy = False


def create_app(
    settings: Settings | None = None, jarvis: Jarvis | None = None, *, voice: bool = False
) -> FastAPI:
    """Build the HUD server. ``voice=True`` also runs the wake-word microphone loop on this machine."""
    settings = settings or get_settings()
    app = FastAPI(title="J.A.R.V.I.S.", version=__version__)
    state: dict[str, Any] = {}

    @app.on_event("startup")
    async def _startup() -> None:
        j = jarvis or Jarvis(settings, mode="voice")
        await j.start()
        state["jarvis"] = j
        state["hub"] = Hub(j, Speaker(settings))
        if settings.resolved_provider == "ollama":
            from ..providers.ollama import ensure_ready

            async def notify(message: str) -> None:
                await j.bus.publish("notice", message=message)

            state["brain_prep"] = asyncio.create_task(
                ensure_ready(settings.ollama_url, settings.ollama_model, notify), name="jarvis-ollama"
            )
        if voice:
            from .voice import ServerVoice

            state["voice"] = asyncio.create_task(
                ServerVoice(state["hub"], settings).run(), name="jarvis-voice"
            )

    @app.on_event("shutdown")
    async def _shutdown() -> None:
        for task in (state.get("voice"), state.get("brain_prep")):
            if task:
                task.cancel()
                with contextlib.suppress(Exception):
                    await task
        if "jarvis" in state:
            await state["jarvis"].stop()

    @app.get("/manifest.webmanifest")
    async def manifest() -> JSONResponse:
        return JSONResponse(MANIFEST, media_type="application/manifest+json")

    @app.get("/icon.png")
    async def icon() -> FileResponse:
        return FileResponse(ASSETS / "icon.png", media_type="image/png")

    @app.get("/icon-192.png")
    async def icon_small() -> FileResponse:
        return FileResponse(ASSETS / "icon-192.png", media_type="image/png")

    @app.get("/favicon.ico")
    async def favicon() -> FileResponse:
        return FileResponse(ASSETS / "icon.ico", media_type="image/x-icon")

    @app.get("/")
    async def index() -> FileResponse:
        return FileResponse(STATIC / "index.html")

    @app.get("/api/status")
    async def status() -> JSONResponse:
        j: Jarvis = state["jarvis"]
        return JSONResponse(
            {
                "version": __version__,
                "model": settings.model,
                "effort": settings.effort,
                "state": j.bus.state.value,
                "user_name": settings.user_name,
                "tools": j.registry.names() + [t["name"] for t in j.brain.server_tools],
                "system": status_snapshot(),
            }
        )

    @app.get("/api/reminders")
    async def reminders() -> JSONResponse:
        j: Jarvis = state["jarvis"]
        return JSONResponse(
            [
                {"id": r.id, "message": r.message, "due_at": r.due_at.isoformat()}
                for r in j.memory.pending_reminders()
            ]
        )

    @app.get("/api/memory")
    async def memory() -> JSONResponse:
        return JSONResponse(state["jarvis"].memory.all_facts())

    @app.post("/api/ask")
    async def ask(body: AskBody) -> JSONResponse:
        j: Jarvis = state["jarvis"]
        return JSONResponse({"answer": await j.brain.ask_text(body.text)})

    @app.websocket("/ws")
    async def ws(websocket: WebSocket) -> None:
        await websocket.accept()
        hub: Hub = state["hub"]
        j: Jarvis = state["jarvis"]
        hub.clients.add(websocket)
        transcript = j.memory.transcript(j.brain.session.id, 30) if j.brain.session else []
        await websocket.send_json(
            {
                "type": "hello",
                "greeting": j.greeting(),
                "state": j.bus.state.value,
                "user_name": settings.user_name,
                "model": settings.model,
                "transcript": transcript,
                "reminders": [
                    {"id": r.id, "message": r.message, "due_at": r.due_at.isoformat()}
                    for r in j.memory.pending_reminders()
                ],
            }
        )
        try:
            while True:
                msg = await websocket.receive_json()
                kind = msg.get("type")
                if kind == "ask" and msg.get("text", "").strip():
                    asyncio.create_task(hub.ask(msg["text"].strip()))
                elif kind == "approval":
                    hub.resolve(msg.get("id", ""), bool(msg.get("allowed")))
                elif kind == "new_session":
                    j.brain.new_session()
                    await hub.broadcast({"type": "session", "new": True})
                elif kind == "greet":
                    await hub.speak_text(j.greeting())
        except WebSocketDisconnect:
            pass
        finally:
            hub.clients.discard(websocket)

    return app
