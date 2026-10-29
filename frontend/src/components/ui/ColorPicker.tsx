import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { tl } from '@/i18n/tl'

/** In-app colour picker (replaces the OS-native <input type="color"> dialog): saturation/value
 * square, hue bar, HEX field, a curated palette, the colours already used in the document and the
 * user's recent colours. A drag previews live inside the popover and commits once on release, so
 * the document's undo history gets one step per choice instead of one per mouse move. */

const PALETTE = [
  ['#000000', '#262626', '#525252', '#737373', '#A3A3A3', '#D4D4D4', '#E5E5E5', '#FFFFFF'],
  ['#7F1D1D', '#B91C1C', '#EF4444', '#F87171', '#FCA5A5', '#FEE2E2'],
  ['#7C2D12', '#C2410C', '#F97316', '#FB923C', '#FDBA74', '#FFEDD5'],
  ['#713F12', '#A16207', '#EAB308', '#FACC15', '#FDE047', '#FEF9C3'],
  ['#14532D', '#15803D', '#22C55E', '#4ADE80', '#86EFAC', '#DCFCE7'],
  ['#134E4A', '#0F766E', '#14B8A6', '#2DD4BF', '#5EEAD4', '#CCFBF1'],
  ['#1E3A8A', '#1D4ED8', '#3B82F6', '#60A5FA', '#93C5FD', '#DBEAFE'],
  ['#312E81', '#4338CA', '#6366F1', '#818CF8', '#A5B4FC', '#E0E7FF'],
  ['#581C87', '#7E22CE', '#A855F7', '#C084FC', '#D8B4FE', '#F3E8FF'],
  ['#831843', '#BE185D', '#EC4899', '#F472B6', '#F9A8D4', '#FCE7F3'],
]
const RECENT_KEY = 'golinelli-recent-colors'

type Hsv = { h: number; s: number; v: number }

function hexToRgb(hex: string): [number, number, number] | null {
  const raw = hex.trim().replace(/^#/, '')
  const full = raw.length === 3 ? raw.split('').map(c => c + c).join('') : raw.slice(0, 6)
  if (!/^[0-9a-fA-F]{6}$/.test(full)) return null
  return [parseInt(full.slice(0, 2), 16), parseInt(full.slice(2, 4), 16), parseInt(full.slice(4, 6), 16)]
}
const toHex = (r: number, g: number, b: number) => '#' + [r, g, b].map(v => Math.round(v).toString(16).padStart(2, '0')).join('').toUpperCase()

function rgbToHsv(r: number, g: number, b: number): Hsv {
  r /= 255; g /= 255; b /= 255
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min
  let h = 0
  if (d) h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4
  return { h: (h * 60 + 360) % 360, s: max ? d / max : 0, v: max }
}
function hsvToHex({ h, s, v }: Hsv): string {
  const c = v * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = v - c
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x]
  return toHex((r + m) * 255, (g + m) * 255, (b + m) * 255)
}
export function normalizeHex(value?: string | null): string | null {
  if (!value) return null
  if (value.startsWith('#')) { const rgb = hexToRgb(value); return rgb ? toHex(...rgb) : null }
  const match = /rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i.exec(value)
  return match ? toHex(+match[1], +match[2], +match[3]) : null
}

function readRecent(): string[] {
  try { return JSON.parse(window.localStorage.getItem(RECENT_KEY) || '[]').filter((c: unknown) => typeof c === 'string').slice(0, 8) } catch { return [] }
}
function pushRecent(color: string) {
  try { window.localStorage.setItem(RECENT_KEY, JSON.stringify([color, ...readRecent().filter(c => c !== color)].slice(0, 8))) } catch { /* storage unavailable */ }
}

type Props = {
  value?: string | null
  onChange: (color: string) => void
  title: string
  /** Colours already used in the document, shown first. */
  documentColors?: string[]
  allowTransparent?: boolean
  /** Small glyph drawn on the swatch button (e.g. "A" for text colour). */
  glyph?: string
  className?: string
  disabled?: boolean
}

