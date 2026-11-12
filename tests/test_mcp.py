"""MCP client: a fake stdio server speaking JSON-RPC, its tools registered and called through the Jarvis registry."""

from __future__ import annotations

import json
import sys
import textwrap

from jarvis.mcp_client import MCPHub, load_config, to_result, tool_name
from jarvis.tools.base import ToolRegistry

SERVER = textwrap.dedent('''
    import json, sys
    for line in sys.stdin:
        m = json.loads(line)
        if "id" not in m:
            continue
        meth, p = m["method"], m.get("params", {})
        if meth == "initialize":
            r = {"protocolVersion": p["protocolVersion"], "capabilities": {"tools": {}}, "serverInfo": {"name": "fake"}}
        elif meth == "tools/list" and not p.get("cursor"):
            r = {"tools": [{"name": "add", "description": "Add two numbers", "inputSchema": {"$schema": "x", "type": "object", "properties": {"a": {"type": "number"}, "b": {"type": "number"}}, "required": ["a", "b"]}, "annotations": {"readOnlyHint": True}}], "nextCursor": "p2"}
        elif meth == "tools/list":
            r = {"tools": [{"name": "delete.everything", "description": "Dangerous", "inputSchema": {"type": "object", "properties": {}}}]}
        elif meth == "tools/call" and p["name"] == "add":
            r = {"content": [{"type": "text", "text": str(p["arguments"]["a"] + p["arguments"]["b"])}]}
        else:
            r = {"content": [{"type": "text", "text": "nope"}], "isError": True}
        print(json.dumps({"jsonrpc": "2.0", "id": m["id"], "result": r}), flush=True)
''')


def test_helpers(tmp_path, monkeypatch):
    assert tool_name("my server", "do.it") == "mcp__my_server__do_it"
    assert to_result({"content": [{"type": "text", "text": "a"}, {"type": "text", "text": "b"}]}).content == "a\nb"
    assert to_result({"content": [{"type": "text", "text": "bad"}], "isError": True}).is_error
    assert to_result({"content": [], "structuredContent": {"x": 1}}).content == '{"x": 1}'
    img = to_result({"content": [{"type": "image", "data": "AAAA", "mimeType": "image/png"}]}).content
    assert img[1]["type"] == "image"
    (tmp_path / "mcp.json").write_text(json.dumps({"mcpServers": {"a": {"command": "x"}, "b": {"command": "y", "disabled": True}}}))
    monkeypatch.delenv("JARVIS_MCP_CONFIG", raising=False)
    assert list(load_config(tmp_path)) == ["a"]
    assert load_config(tmp_path / "missing") == {}


async def test_stdio_server_tools(tmp_path):
    script = tmp_path / "server.py"
    script.write_text(SERVER)
    reg = ToolRegistry()
    hub = MCPHub(reg)
    added = await hub.connect({"fake": {"command": sys.executable, "args": ["-u", str(script)]}, "broken": {"command": "/nonexistent/binary"}})
    try:
        assert added == 2 and "broken" in hub.errors
        assert set(reg.names()) == {"mcp__fake__add", "mcp__fake__delete_everything"}
        assert not reg.get("mcp__fake__add").dangerous, "read-only tools run without asking"
        assert reg.get("mcp__fake__delete_everything").dangerous, "other tools ask for confirmation"
        assert "$schema" not in reg.get("mcp__fake__add").input_schema
        assert (await reg.execute("mcp__fake__add", {"a": 2, "b": 3})).content == "5"
        assert (await reg.execute("mcp__fake__add", {"a": 2})).is_error
        assert (await reg.execute("mcp__fake__delete_everything", {})).is_error, "no approver: declined"
        assert hub.status()["connected"] == {"fake": 2}
    finally:
        await hub.close()
