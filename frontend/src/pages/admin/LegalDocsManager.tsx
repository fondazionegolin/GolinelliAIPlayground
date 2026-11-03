import { useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ExternalLink, FileText, Loader2, Upload } from '@/components/icons'
import { adminApi } from '@/lib/api'
import { useToast } from '@/components/ui/use-toast'
import { tl } from '@/i18n/tl'
import { Button } from '@/design'

type DocVersion = {
  version: string
  title: string
  filename: string | null
  size_bytes: number
  uploaded_at: string | null
  uploaded_by: string | null
  url: string
}

type ManagedDoc = {
  key: string
  title: string
  version: string
  source_url: string
  custom: boolean
  history: DocVersion[]
}

function formatDate(value?: string | null) {
  if (!value) return '—'
  return new Intl.DateTimeFormat('it-IT', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value))
}

function suggestVersion() {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}

export function LegalDocsManager() {
  const queryClient = useQueryClient()
  const { toast } = useToast()
  const [editing, setEditing] = useState<string | null>(null)
  const [version, setVersion] = useState('')
  const [title, setTitle] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const { data, isLoading } = useQuery<{ documents: ManagedDoc[] }>({
    queryKey: ['admin-legal-docs'],
    queryFn: async () => (await adminApi.getLegalDocs()).data,
  })

  const upload = useMutation({
    mutationFn: async (key: string) => {
      const form = new FormData()
      form.append('file', file as File)
      form.append('version', version.trim())
      if (title.trim()) form.append('title', title.trim())
      return (await adminApi.uploadLegalDoc(key, form)).data
    },
    onSuccess: (result) => {
      queryClient.setQueryData(['admin-legal-docs'], result)
      queryClient.invalidateQueries({ queryKey: ['admin-legal-consents'] })
      toast({ title: tl("Documento aggiornato"), description: tl("I docenti dovranno accettare la nuova versione al prossimo accesso.") })
      close()
    },
    onError: (error: any) => {
      toast({
        title: tl("Caricamento non riuscito"),
        description: error?.response?.data?.detail || tl("Riprova tra qualche secondo."),
        variant: 'destructive',
      })
    },
  })

  function open(doc: ManagedDoc) {
    setEditing(doc.key)
    setVersion(suggestVersion())
    setTitle('')
    setFile(null)
  }

  function close() {
    setEditing(null)
    setFile(null)
    if (fileRef.current) fileRef.current.value = ''
  }

  return (
    <div className="admin-panel">
      <div className="admin-panel-head !block">
        <h2 className="text-sm font-bold text-slate-900">{tl("Documenti in accettazione")}</h2>
        <p className="mt-0.5 text-xs text-slate-500">
          {tl("Carica un PDF per sostituire il documento mostrato ai docenti. Ogni nuova versione richiede una nuova accettazione.")}
        </p>
      </div>
      {isLoading ? (
        <div className="flex h-24 items-center justify-center text-sm text-slate-500">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          {tl("Caricamento")}
        </div>
      ) : (
        <ul className="divide-y divide-[var(--admin-line)]">
          {(data?.documents || []).map((doc) => (
            <li key={doc.key} className="px-4 py-3">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex min-w-0 items-start gap-3">
                  <FileText className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-slate-900">{doc.title}</p>
                    <p className="text-xs text-slate-500">
                      {tl("Versione")} {doc.version} · {doc.custom ? tl("PDF caricato") : tl("Documento predefinito")}
                    </p>
                  </div>
                </div>
                <div className="flex shrink-0 gap-2">
                  <Button asChild tone="neutral" surface="outline">
                    <a href={doc.source_url} target="_blank" rel="noreferrer">
                      {tl("Apri")} <ExternalLink className="h-3.5 w-3.5" />
                    </a>
                  </Button>
                  <Button tone="accent" surface="solid" onClick={() => (editing === doc.key ? close() : open(doc))}>
                    <Upload className="h-3.5 w-3.5" />
                    {tl("Carica nuova versione")}
                  </Button>
                </div>
              </div>

              {editing === doc.key && (
                <form
                  className="mt-3 grid gap-3 rounded-md border border-[var(--admin-line)] bg-[var(--admin-surface-2)] p-3 sm:grid-cols-[1fr_10rem_1fr]"
                  onSubmit={(event) => {
                    event.preventDefault()
                    if (file && version.trim()) upload.mutate(doc.key)
                  }}
                >
                  <label className="text-xs font-semibold text-slate-600">
                    {tl("File PDF (max 15 MB)")}
                    <input
                      ref={fileRef}
                      type="file"
                      accept="application/pdf,.pdf"
                      onChange={(event) => setFile(event.target.files?.[0] || null)}
                      className="mt-1 block w-full text-xs file:mr-3 file:rounded-md file:border-0 file:bg-white file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-slate-700"
                    />
                  </label>
                  <label className="text-xs font-semibold text-slate-600">
                    {tl("Versione")}
                    <input
                      value={version}
                      onChange={(event) => setVersion(event.target.value)}
                      className="mt-1 h-9 w-full rounded-md border border-[var(--admin-line-strong)] bg-white px-2 text-sm font-normal outline-none focus:border-[var(--admin-accent)] focus:ring-2 focus:ring-[var(--admin-accent-soft)]"
                    />
                  </label>
                  <label className="text-xs font-semibold text-slate-600">
                    {tl("Titolo (facoltativo)")}
                    <input
                      value={title}
                      onChange={(event) => setTitle(event.target.value)}
                      placeholder={doc.title}
                      className="mt-1 h-9 w-full rounded-md border border-[var(--admin-line-strong)] bg-white px-2 text-sm font-normal outline-none focus:border-[var(--admin-accent)] focus:ring-2 focus:ring-[var(--admin-accent-soft)]"
                    />
                  </label>
                  <div className="flex items-center justify-end gap-2 sm:col-span-3">
                    <Button type="button" tone="neutral" surface="ghost" onClick={close}>
                      {tl("Annulla")}
                    </Button>
                    <Button type="submit" tone="accent" surface="solid" disabled={!file || !version.trim() || upload.isPending}>
                      {upload.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                      {tl("Pubblica")}
                    </Button>
                  </div>
                </form>
              )}

              {doc.history.length > 0 && (
                <details className="mt-2 text-xs text-slate-500">
                  <summary className="cursor-pointer font-semibold">{tl("Versioni caricate")} ({doc.history.length})</summary>
                  <ul className="mt-1 space-y-1 pl-1">
                    {doc.history.map((item) => (
                      <li key={item.version}>
                        <a href={item.url} target="_blank" rel="noreferrer" className="font-medium text-[var(--admin-accent)] hover:underline">
                          {item.version}
                        </a>{' '}
                        · {formatDate(item.uploaded_at)} · {item.uploaded_by || '—'}
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
