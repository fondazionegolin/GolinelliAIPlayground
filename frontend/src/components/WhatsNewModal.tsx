import { useQuery } from '@tanstack/react-query'
import { Sparkles, Wand2, Wrench, X } from 'lucide-react'

import { platformApi } from '@/lib/api'
import { Button } from '@/components/ui/button'

interface ChangelogItem {
  category: 'new' | 'improved' | 'fixed'
  title: string
  description: string
}

interface ChangelogRelease {
  id: string
  version_label: string
  title: string
  summary?: string | null
  git_ref?: string | null
  items: ChangelogItem[]
  published_at?: string | null
}

const CATEGORY_META = {
  new: {
    label: 'Nuovo',
    icon: Sparkles,
    badgeClass: 'bg-fuchsia-100 text-fuchsia-700 border border-fuchsia-200',
  },
  improved: {
    label: 'Migliorato',
    icon: Wand2,
    badgeClass: 'bg-sky-100 text-sky-700 border border-sky-200',
  },
  fixed: {
    label: 'Corretto',
    icon: Wrench,
    badgeClass: 'bg-emerald-100 text-emerald-700 border border-emerald-200',
  },
}

export default function WhatsNewModal({ onClose }: { onClose: () => void }) {
  const { data: releases = [], isLoading } = useQuery<ChangelogRelease[]>({
    queryKey: ['platform-changelog'],
    queryFn: async () => {
      const res = await platformApi.listChangelog()
      return res.data
    },
  })

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
      <div className="flex max-h-[90vh] w-full max-w-4xl flex-col overflow-hidden rounded-[28px] bg-white shadow-2xl">
        <div className="flex items-start justify-between border-b border-slate-100 px-6 pb-4 pt-6">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-br from-fuchsia-500 via-pink-500 to-sky-500 shadow-lg shadow-fuchsia-500/20">
              <Sparkles className="h-5 w-5 text-white" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-slate-900">Changelog piattaforma</h2>
              <p className="mt-1 text-sm text-slate-500">Novità, miglioramenti e correzioni visibili da studenti e docenti tramite il badge beta.</p>
            </div>
          </div>
          <button onClick={onClose} className="rounded-xl p-2 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5">
          {isLoading ? (
            <div className="rounded-[24px] border border-slate-200 bg-slate-50 p-6 text-sm text-slate-500">
              Caricamento changelog…
            </div>
          ) : releases.length === 0 ? (
            <div className="rounded-[24px] border border-dashed border-slate-300 bg-slate-50 p-6 text-sm text-slate-500">
              Nessuna release pubblicata al momento.
            </div>
          ) : (
            <div className="space-y-5">
              {releases.map((release) => (
                <section key={release.id} className="rounded-[28px] border border-slate-200 bg-slate-50/80 p-5">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="rounded-full bg-slate-900 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-white">
                          {release.version_label}
                        </span>
                        {release.published_at && (
                          <span className="text-xs text-slate-400">
                            {new Date(release.published_at).toLocaleDateString('it-IT', { day: '2-digit', month: 'long', year: 'numeric' })}
                          </span>
                        )}
                      </div>
                      <h3 className="mt-3 text-xl font-semibold text-slate-900">{release.title}</h3>
                      {release.summary && <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">{release.summary}</p>}
                    </div>
                    {release.git_ref && (
                      <span className="rounded-full border border-slate-200 bg-white px-3 py-1 font-mono text-[11px] text-slate-500">
                        {release.git_ref}
                      </span>
                    )}
                  </div>

                  <div className="mt-4 space-y-3">
                    {release.items.map((item, index) => {
                      const meta = CATEGORY_META[item.category] ?? CATEGORY_META.improved
                      const Icon = meta.icon
                      return (
                        <div key={`${release.id}-${index}`} className="flex gap-4 rounded-[22px] border border-slate-200 bg-white px-4 py-4">
                          <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-2xl bg-slate-100">
                            <Icon className="h-5 w-5 text-slate-700" />
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="text-sm font-semibold text-slate-900">{item.title}</span>
                              <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${meta.badgeClass}`}>
                                {meta.label}
                              </span>
                            </div>
                            <p className="mt-1 text-sm leading-6 text-slate-600">{item.description}</p>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </section>
              ))}
            </div>
          )}
        </div>

        <div className="flex justify-end border-t border-slate-100 px-6 py-4">
          <Button onClick={onClose} className="bg-[#181b1e] hover:bg-[#0f1113] text-white">
            Chiudi
          </Button>
        </div>
      </div>
    </div>
  )
}
