export const MAX_CORPUS_BYTES = 50 * 1024 * 1024

export interface ToyLMCorpusSelection {
  title: string
  text: string
  truncated: boolean
  sourceUrl?: string
  authors?: string[]
  byteCount?: number
  wordCount?: number
  sha256?: string
}

export interface LibraryBook {
  id: number
  title: string
  authors: string[]
  languages: string[]
  sourceUrl: string
}

export interface LibraryResults {
  results: LibraryBook[]
  hasNext: boolean
  total?: number
}

export interface ImportProgress {
  type: 'status' | 'progress'
  stage: string
  message?: string
  receivedBytes?: number
  totalBytes?: number | null
}

type ImportEvent = ImportProgress | { type: 'complete'; book: ToyLMCorpusSelection } | { type: 'error'; message: string }

export async function libraryFetch<T>(path: string, signal: AbortSignal): Promise<T> {
  const response = await fetch(`/api/v1/toy-lm/library/books${path}`, { credentials: 'include', signal })
  if (!response.ok) {
    const error = await response.json().catch(() => null)
    throw new Error(typeof error?.detail === 'string' ? error.detail : 'Biblioteca non disponibile. Riprova tra poco.')
  }
  return response.json()
}

export async function importLibraryBook(bookId: number, signal: AbortSignal, onProgress: (event: ImportProgress) => void): Promise<ToyLMCorpusSelection> {
  const response = await fetch(`/api/v1/toy-lm/library/books/${bookId}/stream`, { credentials: 'include', signal })
  if (!response.ok) {
    const error = await response.json().catch(() => null)
    throw new Error(typeof error?.detail === 'string' ? error.detail : 'Impossibile avviare il download. Riprova.')
  }
  if (!response.body || !response.headers.get('content-type')?.includes('text/event-stream')) {
    throw new Error('Il servizio di download non ha restituito un flusso valido. Riprova tra poco.')
  }
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  const consumeFrame = (frame: string): ToyLMCorpusSelection | undefined => {
    const data = frame.split(/\r?\n/).filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n')
    if (!data) return
    let event: ImportEvent
    try {
      event = JSON.parse(data) as ImportEvent
    } catch {
      throw new Error('Il download si è interrotto durante il trasferimento del testo. Riprova: nessun estratto è stato importato.')
    }
    if (event.type === 'error') throw new Error(event.message)
    if (event.type === 'complete') {
      if (!event.book.text.trim() || event.book.truncated) throw new Error('Il libro ricevuto è incompleto. Nessun estratto è stato importato.')
      return event.book
    }
    onProgress(event)
  }
  try {
    while (true) {
      const { done, value } = await reader.read()
      buffer += decoder.decode(value, { stream: !done })
      let separator: RegExpMatchArray | null
      while ((separator = buffer.match(/\r?\n\r?\n/))) {
        const position = separator.index!
        const result = consumeFrame(buffer.slice(0, position))
        buffer = buffer.slice(position + separator[0].length)
        if (result) return result
      }
      if (done) break
    }
    if (buffer.trim()) {
      const result = consumeFrame(buffer)
      if (result) return result
    }
    throw new Error('Il collegamento si è interrotto prima della fine del libro. Riprova il download.')
  } finally {
    await reader.cancel().catch(() => {})
    reader.releaseLock()
  }
}

export function downloadCorpusTxt(selection: ToyLMCorpusSelection) {
  const url = URL.createObjectURL(new Blob([selection.text], { type: 'text/plain;charset=utf-8' }))
  const link = document.createElement('a')
  const title = selection.title.replace(/[^\p{L}\p{N}\s._-]/gu, '').trim().slice(0, 120) || 'corpus'
  link.href = url
  link.download = title.toLowerCase().endsWith('.txt') ? title : `${title}.txt`
  document.body.appendChild(link)
  link.click()
  link.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}
