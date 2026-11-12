# J.A.R.V.I.S. 2.0: i 100 upgrade

Ogni voce è una funzione che esiste nel codice, coperta da test automatici (`node --test web/tests/*.test.mjs`, `pytest`) e provata nel browser. Dove non diversamente indicato, gira tutto sul dispositivo, anche senza intelligenza artificiale e senza internet.

## Calcoli da studio (`web/calc.js`)

1. **Importi in lettere** per assegni e contratti: "1.250,50" → *milleduecentocinquanta/50* e "milleduecentocinquanta euro e cinquanta centesimi".
2. **Interessi legali anno per anno**, con i tassi dell'art. 1284 c.c. dal 2010 al 2026 e il dettaglio per anno.
3. **Interessi a tasso libero** tra due date ("al 3%").
4. **Rata del mutuo** o del finanziamento, con piano di ammortamento alla francese, totale e interessi.
5. **Decodifica del codice fiscale**: data di nascita, sesso, età, codice del comune o dello Stato estero, anche per i codici omocodici.
6. **Scadenzario fiscale**: F24 del 16, IVA, imposte sui redditi, IMU, dichiarazioni, acconto IVA, con lo slittamento al primo giorno lavorativo.
7. **Regime forfettario**: reddito con coefficiente di redditività, contributi dedotti, imposta al 15% o al 5%, avviso oltre le soglie.
8. **Prestazione occasionale**: ritenuta del 20%, netto, marca da bollo, avviso sulla Gestione separata.
9. **Compenso da fatturare per incassare un netto voluto**, con cassa, IVA e ritenuta.
10. **Split payment** per le fatture alla PA, con l'annotazione da riportare.
11. **Margine e ricarico** da costo e prezzo.
12. **Prezzo di vendita** da un ricarico o da un margine voluto.
13. **Sconti, anche in cascata** ("20% + 10%"), con lo sconto equivalente.
14. **Variazioni percentuali** tra due valori.
15. **Ore lavorate** da più intervalli ("9-13 e 14:30-18"), con l'importo a tariffa oraria.
16. **Che giorno è** una data, con festività e giorni non lavorativi.
17. **Giorni mancanti** a una data (anche Natale, Capodanno, Ferragosto), di calendario e lavorativi.
18. **Età** da una data di nascita, con i giorni al prossimo compleanno.
19. **Cambio valute** con il cambio di riferimento della BCE (serve internet).
20. **Importi sempre leggibili**: separatore delle migliaia anche sotto i 10.000 € ("5.850,00 €").

## Documenti (`web/extract.js`, `web/docs.js`)

21. **Date e scadenze di un documento**, ordinate, con pagina e frase di contesto, distinguendo le scadenze dalle altre date.
22. **Importi** citati nel documento, con pagina e contesto.
23. **Codici fiscali, partite IVA e IBAN** trovati e validati con la cifra di controllo.
24. **Email, PEC e telefoni** del documento.
25. **Clausole chiave** riconosciute: durata, rinnovo, recesso, preavviso, penali, pagamenti, interessi di mora, risoluzione, garanzie, responsabilità, riservatezza, dati personali, foro competente, legge applicabile, cessione, forza maggiore.
26. **Statistiche**: parole, frasi, pagine e tempo di lettura.
27. **Leggibilità con l'indice Gulpease**, tarato sull'italiano, con abbreviazioni come "art." e "S.r.l." gestite correttamente.
28. **"Analizza" un documento**: un unico rapporto con scadenze, importi, dati, clausole e statistiche.
29. **Confronto tra due versioni** di un contratto: frasi modificate, aggiunte e tolte.
30. **Anonimizzazione GDPR**: copia in Word con codici fiscali, partite IVA, IBAN, email, telefoni, date di nascita e nomi sostituiti da segnaposto.
31. **Ricerca di una frase esatta** tra virgolette nei documenti.
32. **Lettura ad alta voce** di un intero documento ("leggimi il contratto Rossi").
33. **Azioni rapide per ogni documento** nel pannello documenti: riassumi, analizza, anonimizza, leggi.
34. **Archivio persistente**: il browser non cancella più i documenti per fare spazio, e avvisa quando la memoria è quasi piena.

## Modelli di documento (`web/templates.js`)

35. Sollecito di pagamento.
36. Diffida ad adempiere e messa in mora (artt. 1454 e 1219 c.c.), con termine minimo di 15 giorni garantito.
37. Disdetta o recesso da un contratto.
38. Lettera d'incarico professionale.
39. Preventivo con imponibile, IVA e totale calcolati.
40. Convocazione di assemblea, con ordine del giorno e seconda convocazione.
41. Verbale di riunione con decisioni e azioni.
42. Richiesta documenti per il 730 o il modello Redditi.
43. Avviso di scadenza al cliente.
44. Informativa privacy per i clienti (art. 13 GDPR).
45. Email di benvenuto a un nuovo cliente.
46. Delega.
47. Ricevuta e quietanza di pagamento, con l'importo anche in lettere.
48. Policy d'uso dell'AI dello studio (AI Act, art. 4).
49. **Finestra "Modelli"** con i campi da compilare, anteprima nel testo e download in Word.
50. **Riconoscimento del modello dalla frase**: senza intelligenza artificiale apre il modello giusto; con il cervello attivo lo compila con i dati della richiesta.

## Promemoria e agenda (`web/when.js`, `web/ics.js`)

