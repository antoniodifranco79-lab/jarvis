// J.A.R.V.I.S. for the browser: the language model runs on this device through WebGPU (WebLLM);
// the hands (clock, weather, calculator, reminders, memory, Wikipedia, studio tools, documents) are plain
// JavaScript; voice comes from the browser. Nothing leaves the device except weather/Wikipedia lookups:
// documents are read, indexed and searched inside the browser.
import { Library, ACCEPT } from "./docs.js";
import { routeStudio } from "./studio.js";

const $ = (id) => document.getElementById(id);
const transcript = $("transcript"), input = $("input"), stateChip = $("stateChip"), caption = $("caption");
const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
const WEBLLM_URL = "https://cdn.jsdelivr.net/npm/@mlc-ai/web-llm@0.2.88/lib/index.js";

// ---------------------------------------------------------------- settings & memory (local only)
const store = {
  get(key, fallback) { try { const v = localStorage.getItem("jarvis." + key); return v === null ? fallback : JSON.parse(v); } catch { return fallback; } },
  set(key, value) { try { localStorage.setItem("jarvis." + key, JSON.stringify(value)); } catch {} },
};
const settings = Object.assign({ name: "Signore", city: "", lang: "it-IT", model: "auto", think: false, lastModel: "" }, store.get("settings", {}));
const library = new Library();
let facts = store.get("facts", []);          // long-term memory: strings
let history = store.get("history", []);      // [{role, content}]
let reminders = store.get("reminders", []);  // [{id, message, at}]
const app = { state: "idle", engine: null, engineReady: false, level: 0, streaming: null, wake: false, recognizing: false, speaking: Promise.resolve(), lang: settings.lang };

// ---------------------------------------------------------------- UI helpers
const addTurn = (cls, text, who) => {
  const el = document.createElement("div"); el.className = "turn " + cls;
  if (who) { const w = document.createElement("span"); w.className = "who"; w.textContent = who; el.appendChild(w); }
  const body = document.createElement("span"); body.className = "body"; body.textContent = text; el.appendChild(body);
  transcript.appendChild(el); transcript.scrollTop = transcript.scrollHeight; return el;
};
const addTool = (name, preview) => { const el = document.createElement("div"); el.className = "turn tool"; el.innerHTML = "⚙ <b></b> <span></span>"; el.querySelector("b").textContent = name; el.querySelector("span").textContent = preview; transcript.appendChild(el); transcript.scrollTop = transcript.scrollHeight; };
const setState = (s, extra) => {
  app.state = s; stateChip.dataset.state = s; stateChip.textContent = extra || { idle: "pronto", listening: "ascolto", thinking: "elaboro", tool: "strumento", speaking: "parlo", loading: "carico" }[s] || s;
  caption.textContent = extra || { idle: "tutti i sistemi operativi", listening: "in ascolto", thinking: "elaborazione", tool: "strumento in uso", speaking: "risposta vocale", loading: "preparazione del modello" }[s] || s;
};
const notice = (text) => { addTurn("system", text); if (app.state === "idle") caption.textContent = text.toLowerCase().slice(0, 60); };
const updateReminderChip = () => { const c = $("reminderChip"); c.hidden = !reminders.length; c.textContent = reminders.length + (reminders.length === 1 ? " promemoria" : " promemoria"); };

