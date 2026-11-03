import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Database, FilePlus2, Save, Sparkles, Trash2 } from '@/components/icons'

import { adminApi } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { tl } from '@/i18n/tl'
import { AdminNotice, AdminPageHeader } from '@/components/admin/AdminUI'

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
      <AdminPageHeader
        eyebrow="Backend"
        title={tl("Changelog piattaforma")}
        description={tl("Questa sezione serve solo a gestire le release note visibili dal badge beta di docenti e studenti.")}
        actions={
          <Button tone="accent" surface="solid" onClick={newReleaseDraft}>
            <FilePlus2 className="h-4 w-4" />
            {tl("Nuova release")}
          </Button>
        }
      />

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[340px_minmax(0,1fr)]">
        <div className="admin-panel self-start p-4">
          <div className="mb-3 flex items-center gap-2">
            <Database className="h-4 w-4 text-slate-500" />
            <h2 className="text-sm font-semibold text-slate-900">{tl("Release registrate")}</h2>
          </div>

          <div className="space-y-2">
            {releases.map((release) => (
              <button
                key={release.id}
                onClick={() => setSelectedReleaseId(release.id)}
                className={`w-full rounded-md border px-3 py-2.5 text-left transition-colors ${
                  selectedReleaseId === release.id
                    ? 'border-[var(--admin-accent)] bg-[var(--admin-accent-soft)]'
                    : 'border-[var(--admin-line)] bg-white hover:bg-[var(--admin-surface-2)]'
                }`}
              >
                <div className="flex items-center gap-2">
                  <span className="admin-badge admin-badge-neutral font-mono">
                    {release.version_label}
                  </span>
                </div>
                <p className="mt-2 text-sm font-medium text-slate-900">{release.title}</p>
                <p className="mt-1 text-xs text-slate-500">{release.items?.length || 0} {tl("voci")}</p>
              </button>
            ))}
          </div>
        </div>

        <div className="admin-panel p-5">
          {gitDraft && (
            <AdminNotice tone="info" icon={Sparkles} className="mb-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-slate-900">{tl("Bozza changelog da git disponibile")}</p>
                  <p className="mt-1 text-sm text-slate-600">
                    {tl("Viene generata automaticamente dal hook `pre-push` usando i commit nuovi.")}
                  </p>
                  <p className="mt-1 text-xs text-slate-500">
                    {gitDraft.version_label} · {gitDraft.generated_at}
                  </p>
                </div>
              <Button tone="accent" surface="outline" onClick={loadGitDraft}>
                {tl("Usa bozza git")}
              </Button>
              </div>
            </AdminNotice>
          )}

          {!releaseDraft ? (
            <div className="rounded-md border border-dashed border-[var(--admin-line-strong)] bg-[var(--admin-surface-2)] p-6 text-sm text-slate-500">
              {tl("Seleziona una release oppure creane una nuova.")}
            </div>
          ) : (
            <div className="space-y-4">
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                <div>
                  <label className="admin-eyebrow mb-1 block">{tl("Versione")}</label>
                  <input
                    value={releaseDraft.version_label}
                    onChange={(e) => setReleaseDraft((prev) => (prev ? { ...prev, version_label: e.target.value } : prev))}
                    className="w-full rounded-md border border-[var(--admin-line-strong)] bg-white px-3 py-2 text-sm outline-none focus:border-[var(--admin-accent)] focus:ring-2 focus:ring-[var(--admin-accent-soft)]"
                  />
                </div>
                <div>
                  <label className="admin-eyebrow mb-1 block">Git ref</label>
                  <input
                    value={releaseDraft.git_ref || ''}
                    onChange={(e) => setReleaseDraft((prev) => (prev ? { ...prev, git_ref: e.target.value } : prev))}
                    className="w-full rounded-md border border-[var(--admin-line-strong)] bg-white px-3 py-2 text-sm outline-none focus:border-[var(--admin-accent)] focus:ring-2 focus:ring-[var(--admin-accent-soft)]"
                    placeholder={tl("branch o commit")}
                  />
                </div>
              </div>

              <div>
                <label className="admin-eyebrow mb-1 block">{tl("Titolo")}</label>
                <input
                  value={releaseDraft.title}
                  onChange={(e) => setReleaseDraft((prev) => (prev ? { ...prev, title: e.target.value } : prev))}
                  className="w-full rounded-md border border-[var(--admin-line-strong)] bg-white px-3 py-2 text-sm outline-none focus:border-[var(--admin-accent)] focus:ring-2 focus:ring-[var(--admin-accent-soft)]"
                />
              </div>

              <div>
                <label className="admin-eyebrow mb-1 block">{tl("Sintesi")}</label>
                <textarea
                  value={releaseDraft.summary || ''}
                  onChange={(e) => setReleaseDraft((prev) => (prev ? { ...prev, summary: e.target.value } : prev))}
                  className="min-h-[90px] w-full rounded-md border border-[var(--admin-line-strong)] bg-white px-3 py-2 text-sm outline-none focus:border-[var(--admin-accent)] focus:ring-2 focus:ring-[var(--admin-accent-soft)]"
                />
              </div>

              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <label className="admin-eyebrow block">{tl("Voci changelog")}</label>
                  <button
                    onClick={() =>
                      setReleaseDraft((prev) =>
                        prev
                          ? { ...prev, items: [...prev.items, { category: 'improved', title: '', description: '' }] }
                          : prev
                      )
                    }
                    className="text-sm font-medium text-[var(--admin-accent)] hover:underline"
                  >
                    {tl("+ Aggiungi voce")}
                  </button>
                </div>

                {releaseDraft.items.map((item, index) => (
                  <div key={index} className="rounded-md border border-[var(--admin-line)] bg-[var(--admin-surface-2)] p-4">
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
                        className="rounded-md border border-[var(--admin-line-strong)] bg-white px-3 py-2 text-sm outline-none focus:border-[var(--admin-accent)] focus:ring-2 focus:ring-[var(--admin-accent-soft)]"
                      >
                        <option value="new">{tl("Nuovo")}</option>
                        <option value="improved">{tl("Migliorato")}</option>
                        <option value="fixed">{tl("Corretto")}</option>
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
                        className="rounded-md border border-[var(--admin-line-strong)] bg-white px-3 py-2 text-sm outline-none focus:border-[var(--admin-accent)] focus:ring-2 focus:ring-[var(--admin-accent-soft)]"
                        placeholder={tl("Titolo voce")}
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
                      className="mt-3 min-h-[90px] w-full rounded-md border border-[var(--admin-line-strong)] bg-white px-3 py-2 text-sm outline-none focus:border-[var(--admin-accent)] focus:ring-2 focus:ring-[var(--admin-accent-soft)]"
                      placeholder={tl("Descrizione della modifica")}
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
                {tl("Pubblica subito nel modal beta")}
              </label>

              <div className="flex gap-2">
                <Button tone="accent" surface="solid" onClick={saveReleaseDraft}>
                  <Save className="h-4 w-4" />
                  {tl("Salva release")}
                </Button>
                {selectedReleaseId && (
                  <Button tone="danger" surface="outline" onClick={() => deleteRelease.mutate(selectedReleaseId)}>
                    <Trash2 className="h-4 w-4" />
                    {tl("Elimina")}
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
