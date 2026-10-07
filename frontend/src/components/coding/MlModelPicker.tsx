import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Brain, Check, Loader2, X } from '@/components/icons'
import { mlLabApi, type MLLabProjectSummary } from '@/lib/api'
import { MODE_LABEL, modeOfEngine } from '@/lib/mlFeatures'
import { Button } from '@/components/ui/button'

export const ML_MODELS_PATH = 'ml-models.md'

/** The knowledge-base file the code generator reads: which models exist, and how to call them. */
export function buildMlModelsMarkdown(projects: MLLabProjectSummary[]): string {
  const list = projects.map((p) => {
    const mode = modeOfEngine(p.engine)
    const noun = mode === 'hand' ? 'mano' : mode === 'pose' ? 'corpo' : 'immagine'
    return `- **${p.name}** · tipo: ${MODE_LABEL[mode]} (riconosce ${noun}) · id: ${p.id} · classi: ${p.classes.map((c) => `«${c.name}»`).join(', ')}`
  }).join('\n')
  const first = projects[0]
  const firstMode = first ? modeOfEngine(first.engine) : 'hand'
  const sampleLabel = first?.classes[0]?.name ?? 'Classe 1'
  const sampleName = first?.name ?? 'Nome del modello'
  return `# Modelli ML collegati (Lab ML)

Questo progetto usa modelli di riconoscimento addestrati dall'utente nel Lab ML. Sono **VINCOLANTI**: se l'utente chiede di reagire a pose, gesti o immagini, usa QUESTI modelli tramite \`window.GolinelliML\`.
NON importare librerie di tracking (MediaPipe, TensorFlow, ml5, PoseNet…), NON aggiungere tag script e NON inventare altri modelli: l'API è già presente nella pagina e funziona in locale nel browser (la webcam non esce dal dispositivo).

## Modelli disponibili
${list}

## API
\`\`\`js
const model = await window.GolinelliML.load('${sampleName}')   // per nome oppure per id
// model.labels -> nomi delle classi, model.mode -> '${firstMode}'

// 1) riconoscimento continuo di un <video> (o canvas / elemento p5): ritorna la funzione per fermarlo
const stop = model.start(videoElement, {
  onResult: (r) => { /* r.label = classe riconosciuta oppure null se non è sicuro; r.best = classe più probabile;
                        r.confidence 0..1; r.probs = { 'Nome classe': probabilità }; r.detected = false se non vede mano/persona;
                        r.hand = 21 punti {x,y} in pixel (modelli mani); r.pose = 17 punti {x,y,score} in pixel (modelli pose) */ },
})

// 2) eventi: scatta quando una classe resta attiva per holdMs, si riarma quando cambia
model.on('${sampleLabel}', () => { /* attiva la funzione */ }, { minConfidence: 0.75, holdMs: 250 })
model.onChange((label) => { /* label: nome della classe oppure null */ })

// 3) una sola classificazione
const r = await model.classify(videoElement)
\`\`\`

## Webcam
Ottieni il video con \`await window.GolinelliAI.media.camera()\` (stream) oppure con \`createCapture(VIDEO)\` di p5.js. Passa all'API l'elemento <video> (in p5: \`capture.elt\`, oppure direttamente il p5.Element).
Il video della webcam è speculare per l'utente: mostralo specchiato con CSS (\`transform: scaleX(-1)\`) e disegna i punti \`r.hand\` / \`r.pose\` nello stesso modo.

## Esempio p5.js (gesti → azioni)
\`\`\`js
let capture, model, current = null, hand = null;
async function setup() {
  createCanvas(640, 480);
  capture = createCapture(VIDEO); capture.size(640, 480); capture.hide();
  model = await window.GolinelliML.load('${sampleName}');
  model.start(capture.elt, { onResult: (r) => { current = r.label; hand = r.hand || r.pose || null; } });
  model.on('${sampleLabel}', () => { /* es. cambia colore, suona, avvia un'animazione */ });
}
function draw() {
  push(); translate(width, 0); scale(-1, 1); image(capture, 0, 0, width, height);
  if (hand) { fill(255); noStroke(); hand.forEach((p) => circle(p.x * width / capture.width, p.y * height / capture.height, 8)); }
  pop();
  fill(255); textSize(28); text(current || 'Nessun gesto riconosciuto', 20, 40);
}
\`\`\`
Gestisci sempre il caso \`label === null\` (non sicuro) e \`detected === false\`. Non bloccare mai draw() con operazioni lente: la classificazione gira in modo asincrono.
`
}

