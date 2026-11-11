from __future__ import annotations

import json

import httpx
import pytest
from conftest import collect

from jarvis.app import Jarvis
from jarvis.config import Settings
from jarvis.memory import Memory
from jarvis.providers.ollama import OllamaClient, OllamaError, convert_messages, convert_tools


def ndjson(chunks: list[dict]) -> str:
    return "\n".join(json.dumps(c) for c in chunks) + "\n"


def make_client(scripted: list[list[dict]], requests: list[dict]) -> OllamaClient:
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/api/tags":
            return httpx.Response(200, json={"models": [{"name": "qwen3:8b"}]})
        body = json.loads(request.content)
        requests.append(body)
        if not scripted:
            return httpx.Response(404, json={"error": "model 'nope' not found"})
        chunks = scripted.pop(0)
        if body.get("stream"):
            return httpx.Response(200, text=ndjson(chunks), headers={"content-type": "application/x-ndjson"})
        return httpx.Response(200, json=chunks[-1])

    return OllamaClient("http://ollama.test", http=httpx.AsyncClient(transport=httpx.MockTransport(handler)))


@pytest.fixture
def local_settings(tmp_path) -> Settings:
    return Settings(
        data_dir=tmp_path / "d",
        workspace=tmp_path / "w",
        provider="ollama",
        ollama_model="qwen3:8b",
        user_name="Sir",
    )  # type: ignore[call-arg]


def test_convert_messages_and_tools():
    system = [{"type": "text", "text": "You are Jarvis."}]
    messages = [
        {
            "role": "user",
            "content": [
                {"type": "image", "source": {"type": "base64", "media_type": "image/png", "data": "AAAA"}},
                {"type": "text", "text": "[Context] now"},
                {"type": "text", "text": "what is this?"},
            ],
        },
        {
            "role": "assistant",
            "content": [
                {"type": "thinking", "thinking": "", "signature": "x"},
                {"type": "text", "text": "Let me check."},
                {"type": "tool_use", "id": "call_1", "name": "calculate", "input": {"expression": "1+1"}},
            ],
        },
        {"role": "user", "content": [{"type": "tool_result", "tool_use_id": "call_1", "content": "1+1 = 2"}]},
        {"role": "system", "content": "be brief"},
    ]
    out = convert_messages(system, messages)
    assert out[0] == {"role": "system", "content": "You are Jarvis."}
    assert out[1]["role"] == "user" and out[1]["images"] == ["AAAA"] and "what is this?" in out[1]["content"]
    assert out[2]["tool_calls"][0]["function"] == {"name": "calculate", "arguments": {"expression": "1+1"}}
    assert out[3] == {"role": "tool", "tool_name": "calculate", "content": "1+1 = 2"}
    assert out[4] == {"role": "system", "content": "be brief"}
    tools = convert_tools(
        [
            {
                "name": "calculate",
                "description": "d",
                "input_schema": {"type": "object"},
                "eager_input_streaming": True,
            },
            {"type": "web_search_20260209", "name": "web_search"},
        ]
    )
    assert tools == [
        {
            "type": "function",
            "function": {"name": "calculate", "description": "d", "parameters": {"type": "object"}},
        }
    ]


async def test_brain_round_trip_on_ollama(local_settings):
    requests: list[dict] = []
    client = make_client(
        [
            [
                {"message": {"role": "assistant", "content": "One moment."}},
                {
                    "message": {
                        "role": "assistant",
                        "content": "",
                        "tool_calls": [
                            {"function": {"name": "calculate", "arguments": {"expression": "2+2"}}}
                        ],
                    }
                },
                {"done": True, "done_reason": "stop"},
            ],
            [
                {"message": {"role": "assistant", "content": "Four, "}},
                {"message": {"role": "assistant", "content": "Sir."}},
                {"done": True, "done_reason": "stop"},
            ],
        ],
        requests,
    )
    jarvis = Jarvis(local_settings, client=client, memory=Memory(":memory:"))
    assert jarvis.brain.provider == "ollama" and jarvis.brain.model == "qwen3:8b"
    assert jarvis.brain.server_tools == [] and "web_search" in jarvis.registry.names()
    events = await collect(jarvis, "what is 2 plus 2")
    assert [e["type"] for e in events] == ["text", "tool_start", "tool_end", "text", "text", "final"]
    assert events[-1]["text"] == "One moment.Four, Sir."
    first, second = requests
    assert first["model"] == "qwen3:8b" and first["stream"] is True and first["options"]["num_ctx"] == 16384
    assert first["messages"][0]["role"] == "system" and "J.A.R.V.I.S." in first["messages"][0]["content"]
    assert first["messages"][-1]["role"] == "user" and first["messages"][-1]["content"].startswith(
        "[Context]"
    )
    assert any(t["function"]["name"] == "web_search" for t in first["tools"])
    assert second["messages"][-2]["tool_calls"][0]["function"]["name"] == "calculate"
    assert second["messages"][-1] == {"role": "tool", "tool_name": "calculate", "content": "2+2 = 4"}
    history = jarvis.memory.load_messages(jarvis.brain.session.id)
    assert (
        history[1]["content"][1]["type"] == "tool_use" and history[2]["content"][0]["type"] == "tool_result"
    )


