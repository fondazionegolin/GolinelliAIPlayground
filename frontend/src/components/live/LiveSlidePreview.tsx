import { Check, CloudLightning, ListChecks, Lock, MessageSquare, Smile, ThumbsUp, type LucideIcon } from '@/components/icons'
import { tl } from '@/i18n/tl'

/** A slide of a live session (quiz step) or an escape-room clue, as stored in `slides_json`. */
export type PreviewSlide = Record<string, unknown>

export type SlideKind = 'mcq' | 'wordwall' | 'opinion' | 'feedback' | 'escape'

export const KIND_META: Record<SlideKind, { label: string; icon: LucideIcon; color: string }> = {
  mcq: { label: tl("Risposta multipla"), icon: ListChecks, color: '#7b69c9' },
  wordwall: { label: 'Word Wall', icon: CloudLightning, color: '#d97706' },
  opinion: { label: tl("Opinione libera"), icon: MessageSquare, color: '#0d9488' },
  feedback: { label: tl("Feedback rapido"), icon: ThumbsUp, color: '#e85c8d' },
  escape: { label: tl("Indizio"), icon: Lock, color: '#5b5bd6' },
}

export const slideKind = (slide: PreviewSlide, escape = false): SlideKind => {
  if (escape || 'false_statement' in slide) return 'escape'
  const type = String(slide.type ?? 'mcq')
  return type === 'wordwall' || type === 'opinion' || type === 'feedback' ? type : 'mcq'
}

/** Main text of a slide: the question, the prompt or the clue statement. */
export const slideText = (slide: PreviewSlide): string => {
  for (const key of ['question', 'prompt', 'false_statement', 'title']) {
    const value = slide[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return ''
}

const OPTION_LETTERS = ['A', 'B', 'C', 'D', 'E', 'F']
const SAMPLE_WORDS = ['idea', 'energia', 'futuro', 'dati', 'gioco', 'team', 'luce']

/**
 * Read-only rendering of one slide, close to what students will see.
 * `compact` is the tile thumbnail (question + first options only); the default fills the preview dialog.
 */
export default function LiveSlidePreview({ slide, escape = false, compact = false }: { slide: PreviewSlide; escape?: boolean; compact?: boolean }) {
  const kind = slideKind(slide, escape)
  const { icon: Icon, color, label } = KIND_META[kind]
  const text = slideText(slide) || tl("Testo ancora da scrivere")
  const options = Array.isArray(slide.options) ? (slide.options as unknown[]).map(String).filter((o) => o.trim()) : []
  const correct = typeof slide.correct_option === 'number' ? slide.correct_option : null
  const shownOptions = compact ? options.slice(0, 4) : options

  return (
    <div className={`flex h-full flex-col rounded-2xl bg-[var(--ds-field-bg)] text-[var(--text-primary)] ${compact ? 'gap-2 p-3' : 'gap-5 p-6 sm:p-8'}`}>
      <div className="flex items-center gap-2">
        <span className={`ds-squircle flex shrink-0 items-center justify-center text-white ${compact ? 'h-5 w-5' : 'h-8 w-8'}`} style={{ background: color }} aria-hidden>
          <Icon className={compact ? 'h-3 w-3' : 'h-4 w-4'} />
        </span>
        <span className={`font-bold uppercase tracking-[0.12em] text-[var(--text-secondary)] ${compact ? 'text-[9px]' : 'text-xs'}`}>{label}</span>
      </div>

      <p className={`font-bold leading-snug ${compact ? 'line-clamp-2 text-[13px]' : 'text-xl sm:text-2xl'}`}>{text}</p>

      {kind === 'mcq' && (
        <div className={`grid gap-1.5 ${compact ? 'grid-cols-2' : 'gap-2.5 sm:grid-cols-2'}`}>
          {(shownOptions.length ? shownOptions : ['', '', '', '']).map((option, index) => {
            const right = correct === index
            return (
              <div key={index} className={`flex items-center gap-2 rounded-xl bg-[var(--ds-well-tile)] ${compact ? 'px-2 py-1.5 text-[10px]' : 'px-4 py-3 text-sm'}`}>
                <span className={`flex shrink-0 items-center justify-center rounded-md font-black text-white ${compact ? 'h-4 w-4 text-[9px]' : 'h-6 w-6 text-xs'}`} style={{ background: right ? '#16a34a' : color }}>
                  {right ? <Check className={compact ? 'h-2.5 w-2.5' : 'h-3.5 w-3.5'} /> : OPTION_LETTERS[index]}
                </span>
                <span className={`min-w-0 flex-1 ${compact ? 'truncate' : ''} ${right ? 'font-bold' : ''}`}>{option || <span className="text-[var(--text-secondary)]">…</span>}</span>
              </div>
            )
          })}
        </div>
      )}

      {kind === 'wordwall' && (
        <div className="flex flex-wrap items-center gap-1.5">
          {SAMPLE_WORDS.slice(0, compact ? 5 : 7).map((word, index) => (
            <span key={word} className={`rounded-full font-bold text-white ${compact ? 'px-2 py-0.5 text-[9px]' : 'px-4 py-1.5 text-sm'}`} style={{ background: ['#d97706', '#7b69c9', '#0d9488', '#e85c8d', '#3ea9f4'][index % 5], opacity: 0.85 }}>{word}</span>
          ))}
        </div>
      )}

      {kind === 'opinion' && (
        <div className={`rounded-xl bg-[var(--ds-well-tile)] text-[var(--text-secondary)] ${compact ? 'px-2.5 py-2 text-[10px]' : 'px-4 py-4 text-sm'}`}>
          {tl("Gli studenti scrivono qui la loro opinione…")}
        </div>
      )}

      {kind === 'feedback' && (
        <div className="flex gap-2">
          {[Smile, ThumbsUp, ThumbsUp].map((Face, index) => (
            <span key={index} className={`flex items-center justify-center rounded-xl bg-[var(--ds-well-tile)] ${compact ? 'h-7 w-9' : 'h-14 w-20'}`} style={{ color: ['#16a34a', color, '#dc2626'][index] }}>
              <Face className={`${compact ? 'h-4 w-4' : 'h-6 w-6'} ${index === 2 ? 'rotate-180' : ''}`} />
            </span>
          ))}
        </div>
      )}

      {kind === 'escape' && (
        <div className={`rounded-xl bg-[var(--ds-well-tile)] ${compact ? 'px-2.5 py-2 text-[10px]' : 'space-y-3 px-4 py-4 text-sm'}`}>
          <p className="text-[var(--text-secondary)]">{compact ? tl("Vero o falso? Trova l’errore") : tl("Gli studenti devono capire se l’affermazione è vera o correggerla.")}</p>
          {!compact && typeof slide.explanation === 'string' && slide.explanation && (
            <p><span className="font-bold">{tl("Soluzione")}: </span>{slide.explanation}</p>
          )}
          {!compact && (slide.achievement as { name?: string } | undefined)?.name && (
            <p className="flex items-center gap-1.5 font-semibold" style={{ color }}><Lock className="h-4 w-4" />{(slide.achievement as { name: string }).name}</p>
          )}
        </div>
      )}
    </div>
  )
}
