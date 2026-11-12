// Strumenti di utilità senza chiave: fusi orari, conversioni di unità, password e numeri casuali, settimana dell'anno,
// festività, distanza in linea d'aria. Le parti che chiedono la rete (alba e tramonto, qualità dell'aria, dizionario,
// QR code) sono in app.js; qui solo funzioni pure e il riconoscimento delle richieste.
import { holidayName, fmtLong, parseDate, num } from "./studio.js";

// ------------------------------------------------------------------ fusi orari
export const ZONES = { roma: "Europe/Rome", milano: "Europe/Rome", italia: "Europe/Rome", londra: "Europe/London", parigi: "Europe/Paris", berlino: "Europe/Berlin", madrid: "Europe/Madrid", lisbona: "Europe/Lisbon", atene: "Europe/Athens", mosca: "Europe/Moscow", istanbul: "Europe/Istanbul", dubai: "Asia/Dubai", "new york": "America/New_York", "los angeles": "America/Los_Angeles", "san francisco": "America/Los_Angeles", chicago: "America/Chicago", miami: "America/New_York", toronto: "America/Toronto", "città del messico": "America/Mexico_City", "san paolo": "America/Sao_Paulo", "buenos aires": "America/Argentina/Buenos_Aires", tokyo: "Asia/Tokyo", pechino: "Asia/Shanghai", shanghai: "Asia/Shanghai", "hong kong": "Asia/Hong_Kong", singapore: "Asia/Singapore", bangkok: "Asia/Bangkok", mumbai: "Asia/Kolkata", "nuova delhi": "Asia/Kolkata", seul: "Asia/Seoul", sydney: "Australia/Sydney", melbourne: "Australia/Melbourne", auckland: "Pacific/Auckland", cairo: "Africa/Cairo", johannesburg: "Africa/Johannesburg", "tel aviv": "Asia/Jerusalem", riad: "Asia/Riyadh", zurigo: "Europe/Zurich", vienna: "Europe/Vienna", amsterdam: "Europe/Amsterdam", bruxelles: "Europe/Brussels", dublino: "Europe/Dublin", stoccolma: "Europe/Stockholm", varsavia: "Europe/Warsaw", "new delhi": "Asia/Kolkata", honolulu: "Pacific/Honolulu" };
export function worldTime(city, now = new Date()) {
  const zone = ZONES[String(city).toLowerCase().trim()]; if (!zone) return null;
  const f = (tz) => new Intl.DateTimeFormat("it-IT", { timeZone: tz, hour: "2-digit", minute: "2-digit", weekday: "long" }).format(now);
  const off = (tz) => { const p = new Intl.DateTimeFormat("en-US", { timeZone: tz, timeZoneName: "shortOffset" }).formatToParts(now).find((x) => x.type === "timeZoneName").value; const m = /GMT([+-]\d+)(?::(\d+))?/.exec(p); return m ? +m[1] + (m[2] ? Math.sign(+m[1]) * +m[2] / 60 : 0) : 0; };
  const diff = off(zone) - off("Europe/Rome");
  return { text: `A ${city.replace(/\b\w/g, (c) => c.toUpperCase())} è ${f(zone)}${diff ? ` (${diff > 0 ? "+" : ""}${diff} ore rispetto all'Italia)` : " (stessa ora dell'Italia)"}.` };
}

// ------------------------------------------------------------------ conversioni di unità
const U = {
  lunghezza: { mm: 0.001, millimetri: 0.001, cm: 0.01, centimetri: 0.01, m: 1, metri: 1, metro: 1, km: 1000, chilometri: 1000, pollici: 0.0254, pollice: 0.0254, piedi: 0.3048, piede: 0.3048, iarde: 0.9144, miglia: 1609.344, miglio: 1609.344, "miglia nautiche": 1852 },
  massa: { mg: 1e-6, g: 0.001, grammi: 0.001, kg: 1, chili: 1, chilogrammi: 1, quintali: 100, tonnellate: 1000, libbre: 0.45359237, libbra: 0.45359237, once: 0.0283495 },
  volume: { ml: 0.001, millilitri: 0.001, cl: 0.01, l: 1, litri: 1, litro: 1, galloni: 3.785411784, gallone: 3.785411784, "metri cubi": 1000, m3: 1000 },
  superficie: { m2: 1, "metri quadri": 1, mq: 1, ettari: 10000, ettaro: 10000, km2: 1e6, "chilometri quadri": 1e6, acri: 4046.8564224, "piedi quadri": 0.09290304 },
  velocità: { "km/h": 1 / 3.6, "m/s": 1, mph: 0.44704, nodi: 0.514444 },
  dati: { byte: 1, kb: 1e3, mb: 1e6, gb: 1e9, tb: 1e12, kib: 1024, mib: 1048576, gib: 1073741824 },
  energia: { j: 1, joule: 1, kj: 1e3, kwh: 3.6e6, cal: 4.184, kcal: 4184 },
};
const TEMP = { c: "C", celsius: "C", "°c": "C", gradi: "C", f: "F", fahrenheit: "F", "°f": "F", k: "K", kelvin: "K" };
export function convert(value, from, to) {
  from = from.toLowerCase().trim(); to = to.toLowerCase().trim();
  if (TEMP[from] && TEMP[to]) { const a = TEMP[from], b = TEMP[to]; const c = a === "C" ? value : a === "F" ? (value - 32) * 5 / 9 : value - 273.15; const r = b === "C" ? c : b === "F" ? c * 9 / 5 + 32 : c + 273.15; return { value: Math.round(r * 100) / 100, text: `${value.toLocaleString("it-IT")} ${from} = ${(Math.round(r * 100) / 100).toLocaleString("it-IT")} ${to}.` }; }
  for (const [kind, table] of Object.entries(U)) if (table[from] != null && table[to] != null) { const r = value * table[from] / table[to]; const v = Math.abs(r) >= 1 ? Math.round(r * 1000) / 1000 : Number(r.toPrecision(4)); return { value: v, text: `${value.toLocaleString("it-IT")} ${from} = ${v.toLocaleString("it-IT", { maximumFractionDigits: 6 })} ${to} (${kind}).` }; }
  return null;
}
const UNIT_WORDS = [...new Set([...Object.values(U).flatMap((t) => Object.keys(t)), ...Object.keys(TEMP)])].sort((a, b) => b.length - a.length).map((k) => k.replace(/[/°]/g, "\\$&")).join("|");

// ------------------------------------------------------------------ casualità e sicurezza
export function password(length = 16, rnd = (n) => crypto.getRandomValues(new Uint32Array(n))) {
  const sets = ["abcdefghijkmnpqrstuvwxyz", "ABCDEFGHJKLMNPQRSTUVWXYZ", "23456789", "!@#$%&*?-_+="], all = sets.join("");
  length = Math.max(8, Math.min(64, length | 0)); const r = rnd(length + 4);
  const chars = sets.map((s, i) => s[r[i] % s.length]); for (let i = 4; i < length; i++) chars.push(all[r[i] % all.length]);
  for (let i = chars.length - 1; i > 0; i--) { const j = r[(i + 3) % r.length] % (i + 1); [chars[i], chars[j]] = [chars[j], chars[i]]; }
  return chars.join("");
}
export const randomInt = (min, max, rnd = () => crypto.getRandomValues(new Uint32Array(1))[0] / 2 ** 32) => min + Math.floor(rnd() * (max - min + 1));

// ------------------------------------------------------------------ calendario
export function weekNumber(d) { const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())); const day = t.getUTCDay() || 7; t.setUTCDate(t.getUTCDate() + 4 - day); const y0 = new Date(Date.UTC(t.getUTCFullYear(), 0, 1)); return Math.ceil(((t - y0) / 864e5 + 1) / 7); }
export function holidaysOf(year) { const out = []; for (let d = new Date(year, 0, 1); d.getFullYear() === year; d.setDate(d.getDate() + 1)) { const h = holidayName(d); if (h) out.push({ date: new Date(d), name: h }); } return out; }

