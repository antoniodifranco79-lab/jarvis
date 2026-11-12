import test from "node:test";
import assert from "node:assert/strict";
import { parseList, applyList } from "../lists.js";

test("riconosce le richieste sulle liste", () => {
  assert.deepEqual(parseList("aggiungi latte e pane alla lista della spesa"), { action: "aggiungi", list: "spesa", items: ["latte", "pane"] });
  assert.deepEqual(parseList("metti chiamare il dentista nella lista cose da fare"), { action: "aggiungi", list: "cose da fare", items: ["chiamare il dentista"] });
  assert.deepEqual(parseList("devo comprare le uova"), { action: "aggiungi", list: "spesa", items: ["uova"] });
  assert.deepEqual(parseList("cosa c'è nella lista della spesa?"), { action: "mostra", list: "spesa" });
  assert.deepEqual(parseList("cosa devo fare"), { action: "mostra", list: "cose da fare" });
  assert.deepEqual(parseList("togli il pane dalla spesa"), { action: "togli", list: "spesa", items: ["pane"] });
  assert.deepEqual(parseList("ho comprato il latte"), { action: "fatto", list: "spesa", items: ["latte"] });
  assert.deepEqual(parseList("aggiungi biglietti aerei alla lista viaggio"), { action: "aggiungi", list: "viaggio", items: ["biglietti aerei"] });
  assert.equal(parseList("che tempo fa domani"), null); assert.equal(parseList("ricordami di comprare il pane"), null);
});

test("applica le azioni", () => {
  const L = {};
  assert.match(applyList(L, parseList("aggiungi latte, pane e uova alla lista della spesa")), /3 voci/);
  assert.match(applyList(L, parseList("aggiungi il latte alla spesa")), /già/);
  assert.match(applyList(L, parseList("ho comprato il latte")), /Segnato come fatto: latte. Restano 2/);
  assert.equal(applyList(L, parseList("cosa c'è nella lista della spesa")), "Lista spesa:\n- pane\n- uova");
  assert.match(applyList(L, parseList("togli il pane dalla spesa")), /Tolto: pane/);
  assert.match(applyList(L, { action: "elenco" }), /spesa \(1\)/);
  assert.match(applyList(L, parseList("svuota la lista della spesa")), /svuotata \(1 voce\)/);
  assert.match(applyList(L, parseList("cosa c'è nella lista della spesa")), /vuota/);
});
