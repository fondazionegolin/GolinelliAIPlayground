import { useEffect, useRef, useState } from 'react'
import { AlertCircle, BookOpen, CheckCircle2, Download, ExternalLink, FileText, RefreshCw, Upload, X } from '@/components/icons'
import { Button } from '@/design/primitives/Button'
import { Card } from '@/design/primitives/Card'
import { IconButton } from '@/design/primitives/IconButton'
import { SearchPill } from '@/design/primitives/SearchPill'
import { Select } from '@/design/primitives/Select'
import { Textarea } from '@/design/primitives/Textarea'
import { downloadCorpusTxt, importLibraryBook, libraryFetch, MAX_CORPUS_BYTES, type ImportProgress, type LibraryResults, type ToyLMCorpusSelection } from '@/lib/toyLMLibrary'

export type { ToyLMCorpusSelection } from '@/lib/toyLMLibrary'

const LANGUAGE_NAMES: Record<string, string> = { it: 'Italiano', en: 'Inglese', fr: 'Francese', es: 'Spagnolo', de: 'Tedesco', la: 'Latino' }

function formatBytes(bytes: number) {
  return bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toLocaleString('it-IT', { maximumFractionDigits: 1 })} MB` : `${Math.round(bytes / 1024).toLocaleString('it-IT')} KB`
}

function useElapsedSeconds(active: boolean) {
  const [seconds, setSeconds] = useState(0)
  useEffect(() => {
    setSeconds(0)
    if (!active) return
    const started = Date.now()
    const timer = window.setInterval(() => setSeconds(Math.floor((Date.now() - started) / 1000)), 1000)
    return () => window.clearInterval(timer)
  }, [active])
  return seconds
}

export default function ToyLMCorpusPicker({ value, onChange, onBusyChange }: {
  value: ToyLMCorpusSelection | null
  onChange: (selection: ToyLMCorpusSelection | null) => void
  onBusyChange: (busy: boolean) => void
}) {
  const [source, setSource] = useState<'file' | 'library'>('file')
  const [query, setQuery] = useState('')
  const [language, setLanguage] = useState('it')
  const [page, setPage] = useState(1)
  const [results, setResults] = useState<LibraryResults | null>(null)
  const [isSearching, setIsSearching] = useState(false)
  const [isImporting, setIsImporting] = useState(false)
  const [importingId, setImportingId] = useState<number | null>(null)
  const [importTitle, setImportTitle] = useState('')
  const [progress, setProgress] = useState<ImportProgress | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [error, setError] = useState('')
  const [searchError, setSearchError] = useState('')
  const [searchAttempt, setSearchAttempt] = useState(0)
  const [pastedText, setPastedText] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const importRef = useRef<AbortController | null>(null)
  const fileReaderRef = useRef<FileReader | null>(null)
  const elapsed = useElapsedSeconds(isImporting)
  const searchElapsed = useElapsedSeconds(isSearching)

  useEffect(() => {
    onBusyChange(isImporting)
    return () => onBusyChange(false)
  }, [isImporting, onBusyChange])

  useEffect(() => () => { importRef.current?.abort(); fileReaderRef.current?.abort() }, [])

  useEffect(() => {
    if (source !== 'library' || value || isImporting) return
    const controller = new AbortController()
    setIsSearching(true)
    setSearchError('')
    const timer = window.setTimeout(async () => {
      try {
        const params = new URLSearchParams({ q: query.trim(), language, page: String(page) })
        const data = await libraryFetch<LibraryResults>(`?${params}`, controller.signal)
        if (!controller.signal.aborted) setResults(data)
      } catch (cause) {
        if (!controller.signal.aborted) setSearchError((cause as Error).message)
      } finally {
        if (!controller.signal.aborted) setIsSearching(false)
      }
    }, 400)
    return () => { window.clearTimeout(timer); controller.abort() }
  }, [source, query, language, page, value, searchAttempt, isImporting])

  const readFile = async (files: FileList | File[]) => {
    if (isImporting) return
    setError('')
    if (files.length !== 1) { setError('Scegli un solo file: ogni modello viene addestrato su un unico testo.'); return }
    const file = files[0]
    if (!/\.(txt|md)$/i.test(file.name)) { setError('Carica un file di testo in formato .txt o .md.'); return }
    if (file.size > MAX_CORPUS_BYTES) { setError('Il file supera 50 MB. Scegli un file più piccolo: non importeremo un estratto.'); return }
    setIsImporting(true)
    setImportTitle(file.name)
    setProgress({ type: 'status', stage: 'reading', message: 'Lettura del file completo…' })
    try {
      const text = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        fileReaderRef.current = reader
        reader.onprogress = event => setProgress({ type: 'progress', stage: 'reading', receivedBytes: event.loaded, totalBytes: event.lengthComputable ? event.total : null })
        reader.onload = () => resolve(String(reader.result).replace(/^\uFEFF/, ''))
        reader.onerror = () => reject(new Error('Impossibile leggere il file. Riprova.'))
        reader.onabort = () => reject(new Error('Lettura annullata.'))
        reader.readAsText(file, 'UTF-8')
      })
      if (!text.trim()) throw new Error('Il file è vuoto. Scegli un testo per il training.')
      if (text.includes('\u0000') || text.includes('\uFFFD')) throw new Error('Il file non è un testo UTF-8 valido. Salvalo come TXT UTF-8 e riprova.')
      const byteCount = new Blob([text]).size
      if (byteCount > MAX_CORPUS_BYTES) throw new Error('Il testo supera 50 MB. Il file non è stato importato.')
      onChange({ title: file.name, text, truncated: false, byteCount, wordCount: text.split(/\s+/).filter(Boolean).length })
    } catch (cause) { setError((cause as Error).message) }
    finally { setIsImporting(false); fileReaderRef.current = null; if (inputRef.current) inputRef.current.value = '' }
  }

  const importBook = async (book: NonNullable<LibraryResults['results']>[number]) => {
    if (isImporting) return
    const controller = new AbortController()
    importRef.current = controller
    setError('')
    setIsImporting(true)
    setImportingId(book.id)
    setImportTitle(book.title)
    setProgress({ type: 'status', stage: 'metadata', message: 'Connessione alla biblioteca…' })
    try {
      const selection = await importLibraryBook(book.id, controller.signal, event => {
        setProgress(previous => event.stage === 'verifying' ? { ...previous, ...event } : event)
      })
      if (!controller.signal.aborted) onChange(selection)
    } catch (cause) { setError(controller.signal.aborted ? 'Download annullato. Nessun testo parziale è stato importato.' : (cause as Error).message) }
    finally { setIsImporting(false); setImportingId(null); importRef.current = null }
  }

  const usePastedText = () => {
    setError('')
    if (new Blob([pastedText]).size > MAX_CORPUS_BYTES) { setError('Il testo supera 50 MB. Non è stato importato.'); return }
    onChange({ title: 'Testo incollato', text: pastedText, truncated: false, byteCount: new Blob([pastedText]).size, wordCount: pastedText.trim().split(/\s+/).length })
  }

  const received = progress?.receivedBytes ?? 0
  const total = progress?.totalBytes
  const percentage = total ? Math.min(100, Math.floor(received / total * 100)) : undefined
  const phase = progress?.message ?? (progress?.stage === 'reading' ? 'Lettura del file completo…' : 'Download del TXT integrale…')

  return (
    <section className="space-y-3" aria-label="Testo per il training">
      <div className="flex flex-wrap items-center justify-between gap-1">
        <h3 className="text-xs font-bold text-[var(--text-primary)]">1. Scegli un testo</h3>
        <span className="text-[11px] text-[var(--text-muted)]">Un libro intero · un solo corpus</span>
      </div>

      {value ? (
        <Card surface="muted" className="space-y-4 p-4">
          <div className="flex items-start gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[var(--control-radius)] bg-[var(--logo-violet-10)] text-[var(--logo-violet-strong)]"><CheckCircle2 className="h-5 w-5" /></span>
            <div className="min-w-0 flex-1">
              <p className="break-words text-sm font-bold">{value.title}</p>
              {!!value.authors?.length && <p className="mt-1 text-xs text-[var(--text-secondary)]">{value.authors.join(', ')}</p>}
              <p className="mt-2 text-xs font-semibold text-[var(--app-accent-text)]">{value.sourceUrl ? 'Libro integrale importato' : 'Testo completo importato'}</p>
              <p className="mt-1 text-[11px] leading-5 text-[var(--text-muted)]">{value.text.length.toLocaleString('it-IT')} caratteri · {(value.wordCount ?? value.text.trim().split(/\s+/).length).toLocaleString('it-IT')} parole · {formatBytes(value.byteCount ?? new Blob([value.text]).size)}</p>
            </div>
            <IconButton tone="neutral" surface="ghost" size="sm" onClick={() => { onChange(null); setError(''); setPastedText('') }} aria-label="Rimuovi testo e scegli un altro corpus"><X /></IconButton>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button tone="accent" surface="soft" density="compact" onClick={() => downloadCorpusTxt(value)}><Download /> Scarica TXT completo</Button>
            {value.sourceUrl && <Button asChild tone="neutral" surface="ghost" density="compact"><a href={value.sourceUrl} target="_blank" rel="noreferrer"><ExternalLink /> Scheda dell’opera</a></Button>}
          </div>
          <details className="border-t border-[var(--border-subtle)] pt-3">
            <summary className="cursor-pointer text-xs font-semibold text-[var(--text-secondary)]">Anteprima: inizio e fine del testo</summary>
            <p className="mt-2 text-[11px] leading-5 text-[var(--text-muted)]">Questa è solo un’anteprima. Il file TXT e il corpus per il training contengono tutto il testo importato.</p>
            <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-words text-xs leading-5 text-[var(--text-secondary)]">{value.text.length > 4000 ? `${value.text.slice(0, 2500)}\n\n[… anteprima abbreviata …]\n\n${value.text.slice(-1500)}` : value.text}</pre>
          </details>
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2" role="group" aria-label="Origine del testo">
            {([['file', Upload, 'Carica un testo'], ['library', BookOpen, 'Cerca online']] as const).map(([key, Icon, label]) => (
              <Button key={key} tone={source === key ? 'accent' : 'neutral'} surface={source === key ? 'solid' : 'soft'} disabled={isImporting} aria-pressed={source === key} onClick={() => { setSource(key); setError('') }}><Icon />{label}</Button>
            ))}
          </div>
          {source === 'file' ? (
            <>
              <Button tone="neutral" surface="outline" disabled={isImporting}
                onDragOver={event => { event.preventDefault(); setIsDragging(true) }} onDragLeave={() => setIsDragging(false)}
                onDrop={event => { event.preventDefault(); setIsDragging(false); void readFile(event.dataTransfer.files) }} onClick={() => inputRef.current?.click()}
                className={`h-auto w-full flex-col gap-2 whitespace-normal px-4 py-7 ${isDragging ? 'bg-[var(--logo-violet-10)] shadow-[var(--focus-shadow)]' : ''}`}>
                <Upload className="!h-6 !w-6 text-[var(--app-accent-text)]" />
                <span className="text-sm font-semibold">Trascina un testo qui o scegli un file</span>
                <span className="text-[11px] font-normal text-[var(--text-muted)]">TXT o Markdown · file completo, senza tagli · fino a 50 MB</span>
              </Button>
              <input ref={inputRef} type="file" accept=".txt,.md,text/plain,text/markdown" className="hidden" aria-label="Carica un solo file di testo" onChange={event => { if (event.target.files?.length) void readFile(event.target.files) }} />
              <details className="text-xs text-[var(--text-secondary)]"><summary className="cursor-pointer font-semibold">Oppure incolla un testo</summary>
                <div className="mt-3 space-y-2"><Textarea aria-label="Testo da incollare" value={pastedText} disabled={isImporting} onChange={event => setPastedText(event.target.value)} rows={4} placeholder="Incolla il testo da usare come unico corpus…" />
                  <Button tone="neutral" surface="outline" density="compact" disabled={!pastedText.trim() || isImporting} onClick={usePastedText}><FileText /> Usa questo testo</Button>
                </div>
              </details>
            </>
          ) : (
            <Card surface="muted" className="space-y-4 p-4">
              <div className="flex items-start gap-3"><BookOpen className="mt-0.5 h-5 w-5 shrink-0 text-[var(--app-accent-text)]" /><div><p className="text-sm font-bold">Biblioteca di Project Gutenberg</p><p className="mt-1 text-xs leading-5 text-[var(--text-secondary)]">Cerca un titolo o un autore e importa il libro intero in TXT.</p></div></div>
              <div className="flex flex-col gap-2 sm:flex-row">
                <SearchPill aria-label="Cerca un titolo o un autore" value={query} maxLength={200} onValueChange={next => { setQuery(next); setPage(1) }} className="shrink-0 sm:flex-1" placeholder="Pinocchio, Dante, Austen…" disabled={isImporting} />
                <div className="sm:w-36"><Select aria-label="Lingua del testo" value={language} onChange={event => { setLanguage(event.target.value); setPage(1) }} disabled={isImporting}><option value="">Tutte le lingue</option>{Object.entries(LANGUAGE_NAMES).map(([code, name]) => <option key={code} value={code}>{name}</option>)}</Select></div>
              </div>
              {isSearching && !isImporting && <div role="status" className="flex items-center gap-2 text-xs text-[var(--text-secondary)]"><RefreshCw className="h-4 w-4 animate-spin text-[var(--app-accent-text)]" /><span>{searchElapsed < 5 ? 'Ricerca nella biblioteca…' : `Preparazione del catalogo, attendi… ${searchElapsed} s`}</span></div>}
              {searchError && !isImporting && <div role="alert" className="space-y-2 text-xs text-[var(--text-secondary)]"><p>{searchError}</p><Button tone="neutral" surface="outline" density="compact" onClick={() => setSearchAttempt(attempt => attempt + 1)}><RefreshCw /> Riprova la ricerca</Button></div>}
              {!isSearching && !searchError && results && <p className="text-[11px] text-[var(--text-muted)]">{results.total?.toLocaleString('it-IT') ?? results.results.length} {(results.total ?? results.results.length) === 1 ? 'opera trovata' : 'opere trovate'}{results.results.length === 0 ? '. Prova un altro titolo, autore o lingua.' : ''}</p>}
              {results && !searchError && <ul className={`max-h-72 space-y-2 overflow-y-auto ${isSearching ? 'opacity-50' : ''}`}>
                {results.results.map(book => <li key={book.id} className="flex items-center gap-3 rounded-[var(--control-radius)] bg-[var(--ds-surface)] p-3">
                  <div className="min-w-0 flex-1"><p className="break-words text-xs font-bold">{book.title}</p><p className="mt-1 text-[11px] leading-4 text-[var(--text-muted)]">{book.authors.join(', ') || 'Autore anonimo'} · {book.languages.map(code => LANGUAGE_NAMES[code] ?? code).join(', ')}</p></div>
                  <Button tone="accent" surface="soft" density="compact" disabled={isImporting || isSearching} onClick={() => void importBook(book)} aria-label={`Importa il libro completo: ${book.title}`}>{importingId === book.id ? <RefreshCw className="animate-spin" /> : <Download />}<span className="hidden sm:inline">Importa</span></Button>
                </li>)}
              </ul>}
              {results && (page > 1 || results.hasNext) && <div className="flex items-center justify-between gap-2"><Button tone="neutral" surface="ghost" density="compact" disabled={page === 1 || isSearching || isImporting} onClick={() => setPage(p => p - 1)}>Precedenti</Button><span className="text-xs text-[var(--text-muted)]">Pagina {page}</span><Button tone="neutral" surface="ghost" density="compact" disabled={!results.hasNext || isSearching || isImporting} onClick={() => setPage(p => p + 1)}>Successivi</Button></div>}
              <p className="border-t border-[var(--border-subtle)] pt-3 text-[10px] leading-4 text-[var(--text-muted)]">Catalogo ufficiale Gutenberg, disponibile anche quando la ricerca esterna non risponde. Prima dell’importazione verifichiamo il TXT e lo stato di pubblico dominio negli USA; consulta la scheda per i diritti nel tuo Paese.</p>
            </Card>
          )}
        </>
      )}
      {isImporting && <Card surface="muted" className="space-y-3 p-4" role="status" aria-live="polite">
        <div className="flex items-start gap-3"><RefreshCw className="mt-0.5 h-4 w-4 shrink-0 animate-spin text-[var(--app-accent-text)]" /><div className="min-w-0 flex-1"><p className="text-xs font-bold">{phase}</p><p className="mt-1 break-words text-xs text-[var(--text-secondary)]">{importTitle}</p></div><Button tone="neutral" surface="ghost" density="compact" aria-label="Annulla download del testo" onClick={() => { importRef.current?.abort(); fileReaderRef.current?.abort() }}>Annulla</Button></div>
        <div role="progressbar" aria-label="Avanzamento download del libro" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percentage} aria-valuetext={percentage === undefined ? phase : `${percentage}%`} className="h-1.5 overflow-hidden rounded-full bg-[var(--ds-control)]"><div className={`h-full rounded-full bg-[var(--app-accent)] transition-[width] duration-200 ${percentage === undefined ? 'w-1/3 animate-pulse' : ''}`} style={percentage === undefined ? undefined : { width: `${percentage}%` }} /></div>
        <div className="flex justify-between gap-2 text-[11px] text-[var(--text-muted)]"><span>{progress?.receivedBytes !== undefined ? `${formatBytes(received)}${total ? ` di ${formatBytes(total)} · ${percentage}%` : ' ricevuti'}` : 'In attesa della biblioteca'} · {elapsed} s</span><span>TXT integrale</span></div>
        {elapsed >= 10 && <p className="text-[11px] leading-5 text-[var(--text-secondary)]">La biblioteca sta rispondendo lentamente. Il download continua; puoi annullarlo e riprovare.</p>}
      </Card>}
      {error && <Card surface="muted" className="flex items-start gap-2 p-3 text-xs leading-5 text-[var(--text-secondary)]" role="alert"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-[var(--app-accent-text)]" /><p>{error}</p></Card>}
    </section>
  )
}
