# UI Refactor Tasklist

## Obiettivo

Costruire un refactor UI progressivo e reversibile, partendo dai fondamentali del design system e arrivando solo dopo ai moduli complessi.

Principio guida:

- prima si definiscono le regole
- poi si estraggono le primitive
- poi si unificano i pattern di layout
- solo alla fine si toccano i workspace e i moduli monolitici

## Regole di sicurezza

- [x] Lavorare solo su `uirefactor`
- [ ] Non rifattorizzare due macro-aree contemporaneamente
- [ ] Ogni fase deve lasciare il progetto compilabile
- [ ] Ogni sostituzione deve essere incrementale, non "big bang"
- [ ] Nessuna feature nuova finche' il design system non copre il caso d'uso
- [ ] Niente modali custom nuove
- [ ] Niente nuovi colori hardcoded nelle feature
- [ ] Niente helper visuali duplicati dentro le pagine

## Fase 0: Baseline e guardrail

Obiettivo: mettere in sicurezza il refactor prima di cambiare UI.

- [x] Creare una branch policy minima per il refactor
- [x] Documentare le regole UI in `docs/ui-refactor-tasklist.md`
- [x] Fare un inventario dei componenti shared gia' esistenti
- [x] Segnare i componenti duplicati evidenti
- [x] Segnare le pagine ad alto rischio
- [x] Definire un criterio di completamento per ogni fase

Deliverable:

- inventario componenti: `docs/ui-inventory.md`
- elenco duplicati principali: `docs/ui-duplicates.md`
- elenco pagine ad alto rischio: `docs/ui-high-risk-areas.md`
- criterio di completamento fase: `docs/ui-phase0-completion.md`

Gate per passare oltre:

- [x] esiste una lista chiara di cosa puo' essere toccato e in che ordine

## Fase 1: Foundations

Obiettivo: centralizzare i token visivi e smettere di definire stile nelle feature.

### 1.1 Token

- [x] Creare `frontend/src/design/tokens/color.ts`
- [x] Creare `frontend/src/design/tokens/typography.ts`
- [x] Creare `frontend/src/design/tokens/spacing.ts`
- [x] Creare `frontend/src/design/tokens/radius.ts`
- [x] Creare `frontend/src/design/tokens/shadow.ts`
- [x] Creare `frontend/src/design/tokens/motion.ts`
- [x] Creare `frontend/src/design/tokens/zIndex.ts`

### 1.2 Theme e semantic tokens

- [x] Creare `frontend/src/design/themes/semanticTokens.ts`
- [x] Creare `frontend/src/design/themes/roleThemes.ts`
- [x] Unificare `studentAccent.ts` e `teacherAccent.ts`
- [x] Spostare `hexToRgba` e helper colore in `frontend/src/design/themes/colorUtils.ts`
- [x] Ridurre `frontend/src/lib/theme.ts` a adapter sottile o eliminarlo

### 1.3 CSS globale

- [x] Ripulire `frontend/src/index.css`
- [x] Allineare font UI e font brand
- [x] Definire scala tipografica ufficiale
- [x] Definire semantic colors per text, surface, border, accent, success, warning, danger
- [x] Evitare override globali aggressivi non giustificati

Deliverable:

- token centralizzati
- tema condiviso docente/studente
- CSS globale leggibile e governato da token

Gate per passare oltre:

- nuove schermate possono usare token senza reintrodurre colori inline

## Fase 2: Primitive UI

Obiettivo: rafforzare i componenti base e ridurre styling locale.

### 2.1 Primitive base

- [x] Creare `frontend/src/design/primitives/Button.tsx`
- [x] Creare `frontend/src/design/primitives/IconButton.tsx`
- [x] Creare `frontend/src/design/primitives/Input.tsx`
- [x] Creare `frontend/src/design/primitives/Textarea.tsx`
- [x] Creare `frontend/src/design/primitives/Select.tsx`
- [x] Creare `frontend/src/design/primitives/Card.tsx`
- [x] Creare `frontend/src/design/primitives/Badge.tsx`
- [ ] Creare `frontend/src/design/primitives/Avatar.tsx`
- [x] Creare `frontend/src/design/primitives/Dialog.tsx`
- [ ] Creare `frontend/src/design/primitives/Drawer.tsx`
- [x] Creare `frontend/src/design/primitives/Tabs.tsx`
- [x] Creare `frontend/src/design/primitives/Spinner.tsx`

