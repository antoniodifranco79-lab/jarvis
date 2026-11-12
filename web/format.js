// Risposte leggibili: elenchi puntati e numerati, grassetto, link cliccabili e citazioni [1] evidenziate.
// Restituisce HTML sicuro: tutto il testo è prima trasformato in entità, poi si aggiungono solo i tag noti.
const escape = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
function inline(s) {
  return escape(s)
    .replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[\s(])\*([^*\n]+)\*(?=[\s).,;:!?]|$)/g, "$1<em>$2</em>")
    .replace(/`([^`\n]+)`/g, "<code>$1</code>")
    .replace(/\bhttps?:\/\/[^\s<>"')\]]+[^\s<>"').,;:!?\]]/g, (u) => `<a href="${u}" target="_blank" rel="noopener noreferrer">${u.replace(/^https?:\/\/(www\.)?/, "").slice(0, 60)}</a>`)
    .replace(/\[(\d{1,2}|doc|wiki)\]/g, '<sup class="cite">[$1]</sup>');
}
export function renderRich(text) {
  const out = []; let list = null;
  const close = () => { if (list) { out.push(`</${list}>`); list = null; } };
  for (const raw of String(text || "").replace(/\r/g, "").split("\n")) {
    const line = raw.trimEnd(); let m;
    if ((m = /^\s*[-*•]\s+(.*)$/.exec(line))) { if (list !== "ul") { close(); out.push("<ul>"); list = "ul"; } out.push(`<li>${inline(m[1])}</li>`); continue; }
    if ((m = /^\s*(\d{1,2})[.)]\s+(.*)$/.exec(line))) { if (list !== "ol") { close(); out.push(`<ol start="${+m[1]}">`); list = "ol"; } out.push(`<li>${inline(m[2])}</li>`); continue; }
    close();
    if ((m = /^#{1,3}\s+(.*)$/.exec(line))) { out.push(`<strong class="h">${inline(m[1])}</strong>`); continue; }
    out.push(line ? `<p>${inline(line)}</p>` : "");
  }
  close();
  return out.filter((x, i, a) => x || (a[i - 1] && a[i + 1])).join("");
}
/** Vero se il testo ha qualcosa da formattare (altrimenti resta testo semplice). */
/** Link mailto con oggetto e testo (i client email accettano circa 2.000 caratteri nell'indirizzo). */
export function mailto(subject, body, to = "") {
  const max = 1800; let b = String(body || ""); if (encodeURIComponent(b).length > max) { while (encodeURIComponent(b).length > max - 120) b = b.slice(0, Math.floor(b.length * 0.9)); b += "\n\n[…testo completo nel documento Word allegato]"; }
  return `mailto:${encodeURIComponent(to).replace(/%40/g, "@")}?subject=${encodeURIComponent(subject || "")}&body=${encodeURIComponent(b)}`;
}
/** Testo leggibile di una pagina web tramite il lettore pubblico r.jina.ai (gratuito, senza chiave). */
export const readerUrl = (url) => "https://r.jina.ai/" + String(url).trim();
export const isRich = (t) => /(^|\n)\s*([-*•]|\d{1,2}[.)])\s|\*\*|https?:\/\/|(^|\n)#{1,3}\s|\[\d{1,2}\]/.test(String(t || ""));
