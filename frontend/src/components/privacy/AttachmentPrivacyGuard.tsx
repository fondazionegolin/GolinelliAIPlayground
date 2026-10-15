import { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { AlertTriangle, CheckCircle2, Loader2, ShieldCheck, X } from '@/components/icons'
import { Button } from '@/components/ui/button'
import { privacyApi, type AnonymizePreview } from '@/lib/api'

type FileState = { status: 'loading' } | { status: 'ready'; preview: AnonymizePreview } | { status: 'error' }

interface Pending {
  files: File[]
  resolve: (files: File[]) => void
}

function FileRow({ file, state, included, onToggle }: {
  file: File
  state: FileState
  included: boolean
  onToggle: () => void
}) {
  const [open, setOpen] = useState(false)
  const preview = state.status === 'ready' ? state.preview : null
  return (
    <li className="rounded-lg border bg-white p-3">
      <div className="flex items-start gap-3">
        <input type="checkbox" checked={included} onChange={onToggle} className="mt-1 h-4 w-4 accent-[var(--logo-pink)]" aria-label={`Allega ${file.name}`} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-gray-900">{file.name}</p>
          {state.status === 'loading' && (
            <p className="mt-0.5 flex items-center gap-1.5 text-xs text-gray-500"><Loader2 className="h-3 w-3 animate-spin" />Analisi dei dati personali…</p>
          )}
          {state.status === 'error' && (
            <p className="mt-0.5 text-xs text-gray-500">Anteprima non disponibile: il file verrà comunque anonimizzato sul server.</p>
          )}
          {preview && preview.kind === 'image' && (
            <p className="mt-0.5 flex items-start gap-1.5 text-xs text-amber-700"><AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />{preview.note}</p>
          )}
          {preview && preview.kind === 'document' && !preview.supported && (
            <p className="mt-0.5 text-xs text-gray-500">{preview.note}</p>
          )}
          {preview && preview.supported && (
            preview.had_pii ? (
              <div className="mt-1 flex flex-wrap items-center gap-1.5">
                <span className="flex items-center gap-1 text-xs font-semibold text-emerald-700"><ShieldCheck className="h-3.5 w-3.5" />Anonimizzato:</span>
                {Object.entries(preview.counts).map(([k, n]) => (
                  <span key={k} className="rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">
                    {n} {preview.labels[k] ?? k}
                  </span>
                ))}
              </div>
            ) : (
              <p className="mt-0.5 flex items-center gap-1.5 text-xs text-gray-600"><CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />Nessun dato personale rilevato.</p>
            )
          )}
        </div>
        {preview?.supported && preview.text && (
          <button type="button" onClick={() => setOpen((o) => !o)} className="shrink-0 text-xs font-semibold text-[var(--logo-pink)] hover:underline">
            {open ? 'Nascondi copia' : 'Vedi copia anonimizzata'}
          </button>
        )}
      </div>
      {open && preview && (
        <pre className="mt-3 max-h-64 overflow-auto whitespace-pre-wrap rounded-md bg-gray-50 p-3 text-xs leading-relaxed text-gray-800">
          {preview.text.split(/(\[[A-ZÀ-Ý ]+\])/g).map((part, i) =>
            /^\[[A-ZÀ-Ý ]+\]$/.test(part)
              ? <mark key={i} className="rounded bg-[var(--logo-pink-14)] px-0.5 font-semibold text-[var(--logo-pink)]">{part}</mark>
              : <span key={i}>{part}</span>)}
          {preview.truncated ? '\n\n[…anteprima troncata…]' : ''}
        </pre>
      )}
    </li>
  )
}

function Dialog({ pending, onClose }: { pending: Pending; onClose: (files: File[]) => void }) {
  const { files } = pending
  const [states, setStates] = useState<FileState[]>(() => files.map(() => ({ status: 'loading' as const })))
  const [included, setIncluded] = useState<boolean[]>(() => files.map(() => true))

  useEffect(() => {
    let cancelled = false
    files.forEach((file, i) => {
      privacyApi.anonymizePreview(file)
        .then((res) => !cancelled && setStates((s) => s.map((x, j) => (j === i ? { status: 'ready', preview: res.data } : x))))
        .catch(() => !cancelled && setStates((s) => s.map((x, j) => (j === i ? { status: 'error' } : x))))
    })
    return () => { cancelled = true }
  }, [files])

  const selected = files.filter((_, i) => included[i])
  return (
    <div className="fixed inset-0 z-[300] flex items-center justify-center bg-black/50 p-3 backdrop-blur-sm" role="dialog" aria-modal="true">
      <div className="flex max-h-[90vh] w-full max-w-xl flex-col overflow-hidden rounded-2xl border bg-white shadow-2xl">
        <div className="flex items-start justify-between gap-3 border-b px-5 py-4">
          <div>
            <h2 className="text-base font-bold text-gray-900">Prima di allegare</h2>
            <p className="text-xs text-gray-500">Controllo dei dati personali sugli allegati</p>
          </div>
          <button type="button" onClick={() => onClose([])} className="text-gray-400 hover:text-gray-700" aria-label="Annulla"><X className="h-5 w-5" /></button>
        </div>
        <div className="space-y-4 overflow-y-auto px-5 py-4">
          <div className="flex items-start gap-3 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
            <p>
              <strong>Attenzione:</strong> sei sicuro che i dati che stai allegando non contengano dati personali?
              Per tua conoscenza, i dati verranno comunque anonimizzati: i nomi propri di persona diventano <code className="rounded bg-white/70 px-1">[NAME]</code>,
              e vengono mascherati anche e-mail, telefoni, codici fiscali, IBAN e indirizzi.
            </p>
          </div>
          <ul className="space-y-2">
            {files.map((file, i) => (
              <FileRow key={`${file.name}-${i}`} file={file} state={states[i]} included={included[i]}
                onToggle={() => setIncluded((inc) => inc.map((v, j) => (j === i ? !v : v)))} />
            ))}
          </ul>
        </div>
        <div className="flex items-center justify-end gap-2 border-t bg-gray-50 px-5 py-3">
          <Button variant="outline" onClick={() => onClose([])}>Annulla</Button>
          <Button onClick={() => onClose(selected)} disabled={selected.length === 0}>
            Allega {selected.length > 1 ? `${selected.length} file` : 'file'} (copia anonimizzata)
          </Button>
        </div>
      </div>
    </div>
  )
}

// ── Imperative API ───────────────────────────────────────────────────────────
// Mounted on demand in its own React root, so composers only need one function call
// (no provider, no JSX) and every chat entry point shares the same dialog.
let chain: Promise<unknown> = Promise.resolve()

/** Show the privacy alert + anonymized copy; resolves with the files the user confirmed ([] = cancelled). */
export function confirmAttachments(files: File[]): Promise<File[]> {
  if (files.length === 0) return Promise.resolve([])
  const run = () => new Promise<File[]>((resolve) => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)
    const close = (selected: File[]) => {
      root.unmount()
      host.remove()
      resolve(selected)
    }
    root.render(<Dialog pending={{ files, resolve }} onClose={close} />)
  })
  const result = chain.then(run, run)
  chain = result.catch(() => undefined)
  return result
}

let buffered: { file: File; cb: (file: File) => void }[] = []

/**
 * Per-file entry point: files added in the same tick (multi-select, drag & drop) are
 * grouped into a single dialog; `cb` runs for each file the user keeps.
 */
export function guardAttachment(file: File, cb: (file: File) => void): void {
  buffered.push({ file, cb })
  if (buffered.length > 1) return
  queueMicrotask(() => {
    const batch = buffered
    buffered = []
    void confirmAttachments(batch.map((b) => b.file)).then((kept) => {
      const keep = new Set(kept)
      batch.forEach((b) => { if (keep.has(b.file)) b.cb(b.file) })
    })
  })
}
