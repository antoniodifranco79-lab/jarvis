// Analisi dei documenti senza modello linguistico: date e scadenze, importi, dati identificativi (codici fiscali,
// partite IVA, IBAN, email, PEC, telefoni), clausole chiave, statistiche e leggibilità, confronto tra due versioni,
// anonimizzazione. Tutto deterministico, sul dispositivo, con il numero di pagina quando c'è.
import { checkCF, checkPIVA, checkIBAN, num } from "./studio.js";

const MESI = ["gennaio", "febbraio", "marzo", "aprile", "maggio", "giugno", "luglio", "agosto", "settembre", "ottobre", "novembre", "dicembre"];
const fmt = (d) => `${d.getDate()} ${MESI[d.getMonth()]} ${d.getFullYear()}`;
const eur = (n) => n.toLocaleString("it-IT", { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: "always" }) + " €";

/** Pagine del testo: accetta un array di pagine o un testo con marcatori "[p. N]". */
export function pagesOf(input) {
  if (Array.isArray(input)) return input.map((text, i) => ({ page: input.length > 1 ? i + 1 : null, text: String(text || "") }));
  const s = String(input || ""); if (!/\[p\. \d+\]/.test(s)) return [{ page: null, text: s }];
  return s.split(/(?=\[p\. \d+\])/).map((chunk) => { const m = /^\[p\. (\d+)\]\s*/.exec(chunk); return { page: m ? +m[1] : null, text: m ? chunk.slice(m[0].length) : chunk }; }).filter((p) => p.text.trim());
}
/** La frase che contiene la posizione `i`, accorciata. */
function sentenceAt(text, i, len = 0, max = 220) {
  let a = i, b = i + len;
  while (a > 0 && !/[.;\n]/.test(text[a - 1]) && i - a < max) a--;
  while (b < text.length && !/[.;\n]/.test(text[b]) && b - i < max) b++;
  return text.slice(a, Math.min(text.length, b + 1)).replace(/\s+/g, " ").trim();
}

// ------------------------------------------------------------------ date e scadenze
const DATE_RE = new RegExp(`\\b(\\d{1,2})[/.-](\\d{1,2})[/.-](\\d{2,4})\\b|\\b(\\d{1,2})(?:°|º)?\\s+(${MESI.join("|")})\\s+(\\d{4})\\b|\\b(\\d{4})-(\\d{2})-(\\d{2})\\b`, "gi");
const DEADLINE = /\b(entro|scade|scadenza|termine|non oltre|decorr|a partire|fino al|dal giorno|rinnov|disdett|preavviso|pagament|versament|consegn|udienza|notific)/i;
export function estraiDate(input) {
  const out = [];
  for (const { page, text } of pagesOf(input)) {
    for (const m of text.matchAll(DATE_RE)) {
      let d;
      if (m[1]) { const y = m[3].length === 2 ? 2000 + +m[3] : +m[3]; d = new Date(y, +m[2] - 1, +m[1]); if (d.getMonth() !== +m[2] - 1) continue; }
      else if (m[4]) d = new Date(+m[6], MESI.indexOf(m[5].toLowerCase()), +m[4]);
      else d = new Date(+m[7], +m[8] - 1, +m[9]);
      if (Number.isNaN(+d) || d.getFullYear() < 1900 || d.getFullYear() > 2200) continue;
      const context = sentenceAt(text, m.index, m[0].length);
      out.push({ date: d, raw: m[0], page, context, deadline: DEADLINE.test(context) });
    }
  }
  return out.sort((a, b) => a.date - b.date);
}

// ------------------------------------------------------------------ importi
const AMOUNT_RE = /(?:€|euro|eur)\s*(\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?|\d+(?:,\d{1,2})?)|(\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?|\d+(?:,\d{1,2})?)\s*(?:€|euro\b|eur\b)/gi;
export function estraiImporti(input) {
  const out = [];
  for (const { page, text } of pagesOf(input)) for (const m of text.matchAll(AMOUNT_RE)) { const v = num(m[1] || m[2]); if (Number.isFinite(v) && v > 0) out.push({ amount: v, raw: m[0].trim(), page, context: sentenceAt(text, m.index, m[0].length) }); }
  return out;
}

