# Changelog Release Workflow

## Obiettivo

Ogni push che introduce feature, miglioramenti o fix rilevanti deve produrre anche una release nel changelog visibile dal badge `BETA`.

## Workflow operativo

1. Il hook git `pre-push` esegue `scripts/generate_git_changelog.py`.
2. Lo script legge i commit nuovi e genera una bozza in `frontend/public/changelog/git-draft.json`.
3. In `Admin > Backend > Changelog` si usa `Usa bozza git` per importare il draft.
4. Si rifinisce la release se serve.
5. La release viene pubblicata con:
   - `version_label`
   - `title`
   - `summary`
   - una o più `items`
   - eventuale `git_ref`
6. Solo dopo la release note si procede al push.

## Convenzione consigliata

- `new`: feature nuove percepibili dagli utenti
- `improved`: miglioramenti di UX, performance o flussi esistenti
- `fixed`: bugfix e correzioni comportamentali

## Nota pratica

Quando in chat viene richiesto un `push`, il passaggio corretto è:

1. lasciare che il hook generi la bozza git
2. importarla nel changelog backend
3. rifinirla se necessario
4. eseguire il push git

Questo mantiene il modal `BETA` coerente con lo stato reale della piattaforma.
