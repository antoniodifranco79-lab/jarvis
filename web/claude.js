// J.A.R.V.I.S. con Claude: il cervello è un modello Anthropic via API, con la chiave dell'utente
// salvata solo in questo browser. Le mani (documenti, calcoli da studio, meteo, promemoria, memoria)
// restano in JavaScript locale e Claude le chiama come strumenti; la ricerca web è lato server.
import Anthropic from "https://cdn.jsdelivr.net/npm/@anthropic-ai/sdk@1.3.0/+esm";
import { TOOL_DEFS, validateInput } from "./tools.js";

export const CLAUDE_MODELS = {
  "claude-opus-5-5": "Claude Opus 5.5",
  "claude-fable-5-2": "Claude Fable 5.2",
  "claude-sonnet-5-5": "Claude Sonnet 5.5",
  "claude-haiku-5-5": "Claude Haiku 5.5",
};
export const DEFAULT_CLAUDE_MODEL = "claude-opus-5-5";
const MAX_CONTINUATIONS = 6, MAX_ROUNDS = 12, MAX_HISTORY_MESSAGES = 80, MAX_HISTORY_BYTES = 1_500_000;

// ------------------------------------------------------------------ strumenti (definiti in tools.js)
export const toolDefinitions = () => [
  ...TOOL_DEFS.map((t) => ({ ...t, eager_input_streaming: true })),
  { type: "web_search_20260209", name: "web_search", max_uses: 5, user_location: { type: "approximate", country: "IT" } },
  { type: "web_fetch_20260209", name: "web_fetch", max_uses: 5 },
];
export { validateInput };

// ------------------------------------------------------------------ prompt di sistema (fisso per tutta la sessione)
export const systemPrompt = (name) => `Sei J.A.R.V.I.S., l'assistente personale di ${name}: calmo, preciso, educato, con un'ironia britannica leggera e asciutta. Chiami l'utente "${name}". Rispondi nella lingua in cui ti scrivono (di solito italiano).

Come parli
- Le risposte vengono anche lette ad alta voce: vai dritto alla risposta, di solito da una a quattro frasi. Per riassunti, confronti e procedure usa un breve elenco con "- ". Niente tabelle, niente titoli markdown, niente grassetti.
- Nessun preambolo ("Certamente!", "Ottima domanda").

Come lavori
- Hai strumenti: usali con decisione invece di descrivere cosa faresti. Più chiamate indipendenti: falle in parallelo.
- Documenti dell'utente: quando la domanda può riguardare un suo documento, chiama search_documents (o read_document per riassunti e analisi complete) e rispondi solo da quei testi, citando i passaggi come [1], [2]. Se l'informazione non c'è, dillo.
- Numeri fiscali, date e scadenze: usa sempre gli strumenti di calcolo e riporta i numeri esattamente come li restituiscono.
- Fatti che cambiano (notizie, prezzi, norme recenti, scadenze fiscali dell'anno): cerca sul web e cita la fonte.
- Quando l'utente ti dice qualcosa di personale che vale la pena ricordare (preferenze, nomi), chiama ricorda.

Come impari
- Hai una base di conoscenza che cresce con te. Quando apprendi qualcosa di utile e duraturo (dal web, da una pagina che leggi con web_fetch, da un documento, da ciò che l'utente ti insegna), salvalo con impara: titolo breve, contenuto sintetico con date e numeri esatti, fonte. Non salvare chiacchiere né cose effimere.
- Se l'utente ti chiede di studiare un argomento, cerca sul web, leggi con web_fetch le due o tre fonti migliori (meglio se ufficiali) e salva ciò che conta in voci separate; poi riassumi cosa hai imparato.
- Se l'utente ti dà un link, leggilo con web_fetch. Se ti chiede di imparare da un documento, leggilo con read_document e salva i punti chiave.
- Prima di rispondere su un tema che potresti aver già studiato, consulta la conoscenza: le voci più pertinenti ti arrivano già nel [Contesto]; per altro usa cerca_conoscenza. Se una voce è superata, aggiornala con lo stesso titolo.
- All'inizio di ogni messaggio dell'utente trovi un blocco [Contesto] con data, ora, fatti memorizzati, documenti caricati e conoscenze pertinenti: usalo, non ripeterlo.

Confini
- Non inventare mai fatti, numeri, nomi, norme o risultati di strumenti. Se non sai, dillo e suggerisci come verificare.
- Su questioni legali, fiscali e mediche dai informazioni accurate ma ricorda di verificarle con la fonte ufficiale o un professionista quando la decisione è importante.
- Resti J.A.R.V.I.S.; se l'utente chiede come funzioni, rispondi con onestà: sei basato su Claude di Anthropic, con strumenti locali nel browser.`;

