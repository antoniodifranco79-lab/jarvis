// Strumenti di J.A.R.V.I.S.: definizioni condivise dal cervello Claude (API) e dal modello locale nel browser.
// L'esecuzione sta in app.js; qui solo nomi, descrizioni, schemi e la validazione degli input.
const str = { type: "string" }, num = { type: "number" };
export const TOOL_DEFS = [
  { name: "search_documents", description: "Cerca nei documenti che l'utente ha caricato in J.A.R.V.I.S. (PDF, Word, testi, email) e restituisce i passaggi più pertinenti, numerati, con file e pagina. Usalo ogni volta che la domanda riguarda un contratto, un bilancio, una lettera, una circolare o qualunque documento dell'utente, anche se non lo nomina esplicitamente. Cita i passaggi nella risposta come [1], [2].",
    input_schema: { type: "object", properties: { query: { ...str, description: "Cosa cercare, con le parole dell'utente (es. \"preavviso per il recesso\")." }, file: { ...str, description: "Parte del nome del file per limitare la ricerca a un documento. Facoltativo." } }, required: ["query"] } },
  { name: "read_document", description: "Restituisce il testo completo di un documento caricato (fino a circa 60.000 caratteri), con i numeri di pagina. Usalo per riassunti, confronti o analisi dell'intero documento.",
    input_schema: { type: "object", properties: { file: { ...str, description: "Nome o parte del nome del file." } }, required: ["file"] } },
  { name: "list_documents", description: "Elenca i documenti caricati dall'utente.", input_schema: { type: "object", properties: {} } },
  { name: "calcola_iva", description: "Calcolo esatto dell'IVA italiana: aggiunge l'IVA a un imponibile oppure la scorpora da un importo IVA inclusa. Usalo invece di calcolare a mente.",
    input_schema: { type: "object", properties: { importo: num, aliquota: { type: "number", enum: [4, 5, 10, 22] }, modo: { type: "string", enum: ["aggiungi", "scorpora"] } }, required: ["importo", "aliquota", "modo"] } },
  { name: "calcola_fattura_professionista", description: "Calcolo esatto della fattura di un professionista italiano: cassa previdenziale (o rivalsa INPS), IVA, ritenuta d'acconto, totale e netto; oppure regime forfettario con marca da bollo.",
    input_schema: { type: "object", properties: { compenso: num, cassa_percentuale: { ...num, description: "Default 4." }, iva_percentuale: { ...num, description: "Default 22." }, ritenuta_percentuale: { ...num, description: "Default 20; 0 se il cliente non è sostituto d'imposta." }, forfettario: { type: "boolean" } }, required: ["compenso"] } },
  { name: "calcola_scadenza", description: "Data che cade N giorni (di calendario o lavorativi) dopo una data, con festività nazionali italiane, slittamento al primo giorno lavorativo e avviso sulla sospensione feriale di agosto.",
    input_schema: { type: "object", properties: { data_inizio: { ...str, description: "Formato AAAA-MM-GG." }, giorni: { type: "integer" }, lavorativi: { type: "boolean" } }, required: ["data_inizio", "giorni"] } },
  { name: "giorni_tra_date", description: "Giorni di calendario e lavorativi tra due date (festività nazionali italiane escluse).",
    input_schema: { type: "object", properties: { da: { ...str, description: "AAAA-MM-GG" }, a: { ...str, description: "AAAA-MM-GG" } }, required: ["da", "a"] } },
  { name: "verifica_codice", description: "Verifica formale (carattere o cifra di controllo) di un codice fiscale, di una partita IVA o di un IBAN.",
    input_schema: { type: "object", properties: { tipo: { type: "string", enum: ["codice_fiscale", "partita_iva", "iban"] }, valore: str }, required: ["tipo", "valore"] } },
  { name: "calcola", description: "Calcolatrice per espressioni aritmetiche (+ - * / ^, parentesi, percentuali). Usala per ogni conto non banale.",
    input_schema: { type: "object", properties: { espressione: str }, required: ["espressione"] } },
  { name: "meteo", description: "Meteo attuale e previsione per oggi e domani in una località.",
    input_schema: { type: "object", properties: { luogo: str }, required: ["luogo"] } },
  { name: "imposta_promemoria", description: "Imposta un promemoria o un timer su questo dispositivo. Indica minuti_da_ora oppure data_ora (AAAA-MM-GGTHH:MM, ora locale).",
    input_schema: { type: "object", properties: { messaggio: str, minuti_da_ora: num, data_ora: str }, required: ["messaggio"] } },
  { name: "impara", description: "Salva una voce nella base di conoscenza di J.A.R.V.I.S., che resta per le conversazioni future. Usalo ogni volta che apprendi qualcosa di utile e duraturo: dal web, da una pagina letta, da un documento, o da ciò che l'utente ti insegna (procedure dello studio, clienti, norme, decisioni). Un titolo breve e univoco; contenuto sintetico ma autosufficiente, con date e numeri esatti; la fonte (URL o nome del documento). Con lo stesso titolo aggiorni la voce esistente.",
    input_schema: { type: "object", properties: { titolo: str, contenuto: str, fonte: str }, required: ["titolo", "contenuto"] } },
  { name: "cerca_conoscenza", description: "Cerca nella base di conoscenza di J.A.R.V.I.S. ciò che hai già imparato in passato. Usalo prima di cercare sul web quando la domanda riguarda un tema che potresti aver già studiato o che l'utente ti ha insegnato.",
    input_schema: { type: "object", properties: { query: str }, required: ["query"] } },
  { name: "dimentica", description: "Elimina una voce dalla base di conoscenza, quando l'utente lo chiede o quando è superata.",
    input_schema: { type: "object", properties: { titolo: str }, required: ["titolo"] } },
  { name: "ricorda", description: "Salva un fatto da ricordare sull'utente (preferenze, nomi, procedure dello studio). Usalo quando l'utente dice qualcosa che vale la pena ricordare.",
    input_schema: { type: "object", properties: { fatto: str }, required: ["fatto"] } },
  { name: "crea_bozza", description: "Prepara una bozza scaricabile in Word (.docx): lettere, email, comunicazioni ai clienti, verbali, relazioni. Usalo quando l'utente chiede di scrivere, redigere o preparare un testo da usare. Il testo può usare righe che iniziano con \"# \" per i titoli, \"- \" per gli elenchi e **grassetto**.",
    input_schema: { type: "object", properties: { titolo: { ...str, description: "Titolo del documento, es. \"Lettera di recesso - Rossi\"." }, testo: { ...str, description: "Testo completo della bozza." } }, required: ["titolo", "testo"] } },
  { name: "cerca_wikipedia", description: "Cerca su Wikipedia (italiana, o inglese con lingua \"en\") e restituisce i titoli delle voci più pertinenti con un estratto. Usalo per studiare un argomento o verificare un fatto enciclopedico.",
    input_schema: { type: "object", properties: { query: str, lingua: { type: "string", enum: ["it", "en"] } }, required: ["query"] } },
  { name: "leggi_wikipedia", description: "Legge il testo di una voce di Wikipedia (fino a circa 12.000 caratteri). Usalo dopo cerca_wikipedia per studiare un argomento, poi salva i punti chiave con impara.",
    input_schema: { type: "object", properties: { titolo: str, lingua: { type: "string", enum: ["it", "en"] } }, required: ["titolo"] } },
  { name: "calcolo_professionale", description: "Calcoli da studio descritti a parole, con risultato esatto: interessi legali o a tasso dato tra due date, rata e piano di un mutuo, importo in lettere per assegni, decodifica del codice fiscale (data e luogo di nascita), regime forfettario, prestazione occasionale, compenso da fatturare per un netto voluto, split payment, margine e ricarico, sconti anche in cascata, variazioni percentuali, ore lavorate, giorno della settimana, giorni mancanti a una data, età.",
    input_schema: { type: "object", properties: { richiesta: { ...str, description: "La richiesta completa con i numeri, es. \"interessi legali su 10000 euro dal 1/1/2024 al 31/12/2025\", \"rata mutuo 150000 euro al 3,2% per 25 anni\", \"1250,50 in lettere\", \"forfettario con ricavi 40000\"." } }, required: ["richiesta"] } },
  { name: "scadenze_fiscali", description: "Scadenze fiscali ordinarie italiane (F24 del 16, IVA, imposte sui redditi, IMU, dichiarazioni) nei prossimi giorni, già spostate al primo giorno lavorativo.",
    input_schema: { type: "object", properties: { giorni: { type: "integer", description: "Quanti giorni guardare avanti (default 45)." } } } },
  { name: "analizza_documento", description: "Analisi esatta di un documento caricato, senza riassumere: date e scadenze, importi, dati identificativi (codici fiscali, partite IVA, IBAN, email, PEC, telefoni), clausole chiave (durata, rinnovo, recesso, penali, foro...), statistiche e leggibilità, con le pagine.",
    input_schema: { type: "object", properties: { file: str, cosa: { type: "string", enum: ["tutto", "scadenze", "importi", "dati", "clausole", "statistiche"] } }, required: ["file"] } },
  { name: "confronta_documenti", description: "Confronta due documenti caricati (per esempio due versioni di un contratto) e restituisce le frasi modificate, aggiunte e tolte.",
    input_schema: { type: "object", properties: { file_a: str, file_b: str }, required: ["file_a", "file_b"] } },
  { name: "anonimizza_documento", description: "Crea una copia anonimizzata (GDPR) di un documento caricato, con codici fiscali, partite IVA, IBAN, email, telefoni, date di nascita e nomi sostituiti da segnaposto, scaricabile in Word.",
    input_schema: { type: "object", properties: { file: str, nomi: { ...str, description: "Altri nomi da oscurare, separati da virgole. Facoltativo." } }, required: ["file"] } },
  { name: "usa_modello", description: "Compila un modello di documento da studio e lo rende scaricabile in Word. Modelli: sollecito, diffida, disdetta, incarico, preventivo, convocazione, verbale, documenti-730, avviso-scadenza, privacy, benvenuto, delega, quietanza, policy-ai. Passa in campi i dati che conosci (es. destinatario, importo, fattura, scadenza, cliente, oggetto, voci, data).",
    input_schema: { type: "object", properties: { modello: { type: "string", enum: ["sollecito", "diffida", "disdetta", "incarico", "preventivo", "convocazione", "verbale", "documenti-730", "avviso-scadenza", "privacy", "benvenuto", "delega", "quietanza", "policy-ai"] }, campi: { type: "object", description: "Coppie nome campo: valore." } }, required: ["modello"] } },
  { name: "elenca_promemoria", description: "Elenca i promemoria attivi, con data e ora.", input_schema: { type: "object", properties: {} } },
  { name: "cancella_promemoria", description: "Cancella i promemoria il cui testo contiene le parole indicate.",
    input_schema: { type: "object", properties: { testo: str }, required: ["testo"] } },
  { name: "converti_valuta", description: "Converte un importo tra valute con il cambio di riferimento della Banca Centrale Europea (serve internet).",
    input_schema: { type: "object", properties: { importo: num, da: { ...str, description: "Codice ISO, es. USD" }, a: { ...str, description: "Codice ISO, es. EUR" } }, required: ["importo", "da", "a"] } },
];
/** Strumenti per i modelli locali più piccoli (contesto corto): i più utili, per non riempire il prompt. */
export const CORE_TOOLS = ["search_documents", "read_document", "calcola_iva", "calcola_fattura_professionista", "calcola_scadenza", "calcolo_professionale", "scadenze_fiscali", "analizza_documento", "usa_modello", "crea_bozza", "imposta_promemoria", "impara", "cerca_conoscenza", "meteo", "cerca_wikipedia", "leggi_wikipedia"];

/** Valida l'input di uno strumento contro il suo schema (tipi, obbligatori, enum). Restituisce un errore o null. */
export function validateInput(name, input) {
  const def = TOOL_DEFS.find((t) => t.name === name); if (!def) return `strumento sconosciuto: ${name}`;
  if (!input || typeof input !== "object" || Array.isArray(input)) return "input non è un oggetto";
  const { properties = {}, required = [] } = def.input_schema;
  for (const r of required) if (input[r] === undefined || input[r] === null || input[r] === "") return `manca "${r}"`;
  for (const [k, v] of Object.entries(input)) {
    const p = properties[k]; if (!p) return `campo non previsto "${k}"`;
    const ok = p.type === "integer" ? Number.isInteger(v) : p.type === "number" ? typeof v === "number" && Number.isFinite(v) : typeof v === p.type;
    if (!ok) return `"${k}" deve essere ${p.type}`;
    if (p.enum && !p.enum.includes(v)) return `"${k}" deve essere uno tra ${p.enum.join(", ")}`;
  }
  return null;
}
