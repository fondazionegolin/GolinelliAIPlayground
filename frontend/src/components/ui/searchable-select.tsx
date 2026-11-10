import { SearchPill } from '@/design/primitives/SearchPill'
import { useEffect, useId, useRef, useState } from 'react'
import { Check, ChevronDown, Star } from '@/components/icons'
import { Button, IconButton } from '@/design'
import { tl } from '@/i18n/tl'

export interface SearchableOption {
  value: string
  label: string
  description?: string
  searchText?: string
  disabled?: boolean
}

export function SearchableSelect({ value, options, onChange, label, disabled = false, className = '', menuClassName = 'w-full min-w-[16rem]', favoriteValue, onFavoriteChange }: {
  value: string; options: SearchableOption[]; onChange: (value: string) => void
  label: string; disabled?: boolean; className?: string; menuClassName?: string
  favoriteValue?: string; onFavoriteChange?: (value: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [active, setActive] = useState(0)
  const root = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const input = useRef<HTMLInputElement>(null)
  const id = useId()
  const filtered = options.filter((option) => `${option.label} ${option.description || ''} ${option.searchText || ''}`.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()))
  const close = () => { setOpen(false); trigger.current?.focus() }
  useEffect(() => {
    if (!open) return
    input.current?.focus()
    const outside = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false) }
    document.addEventListener('pointerdown', outside)
    return () => document.removeEventListener('pointerdown', outside)
  }, [open])
  useEffect(() => {
    if (open) document.getElementById(`${id}-${active}`)?.scrollIntoView({ block: 'nearest' })
  }, [open, active, search, id])
  const choose = (option?: SearchableOption) => {
    if (!option || option.disabled) return
    onChange(option.value)
    close()
  }
  // A grid popup keeps row actions separate from selection buttons. A listbox
  // option cannot contain an independently focusable favorite button.
  const hasFavorites = Boolean(onFavoriteChange)
  return <div ref={root} className={`relative min-w-0 ${className}`} onKeyDown={(event) => {
    if (open && event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close() }
  }} onBlur={(event) => {
    if (!event.currentTarget.contains(event.relatedTarget as Node)) setOpen(false)
  }}>
    <Button tone="neutral" surface="ghost" ref={trigger} type="button" aria-label={label} aria-haspopup={hasFavorites ? 'grid' : 'listbox'} aria-expanded={open} disabled={disabled}
      onClick={() => { setOpen(!open); setSearch(''); setActive(0) }}
      className="ds-field w-full !justify-between rounded-[var(--control-radius)] text-left text-[var(--text-primary)]">
      <span className="flex min-w-0 items-center gap-2">
        {hasFavorites && value === favoriteValue && <Star className="h-3.5 w-3.5 shrink-0 fill-current text-[var(--text-secondary)]" aria-hidden="true" />}
        <span className="truncate font-semibold" style={{ color: 'var(--text-primary)' }}>{options.find((o) => o.value === value)?.label || label}</span>
      </span><ChevronDown className="h-3.5 w-3.5 shrink-0" />
    </Button>
    {open && <div className={`ds-popover absolute right-0 top-full z-[110] mt-2 ${menuClassName} rounded-[var(--card-radius)] p-2 text-[var(--text-primary)]`}>
      <SearchPill ref={input} role="combobox" aria-label={tl('Cerca')} aria-controls={id} aria-expanded="true" aria-autocomplete="list" aria-haspopup={hasFavorites ? 'grid' : 'listbox'} aria-activedescendant={filtered[active] ? `${id}-${active}` : undefined} value={search} onKeyDown={(event) => {
            if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close() }
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
              event.preventDefault()
              const direction = event.key === 'ArrowDown' ? 1 : -1
              setActive((index) => {
                for (let i = 1; i <= filtered.length; i++) {
                  const next = (index + direction * i + filtered.length) % filtered.length
                  if (!filtered[next].disabled) return next
                }
                return index
              })
            }
            if (event.key === 'Enter') { event.preventDefault(); choose(filtered[active]) }
          }} placeholder={tl('Cerca…')} onValueChange={(nextValue) => { setSearch(nextValue); setActive(0) }} className="mb-2" />
      <div id={id} role={hasFavorites ? 'grid' : 'listbox'} aria-label={label} className="max-h-64 overflow-y-auto">
        {filtered.map((option, index) => {
          const selection = <Button tone="neutral" surface="ghost" type="button" role={hasFavorites ? undefined : 'option'} id={hasFavorites ? undefined : `${id}-${index}`}
          aria-label={option.label}
          aria-selected={hasFavorites ? undefined : value === option.value} aria-disabled={option.disabled} disabled={option.disabled}
          onPointerMove={() => setActive(index)} onClick={() => choose(option)}
          className={`!h-auto min-h-[var(--button-height-default)] w-full !justify-between whitespace-normal rounded-[var(--control-radius)] px-3 py-2 text-left !text-[var(--text-primary)] disabled:opacity-40 ${value === option.value ? 'ds-selected' : index === active ? 'bg-[var(--ds-control-hover)]' : ''}`}>
          <span className="min-w-0"><span className="block break-words text-xs font-semibold" style={{ color: 'var(--text-primary)' }}>{option.label}</span>{option.description && <span className="block text-[10px]" style={{ color: 'var(--text-muted)' }}>{option.description}</span>}</span>
          {value === option.value && <Check className="h-3.5 w-3.5 shrink-0" />}
        </Button>
          if (!hasFavorites) return <div key={option.value} role="presentation">{selection}</div>
          const favorite = favoriteValue === option.value
          const favoriteLabel = favorite ? tl('Modello preferito: {0}', option.label) : tl('Imposta {0} come modello preferito', option.label)
          return <div key={option.value} role="row" aria-selected={value === option.value} className="flex items-center gap-1" onPointerMove={() => setActive(index)}>
            <div role="gridcell" id={`${id}-${index}`} className="min-w-0 flex-1">{selection}</div>
            <div role="gridcell">
              <IconButton type="button" tone="neutral" surface="ghost" size="sm" disabled={option.disabled}
                aria-label={favoriteLabel} title={favoriteLabel} aria-pressed={favorite}
                onClick={() => { if (!favorite) onFavoriteChange?.(option.value) }}>
                <Star className={`text-[var(--text-secondary)] ${favorite ? 'fill-current' : ''}`} aria-hidden="true" />
              </IconButton>
            </div>
          </div>
        })}
        {!filtered.length && <p className="px-3 py-4 text-xs text-[var(--text-secondary)]">{tl('Nessun risultato')}</p>}
      </div>
    </div>}
  </div>
}