export function ColorPicker({ value, onChange, title, documentColors = [], allowTransparent, glyph, className = '', disabled }: Props) {
  const [open, setOpen] = useState(false)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const isTransparent = !value || value === 'transparent'
  const current = normalizeHex(value) || '#FFFFFF'

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        title={title}
        aria-label={title}
        aria-haspopup="dialog"
        aria-expanded={open}
        disabled={disabled}
        onMouseDown={(event) => event.preventDefault() /* keep the text selection in the slide */}
        onClick={() => setOpen(value => !value)}
        className={`relative flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-slate-200 bg-white hover:border-slate-300 disabled:cursor-not-allowed disabled:opacity-40 ${className}`}
      >
        {glyph ? (
          <span className="flex flex-col items-center leading-none">
            <span className="text-[13px] font-bold text-slate-700">{glyph}</span>
            <span className="mt-0.5 h-1 w-5 rounded-sm border border-slate-200" style={{ background: isTransparent ? 'transparent' : current }} />
          </span>
        ) : (
          <span className="h-5 w-5 rounded border border-slate-300" style={isTransparent ? CHECKER : { background: current }} />
        )}
      </button>
      {open && (
        <ColorPopover
          anchor={buttonRef.current}
          value={isTransparent ? null : current}
          documentColors={documentColors}
          allowTransparent={allowTransparent}
          onClose={() => setOpen(false)}
          onCommit={(color) => { if (color !== 'transparent') pushRecent(color); onChange(color) }}
        />
      )}
    </>
  )
}

const CHECKER = {
  backgroundImage: 'linear-gradient(45deg,#cbd5e1 25%,transparent 25%),linear-gradient(-45deg,#cbd5e1 25%,transparent 25%),linear-gradient(45deg,transparent 75%,#cbd5e1 75%),linear-gradient(-45deg,transparent 75%,#cbd5e1 75%)',
  backgroundSize: '8px 8px',
  backgroundPosition: '0 0,0 4px,4px -4px,-4px 0',
}

