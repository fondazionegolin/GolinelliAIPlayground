import api from '@/lib/api'

export type DocumentShareSource = { source_kind: 'draft' | 'task'; source_id: string }
export type SharePermission = 'view' | 'edit'
export type DocumentShareLink = { id: string; token: string; permission: SharePermission; created_at: string }
export type SharedDocument = { title: string; doc_type: 'document' | 'presentation'; content_json: string; permission: SharePermission; revision: string }

export const documentSharesApi = {
  list: (source: DocumentShareSource) => api.get<DocumentShareLink[]>('/document-shares', { params: source }),
  create: (source: DocumentShareSource, permission: SharePermission) => api.post<DocumentShareLink>('/document-shares', { ...source, permission }),
  revoke: (id: string) => api.delete(`/document-shares/${id}`),
}

export class PublicDocumentError extends Error {
  constructor(message: string, readonly status: number) { super(message) }
}

async function publicRequest(token: string, body?: { title: string; content_json: string; revision: string }): Promise<SharedDocument> {
  const response = await fetch(`/api/v1/document-shares/public/${encodeURIComponent(token)}`, {
    method: body ? 'PUT' : 'GET', credentials: 'omit', cache: 'no-store',
    headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined,
  })
  const value = await response.json()
  if (!response.ok) throw new PublicDocumentError(typeof value.detail === 'string' ? value.detail : 'Documento non disponibile', response.status)
  return value
}

export const publicDocumentApi = { read: (token: string) => publicRequest(token), save: publicRequest }
export const documentShareUrl = (token: string) => `${window.location.origin}/d/${encodeURIComponent(token)}`
