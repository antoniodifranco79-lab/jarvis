"""Tool plumbing: a decorator that turns a typed Python function into a Claude tool,
a registry that hands the definitions to the API, and a safe executor."""

from __future__ import annotations

import asyncio
import inspect
import logging
import re
import typing
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from typing import Any, Literal, Union, get_args, get_origin, get_type_hints

import jsonschema

log = logging.getLogger(__name__)

Approver = Callable[[str, dict[str, Any]], Awaitable[bool]]


@dataclass
class ToolResult:
    """What a tool hands back to Claude. ``content`` is a string or a list of content blocks
    (text / image), ``is_error`` flags failures so Claude can recover."""

    content: str | list[dict[str, Any]]
    is_error: bool = False

    @classmethod
    def error(cls, message: str) -> ToolResult:
        return cls(content=message, is_error=True)

    @classmethod
    def image(cls, data_b64: str, media_type: str = "image/png", caption: str = "") -> ToolResult:
        blocks: list[dict[str, Any]] = [
            {"type": "image", "source": {"type": "base64", "media_type": media_type, "data": data_b64}}
        ]
        if caption:
            blocks.append({"type": "text", "text": caption})
        return cls(content=blocks)

    def preview(self, limit: int = 160) -> str:
        if isinstance(self.content, str):
            text = self.content
        else:
            text = " ".join(
                b.get("text", "[image]") if b.get("type") != "image" else "[image]" for b in self.content
            )
        text = " ".join(text.split())
        return text if len(text) <= limit else text[: limit - 1] + "…"


@dataclass
class Tool:
    name: str
    description: str
    input_schema: dict[str, Any]
    handler: Callable[..., Any]
    dangerous: bool = False
    timeout: float | None = None
    tags: set[str] = field(default_factory=set)

    def definition(self, streaming: bool = True) -> dict[str, Any]:
        d: dict[str, Any] = {
            "name": self.name,
            "description": self.description,
            "input_schema": self.input_schema,
        }
        if streaming:
            d["eager_input_streaming"] = True
        return d

    def validate(self, arguments: Any) -> str | None:
        """Return an error message when ``arguments`` doesn't satisfy the schema, else None."""
        try:
            jsonschema.validate(arguments, self.input_schema)
        except jsonschema.ValidationError as exc:
            return f"{exc.message} (at {'/'.join(str(p) for p in exc.absolute_path) or 'root'})"
        return None


# ---------------------------------------------------------------- schema generation


def _parse_doc(doc: str) -> tuple[str, dict[str, str]]:
    """Split a Google-style docstring into (description, {param: description})."""
    if not doc:
        return "", {}
    lines = inspect.cleandoc(doc).splitlines()
    desc_lines: list[str] = []
    params: dict[str, str] = {}
    in_args = False
    current: str | None = None
    for line in lines:
        stripped = line.strip()
        if re.match(r"^(Args|Arguments|Parameters):\s*$", stripped):
            in_args = True
            continue
        if in_args:
            if re.match(r"^(Returns|Raises|Examples|Notes?):\s*$", stripped):
                in_args = False
                current = None
                continue
            m = re.match(r"^(\w+)\s*(?:\([^)]*\))?\s*:\s*(.*)$", stripped)
            if m and not line.startswith(" " * 8):
                current = m.group(1)
                params[current] = m.group(2).strip()
            elif current and stripped:
                params[current] += " " + stripped
            continue
        desc_lines.append(line)
    description = "\n".join(desc_lines).strip()
    return description, params


def _schema_for(annotation: Any) -> dict[str, Any]:
    origin = get_origin(annotation)
    if annotation in (inspect.Parameter.empty, Any):
        return {"type": "string"}
    if origin is Literal:
        values = list(get_args(annotation))
        kind = "string" if all(isinstance(v, str) for v in values) else "integer"
        return {"type": kind, "enum": values}
    if origin in (Union, getattr(typing, "UnionType", Union)) or str(origin) == "<class 'types.UnionType'>":
        args = [a for a in get_args(annotation) if a is not type(None)]
        return _schema_for(args[0]) if len(args) == 1 else {"anyOf": [_schema_for(a) for a in args]}
    if origin in (list, typing.List):  # noqa: UP006
        (item,) = get_args(annotation) or (str,)
        return {"type": "array", "items": _schema_for(item)}
    if origin in (dict, typing.Dict):  # noqa: UP006
        return {"type": "object"}
    mapping = {str: "string", int: "integer", float: "number", bool: "boolean", dict: "object", list: "array"}
    if annotation in mapping:
        return {"type": mapping[annotation]}
    return {"type": "string"}


