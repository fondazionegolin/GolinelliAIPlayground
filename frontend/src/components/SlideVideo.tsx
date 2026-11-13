import { useState } from 'react'
import { Play } from '@/components/icons'
import { parseVideoUrl } from '@/lib/slideVideo'
import { tl } from '@/i18n/tl'

interface SlideVideoProps {
  url: string
  /** Presenting/viewing: the real player is loaded and clickable. Otherwise a still frame stands in (so the block can be dragged). */
  interactive: boolean
  /** Editor only: lets the author paste or change the link right inside the block. */
  onChangeUrl?: (url: string) => void
  selected?: boolean
}

export function SlideVideo({ url, interactive, onChangeUrl, selected }: SlideVideoProps) {
  const source = parseVideoUrl(url)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const invalid = draft.trim() !== '' && !parseVideoUrl(draft)

  const commit = () => {
    if (!parseVideoUrl(draft)) return
    onChangeUrl?.(draft.trim())
    setEditing(false)
    setDraft('')
  }

  if (onChangeUrl && (!source || editing)) {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center gap-2 bg-slate-900 p-3 text-white" onPointerDown={(event) => event.stopPropagation()}>
        <Play className="h-8 w-8 opacity-70" />
        <p className="text-center text-xs font-semibold opacity-80">{tl("Incolla il link di un video (YouTube, Vimeo o file .mp4)")}</p>
        <div className="flex w-full max-w-md gap-1.5">
          <input
            autoFocus
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => { event.stopPropagation(); if (event.key === 'Enter') commit(); if (event.key === 'Escape') { setEditing(false); setDraft('') } }}
            placeholder="https://www.youtube.com/watch?v=…"
            className={`h-9 min-w-0 flex-1 rounded-lg bg-white px-3 text-sm text-slate-900 outline-none ${invalid ? 'ring-2 ring-red-400' : 'focus:ring-2 focus:ring-blue-400'}`}
          />
          <button type="button" disabled={!parseVideoUrl(draft)} onClick={commit} className="h-9 rounded-lg bg-blue-500 px-3 text-sm font-bold disabled:opacity-40">{tl("Inserisci")}</button>
        </div>
        {invalid && <p className="text-[11px] text-red-300">{tl("Link non riconosciuto")}</p>}
      </div>
    )
  }

  if (!source) return <div className="h-full w-full bg-slate-900" />

  const changeButton = onChangeUrl && selected ? (
    <button
      type="button"
      onPointerDown={(event) => event.stopPropagation()}
      onClick={() => { setDraft(url); setEditing(true) }}
      className="absolute left-2 top-2 z-10 rounded-full bg-black/70 px-2.5 py-1 text-[11px] font-bold text-white hover:bg-black/85"
    >{tl("Cambia link")}</button>
  ) : null

  if (interactive) {
    return source.kind === 'embed' ? (
      <iframe
        src={source.embedUrl}
        title="Video"
        className="h-full w-full border-0 bg-black"
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"
        allowFullScreen
        referrerPolicy="strict-origin-when-cross-origin"
      />
    ) : (
      <video src={source.url} controls playsInline className="h-full w-full bg-black object-contain" />
    )
  }

  return (
    <div className="pointer-events-none relative h-full w-full select-none bg-slate-900">
      {source.kind === 'embed' && source.poster
        ? <img src={source.poster} alt="" className="h-full w-full object-cover" />
        : source.kind === 'file'
          ? <video src={`${source.url}#t=0.1`} preload="metadata" muted playsInline className="h-full w-full object-cover" />
          : null}
      <span className="absolute inset-0 flex items-center justify-center">
        <span className="flex h-14 w-14 items-center justify-center rounded-full bg-black/65 text-white"><Play className="h-7 w-7" /></span>
      </span>
      <span className="pointer-events-auto">{changeButton}</span>
    </div>
  )
}
