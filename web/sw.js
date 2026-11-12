// Service worker di J.A.R.V.I.S.
// - Pagine e codice dell'app: prima la rete (così un solo caricamento porta la versione nuova), poi la copia salvata.
// - Librerie esterne con versione fissa (jsdelivr @x.y.z) e caratteri: prima la copia salvata, sono immutabili.
// - Pesi dei modelli (Hugging Face, GitHub): li gestiscono WebLLM e wllama nelle loro cache.
// Risultato: dopo il primo avvio J.A.R.V.I.S. funziona anche senza internet.
// Due cache: quella dell'app cambia nome a ogni versione; quella delle librerie (URL con versione fissa) resta.
// Le cache degli altri (modelli di WebLLM, wllama, Puter) NON si toccano mai: il modello si scarica una volta sola.
const CACHE = "jarvis-app-v14", CDN = "jarvis-cdn";
const SHELL = ["./", "./index.html", "./app.js", "./docs.js", "./studio.js", "./claude.js", "./knowledge.js", "./tools.js", "./voice.js", "./localagent.js", "./cpuengine.js", "./puterbrain.js", "./when.js", "./docx.js", "./summarize.js", "./calc.js", "./extract.js", "./templates.js", "./ics.js", "./format.js", "./utility.js", "./hud/hud.css", "./hud/reactor.js", "./manifest.webmanifest", "./manifest-personale.webmanifest", "./lists.js", "./icon-192.png", "./icon-512.png"];
const IMMUTABLE = (u) => (u.hostname === "cdn.jsdelivr.net" && /@\d+\.\d+\.\d+/.test(u.pathname)) || u.hostname === "fonts.gstatic.com" || u.hostname === "fonts.googleapis.com";

self.addEventListener("install", (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())); });
/** Cache vecchie di J.A.R.V.I.S. da togliere: solo le versioni precedenti dell'app, mai librerie o modelli. */
const stale = (k) => (k.startsWith("jarvis-app-") || /^jarvis-v\d+$/.test(k)) && k !== CACHE;
self.addEventListener("activate", (e) => { e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter(stale).map((k) => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET") return;
  const url = new URL(e.request.url);
  if (url.origin === location.origin) {
    e.respondWith(fetch(e.request).then((res) => { if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); } return res; })
      .catch(() => caches.match(e.request, { ignoreSearch: true }).then((hit) => hit || caches.match("./index.html"))));
    return;
  }
  if (IMMUTABLE(url)) {
    e.respondWith(caches.match(e.request).then((hit) => hit || fetch(e.request).then((res) => { if (res.ok || res.type === "opaque") { const copy = res.clone(); caches.open(CDN).then((c) => c.put(e.request, copy)); } return res; })));
  }
});
