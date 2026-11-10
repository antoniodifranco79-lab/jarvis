"""Shared fixtures: a scripted fake Anthropic client so the brain can be tested offline."""

from __future__ import annotations

import copy
from pathlib import Path
from types import SimpleNamespace
from typing import Any

import pytest
from anthropic.types.beta import BetaMessage

from jarvis.app import Jarvis
from jarvis.config import Settings
from jarvis.memory import Memory


def make_message(content: list[dict[str, Any]], stop_reason: str = "end_turn") -> BetaMessage:
    return BetaMessage.model_validate(
        {
            "id": "msg_test",
            "type": "message",
            "role": "assistant",
            "model": "claude-opus-5-5",
            "content": content,
            "stop_reason": stop_reason,
            "stop_sequence": None,
            "usage": {"input_tokens": 10, "output_tokens": 5},
        }
    )


def text_message(text: str) -> BetaMessage:
    return make_message([{"type": "text", "text": text}])


def tool_message(
    name: str,
    arguments: dict[str, Any],
    tool_id: str = "toolu_1",
    text: str | None = None,
    stop_reason: str = "tool_use",
) -> BetaMessage:
    blocks: list[dict[str, Any]] = []
    if text:
        blocks.append({"type": "text", "text": text})
    blocks.append({"type": "tool_use", "id": tool_id, "name": name, "input": arguments})
    return make_message(blocks, stop_reason)


class FakeStream:
    def __init__(self, response: BetaMessage) -> None:
        self.response = response

    async def __aenter__(self) -> FakeStream:
        return self

    async def __aexit__(self, *exc: Any) -> bool:
        return False

    def __aiter__(self):
        return self._events()

    async def _events(self):
        for block in self.response.content:
            if block.type == "text":
                yield SimpleNamespace(type="text", text=block.text, snapshot=block.text)
            elif block.type == "tool_use":
                yield SimpleNamespace(type="content_block_start", content_block=block)

    async def get_final_message(self) -> BetaMessage:
        return self.response


class FakeBetaMessages:
    def __init__(self, scripted: list[BetaMessage]) -> None:
        self.scripted = list(scripted)
        self.calls: list[dict[str, Any]] = []

    def stream(self, **params: Any) -> FakeStream:
        self.calls.append(copy.deepcopy(params))  # snapshot: the brain mutates its messages list
        if not self.scripted:
            raise AssertionError("no scripted response left")
        return FakeStream(self.scripted.pop(0))


class FakeClient:
    def __init__(self, scripted: list[BetaMessage], summary: str = "summary of the past") -> None:
        self.beta = SimpleNamespace(messages=FakeBetaMessages(scripted))
        self.summary = summary
        self.create_calls: list[dict[str, Any]] = []

        async def create(**params: Any) -> BetaMessage:
            self.create_calls.append(params)
            return text_message(self.summary)

        self.messages = SimpleNamespace(create=create)

    @property
    def calls(self) -> list[dict[str, Any]]:
        return self.beta.messages.calls


@pytest.fixture
def settings(tmp_path: Path) -> Settings:
    return Settings(
        data_dir=tmp_path / "data",
        workspace=tmp_path / "ws",
        user_name="Sir",
        location="Milano",
        _env_file=None,  # type: ignore[call-arg]
    )


@pytest.fixture
def memory() -> Memory:
    return Memory(":memory:")


def make_jarvis(settings: Settings, scripted: list[BetaMessage], **kwargs: Any) -> tuple[Jarvis, FakeClient]:
    client = FakeClient(scripted)
    jarvis = Jarvis(settings, client=client, memory=Memory(":memory:"), **kwargs)
    return jarvis, client


async def collect(jarvis: Jarvis, text: str) -> list[dict[str, Any]]:
    return [event async for event in jarvis.brain.ask(text)]
