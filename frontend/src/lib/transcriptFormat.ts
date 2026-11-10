/**
 * Reading aids for call transcripts: keywords (frequent content words), numbers, proper names and questions are
 * marked so the text can be scanned and analysed at a glance. Pure functions, no React.
 */

const STOPWORDS = new Set((
  'a ad al allo alla alle agli ai all anche ancora anzi altro altri altre altra altre assai avere ha ho hai hanno abbiamo avete avevo aveva ' +
  'avuto bene che chi ci cio ciò come con contro cosa così cui da dal dallo dalla dalle dagli dai dei del dello della delle degli di dove e ed ' +
  'è era erano essere ecco fa fare faccio facciamo fanno fatto gli ha già i il in infatti insomma io la le lei lo loro lui ma me mi mia mie ' +
  'miei mio molto ne negli nei nel nella nelle nello no noi non nostra nostre nostri nostro o ogni oppure ora per perché perche però poi ' +
  'poco può puoi posso possiamo possono più qua quale quali qualche quando quanto quella quelle quelli quello questa queste questi questo qui ' +
  'se sei sembra sempre si sia siamo siete solo sono sta stai stanno stato stati stata state su sua sue sui sul sulla sulle sullo suo suoi ' +
  'ta te ti tra fra tu tua tue tuo tuoi tutta tutte tutti tutto un una uno va vai vado vanno vi voi vostra vostro altrimenti allora dunque ' +
  'cioè quindi quasi proprio prima dopo oggi adesso ormai volta volte modo parte cosa cose esempio dico dice dite detto vedere vediamo ' +
  'vedete guardate sapete sappiamo credo penso direi diciamo ragazzi ragazze buongiorno grazie prego okay ok eh ah mmh ' +
  'sotto sopra dentro fuori davanti dietro vicino lontano fino verso senza durante mentre intanto comunque magari subito sempre mai'
).split(/\s+/))

export type Mark = 'keyword' | 'number' | 'name' | 'search'
export interface Piece { text: string; mark?: Mark; keyword?: string }

const TOKEN = /[\p{L}\p{N}'’]+|[^\p{L}\p{N}'’]+/gu
const WORD = /^[\p{L}\p{N}'’]+$/u

const normalize = (word: string) => word.toLocaleLowerCase('it').replace(/['’]/g, '')

/** Most frequent content words (≥5 letters, not stopwords, at least 2 occurrences), most frequent first. */
export function extractKeywords(texts: string[], max = 14): string[] {
  const counts = new Map<string, number>()
  for (const text of texts) {
    for (const token of text.match(TOKEN) ?? []) {
      if (!WORD.test(token)) continue
      const word = normalize(token)
      if (word.length < 5 || STOPWORDS.has(word) || /^\d/.test(word)) continue
      counts.set(word, (counts.get(word) ?? 0) + 1)
    }
  }
  return [...counts.entries()]
    .filter(([, count]) => count >= 2)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, max)
    .map(([word]) => word)
}

export function splitSentences(text: string): string[] {
  const parts = text.match(/[^.!?…]+[.!?…]+["»”)]*\s*|[^.!?…]+$/g)
  return (parts ?? [text]).map((part) => part.trim()).filter(Boolean)
}

/** Group sentences in short paragraphs (readable blocks instead of one wall of text). */
export function paragraphs(text: string, perParagraph = 3): string[] {
  const sentences = splitSentences(text)
  const out: string[] = []
  for (let i = 0; i < sentences.length; i += perParagraph) out.push(sentences.slice(i, i + perParagraph).join(' '))
  return out.length ? out : [text]
}

export const isQuestion = (sentence: string) => /\?\s*["»”)]*$/.test(sentence.trim())

/** Split a sentence into pieces carrying a mark; `search` wins over the others. */
export function markSentence(sentence: string, keywords: Set<string>, search = ''): Piece[] {
  const needle = search.trim().toLocaleLowerCase('it')
  const pieces: Piece[] = []
  let sentenceStart = true
  for (const token of sentence.match(TOKEN) ?? []) {
    if (!WORD.test(token)) {
      pieces.push({ text: token })
      if (/[.!?…]/.test(token)) sentenceStart = true
      continue
    }
    const word = normalize(token)
    let mark: Mark | undefined
    if (needle && word.includes(needle)) mark = 'search'
    else if (keywords.has(word)) mark = 'keyword'
    else if (/\d/.test(token)) mark = 'number'
    else if (!sentenceStart && token.length >= 3 && /^\p{Lu}\p{Ll}+/u.test(token) && !STOPWORDS.has(word)) mark = 'name'
    pieces.push({ text: token, mark, keyword: mark === 'keyword' ? word : undefined })
    sentenceStart = false
  }
  // Merge neighbours with the same mark so the DOM stays small.
  const merged: Piece[] = []
  for (const piece of pieces) {
    const last = merged[merged.length - 1]
    if (last && last.mark === piece.mark && last.keyword === piece.keyword && !piece.mark) last.text += piece.text
    else merged.push({ ...piece })
  }
  return merged
}

// ── Clean exports ───────────────────────────────────────────────────────────────

export interface ExportLine { speaker: string; start: number; text: string }

export const clock = (seconds: number) => {
  const s = Math.max(0, Math.round(seconds))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  return `${h ? `${h}:${String(m).padStart(2, '0')}` : String(m).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
}

/** Readable plain text: header, then one block per speaker turn (timestamp + name, blank line, text). */
export function transcriptToText(title: string, meta: string, lines: ExportLine[]): string {
  const body = lines.map((line) => `[${clock(line.start)}] ${line.speaker}\n${paragraphs(line.text, 4).join('\n\n')}`).join('\n\n')
  return `${title}\n${meta}\n${'='.repeat(Math.min(60, Math.max(title.length, 20)))}\n\n${body}\n`
}

export function transcriptToMarkdown(lines: ExportLine[]): string {
  return lines.map((line) => `**${line.speaker}** · \`${clock(line.start)}\`\n\n${paragraphs(line.text, 4).join('\n\n')}`).join('\n\n---\n\n')
}

export const safeFileName = (name: string) => name.replace(/[^\p{L}\p{N}-]+/gu, '_').replace(/^_+|_+$/g, '').slice(0, 80) || 'chiamata'
