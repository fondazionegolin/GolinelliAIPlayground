import { describe, expect, it } from 'vitest'
import { appendStudioSources, MAX_STUDIO_SOURCE_CHARS } from './presentationStudio'

describe('Presentation Studio source import', () => {
  it('keeps existing notes, Markdown, file order and the last section', () => {
    const text = '# Titolo\n\n- Punto\n\n**Note docente:** dettaglio\n'.repeat(6000) + '# Fine'
    const combined = appendStudioSources('Note esistenti', [{ filename: 'xr.md', text }, { filename: 'altre.txt', text: 'Appendice' }])
    expect(combined.startsWith('Note esistenti')).toBe(true)
    expect(combined).toContain(text)
    expect(combined.endsWith('Appendice')).toBe(true)
  })
  it('rejects an oversized combined source rather than returning a truncated string', () => {
    expect(() => appendStudioSources('x'.repeat(MAX_STUDIO_SOURCE_CHARS), [{ filename: 'note.md', text: 'Non perdere' }])).toThrow('milione')
  })
})
