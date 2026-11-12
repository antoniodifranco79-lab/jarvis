import test from "node:test";
import assert from "node:assert/strict";
import * as u from "../utility.js";

const NOW = new Date(Date.UTC(2026, 10, 12, 12, 0)); // 13:00 a Roma
test("fusi orari", () => {
  assert.match(u.worldTime("tokyo", NOW).text, /21:00.*\+8 ore/);
  assert.match(u.worldTime("new york", NOW).text, /07:00.*-6 ore/);
  assert.equal(u.worldTime("atlantide", NOW), null);
});
test("conversioni", () => {
  assert.equal(u.convert(10, "km", "miglia").value, 6.214); assert.equal(u.convert(100, "f", "c").value, 37.78);
  assert.equal(u.convert(1, "kwh", "kcal").value, 860.421); assert.equal(u.convert(2, "ettari", "mq").value, 20000); assert.equal(u.convert(1, "kg", "metri"), null);
});
test("password, casuale, calendario, distanze", () => {
  const p = u.password(20); assert.equal(p.length, 20); assert.match(p, /[a-z]/); assert.match(p, /[A-Z]/); assert.match(p, /\d/); assert.match(p, /[!@#$%&*?\-_+=]/);
  for (let i = 0; i < 50; i++) { const n = u.randomInt(1, 6); assert.ok(n >= 1 && n <= 6); }
  assert.equal(u.weekNumber(new Date(2026, 0, 1)), 1); assert.equal(u.weekNumber(new Date(2026, 11, 31)), 53);
  assert.equal(u.holidaysOf(2026).length, 13);
  assert.equal(Math.round(u.haversine({ lat: 45.4642, lon: 9.19 }, { lat: 41.9028, lon: 12.4964 })), 477);
});
test("routeUtility", () => {
  const R = (q) => u.routeUtility(q, NOW);
  assert.equal(R("che ore sono a Tokyo?").tool, "fuso orario");
  assert.match(R("converti 10 km in miglia").result, /6,214 miglia/); assert.match(R("quanti litri sono 5 galloni").result, /18,927/);
  assert.match(R("genera una password di 24 caratteri").result, /24 caratteri/);
  assert.match(R("testa o croce").result, /Testa|Croce/); assert.equal(R("numero casuale tra 1 e 10").tool, "casuale");
  assert.match(R("in che settimana siamo? che settimana è").result, /settimana 46/);
  assert.match(R("festività 2027").result, /Pasqua/); assert.match(R("è festivo il 25/12/2026").result, /Natale/);
  assert.deepEqual(R("distanza tra Milano e Roma"), { tool: "distanza", need: "distanza", a: "milano", b: "roma" });
  assert.equal(R("a che ora tramonta il sole a Napoli").need, "sole"); assert.equal(R("qualità dell'aria a Torino").place, "torino");
  assert.equal(R("cosa significa ossimoro").word, "ossimoro"); assert.equal(R("crea un QR code per https://example.com").data, "https://example.com");
  assert.equal(R("ciao"), null); assert.equal(R("riassumi il contratto"), null);
});
