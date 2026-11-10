"""Split a streaming text into speakable sentences, and guess which language they are in."""

from __future__ import annotations

import re

_BOUNDARY = re.compile(r"(?<=[.!?…])\s+|\n+")
_IT_WORDS = {
    "il",
    "la",
    "di",
    "che",
    "è",
    "e",
    "non",
    "un",
    "una",
    "per",
    "sono",
    "del",
    "della",
    "con",
    "le",
    "gli",
    "ho",
    "signore",
    "buongiorno",
    "buonasera",
    "grazie",
    "oggi",
    "domani",
    "anche",
    "come",
    "questo",
    "questa",
    "tutto",
}
_EN_WORDS = {
    "the",
    "is",
    "and",
    "of",
    "to",
    "you",
    "it",
    "that",
    "sir",
    "good",
    "morning",
    "evening",
    "with",
    "for",
    "your",
    "are",
    "have",
    "this",
    "will",
    "not",
    "today",
    "tomorrow",
    "all",
    "systems",
    "there",
    "be",
    "what",
    "can",
}


def guess_language(text: str) -> str:
    """'it' or 'en' - a tiny heuristic, good enough to pick a voice."""
    words = re.findall(r"[a-zàèéìòù']+", text.lower())
    it = sum(w in _IT_WORDS for w in words)
    en = sum(w in _EN_WORDS for w in words)
    if it == en:
        return "it" if re.search(r"[àèéìòù]", text) else "en"
    return "it" if it > en else "en"


class SentenceBuffer:
    """Feed it text deltas; it hands back complete sentences as soon as they are ready."""

    def __init__(self, min_chars: int = 12) -> None:
        self.min_chars = min_chars
        self._buf = ""

    def feed(self, delta: str) -> list[str]:
        self._buf += delta
        out: list[str] = []
        while True:
            m = _BOUNDARY.search(self._buf)
            if not m:
                break
            candidate = self._buf[: m.start()].strip()
            rest = self._buf[m.end() :]
            if len(candidate) < self.min_chars and not rest.strip() and "\n" not in m.group(0):
                break  # too short to be worth a separate utterance; wait for more
            if candidate:
                out.append(candidate)
            self._buf = rest
        return out

    def flush(self) -> list[str]:
        rest = self._buf.strip()
        self._buf = ""
        return [rest] if rest else []
