// Strumenti da studio professionale: calcoli deterministici, verificabili, senza rete.
// Ogni funzione restituisce testo pronto da mostrare; il modello linguistico può solo riformularlo.

const eur = (n) => n.toLocaleString("it-IT", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €";
// Numeri all'italiana: "1.000" = mille, "1.250,50" = milleduecentocinquanta e 50, "1250.5" = decimale all'inglese.
export const num = (s) => { if (s == null) return NaN; let t = String(s).replace(/[€\s]/g, "").replace(/[.,]$/, ""); if (t.includes(",")) t = t.replace(/\./g, "").replace(",", "."); else if (/^\d{1,3}(\.\d{3})+$/.test(t)) t = t.replace(/\./g, ""); return parseFloat(t); };
const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;

// ------------------------------------------------------------------ IVA
export function iva(amount, rate, mode) {
  const r = rate / 100;
  if (mode === "scorpora") { const imponibile = round2(amount / (1 + r)); return { imponibile, iva: round2(amount - imponibile), totale: amount, text: `Da ${eur(amount)} IVA inclusa al ${rate}%: imponibile ${eur(imponibile)}, IVA ${eur(round2(amount - imponibile))}.` }; }
  const imposta = round2(amount * r); return { imponibile: amount, iva: imposta, totale: round2(amount + imposta), text: `${eur(amount)} più IVA al ${rate}%: IVA ${eur(imposta)}, totale ${eur(round2(amount + imposta))}.` };
}

// ------------------------------------------------------------------ fattura del professionista
/** Regime ordinario: cassa previdenziale sul compenso, IVA su compenso+cassa, ritenuta d'acconto sul compenso.
 *  Regime forfettario: niente IVA né ritenuta; marca da bollo di 2 € sopra 77,47 € (a carico del cliente se addebitata). */
export function parcella(compenso, { cassa = 4, ivaRate = 22, ritenuta = 20, forfettario = false } = {}) {
  const contributo = round2(compenso * cassa / 100);
  if (forfettario) {
    const imponibile = round2(compenso + contributo), bollo = imponibile > 77.47 ? 2 : 0, totale = round2(imponibile + bollo);
    return { contributo, iva: 0, ritenuta: 0, bollo, totale, netto: totale, text: `Fattura in regime forfettario su ${eur(compenso)}: rivalsa/cassa ${cassa}% ${eur(contributo)}, nessuna IVA né ritenuta${bollo ? ", marca da bollo 2,00 €" : ""}. Totale ${eur(totale)}.` };
  }
  const imponibileIva = round2(compenso + contributo), imposta = round2(imponibileIva * ivaRate / 100), totale = round2(imponibileIva + imposta), rit = round2(compenso * ritenuta / 100), netto = round2(totale - rit);
  return { contributo, iva: imposta, ritenuta: rit, bollo: 0, totale, netto, text: `Fattura su compenso di ${eur(compenso)}: cassa ${cassa}% ${eur(contributo)}, IVA ${ivaRate}% ${eur(imposta)}, totale fattura ${eur(totale)}. Ritenuta d'acconto ${ritenuta}% ${eur(rit)}: netto da incassare ${eur(netto)}.` };
}

// ------------------------------------------------------------------ calendario e scadenze
function easter(y) { const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451), month = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1; return new Date(y, month - 1, day); }
export function holidayName(d) {
  const y = d.getFullYear(), md = `${d.getMonth() + 1}-${d.getDate()}`;
  const fixed = { "1-1": "Capodanno", "1-6": "Epifania", "4-25": "Festa della Liberazione", "5-1": "Festa del Lavoro", "6-2": "Festa della Repubblica", "8-15": "Ferragosto", "11-1": "Ognissanti", "12-8": "Immacolata", "12-25": "Natale", "12-26": "Santo Stefano" };
  if (y >= 2026) fixed["10-4"] = "San Francesco d'Assisi";
  if (fixed[md]) return fixed[md];
  const e = easter(y), em = new Date(e); em.setDate(e.getDate() + 1);
  if (d.toDateString() === e.toDateString()) return "Pasqua"; if (d.toDateString() === em.toDateString()) return "Lunedì dell'Angelo";
  return null;
}
const DAYS = ["domenica", "lunedì", "martedì", "mercoledì", "giovedì", "venerdì", "sabato"], MONTHS = ["gennaio", "febbraio", "marzo", "aprile", "maggio", "giugno", "luglio", "agosto", "settembre", "ottobre", "novembre", "dicembre"];
export const fmtLong = (d) => `${DAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
export function parseDate(s, today = new Date()) {
  if (!s) return null; s = s.trim().toLowerCase();
  if (/^oggi$/.test(s)) return new Date(today.getFullYear(), today.getMonth(), today.getDate());
  let m = /^(\d{1,2})[\/.\-](\d{1,2})(?:[\/.\-](\d{2,4}))?$/.exec(s);
  if (m) { let y = m[3] ? parseInt(m[3], 10) : today.getFullYear(); if (y < 100) y += 2000; const d = new Date(y, parseInt(m[2], 10) - 1, parseInt(m[1], 10)); return d.getDate() === parseInt(m[1], 10) ? d : null; }
  m = /^(\d{1,2})\s+([a-zà]+)(?:\s+(\d{4}))?$/.exec(s);
  if (m) { const mi = MONTHS.findIndex((x) => x.startsWith(m[2].slice(0, 3))); if (mi < 0) return null; return new Date(m[3] ? parseInt(m[3], 10) : today.getFullYear(), mi, parseInt(m[1], 10)); }
  m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s); if (m) return new Date(+m[1], +m[2] - 1, +m[3]);
  return null;
}
const isWorking = (d) => d.getDay() !== 0 && d.getDay() !== 6 && !holidayName(d);
export function addDays(from, n, { working = false } = {}) {
  const d = new Date(from); if (!working) { d.setDate(d.getDate() + n); } else { let left = n; while (left > 0) { d.setDate(d.getDate() + 1); if (isWorking(d)) left--; } }
  let text = `${n} giorni${working ? " lavorativi" : ""} dal ${fmtLong(from)}: ${fmtLong(d)}.`;
  if (!working && !isWorking(d)) { const next = new Date(d); while (!isWorking(next)) next.setDate(next.getDate() + 1); const why = holidayName(d) || (d.getDay() === 0 ? "domenica" : "sabato"); text += ` Cade di ${why}: il primo giorno lavorativo successivo è ${fmtLong(next)}.`; }
  const aug = new Date(from.getFullYear(), 7, 1); if ((from <= aug && d >= aug) || from.getMonth() === 7 || d.getMonth() === 7) text += " Se è un termine processuale, verifichi la sospensione feriale (1–31 agosto).";
  return { date: d, text };
}
export function daysBetween(a, b) {
  const ms = Date.UTC(b.getFullYear(), b.getMonth(), b.getDate()) - Date.UTC(a.getFullYear(), a.getMonth(), a.getDate()); const n = Math.round(ms / 86400000);
  let w = 0; const step = n >= 0 ? 1 : -1; const d = new Date(a); for (let i = 0; i !== n; i += step) { d.setDate(d.getDate() + step); if (isWorking(d)) w++; }
  return { days: n, working: w, text: `Dal ${fmtLong(a)} al ${fmtLong(b)}: ${Math.abs(n)} giorni di calendario, ${w} lavorativi (esclusi sabati, domeniche e festività nazionali).` };
}

// ------------------------------------------------------------------ codice fiscale, partita IVA, IBAN
const CF_ODD = { 0: 1, 1: 0, 2: 5, 3: 7, 4: 9, 5: 13, 6: 15, 7: 17, 8: 19, 9: 21, A: 1, B: 0, C: 5, D: 7, E: 9, F: 13, G: 15, H: 17, I: 19, J: 21, K: 2, L: 4, M: 18, N: 20, O: 11, P: 3, Q: 6, R: 8, S: 12, T: 14, U: 16, V: 10, W: 22, X: 25, Y: 24, Z: 23 };
const cfEven = (c) => (/\d/.test(c) ? +c : c.charCodeAt(0) - 65);
export function checkCF(raw) {
  const cf = raw.toUpperCase().replace(/\s/g, "");
  if (!/^[A-Z]{6}[0-9LMNPQRSTUV]{2}[A-Z][0-9LMNPQRSTUV]{2}[A-Z][0-9LMNPQRSTUV]{3}[A-Z]$/.test(cf)) return { ok: false, text: `${cf} non ha il formato di un codice fiscale (16 caratteri: 6 lettere, 2 cifre, 1 lettera, 2 cifre, 1 lettera, 3 cifre, 1 lettera).` };
  let sum = 0; for (let i = 0; i < 15; i++) sum += i % 2 === 0 ? CF_ODD[cf[i]] : cfEven(cf[i]);
  const expected = String.fromCharCode(65 + (sum % 26)); const ok = expected === cf[15];
  const months = "ABCDEHLMPRST", omocodia = { L: 0, M: 1, N: 2, P: 3, Q: 4, R: 5, S: 6, T: 7, U: 8, V: 9 }, digit = (c) => (/\d/.test(c) ? c : String(omocodia[c]));
  const yy = digit(cf[6]) + digit(cf[7]), mm = months.indexOf(cf[8]) + 1; let dd = parseInt(digit(cf[9]) + digit(cf[10]), 10); const sex = dd > 40 ? "F" : "M"; if (dd > 40) dd -= 40;
  const detail = mm > 0 ? ` Nato/a il ${dd}/${mm}/${yy}, sesso ${sex}, comune catastale ${cf[11]}${digit(cf[12])}${digit(cf[13])}${digit(cf[14])}.` : "";
  return { ok, text: ok ? `Il codice fiscale ${cf} è formalmente valido.${detail}` : `Il codice fiscale ${cf} NON è valido: il carattere di controllo dovrebbe essere ${expected}, non ${cf[15]}.` };
}
export function checkPIVA(raw) {
  const p = raw.replace(/\D/g, ""); if (p.length !== 11) return { ok: false, text: `Una partita IVA ha 11 cifre; "${raw}" ne ha ${p.length}.` };
  let s = 0; for (let i = 0; i < 10; i++) { let d = +p[i]; if (i % 2 === 1) { d *= 2; if (d > 9) d -= 9; } s += d; }
  const c = (10 - (s % 10)) % 10, ok = c === +p[10];
  return { ok, text: ok ? `La partita IVA ${p} è formalmente valida (codice ufficio ${p.slice(7, 10)}). Per sapere se è attiva serve la verifica sul sito dell'Agenzia delle Entrate o VIES.` : `La partita IVA ${p} NON è valida: la cifra di controllo dovrebbe essere ${c}.` };
}
export function checkIBAN(raw) {
  const iban = raw.toUpperCase().replace(/\s/g, ""); if (!/^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(iban)) return { ok: false, text: `"${raw}" non ha il formato di un IBAN.` };
  if (iban.startsWith("IT") && iban.length !== 27) return { ok: false, text: `Un IBAN italiano ha 27 caratteri; questo ne ha ${iban.length}.` };
  const moved = (iban.slice(4) + iban.slice(0, 4)).replace(/[A-Z]/g, (ch) => String(ch.charCodeAt(0) - 55));
  let rem = 0; for (const ch of moved) rem = (rem * 10 + +ch) % 97; const ok = rem === 1;
  const it = iban.startsWith("IT") ? ` ABI ${iban.slice(5, 10)}, CAB ${iban.slice(10, 15)}, conto ${iban.slice(15)}.` : "";
  return { ok, text: ok ? `L'IBAN ${iban.replace(/(.{4})/g, "$1 ").trim()} è formalmente valido.${it}` : `L'IBAN ${iban} NON è valido: il controllo modulo 97 non torna. Probabile errore di battitura.` };
}