// ------------------------------------------------------------------ sessione
export class ClaudeSession {
  constructor({ getKey, getModel, getName, getEffort, store, tools }) { Object.assign(this, { getKey, getModel, getName, getEffort, store, tools }); this.messages = store.get("claudeHistory", []); this.system = store.get("claudeSystem", ""); this.stream = null; this.aborted = false; }
  get size() { return this.messages.length; }
  reset() { this.messages = []; this.system = ""; this.save(); }
  save() { const json = JSON.stringify(this.messages); if (json.length > MAX_HISTORY_BYTES) { this.messages = []; } this.store.set("claudeHistory", this.messages); this.store.set("claudeSystem", this.system); }
  abort() { this.aborted = true; try { this.stream?.abort(); } catch {} }
  client() { return new Anthropic({ apiKey: this.getKey(), dangerouslyAllowBrowser: true, maxRetries: 2 }); }

  /** Una domanda dell'utente: esegue il ciclo strumenti finché Claude ha finito. Callbacks: onText(delta), onThinking(), onTool(name, input), onSources(list). */
  async ask(userText, context, cb) {
    this.aborted = false;
    // La sessione cresce solo in coda (append-only): così i blocchi di ragionamento restano validi e la cache del prompt calda.
    const system = systemPrompt(this.getName());
    if (this.system !== system || this.messages.length > MAX_HISTORY_MESSAGES) { if (this.messages.length) cb.onNotice?.("Conversazione lunga: riparto da una sessione nuova con Claude."); this.messages = []; this.system = system; }
    const start = this.messages.length;
    this.messages.push({ role: "user", content: [{ type: "text", text: `[Contesto] ${context}` }, { type: "text", text: userText }] });
    const sources = [], webSources = new Map(); let answer = "", continuations = 0, rounds = 0, extras = true;
    try {
      while (true) {
        if (this.aborted) throw new Error("interrotto");
        const model = this.getModel();
        const params = {
          model, max_tokens: 64000, system, messages: this.messages, tools: toolDefinitions(),
          output_config: { effort: this.getEffort() },
        };
        if (extras) {
          // Opzioni consigliate: ripiego automatico su un altro modello in caso di rifiuto, e blocchi di ragionamento
          // scartati invece di un errore se la cronologia non combacia. Se l'API le rifiuta, si riprova senza.
          params.cache_control = { type: "ephemeral" }; // cache automatica di sistema, strumenti e cronologia
          params.betas = ["thinking-binding-controls-2026-08-01"];
          params.thinking = { type: "adaptive", block_binding: { prefix_mismatch_behavior: "drop_block" } };
          if (model !== "claude-haiku-5-5") { params.betas.push("server-side-fallback-2026-07-01"); params.fallbacks = "default"; }
        }
        let message;
        try {
          this.stream = this.client().beta.messages.stream(params);
          this.stream.on("streamEvent", (ev) => { if (ev.type === "content_block_start" && ev.content_block?.type === "thinking") cb.onThinking?.(); });
          this.stream.on("text", (d) => { answer += d; cb.onText(d); });
          message = await this.stream.finalMessage();
        } catch (err) {
          if (err instanceof Anthropic.BadRequestError && extras && /beta|fallback|block_binding|thinking|cache_control|unknown|extra|not permitted|not supported/i.test(String(err.message))) { extras = false; continue; }
          if (!(err instanceof Anthropic.APIError) && !this.aborted && rounds < 2 && /json/i.test(String(err.message))) { rounds++; continue; } // input di strumento illeggibile: si ripete il turno
          throw err;
        } finally { this.stream = null; }
        rounds++;
        for (const b of message.content) if (b.type === "text" && Array.isArray(b.citations)) for (const c of b.citations) if (c.url) webSources.set(c.url, c.title || c.url);
        if (message.stop_reason === "refusal") { this.messages.length = start; this.save(); return { answer: answer || "Su questa richiesta Claude ha preferito non rispondere.", sources, web: [...webSources], refused: true }; }
        if (message.stop_reason === "pause_turn") { this.messages.push({ role: "assistant", content: message.content }); if (++continuations > MAX_CONTINUATIONS) break; continue; }
        const toolUses = message.content.filter((b) => b.type === "tool_use");
        if (!toolUses.length) { this.messages.push({ role: "assistant", content: message.content }); break; }
        if (message.stop_reason === "max_tokens") throw new Error("risposta troncata: riprovi con una domanda più circoscritta");
        if (rounds > MAX_ROUNDS) throw new Error("troppi passaggi con gli strumenti");
        this.messages.push({ role: "assistant", content: message.content });
        if (answer && !/\s$/.test(answer)) { answer += "\n"; cb.onText("\n"); }
        const results = await Promise.all(toolUses.map(async (tu) => {
          const bad = validateInput(tu.name, tu.input);
          if (bad) return { type: "tool_result", tool_use_id: tu.id, is_error: true, content: JSON.stringify({ INVALID_JSON: JSON.stringify(tu.input), errore: bad }) };
          cb.onTool?.(tu.name, tu.input);
          try { const out = await this.tools[tu.name](tu.input); if (out.sources) sources.push(...out.sources); return { type: "tool_result", tool_use_id: tu.id, content: out.text }; }
          catch (e) { return { type: "tool_result", tool_use_id: tu.id, is_error: true, content: String(e.message || e) }; }
        }));
        this.messages.push({ role: "user", content: results });
      }
      this.save();
      return { answer, sources, web: [...webSources] };
    } catch (err) {
      this.messages.length = start; this.save(); // il turno non riuscito si toglie per intero, dalla coda
      throw new Error(explain(err, this.aborted));
    }
  }
}

