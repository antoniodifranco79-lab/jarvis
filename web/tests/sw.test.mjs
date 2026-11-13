// Il service worker non deve mai cancellare il modello scaricato né le librerie: si installa una volta e funziona sempre.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

test("aggiornare l'app non cancella modelli e librerie", async () => {
  const handlers = {}, store = new Set(["jarvis-v8", "jarvis-v12", "jarvis-app-v1", "jarvis-cdn", "webllm/model", "webllm/config", "webllm/wasm", "wllama_cache", "puter"]);
  const caches = { keys: async () => [...store], delete: async (k) => store.delete(k), open: async (k) => { store.add(k); return { addAll: async () => {}, put: async () => {} }; }, match: async () => undefined };
  const self = { addEventListener: (t, f) => (handlers[t] = f), skipWaiting: () => {}, clients: { claim: async () => {} } };
  vm.runInNewContext(readFileSync(new URL("../sw.js", import.meta.url), "utf8"), { self, caches, location: { origin: "https://x" }, URL, fetch: async () => ({}) });
  let p; handlers.install({ waitUntil: (x) => (p = x) }); await p;
  handlers.activate({ waitUntil: (x) => (p = x) }); await p;
  const left = [...store].sort();
  for (const k of ["webllm/model", "webllm/config", "webllm/wasm", "wllama_cache", "puter", "jarvis-cdn"]) assert.ok(left.includes(k), `${k} deve restare`);
  for (const k of ["jarvis-v8", "jarvis-v12", "jarvis-app-v1"]) assert.ok(!left.includes(k), `${k} va tolta`);
  assert.ok(left.some((k) => /^jarvis-app-v\d+$/.test(k)), "la cache dell'app attuale c'è");
});
