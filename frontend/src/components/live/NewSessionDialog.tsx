import { useState } from 'react'
import { createPortal } from 'react-dom'
import { Button } from '@/design'
import { ChevronRight, LayoutTemplate, LockKeyhole, Sparkles, X, type LucideIcon } from '@/components/icons'
import LiveSlidePreview, { KIND_META, type PreviewSlide, type SlideKind } from '@/components/live/LiveSlidePreview'
import { tl } from '@/i18n/tl'

type Path = 'manual' | 'ai' | 'escape'

interface Choice {
  id: Path
  title: string
  description: string
  icon: LucideIcon
  color: string
  /** What the teacher will see and build with this path. */
  bullets: string[]
  samples: Array<{ slide: PreviewSlide; escape?: boolean }>
}

const CHOICES: Choice[] = [
  {
    id: 'manual',
    title: tl("Crea manualmente"),
    description: tl("Componi il quiz slide per slide e scegli ogni interazione."),
    icon: LayoutTemplate,
    color: '#3ea9f4',
    bullets: [tl("Risposta multipla con classifica"), tl("Word Wall, opinione libera e feedback rapido"), tl("Tempo massimo per ogni slide")],
    samples: [
      { slide: { type: 'mcq', question: tl("Quale pianeta è il più vicino al Sole?"), options: ['Mercurio', 'Venere', 'Terra', 'Marte'], correct_option: 0 } },
      { slide: { type: 'wordwall', prompt: tl("Una parola che descrive il futuro") } },
      { slide: { type: 'opinion', prompt: tl("Cosa ne pensi dell’intelligenza artificiale a scuola?") } },
      { slide: { type: 'feedback', prompt: tl("Com’è andata la lezione di oggi?") } },
    ],
  },
  {
    id: 'ai',
    title: tl("Suggerisci struttura AI"),
    description: tl("Parti da un argomento o da un PDF e modifica la proposta."),
    icon: Sparkles,
    color: '#7b69c9',
    bullets: [tl("Scegli argomento, numero di slide e tipologie"), tl("Puoi allegare un PDF di riferimento"), tl("Rivedi e modifica tutto prima di pubblicare")],
    samples: [
      { slide: { type: 'mcq', question: tl("Cosa descrive meglio la fotosintesi?"), options: [tl("Produzione di zuccheri dalla luce"), tl("Respirazione cellulare"), tl("Digestione"), tl("Evaporazione")], correct_option: 0 } },
      { slide: { type: 'wordwall', prompt: tl("Una parola legata alle piante") } },
    ],
  },
  {
    id: 'escape',
    title: 'Escape Room',
    description: tl("Trasforma un Teacherbot in una sfida narrativa a indizi."),
    icon: LockKeyhole,
    color: '#d97706',
    bullets: [tl("Ogni indizio è un’affermazione da verificare"), tl("Gli studenti sbloccano oggetti e premi"), tl("Serve un Teacherbot con modalità Escape Room")],
    samples: [
      { escape: true, slide: { false_statement: tl("Il Colosseo è stato costruito nel Medioevo."), explanation: tl("Fu costruito nel I secolo d.C."), achievement: { name: tl("Chiave di bronzo") } } },
    ],
  },
]

