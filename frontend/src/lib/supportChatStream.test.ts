import { afterEach, describe, expect, it, vi } from 'vitest'
import { consumeSupportChatStream } from './supportChatStream'

function stream(parts: string[], close = true) {
  return new ReadableStream<Uint8Array>({ start(controller) {
    parts.forEach(part => controller.enqueue(new TextEncoder().encode(part)))
    if (close) controller.close()
  } }).getReader()
}

afterEach(() => vi.useRealTimers())

describe('support chat streaming lifecycle', () => {
  it('handles fragmented events, CRLF, UTF-8 and a trailing done event', async () => {
    const events: any[] = []
    await consumeSupportChatStream(stream(['data: {"type":"ch', 'unk","content":"è"}\r\n\r\n', 'data:{"type":"done","content":"è"}']), data => events.push(data))
    expect(events.map(event => event.type)).toEqual(['chunk', 'done'])
    expect(events[0].content).toBe('è')
  })
  it('surfaces backend errors immediately instead of accepting an empty result', async () => {
    await expect(consumeSupportChatStream(stream(['data: {"type":"error","message":"Provider non disponibile"}\n\n']), () => {})).rejects.toThrow('Provider non disponibile')
  })
  it('rejects a disconnected stream even after partial output', async () => {
    await expect(consumeSupportChatStream(stream(['data: {"type":"chunk","content":"<html>"}\n\n']), () => {})).rejects.toThrow('interrotta')
  })
  it('fails a silent stream and releases the reader', async () => {
    vi.useFakeTimers()
    const reader = stream([], false)
    const result = consumeSupportChatStream(reader, () => {}, { idleTimeoutMs: 50 })
    const assertion = expect(result).rejects.toThrow('tempo previsto')
    await vi.advanceTimersByTimeAsync(51)
    await assertion
  })
  it('bounds total duration even when keepalives arrive', async () => {
    vi.useFakeTimers()
    let controller: ReadableStreamDefaultController<Uint8Array>
    const reader = new ReadableStream<Uint8Array>({ start(value) { controller = value } }).getReader()
    const result = consumeSupportChatStream(reader, () => {}, { idleTimeoutMs: 100, totalTimeoutMs: 50 })
    const assertion = expect(result).rejects.toThrow('tempo previsto')
    await vi.advanceTimersByTimeAsync(25)
    controller!.enqueue(new TextEncoder().encode(': keepalive\n\n'))
    await vi.advanceTimersByTimeAsync(26)
    await assertion
  })
  it('completes without waiting for a server that keeps the connection open', async () => {
    await consumeSupportChatStream(stream(['data: {"type":"done","content":"ready"}\n\n'], false), () => {})
  })
})
