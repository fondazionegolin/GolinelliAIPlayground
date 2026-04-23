# UI High Risk Areas

## Scopo

Elenco delle aree ad alto rischio per il refactor, con motivazione e strategia consigliata.

## Livello: Critico

### `frontend/src/pages/teacher/TeacherSupportChat.tsx`

Rischio:

- 3968 righe
- pagina monolitica
- contiene piu' prodotti in un solo file: chat, report, publish flow, editor flow, image flow, artifact flow
- alta densita' di stato locale e layout custom

Regola:

- non rifattorizzare prima di aver stabilizzato primitives, dialog e conversation patterns

### `frontend/src/pages/student/ChatbotModule.tsx`

Rischio:

- 3830 righe
- shell propria
- mobile/desktop con comportamenti distinti
- modalita' molteplici nello stesso file
- styling locale molto esteso

Regola:

- non toccare prima di avere un chat kit minimo e i token consolidati

## Livello: Molto Alto

### `frontend/src/pages/student/ClassificationModule.tsx`

Rischio:

- 2502 righe
- e' quasi un'app autonoma
- palette e componenti propri
- mix di form, visualizzazione dati, training flow

Regola:

- riallineare solo dopo primitives e pattern consolidati

### `frontend/src/components/ChatSidebar.tsx`

Rischio:

- 1802 righe
- componente condiviso ma molto denso
- forte impatto trasversale

Regola:

- trattarlo come sottosistema dedicato, non come refactor opportunistico

### `frontend/src/pages/teacher/SessionLivePage.tsx`

Rischio:

- 1647 righe
- monitoraggio live, task management, module toggles, history, demo bot
- troppi domini UI nello stesso posto

Regola:

- entrare solo dopo pattern di shell, metriche e list/detail

### `frontend/src/pages/teacher/TeacherDocumentsPage.tsx`

### `frontend/src/pages/student/StudentDocumentsModule.tsx`

Rischio:

- duplicazione strutturale quasi completa
- editor e shell complessi
- rischio regressioni alto

Regola:

- affrontare insieme sotto un solo `DocumentWorkspace`

## Livello: Alto ma gestibile

### `frontend/src/pages/notebook/NotebookPage.tsx`

Rischio:

- 1143 righe
- workspace tecnico con interazioni forti

Regola:

- non e' il primo target, ma puo' essere riallineato dopo i workspace principali

### `frontend/src/pages/student/StudentDashboard.tsx`

Rischio:

- 979 righe
- mobile e desktop con grammatiche diverse

Regola:

- rifattorizzare solo dopo shell e navigation patterns

### `frontend/src/components/teacher/TeacherClassesSessionsManager.tsx`

Rischio:

- 895 righe
- importante ma leggibile
- buon candidato pilota

Regola:

- primo target di migrazione consigliato

## Livello: Medio

### `frontend/src/pages/teacher/UDAListPage.tsx`

Rischio:

- basso impatto sistemico
- ottima pagina pilota secondaria

### `frontend/src/pages/student/TasksModule.tsx`

Rischio:

- medio
- buon candidato pilota per task/grid/empty state/dialog

## Strategia operativa

Ordine raccomandato:

1. `TeacherClassesSessionsManager.tsx`
2. `UDAListPage.tsx`
3. `TasksModule.tsx`
4. shell e dashboard
5. document workspace
6. chat monolitiche
7. sistemi secondari
