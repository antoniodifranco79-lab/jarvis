// "Potenza massima" senza chiave API: i modelli di punta (Claude in testa) tramite Puter.js. Chi usa l'app accede con
// un account Puter gratuito; l'uso è conteggiato sul suo account (credito gratuito incluso, poi a pagamento su Puter).
// J.A.R.V.I.S. passa a Puter gli stessi strumenti del cervello locale, in formato OpenAI (che Puter uniforma).
import { TOOL_DEFS, validateInput } from "./tools.js";

const PUTER_JS = "https://js.puter.com/v2/";
const PREFERRED = ["claude-fable-5-2", "claude-opus-5-5", "claude-opus-5", "claude-opus-4-8", "claude-opus-4-7", "claude-opus-4-6", "claude-sonnet-5-5", "claude-sonnet-4-6", "gpt-5.5", "gemini-3"];
const MAX_ROUNDS = 10, MAX_MESSAGES = 80;

let loading = null;
export function loadPuter() {
  if (window.puter) return Promise.resolve(window.puter);
  return (loading ||= new Promise((res, rej) => {
    const s = document.createElement("script"); s.src = PUTER_JS; s.async = true;
    s.onload = () => (window.puter ? res(window.puter) : rej(new Error("Puter.js non si è inizializzato")));
    s.onerror = () => { loading = null; rej(new Error("non riesco a scaricare Puter.js (connessione?)")); };
    document.head.appendChild(s);
  }));
}
export const isSignedIn = () => { try { return !!window.puter?.auth?.isSignedIn(); } catch { return false; } };
/** Da chiamare dentro un clic: apre la finestra di accesso di Puter. */
export async function signIn() { const p = await loadPuter(); await p.auth.signIn(); return isSignedIn(); }

/** Il modello più capace tra quelli che Puter offre adesso, secondo l'ordine di preferenza. */
export async function bestModel(preferred) {
  const p = await loadPuter();
  let ids = [];
  try { ids = (await p.ai.listModels()).map((m) => String(m.id || "")); } catch {}
  if (preferred && (!ids.length || ids.includes(preferred))) return preferred;
  for (const want of PREFERRED) { const hit = ids.find((id) => id === want || id.endsWith("/" + want)) || ids.find((id) => id.includes(want)); if (hit) return hit; }
  return preferred || "claude-opus-4-6";
}
export const prettyModel = (id) => String(id || "").replace(/^.*\//, "").replace(/^claude-/, "Claude ").replace(/-(\d)-(\d)$/, " $1.$2").replace(/-(\d)$/, " $1").replace(/\b(opus|sonnet|haiku|fable)\b/i, (w) => w[0].toUpperCase() + w.slice(1));

const tools = () => TOOL_DEFS.map((t) => ({ type: "function", function: { name: t.name, description: t.description, parameters: t.input_schema } }));

export class PuterSession {
  constructor({ getModel, setModel, getName, store, tools: impl, system }) { Object.assign(this, { getModel, setModel, getName, store, impl, system }); this.messages = store.get("puterHistory", []); this.abortCtl = null; this.aborted = false; }
  reset() { this.messages = []; this.store.set("puterHistory", []); }
  save() { if (JSON.stringify(this.messages).length > 1_000_000) this.messages = []; this.store.set("puterHistory", this.messages); }
  abort() { this.aborted = true; try { this.abortCtl?.abort(); } catch {} }

  async ask(text, context, cb) {
    const p = await loadPuter();
    if (!isSignedIn()) throw new Error("Per la potenza massima serve l'accesso a Puter: prema \"Accedi con Puter\" nelle impostazioni.");
    let model = this.getModel(); if (!model) { model = await bestModel(); this.setModel(model); }
    this.aborted = false;
    if (this.messages.length > MAX_MESSAGES) this.messages = [];
    const start = this.messages.length, sources = [];
    this.messages.push({ role: "user", content: `[Contesto] ${context}\n\n${text}` });
    let answer = "";
    try {
      for (let round = 0; round <= MAX_ROUNDS; round++) {
        if (this.aborted) throw new Error("Interrotto.");
        this.abortCtl = new AbortController();
        const req = [{ role: "system", content: this.system() }, ...this.messages];
        const opts = { model, tools: tools(), max_tokens: 4096, signal: this.abortCtl.signal };
        let textOut = "", calls = [];
        try {
          const stream = await p.ai.chat(req, { ...opts, stream: true });
          for await (const part of stream) {
            if (part.type === "text" && part.text) { textOut += part.text; cb.onText(part.text); }
            else if (part.type === "reasoning" || part.type === "reasoning_start") cb.onThinking?.();
            else if (part.type === "tool_use") calls.push({ id: part.id, name: part.name, input: part.input || {} });
            else if (part.type === "error") throw new Error(part.message || "errore del modello");
          }
        } catch (e) {
          if (this.aborted || /abort/i.test(String(e?.name))) throw new Error("Interrotto.");
          if (textOut || calls.length) throw e;
          // Ripiego senza streaming, con la forma di risposta uniforme di Puter.
          const r = await p.ai.chat(req, { ...opts, normalize: true });
          const msg = r?.message || {}; textOut = typeof msg.content === "string" ? msg.content : Array.isArray(msg.content) ? msg.content.map((c) => c.text || "").join("") : String(r || "");
          if (textOut) cb.onText(textOut);
          calls = (msg.tool_calls || []).map((c) => ({ id: c.id, name: c.function?.name, input: (() => { try { return JSON.parse(c.function?.arguments || "{}"); } catch { return null; } })() }));
        }
        if (textOut) answer += (answer ? "\n" : "") + textOut;
        if (!calls.length) { this.messages.push({ role: "assistant", content: textOut || "" }); break; }
        this.messages.push({ role: "assistant", content: textOut || "", tool_calls: calls.map((c) => ({ id: c.id, type: "function", function: { name: c.name, arguments: JSON.stringify(c.input || {}) } })) });
        for (const c of calls) {
          let out;
          const bad = c.input === null ? "argomenti non in JSON valido" : validateInput(c.name, c.input);
          if (!this.impl[c.name]) out = `Errore: lo strumento "${c.name}" non esiste.`;
          else if (bad) out = `Errore negli argomenti: ${bad}.`;
          else { cb.onTool?.(c.name, c.input); try { const r = await this.impl[c.name](c.input); if (r.sources) sources.push(...r.sources); out = String(r.text).slice(0, 20000); } catch (e) { out = `Errore: ${e.message || e}`; } }
          this.messages.push({ role: "tool", tool_call_id: c.id, content: out });
        }
      }
      this.save();
      return { answer, sources, model };
    } catch (e) {
      this.messages.length = start; this.save();
      throw new Error(explain(e));
    }
  }
}

export function explain(e) {
  const m = String(e?.message || e?.error?.message || e || "");
  if (/interrott/i.test(m)) return "Interrotto.";
  if (/insufficient|funds|credit|limit|quota|402/i.test(m)) return "Il credito gratuito di Puter per questo account è esaurito per ora. Riprovi più tardi, ricarichi su puter.com, oppure torni al cervello locale nelle impostazioni.";
  if (/auth|sign|401|403|token/i.test(m)) return "Serve di nuovo l'accesso a Puter: prema \"Accedi con Puter\" nelle impostazioni.";
  if (/fetch|network|connection/i.test(m)) return "Non raggiungo Puter: controlli la connessione.";
  return m.slice(0, 200) || "Errore sconosciuto di Puter.";
}
