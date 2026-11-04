import { SearchableSelect } from '@/components/ui/searchable-select'
import { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ArrowLeft, Download, Film, FolderOpen, Loader2, Pause, Paperclip, Play, RefreshCw, Scissors,
  SkipForward, Sparkles, Trash2, Upload, Volume2, ZoomIn,
} from '@/components/icons'
import { Button, IconButton, Input, Select, Textarea } from '@/design'
import { adminApi } from '@/lib/api'
import { useToast } from '@/components/ui/use-toast'
import { Monitor } from '@/components/videostudio/Monitor'
import { DrivePicker } from '@/components/videostudio/DrivePicker'
import { Timeline, fmtTime } from '@/components/videostudio/Timeline'
import { usePlayback } from '@/components/videostudio/usePlayback'
import {
  STATUS_LABEL, isBusy,
  type Project, type Script, type Shot, type VideoModel, type VideoStudioConfig, type VoiceOption,
} from '@/components/videostudio/types'
import type { DriveItem } from '@/components/drive/driveTypes'
import { driveApi } from '@/lib/api'
import { notifyJobsChanged } from '@/lib/backgroundJobs'
import { tl } from '@/i18n/tl'

const api = adminApi.videoStudio
const LOCAL = 'local'
const Label = ({ children }: { children: React.ReactNode }) => (
  <span className="mb-1 block text-[11px] font-semibold text-[var(--text-secondary)]">{children}</span>
)
const newId = () => Math.random().toString(36).slice(2, 10)
const credits = (v: number) => v.toLocaleString('it-IT', { maximumFractionDigits: v < 10 ? 1 : 0 })
const remember = (key: string, value?: string) => { try { value === undefined ? localStorage.getItem(key) : localStorage.setItem(key, value) } catch { /* private mode */ } }
const recall = (key: string) => { try { return localStorage.getItem(key) || '' } catch { return '' } }
const pickDuration = (options: number[], wanted: number) => [...options].sort((a, b) => a - b).find((d) => d >= wanted) ?? Math.max(...options)
const refreshCredits = () => window.dispatchEvent(new Event('focus')) // the navbar balance pill reloads on focus

