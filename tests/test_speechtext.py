"""What the voice reads: clean, natural Italian and English, without markdown, citations or links."""

from __future__ import annotations

from jarvis.voice.speechtext import speech_text
from jarvis.voice.tts import clean_for_speech


def test_italian_money_percent_citations_abbreviations():
    out = speech_text("La fattura è di 1.903,20 € con IVA al 22% [1]. Vedi art. 7, p. 2 (fonte: Rossi.pdf, p. 2).", "it")
    assert out == "La fattura è di 1903 euro e 20 centesimi con iva al 22 per cento. Vedi articolo 7, pagina 2."


def test_italian_dates_times_companies():
    out = speech_text("Scade il 16/12/2026 alle 09:30; la Bianchi S.r.l. paga € 1.250.000 entro il 16/06.", "it")
    assert "16 dicembre 2026" in out and "9 e 30" in out and "esse erre elle" in out and "1250000 euro" in out and "16 giugno" in out


def test_markdown_lists_and_links():
    assert speech_text("**Ecco** i punti:\n- primo\n- secondo https://example.com", "it") == "Ecco i punti: primo, secondo il link"


def test_english():
    assert speech_text("Good evening, Sir. It is 18:00 and the bill is €1,250 (source: x).", "en") == "Good evening, Sir. It is 18 o'clock and the bill is 1,250 euros."


def test_clean_for_speech_guesses_language():
    assert clean_for_speech("Buongiorno Signore, la spesa è 50 €.") == "Buongiorno Signore, la spesa è 50 euro."
