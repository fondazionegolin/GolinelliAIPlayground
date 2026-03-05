# Load Test Agent (CLI)

Applicazione da terminale per simulare utenti studenti con journey completa:
1. join con codice classe `XYLAS`
2. messaggio in chat pubblica di sessione (verifica presenza utente)
3. apertura `Chatbot AI` e invio domanda: `come faccio a calcolare la radice quadrata di un numero`
4. apertura `ML Lab`
5. selezione modalità `Dati`
6. upload CSV `dataset_1772097045952.csv`
7. avvio training modello

Include monitor live colorato con:
- tempi risposta medi e p95 per ogni step
- funzionalità attivate (join/chat/upload/training)
- timeline journey utenti
- latency API osservate dal browser

Modalita journey:
- `api` (default): usa endpoint backend direttamente, piu stabile e scalabile su produzione.
- `ui`: usa Playwright per click UI end-to-end.

## Setup

```bash
cd /home/ale/GIT/GolinelliAIPlayground
python3 -m venv .venv-loadtest
source .venv-loadtest/bin/activate
pip install -r loadtest/requirements.txt
python -m playwright install chromium
```

## Configurazione

```bash
cp loadtest/config.example.yaml loadtest/config.yaml
```

Nel file `loadtest/config.yaml` imposta almeno:
- `base_url` (es. `http://localhost:5173`)
- `csv_path` (path reale del tuo `dataset_1772097045952.csv`)
- `journey_mode` (`api` consigliato)

## Avvio

```bash
python loadtest/run.py --config loadtest/config.yaml
```

Override rapidi da CLI:

```bash
python loadtest/run.py \
  --base-url http://localhost:5173 \
  --planned-users 80 \
  --start-concurrency 4 \
  --max-concurrency 24 \
  --ramp-step-users 2 \
  --ramp-every-seconds 8 \
  --csv-path /percorso/dataset_1772097045952.csv
```

## Controlli Runtime

Durante il test:
- `p`: pausa/riprendi ramp-up
- `+`: aumenta concorrenza target
- `-`: riduce concorrenza target
- `q`: stop graduale (non lancia nuovi utenti)

## Note operative

- Se il CSV non esiste, il test si interrompe subito con errore esplicito.
- Alcuni step UI usano fallback IT/EN per i selettori (es. `Dati/Data`, `Caricati/Loaded`).
- Il training in `ML Lab` è client-side (TensorFlow.js), quindi impatta anche la macchina che esegue il test.
