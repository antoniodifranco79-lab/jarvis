"""An Ollama adapter that looks, to the brain, like the slice of the Anthropic SDK it uses:
``client.beta.messages.stream(...)`` (async context manager yielding ``text`` /
``content_block_start`` events, with ``get_final_message()``) and ``client.messages.create(...)``.

Anthropic-shaped messages (text / image / tool_use / tool_result / thinking blocks) are translated to
Ollama's ``/api/chat`` format and the reply is translated back, so conversations are stored in one
format whichever brain is answering.
"""

from __future__ import annotations

import asyncio
import json
import logging
import shutil
import subprocess
import uuid
from collections.abc import AsyncIterator, Awaitable, Callable
from types import SimpleNamespace
from typing import Any

import httpx

log = logging.getLogger(__name__)


class OllamaError(RuntimeError):
    pass


class Block(SimpleNamespace):
    def to_dict(self, **_: Any) -> dict[str, Any]:
        return {k: v for k, v in vars(self).items() if v is not None}


class Message(SimpleNamespace):
    pass


def _text_of(content: Any) -> str:
    if isinstance(content, str):
        return content
    return "\n".join(b.get("text", "") for b in content if isinstance(b, dict) and b.get("type") == "text")


def _images_of(content: Any) -> list[str]:
    if not isinstance(content, list):
        return []
    return [
        b["source"]["data"]
        for b in content
        if isinstance(b, dict) and b.get("type") == "image" and b.get("source", {}).get("type") == "base64"
    ]


