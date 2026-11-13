// Calcoli da studio, seconda serie: numeri in lettere, interessi legali, mutui, codice fiscale, scadenzario fiscale,
// forfettario, prestazioni occasionali, compensi, margini, sconti, ore lavorate, età, split payment.
// Funzioni pure e deterministiche: niente rete, niente modello. Ognuna restituisce { text, ... } pronto da mostrare.
import { num, holidayName, checkCF, fmtLong, parseDate } from "./studio.js";

const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
export const eur = (n) => n.toLocaleString("it-IT", { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: "always" }) + " €";
const pct = (n) => (Math.round(n * 100) / 100).toLocaleString("it-IT") + "%";
const DAY = 864e5;
const startOf = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const daysDiff = (a, b) => Math.round((startOf(b) - startOf(a)) / DAY);

// ------------------------------------------------------------------ numeri in lettere (assegni, contratti)
const UNITS = ["zero", "uno", "due", "tre", "quattro", "cinque", "sei", "sette", "otto", "nove", "dieci", "undici", "dodici", "tredici", "quattordici", "quindici", "sedici", "diciassette", "diciotto", "diciannove"];
const TENS = ["", "", "venti", "trenta", "quaranta", "cinquanta", "sessanta", "settanta", "ottanta", "novanta"];
function under1000(n) {
  const h = Math.floor(n / 100), r = n % 100; let out = h ? (h === 1 ? "cento" : UNITS[h] + "cento") : "";
  if (r < 20) { if (r) out += UNITS[r]; return out; }
  const t = Math.floor(r / 10), u = r % 10; let tens = TENS[t];
  if (u === 1 || u === 8) tens = tens.slice(0, -1); // ventuno, ventotto
  return out + tens + (u ? UNITS[u] : "");
}
/** Intero in lettere, come si scrive sugli assegni: 1250 → "milleduecentocinquanta". */
export function inLettere(n) {
  n = Math.floor(Math.abs(Number(n))); if (!Number.isFinite(n)) return "";
  if (n === 0) return "zero";
  const parts = [[1e9, "unmiliardo", "miliardi"], [1e6, "unmilione", "milioni"], [1e3, "mille", "mila"]];
  let out = "";
  for (const [size, one, many] of parts) { const q = Math.floor(n / size); if (q) { out += q === 1 ? one : under1000(q) + many; n %= size; } }
  out += n ? under1000(n) : "";
  return out.length > 3 && out.endsWith("tre") ? out.slice(0, -3) + "tré" : out;
}
/** Importo per assegni e contratti: "1.250,50" → milleduecentocinquanta/50 e in parole con i centesimi. */
export function numeroInLettere(value) {
  const n = typeof value === "number" ? value : num(value); if (!Number.isFinite(n) || n < 0 || n >= 1e12) return { text: "Mi serve un importo valido (fino a 999 miliardi)." };
  const int = Math.floor(round2(n)), cents = Math.round((round2(n) - int) * 100);
  const cheque = `${inLettere(int)}/${String(cents).padStart(2, "0")}`;
  const words = `${inLettere(int)} euro${cents ? ` e ${inLettere(cents)} centesimi` : ""}`;
  return { cheque, words, text: `${eur(n)} in lettere: ${cheque} (${words}).` };
}

// ------------------------------------------------------------------ interessi
/** Saggio degli interessi legali (art. 1284 c.c.), per anno, fissato ogni dicembre con decreto MEF. */
export const TASSI_LEGALI = { 2010: 1, 2011: 1.5, 2012: 2.5, 2013: 2.5, 2014: 1, 2015: 0.5, 2016: 0.2, 2017: 0.1, 2018: 0.3, 2019: 0.8, 2020: 0.05, 2021: 0.01, 2022: 1.25, 2023: 5, 2024: 2.5, 2025: 2, 2026: 1.6 };
/** Interessi semplici su un capitale dal giorno `dal` (escluso) al giorno `al` (incluso). Con `tasso` fisso, oppure
 *  al tasso legale anno per anno. Anno civile di 365 giorni, interessi non capitalizzati. */
