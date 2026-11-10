"""Persistent memory: conversation sessions (append-only, API-ready), long-term facts and reminders.

Everything lives in one SQLite file so Jarvis remembers across restarts.
"""

from __future__ import annotations

import hashlib
import json
import sqlite3
import threading
from dataclasses import dataclass
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any

SCHEMA = """
CREATE TABLE IF NOT EXISTS sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    mode TEXT NOT NULL,
    fingerprint TEXT NOT NULL,
    started_at TEXT NOT NULL,
    last_at TEXT NOT NULL,
    summary TEXT
);
CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    text TEXT,
    ts TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id, id);
CREATE TABLE IF NOT EXISTS facts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    fact TEXT NOT NULL,
    category TEXT NOT NULL DEFAULT 'general',
    created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS reminders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    message TEXT NOT NULL,
    due_at TEXT NOT NULL,
    created_at TEXT NOT NULL,
    fired INTEGER NOT NULL DEFAULT 0
);
"""


def _now() -> str:
    return datetime.now().isoformat(timespec="seconds")


@dataclass
class Session:
    id: int
    mode: str
    fingerprint: str
    started_at: datetime
    last_at: datetime
    summary: str | None = None


@dataclass
class Reminder:
    id: int
    message: str
    due_at: datetime
    fired: bool = False


def fingerprint(system_prompt: str, model: str, tool_names: list[str]) -> str:
    """Identity of a conversation's frozen prefix (system prompt + model + tool set)."""
    payload = json.dumps(
        {"system": system_prompt, "model": model, "tools": sorted(tool_names)}, sort_keys=True
    )
    return hashlib.sha256(payload.encode()).hexdigest()[:16]


