// J.A.R.V.I.S. for the browser: the language model runs on this device through WebGPU (WebLLM);
// the hands (clock, weather, calculator, reminders, memory, Wikipedia) are plain JavaScript;
// voice comes from the browser. Nothing leaves the device except weather/Wikipedia lookups.

const $ = (id) => document.getElementById(id);
const transcript = $("transcript"), input = $("input"), stateChip = $("stateChip"), caption = $("caption");
const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
const WEBLLM_URL = "https://cdn.jsdelivr.net/npm/@mlc-ai/web-llm@0.2.88/lib/index.js";

// ---------------------------------------------------------------- settings & memory (local only)
const store = {
  get(key, fallback) { try { const v = localStorage.getItem("jarvis." + key); return v === null ? fallback : JSON.parse(v); } catch { return fallback; } },
  set(key, value) { try { localStorage.setItem("jarvis." + key, JSON.stringify(value)); } catch {} },
};
const settings = Object.assign({ name: "Signore", city: "", lang: "it-IT", model: "Qwen3-1.7B-q4f16_1-MLC" }, store.get("settings", {}));
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
async function route(text) {
  const t = text.toLowerCase().trim();
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
const persona = () => `Sei J.A.R.V.I.S., l'assistente personale di ${settings.name}: calmo, preciso, educato, con un'ironia britannica leggera. Rispondi in modo breve (una o tre frasi), senza elenchi né markdown, nella lingua in cui ti scrivono. Chiama l'utente "${settings.name}". Non inventare fatti; se un risultato di uno strumento è presente, usalo e cita i numeri esatti. Oggi è ${fmtDate()}, sono le ${fmtTime()}.${facts.length ? " Cose che sai dell'utente: " + facts.join("; ") + "." : ""}`;
async function loadEngine() {
  if (!("gpu" in navigator)) { notice("Questo browser non ha WebGPU: funzionano orologio, meteo, promemoria, calcoli e Wikipedia, ma non la conversazione libera. Serve Chrome aggiornato su Android 12 o più recente."); $("model").textContent = "modalità essenziale"; return; }
  setState("loading"); $("progress").hidden = false; $("model").textContent = settings.model.replace(/-q4f16_1-MLC$/, "");
  try {
    const webllm = await import(WEBLLM_URL);
    app.engine = await webllm.CreateMLCEngine(settings.model, { initProgressCallback: (p) => { $("progressBar").style.width = Math.round((p.progress || 0) * 100) + "%"; caption.textContent = (p.text || "carico il modello").toLowerCase().slice(0, 70); } });
    app.engineReady = true; $("progress").hidden = true; setState("idle"); notice("Modello pronto. Tutto gira su questo dispositivo.");
  } catch (e) { console.error(e); $("progress").hidden = true; setState("idle"); notice("Non sono riuscito a caricare il modello (" + (e.message || e) + "). Provi un modello più piccolo nelle impostazioni; intanto funzionano gli strumenti."); $("model").textContent = "modalità essenziale"; }
}
async function askModel(userText, toolResult) {
  const messages = [{ role: "system", content: persona() }, ...history.slice(-8)];
  messages.push({ role: "user", content: (toolResult ? `[Risultato strumento] ${toolResult}\n\n` : "") + userText + " /no_think" });
  const el = addTurn("jarvis streaming", "", "jarvis"); const body = el.querySelector(".body"); let out = "", spoken = "";
  const stream = await app.engine.chat.completions.create({ messages, stream: true, temperature: 0.6, max_tokens: 300 });
  for await (const chunk of stream) { const d = chunk.choices?.[0]?.delta?.content || ""; if (!d) continue; out += d; const shown = out.replace(/<think>[\s\S]*?(<\/think>|$)/g, "").trimStart(); body.textContent = shown; transcript.scrollTop = transcript.scrollHeight;
    const m = /^(.*?[.!?])\s/.exec(shown.slice(spoken.length)); if (m && m[1].length > 12) { speak(m[1]); spoken += m[0]; } }
  el.classList.remove("streaming"); const final = out.replace(/<think>[\s\S]*?<\/think>/g, "").trim(); body.textContent = final; if (final.slice(spoken.length).trim()) speak(final.slice(spoken.length).trim()); return final;
}
let busy = false;
async function ask(text) {
  text = (text || "").trim(); if (!text || busy) return; busy = true; input.value = "";
  addTurn("user", text, "lei"); setState("thinking");
  try {
    let routed = null; try { routed = await route(text); } catch (e) { console.warn(e); }
    let answer;
    if (routed) { setState("tool", routed.tool); addTool(routed.tool, routed.result.slice(0, 120)); setState("thinking"); }
    if (app.engineReady && (!routed || routed.result)) answer = await askModel(text, routed ? routed.result : "");
    else { answer = routed ? routed.direct : `Il modello non è ancora pronto, ${settings.name}. Posso dirle l'ora, il meteo, fare calcoli, promemoria e cercare su Wikipedia.`; addTurn("jarvis", answer, "jarvis"); speak(answer); }
    history.push({ role: "user", content: text }, { role: "assistant", content: answer }); history = history.slice(-20); store.set("history", history);
  } catch (e) { console.error(e); notice("Qualcosa è andato storto: " + (e.message || e)); }
  finally { busy = false; if (app.state !== "speaking") setState("idle"); }
}

// ---------------------------------------------------------------- input: text, microphone, wake mode
$("form").addEventListener("submit", (e) => { e.preventDefault(); ask(input.value); });
$("newSession").onclick = () => { history = []; store.set("history", history); transcript.innerHTML = ""; addTurn("system", "— nuova sessione —"); };
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
$("settingsBtn").onclick = () => { $("setName").value = settings.name; $("setCity").value = settings.city; $("setLang").value = settings.lang; $("setModel").value = settings.model; dlg.showModal(); };
$("setCancel").onclick = () => dlg.close();
$("setSave").onclick = (e) => { e.preventDefault(); const prevModel = settings.model; settings.name = $("setName").value.trim() || "Signore"; settings.city = $("setCity").value.trim(); settings.lang = $("setLang").value; settings.model = $("setModel").value; store.set("settings", settings); dlg.close(); if (settings.model !== prevModel) location.reload(); };

// ---------------------------------------------------------------- install prompt & boot
let installEvent = null;
window.addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); installEvent = e; if (!matchMedia("(display-mode: standalone)").matches) $("installBtn").style.display = "block"; });
$("installBtn").onclick = async () => { if (!installEvent) return; installEvent.prompt(); await installEvent.userChoice; $("installBtn").style.display = "none"; };
if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
updateReminderChip(); reminders.forEach(armReminder);
history.slice(-6).forEach((m) => addTurn(m.role === "user" ? "user" : "jarvis", m.content, m.role === "user" ? "lei" : "jarvis"));
const hour = new Date().getHours(); const hello = `${hour < 12 ? "Buongiorno" : hour < 18 ? "Buon pomeriggio" : "Buonasera"}, ${settings.name}. ${app.engineReady ? "" : "Preparo i sistemi."}`.trim();
addTurn("jarvis", hello, "jarvis");
if (synth) synth.onvoiceschanged = () => {};
loadEngine();