export function interessi(capitale, dal, al, tasso = null) {
  if (!(capitale > 0) || !dal || !al || al <= dal) return { text: "Servono un capitale e due date in ordine (dal… al…)." };
  let tot = 0, cur = startOf(dal); const rows = []; const missing = new Set();
  const end = startOf(al);
  while (cur < end) {
    const y = cur.getFullYear(), yearEnd = new Date(y + 1, 0, 1), stop = yearEnd < end ? yearEnd : end;
    const days = daysDiff(cur, stop), rate = tasso != null ? tasso : TASSI_LEGALI[y];
    if (rate == null) { missing.add(y); cur = stop; continue; }
    const amount = capitale * rate / 100 * days / 365; tot += amount; rows.push({ year: y, days, rate, amount: round2(amount) }); cur = stop;
  }
  if (missing.size) return { text: `Non ho il tasso legale per ${[...missing].join(", ")}: me lo indichi ("al 2%").` };
  tot = round2(tot);
  const detail = rows.map((r) => `${r.year}: ${r.days} giorni al ${pct(r.rate)} = ${eur(r.amount)}`).join("; ");
  return { total: tot, rows, text: `Interessi ${tasso != null ? "al " + pct(tasso) : "legali"} su ${eur(capitale)} dal ${fmtLong(dal)} al ${fmtLong(al)}: ${eur(tot)} (${detail}). Totale con il capitale: ${eur(round2(capitale + tot))}.${tasso == null ? " Tassi legali annuali dell'art. 1284 c.c.: verifichi l'ultimo decreto del MEF per l'anno in corso." : ""}` };
}

/** Rata costante (ammortamento alla francese). */
export function ammortamento(capitale, tassoAnnuo, mesi) {
  if (!(capitale > 0) || !(mesi > 0) || tassoAnnuo < 0) return { text: "Servono importo, tasso annuo e durata." };
  const i = tassoAnnuo / 100 / 12, rata = i ? capitale * i / (1 - (1 + i) ** -mesi) : capitale / mesi;
  let debito = capitale; const rows = [];
  for (let k = 1; k <= mesi; k++) { const int = debito * i, cap = rata - int; debito -= cap; rows.push({ n: k, rata: round2(rata), interessi: round2(int), capitale: round2(cap), residuo: round2(Math.max(0, debito)) }); }
  const totale = round2(rata * mesi), totInt = round2(totale - capitale);
  const anni = mesi % 12 === 0 ? `${mesi / 12} anni` : `${mesi} mesi`;
  return { rata: round2(rata), totale, interessi: totInt, rows, text: `Finanziamento di ${eur(capitale)} al ${pct(tassoAnnuo)} annuo per ${anni}: rata mensile ${eur(round2(rata))}, totale restituito ${eur(totale)}, di cui interessi ${eur(totInt)}. Prima rata: ${eur(rows[0].interessi)} di interessi e ${eur(rows[0].capitale)} di capitale.` };
}

// ------------------------------------------------------------------ codice fiscale
const MONTH_CF = "ABCDEHLMPRST", OMO = "LMNPQRSTUV";
/** Data di nascita, sesso e codice del comune ricavati dal codice fiscale (anche omocodico). */
export function decodificaCF(raw, today = new Date()) {
  const cf = String(raw || "").toUpperCase().replace(/\s/g, "");
  const check = checkCF(cf); if (!check.ok) return { ok: false, text: check.text };
  const fix = (s) => s.replace(/[LMNPQRSTUV]/g, (c) => String(OMO.indexOf(c)));
  const yy = +fix(cf.slice(6, 8)), month = MONTH_CF.indexOf(cf[8]), dd = +fix(cf.slice(9, 11)), comune = cf[11] + fix(cf.slice(12, 15));
  const female = dd > 40, day = female ? dd - 40 : dd;
  const century = yy > today.getFullYear() % 100 ? 1900 : 2000, born = new Date(century + yy, month, day);
  const age = today.getFullYear() - born.getFullYear() - (today < new Date(today.getFullYear(), born.getMonth(), born.getDate()) ? 1 : 0);
  return { ok: true, sex: female ? "F" : "M", born, comune, age, text: `Codice fiscale valido: ${female ? "donna" : "uomo"}, nato${female ? "a" : ""} il ${fmtLong(born)} (${age} anni), codice catastale del luogo di nascita ${comune}${comune[0] === "Z" ? " (Stato estero)" : ""}. Il secolo di nascita è dedotto: il codice fiscale riporta solo le ultime due cifre dell'anno.` };
}

