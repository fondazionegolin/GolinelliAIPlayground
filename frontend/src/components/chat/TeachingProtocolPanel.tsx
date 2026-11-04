import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Badge, Button, Input, Select, Textarea } from '@/design'
import { Brain, Check, Loader2, Plus, Square, Trash2 } from '@/components/icons'
import { notifyJobsChanged } from '@/lib/backgroundJobs'
import { driveApi } from '@/lib/api'
import { PROTOCOL_KINDS, protocolApi, type ProtocolData, type ProtocolKind, type ProtocolMessage, type ProtocolPlan, type ProtocolResult, type ProtocolState, type ProtocolTask } from '@/lib/teachingProtocol'
import { tl } from '@/i18n/tl'

const hint = 'text-xs leading-relaxed text-[var(--text-secondary)]'
const field = 'block space-y-1.5 text-xs font-semibold'
const softBlock = 'rounded-[var(--ds-radius-control)] bg-[var(--surface-muted)]'
const statusLabel: Record<ProtocolResult['status'], string> = {
  pending: 'In attesa', running: 'In lavorazione', ready: 'Da approvare', saved: 'Approvato', error: 'Da riprovare', blocked: 'Dipendenza da completare',
}
const statusTone: Record<ProtocolResult['status'], 'neutral' | 'success' | 'warning' | 'danger'> = {
  pending: 'neutral', running: 'neutral', ready: 'warning', saved: 'success', error: 'danger', blocked: 'danger',
}

/** One clear call to action per material: what the single "Conferma" click does. */
const confirmLabel = (kind: ProtocolKind) =>
  kind === 'teacherbot' ? tl('Conferma e pubblica il teacherbot')
    : kind === 'quiz' ? tl('Conferma e pubblica il quiz')
      : tl('Conferma e salva')

function errorMessage(error: unknown) {
  const detail = (error as { response?: { data?: { detail?: unknown } } }).response?.data?.detail
  return typeof detail === 'string' ? detail : tl('Operazione non riuscita. Controlla le attività e riprova.')
}

