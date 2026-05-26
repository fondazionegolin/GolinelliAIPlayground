import '@google/model-viewer'
import { useState, useEffect, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Box, Loader2, Download, RotateCcw, Sparkles, AlertCircle,
  Upload, X, Share2, Trash2, Wand2, ImageIcon, Type,
  Lightbulb, ArrowRight, CheckCircle2, ChevronDown, ChevronUp,
} from 'lucide-react'
import { meshyApi, chatApi } from '@/lib/api'
import { Button } from '@/design/primitives/Button'

// ── Types ──────────────────────────────────────────────────────────────────

type Mode = 'txt2img' | 'img23d' | 'txt23d'
type TaskStatus = 'PENDING' | 'IN_PROGRESS' | 'SUCCEEDED' | 'FAILED' | 'EXPIRED'

interface Task3D {
  id: string
  status: TaskStatus
  progress: number
  model_urls?: { glb?: string; fbx?: string; obj?: string; usdz?: string }
  thumbnail_url?: string
  error?: { message?: string }
}

interface Asset3D {
  id: string
  label: string
  mode: Mode
  glbUrl: string
  thumbnailUrl?: string
  createdAt: string
}

interface ImgSrc {
  base64: string
  mime: string
  preview: string
  name?: string
}

// ── Design tokens per mode ─────────────────────────────────────────────────

const S = {
  txt2img: {
    stripe:   'bg-violet-500',
    iconBg:   'bg-violet-100 ring-1 ring-violet-200',
    icon:     'text-violet-700',
    badge:    'border border-violet-200 bg-violet-100 text-violet-800',
    panel:    'border-violet-200 bg-violet-50/80 text-violet-950',
    section:  'border-violet-200 bg-violet-50 text-violet-700',
    card:     'border-violet-200/80 bg-gradient-to-br from-white via-violet-50/60 to-white hover:border-violet-300 hover:shadow-violet-100/80',
    selCard:  'border-violet-400 bg-gradient-to-br from-white via-violet-50/80 to-white ring-2 ring-violet-200',
    tip:      'border-violet-200 bg-violet-50',
    tipText:  'text-violet-800',
    tipIcon:  'text-violet-500',
    progress: 'bg-violet-500',
    btnCls:   'bg-violet-600 hover:bg-violet-700 border border-violet-500 text-white shadow-sm',
    ring:     'ring-violet-300',
    focusInput: 'focus:ring-violet-300 focus:border-violet-400',
    optActive: 'border-violet-400 bg-violet-50 text-violet-800',
  },
  img23d: {
    stripe:   'bg-emerald-500',
    iconBg:   'bg-emerald-100 ring-1 ring-emerald-200',
    icon:     'text-emerald-700',
    badge:    'border border-emerald-200 bg-emerald-100 text-emerald-800',
    panel:    'border-emerald-200 bg-emerald-50/80 text-emerald-950',
    section:  'border-emerald-200 bg-emerald-50 text-emerald-700',
    card:     'border-emerald-200/80 bg-gradient-to-br from-white via-emerald-50/60 to-white hover:border-emerald-300 hover:shadow-emerald-100/80',
    selCard:  'border-emerald-400 bg-gradient-to-br from-white via-emerald-50/80 to-white ring-2 ring-emerald-200',
    tip:      'border-emerald-200 bg-emerald-50',
    tipText:  'text-emerald-800',
    tipIcon:  'text-emerald-500',
    progress: 'bg-emerald-500',
    btnCls:   'bg-emerald-600 hover:bg-emerald-700 border border-emerald-500 text-white shadow-sm',
    ring:     'ring-emerald-300',
    focusInput: 'focus:ring-emerald-300 focus:border-emerald-400',
    optActive: 'border-emerald-400 bg-emerald-50 text-emerald-800',
  },
  txt23d: {
    stripe:   'bg-indigo-500',
    iconBg:   'bg-indigo-100 ring-1 ring-indigo-200',
    icon:     'text-indigo-700',
    badge:    'border border-indigo-200 bg-indigo-100 text-indigo-800',
    panel:    'border-indigo-200 bg-indigo-50/80 text-indigo-950',
    section:  'border-indigo-200 bg-indigo-50 text-indigo-700',
    card:     'border-indigo-200/80 bg-gradient-to-br from-white via-indigo-50/60 to-white hover:border-indigo-300 hover:shadow-indigo-100/80',
    selCard:  'border-indigo-400 bg-gradient-to-br from-white via-indigo-50/80 to-white ring-2 ring-indigo-200',
    tip:      'border-indigo-200 bg-indigo-50',
    tipText:  'text-indigo-800',
    tipIcon:  'text-indigo-500',
    progress: 'bg-indigo-500',
    btnCls:   'bg-indigo-600 hover:bg-indigo-700 border border-indigo-500 text-white shadow-sm',
    ring:     'ring-indigo-300',
    focusInput: 'focus:ring-indigo-300 focus:border-indigo-400',
    optActive: 'border-indigo-400 bg-indigo-50 text-indigo-800',
  },
} as const