// ------------------------------------------------------------------ scadenzario fiscale
const SCADENZE = [
  [3, 16, "Saldo IVA dell'anno precedente (o prima rata) e invio della Certificazione Unica"],
  [4, 30, "Dichiarazione IVA annuale"],
  [5, 16, "IVA del primo trimestre (contribuenti trimestrali)"],
  [6, 16, "IMU: acconto"],
  [6, 30, "Saldo e primo acconto di imposte sui redditi, IRAP e contributi INPS"],
  [8, 20, "IVA del secondo trimestre e versamenti sospesi per agosto"],
  [9, 30, "Presentazione del modello 730"],
  [10, 31, "Dichiarazione dei redditi (modello Redditi e IRAP) e modello 770"],
  [11, 16, "IVA del terzo trimestre (contribuenti trimestrali)"],
  [11, 30, "Secondo acconto di imposte sui redditi, IRAP e contributi INPS"],
  [12, 16, "IMU: saldo"],
  [12, 27, "Acconto IVA"],
];
const working = (d) => d.getDay() !== 0 && d.getDay() !== 6 && !holidayName(d);
/** Se una scadenza cade di sabato, domenica o festivo, slitta al primo giorno lavorativo successivo. */
export function nextWorking(d) { const x = new Date(d); while (!working(x)) x.setDate(x.getDate() + 1); return x; }
/** Scadenze fiscali ordinarie tra `from` e `from + days`: F24 del 16 di ogni mese più le scadenze annuali. */
export function scadenzeFiscali(from = new Date(), days = 30) {
  const start = startOf(from), end = new Date(start.getTime() + days * DAY), out = [];
  for (let y = start.getFullYear(); y <= end.getFullYear(); y++) {
    for (let m = 1; m <= 12; m++) {
      const d16 = new Date(y, m - 1, m === 8 ? 20 : 16);
      out.push({ nominal: d16, title: "F24: ritenute, contributi dei dipendenti e IVA mensile" + (m === 8 ? " (prorogati al 20 agosto)" : "") });
    }
    for (const [m, d, title] of SCADENZE) out.push({ nominal: new Date(y, m - 1, d), title });
  }
  const list = out.map((x) => ({ ...x, date: nextWorking(x.nominal) })).filter((x) => x.date >= start && x.date <= end).sort((a, b) => a.date - b.date);
  // stesse date: un'unica riga
  const merged = []; for (const x of list) { const last = merged[merged.length - 1]; if (last && +last.date === +x.date) last.title += "; " + x.title; else merged.push({ ...x }); }
  const text = merged.length ? `Scadenze fiscali dei prossimi ${days} giorni: ` + merged.map((x) => `${fmtLong(x.date)}: ${x.title}${+x.date !== +x.nominal ? " (slitta dal " + x.nominal.getDate() + ")" : ""}`).join(". ") + ". Sono le scadenze ordinarie: verifichi sempre eventuali proroghe sul sito dell'Agenzia delle Entrate." : `Nessuna scadenza fiscale ordinaria nei prossimi ${days} giorni.`;
  return { list: merged, text };
}

