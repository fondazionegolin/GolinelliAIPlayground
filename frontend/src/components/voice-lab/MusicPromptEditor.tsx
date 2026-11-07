import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import CodeMirror, { type ReactCodeMirrorRef } from '@uiw/react-codemirror'
import { EditorState } from '@codemirror/state'
import { Decoration, EditorView, keymap } from '@codemirror/view'
import { Button } from '@/design'
import { musicCategories, musicSuggestions, parseMusicPrompt, type MusicToken } from '@/lib/musicPrompt'
import { tl } from '@/i18n/tl'
import './music-prompt.css'

export function MusicPromptEditor({ value, onChange, disabled = false, compact = false }: {
  value: string; onChange: (value: string) => void; disabled?: boolean; compact?: boolean
}) {
  const id = useId(), editor = useRef<ReactCodeMirrorRef>(null), menu = useRef<HTMLDivElement>(null)
  const [active, setActive] = useState<MusicToken | null>(null)
  const [position, setPosition] = useState<{ top: number; left: number; maxHeight: number; width: number } | null>(null)
  const tokens = useMemo(() => parseMusicPrompt(value), [value])
  const options = active ? musicSuggestions(active, tokens) : []
  const extensions = useMemo(() => [
    EditorView.lineWrapping,
    EditorView.contentAttributes.of({ 'aria-label': tl('Descrizione musicale'), 'aria-describedby': `${id}-hint`, 'aria-multiline': 'true' }),
    EditorState.transactionFilter.of(tr => tr.newDoc.length > 4100 && tr.newDoc.length >= tr.startState.doc.length ? [] : tr),
    EditorView.decorations.compute(['doc'], state => Decoration.set(parseMusicPrompt(state.doc.toString()).map(token => Decoration.mark({
      class: `music-term music-term-${token.category}`, attributes: { title: tl('{0}: alternative', tl(musicCategories[token.category])), 'data-music-term': 'true' },
    }).range(token.from, token.to)))),
    EditorView.domEventHandlers({ click(event, view) {
      if (disabled) return false
      const el = event.target instanceof Element ? event.target.closest('[data-music-term]') : null
      const pos = el ? view.posAtDOM(el) : null
      setActive(pos === null ? null : parseMusicPrompt(view.state.doc.toString()).find(t => pos >= t.from && pos < t.to) || null)
      return false
    } }),
    keymap.of([{ key: 'Alt-ArrowDown', run: view => {
      if (disabled) return false
      const pos = view.state.selection.main.head
      const token = parseMusicPrompt(view.state.doc.toString()).find(t => pos >= t.from && pos <= t.to)
      setActive(token || null)
      return !!token
    } }]),
  ], [disabled, id])
  useLayoutEffect(() => {
    if (!active || disabled) { setPosition(null); return }
    const place = () => {
      const view = editor.current?.view, rect = view?.coordsAtPos(active.from)
      const bounds = view?.scrollDOM.getBoundingClientRect()
      if (!rect || !bounds || rect.bottom < bounds.top || rect.top > bounds.bottom || rect.bottom < 0 || rect.top > window.innerHeight) { setActive(null); return }
      const width = Math.min(220, window.innerWidth - 24)
      const below = window.innerHeight - rect.bottom - 16, above = rect.top - 16
      const upward = below < 140 && above > below
      const maxHeight = Math.min(288, Math.max(72, upward ? above : below))
      setPosition({ left: Math.max(12, Math.min(rect.left, window.innerWidth - width - 12)), top: upward ? Math.max(12, rect.top - maxHeight - 4) : rect.bottom + 4, width, maxHeight })
    }
    place()
    const outside = (e: PointerEvent) => { if (!menu.current?.contains(e.target as Node) && !editor.current?.view?.dom.contains(e.target as Node)) setActive(null) }
    window.addEventListener('resize', place); window.addEventListener('scroll', place, true)
    document.addEventListener('pointerdown', outside)
    return () => { window.removeEventListener('resize', place); window.removeEventListener('scroll', place, true); document.removeEventListener('pointerdown', outside) }
  }, [active, disabled])
  const visible = !!position && !!active && !disabled
  useEffect(() => { if (visible) menu.current?.querySelector<HTMLButtonElement>('[role=option]:not(:disabled)')?.focus({ preventScroll: true }) }, [visible, active])
  const close = () => { setActive(null); editor.current?.view?.focus() }
  const replace = (replacement: string) => {
    const view = editor.current?.view
    if (!view || !active || disabled || view.state.sliceDoc(active.from, active.to) !== active.text || view.state.doc.length - (active.to - active.from) + replacement.length > 4100) return
    view.dispatch({ changes: { from: active.from, to: active.to, insert: replacement }, selection: { anchor: active.from + replacement.length } })
    close()
  }
  return <div className="space-y-2">
    <span className="block text-sm font-semibold">{tl('Descrivi il brano')}</span>
    <CodeMirror ref={editor} value={value} onChange={text => { setActive(null); onChange(text) }} extensions={extensions}
      editable={!disabled} readOnly={disabled} basicSetup={{ lineNumbers: false, foldGutter: false, highlightActiveLine: false, highlightActiveLineGutter: false, autocompletion: false, bracketMatching: false, closeBrackets: false, highlightSelectionMatches: false }}
      className={`music-prompt-editor ${disabled ? 'opacity-50' : ''}`} minHeight={compact ? '88px' : '140px'} maxHeight="240px"
      placeholder={tl('Jazz caldo, pianoforte e contrabbasso, 60 bpm…')} />
    <p id={`${id}-hint`} className="sr-only">{tl('Clicca un termine colorato per le alternative, oppure premi Alt + freccia giù sul termine. Usa le frecce per scegliere ed Esc per chiudere.')}</p>
    {value.length >= 3900 && <p className="text-right text-xs text-[var(--text-secondary)]">{value.length}/4100</p>}
    {visible && position && active && createPortal(<div ref={menu} data-audio-overlay role="listbox" aria-label={tl('Alternative per {0}', active.text)} style={position}
      className="ds-popover fixed z-[260] overflow-y-auto rounded-2xl p-1.5" onKeyDown={e => {
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); return }
        if (e.key === 'Tab') { close(); return }
        if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) return
        e.preventDefault()
        const buttons = Array.from(menu.current?.querySelectorAll<HTMLButtonElement>('[role=option]:not(:disabled)') || [])
        const current = buttons.indexOf(document.activeElement as HTMLButtonElement)
        const next = e.key === 'Home' ? 0 : e.key === 'End' ? buttons.length - 1 : (current + (e.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length
        buttons[next]?.focus()
      }}>
      {options.map(option => <Button key={option} role="option" aria-selected="false" tone="neutral" surface="ghost" density="compact" className="!flex !w-full !justify-start !rounded-xl" disabled={value.length - (active.to - active.from) + option.length > 4100} onClick={() => replace(option)}>{option}</Button>)}
    </div>, document.body)}
  </div>
}