export default function VideoStudioEditorPage() {
  const { projectId = '' } = useParams()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const { toast } = useToast()
  const fileInput = useRef<HTMLInputElement>(null)
  const clipInput = useRef<HTMLInputElement>(null)
  const fail = (title: string) => (err: any) =>
    toast({ variant: 'destructive', title, description: err?.response?.data?.detail || tl("Riprova tra poco.") })

  const config = useQuery<VideoStudioConfig>({ queryKey: ['vs', 'config'], queryFn: async () => (await api.config()).data })
  const query = useQuery<Project>({
    queryKey: ['vs', 'project', projectId],
    queryFn: async () => (await api.get(projectId)).data,
    refetchInterval: (q) => (isBusy(q.state.data as Project | undefined) ? 2500 : false),
  })
  const p = query.data
  const models = useQuery<VideoModel[]>({ queryKey: ['vs', 'video-models'], queryFn: async () => (await api.videoModels()).data, enabled: !!config.data?.openrouter_configured, staleTime: 10 * 60 * 1000 })
  const voices = useQuery<VoiceOption[]>({ queryKey: ['vs', 'voices'], queryFn: async () => (await api.voices()).data, enabled: !!config.data?.voice_configured, staleTime: 10 * 60 * 1000 })

  // render choices (model / duration / resolution / voice)
  const [videoModel, setVideoModel] = useState('')
  const [videoDuration, setVideoDuration] = useState<number | null>(null) // null = sized on the narration
  const [videoResolution, setVideoResolution] = useState('')
  const [voiceId, setVoiceId] = useState('')
  const renderProject = useRef('')
  useEffect(() => {
    if (!p || renderProject.current === p.id) return
    renderProject.current = p.id
    const r = p.script?.render_settings
    setVideoModel(r?.provider === 'openrouter' ? r.model || '' : r?.provider === 'local' && p.script?.shots?.some((s) => s.video_key) ? LOCAL : recall('vs:model'))
    setVideoDuration(r?.provider === 'openrouter' ? r.duration ?? null : null)
    setVideoResolution(r?.provider === 'openrouter' ? r.resolution ?? '' : '')
    setVoiceId(p.script?.voice?.voice_id || recall('vs:voice'))
  }, [p])
  useEffect(() => { // default: cheapest catalogue model, as the list arrives sorted by price
    if (!videoModel && models.data?.length) setVideoModel(models.data[0].id)
  }, [models.data, videoModel])
  useEffect(() => { // a voice-over needs a voice: preselect the first one so narration is never silently skipped
    if (!voiceId && voices.data?.length) setVoiceId(voices.data[0].voice_id)
  }, [voices.data, voiceId])
  const model = models.data?.find((m) => m.id === videoModel)
  const voice = voices.data?.find((v) => v.voice_id === voiceId)
  const resolution = videoResolution || model?.default_resolution || ''

  const [form, setForm] = useState({ title: '', source_text: '', brief: '', style_key: 'flat_2d', aspect: '16:9', language: 'it', target_shots: 6 })
  const [script, setScript] = useState<Script>({})
  const [formDirty, setFormDirty] = useState(false)
  const [scriptDirty, setScriptDirty] = useState(false)
  const [selectedId, setSelectedId] = useState<string>()
  const [zoom, setZoom] = useState(48)
  const [showSource, setShowSource] = useState(false)
  const [driveOpen, setDriveOpen] = useState(false)
  const [addOpen, setAddOpen] = useState(false)
  const [junction, setJunction] = useState<{ index: number; x: number; y: number } | null>(null)

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
    refreshCredits()
    notifyJobsChanged() // a generation may have started: show it in the navbar
  }
  const saveForm = useMutation({
    mutationFn: async () => (await api.update(projectId, form)).data,
    onSuccess: () => { setFormDirty(false); refresh() },
  })
  const saveScript = useMutation({
    mutationFn: async () => (await api.saveScript(projectId, script)).data,
    onSuccess: () => { setScriptDirty(false); refresh() },
    onError: fail(tl("Salvataggio non riuscito")),
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
    const t = setTimeout(() => saveScript.mutate(), 1000)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [script, scriptDirty, busy])
  const flushEdits = async () => {
    if (formDirty) { await api.update(projectId, form); setFormDirty(false) }
    if (scriptDirty) { await api.saveScript(projectId, script); setScriptDirty(false) }
  }

  const shots = script.shots || []
  const entities = script.entities || []
  const hasScript = shots.length > 0
  const aiShots = shots.filter((s) => s.source !== 'upload')
  const withKeyframe = aiShots.filter((s) => s.keyframe_key).length
  const selected = shots.find((s) => s.id === selectedId) || shots[0]
  const play = usePlayback(shots)

  const renderOptions = (): Parameters<typeof api.render>[2] => {
    const chosen = voice ? { voice_id: voice.voice_id, name: voice.name } : null
    return videoModel === LOCAL || !videoModel
      ? { provider: 'local', voice: chosen }
      : { provider: 'openrouter', model: videoModel, duration: videoDuration, resolution: resolution || undefined, voice: chosen }
  }

  const genScript = useMutation({
    mutationFn: async () => { await flushEdits(); return (await api.generateScript(projectId)).data as Project },
    onSuccess: () => { setScriptDirty(false); setShowSource(false); setSelectedId(undefined); refresh() },
    onError: fail(tl("Sceneggiatura non generata")),
  })
  const startStoryboard = useMutation({
    mutationFn: async (ids?: string[]) => { await flushEdits(); return (await api.storyboard(projectId, ids)).data },
    onSuccess: refresh, onError: fail(tl("Immagini non avviate")),
  })
  const startRender = useMutation({
    mutationFn: async (ids?: string[]) => { await flushEdits(); return (await api.render(projectId, ids, renderOptions())).data },
    onSuccess: () => { remember('vs:model', videoModel); remember('vs:voice', voiceId); refresh() },
    onError: fail(tl("Generazione clip non avviata")),
  })
  const startAssemble = useMutation({
    mutationFn: async () => { await flushEdits(); return (await api.assemble(projectId)).data },
    onSuccess: refresh, onError: fail(tl("Montaggio non avviato")),
  })
  const addUpload = useMutation({
    mutationFn: async ({ file, name }: { file: File | Blob; name: string }) => { await flushEdits(); return (await api.uploadClip(projectId, file, name)).data as Project },
    onSuccess: (proj) => { setScriptDirty(false); setScript(proj.script || {}); setSelectedId(proj.script?.shots?.slice(-1)[0]?.id); refresh() },
    onError: fail(tl("Clip non caricata")),
  })
  const addClip = useMutation({
    mutationFn: async ({ prompt, position }: { prompt: string; position: number }) => { await flushEdits(); return (await api.generateClip(projectId, prompt, position)).data as Project & { new_shot_id: string } },
    onSuccess: (proj) => { setAddOpen(false); setScriptDirty(false); setScript(proj.script || {}); setSelectedId(proj.new_shot_id); refresh() },
    onError: fail(tl("Clip non generata")),
  })
  const importFromDrive = async (item: DriveItem) => {
    setDriveOpen(false)
    try {
      const blob = (await driveApi.content(item.id)).data as Blob
      addUpload.mutate({ file: blob, name: item.name })
    } catch (err) { fail(tl("Lettura dal Drive non riuscita"))(err) }
  }

  // ── cost estimates, in credits ──
  const durationFor = (s: Shot) => videoDuration ?? pickDuration(model?.supported_durations?.length ? model.supported_durations : [5], ((s.narration || '').trim().length / (config.data?.chars_per_second ?? 14)) + 0.6)
  const perSecond = model ? (model.credits_per_second[resolution || 'default'] ?? Math.min(...Object.values(model.credits_per_second), Infinity)) : 0
  const settingsChanged = hasScript && shots.some((s) => s.video_key && s.source !== 'upload') && (() => {
    const r = script.render_settings
    if (videoModel === LOCAL) return r?.provider !== 'local'
    return !r || r.provider !== 'openrouter' || r.model !== videoModel || (r.duration ?? null) !== videoDuration || (r.resolution ?? '') !== resolution
  })()
  const needClips = aiShots.filter((s) => s.keyframe_key && (!s.video_key || settingsChanged))
  const needVoiceShots = voice ? shots.filter((s) => s.narration.trim() && (!s.audio_key || script.voice?.voice_id !== voice.voice_id)) : []
  const clipCredits = videoModel === LOCAL ? 0 : needClips.reduce((sum, s) => sum + durationFor(s) * (Number.isFinite(perSecond) ? perSecond : 0), 0)
  const voiceCredits = needVoiceShots.reduce((sum, s) => sum + s.narration.trim().length, 0) / 1000 * (config.data?.voice_credits_per_1000_chars ?? 0)
  const imageCredits = (aiShots.length - withKeyframe) * (config.data?.image_credits ?? 0)
    + entities.filter((e) => !e.sheet_key && aiShots.filter((s) => s.entities.includes(e.id)).length >= 2).length * (config.data?.sheet_credits ?? 0)
  const refSeconds = aiShots.length ? aiShots.reduce((sum, s) => sum + Math.max(1, (s.narration || '').trim().length / (config.data?.chars_per_second ?? 14) + 0.6), 0) / aiShots.length : 5
  const modelOptions = (() => {
    const rows = (models.data || []).map((m) => {
      const res = m.default_resolution || Object.keys(m.credits_per_second)[0] || 'default'
      const cps = m.credits_per_second[res] ?? Math.min(...Object.values(m.credits_per_second))
      const seconds = videoDuration && m.supported_durations.includes(videoDuration) ? videoDuration : pickDuration(m.supported_durations, refSeconds)
      return { m, res, cps: Number.isFinite(cps) ? cps : null, seconds }
    })
    const priced = rows.map((r) => r.cps).filter((v): v is number => v !== null).sort((a, b) => a - b)
    const low = priced[Math.floor(priced.length / 3)], high = priced[Math.floor(priced.length * 0.8)]
    return rows.map(({ m, res, cps, seconds }) => ({
      value: m.id, label: m.name, searchText: m.id,
      description: cps === null ? tl("prezzo non indicato dal provider")
        : `${cps <= low ? '● ' + tl("economico") + ' · ' : cps >= high ? '● ' + tl("premium") + ' · ' : ''}~${credits(cps * seconds)} cr/clip (${seconds}s, ${res}) · ${credits(cps)} cr/s${m.has_audio ? ' · ' + tl("audio") : ''} · ${tl("max")} ${Math.max(...m.supported_durations)}s`,
      disabled: !!m.supported_aspect_ratios.length && !m.supported_aspect_ratios.includes(form.aspect),
    }))
  })()

  const addClipCredits = (config.data?.image_credits ?? 0) + (videoModel === LOCAL || !model ? 0 : 5 * (Number.isFinite(perSecond) ? perSecond : 0))
  const canGenerate = form.source_text.trim().length >= 40
  const edit = (patch: Partial<Script>) => { setScript((s) => ({ ...s, ...patch })); setScriptDirty(true) }
  const editShot = (id: string, patch: Partial<Shot>) => edit({ shots: shots.map((s) => (s.id === id ? { ...s, ...patch } : s)) })
  const renumber = (list: Shot[]) => list.map((s, i) => ({ ...s, n: i + 1 }))
  const reorder = (from: number, to: number) => {
    const next = [...shots]
    next.splice(to, 0, next.splice(from, 1)[0])
    edit({ shots: renumber(next) })
  }
  const removeShot = (id: string) => {
    if (shots.length <= 1) return
    edit({ shots: renumber(shots.filter((s) => s.id !== id)) })
    setSelectedId(undefined)
  }
  const splitAtPlayhead = () => {
    // Clip under the playhead; if the playhead is elsewhere, the selected clip is split at its middle.
    const under = play.current?.shot.video_key ? play.current : undefined
    const target = under ?? play.segments.find((x) => x.shot.id === selected?.id && x.shot.video_key)
    if (!target) {
      toast({ title: tl("Nessuna clip da dividere"), description: tl("Seleziona una clip con video.") })
      return
    }
    const s = target.shot
    const from = s.trim_in ?? 0
    const to = s.trim_out ?? s.clip_dur ?? 0
    let pos = from + (play.time - target.start)
    if (!under || pos < from + 0.3 || pos > to - 0.3) pos = from + (to - from) / 2
    if (to - from < 0.6) {
      toast({ title: tl("Clip troppo corta"), description: tl("Servono almeno 0,3 s per parte.") })
      return
    }
    const second: Shot = { ...s, id: newId(), clone_of: s.id, narration: '', title: `${s.title} ·2`, trim_in: +pos.toFixed(2), transition: 'none' }
    edit({ shots: renumber(shots.flatMap((x) => (x.id === s.id ? [{ ...x, trim_out: +pos.toFixed(2) }, second] : [x]))) })
    setSelectedId(second.id)
  }

  const download = async () => {
    const res = await api.file(projectId, 'final.mp4')
    const url = URL.createObjectURL(res.data)
    const a = document.createElement('a')
    a.href = url; a.download = `${(form.title || 'video').replace(/[^\w-]+/g, '_')}.mp4`; a.click()
    setTimeout(() => URL.revokeObjectURL(url), 2000)
  }
  const onFile = async (file?: File) => {
    if (!file) return
    try {
      const res = await api.extractText(file)
      patchForm({ source_text: res.data.text, ...(form.title === 'Nuovo video' ? { title: file.name.replace(/\.[^.]+$/, '') } : {}) })
      toast({ title: tl("Documento letto"), description: tl("{0} caratteri estratti", res.data.text.length.toLocaleString('it-IT')) })
    } catch (err) { fail(tl("Lettura file non riuscita"))(err) }
  }
  const patchForm = (patch: Partial<typeof form>) => { setForm((f) => ({ ...f, ...patch })); setFormDirty(true) }

  // Space bar = play / pause (unless the user is typing in a field).
  const toggleRef = useRef(play.toggle)
  toggleRef.current = play.toggle
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== 'Space' || e.repeat || e.ctrlKey || e.metaKey || e.altKey) return
      const el = e.target as HTMLElement | null
      if (el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT|BUTTON)$/.test(el.tagName) || el.closest('[role="listbox"],[role="dialog"]'))) return
      e.preventDefault()
      toggleRef.current()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  if (query.isLoading || !p) {
    return <div className="flex h-full items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-[var(--app-accent)]" /></div>
  }

  const keyOk = config.data?.configured !== false
  const primary = (() => {
    if (!hasScript) return { label: tl("Genera sceneggiatura"), Icon: Sparkles, run: () => genScript.mutate(), disabled: !canGenerate || genScript.isPending || busy, hint: '' }
    if (withKeyframe < aiShots.length) return { label: withKeyframe ? tl("Completa le immagini") : tl("Genera le immagini"), Icon: Sparkles, run: () => startStoryboard.mutate(undefined), disabled: busy || !keyOk, hint: imageCredits ? `~${credits(imageCredits)} cr` : '' }
    if (needClips.length || needVoiceShots.length || (settingsChanged && needClips.length)) {
      return { label: videoModel === LOCAL ? tl("Anima e monta") : tl("Genera clip e voce"), Icon: Film, run: () => startRender.mutate(undefined), disabled: busy || (!videoModel && !models.data?.length && videoModel !== LOCAL), hint: `~${credits(clipCredits + voiceCredits)} cr` }
    }
    if (!p.has_final) return { label: tl("Monta ed esporta"), Icon: Film, run: () => startAssemble.mutate(), disabled: busy || scriptDirty, hint: '' }
    return { label: tl("Scarica MP4"), Icon: Download, run: download, disabled: false, hint: '' }
  })()
  const saving = saveForm.isPending || saveScript.isPending
  const ratio = (() => { const [a, b] = (form.aspect || '16:9').split(':').map(Number); return a && b ? a / b : 16 / 9 })()
  const step = (dir: number) => {
    const i = Math.max(0, play.segments.findIndex((s) => s.shot.id === play.current?.shot.id))
    const target = play.segments[Math.max(0, Math.min(play.segments.length - 1, i + dir))]
    if (target) { play.seek(target.start); setSelectedId(target.shot.id) }
  }

  return (
    <div className="flex h-full min-h-0 flex-col text-[var(--text-primary)]">
      <header className="ds-frame-header flex shrink-0 flex-wrap items-center gap-x-2 gap-y-2 px-3 py-2">
        <IconButton tone="neutral" surface="ghost" size="sm" onClick={() => navigate('/teacher/video-studio')} title={tl("Tutti i video")}><ArrowLeft /></IconButton>
        <Input value={form.title} onChange={(e) => patchForm({ title: e.target.value })} density="compact" className="w-[200px] shrink-0 font-bold" aria-label={tl("Titolo del video")} />
        {hasScript && !showSource && (
          <>
            <SearchableSelect className="w-[210px] shrink-0" menuClassName="left-0 right-auto w-[30rem] max-w-[90vw]" value={videoModel} disabled={busy} label={tl("Modello video")}
              onChange={(value) => { setVideoModel(value); setVideoDuration(null); setVideoResolution('') }}
              options={[{ value: LOCAL, label: tl("Animazione da immagini"), description: tl("Gratuita · zoom sull'immagine") }, ...modelOptions]} />
            <div className="w-[92px] shrink-0">
              <Select density="compact" title={tl("Durata clip")} aria-label={tl("Durata clip")} disabled={busy || !model} value={videoDuration ?? 'auto'} onChange={(e) => setVideoDuration(e.target.value === 'auto' ? null : Number(e.target.value))}>
                <option value="auto">{tl("Auto")}</option>
                {model?.supported_durations.map((d) => <option key={d} value={d}>{d}s</option>)}
              </Select>
            </div>
            <div className="w-[104px] shrink-0">
              <Select density="compact" title={tl("Risoluzione")} aria-label={tl("Risoluzione")} disabled={busy || !model} value={resolution} onChange={(e) => setVideoResolution(e.target.value)}>
                {model?.supported_resolutions.length ? model.supported_resolutions.map((r) => <option key={r} value={r}>{r}</option>) : <option value="">HD</option>}
              </Select>
            </div>
            <SearchableSelect className="w-[190px] shrink-0" menuClassName="left-0 right-auto w-[22rem] max-w-[90vw]" value={voiceId} disabled={busy} label={tl("Voce narrante")} onChange={setVoiceId}
              options={[{ value: '', label: tl("Nessuna voce") }, ...(voices.data || []).map((v) => ({
                value: v.voice_id, label: v.name, searchText: Object.values(v.labels || {}).join(' '),
                description: Object.values(v.labels || {}).slice(0, 3).join(' · ') }))]} />
            <VoicePreview url={voice?.preview_url} />
          </>
        )}
        <div className="ml-auto flex items-center gap-2">
          <span className="hidden text-xs text-[var(--text-secondary)] 2xl:inline">
            {saving ? tl("Salvo…") : formDirty || scriptDirty ? tl("Modifiche non salvate") : tl("Speso {0} crediti", credits(p.cost_credits))}
          </span>
          {hasScript && <IconButton tone="neutral" surface="soft" size="sm" title={tl("Testo del video")} onClick={() => setShowSource((v) => !v)}><Paperclip /></IconButton>}
          <Button tone="accent" surface="solid" onClick={primary.run} disabled={primary.disabled}>
            {genScript.isPending || busy ? <Loader2 className="animate-spin" /> : <primary.Icon />}
            {busy ? (p.phase_label || STATUS_LABEL[p.status]) : primary.label}
            {!busy && primary.hint ? <span className="ml-1 opacity-80">{primary.hint}</span> : null}
          </Button>
        </div>
      </header>

      {p.error && <div className="shrink-0 bg-[color-mix(in_srgb,var(--logo-pink)_12%,transparent)] px-4 py-1.5 text-xs text-[var(--logo-pink)]">{p.error}</div>}
      {config.data && !config.data.configured && (
        <div className="shrink-0 bg-[color-mix(in_srgb,var(--logo-violet)_10%,transparent)] px-4 py-1.5 text-xs text-[var(--text-secondary)]">
          {tl("OPENAI_API_KEY mancante nel file .env: non è possibile generare le immagini.")}
        </div>
      )}

      {!hasScript || showSource ? (
        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          <Composer form={form} config={config.data} hasScript={hasScript} onChange={patchForm} onPickFile={() => fileInput.current?.click()}
            generating={genScript.isPending} canGenerate={canGenerate} onClose={() => setShowSource(false)}
            onGenerate={() => { if (!hasScript || window.confirm(tl("Rigenerare la sceneggiatura? Immagini, clip e voce attuali verranno persi."))) genScript.mutate() }} />
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3 lg:overflow-hidden">
          {/* monitor and inspector share the same height; the timeline spans the full width underneath */}
          <div className="grid min-h-[320px] flex-1 gap-3 lg:min-h-0 lg:grid-cols-[minmax(0,1fr)_360px]">
            <div className="ui-card min-h-[240px] p-2 lg:min-h-0">
              <Monitor projectId={p.id} ratio={ratio} segments={play.segments} time={play.time} playing={play.playing} current={play.current} />
            </div>
            {selected && (
              <ClipCard key={selected.id} shot={selected} busy={busy} imageCredits={config.data?.image_credits ?? 0}
                clipCredits={selected.source === 'upload' ? 0 : durationFor(selected) * (Number.isFinite(perSecond) ? perSecond : 0)}
                onChange={(patch) => editShot(selected.id, patch)}
                onImage={() => startStoryboard.mutate([selected.id])}
                onClip={() => startRender.mutate([selected.id])} isLocal={videoModel === LOCAL} />
            )}
          </div>
          <div className="flex shrink-0 flex-col gap-3">
            <div className="ui-card shrink-0 space-y-2 p-3">
              <div className="flex flex-wrap items-center gap-2">
                <IconButton tone="neutral" surface="soft" size="sm" title={tl("Clip precedente")} onClick={() => step(-1)}><SkipForward className="rotate-180" /></IconButton>
                <IconButton tone="accent" surface="solid" size="sm" title={tl("Riproduci / pausa (barra spazio)")} onClick={play.toggle} disabled={!play.total}>{play.playing ? <Pause /> : <Play />}</IconButton>
                <IconButton tone="neutral" surface="soft" size="sm" title={tl("Clip successiva")} onClick={() => step(1)}><SkipForward /></IconButton>
                <span className="mx-1 font-mono text-xs tabular-nums text-[var(--text-secondary)]">{fmtTime(play.time)} / {fmtTime(play.total)}</span>
                <Button tone="neutral" surface="soft" density="compact" onClick={splitAtPlayhead} disabled={busy || !shots.some((s) => s.video_key)} title={tl("Divide la clip nel punto del cursore")}><Scissors />{tl("Dividi")}</Button>
                <IconButton tone="danger" surface="ghost" size="sm" title={tl("Rimuovi clip")} onClick={() => selected && removeShot(selected.id)} disabled={busy || shots.length <= 1}><Trash2 /></IconButton>
                <div className="ml-auto flex items-center gap-2">
                  <Button tone="neutral" surface="soft" density="compact" onClick={() => setAddOpen(true)} disabled={busy || !keyOk || shots.length >= 40} title={tl("Genera una nuova clip con l'AI e inseriscila nel video")}><Sparkles />{tl("Nuova clip")}</Button>
                  <IconButton tone="neutral" surface="soft" size="sm" title={tl("Aggiungi un video dal computer")} onClick={() => clipInput.current?.click()} disabled={busy || addUpload.isPending}>
                    {addUpload.isPending ? <Loader2 className="animate-spin" /> : <Upload />}
                  </IconButton>
                  <IconButton tone="neutral" surface="soft" size="sm" title={tl("Aggiungi un video dai tuoi file")} onClick={() => setDriveOpen(true)} disabled={busy || addUpload.isPending}><FolderOpen /></IconButton>
                  <ZoomIn className="h-4 w-4 text-[var(--text-secondary)]" />
                  <input type="range" min={16} max={140} value={zoom} onChange={(e) => setZoom(Number(e.target.value))} className="w-24" aria-label="Zoom" />
                </div>
              </div>
              <Timeline projectId={p.id} segments={play.segments} total={play.total} time={play.time} zoom={zoom}
                selectedId={selected?.id} disabled={busy}
                onSelect={setSelectedId} onSeek={play.seek} onReorder={reorder}
                onEdit={editShot}
                onJunction={(index, rect) => setJunction({ index, x: rect.left, y: rect.top })} />
            </div>
          </div>
        </div>
      )}
      {addOpen && (
        <AddClipDialog shots={shots} selectedId={selected?.id} credits={credits(addClipCredits)} pending={addClip.isPending}
          onClose={() => setAddOpen(false)} onSubmit={(prompt, position) => addClip.mutate({ prompt, position })} />
      )}
      {junction && shots[junction.index] && (
        <TransitionMenu x={junction.x} y={junction.y} shot={shots[junction.index]} options={config.data?.transitions || []}
          onChange={(patch) => editShot(shots[junction.index].id, patch)} onClose={() => setJunction(null)} />
      )}
      <input ref={fileInput} type="file" hidden accept=".pdf,.docx,.pptx,.txt,.md" onChange={(e) => { onFile(e.target.files?.[0]); e.target.value = '' }} />
      <input ref={clipInput} type="file" hidden accept="video/*" onChange={(e) => { const f = e.target.files?.[0]; if (f) addUpload.mutate({ file: f, name: f.name }); e.target.value = '' }} />
      <DrivePicker open={driveOpen} onClose={() => setDriveOpen(false)} onPick={importFromDrive} />
    </div>
  )
}

