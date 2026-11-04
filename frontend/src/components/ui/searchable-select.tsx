import { useEffect, useId, useRef, useState } from 'react'
import { Check, ChevronDown, Search } from '@/components/icons'
import { Button, Input } from '@/design'
import { tl } from '@/i18n/tl'

export interface SearchableOption {
  value: string
  label: string
  description?: string
  searchText?: string
  disabled?: boolean
}

export function SearchableSelect({ value, options, onChange, label, disabled = false, className = '', menuClassName = 'w-full min-w-[16rem]' }: {
  value: string; options: SearchableOption[]; onChange: (value: string) => void
  label: string; disabled?: boolean; className?: string; menuClassName?: string
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
  return <div ref={root} className={`relative min-w-0 ${className}`} onBlur={(event) => {
    if (!event.currentTarget.contains(event.relatedTarget as Node)) setOpen(false)
  }}>
    <Button tone="neutral" surface="ghost" ref={trigger} type="button" aria-label={label} aria-haspopup="listbox" aria-expanded={open} disabled={disabled}
      onClick={() => { setOpen(!open); setSearch(''); setActive(0) }}
      className="ds-field w-full !justify-between rounded-[var(--control-radius)] text-left text-[var(--text-primary)]">
      <span className="truncate font-semibold" style={{ color: 'var(--text-primary)' }}>{options.find((o) => o.value === value)?.label || label}</span><ChevronDown className="h-3.5 w-3.5 shrink-0" />
    </Button>
    {open && <div className={`ds-popover absolute right-0 top-full z-[110] mt-2 ${menuClassName} rounded-[var(--card-radius)] p-2 text-[var(--text-primary)]`}>
      <div className="mb-2 flex items-center gap-2">
        <Search className="h-4 w-4 shrink-0 text-[var(--text-secondary)]" />
        <Input ref={input} role="combobox" aria-label={tl('Cerca')} aria-controls={id} aria-expanded="true" aria-autocomplete="list"
          aria-activedescendant={filtered[active] ? `${id}-${active}` : undefined}
          style={{ color: 'var(--text-primary)' }} value={search} onChange={(event) => { setSearch(event.target.value); setActive(0) }}
          onKeyDown={(event) => {
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
          }}
          placeholder={tl('Cerca…')} className="min-w-0 flex-1" />
      </div>
      <div id={id} role="listbox" aria-label={label} className="max-h-64 overflow-y-auto">
        {filtered.map((option, index) => <Button tone="neutral" surface="ghost" type="button" role="option" id={`${id}-${index}`} key={option.value}
          aria-selected={value === option.value} aria-disabled={option.disabled} disabled={option.disabled}
          onPointerMove={() => setActive(index)} onClick={() => choose(option)}
          className={`!h-auto min-h-[var(--button-height-default)] w-full !justify-between whitespace-normal rounded-[var(--control-radius)] px-3 py-2 text-left !text-[var(--text-primary)] disabled:opacity-40 ${value === option.value ? 'ds-selected' : index === active ? 'bg-[var(--ds-control-hover)]' : ''}`}>
          <span className="min-w-0"><span className="block break-words text-xs font-semibold" style={{ color: 'var(--text-primary)' }}>{option.label}</span>{option.description && <span className="block text-[10px]" style={{ color: 'var(--text-muted)' }}>{option.description}</span>}</span>
          {value === option.value && <Check className="h-3.5 w-3.5 shrink-0" />}
        </Button>)}
        {!filtered.length && <p className="px-3 py-4 text-xs text-[var(--text-secondary)]">{tl('Nessun risultato')}</p>}
      </div>
    </div>}
  </div>
}
