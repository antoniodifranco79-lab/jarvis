"""Turn Jarvis' written answers into text a voice can read naturally: no markdown, citations or links;
money, percentages, dates, times and abbreviations the way a person would say them. Mirrors web/voice.js."""

from __future__ import annotations

import re

MESI = ["gennaio", "febbraio", "marzo", "aprile", "maggio", "giugno", "luglio", "agosto", "settembre", "ottobre", "novembre", "dicembre"]
MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"]
IT_ABBR = [
    (r"\bartt\.\s*", "articoli ", re.I), (r"\bart\.\s*", "articolo ", re.I), (r"\bpp\.\s*(?=\d)", "pagine ", re.I), (r"\bp\.\s*(?=\d)", "pagina ", re.I),
    (r"\bn\.\s*(?=\d)", "numero ", re.I), (r"\becc\.", "eccetera", re.I), (r"\bdott\.ssa\b\.?", "dottoressa", re.I), (r"\bdott\.\s*", "dottor ", re.I),
    (r"\bavv\.\s*", "avvocato ", re.I), (r"\bing\.\s*", "ingegner ", re.I), (r"\bsig\.ra\b\.?", "signora", re.I), (r"\bsig\.\s*", "signor ", re.I),
    (r"\bS\.?r\.?l\.?(?=\W|$)", "esse erre elle", 0), (r"\bS\.?p\.?A\.?(?=\W|$)", "esse pi a", 0), (r"\bp\.?\s?iva\b", "partita iva", re.I),
    (r"\bIVA\b", "iva", 0), (r"\bIBAN\b", "iban", 0), (r"\bF24\b", "effe ventiquattro", 0), (r"\bAI\b", "A I", 0), (r"\bGDPR\b", "gi di pi erre", 0),
    (r"\bkm/h\b", "chilometri orari", re.I), (r"°\s?C\b", " gradi", re.I), (r"\s?°", " gradi", re.I),
]
EN_ABBR = [
    (r"\be\.g\.\s*", "for example ", re.I), (r"\bi\.e\.\s*", "that is ", re.I), (r"\betc\.", "et cetera", re.I), (r"\bDr\.\s*", "Doctor ", 0),
    (r"\bMr\.\s*", "Mister ", 0), (r"\bkm/h\b", "kilometres per hour", re.I), (r"°\s?C\b", " degrees", re.I), (r"\s?°", " degrees", re.I),
]
_EMOJI = re.compile("[\U0001F300-\U0001FAFF☀-➿\U0001F000-\U0001F2FF]")


def _date(d: str, m: int, y: str, italian: bool) -> str | None:
    if not 1 <= m <= 12:
        return None
    return f"{int(d)} {(MESI if italian else MONTHS)[m - 1]}" + (f" {y}" if y else "")


def _euro(n: str) -> str:
    whole, _, cents = n.replace(".", "").partition(",")
    return f"{whole} euro e {int(cents)} centesimi" if cents and int(cents) else f"{whole} euro"


def speech_text(text: str, language: str = "it") -> str:
    italian = not language.lower().startswith("en")
    t = text or ""
    t = re.sub(r"```.*?```", " ", t, flags=re.S)
    t = re.sub(r"`([^`]*)`", r"\1", t)
    t = re.sub(r"\[([^\]]+)\]\([^)]+\)", r"\1", t)  # markdown links
    t = re.sub(r"\[(?:\d+|doc|wiki)\](?:\s*\[(?:\d+|doc|wiki)\])*", "", t, flags=re.I)
    t = re.sub(r"\((?:fonte|fonti|source|file)[^)]*\)", "", t, flags=re.I)
    t = re.sub(r"\([^()]*\bp\.\s*\d+[^()]*\)", "", t)
    t = re.sub(r"https?://\S+", "il link" if italian else "the link", t)
    t = _EMOJI.sub("", t)
    t = re.sub(r"^\s*(?:[-*•]|\d+[.)])\s+", "", t, flags=re.M)
    t = re.sub(r"[*_#>|~]+", " ", t)
    t = re.sub(r"J\.A\.R\.V\.I\.S\.?", "Jarvis", t)
    t = re.sub(r"\b(\d{4})-(\d{2})-(\d{2})\b", lambda m: _date(m[3], int(m[2]), m[1], italian) or m[0], t)
    t = re.sub(r"\b(\d{1,2})/(\d{1,2})/(\d{2,4})\b", lambda m: _date(m[1], int(m[2]), ("20" + m[3]) if len(m[3]) == 2 else m[3], italian) or m[0], t)
    t = re.sub(r"\b(il|al|dal|del|entro|fino|giorno|data|scade|the|on|by)\s+(\d{1,2})/(\d{1,2})\b(?!/)",
               lambda m: f"{m[1]} {_date(m[2], int(m[3]), '', italian) or m[2] + '/' + m[3]}" if 1 <= int(m[2]) <= 31 else m[0], t, flags=re.I)
    t = re.sub(r"\b([01]?\d|2[0-3])[:.]([0-5]\d)\b(?!\d)",
               lambda m: (f"{int(m[1])}" if m[2] == "00" else f"{int(m[1])} e {int(m[2])}") if italian else (f"{int(m[1])} o'clock" if m[2] == "00" else f"{int(m[1])} {m[2]}"), t)
    if italian:
        t = re.sub(r"\b\d{1,3}(?:\.\d{3})+(?![\d.]*\d)", lambda m: m[0].replace(".", ""), t)
        t = re.sub(r"€\s?(\d[\d.,]*\d|\d)", lambda m: _euro(m[1]), t)
        t = re.sub(r"(\d[\d.,]*\d|\d)\s?€", lambda m: _euro(m[1]), t)
        t = re.sub(r"(\d+),(\d{2})\s+euro\b", lambda m: _euro(f"{m[1]},{m[2]}"), t)
        t = re.sub(r"(\d)\s?%", r"\1 per cento", t)
    else:
        t = re.sub(r"€\s?(\d[\d.,]*)", r"\1 euros", t)
        t = re.sub(r"(\d)\s?%", r"\1 percent", t)
    for pattern, replacement, flags in IT_ABBR if italian else EN_ABBR:
        t = re.sub(pattern, replacement, t, flags=flags)
    t = re.sub(r"([:;,.!?])[ \t]*\n+", r"\1 ", t)
    t = re.sub(r"\n{2,}", ". ", t).replace("\n", ", ")
    t = re.sub(r"\s+([,.;:!?])", r"\1", t)
    t = re.sub(r"\(\s*\)", "", t)
    t = re.sub(r"([.!?:;,])\s*[.,](?!\d)", r"\1", t)
    return re.sub(r"[ \t]+", " ", t).strip()
