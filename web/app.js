// J.A.R.V.I.S. for the browser: the language model runs on this device through WebGPU (WebLLM);
// the hands (clock, weather, calculator, reminders, memory, Wikipedia, studio tools, documents) are plain
// JavaScript; voice comes from the browser. Nothing leaves the device except weather/Wikipedia lookups:
// documents are read, indexed and searched inside the browser.
import { Library, ACCEPT } from "./docs.js";
import { Knowledge } from "./knowledge.js";
import { routeStudio } from "./studio.js";
import * as studio from "./studio.js";
import { Voice } from "./voice.js";
import { runLocalAgent, toolsBlock } from "./localagent.js";
import { createCpuEngine, CPU_MODELS } from "./cpuengine.js";
import { parseWhen, describeWhen } from "./when.js";
import { docxBlob, fileName } from "./docx.js";
import { summarize, summaryFocus } from "./summarize.js";
import * as calc from "./calc.js";
import * as util from "./utility.js";
import * as extract from "./extract.js";
import { TEMPLATES, findTemplate, fillTemplate } from "./templates.js";
import { icsCalendar } from "./ics.js";
import { renderRich, isRich } from "./format.js";
import { parseRecurring, nextOccurrence, describeRule } from "./when.js";
import { TOOL_DEFS, CORE_TOOLS } from "./tools.js";

const APP_VERSION = "2.0";

const $ = (id) => document.getElementById(id);
const transcript = $("transcript"), input = $("input"), stateChip = $("stateChip"), caption = $("caption");
const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
const WEBLLM_URL = "https://cdn.jsdelivr.net/npm/@mlc-ai/web-llm@0.2.88/lib/index.js";

// ---------------------------------------------------------------- settings & memory (local only)
const store = {
  get(key, fallback) { try { const v = localStorage.getItem("jarvis." + key); return v === null ? fallback : JSON.parse(v); } catch { return fallback; } },
  set(key, value) { try { localStorage.setItem("jarvis." + key, JSON.stringify(value)); } catch {} },
};
const settings = Object.assign({ name: "Signore", city: "", lang: "it-IT", model: "auto", think: false, lastModel: "", provider: "local", claudeModel: "claude-opus-5-5", voiceIt: "", voiceEn: "", voiceRate: 1, voiceGender: "male", puterModel: "", studio: "", signer: "", textSize: 1, privateMode: false, pinHash: "", briefing: true, sound: true, plan: "", billing: "annuale", renewal: "" }, store.get("settings", {}));
const claudeKey = { get: () => store.get("claudeKey", ""), set: (k) => store.set("claudeKey", k) };
const usingClaude = () => settings.provider === "claude";
const usingPuter = () => settings.provider === "puter";
const library = new Library();
const knowledge = new Knowledge();
let facts = store.get("facts", []);          // long-term memory: strings
let history = store.get("history", []);      // [{role, content}]
let inputHistory = store.get("inputHistory", []), histPos = inputHistory.length; // domande recenti, richiamabili con ↑
let reminders = store.get("reminders", []);  // [{id, message, at, rule?}]
// Statistiche d'uso, solo su questo dispositivo: servono a mostrare il tempo risparmiato.
const stats = Object.assign({ since: Date.now(), questions: 0, summaries: 0, drafts: 0, analyses: 0, calcs: 0, searches: 0, reminders: 0, minutes: 0 }, store.get("stats", {}));
const SAVED = { questions: 2, summaries: 20, drafts: 15, analyses: 10, calcs: 3, searches: 5, reminders: 1 };
const track = (kind, n = 1) => { stats[kind] = (stats[kind] || 0) + n; stats.minutes += (SAVED[kind] || 0) * n; store.set("stats", stats); };
const saveHistory = () => { if (!settings.privateMode) store.set("history", history); };
const app = { state: "idle", engine: null, engineReady: false, level: 0, streaming: null, wake: false, recognizing: false, speaking: Promise.resolve(), lang: settings.lang };

// ---------------------------------------------------------------- UI helpers
const addTurn = (cls, text, who, opts = {}) => {
  const el = document.createElement("div"); el.className = "turn " + cls;
  if (who) { const w = document.createElement("span"); w.className = "who"; w.textContent = who; el.appendChild(w); }
  const body = document.createElement("span"); body.className = "body"; body.textContent = text; el.appendChild(body);
  if (/^jarvis\b/.test(cls)) { el.dataset.q = app.currentQ || ""; if (!/streaming/.test(cls)) richify(el); }
  transcript.appendChild(el); transcript.scrollTop = transcript.scrollHeight;
  if (/^jarvis\b/.test(cls) && !/streaming/.test(cls) && text && text.length > 80 && !opts.plain) addActions(el);
  return el;
};
/** Elenchi, grassetti, link e citazioni resi leggibili (HTML sicuro da format.js); il testo originale resta in data-raw. */
function richify(el) {
  const body = el.querySelector(".body"); if (!body) return; const raw = body.dataset.raw ?? body.textContent;
  body.dataset.raw = raw; if (isRich(raw)) { body.innerHTML = renderRich(raw); body.classList.add("rich"); }
}
const rawText = (el) => { const b = el.querySelector(".body"); return (b?.dataset.raw ?? b?.textContent ?? "").trim(); };
/** Sotto ogni risposta: copia il testo, oppure scaricalo come bozza Word. */
function addActions(el) {
  if (el.querySelector(".acts")) return;
  const text = () => rawText(el);
  const box = document.createElement("div"); box.className = "acts";
  const copy = document.createElement("button"); copy.type = "button"; copy.textContent = "copia";
  copy.onclick = async () => { try { await navigator.clipboard.writeText(text()); copy.textContent = "copiato"; } catch { const r = document.createRange(); r.selectNodeContents(el.querySelector(".body")); const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r); copy.textContent = "selezionato"; } setTimeout(() => (copy.textContent = "copia"), 1600); };
  const word = document.createElement("button"); word.type = "button"; word.textContent = "word";
  word.onclick = () => { const t = text(); const title = (t.split(/[.!?\n]/)[0] || "Risposta di Jarvis").replace(/^[-*#\s]+/, "").slice(0, 70); downloadDocx(title, t); track("drafts"); };
  const say = document.createElement("button"); say.type = "button"; say.textContent = "leggi"; say.title = "Rileggi ad alta voce";
  say.onclick = () => { voice.stop(); speak(text()); };
  const learn = document.createElement("button"); learn.type = "button"; learn.textContent = "impara"; learn.title = "Salva nella base di conoscenza";
  learn.onclick = async () => { const t = text(), q = el.dataset.q || ""; const title = (q || t.split(/[.!?\n]/)[0]).replace(/[?!.]+$/, "").slice(0, 80); await knowledge.learn({ title, content: t.slice(0, 8000), source: "risposta di Jarvis, approvata da " + settings.name, origin: "user" }); renderKnowledge(); learn.textContent = "imparato"; learn.disabled = true; };
  box.append(copy, word, say, learn);
  if (el.dataset.q) { const again = document.createElement("button"); again.type = "button"; again.textContent = "riprova"; again.title = "Chiedi di nuovo"; again.onclick = () => ask(el.dataset.q); box.append(again); }
  el.appendChild(box);
}
function downloadDocx(title, body) {
  const a = document.createElement("a"); a.href = URL.createObjectURL(docxBlob(title, body, fmtDate())); a.download = fileName(title);
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000); return a.download;
}
const addTool = (name, preview) => { const el = document.createElement("div"); el.className = "turn tool"; el.innerHTML = "⚙ <b></b> <span></span>"; el.querySelector("b").textContent = name; el.querySelector("span").textContent = preview; transcript.appendChild(el); transcript.scrollTop = transcript.scrollHeight; };
const setState = (s, extra) => {
  app.state = s; stateChip.dataset.state = s; stateChip.textContent = extra || { idle: "pronto", listening: "ascolto", thinking: "elaboro", tool: "strumento", speaking: "parlo", loading: "carico" }[s] || s;
  caption.textContent = extra || { idle: "tutti i sistemi operativi", listening: "in ascolto", thinking: "elaborazione", tool: "strumento in uso", speaking: "risposta vocale", loading: "preparazione del modello" }[s] || s;
};
const notice = (text) => { addTurn("system", text); if (app.state === "idle") caption.textContent = text.toLowerCase().slice(0, 60); };
const updateReminderChip = () => { const c = $("reminderChip"); c.hidden = !reminders.length; c.textContent = reminders.length + " promemoria"; refreshTele?.(); };
let refreshTele = null;

// ---------------------------------------------------------------- speech out (voice.js: the most natural voice on this device)
const voice = new Voice({
  getSettings: () => settings,
  onStart: () => setState("speaking"),
  onEnd: () => { if (app.state === "speaking") setState("idle"); app.level = 0; },
  onWord: () => { app.level = 0.9; setTimeout(() => { app.level = 0.35; }, 120); },
});
const speak = (text) => voice.speak(text);

// ---------------------------------------------------------------- reactor (shared holographic renderer, hud/reactor.js)
window.JarvisReactor.create($("reactor"), { getState: () => ({ state: app.state, level: app.level }) });

// ---------------------------------------------------------------- tools (the hands)
const IT_DAYS = ["domenica", "lunedì", "martedì", "mercoledì", "giovedì", "venerdì", "sabato"], IT_MONTHS = ["gennaio", "febbraio", "marzo", "aprile", "maggio", "giugno", "luglio", "agosto", "settembre", "ottobre", "novembre", "dicembre"];
const fmtTime = (d = new Date()) => `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
const fmtDate = (d = new Date()) => `${IT_DAYS[d.getDay()]} ${d.getDate()} ${IT_MONTHS[d.getMonth()]} ${d.getFullYear()}`;
const WMO = { 0: "cielo sereno", 1: "poco nuvoloso", 2: "parzialmente nuvoloso", 3: "coperto", 45: "nebbia", 48: "nebbia gelata", 51: "pioviggine leggera", 53: "pioviggine", 55: "pioviggine intensa", 61: "pioggia leggera", 63: "pioggia", 65: "pioggia forte", 71: "neve leggera", 73: "neve", 75: "neve forte", 80: "rovesci leggeri", 81: "rovesci", 82: "rovesci violenti", 95: "temporale", 96: "temporale con grandine", 99: "temporale con grandine forte" };
async function geocode(place) {
  const g = await (await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(place)}&count=1&language=it&format=json`)).json();
  const loc = g.results && g.results[0]; if (!loc) throw new Error(`non trovo "${place}"`); return { lat: loc.latitude, lon: loc.longitude, name: loc.name + (loc.country ? ", " + loc.country : "") };
}
const AQI = (v) => (v <= 20 ? "buona" : v <= 40 ? "discreta" : v <= 60 ? "moderata" : v <= 80 ? "scarsa" : v <= 100 ? "molto scarsa" : "pessima");
let qrLib = null;
const loadQr = () => (qrLib ||= new Promise((res, rej) => { if (window.qrcode) return res(window.qrcode); const sc = document.createElement("script"); sc.src = "https://cdn.jsdelivr.net/npm/qrcode-generator@1.4.4/qrcode.js"; sc.onload = () => res(window.qrcode); sc.onerror = () => rej(new Error("libreria QR non raggiungibile")); document.head.appendChild(sc); }));
/** Utilità: risposte immediate (utility.js) o con la rete (distanze, sole, aria, dizionario, QR). */
async function runUtility(text) {
  const u = util.routeUtility(text); if (!u) return null;
  if (!u.need) return u;
  const here = (p) => p || settings.city;
  if (u.need === "distanza") { const [a, b] = await Promise.all([geocode(u.a), geocode(u.b)]); const km = util.haversine(a, b); return { tool: u.tool, result: `In linea d'aria da ${a.name} a ${b.name}: ${Math.round(km).toLocaleString("it-IT")} km (su strada di solito il 20-30% in più).` }; }
  if (u.need === "sole" || u.need === "aria") {
    if (!here(u.place)) return { tool: u.tool, result: `Mi dica la città, o la imposti nelle impostazioni, ${settings.name}.` };
    const g = await geocode(here(u.place));
    if (u.need === "sole") { const j = await (await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${g.lat}&longitude=${g.lon}&daily=sunrise,sunset,daylight_duration&timezone=auto&forecast_days=1`)).json(); const hm = (x) => x.slice(11, 16); const dl = j.daily.daylight_duration[0] / 3600; return { tool: u.tool, result: `Oggi a ${g.name} il sole sorge alle ${hm(j.daily.sunrise[0])} e tramonta alle ${hm(j.daily.sunset[0])}: ${Math.floor(dl)} ore e ${Math.round((dl % 1) * 60)} minuti di luce.` }; }
    const j = await (await fetch(`https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${g.lat}&longitude=${g.lon}&current=european_aqi,pm10,pm2_5,nitrogen_dioxide,ozone`)).json(); const c = j.current;
    return { tool: u.tool, result: `Qualità dell'aria a ${g.name} adesso: ${AQI(c.european_aqi)} (indice europeo ${Math.round(c.european_aqi)}). PM10 ${Math.round(c.pm10)} µg/m³, PM2,5 ${Math.round(c.pm2_5)}, biossido di azoto ${Math.round(c.nitrogen_dioxide)}, ozono ${Math.round(c.ozone)}.` };
  }
  if (u.need === "dizionario") {
    const j = await (await fetch(`https://it.wiktionary.org/w/api.php?action=query&prop=extracts&explaintext=1&redirects=1&titles=${encodeURIComponent(u.word)}&format=json&origin=*`)).json();
    const page = Object.values(j.query?.pages || {})[0], ex = page?.extract || "";
    const it = (ex.split(/\n== (?!Italiano)[^=]+ ==\n/)[0].split(/== Italiano ==/)[1] || ex).replace(/^=+ ?(.+?) ?=+$/gm, "$1:").split("\n").filter((l) => l.trim() && !/^(Sillabazione|Pronuncia|Etimologia|Sinonimi|Contrari|Parole derivate|Termini correlati|Traduzione|Note|Citazione)/.test(l)).join(" ").replace(/\s+/g, " ").slice(0, 600);
    if (it.trim().length > 20) return { tool: u.tool, result: `${u.word} (Wikizionario): ${it.trim()}` };
    const w = await wikipedia(u.word); return { tool: u.tool, result: w || `Non trovo la definizione di "${u.word}", ${settings.name}.` };
  }
  if (u.need === "qr") {
    const q = await loadQr(); const qr = q(0, "M"); qr.addData(u.data); qr.make(); const url = qr.createDataURL(8, 16);
    const el = addTurn("tool", ""); const img = document.createElement("img"); img.src = url; img.alt = "QR code: " + u.data; img.className = "qr"; const a = document.createElement("a"); a.href = url; a.download = "qr-code.gif"; a.className = "dl"; a.textContent = " scarica il QR code"; el.querySelector(".body").append(img, a);
    return { tool: u.tool, result: `QR code pronto per: ${u.data}. Lo inquadri con la fotocamera del telefono.` };
  }
  return null;
}
async function weather(place) {
  const g = await (await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(place)}&count=1&language=it&format=json`)).json();
  const loc = g.results && g.results[0]; if (!loc) return { error: `Non trovo "${place}".` };
  const w = await (await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${loc.latitude}&longitude=${loc.longitude}&current=temperature_2m,apparent_temperature,weather_code,wind_speed_10m,precipitation&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max&timezone=auto&forecast_days=2`)).json();
  const c = w.current, d = w.daily;
  return { place: `${loc.name}${loc.country ? ", " + loc.country : ""}`, now: `${WMO[c.weather_code] || "variabile"}, ${Math.round(c.temperature_2m)}°C (percepiti ${Math.round(c.apparent_temperature)}°), vento ${Math.round(c.wind_speed_10m)} km/h`, today: `min ${Math.round(d.temperature_2m_min[0])}° max ${Math.round(d.temperature_2m_max[0])}°, pioggia ${d.precipitation_probability_max[0] ?? 0}%`, tomorrow: `${WMO[d.weather_code[1]] || "variabile"}, min ${Math.round(d.temperature_2m_min[1])}° max ${Math.round(d.temperature_2m_max[1])}°, pioggia ${d.precipitation_probability_max[1] ?? 0}%` };
}
function calculate(expr) {
  expr = String(expr).replace(/(\d+(?:[.,]\d+)?)\s*(?:%|per\s*cento)\s+(?:di|del|della|dello|dei|delle|su)\s+(\d+(?:[.,]\d+)*)/gi, (_, a, b) => `(${a.replace(",", ".")}/100*${b.replace(/\.(?=\d{3}\b)/g, "").replace(",", ".")})`).replace(/^(il|lo|la|l')\s*/i, "");
  const clean = expr.replace(/,/g, ".").replace(/\^/g, "**").replace(/×/g, "*").replace(/÷/g, "/").replace(/per cento|percento|%/g, "/100").replace(/\s+(per|x)\s+/gi, "*").replace(/\s+diviso\s+/gi, "/").replace(/\s+più\s+/gi, "+").replace(/\s+meno\s+/gi, "-").replace(/radice di\s*/gi, "Math.sqrt");
  if (!/^[\d\s.+\-*/()%Math.sqrtpowabs,eE]+$/.test(clean)) return null;
  try { const v = Function(`"use strict"; return (${clean});`)(); return Number.isFinite(v) ? Math.round(v * 1e6) / 1e6 : null; } catch { return null; }
}
async function wikipedia(topic, lang = "it") {
  const r = await fetch(`https://${lang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(topic.trim().replace(/\s+/g, "_"))}`, { headers: { accept: "application/json" } });
  if (!r.ok) return null; const j = await r.json(); return j.extract ? `${j.title}: ${j.extract}` : null;
}
function scheduleReminder(message, at, rule = null) {
  const r = { id: Date.now() + Math.floor(Math.random() * 1000), message, at, ...(rule ? { rule } : {}) }; reminders.push(r); store.set("reminders", reminders); updateReminderChip(); armReminder(r); track("reminders"); return r;
}
const timers = new Map();
function cancelReminder(id) { clearTimeout(timers.get(id)); timers.delete(id); reminders = reminders.filter((x) => x.id !== id); store.set("reminders", reminders); updateReminderChip(); renderReminders(); }
/** Un breve segnale acustico (WebAudio), oltre alla voce e alla notifica. */
function chime() {
  if (!settings.sound) return;
  try { const ac = new (window.AudioContext || window.webkitAudioContext)(); [0, 0.18].forEach((t, i) => { const o = ac.createOscillator(), g = ac.createGain(); o.frequency.value = i ? 1046 : 784; g.gain.setValueAtTime(0.0001, ac.currentTime + t); g.gain.exponentialRampToValueAtTime(0.18, ac.currentTime + t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + t + 0.35); o.connect(g).connect(ac.destination); o.start(ac.currentTime + t); o.stop(ac.currentTime + t + 0.4); }); setTimeout(() => ac.close(), 1200); } catch {}
}
function fireReminder(r) {
  const due = new Date(r.at), late = Date.now() - r.at > 90e3;
  if (r.rule) { r.at = nextOccurrence(r.rule, new Date(Math.max(Date.now(), r.at))); store.set("reminders", reminders); armReminder(r); }
  else { reminders = reminders.filter((x) => x.id !== r.id); store.set("reminders", reminders); }
  updateReminderChip(); renderReminders(); app.lastFired = r;
  const el = addTurn("reminder", "⏰ " + r.message + (late ? ` (era previsto per le ${fmtTime(due)} del ${due.toLocaleDateString("it-IT")}, mentre l'app era chiusa)` : "") + (r.rule ? ` · si ripete ${describeRule(r.rule)}` : ""));
  const box = document.createElement("div"); box.className = "acts";
  for (const [label, mins] of [["rimanda 10 min", 10], ["rimanda 1 ora", 60]]) { const b = document.createElement("button"); b.type = "button"; b.textContent = label; b.onclick = () => { scheduleReminder(r.message, Date.now() + mins * 60e3); b.textContent = "rimandato"; box.querySelectorAll("button").forEach((x) => (x.disabled = true)); }; box.appendChild(b); }
  el.appendChild(box); chime(); speak(`${settings.name}, ${r.message}`);
  try { if (Notification.permission === "granted") new Notification("J.A.R.V.I.S.", { body: r.message, icon: "icon-192.png", tag: "jarvis-" + r.id }); } catch {}
}
const MAX_TIMER = 2 ** 31 - 1; // i timer del browser non vanno oltre circa 24,8 giorni: oltre si riarmano
function armReminder(r) {
  clearTimeout(timers.get(r.id));
  const delay = Math.max(0, r.at - Date.now());
  if (delay > MAX_TIMER) { timers.set(r.id, setTimeout(() => armReminder(r), MAX_TIMER)); return; }
  timers.set(r.id, setTimeout(() => fireReminder(r), delay));
}

// ---------------------------------------------------------------- strumenti di studio: documenti, modelli, calendario
const ctxForTemplates = () => ({ studio: settings.studio, signer: settings.signer, city: settings.city, name: settings.name });
const downloadFile = (name, blob) => { const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000); };
/** Un link di download nella conversazione (Word, calendario…), che resta cliccabile anche dopo. */
function offerDownload(label, name, blob) {
  const el = addTurn("tool", ""); const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = name; a.textContent = label; a.className = "dl"; el.querySelector(".body").appendChild(a); return name;
}
const docText = (d) => library.fullText(d.id, 400000);
/** Il documento di cui parla la frase: nominato, oppure l'unico caricato. */
const docFor = (text) => library.mentioned(text) || (library.size === 1 ? library.docs[0] : null);
/** Due documenti da confrontare: quelli nominati, oppure gli unici due caricati. */
function twoDocs(text) {
  const q = text.toLowerCase();
  const by = library.docs.filter((d) => d.name.replace(/\.[a-z0-9]+$/i, "").toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 2 && !/^(contratto|documento|versione|file|bozza|copia)$/.test(w)).some((w) => q.includes(w)));
  if (by.length >= 2) return by.slice(0, 2);
  return library.size === 2 ? library.docs.slice() : null;
}
function remindersIcs() { return new Blob([icsCalendar(reminders.map((r) => ({ title: r.message, at: r.at, rule: r.rule })), "Promemoria J.A.R.V.I.S.")], { type: "text/calendar" }); }
function fiscalIcs() { const l = calc.scadenzeFiscali(new Date(), 366).list; return new Blob([icsCalendar(l.map((x) => ({ title: x.title, date: x.date, description: "Scadenza fiscale ordinaria: verificare eventuali proroghe sul sito dell'Agenzia delle Entrate." })), "Scadenze fiscali")], { type: "text/calendar" }); }
function listReminders() {
  if (!reminders.length) return "Nessun promemoria attivo.";
  return reminders.slice().sort((a, b) => a.at - b.at).map((r) => `- ${describeWhen(r.at)}: ${r.message}${r.rule ? ` (${describeRule(r.rule)})` : ""}`).join("\n");
}
async function exchange(amount, from, to) {
  const r = await fetch(`https://api.frankfurter.app/latest?amount=${amount}&from=${from}&to=${to}`); if (!r.ok) throw new Error("cambio non disponibile per queste valute");
  const j = await r.json(), v = j.rates?.[to]; if (v == null) throw new Error("cambio non disponibile");
  return `${amount.toLocaleString("it-IT")} ${from} = ${v.toLocaleString("it-IT", { maximumFractionDigits: 2 })} ${to} (cambio di riferimento BCE del ${new Date(j.date).toLocaleDateString("it-IT")}).`;
}
function briefing() {
  const now = new Date(), today = reminders.filter((r) => new Date(r.at).toDateString() === now.toDateString()).sort((a, b) => a.at - b.at);
  const fiscal = calc.scadenzeFiscali(now, 7).list;
  const parts = [`Oggi è ${fmtDate(now)}, sono le ${fmtTime(now)}.`];
  parts.push(today.length ? `Promemoria di oggi: ${today.map((r) => `${fmtTime(new Date(r.at))} ${r.message}`).join("; ")}.` : "Nessun promemoria per oggi.");
  parts.push(fiscal.length ? `Scadenze fiscali entro una settimana: ${fiscal.map((x) => `${x.date.getDate()}/${x.date.getMonth() + 1} ${x.title}`).join("; ")}.` : "Nessuna scadenza fiscale ordinaria entro una settimana.");
  if (library.size) parts.push(`In archivio ${library.size} document${library.size === 1 ? "o" : "i"} e ${knowledge.size} conoscenze.`);
  return parts.join(" ");
}
function statsText() {
  const h = Math.floor(stats.minutes / 60), m = stats.minutes % 60, since = new Date(stats.since).toLocaleDateString("it-IT");
  return `Dal ${since}: ${stats.questions} domande, ${stats.summaries} riassunti, ${stats.drafts} bozze e modelli, ${stats.analyses} analisi di documenti, ${stats.calcs} calcoli, ${stats.searches} ricerche nei documenti, ${stats.reminders} promemoria. Tempo risparmiato stimato: ${h ? h + " ore e " : ""}${m} minuti.`;
}
const NEWS = () => `Novità della versione ${APP_VERSION}: risposte formattate con pulsanti copia, word, leggi, impara e riprova; calcoli da studio nuovi (interessi legali, mutuo, importi in lettere, codice fiscale, forfettario, prestazione occasionale, compenso dal netto, margini, sconti, ore lavorate); scadenzario fiscale e calendario .ics; analisi dei documenti (scadenze, importi, dati, clausole, leggibilità), confronto tra versioni e anonimizzazione; 14 modelli di documento; promemoria ricorrenti con rinvio; briefing del giorno; statistiche del tempo risparmiato; PIN, modalità privata, backup e cancellazione dei dati; dati dello studio e dell'abbonamento nelle impostazioni.`;