def build_schema(func: Callable[..., Any]) -> tuple[str, dict[str, Any]]:
    """Derive (description, JSON schema) from a function's signature and docstring."""
    description, param_docs = _parse_doc(func.__doc__ or "")
    hints = get_type_hints(func)
    properties: dict[str, Any] = {}
    required: list[str] = []
    for name, param in inspect.signature(func).parameters.items():
        if name.startswith("_") or param.kind in (param.VAR_POSITIONAL, param.VAR_KEYWORD):
            continue
        schema = _schema_for(hints.get(name, param.annotation))
        if name in param_docs:
            schema["description"] = param_docs[name]
        if param.default is inspect.Parameter.empty:
            required.append(name)
        elif param.default is not None:
            schema["default"] = param.default
        properties[name] = schema
    input_schema: dict[str, Any] = {"type": "object", "properties": properties, "additionalProperties": False}
    if required:
        input_schema["required"] = required
    return description, input_schema


# ---------------------------------------------------------------- registry


class ToolRegistry:
    def __init__(self) -> None:
        self._tools: dict[str, Tool] = {}

    def __len__(self) -> int:
        return len(self._tools)

    def __contains__(self, name: str) -> bool:
        return name in self._tools

    def get(self, name: str) -> Tool | None:
        return self._tools.get(name)

    def names(self) -> list[str]:
        return sorted(self._tools)

    def add(self, tool: Tool) -> Tool:
        if tool.name in self._tools:
            raise ValueError(f"tool already registered: {tool.name}")
        self._tools[tool.name] = tool
        return tool

    def remove(self, name: str) -> None:
        self._tools.pop(name, None)

    def tool(
        self,
        name: str | None = None,
        *,
        dangerous: bool = False,
        timeout: float | None = None,
        description: str | None = None,
        tags: set[str] | None = None,
    ) -> Callable[[Callable[..., Any]], Callable[..., Any]]:
        """Decorator: ``@registry.tool()`` registers a sync or async function as a tool."""

        def decorator(func: Callable[..., Any]) -> Callable[..., Any]:
            desc, schema = build_schema(func)
            self.add(
                Tool(
                    name=name or func.__name__,
                    description=description or desc or func.__name__,
                    input_schema=schema,
                    handler=func,
                    dangerous=dangerous,
                    timeout=timeout,
                    tags=set(tags or ()),
                )
            )
            return func

        return decorator

    def definitions(self, streaming: bool = True) -> list[dict[str, Any]]:
        """Tool definitions in a deterministic (name-sorted) order, so the prompt cache stays warm."""
        return [self._tools[n].definition(streaming) for n in self.names()]

    async def execute(
        self,
        name: str,
        arguments: Any,
        *,
        approver: Approver | None = None,
        auto_approve: bool = False,
        default_timeout: float = 60.0,
    ) -> ToolResult:
        """Validate, (maybe) ask for approval, run with a timeout, and never raise."""
        tool = self._tools.get(name)
        if tool is None:
            return ToolResult.error(f"Unknown tool: {name}")
        if not isinstance(arguments, dict):
            return ToolResult.error(
                f"INVALID_JSON: tool input must be an object, got {type(arguments).__name__}"
            )
        problem = tool.validate(arguments)
        if problem:
            return ToolResult.error(f"INVALID_INPUT: {problem}")
        if tool.dangerous and not auto_approve:
            if approver is None:
                return ToolResult.error(
                    "Action declined: no approval channel is available for this potentially dangerous action."
                )
            try:
                allowed = await approver(name, arguments)
            except Exception as exc:  # noqa: BLE001
                return ToolResult.error(f"Action declined: approval failed ({exc}).")
            if not allowed:
                return ToolResult.error("Action declined by the user.")
        try:
            if inspect.iscoroutinefunction(tool.handler):
                coro = tool.handler(**arguments)
            else:
                coro = asyncio.to_thread(tool.handler, **arguments)
            result = await asyncio.wait_for(coro, timeout=tool.timeout or default_timeout)
        except asyncio.TimeoutError:
            return ToolResult.error(f"Tool {name} timed out after {tool.timeout or default_timeout:.0f}s.")
        except Exception as exc:  # noqa: BLE001
            log.exception("tool %s failed", name)
            return ToolResult.error(f"Tool {name} failed: {type(exc).__name__}: {exc}")
        if isinstance(result, ToolResult):
            return result
        if result is None:
            return ToolResult("OK")
        if isinstance(result, (dict, list)):
            import json

            return ToolResult(json.dumps(result, ensure_ascii=False, default=str))
        return ToolResult(str(result))