// ------------------------------------------------------------------ professionisti e piccole imprese
/** Regime forfettario: reddito = ricavi × coefficiente di redditività − contributi versati; imposta sostitutiva 15% (5% nei primi 5 anni). */
export function forfettario(ricavi, { coefficiente = 78, aliquota = 15, contributi = 0 } = {}) {
  if (!(ricavi > 0)) return { text: "Mi servono i ricavi o compensi dell'anno." };
  const lordo = round2(ricavi * coefficiente / 100), imponibile = round2(Math.max(0, lordo - contributi)), imposta = round2(imponibile * aliquota / 100);
  return { lordo, imponibile, imposta, text: `Forfettario su ${eur(ricavi)} di ricavi, coefficiente ${coefficiente}%: reddito ${eur(lordo)}${contributi ? `, meno ${eur(contributi)} di contributi versati = ${eur(imponibile)}` : ""}; imposta sostitutiva al ${aliquota}%: ${eur(imposta)}.${ricavi > 85000 ? " Attenzione: oltre 85.000 € di ricavi si esce dal forfettario (dall'anno dopo; subito oltre 100.000 €)." : ""} Il coefficiente dipende dal codice ATECO (78% per molte attività professionali).` };
}
/** Prestazione occasionale: ritenuta d'acconto del 20% se il committente è sostituto d'imposta, bollo da 2 € oltre 77,47 €. */
export function prestazioneOccasionale(lordo, { ritenuta = true } = {}) {
  if (!(lordo > 0)) return { text: "Mi serve il compenso lordo." };
  const rit = ritenuta ? round2(lordo * 0.2) : 0, bollo = lordo > 77.47 ? 2 : 0, netto = round2(lordo - rit);
  return { ritenuta: rit, netto, bollo, text: `Prestazione occasionale di ${eur(lordo)} lordi: ritenuta d'acconto 20% ${eur(rit)}, netto a pagare ${eur(netto)}${bollo ? "; sulla ricevuta va la marca da bollo da 2 €" : ""}. Oltre 5.000 € di compensi occasionali nell'anno scatta l'iscrizione alla Gestione separata INPS.` };
}
/** Compenso da fatturare per incassare un netto voluto (regime ordinario: cassa, IVA, ritenuta). */
export function compensoDaNetto(netto, { cassa = 4, iva = 22, ritenuta = 20 } = {}) {
  if (!(netto > 0)) return { text: "Mi serve il netto che vuole incassare." };
  const factor = (1 + cassa / 100) * (1 + iva / 100) - ritenuta / 100, compenso = round2(netto / factor);
  const contributo = round2(compenso * cassa / 100), imposta = round2((compenso + contributo) * iva / 100), totale = round2(compenso + contributo + imposta), rit = round2(compenso * ritenuta / 100);
  return { compenso, text: `Per incassare ${eur(netto)} netti serve un compenso di ${eur(compenso)}: cassa ${cassa}% ${eur(contributo)}, IVA ${iva}% ${eur(imposta)}, totale fattura ${eur(totale)}, ritenuta ${ritenuta}% ${eur(rit)}, netto ${eur(round2(totale - rit))}.` };
}
/** Split payment (fatture alla PA e società controllate): l'IVA la versa il cliente, il fornitore incassa l'imponibile. */
export function splitPayment(imponibile, iva = 22) {
  if (!(imponibile > 0)) return { text: "Mi serve l'imponibile." };
  const imposta = round2(imponibile * iva / 100);
  return { iva: imposta, text: `Split payment su ${eur(imponibile)}: IVA ${iva}% ${eur(imposta)} indicata in fattura ma versata direttamente dall'ente; lei incassa ${eur(imponibile)}. In fattura va l'annotazione "scissione dei pagamenti, art. 17-ter DPR 633/72".` };
}