// ------------------------------------------------------------------ dati identificativi
export function estraiDati(input) {
  const found = { cf: [], piva: [], iban: [], email: [], pec: [], telefoni: [] }; const seen = new Set();
  const add = (k, v, page) => { const key = k + v; if (seen.has(key)) return; seen.add(key); found[k].push({ value: v, page }); };
  for (const { page, text } of pagesOf(input)) {
    for (const m of text.matchAll(/\b[A-Z]{6}[0-9LMNPQRSTUV]{2}[A-Z][0-9LMNPQRSTUV]{2}[A-Z][0-9LMNPQRSTUV]{3}[A-Z]\b/gi)) if (checkCF(m[0]).ok) add("cf", m[0].toUpperCase(), page);
    for (const m of text.matchAll(/(?:p\.?\s?iva|partita iva|c\.f\.\/p\.iva|vat)\D{0,12}(?:IT)?\s?(\d{11})\b|\b(\d{11})\b/gi)) { const v = m[1] || m[2]; if (checkPIVA(v).ok && (m[1] || /iva|vat/i.test(sentenceAt(text, m.index, 11, 60)))) add("piva", v, page); }
    for (const m of text.matchAll(/\b[A-Z]{2}\d{2}(?:\s?[A-Z0-9]){11,30}\b/g)) { const v = m[0].replace(/\s/g, ""); if (checkIBAN(v).ok) add("iban", v, page); }
    for (const m of text.matchAll(/\b[\w.+-]+@[\w-]+(?:\.[\w-]+)+\b/g)) add(/(?:^|[.@])(pec|legalmail|postacert|cert|arubapec|pecimprese|sicurezzapostale)\b/i.test(m[0]) ? "pec" : "email", m[0].toLowerCase(), page);
    const noIban = text.replace(/\b[A-Z]{2}\d{2}(?:\s?[A-Z0-9]){11,30}\b/g, (m) => " ".repeat(m.length));
    for (const m of noIban.matchAll(/(?<![\w.])(?:\+39[\s.]?)?(?:3\d{2}|0\d{1,3})[\s./-]?\d{3,4}[\s./-]?\d{3,4}(?![\w])/g)) { const d = m[0].replace(/\D/g, "").replace(/^39(?=\d{9,10}$)/, ""); if (d.length >= 9 && d.length <= 11 && !/^\d{11}$/.test(m[0].trim())) add("telefoni", m[0].trim(), page); }
  }
  return found;
}

