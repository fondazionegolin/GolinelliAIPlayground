# UI Phase 0 Completion

## Obiettivo della fase

Chiudere il perimetro iniziale del refactor prima di iniziare modifiche strutturali.

## Output prodotti

- inventario componenti: `docs/ui-inventory.md`
- duplicati principali: `docs/ui-duplicates.md`
- aree ad alto rischio: `docs/ui-high-risk-areas.md`
- task tracking generale: `docs/ui-refactor-tasklist.md`

## Criterio di completamento adottato

La Fase 0 si considera chiusa quando:

- esiste una branch dedicata al refactor
- esiste una tasklist sequenziale di progetto
- esiste un inventario dei layer UI esistenti
- esiste un elenco dei duplicati principali
- esiste una mappa delle aree ad alto rischio
- esiste un primo ordine di attacco condiviso

## Stato

Completato.

## Decisioni operative fissate

- si lavora solo su `uirefactor`
- non si entra subito nei monoliti
- si parte dai fondamentali del design system
- la prima pagina pilota raccomandata e' `TeacherClassesSessionsManager.tsx`
- i workspace documentali andranno affrontati solo con un approccio shared
- i sistemi chat non vanno toccati prima di avere shell, pattern e primitive stabili

## Prossima fase

Fase 1: foundations

Primo perimetro raccomandato:

- `frontend/src/design/tokens/*`
- `frontend/src/design/themes/*`
- ripulitura progressiva di `frontend/src/index.css`
- convergenza di `studentAccent.ts` e `teacherAccent.ts`
