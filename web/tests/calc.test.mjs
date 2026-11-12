import test from "node:test";
import assert from "node:assert/strict";
import * as c from "../calc.js";

const TODAY = new Date(2026, 10, 12); // giovedì 12 novembre 2026

test("numeri in lettere", () => {
  const cases = { 0: "zero", 1: "uno", 18: "diciotto", 21: "ventuno", 23: "ventitré", 28: "ventotto", 100: "cento", 108: "centootto", 133: "centotrentatré", 1000: "mille", 1001: "milleuno", 2000: "duemila", 1250: "milleduecentocinquanta", 21000: "ventunomila", 1000000: "unmilione", 2500000: "duemilionicinquecentomila", 3: "tre", 1003: "milletré" };
  for (const [n, w] of Object.entries(cases)) assert.equal(c.inLettere(+n), w, n);
  const r = c.numeroInLettere("1.250,50"); assert.equal(r.cheque, "milleduecentocinquanta/50"); assert.equal(r.words, "milleduecentocinquanta euro e cinquanta centesimi");
});

test("interessi legali anno per anno e a tasso fisso", () => {
  const r = c.interessi(10000, new Date(2024, 0, 1), new Date(2025, 0, 1));
  assert.equal(r.rows.length, 1); assert.equal(r.rows[0].days, 366); assert.equal(r.total, 250.68); // 10000 × 2,5% × 366/365
  const two = c.interessi(10000, new Date(2024, 6, 1), new Date(2025, 6, 1));
  assert.deepEqual(two.rows.map((x) => [x.year, x.days, x.rate]), [[2024, 184, 2.5], [2025, 181, 2]]);
  assert.equal(c.interessi(1000, new Date(2025, 0, 1), new Date(2025, 11, 31), 10).total, 99.73);
  assert.match(c.interessi(1000, new Date(2009, 0, 1), new Date(2010, 6, 1)).text, /Non ho il tasso legale per 2009/);
});

test("mutuo alla francese", () => {
  const r = c.ammortamento(100000, 3, 240); assert.equal(r.rata, 554.6); assert.equal(r.rows.at(-1).residuo, 0); assert.ok(Math.abs(r.rows.reduce((a, x) => a + x.capitale, 0) - 100000) < 1);
  assert.equal(c.ammortamento(1200, 0, 12).rata, 100);
});

test("decodifica del codice fiscale, anche omocodico", () => {
  const r = c.decodificaCF("RSSMRA85T10A562S", TODAY); assert.ok(r.ok); assert.equal(r.sex, "M"); assert.equal(r.born.getFullYear(), 1985); assert.equal(r.born.getMonth(), 11); assert.equal(r.born.getDate(), 10); assert.equal(r.comune, "A562"); assert.equal(r.age, 40);
  assert.ok(!c.decodificaCF("RSSMRA85T10A562X").ok);
});

test("scadenzario fiscale con slittamento al giorno lavorativo", () => {
  const r = c.scadenzeFiscali(TODAY, 50); const titles = r.list.map((x) => `${x.date.getDate()}/${x.date.getMonth() + 1} ${x.title}`);
  assert.ok(titles.some((x) => /^16\/11 .*F24.*IVA del terzo trimestre/.test(x)), titles.join("\n"));
  assert.ok(titles.some((x) => /^30\/11 Secondo acconto/.test(x)));
  assert.ok(titles.some((x) => /^16\/12 .*IMU: saldo/.test(x)));
  assert.ok(titles.some((x) => /^28\/12 Acconto IVA/.test(x)), "27/12/2026 è domenica: slitta a lunedì 28");
  assert.ok(c.nextWorking(new Date(2026, 7, 15)).getDate() === 17, "Ferragosto sabato → lunedì 17");
});

test("professionisti: forfettario, occasionale, compenso dal netto, split payment", () => {
  assert.equal(c.forfettario(50000).imposta, 5850); assert.equal(c.forfettario(50000, { aliquota: 5, contributi: 5000 }).imposta, 1700);
  const o = c.prestazioneOccasionale(1000); assert.equal(o.netto, 800); assert.equal(o.bollo, 2);
  assert.equal(c.compensoDaNetto(1068.8).compenso, 1000);
  assert.equal(c.splitPayment(1000).iva, 220);
});

test("commercio: margine, ricarico, sconti, variazione", () => {
  const m = c.margine(80, 100); assert.equal(m.margine, 20); assert.equal(m.ricarico, 25);
  assert.equal(c.prezzoDaRicarico(80, 25).prezzo, 100); assert.equal(c.prezzoDaMargine(80, 20).prezzo, 100);
  assert.equal(c.sconto(100, [20, 10]).finale, 72); assert.equal(c.variazione(80, 100).pct, 25);
});

test("tempo: ore lavorate, giorno della settimana, giorni mancanti, età", () => {
  assert.equal(c.oreLavorate("9-13 e 14:30-18:15").minutes, 465); assert.match(c.oreLavorate("9-13", 50).text, /200,00 €/);
  assert.match(c.giornoDellaSettimana(new Date(2026, 11, 25), TODAY).text, /venerdì.*Natale/);
  assert.equal(c.giorniMancanti(new Date(2026, 11, 25), TODAY).days, 43);
  assert.equal(c.eta(new Date(1985, 11, 10), TODAY).years, 40);
});

test("valute", () => {
  assert.deepEqual(c.parseCambio("quanto sono 100 dollari in euro?"), { amount: 100, from: "USD", to: "EUR" });
  assert.deepEqual(c.parseCambio("converti 1.500 euro in sterline"), { amount: 1500, from: "EUR", to: "GBP" });
  assert.equal(c.parseCambio("ciao"), null);
  assert.equal(c.parseCambio("ho dato 100 euro a franco"), null, "un nome non è una valuta");
});

test("routeCalc capisce le richieste", () => {
  const R = (q) => c.routeCalc(q, TODAY);
  assert.equal(R("scrivi in lettere 1.250,50").tool, "in lettere");
  assert.equal(R("1250 euro in lettere").tool, "in lettere");
  assert.match(R("interessi legali su 10.000 euro dal 1/1/2024 al 1/1/2025").result, /250,68/);
  assert.match(R("interessi su 5000 euro dal 1/1/2025 al 31/12/2025 al 3%").result, /al 3%/);
  assert.match(R("rata del mutuo di 100.000 euro al 3% per 20 anni").result, /554,60/);
  assert.equal(R("decodifica il codice fiscale RSSMRA85T10A562S").tool, "codice fiscale");
  assert.equal(R("quali sono le prossime scadenze fiscali?").tool, "scadenzario");
  assert.match(R("forfettario con ricavi 50.000").result, /5\.850,00/);
  assert.match(R("prestazione occasionale di 1000 euro").result, /800,00/);
  assert.match(R("quanto devo fatturare per incassare 1.000 euro netti").result, /935,63/);
  assert.match(R("margine con costo 80 e prezzo 100").result, /20%/);
  assert.match(R("prezzo con costo 80 e ricarico 25%").result, /100,00/);
  assert.match(R("sconto del 20% + 10% su 100 euro").result, /72,00/);
  assert.match(R("variazione percentuale da 80 a 100").result, /25%/);
  assert.match(R("ho lavorato dalle 9-13 e 14-18, quante ore sono?").result, /8 ore/);
  assert.match(R("che giorno è il 25/12/2026").result, /venerdì/);
  assert.match(R("quanti giorni mancano a natale").result, /43 giorni/);
  assert.equal(R("che tempo fa"), null);
  assert.equal(R("ciao jarvis"), null);
});