// ------------------------------------------------------------------ clausole chiave
export const CLAUSOLE = [
  ["Durata", /\b(durata|ha durata|validità del contratto|per un periodo di|anni a decorrere|mesi a decorrere)\b/i],
  ["Rinnovo", /\b(rinnov\w+ (?:tacit|automatic)\w*|tacito rinnovo|si rinnova)\b/i],
  ["Recesso e disdetta", /\b(recesso|recedere|disdetta|disdire)\b/i],
  ["Preavviso", /\bpreavviso\b/i],
  ["Penali", /\b(penale|penali|penalità)(?![a-zà-ÿ])/i],
  ["Pagamenti", /\b(corrispettivo|canone|pagamento|pagabile|fattura\w*|bonifico)\b/i],
  ["Interessi di mora", /\b(interessi (?:di mora|moratori)|d\.?\s?lgs\.?\s*231\/2002)\b/i],
  ["Risoluzione", /\b(risoluzione|clausola risolutiva|si risolve|risolto di diritto|art\.?\s*1456)\b/i],
  ["Garanzie", /\b(garanzia|garanzie|fideiussion\w*|deposito cauzionale|cauzione)\b/i],
  ["Responsabilità", /\b(responsabilità|manleva|tenere indenne|limitazione di responsabilità)(?![a-zà-ÿ])/i],
  ["Riservatezza", /\b(riservatezza|confidenzial\w*|segreto|non divulga\w*)\b/i],
  ["Dati personali", /\b(gdpr|regolamento \(?ue\)? 2016\/679|dati personali|trattamento dei dati|privacy)\b/i],
  ["Foro competente", /\b(foro competente|competenza esclusiva|tribunale di \w+ (?:sarà|è) competente|foro di \w+)\b/i],
  ["Legge applicabile", /\b(legge applicabile|regolato dalla legge|disciplinato dalla legge)\b/i],
  ["Cessione", /\b(cessione del contratto|cedere il contratto|subappalt\w*|sublocazione|sublocare)\b/i],
  ["Forza maggiore", /\b(forza maggiore|caso fortuito)\b/i],
];
/** Paragrafi che parlano di ciascuna clausola chiave, con la pagina. */
export function clausoleChiave(input, max = 2) {
  const out = [];
  const paras = pagesOf(input).flatMap(({ page, text }) => text.split(/\n{2,}|(?=\b(?:art(?:icolo|\.)\s*\d+))/i).map((p) => ({ page, text: p.replace(/\s+/g, " ").trim() })).filter((p) => p.text.length > 25));
  for (const [name, re] of CLAUSOLE) {
    const hits = paras.filter((p) => re.test(p.text)).slice(0, max);
    if (hits.length) out.push({ name, hits: hits.map((h) => ({ page: h.page, text: h.text.length > 420 ? h.text.slice(0, 417) + "…" : h.text })) });
  }
  return out;
}

