// Quando? Dal linguaggio naturale italiano a un istante preciso, per i promemoria:
// "tra 10 minuti", "tra 3 giorni", "domani alle 9", "dopodomani", "stasera", "lunedì alle 10",
// "il 16/12 alle 9:30", "il 16 dicembre", "alle 18:30". Restituisce {at, rest} o null.

const WEEK = ["domenica", "lunedi", "martedi", "mercoledi", "giovedi", "venerdi", "sabato"];
const MESI = ["gennaio", "febbraio", "marzo", "aprile", "maggio", "giugno", "luglio", "agosto", "settembre", "ottobre", "novembre", "dicembre"];
const NUM = { un: 1, una: 1, uno: 1, "un'": 1, due: 2, tre: 3, quattro: 4, cinque: 5, sei: 6, sette: 7, otto: 8, nove: 9, dieci: 10, quindici: 15, venti: 20, trenta: 30, quaranta: 40, cinquanta: 50 };
const fold = (s) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
const toNum = (w) => (/^\d+$/.test(w) ? parseInt(w, 10) : NUM[w] ?? null);

export function parseWhen(text, now = new Date()) {
  let t = fold(text), o = fold(text).length === text.length ? text : fold(text);
  // Le parti riconosciute si tolgono da entrambe le copie (stessa lunghezza): il promemoria conserva maiuscole e accenti.
  const blank = (i, len) => { t = t.slice(0, i) + " ".repeat(len) + t.slice(i + len); o = o.slice(0, i) + " ".repeat(len) + o.slice(i + len); };
  const cut = (re) => { if (typeof re === "string") { const i = t.indexOf(re); if (i >= 0) blank(i, re.length); return; } const g = new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g"); let mm; const spans = []; while ((mm = g.exec(t))) { spans.push([mm.index, mm[0].length]); if (!mm[0].length) g.lastIndex++; } spans.forEach(([i, len]) => blank(i, len)); };
  let at = null;
  // relativo: tra/fra/in N unità
  let m = /\b(?:tra|fra|in)\s+(\d+|un'|una|un|uno|due|tre|quattro|cinque|sei|sette|otto|nove|dieci|quindici|venti|trenta|quaranta|cinquanta|mezz'?\s*ora)\s*(secondi|secondo|minuti|minuto|ore|ora|giorni|giorno|settimane|settimana|mesi|mese)?\b/.exec(t);
  if (m && (m[2] || /^mezz/.test(m[1]))) {
    const unit = m[2] || "ore", n = /^mezz/.test(m[1]) ? 0.5 : toNum(m[1]);
    if (n != null) {
      const ms = /^second/.test(unit) ? 1e3 : /^minut/.test(unit) ? 6e4 : /^or/.test(unit) ? 36e5 : /^giorn/.test(unit) ? 864e5 : /^settiman/.test(unit) ? 6048e5 : 0;
      if (/^mes/.test(unit)) { const d = new Date(now); d.setMonth(d.getMonth() + n); at = d.getTime(); } else at = now.getTime() + n * ms;
      cut(m[0]);
      return { at, rest: tidy(o) };
    }
  }
  // giorno
  let day = null, defHour = 9;
  if ((m = /\b(oggi|stamattina|stasera|stanotte|domani|dopodomani)\b/.exec(t))) {
    day = new Date(now); if (m[1] === "domani") day.setDate(day.getDate() + 1); if (m[1] === "dopodomani") day.setDate(day.getDate() + 2);
    if (m[1] === "stasera") defHour = 20; if (m[1] === "stanotte") defHour = 22; if (m[1] === "oggi") defHour = Math.min(23, now.getHours() + 1);
    cut(m[0]);
  } else if ((m = /\b(?:il\s+|di\s+|per\s+|(?:il\s+)?prossimo\s+)?(lunedi|martedi|mercoledi|giovedi|venerdi|sabato|domenica)(\s+prossim[oa])?\b/.exec(t))) {
    const want = WEEK.indexOf(m[1]); day = new Date(now); let delta = (want - now.getDay() + 7) % 7; if (delta === 0) delta = 7; day.setDate(day.getDate() + delta); cut(m[0]);
  } else if ((m = /\b(?:il\s+)?(\d{1,2})[/.-](\d{1,2})(?:[/.-](\d{2,4}))?\b/.exec(t)) && +m[2] >= 1 && +m[2] <= 12 && +m[1] >= 1 && +m[1] <= 31) {
    const y = m[3] ? (m[3].length === 2 ? 2000 + +m[3] : +m[3]) : now.getFullYear(); day = new Date(y, +m[2] - 1, +m[1]); if (!m[3] && day < new Date(now.getFullYear(), now.getMonth(), now.getDate())) day.setFullYear(y + 1); cut(m[0]);
  } else if ((m = new RegExp(`\\b(?:il\\s+)?(\\d{1,2})\\s+(${MESI.join("|")})(?:\\s+(\\d{4}))?\\b`).exec(t))) {
    const y = m[3] ? +m[3] : now.getFullYear(); day = new Date(y, MESI.indexOf(m[2]), +m[1]); if (!m[3] && day < new Date(now.getFullYear(), now.getMonth(), now.getDate())) day.setFullYear(y + 1); cut(m[0]);
  }
  // ora: "alle 9", "alle 18:30", "alle 9 e mezza", "alle 9 e un quarto", "a mezzogiorno"
  let hh = null, mm = 0;
  if ((m = /\b(?:alle|all'|per le|verso le|ore)\s*(\d{1,2})(?:[:.](\d{2}))?(?:\s+e\s+(mezza|mezzo|un quarto|quarto|\d{1,2}))?\b/.exec(t))) {
    hh = +m[1]; mm = m[2] ? +m[2] : m[3] ? (/mezz/.test(m[3]) ? 30 : /quarto/.test(m[3]) ? 15 : +m[3]) : 0; cut(m[0]);
    if (/\b(pomeriggio|sera|stasera)\b/.test(fold(text)) && hh < 12) hh += 12;
  } else if ((m = /\ba\s+mezzogiorno\b|\bmezzogiorno\b/.exec(t))) { hh = 12; cut(m[0]); }
  else if ((m = /\b(?:a\s+)?mezzanotte\b/.exec(t))) { hh = 0; cut(m[0]); if (!day) { day = new Date(now); day.setDate(day.getDate() + 1); } }
  cut(/\b(di|del|della)\s+(mattina|pomeriggio|sera)\b/g);
  if (hh == null && !day) return null;
  if (hh != null && hh > 23) return null;
  const d = day ? new Date(day) : new Date(now);
  d.setHours(hh != null ? hh : defHour, hh != null ? mm : 0, 0, 0);
  if (!day && d.getTime() <= now.getTime()) d.setDate(d.getDate() + 1); // "alle 9" già passate: domani
  if (d.getTime() <= now.getTime()) return null;
  return { at: d.getTime(), rest: tidy(o) };
}

const STOP = /\b(ricordami|ricorda(?:mi)? di|ricordati di|avvisami|svegliami|promemoria|timer|remind me)\b/gi;
function tidy(t) {
  return t.replace(STOP, " ").replace(/\s+/g, " ").trim().replace(/^(di|che|per|a)\s+/i, "").replace(/^(di|che)\s+/i, "").replace(/[\s,.;:]+$/, "").trim();
}

/** "domani alle 09:00", "lunedì 17 novembre alle 10:30", "tra 25 minuti": come dirlo all'utente. */
export function describeWhen(at, now = new Date()) {
  const d = new Date(at), mins = Math.round((at - now.getTime()) / 6e4);
  if (mins < 60) return `tra ${Math.max(1, mins)} minut${mins === 1 ? "o" : "i"}`;
  const hm = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()), dd = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const days = Math.round((dd - today) / 864e5);
  if (mins < 360) { const h = Math.floor(mins / 60), m = mins % 60; return `tra ${h === 1 ? "un'ora" : h + " ore"}${m ? ` e ${m} minut${m === 1 ? "o" : "i"}` : ""}, ${days === 0 ? "alle" : "domani alle"} ${hm}`; }
  const giorni = ["domenica", "lunedì", "martedì", "mercoledì", "giovedì", "venerdì", "sabato"];
  if (days === 0) return `oggi alle ${hm}`;
  if (days === 1) return `domani alle ${hm}`;
  if (days === 2) return `dopodomani alle ${hm}`;
  if (days < 7) return `${giorni[d.getDay()]} alle ${hm}`;
  return `${giorni[d.getDay()]} ${d.getDate()} ${MESI[d.getMonth()]}${d.getFullYear() !== now.getFullYear() ? " " + d.getFullYear() : ""} alle ${hm}`;
}
