import { useEffect, useRef, type CSSProperties } from 'react'
import { Loader2 } from '@/components/icons'
import { useAuthBlobUrl } from './useAuthBlob'
import { mediaName } from './types'
import type { Segment } from './usePlayback'

const PRELOAD = 3 // seconds ahead a clip is mounted and buffered, so cuts and transitions never wait for a download

/** CSS approximation of the ffmpeg `xfade` transitions (the export uses the real filter). `p` runs 0 -> 1. */
function effectStyle(kind: string, p: number, role: 'in' | 'out'): CSSProperties {
  const inc = role === 'in'
  switch (kind) {
    case 'fade': return inc ? { opacity: p } : {}
    case 'fadeblack':
    case 'fadewhite': return { opacity: inc ? (p < 0.5 ? 0 : (p - 0.5) * 2) : (p < 0.5 ? 1 - p * 2 : 0) }
    case 'wipeleft': return inc ? { clipPath: `inset(0 0 0 ${(1 - p) * 100}%)` } : {}
    case 'wiperight': return inc ? { clipPath: `inset(0 ${(1 - p) * 100}% 0 0)` } : {}
    case 'slideleft': return { transform: `translateX(${inc ? (1 - p) * 100 : -p * 100}%)` }
    case 'slideright': return { transform: `translateX(${inc ? -(1 - p) * 100 : p * 100}%)` }
    case 'circleopen': return inc ? { clipPath: `circle(${p * 75}% at 50% 50%)` } : {}
    case 'zoomin': return inc ? { opacity: p, transform: `scale(${1 + (1 - p) * 0.2})` } : { transform: `scale(${1 + p * 0.25})` }
    case 'pixelize': {
      const blur = (1 - Math.abs(2 * p - 1)) * 10
      return inc ? { opacity: p, filter: `blur(${blur}px)` } : { filter: `blur(${blur}px)` }
    }
    case 'radial': {
      const mask = `conic-gradient(#000 ${p * 360}deg, transparent ${p * 360}deg)`
      return inc ? { WebkitMaskImage: mask, maskImage: mask } : {}
    }
    default: return inc ? { opacity: p } : {}
  }
}

function ClipLayer({ projectId, seg, next, time, playing, z }: {
  projectId: string; seg: Segment; next?: Segment; time: number; playing: boolean; z: number
}) {
  const shot = seg.shot
  const videoUrl = useAuthBlobUrl(projectId, shot.video_key ? mediaName(shot.video_key) : '', shot.video_ver)
  const imageUrl = useAuthBlobUrl(projectId, !shot.video_key && shot.keyframe_key ? mediaName(shot.keyframe_key) : '', shot.keyframe_ver)
  const ref = useRef<HTMLVideoElement>(null)
  const active = time >= seg.start - 1e-6 && time < seg.start + seg.duration
  const trimIn = shot.trim_in ?? 0
  const local = time - seg.start
  const heldAtTrim = local >= seg.clipLen
  const pos = Math.min(trimIn + Math.max(local, 0), trimIn + seg.clipLen, (shot.clip_dur ?? Infinity) - 0.04)
  const live = useRef({ pos, trimIn })
  live.current = { pos, trimIn }

  // Buffer the first frame as soon as the metadata is there.
  useEffect(() => {
    const v = ref.current
    if (!v || !videoUrl) return
    const init = () => { v.currentTime = live.current.pos }
    if (v.readyState >= 1) init(); else v.addEventListener('loadedmetadata', init, { once: true })
    return () => v.removeEventListener('loadedmetadata', init)
  }, [videoUrl])

  useEffect(() => {
    const v = ref.current
    if (!v || !videoUrl) return
    if (!active) { if (!v.paused) v.pause(); return }
    if (!playing || heldAtTrim) {
      if (!v.paused) v.pause()
      if (Math.abs(v.currentTime - pos) > 0.03) v.currentTime = pos
      return
    }
    if (v.paused || Math.abs(v.currentTime - pos) > 0.4) {
      if (v.ended || v.paused) v.currentTime = pos
      void v.play().catch(() => undefined)
    }
  }, [active, playing, heldAtTrim, pos, videoUrl])

  // Transition progress: this layer coming in (own transition) or going out (the next clip's).
  let style: CSSProperties = { opacity: active ? 1 : 0 }
  if (active && seg.overlap > 0 && local < seg.overlap && shot.transition) {
    style = { opacity: 1, ...effectStyle(shot.transition, Math.max(0, Math.min(1, local / seg.overlap)), 'in') }
  } else if (next && next.overlap > 0 && time >= next.start && time < next.start + next.overlap && next.shot.transition) {
    style = { opacity: 1, ...effectStyle(next.shot.transition, (time - next.start) / next.overlap, 'out') }
  }
  return (
    <div className="absolute inset-0" style={{ ...style, zIndex: z, pointerEvents: 'none' }}>
      {shot.video_key
        ? (videoUrl ? <video ref={ref} src={videoUrl} preload="auto" playsInline className="h-full w-full object-contain" /> : <div className="flex h-full items-center justify-center"><Loader2 className="h-5 w-5 animate-spin text-white" /></div>)
        : imageUrl ? <img src={imageUrl} alt="" draggable={false} className="h-full w-full object-contain" />
        : <div className="flex h-full items-center justify-center p-6 text-center text-sm text-white/70">{shot.visual}</div>}
    </div>
  )
}

