import { useEffect, useRef, useState, type FormEvent } from 'react'
import { v4 as uuid } from 'uuid'
import ReactMarkdown from 'react-markdown'
import remarkMath from 'remark-math'
import remarkGfm from 'remark-gfm'
import rehypeKatex from 'rehype-katex'
import 'katex/dist/katex.min.css'
import { Check, History, Loader2, Pencil, Plus, Search, Send, Sparkles, Trash2, Upload, X } from '@/components/icons'
import api from '@/lib/api'
import { useAuthStore } from '@/stores/auth'
import VisualStage from '@/components/visual-comprehension/VisualStage'
import type { Overlay, SavedVisualMessage, SavedVisualSession, Selection, SourceImage, StudentNote, VisualSessionItem } from '@/components/visual-comprehension/types'
import type { DrawingScene } from '@/components/visual-comprehension/blackboard'
import './visual-comprehension.css'
import { tl } from '@/i18n/tl'

const BASE = '/admin/visual-comprehension/sessions'
const STARTERS = [tl("Guidami passo per passo"), tl("Spiegami il contenuto completo"), tl("Aiutami a metterlo in pratica")]
const ZONE_QUESTIONS = [tl("Cos’è?"), tl("A cosa serve?"), tl("Spiegamelo passo passo")]
const SHAPE_NAMES: Record<Selection['shape'], string> = { rect: tl("rettangolo"), lasso: 'lazo', scribble: 'scarabocchio', brush: 'pennello' }

/** The tutor's quick choices: one click per question (or a short free answer), then everything is sent together. */
function QuestionForm({ questions, disabled, onSubmit }: { questions: Array<{ question: string; options: string[] }>; disabled: boolean; onSubmit: (text: string) => void }) {
  const [answers, setAnswers] = useState<Record<number, string>>({})
  const [other, setOther] = useState<Record<number, string>>({})
  const ready = questions.every((_, i) => (answers[i] || other[i] || '').trim())
  return <div className="vc-questions">
    {questions.map((q, i) => <div key={i} className="vc-question"><p>{q.question}</p><div className="vc-question-options">
      {q.options.map(option => <button key={option} type="button" disabled={disabled} className={answers[i] === option ? 'vc-option-on' : ''}
        onClick={() => { setAnswers(a => ({ ...a, [i]: option })); setOther(o => ({ ...o, [i]: '' })) }}>{option}</button>)}
      <input aria-label={tl("Altra risposta: {0}", q.question)} placeholder={tl("Altro…")} value={other[i] || ''} disabled={disabled}
        onChange={e => { const text = e.target.value; setOther(o => ({ ...o, [i]: text })); if (text) setAnswers(a => { const next = { ...a }; delete next[i]; return next }) }} />
    </div></div>)}
    <button type="button" className="vc-questions-send" disabled={disabled || !ready}
      onClick={() => onSubmit('Risposte:\n' + questions.map((q, i) => `• ${q.question} → ${(other[i] || answers[i]).trim()}`).join('\n'))}>{tl("Costruiscilo")}<Send /></button>
  </div>
}

function Text({ children }: { children: string }) {
  return <div className="vc-markdown"><ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeKatex]} disallowedElements={['img']} skipHtml>{children}</ReactMarkdown></div>
}

async function readImage(file: File): Promise<string> {
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) throw new Error(tl("Scegli un file PNG, JPEG o WebP."))
  if (file.size > 8 * 1024 * 1024) throw new Error(tl("L’immagine supera 8 MB. Usa un ritaglio o un file più piccolo."))
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(new Error(tl("Impossibile leggere il file.")))
    reader.readAsDataURL(file)
  })
}

function errorMessage(err: unknown, fallback: string) {
  const detail = (err as { response?: { data?: { detail?: unknown } } }).response?.data?.detail
  return typeof detail === 'string' ? detail : err instanceof Error && !('response' in err) ? err.message : fallback
}

