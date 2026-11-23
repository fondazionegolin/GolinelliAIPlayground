import { useCallback, useEffect, useRef, useState } from 'react'
import api, { meshyApi, type MeshyGenerationOptions } from '@/lib/api'
import { imageToDataUrl } from '@/components/canvasAi'
import { Box, Check, Loader2, Scissors } from '@/components/icons'
import { Button, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/design'
import { tl } from '@/i18n/tl'

type Verdict = { subject: string; feasible: boolean; score: number; kind: string; issues: string[]; advice: string; needs_cutout: boolean }
type Phase = 'checking' | 'review' | 'cutting' | 'generating' | 'saving' | 'error'
export type StoredModel = { src: string; poster?: string; usdz?: string; title: string }

const POLL_MS = 4000
const MAX_WAIT_MS = 15 * 60 * 1000

function errorText(err: unknown, fallback: string) {
  const detail = (err as { response?: { data?: { detail?: unknown } } }).response?.data?.detail
  return typeof detail === 'string' ? detail : fallback
}

/** The image as PNG (keeps the transparency left by «Scontorna»), at most `maxSide` px. */
async function imageToPng(src: string, maxSide = 1536): Promise<{ data: string; mime: string } | null> {
  const img = await new Promise<HTMLImageElement | null>((resolve) => {
    const el = new Image(); el.crossOrigin = 'anonymous'
    el.onload = () => resolve(el); el.onerror = () => resolve(null); el.src = src
  })
  if (!img) return null
  const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(img.naturalWidth * scale)); canvas.height = Math.max(1, Math.round(img.naturalHeight * scale))
  canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height)
  try { return { data: canvas.toDataURL('image/png').split(',')[1], mime: 'image/png' } } catch { return null }
}

/**
 * Image → 3D model on the board: a cheap vision check first (is this picture a good source?), an optional local
 * cut-out, then Meshy image-to-3D with PBR textures. The finished GLB is copied to the board's own storage.
 */
