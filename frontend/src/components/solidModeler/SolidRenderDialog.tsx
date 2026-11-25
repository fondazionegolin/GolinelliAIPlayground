import { useEffect, useRef, useState, type MutableRefObject } from 'react'
import { Button } from '@/design/primitives/Button'
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/design/primitives/Dialog'
import { Download, Loader2 } from '@/components/icons'
import type { RenderBackground } from './render'
import type { ViewportApi } from './SolidModelerViewport'
import { tl } from '@/i18n/tl'

interface Props {
  open: boolean
  onClose: () => void
  viewport: MutableRefObject<ViewportApi | null>
  name: string
}

const QUALITY = [
  { id: 'draft', label: tl("Bozza (veloce)"), passes: 24 },
  { id: 'good', label: tl("Buona"), passes: 64 },
  { id: 'high', label: tl("Alta (più lenta)"), passes: 160 },
]
const SIZES = [{ px: 1280, label: '1280 px' }, { px: 1920, label: 'Full HD · 1920 px' }, { px: 3840, label: '4K · 3840 px' }]
const SOFT = [{ deg: 1.5, label: tl("Nitide") }, { deg: 5, label: tl("Naturali") }, { deg: 11, label: tl("Molto morbide") }]
const BGS: { id: RenderBackground; label: string }[] = [{ id: 'light', label: tl("Studio chiaro") }, { id: 'dark', label: tl("Studio scuro") }, { id: 'white', label: tl("Bianco") }]

const fieldClass = 'ds-field w-full px-3 py-1.5 text-xs font-semibold'

/** «Render»: studio-quality image of the current view with soft shadows and the materials assigned to the objects. */
export default function SolidRenderDialog({ open, onClose, viewport, name }: Props) {
  const [quality, setQuality] = useState('good')
  const [size, setSize] = useState(1920)
  const [soft, setSoft] = useState(5)
  const [bg, setBg] = useState<RenderBackground>('light')
  const [progress, setProgress] = useState<number | null>(null)
  const [image, setImage] = useState<{ url: string; blob: Blob } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const abort = useRef<AbortController | null>(null)

  useEffect(() => () => { abort.current?.abort() }, [])
  useEffect(() => () => { if (image) URL.revokeObjectURL(image.url) }, [image])
  useEffect(() => { if (!open) { abort.current?.abort(); setProgress(null) } }, [open])

  const start = async () => {
    const api = viewport.current
    if (!api) return
    setError(null)
    setImage(null)
    setProgress(0)
    const ctl = new AbortController()
    abort.current = ctl
    try {
      const blob = await api.render(
        { longSide: size, passes: QUALITY.find(q => q.id === quality)!.passes, softness: soft, background: bg, exposure: 1 },
        (done, total) => setProgress(done / total),
        ctl.signal,
      )
      setImage({ url: URL.createObjectURL(blob), blob })
    } catch (e) {
      if ((e as Error).name !== 'AbortError') setError((e as Error).message || tl("Render non riuscito"))
    } finally {
      setProgress(null)
    }
  }

  const busy = progress !== null
  const save = () => {
    if (!image) return
    const a = document.createElement('a')
    a.href = image.url
    a.download = `${(name || 'render').replace(/[^\w\-]+/g, '_')}.png`
    a.click()
  }

  return (
    <Dialog open={open} onOpenChange={o => { if (!o) onClose() }}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>{tl("Render")}</DialogTitle>
        </DialogHeader>
        <DialogBody>
          <div className="grid gap-4 md:grid-cols-[220px_1fr]">
            <div className="space-y-3 text-xs">
              <label className="block space-y-1"><span className="font-semibold text-slate-600">{tl("Qualità")}</span>
                <select className={fieldClass} value={quality} onChange={e => setQuality(e.target.value)} disabled={busy}>{QUALITY.map(q => <option key={q.id} value={q.id}>{q.label}</option>)}</select></label>
              <label className="block space-y-1"><span className="font-semibold text-slate-600">{tl("Risoluzione")}</span>
                <select className={fieldClass} value={size} onChange={e => setSize(Number(e.target.value))} disabled={busy}>{SIZES.map(q => <option key={q.px} value={q.px}>{q.label}</option>)}</select></label>
              <label className="block space-y-1"><span className="font-semibold text-slate-600">{tl("Ombre")}</span>
                <select className={fieldClass} value={soft} onChange={e => setSoft(Number(e.target.value))} disabled={busy}>{SOFT.map(q => <option key={q.deg} value={q.deg}>{q.label}</option>)}</select></label>
              <label className="block space-y-1"><span className="font-semibold text-slate-600">{tl("Sfondo")}</span>
                <select className={fieldClass} value={bg} onChange={e => setBg(e.target.value as RenderBackground)} disabled={busy}>{BGS.map(q => <option key={q.id} value={q.id}>{q.label}</option>)}</select></label>
              <p className="leading-4 text-slate-500">{tl("Inquadratura della vista attuale. Materiali, luci e ombre morbide sono calcolati con molti passaggi: più qualità = immagine più pulita.")}</p>
            </div>
            <div className="flex min-h-[260px] items-center justify-center overflow-hidden rounded-2xl bg-slate-100">
              {image ? <img src={image.url} alt={tl("Render")} className="max-h-[60vh] w-full object-contain" />
                : busy ? (
                  <div className="w-2/3 space-y-2 text-center text-xs text-slate-500">
                    <Loader2 className="mx-auto h-5 w-5 animate-spin" />
                    <div className="h-1.5 overflow-hidden rounded-full bg-slate-200"><div className="h-full rounded-full bg-blue-600 transition-all" style={{ width: `${Math.round((progress ?? 0) * 100)}%` }} /></div>
                    <p>{Math.round((progress ?? 0) * 100)}%</p>
                  </div>
                ) : <p className="px-6 text-center text-xs text-slate-500">{error ?? tl("Premi «Avvia render» per generare l'immagine.")}</p>}
            </div>
          </div>
        </DialogBody>
        <DialogFooter>
          {busy
            ? <Button type="button" tone="neutral" surface="soft" className="rounded-full" onClick={() => abort.current?.abort()}>{tl("Annulla")}</Button>
            : <>
              {image && <Button type="button" tone="neutral" surface="soft" className="rounded-full" onClick={save}><Download /> {tl("Scarica PNG")}</Button>}
              <Button type="button" tone="accent" surface="solid" className="rounded-full" onClick={start}>{image ? tl("Rigenera") : tl("Avvia render")}</Button>
            </>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