/** Fast intent routing: the hands act first, the model phrases the answer. Returns {tool, result, direct} or null. */
const HELP = () => `Ecco cosa so fare, ${settings.name}.
- Documenti: li carichi con la graffetta e mi chieda cosa contengono; "riassumi" e il nome per il riassunto dell'intero documento; "estrai le scadenze", "gli importi", "i dati" o "le clausole"; "analizza" per tutto insieme; "confronta" due versioni; "anonimizza" per una copia senza dati personali; "leggimi" per l'ascolto. Restano su questo dispositivo.
- Modelli: "modelli" apre 14 atti pronti in Word (sollecito, diffida, disdetta, incarico, preventivo, convocazione, verbale, documenti per il 730, avviso di scadenza, informativa privacy, benvenuto, delega, quietanza, policy AI).
- Calcoli da studio: IVA, fattura del professionista, compenso dal netto, forfettario, prestazione occasionale, split payment, interessi legali tra due date, rata del mutuo, importi in lettere, codice fiscale, margini, sconti, ore lavorate, cambio valute, giorni tra date e scadenze con le festività.
- Scadenze fiscali: "prossime scadenze fiscali", anche come calendario da importare.
- Promemoria: "ricordami domani alle 9 di…", "ogni lunedì alle 9…", "il 16 di ogni mese…"; "quali promemoria ho", "rimanda di 10 minuti", "esporta i promemoria nel calendario".
- Ogni risposta ha i pulsanti copia, word, leggi, impara e riprova. "Briefing" riassume la giornata, "quanto tempo mi hai fatto risparmiare" mostra le statistiche.
- Conoscenza: "impara che…", "cosa hai imparato", "studia…" e "ricerca approfondita su…".
- Utilità: "che ore sono a Tokyo", "converti 10 km in miglia", "distanza tra Milano e Roma", "alba a Napoli", "qualità dell'aria a Torino", "cosa significa…", "crea un QR code per…", "genera una password", "festività 2027", "che settimana è".
- Voce: il microfono per parlare, "ripeti", "basta", "parla più piano".
Per il resto, conversazione libera${settings.provider === "claude" ? " con Claude" : settings.provider === "puter" ? " con i modelli di punta tramite Puter" : " con il modello che gira su questo dispositivo; per la potenza massima scelga Puter nelle impostazioni"}.`;
async function route(text) {
  const t = text.toLowerCase().trim(); let m0;
  // voce e conversazione
  if (/^(basta|stop|silenzio|zitto|fermati|smetti di parlare)[.!]*$/.test(t)) { voice.stop(); return { tool: "voce", result: "", direct: "", silent: true }; }
  if (/^(ripeti|puoi ripetere|come hai detto|ripetilo)\b/.test(t)) { const last = [...transcript.querySelectorAll(".turn.jarvis")].pop(); const a = last ? rawText(last) : ""; return { tool: "voce", result: "", direct: a || `Non ho ancora detto nulla da ripetere, ${settings.name}.` }; }
  if (/\bparla (?:più|piu) (piano|lentamente|lento|veloce|velocemente|in fretta)\b/.test(t)) { const slower = /piano|lent/.test(t); settings.voiceRate = Math.max(0.6, Math.min(1.6, Math.round(((+settings.voiceRate || 1) + (slower ? -0.1 : 0.1)) * 10) / 10)); store.set("settings", settings); return { tool: "voce", result: "", direct: `Va bene, ${settings.name}: velocità della voce ${settings.voiceRate.toLocaleString("it-IT")}.` }; }
  if (/^(buongiorno|buon pomeriggio|buonasera)?\s*(jarvis)?[,!]?\s*(briefing|riepilogo (?:della|di) (?:giornata|oggi)|cosa ho oggi|come (?:è|e) la giornata|che cosa ho in programma)\b/.test(t) || /^(buongiorno|buondì)\s*(jarvis)?[.!]*$/.test(t)) return { tool: "briefing", result: briefing(), direct: `${new Date().getHours() < 12 ? "Buongiorno" : "Buonasera"}, ${settings.name}. ${briefing()}`, exact: true };
  if (/\b(tempo (?:mi hai fatto )?risparmiat|quanto tempo (?:ho|mi hai fatto|mi fai) risparmi|statistiche (?:di |d')uso|quanto ti uso)/.test(t)) return { tool: "statistiche", result: statsText(), direct: statsText() + ` Grazie a lei, ${settings.name}.`, exact: true };
  if (/\b(novità|cosa c'è di nuovo|cosa ce di nuovo|ultima versione|che versione)(?![a-zà-ÿ])/.test(t)) return { tool: "novità", result: "", direct: NEWS() };
  if (/^(blocca|blocca jarvis|blocca lo schermo)[.!]*$/.test(t)) { if (!settings.pinHash) return { tool: "privacy", result: "", direct: `Prima imposti un PIN nelle impostazioni, ${settings.name}.` }; lockScreen(); return { tool: "privacy", result: "", direct: "", silent: true }; }
  // modelli di documento
  if (/^(modelli|che modelli hai|quali modelli|elenco (?:dei )?modelli|mostra(?:mi)? i modelli)\b/.test(t)) { openTemplates(); return { tool: "modelli", result: "", direct: `Ho ${TEMPLATES.length} modelli pronti, ${settings.name}: ${TEMPLATES.map((x) => x.title.toLowerCase()).join(", ")}. Li ho aperti: scelga, compili i campi e scarichi il Word.` }; }
  const tpl = /\b(modello|prepara|preparami|scrivi|scrivimi|redigi|fammi|crea|compila)\b/.test(t) && !/\b(ricordami|ricorda|promemoria|avvisami)\b/.test(t) ? findTemplate(t) : null;
  if (tpl && !(agentCapable() || usingPuter() || usingClaude())) { openTemplates(tpl.id); return { tool: "modelli", result: "", direct: `Ho aperto il modello "${tpl.title}", ${settings.name}: compili i campi che conosce e scarichi il Word.` }; }
  // documenti: analisi, confronto, anonimizzazione, lettura ad alta voce
  if (library.size && /\b(confronta|differenze tra|cosa (?:è|e) cambiato|paragona)\b/.test(t)) { const two = twoDocs(text); if (two) { const r = extract.confronta(docText(two[0]), docText(two[1])); track("analyses"); return { tool: "confronto", result: `Confronto tra ${two[0].name} (A) e ${two[1].name} (B). ${r.text}`, direct: `Confronto tra ${two[0].name} e ${two[1].name}. ${r.text}`, exact: true }; } }
  if (library.size && /\banonimizz|\boscura i dati|\btogli i dati personali/.test(t)) { const d = docFor(text); if (d) { const r = extract.anonimizza(docText(d), (/(?:nomi|oscura anche)\s*:?\s*(.+)$/i.exec(text) || [])[1]?.split(/,|\be\b/) || []); const title = d.name.replace(/\.[a-z0-9]+$/i, "") + " - anonimizzato"; offerDownload(`📄 ${fileName(title)} · copia anonimizzata in Word`, fileName(title), docxBlob(title, r.text, fmtDate())); track("analyses"); return { tool: "anonimizza", result: "", direct: `Copia anonimizzata di ${d.name} pronta, ${settings.name}. ${r.summary} La ricontrolli prima di condividerla: nomi senza titolo (Sig., Dott., Avv.) li indichi con "anonimizza ${d.name.replace(/\.[a-z0-9]+$/i, "")} nomi: Rossi, Bianchi".`, exact: true }; } }
  if (library.size && /\b(estrai|elenca|trova|quali sono|dammi)\b.*\b(scadenz|date|importi|cifre|dati|codici fiscali|iban|partite iva|clausole)|\banalizza\b|\bleggibilit|\bstatistiche del (?:documento|file|testo)/.test(t)) {
    const d = docFor(text); if (d) {
      const what = /scadenz|date/.test(t) ? "scadenze" : /importi|cifre/.test(t) ? "importi" : /dati|codici fiscali|iban|partite iva/.test(t) ? "dati" : /clausole/.test(t) ? "clausole" : /leggibilit|statistiche/.test(t) ? "statistiche" : "tutto";
      const r = extract.rapporto(d.name, docText(d), what); track("analyses");
      return { tool: "analisi", result: r, direct: r, exact: true };
    }
  }
  if (library.size && /^(leggimi|leggi ad alta voce|leggi)\b/.test(t) && !/wikipedia/.test(t)) { const d = docFor(text); if (d && (library.mentioned(text) || /\b(documento|file|contratto|testo)\b/.test(t))) { const full = docText(d).replace(/\[p\. \d+\]/g, ""); voice.stop(); speak(full.slice(0, 20000)); return { tool: "lettura", result: "", direct: `Leggo ${d.name}, ${settings.name}. Dica "basta" o prema Esc per fermarmi.`, silent: false, noSpeak: true }; } }
  // utilità: fusi orari, conversioni, password, festività, distanze, sole, aria, dizionario, QR
  try { const u = /\b(ricordami|ricorda di|ricordati di|avvisami|promemoria)\b/.test(t) ? null : await runUtility(text); if (u) { track("calcs"); return { tool: u.tool, result: u.result, direct: u.result, exact: true }; } } catch (e) { return { tool: "utilità", result: "", direct: `Non ci riesco adesso (${e.message}), ${settings.name}.` }; }
  // cambio valuta (BCE)
  const fx = calc.parseCambio(t); if (fx) { try { const r = await exchange(fx.amount, fx.from, fx.to); track("calcs"); return { tool: "cambio", result: r, direct: r, exact: true }; } catch (e) { return { tool: "cambio", result: "", direct: `Non riesco a ottenere il cambio adesso (${e.message}), ${settings.name}.` }; } }
  if (/^(aiuto|help|cosa sai fare|che cosa sai fare|comandi|cosa puoi fare)\b/.test(t)) return { tool: "aiuto", result: "", direct: HELP() };
  if (/\b(quali|che|elenca|lista)\b.*\b(documenti|file)\b/.test(t) && !/\b(dice|contien|parla)/.test(t)) { const list = library.docs.map((d) => `${d.name} (${d.pages > 1 ? d.pages + " pagine" : d.chars < 1000 ? d.chars + " caratteri" : Math.round(d.chars / 1000) + " mila caratteri"})`); return { tool: "documenti", result: list.length ? "Documenti caricati: " + list.join("; ") : "Nessun documento caricato.", direct: list.length ? `Ho ${list.length} documenti, ${settings.name}: ${list.join("; ")}.` : `Nessun documento caricato, ${settings.name}. Usi la graffetta per aggiungerne.` }; }
  if (/\b(quali|che|elenca|lista|mostra)\b.*\bpromemoria\b|\bpromemoria (attivi|impostati)\b/.test(t)) return { tool: "promemoria", result: listReminders(), direct: reminders.length ? `Ecco i promemoria, ${settings.name}:\n${listReminders()}` : `Nessun promemoria attivo, ${settings.name}.`, exact: true };
  if (/\b(cancella|elimina|togli|annulla)\b.*\bpromemoria\b/.test(t)) {
    if (/\btutti\b/.test(t)) { const n = reminders.length; reminders.slice().forEach((r) => cancelReminder(r.id)); return { tool: "promemoria", result: "", direct: `Cancellati ${n} promemoria, ${settings.name}.` }; }
    const words = t.replace(/\b(cancella|elimina|togli|annulla|il|lo|i|gli|promemoria|di|del|per|che|mi|ricorda)\b/g, " ").split(/\s+/).filter((w) => w.length > 2);
    const hit = reminders.filter((r) => words.length && words.every((w) => r.message.toLowerCase().includes(w)));
    if (hit.length) { hit.forEach((r) => cancelReminder(r.id)); return { tool: "promemoria", result: "", direct: `Cancellat${hit.length === 1 ? "o il promemoria" : "i " + hit.length + " promemoria"}: ${hit.map((r) => r.message).join("; ")}.` }; }
    return { tool: "promemoria", result: "", direct: `Non trovo quel promemoria, ${settings.name}. ${reminders.length ? "Ecco quelli attivi:\n" + listReminders() : "Non ce ne sono di attivi."}` };
  }
  if ((m0 = /\brimanda(?:mi|lo)?\b(?:\s+(?:di|tra|fra))?\s*(\d+|un|una|mezz'?ora|dieci|cinque|quindici|venti|trenta)?\s*(minut\w*|or[ae])?/.exec(t)) && app.lastFired) {
    const n = { un: 1, una: 1, cinque: 5, dieci: 10, quindici: 15, venti: 20, trenta: 30 }[m0[1]] ?? (m0[1] && /mezz/.test(m0[1]) ? 30 : +m0[1] || 10); const mins = /^or/.test(m0[2] || "") ? n * 60 : n;
    const r = scheduleReminder(app.lastFired.message, Date.now() + mins * 60e3); return { tool: "promemoria", result: "", direct: `Rimandato ${describeWhen(r.at)}, ${settings.name}.`, exact: true };
  }
  if (/\b(esporta|scarica|aggiungi|metti)\b.*\bpromemoria\b.*\b(calendario|ics|outlook|google)\b|\bpromemoria\b.*\b(nel|in) calendario\b/.test(t)) {
    if (!reminders.length) return { tool: "calendario", result: "", direct: `Non ci sono promemoria da esportare, ${settings.name}.` };
    offerDownload(`📅 promemoria.ics · aprilo con Google Calendar, Outlook o Calendario`, "promemoria-jarvis.ics", remindersIcs());
    return { tool: "calendario", result: "", direct: `Ecco il file del calendario con ${reminders.length} promemoria, ${settings.name}: lo apra e si aggiungono da soli.` };
  }
  if (/scadenz\w* fiscal\w*.*\b(calendario|ics|outlook|google)\b|\b(calendario|ics)\b.*scadenz\w* fiscal/.test(t)) {
    offerDownload("📅 scadenze-fiscali.ics · un anno di scadenze, con avviso tre giorni prima", "scadenze-fiscali.ics", fiscalIcs());
    return { tool: "calendario", result: "", direct: `Ecco le scadenze fiscali ordinarie dei prossimi dodici mesi in un file di calendario, ${settings.name}, con un avviso tre giorni prima di ciascuna.` };
  }
  const recur = /\b(ogni|tutti i|tutte le|nei giorni feriali|di ogni mese|di ogni anno)\b/.test(t) && /\b(ricordami|ricorda di|ricordati di|avvisami|promemoria)\b/.test(t) ? parseRecurring(text) : null;
  if (recur) {
    const r = scheduleReminder(recur.rest || "promemoria", recur.at, recur.rule);
    try { if ("Notification" in window && Notification.permission === "default") Notification.requestPermission(); } catch {}
    return { tool: "promemoria", result: `Promemoria ricorrente ${describeRule(recur.rule)}: ${r.message}. Il primo ${describeWhen(r.at)}.`, direct: `Fatto. Glielo ricordo ${describeRule(recur.rule)}, ${settings.name}; la prima volta ${describeWhen(r.at)}.`, exact: true };
  }
  if (/\b(ricordami|ricorda di|ricordati di|timer|sveglia|svegliami|avvisami|remind me)\b/.test(t)) {
    const when = parseWhen(text);
    if (!when && /\bricordami\s+(cosa|chi|come|qual|quant|dove|perch|il nome|che cosa)/.test(t)) { /* è una domanda, non un promemoria */ }
    else if (!when) return { tool: "promemoria", result: "", direct: `Quando, ${settings.name}? Per esempio "tra dieci minuti", "domani alle 9" o "il 16/12 alle 10".` };
    else {
    const r = scheduleReminder(when.rest || "promemoria", when.at); const said = describeWhen(when.at);
    try { if ("Notification" in window && Notification.permission === "default") Notification.requestPermission(); } catch {}
    return { tool: "promemoria", result: `Promemoria impostato ${said}: ${r.message}.`, direct: `Fatto. Glielo ricordo ${said}, ${settings.name}.`, exact: true };
    }
  }
  const more = calc.routeCalc(text); if (more) { track("calcs"); return { tool: more.tool, result: more.result, direct: more.result, exact: true }; }
  const studio = routeStudio(text); if (studio) { track("calcs"); return { tool: studio.tool, result: studio.result, direct: studio.result, exact: true }; }
  if (/^(che ore sono|che ora è|che ora e|che ora sono|dimmi l.ora|sai che ore sono|what time)/.test(t) || /\b(che ore sono|what time is it)\b/.test(t)) return { tool: "orologio", result: `Ora: ${fmtTime()}, ${fmtDate()}.`, direct: `Sono le ${fmtTime()}, ${settings.name}.` };
  if (/\b(che giorno|data di oggi|what day|what's the date)\b/.test(t)) return { tool: "calendario", result: `Oggi è ${fmtDate()}.`, direct: `Oggi è ${fmtDate()}, ${settings.name}.` };
  if (/\b(meteo|tempo fa|che tempo|piove|pioverà|temperatura|weather|gradi)(?![a-zà-ÿ])/.test(t)) {
    const clean = text.trim().replace(/[?.!]+$/, "").replace(/\s+(oggi|domani|dopodomani|stasera|stamattina|adesso|ora|questa settimana|nel weekend)$/i, "");
    const m = /\b(?:a|in|ad|at|per)\s+([A-Za-zÀ-ÿ' ]{2,30})$/i.exec(clean); const place = (m && m[1].trim()) || settings.city;
    if (!place) return { tool: "meteo", result: "", direct: `Per il meteo mi serve una città, ${settings.name}: la imposti nelle impostazioni, oppure me la dica.` };
    const w = await weather(place); if (w.error) return { tool: "meteo", result: w.error, direct: w.error };
    return { tool: "meteo", result: `Meteo a ${w.place}: adesso ${w.now}. Oggi ${w.today}. Domani ${w.tomorrow}.`, direct: `A ${w.place} adesso ${w.now}. Oggi ${w.today}; domani ${w.tomorrow}.` };
  }
  const studyM = /^(?:studia|studiati|informati su|impara tutto su|impara su|documentati su)\s+(?:l'|il |lo |la |i |gli |le |un |una )?(.+?)[?.!]*$/i.exec(text.trim());
  if (studyM && !agentCapable()) return await studyOnWikipedia(studyM[1].trim());
  const learnM = /^(impara che|impara:|imparalo:|sappi che|tieni presente che)\s*(.+)$/is.exec(text.trim());
  if (learnM) { const content = learnM[2].trim(); const title = content.split(/[.:;\n]/)[0].split(/\s+/).slice(0, 8).join(" "); const r = await knowledge.learn({ title, content, source: "insegnato da " + settings.name, origin: "user" }); renderKnowledge(); return { tool: "conoscenza", result: `${r.updated ? "Aggiornato" : "Imparato"}: ${title}`, direct: `${r.updated ? "Aggiornato" : "Imparato"}, ${settings.name}. Lo userò d'ora in poi.` }; }
  if (/\b(cosa hai imparato|che cosa hai imparato|cosa sai fare di nuovo|mostrami la conoscenza)\b/.test(t)) { const list = knowledge.recent(8).map((k) => k.title); return { tool: "conoscenza", result: list.length ? "Voci recenti: " + list.join("; ") : "Nessuna voce.", direct: list.length ? `Ho imparato ${knowledge.size} cose, ${settings.name}. Le più recenti: ${list.join("; ")}.` : `Per ora non ho imparato nulla, ${settings.name}. Mi insegni qualcosa con "impara che…".` }; }
  if (/^(ricorda che|ricordati che|memorizza che|remember that)\s+/i.test(text.trim())) { const fact = text.trim().replace(/^(ricorda che|ricordati che|memorizza che|remember that)\s+/i, ""); facts.push(fact); store.set("facts", facts); return { tool: "memoria", result: `Memorizzato: ${fact}`, direct: `Annotato, ${settings.name}.` }; }
  if (/\b(cosa sai di me|cosa ti ho detto|cosa ricordi|what do you remember)\b/.test(t)) return { tool: "memoria", result: facts.length ? "Fatti memorizzati: " + facts.join("; ") : "Nessun fatto memorizzato.", direct: facts.length ? `Ricordo questo, ${settings.name}: ${facts.join("; ")}.` : `Per ora non mi ha detto nulla da ricordare, ${settings.name}.` };
  const calcM = /^(quanto fa|calcola|calculate|what is|quanto è)\s+(.+)$/i.exec(text.trim().replace(/[?.!]+$/, "")); if (calcM) { const v = calculate(calcM[2]); if (v != null) return { tool: "calcolatrice", result: `${calcM[2]} = ${v}`, direct: `Fa ${String(v).replace(".", ",")}, ${settings.name}.` }; }
  const who = /^(chi è|chi era|cos'è|cosa è|che cos'è|who is|what is)\s+(.+)$/i.exec(text.trim().replace(/[?.!]+$/, "")); if (who) { who[2] = who[2].replace(/^(il|lo|la|l'|i|gli|le|un|uno|una|un'|the|a|an)\s*/i, ""); const r = await wikipedia(who[2], /^who|^what/i.test(who[1]) ? "en" : "it").catch(() => null); if (r) return { tool: "wikipedia", result: r, direct: r }; }
  return null;
}

// Ricerca approfondita: più voci di Wikipedia (italiano e inglese), poi un rapporto con fonti numerate dal cervello attivo.
async function deepResearch(topic) {
  setState("tool", "ricerca"); addTool("ricerca approfondita", topic);
  const search = async (lang, n) => { try { const j = await (await fetch(`https://${lang}.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(topic)}&srlimit=${n}&format=json&origin=*`)).json(); return (j.query?.search || []).map((h) => ({ lang, title: h.title })); } catch { return []; } };
  const [it, en] = await Promise.all([search("it", 5), search("en", 3)]);
  const picks = [...it.slice(0, 3), ...en.slice(0, 1)];
  const read = await Promise.all(picks.map((pk) => TOOLS.leggi_wikipedia({ titolo: pk.title, lingua: pk.lang }).catch(() => null)));
  const passages = read.map((r, i) => (r && r.sources ? { doc: r.sources[0].doc + (picks[i].lang === "en" ? " (en)" : ""), page: null, text: r.text.split("\n\n").slice(1).join("\n\n").slice(0, 3500), url: (/\(fonte: (\S+)\)/.exec(r.text) || [])[1] || "" } : null)).filter(Boolean).map((p, i) => ({ ...p, n: i + 1 }));
  if (!passages.length) { const a = `Non trovo fonti su "${topic}", ${settings.name}.`; addTurn("jarvis", a, "jarvis"); speak(a); return a; }
  addTool("fonti", passages.map((p) => p.doc).join(" · ").slice(0, 160));
  const brief = `Ricerca approfondita su "${topic}". Usa solo le fonti numerate qui sotto. Scrivi un rapporto: una sintesi di due o tre frasi, poi da quattro a sette punti chiave con date e numeri esatti, ciascuno citato come [n]; chiudi con ciò che resta incerto. Poi salva i punti chiave nella conoscenza con impara (titolo: "${topic}", fonte: le voci di Wikipedia).`;
  const withSources = brief + "\n\n" + passages.map((p) => `[${p.n}] ${p.doc}${p.url ? " (" + p.url + ")" : ""}\n${p.text}`).join("\n\n");
  let answer;
  if (usingPuter() && puterMod?.isSignedIn()) answer = await askPuter(withSources);
  else if (usingClaude() && claudeKey.get()) answer = await askClaude(withSources);
  else if (agentCapable()) answer = await askLocal(brief, "", passages, 1400);
  else {
    for (const p of passages) await knowledge.learn({ title: p.doc.replace(/^Wikipedia: /, ""), content: p.text.slice(0, 1800), source: p.url || "Wikipedia", origin: "claude" });
    renderKnowledge();
    answer = `Ho letto ${passages.length} voci su "${topic}" e le ho salvate nella conoscenza, ${settings.name}. Con un cervello più grande ne scriverei anche il rapporto; intanto le trova qui sotto.`;
    const el = addTurn("jarvis", answer, "jarvis"); addSources(el, passages); speak(answer); return answer;
  }
  const last = [...transcript.querySelectorAll(".turn.jarvis")].pop(); if (last && !last.querySelector(".sources")) addSources(last, passages);
  return answer;
}

// Studio senza modello: Wikipedia, voce più pertinente, scheda di conoscenza con la fonte.
const agentCapable = () => app.engineReady && !/0\.6B|-cpu$/.test(app.model || "");
async function studyOnWikipedia(topic) {
  const found = await TOOLS.cerca_wikipedia({ query: topic });
  const first = /^- (.+?):/m.exec(found.text);
  if (!first) return { tool: "wikipedia", result: "", direct: `Su Wikipedia non trovo nulla su "${topic}", ${settings.name}.` };
  const page = await TOOLS.leggi_wikipedia({ titolo: first[1] });
  const body = page.text.split("\n\n").slice(1).join("\n\n").trim();
  if (!body) return { tool: "wikipedia", result: "", direct: `Non riesco a leggere la voce "${first[1]}", ${settings.name}.` };
  const url = (/\(fonte: (\S+)\)/.exec(page.text) || [])[1] || "Wikipedia";
  const summary = body.split(/\n+/).filter((l) => l.length > 40 && !/^=+/.test(l)).join("\n").slice(0, 1800);
  const r = await knowledge.learn({ title: first[1], content: summary, source: url, origin: "claude" }); renderKnowledge();
  const lead = (summary.match(/^(.+?[.!?])\s+(.+?[.!?])/) || [summary.slice(0, 240)])[0];
  return { tool: "studio", result: "", direct: `${r.updated ? "Ho aggiornato" : "Ho studiato"} "${first[1]}" su Wikipedia e l'ho salvato nella conoscenza, ${settings.name}. In breve: ${lead}` };
}

// ---------------------------------------------------------------- Claude (cloud): il cervello più capace, senza modelli da scaricare
let claudeMod = null, claudeSession = null;
const loadClaude = async () => (claudeMod ||= await import("./claude.js"));
const contextLine = (question = "") => {
  const known = knowledge.relevant(question, 3);
  return [`oggi è ${fmtDate()}, sono le ${fmtTime()}`, settings.city ? `città dell'utente: ${settings.city}` : "", facts.length ? `fatti memorizzati: ${facts.join("; ")}` : "nessun fatto memorizzato",
    library.size ? `documenti caricati: ${library.docs.map((d) => d.name).join("; ")}` : "nessun documento caricato",
    knowledge.size ? `base di conoscenza: ${knowledge.size} voci` : "base di conoscenza vuota",
    known.length ? "conoscenze pertinenti:\n" + known.map((k) => `- ${k.title}: ${k.content.slice(0, 600)}${k.source ? ` (fonte: ${k.source})` : ""}`).join("\n") : ""].filter(Boolean).join(". ") + ".";
};
const TOOLS = {
  async search_documents({ query, file }) {
    if (!library.size) return { text: "Nessun documento caricato. L'utente può aggiungerne con la graffetta." };
    const doc = file ? library.find(file) : null; if (file && !doc) return { text: `Nessun documento il cui nome contiene "${file}". Documenti: ${library.docs.map((d) => d.name).join("; ")}.` };
    const hits = library.search(query, 6, doc ? doc.id : null); if (!hits.length) return { text: `Nessun passaggio pertinente per "${query}".` };
    const base = (TOOLS._n ||= 0); const passages = hits.map((h, i) => ({ ...h, n: base + i + 1 })); TOOLS._n = base + hits.length;
    return { text: passages.map((p) => `[${p.n}] (${cite(p)})\n${p.text}`).join("\n\n"), sources: passages };
  },
  async read_document({ file }) { const d = library.find(file); if (!d) return { text: `Documento "${file}" non trovato. Documenti: ${library.docs.map((x) => x.name).join("; ") || "nessuno"}.` }; return { text: `Documento: ${d.name}\n\n${library.fullText(d.id)}`, sources: [{ doc: d.name, page: null, text: library.head(d.id, 900), n: "doc" }] }; },
  async list_documents() { return { text: library.size ? library.docs.map((d) => `${d.name} (${d.pages > 1 ? d.pages + " pagine" : d.chars + " caratteri"})`).join("\n") : "Nessun documento caricato." }; },
  async calcola_iva({ importo, aliquota, modo }) { return { text: studio.iva(importo, aliquota, modo).text }; },
  async calcola_fattura_professionista({ compenso, cassa_percentuale = 4, iva_percentuale = 22, ritenuta_percentuale = 20, forfettario = false }) { return { text: studio.parcella(compenso, { cassa: cassa_percentuale, ivaRate: iva_percentuale, ritenuta: ritenuta_percentuale, forfettario }).text }; },
  async calcola_scadenza({ data_inizio, giorni, lavorativi = false }) { const d = studio.parseDate(data_inizio); if (!d) throw new Error("data_inizio non valida, usare AAAA-MM-GG"); return { text: studio.addDays(d, giorni, { working: lavorativi }).text }; },
  async giorni_tra_date({ da, a }) { const x = studio.parseDate(da), y = studio.parseDate(a); if (!x || !y) throw new Error("date non valide, usare AAAA-MM-GG"); return { text: studio.daysBetween(x, y).text }; },
  async verifica_codice({ tipo, valore }) { return { text: (tipo === "iban" ? studio.checkIBAN : tipo === "partita_iva" ? studio.checkPIVA : studio.checkCF)(valore).text }; },
  async calcola({ espressione }) { const v = calculate(espressione); if (v == null) throw new Error("espressione non valida"); return { text: `${espressione} = ${v}` }; },
  async meteo({ luogo }) { const w = await weather(luogo); if (w.error) throw new Error(w.error); return { text: `Meteo a ${w.place}: adesso ${w.now}. Oggi ${w.today}. Domani ${w.tomorrow}.` }; },
  async imposta_promemoria({ messaggio, minuti_da_ora, data_ora }) {
    const at = minuti_da_ora != null ? Date.now() + minuti_da_ora * 60000 : data_ora ? new Date(data_ora).getTime() : NaN;
    if (!Number.isFinite(at) || at < Date.now() - 60000) throw new Error("orario non valido: indicare minuti_da_ora oppure data_ora futura");
    scheduleReminder(messaggio, at); try { if ("Notification" in window && Notification.permission === "default") Notification.requestPermission(); } catch {}
    return { text: `Promemoria impostato ${describeWhen(at)}: ${messaggio}.` };
  },
  async impara({ titolo, contenuto, fonte = "" }) { const r = await knowledge.learn({ title: titolo, content: contenuto, source: fonte, origin: "claude" }); renderKnowledge(); return { text: `${r.updated ? "Voce aggiornata" : "Voce salvata"} nella base di conoscenza: ${r.item.title} (${knowledge.size} voci in tutto).` }; },
  async cerca_conoscenza({ query }) { const hits = knowledge.search(query, 5); return { text: hits.length ? hits.map((k, i) => `(${i + 1}) ${k.title}${k.source ? ` [fonte: ${k.source}]` : ""}\n${k.content}`).join("\n\n") : `Niente nella base di conoscenza su "${query}".` }; },
  async dimentica({ titolo }) { const it = await knowledge.forget(titolo); renderKnowledge(); return { text: it ? `Voce eliminata: ${it.title}.` : `Nessuna voce intitolata "${titolo}".` }; },
  async cerca_wikipedia({ query, lingua = "it" }) {
    const j = await (await fetch(`https://${lingua}.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(query)}&srlimit=5&format=json&origin=*`)).json();
    const hits = j.query?.search || []; if (!hits.length) return { text: `Nessun risultato su Wikipedia per "${query}".` };
    return { text: hits.map((h) => `- ${h.title}: ${h.snippet.replace(/<[^>]+>/g, "").replace(/&quot;/g, '"').replace(/&amp;/g, "&")}`).join("\n") };
  },
  async leggi_wikipedia({ titolo, lingua = "it" }) {
    const j = await (await fetch(`https://${lingua}.wikipedia.org/w/api.php?action=query&prop=extracts&explaintext=1&redirects=1&titles=${encodeURIComponent(titolo)}&format=json&origin=*`)).json();
    const page = Object.values(j.query?.pages || {})[0]; if (!page || page.missing !== undefined || !page.extract) return { text: `Voce "${titolo}" non trovata su Wikipedia.` };
    const url = `https://${lingua}.wikipedia.org/wiki/${encodeURIComponent(page.title.replace(/ /g, "_"))}`;
    return { text: `${page.title} (fonte: ${url})\n\n${page.extract.slice(0, 12000)}`, sources: [{ doc: "Wikipedia: " + page.title, page: null, text: page.extract.slice(0, 900), n: "wiki" }] };
  },
  async crea_bozza({ titolo, testo }) {
    track("drafts");
    const name = fileName(titolo), url = URL.createObjectURL(docxBlob(titolo, testo, fmtDate()));
    const el = addTurn("tool", ""); const a = document.createElement("a"); a.href = url; a.download = name; a.textContent = `📄 ${name} · scarica la bozza in Word`; a.className = "dl"; el.querySelector(".body").appendChild(a);
    return { text: `Bozza pronta: ${name}. L'utente la scarica con il link comparso nella conversazione.` };
  },
  async ricorda({ fatto }) { facts.push(fatto); store.set("facts", facts); return { text: `Memorizzato: ${fatto}` }; },
  async calcolo_professionale({ richiesta }) { const r = calc.routeCalc(richiesta) || routeStudio(richiesta); if (!r) throw new Error('richiesta non riconosciuta: riformulala con i numeri, per esempio "interessi legali su 10000 euro dal 1/1/2024 al 31/12/2025" o "rata mutuo 150000 euro al 3% per 20 anni"'); track("calcs"); return { text: r.result }; },
  async scadenze_fiscali({ giorni = 45 }) { return { text: calc.scadenzeFiscali(new Date(), Math.max(1, Math.min(366, giorni))).text }; },
  async analizza_documento({ file, cosa = "tutto" }) { const d = library.find(file); if (!d) throw new Error(`documento "${file}" non trovato; documenti: ${library.docs.map((x) => x.name).join("; ") || "nessuno"}`); track("analyses"); return { text: extract.rapporto(d.name, docText(d), cosa) }; },
  async confronta_documenti({ file_a, file_b }) { const a = library.find(file_a), b = library.find(file_b); if (!a || !b) throw new Error(`documento non trovato; documenti: ${library.docs.map((x) => x.name).join("; ")}`); track("analyses"); return { text: `A = ${a.name}, B = ${b.name}. ` + extract.confronta(docText(a), docText(b)).text }; },
  async anonimizza_documento({ file, nomi = "" }) { const d = library.find(file); if (!d) throw new Error(`documento "${file}" non trovato`); const r = extract.anonimizza(docText(d), nomi.split(/,|;/)); const title = d.name.replace(/\.[a-z0-9]+$/i, "") + " - anonimizzato"; offerDownload(`📄 ${fileName(title)} · copia anonimizzata in Word`, fileName(title), docxBlob(title, r.text, fmtDate())); track("analyses"); return { text: `Copia anonimizzata pronta (link nella conversazione). ${r.summary}` }; },
  async usa_modello({ modello, campi = {} }) { const r = fillTemplate(modello, campi, ctxForTemplates()); if (!r) throw new Error("modello sconosciuto"); offerDownload(`📄 ${fileName(r.title)} · scarica il modello compilato in Word`, fileName(r.title), docxBlob(r.title, r.body, fmtDate())); track("drafts"); return { text: `Modello "${r.title}" pronto (link nella conversazione).${r.missing.length ? " Campi da completare a mano: " + r.missing.join(", ") + "." : ""}\n\n${r.body.slice(0, 1500)}` }; },
  async elenca_promemoria() { return { text: listReminders() }; },
  async cancella_promemoria({ testo }) { const w = String(testo).toLowerCase(); const hit = reminders.filter((r) => r.message.toLowerCase().includes(w)); hit.forEach((r) => cancelReminder(r.id)); return { text: hit.length ? `Cancellati: ${hit.map((r) => r.message).join("; ")}.` : "Nessun promemoria con quel testo." }; },
  async utilita({ richiesta }) { const r = await runUtility(richiesta); if (!r) throw new Error('richiesta non riconosciuta: es. "che ore sono a Tokyo", "converti 10 km in miglia", "distanza tra Milano e Roma", "qualità dell\'aria a Torino", "alba a Napoli", "cosa significa ossimoro", "crea un QR code per …", "genera una password", "festività 2027"'); return { text: r.result }; },
  async converti_valuta({ importo, da, a }) { return { text: await exchange(importo, String(da).toUpperCase(), String(a).toUpperCase()) }; },
};
const TOOL_LABEL = { search_documents: "documenti", read_document: "leggo documento", list_documents: "documenti", calcola_iva: "IVA", calcola_fattura_professionista: "parcella", calcola_scadenza: "scadenza", giorni_tra_date: "calendario", verifica_codice: "verifica", calcola: "calcolatrice", meteo: "meteo", imposta_promemoria: "promemoria", ricorda: "memoria", impara: "imparo", cerca_conoscenza: "conoscenza", dimentica: "dimentico", cerca_wikipedia: "wikipedia", leggi_wikipedia: "leggo wikipedia", crea_bozza: "bozza word", calcolo_professionale: "calcolo", scadenze_fiscali: "scadenzario", analizza_documento: "analisi documento", confronta_documenti: "confronto", anonimizza_documento: "anonimizza", usa_modello: "modello", elenca_promemoria: "promemoria", cancella_promemoria: "promemoria", converti_valuta: "cambio", utilita: "utilità" };
async function getClaudeSession() {
  const m = await loadClaude();
  return (claudeSession ||= new m.ClaudeSession({ getKey: claudeKey.get, getModel: () => settings.claudeModel || m.DEFAULT_CLAUDE_MODEL, getName: () => settings.name, getEffort: () => (settings.think ? "high" : "medium"), store, tools: TOOLS }));
}
/** Mostra e legge una risposta in streaming, con le righe degli strumenti in mezzo e le fonti alla fine. */
function streamRenderer() {
  let el = null, body = null, spoken = "", buffer = "", lastEl = null;
  const bubble = () => { if (!el) { el = addTurn("jarvis streaming", "", "jarvis"); body = el.querySelector(".body"); spoken = ""; buffer = ""; lastEl = el; } };
  const flushSpeech = (final) => { const rest = buffer.slice(spoken.length); if (final) { if (rest.trim()) speak(rest.trim()); spoken = buffer; return; } const m = /^([\s\S]*?[.!?])\s/.exec(rest); if (m && m[1].length > 12) { speak(m[1]); spoken += m[0]; } };
  const close = () => { if (el) { el.classList.remove("streaming"); body.dataset.raw = buffer.trim(); richify(el); flushSpeech(true); el = null; } };
  return {
    onText: (d) => { bubble(); buffer += d; body.textContent = buffer.trimStart(); transcript.scrollTop = transcript.scrollHeight; flushSpeech(false); },
    onThinking: () => { caption.textContent = "ragiono…"; },
    onTool: (name, input) => { close(); setState("tool", TOOL_LABEL[name] || name); addTool(TOOL_LABEL[name] || name, (name === "crea_bozza" ? [input.titolo] : Object.values(input)).filter((v) => typeof v !== "object").map((v) => String(v).replace(/\s+/g, " ").slice(0, 60)).join(" · ").slice(0, 120)); setState("thinking"); },
    onNotice: (t) => addTurn("system", t),
    finish(answer, sources = [], web = []) {
      close();
      if (!lastEl) { const a = answer && answer.trim() ? answer : `Non sono riuscito a formulare una risposta, ${settings.name}. Provi a riformulare la domanda, oppure attivi il ragionamento approfondito nelle impostazioni.`; lastEl = addTurn("jarvis", a, "jarvis"); speak(a); }
      else addActions(lastEl);
      const docSources = sources.filter((p, i, a) => a.findIndex((q) => q.n === p.n && q.doc === p.doc) === i);
      if (docSources.length) addSources(lastEl, docSources);
      if (web.length) { const box = document.createElement("div"); box.className = "sources"; web.slice(0, 6).forEach(([url, title]) => { const a = document.createElement("a"); a.href = url; a.target = "_blank"; a.rel = "noopener"; a.textContent = "↗ " + title; box.appendChild(a); }); lastEl.appendChild(box); }
    },
  };
}
// ---------------------------------------------------------------- Puter: potenza massima senza chiave (account Puter gratuito)
let puterMod = null, puterSession = null;
const loadPuterBrain = async () => (puterMod ||= await import("./puterbrain.js"));
const cloudSystem = () => `Sei J.A.R.V.I.S., l'assistente personale di ${settings.name}: calmo, preciso, educato, con un'ironia britannica leggera e asciutta. Chiami l'utente "${settings.name}" e rispondi nella sua lingua (di solito italiano).
Le risposte vengono anche lette ad alta voce: vai dritto al punto, di solito da una a quattro frasi; per rapporti, confronti e procedure usa un breve elenco con "- ". Niente tabelle, titoli o grassetti.
Lavori con strumenti: usali con decisione, in parallelo quando sono indipendenti.
- Documenti dell'utente: search_documents o read_document, poi rispondi solo da quei testi citando [1], [2].
- IVA, fatture, scadenze, codici fiscali e IBAN: sempre gli strumenti di calcolo, numeri riportati esattamente.
- Lettere, email, comunicazioni, verbali da usare: scrivili con crea_bozza, che produce un file Word da scaricare. Per solleciti, diffide, disdette, incarichi, preventivi, convocazioni, verbali, informative privacy, deleghe, quietanze e policy AI usa usa_modello con i campi che conosci.
- Interessi, mutui, importi in lettere, codice fiscale, forfettario, prestazioni occasionali, margini e sconti: calcolo_professionale. Scadenze fiscali: scadenze_fiscali.
- Date, importi, dati identificativi e clausole di un documento: analizza_documento; due versioni: confronta_documenti; copia senza dati personali: anonimizza_documento.
- Studiare e verificare: cerca_wikipedia e leggi_wikipedia (anche in inglese con lingua "en"), poi salva ciò che conta con impara (titolo breve, contenuto sintetico con date e numeri, fonte). Quando l'utente ti insegna qualcosa di utile, usa impara; per ciò che hai già studiato, cerca_conoscenza.
- Ogni messaggio inizia con [Contesto] (data, ora, fatti, documenti, conoscenze pertinenti): usalo senza ripeterlo.
Non inventare mai fatti, numeri, norme o risultati: se non sai, usa uno strumento o dillo. Su temi legali, fiscali e medici sii accurato e ricorda di verificare con la fonte ufficiale quando la decisione è importante.`;
async function getPuterSession() {
  const m = await loadPuterBrain();
  return (puterSession ||= new m.PuterSession({ getModel: () => settings.puterModel, setModel: (id) => { settings.puterModel = id; store.set("settings", settings); showBrain(); }, getName: () => settings.name, store, tools: TOOLS, system: cloudSystem }));
}
async function askPuter(text) {
  const session = await getPuterSession(); TOOLS._n = 0;
  const view = streamRenderer();
  const res = await session.ask(text, contextLine(text), view);
  view.finish(res.answer, res.sources);
  return res.answer;
}

async function askClaude(text) {
  const session = await getClaudeSession(); TOOLS._n = 0;
  const view = streamRenderer();
  const res = await session.ask(text, contextLine(text), view);
  view.finish(res.answer, res.sources, res.web);
  return res.answer;
}

// ---------------------------------------------------------------- the model (WebLLM on WebGPU)
const WEBLLM_MODELS = ["Qwen3-8B", "Qwen3-4B", "Qwen3-1.7B", "Qwen3-0.6B"];
/** Sceglie il modello più capace che il dispositivo regge, con la variante f32 dove la GPU non supporta f16. */
async function pickModels() {
  let f16 = true, maxBuf = 0;
  try { const a = await navigator.gpu.requestAdapter({ powerPreference: "high-performance" }); if (!a) return []; f16 = a.features.has("shader-f16"); maxBuf = a.limits.maxBufferSize || 0; } catch { return []; }
  const q = f16 ? "q4f16_1" : "q4f32_1", id = (m) => `${m}-${q}-MLC`;
  const base = String(settings.model || "auto").replace(/-q4f(16|32)_1-MLC$/, "");
  if (base !== "auto" && WEBLLM_MODELS.includes(base)) return WEBLLM_MODELS.slice(WEBLLM_MODELS.indexOf(base)).map(id);
  const mobile = /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent), mem = navigator.deviceMemory || 4;
  let start = mobile ? (mem >= 8 ? "Qwen3-1.7B" : "Qwen3-0.6B") : (mem >= 8 && maxBuf >= 2 ** 31 ? "Qwen3-4B" : "Qwen3-1.7B");
  if (settings.lastModel && WEBLLM_MODELS.includes(settings.lastModel)) start = settings.lastModel; // già scaricato: niente nuovo download
  return WEBLLM_MODELS.slice(WEBLLM_MODELS.indexOf(start)).map(id);
}
// Stato del cervello: "loading" (con percentuale), "ready", "failed" (con motivo). Le domande fatte durante il
// caricamento vanno in coda e ricevono risposta appena il cervello è pronto.
app.brain = { state: "loading", pct: 0, reason: "" }; app.queue = [];
let progressTurn = null;
function showProgress(pct, detail) {
  pct = Math.max(0, Math.min(100, Math.round(pct)));
  app.brain.pct = pct; $("progress").hidden = false; $("progressBar").style.width = pct + "%"; caption.textContent = `preparo il cervello · ${pct}%`;
  const txt = `Preparo il cervello: ${pct}%${detail ? " · " + detail : ""}. Serve solo la prima volta, poi resta su questo dispositivo e funziona anche offline. Intanto può già chiedermi l'ora, calcoli, scadenze e documenti.`;
  if (!progressTurn) progressTurn = addTurn("system", txt); else progressTurn.querySelector(".body").textContent = txt;
}
function brainReady(label, how) {
  app.engineReady = true; app.brain = { state: "ready", pct: 100, reason: "" };
  $("progress").hidden = true; setState("idle"); $("model").textContent = label;
  if (progressTurn) { progressTurn.querySelector(".body").textContent = `Cervello pronto: ${label}, ${how}. Gratis e senza chiave.`; progressTurn = null; } else notice(`Cervello pronto: ${label}, ${how}.`);
  refreshTele?.(); drainQueue();
}
function brainFailed(reason) {
  app.brain = { state: "failed", pct: 0, reason }; $("progress").hidden = true; setState("idle"); $("model").textContent = "modalità essenziale";
  const msg = `Non riesco ad avviare il cervello su questo dispositivo: ${reason}. Funzionano comunque documenti, conoscenza, strumenti da studio, meteo e promemoria. Provi con Chrome o Edge aggiornati, oppure da un computer.`;
  if (progressTurn) { progressTurn.querySelector(".body").textContent = msg; progressTurn = null; } else notice(msg);
  refreshTele?.(); drainQueue();
}
let draining = false;
async function drainQueue() {
  if (draining) return; draining = true;
  try { while (app.queue.length) { while (busy) await new Promise((r) => setTimeout(r, 200)); const q = app.queue.shift(); await ask(q, { queued: true }); } } finally { draining = false; }
}
const friendly = (e) => { const m = String(e?.message || e || ""); if (/fetch|network|load|import|connection|404|cors/i.test(m)) return "il download non è riuscito (connessione assente o instabile)"; if (/memory|oom|alloc|buffer|device lost|quota/i.test(m)) return "memoria insufficiente su questo dispositivo"; return m.slice(0, 120); };
const mb = (bytes) => (bytes >= 1e9 ? (bytes / 1e9).toFixed(1) + " GB" : Math.round(bytes / 1e6) + " MB");
async function loadOnGpu(candidates) {
  let webllm; try { webllm = await import(WEBLLM_URL); } catch (e) { return friendly(e); }
  let lastErr = "";
  for (const model of candidates) {
    const name = model.replace(/-q4f(16|32)_1-MLC$/, "");
    $("model").textContent = name + " · scarico";
    try {
      app.engine = await webllm.CreateMLCEngine(model, { initProgressCallback: (p) => { const m = /(\d+(?:\.\d+)?)\s*MB fetched/i.exec(p.text || ""); showProgress((p.progress || 0) * 100, `${name}${m ? ", " + m[1] + " MB scaricati" : ""}`); } }, { context_window_size: /0\.6B|1\.7B/.test(model) ? 6144 : 8192 });
      app.model = model; settings.lastModel = name; store.set("settings", settings);
      brainReady(name.replace("Qwen3-", "Qwen3 "), "sulla scheda grafica"); return null;
    } catch (e) { console.warn(model, e); lastErr = friendly(e); notice(`${name} non entra in questo dispositivo, provo un modello più piccolo.`); }
  }
  return lastErr || "nessun modello entra nella memoria grafica";
}
async function loadOnCpu() {
  const mobile = /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent), mem = navigator.deviceMemory || 4;
  const wanted = settings.model && settings.model !== "auto" ? settings.model.replace(/-q4f(16|32)_1-MLC$/, "") : "";
  const name = wanted === "Qwen3-0.6B" || mobile || mem < 8 ? "Qwen3-0.6B" : "Qwen3-1.7B";
  $("model").textContent = CPU_MODELS[name].label + " · scarico";
  try {
    app.engine = await createCpuEngine(name, (loaded, total) => showProgress(total ? (loaded / total) * 100 : 0, `${CPU_MODELS[name].label} sul processore, ${mb(loaded)}${total ? " di " + mb(total) : ""}`));
    app.model = name + "-cpu"; brainReady(CPU_MODELS[name].label, "sul processore"); return null;
  } catch (e) { console.warn("cpu engine", e); return friendly(e); }
}
async function loadEngine() {
  setState("loading"); showProgress(0, "avvio");
  let gpuProblem = "";
  if (!("gpu" in navigator)) gpuProblem = "questo browser non ha WebGPU";
  else { const candidates = await pickModels(); if (!candidates.length) gpuProblem = "la scheda grafica non è disponibile al browser"; else gpuProblem = await loadOnGpu(candidates); }
  if (!gpuProblem) return;
  notice(`Grafica accelerata non utilizzabile (${gpuProblem}): passo al motore sul processore, più lento ma compatibile con tutti i dispositivi.`);
  const cpuProblem = await loadOnCpu();
  if (cpuProblem) brainFailed(`${gpuProblem}; sul processore: ${cpuProblem}`);
}

const SUMMARY = /\b(riassum\w*|riassunto|sintesi|sintetizz\w*|di cosa parla|cosa dice|summari[sz]e|in breve)\b/i;
const FULLSUM = /\b(riassum|riassunto|sintesi|sintetizza|di cosa parla|summari[sz]e)/i;
const DOCWORDS = /\b(document|contratt|file|pdf|allegat|testo|clausol|articol|bilanci|verbal|atto|fattur|preventiv|relazion|lettera|mail|delibera|statuto|perizia)/i;
/** Passaggi dai documenti pertinenti alla domanda, o [] se la domanda non riguarda i documenti. */
function docContext(text) {
  const known = knowledge.relevant(text, 2).map((k, i) => ({ doc: "Conoscenza: " + k.title, page: null, text: k.content, n: i + 1 }));
  const fromDocs = docPassages(text).map((p) => ({ ...p, n: p.n + known.length }));
  return [...known, ...fromDocs];
}
function docPassages(text) {
  if (!library.size) return [];
  const named = library.mentioned(text);
  if (named && SUMMARY.test(text)) return [{ doc: named.name, page: null, text: library.head(named.id), n: 1 }];
  if (SUMMARY.test(text) && library.size === 1 && DOCWORDS.test(text)) return [{ doc: library.docs[0].name, page: null, text: library.head(library.docs[0].id), n: 1 }];
  const hits = library.search(text, 4, named ? named.id : null);
  if (!hits.length) return [];
  const strong = hits[0].score >= 2.2 || DOCWORDS.test(text) || named;
  return strong ? hits.map((h, i) => ({ ...h, n: i + 1 })) : [];
}
/** Riassunto di un intero documento con il cervello locale, a parti e livelli, con avanzamento visibile. */
async function summarizeDocument(doc, question) {
  const focus = summaryFocus(question, doc.name);
  setState("tool", "riassunto"); const line = addTurn("tool", ""); line.innerHTML = "⚙ <b>riassunto</b> <span></span>";
  const status = (f, a, b) => { line.querySelector("span").textContent = `${doc.name} · ${f === "lettura" ? "leggo la parte" : f === "unione" ? "unisco" : "riassumo"} ${a}/${b}`; caption.textContent = `riassunto ${a}/${b}`; };
  const text = library.fullText(doc.id, 400000);
  const summary = await summarize({ engine: app.engine, text, title: doc.name, focus, onProgress: status, partChars: /-cpu$|0\.6B/.test(app.model || "") ? 2200 : 3000, isAborted: () => app.aborted });
  setState("thinking");
  const answer = summary && summary.trim() ? summary : `Non sono riuscito a riassumere ${doc.name}, ${settings.name}.`; if (summary) track("summaries");
  const el = addTurn("jarvis", answer, "jarvis"); addSources(el, [{ doc: doc.name, page: null, text: library.head(doc.id, 900), n: "doc" }]); speak(answer);
  return answer;
}
const cite = (p) => `${p.doc}${p.page ? ", p. " + p.page : ""}`;
function addSources(el, passages) {
  if (!passages.length) return;
  const box = document.createElement("div"); box.className = "sources";
  passages.forEach((p) => { const d = document.createElement("details"); const s = document.createElement("summary"); s.textContent = `[${p.n}] ${cite(p)}`; const q = document.createElement("p"); q.textContent = p.text.slice(0, 900) + (p.text.length > 900 ? "…" : ""); d.append(s, q); box.appendChild(d); });
  el.appendChild(box); transcript.scrollTop = transcript.scrollHeight;
}

/** Strumenti per il modello locale: il nucleo più quelli che la domanda richiede, per non riempire il contesto. */
function localTools(text = "") {
  const want = new Set(CORE_TOOLS); const t = text.toLowerCase();
  if (/confront|differenz|version/.test(t)) want.add("confronta_documenti");
  if (/anonim|privacy|dati personali|gdpr/.test(t)) want.add("anonimizza_documento");
  if (/promemoria|ricord|cancell/.test(t)) { want.add("elenca_promemoria"); want.add("cancella_promemoria"); }
  if (/valut|cambio|dollar|sterlin|franchi|yen/.test(t)) want.add("converti_valuta");
  if (/ore sono a|fuso|convert|distanza|alba|tramonto|aria|smog|significa|definizione|qr|password|casuale|festiv|settimana/.test(t)) want.add("utilita");
  if (/codic|iban|partita iva/.test(t)) want.add("verifica_codice");
  if (/documenti|file/.test(t)) want.add("list_documents");
  if (/dimentic/.test(t)) want.add("dimentica");
  if (/giorni tra|quanti giorni/.test(t)) want.add("giorni_tra_date");
  if (/ricorda che|memorizza/.test(t)) want.add("ricorda");
  if (/\d\s*[-+*/^x]\s*\d/.test(t)) want.add("calcola");
  return TOOL_DEFS.filter((d) => want.has(d.name));
}
const localSystem = (text = "") => `Sei J.A.R.V.I.S., l'assistente personale di ${settings.name}: calmo, preciso, educato, con un'ironia britannica leggera. Chiama l'utente "${settings.name}" e rispondi nella sua lingua (di solito italiano).
Le risposte vengono lette ad alta voce: vai dritto al punto, di solito da una a tre frasi; per elenchi usa righe che iniziano con "- ", niente tabelle.
Regole:
- Non inventare mai fatti, numeri, date, norme o nomi. Se non lo sai, usa uno strumento o dillo.
- Documenti dell'utente: usa search_documents (o read_document per riassunti) e rispondi solo da quei testi, citando [1], [2].
- IVA, fatture, scadenze, codici: usa sempre gli strumenti di calcolo e riporta i numeri esatti.
- Per scrivere lettere, email o comunicazioni da usare: crea_bozza (file Word scaricabile); per solleciti, diffide, disdette, preventivi, verbali e altri atti tipici: usa_modello.
- Interessi, mutui, importi in lettere, codice fiscale, forfettario, margini: calcolo_professionale. Scadenze, importi e clausole di un documento: analizza_documento.
- Per studiare un argomento: cerca_wikipedia, poi leggi_wikipedia, poi salva i punti chiave con impara (titolo breve, contenuto sintetico, fonte). Quando l'utente ti insegna qualcosa di utile, usa impara.
- Ogni messaggio dell'utente inizia con [Contesto] (data, ora, fatti, documenti, conoscenze pertinenti): usalo senza ripeterlo. Se c'è un [Risultato strumento] o ci sono [Passaggi], usali.
${app.model && /0\.6B|-cpu$/.test(app.model) ? "" : toolsBlock(localTools(text))}`;
/** Domande che meritano ragionamento: spiegazioni, analisi, confronti, calcoli, piani; oppure molto lunghe. */
const isComplex = (t) => t.length > 180 || /\b(perch[eé]|come mai|spiega|analizza|confronta|differenz|ragiona|dimostra|calcola|risolvi|strategi|pianifica|valuta|pro e contro|conviene|quale scegliere|ottimizza|rapporto)\b/i.test(t) || /\d+\s*[-+*/^x]\s*\d+/.test(t);
async function askLocal(text, toolResult, passages = [], maxChars = 700) {
  const ctxText = passages.map((p) => `[${p.n}] (${cite(p)})\n${p.text.slice(0, passages.length === 1 ? 2400 : maxChars)}`).join("\n\n");
  const userContent = `[Contesto] ${contextLine(text)}\n\n` + (toolResult ? `[Risultato strumento] ${toolResult}\n\n` : "") + (ctxText ? `[Passaggi]\n${ctxText}\n\n` : "") + text;
  const view = streamRenderer(); TOOLS._n = passages.length;
  const think = settings.think || (isComplex(text) && /4B|8B/.test(app.model || ""));
  if (think) caption.textContent = "ragiono a fondo…";
  const res = await runLocalAgent({ engine: app.engine, system: localSystem(text), history: history.slice(-6), userContent, tools: TOOLS, think,
    onText: view.onText, onTool: view.onTool, onThinking: view.onThinking, maxRounds: /0\.6B|-cpu$/.test(app.model || "") ? 0 : 4, isAborted: () => app.aborted });
  view.finish(res.answer, [...passages, ...res.sources]);
  return res.answer;
}
let busy = false;
async function ask(text, opts = {}) {
  text = (text || "").trim(); if (!text) return;
  if (busy) { if (!opts.queued) { app.queue.push(text); input.value = ""; addTurn("user", text, "lei"); addTurn("system", "in coda: rispondo appena finisco"); } return; }
  busy = true; app.aborted = false; if (!/^(ripeti|basta|stop)/i.test(text)) voice.stop(); if (!opts.queued) input.value = ""; $("sendBtn").classList.add("stop");
  app.currentQ = text; if (!opts.retry) { inputHistory.push(text); inputHistory = inputHistory.slice(-50); store.set("inputHistory", inputHistory); } histPos = inputHistory.length; track("questions"); document.title = "● J.A.R.V.I.S.";
  if (!opts.queued) addTurn("user", text, "lei"); setState("thinking");
  try {
    let answer;
    const deep = /^(?:ricerca approfondita(?: su)?|approfondisci|fai una ricerca(?: approfondita)? su|ricerca su)\s+(.+?)[?.!]*$/i.exec(text);
    if (deep) { answer = await deepResearch(deep[1].trim()); history.push({ role: "user", content: text }, { role: "assistant", content: answer }); history = history.slice(-20); saveHistory(); return; }
    if (usingPuter() && !/^(aiuto|help|cosa sai fare|che cosa sai fare|comandi|cosa puoi fare)\b/i.test(text)) {
      setState("thinking"); answer = await askPuter(text);
      history.push({ role: "user", content: text }, { role: "assistant", content: answer }); history = history.slice(-20); saveHistory();
      return;
    }
    if (usingClaude() && !/^(aiuto|help|cosa sai fare|che cosa sai fare|comandi|cosa puoi fare)\b/i.test(text)) {
      setState("thinking"); answer = await askClaude(text);
      history.push({ role: "user", content: text }, { role: "assistant", content: answer }); history = history.slice(-20); saveHistory();
      return;
    }
    if (FULLSUM.test(text) && library.size && app.engineReady && !usingPuter() && !usingClaude()) {
      const doc = library.mentioned(text) || (library.size === 1 && (DOCWORDS.test(text) || /^\s*(riassumi(lo|la)?|sintetizza(lo|la)?|fammi un riassunto|riassunto)\s*[.!?]*$/i.test(text)) ? library.docs[0] : null);
      if (doc) { answer = await summarizeDocument(doc, text); history.push({ role: "user", content: text }, { role: "assistant", content: answer }); history = history.slice(-20); saveHistory(); return; }
    }
    let routed = null; try { routed = await route(text); } catch (e) { console.warn(e); }
    const passages = routed ? [] : docContext(text);
    if (routed && routed.silent) return;
    if (routed) { setState("tool", routed.tool); if (!/^(aiuto|voce|novità|briefing|statistiche)$/.test(routed.tool) && (routed.result || routed.direct)) addTool(routed.tool, (routed.result || routed.direct).replace(/\s+/g, " ").slice(0, 140)); setState("thinking"); }
    if (passages.length) track("searches");
    if (passages.length) addTool("documenti", passages.map(cite).filter((v, i, a) => a.indexOf(v) === i).join(" · ").slice(0, 140));
    const needsModel = !routed || (routed.result && !routed.exact);
    if (!app.engineReady && needsModel && app.brain.state === "loading" && !opts.queued) {
      app.queue.push(text);
      answer = `Sto ancora preparando il cervello (${app.brain.pct}%), ${settings.name}. Le rispondo appena è pronto, non serve riscrivere.`;
      addTurn("jarvis", answer, "jarvis"); speak(answer); return;
    }
    if (app.engineReady && needsModel) answer = await askLocal(text, routed ? routed.result : "", passages);
    else if (passages.length) { answer = `Ecco i passaggi più pertinenti, ${settings.name}. ${app.engineReady ? "" : "Con il modello attivo li riassumerei io; intanto li apra qui sotto."}`.trim(); const el = addTurn("jarvis", answer, "jarvis"); addSources(el, passages); el.querySelectorAll("details")[0]?.setAttribute("open", ""); speak(answer); }
    else if (routed && routed.noSpeak) { answer = routed.direct; addTurn("jarvis", answer, "jarvis"); }
    else { answer = routed ? routed.direct : `Il cervello non è disponibile su questo dispositivo${app.brain.reason ? " (" + app.brain.reason + ")" : ""}, ${settings.name}. Posso comunque cercare nei documenti e nella conoscenza, fare calcoli da studio, dirle l'ora e il meteo, impostare promemoria e cercare su Wikipedia. Scriva "aiuto" per l'elenco.`; addTurn("jarvis", answer, "jarvis"); speak(answer); }
    history.push({ role: "user", content: text }, { role: "assistant", content: answer }); history = history.slice(-20); saveHistory();
  } catch (e) {
    console.error(e); const msg = String(e.message || e);
    notice(/^(Interrotto|Per la potenza|Serve |Il credito|Non raggiungo|La chiave|Troppe richieste|Modello non|Richiesta rifiutata|Errore del servizio)/.test(msg) ? msg : "Qualcosa è andato storto: " + msg);
  }
  finally { busy = false; document.title = "J.A.R.V.I.S."; $("sendBtn").classList.remove("stop"); if (app.state !== "speaking") setState("idle"); if (app.queue.length && app.brain.state !== "loading") drainQueue(); }
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
    const acts = document.createElement("div"); acts.className = "dacts"; const short = d.name.replace(/\.[a-z0-9]+$/i, "");
    for (const [label, q] of [["riassumi", `riassumi ${short}`], ["analizza", `analizza ${short}`], ["anonimizza", `anonimizza ${short}`], ["leggi", `leggimi il documento ${short}`]]) { const b = document.createElement("button"); b.type = "button"; b.textContent = label; b.onclick = () => { docsDlg.close(); ask(q); }; acts.appendChild(b); }
    li.append(name, meta, rm, acts); ul.appendChild(li);
  });
  $("docsClear").hidden = library.size < 2;
  renderSuggest(); refreshTele?.();
}
async function addFiles(files) {
  files = [...files]; if (!files.length) return;
  try { await navigator.storage?.persist?.(); const est = await navigator.storage?.estimate?.(); if (est && est.quota && est.usage / est.quota > 0.85) notice("La memoria del browser è quasi piena: rimuova documenti che non servono o faccia un backup."); } catch {}
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
$("form").addEventListener("submit", (e) => { e.preventDefault(); voice.stop(); if (busy) { app.aborted = true; if (claudeSession) claudeSession.abort(); if (puterSession) puterSession.abort(); if (app.engine) { try { app.engine.interruptGenerate(); } catch {} } return; } ask(input.value); });
$("newSession").onclick = () => { history = []; store.set("history", history); app.currentQ = ""; store.set("claudeHistory", []); if (claudeSession) claudeSession.reset(); if (puterSession) puterSession.reset(); transcript.innerHTML = ""; addTurn("system", "— nuova sessione —"); };
$("exportBtn").onclick = () => {
  const parts = [...transcript.querySelectorAll(".turn")].map((el) => {
    const who = el.querySelector(".who")?.textContent; const body = rawText(el) || el.textContent.trim();
    const src = [...el.querySelectorAll(".sources summary")].map((x) => "- fonte " + x.textContent).join("\n");
    if (!body) return ""; if (el.classList.contains("tool")) return `_${body}_`.replace(/^_⚙\s*/, "_");
    return (who ? `**${who === "lei" ? settings.name : "J.A.R.V.I.S."}:** ` : "") + body + (src ? "\n" + src : "");
  }).filter(Boolean);
  downloadDocx(`Conversazione con J.A.R.V.I.S. del ${fmtDate()}`, parts.join("\n\n"));
};
input.addEventListener("keydown", (e) => {
  if (e.key === "ArrowUp" && inputHistory.length && (!input.value || histPos < inputHistory.length)) { e.preventDefault(); histPos = Math.max(0, histPos - 1); input.value = inputHistory[histPos] || ""; }
  else if (e.key === "ArrowDown" && histPos < inputHistory.length) { e.preventDefault(); histPos++; input.value = inputHistory[histPos] || ""; }
});
document.addEventListener("keydown", (e) => {
  const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName || "") || document.activeElement?.isContentEditable;
  if (e.key === "Escape" && !document.querySelector("dialog[open]")) { voice.stop(); if (busy) $("form").requestSubmit(); }
  if (e.key === "/" && !typing && !document.querySelector("dialog[open]") && $("lock").hidden) { e.preventDefault(); input.focus(); }
});
const SR = window.SpeechRecognition || window.webkitSpeechRecognition; let rec = null;
const startRec = (continuous) => {
  if (!SR) { notice("Il riconoscimento vocale non è disponibile in questo browser: usi Chrome."); return; }
  if (rec) rec.stop(); rec = new SR(); rec.lang = settings.lang; rec.continuous = continuous; rec.interimResults = true;
  rec.onstart = () => { app.recognizing = true; $("micBtn").classList.toggle("on", !continuous); if (!continuous) setState("listening"); };
  rec.onresult = (ev) => { let final = "", interim = ""; for (let i = ev.resultIndex; i < ev.results.length; i++) { const r = ev.results[i]; if (r.isFinal) final += r[0].transcript; else interim += r[0].transcript; } app.level = Math.min(1, 0.3 + interim.length / 40);
    if (continuous) { if (voice.pending) return; const m = /\b(jarvis|giarvis)\b[,.!?]?\s*(.+)/i.exec(final); if (m && m[2].trim()) ask(m[2]); } else { input.value = final || interim; if (final) ask(final); } };
  rec.onerror = (e) => { if (e.error !== "no-speech" && e.error !== "aborted") notice("microfono: " + e.error); };
  rec.onend = () => { app.recognizing = false; $("micBtn").classList.remove("on"); if (app.state === "listening") setState("idle"); if (app.wake && continuous) setTimeout(() => startRec(true), 300); };
  try { rec.start(); } catch (e) { notice("microfono: " + e.message); }
};
const stopRec = () => { if (rec) { const r = rec; rec = null; r.onend = null; r.stop(); app.recognizing = false; $("micBtn").classList.remove("on"); if (app.state === "listening") setState("idle"); } };
$("micBtn").onclick = () => { voice.stop(); if (app.recognizing && !app.wake) stopRec(); else { app.wake = false; $("wakeBtn").classList.remove("on"); startRec(false); } };
$("wakeBtn").onclick = () => { app.wake = !app.wake; $("wakeBtn").classList.toggle("on", app.wake); if (app.wake) { notice("modalità ascolto attiva · dica \"Jarvis, …\""); startRec(true); } else stopRec(); };

// ---------------------------------------------------------------- settings dialog
const dlg = $("settings");
const syncProviderUI = () => { const v = $("setProvider").value; $("claudeFields").hidden = v !== "claude"; $("puterFields").hidden = v !== "puter"; $("localFields").hidden = v !== "local"; if (v === "puter") refreshPuterFields(); };
async function refreshPuterFields() {
  $("puterStatus").textContent = "Collego Puter…";
  try {
    const m = await loadPuterBrain(); await m.loadPuter();
    const signed = m.isSignedIn(); $("puterSignIn").textContent = signed ? "Account Puter collegato" : "Accedi con Puter (gratis)"; $("puterSignIn").disabled = signed;
    $("puterStatus").textContent = signed ? "Pronto: J.A.R.V.I.S. usa i modelli di punta con il credito gratuito del suo account Puter." : "Serve un account Puter gratuito: nessuna chiave API. Le domande e i passaggi usati passano da Puter e dal fornitore del modello.";
    const sel = $("setPuterModel"); if (sel.options.length <= 1 && signed) { try { const list = (await window.puter.ai.listModels()).map((x) => String(x.id)).filter((id) => /claude|gpt-5|gemini|grok|deepseek|qwen/i.test(id)).sort(); for (const id of list.slice(0, 80)) { const o = document.createElement("option"); o.value = id; o.textContent = m.prettyModel(id); sel.appendChild(o); } } catch {} }
    sel.value = [...sel.options].some((o) => o.value === settings.puterModel) ? settings.puterModel : "";
  } catch (e) { $("puterStatus").textContent = "Non riesco a caricare Puter: " + (e.message || e); }
}
$("puterSignIn").onclick = async () => { try { const m = await loadPuterBrain(); await m.signIn(); } catch (e) { $("puterStatus").textContent = "Accesso non riuscito: " + (e.message || e); } refreshPuterFields(); };
function openSettings(focus) {
  $("setName").value = settings.name; $("setCity").value = settings.city; $("setLang").value = settings.lang; $("setModel").value = settings.model.replace(/-q4f(16|32)_1-MLC$/, ""); $("setThink").checked = !!settings.think;
  $("setProvider").value = settings.provider || "claude"; $("setKey").value = claudeKey.get(); $("setClaudeModel").value = settings.claudeModel || "claude-opus-5-5"; $("keyStatus").textContent = claudeKey.get() ? "Chiave salvata su questo dispositivo." : "";
  fillVoices(); $("setVoiceRate").value = settings.voiceRate || 1; $("setVoiceGender").value = settings.voiceGender || "male";
  $("setStudio").value = settings.studio || ""; $("setSigner").value = settings.signer || ""; $("setPlan").value = settings.plan || ""; $("setBilling").value = settings.billing || "annuale"; $("setRenewal").value = settings.renewal || "";
  $("setTextSize").value = String(settings.textSize || 1); $("setBriefing").checked = settings.briefing !== false; $("setSound").checked = settings.sound !== false; $("setPrivate").checked = !!settings.privateMode;
  $("setPin").value = ""; $("pinNote").textContent = settings.pinHash ? "PIN attivo: J.A.R.V.I.S. lo chiede all'apertura." : "Nessun PIN: chi usa questo dispositivo vede la conversazione."; $("pinClear").hidden = !settings.pinHash; $("lockNow").hidden = !settings.pinHash;
  $("aboutLine").textContent = aboutText();
  syncProviderUI(); if (!dlg.open) dlg.showModal(); if (focus === "claude") $("setKey").focus();
}
$("setProvider").onchange = syncProviderUI;
function fillVoices() {
  for (const [id, lang, cur] of [["setVoiceIt", "it-IT", settings.voiceIt], ["setVoiceEn", "en-GB", settings.voiceEn]]) {
    const sel = $(id), list = voice.list(lang); sel.innerHTML = "";
    const auto = document.createElement("option"); auto.value = ""; auto.textContent = list[0] ? `Automatica · ${list[0].name}` : "Automatica"; sel.appendChild(auto);
    list.forEach((v, i) => { const o = document.createElement("option"); o.value = v.name; o.textContent = (i === 0 ? "★ " : "") + v.name; sel.appendChild(o); });
    sel.value = cur && list.some((v) => v.name === cur) ? cur : "";
  }
  const best = voice.list("it-IT")[0]; $("voiceTip").hidden = !!(best && /natural|neural|online|google|premium|enhanced/i.test(best.name));
}
const readVoiceFields = () => { settings.voiceIt = $("setVoiceIt").value; settings.voiceEn = $("setVoiceEn").value; settings.voiceRate = +$("setVoiceRate").value || 1; settings.voiceGender = $("setVoiceGender").value; };
$("setVoiceGender").onchange = () => { readVoiceFields(); fillVoices(); };
$("voiceTest").onclick = () => { readVoiceFields(); voice.test("it-IT"); };
$("voiceTestEn").onclick = () => { readVoiceFields(); voice.test("en-GB"); };
$("settingsBtn").onclick = () => openSettings();
$("settingsBtn").onkeydown = (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openSettings(); } };
$("setCancel").onclick = () => dlg.close();
$("setSave").onclick = async (e) => {
  e.preventDefault();
  const prev = { model: settings.model, provider: settings.provider };
  settings.name = $("setName").value.trim() || "Signore"; settings.city = $("setCity").value.trim(); settings.lang = $("setLang").value; settings.model = $("setModel").value; settings.think = $("setThink").checked;
  settings.provider = $("setProvider").value; settings.claudeModel = $("setClaudeModel").value; readVoiceFields();
  settings.studio = $("setStudio").value.trim(); settings.signer = $("setSigner").value.trim(); settings.plan = $("setPlan").value; settings.billing = $("setBilling").value; settings.renewal = $("setRenewal").value;
  settings.textSize = +$("setTextSize").value || 1; settings.briefing = $("setBriefing").checked; settings.sound = $("setSound").checked;
  const wasPrivate = settings.privateMode; settings.privateMode = $("setPrivate").checked; if (settings.privateMode && !wasPrivate) { store.set("history", []); store.set("claudeHistory", []); store.set("puterHistory", []); store.set("inputHistory", []); }
  const pin = $("setPin").value.trim(); if (pin) { if (!/^\d{4,8}$/.test(pin)) { $("pinNote").textContent = "Il PIN deve avere da 4 a 8 cifre."; return; } settings.pinHash = await hashPin(pin); }
  applyLook();
  if (settings.provider === "puter") settings.puterModel = $("setPuterModel").value;
  if (settings.model !== prev.model) settings.lastModel = "";
  if (settings.provider === "claude") {
    const key = $("setKey").value.trim();
    if (!key) { $("keyStatus").textContent = "Per usare Claude serve una chiave API; senza chiave scelga il cervello locale, gratuito."; return; }
    if (key !== claudeKey.get()) {
      $("keyStatus").textContent = "Verifico la chiave…";
      try { const err = await (await loadClaude()).checkKey(key, settings.claudeModel); if (err) { $("keyStatus").textContent = err; return; } }
      catch (x) { $("keyStatus").textContent = "Non riesco a caricare il collegamento con Claude: controlli la connessione."; return; }
      claudeKey.set(key);
    }
  }
  store.set("settings", settings); dlg.close();
  if (prev.provider !== settings.provider || (settings.provider === "local" && settings.model !== prev.model)) location.reload();
  else showBrain();
};
$("setForgetKey").onclick = () => { claudeKey.set(""); $("setKey").value = ""; $("keyStatus").textContent = "Chiave cancellata da questo dispositivo."; };
function showBrain() {
  if (usingPuter()) { $("model").textContent = (settings.puterModel ? (puterMod ? puterMod.prettyModel(settings.puterModel) : settings.puterModel) : "Potenza massima") + " · Puter"; refreshTele?.(); return; }
  if (usingClaude()) { $("model").textContent = (claudeMod?.CLAUDE_MODELS[settings.claudeModel] || "Claude") + (claudeKey.get() ? "" : " · manca la chiave"); }
}

// ---------------------------------------------------------------- promemoria: elenco, cancellazione, calendario
const remDlg = $("remDialog");
function renderReminders() {
  const ul = $("remList"); if (!ul) return; ul.innerHTML = "";
  if (!reminders.length) { const li = document.createElement("li"); li.className = "empty"; li.textContent = 'Nessun promemoria. Provi: "ricordami domani alle 9 di chiamare Rossi" o "ogni lunedì alle 9 controlla la PEC".'; ul.appendChild(li); return; }
  reminders.slice().sort((a, b) => a.at - b.at).forEach((r) => {
    const li = document.createElement("li"), t = document.createElement("span"), m = document.createElement("span"), rm = document.createElement("button");
    t.className = "kt"; t.textContent = r.message; m.className = "km"; m.textContent = describeWhen(r.at) + (r.rule ? " · " + describeRule(r.rule) : "");
    rm.type = "button"; rm.textContent = "cancella"; rm.onclick = () => cancelReminder(r.id);
    li.append(t, rm, m); ul.appendChild(li);
  });
}
$("reminderChip").onclick = () => { renderReminders(); remDlg.showModal(); };
$("reminderChip").onkeydown = (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); $("reminderChip").click(); } };
$("remIcs").onclick = () => { if (reminders.length) downloadFile("promemoria-jarvis.ics", remindersIcs()); };
$("fiscalIcs").onclick = () => downloadFile("scadenze-fiscali.ics", fiscalIcs());
$("remClose").onclick = () => remDlg.close();

// ---------------------------------------------------------------- modelli di documento
const tplDlg = $("tplDialog");
const LONG_FIELDS = /voci|odg|decisioni|azioni|documenti|strumenti|obbligazione|oggetto|note/;
function renderTplFields() {
  const tpl = TEMPLATES.find((x) => x.id === $("tplSelect").value) || TEMPLATES[0], box = $("tplFields"); box.innerHTML = "";
  for (const [k, label, def] of tpl.fields) {
    const l = document.createElement("label"); l.textContent = label + " ";
    const f = document.createElement(LONG_FIELDS.test(k) ? "textarea" : "input"); f.dataset.k = k; f.value = def || ""; if (/importo|compenso/.test(k)) f.inputMode = "decimal";
    l.appendChild(f); box.appendChild(l);
  }
}
function openTemplates(id) {
  const sel = $("tplSelect"); if (!sel.options.length) { for (const t of TEMPLATES) { const o = document.createElement("option"); o.value = t.id; o.textContent = t.title; sel.appendChild(o); } }
  if (id) sel.value = id; renderTplFields(); if (!tplDlg.open) tplDlg.showModal();
}
const tplValues = () => Object.fromEntries([...$("tplFields").querySelectorAll("[data-k]")].map((f) => [f.dataset.k, f.value]));
$("tplSelect").onchange = renderTplFields;
$("tplChip").onclick = () => openTemplates();
$("tplChip").onkeydown = (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openTemplates(); } };
$("tplWord").onclick = () => { const r = fillTemplate($("tplSelect").value, tplValues(), ctxForTemplates()); downloadDocx(r.title, r.body); track("drafts"); tplDlg.close(); notice(`Scaricato "${fileName(r.title)}".${r.missing.length ? " Da completare: " + r.missing.join(", ") + "." : ""}`); };
$("tplShow").onclick = () => { const r = fillTemplate($("tplSelect").value, tplValues(), ctxForTemplates()); tplDlg.close(); app.currentQ = ""; addTurn("jarvis", r.body, "jarvis"); track("drafts"); };
$("tplClose").onclick = () => tplDlg.close();

// ---------------------------------------------------------------- suggerimenti rapidi sotto il campo di testo
function renderSuggest() {
  const box = $("suggest"); if (!box) return; box.innerHTML = "";
  const last = library.docs.slice().sort((a, b) => b.added - a.added)[0], short = last ? last.name.replace(/\.[a-z0-9]+$/i, "").slice(0, 28) : "";
  const items = [["briefing", () => ask("briefing")], ["scadenze fiscali", () => ask("prossime scadenze fiscali")], ["modelli", () => openTemplates()]];
  if (last) items.push([`riassumi ${short}`, () => ask(`riassumi ${short}`)], [`scadenze di ${short}`, () => ask(`estrai le scadenze da ${short}`)]);
  items.push(["promemoria", () => { input.value = "ricordami domani alle 9 di "; input.focus(); }], ["calcoli", () => { input.value = "interessi legali su 10.000 euro dal 1/1/2025 a oggi"; input.focus(); }]);
  for (const [label, go] of items) { const b = document.createElement("button"); b.type = "button"; b.textContent = label; b.onclick = go; box.appendChild(b); }
}

// ---------------------------------------------------------------- privacy: PIN, backup, cancellazione
async function hashPin(pin) {
  const data = new TextEncoder().encode("jarvis-pin:" + pin);
  try { const h = await crypto.subtle.digest("SHA-256", data); return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, "0")).join(""); }
  catch { let h = 2166136261; for (const b of data) { h ^= b; h = Math.imul(h, 16777619) >>> 0; } return "fnv" + h.toString(16); }
}
function lockScreen() { if (!settings.pinHash) return; voice.stop(); document.querySelectorAll("dialog[open]").forEach((d) => d.close()); $("lock").hidden = false; $("lockPin").value = ""; $("lockMsg").textContent = ""; setTimeout(() => $("lockPin").focus(), 50); }
$("lockForm").onsubmit = async (e) => { e.preventDefault(); if ((await hashPin($("lockPin").value.trim())) === settings.pinHash) { $("lock").hidden = true; input.focus(); } else { $("lockMsg").textContent = "PIN errato."; $("lockPin").select(); } };
$("pinClear").onclick = () => { settings.pinHash = ""; store.set("settings", settings); $("pinNote").textContent = "PIN tolto."; $("pinClear").hidden = $("lockNow").hidden = true; };
$("lockNow").onclick = () => { dlg.close(); lockScreen(); };
$("backupBtn").onclick = () => {
  const { pinHash, ...safeSettings } = settings;
  const data = { format: "jarvis-backup", version: 1, app: APP_VERSION, created: new Date().toISOString(), settings: safeSettings, facts, reminders, history, stats, knowledge: knowledge.items, documents: library.docs };
  downloadFile(`jarvis-backup-${new Date().toISOString().slice(0, 10)}.json`, new Blob([JSON.stringify(data)], { type: "application/json" }));
  $("pinNote").textContent = `Backup scaricato: ${library.size} documenti, ${knowledge.size} conoscenze, ${reminders.length} promemoria.`;
};
$("restoreBtn").onclick = () => $("restoreFile").click();
$("restoreFile").onchange = async () => {
  const f = $("restoreFile").files[0]; $("restoreFile").value = ""; if (!f) return;
  try {
    const d = JSON.parse(await f.text()); if (d.format !== "jarvis-backup") throw new Error("non è un backup di J.A.R.V.I.S.");
    if (!confirm(`Ripristinare il backup del ${new Date(d.created).toLocaleString("it-IT")}? Impostazioni, memoria, promemoria e cronologia attuali verranno sostituiti; documenti e conoscenze si aggiungono.`)) return;
    store.set("settings", { ...d.settings, pinHash: settings.pinHash }); store.set("facts", d.facts || []); store.set("reminders", d.reminders || []); store.set("history", d.history || []); if (d.stats) store.set("stats", d.stats);
    if (d.knowledge?.length) await knowledge.import(d.knowledge);
    if (d.documents?.length) await library.importDocs(d.documents);
    location.reload();
  } catch (e) { $("pinNote").textContent = "Ripristino non riuscito: " + (e.message || e); }
};
$("wipeBtn").onclick = async () => {
  if (!confirm("Cancellare da questo dispositivo tutti i dati di J.A.R.V.I.S.: documenti, conoscenze, memoria, promemoria, cronologia e impostazioni? L'operazione non si può annullare. I modelli scaricati restano in cache.")) return;
  await library.clear(); await knowledge.clearAll();
  try { Object.keys(localStorage).filter((k) => k.startsWith("jarvis.")).forEach((k) => localStorage.removeItem(k)); } catch {}
  location.reload();
};
window.addEventListener("pagehide", () => { if (settings.privateMode) { store.set("history", []); store.set("claudeHistory", []); store.set("puterHistory", []); store.set("inputHistory", []); } });

// ---------------------------------------------------------------- abbonamento e assistenza
const aboutText = () => `J.A.R.V.I.S. ${APP_VERSION}${settings.plan ? ` · piano ${settings.plan} ${settings.billing}` : ""}${settings.renewal ? ` · rinnovo il ${new Date(settings.renewal + "T12:00").toLocaleDateString("it-IT")}` : ""}.`;
$("assistBtn").onclick = () => {
  const ua = navigator.userAgent, br = /Edg\//.test(ua) ? "Edge" : /Chrome\//.test(ua) ? "Chrome" : /Firefox\//.test(ua) ? "Firefox" : /Safari\//.test(ua) ? "Safari" : "browser";
  const os = /Android/.test(ua) ? "Android" : /iPhone|iPad/.test(ua) ? "iOS" : /Windows/.test(ua) ? "Windows" : /Mac/.test(ua) ? "macOS" : /Linux/.test(ua) ? "Linux" : "";
  const text = `Ciao Leonardo, ho bisogno di assistenza su J.A.R.V.I.S.${settings.studio ? " per " + settings.studio : ""}.\n\n(Versione ${APP_VERSION}, cervello: ${brainLabel()}, ${br}${os ? " su " + os : ""}${settings.plan ? ", piano " + settings.plan + " " + settings.billing : ""})\n\nProblema: `;
  window.open("https://wa.me/393791667781?text=" + encodeURIComponent(text), "_blank", "noopener");
};
function applyLook() { const z = +settings.textSize || 1; transcript.style.zoom = z === 1 ? "" : String(z); }
function renewalNotice() {
  if (!settings.renewal) return; const days = Math.round((new Date(settings.renewal + "T12:00") - new Date()) / 864e5);
  if (days < 0) notice(`L'abbonamento ${settings.plan || ""} risulta scaduto da ${-days} giorni: per aggiornamenti e assistenza scriva a Leonardo dalle impostazioni.`);
  else if (days <= 30) notice(`L'abbonamento ${settings.plan || ""} ${settings.billing} si rinnova tra ${days} giorni.${settings.billing === "mensile" ? " Passando all'annuale due mesi sono gratis." : ""}`);
}

// ---------------------------------------------------------------- knowledge: view, search, teach, export, import
const kDlg = $("knowledgeDialog");
const fmtWhen = (ms) => new Date(ms).toLocaleDateString("it-IT", { day: "numeric", month: "short", year: "numeric" });
function renderKnowledge() {
  $("knowledgeChip").textContent = knowledge.size ? `${knowledge.size} conoscenz${knowledge.size === 1 ? "a" : "e"}` : "conoscenza";
  const recent = knowledge.recent(4), box = $("tLearned"); box.innerHTML = "";
  if (!recent.length) { const e = document.createElement("div"); e.className = "empty"; e.textContent = "Ancora nulla. Chieda a Jarvis di studiare un argomento, o scriva \"impara che…\"."; box.appendChild(e); }
  recent.forEach((k) => { const d = document.createElement("div"); d.textContent = k.title; d.title = k.content.slice(0, 300); box.appendChild(d); });
  if (kDlg.open) renderKnowledgeList();
  refreshTele?.();
}
function renderKnowledgeList() {
  const q = $("kSearch").value.trim(), list = q ? knowledge.search(q, 30) : knowledge.recent(60), ul = $("kList"); ul.innerHTML = "";
  if (!list.length) { const li = document.createElement("li"); li.className = "empty"; li.textContent = q ? "Nessuna voce trovata." : "La base di conoscenza è vuota. Con Claude, provi: \"studia le scadenze fiscali di dicembre\"."; ul.appendChild(li); return; }
  list.forEach((k) => {
    const li = document.createElement("li"), t = document.createElement("span"), m = document.createElement("span"), c = document.createElement("span"), rm = document.createElement("button");
    t.className = "kt"; t.textContent = k.title; m.className = "km"; m.textContent = `${fmtWhen(k.updated)} · ${k.origin === "user" ? "insegnato da lei" : k.origin === "import" ? "importato" : "imparato da Jarvis"}${k.source ? " · " + k.source : ""}`;
    c.className = "kc"; c.textContent = k.content; rm.type = "button"; rm.textContent = "dimentica"; rm.onclick = async () => { await knowledge.forget(k.id); renderKnowledge(); renderKnowledgeList(); };
    li.append(t, rm, m, c); ul.appendChild(li);
  });
}
$("knowledgeChip").onclick = () => { $("kSearch").value = ""; renderKnowledgeList(); kDlg.showModal(); };
$("knowledgeChip").onkeydown = (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); $("knowledgeChip").click(); } };
$("kSearch").oninput = renderKnowledgeList;
$("kClose").onclick = () => kDlg.close();
$("kAdd").onclick = async () => { const title = $("kTitle").value.trim(), content = $("kContent").value.trim(); if (!title || !content) return; await knowledge.learn({ title, content, source: "insegnato da " + settings.name, origin: "user" }); $("kTitle").value = ""; $("kContent").value = ""; renderKnowledge(); renderKnowledgeList(); };
$("kExport").onclick = () => { const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([knowledge.export()], { type: "application/json" })); a.download = `jarvis-conoscenza-${new Date().toISOString().slice(0, 10)}.json`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000); };
$("kImport").onclick = () => $("kImportFile").click();
$("kImportFile").onchange = async () => { const f = $("kImportFile").files[0]; $("kImportFile").value = ""; if (!f) return; try { const n = await knowledge.import(await f.text()); notice(`Importate ${n} voci nella base di conoscenza.`); renderKnowledge(); renderKnowledgeList(); } catch (e) { notice("Importazione non riuscita: " + e.message); } };

