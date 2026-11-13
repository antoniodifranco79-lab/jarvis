import test from "node:test";
import assert from "node:assert/strict";
import { num, iva, parcella, holidayName, parseDate, addDays, daysBetween, checkCF, checkPIVA, checkIBAN, routeStudio } from "../studio.js";

test("numeri all'italiana", () => {
  assert.equal(num("1.000"), 1000); assert.equal(num("1.250,50"), 1250.5); assert.equal(num("1250.5"), 1250.5); assert.equal(num("€ 2.000"), 2000);
});
test("IVA aggiunta e scorporata", () => {
  assert.deepEqual([iva(1000, 22).iva, iva(1000, 22).totale], [220, 1220]);
  const s = iva(1220, 22, "scorpora"); assert.equal(s.imponibile, 1000); assert.equal(s.iva, 220);
});
test("parcella ordinaria e forfettaria", () => {
  const o = parcella(1000); assert.equal(o.contributo, 40); assert.equal(o.iva, 228.8); assert.equal(o.totale, 1268.8); assert.equal(o.ritenuta, 200); assert.equal(o.netto, 1068.8);
  const f = parcella(1000, { forfettario: true }); assert.equal(f.iva, 0); assert.equal(f.bollo, 2); assert.equal(f.totale, 1042);
});
test("festività e scadenze", () => {
  assert.equal(holidayName(new Date(2026, 3, 5)), "Pasqua"); assert.equal(holidayName(new Date(2026, 3, 6)), "Lunedì dell'Angelo"); assert.equal(holidayName(new Date(2026, 9, 4)), "San Francesco d'Assisi");
  assert.equal(addDays(new Date(2026, 11, 23), 2).date.getDate(), 25); assert.match(addDays(new Date(2026, 11, 23), 2).text, /Natale/);
  assert.equal(addDays(new Date(2026, 11, 23), 2, { working: true }).date.getDate(), 28);
  assert.equal(parseDate("31/02/2026"), null); assert.equal(parseDate("16 dicembre 2026").getMonth(), 11);
  assert.match(daysBetween(new Date(2026, 0, 1), new Date(2026, 0, 31)).text, /30/);
});
test("codici: CF, partita IVA, IBAN", () => {
  assert.ok(checkCF("RSSMRA85T10A562S").ok); assert.ok(!checkCF("RSSMRA85T10A562X").ok);
  assert.ok(checkPIVA("12345678903").ok); assert.ok(!checkPIVA("12345678901").ok);
  assert.ok(checkIBAN("IT60 X054 2811 1010 0000 0123 456").ok); assert.ok(!checkIBAN("IT60X0542811101000000123457").ok);
});
test("routeStudio riconosce le richieste", () => {
  assert.equal(routeStudio("quanto è l'iva su 1000 euro").tool, "IVA");
  assert.equal(routeStudio("scorpora iva da 1220").tool, "IVA");
  assert.equal(routeStudio("fattura per un compenso di 2.000 euro").tool, "parcella");
  assert.equal(routeStudio("60 giorni dal 15/07/2026").tool, "scadenza");
  assert.equal(routeStudio("che tempo fa domani"), null);
});