/** Attach Lab ML models to the open Vibe Lab project. */
export default function MlModelPicker({ attachedIds, onApply, onClose }: { attachedIds: string[]; onApply: (projects: MLLabProjectSummary[]) => void; onClose: () => void }) {
  const query = useQuery({ queryKey: ['ml-lab', 'projects'], queryFn: async () => (await mlLabApi.list()).data.projects })
  const [selected, setSelected] = useState<Set<string>>(new Set(attachedIds))
  const projects = query.data ?? []
  const toggle = (id: string) => setSelected((prev) => { const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next })

  return (
    <div className="fixed inset-0 z-[300] flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-sm" onMouseDown={onClose}>
      <div className="flex max-h-[85vh] w-full max-w-lg flex-col rounded-3xl bg-white shadow-2xl dark:bg-slate-900" onMouseDown={(event) => event.stopPropagation()} role="dialog" aria-modal="true" aria-label="Modelli ML del progetto">
        <div className="flex items-start justify-between gap-4 border-b border-slate-100 p-5 dark:border-white/10">
          <div className="flex gap-3">
            <span className="ds-squircle flex h-11 w-11 shrink-0 items-center justify-center text-white" style={{ background: '#7b69c9' }}><Brain className="h-5 w-5" /></span>
            <div>
              <h2 className="text-lg font-bold text-slate-900">Modelli ML del progetto</h2>
              <p className="mt-0.5 text-xs leading-5 text-slate-500">Scegli i modelli del Lab ML (immagini, pose, gesti delle mani) che l'app può usare. L'IA saprà come richiamarli e li troverai in <code>ml-models.md</code>.</p>
            </div>
          </div>
          <button onClick={onClose} className="rounded-xl p-2 text-slate-400 hover:bg-slate-100" aria-label="Chiudi"><X className="h-5 w-5" /></button>
        </div>
        <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-5">
          {query.isLoading && <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-slate-400" /></div>}
          {!query.isLoading && projects.length === 0 && <p className="rounded-2xl bg-slate-50 p-5 text-center text-sm text-slate-500">Non hai ancora progetti nel Lab ML. Creane uno, addestralo con qualche esempio e poi torna qui.</p>}
          {projects.map((project) => {
            const mode = modeOfEngine(project.engine)
            const usable = project.has_model !== false
            const checked = selected.has(project.id)
            return (
              <button key={project.id} type="button" disabled={!usable} onClick={() => toggle(project.id)}
                className={`flex w-full items-center gap-3 rounded-2xl border p-3.5 text-left transition disabled:opacity-50 ${checked ? 'border-violet-400 bg-violet-50 ring-2 ring-violet-100 dark:bg-violet-500/10' : 'border-slate-200 hover:border-violet-200 dark:border-white/10'}`}>
                <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-lg border ${checked ? 'border-violet-600 bg-violet-600 text-white' : 'border-slate-300'}`}>{checked && <Check className="h-4 w-4" />}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-bold text-slate-900">{project.name}</span>
                  <span className="block truncate text-xs text-slate-500">{MODE_LABEL[mode]} · {project.classes.map((c) => c.name).join(', ')}{usable ? '' : ' · nessun modello addestrato'}</span>
                </span>
                {project.accuracy !== null && <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-600 dark:bg-white/10">~{Math.round(project.accuracy * 100)}%</span>}
              </button>
            )
          })}
        </div>
        <div className="flex items-center justify-between gap-3 border-t border-slate-100 p-5 dark:border-white/10">
          <span className="text-xs text-slate-400">{selected.size} selezionati</span>
          <div className="flex gap-2">
            <Button tone="neutral" surface="ghost" onClick={onClose}>Annulla</Button>
            <Button tone="accent" surface="solid" onClick={() => onApply(projects.filter((p) => selected.has(p.id)))}>{selected.size === 0 ? 'Scollega tutti' : 'Collega al progetto'}</Button>
          </div>
        </div>
      </div>
    </div>
  )
}
