import { createContext, useContext, useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Maximize2, Minimize2, PictureInPicture2, Play, X } from '@/components/icons'
import api, { getApiAuthHeaders } from '@/lib/api'
import { Select } from '@/design'
import { safeMediaUrl, youtubeVideo } from '@/lib/media'
import './media-player.css'

type VideoSource = { src: string; title: string; blob?: Blob; poster?: string }
type PlayerContext = { openVideo: (source: VideoSource) => void }
const Context = createContext<PlayerContext | null>(null)

/** Resolve protected student media using its header token; never send credentials to external URLs. */
function useMediaSource(src: string) {
  const [resolved, setResolved] = useState<{ url: string; blob?: Blob; error?: string } | null>(null)
  useEffect(() => {
    let active = true
    let objectUrl: string | undefined
    setResolved(null)
    if (!safeMediaUrl(src)) { setResolved({ url: '', error: 'Indirizzo multimediale non valido.' }); return }
    const u = new URL(src, window.location.origin)
    if (u.origin === window.location.origin && u.pathname.startsWith('/api/v1/') && Object.keys(getApiAuthHeaders()).length) {
      api.get<Blob>(u.pathname.slice('/api/v1'.length) + u.search, { responseType: 'blob' }).then(({ data }) => {
        if (!active) return
        objectUrl = URL.createObjectURL(data)
        setResolved({ url: objectUrl, blob: data })
      }).catch(() => { if (active) setResolved({ url: '', error: 'File non disponibile o accesso scaduto.' }) })
    } else setResolved({ url: src })
    return () => { active = false; if (objectUrl) URL.revokeObjectURL(objectUrl) }
  }, [src])
  return resolved
}

