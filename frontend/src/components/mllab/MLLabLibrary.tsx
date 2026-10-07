import { useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Brain, Camera, Copy, Download, Hand, Image as ImageIcon, Loader2, MoreHorizontal, Plus, Sparkles, Trash2, Upload, User, X, Zap } from '@/components/icons'
import { MODE_LABEL, modeOfEngine, type Mode } from '@/lib/mlFeatures'
import { mlLabApi, type MLLabProjectSummary } from '@/lib/api'
import { useToast } from '@/components/ui/use-toast'
import { Button } from '@/components/ui/button'

const relative = (iso: string) => {
  const minutes = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000))
  if (minutes < 1) return 'adesso'
  if (minutes < 60) return `${minutes} min fa`
  if (minutes < 1440) return `${Math.round(minutes / 60)} h fa`
  if (minutes < 43200) return `${Math.round(minutes / 1440)} g fa`
  return new Date(iso).toLocaleDateString('it-IT', { day: '2-digit', month: 'short', year: 'numeric' })
}

const MODE_META: Record<Mode, { icon: typeof Camera; color: string; blurb: string }> = {
  image: { icon: ImageIcon, color: '#3ea9f4', blurb: 'Riconosce oggetti, disegni, scritte: tutto ciò che si può inquadrare.' },
  pose: { icon: User, color: '#7b69c9', blurb: 'Riconosce la posizione del corpo: braccia alzate, seduto, in piedi, un passo di danza…' },
  hand: { icon: Hand, color: '#e85c8d', blurb: 'Riconosce i gesti delle mani: pollice in su, pugno, mano aperta, numeri con le dita…' },
}

