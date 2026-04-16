# UI Inventory

## Scopo

Inventario iniziale dei layer UI esistenti nel frontend, usato come baseline per il refactor.

## Design system attuale

### UI primitives attuali

Percorso: `frontend/src/components/ui`

- `AppBackground.tsx`
- `FileViewerModal.tsx`
- `LongPressMenu.tsx`
- `NavTab.tsx`
- `PullToRefresh.tsx`
- `SwipeableMessage.tsx`
- `ZoomableImage.tsx`
- `avatar.tsx`
- `badge.tsx`
- `button.tsx`
- `card.tsx`
- `dialog.tsx`
- `dropdown-menu.tsx`
- `input.tsx`
- `label.tsx`
- `scroll-area.tsx`
- `switch.tsx`
- `tabs.tsx`
- `textarea.tsx`
- `toast.tsx`
- `toaster.tsx`
- `use-toast.ts`

### Shared components fuori da `ui`

Percorso: `frontend/src/components`

- editor e authoring: `RichTextEditor`, `SlideEditor`, `SpreadsheetEditor`, `CollaborativeCanvas`, `UnifiedToolbar`
- chat e messaging: `ChatSidebar`, `TeacherNotifications`, `TeacherChatWidget`, `VoiceRecorder`
- supporto contenuti: `DataFileCard`, `DataVisualizationPanel`, `PagedDocumentPreview`, `CodeBlock`
- shell e nav: `TeacherNavbar`, `StudentNavbar`, `NavbarCalendarClock`, `LogoMark`, `LanguageSwitcher`
- overlay e modal: `ArtifactPreviewModal`, `ContentEditorModal`, `AIImageGeneratorModal`, `TeachersManagementModal`, `WhatsNewModal`

### Sottosistemi specializzati

- `frontend/src/components/student`
- `frontend/src/components/teacher`
- `frontend/src/components/notebook`
- `frontend/src/components/desktop`
- `frontend/src/pages/student`
- `frontend/src/pages/teacher`

## Tema e token attuali

Layer principale attuale:

- `frontend/src/index.css`
- `frontend/src/lib/theme.ts`
- `frontend/src/lib/studentAccent.ts`
- `frontend/src/lib/teacherAccent.ts`

Problemi osservati:

- token pochi e poco prescrittivi
- semantica colore debole
- accenti duplicati per ruolo
- helper visuali ripetuti fuori dal theme layer

## Nuovo bootstrap creato

Percorso: `frontend/src/design`

### Tokens

- `tokens/color.ts`
- `tokens/typography.ts`
- `tokens/spacing.ts`
- `tokens/radius.ts`
- `tokens/shadow.ts`
- `tokens/motion.ts`
- `tokens/zIndex.ts`

### Themes

- `themes/colorUtils.ts`
- `themes/semanticTokens.ts`
- `themes/roleThemes.ts`

### Primitives bootstrap

- `primitives/Button.tsx`
- `primitives/Card.tsx`
- `primitives/Dialog.tsx`
- `primitives/Input.tsx`
- `primitives/Textarea.tsx`
- `primitives/Badge.tsx`
- `primitives/Avatar.tsx`
- `primitives/Tabs.tsx`
- `primitives/IconButton.tsx`
- `primitives/Spinner.tsx`
- `primitives/Select.tsx`

## Pagine principali per area

### Teacher

- `TeacherDashboard.tsx`
- `TeacherSupportChat.tsx`
- `TeacherDocumentsPage.tsx`
- `SessionLivePage.tsx`
- `UDACreatorPage.tsx`
- `UDAListPage.tsx`

### Student

- `StudentDashboard.tsx`
- `ChatbotModule.tsx`
- `StudentDocumentsModule.tsx`
- `TasksModule.tsx`
- `ClassificationModule.tsx`
- `StudentNotebookModule.tsx`

### Shared / secondary

- `DesktopPage.tsx`
- `NotebookPage.tsx`
- `LandingPage.tsx`
- admin pages

## Metriche baseline

File UI/pagine piu' pesanti:

- `TeacherSupportChat.tsx`: 3968 righe
- `ChatbotModule.tsx`: 3830 righe
- `ClassificationModule.tsx`: 2502 righe
- `ChatSidebar.tsx`: 1802 righe
- `SessionLivePage.tsx`: 1647 righe
- `TeacherDocumentsPage.tsx`: 1632 righe
- `StudentDocumentsModule.tsx`: 1490 righe
- `NotebookPage.tsx`: 1143 righe
- `StudentDashboard.tsx`: 979 righe
- `TeacherClassesSessionsManager.tsx`: 895 righe

Layer logic/theme rilevanti:

- `lib/api.ts`: 664 righe
- `hooks/useSocket.ts`: 615 righe
- `hooks/usePyodide.ts`: 396 righe

## Uso consigliato

Questo inventario serve per:

- capire cosa e' gia' disponibile
- evitare doppioni durante il refactor
- decidere quali parti promuovere a primitive o pattern
