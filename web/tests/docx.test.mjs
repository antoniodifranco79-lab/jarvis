import test from "node:test";
import assert from "node:assert/strict";
import { crc32, docxBytes, documentXml, fileName } from "../docx.js";

/** Legge le voci di uno ZIP "stored" (senza compressione), come quello prodotto da docx.js. */
function entries(bytes) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), out = {}; let p = 0;
  while (dv.getUint32(p, true) === 0x04034b50) {
    const method = dv.getUint16(p + 8, true), crc = dv.getUint32(p + 14, true), size = dv.getUint32(p + 18, true), nlen = dv.getUint16(p + 26, true), xlen = dv.getUint16(p + 28, true);
    const name = new TextDecoder().decode(bytes.subarray(p + 30, p + 30 + nlen)); const data = bytes.subarray(p + 30 + nlen + xlen, p + 30 + nlen + xlen + size);
    assert.equal(method, 0); assert.equal(crc32(data), crc, `crc di ${name}`);
    out[name] = new TextDecoder().decode(data); p += 30 + nlen + xlen + size;
  }
  assert.equal(dv.getUint32(p, true), 0x02014b50, "segue la directory centrale");
  return out;
}

test("crc32 noto", () => { assert.equal(crc32(new TextEncoder().encode("123456789")), 0xcbf43926); });

test("il .docx contiene le parti richieste da Word", () => {
  const files = entries(docxBytes("Lettera al cliente", "Gentile cliente,\n\n# Oggetto\n- primo punto\n- **secondo** punto", "12 novembre 2026"));
  for (const n of ["[Content_Types].xml", "_rels/.rels", "word/document.xml"]) assert.ok(files[n], n);
  const doc = files["word/document.xml"];
  assert.match(doc, /Lettera al cliente/); assert.match(doc, /12 novembre 2026/); assert.match(doc, /primo punto/);
  assert.match(doc, /<w:b\/>/, "il grassetto diventa grassetto vero");
  assert.doesNotMatch(doc, /\*\*/);
});

test("caratteri speciali escapati", () => {
  const xml = documentXml("A & B <C>", "Prezzo < 100 & \"sconto\"");
  assert.doesNotMatch(xml, /A & B/); assert.match(xml, /A &amp; B &lt;C&gt;/);
});

test("nome file pulito", () => {
  assert.equal(fileName("Lettera al Dott. Rossi (figli)"), "Lettera-al-Dott-Rossi-figli.docx");
  assert.equal(fileName("Perché è così?"), "Perche-e-cosi.docx");
  assert.equal(fileName(""), "bozza.docx");
});
