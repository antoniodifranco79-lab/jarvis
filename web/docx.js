// Bozze in Word (.docx) senza librerie e senza rete: un archivio ZIP "stored" con il minimo di WordprocessingML.
// Righe che iniziano con "#" diventano titoli, "- " o "• " elenchi puntati, "**testo**" grassetto.

const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
export function crc32(bytes) { let c = 0xffffffff; for (let i = 0; i < bytes.length; i++) c = CRC[(c ^ bytes[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }

/** Archivio ZIP senza compressione: [{name, data: Uint8Array|string}] → Uint8Array. */
export function zip(files) {
  const enc = new TextEncoder(), chunks = [], central = []; let offset = 0;
  const u16 = (v) => [v & 0xff, (v >>> 8) & 0xff], u32 = (v) => [v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff];
  for (const f of files) {
    const name = enc.encode(f.name), data = typeof f.data === "string" ? enc.encode(f.data) : f.data, crc = crc32(data);
    const local = new Uint8Array([...u32(0x04034b50), ...u16(20), ...u16(0x0800), ...u16(0), ...u16(0), ...u16(0x21), ...u32(crc), ...u32(data.length), ...u32(data.length), ...u16(name.length), ...u16(0)]);
    chunks.push(local, name, data);
    central.push(new Uint8Array([...u32(0x02014b50), ...u16(20), ...u16(20), ...u16(0x0800), ...u16(0), ...u16(0), ...u16(0x21), ...u32(crc), ...u32(data.length), ...u32(data.length), ...u16(name.length), ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u32(0), ...u32(offset)]), name);
    offset += local.length + name.length + data.length;
  }
  const cdSize = central.reduce((a, c) => a + c.length, 0);
  const end = new Uint8Array([...u32(0x06054b50), ...u16(0), ...u16(0), ...u16(files.length), ...u16(files.length), ...u32(cdSize), ...u32(offset), ...u16(0)]);
  const all = [...chunks, ...central, end], out = new Uint8Array(all.reduce((a, c) => a + c.length, 0)); let p = 0;
  for (const c of all) { out.set(c, p); p += c.length; }
  return out;
}

const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const run = (text, { bold = false, size = 0 } = {}) => `<w:r><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/>${bold ? "<w:b/>" : ""}${size ? `<w:sz w:val="${size}"/>` : ""}</w:rPr><w:t xml:space="preserve">${esc(text)}</w:t></w:r>`;
const runs = (line, opts = {}) => line.split(/(\*\*[^*]+\*\*)/g).filter(Boolean).map((part) => (/^\*\*.*\*\*$/.test(part) ? run(part.slice(2, -2), { ...opts, bold: true }) : run(part, opts))).join("");
const para = (inner, { after = 120, indent = 0 } = {}) => `<w:p><w:pPr><w:spacing w:after="${after}"/>${indent ? `<w:ind w:left="${indent}" w:hanging="240"/>` : ""}</w:pPr>${inner}</w:p>`;

/** Il documento: titolo, data e corpo, con titoli, elenchi e grassetti. */
export function documentXml(title, body, dateLine = "") {
  const lines = String(body || "").replace(/\r/g, "").split("\n");
  const ps = [para(run(title, { bold: true, size: 32 }), { after: 80 })];
  if (dateLine) ps.push(para(run(dateLine, { size: 18 }), { after: 240 }));
  for (const raw of lines) {
    const line = raw.trimEnd();
    if (!line.trim()) { ps.push(para("", { after: 60 })); continue; }
    const h = /^(#{1,3})\s+(.*)$/.exec(line), b = /^\s*(?:[-*•]|\d+[.)])\s+(.*)$/.exec(line);
    if (h) ps.push(para(runs(h[2], { bold: true, size: h[1].length === 1 ? 28 : 24 }), { after: 100 }));
    else if (b) ps.push(para(run("• ") + runs(b[1]), { indent: 360 }));
    else ps.push(para(runs(line)));
  }
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${ps.join("")}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1417" w:right="1134" w:bottom="1134" w:left="1134" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr></w:body></w:document>`;
}

export function docxBytes(title, body, dateLine = "") {
  return zip([
    { name: "[Content_Types].xml", data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>' },
    { name: "_rels/.rels", data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>' },
    { name: "word/document.xml", data: documentXml(title, body, dateLine) },
  ]);
}
export const docxBlob = (title, body, dateLine = "") => new Blob([docxBytes(title, body, dateLine)], { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });
export const fileName = (title) => (String(title || "bozza").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^\w\- ]+/g, "").trim().replace(/\s+/g, "-").slice(0, 60) || "bozza") + ".docx";
