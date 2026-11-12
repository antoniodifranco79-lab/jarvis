"""Professional-office calculators for Italian studios, exact and offline: amounts in words for cheques, legal
interest year by year, loan instalments, fiscal deadlines moved to the next working day, tax-code decoding.
Same rules as the web app (web/calc.js), so both apps give the same numbers."""

from __future__ import annotations

from datetime import date, timedelta

from . import ToolContext
from .base import ToolRegistry, ToolResult

UNITS = ["zero", "uno", "due", "tre", "quattro", "cinque", "sei", "sette", "otto", "nove", "dieci", "undici", "dodici", "tredici", "quattordici", "quindici", "sedici", "diciassette", "diciotto", "diciannove"]
TENS = ["", "", "venti", "trenta", "quaranta", "cinquanta", "sessanta", "settanta", "ottanta", "novanta"]
MONTHS = ["gennaio", "febbraio", "marzo", "aprile", "maggio", "giugno", "luglio", "agosto", "settembre", "ottobre", "novembre", "dicembre"]
DAYS = ["lunedì", "martedì", "mercoledì", "giovedì", "venerdì", "sabato", "domenica"]
# Legal interest rate (art. 1284 c.c.), set each December by MEF decree.
LEGAL_RATES = {2010: 1, 2011: 1.5, 2012: 2.5, 2013: 2.5, 2014: 1, 2015: 0.5, 2016: 0.2, 2017: 0.1, 2018: 0.3, 2019: 0.8, 2020: 0.05, 2021: 0.01, 2022: 1.25, 2023: 5, 2024: 2.5, 2025: 2, 2026: 1.6}
FISCAL = [
    (3, 16, "Saldo IVA dell'anno precedente (o prima rata) e invio della Certificazione Unica"),
    (4, 30, "Dichiarazione IVA annuale"),
    (5, 16, "IVA del primo trimestre (contribuenti trimestrali)"),
    (6, 16, "IMU: acconto"),
    (6, 30, "Saldo e primo acconto di imposte sui redditi, IRAP e contributi INPS"),
    (8, 20, "IVA del secondo trimestre e versamenti sospesi per agosto"),
    (9, 30, "Presentazione del modello 730"),
    (10, 31, "Dichiarazione dei redditi (modello Redditi e IRAP) e modello 770"),
    (11, 16, "IVA del terzo trimestre (contribuenti trimestrali)"),
    (11, 30, "Secondo acconto di imposte sui redditi, IRAP e contributi INPS"),
    (12, 16, "IMU: saldo"),
    (12, 27, "Acconto IVA"),
]


def eur(n: float) -> str:
    whole, cents = f"{n:,.2f}".split(".")
    return whole.replace(",", ".") + "," + cents + " €"


def fmt(d: date) -> str:
    return f"{DAYS[d.weekday()]} {d.day} {MONTHS[d.month - 1]} {d.year}"


def _under_1000(n: int) -> str:
    h, r = divmod(n, 100)
    out = ("cento" if h == 1 else UNITS[h] + "cento") if h else ""
    if r < 20:
        return out + (UNITS[r] if r else "")
    t, u = divmod(r, 10)
    tens = TENS[t][:-1] if u in (1, 8) else TENS[t]
    return out + tens + (UNITS[u] if u else "")


def in_words(n: int) -> str:
    """Integer in Italian words, as written on cheques: 1250 -> "milleduecentocinquanta"."""
    n = abs(int(n))
    if n == 0:
        return "zero"
    out = ""
    for size, one, many in ((10**9, "unmiliardo", "miliardi"), (10**6, "unmilione", "milioni"), (1000, "mille", "mila")):
        q, n = divmod(n, size)
        if q:
            out += one if q == 1 else _under_1000(q) + many
    out += _under_1000(n) if n else ""
    return out[:-3] + "tré" if len(out) > 3 and out.endswith("tre") else out