function ColorPopover({ anchor, value, documentColors, allowTransparent, onClose, onCommit }: {
  anchor: HTMLElement | null
  value: string | null
  documentColors: string[]
  allowTransparent?: boolean
  onClose: () => void
  onCommit: (color: string) => void
}) {
  const popoverRef = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState({ left: 0, top: 0 })
  const [hsv, setHsv] = useState<Hsv>(() => { const rgb = hexToRgb(value || '#3B82F6')!; return rgbToHsv(...rgb) })
  const [hexDraft, setHexDraft] = useState(value || '')
  const [recent] = useState(readRecent)
  const preview = hsvToHex(hsv)

  useLayoutEffect(() => {
    if (!anchor) return
    const rect = anchor.getBoundingClientRect()
    const width = 248, height = 380
    setPosition({
      left: Math.max(8, Math.min(rect.left, window.innerWidth - width - 8)),
      top: rect.bottom + 6 + height > window.innerHeight ? Math.max(8, rect.top - height - 6) : rect.bottom + 6,
    })
  }, [anchor])

  useEffect(() => {
    const onDown = (event: PointerEvent) => {
      if (!popoverRef.current?.contains(event.target as Node) && !anchor?.contains(event.target as Node)) onClose()
    }
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.stopPropagation(); onClose() } }
    window.addEventListener('pointerdown', onDown, true)
    window.addEventListener('keydown', onKey, true)
    return () => { window.removeEventListener('pointerdown', onDown, true); window.removeEventListener('keydown', onKey, true) }
  }, [anchor, onClose])

  const commit = useCallback((color: string) => { setHexDraft(color); onCommit(color) }, [onCommit])

  const dragArea = (kind: 'sv' | 'hue') => (event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault()
    const target = event.currentTarget
    target.setPointerCapture(event.pointerId)
    let latest = hsv
    const update = (clientX: number, clientY: number) => {
      const rect = target.getBoundingClientRect()
      const x = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width))
      const y = Math.min(1, Math.max(0, (clientY - rect.top) / rect.height))
      latest = kind === 'sv' ? { ...latest, s: x, v: 1 - y } : { ...latest, h: x * 360 }
      setHsv(latest)
      setHexDraft(hsvToHex(latest))
    }
    update(event.clientX, event.clientY)
    const move = (e: PointerEvent) => update(e.clientX, e.clientY)
    const up = () => {
      target.removeEventListener('pointermove', move)
      target.removeEventListener('pointerup', up)
      onCommit(hsvToHex(latest))
    }
    target.addEventListener('pointermove', move)
    target.addEventListener('pointerup', up)
  }

  const pick = (color: string) => {
    const rgb = hexToRgb(color)
    if (rgb) setHsv(rgbToHsv(...rgb))
    commit(color)
  }

  const swatch = (color: string, key: string) => (
    <button key={key} type="button" title={color} onMouseDown={(e) => e.preventDefault()} onClick={() => pick(color)}
      className={`h-5 w-5 rounded border ${preview === color ? 'border-slate-900 ring-2 ring-blue-400' : 'border-slate-200'} hover:scale-110`}
      style={{ background: color }} />
  )

  return createPortal(
    <div ref={popoverRef} role="dialog" aria-label={tl("Scegli un colore")} onMouseDown={(e) => {
        // Popover lives in a portal: keep host menus that close on outside mousedown open, and keep
        // the editor's text selection (no focus change) unless the HEX field is clicked.
        e.stopPropagation()
        if ((e.target as HTMLElement).tagName !== 'INPUT') e.preventDefault()
      }}
      className="fixed z-[200] w-[248px] rounded-xl border border-slate-200 bg-white p-3 shadow-2xl" style={position}>
      <div className="relative h-36 w-full cursor-crosshair touch-none rounded-lg" onPointerDown={dragArea('sv')}
        style={{ background: `linear-gradient(to top,#000,transparent),linear-gradient(to right,#fff,hsl(${hsv.h},100%,50%))` }}>
        <span className="pointer-events-none absolute h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow ring-1 ring-black/30"
          style={{ left: `${hsv.s * 100}%`, top: `${(1 - hsv.v) * 100}%`, background: preview }} />
      </div>
      <div className="relative mt-2.5 h-3 w-full cursor-pointer touch-none rounded-full" onPointerDown={dragArea('hue')}
        style={{ background: 'linear-gradient(to right,#f00,#ff0,#0f0,#0ff,#00f,#f0f,#f00)' }}>
        <span className="pointer-events-none absolute top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow ring-1 ring-black/30"
          style={{ left: `${(hsv.h / 360) * 100}%`, background: `hsl(${hsv.h},100%,50%)` }} />
      </div>
      <div className="mt-2.5 flex items-center gap-2">
        <span className="h-7 w-7 shrink-0 rounded-md border border-slate-200" style={{ background: preview }} />
        <input
          value={hexDraft}
          onChange={(event) => setHexDraft(event.target.value)}
          onKeyDown={(event) => { if (event.key === 'Enter') { const hex = normalizeHex(hexDraft.startsWith('#') ? hexDraft : `#${hexDraft}`); if (hex) pick(hex) } }}
          onBlur={() => { const hex = normalizeHex(hexDraft.startsWith('#') ? hexDraft : `#${hexDraft}`); if (hex && hex !== value) pick(hex) }}
          aria-label={tl("Codice HEX")}
          className="h-7 min-w-0 flex-1 rounded-md border border-slate-200 px-2 font-mono text-xs uppercase focus:border-blue-400 focus:outline-none"
        />
        {allowTransparent && (
          <button type="button" title={tl("Nessun colore")} onMouseDown={(e) => e.preventDefault()} onClick={() => { onCommit('transparent'); onClose() }}
            className="h-7 w-7 shrink-0 rounded-md border border-slate-200" style={CHECKER} />
        )}
      </div>
      {documentColors.length > 0 && (
        <>
          <p className="mt-3 text-[10px] font-bold uppercase tracking-wide text-slate-400">{tl("Nel documento")}</p>
          <div className="mt-1 flex flex-wrap gap-1">{documentColors.slice(0, 16).map((c, i) => swatch(c, `d${i}`))}</div>
        </>
      )}
      {recent.length > 0 && (
        <>
          <p className="mt-2.5 text-[10px] font-bold uppercase tracking-wide text-slate-400">{tl("Recenti")}</p>
          <div className="mt-1 flex flex-wrap gap-1">{recent.map((c, i) => swatch(c, `r${i}`))}</div>
        </>
      )}
      <p className="mt-2.5 text-[10px] font-bold uppercase tracking-wide text-slate-400">Palette</p>
      <div className="mt-1 space-y-1">
        {PALETTE.map((row, r) => <div key={r} className="flex gap-1">{row.map((c, i) => swatch(c, `p${r}-${i}`))}</div>)}
      </div>
    </div>,
    document.body,
  )
}

/** Distinct colours used across a deck's blocks, most frequent first (for the "Nel documento" row). */
export function collectDocumentColors(blocks: { style?: Record<string, unknown> }[]): string[] {
  const counts = new Map<string, number>()
  for (const block of blocks) {
    for (const key of ['color', 'fill', 'stroke', 'backgroundColor']) {
      const hex = normalizeHex(block.style?.[key] as string | undefined)
      if (hex) counts.set(hex, (counts.get(hex) || 0) + 1)
    }
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([color]) => color).slice(0, 16)
}