// ------------------------------------------------------------------ statistiche e leggibilità
/** Parole, frasi, tempo di lettura e indice Gulpease (leggibilità dell'italiano: sopra 60 facile, sotto 40 difficile). */
export function statistiche(input) {
  const pages = pagesOf(input), text = pages.map((p) => p.text).join("\n");
  const words = text.match(/[\p{L}\p{N}']+/gu) || [], letters = words.join("").replace(/[^\p{L}\p{N}]/gu, "").length;
  // Frasi: un punto conta solo se segue una maiuscola o la fine, e non chiude un'abbreviazione (art., Sig., S.r.l., P.IVA).
  const ABBR = /^(art|artt|sig|sigg|sig\.ra|dott|avv|ing|arch|geom|rag|prof|n|nn|pag|pp|tel|ecc|es|cfr|ss|vs|c|cf|p|iva|s|r|l|spa|srl|snc|sas|ca)$/i;
  let sentences = 0; for (const m of text.matchAll(/([\p{L}\p{N}.]+)[.!?]+(?=\s+["«(\p{Lu}\p{N}]|\s*$)/gu)) if (!ABBR.test(m[1]) && !/\p{L}\.\p{L}/u.test(m[1])) sentences++;
  sentences = Math.max(1, sentences);
  const gulpease = words.length ? Math.max(0, Math.min(100, Math.round(89 + (300 * sentences - 10 * letters) / words.length))) : 0;
  const level = gulpease >= 80 ? "molto facile" : gulpease >= 60 ? "facile" : gulpease >= 40 ? "impegnativo" : "difficile";
  const minutes = Math.max(1, Math.round(words.length / 200));
  return { words: words.length, sentences, pages: pages.length, minutes, gulpease, level, text: `${words.length.toLocaleString("it-IT")} parole, ${sentences} frasi${pages.length > 1 ? ", " + pages.length + " pagine" : ""}; lettura in circa ${minutes} minut${minutes === 1 ? "o" : "i"}. Leggibilità (indice Gulpease) ${gulpease}: ${level} per un lettore con licenza media${gulpease < 40 ? ", adatto a chi ha studi superiori" : ""}.` };
}

// ------------------------------------------------------------------ confronto tra due versioni
const sentences = (s) => String(s || "").replace(/\[p\. \d+\]/g, " ").replace(/\s+/g, " ").split(/(?<=[.;:!?])\s+(?=[A-ZÀ-Ý0-9"«(])/).map((x) => x.trim()).filter((x) => x.length > 2);
const words = (s) => s.toLowerCase().match(/[\p{L}\p{N}]+/gu) || [];
function similarity(a, b) { const A = new Set(words(a)), B = new Set(words(b)); let i = 0; for (const w of A) if (B.has(w)) i++; return i / Math.max(1, Math.max(A.size, B.size)); }
/** Frasi aggiunte, tolte e modificate tra la versione A e la B (allineamento LCS sulle frasi). */
export function confronta(a, b) {
  const X = sentences(a), Y = sentences(b), n = X.length, m = Y.length;
  const L = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i][j] = X[i] === Y[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  const removed = [], added = []; let i = 0, j = 0;
  while (i < n && j < m) { if (X[i] === Y[j]) { i++; j++; } else if (L[i + 1][j] >= L[i][j + 1]) removed.push(X[i++]); else added.push(Y[j++]); }
  while (i < n) removed.push(X[i++]); while (j < m) added.push(Y[j++]);
  const changed = [];
  for (const r of [...removed]) { let best = -1, score = 0.5; added.forEach((x, k) => { const s = similarity(r, x); if (s > score) { score = s; best = k; } }); if (best >= 0) { changed.push({ from: r, to: added[best] }); removed.splice(removed.indexOf(r), 1); added.splice(best, 1); } }
  const same = n - removed.length - changed.length;
  const short = (s) => (s.length > 200 ? s.slice(0, 197) + "…" : s);
  const parts = [];
  if (changed.length) parts.push(`Modificate (${changed.length}): ` + changed.slice(0, 8).map((c) => `"${short(c.from)}" → "${short(c.to)}"`).join("; "));
  if (added.length) parts.push(`Aggiunte (${added.length}): ` + added.slice(0, 8).map((x) => `"${short(x)}"`).join("; "));
  if (removed.length) parts.push(`Tolte (${removed.length}): ` + removed.slice(0, 8).map((x) => `"${short(x)}"`).join("; "));
  return { added, removed, changed, same, text: parts.length ? `Confronto: ${same} frasi identiche. ` + parts.join(". ") + "." : "I due testi sono identici, frase per frase." };
}

// ------------------------------------------------------------------ anonimizzazione (GDPR)
/** Sostituisce dati personali con segnaposto: codici fiscali, P.IVA, IBAN, email, telefoni, date di nascita e nomi
 *  dopo i titoli (Sig., Dott., Avv., ...) più i nomi indicati. Restituisce il testo e quante sostituzioni per tipo. */
export function anonimizza(text, nomi = []) {
  let t = String(text || ""); const count = {}; const map = new Map();
  const tag = (kind, value) => { const k = kind + "|" + value.toLowerCase(); if (!map.has(k)) { count[kind] = (count[kind] || 0) + 1; map.set(k, `[${kind} ${count[kind]}]`); } return map.get(k); };
  const rep = (re, kind, ok = () => true) => { t = t.replace(re, (m, ...g) => (ok(m, ...g) ? tag(kind, m) : m)); };
  rep(/\b[A-Z]{2}\d{2}(?:\s?[A-Z0-9]){11,30}\b/g, "IBAN", (m) => checkIBAN(m.replace(/\s/g, "")).ok);
  rep(/\b[A-Z]{6}[0-9LMNPQRSTUV]{2}[A-Z][0-9LMNPQRSTUV]{2}[A-Z][0-9LMNPQRSTUV]{3}[A-Z]\b/gi, "CODICE FISCALE", (m) => checkCF(m).ok);
  rep(/\b\d{11}\b/g, "PARTITA IVA", (m) => checkPIVA(m).ok);
  rep(/\b[\w.+-]+@[\w-]+(?:\.[\w-]+)+\b/g, "EMAIL");
  rep(/(?<![\w.[])(?:\+39[\s.]?)?(?:3\d{2}|0\d{1,3})[\s./-]?\d{3,4}[\s./-]?\d{3,4}(?![\w\]])/g, "TELEFONO", (m) => { const d = m.replace(/\D/g, ""); return d.length >= 9 && d.length <= 12; });
  t = t.replace(/(\bnat[oa]\s+(?:a\s+[A-ZÀ-Ý][\p{L}' ]+?\s+)?il\s+)(\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4})/giu, (m, pre, date) => pre + tag("DATA DI NASCITA", date));
  const TITLE = "(?:sig\\.ra|sig\\.|signor[ae]?|dott\\.ssa|dott\\.|dottor|avv\\.|avvocato|ing\\.|arch\\.|geom\\.|rag\\.|prof\\.|prof\\.ssa|sig\\.na)";
  t = t.replace(new RegExp(`(${TITLE}\\s+)((?:[A-ZÀ-Ý][\\p{Ll}'’]+\\s?){1,3})`, "giu"), (m, title, name) => title + tag("NOME", name.trim()) + (/\s$/.test(name) ? " " : ""));
  for (const n of nomi.map((x) => String(x).trim()).filter((x) => x.length > 1)) t = t.replace(new RegExp(`\\b${n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "gi"), (m) => tag("NOME", n));
  const total = Object.values(count).reduce((a, b) => a + b, 0);
  return { text: t, count, total, summary: total ? "Sostituiti: " + Object.entries(count).map(([k, v]) => `${v} ${k.toLowerCase()}`).join(", ") + "." : "Non ho trovato dati personali riconoscibili." };
}

// ------------------------------------------------------------------ rapporto unico, per il documento intero
export function rapporto(name, input, what = "tutto") {
  const out = [];
  if (what === "tutto" || what === "scadenze" || what === "date") {
    const ds = estraiDate(input), dl = ds.filter((d) => d.deadline);
    const list = (dl.length ? dl : ds).slice(0, 12).map((d) => `${fmt(d.date)}${d.page ? ` (p. ${d.page})` : ""}: ${d.context}`);
    out.push(list.length ? `Date${dl.length ? " e scadenze" : ""} in ${name}:\n- ` + list.join("\n- ") : `Nessuna data in ${name}.`);
  }
  if (what === "tutto" || what === "importi") {
    const im = estraiImporti(input); const uniq = [...new Map(im.map((x) => [x.amount + "|" + x.page, x])).values()].slice(0, 12);
    out.push(uniq.length ? `Importi in ${name}:\n- ` + uniq.map((x) => `${eur(x.amount)}${x.page ? ` (p. ${x.page})` : ""}: ${x.context}`).join("\n- ") : `Nessun importo in ${name}.`);
  }
  if (what === "tutto" || what === "dati") {
    const d = estraiDati(input); const labels = { cf: "Codici fiscali", piva: "Partite IVA", iban: "IBAN", email: "Email", pec: "PEC", telefoni: "Telefoni" };
    const rows = Object.entries(d).filter(([, v]) => v.length).map(([k, v]) => `${labels[k]}: ${v.map((x) => x.value + (x.page ? ` (p. ${x.page})` : "")).join(", ")}`);
    out.push(rows.length ? `Dati identificativi in ${name}:\n- ` + rows.join("\n- ") : `Nessun dato identificativo riconosciuto in ${name}.`);
  }
  if (what === "tutto" || what === "clausole") {
    const c = clausoleChiave(input, 1);
    out.push(c.length ? `Clausole chiave in ${name}:\n- ` + c.map((x) => `${x.name}${x.hits[0].page ? ` (p. ${x.hits[0].page})` : ""}: ${x.hits[0].text}`).join("\n- ") : `Non riconosco clausole contrattuali tipiche in ${name}.`);
  }
  if (what === "tutto" || what === "statistiche") out.push(`Statistiche di ${name}: ${statistiche(input).text}`);
  return out.join("\n\n");
}
