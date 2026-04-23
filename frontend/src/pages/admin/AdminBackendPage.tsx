import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Database, FilePlus2, Save, Sparkles, Trash2 } from 'lucide-react'

import { adminApi } from '@/lib/api'
import { Button } from '@/components/ui/button'

type ReleaseItemCategory = 'new' | 'improved' | 'fixed'

interface ChangelogItem {
  category: ReleaseItemCategory
  title: string
  description: string
}

interface ChangelogRelease {
  id: string
  version_label: string
  title: string
  summary?: string | null
  git_ref?: string | null
  is_published: boolean
  items: ChangelogItem[]
  published_at?: string | null
}

interface ReleaseDraft {
  version_label: string
  title: string
  summary?: string | null
  git_ref?: string | null
  is_published: boolean
  items: ChangelogItem[]
}

interface GitDraftRelease {
  generated_at: string
  version_label: string
  title: string
  summary?: string
  git_ref?: string
  items: ChangelogItem[]
}

function buildReleaseDraft(release: ChangelogRelease | null): ReleaseDraft | null {
  if (!release) return null
  return {
    version_label: release.version_label,
    title: release.title,
    summary: release.summary,
    git_ref: release.git_ref,
    is_published: release.is_published,
    items: release.items?.length
      ? release.items
      : [{ category: 'new', title: '', description: '' }],
  }
}

