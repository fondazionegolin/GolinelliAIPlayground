import api from '@/lib/api'
import { safeMediaUrl } from '@/lib/media'

export interface AudioTrack { id: string; title: string; artist_name?: string | null; mime_type?: string; cover_url?: string | null }
export type AudioLoader = (track: AudioTrack, signal: AbortSignal) => Promise<Blob | string>

/** Fetch private media with app authentication; external media never receives those headers. */
export const loadAudioUrl: AudioLoader = async (track, signal) => {
  if (!safeMediaUrl(track.id)) throw new Error('Invalid audio URL')
  const url = new URL(track.id, window.location.origin)
  if (url.origin === window.location.origin && url.pathname.startsWith('/api/v1/')) {
    const path = url.pathname.slice('/api/v1'.length) + url.search
    if (url.pathname.endsWith('/download-url')) {
      const { data } = await api.get<{ download_url?: string; url?: string }>(path, { signal })
      const target = data.download_url || data.url
      if (!target || !safeMediaUrl(target) || new URL(target, window.location.origin).pathname.endsWith('/download-url')) throw new Error('Invalid audio link')
      return loadAudioUrl({ ...track, id: target }, signal)
    }
    return (await api.get<Blob>(path, { responseType: 'blob', signal })).data
  }
  if (url.protocol === 'blob:') {
    const response = await fetch(url, { signal, credentials: 'omit' })
    if (!response.ok) throw new Error('Audio unavailable')
    return response.blob()
  }
  return url.href
}