function AddClipDialog({ shots, selectedId, credits: cost, pending, onClose, onSubmit }: {
  shots: Shot[]; selectedId?: string; credits: string; pending: boolean
  onClose: () => void; onSubmit: (prompt: string, position: number) => void
}) {
  const sel = shots.findIndex((s) => s.id === selectedId)
  const [prompt, setPrompt] = useState('')
  const [position, setPosition] = useState(sel >= 0 ? sel + 1 : shots.length)
  useEffect(() => {
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape' && !pending) onClose() }
    document.addEventListener('keydown', key)
    return () => document.removeEventListener('keydown', key)
  }, [onClose, pending])
  const slots = [
    { value: 0, label: tl("All'inizio") },
    ...shots.map((s, i) => ({ value: i + 1, label: i === shots.length - 1 ? tl("In fondo, dopo «{0}»", s.title) : tl("Dopo «{0}»", s.title) })),
  ]
  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/40 p-4" onPointerDown={(e) => { if (e.target === e.currentTarget && !pending) onClose() }}>
      <div role="dialog" aria-modal="true" aria-label={tl("Nuova clip")} className="ds-popover w-full max-w-lg space-y-3 rounded-[var(--card-radius)] p-4">
        <h2 className="text-base font-bold">{tl("Nuova clip")}</h2>
        <p className="text-xs text-[var(--text-secondary)]">{tl("Descrivi cosa deve mostrare. L'AI la integra nella sceneggiatura, poi genera solo immagine, clip e voce di questo pezzo: il resto del video resta com'è.")}</p>
        <Textarea autoFocus density="roomy" resize="none" rows={5} value={prompt} onChange={(e) => setPrompt(e.target.value)} disabled={pending}
          placeholder={tl("Es. «Mazzini parla ai giovani riuniti in una piazza di Marsiglia»")} />
        <div>
          <Label>{tl("Dove inserirla")}</Label>
          <Select density="compact" value={position} disabled={pending} onChange={(e) => setPosition(Number(e.target.value))}>
            {slots.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </Select>
        </div>
        <div className="flex items-center justify-end gap-2">
          <Button tone="neutral" surface="ghost" density="compact" onClick={onClose} disabled={pending}>{tl("Annulla")}</Button>
          <Button tone="accent" surface="solid" onClick={() => onSubmit(prompt.trim(), position)} disabled={pending || prompt.trim().length < 5}>
            {pending ? <Loader2 className="animate-spin" /> : <Sparkles />}{tl("Genera clip")}<span className="ml-1 opacity-80">~{cost} cr</span>
          </Button>
        </div>
      </div>
    </div>
  )
}

