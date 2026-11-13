// Agente locale: il modello nel browser (Qwen3 via WebLLM) usa gli strumenti di J.A.R.V.I.S. con il formato
// <tool_call> su cui Qwen3 è addestrato. Nessuna chiave e nessun server: tutto gira sul dispositivo.
import { TOOL_DEFS, validateInput } from "./tools.js";

const firstSentence = (d) => (d.match(/^.*?[.!?](\s|$)/) || [d])[0].trim();

/** Blocco strumenti nel formato Qwen (Hermes): firme JSON tra <tools></tools>, chiamate tra <tool_call></tool_call>. */
export function toolsBlock(defs = TOOL_DEFS) {
  const fns = defs.map((t) => JSON.stringify({ type: "function", function: { name: t.name, description: firstSentence(t.description), parameters: t.input_schema } }));
  return `# Strumenti

Puoi chiamare funzioni per aiutare l'utente. Le firme sono tra <tools></tools>:
<tools>
${fns.join("\n")}
</tools>

Per chiamare una funzione rispondi soltanto con un oggetto JSON tra i tag <tool_call></tool_call>:
<tool_call>
{"name": "nome_funzione", "arguments": {"parametro": "valore"}}
</tool_call>
Il risultato ti arriva tra <tool_response></tool_response>; a quel punto rispondi all'utente oppure chiama un'altra funzione.`;
}

/** Estrae le chiamate (anche senza tag di chiusura, che il motore può tagliare come sequenza di stop). */
export function parseToolCalls(text) {
  const calls = [], re = /<tool_call>\s*([\s\S]*?)\s*(?:<\/tool_call>|$)/g; let m;
  while ((m = re.exec(text))) {
    const raw = m[1].trim(); if (!raw) continue;
    try { const j = JSON.parse(raw.replace(/^```(?:json)?|```$/g, "").trim()); if (j && typeof j.name === "string") calls.push({ name: j.name, arguments: typeof j.arguments === "string" ? JSON.parse(j.arguments) : j.arguments || j.parameters || {} }); else calls.push({ name: null, raw }); }
    catch { calls.push({ name: null, raw }); }
  }
  return calls;
}
/** Risposta da scartare: testo di altri alfabeti in una conversazione italiana o inglese, parole ripetute a raffica,
 *  simboli a caso, oppure un frammento di una o due parole a una domanda vera. Succede con alcuni driver grafici
 *  dei telefoni (calcoli a 16 bit) o quando un modello piccolo si perde. */
