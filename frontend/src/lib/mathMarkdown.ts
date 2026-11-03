/** Convert common LLM LaTeX delimiters before Markdown consumes their escapes. */
export function normalizeMathMarkdown(source: string): string {
  const prose = (text: string) => text
    .replace(/\\\[([\s\S]*?)\\\]/g, (_, formula: string) => `\n$$\n${formula.trim()}\n$$\n`)
    .replace(/\\\(([\s\S]*?)\\\)/g, (_, formula: string) => `$${formula.trim()}$`)
    .replace(/\$\$([\s\S]*?)\$\$/g, (match: string, formula: string, offset: number, full: string) => {
      const before = offset === 0 || full[offset - 1] === '\n' ? '' : '\n'
      const after = offset + match.length === full.length || full[offset + match.length] === '\n' ? '' : '\n'
      return `${before}$$\n${formula.trim()}\n$$${after}`
    })
  const inline = (text: string) => text.split(/(`+[^`]*`+)/g)
    .map((part) => part.startsWith('`') ? part : prose(part)).join('')
  let result = ''
  let pending = ''
  let fence: string | null = null
  for (const line of source.split(/(?<=\n)/)) {
    const marker = line.match(/^ {0,3}(`{3,}|~{3,})/)
    if (fence) {
      result += line
      if (marker && marker[1][0] === fence[0] && marker[1].length >= fence.length) fence = null
    } else if (marker) {
      result += inline(pending) + line
      pending = ''
      fence = marker[1]
    } else {
      pending += line
    }
  }
  return result + inline(pending)
}
