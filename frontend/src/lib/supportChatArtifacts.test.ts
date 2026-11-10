import { describe, expect, it } from 'vitest'
import { extractHtmlPage, requestsCodeOnly } from './supportChatArtifacts'

const page = '<!DOCTYPE html><html><head><style>body{color:red}</style></head><body><button>Avvia</button><script>let count=0</script></body></html>'

describe('support chat artifacts across model output formats', () => {
  it.each(['html', 'html_page', 'HTML', 'html5'])('extracts a complete %s page surrounded by prose', language => {
    expect(extractHtmlPage(`Ecco la pagina:\n\`\`\`${language}\n${page}\n\`\`\`\nPuoi modificarla.`)).toBe(page)
  })
  it('accepts raw documents and recovers the latest version', () => {
    expect(extractHtmlPage(page)).toBe(page)
    const edited = page.replace('red', 'blue')
    expect(extractHtmlPage(`\`\`\`html\n${page}\n\`\`\`\n\`\`\`html\n${edited}\n\`\`\``)).toBe(edited)
  })
  it.each(['```html\n<button>Example</button>\n```', 'Sto generando la pagina…', page.replace('</script>', ''), page.replace('</html>', ''), page.replace('</style>', '')])('rejects fragments, promises and truncated output', output => {
    expect(extractHtmlPage(output)).toBeNull()
  })
  it('preserves explicit code-only requests', () => {
    expect(requestsCodeOnly('Mostrami solo il codice HTML')).toBe(true)
    expect(requestsCodeOnly('Give me code only')).toBe(true)
    expect(requestsCodeOnly('Crea una pagina interattiva')).toBe(false)
  })
})