export default function AdminBackendPage() {
  const qc = useQueryClient()
  const [selectedReleaseId, setSelectedReleaseId] = useState<string | null>(null)
  const [releaseDraft, setReleaseDraft] = useState<ReleaseDraft | null>(null)

  const { data: releases = [] } = useQuery<ChangelogRelease[]>({
    queryKey: ['admin-backend-changelog'],
    queryFn: async () => {
      const res = await adminApi.listBackendChangelog()
      return res.data
    },
  })

  const { data: gitDraft } = useQuery<GitDraftRelease | null>({
    queryKey: ['admin-backend-git-draft'],
    queryFn: async () => {
      try {
        const res = await fetch(`/changelog/git-draft.json?ts=${Date.now()}`)
        if (!res.ok) return null
        return await res.json()
      } catch {
        return null
      }
    },
    staleTime: 0,
  })

  useEffect(() => {
    if (!selectedReleaseId && releases[0]) {
      setSelectedReleaseId(releases[0].id)
    }
    if (selectedReleaseId && !releases.some((item) => item.id === selectedReleaseId)) {
      setSelectedReleaseId(releases[0]?.id ?? null)
    }
  }, [releases, selectedReleaseId])

  useEffect(() => {
    const selected = releases.find((item) => item.id === selectedReleaseId) ?? null
    setReleaseDraft(buildReleaseDraft(selected))
  }, [selectedReleaseId, releases])

  const invalidateReleases = () => qc.invalidateQueries({ queryKey: ['admin-backend-changelog'] })

  const createRelease = useMutation({
    mutationFn: (payload: ReleaseDraft) =>
      adminApi.createBackendChangelog({
        ...payload,
        summary: payload.summary || undefined,
        git_ref: payload.git_ref || undefined,
      }),
    onSuccess: (res) => {
      invalidateReleases()
      setSelectedReleaseId(res.data.id)
    },
  })

  const updateRelease = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: ReleaseDraft }) =>
      adminApi.updateBackendChangelog(id, {
        ...payload,
        summary: payload.summary || undefined,
        git_ref: payload.git_ref || undefined,
      }),
    onSuccess: invalidateReleases,
  })

  const deleteRelease = useMutation({
    mutationFn: (id: string) => adminApi.deleteBackendChangelog(id),
    onSuccess: () => {
      invalidateReleases()
      setSelectedReleaseId(null)
    },
  })

  const newReleaseDraft = () => {
    setSelectedReleaseId(null)
    setReleaseDraft({
      version_label: '',
      title: '',
      summary: '',
      git_ref: '',
      is_published: true,
      items: [{ category: 'new', title: '', description: '' }],
    })
  }

  const loadGitDraft = () => {
    if (!gitDraft) return
    setSelectedReleaseId(null)
    setReleaseDraft({
      version_label: gitDraft.version_label,
      title: gitDraft.title,
      summary: gitDraft.summary || '',
      git_ref: gitDraft.git_ref || '',
      is_published: true,
      items: gitDraft.items?.length
        ? gitDraft.items
        : [{ category: 'improved', title: '', description: '' }],
    })
  }

  const saveReleaseDraft = () => {
    if (!releaseDraft) return
    const payload: ReleaseDraft = {
      version_label: releaseDraft.version_label,
      title: releaseDraft.title,
      summary: releaseDraft.summary || undefined,
      git_ref: releaseDraft.git_ref || undefined,
      is_published: releaseDraft.is_published,
      items: releaseDraft.items.filter((item) => item.title.trim() && item.description.trim()),
    }
    if (selectedReleaseId) {
      updateRelease.mutate({ id: selectedReleaseId, payload })
      return
    }
    createRelease.mutate(payload)
  }

  return (
    <div className="space-y-6">
      <div className="rounded-[28px] border border-slate-200 bg-white/90 p-6 shadow-[0_25px_60px_-30px_rgba(15,23,42,0.35)] backdrop-blur-xl">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-400">Admin / Backend</p>
            <h1 className="mt-2 text-2xl font-semibold text-slate-900">Changelog piattaforma</h1>
            <p className="mt-2 max-w-3xl text-sm text-slate-500">
              Questa sezione serve solo a gestire le release note visibili dal badge beta di docenti e studenti.
            </p>
          </div>
          <Button className="bg-[#181b1e] hover:bg-[#0f1113]" onClick={newReleaseDraft}>
            <FilePlus2 className="mr-2 h-4 w-4" />
            Nuova release
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[360px_minmax(0,1fr)]">
        <div className="rounded-[28px] border border-slate-200 bg-white/90 p-5 shadow-[0_25px_60px_-30px_rgba(15,23,42,0.35)] backdrop-blur-xl">
          <div className="mb-4 flex items-center gap-2">
            <Database className="h-4 w-4 text-fuchsia-500" />
            <h2 className="text-base font-semibold text-slate-900">Release registrate</h2>
          </div>

          <div className="space-y-2">
            {releases.map((release) => (
              <button
                key={release.id}
                onClick={() => setSelectedReleaseId(release.id)}
                className={`w-full rounded-[22px] border px-4 py-3 text-left transition-colors ${
                  selectedReleaseId === release.id
                    ? 'border-fuchsia-300 bg-fuchsia-50/60'
                    : 'border-slate-200 bg-slate-50 hover:bg-slate-100'
                }`}
              >
                <div className="flex items-center gap-2">
                  <span className="rounded-full bg-slate-900 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white">
                    {release.version_label}
                  </span>
                </div>
                <p className="mt-2 text-sm font-medium text-slate-900">{release.title}</p>
                <p className="mt-1 text-xs text-slate-500">{release.items?.length || 0} voci</p>
              </button>
            ))}
          </div>
        </div>

        <div className="rounded-[28px] border border-slate-200 bg-white/90 p-5 shadow-[0_25px_60px_-30px_rgba(15,23,42,0.35)] backdrop-blur-xl">
          {gitDraft && (
            <div className="mb-5 flex flex-wrap items-start justify-between gap-3 rounded-[24px] border border-fuchsia-200 bg-fuchsia-50/70 p-4">
              <div className="flex items-start gap-3">
                <div className="mt-0.5 flex h-9 w-9 items-center justify-center rounded-2xl bg-white text-fuchsia-600 shadow-sm">
                  <Sparkles className="h-4 w-4" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-slate-900">Bozza changelog da git disponibile</p>
                  <p className="mt-1 text-sm text-slate-600">
                    Viene generata automaticamente dal hook `pre-push` usando i commit nuovi.
                  </p>
                  <p className="mt-1 text-xs text-slate-500">
                    {gitDraft.version_label} · {gitDraft.generated_at}
                  </p>
                </div>
              </div>
              <Button className="bg-[#181b1e] hover:bg-[#0f1113]" onClick={loadGitDraft}>
                Usa bozza git
              </Button>
            </div>
          )}

          {!releaseDraft ? (
            <div className="rounded-[24px] border border-dashed border-slate-300 bg-slate-50 p-6 text-sm text-slate-500">
              Seleziona una release oppure creane una nuova.
            </div>
          ) : (
            <div className="space-y-4">
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                <div>
                  <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">Versione</label>
                  <input
                    value={releaseDraft.version_label}
                    onChange={(e) => setReleaseDraft((prev) => (prev ? { ...prev, version_label: e.target.value } : prev))}
                    className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm outline-none"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">Git ref</label>
                  <input
                    value={releaseDraft.git_ref || ''}
                    onChange={(e) => setReleaseDraft((prev) => (prev ? { ...prev, git_ref: e.target.value } : prev))}
                    className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm outline-none"
                    placeholder="branch o commit"
                  />
                </div>
              </div>

              <div>
                <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">Titolo</label>
                <input
                  value={releaseDraft.title}
                  onChange={(e) => setReleaseDraft((prev) => (prev ? { ...prev, title: e.target.value } : prev))}
                  className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm outline-none"
                />
              </div>

              <div>
                <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">Sintesi</label>
                <textarea
                  value={releaseDraft.summary || ''}
                  onChange={(e) => setReleaseDraft((prev) => (prev ? { ...prev, summary: e.target.value } : prev))}
                  className="min-h-[90px] w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm outline-none"
                />
              </div>

              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <label className="block text-xs font-medium uppercase tracking-wide text-slate-500">Voci changelog</label>
                  <button
                    onClick={() =>
                      setReleaseDraft((prev) =>
                        prev
                          ? { ...prev, items: [...prev.items, { category: 'improved', title: '', description: '' }] }
                          : prev
                      )
                    }
                    className="text-sm font-medium text-fuchsia-600 hover:text-fuchsia-700"
                  >
                    + Aggiungi voce
                  </button>
                </div>

                {releaseDraft.items.map((item, index) => (
                  <div key={index} className="rounded-[24px] border border-slate-200 bg-slate-50 p-4">
                    <div className="grid grid-cols-1 gap-3 md:grid-cols-[160px_minmax(0,1fr)]">
                      <select
                        value={item.category}
                        onChange={(e) =>
                          setReleaseDraft((prev) =>
                            prev
                              ? {
                                  ...prev,
                                  items: prev.items.map((entry, entryIndex) =>
                                    entryIndex === index ? { ...entry, category: e.target.value as ReleaseItemCategory } : entry
                                  ),
                                }
                              : prev
                          )
                        }
                        className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm outline-none"
                      >
                        <option value="new">Nuovo</option>
                        <option value="improved">Migliorato</option>
                        <option value="fixed">Corretto</option>
                      </select>
                      <input
                        value={item.title}
                        onChange={(e) =>
                          setReleaseDraft((prev) =>
                            prev
                              ? {
                                  ...prev,
                                  items: prev.items.map((entry, entryIndex) =>
                                    entryIndex === index ? { ...entry, title: e.target.value } : entry
                                  ),
                                }
                              : prev
                          )
                        }
                        className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm outline-none"
                        placeholder="Titolo voce"
                      />
                    </div>
                    <textarea
                      value={item.description}
                      onChange={(e) =>
                        setReleaseDraft((prev) =>
                          prev
                            ? {
                                ...prev,
                                items: prev.items.map((entry, entryIndex) =>
                                  entryIndex === index ? { ...entry, description: e.target.value } : entry
                                ),
                              }
                            : prev
                        )
                      }
                      className="mt-3 min-h-[90px] w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm outline-none"
                      placeholder="Descrizione della modifica"
                    />
                  </div>
                ))}
              </div>

              <label className="flex items-center gap-2 text-sm text-slate-600">
                <input
                  type="checkbox"
                  checked={releaseDraft.is_published}
                  onChange={(e) => setReleaseDraft((prev) => (prev ? { ...prev, is_published: e.target.checked } : prev))}
                />
                Pubblica subito nel modal beta
              </label>

              <div className="flex gap-2">
                <Button className="bg-[#181b1e] hover:bg-[#0f1113]" onClick={saveReleaseDraft}>
                  <Save className="mr-2 h-4 w-4" />
                  Salva release
                </Button>
                {selectedReleaseId && (
                  <Button variant="outline" onClick={() => deleteRelease.mutate(selectedReleaseId)}>
                    <Trash2 className="mr-2 h-4 w-4" />
                    Elimina
                  </Button>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
