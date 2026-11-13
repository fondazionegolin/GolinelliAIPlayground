import { useState } from 'react'
import { ChevronLeft, ChevronRight, Check, Maximize2 } from '@/components/icons'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { SlidePreview } from '@/components/documents/DocumentThumbnail'
import type { SlidePair } from '@/lib/slideProposalPreview'
import { tl } from '@/i18n/tl'

type Format = '16:9' | '4:3'

function Frame({ slide, format, label, tone, empty }: { slide: SlidePair['before']; format: Format; label: string; tone: 'before' | 'after'; empty: string }) {
  return (
    <div className="min-w-0">
      <p className={`mb-1 text-[9px] font-black uppercase tracking-wide ${tone === 'before' ? 'text-red-600' : 'text-sky-700'}`}>{label}</p>
      <div className={`relative overflow-hidden rounded-md border border-slate-200 bg-slate-100 ${format === '4:3' ? 'aspect-[4/3]' : 'aspect-video'}`}>
        {slide
          ? <SlidePreview content={{ format, slides: [slide] }} title={slide.title} />
          : <div className="flex h-full items-center justify-center px-2 text-center text-[11px] font-semibold text-slate-400">{empty}</div>}
      </div>
    </div>
  )
}

interface Props {
  pairs: SlidePair[]
  format: Format
  /** Offers Applica/Rifiuta inside the full-size dialog while the proposal is still pending. */
  pending?: boolean
  onApply?: () => void
  onReject?: () => void
}

/** Before/after of what a slide proposal changes: a thumbnail pair in the chat and a full-size viewer. */
export function SlideProposalPreview({ pairs, format, pending, onApply, onReject }: Props) {
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  if (!pairs.length) return null
  const pair = pairs[Math.min(active, pairs.length - 1)]
  const first = pairs[0]
  const label = (p: SlidePair) => !p.before ? tl("Slide nuova") : !p.after ? tl("Slide eliminata") : tl("Slide {0}", p.position)

  return (
    <>
      <div className="p-2.5">
        <div className="mb-1.5 flex items-center justify-between gap-2">
          <span className="text-[10px] font-bold text-slate-500">{label(first)}{pairs.length > 1 ? ` · ${tl("+{0} altre", pairs.length - 1)}` : ''}</span>
          <button type="button" onClick={() => { setActive(0); setOpen(true) }} className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-bold text-slate-600 hover:bg-slate-200/60">
            <Maximize2 className="h-3.5 w-3.5" />{tl("Anteprima completa")}
          </button>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Frame slide={first.before} format={format} label={tl("Prima")} tone="before" empty={tl("Non esiste")} />
          <Frame slide={first.after} format={format} label={tl("Dopo")} tone="after" empty={tl("Eliminata")} />
        </div>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[calc(100vh-2rem)] overflow-y-auto sm:max-w-5xl">
          <DialogHeader>
            <DialogTitle>{tl("Anteprima della modifica")}</DialogTitle>
            <DialogDescription>
              {pairs.length === 1 ? tl("1 slide cambia.") : tl("{0} slide cambiano.", pairs.length)} {tl("Questa è la slide intera, come sarà dopo l'applicazione.")}
            </DialogDescription>
          </DialogHeader>
          {pairs.length > 1 && (
            <div className="flex items-center gap-2">
              <button type="button" aria-label={tl("Slide precedente")} disabled={active === 0} onClick={() => setActive(active - 1)} className="flex h-8 w-8 items-center justify-center rounded-lg hover:bg-slate-100 disabled:opacity-30"><ChevronLeft className="h-4 w-4" /></button>
              <div className="flex min-w-0 flex-1 flex-wrap gap-1">
                {pairs.map((item, index) => (
                  <button key={`${item.position}-${index}`} type="button" onClick={() => setActive(index)} className={`h-8 min-w-8 rounded-lg px-2 text-xs font-bold ${index === active ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>{item.position}</button>
                ))}
              </div>
              <button type="button" aria-label={tl("Slide successiva")} disabled={active >= pairs.length - 1} onClick={() => setActive(active + 1)} className="flex h-8 w-8 items-center justify-center rounded-lg hover:bg-slate-100 disabled:opacity-30"><ChevronRight className="h-4 w-4" /></button>
            </div>
          )}
          <p className="text-sm font-semibold">{label(pair)}</p>
          <div className="grid gap-4 md:grid-cols-2">
            <Frame slide={pair.before} format={format} label={tl("Prima")} tone="before" empty={tl("Non esiste")} />
            <Frame slide={pair.after} format={format} label={tl("Dopo")} tone="after" empty={tl("Eliminata")} />
          </div>
          {pending && (
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => { onReject?.(); setOpen(false) }} className="h-10 rounded-xl border border-slate-200 px-4 text-sm font-bold text-slate-600 hover:bg-slate-50">{tl("Rifiuta")}</button>
              <button type="button" onClick={() => { onApply?.(); setOpen(false) }} className="inline-flex h-10 items-center gap-1.5 rounded-xl bg-slate-950 px-4 text-sm font-bold text-white hover:bg-slate-800"><Check className="h-4 w-4" />{tl("Applica")}</button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}