export function explain(err, aborted) {
  if (aborted || err instanceof Anthropic.APIUserAbortError) return "Interrotto.";
  if (err instanceof Anthropic.AuthenticationError) return "La chiave API di Claude non è valida o è stata revocata. La controlli nelle impostazioni.";
  if (err instanceof Anthropic.PermissionDeniedError) return "La chiave non ha accesso a questo modello. Ne scelga un altro nelle impostazioni.";
  if (err instanceof Anthropic.NotFoundError) return "Modello non disponibile per questa chiave. Ne scelga un altro nelle impostazioni.";
  if (err instanceof Anthropic.RateLimitError) return "Troppe richieste o credito esaurito. Attenda un minuto, oppure controlli il credito su console.anthropic.com.";
  if (err instanceof Anthropic.BadRequestError) return "Richiesta rifiutata dall'API: " + (err.message || "").slice(0, 200);
  if (err instanceof Anthropic.APIConnectionError) return "Non raggiungo Claude: controlli la connessione.";
  if (err instanceof Anthropic.APIError) return `Errore del servizio Claude (${err.status ?? "?"}). Riprovi tra poco.`;
  return String(err.message || err);
}

/** Verifica una chiave con una chiamata leggera all'API dei modelli. */
export async function checkKey(apiKey, model) {
  const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true, maxRetries: 1 });
  try { await client.models.retrieve(model); return null; } catch (e) { return explain(e, false); }
}
