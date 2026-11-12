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

const $ = (id) => document.getElementById(id);
const transcript = $("transcript"), input = $("input"), stateChip = $("stateChip"), caption = $("caption");
const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
const WEBLLM_URL = "https://cdn.jsdelivr.net/npm/@mlc-ai/web-llm@0.2.88/lib/index.js";

// ---------------------------------------------------------------- settings & memory (local only)
const store = {
  get(key, fallback) { try { const v = localStorage.getItem("jarvis." + key); return v === null ? fallback : JSON.parse(v); } catch { return fallback; } },
  set(key, value) { try { localStorage.setItem("jarvis." + key, JSON.stringify(value)); } catch {} },
};
const settings = Object.assign({ name: "Signore", city: "", lang: "it-IT", model: "auto", think: false, lastModel: "", provider: "local", claudeModel: "claude-opus-5-5", voiceIt: "", voiceEn: "", voiceRate: 1, voiceGender: "male" }, store.get("settings", {}));
const claudeKey = { get: () => store.get("claudeKey", ""), set: (k) => store.set("claudeKey", k) };
const usingClaude = () => settings.provider === "claude";
const library = new Library();
const knowledge = new Knowledge();
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
const HELP = () => `Ecco cosa so fare, ${settings.name}. Documenti: carichi PDF, Word o testi con la graffetta e mi chieda cosa contengono, un riassunto o una clausola; restano su questo dispositivo. Studio: IVA (aggiungi o scorpora), fattura del professionista con cassa e ritenuta, giorni tra due date, scadenze tra N giorni con festività, verifica di codice fiscale, partita IVA e IBAN. Conoscenza: "impara che …" mi insegna qualcosa, "cosa hai imparato" mostra ciò che so; con Claude posso anche studiare un argomento sul web e memorizzarlo. Poi ora, meteo, calcoli, promemoria, memoria a lungo termine e Wikipedia. Per il resto, conversazione libera${settings.provider === "claude" ? " con Claude, anche con ricerca sul web" : " con il modello che gira su questo dispositivo, gratis e senza chiave"}. Dica "studia" e un argomento per farmi imparare da Wikipedia.`;
async function route(text) {
  const t = text.toLowerCase().trim();
  if (/^(aiuto|help|cosa sai fare|che cosa sai fare|comandi|cosa puoi fare)\b/.test(t)) return { tool: "aiuto", result: "", direct: HELP() };
  if (/\b(quali|che|elenca|lista)\b.*\b(documenti|file)\b/.test(t) && !/\b(dice|contien|parla)/.test(t)) { const list = library.docs.map((d) => `${d.name} (${d.pages > 1 ? d.pages + " pagine" : d.chars < 1000 ? d.chars + " caratteri" : Math.round(d.chars / 1000) + " mila caratteri"})`); return { tool: "documenti", result: list.length ? "Documenti caricati: " + list.join("; ") : "Nessun documento caricato.", direct: list.length ? `Ho ${list.length} documenti, ${settings.name}: ${list.join("; ")}.` : `Nessun documento caricato, ${settings.name}. Usi la graffetta per aggiungerne.` }; }
  const studio = routeStudio(text); if (studio) return { tool: studio.tool, result: studio.result, direct: studio.result, exact: true };
  if (/^(che ore sono|che ora è|che ora e|che ora sono|dimmi l.ora|sai che ore sono|what time)/.test(t) || /\b(che ore sono|what time is it)\b/.test(t)) return { tool: "orologio", result: `Ora: ${fmtTime()}, ${fmtDate()}.`, direct: `Sono le ${fmtTime()}, ${settings.name}.` };
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
  const learnM = /^(impara che|impara:|imparalo:|sappi che|tieni presente che)\s*(.+)$/is.exec(text.trim());
  if (learnM) { const content = learnM[2].trim(); const title = content.split(/[.:;\n]/)[0].split(/\s+/).slice(0, 8).join(" "); const r = await knowledge.learn({ title, content, source: "insegnato da " + settings.name, origin: "user" }); renderKnowledge(); return { tool: "conoscenza", result: `${r.updated ? "Aggiornato" : "Imparato"}: ${title}`, direct: `${r.updated ? "Aggiornato" : "Imparato"}, ${settings.name}. Lo userò d'ora in poi.` }; }
  if (/\b(cosa hai imparato|che cosa hai imparato|cosa sai fare di nuovo|mostrami la conoscenza)\b/.test(t)) { const list = knowledge.recent(8).map((k) => k.title); return { tool: "conoscenza", result: list.length ? "Voci recenti: " + list.join("; ") : "Nessuna voce.", direct: list.length ? `Ho imparato ${knowledge.size} cose, ${settings.name}. Le più recenti: ${list.join("; ")}.` : `Per ora non ho imparato nulla, ${settings.name}. Mi insegni qualcosa con "impara che…".` }; }
  if (/^(ricorda che|ricordati che|memorizza che|remember that)\s+/i.test(text.trim())) { const fact = text.trim().replace(/^(ricorda che|ricordati che|memorizza che|remember that)\s+/i, ""); facts.push(fact); store.set("facts", facts); return { tool: "memoria", result: `Memorizzato: ${fact}`, direct: `Annotato, ${settings.name}.` }; }
  if (/\b(cosa sai di me|cosa ti ho detto|cosa ricordi|what do you remember)\b/.test(t)) return { tool: "memoria", result: facts.length ? "Fatti memorizzati: " + facts.join("; ") : "Nessun fatto memorizzato.", direct: facts.length ? `Ricordo questo, ${settings.name}: ${facts.join("; ")}.` : `Per ora non mi ha detto nulla da ricordare, ${settings.name}.` };
  const calc = /^(quanto fa|calcola|calculate|what is|quanto è)\s+(.+)$/i.exec(text.trim().replace(/[?.!]+$/, "")); if (calc) { const v = calculate(calc[2]); if (v != null) return { tool: "calcolatrice", result: `${calc[2]} = ${v}`, direct: `Fa ${String(v).replace(".", ",")}, ${settings.name}.` }; }
  const who = /^(chi è|chi era|cos'è|cosa è|che cos'è|who is|what is)\s+(.+)$/i.exec(text.trim().replace(/[?.!]+$/, "")); if (who) { const r = await wikipedia(who[2], /^who|^what/i.test(who[1]) ? "en" : "it").catch(() => null); if (r) return { tool: "wikipedia", result: r, direct: r }; }
  return null;
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
    return { text: `Promemoria impostato per ${fmtDate(new Date(at))} alle ${fmtTime(new Date(at))}: ${messaggio}.` };
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
  async ricorda({ fatto }) { facts.push(fatto); store.set("facts", facts); return { text: `Memorizzato: ${fatto}` }; },
};
const TOOL_LABEL = { search_documents: "documenti", read_document: "leggo documento", list_documents: "documenti", calcola_iva: "IVA", calcola_fattura_professionista: "parcella", calcola_scadenza: "scadenza", giorni_tra_date: "calendario", verifica_codice: "verifica", calcola: "calcolatrice", meteo: "meteo", imposta_promemoria: "promemoria", ricorda: "memoria", impara: "imparo", cerca_conoscenza: "conoscenza", dimentica: "dimentico", cerca_wikipedia: "wikipedia", leggi_wikipedia: "leggo wikipedia" };
async function getClaudeSession() {
  const m = await loadClaude();
  return (claudeSession ||= new m.ClaudeSession({ getKey: claudeKey.get, getModel: () => settings.claudeModel || m.DEFAULT_CLAUDE_MODEL, getName: () => settings.name, getEffort: () => (settings.think ? "high" : "medium"), store, tools: TOOLS }));
}
/** Mostra e legge una risposta in streaming, con le righe degli strumenti in mezzo e le fonti alla fine. */
function streamRenderer() {
  let el = null, body = null, spoken = "", buffer = "", lastEl = null;
  const bubble = () => { if (!el) { el = addTurn("jarvis streaming", "", "jarvis"); body = el.querySelector(".body"); spoken = ""; buffer = ""; lastEl = el; } };
  const flushSpeech = (final) => { const rest = buffer.slice(spoken.length); if (final) { if (rest.trim()) speak(rest.trim()); spoken = buffer; return; } const m = /^([\s\S]*?[.!?])\s/.exec(rest); if (m && m[1].length > 12) { speak(m[1]); spoken += m[0]; } };
  const close = () => { if (el) { el.classList.remove("streaming"); flushSpeech(true); el = null; } };
  return {
    onText: (d) => { bubble(); buffer += d; body.textContent = buffer.trimStart(); transcript.scrollTop = transcript.scrollHeight; flushSpeech(false); },
    onThinking: () => { caption.textContent = "ragiono…"; },
    onTool: (name, input) => { close(); setState("tool", TOOL_LABEL[name] || name); addTool(TOOL_LABEL[name] || name, Object.values(input).filter((v) => typeof v !== "object").join(" · ").slice(0, 120)); setState("thinking"); },
    onNotice: (t) => addTurn("system", t),
    finish(answer, sources = [], web = []) {
      close();
      if (!lastEl) { lastEl = addTurn("jarvis", answer || "Fatto.", "jarvis"); speak(answer); }
      const docSources = sources.filter((p, i, a) => a.findIndex((q) => q.n === p.n && q.doc === p.doc) === i);
      if (docSources.length) addSources(lastEl, docSources);
      if (web.length) { const box = document.createElement("div"); box.className = "sources"; web.slice(0, 6).forEach(([url, title]) => { const a = document.createElement("a"); a.href = url; a.target = "_blank"; a.rel = "noopener"; a.textContent = "↗ " + title; box.appendChild(a); }); lastEl.appendChild(box); }
    },
  };
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
      app.engine = await webllm.CreateMLCEngine(model, { initProgressCallback: (p) => { $("progressBar").style.width = Math.round((p.progress || 0) * 100) + "%"; caption.textContent = (p.text || "carico il modello").toLowerCase().slice(0, 70); } }, { context_window_size: /0\.6B|1\.7B/.test(model) ? 6144 : 8192 });
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
const cite = (p) => `${p.doc}${p.page ? ", p. " + p.page : ""}`;
function addSources(el, passages) {
  if (!passages.length) return;
  const box = document.createElement("div"); box.className = "sources";
  passages.forEach((p) => { const d = document.createElement("details"); const s = document.createElement("summary"); s.textContent = `[${p.n}] ${cite(p)}`; const q = document.createElement("p"); q.textContent = p.text.slice(0, 900) + (p.text.length > 900 ? "…" : ""); d.append(s, q); box.appendChild(d); });
  el.appendChild(box); transcript.scrollTop = transcript.scrollHeight;
}

const localSystem = () => `Sei J.A.R.V.I.S., l'assistente personale di ${settings.name}: calmo, preciso, educato, con un'ironia britannica leggera. Chiama l'utente "${settings.name}" e rispondi nella sua lingua (di solito italiano).
Le risposte vengono lette ad alta voce: vai dritto al punto, di solito da una a tre frasi, senza markdown né tabelle.
Regole:
- Non inventare mai fatti, numeri, date, norme o nomi. Se non lo sai, usa uno strumento o dillo.
- Documenti dell'utente: usa search_documents (o read_document per riassunti) e rispondi solo da quei testi, citando [1], [2].
- IVA, fatture, scadenze, codici: usa sempre gli strumenti di calcolo e riporta i numeri esatti.
- Per studiare un argomento: cerca_wikipedia, poi leggi_wikipedia, poi salva i punti chiave con impara (titolo breve, contenuto sintetico, fonte). Quando l'utente ti insegna qualcosa di utile, usa impara.
- Ogni messaggio dell'utente inizia con [Contesto] (data, ora, fatti, documenti, conoscenze pertinenti): usalo senza ripeterlo. Se c'è un [Risultato strumento] o ci sono [Passaggi], usali.
${app.model && /0\.6B/.test(app.model) ? "" : toolsBlock()}`;
async function askLocal(text, toolResult, passages = []) {
  const ctxText = passages.map((p) => `[${p.n}] (${cite(p)})\n${p.text.slice(0, passages.length === 1 ? 2400 : 700)}`).join("\n\n");
  const userContent = `[Contesto] ${contextLine(text)}\n\n` + (toolResult ? `[Risultato strumento] ${toolResult}\n\n` : "") + (ctxText ? `[Passaggi]\n${ctxText}\n\n` : "") + text;
  const view = streamRenderer(); TOOLS._n = passages.length;
  const res = await runLocalAgent({ engine: app.engine, system: localSystem(), history: history.slice(-6), userContent, tools: TOOLS, think: settings.think,
    onText: view.onText, onTool: view.onTool, onThinking: view.onThinking, maxRounds: /0\.6B/.test(app.model || "") ? 0 : 4, isAborted: () => app.aborted });
  view.finish(res.answer, [...passages, ...res.sources]);
  return res.answer;
}
let busy = false;
async function ask(text) {
  text = (text || "").trim(); if (!text || busy) return; busy = true; app.aborted = false; voice.stop(); input.value = ""; $("sendBtn").classList.add("stop");
  addTurn("user", text, "lei"); setState("thinking");
  try {
    let answer;
    if (usingClaude() && !/^(aiuto|help|cosa sai fare|che cosa sai fare|comandi|cosa puoi fare)\b/i.test(text)) {
      setState("thinking"); answer = await askClaude(text);
      history.push({ role: "user", content: text }, { role: "assistant", content: answer }); history = history.slice(-20); store.set("history", history);
      return;
    }
    let routed = null; try { routed = await route(text); } catch (e) { console.warn(e); }
    const passages = routed ? [] : docContext(text);
    if (routed) { setState("tool", routed.tool); addTool(routed.tool, (routed.result || routed.direct).slice(0, 140)); setState("thinking"); }
    if (passages.length) addTool("documenti", passages.map(cite).filter((v, i, a) => a.indexOf(v) === i).join(" · ").slice(0, 140));
    if (app.engineReady && (!routed || (routed.result && !routed.exact))) answer = await askLocal(text, routed ? routed.result : "", passages);
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
  refreshTele?.();
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
$("form").addEventListener("submit", (e) => { e.preventDefault(); voice.stop(); if (busy) { app.aborted = true; if (claudeSession) claudeSession.abort(); if (app.engine) { try { app.engine.interruptGenerate(); } catch {} } return; } ask(input.value); });
$("newSession").onclick = () => { history = []; store.set("history", history); store.set("claudeHistory", []); if (claudeSession) claudeSession.reset(); transcript.innerHTML = ""; addTurn("system", "— nuova sessione —"); };
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
$("micBtn").onclick = () => { voice.stop(); if (app.recognizing && !app.wake) stopRec(); else { app.wake = false; $("wakeBtn").classList.remove("on"); startRec(false); } };
$("wakeBtn").onclick = () => { app.wake = !app.wake; $("wakeBtn").classList.toggle("on", app.wake); if (app.wake) { notice("modalità ascolto attiva · dica \"Jarvis, …\""); startRec(true); } else stopRec(); };

// ---------------------------------------------------------------- settings dialog
const dlg = $("settings");
const syncProviderUI = () => { const c = $("setProvider").value === "claude"; $("claudeFields").hidden = !c; $("localFields").hidden = c; };
function openSettings(focus) {
  $("setName").value = settings.name; $("setCity").value = settings.city; $("setLang").value = settings.lang; $("setModel").value = settings.model.replace(/-q4f(16|32)_1-MLC$/, ""); $("setThink").checked = !!settings.think;
  $("setProvider").value = settings.provider || "claude"; $("setKey").value = claudeKey.get(); $("setClaudeModel").value = settings.claudeModel || "claude-opus-5-5"; $("keyStatus").textContent = claudeKey.get() ? "Chiave salvata su questo dispositivo." : "";
  fillVoices(); $("setVoiceRate").value = settings.voiceRate || 1; $("setVoiceGender").value = settings.voiceGender || "male";
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
  if (usingClaude()) { $("model").textContent = (claudeMod?.CLAUDE_MODELS[settings.claudeModel] || "Claude") + (claudeKey.get() ? "" : " · manca la chiave"); }
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
const brainLabel = () => (usingClaude() ? (claudeMod?.CLAUDE_MODELS?.[settings.claudeModel] || "Claude") : settings.provider === "local" ? ($("model").textContent || "locale") : "da scegliere");
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
updateReminderChip(); reminders.forEach(armReminder);
history.slice(-6).forEach((m) => addTurn(m.role === "user" ? "user" : "jarvis", m.content, m.role === "user" ? "lei" : "jarvis"));
const hour = new Date().getHours();
addTurn("jarvis", `${hour < 12 ? "Buongiorno" : hour < 18 ? "Buon pomeriggio" : "Buonasera"}, ${settings.name}. Preparo i sistemi. Scriva "aiuto" per sapere cosa so fare, o trascini qui un documento.`, "jarvis");
library.load().then(() => { renderDocs(); refreshTele(); });
knowledge.load().then(renderKnowledge);
if (usingClaude() && claudeKey.get()) { loadClaude().then(showBrain).catch(() => notice("Non riesco a caricare il collegamento con Claude: controlli la connessione.")); $("model").textContent = "Claude"; notice("Cervello: Claude di Anthropic."); }
else { if (usingClaude()) { settings.provider = "local"; store.set("settings", settings); } loadEngine(); }
