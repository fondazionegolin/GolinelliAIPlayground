import { useMemo } from 'react'
import { SectionHeading } from '@/design/primitives/SectionHeading'
import { SearchPill } from '@/design/primitives/SearchPill'
import { Button } from '@/design'
import { HelpCircle, Loader2, Plus, Sparkles, Users } from '@/components/icons'
import { tl } from '@/i18n/tl'

export type LibraryProject = {
  id: string
  title: string
  template_key: string
  visibility: string
  owner_display_name?: string | null
  owner_kind?: string | null
  thumbnail?: string | null
  updated_at: string
}

// Projects without a captured preview still get a distinct, stable cover derived from the title.
function coverFor(title: string): { background: string; initials: string } {
  let hash = 0
  for (const ch of title) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0
  const hue = hash % 360
  const initials = title.trim().split(/\s+/).slice(0, 2).map((word) => word[0]?.toUpperCase() || '').join('') || 'V'
  return {
    background: `linear-gradient(135deg, hsl(${hue} 55% 38%), hsl(${(hue + 48) % 360} 60% 52%))`,
    initials,
  }
}

function ProjectCard({ project, onOpen }: { project: LibraryProject; onOpen: (project: LibraryProject) => void }) {
  const cover = useMemo(() => coverFor(project.title), [project.title])
  const owner = project.owner_display_name || (project.owner_kind === 'teacher' ? tl("Docente") : tl("Studente"))
  return (
    <article className="ui-card ui-card-interactive group overflow-hidden">
      <button type="button" onClick={() => onOpen(project)} className="block w-full text-left">
        <div className="relative aspect-video overflow-hidden bg-[var(--ds-surface-muted)]">
          {project.thumbnail ? (
            <img src={project.thumbnail} alt="" loading="lazy" className="h-full w-full object-cover object-top transition duration-300 group-hover:scale-[1.03]" />
          ) : (
            <div className="flex h-full w-full items-center justify-center" style={{ background: cover.background }}>
              <span className="text-4xl font-black tracking-tight text-white/90">{cover.initials}</span>
            </div>
          )}
          {project.visibility === 'class_shared' && (
            <span className="absolute left-3 top-3 inline-flex items-center gap-1 rounded-full bg-black/60 px-2.5 py-1 text-[10px] font-bold text-white">
              <Users className="h-3 w-3" />{tl("Condiviso")}
            </span>
          )}
        </div>
        <div className="px-4 pb-4 pt-3">
          <h2 className="truncate text-sm font-black text-[var(--text-primary)]">{project.title}</h2>
          <p className="mt-1 truncate text-[11px] text-[var(--text-secondary)]">
            {owner} · {new Date(project.updated_at).toLocaleDateString('it-IT', { day: '2-digit', month: 'short', year: 'numeric' })}
          </p>
        </div>
      </button>
    </article>
  )
}

export default function VibeLabLibrary({ projects, loading, search, onSearch, onOpen, onNew, onTutorial, creating }: {
  projects: LibraryProject[]
  loading: boolean
  search: string
  onSearch: (value: string) => void
  onOpen: (project: LibraryProject) => void
  onNew: () => void
  onTutorial: () => void
  creating?: boolean
}) {
  const query = search.trim().toLocaleLowerCase('it')
  const visible = query
    ? projects.filter((project) => [project.title, project.owner_display_name].filter(Boolean).join(' ').toLocaleLowerCase('it').includes(query))
    : projects

  return (
    <div className="h-full min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto max-w-[1400px] px-5 py-7 md:px-8">
        <header className="mb-6 flex flex-wrap items-end gap-4">
          <div className="min-w-0 flex-1">
            <SectionHeading
              section="/teacher/coding"
              className="text-2xl font-black tracking-tight text-[var(--text-primary)]"
              subtitle={tl("Descrivi cosa vuoi creare: Vibe Lab fa qualche domanda, sceglie lo stile con te e costruisce un'app vera, con immagini, mappe e assistenti AI reali.")}
              subtitleClassName="mt-3 max-w-2xl text-sm text-[var(--text-secondary)]"
            >
              Vibe Lab
            </SectionHeading>
          </div>
          <div className="flex items-center gap-2">
            <Button type="button" variant="outline" density="roomy" onClick={onTutorial}>
              <HelpCircle /> {tl("Tutorial")}
            </Button>
            <Button type="button" tone="accent" surface="solid" density="roomy" onClick={onNew} disabled={creating}>
              {creating ? <Loader2 className="animate-spin" /> : <Plus />} {tl("Nuovo")}
            </Button>
          </div>
        </header>

        {projects.length > 0 && (
          <div className="mb-5 flex flex-wrap items-center gap-3">
            <SearchPill value={search} placeholder={tl("Cerca progetti...")} aria-label={tl("Cerca progetti")} onValueChange={onSearch} className="w-full sm:w-80" />
          </div>
        )}

        {loading ? (
          <div className="flex h-64 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-[var(--app-accent)]" /></div>
        ) : projects.length === 0 ? (
          <button type="button" onClick={onNew} className="ui-card flex w-full flex-col items-center gap-3 px-6 py-20 text-center">
            <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-[var(--ds-surface-muted)] text-[var(--app-accent)]"><Sparkles className="h-6 w-6" /></span>
            <span className="text-lg font-black text-[var(--text-primary)]">{tl("Crea il tuo primo progetto")}</span>
            <span className="max-w-md text-sm text-[var(--text-secondary)]">{tl("Un'idea, una pagina, un'app: descrivila a parole e Vibe Lab la costruisce per te.")}</span>
          </button>
        ) : visible.length === 0 ? (
          <p className="py-16 text-center text-sm text-[var(--text-secondary)]">{tl("Nessun progetto corrisponde a “")}{search}”.</p>
        ) : (
          <div className="ds-well grid gap-5 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
            {visible.map((project) => <ProjectCard key={project.id} project={project} onOpen={onOpen} />)}
          </div>
        )}
      </div>
    </div>
  )
}

