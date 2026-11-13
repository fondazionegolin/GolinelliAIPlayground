/** Turns a pasted link into something a slide can play: YouTube/Vimeo embeds or a direct video file. */
export type SlideVideoSource =
  | { kind: 'embed'; provider: 'youtube' | 'vimeo'; embedUrl: string; poster?: string }
  | { kind: 'file'; url: string }

const FILE_RE = /\.(mp4|webm|ogv|ogg|mov|m4v)(?:$|[?#])/i

export function parseVideoUrl(input: string | undefined | null): SlideVideoSource | null {
  const raw = (input || '').trim()
  if (!raw) return null
  let url: URL
  try { url = new URL(/^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : `https://${raw}`) } catch { return null }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
  const host = url.hostname.replace(/^www\.|^m\./, '').toLowerCase()

  let youtubeId: string | null = null
  if (host === 'youtu.be') youtubeId = url.pathname.split('/')[1] || null
  else if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
    if (url.pathname === '/watch') youtubeId = url.searchParams.get('v')
    else {
      const match = url.pathname.match(/^\/(?:embed|shorts|live|v)\/([\w-]{6,})/)
      youtubeId = match ? match[1] : null
    }
  }
  if (youtubeId && /^[\w-]{6,}$/.test(youtubeId)) {
    const start = parseInt(url.searchParams.get('t') || url.searchParams.get('start') || '', 10)
    return {
      kind: 'embed', provider: 'youtube',
      embedUrl: `https://www.youtube-nocookie.com/embed/${youtubeId}?rel=0${Number.isFinite(start) && start > 0 ? `&start=${start}` : ''}`,
      poster: `https://i.ytimg.com/vi/${youtubeId}/hqdefault.jpg`,
    }
  }

  if (host === 'vimeo.com' || host === 'player.vimeo.com') {
    const match = url.pathname.match(/(\d{5,})/)
    if (match) return { kind: 'embed', provider: 'vimeo', embedUrl: `https://player.vimeo.com/video/${match[1]}` }
  }

  if (FILE_RE.test(url.pathname + url.search)) return { kind: 'file', url: url.toString() }
  return null
}

/** True when the text pasted/typed is (only) a link we can play. */
export function isVideoUrl(text: string): boolean {
  const trimmed = text.trim()
  return !/\s/.test(trimmed) && parseVideoUrl(trimmed) !== null
}
