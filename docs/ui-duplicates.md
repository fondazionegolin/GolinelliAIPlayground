# UI Duplicates

## Scopo

Elenco iniziale dei duplicati strutturali e visivi che giustificano il refactor.

## Duplicati ad alta priorita'

### 1. Workspace documentale docente/studente

File:

- `frontend/src/pages/teacher/TeacherDocumentsPage.tsx`
- `frontend/src/pages/student/StudentDocumentsModule.tsx`

Duplicazione:

- modalita' editor quasi equivalenti
- sidebar documenti molto simile
- flow "new document" duplicato
- flow "publish / submit" duplicato
- uso condiviso di `UnifiedToolbar`
- stesse responsabilita' di shell mischiate a data layer e action layer

Priorita':

- altissima

### 2. Navbar docente/studente

File:

- `frontend/src/components/TeacherNavbar.tsx`
- `frontend/src/components/StudentNavbar.tsx`

Duplicazione:

- brand lockup
- avatar/profile dropdown
- settings modal embedded
- gestione accent
- session info strip
- blocchi di nav top-level

Priorita':

- alta

### 3. Settings modal duplicato

File:

- `frontend/src/components/TeacherNavbar.tsx`
- `frontend/src/components/StudentNavbar.tsx`

Duplicazione:

- modal integrato localmente invece di pattern condiviso
- struttura molto simile ma con varianti di ruolo

Priorita':

- alta

### 4. Accent model duplicato

File:

- `frontend/src/lib/studentAccent.ts`
- `frontend/src/lib/teacherAccent.ts`

Duplicazione:

- stessa struttura dati
- stessa semantica
- differenza solo nominale di ruolo

Priorita':

- alta

### 5. Helper colore duplicato

File:

- `frontend/src/lib/theme.ts`
- `frontend/src/pages/student/ChatbotModule.tsx`
- `frontend/src/components/teacher/TeacherClassesSessionsManager.tsx`

Duplicazione:

- `hexToRgba` definito in piu' posti

Priorita':

- media

## Duplicati di pattern

### Overlay / modal custom

File rappresentativi:

- `frontend/src/components/teacher/TeacherClassesSessionsManager.tsx`
- `frontend/src/pages/student/StudentDocumentsModule.tsx`
- `frontend/src/pages/teacher/TeacherDocumentsPage.tsx`
- `frontend/src/pages/teacher/TeacherSupportChat.tsx`
- `frontend/src/pages/student/ChatbotModule.tsx`
- `frontend/src/pages/student/ClassificationModule.tsx`
- `frontend/src/pages/teacher/UDACreatorPage.tsx`

Problema:

- esiste gia' `frontend/src/components/ui/dialog.tsx`
- molti flussi continuano a usare overlay custom con `fixed inset-0 z-50`

Priorita':

- alta

### Mobile layer parallelo

File:

- `frontend/src/components/student/MobileNav.tsx`
- `frontend/src/components/student/MobileHeader.tsx`
- `frontend/src/pages/student/StudentDashboard.tsx`

Problema:

- componenti mobile dedicati esistono ma non governano il flusso principale
- il mobile usa pattern diversi in piu' punti

Priorita':

- media

## Duplicati di palette / style maps

### Teacherbot subsystem

File:

- `frontend/src/components/teacher/TeacherbotForm.tsx`
- `frontend/src/components/teacher/TeacherbotTestChat.tsx`
- `frontend/src/components/teacher/TeacherbotReportsPanel.tsx`
- `frontend/src/pages/teacher/SessionLivePage.tsx`
- `frontend/src/pages/teacher/TeacherDemoPage.tsx`

Problema:

- color map e style map del sottosistema teacherbot sparse
- brand visivo autonomo rispetto al resto del pannello docente

Priorita':

- media-alta

## Duplicati da tenere d'occhio ma non attaccare subito

- pattern chat tra `ChatSidebar`, `TeacherSupportChat`, `ChatbotModule`, `ChatConversationList`, `ChatConversationView`
- workspace specializzati tra notebook, desktop, UDA creator, ML Lab

## Uso consigliato

Questa lista va usata per:

- scegliere il prossimo estratto a primitive/pattern
- evitare di introdurre un terzo duplicato mentre si rifattorizza
