// Controlli statici sull'app: ogni strumento dichiarato ha un gestore, la cache offline elenca file che esistono,
// e ogni modulo importato è nella cache (così l'app funziona davvero senza rete dopo la prima apertura).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { TOOL_DEFS } from "../tools.js";

const WEB = join(dirname(fileURLToPath(import.meta.url)), "..");
const app = readFileSync(join(WEB, "app.js"), "utf8"), sw = readFileSync(join(WEB, "sw.js"), "utf8");

test("ogni strumento dichiarato ha un gestore ed un'etichetta", () => {
  for (const { name } of TOOL_DEFS) {
    assert.match(app, new RegExp(`async ${name}\\(`), `gestore di ${name}`);
    assert.match(app, new RegExp(`\\b${name}: "`), `etichetta di ${name}`);
  }
});

test("la cache offline contiene file esistenti e tutti i moduli", () => {
  const shell = [...sw.matchAll(/"\.\/([^"]*)"/g)].map((m) => m[1]).filter(Boolean);
  for (const f of shell) assert.ok(existsSync(join(WEB, f)), `manca ${f}`);
  const modules = readdirSync(WEB).filter((f) => f.endsWith(".js") && f !== "sw.js");
  for (const m of modules) assert.ok(shell.includes(m), `${m} non è nella cache offline`);
  for (const m of app.matchAll(/from "\.\/([^"]+)"/g)) assert.ok(shell.includes(m[1]), `${m[1]} importato ma non in cache`);
});
