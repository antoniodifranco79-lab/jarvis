// Voce di J.A.R.V.I.S. nel browser: sceglie la voce più naturale disponibile sul dispositivo, prepara il testo
// per la lettura (niente simboli, numeri e abbreviazioni come li direbbe una persona) e legge a frasi brevi,
// con l'intonazione naturale della voce. Nessuna chiave e nessun servizio esterno oltre a quelli del browser.

const NOVELTY = /albert|bad news|bahh|bells|boing|bubbles|cellos|good news|jester|organ|superstar|trinoids|whisper|wobble|zarvox|\bfred\b|junior|ralph|kathy|princess|espeak|robot|grandma|grandpa|rocko|shelley|flo\b|reed\b|eddy|sandy/i;
const MALE = /diego|giuseppe|cosimo|luca\b|paolo|roberto|riccardo|benigno|calogero|gianni|lisandro|rinaldo|marcello|ryan|daniel|george|arthur|oliver|thomas|\bguy\b|davis|eric|andrew|brian|christopher|alfie|elliot|ethan|noah|male|uomo|maschile/i;

/** Punteggio di naturalezza di una voce per una lingua: le voci neurali e di rete vincono, quelle "giocattolo" sono escluse. */
export function scoreVoice(v, lang, gender = "male") {
  const vl = String(v.lang || "").replace("_", "-").toLowerCase(), want = lang.toLowerCase();
  if (!vl.startsWith(want.slice(0, 2)) || NOVELTY.test(v.name)) return -1;
  let s = vl === want ? 15 : 0;
  if (/natural|neural/i.test(v.name)) s += 120;          // Microsoft Edge: voci neurali
  else if (/online/i.test(v.name)) s += 90;              // altre voci di rete Microsoft
  if (/premium|enhanced|siri|migliorat/i.test(v.name)) s += 80; // Apple: voci scaricate di qualità alta
  if (/google/i.test(v.name)) s += 70;                   // Chrome: voci di rete Google
  if (v.localService === false) s += 15;
  const male = MALE.test(v.name);
  if ((gender === "male" && male) || (gender === "female" && !male)) s += 60;
  return s;
}
export const rankVoices = (voices, lang, gender) => voices.map((v) => ({ v, s: scoreVoice(v, lang, gender) })).filter((x) => x.s >= 0).sort((a, b) => b.s - a.s).map((x) => x.v);

