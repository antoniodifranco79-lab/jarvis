// Motore di riserva per i dispositivi senza WebGPU (molti telefoni, alcuni PC): llama.cpp compilato in WebAssembly
// (wllama) fa girare un modello GGUF sul processore. Gratis, senza chiave, tutto sul dispositivo. Espone la stessa
// interfaccia del motore WebLLM (chat.completions.create in streaming, interruptGenerate), così il resto dell'app non cambia.
const WLLAMA = "https://cdn.jsdelivr.net/npm/@wllama/wllama@3.8.1/esm/index.js";
const WASM = "https://cdn.jsdelivr.net/npm/@wllama/wllama@3.8.1/esm/wasm/wllama.wasm";

export const CPU_MODELS = {
  "Qwen3-0.6B": { repo: "bartowski/Qwen_Qwen3-0.6B-GGUF", file: "Qwen_Qwen3-0.6B-Q4_K_M.gguf", label: "Qwen3 0.6B" },
  "Qwen3-1.7B": { repo: "bartowski/Qwen_Qwen3-1.7B-GGUF", file: "Qwen_Qwen3-1.7B-Q4_K_M.gguf", label: "Qwen3 1.7B" },
};

/** Avvolge uno stream di chunk e lo chiude alla prima sequenza di stop (wllama non la applica alla chat).
 *  Trattiene la coda che potrebbe essere l'inizio di uno stop spezzato tra due chunk. */
export async function* applyStops(stream, stops = [], abort = () => {}) {
  let acc = "", sent = 0;
  const out = (text) => ({ choices: [{ delta: { content: text } }] });
  const heldBack = () => { let n = 0; for (const s of stops) for (let k = Math.min(s.length - 1, acc.length); k > n; k--) if (acc.endsWith(s.slice(0, k))) { n = k; break; } return n; };
  try {
    for await (const ch of stream) {
      acc += ch?.choices?.[0]?.delta?.content || "";
      const hit = stops.map((s) => acc.indexOf(s)).filter((i) => i >= 0).sort((x, y) => x - y)[0];
      if (hit !== undefined) { if (hit > sent) yield out(acc.slice(sent, hit)); abort(); return; }
      const safe = acc.length - heldBack();
      if (safe > sent) { yield out(acc.slice(sent, safe)); sent = safe; }
    }
    if (acc.length > sent) yield out(acc.slice(sent));
  } catch (e) { if (!/abort/i.test(String(e?.name) + String(e?.message))) throw e; }
}

export async function createCpuEngine(name, onProgress) {
  const m = CPU_MODELS[name] || CPU_MODELS["Qwen3-0.6B"];
  const { Wllama } = await import(WLLAMA);
  const w = new Wllama({ default: WASM });
  await w.loadModelFromHF({ repo: m.repo, file: m.file }, { n_ctx: 4096, progressCallback: ({ loaded, total }) => onProgress?.(loaded, total) });
  let ctrl = null;
  return {
    backend: "cpu", label: m.label,
    interruptGenerate() { try { ctrl?.abort(); } catch {} },
    chat: { completions: { create: async (req) => {
      ctrl = new AbortController(); const mine = ctrl;
      const stream = await w.createChatCompletion({ messages: req.messages, stream: true, max_tokens: req.max_tokens, temperature: req.temperature, cache_prompt: true, abortSignal: mine.signal });
      return applyStops(stream, req.stop || [], () => mine.abort());
    } } },
  };
}
