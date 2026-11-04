import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Shot } from './types'

const STILL_SECONDS = 3 // a shot without a clip yet shows its still image for this long

export interface Segment {
  shot: Shot
  start: number       // where the clip starts on the output timeline
  duration: number    // clip length incl. the hold needed by its voice-over
  clipLen: number     // trimmed footage length
  overlap: number     // seconds shared with the previous clip (transition)
  audioAbs: number    // where its voice-over starts on the output timeline
  audioLen: number    // trimmed voice-over length (0 = none)
}

/** Where every clip and voice-over sits on the output timeline. Mirrors `layout()` in services/video_studio.py: keep in sync. */
export function layoutShots(shots: Shot[]): Segment[] {
  const out: Segment[] = []
  let prevEnd = 0, prevAudioEnd = 0, prevDur = 0
  shots.forEach((shot, i) => {
    const clipLen = shot.video_key ? Math.max(0.2, (shot.trim_out ?? shot.clip_dur ?? 0) - (shot.trim_in ?? 0)) : STILL_SECONDS
    const audioLen = shot.audio_key ? Math.max(0.2, (shot.audio_out ?? shot.audio_dur ?? 0) - (shot.audio_in ?? 0)) : 0
    const overlap = i && shot.transition && shot.transition !== 'none'
      ? Math.max(0.2, Math.min(shot.transition_dur ?? 0.6, prevDur * 0.9, clipLen * 0.9)) : 0
    const start = i ? prevEnd - overlap : 0
    const audioAbs = shot.audio_offset != null ? Math.max(0, start + shot.audio_offset) : Math.max(start, prevAudioEnd)
    const duration = Math.max(clipLen, audioLen ? audioAbs - start + audioLen : 0)
    out.push({ shot, start, duration, clipLen, overlap, audioAbs, audioLen })
    prevEnd = start + duration
    prevDur = duration
    if (audioLen) prevAudioEnd = audioAbs + audioLen
  })
  return out
}

/** Timeline clock for the monitor. */
export function usePlayback(shots: Shot[]) {
  const segments = useMemo(() => layoutShots(shots), [shots])
  const total = segments.reduce((m, s) => Math.max(m, s.start + s.duration, s.audioAbs + s.audioLen), 0)

  const [time, setTime] = useState(0)
  const [playing, setPlaying] = useState(false)
  const timeRef = useRef(0)
  const totalRef = useRef(total)
  totalRef.current = total

  const seek = useCallback((t: number) => {
    const clamped = Math.max(0, Math.min(t, totalRef.current))
    timeRef.current = clamped
    setTime(clamped)
  }, [])

  useEffect(() => {
    if (!playing) return
    let raf = 0
    let last = performance.now()
    let lastPaint = 0
    const tick = (now: number) => {
      timeRef.current += (now - last) / 1000
      last = now
      if (timeRef.current >= totalRef.current) {
        timeRef.current = totalRef.current
        setTime(totalRef.current)
        setPlaying(false)
        return
      }
      if (now - lastPaint > 33) { lastPaint = now; setTime(timeRef.current) }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [playing])

  const toggle = useCallback(() => {
    setPlaying((p) => {
      if (!p && timeRef.current >= totalRef.current - 0.05) { timeRef.current = 0; setTime(0) }
      return !p
    })
  }, [])

  // the clip on top at this instant: the latest one that has started and not finished
  let index = -1
  segments.forEach((s, i) => { if (time >= s.start - 1e-6 && time < s.start + s.duration - 1e-6) index = i })
  if (index < 0) index = Math.max(0, segments.findIndex((s) => time < s.start))
  if (index < 0 || (time >= total && segments.length)) index = segments.length - 1
  const current = segments[index]
  return { segments, total, time, playing, seek, toggle, pause: () => setPlaying(false), play: () => setPlaying(true), current }
}