### 2.2 Varianti

- [x] Definire varianti semantiche per `Button`
- [x] Definire varianti di surface per `Card`
- [x] Definire density coerenti
- [x] Definire stati focus/hover/disabled consistenti
- [ ] Ridurre le `className` inline di override locale

Deliverable:

- set minimo di primitive usabili senza styling aggiuntivo pesante

Gate per passare oltre:

- almeno 3 pagine semplici possono essere migrate usando quasi solo primitive

## Fase 3: Pattern UI

Obiettivo: formalizzare i pattern ripetuti che oggi vivono dentro le pagine.

### 3.1 Pattern di contenuto

- [ ] Creare `frontend/src/design/patterns/SectionHeader.tsx`
- [ ] Creare `frontend/src/design/patterns/MetricCard.tsx`
- [ ] Creare `frontend/src/design/patterns/EmptyState.tsx`
- [ ] Creare `frontend/src/design/patterns/SearchField.tsx`
- [ ] Creare `frontend/src/design/patterns/StatusPill.tsx`
- [ ] Creare `frontend/src/design/patterns/InlineNotice.tsx`
- [ ] Creare `frontend/src/design/patterns/PageLoader.tsx`

### 3.2 Pattern overlay

- [ ] Creare `frontend/src/design/patterns/ConfirmDialog.tsx`
- [ ] Creare `frontend/src/design/patterns/FormDialog.tsx`
- [ ] Creare `frontend/src/design/patterns/PickerDialog.tsx`
- [ ] Creare `frontend/src/design/patterns/FullscreenDialog.tsx`
- [ ] Creare `frontend/src/design/patterns/SidePanel.tsx`

Deliverable:

- pattern riusabili per liste, metriche, empty state, search, dialoghi

Gate per passare oltre:

- le feature nuove o migrate non aprono piu' overlay custom scritti a mano

## Fase 4: Shell e navigazione

Obiettivo: unificare il linguaggio dei layout principali.

### 4.1 Brand e nav

- [ ] Creare `frontend/src/design/patterns/BrandLockup.tsx`
- [ ] Creare `frontend/src/design/patterns/TopNav.tsx`
- [ ] Creare `frontend/src/design/patterns/NavTabs.tsx`
- [ ] Creare `frontend/src/design/patterns/ProfileMenu.tsx`
- [ ] Creare `frontend/src/design/patterns/SessionSwitcher.tsx`
- [ ] Creare `frontend/src/design/patterns/SettingsDialog.tsx`

### 4.2 Shell di pagina

- [ ] Creare `frontend/src/design/patterns/AppShell.tsx`
- [ ] Creare `frontend/src/design/patterns/WorkspaceShell.tsx`
- [ ] Creare `frontend/src/design/patterns/SplitView.tsx`
- [ ] Creare `frontend/src/design/patterns/ListDetailLayout.tsx`

### 4.3 Migrazione iniziale

- [ ] Rifattorizzare `TeacherNavbar.tsx`
- [ ] Rifattorizzare `StudentNavbar.tsx`
- [ ] Rimuovere o integrare `MobileNav.tsx`
- [ ] Rimuovere o integrare `MobileHeader.tsx`

Deliverable:

- top navigation consistente tra docente e studente
- settings condivisi
- shell coerenti su desktop e mobile

Gate per passare oltre:

- docente e studente usano lo stesso vocabolario di layout

## Fase 5: Pagine pilota a basso rischio

Obiettivo: validare il sistema su aree semplici prima dei moduli pesanti.

### Target

- [x] `TeacherClassesSessionsManager.tsx`
- [ ] `UDAListPage.tsx`
- [ ] `TasksModule.tsx`

### Cose da verificare

- [ ] metriche
- [ ] liste
- [ ] search
- [ ] empty state
- [ ] toolbar leggere
- [ ] dialog semplici

Deliverable:

- primo blocco di UI realmente migrato

Gate per passare oltre:

- il nuovo sistema regge casi reali senza esplodere in override locali

## Fase 6: Workspace documentale condiviso

