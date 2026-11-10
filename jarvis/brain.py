"""The brain: a streaming, tool-using conversation loop on top of the Claude API.

Design notes
- The system prompt and the tool set are frozen per session (``memory.fingerprint``): the
  conversation is append-only, which keeps the prompt cache warm and satisfies the API's
  history-editing check on current models.
- Live context (the clock, pending reminders) travels in a small per-turn message, never
  in the top-level system prompt.
- Long sessions roll over into a fresh session seeded with a summary (client-side "simple
  compaction"); server-side compaction can be switched on instead.
- Every tool input is validated against its schema before it runs (eager input streaming
  means the API no longer does that for us).
"""

from __future__ import annotations

import asyncio
import logging
import uuid
from collections.abc import AsyncIterator
from datetime import datetime
from typing import Any

import anthropic

from .config import Settings
from .events import EventBus, State
from .memory import Memory, Session, fingerprint
from .persona import build_system_prompt
from .tools import Approver, ToolRegistry
from .tools.datetime_tool import current_time

log = logging.getLogger(__name__)

MAX_TOOL_ROUNDS = 12
FALLBACK_BETA = "server-side-fallback-2026-07-01"
COMPACTION_BETA = "compact-2026-01-12"

# Models that accept mid-conversation ``role: "system"`` messages and the ``fallbacks`` parameter.
_MODERN_PREFIXES = (
    "claude-opus-5",
    "claude-fable-5",
    "claude-mythos-5",
    "claude-sonnet-5-5",
    "claude-haiku-5-5",
)


def is_modern_model(model: str) -> bool:
    return model.startswith(_MODERN_PREFIXES)


def serialize_content(blocks: list[Any]) -> list[dict[str, Any]]:
    """Turn response content blocks into plain dicts that can be sent back verbatim
    (thinking blocks and their signatures included - the API needs them unchanged)."""
    out: list[dict[str, Any]] = []
    for block in blocks:
        if hasattr(block, "to_dict"):
            out.append(block.to_dict(mode="json", exclude_none=True))
        elif isinstance(block, dict):
            out.append(block)
        else:  # pragma: no cover - defensive
            out.append(dict(block))
    return out


def text_of(blocks: list[Any]) -> str:
    parts = []
    for b in blocks:
        btype = b.get("type") if isinstance(b, dict) else getattr(b, "type", None)
        if btype == "text":
            parts.append(b["text"] if isinstance(b, dict) else b.text)
    return "".join(parts).strip()