// ------------------------------------------------------------------ distanze
export function haversine(a, b) { const R = 6371, r = (x) => x * Math.PI / 180, dLat = r(b.lat - a.lat), dLon = r(b.lon - a.lon); const h = Math.sin(dLat / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(dLon / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(h)); }

// ------------------------------------------------------------------ riconoscimento
/** Richieste di utilità. Restituisce {tool, result} oppure {tool, need: "rete", ...} per ciò che serve chiedere online. */
export function routeUtility(text, today = new Date()) {
  const t = text.toLowerCase().replace(/[?!.]+$/, "").trim(); let m;
  if ((m = /(?:che ore? (?:sono|è)|che ora è|ora locale)\s+(?:a|ad|in)\s+([a-zà-ù ]+)$/.exec(t))) { const r = worldTime(m[1].trim(), today); if (r) return { tool: "fuso orario", result: r.text }; }
  if ((m = new RegExp(`(-?\\d[\\d.,]*)\\s*(${UNIT_WORDS})\\s+(?:in|a|to)\\s+(${UNIT_WORDS})$`).exec(t.replace(/^(?:converti|quanti|quante|quanto fa|quanto sono|quanto è)\s+/, "").replace(/^(?:sono\s+)?/, "")))) { const r = convert(num(m[1]), m[2], m[3]); if (r) return { tool: "conversione", result: r.text }; }
  if ((m = new RegExp(`quant[ie]\\s+(${UNIT_WORDS})\\s+(?:sono|fanno|ci sono in)\\s+(-?\\d[\\d.,]*)\\s*(${UNIT_WORDS})$`).exec(t))) { const r = convert(num(m[2]), m[3], m[1]); if (r) return { tool: "conversione", result: r.text }; }
  if (/\b(genera|crea|dammi|inventa)\b.*\bpassword\b|^password\b/.test(t)) { const n = +(/(\d{1,2})\s*caratteri/.exec(t) || [])[1] || 16; return { tool: "password", result: `Password di ${Math.max(8, Math.min(64, n))} caratteri, generata sul dispositivo: ${password(n)}`, exact: true }; }
  if (/\b(lancia|tira)\b.*\bmoneta\b|testa o croce/.test(t)) return { tool: "moneta", result: randomInt(0, 1) ? "Testa." : "Croce." };
  if ((m = /\b(?:lancia|tira)\b.*\bdad[oi]\b(?:.*?(\d+)\s*facce)?/.exec(t))) { const f = +(m[1] || 6); return { tool: "dado", result: `È uscito ${randomInt(1, f)} (dado da ${f}).` }; }
  if ((m = /numero (?:casuale|a caso)(?: (?:tra|da) (-?\d+) (?:e|a) (-?\d+))?/.exec(t))) { const a = +(m[1] ?? 1), b = +(m[2] ?? 100); return { tool: "casuale", result: `Numero casuale tra ${Math.min(a, b)} e ${Math.max(a, b)}: ${randomInt(Math.min(a, b), Math.max(a, b))}.` }; }
  if (/che settimana|numero della settimana|settimana dell'anno/.test(t)) return { tool: "calendario", result: `Siamo nella settimana ${weekNumber(today)} del ${today.getFullYear()}.` };
  if ((m = /(?:^|\s)(?:festivi|festività|giorni festivi|feste)(?=\s|$)(?:\s+(?:del|nel)?\s*(\d{4}))?/.exec(t)) && !/\b(è|e) festivo\b/.test(t)) { const y = +(m[1] || today.getFullYear()); return { tool: "festività", result: `Festività nazionali ${y}: ` + holidaysOf(y).map((h) => `${fmtLong(h.date)} (${h.name})`).join("; ") + "." }; }
  if ((m = /(?:è|e) festivo (?:il\s+)?([\d/.\-]+|\d{1,2}\s+[a-zà]+(?:\s+\d{4})?)/.exec(t))) { const d = parseDate(m[1], today); if (d) { const h = holidayName(d); return { tool: "calendario", result: h ? `Sì: ${fmtLong(d)} è ${h}.` : d.getDay() % 6 === 0 ? `${fmtLong(d)} non è festivo, ma è ${d.getDay() ? "sabato" : "domenica"}.` : `No, ${fmtLong(d)} è un giorno lavorativo.` }; } }
  // richieste che servono la rete: le gestisce app.js
  if ((m = /distanza (?:tra|fra|da) ([a-zà-ù' ]+?) (?:e|a) ([a-zà-ù' ]+)$/.exec(t))) return { tool: "distanza", need: "distanza", a: m[1].trim(), b: m[2].trim() };
  if ((m = /\b(?:alba|tramonto|a che ora sorge|a che ora tramonta)\b.*?(?:\b(?:a|ad|in)\s+([a-zà-ù' ]+))?$/.exec(t))) return { tool: "alba e tramonto", need: "sole", place: (m[1] || "").trim() };
  if ((m = /qualit[aà] dell'?aria(?:\s+(?:a|ad|in)\s+([a-zà-ù' ]+))?|\bsmog\b(?:\s+(?:a|ad|in)\s+([a-zà-ù' ]+))?|\bpm10\b|\bpm2/.exec(t))) return { tool: "qualità dell'aria", need: "aria", place: (m[1] || m[2] || "").trim() };
  if ((m = /^(?:cosa significa|che significa|significato di|definizione di|definisci)\s+(?:la parola\s+)?["«]?([a-zà-ù' -]{2,40})["»]?$/.exec(t))) return { tool: "dizionario", need: "dizionario", word: m[1].trim() };
  if ((m = /^(?:crea|genera|fammi)\s+(?:un\s+)?(?:codice\s+)?qr(?:\s*code)?\s+(?:per|di|con|del)\s+(.+)$/i.exec(text.trim()))) return { tool: "QR code", need: "qr", data: m[1].trim() };
  return null;
}
