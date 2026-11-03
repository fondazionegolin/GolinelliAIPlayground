import { liveInteractionApi } from '@/lib/api'

/** Downloads the PDF report of a finished live session. Throws on failure so the caller can toast. */
export async function downloadLiveReport(id: string, title: string): Promise<void> {
  const response = await liveInteractionApi.reportPdf(id)
  const url = URL.createObjectURL(response.data as Blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `report-${title.replace(/[^\p{L}\p{N} _-]+/gu, '').trim().slice(0, 50) || 'sessione'}.pdf`
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}
