import test from "node:test";
import assert from "node:assert/strict";
import { renderRich, isRich } from "../format.js";
import { icsCalendar, rrule } from "../ics.js";

test("formattazione sicura delle risposte", () => {
  const h = renderRich("Ecco:\n- **IVA** al 22% [1]\n- vedi https://www.agenziaentrate.gov.it/portale\n1. primo\n2. secondo\n<script>alert(1)</script>");
  assert.match(h, /<ul><li><strong>IVA<\/strong> al 22% <sup class="cite">\[1\]<\/sup><\/li>/);
  assert.match(h, /<a href="https:\/\/www\.agenziaentrate\.gov\.it\/portale" target="_blank" rel="noopener noreferrer">agenziaentrate\.gov\.it\/portale<\/a>/);
  assert.match(h, /<ol start="1"><li>primo<\/li><li>secondo<\/li><\/ol>/);
  assert.doesNotMatch(h, /<script>/); assert.match(h, /&lt;script&gt;/);
  assert.ok(isRich("- a\n- b")); assert.ok(!isRich("Buongiorno, sono le 9."));
  assert.doesNotMatch(renderRich('vedi https://x.it/"onmouseover="alert(1)'), /"onmouseover/);
});

test("calendario .ics valido, con ricorrenze e avvisi", () => {
  const ics = icsCalendar([
    { title: "Chiamare Rossi, studio; urgente", at: new Date(2026, 10, 16, 9, 0).getTime() },
    { title: "Controllare la PEC", at: new Date(2026, 10, 16, 9, 0).getTime(), rule: { every: "week", weekday: 1, h: 9, m: 0 } },
    { title: "IMU: saldo", date: new Date(2026, 11, 16) },
  ], "Studio", new Date(2026, 10, 12, 10, 0));
  assert.match(ics, /^BEGIN:VCALENDAR\r\n/); assert.match(ics, /END:VCALENDAR\r\n$/);
  assert.equal((ics.match(/BEGIN:VEVENT/g) || []).length, 3);
  assert.match(ics, /DTSTART:20261116T090000/); assert.match(ics, /SUMMARY:Chiamare Rossi\\, studio\; urgente/);
  assert.match(ics, /RRULE:FREQ=WEEKLY;BYDAY=MO/); assert.match(ics, /DTSTART;VALUE=DATE:20261216/); assert.match(ics, /TRIGGER:-PT4320M/);
  for (const line of ics.split("\r\n")) assert.ok(new TextEncoder().encode(line).length <= 75, line);
  assert.equal(rrule({ every: "month", day: 16 }), "FREQ=MONTHLY;BYMONTHDAY=16");
});
