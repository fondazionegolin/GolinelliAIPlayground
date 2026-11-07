import { describe, expect, it } from 'vitest'
import { musicSuggestions, parseMusicPrompt, replaceMusicToken } from './musicPrompt'

describe('music prompt vocabulary', () => {
  it('recognizes genres, instruments, rhythm and timbre in Italian', () => {
    expect(parseMusicPrompt('Jazz caldo con chitarra, basso e synth, 60bpm.').map(t => [t.text, t.category])).toEqual([
      ['Jazz', 'genre'], ['caldo', 'timbre'], ['chitarra', 'instrument'], ['basso', 'instrument'], ['synth', 'instrument'], ['60bpm', 'rhythm'],
    ])
  })
  it('recognizes production timbres alongside compound instruments', () => {
    expect(parseMusicPrompt('chitarra elettrica pulita e synth analogico vintage').map(t => [t.term, t.category])).toEqual([
      ['chitarra elettrica', 'instrument'], ['pulito', 'timbre'], ['synth', 'instrument'], ['analogico', 'timbre'], ['vintage', 'timbre'],
    ])
  })
  it('matches phrases before shorter terms and supports English aliases', () => {
    expect(parseMusicPrompt('deep house, electric guitar, piano elettrico e drum & bass').map(t => t.term)).toEqual(['deep house', 'chitarra elettrica', 'piano elettrico', 'drum and bass'])
  })
  it('does not highlight fragments inside other words, including Unicode letters', () => {
    expect(parseMusicPrompt('bassotto jazzista synthesizerX pianofortissimo αjazz jazzé _pop')).toEqual([])
  })
  it('keeps exact offsets with punctuation, repeated terms, line breaks and emoji', () => {
    const text = '🎵 Jazz!\nJazz con synth(, 60 BPM e 4/4.'
    const tokens = parseMusicPrompt(text)
    expect(tokens.map(t => t.text)).toEqual(['Jazz', 'Jazz', 'synth', '60 BPM', '4/4'])
    tokens.forEach(t => expect(text.slice(t.from, t.to)).toBe(t.text))
    expect(replaceMusicToken(text, tokens[1], 'soul')).toBe('🎵 Jazz!\nsoul con synth(, 60 BPM e 4/4.')
  })
  it('prioritizes curated jazz affinities', () => {
    const tokens = parseMusicPrompt('jazz')
    expect(musicSuggestions(tokens[0], tokens).slice(0, 3)).toEqual(['chill', 'soul', 'blues'])
  })
  it('offers alternatives in the same category, excluding the original and duplicates', () => {
    const tokens = parseMusicPrompt('jazz caldo con synth sincopato')
    for (const token of tokens) {
      const suggestions = musicSuggestions(token, tokens)
      expect(suggestions.length).toBeGreaterThan(0)
      expect(new Set(suggestions).size).toBe(suggestions.length)
      expect(suggestions).not.toContain(token.term)
      suggestions.forEach(s => expect(parseMusicPrompt(s)[0]?.category).toBe(token.category))
    }
  })
  it('ranks context-related instruments after explicit affinities', () => {
    const jazz = parseMusicPrompt('jazz con synth'), house = parseMusicPrompt('house con synth')
    const a = musicSuggestions(jazz[1], jazz), b = musicSuggestions(house[1], house)
    expect(a.slice(0, 3)).toEqual(['pad', 'tastiere', 'piano elettrico'])
    expect(a).not.toEqual(b)
  })
  it('proposes nearby BPM values without duplicates at the bounds', () => {
    const token = parseMusicPrompt('60bpm')[0]
    expect(musicSuggestions(token, [token])).toEqual(['55 bpm', '65 bpm', '50 bpm', '70 bpm', '40 bpm', '80 bpm'])
    const edge = parseMusicPrompt('20 bpm')[0]
    expect(musicSuggestions(edge, [edge])).toEqual(['25 bpm', '30 bpm', '40 bpm'])
  })
  it('preserves untouched text and refuses a stale replacement', () => {
    const text = 'jazz, jazz e basso', token = parseMusicPrompt(text)[1]
    expect(replaceMusicToken(text, token, 'soul')).toBe('jazz, soul e basso')
    expect(replaceMusicToken('testo diverso', token, 'soul')).toBe('testo diverso')
  })
  it('does not retain regex state between parses', () => {
    expect(parseMusicPrompt('jazz')).toEqual(parseMusicPrompt('jazz'))
    expect(parseMusicPrompt('')).toEqual([])
  })
})
