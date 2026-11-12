import test from "node:test";
import assert from "node:assert/strict";
import { applyStops } from "../cpuengine.js";

const stream = (pieces) => (async function* () { for (const p of pieces) yield { choices: [{ delta: { content: p } }] }; })();
const collect = async (it) => { let s = ""; for await (const c of it) s += c.choices[0].delta.content; return s; };

test("si ferma alla sequenza di stop, anche spezzata tra due pezzi", async () => {
  let aborted = 0;
  assert.equal(await collect(applyStops(stream(["Ciao <tool", "_call>{}</tool_", "call> dopo"]), ["</tool_call>"], () => aborted++)), "Ciao <tool_call>{}");
  assert.equal(aborted, 1);
});
test("senza stop restituisce tutto", async () => {
  assert.equal(await collect(applyStops(stream(["a", "b", "</to"]), ["</tool_call>"])), "ab</to");
});
test("un'interruzione non è un errore", async () => {
  const bad = (async function* () { yield { choices: [{ delta: { content: "x" } }] }; const e = new Error("aborted"); e.name = "AbortError"; throw e; })();
  assert.equal(await collect(applyStops(bad, [])), "x");
});
