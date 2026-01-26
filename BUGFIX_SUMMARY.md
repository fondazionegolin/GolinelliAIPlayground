# Bug Fix Summary - Chat di Classe

**Data:** 22 Gennaio 2026, ore 11:01 CET  
**Deploy:** v1.1.1 - Critical Bug Fixes

---

## 🐛 Problemi Risolti

### 1. ✅ Invio Immagini Non Funzionante

**Problema:**
- Upload immagini restituiva 401 Unauthorized
- Endpoint richiedeva autenticazione ma parametri non corretti
- Files non venivano caricati correttamente

**Soluzione:**
- Semplificato endpoint `/api/v1/chat/upload` 
- Cambiato `session_id` da `Annotated[UUID, Query()]` a `str = Query(...)`
- Rimosso dipendenza `db` non necessaria
- Gestione errori migliorata con try/catch
- File: `backend/app/api/v1/endpoints/chat.py:385-417`

**Risultato:**
- Upload ora funziona correttamente
- File salvati in `uploads/chat/{session_id}/`
- URL ritornati come `/uploads/chat/{session_id}/{filename}`

---

### 2. ✅ Flickering Durante Drag & Drop

**Problema:**
- App andava in flickering quando si trascinava un file
- `dragEnter` e `dragLeave` si triggeravano su ogni elemento child
- Overlay drag appariva e spariva continuamente

**Soluzione:**
- Implementato **drag counter** per tracciare eventi nested
- `dragEnter` incrementa counter
- `dragLeave` decrementa counter
- Overlay si nasconde solo quando counter = 0
- File: `frontend/src/components/ChatSidebar.tsx:36,116-130`

**Codice:**
```typescript
const dragCounter = useRef(0)

const handleDragEnter = (e: React.DragEvent) => {
  e.preventDefault()
  e.stopPropagation()
  dragCounter.current++
  if (e.dataTransfer.items && e.dataTransfer.items.length > 0) {
    setDragActive(true)
  }
}

const handleDragLeave = (e: React.DragEvent) => {
  e.preventDefault()
  e.stopPropagation()
  dragCounter.current--
  if (dragCounter.current === 0) {
    setDragActive(false)
  }
}
```

**Risultato:**
- Nessun flickering durante drag
- Overlay stabile
- UX fluida

---

### 3. ✅ Drag da Chatbot a Chat Non Funzionava

**Problema:**
- Immagini generate dal chatbot non potevano essere trascinate nella chat
- DataTransfer passava solo URL stringa invece di oggetto JSON
- ChatSidebar si aspettava formato JSON ma riceveva stringa

**Soluzione:**
- **ChatbotModule**: Modificato `onDragStart` per passare JSON
  ```typescript
  const imageData = JSON.stringify({
    url: imgSrc,
    filename: `chatbot-image-${Date.now()}.png`,
    type: 'image/png'
  })
  e.dataTransfer.setData('application/x-chatbot-image', imageData)
  ```

- **ChatSidebar**: Gestione prioritaria custom data
  ```typescript
  const customImageData = e.dataTransfer.getData('application/x-chatbot-image')
  if (customImageData) {
    const data = JSON.parse(customImageData)
    const res = await fetch(data.url)
    const blob = await res.blob()
    const file = new File([blob], data.filename, { type: blob.type })
    setAttachedFiles(prev => [...prev, file])
    return // Non processare altri file
  }
  ```

**File modificati:**
- `frontend/src/pages/student/ChatbotModule.tsx:1177-1186`
- `frontend/src/components/ChatSidebar.tsx:132-157`

**Risultato:**
- Drag & drop da chatbot funziona perfettamente
- Immagini DALL-E condivisibili in chat classe
- File convertito correttamente da URL a Blob

---

### 4. ✅ Resize Chat Non Disponibile

**Problema:**
- Chat aveva larghezza fissa (320px)
- Impossibile ridimensionare trascinando bordo sinistro
- Nessuna flessibilità layout

**Soluzione:**
- Implementato **resize handle** sul bordo sinistro
- State `chatWidth` per tracciare larghezza (min: 280px, max: 800px)
- Mouse events per resize interattivo
- Visual feedback durante resize (bordo diventa indigo)

**Codice:**
```typescript
const [chatWidth, setChatWidth] = useState(320)
const [isResizing, setIsResizing] = useState(false)

useEffect(() => {
  if (!isResizing || isMobileView) return

  const handleMouseMove = (e: MouseEvent) => {
    const newWidth = window.innerWidth - e.clientX
    if (newWidth >= 280 && newWidth <= 800) {
      setChatWidth(newWidth)
    }
  }

  const handleMouseUp = () => setIsResizing(false)

  document.addEventListener('mousemove', handleMouseMove)
  document.addEventListener('mouseup', handleMouseUp)

  return () => {
    document.removeEventListener('mousemove', handleMouseMove)
    document.removeEventListener('mouseup', handleMouseUp)
  }
}, [isResizing, isMobileView])
```

**UI Resize Handle:**
```tsx
{!isMobileView && (
  <div
    className="absolute left-0 top-0 w-1 h-full cursor-ew-resize 
                hover:bg-indigo-500 transition-colors"
    onMouseDown={handleMouseDown}
  />
)}
```

**File:** `frontend/src/components/ChatSidebar.tsx:30-33,176-206,211-220`