# --------------------------------------------------------------------------- holidays and working days
def _easter(y: int) -> date:
    a, b, c = y % 19, y // 100, y % 100
    d, e = divmod(b, 4)
    f = (b + 8) // 25
    g = (b - f + 1) // 3
    h = (19 * a + b - d - g + 15) % 30
    i, k = divmod(c, 4)
    l_ = (32 + 2 * e + 2 * i - h - k) % 7
    m = (a + 11 * h + 22 * l_) // 451
    month, day = divmod(h + l_ - 7 * m + 114, 31)
    return date(y, month, day + 1)


def holiday(d: date) -> str | None:
    fixed = {(1, 1): "Capodanno", (1, 6): "Epifania", (4, 25): "Festa della Liberazione", (5, 1): "Festa del Lavoro", (6, 2): "Festa della Repubblica", (8, 15): "Ferragosto", (11, 1): "Ognissanti", (12, 8): "Immacolata", (12, 25): "Natale", (12, 26): "Santo Stefano"}
    if d.year >= 2026:
        fixed[(10, 4)] = "San Francesco d'Assisi"
    if (d.month, d.day) in fixed:
        return fixed[(d.month, d.day)]
    e = _easter(d.year)
    return "Pasqua" if d == e else "Lunedì dell'Angelo" if d == e + timedelta(days=1) else None


def next_working(d: date) -> date:
    while d.weekday() >= 5 or holiday(d):
        d += timedelta(days=1)
    return d


def fiscal_deadlines(start: date, days: int = 45) -> list[tuple[date, str]]:
    end = start + timedelta(days=days)
    items: list[tuple[date, str]] = []
    for y in range(start.year, end.year + 1):
        for m in range(1, 13):
            items.append((date(y, m, 20 if m == 8 else 16), "F24: ritenute, contributi dei dipendenti e IVA mensile"))
        items += [(date(y, m, d), t) for m, d, t in FISCAL]
    merged: dict[date, list[str]] = {}
    for nominal, title in items:
        due = next_working(nominal)
        if start <= due <= end:
            merged.setdefault(due, []).append(title)
    return [(d, "; ".join(t)) for d, t in sorted(merged.items())]


def legal_interest(capital: float, start: date, end: date, rate: float | None = None) -> tuple[float, list[tuple[int, int, float, float]]]:
    """Simple interest from start (excluded) to end (included), 365-day year, at a fixed rate or the legal rate of each year."""
    rows, cur = [], start
    while cur < end:
        stop = min(date(cur.year + 1, 1, 1), end)
        r = rate if rate is not None else LEGAL_RATES.get(cur.year)
        if r is None:
            raise ValueError(f"legal rate for {cur.year} unknown: pass the rate")
        days = (stop - cur).days
        rows.append((cur.year, days, r, round(capital * r / 100 * days / 365, 2)))
        cur = stop
    return round(sum(x[3] for x in rows), 2), rows


def instalment(capital: float, annual_rate: float, months: int) -> float:
    i = annual_rate / 100 / 12
    return capital / months if i == 0 else capital * i / (1 - (1 + i) ** -months)


def decode_cf(cf: str, today: date | None = None) -> dict:
    cf = cf.upper().replace(" ", "")
    omo = "LMNPQRSTUV"

    def fix(s: str) -> str:
        return "".join(str(omo.index(c)) if c in omo else c for c in s)

    yy, dd = int(fix(cf[6:8])), int(fix(cf[9:11]))
    today = today or date.today()
    female = dd > 40
    born = date((1900 if yy > today.year % 100 else 2000) + yy, "ABCDEHLMPRST".index(cf[8]) + 1, dd - 40 if female else dd)
    age = today.year - born.year - ((today.month, today.day) < (born.month, born.day))
    return {"sex": "F" if female else "M", "born": born, "place_code": cf[11] + fix(cf[12:15]), "age": age}


def _parse_date(s: str) -> date:
    s = s.strip()
    if "-" in s and len(s.split("-")[0]) == 4:
        return date.fromisoformat(s)
    d, m, y = (s.replace(".", "/").replace("-", "/").split("/") + [str(date.today().year)])[:3]
    y = int(y) + (2000 if int(y) < 100 else 0)
    return date(y, int(m), int(d))