/** New live session: pick how to start and see, before committing, what students will get. */
export default function NewSessionDialog({ onClose, onManual, onAi, onEscape }: { onClose: () => void; onManual: () => void; onAi: () => void; onEscape: () => void }) {
  const [selected, setSelected] = useState<Path>('manual')
  const [sample, setSample] = useState(0)
  const choice = CHOICES.find((entry) => entry.id === selected)!
  const current = choice.samples[Math.min(sample, choice.samples.length - 1)]
  const go = () => (selected === 'manual' ? onManual : selected === 'ai' ? onAi : onEscape)()
  const pick = (id: Path) => { setSelected(id); setSample(0) }

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4" onMouseDown={onClose}>
      <div role="dialog" aria-modal="true" aria-label={tl("Nuova sessione")} className="ds-popover flex max-h-[92vh] w-full max-w-4xl flex-col overflow-hidden rounded-[var(--ds-radius-panel)]" onMouseDown={(event) => event.stopPropagation()}>
        <div className="flex items-start justify-between gap-4 px-6 pb-3 pt-6">
          <div>
            <h2 className="text-xl font-bold text-[var(--text-primary)]">{tl("Nuova sessione")}</h2>
            <p className="mt-1 text-sm text-[var(--text-secondary)]">{tl("Scegli come iniziare: ogni percorso crea una bozza modificabile prima della pubblicazione.")}</p>
          </div>
          <button type="button" onClick={onClose} aria-label={tl("Chiudi")} className="rounded-xl p-2 text-[var(--text-secondary)] hover:bg-black/5"><X className="h-5 w-5" /></button>
        </div>

        <div className="grid min-h-0 flex-1 gap-4 overflow-y-auto px-6 pb-4 md:grid-cols-[17rem_1fr]">
          <div className="space-y-2" role="radiogroup" aria-label={tl("Come vuoi iniziare?")}>
            {CHOICES.map(({ id, title, description, icon: Icon, color }) => (
              <button key={id} type="button" role="radio" aria-checked={selected === id} onClick={() => pick(id)}
                className={`flex w-full items-start gap-3 rounded-2xl p-3 text-left transition ${selected === id ? 'ds-selected' : 'ds-control'}`}>
                <span className="ds-squircle flex h-10 w-10 shrink-0 items-center justify-center text-white" style={{ background: color }} aria-hidden><Icon className="h-5 w-5" /></span>
                <span className="min-w-0"><span className="block text-sm font-bold text-[var(--text-primary)]">{title}</span><span className="mt-0.5 block text-xs leading-5 text-[var(--text-secondary)]">{description}</span></span>
              </button>
            ))}
          </div>

          <div className="flex min-w-0 flex-col gap-3 rounded-3xl bg-[var(--ds-well)] p-4">
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs font-bold uppercase tracking-[0.14em] text-[var(--text-secondary)]">{tl("Anteprima")}</p>
              {choice.samples.length > 1 && (
                <div className="flex flex-wrap gap-1.5" role="group" aria-label={tl("Esempi di slide")}>
                  {choice.samples.map((entry, index) => {
                    const kind = (entry.escape ? 'escape' : String(entry.slide.type)) as SlideKind
                    return (
                      <button key={index} type="button" aria-pressed={sample === index} onClick={() => setSample(index)} title={KIND_META[kind].label}
                        className={`flex h-7 w-7 items-center justify-center rounded-full text-white transition ${sample === index ? 'opacity-100' : 'opacity-45 hover:opacity-80'}`} style={{ background: KIND_META[kind].color }}>
                        {(() => { const KindIcon = KIND_META[kind].icon; return <KindIcon className="h-3.5 w-3.5" /> })()}
                      </button>
                    )
                  })}
                </div>
              )}
            </div>
            <div className="min-h-[15rem] flex-1 [&>div]:min-h-[15rem]">
              <LiveSlidePreview slide={current.slide} escape={current.escape} />
            </div>
            <ul className="space-y-1 text-xs text-[var(--text-secondary)]">
              {choice.bullets.map((line) => <li key={line} className="flex gap-2"><span className="mt-1.5 h-1 w-1 shrink-0 rounded-full" style={{ background: choice.color }} />{line}</li>)}
            </ul>
          </div>
        </div>

        <div className="flex justify-end gap-3 px-6 pb-6 pt-2">
          <Button tone="neutral" surface="ghost" onClick={onClose}>{tl("Annulla")}</Button>
          <Button tone="accent" surface="solid" onClick={go}>{tl("Continua")} <ChevronRight className="h-4 w-4" /></Button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
