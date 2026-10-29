import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { Film, Loader2, Plus, Sparkles, Trash2 } from '@/components/icons'
import { Button, IconButton } from '@/design'
import { adminApi } from '@/lib/api'
import { useToast } from '@/components/ui/use-toast'
import { AuthMedia } from '@/components/videostudio/AuthMedia'
import { STATUS_LABEL, STYLE_SWATCH, isBusy, type Project, type VideoStudioConfig } from '@/components/videostudio/types'
import { tl } from '@/i18n/tl'

const api = adminApi.videoStudio

export default function VideoStudioLibraryPage() {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const { toast } = useToast()
  const config = useQuery<VideoStudioConfig>({ queryKey: ['vs', 'config'], queryFn: async () => (await api.config()).data })
  const list = useQuery<Project[]>({ queryKey: ['vs', 'list'], queryFn: async () => (await api.list()).data, refetchInterval: 5000 })

  const create = useMutation({
    mutationFn: async () => (await api.create({ title: 'Nuovo video' })).data as Project,
    onSuccess: (p) => navigate(`/teacher/video-studio/${p.id}`),
    onError: (err: any) => toast({ variant: 'destructive', title: tl("Creazione non riuscita"), description: err?.response?.data?.detail }),
  })
  const remove = useMutation({
    mutationFn: async (id: string) => api.remove(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['vs', 'list'] }),
    onError: (err: any) => toast({ variant: 'destructive', title: tl("Eliminazione non riuscita"), description: err?.response?.data?.detail }),
  })

  const projects = list.data || []

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-[1400px] px-5 py-7 md:px-8">
        <header className="mb-8 flex flex-wrap items-end gap-4">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-3">
              <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[var(--app-accent)] text-white"><Film className="h-5 w-5" /></span>
              <div>
                <p className="text-[10px] font-black uppercase tracking-[.18em] text-[var(--app-accent)]">{tl("Video Studio · Beta · Admin")}</p>
                <h1 className="text-2xl font-black tracking-tight text-[var(--text-primary)]">{tl("Video didattici")}</h1>
              </div>
            </div>
            <p className="mt-3 max-w-2xl text-sm text-[var(--text-secondary)]">
              {tl("Parti da un testo o da un documento, scrivi la regia: il sistema prepara la sceneggiatura, uno storyboard coerente e un montaggio animato di shot da")} {config.data?.shot_seconds ?? 5} secondi.
            </p>
          </div>
          <Button tone="accent" surface="solid" density="roomy" onClick={() => create.mutate()} disabled={create.isPending}>
            {create.isPending ? <Loader2 className="animate-spin" /> : <Plus />} {tl("Nuovo video")}
          </Button>
        </header>

        {config.data && !config.data.configured && (
          <div className="mb-6 rounded-2xl bg-[var(--ds-surface-muted)] p-4 text-sm text-[var(--text-secondary)]">
            {tl("Chiave OpenAI non configurata: imposta")} <b>OPENAI_API_KEY</b> {tl("nel file")} <b>.env</b> {tl("per generare le immagini.")}
          </div>
        )}

        {list.isLoading ? (
          <div className="flex h-64 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-[var(--app-accent)]" /></div>
        ) : projects.length === 0 ? (
          <button onClick={() => create.mutate()} className="ui-card flex w-full flex-col items-center gap-3 px-6 py-20 text-center">
            <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-[var(--ds-surface-muted)] text-[var(--app-accent)]"><Sparkles className="h-6 w-6" /></span>
            <span className="text-lg font-black text-[var(--text-primary)]">{tl("Crea il tuo primo video")}</span>
            <span className="max-w-md text-sm text-[var(--text-secondary)]">{tl("Incolla una lezione di biologia, chimica o fisica e trasformala in un mini-documentario.")}</span>
          </button>
        ) : (
          <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
            {projects.map((p) => (
              <article key={p.id} className="ui-card ui-card-interactive group overflow-hidden">
                <button onClick={() => navigate(`/teacher/video-studio/${p.id}`)} className="block w-full text-left">
                  <div className="relative aspect-video overflow-hidden bg-[var(--ds-surface-muted)]">
                    {p.thumbnail
                      ? <AuthMedia projectId={p.id} name={p.thumbnail} kind="img" version={p.updated_at || ''} className="h-full w-full object-cover" />
                      : <div className="h-full w-full opacity-80" style={{ background: STYLE_SWATCH[p.style_key] || STYLE_SWATCH.flat_2d }} />}
                    <span className="absolute left-3 top-3 rounded-full bg-black/60 px-2.5 py-1 text-[10px] font-bold text-white">
                      {isBusy(p) ? <span className="flex items-center gap-1"><Loader2 className="h-3 w-3 animate-spin" />{STATUS_LABEL[p.status]}</span> : STATUS_LABEL[p.status] || p.status}
                    </span>
                  </div>
                  <div className="px-4 pb-3 pt-3">
                    <h2 className="truncate text-sm font-black text-[var(--text-primary)]">{p.title}</h2>
                    <p className="mt-1 text-[11px] text-[var(--text-secondary)]">{p.shot_count || 0} shot · {p.aspect} · ${p.cost_usd.toFixed(2)}</p>
                  </div>
                </button>
                <div className="flex justify-end px-3 pb-3">
                  <IconButton tone="danger" surface="ghost" size="sm" title={tl("Elimina")} disabled={isBusy(p)}
                    onClick={() => window.confirm(tl("Eliminare “{0}”?", p.title)) && remove.mutate(p.id)}><Trash2 /></IconButton>
                </div>
              </article>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
