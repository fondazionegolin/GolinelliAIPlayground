import { afterEach, describe, expect, it, vi } from 'vitest'
vi.mock('@/lib/api', () => ({ default: {} }))
import { documentShareUrl, publicDocumentApi } from './documentShares'

afterEach(() => vi.unstubAllGlobals())

describe('anonymous document links', () => {
  it('opens public documents without cookies or application tokens', async () => {
    const fetch = vi.fn().mockResolvedValue(Response.json({ title: 'T', permission: 'view', revision: 'x'.repeat(64), content_json: '{}' }))
    vi.stubGlobal('fetch', fetch)
    await publicDocumentApi.read('token')
    expect(fetch).toHaveBeenCalledWith('/api/v1/document-shares/public/token', expect.objectContaining({ method: 'GET', credentials: 'omit', cache: 'no-store', headers: {} }))
  })
  it('sends the base revision with a save and reports conflicts', async () => {
    const fetch = vi.fn().mockResolvedValue(Response.json({ detail: 'Modificato da altri' }, { status: 409 }))
    vi.stubGlobal('fetch', fetch)
    const body = { title: 'T', content_json: '{"htmlContent":"Nuovo"}', revision: 'a'.repeat(64) }
    await expect(publicDocumentApi.save('token', body)).rejects.toMatchObject({ status: 409, message: 'Modificato da altri' })
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual(body)
    expect(fetch.mock.calls[0][1].credentials).toBe('omit')
  })
  it('reports revoked links and retains the current deployment origin in QR links', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ detail: 'Link revocato' }, { status: 410 })))
    await expect(publicDocumentApi.read('token')).rejects.toMatchObject({ status: 410 })
    vi.stubGlobal('window', { location: { origin: 'https://staging.example.org' } })
    expect(documentShareUrl('abc_123')).toBe('https://staging.example.org/d/abc_123')
  })
})
