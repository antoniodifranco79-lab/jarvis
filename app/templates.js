// Modelli di documento da studio, compilabili anche senza modello linguistico: si riempiono i campi e si scarica il Word.
// Il testo usa "# " per i titoli e "- " per gli elenchi (come docx.js). I campi vuoti restano tra parentesi quadre.
// Sono bozze: vanno rilette e adattate al caso concreto prima dell'invio.
import { numeroInLettere } from "./calc.js";
import { num } from "./studio.js";

const MESI = ["gennaio", "febbraio", "marzo", "aprile", "maggio", "giugno", "luglio", "agosto", "settembre", "ottobre", "novembre", "dicembre"];
const oggi = (d = new Date()) => `${d.getDate()} ${MESI[d.getMonth()]} ${d.getFullYear()}`;
const eur = (n) => n.toLocaleString("it-IT", { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: "always" }) + " €";
const v = (f, k, ph) => (f[k] && String(f[k]).trim()) || `[${ph || k}]`;
const money = (f, k) => { const n = num(f[k]); return Number.isFinite(n) && n > 0 ? eur(n) : `[${k}]`; };
const lines = (s) => String(s || "").split(/\n|;/).map((x) => x.trim()).filter(Boolean);
const firma = (ctx) => `${ctx.city ? ctx.city + ", " : ""}${oggi(ctx.today)}\n\n${ctx.studio || ctx.name || "[Studio]"}\n${ctx.signer || ""}`.trim();