const MODES: { id: Mode; label: string; sub: string; desc: string; Icon: React.FC<{ className?: string }> }[] = [
  {
    id: 'txt2img',
    label: 'Testo → Immagine',
    sub: 'DALL-E 3',
    desc: 'Genera un\'immagine AI da un prompt. Poi usala come riferimento per il modello 3D.',
    Icon: Wand2,
  },
  {
    id: 'img23d',
    label: 'Immagine → 3D',
    sub: 'Meshy AI',
    desc: 'Carica una foto o usa un\'immagine generata. Meshy ricostruisce la geometria 3D automaticamente.',
    Icon: ImageIcon,
  },
  {
    id: 'txt23d',
    label: 'Testo → 3D',
    sub: 'Meshy AI',
    desc: 'Descrivi l\'oggetto e ottieni direttamente un modello 3D realistico senza passaggi intermedi.',
    Icon: Type,
  },
]

const POLYCOUNT_OPTS = [
  { label: 'Bassa  10k', value: 10000 },
  { label: 'Media  30k', value: 30000 },
  { label: 'Alta  100k', value: 100000 },
]

// ── localStorage helpers ───────────────────────────────────────────────────

const KEY = 'teacher_3d_assets'
const MODE_MIGRATION: Record<string, Mode> = { text: 'txt23d', image: 'img23d', txt2img: 'txt2img' }

function loadAssets(): Asset3D[] {
  try {
    const raw: Asset3D[] = JSON.parse(localStorage.getItem(KEY) || '[]')
    return raw
      .map(a => ({ ...a, mode: (MODE_MIGRATION[a.mode] ?? a.mode) as Mode }))
      .filter(a => a.mode in S)
  } catch { return [] }
}
function saveAssets(a: Asset3D[]) { localStorage.setItem(KEY, JSON.stringify(a)) }

// ── Component ──────────────────────────────────────────────────────────────

interface Props { sessionId?: string }

