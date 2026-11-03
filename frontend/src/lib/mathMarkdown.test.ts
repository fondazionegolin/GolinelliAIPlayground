import { describe, expect, it } from 'vitest'
import { normalizeMathMarkdown } from './mathMarkdown'
import { renderMarkdownToHtml } from './markdown'

describe('chat math rendering', () => {
  it('renders model-generated inline and block LaTeX as KaTeX', () => {
    const html = renderMarkdownToHtml(String.raw`La formula è \(E=mc^2\).

\[\frac{-b\pm\sqrt{b^2-4ac}}{2a}\]`)
    expect(html).toContain('class="katex"')
    expect(html).toContain('katex-display')
    expect(html).not.toContain('katex-error')
  })

  it('supports dollar delimiters and makes display formulas standalone blocks', () => {
    const text = 'Testo $$x^2+y^2=z^2$$ poi $E=mc^2$.'
    const normalized = normalizeMathMarkdown(text)
    expect(normalized).toContain('\n$$\nx^2+y^2=z^2\n$$\n')
    expect(normalizeMathMarkdown(normalized)).toBe(normalized)
    expect(renderMarkdownToHtml(text)).toContain('katex-display')
  })

  it('preserves code, including an unfinished streaming code block', () => {
    for (const text of [String.raw`Codice: \`\(x\)\``, '```latex\n\\[x\\]\n```', '~~~python\n\\(x\\)\n~~~', '```latex\n\\[x\\]']) {
      expect(normalizeMathMarkdown(text)).toBe(text)
    }
  })

  it('preserves currency and unfinished formulas', () => {
    for (const text of ['Costa $20 e poi $30.', String.raw`\[\frac{1}{`, String.raw`\(x+`]) {
      expect(normalizeMathMarkdown(text)).toBe(text)
    }
  })
})
