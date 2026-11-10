/** Accept complete documents, never incomplete streams or illustrative HTML fragments. */
export function extractHtmlPage(raw: string): string | null {
  const fences = [...raw.matchAll(/```(?:html_page|html5?|htm)\s*\n([\s\S]*?)```/gi)]
  const candidates = fences.length ? fences.map(match => match[1]).reverse() : [raw]
  for (const candidate of candidates) {
    const document = candidate.match(/(?:<!doctype\s+html[^>]*>\s*)?<html\b[^>]*>[\s\S]*?<\/html\s*>/i)?.[0]
    if (!document || !/<body\b[^>]*>[\s\S]*<\/body\s*>/i.test(document)) continue
    // Closing the outer document must not disguise a truncated script or stylesheet.
    if (['script', 'style'].some(tag =>
      (document.match(new RegExp(`<${tag}\\b`, 'gi')) || []).length !==
      (document.match(new RegExp(`</${tag}\\s*>`, 'gi')) || []).length)) continue
    return document.trim()
  }
  return null
}

export function requestsCodeOnly(text: string): boolean {
  return /\b(?:solo\s+(?:il\s+)?codice|soltanto\s+(?:il\s+)?codice|code\s+only|only\s+(?:the\s+)?code|non\s+(?:eseguire|aprire|generare\s+(?:la\s+)?pagina))\b/i.test(text)
}