export function MediaPlayerProvider({ children }: { children: ReactNode }) {
  const [source, setSource] = useState<VideoSource | null>(null)
  const [floating, setFloating] = useState(false)
  const [position, setPosition] = useState({ x: 24, y: 24 })
  const [error, setError] = useState('')
  const host = useRef<HTMLDivElement>(null)
  const video = useRef<HTMLVideoElement>(null)
  const ownedUrl = useRef<string | null>(null)
  const previousFocus = useRef<HTMLElement | null>(null)
  const closeButton = useRef<HTMLButtonElement>(null)
  const drag = useRef<{ x: number; y: number } | null>(null)
  const youtube = source ? youtubeVideo(source.src) : null
  const release = () => { if (ownedUrl.current) URL.revokeObjectURL(ownedUrl.current); ownedUrl.current = null }
  const close = () => { setSource(null); release(); previousFocus.current?.focus() }
  const openVideo = (next: VideoSource) => {
    if (!safeMediaUrl(next.src)) return
    previousFocus.current = document.activeElement as HTMLElement | null
    release()
    const src = next.blob ? (ownedUrl.current = URL.createObjectURL(next.blob)) : next.src
    setSource({ ...next, src }); setFloating(false); setError('')
  }
  useEffect(() => () => { if (ownedUrl.current) URL.revokeObjectURL(ownedUrl.current) }, [])
  useEffect(() => {
    if (!source) return
    closeButton.current?.focus()
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !document.fullscreenElement) { event.stopImmediatePropagation(); close() }
      if (event.key === 'Tab' && !floating && host.current) {
        const controls = [...host.current.querySelectorAll<HTMLElement>('button,a,video,iframe')].filter(el => !el.hasAttribute('disabled'))
        const first = controls[0], last = controls[controls.length - 1]
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
    // A new source starts one stable player; changing floating mode keeps its video/iframe mounted.
  }, [source, floating])
  useEffect(() => {
    if (!floating || !source) return
    const fitViewport = () => {
      const box = host.current?.getBoundingClientRect()
      if (!box) return
      setPosition(current => ({
        x: Math.max(12, Math.min(current.x, window.innerWidth - box.width - 12)),
        y: Math.max(12, Math.min(current.y, window.innerHeight - box.height - 12)),
      }))
    }
    fitViewport()
    window.addEventListener('resize', fitViewport)
    window.visualViewport?.addEventListener('resize', fitViewport)
    return () => { window.removeEventListener('resize', fitViewport); window.visualViewport?.removeEventListener('resize', fitViewport) }
  }, [floating, source])
  const fullScreen = async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen()
      else if (host.current?.requestFullscreen) await host.current.requestFullscreen()
      else (video.current as (HTMLVideoElement & { webkitEnterFullscreen?: () => void }) | null)?.webkitEnterFullscreen?.()
    } catch { setError('Lo schermo intero non è disponibile in questo browser.') }
  }
  const nativePip = async () => {
    try {
      if (document.pictureInPictureElement) await document.exitPictureInPicture()
      else await video.current?.requestPictureInPicture()
    } catch { setError('PiP non disponibile. Puoi usare la finestra flottante della piattaforma.') }
  }
  const toggleFloating = () => {
    setPosition({ x: Math.max(12, window.innerWidth - 432), y: Math.max(12, window.innerHeight - 320) })
    setFloating(v => !v)
  }
  const embed = youtube ? `https://www.youtube-nocookie.com/embed/${youtube.id}?autoplay=1&playsinline=1&start=${youtube.start}&origin=${encodeURIComponent(window.location.origin)}` : ''
  return <Context.Provider value={{ openVideo }}>
    {children}
    {source && createPortal(<>
      {!floating && <div className="fixed inset-0 z-[2100] bg-black/65" onClick={close} />}
      <div ref={host} role="dialog" aria-modal={!floating} aria-label={source.title}
        className={`platform-media-window fixed z-[2101] overflow-hidden rounded-2xl border border-white/15 bg-slate-950 text-white shadow-2xl ${floating ? 'w-[min(408px,calc(100vw-24px))]' : 'left-1/2 top-1/2 w-[min(860px,calc(100vw-24px))] -translate-x-1/2 -translate-y-1/2'} [&:fullscreen]:flex [&:fullscreen]:h-full [&:fullscreen]:w-full [&:fullscreen]:translate-x-0 [&:fullscreen]:translate-y-0 [&:fullscreen]:flex-col [&:fullscreen]:rounded-none`}
        style={floating ? { left: position.x, top: position.y } : undefined}>
        <header className={`flex items-center gap-2 px-3 py-2 ${floating ? 'cursor-move touch-none' : ''}`}
          onPointerDown={event => {
            if (!floating || document.fullscreenElement || (event.target as HTMLElement).closest('button,a')) return
            const box = host.current!.getBoundingClientRect(); drag.current = { x: event.clientX - box.left, y: event.clientY - box.top }
            event.currentTarget.setPointerCapture(event.pointerId)
          }}
          onPointerMove={event => {
            if (!drag.current || !host.current) return
            const box = host.current.getBoundingClientRect()
            setPosition({ x: Math.max(0, Math.min(window.innerWidth - box.width, event.clientX - drag.current.x)), y: Math.max(0, Math.min(window.innerHeight - box.height, event.clientY - drag.current.y)) })
          }} onPointerUp={() => { drag.current = null }} onPointerCancel={() => { drag.current = null }}>
          <p className="min-w-0 flex-1 truncate text-xs font-semibold">{source.title}</p>
          <button type="button" onClick={toggleFloating} className="rounded-lg p-2 hover:bg-white/15" aria-label={floating ? 'Espandi player' : 'Finestra flottante'}>{floating ? <Maximize2 className="h-4 w-4" /> : <Minimize2 className="h-4 w-4" />}</button>
          {!youtube && document.pictureInPictureEnabled && <button type="button" onClick={() => void nativePip()} className="rounded-lg p-2 hover:bg-white/15" aria-label="PiP di sistema"><PictureInPicture2 className="h-4 w-4" /></button>}
          <button type="button" onClick={() => void fullScreen()} className="rounded-lg p-2 hover:bg-white/15" aria-label="Schermo intero"><Maximize2 className="h-4 w-4" /></button>
          <button ref={closeButton} type="button" onClick={close} className="rounded-lg p-2 hover:bg-white/15" aria-label="Chiudi player"><X className="h-4 w-4" /></button>
        </header>
        <div className="flex aspect-video min-h-0 items-center justify-center bg-black [&:fullscreen]:flex-1">
          {youtube ? <iframe key={source.src} src={embed} title={source.title} className="h-full min-h-[200px] w-full" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowFullScreen referrerPolicy="strict-origin-when-cross-origin" />
            : <video key={source.src} ref={video} src={source.src} poster={source.poster} controls autoPlay playsInline className="h-full max-h-[75dvh] w-full object-contain" onError={() => setError('Questo video non è riproducibile: controlla il formato o il collegamento.')} />}
        </div>
        {error && <p role="alert" className="px-3 py-2 text-xs text-amber-200">{error}</p>}
        {youtube && <a href={source.src} target="_blank" rel="noreferrer" className="block px-3 py-2 text-xs text-white/70 underline">Apri su YouTube</a>}
      </div>
    </>, document.body)}
  </Context.Provider>
}

