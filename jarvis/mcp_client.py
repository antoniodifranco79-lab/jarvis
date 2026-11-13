"""Model Context Protocol client: Jarvis can use the tools of any MCP server, local (stdio) or remote (HTTP).

Servers are listed in ``~/.jarvis/mcp.json`` (or the file in ``JARVIS_MCP_CONFIG``) in the same format as Claude
Desktop, so any server from the MCP ecosystem works as is::

    {"mcpServers": {
      "filesystem": {"command": "npx", "args": ["-y", "@modelcontextprotocol/server-filesystem", "/home/me/docs"]},
      "remote": {"url": "https://example.com/mcp", "headers": {"Authorization": "Bearer ..."}, "trusted": true}
    }}

Each server tool becomes ``mcp__<server>__<tool>``. Tools ask for confirmation before running unless the server
declares them read-only or the server entry has ``"trusted": true``. No SDK needed: JSON-RPC 2.0 over stdio
(one message per line) or over Streamable HTTP (JSON or SSE replies)."""

from __future__ import annotations

import asyncio
import json
import logging
import os
import re
from pathlib import Path
from typing import Any

from .tools.base import Tool, ToolRegistry, ToolResult

log = logging.getLogger(__name__)
PROTOCOL = "2025-06-18"
CLIENT = {"name": "jarvis", "version": "2.0"}


def config_path(data_dir: Path) -> Path:
    return Path(os.environ.get("JARVIS_MCP_CONFIG") or Path(data_dir) / "mcp.json").expanduser()


def load_config(data_dir: Path) -> dict[str, dict[str, Any]]:
    path = config_path(data_dir)
    if not path.is_file():
        return {}
    data = json.loads(path.read_text(encoding="utf-8"))
    servers = data.get("mcpServers", data.get("servers", {}))
    return {name: cfg for name, cfg in servers.items() if isinstance(cfg, dict) and not cfg.get("disabled")}


def tool_name(server: str, tool: str) -> str:
    clean = lambda s: re.sub(r"[^A-Za-z0-9_-]", "_", s)  # noqa: E731
    return f"mcp__{clean(server)}__{clean(tool)}"[:64]


def to_result(result: dict[str, Any]) -> ToolResult:
    blocks, texts = [], []
    for item in result.get("content", []) or []:
        if item.get("type") == "text":
            texts.append(item.get("text", ""))
        elif item.get("type") == "image" and item.get("data"):
            blocks.append({"type": "image", "source": {"type": "base64", "media_type": item.get("mimeType", "image/png"), "data": item["data"]}})
        elif item.get("type") == "resource":
            res = item.get("resource", {})
            texts.append(res.get("text") or f"[risorsa {res.get('uri', '')}]")
    if not texts and result.get("structuredContent") is not None:
        texts.append(json.dumps(result["structuredContent"], ensure_ascii=False))
    text = "\n".join(texts) or "OK"
    if result.get("isError"):
        return ToolResult.error(text)
    return ToolResult([{"type": "text", "text": text}, *blocks]) if blocks else ToolResult(text)


class _Server:
    """Common JSON-RPC handshake and tool calls; subclasses implement ``_send``."""

    def __init__(self, name: str, cfg: dict[str, Any]) -> None:
        self.name, self.cfg, self._id = name, cfg, 0

    async def _send(self, message: dict[str, Any], expect_reply: bool) -> dict[str, Any] | None:
        raise NotImplementedError

    async def request(self, method: str, params: dict[str, Any] | None = None) -> dict[str, Any]:
        self._id += 1
        reply = await self._send({"jsonrpc": "2.0", "id": self._id, "method": method, "params": params or {}}, True)
        if reply is None:
            raise RuntimeError(f"{self.name}: no reply to {method}")
        if "error" in reply:
            raise RuntimeError(f"{self.name}: {reply['error'].get('message', reply['error'])}")
        return reply.get("result", {})

    async def initialize(self) -> None:
        await self.request("initialize", {"protocolVersion": PROTOCOL, "capabilities": {}, "clientInfo": CLIENT})
        await self._send({"jsonrpc": "2.0", "method": "notifications/initialized"}, False)

    async def list_tools(self) -> list[dict[str, Any]]:
        tools, cursor = [], None
        while True:
            page = await self.request("tools/list", {"cursor": cursor} if cursor else {})
            tools += page.get("tools", [])
            cursor = page.get("nextCursor")
            if not cursor:
                return tools

    async def call(self, tool: str, arguments: dict[str, Any]) -> ToolResult:
        return to_result(await self.request("tools/call", {"name": tool, "arguments": arguments}))

    async def close(self) -> None:  # noqa: B027
        pass