const MESI = ["gennaio", "febbraio", "marzo", "aprile", "maggio", "giugno", "luglio", "agosto", "settembre", "ottobre", "novembre", "dicembre"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const IT_ABBR = [[/\bartt\.\s*/gi, "articoli "], [/\bart\.\s*/gi, "articolo "], [/\bpp\.\s*(?=\d)/gi, "pagine "], [/\bp\.\s*(?=\d)/gi, "pagina "], [/\bn\.\s*(?=\d)/gi, "numero "],
  [/\bnn\.\s*(?=\d)/gi, "numeri "], [/\becc\./gi, "eccetera"], [/\bdott\.ssa\b\.?/gi, "dottoressa"], [/\bdott\.\s*/gi, "dottor "], [/\bavv\.\s*/gi, "avvocato "], [/\bing\.\s*/gi, "ingegner "],
  [/\bsig\.ra\b\.?/gi, "signora"], [/\bsig\.\s*/gi, "signor "], [/\bspett\.(le)?\s*/gi, "spettabile "], [/\bS\.?r\.?l\.?(?=\W|$)/g, "esse erre elle"], [/\bS\.?p\.?A\.?(?=\W|$)/g, "esse pi a"],
  [/\bs\.?n\.?c\.?(?=\W|$)/g, "esse enne ci"], [/\bc\.?a\.?(?=\s)/g, "circa"], [/\btel\.\s*/gi, "telefono "], [/\bp\.?\s?iva\b/gi, "partita iva"], [/\bIVA\b/g, "iva"], [/\bIBAN\b/g, "iban"],
  [/\bF24\b/g, "effe ventiquattro"], [/\bPEC\b/g, "pec"], [/\bAI\b/g, "A I"], [/\bGDPR\b/g, "gi di pi erre"], [/\bvs\.?\s/gi, "contro "], [/\bkm\/h\b/gi, "chilometri orari"], [/°\s?C\b/g, " gradi"], [/\s?°/g, " gradi"]];
const EN_ABBR = [[/\be\.g\.\s*/gi, "for example "], [/\bi\.e\.\s*/gi, "that is "], [/\betc\./gi, "et cetera"], [/\bvs\.?\s/gi, "versus "], [/\bDr\.\s*/g, "Doctor "], [/\bMr\.\s*/g, "Mister "],
  [/\bMrs\.\s*/g, "Missus "], [/\bkm\/h\b/gi, "kilometres per hour"], [/°\s?C\b/g, " degrees"], [/\s?°/g, " degrees"]];

/** Testo pronto da leggere: senza markdown, citazioni e link; numeri, date, ore e abbreviazioni come li direbbe una persona. */
export function speechText(text, lang = "it") {
  const it = !String(lang).toLowerCase().startsWith("en");
  let t = String(text || "");
  t = t.replace(/```[\s\S]*?```/g, " ").replace(/`([^`]*)`/g, "$1");
  t = t.replace(/\[(?:\d+|doc|wiki)\](?:\s*\[(?:\d+|doc|wiki)\])*/gi, "");
  t = t.replace(/\((?:fonte|fonti|source|file)[^)]*\)/gi, "").replace(/\([^()]*\bp\.\s*\d+[^()]*\)/g, "");
  t = t.replace(/https?:\/\/\S+/g, it ? "il link" : "the link").replace(/\bwww\.\S+/g, it ? "il sito" : "the website");
  t = t.replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{1F000}-\u{1F2FF}]/gu, "");
  t = t.replace(/^\s*(?:[-*•▸▾]|\d+[.)])\s+/gm, "").replace(/[*_#>|~]+/g, " ");
  t = t.replace(/J\.A\.R\.V\.I\.S\.?/g, "Jarvis");
  // date: 12/03/2026, 2026-03-12
  const dateIt = (d, m, y) => (m >= 1 && m <= 12 ? `${+d} ${it ? MESI[m - 1] : MONTHS[m - 1]}${y ? " " + y : ""}` : null);
  t = t.replace(/\b(\d{4})-(\d{2})-(\d{2})\b/g, (all, y, m, d) => dateIt(d, +m, y) || all);
  t = t.replace(/\b(\d{1,2})\/(\d{1,2})\/(\d{2,4})\b/g, (all, d, m, y) => dateIt(d, +m, y.length === 2 ? "20" + y : y) || all);
  t = t.replace(/\b(il|al|dal|del|entro|fino|giorno|data|scade|the|on|by)\s+(\d{1,2})\/(\d{1,2})\b(?!\/)/gi, (all, w, d, m) => (+d >= 1 && +d <= 31 ? `${w} ${dateIt(d, +m, "") || `${d}/${m}`}` : all));
  // ore: 09:30 -> 9 e 30
  t = t.replace(/\b([01]?\d|2[0-3])[:.]([0-5]\d)\b(?!\d)/g, (all, h, m) => (it ? (m === "00" ? `${+h}` : `${+h} e ${+m}`) : (m === "00" ? `${+h} o'clock` : `${+h} ${m}`)));
  // separatori delle migliaia all'italiana: 1.250.000 -> 1250000
  if (it) t = t.replace(/\b\d{1,3}(?:\.\d{3})+(?![\d.]*\d)/g, (n) => n.replace(/\./g, ""));
  // importi in euro: "1250,50 €", "€ 1250", "1250 euro"
  const euro = (n) => { const [i, c] = n.replace(/\./g, "").split(","); return c && +c ? `${i} euro e ${+c} centesimi` : `${i} euro`; };
  if (it) { t = t.replace(/€\s?(\d[\d.,]*\d|\d)/g, (_, n) => euro(n)).replace(/(\d[\d.,]*\d|\d)\s?€/g, (_, n) => euro(n)).replace(/(\d+),(\d{2})\s+euro\b/g, (_, i, c) => (+c ? `${i} euro e ${+c} centesimi` : `${i} euro`)); }
  else t = t.replace(/€\s?(\d[\d.,]*)/g, "$1 euros").replace(/(\d[\d.,]*)\s?€/g, "$1 euros");
  t = t.replace(/(\d)\s?%/g, it ? "$1 per cento" : "$1 percent");
  for (const [re, rep] of it ? IT_ABBR : EN_ABBR) t = t.replace(re, rep);
  t = t.replace(/([:;,.!?])[ \t]*\n+/g, "$1 ").replace(/\n{2,}/g, ". ").replace(/\n/g, ", ");
  t = t.replace(/\s+([,.;:!?])/g, "$1").replace(/\(\s*\)/g, "").replace(/[ \t]+/g, " ").replace(/([.!?:;,])\s*[.,](?!\d)/g, "$1").replace(/,\s*,/g, ",");
  return t.trim();
}

