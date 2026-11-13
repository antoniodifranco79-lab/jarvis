// Calendario .ics (RFC 5545) per Google Calendar, Outlook e Apple Calendario: promemoria, anche ricorrenti, e
// scadenze fiscali come eventi di un giorno con avviso. Orari "fluttuanti": valgono nel fuso del calendario che li apre.
const pad = (n) => String(n).padStart(2, "0");
const stamp = (d) => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}T${pad(d.getHours())}${pad(d.getMinutes())}00`;
const day = (d) => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
const esc = (s) => String(s || "").replace(/\\/g, "\\\\").replace(/;/g, "\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
/** Righe lunghe piegate a 75 byte, come vuole lo standard. */
function fold(line) { const out = []; let cur = "", bytes = 0; for (const ch of line) { const b = new TextEncoder().encode(ch).length; if (bytes + b > (out.length ? 74 : 75)) { out.push(cur); cur = ""; bytes = 0; } cur += ch; bytes += b; } out.push(cur); return out.join("\r\n "); }
const BYDAY = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];
export function rrule(rule) {
  if (!rule) return "";
  return { day: "FREQ=DAILY", weekday: "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR", week: `FREQ=WEEKLY;BYDAY=${BYDAY[rule.weekday]}`, month: `FREQ=MONTHLY;BYMONTHDAY=${rule.day}`, year: `FREQ=YEARLY;BYMONTH=${rule.month + 1};BYMONTHDAY=${rule.day}` }[rule.every] || "";
}
/** events: [{ title, at (ms) | date (Date, tutto il giorno), rule?, description?, alarmMinutes? }] → testo .ics */
export function icsCalendar(events, name = "J.A.R.V.I.S.", now = new Date()) {
  const L = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//J.A.R.V.I.S.//Promemoria//IT", "CALSCALE:GREGORIAN", "METHOD:PUBLISH", `X-WR-CALNAME:${esc(name)}`];
  events.forEach((e, i) => {
    L.push("BEGIN:VEVENT", `UID:jarvis-${(e.at || +e.date)}-${i}@jarvis.local`, `DTSTAMP:${stamp(now)}`);
    if (e.date) { const next = new Date(e.date); next.setDate(next.getDate() + 1); L.push(`DTSTART;VALUE=DATE:${day(e.date)}`, `DTEND;VALUE=DATE:${day(next)}`); }
    else { const s = new Date(e.at); L.push(`DTSTART:${stamp(s)}`, `DTEND:${stamp(new Date(e.at + 15 * 60e3))}`); }
    const r = rrule(e.rule); if (r) L.push(`RRULE:${r}`);
    L.push(`SUMMARY:${esc(e.title)}`); if (e.description) L.push(`DESCRIPTION:${esc(e.description)}`);
    const alarm = e.alarmMinutes ?? (e.date ? 3 * 24 * 60 : 0);
    L.push("BEGIN:VALARM", "ACTION:DISPLAY", `DESCRIPTION:${esc(e.title)}`, `TRIGGER:-PT${alarm}M`, "END:VALARM", "END:VEVENT");
  });
  L.push("END:VCALENDAR");
  return L.map(fold).join("\r\n") + "\r\n";
}
