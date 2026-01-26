# Chat di Classe - Guida al Testing

## Funzionalità Implementate

### 1. Drag & Drop File
**Come testare:**
1. Apri la chat di classe (sidebar destra per desktop, modulo chat per mobile)
2. Trascina un'immagine dal tuo file system nella chat
3. Verifica che appaia l'overlay blu "Trascina qui i file"
4. Rilascia il file
5. Verifica che il file appaia nella preview sopra l'input
6. Invia il messaggio
7. Verifica che l'immagine appaia nel messaggio inviato

**Cosa verificare:**
- Overlay drag visibile durante il trascinamento
- Preview file prima dell'invio
- Possibilità di rimuovere file con X
- Immagine visualizzata inline nel messaggio

### 2. Upload File con Bottone
**Come testare:**
1. Clicca sul bottone clip (📎) nell'input della chat
2. Seleziona uno o più file
3. Verifica che i file appaiano nella preview
4. Clicca X per rimuovere un file (opzionale)
5. Invia il messaggio
6. Verifica che i file siano visibili nel messaggio

**Cosa verificare:**
- Bottone clip funzionante
- Selezione multipla file
- Preview corretta (thumbnail per immagini, icona per altri file)
- Rimozione file prima dell'invio

### 3. Visualizzazione Immagini Allegate
**Come testare:**
1. Invia un messaggio con un'immagine allegata
2. Verifica che l'immagine appaia inline nel messaggio
3. Clicca sull'immagine
4. Verifica che si apra in una nuova tab

**Cosa verificare:**
- Immagini visualizzate correttamente
- Click apre immagine full size
- Layout responsive

### 4. Registrazione Messaggi
**Come testare:**
1. Invia un messaggio come studente
2. Ricarica la pagina
3. Verifica che il messaggio sia ancora presente
4. Controlla dal lato docente
5. Verifica che il messaggio sia visibile anche lì

**Cosa verificare:**
- Messaggi persistono dopo refresh
- Messaggi visibili a tutti i partecipanti
- Timestamp corretto

### 5. Link Cliccabili per Compiti
**Come testare (come studente):**
1. Il docente pubblica un nuovo compito
2. Verifica che appaia una notifica blu nella chat con icona 🔔
3. Verifica il testo: "📋 Nuovo compito: [Titolo]"
4. Clicca sulla notifica
5. Verifica che si apra il modulo "Quiz & Badge"
6. Verifica che il compito specifico sia aperto ed espanso

**Cosa verificare:**
- Notifica visibile in chat
- Stile distintivo (sfondo blu, hover effect)
- Click apre il modulo corretto
- Task specifico si apre automaticamente

### 6. Drag & Drop Elementi Chatbot
**Come testare:**
1. Vai nel modulo Chatbot AI
2. Genera un'immagine con DALL-E
3. Passa il mouse sull'immagine
4. Verifica il tooltip "Trascina nella chat di classe"
5. Trascina l'immagine verso la chat
6. Verifica che si alleghi automaticamente
7. Invia il messaggio
8. Verifica che l'immagine sia visibile nella chat

**Cosa verificare:**
- Tooltip visibile
- Drag funzionante
- Immagine allegata correttamente
- Qualità immagine preservata

## Testing Completo (Flusso End-to-End)

### Scenario 1: Studente Invia Immagine
1. Login come studente
2. Apri chat di classe
3. Drag & drop un'immagine
4. Scrivi un testo descrittivo
5. Invia
6. Verifica visualizzazione corretta
7. Ricarica pagina
8. Verifica persistenza

### Scenario 2: Docente Pubblica Compito
1. Login come docente
2. Crea un nuovo quiz nella sessione live
3. Pubblica il quiz
4. Verifica notifica in chat (lato docente)
5. Login come studente (altra finestra/browser)
6. Verifica notifica in chat (lato studente)
7. Clicca sulla notifica
8. Verifica apertura quiz

