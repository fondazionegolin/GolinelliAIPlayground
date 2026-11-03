import { ScopedModelSelect, storedModelChoice, useScopedModelChoice } from '@/components/models/ScopedModelSelect'
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { v4 as uuid } from 'uuid'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'
import 'katex/dist/katex.min.css'
import { Check, ChevronRight, Clock3, Loader2, MoreVertical, Pencil, Plus, Search, Send, Sparkles, Trash2, Users, X } from '@/components/icons'
import { CanvasEaselIcon } from '@/components/icons/CustomIcons'
import { Badge, Button, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, Input, Select } from '@/design'
import api from '@/lib/api'
import { useAuthStore } from '@/stores/auth'
import { CollaborativeCanvas, type CanvasHandle } from '@/components/CollaborativeCanvas'
import { changedIds, cropWithGrid, diffDocs, renderPreview, unaliasOps, type AiOp } from '@/components/canvasAi'
import type { CanvasDoc } from '@/components/CollaborativeCanvas'
import { TUTORIAL_TITLE } from '@/components/canvasTutorial'
import { tl } from '@/i18n/tl'

const BASE = '/smart-canvases'
const SUGGESTIONS = [tl("Cosa vedi sulla lavagna?"), tl("Fammi un'animazione della fotosintesi clorofilliana"), tl("Risolvi passo passo la formula selezionata"), tl("Annota l'immagine selezionata")]

type Role = 'teacher' | 'student'
type Board = {
  id: string; title: string; updated_at: string; message_count: number
  session_id: string | null; session_title: string | null; canvas_key: string | null; preview?: string | null
  students_can_write: boolean; mine: boolean; owner_type: 'teacher' | 'student'; owner_name: string | null; can_chat: boolean
  content_json?: string; messages?: Stored[]
}
type SessionOption = { id: string; title: string; class_name: string; status: string | null }
type Stored = { id: string; role: 'user' | 'assistant'; content: string; ops?: AiOp[]; author?: string }
type ChatMessage = { id: string; role: 'user' | 'assistant'; content: string; applied?: number; focus?: string[]; author?: string }

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))

/** Second look at highlights on small targets: a zoomed crop with its own grid lets the model tighten each box. */
async function refineOps(boardId: string, ops: AiOp[], doc: CanvasDoc, request: string, answer: string): Promise<AiOp[]> {
  const out = [...ops]
  const byImage = new Map<string, number[]>()
  ops.forEach((op, i) => {
    if (op.kind === 'shape' && op.on && op.w && op.h && op.w * op.h < 2500) byImage.set(op.on, [...(byImage.get(op.on) || []), i])
  })
  for (const [imageId, idxs] of byImage) {
    const image = doc.items.find(i => i.id === imageId)
    if (!image || image.type !== 'image') continue
    const x0 = Math.min(...idxs.map(i => ops[i].x!)), y0 = Math.min(...idxs.map(i => ops[i].y!))
    const x1 = Math.max(...idxs.map(i => ops[i].x! + ops[i].w!)), y1 = Math.max(...idxs.map(i => ops[i].y! + ops[i].h!))
    const pad = Math.max(x1 - x0, y1 - y0) * 0.6 + 4
    const w = clamp(x1 - x0 + 2 * pad, 25, 100), h = clamp(y1 - y0 + 2 * pad, 25, 100)
    const crop = { x: clamp((x0 + x1) / 2 - w / 2, 0, 100 - w), y: clamp((y0 + y1) / 2 - h / 2, 0, 100 - h), w, h }
    const dataUrl = await cropWithGrid(image.src, crop)
    if (!dataUrl) continue
    const boxes = idxs.map(i => ({ index: i, kind: ops[i].kind, x: ((ops[i].x! - crop.x) / crop.w) * 100, y: ((ops[i].y! - crop.y) / crop.h) * 100, w: (ops[i].w! / crop.w) * 100, h: (ops[i].h! / crop.h) * 100, text: ops[i].text || '' }))
    try {
      const { data } = await api.post<{ boxes: Array<{ index: number; x: number; y: number; w: number; h: number }> }>(`${BASE}/${boardId}/refine`, { content: request, answer, crop: dataUrl, boxes }, { timeout: 70000 })
      for (const b of data.boxes) {
        const next = { x: crop.x + (b.x / 100) * crop.w, y: crop.y + (b.y / 100) * crop.h, w: (b.w / 100) * crop.w, h: (b.h / 100) * crop.h }
        const ratio = (next.w * next.h) / (ops[b.index].w! * ops[b.index].h!)
        if (ratio > 0.25 && ratio < 4) out[b.index] = { ...out[b.index], ...next }  // a wild change is more likely a mistake than a fix
      }
    } catch { /* the first placement is still a valid answer */ }
  }
  return out
}

