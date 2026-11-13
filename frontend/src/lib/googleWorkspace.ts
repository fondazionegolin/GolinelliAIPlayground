export type GoogleWorkspaceKind = 'document' | 'slides'
export type GoogleExportDocument = { title: string; content_json: string }
export type GoogleWorkspaceExport = {
  kind: GoogleWorkspaceKind
  getDocument: () => GoogleExportDocument
}
export type GoogleWorkspaceAccount = {
  email: string
  name: string
  accessToken: string
  expiresAt: number
}

const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file'
const DRIVE_API = 'https://www.googleapis.com/drive/v3'
const UPLOAD_API = 'https://www.googleapis.com/upload/drive/v3/files'
const FORMATS = {
  document: {
    extension: 'docx',
    source: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    target: 'application/vnd.google-apps.document',
    path: 'document',
  },
  slides: {
    extension: 'pptx',
    source: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    target: 'application/vnd.google-apps.presentation',
    path: 'presentation',
  },
} as const

export class GoogleWorkspaceError extends Error {
  constructor(public code: 'load' | 'cancelled' | 'permission' | 'account' | 'expired' | 'upload' | 'conversion') {
    super(code)
  }
}

type TokenResponse = { access_token?: string; expires_in?: number; scope?: string; error?: string }
type GoogleIdentity = {
  accounts: { oauth2: {
    initTokenClient: (config: {
      client_id: string
      scope: string
      include_granted_scopes: boolean
      callback: (response: TokenResponse) => void
      error_callback: (error: { type: string }) => void
    }) => { requestAccessToken: (options: { prompt: string }) => void }
  } }
}

function identity(): GoogleIdentity | undefined {
  return (window as Window & { google?: GoogleIdentity }).google
}

let identityLoading: Promise<void> | undefined

/** Load before the click: Google requires a direct user gesture to open its account chooser. */
export function loadGoogleIdentity(): Promise<void> {
  if (identity()?.accounts?.oauth2) return Promise.resolve()
  if (identityLoading) return identityLoading
  identityLoading = new Promise<void>((resolve, reject) => {
    const script = document.createElement('script')
    const fail = () => {
      clearTimeout(timer)
      script.remove()
      identityLoading = undefined
      reject(new GoogleWorkspaceError('load'))
    }
    const timer = setTimeout(fail, 15000)
    script.src = 'https://accounts.google.com/gsi/client'
    script.async = true
    script.onload = () => {
      if (!identity()?.accounts?.oauth2) return fail()
      clearTimeout(timer)
      resolve()
    }
    script.onerror = fail
    document.head.appendChild(script)
  })
  return identityLoading
}

/** Tokens stay in component memory; no refresh token or account credentials are stored. */
export function chooseGoogleAccount(clientId: string): Promise<GoogleWorkspaceAccount> {
  return new Promise((resolve, reject) => {
    const google = identity()
    if (!google) return reject(new GoogleWorkspaceError('load'))
    const client = google.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: DRIVE_SCOPE,
      include_granted_scopes: false,
      error_callback: error => reject(new GoogleWorkspaceError(error.type === 'popup_closed' ? 'cancelled' : 'load')),
      callback: response => {
        if (response.error || !response.access_token || !response.scope?.split(' ').includes(DRIVE_SCOPE)) {
          reject(new GoogleWorkspaceError(response.error === 'access_denied' ? 'cancelled' : 'permission'))
          return
        }
        const token = response.access_token
        const expiresAt = Date.now() + Number(response.expires_in || 0) * 1000
        fetch(`${DRIVE_API}/about?fields=user(emailAddress,displayName)`, {
          headers: { Authorization: `Bearer ${token}` },
          signal: AbortSignal.timeout(30000),
        }).then(async result => {
          if (!result.ok) throw new GoogleWorkspaceError(result.status === 401 ? 'expired' : 'account')
          const { user } = await result.json()
          if (!user?.emailAddress) throw new GoogleWorkspaceError('account')
          resolve({ email: user.emailAddress, name: user.displayName || user.emailAddress, accessToken: token, expiresAt })
        }).catch(() => reject(new GoogleWorkspaceError('account')))
      },
    })
    client.requestAccessToken({ prompt: 'select_account' })
  })
}

export function googleWorkspaceFormat(kind: GoogleWorkspaceKind) {
  const format = FORMATS[kind]
  if (!format) throw new GoogleWorkspaceError('conversion')
  return format
}

/** Import Office bytes as a native, editable Workspace file in the selected user's My Drive. */
export async function uploadGoogleWorkspace(
  kind: GoogleWorkspaceKind,
  title: string,
  bytes: Blob,
  account: GoogleWorkspaceAccount,
): Promise<string> {
  const format = googleWorkspaceFormat(kind)
  if (account.expiresAt <= Date.now() + 30000) throw new GoogleWorkspaceError('expired')
  if (!bytes.size) throw new GoogleWorkspaceError('conversion')
  const headers = { Authorization: `Bearer ${account.accessToken}` }
  const session = await fetch(`${UPLOAD_API}?uploadType=resumable&fields=id,mimeType`, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json; charset=UTF-8', 'X-Upload-Content-Type': format.source },
    body: JSON.stringify({ name: title.trim() || 'Documento', mimeType: format.target }),
    signal: AbortSignal.timeout(30000),
  })
  if (!session.ok) throw new GoogleWorkspaceError(session.status === 401 ? 'expired' : 'upload')
  const location = session.headers.get('Location')
  // Only send bytes and credentials back to Google's upload endpoint.
  if (!location || !location.startsWith(`${UPLOAD_API}?`)) throw new GoogleWorkspaceError('upload')
  const uploaded = await fetch(location, {
    method: 'PUT',
    headers: { ...headers, 'Content-Type': format.source },
    body: bytes,
    signal: AbortSignal.timeout(180000),
  })
  if (!uploaded.ok) throw new GoogleWorkspaceError(uploaded.status === 401 ? 'expired' : 'upload')
  const file = await uploaded.json()
  if (file.mimeType !== format.target || typeof file.id !== 'string' || !/^[\w-]+$/.test(file.id)) {
    throw new GoogleWorkspaceError('conversion')
  }
  return `https://docs.google.com/${format.path}/d/${file.id}/edit?authuser=${encodeURIComponent(account.email)}`
}
