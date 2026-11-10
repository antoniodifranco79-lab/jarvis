from __future__ import annotations

from typing import Literal

import httpx

from . import ToolContext
from .base import ToolRegistry, ToolResult


def register(registry: ToolRegistry, ctx: ToolContext) -> None:
    base = ctx.settings.home_assistant_url.rstrip("/")
    token = ctx.settings.home_assistant_token
    if not base or not token:
        return  # Home Assistant isn't configured: the tool stays hidden from Claude.

    headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}

    @registry.tool(timeout=30)
    async def home_assistant(
        action: Literal["list_entities", "get_state", "call_service"],
        entity_id: str = "",
        domain: str = "",
        service: str = "",
        data: dict | None = None,
    ) -> ToolResult:
        """Control the smart home through Home Assistant. Call it for lights, switches, thermostats, media players,
        covers, scenes ("turn off the kitchen lights", "set the thermostat to 21", "is the garage open?").
        Use list_entities first if you don't know the entity ids, then call_service with e.g.
        domain="light", service="turn_on", entity_id="light.kitchen".

        Args:
            action: list_entities (all entities, with state), get_state (one entity), call_service (do something).
            entity_id: Target entity, e.g. "light.kitchen". Required for get_state and call_service.
            domain: Service domain for call_service, e.g. "light", "switch", "climate", "media_player", "scene".
            service: Service name for call_service, e.g. "turn_on", "turn_off", "toggle", "set_temperature".
            data: Extra service data, e.g. {"brightness_pct": 40} or {"temperature": 21}.
        """
        async with httpx.AsyncClient(timeout=20, headers=headers) as client:
            if action == "list_entities":
                r = await client.get(f"{base}/api/states")
                r.raise_for_status()
                entities = [
                    {
                        "entity_id": s["entity_id"],
                        "state": s["state"],
                        "name": s.get("attributes", {}).get("friendly_name"),
                    }
                    for s in r.json()
                    if s["entity_id"].split(".")[0]
                    in {
                        "light",
                        "switch",
                        "climate",
                        "media_player",
                        "cover",
                        "scene",
                        "lock",
                        "fan",
                        "sensor",
                        "binary_sensor",
                    }
                ]
                import json

                return ToolResult(json.dumps(entities[:300], ensure_ascii=False))
            if action == "get_state":
                if not entity_id:
                    return ToolResult.error("entity_id is required.")
                r = await client.get(f"{base}/api/states/{entity_id}")
                if r.status_code == 404:
                    return ToolResult.error(f"Unknown entity {entity_id}.")
                r.raise_for_status()
                return ToolResult(r.text)
            if not (domain and service):
                return ToolResult.error("domain and service are required for call_service.")
            payload = dict(data or {})
            if entity_id:
                payload["entity_id"] = entity_id
            r = await client.post(f"{base}/api/services/{domain}/{service}", json=payload)
            r.raise_for_status()
            return ToolResult(f"Called {domain}.{service} on {entity_id or 'all'}.")