// ---------------------------------------------------------------- telemetry: real values from this device
const tele = { fps: 0, frames: 0, since: performance.now(), batt: null, gpu: "" };
const setBar = (id, pct, warn) => { const el = $(id); if (!el) return; el.style.width = Math.max(0, Math.min(100, pct)) + "%"; el.classList.toggle("warn", !!warn); };
const brainLabel = () => (usingPuter() ? $("model").textContent : usingClaude() ? (claudeMod?.CLAUDE_MODELS?.[settings.claudeModel] || "Claude") : settings.provider === "local" ? ($("model").textContent || "locale") : "da scegliere");
refreshTele = () => {
  const now = new Date(), hh = String(now.getHours()).padStart(2, "0"), mm = String(now.getMinutes()).padStart(2, "0"), ss = String(now.getSeconds()).padStart(2, "0");
  $("tClock").textContent = `${hh}:${mm}:${ss}`; $("tClockBig").textContent = `${hh}:${mm}`; $("tDate").textContent = now.toLocaleDateString("it-IT", { weekday: "short", day: "numeric", month: "short" });
  $("rDate").innerHTML = `${now.toLocaleDateString("it-IT")}<br>${hh}:${mm}:${ss}`;
  const brain = brainLabel(); $("tBrain").textContent = brain; $("sBrain").textContent = "cervello " + brain; $("rBrain").innerHTML = "cervello<br>" + brain;
  const online = navigator.onLine; $("tNet").textContent = online ? "online" : "offline"; $("sNet").textContent = "rete " + (online ? "online" : "offline"); $("tStatus").textContent = online ? "online" : "offline";
  if (tele.batt) { const pct = Math.round(tele.batt.level * 100), lbl = pct + "%" + (tele.batt.charging ? " ⚡" : ""); $("tBatt").textContent = lbl; $("sBatt").textContent = "batteria " + lbl; setBar("tBattBar", pct, pct < 20); } else { $("sBatt").hidden = true; }
  $("tCores").textContent = navigator.hardwareConcurrency ? navigator.hardwareConcurrency + " core" : "n/d";
  $("tMem").textContent = navigator.deviceMemory ? "≥ " + navigator.deviceMemory + " GB" : "n/d";
  $("tGpu").textContent = tele.gpu || ("gpu" in navigator ? "WebGPU" : "assente");
  $("tFps").textContent = tele.fps ? tele.fps + " fps" : "—"; setBar("tFpsBar", (tele.fps / 60) * 100, tele.fps && tele.fps < 30);
  $("tDocs").textContent = library.size; $("sDocs").textContent = library.size + " documenti"; $("tKnow").textContent = knowledge.size; $("sKnow").textContent = knowledge.size + " conoscenze";
  setBar("tKnowBar", Math.min(100, knowledge.size * 2)); $("tFacts").textContent = facts.length; $("tRem").textContent = reminders.length;
  $("rArchive").innerHTML = `conoscenze ${knowledge.size}<br>documenti ${library.size}`;
};
const countFrames = (now) => { tele.frames++; if (now - tele.since >= 1000) { tele.fps = Math.round((tele.frames * 1000) / (now - tele.since)); tele.frames = 0; tele.since = now; } requestAnimationFrame(countFrames); };
requestAnimationFrame(countFrames);
setInterval(() => refreshTele(), 1000);
window.addEventListener("online", () => refreshTele()); window.addEventListener("offline", () => refreshTele());
try { navigator.getBattery?.().then((b) => { tele.batt = b; b.onlevelchange = b.onchargingchange = () => refreshTele(); refreshTele(); }); } catch {}
try { navigator.gpu?.requestAdapter().then((a) => { const i = a && a.info; tele.gpu = i ? [i.vendor, i.architecture].filter(Boolean).join(" ") || "WebGPU" : a ? "WebGPU" : "assente"; refreshTele(); }).catch(() => {}); } catch {}