const EN_HINT = /\b(the|is|and|you|sir|what|good|morning|evening|with|your|this|will|have)\b/i, IT_HINT = /\b(il|la|che|sono|signore|buongiorno|buonasera|grazie|oggi|non|per|della|anche)\b/i;
export const guessLang = (t) => (EN_HINT.test(t) && !IT_HINT.test(t) ? "en-GB" : "it-IT");

/** Divide in frasi da leggere: unisce le frasi brevissime (niente pause a singhiozzo) e spezza quelle lunghe sulle virgole. */
export function chunks(text, max = 220) {
  const sentences = String(text).match(/[^.!?…]+[.!?…]+["»)]?|[^.!?…]+$/g) || [];
  const out = []; let cur = "";
  for (let s of sentences.map((x) => x.trim()).filter(Boolean)) {
    while (s.length > max) { let cut = Math.max(s.lastIndexOf(", ", max), s.lastIndexOf("; ", max), s.lastIndexOf(": ", max)); if (cut < max * 0.4) cut = s.lastIndexOf(" ", max); if (cut <= 0) cut = max; out.push((cur + " " + s.slice(0, cut + 1)).trim()); cur = ""; s = s.slice(cut + 1).trim(); }
    if ((cur + " " + s).trim().length < 60 && !/[.!?…]["»)]?$/.test(cur || "x")) cur = (cur + " " + s).trim();
    else if (cur.length < 40 && cur) cur = (cur + " " + s).trim();
    else { if (cur) out.push(cur); cur = s; }
  }
  if (cur) out.push(cur);
  return out;
}

export class Voice {
  constructor({ getSettings, onStart, onEnd, onWord } = {}) {
    this.synth = typeof window !== "undefined" ? window.speechSynthesis : null;
    Object.assign(this, { getSettings: getSettings || (() => ({})), onStart, onEnd, onWord });
    this.voices = []; this.pending = 0; this.keepAlive = null;
    if (this.synth) { const load = () => { this.voices = this.synth.getVoices(); }; load(); this.synth.addEventListener?.("voiceschanged", load); }
  }
  get available() { return !!this.synth; }
  list(lang) { const s = this.getSettings(); return rankVoices(this.voices, lang, s.voiceGender || "male"); }
  pick(lang) {
    const s = this.getSettings(), wanted = lang.startsWith("en") ? s.voiceEn : s.voiceIt;
    return (wanted && this.voices.find((v) => v.name === wanted)) || this.list(lang)[0] || null;
  }
  speak(text) {
    if (!this.synth || !text) return;
    const s = this.getSettings();
    for (const part of chunks(text)) {
      const lang = guessLang(part), clean = speechText(part, lang); if (!clean) continue;
      const u = new SpeechSynthesisUtterance(clean); const v = this.pick(lang);
      u.lang = v ? v.lang : lang; if (v) u.voice = v;
      u.rate = Math.min(1.5, Math.max(0.7, +s.voiceRate || 1)); u.pitch = 1; u.volume = 1;
      u.onstart = () => { this.onStart?.(); };
      u.onboundary = () => this.onWord?.();
      u.onend = u.onerror = () => { this.pending = Math.max(0, this.pending - 1); if (!this.pending) { this.stopKeepAlive(); this.onEnd?.(); } };
      this.pending++; this.synth.speak(u); this.startKeepAlive();
    }
  }
  // Chrome interrompe le letture lunghe dopo circa 15 secondi: una pausa e ripresa periodica lo evita.
  startKeepAlive() { if (this.keepAlive || !/Chrome/.test(navigator.userAgent) || /Edg\//.test(navigator.userAgent)) return; this.keepAlive = setInterval(() => { if (this.synth.speaking && !this.synth.paused) { this.synth.pause(); this.synth.resume(); } }, 10000); }
  stopKeepAlive() { clearInterval(this.keepAlive); this.keepAlive = null; }
  stop() { if (!this.synth) return; this.pending = 0; this.synth.cancel(); this.stopKeepAlive(); this.onEnd?.(); }
  test(lang = "it-IT") { this.stop(); this.speak(lang.startsWith("en") ? "Good evening, Sir. All systems are online, and I am at your service." : `Buonasera, ${this.getSettings().name || "Signore"}. Tutti i sistemi sono operativi: sono a sua disposizione.`); }
}
