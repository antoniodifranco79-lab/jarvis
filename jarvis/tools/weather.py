from __future__ import annotations

import httpx

from . import ToolContext
from .base import ToolRegistry, ToolResult

WMO = {
    0: "clear sky",
    1: "mainly clear",
    2: "partly cloudy",
    3: "overcast",
    45: "fog",
    48: "freezing fog",
    51: "light drizzle",
    53: "drizzle",
    55: "heavy drizzle",
    56: "freezing drizzle",
    57: "heavy freezing drizzle",
    61: "light rain",
    63: "rain",
    65: "heavy rain",
    66: "freezing rain",
    67: "heavy freezing rain",
    71: "light snow",
    73: "snow",
    75: "heavy snow",
    77: "snow grains",
    80: "light showers",
    81: "showers",
    82: "violent showers",
    85: "light snow showers",
    86: "heavy snow showers",
    95: "thunderstorm",
    96: "thunderstorm with hail",
    99: "thunderstorm with heavy hail",
}

GEOCODE_URL = "https://geocoding-api.open-meteo.com/v1/search"
FORECAST_URL = "https://api.open-meteo.com/v1/forecast"


async def geocode(client: httpx.AsyncClient, place: str) -> dict | None:
    r = await client.get(GEOCODE_URL, params={"name": place, "count": 1, "language": "en", "format": "json"})
    r.raise_for_status()
    results = r.json().get("results") or []
    return results[0] if results else None


async def fetch_weather(place: str, days: int = 1) -> dict | str:
    async with httpx.AsyncClient(timeout=15) as client:
        loc = await geocode(client, place)
        if not loc:
            return f"I couldn't find a place called '{place}'."
        r = await client.get(
            FORECAST_URL,
            params={
                "latitude": loc["latitude"],
                "longitude": loc["longitude"],
                "current": "temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m,precipitation",
                "daily": "weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,sunrise,sunset",
                "timezone": "auto",
                "forecast_days": max(1, min(days, 7)),
            },
        )
        r.raise_for_status()
        data = r.json()
    cur = data.get("current", {})
    daily = data.get("daily", {})
    forecast = []
    for i, day in enumerate(daily.get("time", [])):
        forecast.append(
            {
                "date": day,
                "conditions": WMO.get(daily["weather_code"][i], "unknown"),
                "max_c": daily["temperature_2m_max"][i],
                "min_c": daily["temperature_2m_min"][i],
                "rain_probability_pct": daily["precipitation_probability_max"][i],
                "sunrise": daily["sunrise"][i][11:16],
                "sunset": daily["sunset"][i][11:16],
            }
        )
    return {
        "place": ", ".join(p for p in (loc.get("name"), loc.get("admin1"), loc.get("country")) if p),
        "now": {
            "conditions": WMO.get(cur.get("weather_code"), "unknown"),
            "temperature_c": cur.get("temperature_2m"),
            "feels_like_c": cur.get("apparent_temperature"),
            "humidity_pct": cur.get("relative_humidity_2m"),
            "wind_kmh": cur.get("wind_speed_10m"),
            "precipitation_mm": cur.get("precipitation"),
        },
        "forecast": forecast,
    }


def register(registry: ToolRegistry, ctx: ToolContext) -> None:
    @registry.tool(timeout=30)
    async def get_weather(location: str = "", days: int = 1) -> ToolResult:
        """Current weather and forecast for a place (Open-Meteo, no API key). Call it whenever the user
        asks about weather, temperature, rain, what to wear, or whether to take an umbrella.

        Args:
            location: City or place name, e.g. "Milano" or "Paris, France". Empty = the user's home location.
            days: Number of forecast days to include, 1 to 7.
        """
        place = location.strip() or ctx.settings.location.strip()
        if not place:
            return ToolResult.error(
                "No location given and no home location configured. Ask the user where they are."
            )
        result = await fetch_weather(place, days)
        return ToolResult.error(result) if isinstance(result, str) else ToolResult(_json(result))


def _json(obj: dict) -> str:
    import json

    return json.dumps(obj, ensure_ascii=False)
