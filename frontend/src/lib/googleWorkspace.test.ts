import { afterEach, describe, expect, it, vi } from 'vitest'
import { chooseGoogleAccount, googleWorkspaceFormat, uploadGoogleWorkspace, type GoogleWorkspaceAccount } from './googleWorkspace'

const account: GoogleWorkspaceAccount = {
  email: 'teacher+school@example.org', name: 'Teacher', accessToken: 'temporary-token', expiresAt: Date.now() + 3600000,
}
const location = 'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&upload_id=test'
const bytes = new Blob(['office-content'])

afterEach(() => vi.unstubAllGlobals())

describe('Google Workspace export', () => {
  it.each([
    ['document', 'docx', 'application/vnd.google-apps.document', 'document'],
    ['slides', 'pptx', 'application/vnd.google-apps.presentation', 'presentation'],
  ] as const)('imports %s as a native file and opens it using the chosen account', async (kind, extension, mime, path) => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(new Response(null, { status: 200, headers: { Location: location } }))
      .mockResolvedValueOnce(Response.json({ id: 'google-file_123', mimeType: mime }))
    vi.stubGlobal('fetch', fetch)
    const url = await uploadGoogleWorkspace(kind, 'Lezione', bytes, account)
    expect(googleWorkspaceFormat(kind).extension).toBe(extension)
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({ name: 'Lezione', mimeType: mime })
    expect(fetch.mock.calls[1]).toEqual([location, expect.objectContaining({
      method: 'PUT', body: bytes, headers: { Authorization: 'Bearer temporary-token', 'Content-Type': googleWorkspaceFormat(kind).source },
    })])
    expect(url).toBe(`https://docs.google.com/${path}/d/google-file_123/edit?authuser=teacher%2Bschool%40example.org`)
  })

  it('rejects spreadsheets instead of exporting them as documents', () => {
    expect(() => googleWorkspaceFormat('sheet' as 'document')).toThrow('conversion')
  })

  it('requires another account selection when authorization has expired', async () => {
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    await expect(uploadGoogleWorkspace('document', 'Title', bytes, { ...account, expiresAt: 0 })).rejects.toThrow('expired')
    expect(fetch).not.toHaveBeenCalled()
  })

  it('does not send document contents to a redirected upload host', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(null, { headers: { Location: 'https://example.org/upload' } }))
    vi.stubGlobal('fetch', fetch)
    await expect(uploadGoogleWorkspace('slides', 'Title', bytes, account)).rejects.toThrow('upload')
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('reports a refused Drive permission without uploading any content', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(null, { status: 403 }))
    vi.stubGlobal('fetch', fetch)
    await expect(uploadGoogleWorkspace('document', 'Title', bytes, account)).rejects.toThrow('upload')
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('checks that Google actually created the requested native format', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(new Response(null, { headers: { Location: location } }))
      .mockResolvedValueOnce(Response.json({ id: 'file', mimeType: 'application/octet-stream' })))
    await expect(uploadGoogleWorkspace('slides', 'Title', bytes, account)).rejects.toThrow('conversion')
  })

  it('always opens the account chooser and verifies the selected account before export', async () => {
    const requestAccessToken = vi.fn()
    const initTokenClient = vi.fn().mockReturnValue({ requestAccessToken })
    vi.stubGlobal('window', { google: { accounts: { oauth2: { initTokenClient } } } })
    const fetch = vi.fn().mockResolvedValue(Response.json({ user: { emailAddress: account.email, displayName: account.name } }))
    vi.stubGlobal('fetch', fetch)
    const selected = chooseGoogleAccount('public-client-id')
    const config = initTokenClient.mock.calls[0][0]
    expect(config.scope).toBe('https://www.googleapis.com/auth/drive.file')
    expect(requestAccessToken).toHaveBeenCalledWith({ prompt: 'select_account' })
    config.callback({ access_token: account.accessToken, expires_in: 3600, scope: config.scope })
    await expect(selected).resolves.toMatchObject({ email: account.email, name: account.name, accessToken: account.accessToken })
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it.each(['access_denied', 'missing_scope', 'popup_closed'])('handles %s without exporting', async error => {
    const initTokenClient = vi.fn().mockReturnValue({ requestAccessToken: vi.fn() })
    vi.stubGlobal('window', { google: { accounts: { oauth2: { initTokenClient } } } })
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    const selected = chooseGoogleAccount('public-client-id')
    const config = initTokenClient.mock.calls[0][0]
    if (error === 'popup_closed') config.error_callback({ type: error })
    else config.callback(error === 'access_denied' ? { error } : { access_token: 'token', scope: '' })
    await expect(selected).rejects.toThrow(error === 'missing_scope' ? 'permission' : 'cancelled')
    expect(fetch).not.toHaveBeenCalled()
  })
})
