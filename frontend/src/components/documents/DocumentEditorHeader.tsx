import { useEffect, useRef, useState, type ReactNode } from 'react'
import { ChevronLeft, Download, FileSpreadsheet, FileText, Globe, Loader2, Presentation, RectangleHorizontal, RectangleVertical, Shapes, Ruler } from '@/components/icons'
import { PAGE_SIZE_OPTIONS, type PageSetup } from '@/lib/documentPage'

export type DocumentEditorMode = 'document' | 'slides' | 'sheet' | 'canvas' | 'web' | 'pdf'

const MODE_ICON: Record<DocumentEditorMode, typeof FileText> = {
  document: FileText,
  slides: Presentation,
  sheet: FileSpreadsheet,
  canvas: Shapes,
  web: Globe,
  pdf: FileText,
}

export type DocumentSaveState = 'idle' | 'saving' | 'saved' | 'error'

/**
 * Compact editor header shared by the teacher and student document editors.
 * Priority, left → right: back (icon) · document identity (type, inline title, save state) ·
 * utility tools grouped in one icon cluster · the single primary action with a label.
 */
export function DocumentEditorHeader({
  mode,
  backLabel,
  onBack,
  title,
  onTitleChange,
  titleDisabled = false,
  titlePlaceholder,
  saveState = 'idle',
  saveLabel,
  badges,
  tools,
  primary,
}: {
  mode: DocumentEditorMode
  backLabel: string
  onBack: () => void
  title: string
  onTitleChange: (value: string) => void
  titleDisabled?: boolean
  titlePlaceholder?: string
  saveState?: DocumentSaveState
  saveLabel?: string
  badges?: ReactNode
  tools?: ReactNode
  primary?: ReactNode
}) {
  const ModeIcon = MODE_ICON[mode] ?? FileText
  const dotClass = saveState === 'error'
    ? 'bg-red-500'
    : saveState === 'saving'
      ? 'bg-amber-400 animate-pulse'
      : saveState === 'saved' ? 'bg-emerald-500' : 'bg-slate-300'

  return (
    <div className="relative z-30 flex h-12 shrink-0 items-center gap-2 bg-[var(--ds-surface-raised)] px-2.5 shadow-[inset_0_-1px_0_var(--ds-frame-divider)]">
      <HeaderIconButton label={backLabel} onClick={onBack}>
        <ChevronLeft className="h-4 w-4" />
      </HeaderIconButton>

      <div className="flex min-w-0 flex-1 items-center gap-2">
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-[var(--ds-control)] text-slate-500 shadow-[var(--ds-shadow-inset)]" aria-hidden>
          <ModeIcon className="h-3.5 w-3.5" />
        </span>
        <input
          value={title}
          onChange={(event) => onTitleChange(event.target.value)}
          disabled={titleDisabled}
          placeholder={titlePlaceholder}
          aria-label={titlePlaceholder}
          size={Math.max(8, Math.min(40, (title || titlePlaceholder || '').length + 1))}
          className="min-w-0 max-w-[min(34vw,380px)] truncate rounded-lg bg-transparent px-2 py-1 font-emphasis text-sm font-bold text-slate-900 outline-none transition-colors placeholder:text-slate-400 hover:bg-[var(--ds-control-hover)] focus:bg-[var(--ds-control-hover)] focus:shadow-[var(--ds-shadow-focus)] disabled:hover:bg-transparent"
        />
        {saveLabel && (
          <span className="hidden shrink-0 items-center gap-1.5 text-[11px] font-semibold text-slate-400 lg:inline-flex" aria-live="polite">
            <span className={`h-1.5 w-1.5 rounded-full ${dotClass}`} />
            {saveLabel}
          </span>
        )}
        {badges}
      </div>

      {tools && (
        <div className="flex shrink-0 items-center gap-0.5 rounded-full bg-[var(--ds-control)] p-1 shadow-[var(--ds-shadow-control)]">
          {tools}
        </div>
      )}
      {primary && <div className="flex shrink-0 items-center gap-2 pl-1">{primary}</div>}
    </div>
  )
}