export const TEMPLATES = [
  { id: "sollecito", title: "Sollecito di pagamento", keys: /sollecit|pagamento non|non ha pagato|fattura scaduta|insolut/,
    fields: [["destinatario", "Destinatario"], ["fattura", "Fattura (numero e data)"], ["importo", "Importo"], ["scadenza", "Scadenza originaria"], ["giorni", "Giorni per pagare", "15"], ["iban", "IBAN"]],
    build: (f, ctx) => ({ title: `Sollecito di pagamento - ${v(f, "destinatario")}`, body: `Spett.le ${v(f, "destinatario")}

# Oggetto: sollecito di pagamento fattura ${v(f, "fattura")}

Gentili Signori,

da un controllo contabile risulta ancora non saldata la fattura ${v(f, "fattura")}, di importo pari a ${money(f, "importo")}, scaduta il ${v(f, "scadenza")}.

Vi preghiamo di provvedere al pagamento entro ${v(f, "giorni", "15")} giorni dal ricevimento della presente, con bonifico sull'IBAN ${v(f, "iban")}, indicando nella causale il numero della fattura.

Se il pagamento fosse già stato effettuato, vi preghiamo di considerare nulla la presente e di inviarci copia della contabile.

Restando a disposizione per qualsiasi chiarimento, porgiamo cordiali saluti.

${firma(ctx)}` }) },
  { id: "diffida", title: "Diffida ad adempiere e messa in mora", keys: /diffid|messa in mora|mettere in mora|ultimo avviso/,
    fields: [["destinatario", "Destinatario"], ["indirizzo", "Indirizzo o PEC"], ["obbligazione", "Cosa è dovuto (es. pagamento delle fatture n. 12 e 15)"], ["importo", "Importo"], ["contratto", "Contratto o titolo"], ["giorni", "Termine in giorni (minimo 15)", "15"]],
    build: (f, ctx) => ({ title: `Diffida ad adempiere - ${v(f, "destinatario")}`, body: `Spett.le ${v(f, "destinatario")}
${v(f, "indirizzo")}

Raccomandata A/R o PEC

# Oggetto: diffida ad adempiere ai sensi dell'art. 1454 c.c. e costituzione in mora ai sensi dell'art. 1219 c.c.

Con la presente, in relazione a ${v(f, "contratto")}, vi diffidiamo ad adempiere alla seguente obbligazione: ${v(f, "obbligazione")}, per un importo complessivo di ${money(f, "importo")}.

Vi assegniamo a tal fine il termine di ${Math.max(15, +f.giorni || 15)} giorni dal ricevimento della presente, con l'avvertenza che, decorso inutilmente tale termine, il contratto si intenderà risolto di diritto ai sensi dell'art. 1454 c.c., fatto salvo il risarcimento del danno.

La presente vale anche quale atto di costituzione in mora ai sensi dell'art. 1219 c.c., con ogni conseguenza di legge, anche in ordine agli interessi.

Distinti saluti.

${firma(ctx)}` }) },
  { id: "disdetta", title: "Disdetta o recesso da un contratto", keys: /disdett|recesso|recedere|disdire|annullare (?:il )?contratto/,
    fields: [["destinatario", "Destinatario (fornitore)"], ["contratto", "Contratto (tipo, numero o data)"], ["intestatario", "Intestatario del contratto"], ["decorrenza", "Data di efficacia"], ["preavviso", "Preavviso previsto", "rispettando il preavviso contrattuale"]],
    build: (f, ctx) => ({ title: `Disdetta - ${v(f, "contratto")}`, body: `Spett.le ${v(f, "destinatario")}

Raccomandata A/R o PEC

# Oggetto: disdetta del contratto ${v(f, "contratto")}

Il/La sottoscritto/a ${v(f, "intestatario")}, intestatario/a del contratto in oggetto, comunica con la presente la propria volontà di recedere dallo stesso, ${v(f, "preavviso")}, con efficacia dal ${v(f, "decorrenza")}.

Si chiede di confermare per iscritto la ricezione della presente e la data di cessazione, di non emettere ulteriori addebiti successivi a tale data e di restituire eventuali somme versate in anticipo e non dovute.

Distinti saluti.

${firma(ctx)}` }) },
  { id: "incarico", title: "Lettera d'incarico professionale", keys: /lettera d.incarico|conferimento (?:di )?incarico|mandato professionale|incarico professionale/,
    fields: [["cliente", "Cliente"], ["oggetto", "Oggetto dell'incarico"], ["compenso", "Compenso"], ["pagamento", "Modalità di pagamento", "50% alla sottoscrizione, saldo a conclusione dell'incarico"], ["durata", "Durata", "fino alla conclusione dell'attività"]],
    build: (f, ctx) => ({ title: `Lettera d'incarico - ${v(f, "cliente")}`, body: `# Lettera di conferimento d'incarico professionale

Tra ${ctx.studio || "[Studio]"} (di seguito "il Professionista") e ${v(f, "cliente")} (di seguito "il Cliente") si conviene quanto segue.

# 1. Oggetto
Il Cliente conferisce al Professionista l'incarico di: ${v(f, "oggetto")}.

# 2. Durata
L'incarico ha durata ${v(f, "durata")}.

# 3. Compenso
Il compenso è determinato in ${money(f, "compenso")}, oltre a contributi previdenziali e IVA nella misura di legge e alle spese documentate. Pagamento: ${v(f, "pagamento")}.

# 4. Obblighi delle parti
- Il Professionista svolge l'incarico con la diligenza richiesta dalla natura dell'attività e informa il Cliente sullo stato della pratica.
- Il Cliente fornisce in tempo utile documenti e informazioni complete e veritiere.

# 5. Recesso
Ciascuna parte può recedere con comunicazione scritta; al Professionista spetta il compenso per l'attività svolta fino al recesso.

# 6. Dati personali e antiriciclaggio
I dati sono trattati secondo il Regolamento (UE) 2016/679 come da informativa consegnata. Ove applicabile, il Cliente fornisce le informazioni richieste dal D.Lgs. 231/2007.

Letto, confermato e sottoscritto.

${firma(ctx)}

Il Cliente ______________________` }) },
  { id: "preventivo", title: "Preventivo", keys: /preventiv|offerta economica|quotazione/,
    fields: [["cliente", "Cliente"], ["voci", "Voci (una per riga: descrizione; importo)"], ["iva", "Aliquota IVA %", "22"], ["validita", "Validità in giorni", "30"], ["note", "Note e condizioni", "Pagamento a 30 giorni data fattura."]],
    build: (f, ctx) => {
      const rows = String(f.voci || "").split("\n").map((r) => { const m = /^(.*?)[;:\t]\s*(?:€\s*)?([\d.,]+)\s*(?:€|euro)?\s*$/.exec(r.trim()); return m ? { d: m[1].trim(), a: num(m[2]) } : r.trim() ? { d: r.trim(), a: NaN } : null; }).filter(Boolean);
      const imp = rows.reduce((s, r) => s + (Number.isFinite(r.a) ? r.a : 0), 0), rate = num(f.iva || "22"), iva = Math.round(imp * rate) / 100;
      const list = rows.length ? rows.map((r) => `- ${r.d}${Number.isFinite(r.a) ? ": " + eur(r.a) : ""}`).join("\n") : "- [descrizione]: [importo]";
      return { title: `Preventivo - ${v(f, "cliente")}`, body: `Spett.le ${v(f, "cliente")}

# Preventivo

${list}

**Imponibile: ${imp ? eur(imp) : "[imponibile]"}**
IVA ${Number.isFinite(rate) ? rate : 22}%: ${imp ? eur(iva) : "[IVA]"}
**Totale: ${imp ? eur(imp + iva) : "[totale]"}**

Validità dell'offerta: ${v(f, "validita", "30")} giorni dalla data odierna.
${v(f, "note")}

Per accettazione, restituire il presente firmato.

${firma(ctx)}

Per accettazione ______________________` };
    } },
  { id: "convocazione", title: "Convocazione di assemblea", keys: /convocazion|convocare (?:l.)?assemblea|assemblea (?:dei soci|condominiale|ordinaria|straordinaria)/,
    fields: [["ente", "Società, associazione o condominio"], ["tipo", "Tipo di assemblea", "ordinaria"], ["data", "Data"], ["ora", "Ora"], ["luogo", "Luogo"], ["odg", "Ordine del giorno (un punto per riga)"], ["seconda", "Seconda convocazione (data e ora)"]],
    build: (f, ctx) => ({ title: `Convocazione assemblea ${v(f, "tipo", "ordinaria")} - ${v(f, "ente")}`, body: `# ${v(f, "ente")}
# Avviso di convocazione dell'assemblea ${v(f, "tipo", "ordinaria")}

I signori aventi diritto sono convocati in assemblea ${v(f, "tipo", "ordinaria")} presso ${v(f, "luogo")}, il giorno ${v(f, "data")} alle ore ${v(f, "ora")} in prima convocazione${f.seconda ? ` e, occorrendo, il giorno ${f.seconda} in seconda convocazione` : ""}, per discutere e deliberare sul seguente

# Ordine del giorno
${(lines(f.odg).length ? lines(f.odg) : ["[punto 1]", "[punto 2]", "Varie ed eventuali"]).map((x, i) => `${i + 1}) ${x}`).join("\n")}

Ciascun avente diritto può farsi rappresentare mediante delega scritta.

${firma(ctx)}` }) },
  { id: "verbale", title: "Verbale di riunione", keys: /verbale|resoconto della riunione|minute/,
    fields: [["riunione", "Riunione (es. riunione di studio)"], ["data", "Data e ora"], ["presenti", "Presenti"], ["odg", "Argomenti (uno per riga)"], ["decisioni", "Decisioni (una per riga)"], ["azioni", "Azioni: chi fa cosa entro quando (una per riga)"]],
    build: (f, ctx) => ({ title: `Verbale - ${v(f, "riunione")} ${f.data || ""}`.trim(), body: `# Verbale: ${v(f, "riunione")}

Data: ${f.data || oggi(ctx.today)}
Presenti: ${v(f, "presenti")}

# Argomenti trattati
${(lines(f.odg).length ? lines(f.odg) : ["[argomento]"]).map((x) => "- " + x).join("\n")}

# Decisioni
${(lines(f.decisioni).length ? lines(f.decisioni) : ["[decisione]"]).map((x) => "- " + x).join("\n")}

# Azioni
${(lines(f.azioni).length ? lines(f.azioni) : ["[chi] - [cosa] - entro il [data]"]).map((x) => "- " + x).join("\n")}

Il verbale è approvato dai presenti.

${firma(ctx)}` }) },
  { id: "documenti-730", title: "Richiesta documenti per la dichiarazione dei redditi", keys: /documenti per (?:il )?(?:730|dichiarazione|redditi)|richiesta documenti|cosa (?:mi )?serve per il 730/,
    fields: [["cliente", "Cliente"], ["anno", "Anno d'imposta", String(new Date().getFullYear() - 1)], ["entro", "Consegna entro il"]],
    build: (f, ctx) => ({ title: `Documenti dichiarazione ${v(f, "anno")} - ${v(f, "cliente")}`, body: `Gentile ${v(f, "cliente")},

per preparare la dichiarazione dei redditi relativa all'anno ${v(f, "anno")} le chiediamo di consegnarci entro il ${v(f, "entro")} i seguenti documenti, se pertinenti:

# Redditi
- Certificazione Unica (CU) di lavoro dipendente, pensione o altri redditi
- Contratti di locazione e canoni percepiti, visure catastali di immobili nuovi o variati
- Altri redditi: prestazioni occasionali, redditi esteri, dividendi

# Spese detraibili e deducibili
- Spese sanitarie non presenti nel precompilato (scontrini parlanti, fatture, ticket)
- Interessi passivi del mutuo per l'abitazione principale, con contratto di mutuo e atto d'acquisto
- Spese di istruzione, università, asilo nido, attività sportive dei figli
- Lavori di ristrutturazione, risparmio energetico e bonus edilizi: fatture e bonifici
- Premi di assicurazione vita e infortuni, contributi a fondi pensione complementari
- Erogazioni liberali, spese veterinarie, spese funebri, canoni di locazione per studenti fuori sede

# Altro
- Documento d'identità e codice fiscale, eventuali variazioni di residenza o familiari a carico
- Dichiarazione dell'anno precedente, se non predisposta da noi, e deleghe F24 versate

Restiamo a disposizione per ogni chiarimento.

${firma(ctx)}` }) },
  { id: "avviso-scadenza", title: "Avviso di scadenza al cliente", keys: /avvis\w* (?:di )?scadenz|ricordare (?:al cliente )?(?:la )?scadenza|comunicazione (?:di )?scadenza/,
    fields: [["cliente", "Cliente"], ["adempimento", "Adempimento (es. versamento IMU saldo)"], ["data", "Data di scadenza"], ["importo", "Importo"], ["modalita", "Modalità", "modello F24 allegato"]],
    build: (f, ctx) => ({ title: `Scadenza ${v(f, "adempimento")} - ${v(f, "cliente")}`, body: `Gentile ${v(f, "cliente")},

le ricordiamo che entro il ${v(f, "data")} è in scadenza il seguente adempimento: ${v(f, "adempimento")}${f.importo ? `, per un importo di ${money(f, "importo")}` : ""}.

Modalità di pagamento: ${v(f, "modalita")}.

Se ha già provveduto, la preghiamo di inviarci copia della quietanza; in caso contrario restiamo a disposizione per qualsiasi chiarimento.

${firma(ctx)}` }) },
  { id: "privacy", title: "Informativa privacy per i clienti (art. 13 GDPR)", keys: /informativa (?:sulla )?privacy|informativa gdpr|art\.? 13/,
    fields: [["titolare", "Titolare del trattamento"], ["indirizzo", "Sede"], ["contatto", "Email o PEC per la privacy"], ["finalita", "Finalità", "esecuzione dell'incarico professionale e adempimenti di legge (fiscali, contabili, antiriciclaggio)"], ["conservazione", "Conservazione", "10 anni dalla conclusione dell'incarico, salvo obblighi diversi"]],
    build: (f, ctx) => ({ title: `Informativa privacy - ${v(f, "titolare")}`, body: `# Informativa sul trattamento dei dati personali
ai sensi dell'art. 13 del Regolamento (UE) 2016/679

# Titolare
${v(f, "titolare")}, ${v(f, "indirizzo")}, contatto: ${v(f, "contatto")}.

# Finalità e base giuridica
I dati sono trattati per ${v(f, "finalita")}. Base giuridica: esecuzione del contratto e adempimento di obblighi di legge (art. 6, par. 1, lett. b e c, GDPR).

# Destinatari
I dati possono essere comunicati ad amministrazioni pubbliche, enti previdenziali, istituti bancari e consulenti esterni nominati responsabili del trattamento, solo per le finalità indicate. Non sono diffusi.

# Conservazione
${v(f, "conservazione")}.

# Diritti dell'interessato
Lei può chiedere l'accesso ai dati, la rettifica, la cancellazione, la limitazione, l'opposizione e la portabilità (artt. 15-22 GDPR) scrivendo a ${v(f, "contatto")}, e ha diritto di proporre reclamo al Garante per la protezione dei dati personali.

# Strumenti di intelligenza artificiale
Lo studio può usare un assistente di intelligenza artificiale installato sui propri computer, senza trasmettere i documenti a servizi esterni, sempre sotto il controllo di un professionista.

Il conferimento dei dati è necessario per svolgere l'incarico.

${firma(ctx)}` }) },
  { id: "benvenuto", title: "Email di benvenuto a un nuovo cliente", keys: /benvenuto|nuovo cliente|onboarding cliente/,
    fields: [["cliente", "Cliente"], ["referente", "Referente in studio"], ["documenti", "Documenti da inviarci (uno per riga)"], ["contatti", "Contatti", ""]],
    build: (f, ctx) => ({ title: `Benvenuto - ${v(f, "cliente")}`, body: `Gentile ${v(f, "cliente")},

grazie per averci scelto. Il suo referente in studio sarà ${v(f, "referente")}, che la seguirà in ogni fase.

Per iniziare ci servono:
${(lines(f.documenti).length ? lines(f.documenti) : ["documento d'identità e codice fiscale", "lettera d'incarico firmata", "informativa privacy firmata"]).map((x) => "- " + x).join("\n")}

Può inviarli rispondendo a questa email. ${f.contatti ? "Per qualsiasi necessità: " + f.contatti + "." : ""}

A presto.

${firma(ctx)}` }) },
  { id: "delega", title: "Delega", keys: /\bdelega\b|delegare|autorizzo .* a ritirare/,
    fields: [["delegante", "Delegante (nome e cognome)"], ["cf_delegante", "Codice fiscale del delegante"], ["delegato", "Delegato (nome e cognome)"], ["cf_delegato", "Codice fiscale del delegato"], ["oggetto", "Oggetto della delega"], ["presso", "Presso (ufficio o ente)"]],
    build: (f, ctx) => ({ title: `Delega - ${v(f, "delegato")}`, body: `# Delega

Il/La sottoscritto/a ${v(f, "delegante")}, codice fiscale ${v(f, "cf_delegante")},

# delega

il/la sig./sig.ra ${v(f, "delegato")}, codice fiscale ${v(f, "cf_delegato")}, a ${v(f, "oggetto")} presso ${v(f, "presso")}, in nome e per conto del/della sottoscritto/a.

Si allegano copia del documento d'identità del delegante e del delegato.

${ctx.city ? ctx.city + ", " : ""}${oggi(ctx.today)}

Il delegante ______________________` }) },
  { id: "quietanza", title: "Ricevuta e quietanza di pagamento", keys: /quietanza|ricevuta di pagamento|ricevuta per/,
    fields: [["pagatore", "Ricevuto da"], ["importo", "Importo"], ["causale", "Causale"], ["modalita", "Modalità di pagamento", "bonifico bancario"]],
    build: (f, ctx) => { const n = num(f.importo); const lett = Number.isFinite(n) && n > 0 ? ` (${numeroInLettere(n).cheque})` : ""; return { title: `Quietanza - ${v(f, "pagatore")}`, body: `# Ricevuta e quietanza di pagamento

${ctx.studio || "[Studio]"} dichiara di aver ricevuto da ${v(f, "pagatore")} la somma di ${money(f, "importo")}${lett} a titolo di ${v(f, "causale")}, mediante ${v(f, "modalita")}, e ne rilascia ampia e liberatoria quietanza.

${firma(ctx)}` }; } },
  { id: "policy-ai", title: "Policy d'uso dell'intelligenza artificiale (AI Act)", keys: /policy (?:ai|ia|d.uso)|regolamento (?:interno )?(?:sull.)?(?:ai|intelligenza artificiale)|ai act/,
    fields: [["studio", "Studio o azienda"], ["responsabile", "Responsabile dell'AI in studio"], ["strumenti", "Strumenti ammessi (uno per riga)", "J.A.R.V.I.S., assistente installato sui computer dello studio"]],
    build: (f, ctx) => ({ title: `Policy AI - ${f.studio || ctx.studio || "Studio"}`, body: `# Policy d'uso dei sistemi di intelligenza artificiale
${f.studio || ctx.studio || "[studio]"} · in vigore dal ${oggi(ctx.today)}

# 1. Scopo
Questa policy stabilisce come il personale usa i sistemi di intelligenza artificiale (AI), per tutelare i dati dei clienti, la qualità del lavoro e rispettare il Regolamento (UE) 2024/1689 (AI Act), in particolare l'obbligo di alfabetizzazione dell'art. 4.

# 2. Strumenti ammessi
${lines(f.strumenti).map((x) => "- " + x).join("\n")}
Altri strumenti si usano solo dopo l'autorizzazione del responsabile: ${v(f, "responsabile")}.

# 3. Regole
- Non inserire dati personali o documenti dei clienti in servizi di AI esterni non autorizzati.
- Ogni testo, calcolo o sintesi prodotto con l'AI è verificato da una persona prima di essere usato o inviato.
- L'AI non prende decisioni sui clienti: supporta il lavoro dei professionisti.
- Le fonti citate dall'AI si controllano sull'originale.
- Errori e risultati anomali si segnalano al responsabile.

# 4. Formazione
Tutto il personale che usa l'AI partecipa alla formazione di alfabetizzazione, con registro presenze e aggiornamento periodico.

# 5. Registro
Il responsabile tiene l'elenco degli strumenti in uso, delle persone formate e delle revisioni di questa policy.

${firma(ctx)}` }) },
];

/** Il modello più adatto alla frase ("prepara un sollecito per Rossi"), o null. */
export function findTemplate(text) {
  const t = String(text || "").toLowerCase();
  return TEMPLATES.find((x) => x.id === t.trim()) || TEMPLATES.find((x) => x.keys.test(t)) || null;
}
/** Compila un modello: campi mancanti tra parentesi quadre. ctx: { studio, signer, city, name, today }. */
export function fillTemplate(id, fields = {}, ctx = {}) {
  const tpl = TEMPLATES.find((x) => x.id === id) || findTemplate(id); if (!tpl) return null;
  const f = { ...Object.fromEntries(tpl.fields.filter((x) => x[2] != null).map((x) => [x[0], x[2]])), ...Object.fromEntries(Object.entries(fields).filter(([, val]) => val != null && String(val).trim() !== "")) };
  const out = tpl.build(f, { today: new Date(), ...ctx });
  const missing = tpl.fields.filter(([k]) => out.body.includes(`[${k}]`)).map(([, label]) => label);
  return { ...out, id: tpl.id, missing };
}