// ------------------------------------------------------------------ riconoscimento delle richieste
/** Restituisce {tool, result} se la frase chiede uno strumento da studio, altrimenti null. */
export function routeStudio(text, today = new Date()) {
  const t = text.toLowerCase().replace(/[?!]+$/, "").trim();
  const amount = (re) => { const m = re.exec(t); return m ? num(m[1]) : NaN; };
  const rateOf = () => { const m = /(\d{1,2})\s*(%|per\s*cento)/.exec(t.replace(/(\d)\s*€/, "$1")); const r = m ? +m[1] : 22; return [4, 5, 10, 22].includes(r) ? r : 22; };

  if (/\b(cf|codice fiscale)\b/.test(t)) { const m = /\b([a-z]{6}[0-9lmnpqrstuv]{2}[a-z][0-9lmnpqrstuv]{2}[a-z][0-9lmnpqrstuv]{3}[a-z])\b/i.exec(text); if (m) return { tool: "codice fiscale", result: checkCF(m[1]).text }; }
  if (/\b(p\.?\s?iva|partita iva)\b/.test(t) && /\d{11}/.test(t.replace(/\s/g, ""))) { const m = /(\d[\d\s]{10,14})/.exec(t); if (m) return { tool: "partita IVA", result: checkPIVA(m[1]).text }; }
  if (/\biban\b/.test(t)) { const m = /\b([a-z]{2}\d{2}[a-z0-9 ]{10,40})/i.exec(text.replace(/iban/i, "")); if (m) return { tool: "IBAN", result: checkIBAN(m[1]).text }; }

  if (/\b(parcella|fattura|compenso|ritenuta)\b/.test(t) && /\d/.test(t)) {
    const c = amount(/(?:compenso|parcella|fattura|onorario)\D{0,20}?(\d[\d.,]*)/) || amount(/(\d[\d.,]*)\s*(?:€|euro)/);
    if (Number.isFinite(c) && c > 0) {
      const cassaM = /(cassa|cpa|inarcassa|rivalsa)\D{0,12}(\d{1,2})\s*%/.exec(t), noCassa = /senza cassa|no cassa/.test(t);
      return { tool: "parcella", result: parcella(c, { cassa: noCassa ? 0 : cassaM ? +cassaM[2] : 4, forfettario: /forfettari/.test(t), ritenuta: /senza ritenuta|no ritenuta/.test(t) ? 0 : 20 }).text };
    }
  }
  if (/\b(iva)\b/.test(t) && /\d/.test(t)) {
    const a = amount(/(\d[\d.,]*)\s*(?:€|euro)?\s*(?:iva|lordo|ivato|ivati|più|\+|compresa|inclusa|da)/) || amount(/(?:da|su|di)\s*(\d[\d.,]*)/) || amount(/(\d[\d.,]{2,})/);
    if (Number.isFinite(a) && a > 0) { const mode = /scorpor|inclusa|compresa|ivato|lordo|dentro/.test(t) ? "scorpora" : "aggiungi"; return { tool: "IVA", result: iva(a, rateOf(), mode).text }; }
  }

  const dateRe = "(\\d{1,2}[\\/.\\-]\\d{1,2}(?:[\\/.\\-]\\d{2,4})?|\\d{1,2}\\s+[a-zà]+(?:\\s+\\d{4})?|oggi)";
  let m = new RegExp(`(?:giorni|quanti giorni)\\D*?(?:tra|fra|dal|da)\\s+(?:il\\s+)?${dateRe}\\s+(?:e|al|a)\\s+(?:il\\s+)?${dateRe}`).exec(t);
  if (m) { const a = parseDate(m[1], today), b = parseDate(m[2], today); if (a && b) return { tool: "calendario", result: daysBetween(a, b).text }; }
  m = new RegExp(`(\\d{1,4})\\s+giorni\\s*(lavorativi)?\\s*(?:dal|da|dopo il|a partire dal)\\s+(?:il\\s+)?${dateRe}`).exec(t);
  if (m) { const from = parseDate(m[3], today); if (from) return { tool: "scadenza", result: addDays(from, +m[1], { working: !!m[2] }).text }; }
  m = /(?:tra|fra|entro|scadenza a|scade tra)\s+(\d{1,4})\s+giorni\s*(lavorativi)?/.exec(t);
  if (m && /(scad|termin|che giorno|quando|data|cade)/.test(t)) { const from = new Date(today.getFullYear(), today.getMonth(), today.getDate()); return { tool: "scadenza", result: addDays(from, +m[1], { working: !!m[2] }).text }; }
  return null;
}