def convert_messages(system: Any, messages: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Anthropic ``system`` + ``messages`` -> Ollama chat messages."""
    out: list[dict[str, Any]] = []
    system_text = _text_of(system) if system else ""
    if system_text:
        out.append({"role": "system", "content": system_text})
    tool_names: dict[str, str] = {}
    for m in messages:
        role, content = m["role"], m["content"]
        if role == "system":
            out.append({"role": "system", "content": _text_of(content)})
        elif role == "assistant":
            msg: dict[str, Any] = {"role": "assistant", "content": _text_of(content)}
            calls = []
            for b in content if isinstance(content, list) else []:
                if isinstance(b, dict) and b.get("type") == "tool_use":
                    tool_names[b["id"]] = b["name"]
                    calls.append(
                        {
                            "type": "function",
                            "function": {"name": b["name"], "arguments": b.get("input") or {}},
                        }
                    )
            if calls:
                msg["tool_calls"] = calls
            out.append(msg)
        else:  # user: tool results become role=tool messages, the rest a user message
            blocks = content if isinstance(content, list) else [{"type": "text", "text": content}]
            rest: list[dict[str, Any]] = []
            for b in blocks:
                if b.get("type") == "tool_result":
                    body = b["content"]
                    text = body if isinstance(body, str) else _text_of(body) or "[image]"
                    if b.get("is_error"):
                        text = f"ERROR: {text}"
                    out.append(
                        {
                            "role": "tool",
                            "tool_name": tool_names.get(b["tool_use_id"], "tool"),
                            "content": text,
                        }
                    )
                else:
                    rest.append(b)
            if rest:
                msg = {"role": "user", "content": _text_of(rest)}
                images = _images_of(rest)
                if images:
                    msg["images"] = images
                out.append(msg)
    return out


def convert_tools(tools: list[dict[str, Any]] | None) -> list[dict[str, Any]]:
    converted = []
    for t in tools or []:
        if "input_schema" not in t:  # server tools (web_search_*) don't exist here
            continue
        converted.append(
            {
                "type": "function",
                "function": {
                    "name": t["name"],
                    "description": t.get("description", ""),
                    "parameters": t["input_schema"],
                },
            }
        )
    return converted


def _final_message(
    model: str, text: str, tool_calls: list[dict[str, Any]], done_reason: str | None
) -> Message:
    content: list[Block] = []
    if text:
        content.append(Block(type="text", text=text))
    for call in tool_calls:
        fn = call.get("function", {})
        args = fn.get("arguments")
        if isinstance(args, str):  # some models emit a JSON string
            try:
                args = json.loads(args)
            except json.JSONDecodeError:
                args = {"_raw": args}
        content.append(
            Block(
                type="tool_use", id=f"call_{uuid.uuid4().hex[:12]}", name=fn.get("name", ""), input=args or {}
            )
        )
    if tool_calls:
        stop = "tool_use"
    elif done_reason == "length":
        stop = "max_tokens"
    else:
        stop = "end_turn"
    return Message(content=content, stop_reason=stop, stop_details=None, model=model, role="assistant")


class _Stream:
    def __init__(self, client: OllamaClient, params: dict[str, Any]) -> None:
        self.client = client
        self.params = params
        self._text: list[str] = []
        self._tool_calls: list[dict[str, Any]] = []
        self._done_reason: str | None = None
        self._response: httpx.Response | None = None
        self._cm: Any = None

    async def __aenter__(self) -> _Stream:
        payload = self.client.payload(self.params, stream=True)
        try:
            self._cm = self.client.http.stream("POST", f"{self.client.base}/api/chat", json=payload)
            self._response = await self._cm.__aenter__()
        except httpx.ConnectError as exc:
            raise OllamaError(
                f"Ollama isn't reachable at {self.client.base}. Start it with 'ollama serve' and pull a model, "
                f"e.g. 'ollama pull {payload['model']}'."
            ) from exc
        if self._response.status_code >= 400:
            body = await self._response.aread()
            await self._cm.__aexit__(None, None, None)
            raise OllamaError(self.client.describe_error(self._response.status_code, body, payload["model"]))
        return self

    async def __aexit__(self, *exc: Any) -> bool:
        if self._cm is not None:
            await self._cm.__aexit__(*exc)
        return False

    def __aiter__(self) -> AsyncIterator[Any]:
        return self._events()

    async def _events(self) -> AsyncIterator[Any]:
        assert self._response is not None
        async for line in self._response.aiter_lines():
            if not line.strip():
                continue
            chunk = json.loads(line)
            if "error" in chunk:
                raise OllamaError(f"Ollama error: {chunk['error']}")
            msg = chunk.get("message") or {}
            if msg.get("content"):
                self._text.append(msg["content"])
                yield SimpleNamespace(type="text", text=msg["content"], snapshot="".join(self._text))
            for call in msg.get("tool_calls") or []:
                self._tool_calls.append(call)
                yield SimpleNamespace(
                    type="content_block_start",
                    content_block=SimpleNamespace(
                        type="tool_use", name=call.get("function", {}).get("name", "")
                    ),
                )
            if chunk.get("done"):
                self._done_reason = chunk.get("done_reason")

    async def get_final_message(self) -> Message:
        return _final_message(
            self.params.get("model", ""), "".join(self._text), self._tool_calls, self._done_reason
        )


class _BetaMessages:
    def __init__(self, client: OllamaClient) -> None:
        self.client = client

    def stream(self, **params: Any) -> _Stream:
        return _Stream(self.client, params)


class _Messages:
    def __init__(self, client: OllamaClient) -> None:
        self.client = client

    async def create(self, **params: Any) -> Message:
        payload = self.client.payload(params, stream=False)
        try:
            r = await self.client.http.post(f"{self.client.base}/api/chat", json=payload)
        except httpx.ConnectError as exc:
            raise OllamaError(f"Ollama isn't reachable at {self.client.base}.") from exc
        if r.status_code >= 400:
            raise OllamaError(self.client.describe_error(r.status_code, r.content, payload["model"]))
        data = r.json()
        msg = data.get("message") or {}
        return _final_message(
            payload["model"], msg.get("content", ""), msg.get("tool_calls") or [], data.get("done_reason")
        )


class OllamaClient:
    def __init__(
        self,
        base_url: str = "http://127.0.0.1:11434",
        *,
        num_ctx: int = 16384,
        think: bool = False,
        http: httpx.AsyncClient | None = None,
    ) -> None:
        self.base = base_url.rstrip("/")
        self.num_ctx = num_ctx
        self.think = think
        self.http = http or httpx.AsyncClient(timeout=httpx.Timeout(600.0, connect=5.0))
        self.beta = SimpleNamespace(messages=_BetaMessages(self))
        self.messages = _Messages(self)

    def payload(self, params: dict[str, Any], *, stream: bool) -> dict[str, Any]:
        payload: dict[str, Any] = {
            "model": params["model"],
            "messages": convert_messages(params.get("system"), params["messages"]),
            "stream": stream,
            "think": self.think,
            "options": {
                "num_ctx": self.num_ctx,
                "num_predict": min(int(params.get("max_tokens", 4096)), 8192),
            },
        }
        tools = convert_tools(params.get("tools"))
        if tools:
            payload["tools"] = tools
        return payload

    def describe_error(self, status: int, body: bytes, model: str) -> str:
        try:
            detail = json.loads(body).get("error", "")
        except Exception:  # noqa: BLE001
            detail = body.decode(errors="replace")[:200]
        if status == 404 or "not found" in detail:
            return f"The model '{model}' isn't available in Ollama. Run: ollama pull {model}"
        if "does not support tools" in detail:
            return f"The model '{model}' doesn't support tool calling. Use one that does, e.g. qwen3:8b."
        return f"Ollama returned HTTP {status}: {detail}"

    async def is_up(self) -> bool:
        try:
            r = await self.http.get(f"{self.base}/api/tags")
            return r.status_code == 200
        except Exception:  # noqa: BLE001
            return False

    async def models(self) -> list[str]:
        try:
            r = await self.http.get(f"{self.base}/api/tags")
            r.raise_for_status()
            return [m["name"] for m in r.json().get("models", [])]
        except Exception:  # noqa: BLE001
            return []

    def has_model(self, models: list[str], wanted: str) -> bool:
        base = wanted.split(":")[0]
        return any(m == wanted or (":" not in wanted and m.split(":")[0] == base) for m in models)

    async def pull(self, model: str, progress: Callable[[str], Awaitable[None]] | None = None) -> None:
        """Download a model through the API, reporting progress in 25% steps."""
        last = -1
        async with self.http.stream(
            "POST", f"{self.base}/api/pull", json={"name": model, "stream": True}, timeout=None
        ) as r:
            if r.status_code >= 400:
                raise OllamaError(self.describe_error(r.status_code, await r.aread(), model))
            async for line in r.aiter_lines():
                if not line.strip():
                    continue
                chunk = json.loads(line)
                if "error" in chunk:
                    raise OllamaError(f"Could not download {model}: {chunk['error']}")
                total, done = chunk.get("total") or 0, chunk.get("completed") or 0
                if total and progress:
                    step = int(done * 100 / total) // 25 * 25
                    if step > last:
                        last = step
                        await progress(f"Downloading {model}: {step}%")
        if progress:
            await progress(f"{model} is ready.")


async def ensure_ready(
    base_url: str, model: str, notify: Callable[[str], Awaitable[None]], *, start_timeout: float = 30.0
) -> bool:
    """Make the local brain usable: start ``ollama serve`` if needed and pull the model if missing.

    Returns True when Ollama answers and the model is present."""
    client = OllamaClient(base_url)
    if not await client.is_up():
        exe = shutil.which("ollama")
        if not exe:
            await notify("Ollama isn't installed. Get it from ollama.com, start it, and ask me again.")
            return False
        try:
            subprocess.Popen(
                [exe, "serve"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=True
            )
        except OSError as exc:
            await notify(f"Couldn't start Ollama: {exc}")
            return False
        deadline = asyncio.get_running_loop().time() + start_timeout
        while not await client.is_up():
            if asyncio.get_running_loop().time() > deadline:
                await notify("Ollama didn't start in time. Run 'ollama serve' yourself and ask me again.")
                return False
            await asyncio.sleep(0.5)
        await notify("Ollama started.")
    if not client.has_model(await client.models(), model):
        await notify(f"The {model} model isn't downloaded yet. Fetching it now; this takes a few minutes.")
        try:
            await client.pull(model, notify)
        except OllamaError as exc:
            await notify(str(exc))
            return False
    return True
