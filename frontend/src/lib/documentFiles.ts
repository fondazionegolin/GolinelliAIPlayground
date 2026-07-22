export const DOCUMENT_IMPORT_ACCEPT = '.pdf,.ppt,.pptx,.doc,.docx,.md,.xls,.xlsx'

export const DOCUMENT_IMPORT_EXTENSIONS = new Set(['pdf', 'ppt', 'pptx', 'doc', 'docx', 'md', 'xls', 'xlsx'])

export function documentSourceExtension(contentJson: string, fallbackType = 'document'): string {
  try {
    const content = JSON.parse(contentJson || '{}')
    const extension = String(content?.source?.extension || '').trim().replace(/^\./, '')
    if (extension) return extension.toUpperCase()
  } catch {
    // Fall through to native type labels for documents created in the platform.
  }
  if (fallbackType === 'presentation') return 'SLIDE'
  if (fallbackType === 'sheet') return 'SHEET'
  if (fallbackType === 'canvas') return 'CANVAS'
  if (fallbackType === 'pdf') return 'PDF'
  return 'DOC'
}

export function isSupportedDocumentFile(file: File): boolean {
  const extension = file.name.split('.').pop()?.toLowerCase() || ''
  return DOCUMENT_IMPORT_EXTENSIONS.has(extension)
}

export function downloadExportedDocument(blob: Blob, title: string, extension: string): void {
  const safeTitle = title.replace(/[\\/:*?"<>|]+/g, '_').trim() || 'Documento'
  const url = URL.createObjectURL(blob)
  const anchor = window.document.createElement('a')
  anchor.href = url
  anchor.download = `${safeTitle}.${extension}`
  window.document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}