export default function Teacher3DLabPage({ sessionId }: Props) {
  const [mode, setMode] = useState<Mode>('txt23d')

  // txt2img
  const [dallePrompt, setDallePrompt] = useState('')
  const [dalleSize, setDalleSize] = useState('1024x1024')
  const [dalleQuality, setDalleQuality] = useState('standard')
  const [dalleStyle, setDalleStyle] = useState('natural')
  const [dalleLoading, setDalleLoading] = useState(false)
  const [dalleResult, setDalleResult] = useState<{ base64: string; preview: string; revised?: string } | null>(null)
  const [dalleError, setDalleError] = useState<string | null>(null)

  // shared image source (for img23d, and when forwarding from txt2img)
  const [imgSrc, setImgSrc] = useState<ImgSrc | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  // img23d options
  const [pbr, setPbr] = useState(true)
  const [topology, setTopology] = useState('quad')
  const [polycount, setPolycount] = useState(30000)
  const [showAdvanced, setShowAdvanced] = useState(false)

  // txt23d
  const [txt3dPrompt, setTxt3dPrompt] = useState('')
  const [txt3dNeg, setTxt3dNeg] = useState('low quality, low resolution, ugly')
  const [showNeg, setShowNeg] = useState(false)

  // shared 3D generation
  const [task, setTask] = useState<Task3D | null>(null)
  const [taskId, setTaskId] = useState<string | null>(null)
  const [taskMode, setTaskMode] = useState<Mode>('txt23d')
  const [gen3dLoading, setGen3dLoading] = useState(false)
  const [error3d, setError3d] = useState<string | null>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // library
  const [assets, setAssets] = useState<Asset3D[]>(loadAssets)
  const [viewingAsset, setViewingAsset] = useState<Asset3D | null>(null)
  const [toast, setToast] = useState<string | null>(null)

  // Auto-save succeeded task
  useEffect(() => {
    if (task?.status === 'SUCCEEDED' && task.model_urls?.glb) {
      const label =
        taskMode === 'txt23d' ? (txt3dPrompt.trim() || 'Modello 3D') :
        (imgSrc?.name || dallePrompt.trim() || 'Modello da immagine')
      const a: Asset3D = {
        id: task.id, label, mode: taskMode,
        glbUrl: task.model_urls.glb,
        thumbnailUrl: task.thumbnail_url,
        createdAt: new Date().toISOString(),
      }
      setAssets(prev => {
        if (prev.find(x => x.id === a.id)) return prev
        const updated = [a, ...prev]; saveAssets(updated); return updated
      })
    }
  }, [task?.status]) // eslint-disable-line react-hooks/exhaustive-deps

  // Polling
  useEffect(() => {
    if (!taskId) return
    if (['SUCCEEDED', 'FAILED', 'EXPIRED'].includes(task?.status ?? '')) return
    const fn = taskMode === 'txt23d' ? meshyApi.getTextTo3DStatus : meshyApi.getImageTo3DStatus
    pollRef.current = setInterval(async () => {
      try {
        const r = await fn(taskId)
        setTask(r.data)
        if (['SUCCEEDED', 'FAILED', 'EXPIRED'].includes(r.data.status)) clearInterval(pollRef.current!)
      } catch { /* silent */ }
    }, 5000)
    return () => { if (pollRef.current) clearInterval(pollRef.current) }
  }, [taskId, task?.status, taskMode])

  function reset3d() {
    if (pollRef.current) clearInterval(pollRef.current)
    setTask(null); setTaskId(null); setError3d(null); setViewingAsset(null)
  }

  function switchMode(m: Mode) { reset3d(); setMode(m) }

  function handleFile(file: File) {
    setImgSrc(null)
    const r = new FileReader()
    r.onload = ev => {
      const dataUrl = ev.target?.result as string
      setImgSrc({ base64: dataUrl.split(',')[1], mime: file.type || 'image/jpeg', preview: dataUrl, name: file.name })
    }
    r.readAsDataURL(file)
  }

  async function generateImage() {
    if (!dallePrompt.trim()) return
    setDalleError(null); setDalleResult(null); setDalleLoading(true)
    try {
      const r = await meshyApi.generateImage(dallePrompt.trim(), dalleSize, dalleQuality, dalleStyle)
      setDalleResult({ base64: r.data.image_data, preview: `data:image/png;base64,${r.data.image_data}`, revised: r.data.revised_prompt })
    } catch (e: unknown) {
      setDalleError((e as { response?: { data?: { detail?: string } } })?.response?.data?.detail || 'Errore generazione')
    } finally { setDalleLoading(false) }
  }

  function useDalleFor3D() {
    if (!dalleResult) return
    setImgSrc({ base64: dalleResult.base64, mime: 'image/png', preview: dalleResult.preview, name: dallePrompt || 'AI image' })
    switchMode('img23d')
  }

  async function generate3D() {
    reset3d(); setGen3dLoading(true)
    try {
      if (mode === 'txt23d') {
        if (!txt3dPrompt.trim()) return
        const r = await meshyApi.startTextTo3D(txt3dPrompt.trim(), txt3dNeg)
        setTaskId(r.data.task_id); setTaskMode('txt23d')
      } else {
        if (!imgSrc) return
        const r = await meshyApi.startImageTo3D(imgSrc.base64, imgSrc.mime, pbr, topology, polycount)
        setTaskId(r.data.task_id); setTaskMode('img23d')
      }
    } catch (e: unknown) {
      setError3d((e as { response?: { data?: { detail?: string } } })?.response?.data?.detail || 'Errore')
    } finally { setGen3dLoading(false) }
  }

  function deleteAsset(id: string) {
    setAssets(prev => { const u = prev.filter(a => a.id !== id); saveAssets(u); return u })
    if (viewingAsset?.id === id) setViewingAsset(null)
  }

  async function shareAsset(a: Asset3D) {
    if (!sessionId) { showToast('Nessuna sessione attiva'); return }
    try {
      const attachments = a.thumbnailUrl ? [{ url: a.thumbnailUrl, type: 'image', name: a.label }] : []
      await chatApi.sendSessionMessage(sessionId, `🧊 Modello 3D: "${a.label}"`, attachments)
      showToast('Condiviso in chat!')
    } catch { showToast('Errore nella condivisione') }
  }

  function showToast(msg: string) { setToast(msg); setTimeout(() => setToast(null), 3000) }

  const s = S[mode]
  const isRunning3d = gen3dLoading || (task && ['PENDING', 'IN_PROGRESS'].includes(task.status))
  const activeGlb = viewingAsset
    ? meshyApi.proxyAssetUrl(viewingAsset.glbUrl)
    : (task?.status === 'SUCCEEDED' && task.model_urls?.glb ? meshyApi.proxyAssetUrl(task.model_urls.glb) : null)
  const rawGlb = viewingAsset?.glbUrl || (task?.status === 'SUCCEEDED' ? task.model_urls?.glb : undefined)

  // ── Render ─────────────────────────────────────────────────────────────

  return (
    <div className="relative flex h-full flex-col overflow-hidden bg-slate-50">
      <div className="flex-1 overflow-y-auto">

        {/* ── Hero ── */}
        <section className="border-b border-slate-200 bg-white">
          <div className="mx-auto max-w-5xl px-4 py-7 md:px-6 md:py-8">
            <div className="mx-auto max-w-2xl text-center">
              <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-400">Lab 3D</p>
              <h2 className="mt-2 text-3xl font-black tracking-tight text-slate-950">Dalla parola al modello</h2>
              <p className="mx-auto mt-3 max-w-xl text-sm leading-6 text-slate-600">
                Genera immagini con DALL-E 3, trasforma foto in geometria 3D con Meshy AI,
                o parti direttamente da una descrizione testuale.
              </p>
            </div>

            {/* Mode cards */}
            <div className="mt-7 grid gap-3 md:grid-cols-3">
              {MODES.map(m => {
                const ms = S[m.id]
                const selected = mode === m.id
                return (
                  <motion.button
                    key={m.id}
                    whileHover={{ y: -2 }}
                    whileTap={{ scale: 0.97 }}
                    onClick={() => switchMode(m.id)}
                    className={`group relative overflow-hidden rounded-lg border p-4 text-left shadow-sm transition-all hover:shadow-lg ${
                      selected ? ms.selCard : ms.card
                    }`}
                  >
                    <div className={`absolute inset-x-0 top-0 h-1 ${ms.stripe}`} />
                    <div className="flex items-center justify-between gap-3">
                      <span className={`flex h-9 w-9 items-center justify-center rounded-lg ${ms.iconBg}`}>
                        <m.Icon className={`h-5 w-5 ${ms.icon}`} />
                      </span>
                      <span className={`rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide ${ms.badge}`}>
                        {m.sub}
                      </span>
                    </div>
                    <p className="mt-3 text-sm font-extrabold text-slate-900">{m.label}</p>
                    <p className="mt-1 text-xs leading-5 text-slate-500">{m.desc}</p>
                  </motion.button>
                )
              })}
            </div>
          </div>
        </section>

        {/* ── Workspace ── */}
        <div className="mx-auto max-w-5xl px-4 pb-10 pt-6 md:px-6">
          <AnimatePresence mode="wait">
            <motion.div
              key={mode}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.18 }}
            >

              {/* ─── TXT2IMG ─── */}
              {mode === 'txt2img' && (
                <div className="space-y-4">
                  {/* Steps guide */}
                  <div className={`rounded-lg border p-3 flex items-start gap-3 ${s.tip}`}>
                    <Lightbulb className={`h-4 w-4 flex-shrink-0 mt-0.5 ${s.tipIcon}`} />
                    <p className={`text-xs leading-5 ${s.tipText}`}>
                      <strong>Flusso consigliato:</strong> scrivi il prompt → genera l'immagine → clicca <em>"Usa per modello 3D"</em> per passare automaticamente alla scheda Immagine → 3D con l'immagine già caricata.
                    </p>
                  </div>

                  <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm space-y-4">
                    <SectionLabel mode="txt2img" label="Prompt immagine" />

                    <textarea
                      className={`w-full rounded-lg border border-slate-200 px-4 py-3 text-sm resize-none outline-none focus:ring-2 ${s.focusInput} transition-all`}
                      rows={4}
                      placeholder="Es: un drago verde smeraldo visto di fronte, su sfondo bianco puro, stile scultura digitale"
                      value={dallePrompt}
                      onChange={e => setDallePrompt(e.target.value)}
                      disabled={dalleLoading}
                    />

                    <div className="grid grid-cols-3 gap-3">
                      <div>
                        <p className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-slate-500">Formato</p>
                        <select
                          className={`w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs outline-none focus:ring-2 ${s.focusInput}`}
                          value={dalleSize} onChange={e => setDalleSize(e.target.value)} disabled={dalleLoading}
                        >
                          <option value="1024x1024">Quadrato 1:1</option>
                          <option value="1792x1024">Orizzontale 16:9</option>
                          <option value="1024x1792">Verticale 9:16</option>
                        </select>
                      </div>
                      <div>
                        <p className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-slate-500">Qualità</p>
                        <TogglePair
                          options={[{ label: 'Standard', value: 'standard' }, { label: 'HD', value: 'hd' }]}
                          value={dalleQuality} onChange={setDalleQuality} disabled={dalleLoading} s={s}
                        />
                      </div>
                      <div>
                        <p className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-slate-500">Stile</p>
                        <TogglePair
                          options={[{ label: 'Naturale', value: 'natural' }, { label: 'Vivido', value: 'vivid' }]}
                          value={dalleStyle} onChange={setDalleStyle} disabled={dalleLoading} s={s}
                        />
                      </div>
                    </div>

                    {dalleError && <ErrorBox msg={dalleError} />}

                    <button
                      onClick={generateImage}
                      disabled={!dallePrompt.trim() || dalleLoading}
                      className={`inline-flex items-center gap-2 rounded-lg px-5 py-2.5 text-sm font-extrabold transition-all disabled:opacity-50 disabled:cursor-not-allowed ${s.btnCls}`}
                    >
                      {dalleLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                      {dalleLoading ? 'Generazione immagine…' : 'Genera immagine'}
                    </button>
                  </div>

                  {/* Result */}
                  {dalleResult && (
                    <motion.div
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm"
                    >
                      <div className="flex items-center gap-2 mb-4">
                        <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                        <span className="text-sm font-extrabold text-slate-900">Immagine generata</span>
                      </div>
                      <div className="flex gap-5 flex-wrap">
                        <img src={dalleResult.preview} alt="generated" className="h-56 w-auto rounded-lg border border-slate-200 shadow-sm object-cover" />
                        <div className="flex flex-col gap-3 justify-end min-w-[160px]">
                          {dalleResult.revised && (
                            <p className="text-[11px] text-slate-500 italic leading-5 max-w-xs">
                              "{dalleResult.revised.slice(0, 160)}{dalleResult.revised.length > 160 ? '…' : ''}"
                            </p>
                          )}
                          <button
                            onClick={useDalleFor3D}
                            className={`inline-flex items-center gap-2 rounded-lg px-4 py-2.5 text-sm font-extrabold transition-all ${s.btnCls}`}
                          >
                            <ArrowRight className="h-4 w-4" />
                            Usa per modello 3D
                          </button>
                          <a
                            href={dalleResult.preview} download="immagine_ai.png"
                            className="inline-flex items-center gap-2 rounded-lg border border-slate-200 px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50 transition-all"
                          >
                            <Download className="h-3.5 w-3.5" />Scarica PNG
                          </a>
                        </div>
                      </div>
                    </motion.div>
                  )}
                </div>
              )}

              {/* ─── IMG23D ─── */}
              {mode === 'img23d' && (
                <div className="space-y-4">
                  <div className={`rounded-lg border p-3 flex items-start gap-3 ${s.tip}`}>
                    <Lightbulb className={`h-4 w-4 flex-shrink-0 mt-0.5 ${s.tipIcon}`} />
                    <p className={`text-xs leading-5 ${s.tipText}`}>
                      <strong>Risultati migliori:</strong> usa immagini con soggetto isolato su sfondo bianco o trasparente. Più semplice è la silhouette, più precisa sarà la geometria 3D.
                    </p>
                  </div>

                  <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm space-y-5">
                    <SectionLabel mode="img23d" label="Immagine di partenza" />

                    {/* Upload area */}
                    {!imgSrc ? (
                      <button
                        onClick={() => fileRef.current?.click()}
                        disabled={!!isRunning3d}
                        className="w-full h-44 rounded-lg border-2 border-dashed border-slate-300 flex flex-col items-center justify-center gap-2 text-slate-400 hover:border-emerald-300 hover:text-emerald-500 transition-all disabled:opacity-50"
                      >
                        <Upload className="h-10 w-10" />
                        <span className="text-sm font-semibold">Carica immagine</span>
                        <span className="text-xs">PNG, JPG, WebP — max 10 MB</span>
                        <span className="text-[11px] text-slate-400">oppure usa "Testo → Immagine" per generarne una</span>
                      </button>
                    ) : (
                      <div className="flex gap-4 items-start flex-wrap">
                        <div className="relative">
                          <img src={imgSrc.preview} alt="input" className="h-44 w-auto rounded-lg border border-slate-200 shadow-sm object-cover" />
                          {!isRunning3d && (
                            <button
                              onClick={() => setImgSrc(null)}
                              className="absolute -top-2 -right-2 w-6 h-6 rounded-full bg-white border border-slate-200 shadow flex items-center justify-center hover:bg-red-50 transition-colors"
                            >
                              <X className="h-3.5 w-3.5 text-slate-500" />
                            </button>
                          )}
                        </div>
                        <div className="flex flex-col gap-1">
                          {imgSrc.name && <p className="text-xs font-semibold text-slate-600">{imgSrc.name}</p>}
                          <p className="text-[11px] text-slate-400">
                            {imgSrc.mime === 'image/png' && imgSrc.name?.endsWith('.png') === false
                              ? 'Da txt2img'
                              : imgSrc.mime.replace('image/', '').toUpperCase()}
                          </p>
                        </div>
                      </div>
                    )}
                    <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden"
                      onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f) }} />

                    {/* Advanced options toggle */}
                    <button
                      onClick={() => setShowAdvanced(v => !v)}
                      className="flex items-center gap-1.5 text-xs font-semibold text-slate-500 hover:text-slate-700 transition-colors"
                    >
                      {showAdvanced ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                      Opzioni avanzate 3D
                    </button>

                    {showAdvanced && (
                      <div className="space-y-4 border-t border-slate-100 pt-4">
                        <div className="grid grid-cols-2 gap-4">
                          <div>
                            <p className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-slate-500">Topologia mesh</p>
                            <TogglePair
                              options={[{ label: 'Quad', value: 'quad' }, { label: 'Triangoli', value: 'triangle' }]}
                              value={topology} onChange={setTopology} disabled={!!isRunning3d} s={s}
                            />
                          </div>
                          <div>
                            <p className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-slate-500">Densità poligoni</p>
                            <div className="flex flex-col gap-1">
                              {POLYCOUNT_OPTS.map(o => (
                                <button key={o.value} onClick={() => setPolycount(o.value)} disabled={!!isRunning3d}
                                  className={`rounded-lg border px-3 py-1.5 text-xs font-semibold text-left transition-all disabled:opacity-50 ${polycount === o.value ? s.optActive : 'border-slate-200 text-slate-600 hover:bg-slate-50'}`}>
                                  {o.label}
                                </button>
                              ))}
                            </div>
                          </div>
                        </div>
                        <label className="flex items-center gap-3 cursor-pointer select-none w-fit">
                          <div
                            className={`relative w-9 h-5 rounded-full transition-colors ${pbr ? 'bg-emerald-500' : 'bg-slate-300'}`}
                            onClick={() => !isRunning3d && setPbr(v => !v)}
                          >
                            <div className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all ${pbr ? 'left-4' : 'left-0.5'}`} />
                          </div>
                          <span className="text-sm font-semibold text-slate-700">Materiali PBR</span>
                          <span className="text-xs text-slate-400">Texture fisicamente accurate</span>
                        </label>
                      </div>
                    )}

                    <Gen3DButton s={s} disabled={!imgSrc} isRunning={!!isRunning3d} onClick={generate3D} task={task} onReset={reset3d} />
                  </div>
                </div>
              )}

              {/* ─── TXT23D ─── */}
              {mode === 'txt23d' && (
                <div className="space-y-4">
                  <div className={`rounded-lg border p-3 flex items-start gap-3 ${s.tip}`}>
                    <Lightbulb className={`h-4 w-4 flex-shrink-0 mt-0.5 ${s.tipIcon}`} />
                    <p className={`text-xs leading-5 ${s.tipText}`}>
                      <strong>Suggerimento:</strong> descrizioni dettagliate producono risultati migliori — specifica materiale, dimensioni, stato di conservazione, illuminazione. La generazione richiede 1–3 minuti.
                    </p>
                  </div>

                  <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm space-y-4">
                    <SectionLabel mode="txt23d" label="Descrizione oggetto 3D" />

                    <textarea
                      className={`w-full rounded-lg border border-slate-200 px-4 py-3 text-sm resize-none outline-none focus:ring-2 ${s.focusInput} transition-all`}
                      rows={5}
                      placeholder="Es: una sedia in legno massello chiaro, stile scandinavo, con quattro gambe sottili tornite, seduta piatta, schienale a doghe verticali, aspetto nuovo e levigato"
                      value={txt3dPrompt}
                      onChange={e => setTxt3dPrompt(e.target.value)}
                      disabled={!!isRunning3d}
                    />

                    <button
                      onClick={() => setShowNeg(v => !v)}
                      className="flex items-center gap-1.5 text-xs font-semibold text-slate-500 hover:text-slate-700 transition-colors"
                    >
                      {showNeg ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                      Negative prompt (elementi da escludere)
                    </button>

                    {showNeg && (
                      <input
                        className={`w-full rounded-lg border border-slate-200 px-4 py-2.5 text-sm outline-none focus:ring-2 ${s.focusInput} transition-all`}
                        value={txt3dNeg}
                        onChange={e => setTxt3dNeg(e.target.value)}
                        disabled={!!isRunning3d}
                        placeholder="low quality, low resolution, ugly, deformed…"
                      />
                    )}

                    <Gen3DButton s={s} disabled={!txt3dPrompt.trim()} isRunning={!!isRunning3d} onClick={generate3D} task={task} onReset={reset3d} />
                  </div>
                </div>
              )}

              {/* ─── Progress & Result (shared) ─── */}
              {error3d && <ErrorBox msg={error3d} />}

              {task && ['PENDING', 'IN_PROGRESS'].includes(task.status) && (
                <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
                  className="mt-4 rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2.5">
                      <Loader2 className={`h-4 w-4 animate-spin ${s.icon}`} />
                      <span className="text-sm font-bold text-slate-800">
                        {task.status === 'PENDING' ? 'In coda su Meshy AI…' : 'Generazione modello 3D…'}
                      </span>
                    </div>
                    <span className={`text-xl font-black ${s.icon}`}>{task.progress}%</span>
                  </div>
                  <div className="h-2.5 rounded-full bg-slate-100 overflow-hidden">
                    <motion.div
                      className={`h-full rounded-full ${s.progress}`}
                      animate={{ width: `${task.progress}%` }}
                      transition={{ duration: 0.6, ease: 'easeOut' }}
                    />
                  </div>
                  {task.thumbnail_url && (
                    <img src={task.thumbnail_url} alt="preview" className="mt-4 h-28 w-28 rounded-lg border border-slate-200 object-cover shadow-sm" />
                  )}
                </motion.div>
              )}

              {task?.status === 'FAILED' && (
                <ErrorBox msg={`Generazione fallita: ${task.error?.message || 'errore sconosciuto'}`} className="mt-4" />
              )}

              {activeGlb && (
                <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
                  className="mt-4 rounded-lg border border-slate-200 bg-white shadow-sm overflow-hidden">
                  <div className={`flex items-center justify-between px-5 py-3 border-b border-slate-100 ${S[viewingAsset ? viewingAsset.mode : taskMode].panel}`}>
                    <div className="flex items-center gap-2">
                      <CheckCircle2 className="h-4 w-4 text-emerald-500 flex-shrink-0" />
                      <span className="text-sm font-extrabold text-slate-900 truncate max-w-xs">
                        {viewingAsset?.label || (taskMode === 'txt23d' ? txt3dPrompt.trim() : imgSrc?.name) || 'Modello 3D'}
                      </span>
                    </div>
                    <div className="flex gap-2 flex-wrap">
                      <button
                        onClick={() => shareAsset({
                          id: task?.id ?? viewingAsset!.id,
                          label: viewingAsset?.label || (taskMode === 'txt23d' ? txt3dPrompt.trim() : imgSrc?.name) || 'Modello 3D',
                          mode: viewingAsset?.mode ?? taskMode,
                          glbUrl: rawGlb ?? '',
                          thumbnailUrl: task?.thumbnail_url ?? viewingAsset?.thumbnailUrl,
                          createdAt: new Date().toISOString(),
                        })}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-white/80 transition-all"
                      >
                        <Share2 className="h-3.5 w-3.5" />
                        {sessionId ? 'Condividi' : 'Chat non attiva'}
                      </button>
                      {rawGlb && (
                        <a href={rawGlb} download target="_blank" rel="noreferrer"
                          className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-extrabold transition-all ${S[viewingAsset ? viewingAsset.mode : taskMode].btnCls}`}>
                          <Download className="h-3.5 w-3.5" />GLB
                        </a>
                      )}
                      {task?.model_urls?.fbx && (
                        <a href={task.model_urls.fbx} download target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50">
                          <Download className="h-3.5 w-3.5" />FBX
                        </a>
                      )}
                    </div>
                  </div>
                  {/* @ts-expect-error model-viewer custom element */}
                  <model-viewer
                    src={activeGlb}
                    alt="modello 3D"
                    auto-rotate camera-controls shadow-intensity="1"
                    style={{ width: '100%', height: '460px', background: '#0f172a' }}
                  />
                </motion.div>
              )}

            </motion.div>
          </AnimatePresence>

          {/* ── Library ── */}
          {assets.length > 0 && (
            <section className="mt-10">
              <div className="mb-4 flex items-center justify-between gap-3">
                <div className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                  <Box className="h-4 w-4 text-slate-500" />
                  <h3 className="text-xs font-extrabold uppercase tracking-wide text-slate-700">Modelli generati</h3>
                  <span className="text-xs font-bold text-slate-400">{assets.length}</span>
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {assets.map(a => {
                  const as = S[a.mode] ?? S.txt23d
                  const isViewing = viewingAsset?.id === a.id
                  return (
                    <motion.div
                      key={a.id}
                      whileHover={{ y: -2 }}
                      className={`group relative flex flex-col overflow-hidden rounded-lg border shadow-sm transition-all hover:shadow-lg cursor-pointer ${
                        isViewing
                          ? `${as.selCard}`
                          : `${as.card}`
                      }`}
                      onClick={() => { setViewingAsset(isViewing ? null : a); setTask(null); setTaskId(null) }}
                    >
                      <div className={`absolute inset-x-0 top-0 h-1 ${as.stripe}`} />
                      <button
                        onClick={e => { e.stopPropagation(); deleteAsset(a.id) }}
                        className="absolute right-2 top-2 rounded-lg p-1 text-slate-400 opacity-0 transition-all hover:bg-red-50 hover:text-red-500 group-hover:opacity-100"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>

                      {/* Thumbnail */}
                      <div className="h-28 bg-slate-900 flex items-center justify-center overflow-hidden">
                        {a.thumbnailUrl
                          ? <img src={a.thumbnailUrl} alt={a.label} className="h-full w-full object-cover" />
                          : <Box className="h-8 w-8 text-slate-600" />
                        }
                      </div>

                      <div className="flex flex-col flex-1 p-3 gap-3">
                        <div>
                          <span className="line-clamp-2 text-sm font-extrabold leading-tight text-slate-950">{a.label}</span>
                          <div className="mt-2 flex items-center justify-between border-t border-slate-200/70 pt-2">
                            <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${as.badge}`}>
                              {a.mode === 'txt2img' ? 'DALL-E' : a.mode === 'img23d' ? 'img→3D' : 'txt→3D'}
                            </span>
                            <span className="text-xs text-slate-400">
                              {new Date(a.createdAt).toLocaleDateString('it-IT', { day: '2-digit', month: 'short' })}
                            </span>
                          </div>
                        </div>

                        <div className="flex gap-2 mt-auto">
                          <Button
                            tone="neutral" surface="soft" density="compact"
                            className="flex-1 text-xs"
                            onClick={e => { e.stopPropagation(); shareAsset(a) }}
                            title={sessionId ? 'Condividi in chat' : 'Nessuna sessione attiva'}
                          >
                            <Share2 className="h-3 w-3" />Chat
                          </Button>
                          <a
                            href={a.glbUrl} download target="_blank" rel="noreferrer"
                            onClick={e => e.stopPropagation()}
                            className={`inline-flex items-center justify-center gap-1 flex-1 rounded-lg px-3 py-1.5 text-xs font-extrabold transition-all ${as.btnCls}`}
                          >
                            <Download className="h-3 w-3" />GLB
                          </a>
                        </div>
                      </div>
                    </motion.div>
                  )
                })}
              </div>
            </section>
          )}
        </div>
      </div>

      {/* Toast */}
      <AnimatePresence>
        {toast && (
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 16 }}
            className="fixed bottom-6 left-1/2 -translate-x-1/2 rounded-xl bg-slate-900 px-5 py-2.5 text-sm font-bold text-white shadow-xl z-50"
          >
            {toast}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

// ── Sub-components ─────────────────────────────────────────────────────────

function SectionLabel({ mode, label }: { mode: Mode; label: string }) {
  const s = S[mode]
  return (
    <div className={`inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 ${s.section}`}>
      <span className="text-xs font-extrabold uppercase tracking-wide">{label}</span>
    </div>
  )
}

function TogglePair({
  options, value, onChange, disabled, s,
}: {
  options: { label: string; value: string }[]
  value: string
  onChange: (v: string) => void
  disabled?: boolean
  s: typeof S[Mode]
}) {
  return (
    <div className="flex gap-1">
      {options.map(o => (
        <button
          key={o.value}
          onClick={() => onChange(o.value)}
          disabled={disabled}
          className={`flex-1 rounded-lg border px-2 py-2 text-xs font-semibold transition-all disabled:opacity-50 ${
            value === o.value ? s.optActive : 'border-slate-200 text-slate-600 hover:bg-slate-50'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

function Gen3DButton({
  s, disabled, isRunning, onClick, task, onReset,
}: {
  s: typeof S[Mode]
  disabled: boolean
  isRunning: boolean
  onClick: () => void
  task: Task3D | null
  onReset: () => void
}) {
  return (
    <div className="flex gap-3 flex-wrap">
      <button
        onClick={onClick}
        disabled={disabled || isRunning}
        className={`inline-flex items-center gap-2 rounded-lg px-5 py-2.5 text-sm font-extrabold transition-all disabled:opacity-50 disabled:cursor-not-allowed ${s.btnCls}`}
      >
        {isRunning ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
        {isRunning ? 'Generazione 3D in corso…' : 'Genera modello 3D'}
      </button>
      {task && (
        <Button tone="neutral" surface="outline" density="default" onClick={onReset}>
          <RotateCcw className="h-4 w-4" />
          Ricomincia
        </Button>
      )}
    </div>
  )
}

function ErrorBox({ msg, className = '' }: { msg: string; className?: string }) {
  return (
    <div className={`flex items-start gap-3 rounded-lg border border-red-200 bg-red-50 p-4 ${className}`}>
      <AlertCircle className="h-5 w-5 text-red-500 flex-shrink-0 mt-0.5" />
      <p className="text-sm text-red-700">{msg}</p>
    </div>
  )
}