/** Hands every animation brief to the director; an op whose scene could not be built is dropped (and reported). */
async function directAnimations(boardId: string, ops: AiOp[], doc: CanvasDoc, request: string): Promise<{ ops: AiOp[]; failed: string[] }> {
  const failed: string[] = []
  const done = await Promise.all(ops.map(async (op): Promise<AiOp | null> => {
    if (!op.brief || !(op.kind === 'animation' || op.kind === 'update')) return op
    const existing = op.kind === 'update' ? doc.items.find(i => i.id === op.target) : undefined
    if (op.kind === 'update' && existing?.type !== 'animation') return op
    try {
      const { data } = await api.post<{ scene: NonNullable<AiOp['scene']> }>(`${BASE}/${boardId}/animate`, {
        brief: op.brief, content: request, previous: existing?.type === 'animation' ? existing.scene : undefined,
      }, { timeout: 190000 })
      return { ...op, scene: data.scene }
    } catch (err) { failed.push(errorMessage(err, tl("animazione non riuscita"))); return null }
  }))
  return { ops: done.filter((o): o is AiOp => !!o), failed }
}

function errorMessage(err: unknown, fallback: string) {
  const detail = (err as { response?: { data?: { detail?: unknown } } }).response?.data?.detail
  return typeof detail === 'string' ? detail : fallback
}


