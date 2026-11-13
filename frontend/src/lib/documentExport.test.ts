import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { embedExportImages } from './documentExport'

beforeEach(() => {
  vi.stubGlobal('window', { location: { href: 'https://golinelli.ai/teacher/documents', origin: 'https://golinelli.ai' } })
  vi.stubGlobal('FileReader', class {
    result = 'data:image/png;base64,cGljdHVyZQ=='
    onload?: () => void
    readAsDataURL() { this.onload?.() }
  })
})
afterEach(() => vi.unstubAllGlobals())

describe('self-contained document exports', () => {
  it('embeds repeated URL pictures once, preserves layers and does not modify the saved deck', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(new Blob(['picture'], { type: 'image/png' })))
    vi.stubGlobal('fetch', fetch)
    const original = JSON.stringify({ slides: [{ blocks: [
      { type: 'image', content: '/uploads/generated/photo.png', zIndex: 3 },
      { type: 'image', content: '/uploads/generated/photo.png', zIndex: 7 },
      { type: 'image', content: '/private/hidden.png', hidden: true },
      { type: 'image', content: 'data:image/png;base64,existing' },
    ] }] })
    const exported = JSON.parse(await embedExportImages(original, { Authorization: 'Bearer private' }))
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(fetch.mock.calls[0][1]).toMatchObject({ headers: { Authorization: 'Bearer private' }, credentials: 'same-origin' })
    expect(exported.slides[0].blocks[0]).toEqual({ type: 'image', content: 'data:image/png;base64,cGljdHVyZQ==', zIndex: 3 })
    expect(exported.slides[0].blocks[1].zIndex).toBe(7)
    expect(JSON.parse(original).slides[0].blocks[0].content).toBe('/uploads/generated/photo.png')
  })

  it('never sends application credentials to external image hosts', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(new Blob(['picture'], { type: 'image/png' })))
    vi.stubGlobal('fetch', fetch)
    await embedExportImages(JSON.stringify({ slides: [{ blocks: [{ type: 'image', content: 'https://images.example.org/photo.png' }] }] }), { Authorization: 'Bearer private' })
    expect(fetch.mock.calls[0][1]).toMatchObject({ headers: {}, credentials: 'omit' })
  })

  it('reports a missing picture instead of silently creating an incomplete presentation', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 404 })))
    await expect(embedExportImages(JSON.stringify({ slides: [{ blocks: [{ type: 'image', content: '/missing.png' }] }] }))).rejects.toThrow('Impossibile incorporare')
  })
})
