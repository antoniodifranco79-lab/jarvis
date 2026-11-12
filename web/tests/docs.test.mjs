import test from "node:test";
import assert from "node:assert/strict";
import { Library, chunk, tokens } from "../docs.js";

const file = (name, text) => new File([text], name, { type: "text/plain" });

test("tokens: minuscole, accenti, parole vuote, radici", () => {
  assert.deepEqual(tokens("La Penale è dovuta"), tokens("penali dovute"));
  assert.ok(!tokens("il contratto della società").includes("il"));
});
test("chunk divide con sovrapposizione", () => {
  const c = chunk(["Frase uno. ".repeat(300)]); assert.ok(c.length > 2); for (const x of c) assert.ok(x.text.length <= 1100);
});
test("Library: aggiunge, cerca, trova per nome, testo completo", async () => {
  const lib = new Library();
  await lib.add(file("Contratto Rossi.txt", "Articolo 1. Oggetto: fornitura di sedie.\n\nArticolo 7. Penale: in caso di ritardo il fornitore paga 50 euro al giorno.\n\nArticolo 9. Recesso con preavviso di 30 giorni."));
  await lib.add(file("bilancio-2025.txt", "Il fatturato 2025 è di 1,2 milioni. L'utile netto è di 80 mila euro."));
  assert.equal(lib.size, 2);
  const hits = lib.search("quanto è la penale per il ritardo?"); assert.equal(hits[0].doc, "Contratto Rossi.txt"); assert.match(hits[0].text, /50 euro/);
  assert.equal(lib.mentioned("riassumi il contratto rossi").name, "Contratto Rossi.txt");
  assert.equal(lib.find("bilancio").name, "bilancio-2025.txt");
  assert.match(lib.fullText(lib.find("rossi").id), /Recesso/);
  assert.match(lib.head(lib.find("rossi").id, 60), /Articolo 1/);
  await lib.add(file("Contratto Rossi.txt", "versione nuova del contratto con testo sufficiente")); assert.equal(lib.size, 2, "stesso nome: sostituito");
  await lib.remove(lib.find("bilancio").id); assert.equal(lib.size, 1);
});
test("file senza testo: errore chiaro", async () => {
  await assert.rejects(new Library().add(file("vuoto.txt", "  ")), /non contiene testo leggibile/);
});
