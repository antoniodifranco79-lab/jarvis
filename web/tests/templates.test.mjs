import test from "node:test";
import assert from "node:assert/strict";
import { TEMPLATES, findTemplate, fillTemplate } from "../templates.js";
import { docxBytes } from "../docx.js";

const ctx = { studio: "Studio Bianchi", signer: "Dott. Luca Bianchi", city: "Milano", today: new Date(2026, 10, 12) };

test("ogni modello si compila anche vuoto, con titolo e corpo", () => {
  assert.ok(TEMPLATES.length >= 14);
  assert.equal(new Set(TEMPLATES.map((t) => t.id)).size, TEMPLATES.length);
  for (const t of TEMPLATES) {
    const r = fillTemplate(t.id, {}, ctx); assert.ok(r.title && r.body.length > 200, t.id);
    assert.doesNotMatch(r.body, /undefined|NaN|\[object/, t.id);
    assert.ok(docxBytes(r.title, r.body).length > 1000, "diventa un Word: " + t.id);
  }
});

test("riconosce il modello dalla frase", () => {
  const cases = { "prepara un sollecito di pagamento per Rossi": "sollecito", "scrivi una diffida ad adempiere": "diffida", "lettera di disdetta del contratto telefonico": "disdetta", "fammi un preventivo": "preventivo", "verbale della riunione di ieri": "verbale", "informativa privacy per i clienti": "privacy", "policy AI dello studio": "policy-ai", "convocazione assemblea dei soci": "convocazione", "quietanza di pagamento": "quietanza" };
  for (const [q, id] of Object.entries(cases)) assert.equal(findTemplate(q)?.id, id, q);
  assert.equal(findTemplate("che tempo fa"), null);
});

test("sollecito compilato", () => {
  const r = fillTemplate("sollecito", { destinatario: "Rossi S.r.l.", fattura: "n. 12 del 3/10/2026", importo: "1.250", scadenza: "2/11/2026", iban: "IT60X0542811101000000123456" }, ctx);
  assert.match(r.body, /1\.250,00 €/); assert.match(r.body, /entro 15 giorni/); assert.match(r.body, /Milano, 12 novembre 2026/); assert.match(r.body, /Studio Bianchi/);
  assert.deepEqual(r.missing, []);
  assert.deepEqual(fillTemplate("sollecito", {}, ctx).missing, ["Destinatario", "Fattura (numero e data)", "Importo", "Scadenza originaria", "IBAN"]);
});

test("diffida: termine minimo di 15 giorni", () => {
  assert.match(fillTemplate("diffida", { giorni: "7" }, ctx).body, /termine di 15 giorni/);
  assert.match(fillTemplate("diffida", { giorni: "30" }, ctx).body, /termine di 30 giorni/);
});

test("preventivo con totali", () => {
  const r = fillTemplate("preventivo", { cliente: "Verdi", voci: "Consulenza iniziale; 300\nRedazione contratto: 1.200 €" }, ctx);
  assert.match(r.body, /Imponibile: 1\.500,00 €/); assert.match(r.body, /IVA 22%: 330,00 €/); assert.match(r.body, /Totale: 1\.830,00 €/);
});

test("quietanza con importo in lettere", () => {
  assert.match(fillTemplate("quietanza", { pagatore: "Verdi", importo: "1250,50", causale: "saldo fattura 12" }, ctx).body, /milleduecentocinquanta\/50/);
});
