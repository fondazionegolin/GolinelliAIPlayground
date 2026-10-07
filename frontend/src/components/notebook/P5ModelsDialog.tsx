import { useEffect, useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Brain, Camera, Check, Hand, Image as ImageIcon, Loader2, Plus, Trash2, User, X } from '@/components/icons'
import { mlLabApi, type MLLabProjectSummary } from '@/lib/api'
import { CONFIDENCE_THRESHOLD, embedImage, headFromJSON, loadEmbedder, predict, smooth, INPUT_SIZE, type Head, type HeadJSON } from '@/lib/imageClassifier'
import { MODE_LABEL, drawOverlay, extractFeatures, loadLandmarkEngine, modeOfEngine, type Mode } from '@/lib/mlFeatures'
import { Button } from '@/components/ui/button'

const MODE_ICON = { image: ImageIcon, pose: User, hand: Hand } as const
const MODE_COLOR: Record<Mode, string> = { image: '#3ea9f4', pose: '#7b69c9', hand: '#e85c8d' }

interface RuntimeModel { id: string; name: string; mode: Mode; classes: Array<{ id: string; name: string; color?: string }>; head: HeadJSON }

const esc = (text: string) => text.replace(/\\/g, '\\\\').replace(/'/g, "\\'")

/** A complete, working sketch that uses the model. */
export function buildFullSketch(project: MLLabProjectSummary): string {
  const mode = modeOfEngine(project.engine)
  const first = esc(project.classes[0]?.name ?? 'Classe 1')
  const noun = mode === 'hand' ? 'gesto' : mode === 'pose' ? 'posa' : 'oggetto'
  return `// Modello ML «${project.name}» (${MODE_LABEL[mode]}) — classi: ${project.classes.map((c) => `«${c.name}»`).join(', ')}
// Regole: window.GolinelliML è già disponibile (non serve importare nulla). La webcam resta nel tuo browser.
//  - model.start(video, { onResult }) analizza il video di continuo
//  - result.label è la classe riconosciuta, oppure null quando il modello non è sicuro
//  - model.on('Classe', funzione) scatta quando la classe resta attiva per circa 0,25 secondi
let capture, model
let result = { label: null, detected: false }

async function setup() {
  createCanvas(640, 480)
  capture = createCapture(VIDEO)
  capture.size(640, 480)
  capture.hide()
  model = await GolinelliML.load('${esc(project.name)}')
  model.start(capture.elt, { onResult: (r) => { result = r } })
  model.on('${first}', () => {
    // Qui la tua funzione: cambia colore, suona, avvia un'animazione…
    console.log('${first}!')
  })
}

function draw() {
  background(20)
  // il video è specchiato, come in uno specchio
  push()
  translate(width, 0)
  scale(-1, 1)
  image(capture, 0, 0, width, height)
  const points = result.hand || result.pose
  if (points) {
    noStroke()
    fill(255)
    for (const p of points) circle(p.x / result.width * width, p.y / result.height * height, 8)
  }
  pop()
  fill(255)
  textSize(28)
  text(result.label ? result.label : result.detected ? 'Non sono sicuro' : 'Nessun ${noun} rilevato', 20, 40)
}
`
}

/** Only the wiring, to paste into an existing sketch. */
export function buildSnippet(project: MLLabProjectSummary): string {
  const first = esc(project.classes[0]?.name ?? 'Classe 1')
  return `
// ── Modello ML «${project.name}» (Lab ML) ──────────────────────────────
// Chiama setupML() dentro setup() e usa mlResult in draw():  mlResult.label è la classe riconosciuta (o null).
let mlCapture, mlModel
let mlResult = { label: null, detected: false }
async function setupML() {
  mlCapture = createCapture(VIDEO)
  mlCapture.size(640, 480)
  mlCapture.hide()
  mlModel = await GolinelliML.load('${esc(project.name)}')
  mlModel.start(mlCapture.elt, { onResult: (r) => { mlResult = r } })
  mlModel.on('${first}', () => {
    // Qui la tua funzione
  })
}
`
}

/** Live preview: the model running on the webcam, with the skeleton drawn over the video. */
function ModelLivePreview({ projectId }: { projectId: string }) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const overlayRef = useRef<HTMLCanvasElement>(null)
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [message, setMessage] = useState('')
  const [model, setModel] = useState<RuntimeModel | null>(null)
  const [probs, setProbs] = useState<number[] | null>(null)
  const [detected, setDetected] = useState(true)

  useEffect(() => {
    let cancelled = false
    let stream: MediaStream | null = null
    let timer: ReturnType<typeof setTimeout>
    setState('loading'); setProbs(null)
    ;(async () => {
      try {
        const runtime = (await mlLabApi.runtimeModel(projectId)).data as RuntimeModel
        if (cancelled) return
        setModel(runtime)
        const head: Head = headFromJSON(runtime.head)
        await (runtime.mode === 'image' ? loadEmbedder() : loadLandmarkEngine(runtime.mode))
        stream = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 480 }, height: { ideal: 360 }, facingMode: 'user' } })
        if (cancelled) { stream.getTracks().forEach((track) => track.stop()); return }
        const video = videoRef.current!
        video.srcObject = stream
        await video.play().catch(() => undefined)
        setState('ready')
        let previous: number[] | null = null
        let busy = 80
        const tick = async () => {
          if (cancelled) return
          const started = performance.now()
          if (video.readyState >= 2 && video.videoWidth) {
            try {
              if (runtime.mode === 'image') {
                const canvas = document.createElement('canvas')
                canvas.width = canvas.height = INPUT_SIZE
                const side = Math.min(video.videoWidth, video.videoHeight)
                canvas.getContext('2d')!.drawImage(video, (video.videoWidth - side) / 2, (video.videoHeight - side) / 2, side, side, 0, 0, INPUT_SIZE, INPUT_SIZE)
                const [vector] = await embedImage(canvas)
                previous = smooth(previous, predict(head, vector)); setProbs(previous); setDetected(true)
              } else {
                const found = await extractFeatures(runtime.mode, video)
                if (overlayRef.current) drawOverlay(overlayRef.current, found?.overlay ?? null)
                setDetected(Boolean(found))
                if (found) { previous = smooth(previous, predict(head, found.vector)); setProbs(previous) } else { previous = null; setProbs(null) }
              }
            } catch (error) { console.error(error) }
          }
          busy = busy * 0.8 + (performance.now() - started) * 0.2
          timer = setTimeout(tick, Math.min(700, Math.max(120, busy * 2)))
        }
        void tick()
      } catch (error: any) {
        if (cancelled) return
        setState('error')
        setMessage(error?.response?.data?.detail || (error?.name === 'NotAllowedError' ? 'Consenti l’accesso alla webcam per vedere l’anteprima.' : 'Non riesco ad avviare l’anteprima.'))
      }
    })()
    return () => { cancelled = true; clearTimeout(timer); stream?.getTracks().forEach((track) => track.stop()) }
  }, [projectId])

  const labels = model?.head.classIds.map((id) => model.classes.find((c) => c.id === id)) ?? []
  const best = probs ? probs.indexOf(Math.max(...probs)) : -1
  const sure = best >= 0 && probs![best] >= CONFIDENCE_THRESHOLD
  return (
    <div className="overflow-hidden rounded-2xl bg-slate-900">
      <div className="relative aspect-[4/3]">
        <video ref={videoRef} playsInline muted className="h-full w-full -scale-x-100 object-cover" />
        {model && model.mode !== 'image' && <canvas ref={overlayRef} className="pointer-events-none absolute inset-0 h-full w-full -scale-x-100 object-cover" />}
        {state === 'loading' && <div className="absolute inset-0 flex items-center justify-center gap-2 text-sm text-white/80"><Loader2 className="h-4 w-4 animate-spin" /> Avvio anteprima…</div>}
        {state === 'error' && <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-5 text-center text-sm text-white/80"><Camera className="h-7 w-7" />{message}</div>}
        {state === 'ready' && (
          <span className="absolute inset-x-3 bottom-3 rounded-2xl px-4 py-2 text-center text-sm font-black text-white backdrop-blur" style={{ background: sure ? labels[best]?.color || '#7b69c9' : 'rgba(30,41,59,.82)' }}>
            {!detected ? 'Nessun riconoscimento: mostrati alla webcam' : sure ? `${labels[best]?.name} · ${Math.round(probs![best] * 100)}%` : 'Non sono sicuro'}
          </span>
        )}
      </div>
      {state === 'ready' && probs && (
        <ul className="space-y-1.5 bg-white p-3 dark:bg-slate-900">
          {labels.map((cls, index) => (
            <li key={cls?.id ?? index} className="flex items-center gap-2 text-[11px] font-semibold text-slate-600">
              <span className="w-28 truncate">{cls?.name}</span>
              <span className="h-2 flex-1 overflow-hidden rounded-full bg-slate-100 dark:bg-white/10"><span className="block h-full rounded-full transition-[width] duration-150" style={{ width: `${probs[index] * 100}%`, background: cls?.color || '#7b69c9' }} /></span>
              <span className="w-8 text-right tabular-nums">{Math.round(probs[index] * 100)}%</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/** Attach Lab ML models to a p5.js sketch: pick one, see how it behaves live, and drop the code into the sketch. */
export default function P5ModelsDialog({ attachedIds, onAttach, onDetach, onInsert, onClose }: {
  attachedIds: string[]
  onAttach: (project: MLLabProjectSummary) => void
  onDetach: (id: string) => void
  onInsert: (code: string, replace: boolean) => void
  onClose: () => void
}) {
  const query = useQuery({ queryKey: ['ml-lab', 'projects'], queryFn: async () => (await mlLabApi.list()).data.projects })
  const projects = useMemo(() => (query.data ?? []).filter((p) => p.has_model !== false), [query.data])
  const [selectedId, setSelectedId] = useState<string | null>(attachedIds[0] ?? null)
  useEffect(() => { if (!selectedId && projects.length) setSelectedId(projects.find((p) => modeOfEngine(p.engine) === 'hand')?.id ?? projects[0].id) }, [projects, selectedId])
  const selected = projects.find((p) => p.id === selectedId) ?? null
  const attached = selected ? attachedIds.includes(selected.id) : false
  const mode = selected ? modeOfEngine(selected.engine) : 'hand'

  return (
    <div className="fixed inset-0 z-[300] flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-sm" onMouseDown={onClose}>
      <div className="flex max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-3xl bg-white shadow-2xl dark:bg-slate-900" onMouseDown={(event) => event.stopPropagation()} role="dialog" aria-modal="true" aria-label="Modelli ML per lo sketch">
        <div className="flex items-start justify-between gap-4 border-b border-slate-100 p-5 dark:border-white/10">
          <div className="flex gap-3">
            <span className="ds-squircle flex h-11 w-11 shrink-0 items-center justify-center text-white" style={{ background: '#7b69c9' }}><Brain className="h-5 w-5" /></span>
            <div>
              <h2 className="text-lg font-bold text-slate-900">Modelli del Lab ML</h2>
              <p className="mt-0.5 text-xs leading-5 text-slate-500">Usa nello sketch un modello che hai addestrato: gesti delle mani, pose del corpo o immagini. Provalo dal vivo, poi inseriscilo nel codice.</p>
            </div>
          </div>
          <button onClick={onClose} className="rounded-xl p-2 text-slate-400 hover:bg-slate-100" aria-label="Chiudi"><X className="h-5 w-5" /></button>
        </div>

        <div className="grid min-h-0 flex-1 gap-0 overflow-y-auto md:grid-cols-[17rem_minmax(0,1fr)]">
          {/* list */}
          <div className="space-y-1.5 border-b border-slate-100 p-4 md:border-b-0 md:border-r dark:border-white/10">
            {query.isLoading && <div className="flex justify-center py-6"><Loader2 className="h-5 w-5 animate-spin text-slate-400" /></div>}
            {!query.isLoading && projects.length === 0 && <p className="rounded-2xl bg-slate-50 p-4 text-center text-xs leading-5 text-slate-500 dark:bg-white/5">Nessun modello addestrato. Apri il Lab ML, crea un progetto «Gesti delle mani», registra qualche esempio e torna qui.</p>}
            {projects.map((project) => {
              const kind = modeOfEngine(project.engine)
              const Icon = MODE_ICON[kind]
              const active = project.id === selectedId
              return (
                <button key={project.id} type="button" onClick={() => setSelectedId(project.id)} className={`flex w-full items-center gap-3 rounded-2xl p-2.5 text-left transition ${active ? 'bg-violet-50 ring-2 ring-violet-200 dark:bg-violet-500/10' : 'hover:bg-slate-50 dark:hover:bg-white/5'}`}>
                  <span className="ds-squircle flex h-10 w-10 shrink-0 items-center justify-center text-white" style={{ background: MODE_COLOR[kind] }}><Icon className="h-5 w-5" strokeWidth={1.7} /></span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-bold text-slate-900">{project.name}</span>
                    <span className="block truncate text-[11px] text-slate-500">{MODE_LABEL[kind]} · {project.classes.length} classi</span>
                  </span>
                  {attachedIds.includes(project.id) && <Check className="h-4 w-4 shrink-0 text-emerald-500" />}
                </button>
              )
            })}
          </div>

          {/* detail */}
          <div className="p-5">
            {!selected ? <p className="py-16 text-center text-sm text-slate-400">Scegli un modello per vedere come funziona.</p> : (
              <div className="grid gap-5 lg:grid-cols-2">
                <div>
                  <h3 className="mb-2 text-xs font-black uppercase tracking-wider text-slate-400">Anteprima di funzionamento</h3>
                  <ModelLivePreview key={selected.id} projectId={selected.id} />
                  <p className="mt-2 text-[11px] leading-4 text-slate-400">Prova i tuoi {mode === 'hand' ? 'gesti' : mode === 'pose' ? 'movimenti' : 'oggetti'}: è esattamente ciò che vedrà lo sketch.</p>
                </div>
                <div className="space-y-4">
                  <div>
                    <h3 className="mb-2 text-xs font-black uppercase tracking-wider text-slate-400">Classi riconosciute</h3>
                    <div className="flex flex-wrap gap-1.5">{selected.classes.map((cls) => <span key={cls.id} className="rounded-full px-2.5 py-1 text-xs font-bold text-white" style={{ background: cls.color }}>{cls.name}</span>)}</div>
                  </div>
                  <div>
                    <h3 className="mb-2 text-xs font-black uppercase tracking-wider text-slate-400">Regole d’uso nello sketch</h3>
                    <ul className="space-y-1.5 text-xs leading-5 text-slate-600">
                      <li>• Non serve importare nulla: <code className="rounded bg-slate-100 px-1 dark:bg-white/10">GolinelliML</code> è già nella pagina.</li>
                      <li>• <code className="rounded bg-slate-100 px-1 dark:bg-white/10">result.label</code> è la classe riconosciuta, oppure <b>null</b> se il modello non è sicuro.</li>
                      <li>• <code className="rounded bg-slate-100 px-1 dark:bg-white/10">model.on('Classe', fn)</code> esegue <code>fn</code> quando la classe resta attiva per ~0,25 s.</li>
                      {mode !== 'image' && <li>• <code className="rounded bg-slate-100 px-1 dark:bg-white/10">result.{mode === 'hand' ? 'hand' : 'pose'}</code> contiene i punti {mode === 'hand' ? 'della mano (21)' : 'del corpo (17)'} per disegnarli.</li>}
                      <li>• La webcam resta nel tuo browser: nulla viene inviato.</li>
                    </ul>
                  </div>
                  <div className="flex flex-col gap-2">
                    <Button tone="accent" surface="solid" onClick={() => { onAttach(selected); onInsert(buildFullSketch(selected), true) }}>
                      <Plus className="h-4 w-4" /> Crea uno sketch pronto con questo modello
                    </Button>
                    <Button tone="neutral" surface="outline" onClick={() => { onAttach(selected); onInsert(buildSnippet(selected), false) }}>
                      Aggiungi solo il collegamento al mio sketch
                    </Button>
                    {attached && <button type="button" onClick={() => onDetach(selected.id)} className="flex items-center justify-center gap-1.5 text-xs font-semibold text-slate-400 hover:text-red-600"><Trash2 className="h-3.5 w-3.5" /> Scollega dallo sketch</button>}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
