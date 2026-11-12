import test from "node:test";
import assert from "node:assert/strict";
import { parseToolCalls, visibleText, coerceArgs, runLocalAgent, toolsBlock } from "../localagent.js";
import { TOOL_DEFS, validateInput } from "../tools.js";

/** Motore finto: restituisce in ordine le risposte date, applicando lo stop come fa WebLLM. */
function engine(replies) {
  const calls = [];
  return { calls, chat: { completions: { create: async (req) => { calls.push(JSON.parse(JSON.stringify(req))); let t = replies[calls.length - 1] ?? "ok"; for (const s of req.stop || []) { const i = t.indexOf(s); if (i >= 0) t = t.slice(0, i); } return (async function* () { for (const p of t.match(/.{1,5}/gs) || []) yield { choices: [{ delta: { content: p } }] }; })(); } } } };
}

test("parseToolCalls e visibleText", () => {
  const out = 'Controllo.<tool_call>\n{"name": "calcola_iva", "arguments": {"importo": "1.000", "aliquota": 22}}\n</tool_call>';
  const c = parseToolCalls(out); assert.equal(c.length, 1); assert.equal(c[0].name, "calcola_iva");
  assert.equal(visibleText("<think>x</think>Ciao<tool_call>{}</tool_call>"), "Ciao");
  assert.equal(visibleText("<think>non finito"), "");
  assert.ok(!parseToolCalls("<tool_call>{non json</tool_call>")[0].name);
});

test("toolsBlock elenca tutti gli strumenti, inclusa la bozza Word", () => {
  const b = toolsBlock(); for (const d of TOOL_DEFS) assert.ok(b.includes(`"${d.name}"`), d.name);
  assert.ok(TOOL_DEFS.some((d) => d.name === "crea_bozza"));
  assert.equal(new Set(TOOL_DEFS.map((d) => d.name)).size, TOOL_DEFS.length, "nomi unici");
});

test("validateInput", () => {
  assert.equal(validateInput("crea_bozza", { titolo: "Lettera", testo: "Gentile..." }), null);
  assert.ok(validateInput("crea_bozza", { titolo: "Lettera" }));
  assert.ok(coerceArgs("calcola_iva", { importo: "1000" }));
});

test("ciclo strumento → risposta", async () => {
  const e = engine(['<tool_call>\n{"name": "calcola", "arguments": {"espressione": "2+3"}}\n</tool_call>', "Il risultato è 5."]);
  const seen = []; const tools = { calcola: async ({ espressione }) => ({ text: String(eval(espressione)) }) };
  const r = await runLocalAgent({ engine: e, system: "s", userContent: "2+3?", tools, onTool: (n) => seen.push(n) });
  assert.equal(r.answer, "Il risultato è 5."); assert.deepEqual(seen, ["calcola"]); assert.equal(r.rounds, 1);
  assert.match(e.calls[1].messages.at(-1).content, /<tool_response>\n5\n<\/tool_response>/);
});

test("strumenti esauriti: chiede comunque una risposta finale", async () => {
  const call = '<tool_call>\n{"name": "calcola", "arguments": {"espressione": "1+1"}}\n</tool_call>';
  const e = engine([call, call, "Ecco quello che so."]);
  const r = await runLocalAgent({ engine: e, system: "s", userContent: "?", tools: { calcola: async () => ({ text: "2" }) }, maxRounds: 1 });
  assert.equal(r.answer, "Ecco quello che so."); assert.equal(e.calls.length, 3);
  assert.match(e.calls[2].messages.at(-1).content, /Limite di strumenti raggiunto/);
});

test("strumento inesistente: l'errore torna al modello", async () => {
  const e = engine(['<tool_call>\n{"name": "boh", "arguments": {}}\n</tool_call>', "Mi scusi."]);
  const r = await runLocalAgent({ engine: e, system: "s", userContent: "?", tools: {} });
  assert.equal(r.answer, "Mi scusi."); assert.match(e.calls[1].messages.at(-1).content, /non esiste/);
});