export default function VisualComprehensionPage() {
  const userId = useAuthStore(s => s.user?.id) || 'admin'
  const lastKey = `visual-last-session:${userId}`
  const [current, setCurrent] = useState<SavedVisualSession | null>(null)
  const [image, setImage] = useState<SourceImage | null>(null)
  const [sessions, setSessions] = useState<VisualSessionItem[]>([])
  const [drawer, setDrawer] = useState(false)
  const [query, setQuery] = useState('')
  const [draft, setDraft] = useState('')
  const [loading, setLoading] = useState(true)
  const [reading, setReading] = useState(false)
  const [sending, setSending] = useState(false)
  const [saveStatus, setSaveStatus] = useState<'saved' | 'saving' | 'local'>('saved')
  const [error, setError] = useState('')
  const [dragging, setDragging] = useState(false)
  const [focus, setFocus] = useState<{ key: string; overlays: Overlay[]; drawing?: DrawingScene } | null>(null)
  const [reviewing, setReviewing] = useState<string | null>(null)
  const [selection, setSelection] = useState<Selection | null>(null)
  const [focusWidget, setFocusWidget] = useState<{ id: string; nonce: number } | null>(null)
  const [redrawing, setRedrawing] = useState<string | null>(null)
  // The student's own notes on the canvas: kept apart from `current`, which polling replaces while the tutor works.
  const [notes, setNotes] = useState<StudentNote[]>([])
  const savedNotes = useRef('[]')
  const fileInput = useRef<HTMLInputElement>(null)
  const answerInput = useRef<HTMLTextAreaElement>(null)
  const history = useRef<HTMLDivElement>(null)
  const activeId = useRef<string | null>(null)
  const generation = useRef(0)
  const controller = useRef<AbortController | null>(null)
  const imageUrl = useRef<string | null>(null)
  const locked = useRef(false)
  const mounted = useRef(true)
  const busy = sending || !!current?.busy
  const draftKey = (id: string) => `visual-draft:${userId}:${id}`

  function restoreDraft(data: SavedVisualSession) {
    try {
      const cached = JSON.parse(localStorage.getItem(draftKey(data.id)) || 'null')
      if (cached?.text) {
        const alreadySent = data.messages.some(m => m.role === 'user' && m.content === cached.text.trim() && new Date(m.created_at).getTime() >= cached.time)
        if (!alreadySent) return String(cached.text)
        localStorage.removeItem(draftKey(data.id))
      }
    } catch { /* use the server draft */ }
    return data.draft || ''
  }

  function applySession(data: SavedVisualSession) {
    setCurrent(data); setDraft(restoreDraft(data)); setFocus(null); setSaveStatus('saved')
  }

  async function refreshSessions(search = '') {
    const response = await api.get<VisualSessionItem[]>(BASE, { params: { query: search } })
    setSessions(response.data)
    return response.data
  }

  async function openSession(id: string) {
    if (!mounted.current) return
    const version = ++generation.current
    controller.current?.abort(); controller.current = null
    activeId.current = id; locked.current = false
    setSending(false); setLoading(true); setError(''); setDrawer(false)
    try {
      const { data } = await api.get<SavedVisualSession>(`${BASE}/${id}`)
      const source = await api.get<Blob>(data.image_url, { responseType: 'blob' })
      if (version !== generation.current) return
      const url = URL.createObjectURL(source.data)
      if (imageUrl.current) URL.revokeObjectURL(imageUrl.current)
      imageUrl.current = url
      setImage({ url, name: data.image_name, width: data.image_width, height: data.image_height })
      applySession(data)
      const stored = data.dialogue.student_notes || []
      setNotes(stored); savedNotes.current = JSON.stringify(stored)
      localStorage.setItem(lastKey, id)
    } catch (err) {
      if (version === generation.current) {
        activeId.current = null; setCurrent(null); setImage(null)
        setError(errorMessage(err, tl("Impossibile aprire la sessione.")))
      }
    } finally { if (version === generation.current) setLoading(false) }
  }

  useEffect(() => {
    mounted.current = true
    let alive = true
    void (async () => {
      try {
        const rows = await refreshSessions()
        if (!alive) return
        const last = localStorage.getItem(lastKey)
        if (last || rows.length) await openSession(last || rows[0].id)
        else setLoading(false)
      } catch (err) { if (alive) { setLoading(false); setError(errorMessage(err, tl("Impossibile caricare le sessioni salvate."))) } }
    })()
    return () => { alive = false; mounted.current = false; ++generation.current; controller.current?.abort(); if (imageUrl.current) URL.revokeObjectURL(imageUrl.current) }
  }, [userId])

  useEffect(() => {
    if (!drawer) return
    let alive = true
    const timer = window.setTimeout(() => { void api.get<VisualSessionItem[]>(BASE, { params: { query } }).then(r => { if (alive) setSessions(r.data) }).catch(() => undefined) }, 200)
    return () => { alive = false; clearTimeout(timer) }
  }, [drawer, query])

  useEffect(() => {
    if (!current?.busy || sending) return
    const id = current.id
    let alive = true
    const timer = window.setInterval(() => {
      void api.get<SavedVisualSession>(`${BASE}/${id}`).then(r => {
        if (alive && activeId.current === id) {
          applySession(r.data)
          if (!r.data.busy) void refreshSessions().catch(() => undefined)
        }
      }).catch(() => undefined)
    }, 1800)
    return () => { alive = false; clearInterval(timer) }
  }, [current?.id, current?.busy, sending])

  useEffect(() => {
    if (!current || loading || busy || draft === current.draft) return
    const { id, revision } = current
    setSaveStatus('saving')
    const timer = window.setTimeout(() => {
      void api.patch(`${BASE}/${id}`, { draft, revision }).then(() => {
        if (activeId.current === id) setSaveStatus('saved')
      }).catch(() => { if (activeId.current === id) setSaveStatus('local') })
    }, 650)
    return () => clearTimeout(timer)
  }, [current?.id, current?.revision, draft, loading, busy])

  useEffect(() => {
    const json = JSON.stringify(notes)
    if (!current || loading || json === savedNotes.current) return
    const id = current.id
    const timer = window.setTimeout(() => {
      void api.patch(`${BASE}/${id}`, { notes }).then(() => { if (activeId.current === id) savedNotes.current = json })
        .catch(() => { if (activeId.current === id) setSaveStatus('local') })
    }, 600)
    return () => clearTimeout(timer)
  }, [current?.id, notes, loading]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { if (history.current) history.current.scrollTop = history.current.scrollHeight }, [current?.messages.length, busy])

  function newSession() {
    ++generation.current; controller.current?.abort(); controller.current = null
    activeId.current = null; locked.current = false
    setCurrent(null); setImage(null); setDraft(''); setNotes([]); savedNotes.current = '[]'; setFocus(null); setSending(false); setLoading(false); setError(''); setDrawer(false)
    if (imageUrl.current) { URL.revokeObjectURL(imageUrl.current); imageUrl.current = null }
    localStorage.removeItem(lastKey)
  }

  async function upload(file?: File) {
    if (!file || reading) return
    setReading(true); setError('')
    try {
      const dataUrl = await readImage(file)
      const { data } = await api.post<SavedVisualSession>(BASE, {
        image: dataUrl, image_name: file.name.slice(0, 250), title: file.name.replace(/\.[^.]+$/, '').slice(0, 200) || 'Nuova sessione',
      }, { timeout: 45000 })
      await refreshSessions()
      await openSession(data.id)
    } catch (err) { setError(errorMessage(err, tl("Salvataggio dell’immagine non riuscito."))) }
    finally { setReading(false); if (fileInput.current) fileInput.current.value = '' }
  }

  const uploadRef = useRef(upload)
  uploadRef.current = upload
  useEffect(() => {
    const paste = (e: ClipboardEvent) => {
      const files = Array.from(e.clipboardData?.files || [])
      if (files.length) { e.preventDefault(); if (files.length === 1) void uploadRef.current(files[0]); else setError(tl("Carica una sola immagine alla volta.")) }
    }
    window.addEventListener('paste', paste)
    return () => window.removeEventListener('paste', paste)
  }, [])

  async function demo() {
    if (reading) return
    setReading(true); setError('')
    try {
      const source = new Image()
      await new Promise<void>((resolve, reject) => { source.onload = () => resolve(); source.onerror = reject; source.src = '/visual-comprehension-addition.svg' })
      const canvas = document.createElement('canvas'); canvas.width = source.naturalWidth; canvas.height = source.naturalHeight
      canvas.getContext('2d')!.drawImage(source, 0, 0)
      const { data } = await api.post<SavedVisualSession>(BASE, { image: canvas.toDataURL('image/png'), image_name: 'Addizione in colonna', title: 'Un’addizione, insieme' })
      await refreshSessions(); await openSession(data.id)
    } catch (err) { setError(errorMessage(err, tl("Impossibile aprire l’esempio."))) }
    finally { setReading(false) }
  }

  async function send(content = draft, retry?: SavedVisualMessage) {
    const text = content.trim()
    if (!current || !text || busy || locked.current) return
    const id = current.id
    const requestId = retry?.request_id || uuid()
    const abort = new AbortController(); controller.current = abort; locked.current = true
    const zone = retry ? undefined : selection ?? undefined
    setSending(true); setDraft(''); setError(''); setFocus(null); setSaveStatus('saving'); setSelection(null)
    const optimistic: SavedVisualMessage = { id: uuid(), request_id: requestId, role: 'user', content: text, status: 'pending', created_at: new Date().toISOString(), selection: zone }
    setCurrent(previous => previous?.id === id ? { ...previous, busy: true, messages: retry
      ? previous.messages.map(m => m.id === retry.id ? { ...m, status: 'pending', error: null } : m)
      : [...previous.messages, optimistic] } : previous)
    try {
      const { data } = await api.post<SavedVisualSession>(`${BASE}/${id}/messages`, { content: text, request_id: requestId, revision: current.revision, notes, ...(zone ? { selection: zone } : {}) }, { timeout: 175000, signal: abort.signal })
      localStorage.removeItem(draftKey(id))
      if (activeId.current === id) {
        applySession(data)
        // What was asked for comes first: a new interactive card is shown right away, the tour waits on its card.
        const fresh = [...data.messages].reverse().find(m => m.role === 'assistant')?.widgets?.at(-1)
        if (fresh) setFocusWidget({ id: fresh.id, nonce: Date.now() })
        void reviewLatest(data)
      }
      void refreshSessions().catch(() => undefined)
    } catch (err) {
      if (activeId.current === id && !abort.signal.aborted) {
        try {
          const { data } = await api.get<SavedVisualSession>(`${BASE}/${id}`)
          if (activeId.current === id) {
            applySession(data)
            if (!data.messages.some(m => m.request_id === requestId)) setDraft(text)
            if (!data.busy) setError(errorMessage(err, tl("La richiesta non è riuscita. Puoi riprovare.")))
          }
        } catch { setError(tl("Connessione interrotta. La bozza è conservata su questo dispositivo.")); setDraft(text) }
      }
    } finally {
      if (controller.current === abort) { controller.current = null; locked.current = false; setSending(false); requestAnimationFrame(() => answerInput.current?.focus({ preventScroll: true })) }
    }
  }

  /** Art-direction pass on a fresh drawing: rendered here, judged and fixed by the server, then animated. */
  async function reviewLatest(data: SavedVisualSession) {
    const message = [...data.messages].reverse().find(m => m.role === 'assistant')
    if (!message?.focus?.drawing || message.focus.review || !image) return
    setReviewing(message.id)
    try {
      const { snapshotDrawing } = await import('@/components/visual-comprehension/snapshot')
      const { png, issues } = await snapshotDrawing(message.focus.drawing, data.inventory?.grounding.regions || [], image)
      const { data: reviewed } = await api.post<SavedVisualSession>(`${BASE}/${data.id}/messages/${message.id}/review`, { image: png, issues }, { timeout: 100000 })
      if (activeId.current === data.id) setCurrent(previous => previous?.id === data.id ? { ...previous, messages: reviewed.messages, dialogue: reviewed.dialogue } : previous)
    } catch { /* the unreviewed drawing is still a valid drawing */ }
    finally { setReviewing(null) }
  }

  async function redraw(message: SavedVisualMessage) {
    if (!current || redrawing) return
    const id = current.id
    setRedrawing(message.id); setError('')
    try {
      const { data } = await api.post<SavedVisualSession>(`${BASE}/${id}/messages/${message.id}/redraw`, {}, { timeout: 130000 })
      if (activeId.current === id) {
        setCurrent(previous => previous?.id === id ? { ...previous, messages: data.messages, dialogue: data.dialogue } : previous)
        setFocus({ key: `${message.id}:redraw`, overlays: [], drawing: data.messages.find(m => m.id === message.id)?.focus?.drawing })
      }
    } catch (err) { setError(errorMessage(err, tl("Il disegno non è riuscito."))) }
    finally { setRedrawing(null) }
  }

  async function rename(item: VisualSessionItem) {
    const title = window.prompt('Nome della sessione', item.title)?.trim()
    if (!title || title === item.title) return
    try {
      const { data } = await api.patch<SavedVisualSession>(`${BASE}/${item.id}`, { title: title.slice(0, 200) })
      if (activeId.current === item.id) setCurrent(previous => previous && { ...previous, title: data.title })
      await refreshSessions(query)
    } catch (err) { setError(errorMessage(err, tl("Impossibile rinominare la sessione."))) }
  }

  async function remove(item: VisualSessionItem) {
    if (!window.confirm(tl("Eliminare la sessione “{0}” e la sua immagine?", item.title))) return
    try {
      await api.delete(`${BASE}/${item.id}`)
      localStorage.removeItem(draftKey(item.id))
      if (activeId.current === item.id) newSession()
      await refreshSessions(query)
    } catch (err) { setError(errorMessage(err, tl("Impossibile eliminare la sessione."))) }
  }

  const lastAssistant = [...(current?.messages || [])].reverse().find(m => m.role === 'assistant')
  const overlays = focus ? focus.overlays : current?.dialogue.overlays || []
  const drawing = focus ? focus.drawing : current?.dialogue.drawing

  return <div className="vc-page">
    <header className="vc-header">
      <div className="vc-header-left"><button className="vc-sessions-button" aria-expanded={drawer} onClick={() => setDrawer(v => !v)}><History />{tl("Sessioni")}</button><span className="vc-header-divider" /><h1>{tl("Comprensione visuale")} <span>Beta</span></h1></div>
      <div className="vc-header-actions"><span className="vc-save-status" role="status">{current && (saveStatus === 'saving' || busy ? <><Loader2 className="animate-spin" />{tl("Salvataggio…")}</> : saveStatus === 'local' ? tl("Bozza sul dispositivo") : <><Check />{tl("Salvata")}</>)}</span><button aria-label={tl("Nuova sessione")} disabled={reading} onClick={newSession}><Plus /></button><button className="vc-upload-button" disabled={reading} onClick={() => fileInput.current?.click()}><Upload /><span>{tl("Carica immagine")}</span></button></div>
    </header>
    <input ref={fileInput} type="file" accept="image/png,image/jpeg,image/webp" aria-label={tl("Carica screenshot o immagine")} className="sr-only" disabled={reading} onChange={e => void upload(e.target.files?.[0])} />
    {error && <div className="vc-error" role="alert"><span>{error}</span><button aria-label={tl("Chiudi errore")} onClick={() => setError('')}><X /></button></div>}
    {drawer && <aside className="vc-session-drawer" aria-label={tl("Sessioni salvate")}><div className="vc-drawer-heading"><h2>{tl("Le tue sessioni")}</h2><button aria-label={tl("Chiudi sessioni")} onClick={() => setDrawer(false)}><X /></button></div><button className="vc-new-session" onClick={newSession}><Plus />{tl("Nuova sessione")}</button><label className="vc-session-search"><Search /><input aria-label={tl("Cerca sessioni")} placeholder={tl("Cerca una sessione…")} value={query} onChange={e => setQuery(e.target.value)} /></label><div className="vc-session-list">{sessions.length ? sessions.map(item => <div key={item.id} className={`vc-session-row ${current?.id === item.id ? 'vc-session-selected' : ''}`}><button className="vc-session-open" onClick={() => void openSession(item.id)}><strong>{item.title}</strong><span>{new Date(item.updated_at).toLocaleDateString('it-IT', { day: 'numeric', month: 'short' })} · {item.message_count} {tl("messaggi")}{item.busy ? ' · In elaborazione' : ''}</span></button><button aria-label={tl("Rinomina {0}", item.title)} onClick={() => void rename(item)}><Pencil /></button><button aria-label={tl("Elimina {0}", item.title)} disabled={item.busy} onClick={() => void remove(item)}><Trash2 /></button></div>) : <p className="vc-no-sessions">{query ? tl("Nessuna sessione trovata.") : tl("Le sessioni vengono salvate qui automaticamente quando carichi un’immagine.")}</p>}</div></aside>}
    <div className="vc-workspace">
      <section className={`vc-canvas-panel ${dragging ? 'vc-is-dragging' : ''}`} aria-label={tl("Canvas immagine")}
        onDragOver={e => { e.preventDefault(); setDragging(true) }} onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragging(false) }}
        onDrop={e => { e.preventDefault(); setDragging(false); if (e.dataTransfer.files.length === 1) void upload(e.dataTransfer.files[0]); else setError(tl("Carica una sola immagine alla volta.")) }}>
        {loading || reading ? <div className="vc-loading"><Loader2 className="animate-spin" /><p>{reading ? tl("Salvo la tua immagine…") : tl("Apro la sessione salvata…")}</p></div> : image && current ? <VisualStage image={image} regions={current.inventory?.grounding.regions || []} overlays={overlays}
          drawing={reviewing && !focus ? undefined : drawing} reviewing={!!reviewing && !focus} focusKey={focus?.key || lastAssistant?.id || current.id}
          selection={selection} onSelect={zone => { setSelection(zone); if (zone) requestAnimationFrame(() => answerInput.current?.focus({ preventScroll: true })) }}
          onAskStep={(title, zone) => { setSelection(zone); setDraft(`Approfondiamo «${title}»: `); requestAnimationFrame(() => answerInput.current?.focus({ preventScroll: true })) }}
          widgets={current.dialogue.widgets || []} focusWidget={focusWidget} onAskLab={text => void send(text)} notes={notes} onNotes={setNotes}
          onAskNotes={() => void send(tl("Ho scritto le mie idee sul canvas: valutale una per una e aiutami a capire il prossimo passo, senza darmi la soluzione."))} /> : <div className="vc-empty"><span className="vc-empty-icon"><Sparkles /></span><h2>{tl("Da un’immagine, cominciamo a capire.")}</h2><p>{tl("Carica uno screenshot, uno schema o uno spartito.")}<br />{tl("Qui avrai tutto lo spazio per osservarlo.")}</p><button className="vc-primary" onClick={() => fileInput.current?.click()}><Upload />{tl("Scegli un’immagine")}</button><small>{tl("Trascina o incolla · PNG, JPEG, WebP · max 8 MB")}</small><button className="vc-example" onClick={() => void demo()}>{tl("Prova con un esempio")}</button></div>}
        {dragging && <div className="vc-drop-shade">{tl("Rilascia l’immagine per salvarla in una nuova sessione")}</div>}
      </section>
      <aside className="vc-sidebar" aria-label={tl("Chat tutor visuale")}><div className="vc-tutor-heading"><Sparkles /><div><h2>{current?.title || tl("Tutor visuale")}</h2><p title={current?.dialogue.objective}>{current?.dialogue.objective || tl("Chiedi, prova, approfondisci. Al tuo ritmo.")}</p></div></div>
        <div ref={history} className="vc-chat-history" role="log" aria-label={tl("Conversazione salvata")} aria-live="polite">
          {!current?.messages.length && <div className="vc-chat-welcome"><h3>{tl("Guardiamola insieme.")}</h3><p>{image ? tl("Raccontami cosa vuoi riuscire a fare. Ti aiuto a capire e mettere in pratica il contenuto, un pezzo alla volta.") : tl("La conversazione e l’immagine vengono salvate. Puoi riprenderle quando vuoi e continuare con nuovi approfondimenti.")}</p>{image && <div className="vc-starters">{STARTERS.map(text => <button key={text} onClick={() => void send(text)} disabled={busy}>{text}</button>)}</div>}</div>}
          {current?.messages.map(m => <article key={m.id} className={`vc-message vc-message-${m.role} ${m.status === 'failed' ? 'vc-message-failed' : ''}`} aria-label={m.role === 'user' ? tl("Messaggio tuo") : tl("Messaggio del tutor")}><span className="vc-message-label">{m.role === 'user' ? 'Tu' : tl("Tutor visuale")}</span>{m.selection && <button className="vc-message-selection" onClick={() => setSelection(m.selection!)}>{tl("Zona marcata ·")} {SHAPE_NAMES[m.selection.shape]}</button>}<Text>{m.content}</Text>{m.role === 'assistant' && !!m.questions?.length && (m.id === current.messages[current.messages.length - 1]?.id
            ? <QuestionForm questions={m.questions} disabled={busy} onSubmit={text => void send(text)} />
            : <p className="vc-questions-done">{tl("Scelte inviate.")}</p>)}{m.role === 'assistant' && !!m.widgets?.length && <div className="vc-message-widgets">{m.widgets.map(w =>
            <button key={w.id} onClick={() => setFocusWidget({ id: w.id, nonce: Date.now() })}>{w.kind === 'exercise' ? tl("Apri l’esercizio") : w.kind === 'solid' ? tl("Apri il modello 3D") : tl("Apri il grafico")} · {w.title}</button>)}</div>}
          {m.role === 'assistant' && m.focus?.drawing_failed && <div className="vc-drawing-failed"><p>{tl("Il disegno di questa risposta non è riuscito.")}</p>
            <button disabled={!!redrawing || busy} onClick={() => void redraw(m)}>{redrawing === m.id ? <><Loader2 className="animate-spin" />{tl("Disegno…")}</> : tl("Rigenera il disegno")}</button></div>}
          {m.role === 'assistant' && !!(m.focus?.drawing || m.focus?.overlays.length) && <button className="vc-message-focus" onClick={() => setFocus({ key: m.id, overlays: m.focus?.overlays || [], drawing: m.focus?.drawing })}>{m.focus?.drawing ? tl("Rivedi il disegno alla lavagna") : tl("Mostra riferimenti nell’immagine")}</button>}{m.status === 'failed' && <div className="vc-retry"><p>{m.error || tl("Risposta non completata. Il messaggio è salvato.")}</p><button disabled={busy} onClick={() => void send(m.content, m)}>{tl("Riprova")}</button></div>}</article>)}
          {busy && <div className="vc-thinking" role="status"><Loader2 className="animate-spin" /><span>{tl("Osservo il dettaglio e preparo la risposta…")}</span></div>}
        </div>
        <form className="vc-composer" onSubmit={(e: FormEvent) => { e.preventDefault(); void send() }}>
          {selection && <div className="vc-selection-chip" role="status"><strong>{tl("Zona marcata")}</strong><span>({SHAPE_NAMES[selection.shape]})</span>
            {ZONE_QUESTIONS.map(q => <button key={q} type="button" disabled={busy} onClick={() => void send(q)}>{q}</button>)}
            <button type="button" className="vc-chip-close" aria-label={tl("Togli la zona marcata")} onClick={() => setSelection(null)}><X /></button></div>}
          {!!current?.messages.length && <div className="vc-chat-actions"><button type="button" disabled={busy} onClick={() => void send(tl("Spiegamelo in un modo più semplice, con un esempio concreto."))}>{tl("Spiegamelo meglio")}</button><button type="button" disabled={busy} onClick={() => void send(tl("Andiamo avanti con la prossima parte del mio obiettivo."))}>{tl("Continuiamo")}</button>
            <button type="button" disabled={busy} onClick={() => void send(tl("Costruiscimi accanto un grafico interattivo di questa funzione, con i parametri che posso cambiare per vedere cosa succede."))}>{tl("Grafico interattivo")}</button>
            <button type="button" disabled={busy} onClick={() => void send(tl("Spiegamelo in modo alternativo, costruendolo di lato sulla lavagna."))}>{tl("Fammelo vedere di lato")}</button></div>}
          <label htmlFor="vc-question" className="sr-only">{tl("Messaggio al tutor")}</label><div className="vc-input-wrap"><textarea ref={answerInput} id="vc-question" value={draft} onChange={e => { const text = e.target.value; setDraft(text); if (current) localStorage.setItem(draftKey(current.id), JSON.stringify({ text, time: Date.now() })) }} maxLength={4000} disabled={!current || busy || loading} placeholder={current ? (selection ? tl("Cosa vuoi sapere di questa parte?") : tl("Chiedi, rispondi o marca una parte dell’immagine…")) : tl("Carica un’immagine per cominciare…")} rows={3} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void send() } }} /><button type="submit" aria-label={tl("Invia al tutor visuale")} disabled={!current || busy || !draft.trim()}><Send /></button></div><p>{current ? tl("Salvataggio automatico · Invio per inviare") : tl("Le tue sessioni sono private e riservate al tuo account.")}</p>
        </form>
      </aside>
    </div>
  </div>
}