function VoicePreview({ url }: { url?: string | null }) {
  const audio = useRef<HTMLAudioElement>(null)
  const [on, setOn] = useState(false)
  return (
    <>
      <IconButton tone="neutral" surface="soft" size="sm" disabled={!url} title={tl("Ascolta un'anteprima della voce")}
        onClick={() => { const a = audio.current; if (!a) return; if (on) { a.pause() } else { a.currentTime = 0; void a.play() } }}>
        {on ? <Pause /> : <Volume2 />}
      </IconButton>
      {url && <audio ref={audio} src={url} onPlay={() => setOn(true)} onPause={() => setOn(false)} onEnded={() => setOn(false)} />}
    </>
  )
}

function ClipCard({ shot, busy, isLocal, imageCredits, clipCredits, onChange, onImage, onClip }: {
  shot: Shot; busy: boolean; isLocal: boolean; imageCredits: number; clipCredits: number
  onChange: (patch: Partial<Shot>) => void; onImage: () => void; onClip: () => void
}) {
  const upload = shot.source === 'upload'
  const field = (label: string, value: string, key: 'narration' | 'visual' | 'motion', grow: number, placeholder?: string) => (
    <div className="flex min-h-[72px] flex-col" style={{ flex: `${grow} 1 0` }}>
      <Label>{label}</Label>
      <Textarea density="compact" resize="none" className="min-h-0 flex-1" value={value} placeholder={placeholder} onChange={(e) => onChange({ [key]: e.target.value })} />
    </div>
  )
  return (
    <aside className="ui-card flex min-h-[420px] flex-col gap-3 overflow-hidden p-3 lg:min-h-0">
      <Input density="compact" className="shrink-0 font-bold" value={shot.title} onChange={(e) => onChange({ title: e.target.value })} aria-label={tl("Titolo clip")} />
      {field(tl("Testo della voce"), shot.narration, 'narration', 3, tl("Cosa dice la voce in questa clip…"))}
      {!upload && field(tl("Immagine di partenza"), shot.visual, 'visual', 4)}
      {!upload && field(tl("Movimento"), shot.motion, 'motion', 2)}
      {upload && <p className="text-[11px] text-[var(--text-secondary)]">{tl("Clip caricata: puoi tagliarla, spostarla e aggiungerle una voce.")}</p>}
      {shot.audio_key && (shot.audio_offset != null || (shot.audio_in ?? 0) > 0 || (shot.audio_out ?? shot.audio_dur ?? 0) < (shot.audio_dur ?? 0)) && (
        <Button tone="neutral" surface="soft" density="compact" className="shrink-0" onClick={() => onChange({ audio_offset: null, audio_in: 0, audio_out: shot.audio_dur })}>{tl("Ripristina voce")}</Button>
      )}
      {shot.error && <p className="shrink-0 rounded-[var(--control-radius)] bg-[color-mix(in_srgb,var(--logo-pink)_12%,transparent)] p-3 text-xs text-[var(--logo-pink)]">{shot.error}</p>}
      {!upload && (
        <div className="flex shrink-0 flex-wrap gap-2">
          <Button tone="neutral" surface="soft" density="compact" disabled={busy} onClick={onImage}><RefreshCw />{tl("Immagine")} · {credits(imageCredits)} cr</Button>
          {shot.keyframe_key && <Button tone="neutral" surface="soft" density="compact" disabled={busy} onClick={onClip}><Play />{tl("Clip")}{isLocal ? '' : ` · ~${credits(clipCredits)} cr`}</Button>}
        </div>
      )}
    </aside>
  )
}

