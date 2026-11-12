import test from "node:test";
import assert from "node:assert/strict";
import { parseWhen, describeWhen } from "../when.js";

// Mercoledì 11 novembre 2026, 10:00 (ora locale)
const NOW = new Date(2026, 10, 11, 10, 0, 0);
const at = (r) => new Date(r.at);

test("tra N minuti / ore / giorni", () => {
  let r = parseWhen("ricordami tra 10 minuti di chiamare Rossi", NOW);
  assert.equal(r.at - NOW.getTime(), 10 * 60e3); assert.equal(r.rest, "chiamare Rossi");
  r = parseWhen("tra due ore controlla la PEC", NOW); assert.equal(r.at - NOW.getTime(), 2 * 3600e3); assert.equal(r.rest, "controlla la PEC");
  r = parseWhen("fra mezz'ora pausa", NOW); assert.equal(r.at - NOW.getTime(), 30 * 60e3);
  r = parseWhen("ricordami tra 3 giorni di inviare il preventivo", NOW); assert.equal(r.at - NOW.getTime(), 3 * 864e5);
});

test("domani alle 9, stasera, alle 18:30", () => {
  let r = parseWhen("ricordami domani alle 9 di pagare l'F24", NOW);
  assert.deepEqual([at(r).getDate(), at(r).getHours(), at(r).getMinutes()], [12, 9, 0]); assert.equal(r.rest, "pagare l'F24");
  r = parseWhen("stasera chiama il commercialista", NOW); assert.equal(at(r).getHours(), 20); assert.equal(at(r).getDate(), 11);
  r = parseWhen("alle 18:30 riunione", NOW); assert.deepEqual([at(r).getDate(), at(r).getHours(), at(r).getMinutes()], [11, 18, 30]);
  r = parseWhen("alle 9 e mezza caffè", NOW); assert.deepEqual([at(r).getDate(), at(r).getHours(), at(r).getMinutes()], [12, 9, 30]); // le 9:30 sono passate: domani
  r = parseWhen("domani alle 3 del pomeriggio dentista", NOW); assert.equal(at(r).getHours(), 15); assert.equal(r.rest, "dentista");
});

test("giorni della settimana e date", () => {
  let r = parseWhen("lunedì alle 10 udienza", NOW); assert.equal(at(r).getDay(), 1); assert.equal(at(r).getHours(), 10); assert.equal(r.rest, "udienza");
  r = parseWhen("mercoledì scadenza", NOW); assert.equal(at(r).getDate(), 18); // oggi è mercoledì: quello prossimo
  r = parseWhen("il 16/12 alle 9:30 versamento IVA", NOW); assert.deepEqual([at(r).getMonth(), at(r).getDate(), at(r).getHours(), at(r).getMinutes()], [11, 16, 9, 30]); assert.equal(r.rest, "versamento IVA");
  r = parseWhen("il 3 marzo rinnovo", NOW); assert.equal(at(r).getFullYear(), 2027); assert.equal(at(r).getMonth(), 2);
  r = parseWhen("il 5/1/27 assemblea", NOW); assert.equal(at(r).getFullYear(), 2027);
});

test("niente data o data non valida", () => {
  assert.equal(parseWhen("ricordami di chiamare Rossi", NOW), null);
  assert.equal(parseWhen("alle 27 qualcosa", NOW), null);
});

test("describeWhen parla come una persona", () => {
  assert.equal(describeWhen(NOW.getTime() + 10 * 60e3, NOW), "tra 10 minuti");
  assert.equal(describeWhen(NOW.getTime() + 2 * 3600e3, NOW), "tra 2 ore, alle 12:00");
  assert.equal(describeWhen(NOW.getTime() + 90 * 60e3, NOW), "tra un'ora e 30 minuti, alle 11:30");
  assert.match(describeWhen(new Date(2026, 10, 12, 9, 0).getTime(), NOW), /^domani alle 09:00$/);
  assert.match(describeWhen(new Date(2026, 11, 16, 9, 30).getTime(), NOW), /16 dicembre alle 09:30/);
});

import { parseRecurring, nextOccurrence, describeRule } from "../when.js";
test("promemoria ricorrenti", () => {
  let r = parseRecurring("ricordami ogni lunedì alle 9 di controllare la PEC", NOW);
  assert.deepEqual(r.rule, { every: "week", weekday: 1, h: 9, m: 0 }); assert.equal(r.rest, "controllare la PEC");
  assert.equal(new Date(r.at).getDate(), 16); assert.equal(describeRule(r.rule), "ogni lunedì alle 09:00");
  r = parseRecurring("tutti i giorni alle 8:30 leggi le email", NOW); assert.equal(r.rule.every, "day"); assert.equal(new Date(r.at).getDate(), 12); assert.equal(r.rest, "leggi le email");
  r = parseRecurring("il 16 di ogni mese alle 10 paga l'F24", NOW); assert.deepEqual([r.rule.every, r.rule.day], ["month", 16]); assert.equal(new Date(r.at).getDate(), 16); assert.equal(new Date(r.at).getMonth(), 10); assert.equal(r.rest, "paga l'F24");
  r = parseRecurring("nei giorni feriali alle 18 chiudi la cassa", NOW); assert.equal(r.rule.every, "weekday"); assert.equal(new Date(r.at).getHours(), 18);
  r = parseRecurring("ogni anno il 3 marzo rinnovo dominio", NOW); assert.equal(new Date(r.at).getFullYear(), 2027);
  assert.equal(parseRecurring("domani alle 9 chiama Rossi", NOW), null);
});
test("prossima ricorrenza", () => {
  const fri = new Date(2026, 10, 13, 18, 30);
  assert.equal(new Date(nextOccurrence({ every: "weekday", h: 18, m: 0 }, fri)).getDay(), 1, "venerdì sera → lunedì");
  assert.equal(new Date(nextOccurrence({ every: "month", day: 31, h: 9, m: 0 }, new Date(2026, 10, 1))).getDate(), 30, "il 31 a novembre diventa il 30");
});

test("oggi senza ora, anche a tarda sera", () => {
  const late = new Date(2026, 10, 11, 23, 30);
  const r = parseWhen("ricordami oggi di spegnere il server", late);
  assert.equal(r.at - late.getTime(), 36e5); assert.equal(r.rest, "spegnere il server");
});
