// Archivio documenti di J.A.R.V.I.S.: tutto resta nel browser (IndexedDB).
// Estrae il testo da PDF, Word e file di testo, lo divide in passaggi e lo cerca con BM25:
// funziona anche senza modello linguistico e senza internet (dopo il primo caricamento delle librerie).

const PDFJS = "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.min.mjs";
const PDFJS_WORKER = "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.worker.min.mjs";
const MAMMOTH = "https://cdn.jsdelivr.net/npm/mammoth@1.8.0/mammoth.browser.min.js";
const TESSERACT = "https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js";
const XLSX_URL = "https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js";
export const ACCEPT = ".pdf,.docx,.xlsx,.xls,.ods,.txt,.md,.csv,.tsv,.json,.html,.htm,.xml,.eml,.rtf,.log,.jpg,.jpeg,.png,.webp,.bmp";
const IMAGE = /^(jpe?g|png|webp|bmp)$/;
const MAX_BYTES = 40 * 1024 * 1024;

// ------------------------------------------------------------------ storage (IndexedDB, con ripiego in memoria)
let dbp = null;
const db = () => (dbp ||= new Promise((res) => {
  try { const r = indexedDB.open("jarvis-docs", 1); r.onupgradeneeded = () => r.result.createObjectStore("docs", { keyPath: "id" }); r.onsuccess = () => res(r.result); r.onerror = () => res(null); } catch { res(null); }
}));
const tx = async (mode, fn) => { const d = await db(); if (!d) return null; return new Promise((res, rej) => { const t = d.transaction("docs", mode), st = t.objectStore("docs"); const out = fn(st); t.oncomplete = () => res(out && out.result !== undefined ? out.result : out); t.onerror = () => rej(t.error); }); };

// ------------------------------------------------------------------ testo e parole
const STOP = new Set(("a ad al alla alle allo agli ai anche avere che chi ci con come cosa da dal dalla dalle dei del della delle dello degli di e ed era essere gli ha hanno ho i il in io la le lei li lo loro lui ma mi mia mio ne nei nel nella nelle no noi non nostro o per perche più piu poi quale quali quando quanto quello questa questo se sei si sia siamo sono su sua sue sui sul sulla suo tra fra tu tua tuo un una uno vi voi è " +
  "the of and to in is it that for on as with was be by are this an or at from which not have has can will you your what who how").split(" "));
const fold = (s) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
const stem = (w) => (w.length > 5 ? w.replace(/(zioni|zione|mente|menti|ità|ita)$/, "").replace(/[aeiou]$/, "") : w.length >= 4 ? w.replace(/[aeio]$/, "") : w);
export const tokens = (s) => fold(s).split(/[^a-z0-9]+/).filter((w) => w && !STOP.has(w) && (w.length > 1 || /\d/.test(w))).map(stem);

/** Divide le pagine in passaggi di ~900 caratteri, con 150 di sovrapposizione, tagliando su frasi quando possibile. */
export function chunk(pages, size = 900, overlap = 150) {
  const out = [];
  pages.forEach((raw, pi) => {
    const text = raw.replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim(); if (!text) return;
    let i = 0;
    while (i < text.length) {
      let end = Math.min(text.length, i + size);
      if (end < text.length) { const cut = Math.max(text.lastIndexOf(". ", end), text.lastIndexOf("\n", end)); if (cut > i + size * 0.5) end = cut + 1; }
      out.push({ page: pages.length > 1 ? pi + 1 : null, text: text.slice(i, end).trim() });
      if (end >= text.length) break; i = Math.max(end - overlap, i + 1);
    }
  });
  return out;
}