/** Transition chooser opened from the junction button between two clips on the timeline. */
function TransitionMenu({ x, y, shot, options, onChange, onClose }: {
  x: number; y: number; shot: Shot; options: Array<{ key: string; label: string }>
  onChange: (patch: Partial<Shot>) => void; onClose: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const out = (e: PointerEvent) => { if (!ref.current?.contains(e.target as Node)) onClose() }
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('pointerdown', out)
    document.addEventListener('keydown', key)
    return () => { document.removeEventListener('pointerdown', out); document.removeEventListener('keydown', key) }
  }, [onClose])
  const current = shot.transition || 'none'
  const left = Math.max(8, Math.min(x - 100, window.innerWidth - 232))
  return (
    <div ref={ref} className="ds-popover fixed z-[120] w-56 rounded-[var(--card-radius)] p-2" style={{ left, bottom: Math.max(8, window.innerHeight - y + 8) }}>
      <p className="px-2 pb-1 text-[11px] font-semibold text-[var(--text-secondary)]">{tl("Transizione in ingresso")}</p>
      <div className="max-h-64 overflow-y-auto">
        {options.map((t) => (
          <button key={t.key} type="button" onClick={() => onChange({ transition: t.key, transition_dur: shot.transition_dur ?? 0.6 })}
            className={`w-full rounded-[var(--control-radius)] px-3 py-1.5 text-left text-xs font-semibold ${current === t.key ? 'ds-selected' : 'hover:bg-[var(--ds-control-hover)]'}`}>{t.label}</button>
        ))}
      </div>
      {current !== 'none' && (
        <div className="mt-2 flex gap-1 px-1">
          {[0.3, 0.6, 1, 1.5, 2].map((d) => (
            <button key={d} type="button" onClick={() => onChange({ transition_dur: d })}
              className={`flex-1 rounded-[var(--control-radius)] py-1 text-[11px] font-semibold ${(shot.transition_dur ?? 0.6) === d ? 'ds-selected' : 'ds-control'}`}>{d}s</button>
          ))}
        </div>
      )}
    </div>
  )
}