class Brain:
    def __init__(
        self,
        settings: Settings,
        memory: Memory,
        bus: EventBus,
        registry: ToolRegistry,
        *,
        client: Any | None = None,
        mode: str = "voice",
        approver: Approver | None = None,
    ) -> None:
        self.settings = settings
        self.memory = memory
        self.bus = bus
        self.registry = registry
        self.mode = mode
        self.approver = approver
        self.client = client or anthropic.AsyncAnthropic()
        self.system_prompt = build_system_prompt(settings, mode)
        self.server_tools = self._server_tools()
        tool_names = registry.names() + [t["name"] for t in self.server_tools]
        self.fingerprint = fingerprint(self.system_prompt, settings.model, tool_names)
        self.session: Session | None = None
        self._lock = asyncio.Lock()
        self._pending_summary: str | None = None

    # ------------------------------------------------------------------ request shape
    def _server_tools(self) -> list[dict[str, Any]]:
        tools: list[dict[str, Any]] = []
        if self.settings.web_search:
            tools.append(
                {
                    "type": "web_search_20260209",
                    "name": "web_search",
                    "max_uses": self.settings.web_search_max_uses,
                }
            )
        if self.settings.web_fetch:
            tools.append({"type": "web_fetch_20260209", "name": "web_fetch", "max_uses": 3})
        return tools

    def tools(self) -> list[dict[str, Any]]:
        return self.registry.definitions(streaming=True) + self.server_tools

    def request_params(self) -> dict[str, Any]:
        s = self.settings
        params: dict[str, Any] = {
            "model": s.model,
            "max_tokens": s.max_tokens,
            "system": [{"type": "text", "text": self.system_prompt, "cache_control": {"type": "ephemeral"}}],
            "tools": self.tools(),
            "thinking": {"type": "adaptive"},
            "output_config": {"effort": s.effort},
            "cache_control": {"type": "ephemeral"},
        }
        betas: list[str] = []
        if s.fallbacks and is_modern_model(s.model):
            betas.append(FALLBACK_BETA)
            params["fallbacks"] = "default"
        if s.server_compaction:
            betas.append(COMPACTION_BETA)
            params["context_management"] = {"edits": [{"type": "compact_20260112"}]}
        if betas:
            params["betas"] = betas
        return params

    def context_line(self, now: datetime | None = None) -> str:
        now = now or current_time(self.settings.timezone)
        pending = self.memory.pending_reminders()
        line = f"[Context] Now: {now.strftime('%A %d %B %Y, %H:%M')} ({now.tzname() or 'local time'})."
        if pending:
            nxt = pending[0]
            line += f" Pending reminders: {len(pending)} (next: '{nxt.message}' at {nxt.due_at.strftime('%H:%M')})."
        return line

    # ------------------------------------------------------------------ sessions
    async def ensure_session(self) -> Session:
        session, is_new = self.memory.resume_or_start(
            self.mode, self.fingerprint, self.settings.session_idle_hours
        )
        if not is_new and self.memory.estimate_tokens(session.id) > self.settings.session_token_budget:
            summary = await self.summarize_session(session)
            session = self.memory.new_session(self.mode, self.fingerprint, summary)
            self._pending_summary = summary
            await self.bus.publish("session", id=session.id, new=True, summarised=bool(summary))
        elif is_new:
            self._pending_summary = None
            await self.bus.publish("session", id=session.id, new=True, summarised=False)
        self.session = session
        return session

    def new_session(self) -> Session:
        """Forget the current conversation (not the long-term memory) and start afresh."""
        self.session = self.memory.new_session(self.mode, self.fingerprint)
        self._pending_summary = None
        return self.session

    async def summarize_session(self, session: Session) -> str | None:
        """Best-effort summary of an old session, used to seed the next one."""
        turns = self.memory.transcript(session.id, limit=80)
        if not turns:
            return None
        transcript = "\n".join(f"{t['role']}: {t['text']}" for t in turns)
        try:
            response = await self.client.messages.create(
                model=self.settings.model,
                max_tokens=2000,
                output_config={"effort": "low"},
                system="Summarise this conversation between a user and their assistant in at most 15 bullet points. "
                "Keep every fact, decision, open task and preference. Write in the language of the conversation.",
                messages=[{"role": "user", "content": transcript[-60_000:]}],
            )
        except Exception as exc:  # noqa: BLE001
            log.warning("session summary failed: %s", exc)
            return None
        return text_of(response.content) or None

    # ------------------------------------------------------------------ the loop
    async def ask(
        self, text: str, images: list[dict[str, Any]] | None = None
    ) -> AsyncIterator[dict[str, Any]]:
        """Send one user turn and stream back events:
        ``text`` (delta), ``tool_start``, ``tool_end``, ``notice``, ``error`` and finally ``final`` (full text)."""
        async with self._lock:
            try:
                async for event in self._ask(text, images or []):
                    yield event
            finally:
                await self.bus.set_state(State.IDLE)

    async def _ask(self, text: str, images: list[dict[str, Any]]) -> AsyncIterator[dict[str, Any]]:
        session = await self.ensure_session()
        use_system_role = is_modern_model(self.settings.model)

        content: list[dict[str, Any]] = []
        if self._pending_summary:
            content.append(
                {"type": "text", "text": f"[Summary of our previous conversation]\n{self._pending_summary}"}
            )
            self._pending_summary = None
        content.extend(images)
        if not use_system_role:
            content.append({"type": "text", "text": self.context_line()})
        content.append({"type": "text", "text": text})
        self.memory.append_message(session.id, "user", content, text=text)
        if use_system_role:
            self.memory.append_message(session.id, "system", self.context_line(), text="")
        messages = self.memory.load_messages(session.id)

        await self.bus.set_state(State.THINKING)
        spoken: list[str] = []
        json_retries = 0
        rounds = 0
        while True:
            rounds += 1
            if rounds > MAX_TOOL_ROUNDS:
                yield {"type": "error", "message": "Too many tool rounds; stopping here."}
                break
            try:
                async with self.client.beta.messages.stream(
                    **self.request_params(), messages=messages
                ) as stream:
                    async for event in stream:
                        etype = getattr(event, "type", None)
                        if etype == "text":
                            if not event.text:
                                continue
                            spoken.append(event.text)
                            await self.bus.publish("text", text=event.text)
                            yield {"type": "text", "text": event.text}
                        elif etype == "content_block_start":
                            block = event.content_block
                            if block.type in ("tool_use", "server_tool_use"):
                                await self.bus.set_state(State.TOOL, tool=block.name)
                                yield {"type": "tool_start", "name": block.name}
                    response = await stream.get_final_message()
                json_retries = 0
            except ValueError as exc:  # JSON the SDK could not parse at all: re-issue the turn, bounded
                json_retries += 1
                log.warning("unparseable tool input (%s), retry %d", exc, json_retries)
                if json_retries > 2:
                    yield {
                        "type": "error",
                        "message": "I received malformed tool input three times in a row; giving up.",
                    }
                    break
                continue
            except anthropic.AuthenticationError:
                yield {
                    "type": "error",
                    "message": "My API key appears to be missing or invalid. Set ANTHROPIC_API_KEY and restart me.",
                }
                break
            except anthropic.RateLimitError:
                yield {
                    "type": "error",
                    "message": "The API is rate-limiting us. Give me a moment and ask again.",
                }
                break
            except anthropic.APIConnectionError:
                yield {
                    "type": "error",
                    "message": "I can't reach the Anthropic API. Check the network connection.",
                }
                break
            except anthropic.APIStatusError as exc:
                yield {
                    "type": "error",
                    "message": f"The API returned an error ({exc.status_code}): {exc.message}",
                }
                break
            except anthropic.AnthropicError as exc:  # e.g. no credentials could be resolved
                yield {"type": "error", "message": f"I can't talk to the Anthropic API: {exc}"}
                break
            except Exception as exc:  # noqa: BLE001 - the SDK raises TypeError when no credentials exist
                if "authentication" in str(exc).lower():
                    yield {
                        "type": "error",
                        "message": "My API key is missing. Put ANTHROPIC_API_KEY in the .env file and restart me.",
                    }
                    break
                log.exception("request failed")
                yield {"type": "error", "message": f"I couldn't complete the request: {exc}"}
                break

            assistant_content = serialize_content(response.content)
            self.memory.append_message(
                session.id, "assistant", assistant_content, text=text_of(assistant_content)
            )
            messages.append({"role": "assistant", "content": assistant_content})

            if response.stop_reason == "pause_turn":  # a server tool hit its limit: let it continue
                continue
            if response.stop_reason == "refusal":
                details = getattr(response, "stop_details", None)
                why = f" ({details.category})" if details and getattr(details, "category", None) else ""
                yield {"type": "notice", "message": f"I must decline that request{why}."}
                break

            tool_uses = [b for b in response.content if b.type == "tool_use"]
            if not tool_uses:
                break

            truncated = response.stop_reason == "max_tokens"
            await self.bus.set_state(State.TOOL, tool=tool_uses[0].name)
            if truncated:
                results = [
                    {
                        "type": "tool_result",
                        "tool_use_id": tu.id,
                        "is_error": True,
                        "content": "Tool input was cut off (max_tokens reached); the tool was not run.",
                    }
                    for tu in tool_uses
                ]
            else:
                outcomes = await asyncio.gather(*(self._run_tool(tu) for tu in tool_uses))
                results = []
                for tu, outcome in zip(tool_uses, outcomes, strict=True):
                    block: dict[str, Any] = {
                        "type": "tool_result",
                        "tool_use_id": tu.id,
                        "content": outcome.content,
                    }
                    if outcome.is_error:
                        block["is_error"] = True
                    results.append(block)
                    await self.bus.publish(
                        "tool_end", name=tu.name, ok=not outcome.is_error, preview=outcome.preview()
                    )
                    yield {
                        "type": "tool_end",
                        "name": tu.name,
                        "ok": not outcome.is_error,
                        "preview": outcome.preview(),
                    }
            self.memory.append_message(session.id, "user", results, text="")
            messages.append({"role": "user", "content": results})
            if truncated:
                yield {"type": "error", "message": "The response was cut off before the tool call completed."}
                break
            await self.bus.set_state(State.THINKING)

        final = "".join(spoken).strip()
        await self.bus.publish("final", text=final)
        yield {"type": "final", "text": final}
        await self.bus.set_state(State.IDLE)

    async def _run_tool(self, tool_use: Any):
        tool = self.registry.get(tool_use.name)
        if tool and tool.dangerous and not self.settings.auto_approve:
            await self.bus.set_state(State.AWAITING_APPROVAL, tool=tool_use.name)
            await self.bus.publish(
                "approval_request", id=str(uuid.uuid4()), tool=tool_use.name, input=tool_use.input
            )
        return await self.registry.execute(
            tool_use.name,
            tool_use.input,
            approver=self.approver,
            auto_approve=self.settings.auto_approve,
            default_timeout=self.settings.tool_timeout,
        )

    async def ask_text(self, text: str, images: list[dict[str, Any]] | None = None) -> str:
        """Convenience: run a turn and return the final text."""
        final = ""
        async for event in self.ask(text, images):
            if event["type"] == "final":
                final = event["text"]
            elif event["type"] in ("error", "notice") and not final:
                final = event["message"]
        return final