### Scenario 3: Conversazione con Allegati
1. Studente A invia messaggio con foto
2. Studente B risponde con testo
3. Docente invia documento PDF
4. Verifica che tutti vedano tutti i messaggi
5. Verifica ordine cronologico
6. Verifica avatar e nomi corretti

## Problemi Noti da Verificare

### ⚠️ Da Testare Attentamente
1. **Upload file grandi**: Verificare comportamento con file > 10MB
2. **Formati file**: Testare PDF, DOC, immagini varie
3. **Mobile**: Testare tutte le funzionalità su mobile
4. **Concorrenza**: Due studenti inviano messaggi simultaneamente
5. **Offline/Online**: Disconnessione e riconnessione

### 🔧 Se Qualcosa Non Funziona

**Upload fallisce:**
- Controlla console browser per errori
- Verifica che la directory `uploads/chat` esista sul server
- Verifica permessi scrittura

**Immagini non visualizzate:**
- Controlla che il mount `/uploads` in FastAPI funzioni
- Verifica URL immagine nella console

**Notifiche non cliccabili:**
- Verifica che `notification_type` sia presente nel messaggio
- Controlla console per errori

**Messaggi non persistono:**
- Verifica che l'API endpoint sia chiamata PRIMA del socket
- Controlla database per vedere se i messaggi sono salvati

## Comandi Utili per Debug

### Backend
```bash
# Verifica logs backend
docker logs -f eduai-backend

# Controlla uploads directory
ls -la uploads/chat/

# Test endpoint upload
curl -X POST -H "Authorization: Bearer <token>" \
  -F "files=@test.jpg" \
  http://localhost:8000/api/v1/chat/upload?session_id=<session_id>
```

### Frontend
```bash
# Rebuild frontend
npm run build

# Controlla errori TypeScript
npm run type-check

# Console browser
# F12 > Console > filtra per "chat"
```

### Database
```sql
-- Verifica messaggi salvati
SELECT * FROM chat_messages 
ORDER BY created_at DESC 
LIMIT 10;

-- Verifica attachments
SELECT message_text, attachments 
FROM chat_messages 
WHERE attachments IS NOT NULL 
  AND jsonb_array_length(attachments) > 0;
```

## Checklist Pre-Produzione

- [ ] Upload file funziona (immagini)
- [ ] Upload file funziona (PDF, documenti)
- [ ] Drag & drop da file system
- [ ] Drag & drop da chatbot
- [ ] Visualizzazione immagini inline
- [ ] Click notifiche apre task
- [ ] Messaggi persistono dopo refresh
- [ ] Mobile: tutte le funzionalità
- [ ] Mobile: layout corretto
- [ ] Desktop: sidebar sempre visibile
- [ ] Avatar e nomi corretti
- [ ] Timestamp formattati
- [ ] Indicatore online/offline
- [ ] Performance con molti messaggi (100+)
- [ ] Performance con immagini pesanti
- [ ] Sicurezza: validazione file types
- [ ] Sicurezza: limite dimensione file

## Note per Sviluppo Futuro

### Possibili Miglioramenti
1. **Compressione immagini**: Resize automatico prima dell'upload
2. **Lazy loading**: Carica immagini solo quando visibili
3. **Typing indicators**: Mostra "sta scrivendo..."
4. **Reazioni**: Emoji reactions ai messaggi
5. **Thread**: Risposte a messaggi specifici
6. **Ricerca**: Cerca nei messaggi
7. **Esporta chat**: Download conversazione in PDF
8. **Notifiche push**: Notifiche browser per nuovi messaggi
9. **Voice messages**: Messaggi vocali
10. **Link preview**: Anteprima automatica URL

### Ottimizzazioni Tecniche
- Passare a Redis per state WebSocket (multi-instance)
- Implementare CDN per file uploads
- Aggiungere rate limiting per prevenire spam
- Implementare message queuing per alta concorrenza
- Aggiungere monitoring e analytics
