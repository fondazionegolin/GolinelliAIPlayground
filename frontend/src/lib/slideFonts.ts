import type { SlideBlock } from '@/components/SlideEditor'

/** Self-hosted in officeFonts.css, installed everywhere, or generic. */
const AVAILABLE = new Set([
  'calibri', 'aptos', 'cambria', 'arial', 'times new roman', 'courier new', 'helvetica', 'georgia', 'verdana', 'tahoma',
  'trebuchet ms', 'impact', 'comic sans ms', 'consolas', 'segoe ui', 'inter', 'sans-serif', 'serif', 'monospace', 'system-ui',
])
const requested = new Set<string>()

function loadFamily(family: string) {
  if (requested.has(family) || typeof document === 'undefined') return
  requested.add(family)
  const name = encodeURIComponent(family).replace(/%20/g, '+')
  // css2 answers 400 when an axis or weight does not exist for that family: widest request first.
  const queries = [`${name}:wght@100..900`, `${name}:wght@400;700`, name]
  const attempt = (index: number) => {
    const link = document.createElement('link')
    link.rel = 'stylesheet'
    link.href = `https://fonts.googleapis.com/css2?family=${queries[index]}&display=swap`
    link.onerror = () => {
      link.remove()
      if (index + 1 < queries.length) attempt(index + 1)
    }
    document.head.appendChild(link)
  }
  attempt(0)
}

export function fontFamiliesIn(blocks: SlideBlock[]): string[] {
  const stacks: string[] = []
  for (const block of blocks) {
    if (block.type !== 'text') continue
    if (block.style.fontFamily) stacks.push(block.style.fontFamily)
    for (const match of block.content.matchAll(/font-family:\s*([^;"]+)/gi)) stacks.push(match[1].replace(/&#39;|&apos;/g, "'"))
  }
  const families = stacks.flatMap(stack => stack.split(',')).map(name => name.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean)
  return [...new Set(families)].filter(name => !AVAILABLE.has(name.toLowerCase()))
}

/** Fonts of an imported deck that the browser does not have: fetched on demand from Google Fonts.
 * A family Google does not know keeps the fallback stack written by the importer. */
export function ensureSlideFonts(blocks: SlideBlock[]) {
  fontFamiliesIn(blocks).forEach(loadFamily)
}
