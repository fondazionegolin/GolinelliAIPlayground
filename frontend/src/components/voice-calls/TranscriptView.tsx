import { tl } from '@/i18n/tl'
import { clock, paragraphs } from '@/lib/transcriptFormat'
import { HighlightedText, type Highlighter } from './HighlightedText'

export type TranscriptLine = { speaker: string; identity: string; start: number; end: number; text: string }

/**
 * Transcript as one block per speaker turn on the platform's flat dark-grey field background (no tint), name inline
 * at the start of the text (hover = time). Keywords in bold with a coloured underline, numbers and names tinted,
 * questions marked, search highlighted. Fills its parent; only the blocks scroll. The search box is in the
 * parent's toolbar (`filter`).
 */
export function TranscriptView({ lines, colors, highlighter, highlight, filter }: {
  lines: TranscriptLine[]
  colors: Map<string, string>
  highlighter: Highlighter
  highlight: boolean
  filter: string
}) {
  const needle = filter.trim().toLocaleLowerCase('it')
  const visible = lines.filter((line) => !needle || `${line.speaker} ${line.text}`.toLocaleLowerCase('it').includes(needle))

  return (
    <div className="h-full min-h-0 space-y-3 overflow-y-auto pr-2">
      {visible.length === 0 && <p className="py-6 text-center text-sm text-[var(--text-secondary)]">{tl("Nessun risultato")}</p>}
      {visible.map((line, index) => {
        const color = colors.get(line.identity) ?? '#64748b'
        const [first, ...rest] = paragraphs(line.text, 4)
        return (
          <article key={index} className="rounded-2xl bg-[var(--ds-field-bg)] px-4 py-3 text-[14px] leading-6 text-[var(--text-primary)]">
            <p>
              <span className="mr-2 font-bold" style={{ color }} title={clock(line.start)}>{line.speaker}</span>
              <HighlightedText text={first} highlighter={highlighter} search={needle} questions enabled={highlight} />
            </p>
            {rest.map((paragraph, p) => (
              <p key={p} className="mt-1.5"><HighlightedText text={paragraph} highlighter={highlighter} search={needle} questions enabled={highlight} /></p>
            ))}
          </article>
        )
      })}
    </div>
  )
}