51. **Promemoria ricorrenti**: ogni giorno, nei giorni feriali, ogni lunedì, il 16 di ogni mese, ogni anno.
52. **"Quali promemoria ho?"** a voce o per iscritto.
53. **Finestra dei promemoria** con il pulsante per cancellarli.
54. **Cancellazione a voce** ("cancella il promemoria di Rossi", "cancella tutti i promemoria").
55. **Rimanda** con i pulsanti "10 min" e "1 ora" sotto ogni promemoria scattato.
56. **"Rimanda di 10 minuti"** a voce.
57. **Promemoria persi** mentre l'app era chiusa, mostrati alla riapertura con l'ora prevista.
58. **Suono di avviso** oltre a voce e notifica.
59. **Esportazione nel calendario** (.ics) per Google Calendar, Outlook e Apple, con le ricorrenze.
60. **Scadenze fiscali dei prossimi 12 mesi nel calendario**, con avviso tre giorni prima.
61. **Briefing del giorno** a richiesta: data, promemoria di oggi, scadenze fiscali della settimana, archivio.
62. **Briefing automatico** alla prima apertura della giornata, se c'è qualcosa da sapere.

## Interfaccia

63. **Risposte formattate**: elenchi puntati e numerati, grassetti, titoli.
64. **Link cliccabili e citazioni [1] evidenziate**, con HTML sicuro.
65. Pulsante **leggi** per riascoltare una risposta.
66. Pulsante **impara** per salvare una risposta nella base di conoscenza.
67. Pulsante **riprova** per rifare la stessa domanda.
68. **Conversazione esportata in Word**, con fonti e nomi.
69. **Freccia su e giù** per richiamare le domande precedenti.
70. **Scorciatoie**: "/" porta al campo di testo, Esc ferma voce e risposta.
71. **Suggerimenti rapidi** sotto il campo di testo, che cambiano con i documenti caricati.
72. **Dimensione del testo** regolabile.
73. **Indicatore nella scheda del browser** mentre Jarvis risponde.
74. **Statistiche d'uso e tempo risparmiato** ("quanto tempo mi hai fatto risparmiare?").
75. **"Novità"**: Jarvis spiega cosa c'è di nuovo nella sua versione.
76. **Aiuto riscritto** come elenco ordinato per argomento.

## Privacy e dati

77. **PIN di blocco** all'apertura, salvato solo come impronta SHA-256.
78. **Blocca ora**, dal pulsante o dicendo "blocca".
79. **Modalità privata**: la conversazione non viene salvata sul dispositivo.
80. **Backup completo** in un file: impostazioni, memoria, promemoria, conoscenza, cronologia e documenti (senza chiave di Claude e senza PIN).
81. **Ripristino del backup** su un altro computer.
82. **Cancella tutti i dati** di Jarvis dal dispositivo, con conferma.

## Abbonamento e assistenza

83. **Piano, fatturazione e rinnovo** dell'abbonamento nelle impostazioni.
84. **Avviso di rinnovo** 30 giorni prima, con il suggerimento di passare all'annuale.
85. **Assistenza su WhatsApp** con versione, cervello e browser già scritti (mai documenti).
86. **Nome dello studio e firma** in fondo a modelli, lettere e quietanze.

## Voce

87. **"Basta"**, "stop", "silenzio" fermano la voce.
88. **"Ripeti"** rilegge l'ultima risposta.
89. **"Parla più piano" / "più veloce"** regola la velocità della voce.

## Cervello (Claude, Puter e modello locale)

90. Strumento **calcolo_professionale**: tutti i calcoli dei punti 1-18 a disposizione del cervello.
91. Strumento **scadenze_fiscali**.
92. Strumenti **analizza_documento** e **confronta_documenti**.
93. Strumento **anonimizza_documento**.
94. Strumento **usa_modello**: il cervello compila i 14 modelli con i dati della conversazione.
95. Strumenti **elenca_promemoria**, **cancella_promemoria** e **converti_valuta**.
96. **Strumenti scelti in base alla domanda** per i modelli locali: il prompt resta corto e il modello sul dispositivo risponde più in fretta, senza esaurire il contesto.

## App desktop (`jarvis/tools/studio.py`)

97. **Importi in lettere** (`amount_in_words`).
98. **Interessi legali o a tasso dato tra due date** (`legal_interest_between`).
99. **Rata del mutuo** (`loan_instalment`).
100. **Scadenzario fiscale e decodifica del codice fiscale** (`fiscal_calendar`, `decode_tax_code`), con le stesse regole e gli stessi numeri della web app.

---

Test aggiunti in questa versione: quattro nuovi file di test per la web app (calcoli, documenti, modelli, calendario e formattazione) e nuovi casi in quelli esistenti (promemoria ricorrenti, ricerca esatta, ripristino, cancellazione), uno per l'app desktop, più una prova completa nel browser che usa ogni funzione come farebbe un cliente.

## Dopo la 2.0: tutti gli strumenti

- **Server MCP nell'app desktop**: Jarvis usa gli strumenti di qualsiasi server del Model Context Protocol, locale o remoto, configurati in `~/.jarvis/mcp.json`, con conferma per le azioni non di sola lettura.
- **Utilità nella web app**: ora nelle città del mondo, conversioni di unità, distanza tra città, alba e tramonto, qualità dell'aria, dizionario, QR code, password, numeri casuali, festività dell'anno, numero della settimana; disponibili anche ai cervelli con lo strumento `utilita`.