export function TeachingProtocolPanel({ messageId, state, onUpdate, onPublishQuiz }: {
  messageId: string; state: ProtocolState; onUpdate: (message: ProtocolMessage) => void
  onPublishQuiz: (data: ProtocolData) => void
}) {
  const [plan, setPlan] = useState<ProtocolPlan>(state.plan)
  const [editingPlan, setEditingPlan] = useState(false)
  const [focusId, setFocusId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => { setPlan(state.plan) }, [state.plan])
  useEffect(() => {
    if (state.phase !== 'running') return
    let active = true
    let timer: ReturnType<typeof setTimeout>
    const poll = async () => {
      try {
        const { data } = await protocolApi.get(messageId)
        if (active) {
          onUpdate(data); setError('')
          if (data.protocol.phase !== 'running') { notifyJobsChanged(); return }
        }
      } catch { if (active) setError(tl('Connessione interrotta. Gli agenti continuano in background; riprovo a recuperare i risultati.')) }
      if (active) timer = setTimeout(poll, 2000)
    }
    timer = setTimeout(poll, 1000)
    return () => { active = false; clearTimeout(timer) }
    // The parent callback is recreated on each chat render; keep one poller per message/run.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messageId, state.phase])

  /** Resolves true when the server accepted the change, so callers can chain the next step. */
  const act = async (work: () => Promise<{ data: ProtocolMessage }>): Promise<boolean> => {
    setBusy(true); setError('')
    try { onUpdate((await work()).data); notifyJobsChanged(); return true }
    catch (error) { setError(errorMessage(error)); return false }
    finally { setBusy(false) }
  }
  const changeTask = (id: string, patch: Partial<ProtocolTask>) => setPlan(previous => ({ ...previous,
    tasks: previous.tasks.map(task => task.id === id ? { ...task, ...patch } : task) }))
  const removeTask = (id: string) => setPlan(previous => {
    const removed = new Set([id])
    let size = 0
    while (size !== removed.size) {
      size = removed.size
      previous.tasks.forEach(task => { if (task.depends_on.some(key => removed.has(key))) removed.add(task.id) })
    }
    return { ...previous, tasks: previous.tasks.filter(task => !removed.has(task.id)) }
  })
  const startRun = async () => { if (await act(() => protocolApi.run(messageId, state.revision, plan))) setEditingPlan(false) }

  const approved = Object.values(state.results).filter(result => result.status === 'saved').length
  const total = state.plan.tasks.length
  // Materials are proposed one at a time, in plan order: the first not-yet-approved one is "on stage".
  const stageId = focusId && state.plan.tasks.some(t => t.id === focusId && state.results[t.id]?.status !== 'saved')
    ? focusId
    : state.plan.tasks.find(t => state.results[t.id]?.status !== 'saved')?.id

  const header = <section aria-label={tl('Piano agentico dell’attività')} className="not-prose ds-panel mt-3 min-w-0 space-y-3 rounded-[var(--ds-radius-panel)] p-4 text-[var(--text-primary)]">
    <div className="flex items-start gap-3">
      <Brain className="mt-0.5 h-5 w-5 shrink-0 text-[var(--logo-violet-strong)]" />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-bold">{state.plan.title}</p>
        <p className={`mt-1 ${hint}`}>{state.phase === 'plan'
          ? tl('Ecco cosa preparo per te. Conferma e gli agenti generano i materiali.')
          : tl('{0} di {1} materiali approvati. Te li propongo uno alla volta.', approved, total)}</p>
      </div>
      {state.phase !== 'plan' && <Badge tone={approved === total ? 'success' : 'neutral'} surface="soft" density="compact">{approved}/{total}</Badge>}
    </div>
    {state.source_names.length > 0 && <p className={hint}>{tl('Documenti analizzati:')} {state.source_names.join(', ')}</p>}
    {state.warnings.map((warning, i) => <p key={i} className={hint}>{warning}</p>)}
    <p className={hint}>{tl('I materiali restano privati. La pubblicazione agli studenti richiede una tua azione. Le generazioni utilizzano i crediti del tuo account.')}</p>
    {error && <p role="alert" className="text-xs font-semibold text-[var(--logo-pink)]">{error}</p>}

    {state.phase === 'plan' && !editingPlan && <>
      <ol className="space-y-2">
        {state.plan.tasks.map((task, index) => <li key={task.id} className={`${softBlock} flex items-start gap-3 p-3`}>
          <span className="mt-0.5 text-xs font-bold text-[var(--text-muted)]">{index + 1}</span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold">{task.title}</p>
            {task.rationale && <p className={`mt-0.5 ${hint}`}>{task.rationale}</p>}
          </div>
          <Badge tone="neutral" surface="soft" density="compact">{tl(PROTOCOL_KINDS[task.kind])}</Badge>
        </li>)}
      </ol>
      <div className="flex flex-wrap items-center gap-2">
        <Button tone="accent" surface="solid" density="roomy" disabled={busy || !total} onClick={() => void startRun()}>
          {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Check className="mr-2 h-4 w-4" />}{tl('Conferma e genera')}
        </Button>
        <Button tone="neutral" surface="soft" density="roomy" disabled={busy} onClick={() => setEditingPlan(true)}>{tl('Modifica il piano')}</Button>
      </div>
    </>}

    {state.phase === 'plan' && editingPlan && <fieldset disabled={busy} className="min-w-0 space-y-4">
      <label className={field}>{tl('Titolo dell’attività')}<Input value={plan.title} onChange={e => setPlan({ ...plan, title: e.target.value })} /></label>
      <label className={field}>{tl('Obiettivo comune')}<Textarea value={plan.objective} onChange={e => setPlan({ ...plan, objective: e.target.value })} /></label>
      {plan.assumptions.length > 0 && <div><p className="text-xs font-semibold">{tl('Ipotesi da verificare')}</p><ul className="mt-1 list-disc space-y-1 pl-4">{plan.assumptions.map((assumption, i) => <li className={hint} key={i}>{assumption}</li>)}</ul></div>}
      {plan.tasks.map((task, index) => <div key={task.id} className={`${softBlock} min-w-0 space-y-3 p-3`}>
        <div className="flex items-center justify-between gap-2"><strong className="text-xs">{index + 1}. {tl(PROTOCOL_KINDS[task.kind])}</strong>
          <Button tone="danger" surface="ghost" density="compact" aria-label={tl('Rimuovi attività e dipendenti')} title={tl('Rimuovi questa attività e quelle che ne dipendono')} onClick={() => removeTask(task.id)}><Trash2 className="h-4 w-4" /></Button></div>
        {task.rationale && <p className={hint}>{task.rationale}</p>}
        <label className={field}>{tl('Tipo di materiale')}<Select value={task.kind} onChange={e => changeTask(task.id, { kind: e.target.value as ProtocolKind })}>{Object.entries(PROTOCOL_KINDS).map(([key, label]) => <option key={key} value={key}>{tl(label)}</option>)}</Select></label>
        <label className={field}>{tl('Titolo')}<Input value={task.title} onChange={e => changeTask(task.id, { title: e.target.value })} /></label>
        <label className={field}>{tl('Istruzioni per l’agente')}<Textarea rows={4} value={task.instructions} onChange={e => changeTask(task.id, { instructions: e.target.value })} /></label>
        {state.source_names.length > 0 && <fieldset className="space-y-1"><legend className="mb-1 text-xs font-semibold">{tl('Fonti da usare')}</legend>{state.source_names.map(name => <label key={name} className="flex items-center gap-2 text-xs"><input type="checkbox" checked={task.source_names.includes(name)} onChange={e => changeTask(task.id, { source_names: e.target.checked ? [...task.source_names, name] : task.source_names.filter(n => n !== name) })} />{name}</label>)}</fieldset>}
        {plan.tasks.length > 1 && <fieldset className="space-y-1"><legend className="mb-1 text-xs font-semibold">{tl('Attendi prima questi materiali (facoltativo)')}</legend>{plan.tasks.filter(other => other.id !== task.id).map(other => <label key={other.id} className="flex items-center gap-2 text-xs"><input type="checkbox" checked={task.depends_on.includes(other.id)} onChange={e => changeTask(task.id, { depends_on: e.target.checked ? [...task.depends_on, other.id] : task.depends_on.filter(key => key !== other.id) })} />{other.title}</label>)}</fieldset>}
      </div>)}
      <div className="flex flex-wrap gap-2">
        <Button tone="neutral" surface="soft" density="compact" disabled={plan.tasks.length >= 12} onClick={() => setPlan({ ...plan, tasks: [...plan.tasks, {
          id: `attivita_${Date.now()}`, kind: 'document', title: tl('Nuovo materiale'), instructions: '', rationale: '', source_names: [], depends_on: [],
        }] })}><Plus className="mr-1.5 h-4 w-4" />{tl('Aggiungi attività')}</Button>
        <Button tone="neutral" surface="ghost" density="compact" onClick={() => { setPlan(state.plan); setEditingPlan(false) }}>{tl('Annulla')}</Button>
        <Button tone="accent" surface="solid" density="roomy" disabled={!plan.title.trim() || !plan.tasks.length || plan.tasks.some(t => !t.instructions.trim() || !t.title.trim())}
          onClick={() => void startRun()}>{busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Check className="mr-2 h-4 w-4" />}{tl('Conferma e genera')}</Button>
      </div>
    </fieldset>}

    {state.phase === 'running' && <div className="flex items-center justify-between gap-2">
      <p role="status" className={`flex items-center gap-2 ${hint}`}><Loader2 className="h-4 w-4 animate-spin" />{tl('Gli agenti stanno lavorando. Puoi cambiare pagina e tornare qui.')}</p>
      <Button tone="neutral" surface="soft" density="compact" disabled={busy} onClick={async () => { setBusy(true); try { await protocolApi.stop(messageId); onUpdate((await protocolApi.get(messageId)).data) } catch (error) { setError(errorMessage(error)) } finally { setBusy(false) } }}><Square className="mr-1.5 h-3 w-3" />{tl('Interrompi')}</Button>
    </div>}
  </section>

  if (state.phase === 'plan') return header

  // Header first, then every material as its own, separate block.
  return <>
    {header}
    {state.plan.tasks.map(task => <TaskBlock key={task.id} task={task} result={state.results[task.id] || { status: 'pending' }}
      onStage={task.id === stageId} disabled={busy || state.phase === 'running'}
      onFocus={() => setFocusId(task.id)}
      onRetry={instructions => act(() => protocolApi.run(messageId, state.revision, undefined, task.id, instructions))}
      onConfirm={async data => {
        const ok = await act(() => protocolApi.review(messageId, task.id, state.revision, data, true))
        if (ok) { setFocusId(null); if (task.kind === 'quiz') onPublishQuiz(data) }
      }}
      onPublishQuiz={onPublishQuiz} />)}
  </>
}

function TaskBlock({ task, result, onStage, disabled, onFocus, onRetry, onConfirm, onPublishQuiz }: {
  task: ProtocolTask; result: ProtocolResult; onStage: boolean; disabled: boolean
  onFocus: () => void; onRetry: (instructions: string) => Promise<boolean>
  onConfirm: (data: ProtocolData) => Promise<void>; onPublishQuiz: (data: ProtocolData) => void
}) {
  const [data, setData] = useState<ProtocolData>(result.data || {})
  const [instructions, setInstructions] = useState(task.instructions)
  const [mode, setMode] = useState<'view' | 'edit' | 'retry'>('view')
  useEffect(() => { setData(result.data || {}) }, [result.data])
  useEffect(() => { setInstructions(task.instructions) }, [task.instructions])
  const saved = result.status === 'saved'
  const ready = result.status === 'ready'
  const title = data.title || data.name || task.title

  const heading = <div className="flex flex-wrap items-center gap-2">
    <Badge tone="neutral" surface="soft" density="compact">{tl(PROTOCOL_KINDS[task.kind])}</Badge>
    <p className="min-w-0 flex-1 truncate text-sm font-bold">{title}</p>
    <Badge tone={statusTone[result.status]} surface="soft" density="compact">{tl(statusLabel[result.status])}</Badge>
  </div>

  if (!onStage) {
    return <section className="not-prose ui-card mt-3 min-w-0 space-y-2 p-4 text-[var(--text-primary)]">
      {heading}
      <div className="flex flex-wrap items-center gap-2">
        {saved && result.resource && <ResourceLink task={task} resource={result.resource} />}
        {saved && task.kind === 'quiz' && result.data && <Button tone="accent" surface="soft" density="compact" onClick={() => onPublishQuiz(result.data!)}>{tl('Pubblica in una sessione')}</Button>}
        {!saved && <p className={hint}>{ready ? tl('Pronto: te lo propongo dopo il materiale precedente.') : tl(statusLabel[result.status])}</p>}
        {ready && <Button tone="neutral" surface="ghost" density="compact" className="ml-auto" onClick={onFocus}>{tl('Rivedi ora')}</Button>}
      </div>
    </section>
  }

  return <section className="not-prose ds-panel mt-3 min-w-0 space-y-3 rounded-[var(--ds-radius-panel)] p-4 text-[var(--text-primary)]">
    {heading}
    {task.depends_on.length > 0 && <p className={hint}>{tl('Usa i risultati di:')} {task.depends_on.join(', ')}</p>}
    {(result.status === 'pending' || result.status === 'running') && <p role="status" className={`flex items-center gap-2 ${hint}`}><Loader2 className="h-4 w-4 animate-spin" />{tl('Sto preparando questo materiale…')}</p>}
    {result.error && <p role="alert" className="text-xs font-semibold text-[var(--logo-pink)]">{result.error}</p>}

    {result.data && mode !== 'edit' && <Preview task={task} data={data} />}
    {result.data && mode === 'edit' && <Editor task={task} data={data} setData={setData} disabled={disabled} />}

    {ready && <div className="flex flex-wrap items-center gap-2">
      <Button tone="accent" surface="solid" density="roomy" disabled={disabled} onClick={() => void onConfirm(data)}>
        {disabled ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Check className="mr-2 h-4 w-4" />}{confirmLabel(task.kind)}
      </Button>
      {task.kind !== 'image' && <Button tone="neutral" surface="soft" density="roomy" disabled={disabled} onClick={() => setMode(mode === 'edit' ? 'view' : 'edit')}>{mode === 'edit' ? tl('Chiudi modifica') : tl('Modifica')}</Button>}
      <Button tone="neutral" surface="ghost" density="roomy" disabled={disabled} onClick={() => setMode(mode === 'retry' ? 'view' : 'retry')}>{tl('Rigenera')}</Button>
    </div>}
    {!ready && !saved && result.status !== 'pending' && result.status !== 'running' &&
      <Button tone="neutral" surface="soft" density="compact" disabled={disabled} onClick={() => setMode('retry')}>{tl('Rigenera questo blocco')}</Button>}

    {mode === 'retry' && !saved && <fieldset disabled={disabled} className="min-w-0 space-y-2">
      <label className={field}>{tl('Istruzioni per la rigenerazione')}<Textarea rows={3} value={instructions} onChange={e => setInstructions(e.target.value)} /></label>
      <p className={hint}>{tl('La rigenerazione aggiorna anche i materiali dipendenti e usa nuovi crediti. I blocchi indipendenti restano disponibili.')}</p>
      <Button tone="accent" surface="soft" density="compact" disabled={!instructions.trim()} onClick={async () => { if (await onRetry(instructions)) setMode('view') }}>{tl('Rigenera questo blocco')}</Button>
    </fieldset>}
  </section>
}

/** Opens the saved material. Routes stay in the SPA; file downloads go through the authenticated API client. */
function ResourceLink({ task, resource }: { task: ProtocolTask; resource: NonNullable<ProtocolResult['resource']> }) {
  const [failed, setFailed] = useState(false)
  const cls = 'text-xs font-semibold text-[var(--logo-violet-strong)] underline'
  if (resource.url.startsWith('/teacher/')) {
    return <Link className={cls} to={resource.url}>{task.kind === 'teacherbot' ? tl('Apri Teacherbot') : tl('Apri nell’editor')}</Link>
  }
  const download = async () => {
    try {
      const { data } = await driveApi.content(resource.id)
      const url = URL.createObjectURL(data)
      const link = document.createElement('a')
      link.href = url
      link.download = `${task.title}${task.kind === 'image' ? '.png' : task.kind === 'html_page' ? '.html' : '.json'}`
      document.body.appendChild(link); link.click(); link.remove()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
      setFailed(false)
    } catch { setFailed(true) }
  }
  return <>
    <button type="button" className={cls} onClick={() => void download()}>{tl('Scarica il materiale')}</button>
    {failed && <span role="alert" className="text-xs font-semibold text-[var(--logo-pink)]">{tl('Download non riuscito. Riprova o aprilo dai Files.')}</span>}
  </>
}

/** Read-only, scannable summary: the teacher decides at a glance and confirms with one click. */
function Preview({ task, data }: { task: ProtocolTask; data: ProtocolData }) {
  const clamp = 'line-clamp-6 whitespace-pre-wrap text-sm leading-relaxed'
  return <div className={`${softBlock} min-w-0 space-y-2 p-3`}>
    {task.kind === 'teacherbot' && <>
      {data.description && <p className="text-sm">{data.description}</p>}
      <p className={hint}>{tl('Prompt di sistema')}</p>
      <p className={clamp}>{data.system_prompt}</p>
      {data.knowledge && <><p className={hint}>{tl('Knowledge specifica')}</p><p className={clamp}>{data.knowledge}</p></>}
    </>}
    {(task.kind === 'document' || task.kind === 'dispensa') && <p className={`${clamp} line-clamp-[12]`}>{data.text}</p>}
    {task.kind === 'sheet' && data.rows && <div className="overflow-x-auto"><table className="w-full text-left text-xs"><tbody>
      {data.rows.slice(0, 8).map((row, i) => <tr key={i} className={i === 0 ? 'font-bold' : ''}>{row.map((cell, j) => <td key={j} className="px-2 py-1">{String(cell)}</td>)}</tr>)}
    </tbody></table>{data.rows.length > 8 && <p className={hint}>{tl('… e altre {0} righe', data.rows.length - 8)}</p>}</div>}
    {task.kind === 'presentation' && <ol className="list-decimal space-y-1 pl-5 text-sm">{data.slides?.map((slide, i) => <li key={i}><span className="font-semibold">{slide.title}</span></li>)}</ol>}
    {task.kind === 'quiz' && <>
      {data.description && <p className="text-sm">{data.description}</p>}
      <ol className="list-decimal space-y-2 pl-5 text-sm">{data.questions?.map((q, i) => <li key={i}>
        <span className="font-semibold">{q.question}</span>
        {(!q.type || q.type === 'mcq') && <ul className="mt-1 space-y-0.5 text-xs">{q.options.map((option, j) => <li key={j} className={j === q.correctIndex ? 'font-bold text-[var(--logo-blue-strong)]' : 'text-[var(--text-secondary)]'}>{j === q.correctIndex ? '✓ ' : ''}{option}</li>)}</ul>}
        {q.type === 'open' && <p className={hint}>{tl('Risposta aperta')}</p>}
        {q.type === 'scale' && <p className={hint}>{tl('Scala di valutazione')} {q.min ?? 1}–{q.max ?? 5}</p>}
      </li>)}</ol>
    </>}
    {task.kind === 'html_page' && <iframe title={task.title} className="h-80 w-full rounded-[var(--ds-radius-control)] bg-[var(--surface-base)]" sandbox="allow-scripts" referrerPolicy="no-referrer"
      srcDoc={`<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; connect-src 'none'; form-action 'none'; base-uri 'none'">${data.html || ''}`} />}
    {task.kind === 'image' && data.image_url && <img className="max-h-96 max-w-full rounded-[var(--ds-radius-control)] object-contain" alt={data.title || task.title} src={data.image_url} />}
  </div>
}

function Editor({ task, data, setData, disabled }: {
  task: ProtocolTask; data: ProtocolData; setData: (updater: (previous: ProtocolData) => ProtocolData) => void; disabled: boolean
}) {
  const patch = (value: Partial<ProtocolData>) => setData(previous => ({ ...previous, ...value }))
  return <fieldset disabled={disabled} className="min-w-0 space-y-3">
    <label className={field}>{tl('Titolo')}<Input value={data.title || data.name || ''} onChange={e => patch(task.kind === 'teacherbot' ? { name: e.target.value } : { title: e.target.value })} /></label>
    {(task.kind === 'document' || task.kind === 'dispensa') && <label className={field}>{tl('Contenuto')}<Textarea rows={14} value={data.text || ''} onChange={e => patch({ text: e.target.value })} /></label>}
    {task.kind === 'teacherbot' && <>
      <label className={field}>{tl('Descrizione')}<Textarea value={data.description || ''} onChange={e => patch({ description: e.target.value })} /></label>
      <label className={field}>{tl('Prompt di sistema')}<Textarea rows={10} value={data.system_prompt || ''} onChange={e => patch({ system_prompt: e.target.value })} /></label>
      <label className={field}>{tl('Knowledge specifica')}<Textarea rows={8} value={data.knowledge || ''} onChange={e => patch({ knowledge: e.target.value })} /></label>
      <p className={hint}>{tl('La knowledge verrà incorporata nelle istruzioni del teacherbot. Puoi aggiungere altri documenti dalla sua scheda.')}</p>
    </>}
    {task.kind === 'sheet' && <label className={field}>{tl('Celle del foglio (colonne separate da tabulazioni)')}<Textarea className="whitespace-pre font-mono" rows={12} value={(data.rows || []).map(row => row.join('\t')).join('\n')} onChange={e => patch({ rows: e.target.value.split('\n').map(row => row.split('\t')) })} /></label>}
    {task.kind === 'presentation' && data.slides?.map((slide, i) => <div key={i} className={`${softBlock} space-y-2 p-3`}>
      <label className={field}>{tl('Slide {0} · Titolo', i + 1)}<Input value={slide.title} onChange={e => patch({ slides: data.slides!.map((s, j) => j === i ? { ...s, title: e.target.value } : s) })} /></label>
      <label className={field}>{tl('Contenuto')}<Textarea rows={4} value={slide.body} onChange={e => patch({ slides: data.slides!.map((s, j) => j === i ? { ...s, body: e.target.value } : s) })} /></label>
      <label className={field}>{tl('Note del docente')}<Textarea value={slide.notes || ''} onChange={e => patch({ slides: data.slides!.map((s, j) => j === i ? { ...s, notes: e.target.value } : s) })} /></label>
    </div>)}
    {task.kind === 'quiz' && <>
      <label className={field}>{tl('Descrizione')}<Textarea value={data.description || ''} onChange={e => patch({ description: e.target.value })} /></label>
      {data.questions?.map((question, i) => {
        const edit = (value: Partial<typeof question>) => patch({ questions: data.questions!.map((q, j) => i === j ? { ...q, ...value } : q) })
        return <div key={i} className={`${softBlock} space-y-2 p-3`}>
          <label className={field}>{tl('Domanda {0}', i + 1)}<Textarea value={question.question} onChange={e => edit({ question: e.target.value })} /></label>
          <p className={hint}>{tl(question.type === 'open' ? 'Risposta aperta' : question.type === 'scale' ? 'Scala di valutazione' : 'Scelta multipla')}</p>
          {(!question.type || question.type === 'mcq') && question.options.map((option, j) => <label key={j} className="flex items-center gap-2 text-xs"><input type="radio" name={`${task.id}-question-${i}`} aria-label={tl('Risposta corretta: opzione {0}', j + 1)} checked={question.correctIndex === j} onChange={() => edit({ correctIndex: j })} /><Input aria-label={tl('Opzione {0}', j + 1)} value={option} onChange={e => edit({ options: question.options.map((o, k) => j === k ? e.target.value : o) })} /></label>)}
          {question.type === 'open' && <label className={field}>{tl('Risposta attesa / criteri')}<Textarea value={question.sampleAnswer || ''} onChange={e => edit({ sampleAnswer: e.target.value })} /></label>}
          {question.type === 'scale' && <div className="grid grid-cols-2 gap-2"><label className={field}>{tl('Minimo')}<Input type="number" value={question.min ?? 1} onChange={e => edit({ min: Number(e.target.value) })} /></label><label className={field}>{tl('Massimo')}<Input type="number" value={question.max ?? 5} onChange={e => edit({ max: Number(e.target.value) })} /></label></div>}
          <label className={field}>{tl('Spiegazione')}<Textarea value={question.explanation || ''} onChange={e => edit({ explanation: e.target.value })} /></label>
        </div>
      })}
    </>}
    {task.kind === 'html_page' && <label className={field}>{tl('Codice HTML')}<Textarea className="font-mono" rows={10} value={data.html || ''} onChange={e => patch({ html: e.target.value })} /></label>}
  </fieldset>
}