export function VideoPreview({ src, title, poster, blob }: VideoSource) {
  const context = useContext(Context)
  const media = useMediaSource(src)
  const youtube = youtubeVideo(src)
  if (media?.error) return <p role="alert" className="text-xs text-red-600">{media.error}</p>
  return <button type="button" disabled={!media?.url} onClick={() => media?.url && context?.openVideo({ src: media.url, title, poster, blob: blob || media.blob })}
    aria-label={`Riproduci ${title}`} className="group relative block w-72 max-w-full overflow-hidden rounded-xl border border-black/10 bg-slate-950 text-left text-white shadow-sm disabled:opacity-50">
    {poster || youtube ? <img src={poster || `https://img.youtube.com/vi/${youtube!.id}/hqdefault.jpg`} alt="" className="aspect-video w-full object-cover opacity-80" />
      : <video src={media?.url} preload="metadata" muted playsInline className="pointer-events-none aspect-video w-full object-cover opacity-70" />}
    <span className="absolute left-1/2 top-[40%] flex h-12 w-12 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-white/95 text-slate-900 shadow-lg transition group-hover:scale-110"><Play className="h-6 w-6" /></span>
    <span className="block truncate px-3 py-2 text-xs font-semibold">{title}</span>
  </button>
}

export function AudioPlayer({ src, title }: { src: string; title: string }) {
  const media = useMediaSource(src)
  const [error, setError] = useState(false)
  const [playbackRate, setPlaybackRate] = useState(1)
  const audio = useRef<HTMLAudioElement>(null)
  const speedId = useId()
  const speeds = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2]
  useEffect(() => {
    setError(false)
    setPlaybackRate(1)
    if (audio.current) { audio.current.playbackRate = 1; audio.current.defaultPlaybackRate = 1 }
  }, [src])
  return <div className="w-80 max-w-full rounded-xl border border-black/10 bg-white p-3 text-slate-800">
    <p className="mb-2 truncate text-xs font-semibold">{title}</p>
    {media?.error || error ? <p role="alert" className="text-xs text-red-600">{media?.error || 'Audio non disponibile o formato non supportato.'}</p>
      : <>
        <audio ref={audio} src={media?.url} controls preload="metadata" className="w-full" aria-label={title}
          onLoadedMetadata={event => { event.currentTarget.playbackRate = playbackRate }}
          onRateChange={event => setPlaybackRate(event.currentTarget.playbackRate)}
          onError={() => setError(true)} />
        <div className="mt-2 flex items-center justify-between gap-3">
          <label htmlFor={speedId} className="text-xs font-semibold">Velocità di ascolto</label>
          <div className="w-24 shrink-0"><Select id={speedId} aria-label={`Velocità di riproduzione di ${title}`} density="compact" value={playbackRate}
            onChange={event => {
              const rate = Number(event.target.value)
              setPlaybackRate(rate)
              if (audio.current) { audio.current.defaultPlaybackRate = rate; audio.current.playbackRate = rate }
            }}>
            {!speeds.includes(playbackRate) && <option value={playbackRate}>{playbackRate}×</option>}
            {speeds.map(speed => <option key={speed} value={speed}>{speed}×</option>)}
          </Select></div>
        </div>
      </>}
  </div>
}