function VoiceLayer({ projectId, seg, time, playing }: { projectId: string; seg: Segment; time: number; playing: boolean }) {
  const shot = seg.shot
  const url = useAuthBlobUrl(projectId, mediaName(shot.audio_key), shot.audio_ver)
  const ref = useRef<HTMLAudioElement>(null)
  const end = seg.audioAbs + seg.audioLen
  const active = time >= seg.audioAbs && time < end
  const pos = (shot.audio_in ?? 0) + (time - seg.audioAbs)
  useEffect(() => {
    const a = ref.current
    if (!a || !url) return
    if (!active || !playing) { if (!a.paused) a.pause(); return }
    a.volume = Math.max(0, Math.min(1, (time - seg.audioAbs) / 0.08, (end - time) / 0.25))
    if (a.paused || Math.abs(a.currentTime - pos) > 0.3) {
      a.currentTime = pos
      void a.play().catch(() => undefined)
    }
  })
  return url ? <audio ref={ref} src={url} preload="auto" /> : null
}

/** The preview monitor: layered clips (with transitions) and the voice-over track, driven by the timeline clock. */
export function Monitor({ projectId, ratio, segments, time, playing, current }: {
  projectId: string; ratio: number; segments: Segment[]; time: number; playing: boolean; current?: Segment
}) {
  const near = (from: number, to: number) => time >= from - PRELOAD && time < to + 0.2
  const clips = segments.map((s, i) => ({ s, i })).filter(({ s }) => near(s.start, s.start + s.duration)).slice(0, 6)
  const voices = segments.filter((s) => s.audioLen > 0 && near(s.audioAbs, s.audioAbs + s.audioLen))
  const kind = current?.shot.transition
  const inFlight = current && current.overlap > 0 && time - current.start < current.overlap ? kind : undefined
  return (
    <div className="flex h-full min-h-0 items-center justify-center" style={{ containerType: 'size' }}>
      <div className="relative overflow-hidden rounded-[var(--control-radius)]"
        style={{ aspectRatio: String(ratio), width: `min(100cqw, calc(100cqh * ${ratio}))`, background: inFlight === 'fadewhite' ? '#fff' : '#000' }}>
        {clips.map(({ s, i }) => (
          <ClipLayer key={s.shot.id} projectId={projectId} seg={s} next={segments[i + 1]} time={time} playing={playing} z={i + 1} />
        ))}
        {voices.map((s) => <VoiceLayer key={s.shot.id} projectId={projectId} seg={s} time={time} playing={playing} />)}
        {current?.shot.narration && <p className="pointer-events-none absolute inset-x-0 bottom-0 z-[100] bg-gradient-to-t from-black/75 to-transparent px-4 pb-3 pt-8 text-center text-sm text-white">{current.shot.narration}</p>}
      </div>
    </div>
  )
}