export function looksBroken(answer, question = "") {
  const a = String(answer || "").trim(); if (!a) return true;
  if (/\[(Contesto|Passaggi|Risultato strumento)\]|<\/?tool_(call|response)>|<\|im_(start|end)\|>/.test(a)) return true; // il modello ripete il prompt
  const letters = a.replace(/[\s\d\p{P}\p{S}]/gu, ""); if (!letters.length) return a.length > 0 && question.length > 12;
  const foreign = (letters.match(/[^\p{Script=Latin}]/gu) || []).length; if (foreign / letters.length > 0.3) return true;
  const symbols = (a.match(/[^\p{L}\p{N}\s.,;:!?'"«»()\-–—€%/°@#&*+=\[\]]/gu) || []).length; if (symbols / a.length > 0.15) return true;
  const words = a.toLowerCase().match(/[\p{L}\p{N}']+/gu) || [];
  let run = 1; for (let i = 1; i < words.length; i++) { run = words[i] === words[i - 1] ? run + 1 : 1; if (run >= 4) return true; }
  if (words.length >= 12 && new Set(words).size / words.length < 0.25) return true;
  if (words.length <= 2 && question.trim().split(/\s+/).length >= 4 && !/^(sì|si|no|ok|certo|fatto|esatto|yes)(?![\p{L}])/iu.test(a)) return true;
  return false;
}
export const visibleText = (t) => t.replace(/<think>[\s\S]*?(<\/think>|$)/g, "").replace(/<tool_call>[\s\S]*?(<\/tool_call>|$)/g, "").replace(/<\/?tool_(?:call|response)>/g, "").trim();

/** I modelli piccoli sbagliano i tipi: "1220" al posto di 1220, campi in più. Si correggono prima di validare. */
export function coerceArgs(name, args) {
  const def = TOOL_DEFS.find((t) => t.name === name); if (!def || !args || typeof args !== "object") return args;
  const props = def.input_schema.properties || {}, out = {};
  for (const [k, v] of Object.entries(args)) {
    const p = props[k]; if (!p) continue;
    if ((p.type === "number" || p.type === "integer") && typeof v === "string" && v.trim() !== "") { const n = Number(v.replace(/\./g, "").replace(",", ".").replace(/[^\d.-]/g, "")); out[k] = p.type === "integer" ? Math.round(n) : n; }
    else if (p.type === "boolean" && typeof v === "string") out[k] = /^(true|si|sì|yes|1)$/i.test(v);
    else if (p.type === "string" && typeof v === "number") out[k] = String(v);
    else out[k] = v;
  }
  return out;
}

/**
 * Esegue una domanda con il ciclo strumenti. engine: motore WebLLM (chat.completions.create in streaming).
 * Callbacks: onText(delta), onTool(name, args), onThinking(). Restituisce {answer, sources, rounds}.
 */
export async function runLocalAgent({ engine, system, history = [], userContent, tools, think = false, onText, onTool, onThinking, maxRounds = 4, resultChars = 3500, isAborted = () => false, temperature = 0.5, maxTokens = 900 }) {
  const suffix = think ? "" : " /no_think";
  const messages = [{ role: "system", content: system }, ...history, { role: "user", content: userContent + suffix }];
  const sources = []; let answer = "", rounds = 0, final = false;
  while (true) {
    let out = "", shown = "";
    // Campionamento consigliato per Qwen3 senza ragionamento (top_p 0,8) con penalità leggere contro i giri a vuoto.
    const stream = await engine.chat.completions.create({ messages, stream: true, temperature, top_p: 0.8, presence_penalty: 0.3, frequency_penalty: 0.2, max_tokens: think ? 2600 : maxTokens, stop: ["</tool_call>"] });
    for await (const chunk of stream) {
      const d = chunk.choices?.[0]?.delta?.content || ""; if (!d) continue; out += d;
      if (/<think>(?![\s\S]*<\/think>)/.test(out)) onThinking?.();
      const safe = visibleText(out).replace(/<[^>]*$/, "").replace(/\s+$/, (w) => (w.includes("\n") ? "" : w));
      if (safe.length > shown.length && safe.startsWith(shown)) { onText?.(safe.slice(shown.length)); shown = safe; }
    }
    if (shown) answer += (answer ? "\n" : "") + shown;
    const calls = out.includes("<tool_call>") ? parseToolCalls(out) : [];
    if (!calls.length || final || isAborted()) break;
    const cleanOut = out.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
    if (rounds >= maxRounds) {
      // Strumenti esauriti: invece di lasciare l'utente senza risposta, chiede una risposta con quello che ha già.
      if (maxRounds === 0 || answer) break;
      final = true;
      messages.push({ role: "assistant", content: cleanOut.includes("</tool_call>") ? cleanOut : cleanOut + "\n</tool_call>" });
      messages.push({ role: "user", content: "<tool_response>\nLimite di strumenti raggiunto. Rispondi ora all'utente con le informazioni che hai già, senza chiamare altri strumenti.\n</tool_response>" + suffix });
      continue;
    }
    rounds++;
    messages.push({ role: "assistant", content: cleanOut.includes("</tool_call>") ? cleanOut : cleanOut + "\n</tool_call>" });
    const results = [];
    for (const c of calls) {
      if (!c.name) { results.push(`Errore: la chiamata non è JSON valido (${String(c.raw).slice(0, 160)}). Riprova con JSON valido.`); continue; }
      if (!tools[c.name]) { results.push(`Errore: lo strumento "${c.name}" non esiste.`); continue; }
      const args = coerceArgs(c.name, c.arguments), bad = validateInput(c.name, args);
      if (bad) { results.push(`Errore negli argomenti di ${c.name}: ${bad}.`); continue; }
      onTool?.(c.name, args);
      try { const r = await tools[c.name](args); if (r.sources) sources.push(...r.sources); const txt = String(r.text); results.push(txt.length > resultChars ? txt.slice(0, resultChars) + "\n[… testo troncato]" : txt); }
      catch (e) { results.push(`Errore: ${e.message || e}`); }
    }
    messages.push({ role: "user", content: results.map((r) => `<tool_response>\n${r}\n</tool_response>`).join("\n") + suffix });
  }
  return { answer: answer.trim(), sources, rounds };
}
