import test from "node:test";
import assert from "node:assert/strict";
import { speechText, guessLang, chunks, rankVoices, scoreVoice } from "../voice.js";

test("speechText legge come una persona", () => {
  const t = speechText("**Scadenza** il 16/12/2026 alle 09:30: versare 1.250,50 € (fonte [1]) all'art. 5. Vedi https://example.com");
  assert.match(t, /16 dicembre 2026/); assert.match(t, /9 e 30/); assert.match(t, /1250 euro e 50 centesimi/); assert.match(t, /articolo 5/); assert.match(t, /il link/);
  assert.doesNotMatch(t, /[*[\]]|https/);
  assert.match(speechText("IVA al 22%"), /22 per cento/);
  assert.equal(speechText("J.A.R.V.I.S. pronto."), "Jarvis pronto.");
});
test("guessLang", () => { assert.equal(guessLang("Good morning sir, what is the weather"), "en-GB"); assert.equal(guessLang("Buongiorno signore, che tempo fa"), "it-IT"); });
test("chunks non spezza a singhiozzo e non supera il massimo", () => {
  const c = chunks("Sì. Certo. " + "Questa è una frase molto lunga, con molte virgole, che va spezzata in modo naturale, senza tagliare le parole a metà, ".repeat(4) + "fine.");
  assert.ok(c[0].length > 10, "frasi brevissime unite"); for (const x of c) assert.ok(x.length <= 240, x.length);
});
test("le voci neurali vincono, quelle giocattolo sono escluse", () => {
  const voices = [{ name: "Albert", lang: "it-IT" }, { name: "Google italiano", lang: "it-IT" }, { name: "Microsoft Diego Online (Natural) - Italian (Italy)", lang: "it-IT" }, { name: "Alice", lang: "it-IT", localService: true }, { name: "Daniel", lang: "en-GB" }];
  const r = rankVoices(voices, "it-IT", "male"); assert.equal(r[0].name, "Microsoft Diego Online (Natural) - Italian (Italy)"); assert.ok(!r.some((v) => v.name === "Albert"));
  assert.ok(scoreVoice({ name: "Daniel", lang: "en-GB" }, "it-IT") < 0);
});
