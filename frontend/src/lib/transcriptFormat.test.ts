import { describe, expect, it } from 'vitest'
import { extractKeywords, isQuestion, markSentence, paragraphs, splitSentences, transcriptToText } from './transcriptFormat'

describe('transcript formatting', () => {
  it('finds repeated content words and ignores stopwords', () => {
    const words = extractKeywords(['Il denominatore sta sotto. Il denominatore non può essere zero.', 'Quindi il numeratore sta sopra, il denominatore sotto.'])
    expect(words[0]).toBe('denominatore')
    expect(words).not.toContain('sotto')
    expect(words).not.toContain('quindi')
  })

  it('marks keywords, numbers, names and search matches', () => {
    const pieces = markSentence('Oggi Marco calcola 12 frazioni', new Set(['frazioni']), 'calc')
    const byMark = Object.fromEntries(pieces.filter((p) => p.mark).map((p) => [p.mark, p.text]))
    expect(byMark).toEqual({ name: 'Marco', search: 'calcola', number: '12', keyword: 'frazioni' })
    // The first word of a sentence is never taken for a name.
    expect(markSentence('Oggi parliamo', new Set()).every((p) => p.mark !== 'name')).toBe(true)
  })

  it('splits sentences, detects questions and groups paragraphs', () => {
    expect(splitSentences('Uno. Due? Tre!')).toEqual(['Uno.', 'Due?', 'Tre!'])
    expect(isQuestion('Perché no?')).toBe(true)
    expect(paragraphs('A. B. C. D.', 3)).toEqual(['A. B. C.', 'D.'])
  })

  it('exports a readable text', () => {
    const text = transcriptToText('Lezione', '10/11 · 05:00', [{ speaker: 'Prof', start: 65, text: 'Ciao a tutti.' }])
    expect(text).toContain('[01:05] Prof')
    expect(text).toContain('Ciao a tutti.')
  })
})