export default function SmartCanvasApp({ role }: { role: Role }) {
  const userId = useAuthStore(s => s.user?.id) || useAuthStore.getState().studentSession?.student_id || 'me'
  const lastKey = `smart-canvas-open:${role}:${userId}`
  const [boards, setBoards] = useState<Board[]>([])
  const [sessions, setSessions] = useState<SessionOption[]>([])
  const [loading, setLoading] = useState(true)
  const [openId, setOpenId] = useState<string | null>(() => { try { return localStorage.getItem(lastKey) } catch { return null } })
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')
  const [creating, setCreating] = useState(false)
  const [withTutorial, setWithTutorial] = useState(false)
  const [startingGuide, setStartingGuide] = useState(false)
  const [menu, setMenu] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    const { data } = await api.get<Board[]>(BASE)
    setBoards(data)
    return data
  }, [])

  useEffect(() => {
    let alive = true
    void (async () => {
      try {
        const list = await refresh()
        if (role === 'teacher') { const { data } = await api.get<SessionOption[]>(`${BASE}/sessions`); if (alive) setSessions(data) }
        if (alive && openId && !list.some(b => b.id === openId)) setOpenId(null)
      } catch (err) { if (alive) setError(errorMessage(err, tl("Impossibile caricare le lavagne."))) }
      finally { if (alive) setLoading(false) }
    })()
    return () => { alive = false }
  }, [role]) // eslint-disable-line react-hooks/exhaustive-deps

  const open = (id: string | null, tutorial = false) => {
    setWithTutorial(tutorial)
    setOpenId(id)
    try { if (id) localStorage.setItem(lastKey, id); else localStorage.removeItem(lastKey) } catch { /* optional */ }
    if (!id) void refresh().catch(() => undefined)
  }

  if (openId) return <Workspace key={openId} role={role} boardId={openId} sessions={sessions} autoTutorial={withTutorial} onBack={() => open(null)} onGone={() => { open(null) }} />

  const shown = boards.filter(b => !query.trim() || b.title.toLowerCase().includes(query.trim().toLowerCase()))
  const mine = shown.filter(b => b.mine)
  const others = shown.filter(b => !b.mine)
  const groups: Array<[string, Board[]]> = role === 'teacher'
    ? Object.entries(others.reduce<Record<string, Board[]>>((acc, b) => { const k = b.session_title || tl("Senza sessione"); (acc[k] ||= []).push(b); return acc }, {}))
    : [[tl("Condivise dal docente"), others]]

  async function startGuide() {
    if (startingGuide) return
    setStartingGuide(true)
    try {
      const { data } = await api.post<Board>(BASE, { title: TUTORIAL_TITLE })
      void refresh()
      open(data.id, true)
    } catch (err) { setError(errorMessage(err, tl("Impossibile creare la lavagna."))) }
    finally { setStartingGuide(false) }
  }

  async function remove(board: Board) {
    setMenu(null)
    if (!window.confirm(tl("Eliminare la lavagna “{0}”?", board.title))) return
    try { await api.delete(`${BASE}/${board.id}`); await refresh() } catch (err) { setError(errorMessage(err, tl("Impossibile eliminare la lavagna."))) }
  }

  async function rename(board: Board) {
    setMenu(null)
    const title = window.prompt(tl("Nome della lavagna"), board.title)?.trim()
    if (!title || title === board.title) return
    try { await api.patch(`${BASE}/${board.id}`, { title: title.slice(0, 200) }); await refresh() } catch (err) { setError(errorMessage(err, tl("Impossibile rinominare la lavagna."))) }
  }

  const renderCard = (board: Board) => (
    <article key={board.id} className="ui-card ui-card-interactive group overflow-hidden">
      <button type="button" onClick={() => open(board.id)} className="block w-full text-left" aria-label={tl("Apri {0}", board.title)}>
        <div className="relative h-44 overflow-hidden bg-[radial-gradient(circle,var(--canvas-dot)_1px,transparent_1px)] bg-[length:16px_16px]">
          {board.preview
            ? <img src={board.preview} alt="" className="h-full w-full object-contain p-2" loading="lazy" />
            : <div className="flex h-full items-center justify-center"><CanvasEaselIcon className="h-10 w-10 text-slate-300" /></div>}
          {board.session_id && <Badge tone="accent" surface="soft" className="absolute right-2 top-2 gap-1 px-2 py-0.5 text-[9px] font-black uppercase"><Users className="h-3 w-3" />{tl("Condivisa")}</Badge>}
        </div>
        <div className="px-4 pb-3 pt-4">
          <h3 className="truncate text-sm font-black text-slate-900">{board.title}</h3>
          <div className="mt-2 flex flex-wrap gap-1.5">
            <Badge tone="neutral" surface="soft" className="px-2 py-0.5 text-[10px]">{board.session_id ? (board.session_title || tl("Sessione")) : tl("Privata")}</Badge>
            {board.session_id && (board.students_can_write
              ? <Badge tone="success" surface="soft" className="px-2 py-0.5 text-[10px]">{tl("Studenti: modifica")}</Badge>
              : <Badge tone="warning" surface="soft" className="px-2 py-0.5 text-[10px]">{tl("Studenti: sola lettura")}</Badge>)}
            {!board.mine && board.owner_name && <Badge tone="accent" surface="soft" className="px-2 py-0.5 text-[10px]">{board.owner_name}</Badge>}
          </div>
        </div>
      </button>
      <div className="flex items-center gap-2 p-3 shadow-[0_-1px_0_rgba(163,163,163,0.10)]">
        <button type="button" onClick={() => open(board.id)} className="ui-cta flex h-9 flex-1 items-center justify-center gap-2 rounded-xl text-[11px] font-black"><Sparkles className="h-3.5 w-3.5" />{tl("Apri")}</button>
        {board.mine && <div className="relative">
          <button type="button" aria-label={tl("Altre azioni")} onClick={() => setMenu(menu === board.id ? null : board.id)} className="ds-control flex h-9 w-9 items-center justify-center rounded-xl"><MoreVertical className="h-4 w-4" /></button>
          {menu === board.id && <>
            <div className="fixed inset-0 z-10" onMouseDown={() => setMenu(null)} />
            <div className="ds-popover absolute bottom-11 right-0 z-20 w-40 rounded-xl p-1">
              <button type="button" onClick={() => void rename(board)} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-xs font-bold hover:bg-slate-50"><Pencil className="h-3.5 w-3.5" />{tl("Rinomina")}</button>
              <button type="button" onClick={() => void remove(board)} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-xs font-bold text-rose-600 hover:bg-rose-50"><Trash2 className="h-3.5 w-3.5" />{tl("Elimina")}</button>
            </div>
          </>}
        </div>}
      </div>
      <div className="flex items-center justify-between border-t border-slate-50 px-4 py-2 text-[9px] text-slate-400">
        <span className="flex items-center gap-1"><Clock3 className="h-3 w-3" />{new Date(board.updated_at).toLocaleString('it-IT', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
        <span>{board.message_count} {tl("messaggi")}</span>
      </div>
    </article>
  )

  const grid = (items: Board[]) => <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">{items.map(renderCard)}</div>

  return <div className="h-full overflow-y-auto bg-transparent">
    <div className="mx-auto max-w-[1500px] px-5 py-7 md:px-8">
      <header className="mb-7 flex flex-wrap items-end gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-3">
            <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-slate-950 text-white"><CanvasEaselIcon className="h-5 w-5" /></span>
            <div><p className="text-[10px] font-black uppercase tracking-[.18em] text-[var(--logo-pink)]">{tl("Lavagne intelligenti · Beta")}</p>
              <h1 className="text-2xl font-black tracking-tight text-slate-950">{role === 'teacher' ? tl("Le tue lavagne") : tl("Le lavagne della sessione")}</h1></div>
          </div>
          <p className="mt-3 max-w-2xl text-sm text-slate-500">{role === 'teacher' ? tl("Crea una lavagna, condividila con una sessione e lavorate insieme in tempo reale, con l’assistente che legge tutto.") : tl("Le lavagne condivise dal docente e quelle che crei tu, in questa sessione.")}</p>
        </div>
        <button type="button" onClick={() => setCreating(true)} className="ui-cta flex h-11 items-center gap-2 rounded-xl px-5 text-sm font-black"><Plus className="h-4 w-4" />{tl("Nuova lavagna")}</button>
      </header>

      <div className="ui-card mb-5 flex flex-wrap items-center gap-4 p-4">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-pink-50 text-lg font-black text-[var(--logo-pink)]">?</span>
        <div className="min-w-0 flex-1"><h2 className="text-sm font-black text-slate-900">{tl("Nuovo qui? Impara in pochi minuti")}</h2>
          <p className="text-xs text-slate-500">{tl("Una lavagna-guida con esempi veri: come allegare un’immagine, aprire l’assistente, che domande fare e cosa sanno fare spiegazioni e animazioni.")}</p></div>
        <button type="button" onClick={() => void startGuide()} disabled={startingGuide} className="ds-control flex h-9 items-center gap-2 rounded-xl px-4 text-xs font-black disabled:opacity-60">{startingGuide && <Loader2 className="h-3.5 w-3.5 animate-spin" />}{tl("Apri la guida")}</button>
      </div>

      <div className="ui-search mb-5 flex items-center gap-3 p-3"><Search className="ml-1 h-4 w-4 text-slate-400" />
        <input value={query} onChange={e => setQuery(e.target.value)} placeholder={tl("Cerca nelle lavagne…")} aria-label={tl("Cerca una lavagna")} className="min-w-0 flex-1 border-0 bg-transparent text-sm outline-none" />
        <span className="rounded-lg bg-white/70 px-2.5 py-1 text-[10px] font-black text-slate-500 shadow-[var(--ds-shadow-1)]">{shown.length}</span></div>

      {error && <div className="mb-4 flex items-start gap-2 rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-700" role="alert"><span className="flex-1">{error}</span><button type="button" aria-label={tl("Chiudi errore")} onClick={() => setError('')}><X className="h-4 w-4" /></button></div>}

      {loading ? <div className="flex h-64 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-[var(--logo-pink)]" /></div> : <>
        {mine.length ? <section className="mb-8"><h2 className="mb-3 text-[11px] font-black uppercase tracking-[.14em] text-slate-400">{tl("Le mie lavagne")}</h2>{grid(mine)}</section>
          : !others.length && <div className="flex min-h-[22rem] flex-col items-center justify-center rounded-3xl border-2 border-dashed border-slate-200 bg-white text-center">
            <span className="flex h-16 w-16 items-center justify-center rounded-2xl bg-pink-50 text-[var(--logo-pink)]"><CanvasEaselIcon className="h-7 w-7" /></span>
            <h2 className="mt-4 text-lg font-black">{query ? tl("Nessuna lavagna trovata") : tl("Nessuna lavagna")}</h2>
            <p className="mt-1 max-w-sm text-sm text-slate-400">{tl("Crea la prima lavagna: disegna, incolla immagini e formule e chiedi aiuto all’assistente.")}</p>
            <button type="button" onClick={() => setCreating(true)} className="mt-5 flex h-10 items-center gap-2 rounded-xl bg-slate-950 px-4 text-xs font-black text-white"><Plus className="h-4 w-4" />{tl("Crea lavagna")}</button></div>}
        {groups.filter(([, items]) => items.length).map(([name, items]) => <section key={name} className="mb-8"><h2 className="mb-3 text-[11px] font-black uppercase tracking-[.14em] text-slate-400">{role === 'teacher' ? `${tl("Degli studenti")} · ${name}` : name}</h2>{grid(items)}</section>)}
      </>}
    </div>
    {creating && <CreateDialog role={role} sessions={sessions} onClose={() => setCreating(false)} onCreated={id => { setCreating(false); void refresh(); open(id) }} />}
  </div>
}

function CreateDialog({ role, sessions, onClose, onCreated }: { role: Role; sessions: SessionOption[]; onClose: () => void; onCreated: (id: string) => void }) {
  const [title, setTitle] = useState('')
  const [sessionId, setSessionId] = useState('')
  const [canWrite, setCanWrite] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function submit(e: FormEvent) {
    e.preventDefault()
    if (busy) return
    setBusy(true); setError('')
    try {
      const { data } = await api.post<Board>(BASE, { title: title.trim() || tl("Nuova lavagna intelligente"), ...(role === 'teacher' && sessionId ? { session_id: sessionId, students_can_write: canWrite } : {}) })
      onCreated(data.id)
    } catch (err) { setError(errorMessage(err, tl("Impossibile creare la lavagna."))); setBusy(false) }
  }
  return <Dialog open onOpenChange={open => { if (!open) onClose() }}>
    <DialogContent size="sm">
      <DialogHeader><DialogTitle>{tl("Nuova lavagna")}</DialogTitle>
        <DialogDescription>{role === 'teacher' ? tl("Scegli un nome e, se vuoi, condividila con una sessione.") : tl("La lavagna sarà visibile a te e al docente di questa sessione.")}</DialogDescription></DialogHeader>
      <form onSubmit={submit} className="grid gap-4">
        <label className="grid gap-1.5 text-xs font-bold text-slate-600">{tl("Nome")}
          <Input autoFocus value={title} onChange={e => setTitle(e.target.value)} maxLength={200} placeholder={tl("Es. Le parabole")} />
        </label>
        {role === 'teacher' && <>
          <label className="grid gap-1.5 text-xs font-bold text-slate-600">{tl("Condividi con")}
            <Select value={sessionId} onChange={e => setSessionId(e.target.value)}>
              <option value="">{tl("Solo io (privata)")}</option>
              {sessions.map(s => <option key={s.id} value={s.id}>{s.title} · {s.class_name}</option>)}
            </Select>
          </label>
          {sessionId && <label className="ui-card flex cursor-pointer items-start gap-3 p-3 text-xs text-slate-600">
            <input type="checkbox" checked={canWrite} onChange={e => setCanWrite(e.target.checked)} className="mt-0.5" />
            <span><strong className="block text-slate-800">{tl("Gli studenti possono modificare")}</strong>{tl("Con la modifica attiva gli studenti usano anche l’assistente. Puoi cambiarlo quando vuoi.")}</span>
          </label>}
        </>}
        {error && <p className="text-xs font-semibold text-rose-600" role="alert">{error}</p>}
        <DialogFooter>
          <Button type="button" tone="neutral" surface="soft" onClick={onClose}>{tl("Annulla")}</Button>
          <Button type="submit" tone="accent" surface="solid" disabled={busy}>{busy && <Loader2 className="h-4 w-4 animate-spin" />}{tl("Crea")}</Button>
        </DialogFooter>
      </form>
    </DialogContent>
  </Dialog>
}

function Workspace({ role, boardId, sessions, autoTutorial, onBack, onGone }: { role: Role; boardId: string; sessions: SessionOption[]; autoTutorial: boolean; onBack: () => void; onGone: () => void }) {
  const [board, setBoard] = useState<Board | null>(null)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [panelOpen, setPanelOpen] = useState(true)
  const [shareOpen, setShareOpen] = useState(false)
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState<'saved' | 'saving'>('saved')
  const [phase, setPhase] = useState('')
  const [liveCanWrite, setLiveCanWrite] = useState<boolean | null>(null)
  const handle = useRef<CanvasHandle>(null)
  const history = useRef<HTMLDivElement>(null)
  const saveTimer = useRef<number | null>(null)
  const pending = useRef<string | null>(null)
  const savedJson = useRef('')
  const lastSeen = useRef('')
  const tutorialShown = useRef(false)
  const previewTimer = useRef<number | null>(null)
  const previewBase = useRef<string | null>(null)

  const load = useCallback(async () => {
    try {
      const { data } = await api.get<Board>(`${BASE}/${boardId}`)
      savedJson.current = data.content_json || ''
      lastSeen.current = data.content_json || ''
      setBoard(data)
      setLiveCanWrite(null)
      setMessages((data.messages || []).map(m => ({ id: m.id, role: m.role, content: m.content, applied: m.ops?.length || 0, author: m.author })))
    } catch (err) { setError(errorMessage(err, tl("Impossibile aprire la lavagna."))); onGone() }
  }, [boardId, onGone])

  useEffect(() => { void load() }, [load])
  useEffect(() => { if (history.current) history.current.scrollTop = history.current.scrollHeight }, [messages.length, busy])

  const flush = useCallback(async () => {
    if (saveTimer.current) { window.clearTimeout(saveTimer.current); saveTimer.current = null }
    const json = pending.current
    if (json === null || json === savedJson.current) return
    pending.current = null
    try { await api.patch(`${BASE}/${boardId}`, { content_json: json }); savedJson.current = json; setSaving('saved') } catch { pending.current = json }
  }, [boardId])
  useEffect(() => () => { void flush() }, [flush])

  const shared = !!board?.session_id
  const canWrite = liveCanWrite ?? board?.students_can_write ?? false
  // Teacher: always. Student: only while the teacher lets students edit this board.
  const assistantAllowed = role === 'teacher' || (shared && canWrite)

  /** The landing page shows a small picture of the board: redrawn a few seconds after the last change, and when leaving. */
  const uploadPreview = useCallback(async () => {
    if (previewTimer.current) { window.clearTimeout(previewTimer.current); previewTimer.current = null }
    const doc = handle.current?.getDoc()
    const image = doc && await renderPreview(doc)
    if (image) await api.post(`${BASE}/${boardId}/preview`, { image }).catch(() => undefined)
  }, [boardId])

  function queuePreview(json: string) {
    if (previewBase.current === null) { previewBase.current = json; if (board?.preview) return }  // opening is not a change
    else if (json === previewBase.current) return
    previewBase.current = json
    if (previewTimer.current) window.clearTimeout(previewTimer.current)
    previewTimer.current = window.setTimeout(() => void uploadPreview(), 6000)
  }

  function onContentChange(json: string) {
    queuePreview(json)
    if (shared || json === savedJson.current) return
    pending.current = json
    setSaving('saving')
    if (saveTimer.current) window.clearTimeout(saveTimer.current)
    saveTimer.current = window.setTimeout(() => void flush(), 1200)
  }

  async function rename(title: string) {
    const clean = title.trim().slice(0, 200)
    if (!clean || !board?.mine) return
    setBoard(b => (b ? { ...b, title: clean } : b))
    try { await api.patch(`${BASE}/${boardId}`, { title: clean }) } catch { /* the next edit retries */ }
  }

  async function share(patch: { session_id?: string | null; students_can_write?: boolean }) {
    try {
      await flush()
      await api.post(`${BASE}/${boardId}/share`, patch)
      await load()
    } catch (err) { setError(errorMessage(err, tl("Impossibile aggiornare la condivisione."))) }
  }

  async function send(content = draft) {
    const text = content.trim()
    const canvas = handle.current
    if (!text || !canvas || busy || !assistantAllowed) return
    setBusy(true); setError(''); setDraft('')
    const userMessage: ChatMessage = { id: uuid(), role: 'user', content: text }
    setMessages(m => [...m, userMessage])
    try {
      const snap = await canvas.snapshot()
      const before = JSON.parse(lastSeen.current || '{"type":"canvas_v1","items":[]}')
      const changes = diffDocs(before, snap.doc)
      // Where the user is working: what they selected, else what they just edited. New work is placed next to it.
      const toAlias = Object.fromEntries(Object.entries(snap.fromAlias).map(([alias, real]) => [real, alias]))
      const near = snap.selected.length ? snap.selected : changedIds(before, snap.doc).map(id => toAlias[id]).filter(Boolean)
      const { data } = await api.post<{ message: { id: string; content: string; ops?: AiOp[]; focus?: string[] } }>(`${BASE}/${boardId}/chat`, {
        request_id: userMessage.id, content: text, overview: snap.overview, images: snap.images, images_meta: snap.imagesMeta,
        items: snap.items, changes, selected: snap.selected.slice(0, 60), near: near.slice(0, 20), ...storedModelChoice('canvas'),
      }, { timeout: 190000 })
      let ops = unaliasOps(data.message.ops || [], snap.fromAlias)
      if (ops.some(o => o.on && o.kind === 'shape')) { setPhase(tl("Preciso le posizioni sull’immagine…")); ops = await refineOps(boardId, ops, snap.doc, text, data.message.content) }
      let note = ''
      if (ops.some(o => o.brief)) {
        setPhase(tl("Il regista costruisce l’animazione… può richiedere un minuto"))
        const directed = await directAnimations(boardId, ops, snap.doc, text)
        ops = directed.ops
        if (directed.failed.length) note = `\n\n⚠️ ${directed.failed[0]}`
      }
      const { created, idMap } = ops.length ? canvas.applyOps(ops) : { created: [], idMap: {} as Record<string, string> }
      const named = (data.message.focus || []).map(f => idMap[f] || snap.fromAlias[f]).filter((f): f is string => !!f)
      const focus = named.length ? named : created
      if (focus.length) window.setTimeout(() => canvas.focusItems(focus), 60)
      lastSeen.current = JSON.stringify(canvas.getDoc())
      setMessages(m => [...m, { id: data.message.id, role: 'assistant', content: data.message.content + note, applied: ops.length, focus }])
    } catch (err) {
      setError(errorMessage(err, tl("La richiesta non è riuscita. Puoi riprovare.")))
      setDraft(text)
      setMessages(m => m.filter(x => x.id !== userMessage.id))
    } finally { setBusy(false); setPhase('') }
  }

  function assist(prompt: string, ids: string[]) {
    if (!assistantAllowed) return
    setPanelOpen(true)
    handle.current?.focusItems(ids)
    void send(prompt)
  }

  const chrome = useMemo(() => <>
    <span className="mx-1 h-5 w-px bg-slate-200" />
    {role === 'teacher' && board?.mine && (
      <div className="relative">
        <button type="button" onClick={() => setShareOpen(v => !v)} aria-expanded={shareOpen} title={shared ? `${tl("Condivisa con")} ${board.session_title || tl("la sessione")}` : tl("Condividi con una sessione")} className={`flex h-7 max-w-[130px] items-center gap-1.5 rounded px-2 text-xs font-semibold ${shared ? 'bg-emerald-50 text-emerald-700' : 'text-slate-600 hover:bg-slate-100'}`}><Users className="h-3.5 w-3.5 shrink-0" /><span className="truncate">{shared ? (board.session_title || tl("Condivisa")) : tl("Condividi")}</span></button>
        {shareOpen && <div className="absolute right-0 top-8 z-[10000] w-72 rounded-lg border border-slate-200 bg-white p-3 shadow-lg">
          <label className="block text-[11px] font-semibold text-slate-600">{tl("Sessione")}
            <select value={board.session_id || ''} onChange={e => { setShareOpen(false); void share({ session_id: e.target.value || null }) }} className="mt-1 h-8 w-full rounded border border-slate-200 bg-white px-1.5 text-xs font-normal">
              <option value="">{tl("Solo io (privata)")}</option>
              {sessions.map(s => <option key={s.id} value={s.id}>{s.title} · {s.class_name}</option>)}
            </select>
          </label>
          {shared && <p className="mt-2 text-[11px] leading-snug text-slate-500">{tl("Gli studenti connessi vedono la lavagna in tempo reale. Con l’interruttore «Modifiche studenti» in alto decidi se possono modificarla e usare l’assistente. Tasto destro sulla lavagna: «Richiama gli studenti qui».")}</p>}
        </div>}
      </div>
    )}
    {shared && !board?.mine && <span className="rounded bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-600">{board?.owner_type === 'student' ? board?.owner_name : tl("Docente")}</span>}
    {!shared && <span className="flex items-center text-slate-400" role="status" title={saving === 'saving' ? tl("Salvataggio…") : tl("Salvata")}>{saving === 'saving' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}</span>}
    <button type="button" onClick={() => setPanelOpen(v => !v)} className={`flex h-7 items-center gap-1.5 rounded-md px-2.5 text-xs font-bold ${panelOpen ? 'bg-[#1a1a2e] text-white' : 'bg-pink-50 text-[#e85c8d] hover:bg-pink-100'}`}>
      <Sparkles className="h-3.5 w-3.5" />{tl("Assistente")}
    </button>
  </>, [board, flush, onBack, panelOpen, role, saving, shareOpen, shared, sessions]) // eslint-disable-line react-hooks/exhaustive-deps

  const leading = <button type="button" onClick={() => { void flush(); if (previewBase.current !== null) void uploadPreview(); onBack() }} className="flex h-7 shrink-0 items-center gap-1 rounded-md bg-slate-100 px-2 text-xs font-bold text-slate-700 hover:bg-slate-200" aria-label={tl("Torna alle lavagne")}><ChevronRight className="h-3.5 w-3.5 rotate-180" />{tl("Lavagne")}</button>

  if (!board) return <div className="flex h-full items-center justify-center text-sm text-slate-500"><Loader2 className="mr-2 h-4 w-4 animate-spin" />{error || tl("Apro la lavagna…")}</div>

  return <div className="flex h-full min-h-0 w-full bg-white">
    <div className="relative min-w-0 flex-1">
      <CollaborativeCanvas key={`${board.id}:${board.session_id || 'private'}`} ref={handle} fill role={role} title={board.title}
        onTitleChange={board.mine ? t => void rename(t) : undefined} readOnly={false}
        {...(shared ? { sessionId: board.session_id!, canvasName: board.canvas_key! } : { initialContent: board.content_json })}
        onContentChange={onContentChange} chrome={chrome} leading={leading} tutorial
        onHydrated={() => { if (autoTutorial && !tutorialShown.current) { tutorialShown.current = true; handle.current?.insertTutorial() } }} onAssist={assistantAllowed ? assist : undefined} onPermissionChange={setLiveCanWrite} />
    </div>
    {panelOpen && <aside className="flex w-[380px] max-w-[45vw] shrink-0 flex-col border-l border-slate-200 bg-slate-50" aria-label={tl("Assistente della lavagna")}>
      <div className="flex items-center gap-2 border-b border-slate-200 bg-white px-4 py-3">
        <Sparkles className="h-4 w-4 text-[#e85c8d]" />
        <div className="min-w-0 flex-1"><h2 className="truncate text-sm font-bold text-slate-900">{tl("Assistente della lavagna")}</h2>
          <p className="text-[11px] text-slate-500">{tl("Vede tutta la lavagna, le immagini e le modifiche.")}</p></div>
        <button type="button" aria-label={tl("Chiudi")} onClick={() => setPanelOpen(false)} className="text-slate-400 hover:text-slate-700"><X className="h-4 w-4" /></button>
      </div>
      <div ref={history} className="flex-1 space-y-3 overflow-y-auto px-4 py-3" role="log" aria-live="polite">
        {!assistantAllowed && <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">{tl("L’assistente si attiva quando il docente permette agli studenti di modificare questa lavagna. Intanto puoi seguire il lavoro in tempo reale.")}</div>}
        {assistantAllowed && !messages.length && <div className="rounded-lg border border-dashed border-slate-300 bg-white p-3 text-xs text-slate-600">
          <button type="button" onClick={() => handle.current?.insertTutorial()} className="mb-3 flex w-full items-center justify-center gap-1.5 rounded-md bg-pink-50 px-3 py-1.5 text-[11px] font-bold text-[#e85c8d] hover:bg-pink-100"><span className="flex h-4 w-4 items-center justify-center rounded-full bg-[#e85c8d] text-[10px] text-white">?</span>{tl("Apri la guida sulla lavagna")}</button>
          <p className="mb-2 font-semibold text-slate-800">{tl("Disegna, incolla un’immagine, poi chiedi.")}</p>
          <p className="mb-3">{tl("Seleziona un elemento per indicare di cosa parli. Posso rispondere, annotare le immagini e creare forme, formule, grafici e schemi.")}</p>
          <div className="flex flex-wrap gap-1.5">{SUGGESTIONS.map(s => <button key={s} type="button" disabled={busy} onClick={() => void send(s)} className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-100 disabled:opacity-50">{s}</button>)}</div>
        </div>}
        {messages.map(m => <article key={m.id} className={m.role === 'user' ? 'ml-8 rounded-lg bg-[#1a1a2e] px-3 py-2 text-sm text-white' : 'rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800'}>
          {m.role === 'user' ? <>{shared && m.author && <span className="mb-0.5 block text-[10px] font-bold uppercase tracking-wide text-pink-300">{m.author}</span>}{m.content}</> : <div className="prose prose-sm max-w-none prose-p:my-1.5">
            <ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeKatex]} disallowedElements={['img']} skipHtml>{m.content}</ReactMarkdown></div>}
          {m.role === 'assistant' && !!m.applied && <div className="mt-2 flex items-center gap-2 border-t border-slate-100 pt-2 text-[11px] text-slate-500">
            <Pencil className="h-3 w-3" />{tl("{0} modifiche alla lavagna", String(m.applied))}{m.focus && <> · {tl("Ctrl+Z per annullare")}</>}
            {!!m.focus?.length && <button type="button" className="ml-auto font-semibold text-[#e85c8d] hover:underline" onClick={() => handle.current?.focusItems(m.focus!)}>{tl("Mostra")}</button>}
          </div>}
        </article>)}
        {busy && <div className="flex items-center gap-2 text-xs text-slate-500" role="status"><Loader2 className="h-3.5 w-3.5 animate-spin" />{phase || tl("Leggo la lavagna…")}</div>}
        {error && <div className="flex items-start gap-2 rounded-md bg-red-50 px-3 py-2 text-xs text-red-700" role="alert"><span className="flex-1">{error}</span><button type="button" aria-label={tl("Chiudi errore")} onClick={() => setError('')}><X className="h-3.5 w-3.5" /></button></div>}
      </div>
      <form className="border-t border-slate-200 bg-white p-3" onSubmit={(e: FormEvent) => { e.preventDefault(); void send() }}>
        <CanvasModelMenu />
        <div className="flex items-end gap-2">
          <textarea value={draft} onChange={e => setDraft(e.target.value)} rows={2} maxLength={4000} disabled={busy || !assistantAllowed}
            placeholder={assistantAllowed ? tl("Chiedi qualcosa su questa lavagna…") : tl("Assistente disponibile solo al docente")} aria-label={tl("Messaggio all’assistente")}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void send() } }}
            className="min-h-[44px] flex-1 resize-none rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-[#e85c8d] disabled:bg-slate-100" />
          <button type="submit" aria-label={tl("Invia")} disabled={busy || !draft.trim() || !assistantAllowed} className="flex h-10 w-10 items-center justify-center rounded-lg bg-[#e85c8d] text-white disabled:opacity-40"><Send className="h-4 w-4" /></button>
        </div>
      </form>
    </aside>}
  </div>
}

/** Model of the board assistant, from the models the admin enabled for the smart canvas; hidden while none is enabled. */
function CanvasModelMenu() {
  const { value, setValue } = useScopedModelChoice('canvas')
  return <ScopedModelSelect scope="canvas" value={value} onChange={setValue} className="mb-2 w-full" label={tl("Modello dell’assistente")} />
}