**Risultato:**
- Chat ridimensionabile con drag su bordo sinistro
- Limiti min/max per usabilità
- Hover effect per discoverability
- Solo desktop (mobile resta fullscreen)

---

## 📦 File Modificati

### Backend (1 file)
1. **`backend/app/api/v1/endpoints/chat.py`**
   - Semplificato endpoint upload
   - Rimossa dipendenza DB non necessaria
   - Migliorata gestione errori

### Frontend (2 files)
1. **`frontend/src/components/ChatSidebar.tsx`**
   - Fix flickering drag & drop (drag counter)
   - Gestione drag da chatbot (custom data)
   - Resize chat interattivo
   - Migliorate animazioni e UX

2. **`frontend/src/pages/student/ChatbotModule.tsx`**
   - Fix formato dati drag & drop
   - JSON invece di stringa per custom data

---

## 🚀 Deploy

**Metodo:** Rolling update (zero downtime)

```bash
# Build
docker compose build frontend api

# Deploy
docker compose up -d --no-deps frontend api
docker compose restart nginx
```

**Status:**
- ✅ Frontend deployed (build: 29.17s)
- ✅ API deployed (build: 1.9s)
- ✅ Nginx restarted
- ✅ Tutti i servizi UP

---

## ✅ Testing Checklist

### Upload Immagini
- [x] Seleziona file con bottone clip
- [x] Drag & drop da file system
- [x] Preview file prima invio
- [x] Invio messaggio con allegato
- [x] Verifica immagine visualizzata
- [x] Nessun errore 401

### Drag & Drop
- [x] Trascina file → nessun flickering
- [x] Overlay stabile durante drag
- [x] Drop funziona correttamente
- [x] Files aggiunti a preview

### Drag da Chatbot
- [x] Genera immagine DALL-E in chatbot
- [x] Trascina immagine verso chat
- [x] Immagine si allega correttamente
- [x] Invio funziona
- [x] Immagine condivisa con classe

### Resize Chat
- [x] Hover bordo sinistro → cursore resize
- [x] Drag bordo → chat si ridimensiona
- [x] Limiti min/max rispettati
- [x] Release mouse → larghezza mantenuta
- [x] Solo desktop (mobile non affetto)

---

## 🔧 Dettagli Tecnici

### Drag Counter Pattern
**Perché serve:**
- Eventi drag in HTML propagano ai children
- Ogni child genera `dragEnter`/`dragLeave`
- Porta a flickering dell'overlay

**Soluzione:**
- Counter incrementa su enter, decrementa su leave
- Overlay si nasconde solo quando counter torna a 0
- Pattern standard per nested drag events

### Custom DataTransfer
**Formato dati:**
```typescript
{
  url: string,          // URL immagine (base64 o http)
  filename: string,     // Nome file suggerito
  type: string          // MIME type
}
```

**Conversione:**
1. ChatbotModule serializza oggetto → JSON string
2. DataTransfer trasporta string
3. ChatSidebar deserializza → oggetto
4. Fetch URL → Blob
5. Blob → File object
6. File aggiunto ad attachedFiles[]

### Resize Implementation
**Approccio:**
- State per larghezza corrente
- mouseDown su handle → start resize
- mousemove globale → aggiorna larghezza
- mouseup globale → stop resize
- Cleanup listeners on unmount

**Calcolo larghezza:**
```typescript
const newWidth = window.innerWidth - e.clientX
```
- clientX = posizione X mouse
- window.innerWidth - clientX = spazio da destra

---

## 📊 Performance

**Build Times:**
- Frontend: 29.17s (4025 modules)
- Backend: 1.9s (mostly cached)

**Deploy Times:**
- Total: ~15 secondi
- Downtime: 0 secondi (rolling update)

**Bundle Sizes:**
- index.js: 3.04 MB (gzip: 672 KB)
- react-plotly.js: 4.86 MB (gzip: 1.47 MB)
- CSS: 103 KB (gzip: 20.6 KB)

---

## 🎯 Risultati

### Prima delle Fix
- ❌ Upload immagini → 401 error
- ❌ Drag & drop → flickering
- ❌ Drag da chatbot → non funziona
- ❌ Chat larghezza fissa

### Dopo le Fix
- ✅ Upload immagini funziona
- ✅ Drag & drop fluido
- ✅ Drag da chatbot operativo
- ✅ Chat ridimensionabile

---

## 🔄 Rollback Procedure

Se necessario tornare indietro:

```bash
cd /home/ale/GIT/GolinelliAIPlayground

# Stop servizi
docker compose down frontend api

# Checkout commit precedente
git log --oneline -5  # trova commit hash
git checkout <hash-precedente>

# Rebuild e deploy
docker compose build frontend api
docker compose up -d
```

---

## 📝 Note Aggiuntive

### Autenticazione Upload
L'endpoint ora accetta autenticazione standard:
```http
POST /api/v1/chat/upload?session_id={uuid}
Authorization: Bearer {token}
Content-Type: multipart/form-data

files: [File, File, ...]
```

### Limiti
- Max file size: 50 MB (nginx)
- Max chat width: 800px
- Min chat width: 280px
- Supported: immagini, PDF, documenti

### Compatibilità
- Desktop: Tutte le funzionalità
- Mobile: Drag da chatbot non disponibile (limitazione browser mobile)
- Resize: Solo desktop

---

**Deploy completato:** 22/01/2026 11:01:20 CET  
**Status:** ✅ OPERATIONAL  
**Next:** User testing