export function CanvasModelWizard({ boardId, imageId, getImageSrc, onCutout, onDone, onClose }: {
  boardId: string
  imageId: string
  getImageSrc: () => string | null
  /** Local background removal on the board image; resolves when the item holds the new picture. */
  onCutout: () => Promise<boolean>
  onDone: (model: StoredModel) => void
  onClose: () => void
}) {
  const [phase, setPhase] = useState<Phase>('checking')
  const [verdict, setVerdict] = useState<Verdict | null>(null)
  const [cut, setCut] = useState(false)
  const [progress, setProgress] = useState(0)
  const [message, setMessage] = useState('')
  const alive = useRef(true)
  useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])

  const check = useCallback(async () => {
    setPhase('checking'); setMessage('')
    const src = getImageSrc()
    const dataUrl = src ? await imageToDataUrl(src) : null
    if (!dataUrl) { setMessage(tl("Non riesco a leggere questa immagine.")); setPhase('error'); return }
    try {
      const { data } = await api.post<Verdict>(`/smart-canvases/${boardId}/model-check`, { image: dataUrl }, { timeout: 90000 })
      if (!alive.current) return
      setVerdict(data); setPhase('review')
    } catch (err) {
      if (!alive.current) return
      setMessage(errorText(err, tl("Non sono riuscito a valutare l’immagine."))); setPhase('error')
    }
  }, [boardId, getImageSrc])
  useEffect(() => { void check() }, [check, imageId])

  const cutout = async () => {
    setPhase('cutting')
    const ok = await onCutout()
    if (!alive.current) return
    setCut(ok)
    await check()
  }

  const generate = async () => {
    const src = getImageSrc()
    const png = src ? await imageToPng(src) : null
    if (!png) { setMessage(tl("Non riesco a leggere questa immagine.")); setPhase('error'); return }
    setPhase('generating'); setProgress(0); setMessage(tl("In coda su Meshy…"))
    try {
      const started = await meshyApi.generate3D({
        image_data: png.data, image_mime: png.mime,
        // light enough for a phone: ~20k triangles, 2K textures; USDZ lets iOS open AR without converting on the device
        options: { should_texture: true, enable_pbr: true, texture_resolution: '2k', image_enhancement: true, should_remesh: true, topology: 'triangle', target_polycount: 20000, target_formats: ['glb', 'usdz'] } as unknown as MeshyGenerationOptions,
      })
      const taskId = started.data.task_id
      const deadline = Date.now() + MAX_WAIT_MS
      for (;;) {
        await new Promise((r) => window.setTimeout(r, POLL_MS))
        if (!alive.current) return
        if (Date.now() > deadline) throw new Error(tl("Meshy sta impiegando troppo: riprova più tardi."))
        let task
        try { task = (await meshyApi.getImageTo3DStatus(taskId)).data } catch { continue }
        setProgress(Math.round(task.progress || 0))
        setMessage(task.progress ? tl("Meshy sta modellando e applicando le texture…") : tl("In coda su Meshy…"))
        if (task.status === 'FAILED' || task.status === 'EXPIRED') throw new Error(task.error?.message || tl("Meshy non ha completato la generazione"))
        if (task.status === 'SUCCEEDED') {
          const glb = task.model_urls?.glb
          if (!glb) throw new Error(tl("Meshy non ha restituito un file GLB."))
          setPhase('saving')
          const { data } = await api.post<{ src: string; poster: string | null; usdz: string | null }>(`/smart-canvases/${boardId}/models`, { glb_url: glb, thumbnail_url: task.thumbnail_url || null, usdz_url: task.model_urls?.usdz || null }, { timeout: 150000 })
          if (!alive.current) return
          onDone({ src: data.src, poster: data.poster || undefined, usdz: data.usdz || undefined, title: verdict?.subject || tl("Modello 3D") })
          return
        }
      }
    } catch (err) {
      if (!alive.current) return
      setMessage(errorText(err, err instanceof Error && err.message ? err.message : tl("Generazione non riuscita."))); setPhase('error')
    }
  }

  const busy = phase === 'checking' || phase === 'cutting' || phase === 'generating' || phase === 'saving'
  const closable = phase !== 'generating' && phase !== 'saving'
  return (
    <Dialog open onOpenChange={(open) => { if (!open && closable) onClose() }}>
      <DialogContent size="md" showClose={closable}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Box className="h-4 w-4" />{tl("Crea un modello 3D")}</DialogTitle>
          <DialogDescription>{tl("Controllo se l’immagine è adatta, poi Meshy ne ricava un modello con le texture.")}</DialogDescription>
        </DialogHeader>

        {(phase === 'checking' || phase === 'cutting') && (
          <p className="flex items-center gap-2 text-sm text-[var(--text-secondary)]"><Loader2 className="h-4 w-4 animate-spin" />{phase === 'cutting' ? tl("Scontorno l’immagine…") : tl("Valuto l’immagine…")}</p>
        )}

        {phase === 'review' && verdict && (
          <div className="grid gap-3 text-sm">
            <p className="text-[var(--text-primary)]"><span className="font-semibold">{verdict.subject}</span></p>
            <p className={verdict.feasible ? 'flex items-center gap-1.5 font-semibold text-emerald-600' : 'font-semibold text-amber-600'}>
              {verdict.feasible ? <><Check className="h-4 w-4" />{tl("Adatta al 3D")} · {verdict.score}/100</> : <>{tl("Poco adatta al 3D")} · {verdict.score}/100</>}
            </p>
            {verdict.issues.length > 0 && <ul className="list-disc space-y-0.5 pl-5 text-[var(--text-secondary)]">{verdict.issues.map((issue) => <li key={issue}>{issue}</li>)}</ul>}
            {verdict.advice && <p className="text-[var(--text-secondary)]">{verdict.advice}</p>}
            {verdict.needs_cutout && !cut && <p className="text-[var(--text-secondary)]">{tl("Lo sfondo disturba: scontornare prima migliora molto il risultato.")}</p>}
            <p className="text-xs text-[var(--text-secondary)]">{tl("La generazione consuma crediti Meshy e può richiedere alcuni minuti; tieni aperta la lavagna finché non è pronto.")}</p>
          </div>
        )}

        {(phase === 'generating' || phase === 'saving') && (
          <div className="grid gap-2">
            <div className="h-2 overflow-hidden rounded-full bg-[var(--ds-well)]"><div className="h-full rounded-full bg-[#e85c8d] transition-all" style={{ width: `${phase === 'saving' ? 100 : Math.max(4, progress)}%` }} /></div>
            <p className="text-xs text-[var(--text-secondary)]">{phase === 'saving' ? tl("Salvo il modello sulla lavagna…") : `${progress}% · ${message}`}</p>
            <p className="text-xs text-[var(--text-secondary)]">{tl("Tieni aperta questa lavagna: il modello apparirà accanto all’immagine.")}</p>
          </div>
        )}

        {phase === 'error' && <p className="text-sm font-semibold text-rose-600">{message}</p>}

        <DialogFooter>
          {phase === 'review' && verdict && (
            <>
              <Button type="button" surface="ghost" onClick={onClose}>{tl("Annulla")}</Button>
              {(verdict.needs_cutout || !verdict.feasible) && !cut && <Button type="button" surface="soft" onClick={() => void cutout()}><Scissors className="h-4 w-4" />{tl("Scontorna prima")}</Button>}
              <Button type="button" tone="accent" surface="solid" onClick={() => void generate()}>{verdict.feasible ? tl("Genera il modello 3D") : tl("Genera comunque")}</Button>
            </>
          )}
          {phase === 'error' && (
            <>
              <Button type="button" surface="ghost" onClick={onClose}>{tl("Chiudi")}</Button>
              <Button type="button" surface="soft" onClick={() => void check()}>{tl("Riprova")}</Button>
            </>
          )}
          {busy && closable && <Button type="button" surface="ghost" onClick={onClose}>{tl("Annulla")}</Button>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