def register(registry: ToolRegistry, ctx: ToolContext) -> None:
    @registry.tool()
    def amount_in_words(amount: float) -> ToolResult:
        """Write an amount in Italian words, as required on cheques and contracts (e.g. 1250.50 -> "milleduecentocinquanta/50").

        Args:
            amount: The amount in euro.
        """
        if amount < 0 or amount >= 1e12:
            return ToolResult.error("amount out of range")
        whole = int(round(amount, 2))
        cents = round((round(amount, 2) - whole) * 100)
        words = in_words(whole) + " euro" + (f" e {in_words(cents)} centesimi" if cents else "")
        return ToolResult(f"{eur(amount)} in lettere: {in_words(whole)}/{cents:02d} ({words}).")

    @registry.tool()
    def legal_interest_between(capital: float, start_date: str, end_date: str, rate: float = -1) -> ToolResult:
        """Interest on a capital between two dates: at the Italian legal rate year by year (art. 1284 c.c.), or at a given rate.

        Args:
            capital: Capital in euro.
            start_date: Start date, YYYY-MM-DD or DD/MM/YYYY.
            end_date: End date, YYYY-MM-DD or DD/MM/YYYY.
            rate: Fixed annual rate in percent; leave -1 for the legal rate of each year.
        """
        try:
            a, b = _parse_date(start_date), _parse_date(end_date)
            total, rows = legal_interest(capital, a, b, None if rate < 0 else rate)
        except ValueError as e:
            return ToolResult.error(str(e))
        detail = "; ".join(f"{y}: {d} giorni al {r}% = {eur(v)}" for y, d, r, v in rows)
        return ToolResult(f"Interessi su {eur(capital)} dal {fmt(a)} al {fmt(b)}: {eur(total)} ({detail}). Con il capitale: {eur(capital + total)}.")

    @registry.tool()
    def loan_instalment(capital: float, annual_rate: float, years: float) -> ToolResult:
        """Monthly instalment of a loan or mortgage with the French amortisation schedule, total repaid and total interest.

        Args:
            capital: Amount borrowed in euro.
            annual_rate: Annual interest rate in percent (TAN).
            years: Duration in years.
        """
        months = round(years * 12)
        if capital <= 0 or months <= 0 or annual_rate < 0:
            return ToolResult.error("capital, rate and duration must be positive")
        rata = instalment(capital, annual_rate, months)
        total = round(rata, 2) * months
        return ToolResult(f"Rata mensile {eur(rata)} per {months} mesi: totale {eur(total)}, interessi {eur(total - capital)}.")

    @registry.tool()
    def fiscal_calendar(days: int = 45) -> ToolResult:
        """Ordinary Italian fiscal deadlines (F24 on the 16th, VAT, income taxes, IMU, returns) in the next days, moved to the next working day.

        Args:
            days: How many days ahead to look.
        """
        rows = fiscal_deadlines(date.today(), max(1, min(366, days)))
        if not rows:
            return ToolResult(f"Nessuna scadenza fiscale ordinaria nei prossimi {days} giorni.")
        return ToolResult("; ".join(f"{fmt(d)}: {t}" for d, t in rows) + ". Verificare eventuali proroghe sul sito dell'Agenzia delle Entrate.")

    @registry.tool()
    def decode_tax_code(tax_code: str) -> ToolResult:
        """Birth date, sex, age and birthplace code read from an Italian codice fiscale (also omocodic ones).

        Args:
            tax_code: The 16-character codice fiscale.
        """
        cf = tax_code.upper().replace(" ", "")
        if len(cf) != 16 or not cf[:6].isalpha():
            return ToolResult.error("not a 16-character codice fiscale")
        try:
            info = decode_cf(cf)
        except (ValueError, IndexError):
            return ToolResult.error("codice fiscale non decodificabile")
        return ToolResult(f"{'Donna' if info['sex'] == 'F' else 'Uomo'}, nato il {fmt(info['born'])} ({info['age']} anni), codice catastale del luogo di nascita {info['place_code']}.")
