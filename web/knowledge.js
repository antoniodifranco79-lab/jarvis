// Base di conoscenza di J.A.R.V.I.S.: voci che il modello (o l'utente) salva quando impara qualcosa di utile e
// duraturo, dal web, dai documenti o dalla conversazione. Restano nel browser (IndexedDB), si cercano con BM25,
// si esportano e si importano in JSON per portarle su un altro dispositivo.
import { tokens } from "./docs.js";

let dbp = null;
const db = () => (dbp ||= new Promise((res) => {
  try { const r = indexedDB.open("jarvis-knowledge", 1); r.onupgradeneeded = () => r.result.createObjectStore("items", { keyPath: "id" }); r.onsuccess = () => res(r.result); r.onerror = () => res(null); } catch { res(null); }
}));
const tx = async (mode, fn) => { const d = await db(); if (!d) return null; return new Promise((res, rej) => { const t = d.transaction("items", mode), st = t.objectStore("items"); const out = fn(st); t.oncomplete = () => res(out && out.result !== undefined ? out.result : out); t.onerror = () => rej(t.error); }); };
const norm = (s) => tokens(s || "").join(" ");
const clean = (s, max) => String(s || "").replace(/\s+\n/g, "\n").trim().slice(0, max);

export class Knowledge {
  constructor() { this.items = []; this.rebuild(); }
  get size() { return this.items.length; }
  async load() { try { this.items = (await tx("readonly", (st) => st.getAll())) || []; } catch { this.items = []; } this.rebuild(); return this; }
  rebuild() {
    this.df = new Map(); this.idx = this.items.map((it) => { const tf = new Map(); const tk = [...tokens(it.title), ...tokens(it.title), ...tokens(it.content)]; tk.forEach((w) => tf.set(w, (tf.get(w) || 0) + 1)); return { it, tf, len: tk.length }; });
    for (const e of this.idx) for (const w of e.tf.keys()) this.df.set(w, (this.df.get(w) || 0) + 1);
    this.avg = this.idx.reduce((a, e) => a + e.len, 0) / Math.max(1, this.idx.length);
  }
  find(title) { const n = norm(title); return this.items.find((x) => norm(x.title) === n) || null; }
  /** Salva una voce; se esiste già una voce con lo stesso titolo la aggiorna. */
  async learn({ title, content, source = "", origin = "claude" }) {
    title = clean(title, 140); content = clean(content, 8000); source = clean(source, 400);
    if (!title || !content) throw new Error("servono titolo e contenuto");
    const old = this.find(title), now = Date.now();
    const item = old ? { ...old, title, content, source: source || old.source, updated: now, revisions: (old.revisions || 1) + 1 } : { id: `${now}-${Math.random().toString(36).slice(2, 7)}`, title, content, source, origin, created: now, updated: now, revisions: 1 };
    this.items = this.items.filter((x) => x.id !== item.id).concat(item);
    try { await tx("readwrite", (st) => st.put(item)); } catch {}
    this.rebuild(); return { item, updated: !!old };
  }
  async forget(titleOrId) { const it = this.items.find((x) => x.id === titleOrId) || this.find(titleOrId); if (!it) return null; this.items = this.items.filter((x) => x.id !== it.id); try { await tx("readwrite", (st) => st.delete(it.id)); } catch {} this.rebuild(); return it; }
  async clearAll() { const ids = this.items.map((x) => x.id); this.items = []; try { await tx("readwrite", (st) => ids.forEach((id) => st.delete(id))); } catch {} this.rebuild(); }
  search(query, k = 4) {
    const q = [...new Set(tokens(query))]; if (!q.length || !this.idx.length) return [];
    const N = this.idx.length, k1 = 1.2, b = 0.75;
    return this.idx.map((e) => { let s = 0, hits = 0; for (const w of q) { const f = e.tf.get(w) || 0; if (!f) continue; hits++; const df = this.df.get(w) || 0; s += Math.log(1 + (N - df + 0.5) / (df + 0.5)) * (f * (k1 + 1)) / (f + k1 * (1 - b + b * e.len / this.avg)); } return { ...e.it, score: s, hits }; })
      .filter((x) => x.score > 0).sort((a, b) => b.score - a.score).slice(0, k);
  }
  /** Voci abbastanza vicine alla domanda da meritare di essere usate: almeno due parole chiave in comune, o un punteggio alto. */
  relevant(query, k = 3) { return this.search(query, k).filter((x) => x.hits >= 2 || x.score >= 1.6); }
  recent(k = 50) { return this.items.slice().sort((a, b) => b.updated - a.updated).slice(0, k); }
  export() { return JSON.stringify({ format: "jarvis-knowledge", version: 1, exported: new Date().toISOString(), items: this.items }, null, 2); }
  async import(json) {
    const data = typeof json === "string" ? JSON.parse(json) : json; const list = Array.isArray(data) ? data : data.items;
    if (!Array.isArray(list)) throw new Error("file non valido: manca l'elenco delle voci");
    let n = 0; for (const it of list) { if (it && it.title && it.content) { await this.learn({ title: it.title, content: it.content, source: it.source || "", origin: it.origin || "import" }); n++; } }
    return n;
  }
}
