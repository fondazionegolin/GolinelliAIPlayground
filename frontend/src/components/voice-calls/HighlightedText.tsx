import { Children, isValidElement, useMemo, type ReactNode } from 'react'
import { extractKeywords, isQuestion, markSentence, splitSentences, type Piece } from '@/lib/transcriptFormat'

export const KEYWORD_COLORS = ['#6366f1', '#0d9488', '#e85c8d', '#f59e0b', '#3b82f6', '#8b5cf6', '#16a34a']

export interface Highlighter {
  keywords: string[]
  keywordSet: Set<string>
  colorOf: (keyword: string) => string
}

/** Keywords of a call (frequent content words of its transcript) with a stable colour each. */
export function useHighlighter(texts: string[]): Highlighter {
  return useMemo(() => {
    const keywords = extractKeywords(texts)
    return {
      keywords,
      keywordSet: new Set(keywords),
      colorOf: (keyword: string) => KEYWORD_COLORS[Math.max(0, keywords.indexOf(keyword)) % KEYWORD_COLORS.length],
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [texts.length, texts[0], texts[texts.length - 1]])
}

export function Marked({ piece, colorOf }: { piece: Piece; colorOf: (keyword: string) => string }) {
  switch (piece.mark) {
    case 'keyword':
      return <strong className="font-bold underline decoration-2 underline-offset-[3px]" style={{ textDecorationColor: colorOf(piece.keyword ?? '') }}>{piece.text}</strong>
    case 'number':
      return <span className="rounded bg-amber-400/25 px-1 font-semibold text-amber-700 dark:text-amber-300">{piece.text}</span>
    case 'name':
      return <span className="font-semibold text-teal-700 dark:text-teal-300">{piece.text}</span>
    case 'search':
      return <mark className="rounded bg-yellow-300/80 px-0.5 text-slate-900">{piece.text}</mark>
    default:
      return <>{piece.text}</>
  }
}

/** A text with keywords, numbers, names (and optionally questions / a search term) marked. */
export function HighlightedText({ text, highlighter, search = '', questions = false, enabled = true }: {
  text: string
  highlighter: Highlighter
  search?: string
  questions?: boolean
  enabled?: boolean
}) {
  if (!enabled && !search.trim()) return <>{text}</>
  return (
    <>
      {splitSentences(text).map((sentence, index) => {
        const pieces = markSentence(sentence, enabled ? highlighter.keywordSet : new Set(), search)
        const content = pieces.map((piece, i) => <Marked key={i} piece={enabled || piece.mark === 'search' ? piece : { text: piece.text }} colorOf={highlighter.colorOf} />)
        return (
          <span key={index}>
            {enabled && questions && isQuestion(sentence)
              ? <span className="rounded-md bg-violet-500/10 px-1 py-0.5 shadow-[inset_3px_0_0_#8b5cf6] [box-decoration-break:clone]">{content}</span>
              : content}{' '}
          </span>
        )
      })}
    </>
  )
}

/** Highlight the plain-text children of a rendered markdown node (nested elements are left alone). */
export function highlightChildren(children: ReactNode, highlighter: Highlighter, enabled: boolean): ReactNode {
  if (!enabled) return children
  return Children.map(children, (child) => {
    if (typeof child === 'string') return <HighlightedText text={child} highlighter={highlighter} />
    if (isValidElement(child)) return child
    return child
  })
}