// ------------------------------------------------------------------ estrazione
let pdfjs = null, mammothP = null;
async function pdfPages(buf) {
  if (!pdfjs) { pdfjs = await import(PDFJS); pdfjs.GlobalWorkerOptions.workerSrc = PDFJS_WORKER; }
  const doc = await pdfjs.getDocument({ data: buf, isEvalSupported: false }).promise, pages = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const c = await (await doc.getPage(p)).getTextContent(); let line = "", y = null; const parts = [];
    for (const it of c.items) { const yy = it.transform ? it.transform[5] : y; if (y !== null && Math.abs(yy - y) > 2) { parts.push(line); line = ""; } line += it.str + (it.hasEOL ? "\n" : ""); y = yy; }
    parts.push(line); pages.push(parts.join("\n"));
  }
  return pages;
}
const loadScript = (src, global) => new Promise((res, rej) => { if (window[global]) return res(window[global]); const sc = document.createElement("script"); sc.src = src; sc.onload = () => res(window[global]); sc.onerror = () => rej(new Error("libreria non raggiungibile: serve internet la prima volta")); document.head.appendChild(sc); });
/** Un PDF è una scansione se le sue pagine non hanno quasi testo. */
export const isScanned = (pages) => pages.length > 0 && pages.reduce((a, p) => a + p.replace(/\s+/g, "").length, 0) / pages.length < 25;
let ocrWorker = null;
/** Riconoscimento del testo (OCR) sul dispositivo, in italiano e inglese: le immagini non lasciano il browser. */
async function ocr(images, onStep = () => {}) {
  const T = await loadScript(TESSERACT, "Tesseract");
  ocrWorker ||= await T.createWorker("ita+eng");
  const out = [];
  for (let i = 0; i < images.length; i++) { onStep(`riconosco il testo${images.length > 1 ? `, pagina ${i + 1} di ${images.length}` : ""}`); const r = await ocrWorker.recognize(images[i]); out.push(r.data.text || ""); }
  return out;
}
async function pdfImages(buf, max = 40) {
  const doc = await pdfjs.getDocument({ data: buf, isEvalSupported: false }).promise, imgs = [];
  for (let p = 1; p <= Math.min(doc.numPages, max); p++) {
    const page = await doc.getPage(p), vp = page.getViewport({ scale: 2 }), c = document.createElement("canvas");
    c.width = vp.width; c.height = vp.height; await page.render({ canvasContext: c.getContext("2d"), viewport: vp }).promise; imgs.push(c);
  }
  return imgs;
}
async function sheets(buf) {
  const X = await loadScript(XLSX_URL, "XLSX"); const wb = X.read(buf, { type: "array", cellDates: true });
  return wb.SheetNames.map((n) => `Foglio "${n}"\n` + X.utils.sheet_to_csv(wb.Sheets[n], { FS: " ; ", blankrows: false })).filter((t) => t.split("\n").length > 1);
}
const loadMammoth = () => (mammothP ||= new Promise((res, rej) => { if (window.mammoth) return res(window.mammoth); const s = document.createElement("script"); s.src = MAMMOTH; s.onload = () => res(window.mammoth); s.onerror = () => rej(new Error("libreria Word non raggiungibile")); document.head.appendChild(s); }));
const htmlToText = (h) => { const d = new DOMParser().parseFromString(h, "text/html"); d.querySelectorAll("script,style").forEach((n) => n.remove()); return d.body ? d.body.innerText || d.body.textContent : ""; };

