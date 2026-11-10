import { tl } from '@/i18n/tl'

/** Bounded SSE consumption: errors and interrupted streams must leave the loading state. */
export async function consumeSupportChatStream(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  onEvent: (data: any) => void,
  { idleTimeoutMs = 90_000, totalTimeoutMs = 300_000 }: { idleTimeoutMs?: number; totalTimeoutMs?: number } = {},
) {
  const decoder = new TextDecoder()
  const deadline = Date.now() + totalTimeoutMs
  let buffer = ''
  let completed = false
  const emit = (event: string) => {
    const payload = event.split('\n').filter(line => line.startsWith('data:'))
      .map(line => line.slice(5).trimStart()).join('\n').trim()
    if (!payload || payload === '[DONE]') return
    let data: any
    try { data = JSON.parse(payload) } catch { return }
    if (data.type === 'error') throw new Error(data.message || tl('Errore durante la generazione. Riprova.'))
    if (data.type === 'done') completed = true
    onEvent(data)
  }
  try {
    while (!completed) {
      let timer: ReturnType<typeof setTimeout> | undefined
      let result: ReadableStreamReadResult<Uint8Array>
      try {
        result = await Promise.race([
          reader.read(),
          new Promise<never>((_, reject) => {
            timer = setTimeout(() => reject(new Error(tl('Il modello non ha completato la risposta entro il tempo previsto. Riprova.'))),
              Math.max(0, Math.min(idleTimeoutMs, deadline - Date.now())))
          }),
        ])
      } finally { clearTimeout(timer) }
      buffer += result.done ? decoder.decode() : decoder.decode(result.value, { stream: true })
      buffer = buffer.replace(/\r\n/g, '\n')
      let boundary: number
      while ((boundary = buffer.indexOf('\n\n')) !== -1) {
        const event = buffer.slice(0, boundary)
        buffer = buffer.slice(boundary + 2)
        emit(event)
      }
      if (result.done) {
        if (buffer.trim()) emit(buffer)
        break
      }
    }
    if (!completed) throw new Error(tl('La generazione si è interrotta prima del completamento. Riprova.'))
  } finally {
    void reader.cancel().catch(() => {})
    reader.releaseLock()
  }
}
