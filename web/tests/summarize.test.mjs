import test from "node:test";
import assert from "node:assert/strict";
import { splitParts, summarize, summaryFocus } from "../summarize.js";

/** Motore finto compatibile con chat.completions.create in streaming. */
function fakeEngine(reply = (msgs, n) => `- punto ${n}`) {
  const calls = [];
  return { calls, chat: { completions: { create: async (req) => { calls.push(req); const text = reply(req.messages, calls.length); return (async function* () { for (const piece of text.match(/.{1,7}/gs) || []) yield { choices: [{ delta: { content: piece } }] }; })(); } } } };
}
const pages = (n) => Array.from({ length: n }, (_, i) => `[p. ${i + 1}]\n` + `Articolo ${i + 1}. Il fornitore consegna entro il giorno ${i + 1} e la penale è di ${100 * (i + 1)} euro. `.repeat(12)).join("\n\n");

test("splitParts rispetta la dimensione e ricorda la pagina", () => {
  const parts = splitParts(pages(10), 3000);
  assert.ok(parts.length >= 3); for (const p of parts) assert.ok(p.length <= 3200, p.length); assert.ok(parts.every((p) => /\[p\. \d+\]/.test(p)));
});

test("documento breve: una sola chiamata", async () => {
  const e = fakeEngine(() => "<think>ragiono</think>- unico punto"); const prog = [];
  const out = await summarize({ engine: e, text: "Contratto breve tra Rossi e Bianchi.", title: "c.pdf", onProgress: (...a) => prog.push(a) });
  assert.equal(out, "- unico punto"); assert.equal(e.calls.length, 1); assert.deepEqual(prog, [["riassunto", 1, 1]]);
  assert.match(e.calls[0].messages[1].content, /\/no_think$/);
});

test("documento lungo: mappa e unione a livelli", async () => {
  const e = fakeEngine(); const prog = [];
  const out = await summarize({ engine: e, text: pages(30), title: "lungo.pdf", focus: "penali", onProgress: (f, a, b) => prog.push(f) });
  const reads = prog.filter((f) => f === "lettura").length, merges = prog.filter((f) => f === "unione").length;
  assert.ok(reads > 8, "molte parti"); assert.ok(merges >= 2, "almeno due livelli di unione");
  assert.equal(e.calls.length, reads + merges); assert.ok(out.startsWith("- punto"));
  assert.ok(e.calls.every((c) => /penali/.test(c.messages[1].content)), "il tema arriva a ogni chiamata");
});

test("interruzione", async () => {
  let n = 0; await assert.rejects(summarize({ engine: fakeEngine(), text: pages(30), isAborted: () => ++n > 3 }), /Interrotto/);
});

test("summaryFocus", () => {
  assert.equal(summaryFocus("riassumi il contratto Rossi sulle penali", "Contratto Rossi.pdf"), "penali");
  assert.equal(summaryFocus("Riassumi bilancio-2025.pdf", "bilancio-2025.pdf"), "");
  assert.equal(summaryFocus("fammi un riassunto del verbale", "verbale assemblea.docx"), "");
  assert.equal(summaryFocus("riassumi l'atto concentrandoti sulle garanzie", "atto vendita.pdf"), "garanzie");
});