function ModeChooser({ onPick, onClose }: { onPick: (mode: Mode) => void; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4 backdrop-blur-sm" onMouseDown={onClose}>
      <div className="w-full max-w-3xl rounded-3xl bg-white p-6 shadow-2xl dark:bg-slate-900" onMouseDown={(event) => event.stopPropagation()} role="dialog" aria-modal="true" aria-label="Che cosa vuoi riconoscere?">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-xl font-bold text-slate-900">Che cosa vuoi riconoscere?</h2>
            <p className="mt-1 text-sm text-slate-500">Scegli il tipo di progetto. Il modo di lavorare è lo stesso: crei le classi, mostri degli esempi e provi dal vivo.</p>
          </div>
          <button onClick={onClose} className="rounded-xl p-2 text-slate-400 hover:bg-slate-100" aria-label="Chiudi"><X className="h-5 w-5" /></button>
        </div>
        <div className="mt-5 grid gap-3 sm:grid-cols-3">
          {(Object.keys(MODE_META) as Mode[]).map((mode) => {
            const meta = MODE_META[mode]
            return (
              <button key={mode} type="button" onClick={() => onPick(mode)} className="ui-card group flex flex-col items-start gap-3 p-5 text-left transition hover:-translate-y-0.5 hover:shadow-lg">
                <span className="ds-squircle flex h-14 w-14 items-center justify-center text-white" style={{ background: meta.color }}><meta.icon className="h-7 w-7" strokeWidth={1.7} /></span>
                <span className="text-base font-bold text-slate-900">{MODE_LABEL[mode]}</span>
                <span className="text-sm leading-relaxed text-slate-500">{meta.blurb}</span>
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}

function Collage({ project }: { project: MLLabProjectSummary }) {
  const tiles = project.classes.slice(0, 4)
  return (
    <div className="grid h-28 grid-cols-2 gap-1 overflow-hidden rounded-2xl bg-slate-100 p-1 dark:bg-white/5">
      {tiles.length === 0 && <div className="col-span-2 flex items-center justify-center text-slate-400"><Camera className="h-7 w-7" /></div>}
      {tiles.map((cls) => (
        <div key={cls.id} className="relative overflow-hidden rounded-xl" style={{ background: cls.color }}>
          {cls.thumbs[0] && <img src={cls.thumbs[0]} alt="" className="h-full w-full object-cover" />}
          <span className="absolute bottom-1 left-1 max-w-[90%] truncate rounded-full bg-black/55 px-1.5 py-px text-[9px] font-bold text-white">{cls.name}</span>
        </div>
      ))}
    </div>
  )
}

function ProjectMenu({ project, onChanged }: { project: MLLabProjectSummary; onChanged: () => void }) {
  const [open, setOpen] = useState(false)
  const { toast } = useToast()
  const duplicate = useMutation({ mutationFn: () => mlLabApi.duplicate(project.id), onSuccess: () => { onChanged(); toast({ title: 'Progetto duplicato' }) }, onError: (e: any) => toast({ variant: 'destructive', title: 'Duplicazione non riuscita', description: e?.response?.data?.detail }) })
  const remove = useMutation({ mutationFn: () => mlLabApi.remove(project.id), onSuccess: onChanged })
  const exportProject = async () => {
    const full = (await mlLabApi.get(project.id)).data
    const blob = new Blob([JSON.stringify({ app: 'goliai-mllab', name: full.name, engine: full.engine, accuracy: full.accuracy, summary: full.classes, data: full.data })], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url; link.download = `${full.name.replace(/[^\w-]+/g, '-')}.mlproject.json`; link.click()
    URL.revokeObjectURL(url)
  }
  const items = [
    { label: 'Duplica', icon: Copy, run: () => duplicate.mutate() },
    { label: 'Esporta', icon: Download, run: () => void exportProject() },
    { label: 'Elimina', icon: Trash2, danger: true, run: () => { if (window.confirm(`Eliminare «${project.name}»?`)) remove.mutate() } },
  ]
  return (
    <div className="relative" onClick={(event) => event.stopPropagation()}>
      <button type="button" onClick={() => setOpen((v) => !v)} aria-label="Altre azioni" className="flex h-8 w-8 items-center justify-center rounded-xl text-slate-500 hover:bg-slate-100 dark:hover:bg-white/10">
        <MoreHorizontal className="h-5 w-5" />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-20" onClick={() => setOpen(false)} />
          <div className="ds-popover absolute right-0 top-full z-30 mt-1 w-40 rounded-2xl p-1.5 shadow-xl">
            {items.map((item) => (
              <button key={item.label} type="button" onClick={() => { setOpen(false); item.run() }}
                className={`flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-left text-sm font-medium hover:bg-slate-100 dark:hover:bg-white/10 ${item.danger ? 'text-red-600' : 'text-slate-700'}`}>
                <item.icon className="h-4 w-4" />{item.label}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

/** The library: every classifier already built, front and centre. */
export default function MLLabLibrary({ onOpen, onNew, onImported }: { onOpen: (id: string) => void; onNew: (mode: Mode) => void; onImported: (id: string) => void }) {
  const [choosing, setChoosing] = useState(false)
  const startNew = () => setChoosing(true)
  const qc = useQueryClient()
  const { toast } = useToast()
  const fileInput = useRef<HTMLInputElement>(null)
  const query = useQuery({ queryKey: ['ml-lab', 'projects'], queryFn: async () => (await mlLabApi.list()).data.projects })
  const refresh = () => qc.invalidateQueries({ queryKey: ['ml-lab', 'projects'] })
  const projects = query.data ?? []

  const importFile = async (file: File) => {
    try {
      const parsed = JSON.parse(await file.text())
      if (parsed?.app !== 'goliai-mllab' || !parsed?.data?.classes) throw new Error('format')
      const created = (await mlLabApi.create({ name: String(parsed.name || 'Progetto importato').slice(0, 120), engine: parsed.engine, accuracy: parsed.accuracy ?? null, summary: parsed.summary || [], data: parsed.data })).data
      void refresh()
      onImported(created.id)
    } catch {
      toast({ variant: 'destructive', title: 'File non valido', description: 'Importa un progetto esportato dal Lab ML (.mlproject.json).' })
    }
  }

  const importInput = (
    <>
    {choosing && <ModeChooser onClose={() => setChoosing(false)} onPick={(mode) => { setChoosing(false); onNew(mode) }} />}
    <input ref={fileInput} type="file" accept=".json,application/json" className="hidden" onChange={(event) => { const file = event.target.files?.[0]; if (file) void importFile(file); event.target.value = '' }} />
    </>
  )

  if (query.isLoading) return <div className="flex justify-center py-24"><Loader2 className="h-6 w-6 animate-spin text-slate-400" /></div>

  // ── first visit: a centred, explanatory welcome instead of an empty grid ──
  if (projects.length === 0) {
    const steps = [
      { icon: Plus, color: '#7b69c9', title: 'Crea le classi', text: 'Dai un nome a ciò che vuoi riconoscere: penne, quaderni, foglie…' },
      { icon: Camera, color: '#3ea9f4', title: 'Mostra degli esempi', text: 'Con la webcam o con le tue foto: bastano 5–10 esempi per classe.' },
      { icon: Zap, color: '#e85c8d', title: 'Provalo dal vivo', text: 'Il modello si addestra da solo in un attimo e ti dice cosa vede.' },
    ]
    return (
      <div className="mx-auto flex min-h-[calc(100vh-9rem)] max-w-4xl flex-col items-center justify-center px-4 py-10 text-center">
        {importInput}
        <div className="relative mb-7 flex items-center justify-center" aria-hidden>
          <span className="ds-squircle -mr-3 flex h-16 w-16 -rotate-6 items-center justify-center text-white shadow-lg" style={{ background: '#3ea9f4' }}><Camera className="h-7 w-7" strokeWidth={1.7} /></span>
          <span className="ds-squircle relative z-10 flex h-24 w-24 items-center justify-center text-white shadow-xl" style={{ background: '#7b69c9' }}><Brain className="h-11 w-11" strokeWidth={1.6} /></span>
          <span className="ds-squircle -ml-3 flex h-16 w-16 rotate-6 items-center justify-center text-white shadow-lg" style={{ background: '#e85c8d' }}><Sparkles className="h-7 w-7" strokeWidth={1.7} /></span>
        </div>
        <h1 className="text-3xl font-bold tracking-tight text-slate-900">Insegna al computer a riconoscere immagini, pose e gesti</h1>
        <p className="mt-3 max-w-xl text-base text-slate-500">Crea il tuo primo classificatore: oggetti, posizioni del corpo o gesti delle mani. Mostragli alcuni esempi e vedrai l'intelligenza artificiale imparare in tempo reale. I progetti che crei restano salvati qui.</p>
        <div className="mt-7 flex flex-wrap items-center justify-center gap-3">
          <Button tone="accent" surface="solid" size="lg" className="h-12 rounded-2xl px-7 text-base" onClick={startNew}><Plus className="h-5 w-5" /> Crea il primo progetto</Button>
          <Button tone="neutral" surface="outline" size="lg" className="h-12 rounded-2xl px-6" onClick={() => fileInput.current?.click()}><Upload className="h-4 w-4" /> Importa un progetto</Button>
        </div>
        <ol className="mt-12 grid w-full gap-4 text-left sm:grid-cols-3">
          {steps.map((step, index) => (
            <li key={step.title} className="ui-card flex flex-col gap-3 p-5">
              <div className="flex items-center gap-3">
                <span className="ds-squircle flex h-11 w-11 shrink-0 items-center justify-center text-white" style={{ background: step.color }}><step.icon className="h-5 w-5" strokeWidth={1.8} /></span>
                <span className="text-xs font-black uppercase tracking-widest text-slate-400">Passo {index + 1}</span>
              </div>
              <h2 className="text-base font-bold text-slate-900">{step.title}</h2>
              <p className="text-sm leading-relaxed text-slate-500">{step.text}</p>
            </li>
          ))}
        </ol>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      {importInput}
      <div className="mb-7 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Lab ML · Immagini, pose e gesti</h1>
          <p className="mt-1 max-w-2xl text-sm text-slate-500">I tuoi progetti: aprine uno per continuare ad addestrarlo o per provarlo dal vivo, oppure creane uno nuovo.</p>
        </div>
        <div className="flex items-center gap-2">
          <Button tone="neutral" surface="outline" onClick={() => fileInput.current?.click()}><Upload className="h-4 w-4" /> Importa</Button>
          <Button tone="accent" surface="solid" onClick={startNew}><Plus className="h-4 w-4" /> Nuovo progetto</Button>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <button type="button" onClick={startNew} className="group flex min-h-[15rem] flex-col items-center justify-center gap-3 rounded-3xl border-2 border-dashed border-slate-300 text-slate-500 transition hover:border-[var(--app-accent,#7c3aed)] hover:text-[var(--app-accent,#7c3aed)] dark:border-white/20">
          <span className="ds-squircle flex h-14 w-14 items-center justify-center bg-slate-100 transition group-hover:bg-[var(--app-accent,#7c3aed)] group-hover:text-white dark:bg-white/10"><Plus className="h-6 w-6" /></span>
          <span className="text-sm font-bold">Nuovo progetto</span>
        </button>
        {projects.map((project) => (
          <article key={project.id} onClick={() => onOpen(project.id)} className="ui-card group flex cursor-pointer flex-col gap-3 p-4 transition hover:-translate-y-0.5 hover:shadow-lg">
            <Collage project={project} />
            <div className="flex items-start gap-2">
              <div className="min-w-0 flex-1">
                <h3 className="truncate text-base font-bold text-slate-900" title={project.name}>{project.name}</h3>
                <p className="mt-0.5 text-xs text-slate-500"><span className="font-bold" style={{ color: MODE_META[modeOfEngine(project.engine)].color }}>{MODE_LABEL[modeOfEngine(project.engine)]}</span> · {project.class_count} classi · {project.sample_count} esempi</p>
              </div>
              <ProjectMenu project={project} onChanged={refresh} />
            </div>
            <div className="mt-auto flex items-center justify-between gap-2 text-[11px]">
              {project.accuracy !== null
                ? <span className={`rounded-full px-2.5 py-1 font-bold ${project.accuracy >= 0.85 ? 'bg-emerald-100 text-emerald-700' : project.accuracy >= 0.65 ? 'bg-amber-100 text-amber-700' : 'bg-rose-100 text-rose-700'}`} title="Stima su foto non usate per l'addestramento">Affidabilità ~{Math.round(project.accuracy * 100)}%</span>
                : <span className="rounded-full bg-slate-100 px-2.5 py-1 font-semibold text-slate-500 dark:bg-white/10">Servono più esempi</span>}
              <span className="text-slate-400">Aggiornato {relative(project.updated_at)}</span>
            </div>
          </article>
        ))}
      </div>
    </div>
  )
}
