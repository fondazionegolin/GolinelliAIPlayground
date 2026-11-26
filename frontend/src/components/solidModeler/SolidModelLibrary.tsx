import { useState } from 'react'
import { SectionHeading } from '@/design/primitives/SectionHeading'
import { SearchPill } from '@/design/primitives/SearchPill'
import { Button } from '@/design'
import { Box, Loader2, Plus, Trash2, Users } from '@/components/icons'
import type { SolidModelSummary } from '@/lib/api'
import { tl } from '@/i18n/tl'

interface Props {
  projects: SolidModelSummary[]
  loading: boolean
  onOpen: (id: string) => void
  onNew: () => void
  onDelete: (project: SolidModelSummary) => void
  legacyCount?: number
  onImportLegacy?: () => void
  onDismissLegacy?: () => void
  /** Optional element on the left of the header actions (e.g. «Condivisi dal docente» for students). */
  leading?: React.ReactNode
}

/** Landing of the 3D Lab: every saved project as a preview card (same layout as the other section libraries). */
export default function SolidModelLibrary({ projects, loading, onOpen, onNew, onDelete, legacyCount = 0, onImportLegacy, onDismissLegacy, leading }: Props) {
  const [search, setSearch] = useState('')
  const query = search.trim().toLocaleLowerCase('it')
  const visible = query ? projects.filter(p => p.name.toLocaleLowerCase('it').includes(query)) : projects

  return (
    <div className="h-full min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto max-w-[1400px] px-5 py-7 md:px-8">
        <header className="mb-6 flex flex-wrap items-end gap-4">
          <div className="min-w-0 flex-1">
            <SectionHeading
              section="/teacher/3d-lab"
              className="text-2xl font-semibold tracking-tight text-[var(--text-primary)]"
              subtitle={tl("Disegna sketch quotati, estrudi, ruota e assembla solidi; poi condividi il modello con la classe o guardalo in realtà aumentata.")}
              subtitleClassName="mt-3 max-w-2xl text-sm text-[var(--text-secondary)]"
            >
              3D Lab
            </SectionHeading>
          </div>
          <div className="flex items-center gap-2">
            {leading}
            <Button type="button" tone="accent" surface="solid" density="roomy" onClick={onNew}><Plus /> {tl("Nuovo")}</Button>
          </div>
        </header>

        {legacyCount > 0 && (
          <div className="ds-well-tile mb-5 flex flex-wrap items-center gap-3 rounded-2xl px-4 py-3 text-xs text-[var(--text-primary)]">
            <span>{legacyCount} {tl("progetti sono salvati solo in questo browser.")}</span>
            <button type="button" onClick={onImportLegacy} className="font-semibold text-[var(--app-accent-text)] underline">{tl("Importali sul server")}</button>
            <button type="button" onClick={onDismissLegacy} className="text-[var(--text-secondary)]">{tl("Ignora")}</button>
          </div>
        )}

        {projects.length > 0 && (
          <div className="mb-5 flex flex-wrap items-center gap-3">
            <SearchPill value={search} placeholder={tl("Cerca progetti...")} aria-label={tl("Cerca progetti")} onValueChange={setSearch} className="w-full sm:w-80" />
          </div>
        )}

        {loading ? (
          <div className="flex h-64 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-[var(--app-accent)]" /></div>
        ) : projects.length === 0 ? (
          <button type="button" onClick={onNew} className="ui-card flex w-full flex-col items-center gap-3 px-6 py-20 text-center">
            <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-[var(--ds-surface-muted)] text-[var(--app-accent)]"><Box className="h-6 w-6" /></span>
            <span className="text-lg font-semibold text-[var(--text-primary)]">{tl("Crea il tuo primo modello 3D")}</span>
            <span className="max-w-md text-sm text-[var(--text-secondary)]">{tl("Parti da una forma base o da uno sketch 2D quotato.")}</span>
          </button>
        ) : visible.length === 0 ? (
          <p className="py-16 text-center text-sm text-[var(--text-secondary)]">{tl("Nessun progetto corrisponde a “")}{search}”.</p>
        ) : (
          <div className="ds-well grid gap-5 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
            {visible.map(p => {
              const shared = p.public_enabled || p.shared_class_ids.length > 0
              return (
                <article key={p.id} className="ui-card ui-card-interactive group relative overflow-hidden">
                  <button type="button" onClick={() => onOpen(p.id)} className="block w-full text-left">
                    <div className="relative aspect-video overflow-hidden bg-[var(--ds-surface-muted)]">
                      {p.thumbnail
                        ? <img src={p.thumbnail} alt="" loading="lazy" className="h-full w-full object-cover transition duration-300 group-hover:scale-[1.03]" />
                        : <div className="flex h-full w-full items-center justify-center text-[var(--text-secondary)]"><Box className="h-10 w-10 opacity-40" /></div>}
                      {shared && (
                        <span className="absolute left-3 top-3 inline-flex items-center gap-1 rounded-full bg-black/60 px-2.5 py-1 text-[10px] font-semibold text-white">
                          <Users className="h-3 w-3" />{tl("Condiviso")}
                        </span>
                      )}
                    </div>
                    <div className="px-4 pb-4 pt-3">
                      <h2 className="truncate text-sm font-semibold text-[var(--text-primary)]">{p.name}</h2>
                      <p className="mt-1 truncate text-[11px] text-[var(--text-secondary)]">
                        {p.object_count} {tl("oggetti ·")} {new Date(p.updated_at).toLocaleDateString('it-IT', { day: '2-digit', month: 'short', year: 'numeric' })}
                      </p>
                    </div>
                  </button>
                  <button
                    type="button"
                    title={tl("Elimina progetto")}
                    aria-label={tl("Elimina progetto")}
                    onClick={() => onDelete(p)}
                    className="absolute right-2 top-2 flex h-8 w-8 items-center justify-center rounded-full bg-black/60 text-white opacity-0 transition hover:bg-rose-600 focus:opacity-100 group-hover:opacity-100"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </article>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
