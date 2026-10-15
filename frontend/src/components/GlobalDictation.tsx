/**
 * GlobalDictation — Whisper dictation for every free-text field of the app.
 *
 * Shows the same VoiceRecorder used by the chatbots (record → transcribe → review → insert) as a small mic anchored
 * to the text field that has the focus. Fields that already ship their own mic, code editors and short/technical
 * inputs are skipped; a field can opt out with `data-no-dictation`.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { VoiceRecorder } from '@/components/VoiceRecorder'

type Field = HTMLInputElement | HTMLTextAreaElement
type Box = { top: number; right: number }

const TEXT_INPUT_TYPES = new Set(['', 'text', 'search'])
const MIC_SIZE = 32
const MIN_WIDTH = 140

const isLoggedIn = () => {
  try {
    if (localStorage.getItem('student_token')) return true
    const state = JSON.parse(localStorage.getItem('eduai-auth') || 'null')?.state
    return Boolean(state?.user && state?.accessToken)
  } catch { return false }
}

const eligible = (node: EventTarget | null): node is Field => {
  if (!(node instanceof HTMLTextAreaElement || node instanceof HTMLInputElement)) return false
  if (node instanceof HTMLInputElement && !TEXT_INPUT_TYPES.has(node.type)) return false
  if (node.readOnly || node.disabled || node.closest('[data-no-dictation]')) return false
  if (node.closest('.monaco-editor, .cm-editor, .xterm, .cm-content')) return false
  if (node.getAttribute('role') === 'combobox' || node.getAttribute('aria-autocomplete')) return false
  const ac = (node.getAttribute('autocomplete') || '').toLowerCase()
  if (/password|username|email|otp|cc-|tel/.test(ac)) return false
  const rect = node.getBoundingClientRect()
  if (rect.width < MIN_WIDTH || rect.height < 24 || rect.height > window.innerHeight) return false
  // Already has its own microphone (chatbot composers): don't stack a second one.
  let scope: HTMLElement | null = node.parentElement
  for (let depth = 0; scope && depth < 4; depth += 1, scope = scope.parentElement) {
    if (scope.querySelector('[data-voice-recorder]')) return false
  }
  return true
}

const insertAtCursor = (field: Field, text: string) => {
  const start = field.selectionStart ?? field.value.length
  const end = field.selectionEnd ?? start
  const before = field.value.slice(0, start)
  const after = field.value.slice(end)
  const spacer = before && !/\s$/.test(before) ? ' ' : ''
  const proto = field instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
  // React tracks the value through the native setter: going through it makes controlled inputs see the change.
  Object.getOwnPropertyDescriptor(proto, 'value')?.set?.call(field, `${before}${spacer}${text}${after}`)
  const caret = (before + spacer + text).length
  try { field.setSelectionRange(caret, caret) } catch { /* some input types have no selection */ }
  field.dispatchEvent(new Event('input', { bubbles: true }))
}

export function GlobalDictation() {
  const [target, setTarget] = useState<Field | null>(null)
  const [box, setBox] = useState<Box | null>(null)
  const lockedRef = useRef<Field | null>(null)
  const busyRef = useRef(false)
  const rootRef = useRef<HTMLDivElement>(null)

  const place = useCallback((field: Field | null) => {
    if (!field || !field.isConnected) { setBox(null); return }
    const rect = field.getBoundingClientRect()
    if (rect.bottom < 0 || rect.top > window.innerHeight) { setBox(null); return }
    const multiline = field instanceof HTMLTextAreaElement && rect.height > 56
    setBox({
      // Anchored by its right edge: while recording the widget grows (waveform, timer, stop, cancel) and must
      // expand leftwards inside the field instead of spilling out of it.
      right: Math.max(4, Math.min(window.innerWidth - rect.right + 6, window.innerWidth - MIC_SIZE - 4)),
      top: multiline ? rect.bottom - MIC_SIZE - 6 : rect.top + (rect.height - MIC_SIZE) / 2,
    })
  }, [])

  useEffect(() => {
    let hideTimer = 0
    const onFocusIn = (event: FocusEvent) => {
      window.clearTimeout(hideTimer)
      if (rootRef.current?.contains(event.target as Node)) return
      if (busyRef.current) return
      if (isLoggedIn() && eligible(event.target)) setTarget(event.target)
      else setTarget(null)
    }
    const onFocusOut = () => {
      window.clearTimeout(hideTimer)
      hideTimer = window.setTimeout(() => {
        if (busyRef.current) return
        const active = document.activeElement
        if (active && (rootRef.current?.contains(active) || eligible(active))) return
        setTarget(null)
      }, 180)
    }
    document.addEventListener('focusin', onFocusIn)
    document.addEventListener('focusout', onFocusOut)
    return () => { window.clearTimeout(hideTimer); document.removeEventListener('focusin', onFocusIn); document.removeEventListener('focusout', onFocusOut) }
  }, [])

  useEffect(() => {
    place(target)
    if (!target) return
    let frame = 0
    const update = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(() => place(target)) }
    window.addEventListener('scroll', update, true)
    window.addEventListener('resize', update)
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(update) : null
    observer?.observe(target)
    const poll = window.setInterval(update, 500) // layout moves that fire no event (animations, sibling changes)
    return () => { cancelAnimationFrame(frame); window.clearInterval(poll); observer?.disconnect(); window.removeEventListener('scroll', update, true); window.removeEventListener('resize', update) }
  }, [target, place])

  if (!target || !box) return null
  return createPortal(
    <div
      ref={rootRef}
      style={{ position: 'fixed', top: box.top, right: box.right, zIndex: 2000 }}
      // Keep the text field focused (and its caret) while the mic buttons are used.
      onMouseDown={(event) => { lockedRef.current = target; if ((event.target as HTMLElement).closest('button')) event.preventDefault() }}
    >
      <VoiceRecorder
        compact
        onStateChange={(state) => { busyRef.current = state !== 'idle' }}
        onInsertText={(text) => {
          const field = lockedRef.current || target
          if (!field?.isConnected) return
          field.focus()
          insertAtCursor(field, text)
        }}
      />
    </div>,
    document.body,
  )
}