// ---------------------------------------------------------------- boot sequence (once per session, skipped with reduced motion)
let bootDone; const booted = new Promise((r) => { bootDone = r; });
(() => {
  const boot = $("boot"); let seen = false; try { seen = sessionStorage.getItem("jarvis.booted") === "1"; sessionStorage.setItem("jarvis.booted", "1"); } catch {}
  const done = () => { boot.classList.add("done"); setTimeout(() => boot.remove(), 600); bootDone(); };
  if (seen || reduced) { boot.remove(); bootDone(); return; }
  boot.onclick = done; setTimeout(done, 2100);
})();

// ---------------------------------------------------------------- install prompt & boot
let installEvent = null;
window.addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); installEvent = e; if (!matchMedia("(display-mode: standalone)").matches) $("installBtn").style.display = "block"; });
$("installBtn").onclick = async () => { if (!installEvent) return; installEvent.prompt(); await installEvent.userChoice; $("installBtn").style.display = "none"; };
if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
applyLook(); renderSuggest(); if (settings.pinHash) lockScreen();
updateReminderChip(); reminders.forEach(armReminder);
history.slice(-6).forEach((m) => addTurn(m.role === "user" ? "user" : "jarvis", m.content, m.role === "user" ? "lei" : "jarvis"));
const hour = new Date().getHours();
addTurn("jarvis", `${hour < 12 ? "Buongiorno" : hour < 18 ? "Buon pomeriggio" : "Buonasera"}, ${settings.name}. Preparo i sistemi. Scriva "aiuto" per sapere cosa so fare, "modelli" per lettere e atti pronti, o trascini qui un documento.`, "jarvis", { plain: true });
(() => { const today = new Date().toDateString(); if (settings.briefing !== false && store.get("lastBriefing", "") !== today) { store.set("lastBriefing", today); const b = briefing(); if (/Promemoria di oggi:|Scadenze fiscali entro/.test(b)) addTurn("jarvis", "Briefing del giorno. " + b, "jarvis", { plain: true }); } })();
renewalNotice();
library.load().then(() => { renderDocs(); refreshTele(); });
knowledge.load().then(renderKnowledge);
if (usingPuter()) {
  $("model").textContent = "Potenza massima · Puter";
  loadPuterBrain().then((m) => m.loadPuter().then(() => { showBrain(); if (m.isSignedIn()) notice("Cervello: potenza massima con Puter, i modelli di punta senza chiave."); else booted.then(() => { notice("Per la potenza massima colleghi un account Puter gratuito dalle impostazioni."); openSettings(); }); })).catch(() => { notice("Non raggiungo Puter: passo al cervello locale."); settings.provider = "local"; store.set("settings", settings); loadEngine(); });
}
else if (usingClaude() && claudeKey.get()) { loadClaude().then(showBrain).catch(() => notice("Non riesco a caricare il collegamento con Claude: controlli la connessione.")); $("model").textContent = "Claude"; notice("Cervello: Claude di Anthropic."); }
else { if (usingClaude()) { settings.provider = "local"; store.set("settings", settings); } loadEngine(); }
