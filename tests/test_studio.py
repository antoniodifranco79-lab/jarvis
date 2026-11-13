"""Studio calculators of the desktop app: same numbers as the web app (web/calc.js)."""

from __future__ import annotations

from datetime import date

from jarvis.events import EventBus
from jarvis.tools import ToolContext, build_registry
from jarvis.tools.studio import (
    decode_cf,
    fiscal_deadlines,
    holiday,
    in_words,
    instalment,
    legal_interest,
    next_working,
)


def test_in_words():
    cases = {0: "zero", 21: "ventuno", 23: "ventitré", 28: "ventotto", 108: "centootto", 1001: "milleuno", 1250: "milleduecentocinquanta", 21000: "ventunomila", 2_500_000: "duemilionicinquecentomila", 1003: "milletré"}
    for n, w in cases.items():
        assert in_words(n) == w, n


def test_legal_interest_and_loan():
    total, rows = legal_interest(10000, date(2024, 1, 1), date(2025, 1, 1))
    assert total == 250.68 and rows == [(2024, 366, 2.5, 250.68)]
    _, rows = legal_interest(10000, date(2024, 7, 1), date(2025, 7, 1))
    assert [(y, d) for y, d, _, _ in rows] == [(2024, 184), (2025, 181)]
    assert round(instalment(100000, 3, 240), 2) == 554.6
    assert round(instalment(150000, 3, 300), 2) == 711.32


def test_calendar():
    assert holiday(date(2026, 4, 5)) == "Pasqua" and holiday(date(2026, 4, 6)) == "Lunedì dell'Angelo"
    assert next_working(date(2026, 8, 15)) == date(2026, 8, 17)
    rows = dict(fiscal_deadlines(date(2026, 11, 12), 50))
    assert date(2026, 12, 28) in rows and "Acconto IVA" in rows[date(2026, 12, 28)]  # 27/12/2026 is a Sunday
    assert "IVA del terzo trimestre" in rows[date(2026, 11, 16)]


def test_decode_cf():
    info = decode_cf("RSSMRA85T10A562S", date(2026, 11, 12))
    assert info == {"sex": "M", "born": date(1985, 12, 10), "place_code": "A562", "age": 40}


async def test_tools_registered(settings, memory):
    reg = build_registry(ToolContext(settings, memory, EventBus()))
    assert {"amount_in_words", "legal_interest_between", "loan_instalment", "fiscal_calendar", "decode_tax_code"} <= set(reg.names())
    assert "milleduecentocinquanta/50" in (await reg.execute("amount_in_words", {"amount": 1250.5})).content
    assert "250,68 €" in (await reg.execute("legal_interest_between", {"capital": 10000, "start_date": "2024-01-01", "end_date": "01/01/2025"})).content
    assert "711,32 €" in (await reg.execute("loan_instalment", {"capital": 150000, "annual_rate": 3, "years": 25})).content
    assert "1985" in (await reg.execute("decode_tax_code", {"tax_code": "RSSMRA85T10A562S"})).content
    assert (await reg.execute("decode_tax_code", {"tax_code": "abc"})).is_error