class Memory:
    def __init__(self, db_path: Path | str = ":memory:") -> None:
        if db_path != ":memory:":
            Path(db_path).parent.mkdir(parents=True, exist_ok=True)
        self._conn = sqlite3.connect(str(db_path), check_same_thread=False)
        self._conn.row_factory = sqlite3.Row
        self._lock = threading.RLock()
        with self._lock:
            self._conn.execute("PRAGMA journal_mode=WAL")
            self._conn.execute("PRAGMA foreign_keys=ON")
            self._conn.executescript(SCHEMA)

    def close(self) -> None:
        with self._lock:
            self._conn.close()

    # ------------------------------------------------------------------ sessions
    def _row_session(self, row: sqlite3.Row) -> Session:
        return Session(
            id=row["id"],
            mode=row["mode"],
            fingerprint=row["fingerprint"],
            started_at=datetime.fromisoformat(row["started_at"]),
            last_at=datetime.fromisoformat(row["last_at"]),
            summary=row["summary"],
        )

    def latest_session(self, mode: str) -> Session | None:
        with self._lock:
            row = self._conn.execute(
                "SELECT * FROM sessions WHERE mode=? ORDER BY id DESC LIMIT 1", (mode,)
            ).fetchone()
        return self._row_session(row) if row else None

    def get_session(self, session_id: int) -> Session | None:
        with self._lock:
            row = self._conn.execute("SELECT * FROM sessions WHERE id=?", (session_id,)).fetchone()
        return self._row_session(row) if row else None

    def new_session(self, mode: str, fp: str, summary: str | None = None) -> Session:
        now = _now()
        with self._lock:
            cur = self._conn.execute(
                "INSERT INTO sessions(mode, fingerprint, started_at, last_at, summary) VALUES (?,?,?,?,?)",
                (mode, fp, now, now, summary),
            )
            self._conn.commit()
            return self.get_session(cur.lastrowid)  # type: ignore[return-value]

    def touch_session(self, session_id: int) -> None:
        with self._lock:
            self._conn.execute("UPDATE sessions SET last_at=? WHERE id=?", (_now(), session_id))
            self._conn.commit()

    def resume_or_start(self, mode: str, fp: str, idle_hours: float) -> tuple[Session, bool]:
        """Return (session, is_new). A session is reused only when its frozen prefix matches
        and it hasn't gone quiet for longer than ``idle_hours``."""
        latest = self.latest_session(mode)
        if (
            latest
            and latest.fingerprint == fp
            and datetime.now() - latest.last_at < timedelta(hours=idle_hours)
        ):
            return latest, False
        return self.new_session(mode, fp), True

    # ------------------------------------------------------------------ messages
    def append_message(self, session_id: int, role: str, content: Any, text: str | None = None) -> int:
        if text is None and isinstance(content, str):
            text = content
        if text is None and isinstance(content, list):
            text = " ".join(
                b.get("text", "") for b in content if isinstance(b, dict) and b.get("type") == "text"
            )
        with self._lock:
            cur = self._conn.execute(
                "INSERT INTO messages(session_id, role, content, text, ts) VALUES (?,?,?,?,?)",
                (session_id, role, json.dumps(content, ensure_ascii=False), text, _now()),
            )
            self._conn.execute("UPDATE sessions SET last_at=? WHERE id=?", (_now(), session_id))
            self._conn.commit()
            return int(cur.lastrowid)  # type: ignore[arg-type]

    def load_messages(self, session_id: int) -> list[dict[str, Any]]:
        """The session's conversation exactly as it was sent to the API, in order."""
        with self._lock:
            rows = self._conn.execute(
                "SELECT role, content FROM messages WHERE session_id=? ORDER BY id", (session_id,)
            ).fetchall()
        return [{"role": r["role"], "content": json.loads(r["content"])} for r in rows]

    def estimate_tokens(self, session_id: int) -> int:
        """A cheap upper-bound estimate (about one token per 3.5 characters of JSON)."""
        with self._lock:
            row = self._conn.execute(
                "SELECT COALESCE(SUM(LENGTH(content)),0) AS n FROM messages WHERE session_id=?", (session_id,)
            ).fetchone()
        return int(row["n"] / 3.5)

    def transcript(self, session_id: int, limit: int = 50) -> list[dict[str, Any]]:
        """Human-readable turns (user text and assistant text only), newest last."""
        with self._lock:
            rows = self._conn.execute(
                "SELECT role, text, ts FROM messages WHERE session_id=? AND role IN ('user','assistant') "
                "AND text IS NOT NULL AND text != '' ORDER BY id DESC LIMIT ?",
                (session_id, limit),
            ).fetchall()
        return [{"role": r["role"], "text": r["text"], "ts": r["ts"]} for r in reversed(rows)]

    def search_conversations(self, query: str, limit: int = 10) -> list[dict[str, Any]]:
        words = [w for w in query.lower().split() if len(w) > 2][:6] or [query.lower()]
        where = " AND ".join("LOWER(text) LIKE ?" for _ in words)
        params = [f"%{w}%" for w in words] + [limit]
        with self._lock:
            rows = self._conn.execute(
                f"SELECT role, text, ts FROM messages WHERE role IN ('user','assistant') AND text IS NOT NULL "
                f"AND {where} ORDER BY id DESC LIMIT ?",
                params,
            ).fetchall()
        return [{"role": r["role"], "text": r["text"][:400], "ts": r["ts"]} for r in rows]

    # ------------------------------------------------------------------ facts
    def remember(self, fact: str, category: str = "general") -> int:
        with self._lock:
            cur = self._conn.execute(
                "INSERT INTO facts(fact, category, created_at) VALUES (?,?,?)",
                (fact.strip(), category, _now()),
            )
            self._conn.commit()
            return int(cur.lastrowid)  # type: ignore[arg-type]

    def recall(self, query: str = "", limit: int = 12) -> list[dict[str, Any]]:
        with self._lock:
            if not query.strip():
                rows = self._conn.execute("SELECT * FROM facts ORDER BY id DESC LIMIT ?", (limit,)).fetchall()
            else:
                words = [w for w in query.lower().split() if len(w) > 2][:6] or [query.lower()]
                clauses = " OR ".join("LOWER(fact) LIKE ? OR LOWER(category) LIKE ?" for _ in words)
                params: list[Any] = []
                for w in words:
                    params += [f"%{w}%", f"%{w}%"]
                rows = self._conn.execute(
                    f"SELECT * FROM facts WHERE {clauses} ORDER BY id DESC LIMIT ?", (*params, limit)
                ).fetchall()
                if not rows:  # fall back to the most recent facts: better than silence
                    rows = self._conn.execute(
                        "SELECT * FROM facts ORDER BY id DESC LIMIT ?", (limit,)
                    ).fetchall()
        return [dict(r) for r in rows]

    def forget(self, fact_id: int) -> bool:
        with self._lock:
            cur = self._conn.execute("DELETE FROM facts WHERE id=?", (fact_id,))
            self._conn.commit()
            return cur.rowcount > 0

    def all_facts(self) -> list[dict[str, Any]]:
        with self._lock:
            return [dict(r) for r in self._conn.execute("SELECT * FROM facts ORDER BY id").fetchall()]

    # ------------------------------------------------------------------ reminders
    def add_reminder(self, message: str, due_at: datetime) -> Reminder:
        with self._lock:
            cur = self._conn.execute(
                "INSERT INTO reminders(message, due_at, created_at) VALUES (?,?,?)",
                (message, due_at.isoformat(timespec="seconds"), _now()),
            )
            self._conn.commit()
            return Reminder(int(cur.lastrowid), message, due_at)  # type: ignore[arg-type]

    def pending_reminders(self) -> list[Reminder]:
        with self._lock:
            rows = self._conn.execute("SELECT * FROM reminders WHERE fired=0 ORDER BY due_at").fetchall()
        return [Reminder(r["id"], r["message"], datetime.fromisoformat(r["due_at"]), False) for r in rows]

    def due_reminders(self, now: datetime | None = None) -> list[Reminder]:
        now = now or datetime.now()
        return [r for r in self.pending_reminders() if r.due_at <= now]

    def mark_fired(self, reminder_id: int) -> None:
        with self._lock:
            self._conn.execute("UPDATE reminders SET fired=1 WHERE id=?", (reminder_id,))
            self._conn.commit()

    def cancel_reminder(self, reminder_id: int) -> bool:
        with self._lock:
            cur = self._conn.execute("DELETE FROM reminders WHERE id=? AND fired=0", (reminder_id,))
            self._conn.commit()
            return cur.rowcount > 0
