# J.A.R.V.I.S. — Shorts dai video del canale (design)

Data: 2026-11-17 · Stato: bozza da approvare

## Perché

Antonio ha un canale YouTube e vuole che Jarvis trasformi i suoi video lunghi in Shorts e li
carichi sul canale, senza passare ore in un editor. Si chiede a voce o per iscritto ("Jarvis, fammi
tre Shorts dall'ultimo video") e Jarvis fa il resto, chiedendo conferma solo prima di pubblicare.

## Obiettivi

- Partendo da un video **del proprio canale** (link YouTube oppure file nella cartella di lavoro di Jarvis),
  trovare i momenti migliori e produrre Shorts pronti da pubblicare.
- Ogni Short: verticale 9:16 (1080×1920), 15–60 secondi, sottotitoli impressi nel video, con titolo,
  descrizione e hashtag proposti da Jarvis.
- Caricare gli Shorts approvati sul canale tramite Composio.
- Funzionare dalla voce, dal terminale e dal HUD, come gli altri strumenti di Jarvis.

## Non obiettivi (per ora)

- Ritaglio che segue il volto (reframing intelligente): si parte col taglio centrato.
- Montaggi con più spezzoni uniti, musica, effetti, B-roll.
- Programmazione delle pubblicazioni nel tempo, miniature personalizzate.
- Video di altri canali.

## Anti-obiettivi (fallimento anche se "funziona")

- Pubblicare qualcosa senza che Antonio l'abbia approvato.
- Dire "caricato" quando il caricamento non è andato a buon fine (regola di Jarvis: mai fingere).
- Clip che tagliano le frasi a metà o con sottotitoli fuori sincrono.

## Vincoli

- Jarvis gira sul PC dell'utente (Windows, macOS, Linux; anche Termux). Servono `ffmpeg` e `yt-dlp`:
  diventano un extra opzionale (`pip install jarvis-ai[shorts]`); `jarvis doctor` dice se mancano.
- I file restano in `~/jarvis-workspace/shorts/` (la sandbox esistente).
- Due cervelli: con Claude funziona bene; col modello locale (qwen3, contesto 16k) la scelta dei momenti
  su video lunghi è peggiore. È accettato: si avvisa, non si blocca.
- Composio: il caricamento usa l'SDK Python (`composio`), che invia il file locale a Composio prima
  dell'upload su YouTube. Servono una chiave Composio e il canale YouTube collegato una volta.

## Approcci considerati

- **A. Tutto in Jarvis + caricamento via Composio** — *scelto da Antonio*. Elaborazione in locale,
  caricamento con l'azione `YOUTUBE_MULTIPART_UPLOAD_VIDEO` di Composio. Contro: dipendenza da Composio
  per pubblicare.
- **B. Come A ma con l'API YouTube diretta.** Niente Composio, ma Antonio deve creare un progetto Google
  Cloud e gestire OAuth e quote. Resta possibile in futuro sostituendo solo il pezzo di caricamento.
- **C. Servizio esterno (tipo Opus Clip).** Reframing migliore ma a pagamento, meno controllo, poco Jarvis.

## Come funziona

Tre nuovi strumenti in `jarvis/tools/shorts.py`, registrati come gli altri. La scelta dei momenti la fa
il cervello di Jarvis stesso (lo strumento gli restituisce la trascrizione), così non serve un secondo
client AI e funziona con entrambi i provider.

1. **`prepare_video(source)`** — `source` è un link YouTube o un file nella cartella di lavoro.
   - Scarica con `yt-dlp` (migliore qualità fino a 1080p) in `shorts/<id>/source.mp4`.
   - Trascrizione con i tempi: prima prova i sottotitoli del video (quelli caricati o automatici di
     YouTube, via `yt-dlp`); se mancano, `faster-whisper` (già usato da Jarvis per la voce).
   - Restituisce: id del lavoro, durata, titolo originale e la trascrizione compatta per frasi
     (`[mm:ss–mm:ss] testo`), così Jarvis può scegliere i momenti.
   - Lento (minuti): timeout dedicato lungo; avvisa l'utente prima di partire ("ci vorrà qualche minuto").
2. **Jarvis sceglie i momenti** — nel suo ragionamento normale, con istruzioni nella descrizione dello
   strumento: momenti autosufficienti, con un aggancio nei primi 2 secondi, inizio e fine su confini di frase,
   15–60 s. Di default 3 Shorts, o quanti ne chiede l'utente.
3. **`cut_shorts(job_id, clips)`** — `clips` = lista di `{start, end, title, description, hashtags}`.
   - Per ogni clip, `ffmpeg`: taglio, ritaglio centrato 9:16, scalatura 1080×1920.
   - Sottotitoli: `faster-whisper` con tempi parola per parola sul solo spezzone, poi sottotitoli grandi
     impressi (2–4 parole alla volta, stile Shorts) tramite un file `.ass`.
   - Salva `shorts/<id>/short-01.mp4` … e un `manifest.json` con metadati e stato (`pronto`/`caricato`).
   - Restituisce l'elenco: file, durata, titolo proposto. Jarvis lo legge all'utente.
4. **`upload_short(job_id, number, title?, description?, privacy?)`** — **pericoloso**: passa sempre
   dalla conferma esistente ("procedi?"), in terminale, voce o HUD.
   - Chiama `YOUTUBE_MULTIPART_UPLOAD_VIDEO` via SDK Composio; aggiunge `#Shorts` alla descrizione se manca.
   - Riporta l'id e il link del video caricato e aggiorna il manifest. Se fallisce, lo dice chiaramente.

Configurazione nuova (`.env`):
- `COMPOSIO_API_KEY` — chiave Composio.
- `JARVIS_COMPOSIO_USER_ID` — l'utente Composio a cui è collegato il canale (default `default`).
- `JARVIS_SHORTS_PRIVACY` — visibilità predefinita dei caricamenti.

Collegare il canale: `jarvis shorts link` stampa il link di autorizzazione YouTube di Composio
(una volta sola).

## Scelte prese da Claude (da verificare)

- `upload_short` chiede conferma **sempre**, anche con `JARVIS_AUTO_APPROVE=true`: quell'opzione è pensata
  per i comandi locali, una pubblicazione sul canale no. Serve un piccolo flag nel registro degli strumenti
  (es. `always_confirm=True`).
- Se `yt-dlp` viene bloccato da YouTube, Jarvis lo dice chiaramente e chiede di mettere il file originale
  in `~/jarvis-workspace/shorts/` (che ha anche qualità migliore).
- Lingua dei sottotitoli: rilevata da Whisper; il testo resta quello parlato (niente traduzione).

## Test

- Test offline come quelli esistenti: `ffmpeg`/`yt-dlp`/Composio simulati; si verifica la costruzione dei
  comandi ffmpeg, il file `.ass`, il manifest, la validazione dei tempi (15–60 s, dentro la durata) e che
  l'upload sia marcato pericoloso.
- Un test d'integrazione opzionale (saltato se manca `ffmpeg`) taglia un video sintetico di 90 s.

## Decisioni lasciate a chi costruisce

- Stile esatto dei sottotitoli (font, colore, posizione), purché leggibili e grandi.
- Formato preciso della trascrizione compatta e come accorciarla per il modello locale.
- Struttura interna dei moduli (es. `jarvis/shorts/` con `media.py`, `captions.py`, `uploader.py`).