function Composer({ form, config, hasScript, onChange, onPickFile, generating, canGenerate, onGenerate, onClose }: {
  form: { source_text: string; brief: string; style_key: string; aspect: string; language: string; target_shots: number }
  config?: VideoStudioConfig; hasScript: boolean
  onChange: (patch: Record<string, string | number>) => void
  onPickFile: () => void
  generating: boolean
  canGenerate: boolean
  onGenerate: () => void
  onClose: () => void
}) {
  if (generating) {
    return (
      <div className="ui-card mx-auto flex max-w-3xl flex-col items-center justify-center gap-5 p-8 text-center">
        <Loader2 className="h-8 w-8 animate-spin text-[var(--app-accent)]" />
        <div>
          <p className="text-base font-bold">{tl("Sto scrivendo la sceneggiatura…")}</p>
          <p className="mt-1 text-sm text-[var(--text-secondary)]">{tl("Cast, linguaggio visivo e clip: servono circa 30–60 secondi.")}</p>
        </div>
      </div>
    )
  }
  return (
    <div className="ui-card mx-auto w-full max-w-3xl space-y-4 p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-black tracking-tight">{tl("Cosa vuoi generare?")}</h2>
        </div>
        {hasScript && <Button tone="neutral" surface="ghost" density="compact" onClick={onClose}>{tl("Chiudi")}</Button>}
      </div>
      <Textarea density="roomy" resize="none" rows={10} className="min-h-0" value={form.source_text}
        onChange={(e) => onChange({ source_text: e.target.value })}
        placeholder={tl("Descrivi il video che vuoi, oppure incolla la lezione o gli appunti. Es. «Spiega la fotosintesi a una prima media, tono curioso, un solo personaggio guida».")} />
      <div className="grid gap-3 sm:grid-cols-4">
        <div className="sm:col-span-2">
          <Label>{tl("Stile visivo")}</Label>
          <Select density="compact" value={form.style_key} onChange={(e) => onChange({ style_key: e.target.value })}>
            {config?.styles.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
          </Select>
        </div>
        <div>
          <Label>{tl("Formato")}</Label>
          <Select density="compact" value={form.aspect} onChange={(e) => onChange({ aspect: e.target.value })}>
            {config?.aspects.map((a) => <option key={a} value={a}>{a}</option>)}
          </Select>
        </div>
        <div>
          <Label>{tl("Lingua")}</Label>
          <Select density="compact" value={form.language} onChange={(e) => onChange({ language: e.target.value })}>
            <option value="it">{tl("Italiano")}</option><option value="en">English</option>
          </Select>
        </div>
        <div>
          <Label>{tl("Numero di clip")}</Label>
          <Input type="number" min={2} max={12} density="compact" value={form.target_shots}
            onChange={(e) => onChange({ target_shots: Math.max(2, Math.min(12, Number(e.target.value) || 6)) })} />
        </div>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Button tone="neutral" surface="soft" onClick={onPickFile}><Paperclip />{tl("Carica documento")}</Button>
        <div className="flex items-center gap-3">
          <span className="text-xs text-[var(--text-secondary)]">{form.source_text.length.toLocaleString('it-IT')} {tl("caratteri")}{!canGenerate && form.source_text.length > 0 ? ` · ${tl("minimo 40")}` : ''}</span>
          <Button tone="accent" surface="solid" density="roomy" onClick={onGenerate} disabled={!canGenerate}><Sparkles />{hasScript ? tl("Rigenera sceneggiatura") : tl("Genera sceneggiatura")}</Button>
        </div>
      </div>
    </div>
  )
}