// ------------------------------------------------------------------ commercio
export function margine(costo, prezzo) {
  if (!(costo > 0) || !(prezzo > 0)) return { text: "Servono costo e prezzo di vendita." };
  const m = (prezzo - costo) / prezzo * 100, r = (prezzo - costo) / costo * 100;
  return { margine: round2(m), ricarico: round2(r), text: `Costo ${eur(costo)}, prezzo ${eur(prezzo)}: guadagno ${eur(round2(prezzo - costo))}, margine sul prezzo ${pct(m)}, ricarico sul costo ${pct(r)}.` };
}
export function prezzoDaRicarico(costo, ricarico) { const p = round2(costo * (1 + ricarico / 100)); return { prezzo: p, text: `Con un ricarico del ${pct(ricarico)} su ${eur(costo)} il prezzo è ${eur(p)} (margine sul prezzo ${pct((p - costo) / p * 100)}).` }; }
export function prezzoDaMargine(costo, m) { if (m >= 100) return { text: "Il margine deve essere sotto il 100%." }; const p = round2(costo / (1 - m / 100)); return { prezzo: p, text: `Per un margine del ${pct(m)} su un costo di ${eur(costo)} il prezzo è ${eur(p)} (ricarico ${pct((p - costo) / costo * 100)}).` }; }
/** Sconti anche in cascata: sconto(100, [20, 10]) = 72. */
export function sconto(prezzo, sconti) {
  const list = [].concat(sconti).map(Number).filter((x) => x > 0 && x < 100); if (!(prezzo > 0) || !list.length) return { text: "Servono prezzo e sconto." };
  const fin = round2(list.reduce((p, s) => p * (1 - s / 100), prezzo)), eq = (1 - fin / prezzo) * 100;
  return { finale: fin, text: `${eur(prezzo)} con sconto ${list.join(" + ")}%: ${eur(fin)}, risparmio ${eur(round2(prezzo - fin))}${list.length > 1 ? ` (sconto equivalente ${pct(eq)})` : ""}.` };
}
export function variazione(da, a) { if (!da) return { text: "Il valore iniziale non può essere zero." }; const v = (a - da) / Math.abs(da) * 100; return { pct: round2(v), text: `Da ${da.toLocaleString("it-IT")} a ${a.toLocaleString("it-IT")}: ${v >= 0 ? "aumento" : "diminuzione"} del ${pct(Math.abs(v))}.` }; }

