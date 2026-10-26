import { useEffect, useState } from 'react'
import { FileText, Video } from '@/components/icons'
import { AudioPlayer, VideoPreview } from '@/components/media/MediaPlayer'
import { mediaKind, youtubeVideo } from '@/lib/media'
import { llmApi } from '@/lib/api'

const URL_RE = /https?:\/\/[^\s<>()"']+/gi
const metadataCache = new Map<string, LinkMetadata>()

interface LinkMetadata {
  title: string
  description?: string
  image_url?: string
  kind: 'web' | 'youtube'
}

export function linksInMessage(content: string): string[] {
  return [...new Set([...content.matchAll(URL_RE)].map(match => match[0].replace(/[.,;:!?\]}]+$/, '')))]
}

export function messageTextWithoutPreviewLinks(content: string): string {
  return content
    .replace(/\s*\[YouTube: [^\]]+\]/g, '')
    .replace(/\[[^\]]+\]\(https?:\/\/[^)]+\)/gi, '')
    .replace(URL_RE, '')
    .replace(/\s{2,}/g, ' ')
    .trim()
}

function LinkCard({ url }: { url: string }) {
  const [metadata, setMetadata] = useState<LinkMetadata | undefined>(() => metadataCache.get(url))
  useEffect(() => {
    if (metadataCache.has(url)) return
    let active = true
    llmApi.previewLink(url).then(({ data }) => {
      const result: LinkMetadata = { title: data.title, description: data.description, image_url: data.image_url, kind: data.kind }
      metadataCache.set(url, result)
      if (active) setMetadata(result)
    }).catch(() => { /* Keep the domain card when metadata is unavailable. */ })
    return () => { active = false }
  }, [url])

  const isYoutube = Boolean(youtubeVideo(url))
  const videoId = youtubeVideo(url)?.id
  const thumbnail = metadata?.image_url || (videoId ? `https://img.youtube.com/vi/${videoId}/hqdefault.jpg` : undefined)
  let domain = 'Pagina web'
  try { domain = new URL(url).hostname.replace(/^www\./, '') } catch { /* URL remains linkable. */ }

  if (isYoutube || mediaKind(url) === 'video') return <VideoPreview src={url} title={metadata?.title || (isYoutube ? 'Video YouTube' : 'Video')} poster={thumbnail} />
  if (mediaKind(url) === 'audio') return <AudioPlayer src={url} title={metadata?.title || 'Audio'} />

  return (
    <a href={url} target="_blank" rel="noopener noreferrer" title={url}
      className="flex w-52 max-w-full flex-col overflow-hidden rounded-xl border border-black/10 bg-white/90 text-slate-800 shadow-sm transition hover:shadow-md">
      {thumbnail ? (
        <img src={thumbnail} alt="" className="h-24 w-full bg-slate-100 object-cover" loading="lazy" />
      ) : (
        <div className="flex h-20 items-center justify-center bg-slate-100 text-slate-500">
          {isYoutube ? <Video className="h-8 w-8" /> : <FileText className="h-8 w-8" />}
        </div>
      )}
      <div className="min-w-0 px-2.5 py-2">
        <div className="truncate text-xs font-semibold">{metadata?.title && metadata.title !== 'Video YouTube' ? metadata.title : isYoutube ? 'Video YouTube' : domain}</div>
        <div className="truncate text-[10px] text-slate-500">{metadata?.description || domain}</div>
      </div>
    </a>
  )
}

export function MessageLinkPreviews({ content, debounceMs = 0 }: { content: string; debounceMs?: number }) {
  const [shownContent, setShownContent] = useState(debounceMs ? '' : content)
  useEffect(() => {
    if (!debounceMs) { setShownContent(content); return }
    const timer = window.setTimeout(() => setShownContent(content), debounceMs)
    return () => window.clearTimeout(timer)
  }, [content, debounceMs])
  const links = linksInMessage(shownContent).slice(0, 3)
  if (!links.length) return null
  return <div className="mb-2 flex flex-wrap gap-2">{links.map(url => <LinkCard key={url} url={url} />)}</div>
}
