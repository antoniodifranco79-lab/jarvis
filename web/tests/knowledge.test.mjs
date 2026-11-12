import test from "node:test";
import assert from "node:assert/strict";
import { Knowledge } from "../knowledge.js";

test("impara, aggiorna, ritrova, dimentica, esporta e importa", async () => {
  const k = new Knowledge();
  await k.learn({ title: "Orari dello studio", content: "Lo studio è aperto dal lunedì al venerdì, 9-13 e 14-18." });
  const r = await k.learn({ title: "orari dello studio", content: "Aperto dal lunedì al venerdì 9-18 orario continuato." });
  assert.equal(r.updated, true); assert.equal(k.size, 1); assert.equal(k.items[0].revisions, 2);
  await k.learn({ title: "Cliente Bianchi", content: "Bianchi Srl paga a 60 giorni fine mese, referente la signora Neri." });
  assert.equal(k.relevant("quando paga Bianchi?")[0].title, "Cliente Bianchi");
  assert.equal(k.relevant("ricetta della carbonara").length, 0);
  const json = k.export(); const k2 = new Knowledge(); assert.equal(await k2.import(json), 2); assert.equal(k2.size, 2);
  assert.ok(await k.forget("Cliente Bianchi")); assert.equal(k.size, 1);
  await assert.rejects(k.learn({ title: "", content: "x" }), /servono titolo e contenuto/);
  await assert.rejects(k2.import("{\"x\":1}"), /file non valido/);
});

test("cancellazione completa", async () => {
  const k = new Knowledge(); await k.learn({ title: "a", content: "uno" }); await k.learn({ title: "b", content: "due" });
  await k.clearAll(); assert.equal(k.size, 0); assert.deepEqual(k.search("uno"), []);
});