// ------------------------------------------------------------------ tempo
/** Ore lavorate da intervalli "9-13, 14:30-18:15"; con una tariffa oraria dà anche l'importo. */
export function oreLavorate(spec, tariffa = 0) {
  const re = /(\d{1,2})(?:[:.](\d{2}))?\s*(?:-|–|alle|a)\s*(\d{1,2})(?:[:.](\d{2}))?/g; let m, mins = 0, n = 0;
  while ((m = re.exec(spec))) { let a = +m[1] * 60 + +(m[2] || 0), b = +m[3] * 60 + +(m[4] || 0); if (b <= a) b += 24 * 60; mins += b - a; n++; }
  if (!n) return { text: 'Mi indichi gli orari, per esempio "9-13 e 14:30-18".' };
  const h = Math.floor(mins / 60), mm = mins % 60, dec = round2(mins / 60);
  return { minutes: mins, text: `Totale: ${h} ore${mm ? " e " + mm + " minuti" : ""} (${dec.toLocaleString("it-IT")} ore)${tariffa ? `; a ${eur(tariffa)} l'ora fanno ${eur(round2(dec * tariffa))}` : ""}.` };
}
export function giornoDellaSettimana(d, today = new Date()) {
  const diff = daysDiff(today, d), when = diff === 0 ? "oggi" : diff > 0 ? `tra ${diff} giorni` : `${-diff} giorni fa`;
  const h = holidayName(d);
  return { text: `Il ${d.getDate()}/${d.getMonth() + 1}/${d.getFullYear()} è ${fmtLong(d).split(" ")[0]} (${when})${h ? ", festivo: " + h : d.getDay() % 6 === 0 ? ", non lavorativo" : ""}.` };
}
export function giorniMancanti(d, today = new Date()) {
  const diff = daysDiff(today, d); let wd = 0; const x = startOf(today);
  for (let i = 0; i < Math.abs(diff); i++) { x.setDate(x.getDate() + Math.sign(diff)); if (working(x)) wd++; }
  return { days: diff, text: diff === 0 ? `È oggi, ${fmtLong(d)}.` : diff > 0 ? `Mancano ${diff} giorni a ${fmtLong(d)} (${wd} lavorativi).` : `${fmtLong(d)} è passato da ${-diff} giorni.` };
}
export function eta(nascita, today = new Date()) {
  let y = today.getFullYear() - nascita.getFullYear(); const bd = new Date(today.getFullYear(), nascita.getMonth(), nascita.getDate());
  if (today < bd) y--; const next = today < bd ? bd : new Date(today.getFullYear() + 1, nascita.getMonth(), nascita.getDate());
  return { years: y, text: `Chi è nato il ${fmtLong(nascita)} ha ${y} anni; il prossimo compleanno è tra ${daysDiff(today, next)} giorni.` };
}

// ------------------------------------------------------------------ valute (il cambio arriva dalla BCE, via app)
export const CURRENCIES = { euro: "EUR", euri: "EUR", eur: "EUR", "€": "EUR", dollari: "USD", dollaro: "USD", usd: "USD", "$": "USD", sterline: "GBP", sterlina: "GBP", gbp: "GBP", franchi: "CHF", "franchi svizzeri": "CHF", chf: "CHF", yen: "JPY", jpy: "JPY", yuan: "CNY", renminbi: "CNY", cny: "CNY", rubli: "RUB", corone: "SEK", sek: "SEK", nok: "NOK", dkk: "DKK", zloty: "PLN", pln: "PLN", "dollari canadesi": "CAD", cad: "CAD", "dollari australiani": "AUD", aud: "AUD", rupie: "INR", inr: "INR", real: "BRL", brl: "BRL", lire: "TRY", "lire turche": "TRY", try: "TRY" };
/** "100 dollari in euro" → { amount: 100, from: "USD", to: "EUR" } o null. */
export function parseCambio(text) {
  const t = String(text).toLowerCase(); const keys = Object.keys(CURRENCIES).sort((a, b) => b.length - a.length).map((k) => k.replace(/[$€]/g, "\\$&")).join("|");
  const m = new RegExp(`(\\d[\\d.,]*)\\s*(${keys})\\s+(?:in|a|to|=)\\s+(${keys})\\b`).exec(t) || new RegExp(`(${keys})\\s*(\\d[\\d.,]*)\\s+(?:in|a|to)\\s+(${keys})`).exec(t);
  if (!m) return null;
  const [amountRaw, fromK, toK] = /^\d/.test(m[1]) ? [m[1], m[2], m[3]] : [m[2], m[1], m[3]];
  const amount = num(amountRaw), from = CURRENCIES[fromK], to = CURRENCIES[toK];
  return Number.isFinite(amount) && from && to && from !== to ? { amount, from, to } : null;
}

// ------------------------------------------------------------------ riconoscimento delle richieste
const amountRe = "(\\d[\\d.]*(?:,\\d+)?)";
/** Richieste in linguaggio naturale per i calcoli di questo modulo. Restituisce { tool, result } o null. */
export function routeCalc(text, today = new Date()) {
  const t = text.toLowerCase().replace(/[?!]+$/, "").trim(); let m;
  const A = (re) => { const x = re.exec(t); return x ? num(x[1]) : NaN; };
  if ((m = new RegExp(`(?:in lettere|scrivi(?:mi)? in lettere|per l'assegno)\\D*${amountRe}|${amountRe}\\s*(?:€|euro)?\\s*in lettere`).exec(t))) { const v = num(m[1] || m[2]); if (Number.isFinite(v)) return { tool: "in lettere", result: numeroInLettere(v).text }; }
  if (/\binteress/.test(t) && /\d/.test(t)) {
    const cap = A(new RegExp(`(?:su|di|capitale(?: di)?)\\s*${amountRe}`)) || A(new RegExp(`${amountRe}\\s*(?:€|euro)`));
    const dm = /(?:dal|da)\s+(?:il\s+)?([\d/.\-]+|\d{1,2}\s+[a-zà]+(?:\s+\d{4})?)\s+(?:al|a|fino al)\s+(?:il\s+)?([\d/.\-]+|\d{1,2}\s+[a-zà]+(?:\s+\d{4})?|oggi)/.exec(t);
    const rateM = /\bal\s+(\d+(?:[.,]\d+)?)\s*%/.exec(t);
    if (cap > 0 && dm) { const a = parseDate(dm[1], today), b = dm[2] === "oggi" ? startOf(today) : parseDate(dm[2], today); if (a && b) return { tool: "interessi", result: interessi(cap, a, b, rateM ? num(rateM[1]) : null).text }; }
  }
  if (/\b(mutuo|finanziamento|prestito|rata)\b/.test(t) && /%/.test(t)) {
    const cap = A(new RegExp(`(?:mutuo|finanziamento|prestito)\\D{0,12}${amountRe}`)) || A(new RegExp(`${amountRe}\\s*(?:€|euro)`)); const r = A(/(\d+(?:[.,]\d+)?)\s*%/);
    const y = /(\d{1,2})\s*anni/.exec(t), mo = /(\d{1,3})\s*mesi/.exec(t);
    if (cap > 0 && Number.isFinite(r) && (y || mo)) return { tool: "mutuo", result: ammortamento(cap, r, y ? +y[1] * 12 : +mo[1]).text };
  }
  if ((m = /\b([a-z]{6}[0-9lmnpqrstuv]{2}[a-z][0-9lmnpqrstuv]{2}[a-z][0-9lmnpqrstuv]{3}[a-z])\b/i.exec(text)) && /(decodific|nato|data di nascita|chi è|leggi|sesso|età|eta)/.test(t)) return { tool: "codice fiscale", result: decodificaCF(m[1], today).text };
  if (/scadenz\w* fiscal|scadenzario|prossime scadenze|scadenze (?:del|di) (?:mese|f24)|cosa (?:scade|devo pagare)/.test(t)) { const d = /(\d{1,3})\s*giorni/.exec(t); return { tool: "scadenzario", result: scadenzeFiscali(today, d ? +d[1] : /mese/.test(t) ? 31 : 45).text }; }
  if (/forfettari/.test(t) && /\d/.test(t) && !/fattura|parcella|compenso di/.test(t)) {
    const r = A(new RegExp(`(?:ricavi|compensi|fatturato|incassato)\\D{0,10}${amountRe}`)) || A(new RegExp(`${amountRe}\\s*(?:€|euro)`)); const c = /coefficiente\D{0,5}(\d{2})/.exec(t), al = /\b(5|15)\s*%/.exec(t), contr = A(new RegExp(`contributi\\D{0,10}${amountRe}`));
    if (r > 0) return { tool: "forfettario", result: forfettario(r, { coefficiente: c ? +c[1] : 78, aliquota: al ? +al[1] : /primi|startup|nuov/.test(t) ? 5 : 15, contributi: contr > 0 ? contr : 0 }).text };
  }
  if (/prestazione occasionale|ritenuta.*occasional|occasionale/.test(t) && /\d/.test(t)) { const l = A(new RegExp(`${amountRe}`)); if (l > 0) return { tool: "prestazione occasionale", result: prestazioneOccasionale(l, { ritenuta: !/senza ritenuta|privato/.test(t) }).text }; }
  if (/\bnett[oi]\b/.test(t) && /(incassare|prendere|ricevere|in tasca|fatturare per)/.test(t)) { const n = A(new RegExp(`${amountRe}\\s*(?:€|euro)?\\s*nett`)) || A(new RegExp(`nett[oi]\\D{0,12}${amountRe}`)); if (n > 0) return { tool: "compenso da netto", result: compensoDaNetto(n, { cassa: /senza cassa/.test(t) ? 0 : 4 }).text }; }
  if (/split payment|scissione dei pagamenti/.test(t)) { const v = A(new RegExp(`${amountRe}`)); if (v > 0) return { tool: "split payment", result: splitPayment(v).text }; }
  if (/\bmargine\b|\bricarico\b/.test(t) && /\d/.test(t)) {
    const costo = A(new RegExp(`cost[oa]\\D{0,10}${amountRe}`)), prezzo = A(new RegExp(`(?:prezzo|vendo|vendita|venduto)\\D{0,10}${amountRe}`)), p = A(/(\d+(?:[.,]\d+)?)\s*%/);
    if (costo > 0 && prezzo > 0) return { tool: "margine", result: margine(costo, prezzo).text };
    if (costo > 0 && p > 0) return { tool: "prezzo", result: /margine/.test(t) ? prezzoDaMargine(costo, p).text : prezzoDaRicarico(costo, p).text };
  }
  if (/\bscont/.test(t) && /%/.test(t)) {
    const sc = [...t.matchAll(/(\d+(?:[.,]\d+)?)\s*(?:%|\+)/g)].map((x) => num(x[1])).filter((x) => x > 0 && x < 100);
    const pr = A(new RegExp(`(?:su|di|da|prezzo)\\s*${amountRe}\\s*(?:€|euro)?(?!\\s*%)`)) || A(new RegExp(`${amountRe}\\s*(?:€|euro)`));
    if (pr > 0 && sc.length) return { tool: "sconto", result: sconto(pr, sc).text };
  }
  if ((m = new RegExp(`(?:variazione|aumento|differenza|diminuzione)\\s+(?:percentuale\\s+)?(?:da|tra)\\s+${amountRe}\\s+(?:a|e)\\s+${amountRe}`).exec(t))) return { tool: "variazione", result: variazione(num(m[1]), num(m[2])).text };
  if (/\bore\b.*\b(lavorat|fatto|fatte)|\b(lavorato|lavorate)\b/.test(t) && /\d{1,2}(?:[:.]\d{2})?\s*(?:-|–|alle)\s*\d/.test(t)) { const tar = A(new RegExp(`(?:tariffa|a|da)\\s*${amountRe}\\s*(?:€|euro)?\\s*(?:l'ora|all'ora|orari)`)); return { tool: "ore lavorate", result: oreLavorate(t, tar > 0 ? tar : 0).text }; }
  if ((m = /che giorno (?:è|e|sarà|era|cade)\s+(?:il\s+)?([\d/.\-]+|\d{1,2}\s+[a-zà]+(?:\s+\d{4})?)/.exec(t))) { const d = parseDate(m[1], today); if (d) return { tool: "calendario", result: giornoDellaSettimana(d, today).text }; }
  if ((m = /quanti giorni (?:mancano|ci sono|restano)\s+(?:a|al|alla|all'|fino al|fino a)\s*(?:il\s+)?([\d/.\-]+|\d{1,2}\s+[a-zà]+(?:\s+\d{4})?|natale|capodanno|ferragosto)/.exec(t))) {
    const special = { natale: "25/12", capodanno: "1/1", ferragosto: "15/8" }; let d = parseDate(special[m[1]] || m[1], today);
    if (d && d < startOf(today) && !/\d{4}/.test(m[1])) d = new Date(d.getFullYear() + 1, d.getMonth(), d.getDate());
    if (d) return { tool: "calendario", result: giorniMancanti(d, today).text };
  }
  if ((m = /(?:quanti anni ha|età di)\s+(?:chi è nato|un nato|nato|nata)?\s*(?:il\s+)?([\d/.\-]+)/.exec(t))) { const d = parseDate(m[1], today); if (d) return { tool: "età", result: eta(d, today).text }; }
  return null;
}