/** Icon-only header tool; the label becomes tooltip + accessible name. */
export function HeaderIconButton({ label, onClick, active = false, disabled = false, children }: {
  label: string
  onClick: () => void
  active?: boolean
  disabled?: boolean
  children: ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
      aria-pressed={active || undefined}
      className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-35 ${active
        ? 'bg-[image:var(--ds-choice-bg)] text-[var(--logo-violet-strong)] shadow-[var(--ds-shadow-1)]'
        : 'text-slate-500 hover:bg-[var(--ds-control-hover)] hover:text-slate-900'}`}
    >
      {children}
    </button>
  )
}

export interface ExportFormatOption<T extends string> {
  value: T
  label: string
}

/** Export tool: icon button opening a small format menu. */
export function HeaderExportMenu<T extends string>({ label, formats, exporting = false, onExport }: {
  label: string
  formats: ExportFormatOption<T>[]
  exporting?: boolean
  onExport: (format: T) => void
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const close = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false)
    }
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', close)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div ref={ref} className="relative">
      <HeaderIconButton label={label} onClick={() => setOpen((value) => !value)} active={open} disabled={exporting}>
        {exporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
      </HeaderIconButton>
      {open && (
        <div role="menu" className="ds-popover absolute right-0 top-full z-50 mt-2 min-w-[190px] rounded-2xl p-1.5">
          <p className="px-2.5 pb-1 pt-1 text-[10px] font-bold uppercase tracking-wider text-slate-400">{label}</p>
          {formats.map((format) => (
            <button
              key={format.value}
              type="button"
              role="menuitem"
              onClick={() => { setOpen(false); onExport(format.value) }}
              className="flex w-full items-center rounded-xl px-2.5 py-2 text-left text-xs font-semibold text-slate-700 transition-colors hover:bg-[var(--ds-control-hover)] hover:text-slate-900"
            >
              {format.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

/** Hairline between groups inside the tools cluster. */
export function HeaderToolDivider() {
  return <span className="mx-0.5 h-4 w-px bg-[var(--ds-frame-divider)]" aria-hidden />
}

/** Page setup tool (paper size + orientation) for text documents. */
export function HeaderPageSetupMenu({ value, onChange, disabled = false }: {
  value: PageSetup
  onChange: (next: PageSetup) => void
  disabled?: boolean
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const close = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [open])

  const option = (active: boolean) =>
    `flex flex-1 items-center justify-center gap-1.5 rounded-xl px-2 py-2 text-xs font-bold transition-colors ${active
      ? 'bg-[image:var(--ds-choice-bg)] text-[var(--ds-choice-ink)] shadow-[var(--ds-shadow-1)]'
      : 'text-slate-500 hover:bg-[var(--ds-control-hover)] hover:text-slate-900'}`

  return (
    <div ref={ref} className="relative">
      <HeaderIconButton label="Impostazione pagina" onClick={() => setOpen((current) => !current)} active={open} disabled={disabled}>
        <Ruler className="h-4 w-4" />
      </HeaderIconButton>
      {open && (
        <div className="ds-popover absolute right-0 top-full z-50 mt-2 w-[220px] space-y-3 rounded-2xl p-3">
          <div>
            <p className="mb-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-400">Formato</p>
            <div className="flex gap-1">
              {PAGE_SIZE_OPTIONS.map((size) => (
                <button key={size.value} type="button" className={option(value.size === size.value)} onClick={() => onChange({ ...value, size: size.value })}>
                  {size.label}
                </button>
              ))}
            </div>
          </div>
          <div>
            <p className="mb-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-400">Orientamento</p>
            <div className="flex gap-1">
              <button type="button" className={option(value.orientation === 'portrait')} onClick={() => onChange({ ...value, orientation: 'portrait' })}>
                <RectangleVertical className="h-3.5 w-3.5" /> Verticale
              </button>
              <button type="button" className={option(value.orientation === 'landscape')} onClick={() => onChange({ ...value, orientation: 'landscape' })}>
                <RectangleHorizontal className="h-3.5 w-3.5" /> Orizz.
              </button>
            </div>
          </div>
          <p className="text-[10px] leading-4 text-slate-400">I margini si regolano trascinando i cursori del righello.</p>
        </div>
      )}
    </div>
  )
}
