// Liste personali e di studio: spesa, cose da fare, regali, qualsiasi lista con un nome. Restano sul dispositivo.
// parseList riconosce la richiesta, applyList la esegue su un oggetto { nome: [{ text, done, added }] }.

const norm = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim();
const ALIAS = { spesa: "spesa", "della spesa": "spesa", supermercato: "spesa", "cose da fare": "cose da fare", todo: "cose da fare", "to do": "cose da fare", impegni: "cose da fare", compiti: "cose da fare" };
const listName = (raw) => { const n = norm(raw).replace(/^(la|lista|alla|nella|dalla|della)\s+/g, "").replace(/^(lista\s+)?(della|delle|dei|di|per)\s+/, "").trim(); return ALIAS[n] || n || "cose da fare"; };
const splitItems = (s) => String(s || "").split(/,|\se\s|;/).map((x) => x.trim().replace(/^(il|lo|la|i|gli|le|un|uno|una|l'|del|della|dei|delle)\s+/i, "")).filter(Boolean);

/** Riconosce: "aggiungi latte e pane alla lista della spesa", "metti in agenda chiamare Rossi", "cosa c'è nella lista della spesa",
 *  "togli il latte dalla spesa", "ho comprato il pane", "ho fatto chiamare Rossi", "svuota la lista della spesa", "quali liste ho". */
export function parseList(text) {
  const t = String(text || "").trim().replace(/[?!.]+$/, ""); const l = t.toLowerCase(); let m;
  if (/^(quali|che) liste\b|^le mie liste$|^mostra(mi)? le liste$/.test(l)) return { action: "elenco" };
  if ((m = /^(?:aggiungi|metti|segna|scrivi)\s+(.+?)\s+(?:alla|nella|in|sulla|tra le|fra le)\s+(lista\s+(?:della|delle|dei|di|per)\s+[\wàèéìòù ]+|lista\s+[\wàèéìòù ]+|spesa|cose da fare|todo|impegni)$/i.exec(t))) return { action: "aggiungi", list: listName(m[2]), items: splitItems(m[1]) };
  if ((m = /^(?:devo|ricordati che devo|da fare:?)\s+(comprare|prendere)\s+(.+)$/i.exec(t))) return { action: "aggiungi", list: "spesa", items: splitItems(m[2]) };
  if ((m = /^(?:cosa c'è|cosa ce|che c'è|cosa ho|leggi|mostra(?:mi)?|elenca)\s+(?:nella|la|in)\s+(lista\s+(?:della|delle|dei|di|per)\s+[\wàèéìòù ]+|lista\s+[\wàèéìòù ]+|spesa|cose da fare|todo)$/i.exec(t)) || (m = /^(?:cosa devo fare|cosa devo comprare)(?:\s+oggi)?$/i.exec(t))) return { action: "mostra", list: m[1] ? listName(m[1]) : /comprare/i.test(t) ? "spesa" : "cose da fare" };
  if ((m = /^(?:togli|rimuovi|cancella|elimina)\s+(.+?)\s+(?:dalla|dal|dalle)\s+(lista\s+(?:della|delle|dei|di|per)\s+[\wàèéìòù ]+|lista\s+[\wàèéìòù ]+|spesa|cose da fare|todo)$/i.exec(t))) return { action: "togli", list: listName(m[2]), items: splitItems(m[1]) };
  if ((m = /^ho (comprato|preso)\s+(.+)$/i.exec(t))) return { action: "fatto", list: "spesa", items: splitItems(m[2]) };
  if ((m = /^ho (fatto|finito|completato)\s+(.+)$/i.exec(t))) return { action: "fatto", list: "cose da fare", items: splitItems(m[2]) };
  if ((m = /^(?:svuota|azzera|cancella tutta)\s+(?:la\s+)?(lista\s+(?:della|delle|dei|di|per)\s+[\wàèéìòù ]+|lista\s+[\wàèéìòù ]+|spesa|cose da fare|todo)$/i.exec(t))) return { action: "svuota", list: listName(m[1]) };
  return null;
}

const voci = (n) => (n === 1 ? "1 voce" : `${n} voci`);
const match = (entry, item) => { const a = norm(entry.text), b = norm(item); return a === b || a.includes(b) || b.includes(a); };
/** Esegue l'azione e restituisce il testo della risposta; `lists` viene modificato. */
export function applyList(lists, cmd, now = Date.now()) {
  const fmt = (name) => { const l = lists[name] || []; const open = l.filter((x) => !x.done); return open.length ? open.map((x) => `- ${x.text}`).join("\n") : ""; };
  if (cmd.action === "elenco") { const names = Object.keys(lists).filter((n) => (lists[n] || []).some((x) => !x.done)); return names.length ? "Le sue liste: " + names.map((n) => `${n} (${lists[n].filter((x) => !x.done).length})`).join(", ") + "." : "Nessuna lista aperta."; }
  const name = cmd.list; lists[name] ||= [];
  if (cmd.action === "aggiungi") { const added = []; for (const it of cmd.items) { if (!lists[name].some((x) => !x.done && match(x, it))) { lists[name].push({ text: it, done: false, added: now }); added.push(it); } } return added.length ? `Aggiunto alla lista ${name}: ${added.join(", ")}. Ora ${lists[name].filter((x) => !x.done).length === 1 ? "c'è" : "ci sono"} ${voci(lists[name].filter((x) => !x.done).length)}.` : `Era già nella lista ${name}.`; }
  if (cmd.action === "mostra") { const t = fmt(name); return t ? `Lista ${name}:\n${t}` : `La lista ${name} è vuota.`; }
  if (cmd.action === "togli" || cmd.action === "fatto") {
    const hit = []; for (const it of cmd.items) { const e = lists[name].find((x) => !x.done && match(x, it)); if (e) { if (cmd.action === "fatto") e.done = true; else lists[name] = lists[name].filter((x) => x !== e); hit.push(e.text); } }
    if (!hit.length) return `Non trovo "${cmd.items.join(", ")}" nella lista ${name}.`;
    const left = lists[name].filter((x) => !x.done).length;
    return `${cmd.action === "fatto" ? "Segnato come fatto" : "Tolto"}: ${hit.join(", ")}. ${left ? `${left === 1 ? "Resta" : "Restano"} ${voci(left)} nella lista ${name}.` : `La lista ${name} è completa.`}`;
  }
  if (cmd.action === "svuota") { const n = lists[name].filter((x) => !x.done).length; lists[name] = []; return `Lista ${name} svuotata (${voci(n)}).`; }
  return "";
}
