#!/usr/bin/env python3
"""Keep the holographic HUD identical everywhere.

The source of truth is jarvis/server/static/hud/ (served by the desktop HUD). This script copies it into
web/hud/ (the browser app) and inlines reactor.js into site/index.html between the REACTOR markers, because
the site is also published as a single self-contained page. tests/test_hud_sync.py fails when they drift.
"""

from __future__ import annotations

import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "jarvis" / "server" / "static" / "hud"
FILES = ("hud.css", "reactor.js")
START, END = "/* REACTOR:START */", "/* REACTOR:END */"


def inline_block() -> str:
    return f"{START}\n{(SRC / 'reactor.js').read_text(encoding='utf-8').strip()}\n{END}"


def sync() -> list[Path]:
    changed: list[Path] = []
    dest = ROOT / "web" / "hud"
    dest.mkdir(exist_ok=True)
    for name in FILES:
        target = dest / name
        if not target.exists() or target.read_bytes() != (SRC / name).read_bytes():
            shutil.copyfile(SRC / name, target)
            changed.append(target)
    site = ROOT / "site" / "index.html"
    html = site.read_text(encoding="utf-8")
    if START in html and END in html:
        a, b = html.index(START), html.index(END) + len(END)
        new = html[:a] + inline_block() + html[b:]
        if new != html:
            site.write_text(new, encoding="utf-8")
            changed.append(site)
    return changed


if __name__ == "__main__":
    for path in sync():
        print("updated", path.relative_to(ROOT))
