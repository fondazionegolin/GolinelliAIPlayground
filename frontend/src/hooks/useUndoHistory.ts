import { useCallback, useEffect, useRef, useState } from 'react'

const MAX_STEPS = 100

/**
 * Snapshot undo/redo for an immutable value owned elsewhere (e.g. a deck's `slides` array).
 *
 * Every new value reference is a change; changes arriving in a quick burst (typing, a drag, a
 * resize) are grouped into one step, so a single Ctrl+Z reverts the whole gesture. Values applied by
 * undo/redo themselves are not recorded. `resetKey` clears the history (another document opened).
 */
export function useUndoHistory<T>(
  value: T,
  apply: (next: T) => void,
  { resetKey, groupMs = 450 }: { resetKey: string; groupMs?: number },
) {
  const past = useRef<T[]>([])
  const future = useRef<T[]>([])
  const current = useRef(value)
  const burstStart = useRef<{ value: T } | null>(null)
  const burstTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const applying = useRef<T | null>(null)
  const [, setVersion] = useState(0)
  const bump = () => setVersion((version) => version + 1)

  const commitBurst = useCallback(() => {
    if (burstTimer.current) clearTimeout(burstTimer.current)
    burstTimer.current = null
    if (!burstStart.current) return
    past.current.push(burstStart.current.value)
    if (past.current.length > MAX_STEPS) past.current.shift()
    future.current = []
    burstStart.current = null
    bump()
  }, [])

  useEffect(() => {
    past.current = []
    future.current = []
    burstStart.current = null
    if (burstTimer.current) clearTimeout(burstTimer.current)
    current.current = value
    bump()
    // Only a new document resets history; `value` is read as the fresh baseline.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetKey])

  useEffect(() => {
    if (value === current.current) return
    if (applying.current !== null && value === applying.current) {
      applying.current = null
      current.current = value
      return
    }
    if (!burstStart.current) burstStart.current = { value: current.current }
    current.current = value
    if (burstTimer.current) clearTimeout(burstTimer.current)
    burstTimer.current = setTimeout(commitBurst, groupMs)
  }, [value, groupMs, commitBurst])

  useEffect(() => () => {
    if (burstTimer.current) clearTimeout(burstTimer.current)
  }, [])

  const undo = useCallback(() => {
    commitBurst()
    const previous = past.current.pop()
    if (previous === undefined) return false
    future.current.push(current.current)
    applying.current = previous
    apply(previous)
    bump()
    return true
  }, [apply, commitBurst])

  const redo = useCallback(() => {
    commitBurst()
    const next = future.current.pop()
    if (next === undefined) return false
    past.current.push(current.current)
    applying.current = next
    apply(next)
    bump()
    return true
  }, [apply, commitBurst])

  return {
    undo,
    redo,
    canUndo: past.current.length > 0 || burstStart.current !== null,
    canRedo: future.current.length > 0,
  }
}

/** True when the key event targets a place with its own native undo (text fields, rich text). */
export function isNativeUndoTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  if (target.isContentEditable || target.closest('[contenteditable="true"], .ProseMirror')) return true
  const tag = target.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT'
}
