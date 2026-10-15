import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Check, Download, Film, Loader2, Paperclip, Play, Plus, RefreshCw, Sparkles, Trash2 } from '@/components/icons'
import { Badge, Button, IconButton, Input, Select, Textarea } from '@/design'
import { adminApi } from '@/lib/api'
import { useToast } from '@/components/ui/use-toast'
import { AuthMedia } from '@/components/videostudio/AuthMedia'
import {
  STATUS_LABEL, STYLE_SWATCH, isBusy,
  type Entity, type Project, type Script, type Shot, type VideoStudioConfig,
} from '@/components/videostudio/types'

const api = adminApi.videoStudio

type Stage = 'script' | 'storyboard' | 'render' | 'done'

const Label = ({ children }: { children: React.ReactNode }) => (
  <span className="mb-1.5 block text-[11px] font-semibold text-[var(--text-secondary)]">{children}</span>
)
const areaProps = { density: 'compact', resize: 'none' } as const

export default function VideoStudioEditorPage() {
  const { projectId = '' } = useParams()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const { toast } = useToast()
  const fileInput = useRef<HTMLInputElement>(null)
  const fail = (title: string) => (err: any) =>
    toast({ variant: 'destructive', title, description: err?.response?.data?.detail || 'Riprova tra poco.' })

  const config = useQuery<VideoStudioConfig>({ queryKey: ['vs', 'config'], queryFn: async () => (await api.config()).data })
  const query = useQuery<Project>({
    queryKey: ['vs', 'project', projectId],
    queryFn: async () => (await api.get(projectId)).data,
    refetchInterval: (q) => (isBusy(q.state.data as Project | undefined) ? 2500 : false),
  })
  const p = query.data

  const [form, setForm] = useState({ title: '', source_text: '', brief: '', style_key: 'flat_2d', aspect: '16:9', language: 'it', target_shots: 6 })
  const [script, setScript] = useState<Script>({})
  const [formDirty, setFormDirty] = useState(false)
  const [scriptDirty, setScriptDirty] = useState(false)
  const [selected, setSelected] = useState<number | 'film'>(1)
  const [tab, setTab] = useState<'shot' | 'cast'>('shot')

  useEffect(() => {
    if (!p) return
    if (!formDirty) {
      setForm({
        title: p.title, source_text: p.source_text || '', brief: p.brief || '', style_key: p.style_key,
        aspect: p.aspect, language: p.language, target_shots: p.target_shots,
      })
    }
    if (!scriptDirty) setScript(p.script || {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p?.id, p?.updated_at, p?.status])

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['vs', 'project', projectId] })
    qc.invalidateQueries({ queryKey: ['vs', 'list'] })
  }

  const saveForm = useMutation({
    mutationFn: async () => (await api.update(projectId, form)).data,
    onSuccess: () => { setFormDirty(false); refresh() },
  })
  const saveScript = useMutation({
    mutationFn: async () => (await api.saveScript(projectId, script)).data,
    onSuccess: () => { setScriptDirty(false); refresh() },
    onError: fail('Salvataggio non riuscito'),
  })

  const busy = isBusy(p)
  useEffect(() => {
    if (!formDirty || busy) return
    const t = setTimeout(() => saveForm.mutate(), 900)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form, formDirty, busy])
  useEffect(() => {
    if (!scriptDirty || busy) return
    const t = setTimeout(() => saveScript.mutate(), 1200)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [script, scriptDirty, busy])

  const flushEdits = async () => {
    if (formDirty) { await api.update(projectId, form); setFormDirty(false) }
    if (scriptDirty) { await api.saveScript(projectId, script); setScriptDirty(false) }
  }

  const genScript = useMutation({
    mutationFn: async () => { await flushEdits(); return (await api.generateScript(projectId)).data as Project },
    onSuccess: () => { setScriptDirty(false); setSelected(1); refresh() },
    onError: fail('Sceneggiatura non generata'),
  })
  const startStoryboard = useMutation({
    mutationFn: async (shots?: number[]) => { await flushEdits(); return (await api.storyboard(projectId, shots)).data },
    onSuccess: refresh, onError: fail('Storyboard non avviato'),
  })
  const startRender = useMutation({
    mutationFn: async (shots?: number[]) => { await flushEdits(); return (await api.render(projectId, shots)).data },
    onSuccess: refresh, onError: fail('Montaggio non avviato'),
  })

  const shots = script.shots || []
  const entities = script.entities || []
  const hasScript = shots.length > 0
  const keyframes = shots.filter((s) => s.keyframe_key).length
  const clips = shots.filter((s) => s.video_key).length
  const current = typeof selected === 'number' ? shots.find((s) => s.n === selected) || shots[0] : undefined
  const shotSeconds = config.data?.shot_seconds ?? 5
  const imageCost = config.data?.image_cost_usd ?? 0.05
  const stage: Stage = !hasScript ? 'script' : keyframes < shots.length ? 'storyboard' : clips < shots.length || !p?.has_final ? 'render' : 'done'
  const ratio = (() => { const [a, b] = (form.aspect || '16:9').split(':').map(Number); return a && b ? a / b : 16 / 9 })()
  const estimate = useMemo(() => {
    if (stage !== 'storyboard') return null
    return (shots.length - keyframes + entities.filter((e) => !e.sheet_key).length) * imageCost
  }, [stage, shots.length, keyframes, entities, imageCost])

  const edit = (patch: Partial<Script>) => { setScript((s) => ({ ...s, ...patch })); setScriptDirty(true) }
  const editShot = (n: number, patch: Partial<Shot>) => edit({ shots: shots.map((s) => (s.n === n ? { ...s, ...patch } : s)) })
  const editEntity = (id: string, patch: Partial<Entity>) => edit({ entities: entities.map((e) => (e.id === id ? { ...e, ...patch } : e)) })
  const addShot = () => {
    const n = shots.length + 1
    edit({ shots: [...shots, { n, title: `Shot ${n}`, narration: '', visual: '', motion: '', entities: entities.slice(0, 1).map((e) => e.id), status: 'pending' }] })
    setSelected(n); setTab('shot')
  }
  const removeShot = (n: number) => {
    if (shots.length <= 1) return
    edit({ shots: shots.filter((s) => s.n !== n).map((s, i) => ({ ...s, n: i + 1 })) })
    setSelected(1)
  }
  const patchForm = (patch: Partial<typeof form>) => { setForm((f) => ({ ...f, ...patch })); setFormDirty(true) }

  const onFile = async (file?: File) => {
    if (!file) return
    try {
      const res = await api.extractText(file)
      patchForm({ source_text: res.data.text, ...(form.title === 'Nuovo video' ? { title: file.name.replace(/\.[^.]+$/, '') } : {}) })
      toast({ title: 'Documento letto', description: `${res.data.text.length.toLocaleString('it-IT')} caratteri estratti` })
    } catch (err) { fail('Lettura file non riuscita')(err) }
  }

  const download = async () => {
    const res = await api.file(projectId, 'final.mp4')
    const url = URL.createObjectURL(res.data)
    const a = document.createElement('a')
    a.href = url; a.download = `${(form.title || 'video').replace(/[^\w-]+/g, '_')}.mp4`; a.click()
    setTimeout(() => URL.revokeObjectURL(url), 2000)
  }

  const canGenerate = form.source_text.trim().length >= 40
  const keyOk = config.data?.configured !== false

  if (query.isLoading || !p) {
    return <div className="flex h-full items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-[var(--app-accent)]" /></div>
  }

  const primary = (() => {
    if (stage === 'script') return { label: 'Genera sceneggiatura', Icon: Sparkles, run: () => genScript.mutate(), disabled: !canGenerate || genScript.isPending || busy }
    if (stage === 'storyboard') return { label: keyframes ? 'Completa storyboard' : 'Genera storyboard', Icon: Sparkles, run: () => startStoryboard.mutate(undefined), disabled: busy || !keyOk }
    if (stage === 'render') return { label: 'Monta il video', Icon: Play, run: () => startRender.mutate(undefined), disabled: busy }
    return { label: 'Scarica MP4', Icon: Download, run: download, disabled: false }
  })()

  const steps: Array<{ key: Stage; label: string; done: boolean }> = [
    { key: 'script', label: 'Sceneggiatura', done: hasScript },
    { key: 'storyboard', label: 'Storyboard', done: hasScript && keyframes === shots.length },
    { key: 'render', label: 'Montaggio', done: p.has_final },
  ]
  const totalSeconds = shots.length * shotSeconds
  const saving = saveForm.isPending || saveScript.isPending

  return (
    <div className="flex h-full min-h-0 flex-col text-[var(--text-primary)]">
      {/* header */}
      <header className="ds-frame-header flex shrink-0 flex-wrap items-center gap-3 px-4 py-3">
        <IconButton tone="neutral" surface="ghost" size="sm" onClick={() => navigate('/teacher/video-studio')} title="Tutti i video"><ArrowLeft /></IconButton>
        <Input
          value={form.title}
          onChange={(e) => patchForm({ title: e.target.value })}
          density="compact"
          className="max-w-[300px] flex-1 font-bold"
          aria-label="Titolo del video"
        />
        <ol className="hidden items-center gap-1.5 md:flex">
          {steps.map((s, i) => {
            const active = !s.done && steps.slice(0, i).every((x) => x.done)
            return (
              <li key={s.key}>
                <Badge tone={s.done ? 'success' : active ? 'accent' : 'neutral'} surface="soft" density="compact">
                  {s.done ? <Check className="h-3 w-3" /> : <span>{i + 1}</span>}{s.label}
                </Badge>
              </li>
            )
          })}
        </ol>
        <div className="ml-auto flex items-center gap-3">
          <span className="hidden text-xs text-[var(--text-secondary)] sm:inline">
            {saving ? 'Salvo…' : formDirty || scriptDirty ? 'Modifiche non salvate' : `Spesa stimata $${p.cost_usd.toFixed(2)}`}
          </span>
          {stage === 'storyboard' && estimate ? <span className="hidden text-xs text-[var(--text-secondary)] md:inline">~${estimate.toFixed(2)}</span> : null}
          <Button tone="accent" surface="solid" density="default" onClick={primary.run} disabled={primary.disabled}>
            {genScript.isPending || busy ? <Loader2 className="animate-spin" /> : <primary.Icon />}
            {busy ? (p.phase_label || STATUS_LABEL[p.status]) : primary.label}
          </Button>
        </div>
      </header>

      {p.error && <div className="shrink-0 bg-[color-mix(in_srgb,var(--logo-pink)_12%,transparent)] px-4 py-2 text-xs text-[var(--logo-pink)]">{p.error}</div>}
      {config.data && !config.data.configured && (
        <div className="shrink-0 bg-[color-mix(in_srgb,var(--logo-violet)_10%,transparent)] px-4 py-2 text-xs text-[var(--text-secondary)]">
          OPENAI_API_KEY mancante nel file .env: non è possibile generare le immagini.
        </div>
      )}

      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto lg:flex-row lg:overflow-hidden">
        {/* left rail: direction */}
        <aside className="ds-frame-sidebar w-full shrink-0 space-y-5 p-4 lg:w-[272px] lg:overflow-y-auto">
          <div>
            <Label>Stile visivo</Label>
            <div className="grid grid-cols-2 gap-2">
              {config.data?.styles.map((s) => {
                const on = form.style_key === s.key
                return (
                  <button
                    key={s.key}
                    type="button"
                    disabled={busy}
                    onClick={() => patchForm({ style_key: s.key })}
                    className={`overflow-hidden rounded-[var(--control-radius)] text-left text-xs font-semibold transition disabled:opacity-60 ${on ? 'ds-selected' : 'ds-control'}`}
                  >
                    <div className="h-9" style={{ background: STYLE_SWATCH[s.key] }} />
                    <div className="px-2 py-1.5">{s.label}</div>
                  </button>
                )
              })}
            </div>
            {keyframes > 0 && <p className="mt-2 text-[11px] text-[var(--text-secondary)]">Il nuovo stile vale dalle prossime immagini.</p>}
          </div>

          <div>
            <Label>Formato</Label>
            <div className="flex gap-2">
              {config.data?.aspects.map((a) => (
                <Button key={a} density="compact" tone={form.aspect === a ? 'accent' : 'neutral'} surface={form.aspect === a ? 'solid' : 'soft'}
                  className="flex-1" disabled={busy || keyframes > 0} onClick={() => patchForm({ aspect: a })}>{a}</Button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Narrazione</Label>
              <Select density="compact" value={form.language} onChange={(e) => patchForm({ language: e.target.value })}>
                <option value="it">Italiano</option><option value="en">English</option>
              </Select>
            </div>
            <div>
              <Label>Shot (~{form.target_shots * shotSeconds}s)</Label>
              <Input type="number" min={2} max={12} density="compact" value={form.target_shots}
                onChange={(e) => patchForm({ target_shots: Math.max(2, Math.min(12, Number(e.target.value) || 6)) })} />
            </div>
          </div>

          {hasScript && (
            <>
              <div>
                <Label>Nota di regia</Label>
                <Textarea {...areaProps} rows={4} className="min-h-0" value={form.brief} onChange={(e) => patchForm({ brief: e.target.value })} placeholder="Cosa vuoi trasmettere e come…" />
              </div>
              <div>
                <Label>Testo sorgente</Label>
                <Textarea {...areaProps} rows={6} className="min-h-0" value={form.source_text} onChange={(e) => patchForm({ source_text: e.target.value })} />
              </div>
              <Button tone="neutral" surface="soft" density="compact" fullWidth disabled={busy || genScript.isPending || !canGenerate}
                onClick={() => window.confirm('Rigenerare la sceneggiatura? Storyboard e video attuali verranno persi.') && genScript.mutate()}>
                <RefreshCw />Rigenera sceneggiatura
              </Button>
            </>
          )}
        </aside>

        {/* center: stage + timeline */}
        <section className="flex min-h-[420px] min-w-0 flex-1 flex-col gap-3 p-3 lg:min-h-0 lg:p-4">
          {!hasScript ? (
            <Composer form={form} onChange={patchForm} onPickFile={() => fileInput.current?.click()}
              generating={genScript.isPending} canGenerate={canGenerate} onGenerate={() => genScript.mutate()} />
          ) : (
            <>
              <div className="ui-card flex min-h-[260px] flex-1 items-center justify-center overflow-hidden p-3 lg:min-h-0">
                {selected === 'film' && p.has_final ? (
                  <AuthMedia projectId={p.id} name="final.mp4" kind="video" version={p.updated_at || ''}
                    className="max-h-full max-w-full rounded-[var(--control-radius)] bg-black" />
                ) : current ? (
                  <StageView project={p} shot={current} ratio={ratio}
                    onGenerate={stage === 'storyboard' && !busy && keyOk ? () => startStoryboard.mutate(undefined) : undefined} estimate={estimate} />
                ) : null}
              </div>

              <div className="ui-card shrink-0 p-3">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold">
                    Timeline · {shots.length} shot · {Math.floor(totalSeconds / 60)}:{String(totalSeconds % 60).padStart(2, '0')}
                    <span className="ml-2 font-normal text-[var(--text-secondary)]">{keyframes}/{shots.length} immagini · {clips}/{shots.length} clip</span>
                  </span>
                  <Button tone="neutral" surface="soft" density="compact" onClick={addShot} disabled={busy || shots.length >= 12}><Plus />Shot</Button>
                </div>
                <div className="flex gap-2 overflow-x-auto pb-1">
                  {p.has_final && (
                    <button type="button" onClick={() => setSelected('film')}
                      className={`flex h-[84px] w-[116px] shrink-0 flex-col items-center justify-center gap-1 rounded-[var(--control-radius)] text-xs font-semibold ${selected === 'film' ? 'ds-selected' : 'ds-control'}`}>
                      <Film className="h-5 w-5" />Film completo
                    </button>
                  )}
                  {shots.map((s) => (
                    <ShotCard key={s.n} project={p} shot={s} active={selected === s.n} seconds={shotSeconds}
                      onClick={() => { setSelected(s.n); setTab('shot') }} />
                  ))}
                </div>
              </div>
            </>
          )}
          <input ref={fileInput} type="file" hidden accept=".pdf,.docx,.pptx,.txt,.md" onChange={(e) => { onFile(e.target.files?.[0]); e.target.value = '' }} />
        </section>

        {/* right: inspector */}
        {hasScript && (
          <aside className="ds-frame-sidebar flex w-full shrink-0 flex-col lg:w-[320px] lg:overflow-hidden">
            <div className="flex shrink-0 gap-1.5 p-3">
              {(['shot', 'cast'] as const).map((t) => (
                <Button key={t} density="compact" className="flex-1" tone={tab === t ? 'accent' : 'neutral'} surface={tab === t ? 'solid' : 'soft'} onClick={() => setTab(t)}>
                  {t === 'shot' ? `Shot ${current?.n ?? ''}` : `Cast (${entities.length})`}
                </Button>
              ))}
            </div>
            <div className="min-h-0 flex-1 space-y-4 px-4 pb-5 lg:overflow-y-auto">
              {tab === 'shot' && current && (
                <>
                  <div>
                    <Label>Titolo</Label>
                    <Input density="compact" value={current.title} onChange={(e) => editShot(current.n, { title: e.target.value })} />
                  </div>
                  <div>
                    <Label>Voce narrante (didascalia)</Label>
                    <Textarea {...areaProps} rows={3} className="min-h-0" value={current.narration} onChange={(e) => editShot(current.n, { narration: e.target.value })} />
                  </div>
                  <div>
                    <Label>Prima inquadratura</Label>
                    <Textarea {...areaProps} rows={5} className="min-h-0" value={current.visual} onChange={(e) => editShot(current.n, { visual: e.target.value })} />
                  </div>
                  <div>
                    <Label>Movimento ({shotSeconds}s)</Label>
                    <Textarea {...areaProps} rows={3} className="min-h-0" value={current.motion} onChange={(e) => editShot(current.n, { motion: e.target.value })} />
                  </div>
                  <div>
                    <Label>Chi compare</Label>
                    <div className="flex flex-wrap gap-1.5">
                      {entities.map((e) => {
                        const on = current.entities.includes(e.id)
                        return (
                          <Button key={e.id} density="compact" tone={on ? 'accent' : 'neutral'} surface={on ? 'soft' : 'ghost'}
                            onClick={() => editShot(current.n, { entities: on ? current.entities.filter((x) => x !== e.id) : [...current.entities, e.id] })}>
                            {e.name}
                          </Button>
                        )
                      })}
                    </div>
                  </div>
                  {current.error && <p className="rounded-[var(--control-radius)] bg-[color-mix(in_srgb,var(--logo-pink)_12%,transparent)] p-3 text-xs text-[var(--logo-pink)]">{current.error}</p>}
                  <div className="flex flex-wrap gap-2">
                    <Button tone="neutral" surface="soft" density="compact" disabled={busy || !keyOk} onClick={() => startStoryboard.mutate([current.n])}><RefreshCw />Immagine</Button>
                    {current.keyframe_key && <Button tone="neutral" surface="soft" density="compact" disabled={busy} onClick={() => startRender.mutate([current.n])}><Play />Clip</Button>}
                    <IconButton tone="danger" surface="ghost" size="sm" className="ml-auto" title="Rimuovi shot" disabled={busy || shots.length <= 1} onClick={() => removeShot(current.n)}><Trash2 /></IconButton>
                  </div>
                </>
              )}
              {tab === 'cast' && (
                <>
                  <p className="text-xs leading-relaxed text-[var(--text-secondary)]">
                    Descrizione visiva bloccata di ogni personaggio o oggetto, riusata identica in tutti gli shot per mantenerne l’aspetto.
                    Se la modifichi, rigenera l’immagine degli shot in cui compare.
                  </p>
                  {entities.map((e) => (
                    <div key={e.id} className="ui-card space-y-2 p-3">
                      <div className="flex items-center gap-2">
                        <Input density="compact" className="flex-1 font-bold" value={e.name} onChange={(ev) => editEntity(e.id, { name: ev.target.value })} />
                        <Badge tone="neutral" surface="soft" density="compact">{e.kind}</Badge>
                      </div>
                      {e.sheet_key && <AuthMedia projectId={p.id} name={`sheet_${e.id}.jpg`} kind="img" version={String(e.sheet_ver || '')} className="w-full rounded-[var(--control-radius)] bg-[var(--ds-surface-muted)] object-contain" />}
                      <Textarea {...areaProps} rows={4} className="min-h-0" value={e.description} onChange={(ev) => editEntity(e.id, { description: ev.target.value })} />
                    </div>
                  ))}
                  <div>
                    <Label>Linguaggio visivo (tutti gli shot)</Label>
                    <Textarea {...areaProps} rows={4} className="min-h-0" value={script.style_bible || ''} onChange={(e) => edit({ style_bible: e.target.value })} />
                  </div>
                </>
              )}
            </div>
          </aside>
        )}
      </div>
    </div>
  )
}

function Composer({ form, onChange, onPickFile, generating, canGenerate, onGenerate }: {
  form: { source_text: string; brief: string }
  onChange: (patch: Record<string, string>) => void
  onPickFile: () => void
  generating: boolean
  canGenerate: boolean
  onGenerate: () => void
}) {
  if (generating) {
    return (
      <div className="ui-card flex flex-1 flex-col items-center justify-center gap-5 p-8 text-center">
        <Loader2 className="h-8 w-8 animate-spin text-[var(--app-accent)]" />
        <div>
          <p className="text-base font-bold">Sto scrivendo la sceneggiatura…</p>
          <p className="mt-1 text-sm text-[var(--text-secondary)]">Cast, linguaggio visivo e shot: servono circa 30–60 secondi.</p>
        </div>
        <div className="flex gap-2">
          {[0, 1, 2, 3, 4].map((i) => <div key={i} className="h-14 w-20 animate-pulse rounded-[var(--control-radius)] bg-[var(--ds-surface-muted)]" style={{ animationDelay: `${i * 120}ms` }} />)}
        </div>
      </div>
    )
  }
  return (
    <div className="flex flex-1 items-start justify-center overflow-y-auto lg:items-center">
      <div className="ui-card w-full max-w-3xl space-y-4 p-5">
        <div>
          <h2 className="text-xl font-black tracking-tight">Cosa vuoi spiegare?</h2>
          <p className="mt-1 text-sm text-[var(--text-secondary)]">Incolla un testo o carica un documento, poi dirigi: cosa trasmettere e come.</p>
        </div>
        <Textarea density="roomy" resize="none" rows={9} className="min-h-0" value={form.source_text}
          onChange={(e) => onChange({ source_text: e.target.value })}
          placeholder="Incolla qui la lezione, gli appunti o il testo da trasformare in video…" />
        <div>
          <span className="mb-1.5 block text-[11px] font-semibold text-[var(--text-secondary)]">Nota di regia</span>
          <Textarea density="compact" resize="none" rows={2} className="min-h-0" value={form.brief}
            onChange={(e) => onChange({ brief: e.target.value })}
            placeholder="Es. Spiega la fotosintesi come un viaggio della luce dentro la foglia, tono curioso, un solo personaggio guida" />
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Button tone="neutral" surface="soft" onClick={onPickFile}><Paperclip />Carica documento</Button>
          <div className="flex items-center gap-3">
            <span className="text-xs text-[var(--text-secondary)]">{form.source_text.length.toLocaleString('it-IT')} caratteri{!canGenerate && form.source_text.length > 0 ? ' · minimo 40' : ''}</span>
            <Button tone="accent" surface="solid" density="roomy" onClick={onGenerate} disabled={!canGenerate}><Sparkles />Genera sceneggiatura</Button>
          </div>
        </div>
      </div>
    </div>
  )
}

function StageView({ project, shot, ratio, onGenerate, estimate }: {
  project: Project; shot: Shot; ratio: number; onGenerate?: () => void; estimate?: number | null
}) {
  const wide = ratio >= 1
  const busyShot = shot.status === 'rendering'
  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-3">
      <div className="flex min-h-0 w-full flex-1 items-center justify-center">
        {shot.video_key ? (
          <AuthMedia projectId={project.id} name={`shot_${shot.n}.mp4`} kind="video" version={String(shot.video_ver || '')}
            className="max-h-full max-w-full rounded-[var(--control-radius)] bg-black" />
        ) : shot.keyframe_key ? (
          <AuthMedia projectId={project.id} name={`key_${shot.n}.jpg`} kind="img" version={String(shot.keyframe_ver || '')}
            className={`max-h-full max-w-full rounded-[var(--control-radius)] bg-[var(--ds-surface-muted)] object-contain ${busyShot ? 'opacity-60' : ''}`} />
        ) : (
          <div className="flex items-center justify-center rounded-[var(--control-radius)] bg-[var(--ds-surface-muted)] p-6 text-center"
            style={{ aspectRatio: String(ratio), width: wide ? 'min(100%, 720px)' : 'min(70%, 320px)', maxHeight: '100%' }}>
            <div>
              <Film className="mx-auto mb-3 h-7 w-7 text-[var(--text-secondary)]" />
              <p className="line-clamp-4 text-sm leading-relaxed text-[var(--text-secondary)]">{shot.visual || 'Shot senza descrizione'}</p>
              {onGenerate ? (
                <Button tone="accent" surface="solid" className="mt-4" onClick={onGenerate}>
                  <Sparkles />Genera storyboard{estimate ? ` · ~$${estimate.toFixed(2)}` : ''}
                </Button>
              ) : <p className="mt-3 text-xs text-[var(--text-secondary)]">Immagine non ancora generata</p>}
            </div>
          </div>
        )}
      </div>
      {shot.narration && <p className="max-w-2xl shrink-0 text-center text-sm italic text-[var(--text-secondary)]">«{shot.narration}»</p>}
    </div>
  )
}

function ShotCard({ project, shot, active, seconds, onClick }: {
  project: Project; shot: Shot; active: boolean; seconds: number; onClick: () => void
}) {
  const state = shot.video_key ? 'video' : shot.keyframe_key ? 'image' : shot.status === 'failed' ? 'failed' : 'empty'
  const dot = { video: 'bg-[var(--logo-blue)]', image: 'bg-[var(--logo-violet)]', failed: 'bg-[var(--logo-pink)]', empty: 'bg-[var(--text-secondary)] opacity-40' }[state]
  return (
    <button
      type="button"
      onClick={onClick}
      className={`relative h-[84px] w-[132px] shrink-0 overflow-hidden rounded-[var(--control-radius)] text-left ${active ? 'ds-selected' : 'ds-control'}`}
    >
      {shot.keyframe_key
        ? <AuthMedia projectId={project.id} name={`key_${shot.n}.jpg`} kind="img" version={String(shot.keyframe_ver || '')} className="h-full w-full object-cover" />
        : <div className="flex h-full w-full items-center justify-center text-[11px] text-[var(--text-secondary)]">{shot.n}</div>}
      <div className="absolute inset-x-0 bottom-0 flex items-center gap-1.5 bg-gradient-to-t from-black/75 to-transparent px-2 pb-1.5 pt-5">
        <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${dot}`} />
        <span className="truncate text-[11px] font-semibold text-white">{shot.n}. {shot.title}</span>
      </div>
      <span className="absolute right-1.5 top-1.5 rounded-md bg-black/55 px-1.5 py-0.5 text-[10px] font-semibold text-white">{seconds}s</span>
    </button>
  )
}
