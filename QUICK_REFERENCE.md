# Quick Reference - Chat di Classe Update

## 🚀 Deploy Status: ✅ COMPLETED

**Data:** 22 Gennaio 2026, 10:51 CET  
**Ambiente:** Production (playground.golinelli.ai)  
**Versione:** v1.1.0

---

## 📋 Checklist Rapida

- [x] Frontend buildato e deployato
- [x] Backend API buildato e deployato
- [x] Worker buildato e deployato
- [x] Nginx configurato per /uploads
- [x] Volume chat_uploads creato e montato
- [x] Directory /app/uploads/chat creata
- [x] Permessi upload directory impostati
- [x] Health check OK
- [x] WebSocket funzionanti
- [x] Logs senza errori

---

## 🎯 Nuove Funzionalità Attive

### ✅ Drag & Drop File
- Trascina file nella chat
- Overlay visivo durante drag
- Supporto immagini, PDF, documenti

### ✅ Upload con Bottone
- Click clip (📎) per selezionare file
- Preview prima invio
- Rimozione file

### ✅ Visualizzazione Immagini
- Immagini inline nei messaggi
- Click per espandere
- Layout responsive

### ✅ Link Compiti Cliccabili
- Notifiche task con link diretto
- Apre modulo task automaticamente
- Funziona per quiz, exercise, lesson, presentation

### ✅ Drag da Chatbot
- Trascina immagini DALL-E
- Condividi in chat classe
- Qualità preservata

### ✅ Persistenza Messaggi
- Salvataggio DB via API
- Broadcast real-time via WebSocket
- Allegati persistenti

---

## 🔧 Comandi Utili

### Status Servizi
```bash
cd /home/ale/GIT/GolinelliAIPlayground
docker compose ps
```

### Logs Real-time
```bash
# API
docker logs -f golinelliaiplayground-api-1

# Frontend
docker logs -f golinelliaiplayground-frontend-1

# Nginx
docker logs -f golinelliaiplayground-nginx-1
```

### Restart Servizi
```bash
# Singolo servizio
docker compose restart api
docker compose restart frontend
docker compose restart nginx

# Tutti
docker compose restart
```

### Verifica Upload Directory
```bash
# Lista file
docker exec golinelliaiplayground-api-1 ls -la /app/uploads/chat/

# Spazio disco
docker exec golinelliaiplayground-api-1 df -h /app/uploads

# Permessi
docker exec golinelliaiplayground-api-1 ls -ld /app/uploads/chat
```

### Health Checks
```bash
# API Health
curl http://localhost/health

# Frontend
curl -I http://localhost/

# Upload endpoint (richiede auth)
curl http://localhost/api/v1/chat/upload
```

---

## 🐛 Troubleshooting Veloce

### Upload non funziona
```bash
# Verifica permessi
docker exec golinelliaiplayground-api-1 chmod -R 777 /app/uploads

# Verifica directory
docker exec golinelliaiplayground-api-1 mkdir -p /app/uploads/chat

# Logs errori
docker logs golinelliaiplayground-api-1 | grep -i error
```

### Immagini non visualizzate
```bash
# Test nginx route
curl http://localhost/uploads/test.txt

# Verifica file
docker exec golinelliaiplayground-api-1 ls /app/uploads/chat/

# Restart nginx
docker compose restart nginx
```

### WebSocket disconnesso
```bash
# Verifica Redis
docker logs golinelliaiplayground-redis-1 --tail 50

# Verifica API socket
docker logs golinelliaiplayground-api-1 | grep socket

# Restart API
docker compose restart api
```

---

## 📁 File Modificati

### Frontend (4 files)
1. `frontend/src/components/ChatSidebar.tsx`
2. `frontend/src/hooks/useSocket.ts`
3. `frontend/src/lib/api.ts`
4. `frontend/src/pages/student/StudentDashboard.tsx`

### Backend (4 files)
1. `backend/app/api/v1/endpoints/chat.py`
2. `backend/app/schemas/chat.py`
3. `backend/app/realtime/gateway.py`
4. `backend/app/main.py`

### Infrastructure (2 files)
1. `docker-compose.yml`
2. `infrastructure/nginx/nginx.conf`

---

## 🔄 Rollback Rapido

```bash
cd /home/ale/GIT/GolinelliAIPlayground

# Stop servizi
docker compose down frontend api worker nginx

# Rebuild da backup (se necessario)
git checkout HEAD~1  # torna a commit precedente

# Rebuild
docker compose build frontend api worker

# Deploy
docker compose up -d
```

---

## 📊 Metriche da Monitorare

### Prime 24 Ore
- [ ] Numero upload file/giorno
- [ ] Dimensione media file
- [ ] Errori upload
- [ ] Spazio disco volume chat_uploads
- [ ] Tempo risposta endpoint /uploads
- [ ] Errori WebSocket
- [ ] CPU/RAM container API

### Tools
```bash
# Spazio volume
docker system df -v | grep chat_uploads

# Stats container
docker stats golinelliaiplayground-api-1

# Prometheus metrics
curl http://localhost/metrics
```

---

## 🎓 Testing Prioritario

### Critici (Da fare subito)
1. **Upload immagine** - Studente trascina foto nella chat
2. **Visualizzazione** - Immagine appare inline
3. **Persistenza** - Refresh pagina, immagine ancora visibile
4. **Link task** - Docente pubblica quiz, studente clicca notifica

### Secondari (Da fare entro 24h)
1. File multipli simultanei
2. File grandi (>10MB)
3. PDF e documenti
4. Mobile upload
5. Concorrenza (2+ studenti upload)

---

## 📞 Support

**Documentazione completa:** `DEPLOY_SUMMARY.md`  
**Testing guide:** `CHAT_TESTING.md`  
**Deploy by:** OpenCode AI Assistant  
**Environment:** Production  

---

## ✨ Quick Win Checklist

Per verificare che tutto funzioni:

```bash
# 1. Servizi attivi
docker compose ps | grep Up

# 2. No errori recenti
docker logs golinelliaiplayground-api-1 --tail 50 | grep -i error

# 3. Health OK
curl http://localhost/health

# 4. Upload dir pronta
docker exec golinelliaiplayground-api-1 ls -la /app/uploads/chat

# 5. WebSocket attivi
docker logs golinelliaiplayground-api-1 | grep -i websocket | tail -5
```

Se tutti i check passano: **✅ SISTEMA OPERATIVO**

---

**Last updated:** 2026-01-22 10:54 CET
