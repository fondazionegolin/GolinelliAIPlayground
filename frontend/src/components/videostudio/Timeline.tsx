import { useEffect, useRef, useState } from 'react'
import { Film, Loader2, Mic } from '@/components/icons'
import { AuthMedia } from './AuthMedia'
import { mediaName, type Shot } from './types'
import { layoutShots, type Segment } from './usePlayback'

const TRACK_H = 60
const AUDIO_H = 30
const RULER_H = 26
const LABEL_W = 40
const HANDLE = 8
const MIN_CLIP = 0.3
const MAX_HOLD = 15 // a clip can be stretched past its end: the last frame is held
const SNAP = 0.15   // seconds

export const fmtTime = (t: number) => {
  const s = Math.max(0, t)
  return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}.${Math.floor((s * 10) % 10)}`
}

interface Props {
  projectId: string
  segments: Segment[]
  total: number
  time: number
  zoom: number               // pixels per second
  selectedId?: string
  disabled?: boolean
  onSelect: (id: string) => void
  onSeek: (t: number) => void
  onReorder: (from: number, to: number) => void
  onEdit: (id: string, patch: Partial<Shot>) => void
  onJunction: (index: number, rect: DOMRect) => void
}

const track = (move: (ev: PointerEvent) => void, up: (ev: PointerEvent) => void) => {
  const end = (ev: PointerEvent) => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', end); up(ev) }
  window.addEventListener('pointermove', move)
  window.addEventListener('pointerup', end)
}

/** Video track and voice-over track. The video track is magnetic (ripple): clips never leave gaps, so dragging a clip
 *  re-flows its neighbours live and trimming an edge shifts everything after it. */
export function Timeline({ projectId, segments, total, time, zoom, selectedId, disabled, onSelect, onSeek, onReorder, onEdit, onJunction }: Props) {
  const scroller = useRef<HTMLDivElement>(null)
  const [drag, setDrag] = useState<{ index: number; dx: number; target: number } | null>(null)
  const [trim, setTrim] = useState<{ id: string; trimIn: number; trimOut: number } | null>(null)
  const [voice, setVoice] = useState<{ id: string; abs: number; len: number } | null>(null)

  // Layout as it will be once the gesture is released: trims and the dragged clip's slot are applied live.
  let ordered = segments.map((s) => (trim && trim.id === s.shot.id ? { ...s.shot, trim_in: trim.trimIn, trim_out: trim.trimOut } : s.shot))
  if (drag) {
    const moving = ordered[drag.index]
    const rest = ordered.filter((_, i) => i !== drag.index)
    ordered = [...rest.slice(0, drag.target), moving, ...rest.slice(drag.target)]
  }
  const view: Segment[] = drag || trim ? layoutShots(ordered) : segments
  const liveTotal = view.reduce((m, s) => Math.max(m, s.start + s.duration, s.audioAbs + s.audioLen), 0)
  const width = Math.max(Math.max(total, liveTotal) * zoom + 140, 480)

  useEffect(() => { // keep the playhead in view while playing
    const el = scroller.current
    if (!el) return
    const x = time * zoom
    if (x < el.scrollLeft || x > el.scrollLeft + el.clientWidth - 60) el.scrollLeft = Math.max(0, x - 80)
  }, [time, zoom])

  const seekFromEvent = (e: React.PointerEvent) => {
    const el = scroller.current
    if (!el) return
    onSeek((e.clientX - el.getBoundingClientRect().left + el.scrollLeft - LABEL_W) / zoom)
  }
  const scrub = (e: React.PointerEvent) => {
    if (disabled) return
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    seekFromEvent(e)
  }

  // ── video clips ──
  const startMove = (e: React.PointerEvent, index: number) => {
    if (disabled || e.button !== 0) return
    e.stopPropagation()
    const startX = e.clientX
    const seg = segments[index]
    onSelect(seg.shot.id)
    let moved = false
    const others = layoutShots(segments.filter((_, i) => i !== index).map((x) => x.shot))
    const targetFor = (dx: number) => {
      const centre = seg.start + seg.duration / 2 + dx / zoom
      return others.filter((o) => o.start + o.duration / 2 < centre).length
    }
    let target = index
    track((ev) => {
      const dx = ev.clientX - startX
      if (Math.abs(dx) > 4) moved = true
      if (!moved) return
      target = targetFor(dx)
      setDrag({ index, dx, target })
    }, () => {
      setDrag(null)
      if (moved && target !== index) onReorder(index, target)
    })
  }
  const startTrim = (e: React.PointerEvent, shot: Shot, edge: 'in' | 'out') => {
    if (disabled) return
    e.stopPropagation(); e.preventDefault()
    onSelect(shot.id)
    const clip = shot.clip_dur ?? 0
    const base = { in: shot.trim_in ?? 0, out: shot.trim_out ?? clip }
    const startX = e.clientX
    let latest = { ...base }
    track((ev) => {
      const delta = (ev.clientX - startX) / zoom
      latest = edge === 'in'
        ? { in: Math.max(0, Math.min(base.in + delta, base.out - MIN_CLIP)), out: base.out }
        : { in: base.in, out: Math.min(clip + MAX_HOLD, Math.max(base.out + delta, base.in + MIN_CLIP)) }
      setTrim({ id: shot.id, trimIn: latest.in, trimOut: latest.out })
    }, () => {
      setTrim(null)
      if (latest.in !== base.in || latest.out !== base.out) onEdit(shot.id, { trim_in: +latest.in.toFixed(2), trim_out: +latest.out.toFixed(2) })
    })
  }

  // ── voice-over track ──
  const snap = (abs: number, self: string) => {
    const points = [0, ...segments.filter((s) => s.shot.id !== self).flatMap((s) => [s.start, s.start + s.duration])]
    const hit = points.find((p) => Math.abs(p - abs) < SNAP)
    return hit ?? abs
  }
  const startVoiceMove = (e: React.PointerEvent, seg: Segment) => {
    if (disabled || e.button !== 0) return
    e.stopPropagation()
    const shot = seg.shot
    onSelect(shot.id)
    const startX = e.clientX
    let abs = seg.audioAbs
    let moved = false
    track((ev) => {
      moved = true
      abs = snap(Math.max(0, seg.audioAbs + (ev.clientX - startX) / zoom), shot.id)
      setVoice({ id: shot.id, abs, len: seg.audioLen })
    }, () => {
      setVoice(null)
      if (moved) onEdit(shot.id, { audio_offset: +(abs - seg.start).toFixed(2) })
    })
  }
  const startVoiceTrim = (e: React.PointerEvent, seg: Segment, edge: 'in' | 'out') => {
    if (disabled) return
    e.stopPropagation(); e.preventDefault()
    const shot = seg.shot
    onSelect(shot.id)
    const full = shot.audio_dur ?? 0
    const base = { in: shot.audio_in ?? 0, out: shot.audio_out ?? full }
    const startX = e.clientX
    let next = { ...base }
    track((ev) => {
      const delta = (ev.clientX - startX) / zoom
      next = edge === 'in'
        ? { in: Math.max(0, Math.min(base.in + delta, base.out - MIN_CLIP)), out: base.out }
        : { in: base.in, out: Math.min(full, Math.max(base.out + delta, base.in + MIN_CLIP)) }
      setVoice({ id: shot.id, abs: seg.audioAbs + (next.in - base.in), len: next.out - next.in })
    }, () => {
      setVoice(null)
      if (next.in === base.in && next.out === base.out) return
      // trimming the head keeps the rest of the voice where it was: the start moves with it
      onEdit(shot.id, { audio_in: +next.in.toFixed(2), audio_out: +next.out.toFixed(2),
        audio_offset: +(seg.audioAbs + (next.in - base.in) - seg.start).toFixed(2) })
    })
  }

  const ticks: number[] = []
  const step = zoom >= 80 ? 1 : zoom >= 40 ? 2 : zoom >= 20 ? 5 : 10
  for (let t = 0; t <= total + step; t += step) ticks.push(t)
  const videoTop = RULER_H
  const audioTop = RULER_H + TRACK_H + 10

  return (
    <div ref={scroller} className="relative overflow-x-auto overflow-y-hidden rounded-[var(--control-radius)] bg-[var(--ds-surface-muted)]">
      <div className="relative select-none" style={{ width: width + LABEL_W, height: audioTop + AUDIO_H + 8 }}>
        <div className="absolute inset-x-0 top-0 cursor-col-resize" style={{ height: RULER_H }} onPointerDown={scrub} onPointerMove={(e) => e.buttons === 1 && seekFromEvent(e)}>
          {ticks.map((t) => (
            <span key={t} className="absolute top-0 h-full border-l border-[var(--border-subtle)] pl-1 text-[10px] leading-[26px] text-[var(--text-muted)]"
              style={{ left: LABEL_W + t * zoom }}>{fmtTime(t).slice(0, -2)}</span>
          ))}
        </div>

        <span className="absolute flex w-[40px] items-center justify-center text-[var(--text-muted)]" style={{ top: videoTop, height: TRACK_H }} title="Video"><Film className="h-4 w-4" /></span>
        <span className="absolute flex w-[40px] items-center justify-center text-[var(--text-muted)]" style={{ top: audioTop, height: AUDIO_H }} title="Voce"><Mic className="h-4 w-4" /></span>

        {/* video track */}
        {drag && (() => {
          const slot = view.find((v) => v.shot.id === segments[drag.index].shot.id)
          return slot ? <div className="pointer-events-none absolute rounded-[var(--control-radius)] bg-[color-mix(in_srgb,var(--logo-violet)_16%,transparent)]"
            style={{ left: LABEL_W + slot.start * zoom, top: videoTop, width: Math.max(slot.duration * zoom, 28), height: TRACK_H, transition: 'left 140ms ease-out' }} /> : null
        })()}
        {segments.map((orig, i) => {
          const shot = orig.shot
          const seg = view.find((v) => v.shot.id === shot.id) ?? orig
          const dragging = drag?.index === i
          const dur = seg.duration
          const left = dragging ? Math.max(LABEL_W, LABEL_W + orig.start * zoom + drag.dx) : LABEL_W + seg.start * zoom
          const failed = shot.status === 'failed'
          return (
            <div key={shot.id} onPointerDown={(e) => startMove(e, i)}
              className={`absolute overflow-hidden rounded-[var(--control-radius)] ${selectedId === shot.id ? 'ds-selected' : 'ds-control'} ${disabled ? '' : 'cursor-grab active:cursor-grabbing'}`}
              style={{ left, top: videoTop, width: Math.max(dur * zoom, 28), height: TRACK_H, zIndex: dragging ? 8 : i + 1, opacity: dragging ? 0.9 : 1, boxShadow: dragging ? '0 8px 22px rgba(0,0,0,.28)' : undefined, transition: drag && !dragging ? 'left 140ms ease-out' : undefined }}>
              {shot.keyframe_key && (
                <div className="pointer-events-none absolute inset-0 flex">
                  {Array.from({ length: Math.max(1, Math.ceil((dur * zoom) / (TRACK_H * 1.6))) }).map((_, k) => (
                    <AuthMedia key={k} projectId={projectId} name={mediaName(shot.keyframe_key)} kind="img" version={String(shot.keyframe_ver || '')} className="h-full shrink-0 object-cover" />
                  ))}
                </div>
              )}
              <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-center gap-1 bg-gradient-to-t from-black/70 to-transparent px-2 pb-1 pt-4">
                {!shot.video_key && !failed && shot.status === 'rendering' ? <Loader2 className="h-3 w-3 animate-spin text-white" /> : null}
                <span className="truncate text-[11px] font-semibold text-white">{shot.n}. {shot.title}</span>
              </div>
              {!shot.video_key && <span className="pointer-events-none absolute right-1 top-1 rounded-md bg-black/55 px-1.5 text-[10px] font-semibold text-white">{failed ? 'errore' : 'solo immagine'}</span>}
              {shot.video_key && !disabled && (
                <>
                  <span onPointerDown={(e) => startTrim(e, shot, 'in')} title="Taglia inizio" className="absolute inset-y-0 left-0 cursor-ew-resize bg-[var(--logo-violet)]/70 hover:bg-[var(--logo-violet)]" style={{ width: HANDLE }} />
                  <span onPointerDown={(e) => startTrim(e, shot, 'out')} title="Taglia o allunga (ultimo fotogramma fermo)" className="absolute inset-y-0 right-0 cursor-ew-resize bg-[var(--logo-violet)]/70 hover:bg-[var(--logo-violet)]" style={{ width: HANDLE }} />
                </>
              )}
            </div>
          )
        })}

        {/* transition buttons on the junctions */}
        {view.map((seg, i) => {
          if (i === 0 || drag) return null
          const set = seg.shot.transition && seg.shot.transition !== 'none'
          return (
            <button key={`j-${seg.shot.id}`} type="button" disabled={disabled} title="Transizione"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => onJunction(i, (e.currentTarget as HTMLElement).getBoundingClientRect())}
              className={`absolute z-[20] flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold shadow-sm ${set ? 'bg-[var(--logo-pink)] text-white' : 'ds-control text-[var(--text-secondary)]'}`}
              style={{ left: LABEL_W + seg.start * zoom - 10, top: videoTop + TRACK_H / 2 - 10 }}>{set ? '◆' : '+'}</button>
          )
        })}

        {/* voice-over track */}
        {view.map((seg) => {
          const shot = seg.shot
          if (!shot.narration?.trim()) return null
          if (!shot.audio_key) {
            return (
              <button key={`a-${shot.id}`} type="button" onClick={() => onSelect(shot.id)} title={shot.narration}
                className="ds-control absolute truncate rounded-[var(--control-radius)] px-2 text-left text-[11px] font-medium text-[var(--text-muted)]"
                style={{ left: LABEL_W + seg.start * zoom, top: audioTop, width: Math.max(seg.duration * zoom, 28), height: AUDIO_H }}>
                {shot.narration} ({'voce da generare'})
              </button>
            )
          }
          const live = voice?.id === shot.id ? voice : null
          const abs = live ? live.abs : seg.audioAbs
          const len = live ? live.len : seg.audioLen
          return (
            <div key={`a-${shot.id}`} onPointerDown={(e) => startVoiceMove(e, seg)} title={shot.narration}
              className={`absolute overflow-hidden rounded-[var(--control-radius)] bg-[color-mix(in_srgb,var(--logo-violet)_24%,transparent)] ${selectedId === shot.id ? 'ds-selected' : ''} ${disabled ? '' : 'cursor-grab active:cursor-grabbing'}`}
              style={{ left: LABEL_W + abs * zoom, top: audioTop, width: Math.max(len * zoom, 24), height: AUDIO_H }}>
              <span className="pointer-events-none block truncate px-3 text-[11px] font-medium leading-[30px] text-[var(--text-primary)]">{shot.narration}</span>
              {!disabled && (
                <>
                  <span onPointerDown={(e) => startVoiceTrim(e, seg, 'in')} title="Taglia inizio voce" className="absolute inset-y-0 left-0 cursor-ew-resize bg-[var(--logo-violet)]/70 hover:bg-[var(--logo-violet)]" style={{ width: 6 }} />
                  <span onPointerDown={(e) => startVoiceTrim(e, seg, 'out')} title="Taglia fine voce" className="absolute inset-y-0 right-0 cursor-ew-resize bg-[var(--logo-violet)]/70 hover:bg-[var(--logo-violet)]" style={{ width: 6 }} />
                </>
              )}
            </div>
          )
        })}

        {/* playhead */}
        <div className="pointer-events-none absolute bottom-0 top-0 z-[30] w-px bg-[var(--logo-pink)]" style={{ left: LABEL_W + time * zoom }}>
          <span className="absolute -left-[5px] top-0 h-3 w-[11px] rounded-b-md bg-[var(--logo-pink)]" />
        </div>
      </div>
    </div>
  )
}
