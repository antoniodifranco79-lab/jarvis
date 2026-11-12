import test from "node:test";
import assert from "node:assert/strict";
import * as x from "../extract.js";

const CONTRATTO = [
  `CONTRATTO DI FORNITURA tra Rossi S.r.l., P.IVA 12345678903, con sede in Milano, e il Sig. Mario Bianchi, C.F. RSSMRA85T10A562S, nato a Roma il 10/12/1985, email mario.bianchi@example.com, PEC bianchi@pec.it, tel. 333 123 4567.

Art. 1 Durata. Il contratto ha durata di 24 mesi a decorrere dal 1 gennaio 2027 e si rinnova tacitamente per uguale periodo.

Art. 2 Corrispettivo. Il canone è di € 1.250,00 al mese, pagabile entro il 5 di ogni mese con bonifico sull'IBAN IT60 X054 2811 1010 0000 0123 456.`,
  `Art. 3 Recesso. Ciascuna parte può recedere con preavviso di 90 giorni da comunicare entro il 30/09/2028 a mezzo PEC.

Art. 4 Penale. In caso di ritardo nella consegna è dovuta una penale di 50 euro per ogni giorno.

Art. 5 Foro competente. Per ogni controversia è competente in via esclusiva il foro di Milano.`,
];

test("pagine da array o da marcatori [p. N]", () => {
  assert.deepEqual(x.pagesOf(["a", "b"]).map((p) => p.page), [1, 2]);
  assert.deepEqual(x.pagesOf("[p. 1]\nuno\n\n[p. 2]\ndue").map((p) => [p.page, p.text.trim()]), [[1, "uno"], [2, "due"]]);
});

test("date e scadenze con contesto e pagina", () => {
  const d = x.estraiDate(CONTRATTO);
  assert.deepEqual(d.map((v) => [v.date.getFullYear(), v.date.getMonth() + 1, v.date.getDate(), v.page]), [[1985, 12, 10, 1], [2027, 1, 1, 1], [2028, 9, 30, 2]]);
  assert.ok(d[2].deadline && /preavviso di 90 giorni/.test(d[2].context));
  assert.ok(!d[0].deadline, "la data di nascita non è una scadenza");
});

test("importi", () => {
  const im = x.estraiImporti(CONTRATTO); assert.deepEqual(im.map((v) => v.amount), [1250, 50]); assert.equal(im[1].page, 2);
});

test("dati identificativi validati", () => {
  const d = x.estraiDati(CONTRATTO);
  assert.deepEqual(d.cf.map((v) => v.value), ["RSSMRA85T10A562S"]); assert.deepEqual(d.piva.map((v) => v.value), ["12345678903"]);
  assert.deepEqual(d.iban.map((v) => v.value), ["IT60X0542811101000000123456"]); assert.deepEqual(d.email.map((v) => v.value), ["mario.bianchi@example.com"]);
  assert.deepEqual(d.pec.map((v) => v.value), ["bianchi@pec.it"]); assert.equal(d.telefoni.length, 1);
});

test("clausole chiave", () => {
  const names = x.clausoleChiave(CONTRATTO).map((c) => c.name);
  for (const n of ["Durata", "Rinnovo", "Recesso e disdetta", "Preavviso", "Penali", "Pagamenti", "Foro competente"]) assert.ok(names.includes(n), n);
  assert.equal(x.clausoleChiave(CONTRATTO).find((c) => c.name === "Penali").hits[0].page, 2);
});

test("statistiche e indice Gulpease", () => {
  const s = x.statistiche("Il gatto dorme. Il cane abbaia. Oggi piove.");
  assert.equal(s.words, 8); assert.equal(s.sentences, 3); assert.equal(s.gulpease, 100, "frasi brevissime: il massimo");
  const legalese = "Il presente contratto, stipulato tra le parti sopra indicate, disciplina la fornitura continuativa dei beni descritti nell'allegato tecnico, che costituisce parte integrante e sostanziale del medesimo, nonché le modalità di consegna, collaudo, pagamento e risoluzione delle eventuali controversie insorgenti.";
  assert.ok(x.statistiche(legalese).gulpease < 40, "periodo lungo e tecnico: difficile");
  assert.equal(x.statistiche("Ai sensi dell'art. 5 del contratto, la società S.r.l. paga. Poi chiude.").sentences, 2, "le abbreviazioni non chiudono la frase");
});

test("confronto tra due versioni", () => {
  const a = "Il canone è di 1.000 euro. Il preavviso è di 60 giorni. Il foro è Milano.";
  const b = "Il canone è di 1.200 euro. Il preavviso è di 60 giorni. Si applica la legge italiana.";
  const r = x.confronta(a, b);
  assert.equal(r.same, 1); assert.equal(r.changed.length, 1); assert.match(r.changed[0].to, /1\.200/);
  assert.deepEqual(r.added, ["Si applica la legge italiana."]); assert.deepEqual(r.removed, ["Il foro è Milano."]);
  assert.match(x.confronta(a, a).text, /identici/);
});

test("anonimizzazione GDPR", () => {
  const r = x.anonimizza(CONTRATTO.join("\n"), ["Rossi"]);
  for (const s of ["RSSMRA85T10A562S", "12345678903", "IT60 X054", "mario.bianchi@example.com", "333 123 4567", "Mario Bianchi", "10/12/1985", "Rossi"]) assert.ok(!r.text.includes(s), s);
  assert.match(r.text, /Sig\. \[NOME 1\]/); assert.match(r.text, /\[CODICE FISCALE 1\]/); assert.match(r.text, /nato a Roma il \[DATA DI NASCITA 1\]/);
  assert.ok(r.total >= 7); assert.match(r.summary, /Sostituiti/);
  assert.match(r.text, /foro di Milano/, "i luoghi non sono dati personali");
});

test("rapporto completo", () => {
  const r = x.rapporto("contratto.pdf", CONTRATTO);
  for (const s of ["Date e scadenze", "Importi", "Dati identificativi", "Clausole chiave", "Statistiche"]) assert.ok(r.includes(s), s);
});