class StdioServer(_Server):
    async def start(self) -> None:
        env = {**os.environ, **{k: str(v) for k, v in (self.cfg.get("env") or {}).items()}}
        self.proc = await asyncio.create_subprocess_exec(
            self.cfg["command"], *[str(a) for a in self.cfg.get("args", [])], env=env, cwd=self.cfg.get("cwd"),
            stdin=asyncio.subprocess.PIPE, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.DEVNULL, limit=16 * 1024 * 1024,
        )
        self.pending: dict[int, asyncio.Future] = {}
        self.reader = asyncio.create_task(self._read())

    async def _read(self) -> None:
        assert self.proc.stdout
        while line := await self.proc.stdout.readline():
            try:
                msg = json.loads(line)
            except ValueError:
                continue
            fut = self.pending.pop(msg.get("id"), None) if "id" in msg and ("result" in msg or "error" in msg) else None
            if fut and not fut.done():
                fut.set_result(msg)
        for fut in self.pending.values():
            if not fut.done():
                fut.set_exception(RuntimeError(f"{self.name}: server exited"))

    async def _send(self, message: dict[str, Any], expect_reply: bool) -> dict[str, Any] | None:
        assert self.proc.stdin
        fut = None
        if expect_reply:
            fut = asyncio.get_running_loop().create_future()
            self.pending[message["id"]] = fut
        self.proc.stdin.write((json.dumps(message) + "\n").encode())
        await self.proc.stdin.drain()
        return await fut if fut else None

    async def close(self) -> None:
        if getattr(self, "proc", None) and self.proc.returncode is None:
            self.proc.terminate()
            try:
                await asyncio.wait_for(self.proc.wait(), 3)
            except asyncio.TimeoutError:
                self.proc.kill()
        if getattr(self, "reader", None):
            self.reader.cancel()


class HttpServer(_Server):
    async def start(self) -> None:
        import httpx

        self.client = httpx.AsyncClient(timeout=60)
        self.session_id: str | None = None

    async def _send(self, message: dict[str, Any], expect_reply: bool) -> dict[str, Any] | None:
        headers = {"Accept": "application/json, text/event-stream", "Content-Type": "application/json", "MCP-Protocol-Version": PROTOCOL, **(self.cfg.get("headers") or {})}
        if self.session_id:
            headers["Mcp-Session-Id"] = self.session_id
        r = await self.client.post(self.cfg["url"], json=message, headers=headers)
        self.session_id = r.headers.get("mcp-session-id", self.session_id)
        r.raise_for_status()
        if not expect_reply:
            return None
        if "text/event-stream" in r.headers.get("content-type", ""):
            for line in r.text.splitlines():
                if line.startswith("data:"):
                    msg = json.loads(line[5:].strip() or "{}")
                    if msg.get("id") == message["id"]:
                        return msg
            return None
        return r.json()

    async def close(self) -> None:
        if getattr(self, "client", None):
            await self.client.aclose()


class MCPHub:
    """Connects the configured servers and registers their tools in the Jarvis registry."""

    def __init__(self, registry: ToolRegistry) -> None:
        self.registry, self.servers, self.errors = registry, {}, {}

    async def connect(self, config: dict[str, dict[str, Any]], timeout: float = 30) -> int:
        added = 0
        for name, cfg in config.items():
            server: _Server = HttpServer(name, cfg) if cfg.get("url") else StdioServer(name, cfg)
            try:
                await asyncio.wait_for(server.start(), timeout)
                await asyncio.wait_for(server.initialize(), timeout)
                tools = await asyncio.wait_for(server.list_tools(), timeout)
            except Exception as exc:  # noqa: BLE001
                self.errors[name] = f"{type(exc).__name__}: {exc}"
                log.warning("MCP server %s not available: %s", name, exc)
                await server.close()
                continue
            self.servers[name] = server
            for t in tools:
                added += self._register(server, t, bool(cfg.get("trusted")))
        return added

    def _register(self, server: _Server, t: dict[str, Any], trusted: bool) -> int:
        remote = t["name"]

        async def handler(**arguments: Any) -> ToolResult:
            return await server.call(remote, arguments)

        read_only = bool((t.get("annotations") or {}).get("readOnlyHint"))
        schema = t.get("inputSchema") or {"type": "object", "properties": {}}
        schema = {k: v for k, v in schema.items() if k != "$schema"}
        self.registry.add(Tool(name=tool_name(server.name, remote), description=f"[{server.name}] {t.get('description') or remote}"[:1024],
                               input_schema=schema, handler=handler, dangerous=not (trusted or read_only), timeout=120, tags={"mcp", server.name}))
        return 1

    def status(self) -> dict[str, Any]:
        return {"connected": {n: len([t for t in self.registry.names() if t.startswith(tool_name(n, ""))]) for n in self.servers}, "errors": self.errors}

    async def close(self) -> None:
        for s in self.servers.values():
            await s.close()