// ---------------------------------------------------------------- speech out
const synth = window.speechSynthesis;
const pickVoice = (lang) => { const vs = synth ? synth.getVoices() : []; const same = vs.filter((v) => v.lang.replace("_", "-").toLowerCase().startsWith(lang.slice(0, 2))); return same.find((v) => /male|ryan|daniel|diego|cosimo|google/i.test(v.name)) || same[0] || null; };
const guessLang = (t) => /\b(the|is|and|you|sir|what|good|morning|evening)\b/i.test(t) && !/\b(il|la|che|sono|signore|buongiorno|buonasera|grazie|oggi)\b/i.test(t) ? "en-GB" : "it-IT";
const speak = (text) => { if (!synth || !text) return; const clean = text.replace(/[*_`#]/g, ""); app.speaking = app.speaking.then(() => new Promise((resolve) => { const u = new SpeechSynthesisUtterance(clean); u.lang = guessLang(clean); const v = pickVoice(u.lang); if (v) u.voice = v; u.rate = 1.02; u.pitch = 0.9; u.onstart = () => setState("speaking"); u.onend = () => { setState("idle"); resolve(); }; u.onerror = () => { setState("idle"); resolve(); }; synth.speak(u); })); };

// ---------------------------------------------------------------- reactor
const canvas = $("reactor"), ctx = canvas.getContext("2d"); let t0 = performance.now(), bars = new Array(40).fill(0);
const draw = (now) => {
  const t = (now - t0) / 1000, W = canvas.width, H = canvas.height, cx = W / 2, cy = H / 2, R = W * 0.42, s = app.state;
  const speed = reduced ? 0 : (s === "thinking" || s === "loading" ? 1.6 : s === "tool" ? 1 : s === "speaking" ? 0.7 : 0.25);
  const col = s === "listening" ? "82,227,155" : (s === "tool" || s === "loading") ? "255,181,71" : "57,198,255";
  ctx.clearRect(0, 0, W, H); const pulse = reduced ? 0.5 : 0.5 + 0.5 * Math.sin(t * (s === "idle" ? 1.2 : 3));
  const glow = ctx.createRadialGradient(cx, cy, R * 0.05, cx, cy, R * 0.55); glow.addColorStop(0, `rgba(${col},${0.55 + 0.25 * pulse})`); glow.addColorStop(0.5, `rgba(${col},0.12)`); glow.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = glow; ctx.beginPath(); ctx.arc(cx, cy, R * 0.55, 0, Math.PI * 2); ctx.fill();
  ctx.save(); ctx.translate(cx, cy); ctx.rotate(t * speed * 0.1);
  for (let i = 0; i < 90; i++) { const a = (i / 90) * Math.PI * 2, big = i % 15 === 0; ctx.strokeStyle = `rgba(${col},${big ? 0.9 : 0.35})`; ctx.lineWidth = big ? 2.2 : 1; ctx.beginPath(); ctx.moveTo(Math.cos(a) * R, Math.sin(a) * R); ctx.lineTo(Math.cos(a) * (R - (big ? 14 : 7)), Math.sin(a) * (R - (big ? 14 : 7))); ctx.stroke(); }
  ctx.restore();
  [[0.9, 0.9, 1], [0.78, -1.3, 0.6], [0.66, 0.6, 0.45]].forEach(([r, dir, len], i) => { ctx.save(); ctx.translate(cx, cy); ctx.rotate(t * speed * dir + i); ctx.strokeStyle = `rgba(${col},${0.55 + 0.15 * i})`; ctx.lineWidth = i === 0 ? 3 : 2; ctx.lineCap = "round"; for (let k = 0; k < 3; k++) { ctx.beginPath(); ctx.arc(0, 0, R * r, k * 2.1, k * 2.1 + len); ctx.stroke(); } ctx.restore(); });
  const active = s === "speaking" || s === "listening";
  for (let i = 0; i < bars.length; i++) { const target = active ? (s === "listening" ? app.level : 0.25 + Math.random() * 0.75) * (0.4 + 0.6 * Math.abs(Math.sin(i * 1.7 + t * 5))) : 0.05; bars[i] += (target - bars[i]) * (reduced ? 1 : 0.25); }
  ctx.save(); ctx.translate(cx, cy); for (let i = 0; i < bars.length; i++) { const a = (i / bars.length) * Math.PI * 2, r0 = R * 0.36, h = 6 + bars[i] * R * 0.16; ctx.strokeStyle = `rgba(${col},0.8)`; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(Math.cos(a) * r0, Math.sin(a) * r0); ctx.lineTo(Math.cos(a) * (r0 + h), Math.sin(a) * (r0 + h)); ctx.stroke(); } ctx.restore();
  if (s === "thinking" || s === "tool" || s === "loading") { ctx.save(); ctx.translate(cx, cy); ctx.rotate(t * 4); const g = ctx.createLinearGradient(0, 0, R * 0.6, 0); g.addColorStop(0, `rgba(${col},0)`); g.addColorStop(1, `rgba(${col},0.7)`); ctx.strokeStyle = g; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(R * 0.6, 0); ctx.stroke(); ctx.restore(); }
  ctx.fillStyle = `rgba(${col},${0.75 + 0.25 * pulse})`; ctx.shadowColor = `rgba(${col},0.9)`; ctx.shadowBlur = 30 + 20 * pulse; ctx.beginPath(); ctx.arc(cx, cy, R * 0.16, 0, Math.PI * 2); ctx.fill(); ctx.shadowBlur = 0;
  ctx.fillStyle = "rgba(255,255,255,0.85)"; ctx.beginPath(); ctx.arc(cx, cy, R * 0.06, 0, Math.PI * 2); ctx.fill();
  requestAnimationFrame(draw);
};
requestAnimationFrame(draw);

// ---------------------------------------------------------------- tools (the hands)
const IT_DAYS = ["domenica", "lunedì", "martedì", "mercoledì", "giovedì", "venerdì", "sabato"], IT_MONTHS = ["gennaio", "febbraio", "marzo", "aprile", "maggio", "giugno", "luglio", "agosto", "settembre", "ottobre", "novembre", "dicembre"];
const fmtTime = (d = new Date()) => `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
const fmtDate = (d = new Date()) => `${IT_DAYS[d.getDay()]} ${d.getDate()} ${IT_MONTHS[d.getMonth()]} ${d.getFullYear()}`;
const WMO = { 0: "cielo sereno", 1: "poco nuvoloso", 2: "parzialmente nuvoloso", 3: "coperto", 45: "nebbia", 48: "nebbia gelata", 51: "pioviggine leggera", 53: "pioviggine", 55: "pioviggine intensa", 61: "pioggia leggera", 63: "pioggia", 65: "pioggia forte", 71: "neve leggera", 73: "neve", 75: "neve forte", 80: "rovesci leggeri", 81: "rovesci", 82: "rovesci violenti", 95: "temporale", 96: "temporale con grandine", 99: "temporale con grandine forte" };
async function weather(place) {
  const g = await (await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(place)}&count=1&language=it&format=json`)).json();
  const loc = g.results && g.results[0]; if (!loc) return { error: `Non trovo "${place}".` };
  const w = await (await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${loc.latitude}&longitude=${loc.longitude}&current=temperature_2m,apparent_temperature,weather_code,wind_speed_10m,precipitation&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max&timezone=auto&forecast_days=2`)).json();
  const c = w.current, d = w.daily;
  return { place: `${loc.name}${loc.country ? ", " + loc.country : ""}`, now: `${WMO[c.weather_code] || "variabile"}, ${Math.round(c.temperature_2m)}°C (percepiti ${Math.round(c.apparent_temperature)}°), vento ${Math.round(c.wind_speed_10m)} km/h`, today: `min ${Math.round(d.temperature_2m_min[0])}° max ${Math.round(d.temperature_2m_max[0])}°, pioggia ${d.precipitation_probability_max[0] ?? 0}%`, tomorrow: `${WMO[d.weather_code[1]] || "variabile"}, min ${Math.round(d.temperature_2m_min[1])}° max ${Math.round(d.temperature_2m_max[1])}°, pioggia ${d.precipitation_probability_max[1] ?? 0}%` };
}
function calculate(expr) {
  const clean = expr.replace(/,/g, ".").replace(/\^/g, "**").replace(/×/g, "*").replace(/÷/g, "/").replace(/per cento|percento|%/g, "/100").replace(/\s+(per|x)\s+/gi, "*").replace(/\s+diviso\s+/gi, "/").replace(/\s+più\s+/gi, "+").replace(/\s+meno\s+/gi, "-").replace(/radice di\s*/gi, "Math.sqrt");
  if (!/^[\d\s.+\-*/()%Math.sqrtpowabs,eE]+$/.test(clean)) return null;
  try { const v = Function(`"use strict"; return (${clean});`)(); return Number.isFinite(v) ? Math.round(v * 1e6) / 1e6 : null; } catch { return null; }
}
async function wikipedia(topic, lang = "it") {
  const r = await fetch(`https://${lang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(topic.trim().replace(/\s+/g, "_"))}`, { headers: { accept: "application/json" } });
  if (!r.ok) return null; const j = await r.json(); return j.extract ? `${j.title}: ${j.extract}` : null;
}
function scheduleReminder(message, at) {
  const r = { id: Date.now(), message, at }; reminders.push(r); store.set("reminders", reminders); updateReminderChip(); armReminder(r); return r;
}
function armReminder(r) {
  const delay = Math.max(0, r.at - Date.now());
  setTimeout(() => { reminders = reminders.filter((x) => x.id !== r.id); store.set("reminders", reminders); updateReminderChip(); addTurn("reminder", "⏰ " + r.message); speak(`${settings.name}, ${r.message}`); try { if (Notification.permission === "granted") new Notification("J.A.R.V.I.S.", { body: r.message, icon: "icon-192.png" }); } catch {} }, Math.min(delay, 2 ** 31 - 1));
}
const parseDelay = (t) => { const m = /(?:tra|in|fra)\s+(\d+|un|una|uno|mezz'?)\s*(secondi?|minut[oi]|or[ae]|ore)/i.exec(t); if (!m) return null; const n = /^un|^mezz/i.test(m[1]) ? (/^mezz/i.test(m[1]) ? 0.5 : 1) : parseInt(m[1], 10); const unit = /sec/i.test(m[2]) ? 1000 : /min/i.test(m[2]) ? 60000 : 3600000; return n * unit; };
const parseClock = (t) => { const m = /alle\s+(\d{1,2})(?:[:.](\d{2}))?/i.exec(t); if (!m) return null; const d = new Date(); d.setHours(parseInt(m[1], 10), m[2] ? parseInt(m[2], 10) : 0, 0, 0); if (d.getTime() <= Date.now()) d.setDate(d.getDate() + 1); return d.getTime(); };

/** Fast intent routing: the hands act first, the model phrases the answer. Returns {tool, result, direct} or null. */
const HELP = () => `Ecco cosa so fare, ${settings.name}. Documenti: carichi PDF, Word o testi con la graffetta e mi chieda cosa contengono, un riassunto o una clausola; restano su questo dispositivo. Studio: IVA (aggiungi o scorpora), fattura del professionista con cassa e ritenuta, giorni tra due date, scadenze tra N giorni con festività, verifica di codice fiscale, partita IVA e IBAN. Poi ora, meteo, calcoli, promemoria, memoria a lungo termine e Wikipedia. Per il resto, conversazione libera con il modello locale.`;
async function route(text) {
  const t = text.toLowerCase().trim();
  if (/^(aiuto|help|cosa sai fare|che cosa sai fare|comandi|cosa puoi fare)\b/.test(t)) return { tool: "aiuto", result: "", direct: HELP() };
  if (/\b(quali|che|elenca|lista)\b.*\b(documenti|file)\b/.test(t) && !/\b(dice|contien|parla)/.test(t)) { const list = library.docs.map((d) => `${d.name} (${d.pages > 1 ? d.pages + " pagine" : d.chars < 1000 ? d.chars + " caratteri" : Math.round(d.chars / 1000) + " mila caratteri"})`); return { tool: "documenti", result: list.length ? "Documenti caricati: " + list.join("; ") : "Nessun documento caricato.", direct: list.length ? `Ho ${list.length} documenti, ${settings.name}: ${list.join("; ")}.` : `Nessun documento caricato, ${settings.name}. Usi la graffetta per aggiungerne.` }; }
  const studio = routeStudio(text); if (studio) return { tool: studio.tool, result: studio.result, direct: studio.result, exact: true };
  if (/\b(che or[ae]|che ore sono|what time)\b/.test(t)) return { tool: "orologio", result: `Ora: ${fmtTime()}, ${fmtDate()}.`, direct: `Sono le ${fmtTime()}, ${settings.name}.` };
  if (/\b(che giorno|data di oggi|what day|what's the date)\b/.test(t)) return { tool: "calendario", result: `Oggi è ${fmtDate()}.`, direct: `Oggi è ${fmtDate()}, ${settings.name}.` };
  if (/\b(meteo|tempo fa|che tempo|piove|pioverà|temperatura|weather|gradi)\b/.test(t)) {
    const m = /\b(?:a|in|ad|at|per)\s+([A-Za-zÀ-ÿ' ]{2,30})$/i.exec(text.trim().replace(/[?.!]+$/, "")) ; const place = (m && m[1].trim()) || settings.city;
    if (!place) return { tool: "meteo", result: "", direct: `Per il meteo mi serve una città, ${settings.name}: la imposti nelle impostazioni, oppure me la dica.` };
    const w = await weather(place); if (w.error) return { tool: "meteo", result: w.error, direct: w.error };
    return { tool: "meteo", result: `Meteo a ${w.place}: adesso ${w.now}. Oggi ${w.today}. Domani ${w.tomorrow}.`, direct: `A ${w.place} adesso ${w.now}. Oggi ${w.today}; domani ${w.tomorrow}.` };
  }
  if (/\b(ricordami|ricorda di|timer|sveglia|avvisami|remind me)\b/.test(t)) {
    const at = parseDelay(t) != null ? Date.now() + parseDelay(t) : parseClock(t);
    if (!at) return { tool: "promemoria", result: "", direct: `Quando, ${settings.name}? Per esempio "tra dieci minuti" o "alle 18:30".` };
    const msg = text.replace(/.*?(ricordami|ricorda di|avvisami|remind me)\s*(di\s+)?/i, "").replace(/\b(tra|in|fra)\s+\S+\s+\S+/i, "").replace(/\balle\s+[\d:.]+/i, "").replace(/\btimer\b/i, "").trim().replace(/^di\s+/i, "") || "promemoria";
    const r = scheduleReminder(msg, at); const when = at - Date.now() < 3600000 ? `tra ${Math.round((at - Date.now()) / 60000)} minuti` : `alle ${fmtTime(new Date(at))}`;
    try { if ("Notification" in window && Notification.permission === "default") Notification.requestPermission(); } catch {}
    return { tool: "promemoria", result: `Promemoria impostato ${when}: ${r.message}.`, direct: `Fatto. Glielo ricordo ${when}, ${settings.name}.` };
  }
  if (/^(ricorda che|ricordati che|memorizza che|remember that)\s+/i.test(text.trim())) { const fact = text.trim().replace(/^(ricorda che|ricordati che|memorizza che|remember that)\s+/i, ""); facts.push(fact); store.set("facts", facts); return { tool: "memoria", result: `Memorizzato: ${fact}`, direct: `Annotato, ${settings.name}.` }; }
  if (/\b(cosa sai di me|cosa ti ho detto|cosa ricordi|what do you remember)\b/.test(t)) return { tool: "memoria", result: facts.length ? "Fatti memorizzati: " + facts.join("; ") : "Nessun fatto memorizzato.", direct: facts.length ? `Ricordo questo, ${settings.name}: ${facts.join("; ")}.` : `Per ora non mi ha detto nulla da ricordare, ${settings.name}.` };
  const calc = /^(quanto fa|calcola|calculate|what is|quanto è)\s+(.+)$/i.exec(text.trim().replace(/[?.!]+$/, "")); if (calc) { const v = calculate(calc[2]); if (v != null) return { tool: "calcolatrice", result: `${calc[2]} = ${v}`, direct: `Fa ${String(v).replace(".", ",")}, ${settings.name}.` }; }
  const who = /^(chi è|chi era|cos'è|cosa è|che cos'è|who is|what is)\s+(.+)$/i.exec(text.trim().replace(/[?.!]+$/, "")); if (who) { const r = await wikipedia(who[2], /^who|^what/i.test(who[1]) ? "en" : "it").catch(() => null); if (r) return { tool: "wikipedia", result: r, direct: r }; }
  return null;
}

// ---------------------------------------------------------------- the model (WebLLM on WebGPU)
const WEBLLM_MODELS = ["Qwen3-8B", "Qwen3-4B", "Qwen3-1.7B", "Qwen3-0.6B"];
const persona = (withDocs) => `Sei J.A.R.V.I.S., l'assistente personale di ${settings.name}: calmo, preciso, educato, con un'ironia britannica leggera. Chiama l'utente "${settings.name}" e rispondi nella lingua in cui ti scrivono.
Regole:
- Sii utile e concreto. Di solito bastano da una a quattro frasi; per riassunti, confronti o procedure usa un breve elenco puntato.
- Non inventare mai fatti, numeri, date, norme o nomi. Se non lo sai, dillo e suggerisci come verificarlo.
- Se è presente un [Risultato strumento], quei numeri sono esatti: riportali senza ricalcolarli.
${withDocs ? "- Rispondi SOLO in base ai [Passaggi] forniti, citandoli tra parentesi quadre come [1] o [2]. Se la risposta non è nei passaggi, dillo chiaramente.\n" : ""}- Per questioni legali, fiscali o mediche dai informazioni generali e ricorda di verificarle con un professionista o con la fonte ufficiale.
Oggi è ${fmtDate()}, sono le ${fmtTime()}.${facts.length ? " Cose che sai dell'utente: " + facts.join("; ") + "." : ""}`;

/** Sceglie il modello più capace che il dispositivo regge, con la variante f32 dove la GPU non supporta f16. */
async function pickModels() {
  let f16 = true, maxBuf = 0;
  try { const a = await navigator.gpu.requestAdapter({ powerPreference: "high-performance" }); if (!a) return []; f16 = a.features.has("shader-f16"); maxBuf = a.limits.maxBufferSize || 0; } catch { return []; }
  const q = f16 ? "q4f16_1" : "q4f32_1", id = (m) => `${m}-${q}-MLC`;
  if (settings.model !== "auto") { const base = settings.model.replace(/-q4f(16|32)_1-MLC$/, ""); return WEBLLM_MODELS.slice(WEBLLM_MODELS.indexOf(base)).map(id); }
  const mobile = /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent), mem = navigator.deviceMemory || 4;
  let start = mobile ? (mem >= 8 ? "Qwen3-1.7B" : "Qwen3-0.6B") : (mem >= 8 && maxBuf >= 2 ** 31 ? "Qwen3-4B" : "Qwen3-1.7B");
  if (settings.lastModel && WEBLLM_MODELS.includes(settings.lastModel)) start = settings.lastModel; // già scaricato: niente nuovo download
  return WEBLLM_MODELS.slice(WEBLLM_MODELS.indexOf(start)).map(id);
}
async function loadEngine() {
  if (!("gpu" in navigator)) { notice("Questo browser non ha WebGPU: funzionano documenti (ricerca), strumenti da studio, orologio, meteo, promemoria, calcoli e Wikipedia, ma non la conversazione libera. Serve Chrome o Edge aggiornati."); $("model").textContent = "modalità essenziale"; return; }
  const candidates = await pickModels(); if (!candidates.length) { notice("La GPU non è disponibile: resto in modalità essenziale."); $("model").textContent = "modalità essenziale"; return; }
  setState("loading"); $("progress").hidden = false;
  let webllm; try { webllm = await import(WEBLLM_URL); } catch (e) { $("progress").hidden = true; setState("idle"); notice("Non raggiungo la libreria del modello: controlli la connessione. Intanto funzionano gli strumenti."); $("model").textContent = "modalità essenziale"; return; }
  for (const model of candidates) {
    $("model").textContent = model.replace(/-q4f(16|32)_1-MLC$/, "");
    try {
      app.engine = await webllm.CreateMLCEngine(model, { initProgressCallback: (p) => { $("progressBar").style.width = Math.round((p.progress || 0) * 100) + "%"; caption.textContent = (p.text || "carico il modello").toLowerCase().slice(0, 70); } });
      app.engineReady = true; app.model = model; settings.lastModel = model.replace(/-q4f(16|32)_1-MLC$/, ""); store.set("settings", settings);
      $("progress").hidden = true; setState("idle"); notice(`Modello ${settings.lastModel} pronto. Tutto gira su questo dispositivo.`); return;
    } catch (e) { console.warn(model, e); notice(`${model.replace(/-q4f(16|32)_1-MLC$/, "")} non entra in questo dispositivo, provo un modello più piccolo.`); }
  }
  $("progress").hidden = true; setState("idle"); notice("Non sono riuscito a caricare nessun modello. Funzionano comunque documenti, strumenti da studio e comandi rapidi."); $("model").textContent = "modalità essenziale";
}

const SUMMARY = /\b(riassum|riassunto|sintesi|sintetizza|di cosa parla|cosa dice|summari[sz]e|in breve)\b/i;
const DOCWORDS = /\b(document|contratt|file|pdf|allegat|testo|clausol|articol|bilanci|verbal|atto|fattur|preventiv|relazion|lettera|mail|delibera|statuto|perizia)/i;
/** Passaggi dai documenti pertinenti alla domanda, o [] se la domanda non riguarda i documenti. */
function docContext(text) {
  if (!library.size) return [];
  const named = library.mentioned(text);
  if (named && SUMMARY.test(text)) return [{ doc: named.name, page: null, text: library.head(named.id), n: 1 }];
  if (SUMMARY.test(text) && library.size === 1 && DOCWORDS.test(text)) return [{ doc: library.docs[0].name, page: null, text: library.head(library.docs[0].id), n: 1 }];
  const hits = library.search(text, 4, named ? named.id : null);
  if (!hits.length) return [];
  const strong = hits[0].score >= 2.2 || DOCWORDS.test(text) || named;
  return strong ? hits.map((h, i) => ({ ...h, n: i + 1 })) : [];
}
const cite = (p) => `${p.doc}${p.page ? ", p. " + p.page : ""}`;
function addSources(el, passages) {
  if (!passages.length) return;
  const box = document.createElement("div"); box.className = "sources";
  passages.forEach((p) => { const d = document.createElement("details"); const s = document.createElement("summary"); s.textContent = `[${p.n}] ${cite(p)}`; const q = document.createElement("p"); q.textContent = p.text.slice(0, 900) + (p.text.length > 900 ? "…" : ""); d.append(s, q); box.appendChild(d); });
  el.appendChild(box); transcript.scrollTop = transcript.scrollHeight;
}

async function askModel(userText, toolResult, passages = []) {
  const ctxText = passages.map((p) => `[${p.n}] (${cite(p)})\n${p.text.slice(0, passages.length === 1 ? 3200 : 850)}`).join("\n\n");
  const messages = [{ role: "system", content: persona(passages.length > 0) }, ...history.slice(passages.length ? -4 : -10)];
  messages.push({ role: "user", content: (toolResult ? `[Risultato strumento] ${toolResult}\n\n` : "") + (ctxText ? `[Passaggi]\n${ctxText}\n\n[Domanda] ` : "") + userText + (settings.think ? "" : " /no_think") });
  const el = addTurn("jarvis streaming", "", "jarvis"); const body = el.querySelector(".body"); let out = "", spoken = "";
  const stream = await app.engine.chat.completions.create({ messages, stream: true, temperature: passages.length || toolResult ? 0.3 : 0.6, max_tokens: settings.think ? 1600 : passages.length ? 600 : 400 });
  for await (const chunk of stream) {
    const d = chunk.choices?.[0]?.delta?.content || ""; if (!d) continue; out += d;
    const thinking = /<think>(?![\s\S]*<\/think>)/.test(out); if (thinking) caption.textContent = "ragiono…";
    const shown = out.replace(/<think>[\s\S]*?(<\/think>|$)/g, "").trimStart(); body.textContent = shown; transcript.scrollTop = transcript.scrollHeight;
    const m = /^(.*?[.!?])\s/.exec(shown.slice(spoken.length)); if (m && m[1].length > 12) { speak(m[1]); spoken += m[0]; }
  }
  el.classList.remove("streaming"); const final = out.replace(/<think>[\s\S]*?<\/think>/g, "").trim(); body.textContent = final;
  if (final.slice(spoken.length).trim()) speak(final.slice(spoken.length).trim());
  addSources(el, passages); return final;
}
let busy = false;
async function ask(text) {
  text = (text || "").trim(); if (!text || busy) return; busy = true; input.value = ""; $("sendBtn").classList.add("stop");
  addTurn("user", text, "lei"); setState("thinking");
  try {
    let routed = null; try { routed = await route(text); } catch (e) { console.warn(e); }
    const passages = routed ? [] : docContext(text);
    let answer;
    if (routed) { setState("tool", routed.tool); addTool(routed.tool, (routed.result || routed.direct).slice(0, 140)); setState("thinking"); }
    if (passages.length) addTool("documenti", passages.map(cite).filter((v, i, a) => a.indexOf(v) === i).join(" · ").slice(0, 140));
    if (app.engineReady && (!routed || (routed.result && !routed.exact))) answer = await askModel(text, routed ? routed.result : "", passages);
    else if (passages.length) { answer = `Ecco i passaggi più pertinenti, ${settings.name}. ${app.engineReady ? "" : "Con il modello attivo li riassumerei io; intanto li apra qui sotto."}`.trim(); const el = addTurn("jarvis", answer, "jarvis"); addSources(el, passages); el.querySelectorAll("details")[0]?.setAttribute("open", ""); speak(answer); }
    else { answer = routed ? routed.direct : `Il modello non è ancora pronto, ${settings.name}. Intanto posso cercare nei documenti, fare calcoli da studio, dirle l'ora, il meteo, impostare promemoria e cercare su Wikipedia. Scriva "aiuto" per l'elenco.`; addTurn("jarvis", answer, "jarvis"); speak(answer); }
    history.push({ role: "user", content: text }, { role: "assistant", content: answer }); history = history.slice(-20); store.set("history", history);
  } catch (e) { console.error(e); notice("Qualcosa è andato storto: " + (e.message || e)); }
  finally { busy = false; $("sendBtn").classList.remove("stop"); if (app.state !== "speaking") setState("idle"); }
}

// ---------------------------------------------------------------- documents: add, list, remove, drag & drop
const docsDlg = $("docsDialog"), fileInput = $("fileInput");
fileInput.accept = ACCEPT;
const fmtSize = (b) => (b > 1048576 ? (b / 1048576).toFixed(1) + " MB" : Math.max(1, Math.round(b / 1024)) + " KB");
function renderDocs() {
  $("docsChip").textContent = library.size ? `${library.size} document${library.size === 1 ? "o" : "i"}` : "documenti";
  const ul = $("docsList"); ul.innerHTML = "";
  if (!library.size) { const li = document.createElement("li"); li.className = "empty"; li.textContent = "Nessun documento. Aggiunga PDF, Word o file di testo: vengono letti e cercati solo su questo dispositivo."; ul.appendChild(li); }
  library.docs.slice().sort((a, b) => b.added - a.added).forEach((d) => {
    const li = document.createElement("li"); const name = document.createElement("span"); name.className = "dname"; name.textContent = d.name;
    const meta = document.createElement("span"); meta.className = "dmeta"; meta.textContent = `${d.pages > 1 ? d.pages + " pagine · " : ""}${d.chunks.length} passaggi · ${fmtSize(d.size)}`;
    const rm = document.createElement("button"); rm.type = "button"; rm.textContent = "rimuovi"; rm.onclick = async () => { await library.remove(d.id); renderDocs(); };
    li.append(name, meta, rm); ul.appendChild(li);
  });
  $("docsClear").hidden = library.size < 2;
}
async function addFiles(files) {
  files = [...files]; if (!files.length) return;
  for (const f of files) {
    setState("tool", "leggo"); caption.textContent = `leggo ${f.name}`.toLowerCase();
    try { const d = await library.add(f); addTool("documenti", `${d.name}: ${d.pages > 1 ? d.pages + " pagine, " : ""}${d.chunks.length} passaggi indicizzati`); }
    catch (e) { console.warn(e); notice(String(e.message || e)); }
  }
  setState("idle"); renderDocs();
  if (library.size) notice(`Documenti pronti. Chieda pure, per esempio: "riassumi ${library.docs[library.docs.length - 1].name.replace(/\.[a-z0-9]+$/i, "")}".`);
}
$("attachBtn").onclick = () => fileInput.click();
fileInput.onchange = () => { addFiles(fileInput.files); fileInput.value = ""; };
$("docsChip").onclick = () => { renderDocs(); docsDlg.showModal(); };
$("docsChip").onkeydown = (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); $("docsChip").click(); } };
$("docsAdd").onclick = () => fileInput.click();
$("docsClose").onclick = () => docsDlg.close();
$("docsClear").onclick = async () => { await library.clear(); renderDocs(); };
let dragDepth = 0;
window.addEventListener("dragenter", (e) => { if ([...(e.dataTransfer?.types || [])].includes("Files")) { dragDepth++; document.body.classList.add("dropping"); } });
window.addEventListener("dragleave", () => { dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth) document.body.classList.remove("dropping"); });
window.addEventListener("dragover", (e) => e.preventDefault());
window.addEventListener("drop", (e) => { e.preventDefault(); dragDepth = 0; document.body.classList.remove("dropping"); if (e.dataTransfer?.files?.length) addFiles(e.dataTransfer.files); });

// ---------------------------------------------------------------- input: text, microphone, wake mode
$("form").addEventListener("submit", (e) => { e.preventDefault(); if (busy && app.engine) { try { app.engine.interruptGenerate(); } catch {} return; } ask(input.value); });
$("newSession").onclick = () => { history = []; store.set("history", history); transcript.innerHTML = ""; addTurn("system", "— nuova sessione —"); };
$("exportBtn").onclick = () => {
  const lines = [...transcript.querySelectorAll(".turn")].map((el) => { const who = el.querySelector(".who")?.textContent; const body = el.querySelector(".body")?.textContent ?? el.textContent; const src = [...el.querySelectorAll(".sources summary")].map((s) => "   fonte " + s.textContent).join("\n"); return (who ? who.toUpperCase() + ": " : "") + body + (src ? "\n" + src : ""); });
  const blob = new Blob([`J.A.R.V.I.S. · conversazione del ${fmtDate()}\n\n` + lines.join("\n\n")], { type: "text/plain;charset=utf-8" });
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `jarvis-${new Date().toISOString().slice(0, 10)}.txt`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
};
const SR = window.SpeechRecognition || window.webkitSpeechRecognition; let rec = null;
const startRec = (continuous) => {
  if (!SR) { notice("Il riconoscimento vocale non è disponibile in questo browser: usi Chrome."); return; }
  if (rec) rec.stop(); rec = new SR(); rec.lang = settings.lang; rec.continuous = continuous; rec.interimResults = true;
  rec.onstart = () => { app.recognizing = true; $("micBtn").classList.toggle("on", !continuous); if (!continuous) setState("listening"); };
  rec.onresult = (ev) => { let final = "", interim = ""; for (let i = ev.resultIndex; i < ev.results.length; i++) { const r = ev.results[i]; if (r.isFinal) final += r[0].transcript; else interim += r[0].transcript; } app.level = Math.min(1, 0.3 + interim.length / 40);
    if (continuous) { const m = /\b(jarvis|giarvis)\b[,.!?]?\s*(.+)/i.exec(final); if (m && m[2].trim()) ask(m[2]); } else { input.value = final || interim; if (final) ask(final); } };
  rec.onerror = (e) => { if (e.error !== "no-speech" && e.error !== "aborted") notice("microfono: " + e.error); };
  rec.onend = () => { app.recognizing = false; $("micBtn").classList.remove("on"); if (app.state === "listening") setState("idle"); if (app.wake && continuous) setTimeout(() => startRec(true), 300); };
  try { rec.start(); } catch (e) { notice("microfono: " + e.message); }
};
const stopRec = () => { if (rec) { const r = rec; rec = null; r.onend = null; r.stop(); app.recognizing = false; $("micBtn").classList.remove("on"); if (app.state === "listening") setState("idle"); } };
$("micBtn").onclick = () => { if (app.recognizing && !app.wake) stopRec(); else { app.wake = false; $("wakeBtn").classList.remove("on"); startRec(false); } };
$("wakeBtn").onclick = () => { app.wake = !app.wake; $("wakeBtn").classList.toggle("on", app.wake); if (app.wake) { notice("modalità ascolto attiva · dica \"Jarvis, …\""); startRec(true); } else stopRec(); };

// ---------------------------------------------------------------- settings dialog
const dlg = $("settings");
$("settingsBtn").onclick = () => { $("setName").value = settings.name; $("setCity").value = settings.city; $("setLang").value = settings.lang; $("setModel").value = settings.model.replace(/-q4f(16|32)_1-MLC$/, ""); $("setThink").checked = !!settings.think; dlg.showModal(); };
$("settingsBtn").onkeydown = (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); $("settingsBtn").click(); } };
$("setCancel").onclick = () => dlg.close();
$("setSave").onclick = (e) => { e.preventDefault(); const prevModel = settings.model; settings.name = $("setName").value.trim() || "Signore"; settings.city = $("setCity").value.trim(); settings.lang = $("setLang").value; settings.model = $("setModel").value; settings.think = $("setThink").checked; if (settings.model !== prevModel) settings.lastModel = ""; store.set("settings", settings); dlg.close(); if (settings.model !== prevModel) location.reload(); };

// ---------------------------------------------------------------- install prompt & boot
let installEvent = null;
window.addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); installEvent = e; if (!matchMedia("(display-mode: standalone)").matches) $("installBtn").style.display = "block"; });
$("installBtn").onclick = async () => { if (!installEvent) return; installEvent.prompt(); await installEvent.userChoice; $("installBtn").style.display = "none"; };
if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
updateReminderChip(); reminders.forEach(armReminder);
history.slice(-6).forEach((m) => addTurn(m.role === "user" ? "user" : "jarvis", m.content, m.role === "user" ? "lei" : "jarvis"));
const hour = new Date().getHours();
addTurn("jarvis", `${hour < 12 ? "Buongiorno" : hour < 18 ? "Buon pomeriggio" : "Buonasera"}, ${settings.name}. Preparo i sistemi. Scriva "aiuto" per sapere cosa so fare, o trascini qui un documento.`, "jarvis");
if (synth) synth.onvoiceschanged = () => {};
library.load().then(renderDocs);
loadEngine();
