export type MediaKind = 'video' | 'audio'
const AUDIO = /\.(mp3|wav|ogg|oga|m4a|aac|flac|opus)(?:$|[?#])/i
const VIDEO = /\.(mp4|webm|mov|m4v|ogv)(?:$|[?#])/i

export function mediaKind(name: string, mime = ''): MediaKind | null {
  if (mime.startsWith('audio/') || AUDIO.test(name)) return 'audio'
  if (mime.startsWith('video/') || VIDEO.test(name)) return 'video'
  return null
}

export function youtubeVideo(url: string): { id: string; start: number } | null {
  try {
    const u = new URL(url)
    if (!['https:', 'http:'].includes(u.protocol)) return null
    const host = u.hostname.toLowerCase().replace(/^www\./, '')
    let id: string | null = null
    if (host === 'youtu.be') id = u.pathname.split('/')[1]
    if (['youtube.com', 'm.youtube.com', 'youtube-nocookie.com'].includes(host)) {
      const parts = u.pathname.split('/')
      id = u.pathname === '/watch' ? u.searchParams.get('v') : ['embed', 'shorts', 'live'].includes(parts[1]) ? parts[2] : null
    }
    if (!id || !/^[\w-]{11}$/.test(id)) return null
    const t = u.searchParams.get('t') || u.searchParams.get('start') || ''
    const start = /^\d+$/.test(t) ? Number(t) : [...t.matchAll(/(\d+)(h|m|s)/g)].reduce((n, m) => n + Number(m[1]) * ({ h: 3600, m: 60, s: 1 }[m[2]] || 0), 0)
    return { id, start: Math.min(start, 86400) }
  } catch { return null }
}

export function safeMediaUrl(url: string) {
  try { return ['http:', 'https:', 'blob:'].includes(new URL(url, window.location.origin).protocol) } catch { return false }
}
