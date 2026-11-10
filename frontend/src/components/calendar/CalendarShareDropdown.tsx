import { useEffect, useMemo, useRef, useState } from 'react'
import { Check, ChevronDown, GraduationCap, Loader2, Presentation, Search, Users, X } from '@/components/icons'
import { Button, Input } from '@/design'
import type { CalendarShareTargets, CalendarTargetType } from '@/lib/api'
import { tl } from '@/i18n/tl'

export const targetKey = (type: CalendarTargetType, id: string) => `${type}:${id}`

type Option = { key: string; type: CalendarTargetType; label: string; detail?: string }

/**
 * "Condividi con" dropdown: one list of active classes, active sessions and co-teachers, multi-select.
 * The trigger summarises the choice; the session the teacher is in comes preselected by the caller.
 */
export function CalendarShareDropdown({ targets, onChange, shareTargets, loading, currentSessionId, existingLabels }: {
  targets: Set<string>
  onChange: (next: Set<string>) => void
  shareTargets?: CalendarShareTargets
  loading: boolean
  currentSessionId?: string
  /** Labels of already-saved targets, in case they are no longer in the active lists. */
  existingLabels?: Record<string, string>
}) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const root = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const outside = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false) }
    document.addEventListener('pointerdown', outside)
    return () => document.removeEventListener('pointerdown', outside)
  }, [open])

  const groups = useMemo(() => {
    const classNames = new Map((shareTargets?.classes ?? []).map((c) => [c.id, c.name]))
    const activeSessions = (shareTargets?.sessions ?? []).filter((s) => s.status === 'active' || s.id === currentSessionId || targets.has(targetKey('session', s.id)))
    const activeClassIds = new Set(activeSessions.map((s) => s.class_id))
    const classes: Option[] = (shareTargets?.classes ?? [])
      .filter((c) => activeClassIds.has(c.id) || targets.has(targetKey('class', c.id)))
      .map((c) => ({ key: targetKey('class', c.id), type: 'class', label: c.name, detail: tl("tutte le sessioni della classe") }))
    const sessions: Option[] = activeSessions
      .map((s) => ({
        key: targetKey('session', s.id), type: 'session' as const, label: s.name,
        detail: [s.class_name || classNames.get(s.class_id), s.id === currentSessionId ? tl("sessione attuale") : ''].filter(Boolean).join(' · '),
      }))
      .sort((a, b) => Number(b.key === targetKey('session', currentSessionId || '')) - Number(a.key === targetKey('session', currentSessionId || '')))
    const teachers: Option[] = (shareTargets?.teachers ?? []).map((t) => ({ key: targetKey('teacher', t.id), type: 'teacher', label: t.name, detail: t.email }))
    return [
      { title: tl("Classi"), icon: GraduationCap, options: classes },
      { title: tl("Sessioni attive"), icon: Presentation, options: sessions },
      { title: tl("Codocenti"), icon: Users, options: teachers },
    ]
  }, [shareTargets, currentSessionId, targets])

  const labelOf = (key: string) => {
    for (const group of groups) {
      const hit = group.options.find((o) => o.key === key)
      if (hit) return hit.label
    }
    return existingLabels?.[key] ?? '…'
  }

  const q = search.trim().toLowerCase()
  const toggle = (key: string) => {
    const next = new Set(targets)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    onChange(next)
  }
  const selected = [...targets]

  return (
    <div ref={root} className="relative grid gap-1.5">
      <span className="text-xs font-semibold text-[var(--text-secondary)]">{tl("Condividi con")}</span>
      <Button
        type="button"
        tone="neutral"
        surface="ghost"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => { setOpen((v) => !v); setSearch('') }}
        className="ds-field !h-auto min-h-[var(--button-height-default)] w-full !justify-between gap-2 rounded-[var(--control-radius)] py-1.5 text-left"
      >
        <span className="flex min-w-0 flex-1 flex-wrap gap-1">
          {selected.length === 0 && <span className="py-0.5 text-sm text-[var(--ds-field-placeholder)]">{tl("Solo io (nessuna condivisione)")}</span>}
          {selected.slice(0, 4).map((key) => (
            <span key={key} className="ds-selected inline-flex max-w-[14rem] items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold">
              <span className="truncate">{labelOf(key)}</span>
              <span role="button" tabIndex={-1} aria-label={tl("Rimuovi")} onClick={(e) => { e.stopPropagation(); toggle(key) }} className="opacity-60 hover:opacity-100"><X className="h-3 w-3" /></span>
            </span>
          ))}
          {selected.length > 4 && <span className="py-0.5 text-xs font-semibold text-[var(--text-secondary)]">+{selected.length - 4}</span>}
        </span>
        <ChevronDown className="h-4 w-4 shrink-0" />
      </Button>

      {open && (
        <div className="ds-popover absolute left-0 right-0 top-full z-[110] mt-1 rounded-[var(--card-radius)] p-2 text-[var(--text-primary)]">
          <div className="mb-2 flex items-center gap-2">
            <Search className="h-4 w-4 shrink-0 text-[var(--text-secondary)]" />
            <Input autoFocus value={search} onChange={(e) => setSearch(e.target.value)} placeholder={tl("Cerca classe, sessione o collega…")} className="min-w-0 flex-1"
              onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setOpen(false) } }} />
          </div>
          <div role="listbox" aria-multiselectable="true" className="max-h-72 overflow-y-auto">
            {loading ? (
              <div className="flex items-center gap-2 px-3 py-4 text-xs text-[var(--text-secondary)]"><Loader2 className="h-3.5 w-3.5 animate-spin" />{tl("Caricamento…")}</div>
            ) : groups.map((group) => {
              const options = group.options.filter((o) => !q || `${o.label} ${o.detail ?? ''}`.toLowerCase().includes(q))
              if (!options.length) return null
              const Icon = group.icon
              return (
                <div key={group.title} className="mb-1">
                  <div className="flex items-center gap-1.5 px-2 pb-1 pt-2 text-[10px] font-bold uppercase tracking-wide text-[var(--text-secondary)]"><Icon className="h-3 w-3" />{group.title}</div>
                  {options.map((option) => {
                    const isSelected = targets.has(option.key)
                    return (
                      <Button
                        key={option.key}
                        type="button"
                        tone="neutral"
                        surface="ghost"
                        role="option"
                        aria-selected={isSelected}
                        onClick={() => toggle(option.key)}
                        className={`!h-auto min-h-9 w-full !justify-between whitespace-normal rounded-[var(--control-radius)] px-3 py-1.5 text-left ${isSelected ? 'ds-selected' : ''}`}
                      >
                        <span className="min-w-0">
                          <span className="block truncate text-xs font-semibold text-[var(--text-primary)]">{option.label}</span>
                          {option.detail && <span className="block truncate text-[10px] text-[var(--text-secondary)]">{option.detail}</span>}
                        </span>
                        {isSelected && <Check className="h-3.5 w-3.5 shrink-0" />}
                      </Button>
                    )
                  })}
                </div>
              )
            })}
            {!loading && groups.every((g) => !g.options.some((o) => !q || `${o.label} ${o.detail ?? ''}`.toLowerCase().includes(q))) && (
              <p className="px-3 py-4 text-xs text-[var(--text-secondary)]">{tl("Nessun risultato")}</p>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