export async function extract(file, onStep = () => {}) {
  if (file.size > MAX_BYTES) throw new Error(`${file.name} supera i 40 MB`);
  const ext = (file.name.split(".").pop() || "").toLowerCase(), buf = await file.arrayBuffer();
  if (ext === "pdf" || file.type === "application/pdf") { const pages = await pdfPages(buf.slice(0)); if (!isScanned(pages)) return pages; onStep(`${file.name} è una scansione: riconosco il testo`); return ocr(await pdfImages(buf), onStep); }
  if (IMAGE.test(ext) || /^image\//.test(file.type)) return ocr([file], onStep);
  if (/^(xlsx|xls|ods)$/.test(ext)) return sheets(buf);
  if (ext === "docx") { const m = await loadMammoth(); const r = await m.extractRawText({ arrayBuffer: buf }); return [r.value]; }
  const text = new TextDecoder("utf-8").decode(buf);
  if (ext === "html" || ext === "htm") return [htmlToText(text)];
  if (ext === "rtf") return [text.replace(/\\par[d]?/g, "\n").replace(/\{\\[^{}]*\}|\\[a-z]+-?\d* ?|[{}]/g, "")];
  return [text];
}

// ------------------------------------------------------------------ indice BM25
export class Library {
  constructor() { this.docs = []; this.rebuild(); }
  async load() { try { this.docs = (await tx("readonly", (st) => st.getAll())) || []; } catch { this.docs = []; } this.rebuild(); return this; }
  rebuild() {
    this.passages = []; this.df = new Map();
    for (const d of this.docs) for (const c of d.chunks) { const tf = new Map(); const tk = tokens(c.text); tk.forEach((w) => tf.set(w, (tf.get(w) || 0) + 1)); this.passages.push({ doc: d.name, docId: d.id, page: c.page, text: c.text, tf, len: tk.length }); }
    for (const p of this.passages) for (const w of p.tf.keys()) this.df.set(w, (this.df.get(w) || 0) + 1);
    this.avg = this.passages.reduce((a, p) => a + p.len, 0) / Math.max(1, this.passages.length);
  }
  get size() { return this.docs.length; }
  async add(file, onStep = () => {}) {
    onStep(`leggo ${file.name}`); const pages = await extract(file, onStep); const chunks = chunk(pages);
    const chars = pages.reduce((a, p) => a + p.trim().length, 0);
    if (!chunks.length || chars < 20) throw new Error(`${file.name} non contiene testo leggibile, nemmeno con il riconoscimento del testo`);
    const doc = { id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, name: file.name, size: file.size, pages: pages.length, chars, added: Date.now(), chunks, text: pages.map((p) => p.replace(/[ \t]+/g, " ").trim()) };
    this.docs = this.docs.filter((d) => d.name !== file.name); try { await tx("readwrite", (st) => st.put(doc)); } catch {}
    this.docs.push(doc); this.rebuild(); return doc;
  }
  async remove(id) { this.docs = this.docs.filter((d) => d.id !== id); try { await tx("readwrite", (st) => st.delete(id)); } catch {} this.rebuild(); }
  /** Documenti da un backup: stessi oggetti salvati in IndexedDB; sostituisce quelli con lo stesso nome. */
  async importDocs(list) {
    let n = 0;
    for (const d of list || []) { if (!d || !d.name || !Array.isArray(d.chunks)) continue; this.docs = this.docs.filter((x) => x.name !== d.name); try { await tx("readwrite", (st) => st.put(d)); } catch {} this.docs.push(d); n++; }
    this.rebuild(); return n;
  }
  async clear() { const ids = this.docs.map((d) => d.id); this.docs = []; try { await tx("readwrite", (st) => ids.forEach((id) => st.delete(id))); } catch {} this.rebuild(); }
  /** I k passaggi più pertinenti, con punteggio BM25. Il nome del documento conta come parte del testo. */
  search(query, k = 4, filterDoc = null) {
    // Frasi esatte tra virgolette ("preavviso di sei mesi"): i passaggi devono contenerle tutte.
    const phrases = [...String(query).matchAll(/["«“]([^"»”]{3,})["»”]/g)].map((m) => fold(m[1]).replace(/\s+/g, " ").trim());
    const q = [...new Set(tokens(query))]; if (!q.length || !this.passages.length) return [];
    const N = this.passages.length, k1 = 1.4, b = 0.75;
    return this.passages.filter((p) => !filterDoc || p.docId === filterDoc).map((p) => {
      let s = 0; const nameTk = tokens(p.doc);
      for (const w of q) { const f = p.tf.get(w) || 0; const df = this.df.get(w) || 0; if (f) { const idf = Math.log(1 + (N - df + 0.5) / (df + 0.5)); s += idf * (f * (k1 + 1)) / (f + k1 * (1 - b + b * p.len / this.avg)); } if (nameTk.includes(w)) s += 0.6; }
      if (phrases.length) { const ft = fold(p.text).replace(/\s+/g, " "); s = phrases.every((ph) => ft.includes(ph)) ? s + 5 : 0; }
      return { ...p, score: s };
    }).filter((p) => p.score > 0).sort((a, b) => b.score - a.score).slice(0, k);
  }
  /** Il documento nominato nella frase ("nel contratto Rossi", "nel file bilancio.pdf"), se c'è. */
  mentioned(query) {
    const qt = new Set(tokens(query)); let best = null, bestHits = 0;
    for (const d of this.docs) { const nt = tokens(d.name.replace(/\.[a-z0-9]+$/i, "")).filter((w) => w.length > 2 && !/^\d+$/.test(w)); const hits = nt.filter((w) => qt.has(w)).length; if (hits > bestHits) { best = d; bestHits = hits; } }
    return best;
  }
  /** Il documento il cui nome contiene la stringa data (senza badare ad accenti e maiuscole). */
  find(name) { const q = fold(name || "").replace(/\.[a-z0-9]+$/, "").trim(); if (!q) return null; return this.docs.find((d) => fold(d.name) === fold(name)) || this.docs.find((d) => fold(d.name).includes(q)) || this.docs.find((d) => tokens(q).every((w) => tokens(d.name).includes(w))) || null; }
  /** Testo completo di un documento con i numeri di pagina, fino a ``max`` caratteri. */
  fullText(id, max = 60000) {
    const d = this.docs.find((x) => x.id === id); if (!d) return "";
    const pages = d.text || [d.chunks.map((c) => c.text).join("\n")];
    let out = ""; for (let i = 0; i < pages.length; i++) { const block = (pages.length > 1 ? `[p. ${i + 1}]\n` : "") + pages[i] + "\n\n"; if (out.length + block.length > max) { out += `[… testo troncato: mostrate ${i} pagine su ${pages.length}]`; break; } out += block; }
    return out;
  }
  /** Testo iniziale di un documento, per i riassunti. */
  head(id, chars = 2600) { const d = this.docs.find((x) => x.id === id); if (!d) return ""; let out = ""; for (const c of d.chunks) { if (out.length + c.text.length > chars) break; out += (c.page ? `[p. ${c.page}] ` : "") + c.text + "\n"; } return out || d.chunks[0].text.slice(0, chars); }
}
