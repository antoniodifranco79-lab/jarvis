// Riassunti di documenti di qualsiasi lunghezza con un modello piccolo: il testo si divide in parti, ogni parte
// diventa pochi punti (con la pagina), poi i punti si uniscono, anche a più livelli. Funziona con ogni motore
// compatibile con chat.completions.create in streaming (WebLLM, wllama).
import { visibleText } from "./localagent.js";

/** Divide il testo in parti di circa `size` caratteri, su paragrafi, ricordando l'ultima pagina vista. */
export function splitParts(text, size = 3000) {
  const paras = String(text || "").split(/\n{2,}|(?=\[p\. \d+\])/).map((p) => p.trim()).filter(Boolean);
  const parts = []; let cur = "", page = "";
  for (const p of paras) {
    const pm = /^\[p\. (\d+)\]/.exec(p); if (pm) page = pm[1];
    if ((cur + "\n\n" + p).length > size && cur) { parts.push(cur); cur = page && !pm ? `[p. ${page}] ` : ""; }
    if (p.length > size) { for (let i = 0; i < p.length; i += size) parts.push((page ? `[p. ${page}] ` : "") + p.slice(i, i + size)); cur = ""; continue; }
    cur = cur ? cur + "\n\n" + p : p;
  }
  if (cur.trim()) parts.push(cur);
  return parts;
}

async function complete(engine, system, user, maxTokens) {
  const stream = await engine.chat.completions.create({ messages: [{ role: "system", content: system }, { role: "user", content: user + " /no_think" }], stream: true, temperature: 0.2, max_tokens: maxTokens });
  let out = ""; for await (const ch of stream) out += ch?.choices?.[0]?.delta?.content || "";
  return visibleText(out);
}

const SYS = "Sei un assistente che riassume documenti professionali in italiano. Sei fedele al testo: non aggiungi nulla, riporti nomi, date, importi, scadenze e obblighi esatti.";

/**
 * Riassume `text`. onProgress(fase, fatto, totale). focus: aspetto su cui concentrarsi (facoltativo).
 * Restituisce il riassunto finale (punti con "- ").
 */
export async function summarize({ engine, text, title = "documento", focus = "", onProgress = () => {}, partChars = 3000, maxParts = 40, isAborted = () => false }) {
  let parts = splitParts(text, partChars); const truncated = parts.length > maxParts; parts = parts.slice(0, maxParts);
  const want = focus ? ` concentrandoti su: ${focus}` : "";
  if (parts.length === 1) {
    onProgress("riassunto", 1, 1);
    return await complete(engine, SYS, `Documento "${title}".\n\n${parts[0]}\n\nRiassumi${want} in 5-8 punti, ciascuno su una riga che inizia con "- ", con la pagina [p. N] quando indicata.`, 700);
  }
  let notes = [];
  for (let i = 0; i < parts.length; i++) {
    if (isAborted()) throw new Error("Interrotto.");
    onProgress("lettura", i + 1, parts.length);
    notes.push(await complete(engine, SYS, `Documento "${title}", parte ${i + 1} di ${parts.length}.\n\n${parts[i]}\n\nScrivi da 2 a 5 punti con i fatti essenziali${want} (nomi, date, importi, obblighi), ciascuno su una riga che inizia con "- ", con la pagina [p. N] quando indicata. Solo i punti.`, 320));
  }
  // Unione a livelli: gruppi di 8 note alla volta, finché ne resta una.
  let level = 0;
  while (notes.length > 1) {
    level++; const groups = []; for (let i = 0; i < notes.length; i += 8) groups.push(notes.slice(i, i + 8));
    const merged = [];
    for (let g = 0; g < groups.length; g++) {
      if (isAborted()) throw new Error("Interrotto.");
      onProgress("unione", g + 1, groups.length);
      const final = groups.length === 1;
      merged.push(await complete(engine, SYS, `Appunti su parti consecutive del documento "${title}":\n\n${groups[g].join("\n")}\n\n${final ? `Scrivi il riassunto finale${want}: una frase di sintesi, poi da 5 a 8 punti con "- ", senza ripetizioni, mantenendo date, importi e pagine.` : `Unisci questi appunti in 4-6 punti con "- "${want}, senza ripetizioni, mantenendo date, importi e pagine.`}`, final ? 700 : 400));
    }
    notes = merged;
  }
  return notes[0] + (truncated ? `\n\n(Riassunte le prime ${maxParts} parti del documento: il resto è troppo lungo per questo dispositivo.)` : "");
}

const FILLER = /\b(riassum\w*|riassunto|sintesi|sintetizz\w*|summari[sz]e|di cosa parla|fammi|fai|mi|un|una|uno|il|lo|la|le|i|gli|l|del|della|dello|dei|delle|degli|di|da|sul|sulla|sullo|sulle|sui|sugli|su|al|alla|allo|alle|ai|agli|a|riguardo|soprattutto|concentrandoti|concentrati|concentrandosi|focalizzandoti|parte|parti|per|favore|perfavore|documento|contratto|file|pdf|testo|breve|completo|intero|tutto|tutta|in|e|ed|con|questo|questa|quello|quella|cosa|parla|dice)\b/gi;
/** Il tema su cui concentrare il riassunto ("riassumi il contratto Rossi sulle penali" → "penali"), o "". */
export function summaryFocus(question, docName = "") {
  let q = " " + String(question || "").toLowerCase().replace(/[’']/g, " ") + " ";
  for (const w of String(docName).toLowerCase().replace(/\.[a-z0-9]+$/i, "").split(/[^\p{L}\p{N}]+/u)) if (w.length > 1) q = q.replace(new RegExp(`(^|[^\\p{L}\\p{N}])${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?=$|[^\\p{L}\\p{N}])`, "giu"), " ");
  q = q.replace(FILLER, " ").replace(/[^\p{L}\p{N}\s-]+/gu, " ").replace(/\s+/g, " ").trim();
  return q.length > 3 ? q : "";
}