Obiettivo: eliminare il duplicato piu' costoso del progetto.

### Architettura

- [ ] Definire `DocumentWorkspace`
- [ ] Separare shell da data provider
- [ ] Separare azioni docente/studente
- [ ] Estrarre sidebar documenti
- [ ] Estrarre toolbar documentale
- [ ] Estrarre dialog "new document"
- [ ] Estrarre dialog "publish/submit"

### Migrazione

- [ ] Rifattorizzare `TeacherDocumentsPage.tsx`
- [ ] Rifattorizzare `StudentDocumentsModule.tsx`
- [ ] Allineare `UnifiedToolbar.tsx`

Deliverable:

- un solo workspace documentale parametrico

Gate per passare oltre:

- docente e studente differiscono per dati e permessi, non per struttura UI

## Fase 7: Dashboard e landing interne

Obiettivo: riallineare home docente e studente.

- [ ] Rifattorizzare `TeacherDashboard.tsx`
- [ ] Rifattorizzare `StudentDashboard.tsx`
- [ ] Ridurre la distanza tra mobile e desktop
- [ ] Unificare card home, quick action, header, strip di sessione

Deliverable:

- dashboard coerenti e piu' leggibili

Gate per passare oltre:

- la home non sembra piu' due prodotti diversi tra mobile e desktop

## Fase 8: Sistemi chat

Obiettivo: normalizzare le due aree piu' dense.

### Kit chat

- [ ] Creare `ConversationLayout`
- [ ] Creare `ConversationSidebar`
- [ ] Creare `Composer`
- [ ] Creare `AttachmentTray`
- [ ] Creare `MessageBubble`
- [ ] Creare `ModeSwitcher`
- [ ] Creare `ConversationEmptyState`

### Migrazione

- [ ] Rifattorizzare `TeacherSupportChat.tsx`
- [ ] Rifattorizzare `ChatbotModule.tsx`
- [ ] Verificare convergenza con `ChatSidebar.tsx`

Deliverable:

- grammatica chat condivisa

Gate per passare oltre:

- le chat cambiano per capability, non per struttura di base

## Fase 9: Sistemi secondari

Obiettivo: portare a compatibilita' i sottosistemi laterali.

- [ ] Rifattorizzare `SessionLivePage.tsx`
- [ ] Rifattorizzare `ClassificationModule.tsx`
- [ ] Rifattorizzare `TeacherDemoPage.tsx`
- [ ] Rifattorizzare `UDACreatorPage.tsx`
- [ ] Allineare `DesktopPage.tsx`
- [ ] Allineare notebook e pagine correlate

Deliverable:

- sottosistemi compatibili con il linguaggio del progetto

Gate finale:

- niente macro-area usa piu' un visual language completamente autonomo

## Ordine consigliato

1. Fase 0
2. Fase 1
3. Fase 2
4. Fase 3
5. Fase 4
6. Fase 5
7. Fase 6
8. Fase 7
9. Fase 8
10. Fase 9

## Primo sprint consigliato

Se vuoi partire senza rischiare troppo:

- [ ] completare Fase 1
- [ ] creare `Button`, `Card`, `Dialog`, `Input`
- [ ] creare `SectionHeader`, `MetricCard`, `EmptyState`, `SearchField`
- [ ] usare `TeacherClassesSessionsManager.tsx` come pagina pilota

## File da toccare per primi

- [ ] `frontend/src/index.css`
- [ ] `frontend/src/lib/theme.ts`
- [ ] `frontend/src/lib/studentAccent.ts`
- [ ] `frontend/src/lib/teacherAccent.ts`
- [ ] `frontend/src/components/ui/button.tsx`
- [ ] `frontend/src/components/ui/card.tsx`
- [ ] `frontend/src/components/ui/dialog.tsx`
- [ ] `frontend/src/components/teacher/TeacherClassesSessionsManager.tsx`

## Criteri di successo

- [ ] una nuova UI non introduce colori hardcoded
- [ ] una nuova modale non usa overlay custom
- [ ] una pagina semplice si costruisce con primitive e pattern
- [ ] docente e studente condividono shell e pattern
- [ ] i moduli grossi diminuiscono le responsabilita' di styling locale