async def test_missing_model_is_explained(local_settings):
    client = make_client([], [])
    jarvis = Jarvis(local_settings, client=client, memory=Memory(":memory:"))
    events = await collect(jarvis, "hi")
    assert events[0]["type"] == "error" and "ollama pull qwen3:8b" in events[0]["message"]
    assert "ollama pull qwen3:8b" in await jarvis.brain.ask_text("hi again")  # ask_text surfaces the problem


async def test_adapter_reports_models():
    client = make_client([], [])
    assert await client.is_up() and await client.models() == ["qwen3:8b"]
    with pytest.raises(OllamaError):
        async with client.beta.messages.stream(model="nope", messages=[{"role": "user", "content": "x"}]):
            pass


def test_auto_provider_falls_back_to_ollama(tmp_path, monkeypatch):
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    monkeypatch.delenv("ANTHROPIC_AUTH_TOKEN", raising=False)
    monkeypatch.setenv("ANTHROPIC_CONFIG_DIR", str(tmp_path / "nothing"))
    monkeypatch.delenv("APPDATA", raising=False)
    s = Settings(data_dir=tmp_path, workspace=tmp_path)  # type: ignore[call-arg]
    assert s.resolved_provider == "ollama" and s.active_model == "qwen3:8b"
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-ant-real")
    assert s.resolved_provider == "anthropic" and s.active_model == "claude-opus-5-5"


async def test_ensure_ready_pulls_missing_model(monkeypatch):
    from jarvis.providers import ollama as mod

    calls: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(request.url.path)
        if request.url.path == "/api/tags":
            return httpx.Response(200, json={"models": [{"name": "llama3:8b"}]})
        if request.url.path == "/api/pull":
            chunks = [
                {"status": "pulling", "total": 100, "completed": 10},
                {"status": "pulling", "total": 100, "completed": 60},
                {"status": "pulling", "total": 100, "completed": 100},
                {"status": "success"},
            ]
            return httpx.Response(200, text=ndjson(chunks))
        return httpx.Response(404)

    transport = httpx.MockTransport(handler)
    real_init = mod.OllamaClient.__init__

    def patched_init(self, base_url="http://127.0.0.1:11434", **kw):
        kw.setdefault("http", httpx.AsyncClient(transport=transport))
        real_init(self, base_url, **kw)

    monkeypatch.setattr(mod.OllamaClient, "__init__", patched_init)
    notices: list[str] = []

    async def notify(msg: str) -> None:
        notices.append(msg)

    assert await mod.ensure_ready("http://ollama.test", "qwen3:8b", notify)
    assert "/api/pull" in calls
    assert (
        any("0%" in n for n in notices)
        and any("50%" in n for n in notices)
        and notices[-1] == "qwen3:8b is ready."
    )


async def test_ensure_ready_without_engine_and_offline(monkeypatch, tmp_path):
    from jarvis import engine
    from jarvis.providers import ollama as mod

    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("refused")

    real_init = mod.OllamaClient.__init__

    def patched_init(self, base_url="http://127.0.0.1:11434", **kw):
        kw.setdefault("http", httpx.AsyncClient(transport=httpx.MockTransport(handler)))
        real_init(self, base_url, **kw)

    monkeypatch.setattr(mod.OllamaClient, "__init__", patched_init)
    monkeypatch.setattr(engine, "find_ollama", lambda data_dir, system=None: None)

    async def failing_download(data_dir, notify, *, system=None):
        raise RuntimeError("offline")

    monkeypatch.setattr(engine, "download_engine", failing_download)
    notices: list[str] = []

    async def notify(msg: str) -> None:
        notices.append(msg)

    assert not await mod.ensure_ready("http://ollama.test", "qwen3:8b", notify, data_dir=tmp_path)
    assert "couldn't download" in notices[-1].lower()


def test_has_model():
    c = OllamaClient(
        "http://ollama.test",
        http=httpx.AsyncClient(transport=httpx.MockTransport(lambda r: httpx.Response(404))),
    )
    assert c.has_model(["qwen3:8b", "llama3:latest"], "qwen3:8b")
    assert c.has_model(["qwen3:8b"], "qwen3") and not c.has_model(["qwen3:4b"], "qwen3:8b")
