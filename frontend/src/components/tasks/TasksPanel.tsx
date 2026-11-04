import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { teacherApi } from '@/lib/api'
import { Badge, Button, Input, SearchPill, Tabs, TabsList, TabsTrigger } from '@/design'
import { useToast } from '@/components/ui/use-toast'
import { ArrowLeft, Brain, Check, ChevronRight, ClipboardList, Download, FileText, Plus, Trash2 } from '@/components/icons'
import TaskBuilder from '@/components/TaskBuilder'
import { SpreadsheetEditor, type SheetChartConfig } from '@/components/SpreadsheetEditor'
import { tl } from '@/i18n/tl'
import {
  ExerciseCorrectionPanel,
  FORMATIVE_FLAG_META,
  SubmissionContentPreview,
  SubmissionFeedbackEditor,
  TaskContentPreview,
  toDateTimeLocalValue,
  type SubmissionData,
  type TaskAnalysisData,
  type TaskData,
} from './taskShared'

// ─── Types of the /results endpoint ─────────────────────────────────────────

interface ResultQuestion {
  index: number
  type: 'mcq' | 'open' | 'scale'
  text: string
  options: string[]
  correct_index: number | null
  min: number
  max: number
  sample_answer?: string | null
}

interface ResultCell { display: string; value: unknown; correct: boolean | null; answered: boolean }

interface ResultRow {
  student_id: string
  student_nickname: string
  submitted: boolean
  submission_id: string | null
  submitted_at: string | null
  score: string | null
  feedback: string | null
  feedback_published: boolean
  answers: ResultCell[]
  text: string | null
}

interface QuestionStats {
  answered: number
  submitted: number
  distribution?: number[]
  correct_percent?: number | null
  average?: number | null
}

interface TaskResults {
  task: { id: string; title: string; task_type: string }
  questions: ResultQuestion[]
  question_stats: QuestionStats[]
  rows: ResultRow[]
  totals: { students: number; submitted: number }
}

type WorkspaceTab = 'students' | 'table' | 'summary' | 'task'

const TYPE_LABEL: Record<string, string> = {
  quiz: tl("Quiz"), exercise: tl("Esercizio"), reading: tl("Lettura"), discussion: tl("Discussione"),
  project: tl("Progetto"), lesson: tl("Lezione"), presentation: tl("Presentazione"),
}

const dateTime = (value: string | null | undefined) =>
  value ? new Date(value).toLocaleString('it-IT', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—'

function scorePercent(score: string | null): number | null {
  const head = score?.split('+')[0].trim().split('/')
  if (!head || head.length !== 2 || !head.every(p => /^\d+$/.test(p.trim())) || Number(head[1]) <= 0) return null
  return Math.round(Number(head[0]) / Number(head[1]) * 100)
}

async function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

const safeName = (title: string, ext: string) =>
  `${title.normalize('NFKD').replace(/[^\w.-]+/g, '_').replace(/^_+|_+$/g, '') || 'compito'}.${ext}`

// ─── Shared look ────────────────────────────────────────────────────────────
// Only design-system surfaces/tokens: ds-panel / ui-card / --surface-* / --logo-* / --text-*. No borders, no palette colours.

const SOFT_BLOCK = 'rounded-[var(--ds-radius-control)] bg-[var(--surface-muted)]'
const MUTED = 'text-[var(--text-muted)]'
const META_LABEL = 'text-[10px] font-bold uppercase tracking-wide text-[var(--text-muted)]'

function Bar({ percent, tone = 'blue' }: { percent: number; tone?: 'blue' | 'strong' | 'violet' | 'pink' }) {
  const fill = { blue: 'var(--logo-blue)', strong: 'var(--logo-blue-strong)', violet: 'var(--logo-violet)', pink: 'var(--logo-pink)' }[tone]
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-[var(--surface-muted)]">
      <div className="h-full rounded-full" style={{ width: `${Math.max(0, Math.min(100, percent))}%`, backgroundColor: fill }} />
    </div>
  )
}

// ─── Panel ──────────────────────────────────────────────────────────────────

interface TasksPanelProps {
  sessionId: string
  tasks: TaskData[] | undefined
  studentCount: number
}

export default function TasksPanel({ sessionId, tasks, studentCount }: TasksPanelProps) {
  const queryClient = useQueryClient()
  const { toast } = useToast()
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [showBuilder, setShowBuilder] = useState(false)
  const [search, setSearch] = useState('')

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['session-tasks', sessionId] })

  const createTask = useMutation({
    mutationFn: (data: { title: string; description: string; task_type: string; content_json?: string; due_at?: string | null }) =>
      teacherApi.createTask(sessionId, data),
    onSuccess: () => { refresh(); setShowBuilder(false); toast({ title: tl("Compito creato!") }) },
  })
  const publishTask = useMutation({
    mutationFn: (taskId: string) => teacherApi.updateTask(sessionId, taskId, { new_status: 'published' }),
    onSuccess: () => { refresh(); toast({ title: tl("Compito pubblicato!") }) },
  })
  const deleteTask = useMutation({
    mutationFn: (taskId: string) => teacherApi.deleteTask(sessionId, taskId),
    onSuccess: (_, taskId) => {
      refresh()
      if (selectedId === taskId) setSelectedId(null)
      toast({ title: tl("Compito eliminato") })
    },
  })
  const confirmDelete = (task: TaskData) => {
    if (window.confirm(tl("Eliminare definitivamente il compito \"{0}\"? Questa azione non può essere annullata.", task.title))) {
      deleteTask.mutate(task.id)
    }
  }

  const selected = tasks?.find(task => task.id === selectedId) ?? null
  useEffect(() => {
    if (selectedId && tasks && !selected) setSelectedId(null)
  }, [selectedId, selected, tasks])

  if (selected) {
    return (
      <TaskWorkspace
        key={selected.id}
        task={selected}
        sessionId={sessionId}
        onBack={() => setSelectedId(null)}
        onPublish={() => publishTask.mutate(selected.id)}
        onDelete={() => confirmDelete(selected)}
      />
    )
  }

  const visible = (tasks ?? []).filter(task => {
    const terms = search.toLowerCase().split(/\s+/).filter(Boolean)
    const target = [task.title, task.description || '', TYPE_LABEL[task.task_type] || task.task_type].join(' ').toLowerCase()
    return terms.every(term => target.includes(term))
  })

  return (
    <section className="ds-panel rounded-[var(--ds-radius-panel)]">
      <div className="flex items-center gap-3 p-4">
        <ClipboardList className="h-4 w-4 text-[var(--text-secondary)]" />
        <span className="ui-control-label text-[var(--text-primary)]">{tl("Compiti")}</span>
        <Badge tone="neutral" surface="soft" density="compact">{tasks?.length ?? 0}</Badge>
        {!showBuilder && (
          <Button size="sm" onClick={() => setShowBuilder(true)} className="ml-auto">
            <Plus className="mr-1.5 h-3.5 w-3.5" />{tl("Nuovo compito")}
          </Button>
        )}
      </div>
      <div className="space-y-4 px-4 pb-4">
        {showBuilder && (
          <TaskBuilder onSubmit={data => createTask.mutate(data)} onCancel={() => setShowBuilder(false)} isLoading={createTask.isPending} />
        )}
        {tasks && tasks.length > 0 && (
          <SearchPill value={search} onValueChange={setSearch} placeholder={tl("Cerca compiti...")} className="max-w-sm" />
        )}
        {!tasks || tasks.length === 0 ? (
          <p className={`py-8 text-center text-sm ${MUTED}`}>{tl("Nessun compito assegnato. Crea il primo compito sopra.")}</p>
        ) : visible.length === 0 ? (
          <p className={`py-8 text-center text-sm ${MUTED}`}>{tl("Nessun compito corrisponde a")} <strong>"{search}"</strong></p>
        ) : (
          <div className="space-y-2">
            <div className={`hidden grid-cols-[minmax(0,1fr)_120px_150px_90px_96px] gap-3 px-4 md:grid ${META_LABEL}`}>
              <span>{tl("Compito")}</span><span>{tl("Scadenza")}</span><span>{tl("Consegne")}</span><span>{tl("Esito")}</span><span />
            </div>
            {visible.map(task => {
              const delivered = task.submission_count ?? 0
              const average = task.score_summary?.average_percent
              return (
                <div
                  key={task.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => setSelectedId(task.id)}
                  onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSelectedId(task.id) } }}
                  className="ui-card ui-card-interactive grid cursor-pointer grid-cols-1 items-center gap-2 p-4 outline-none focus-visible:shadow-[var(--ds-shadow-focus)] md:grid-cols-[minmax(0,1fr)_120px_150px_90px_96px] md:gap-3"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-[var(--text-primary)]">{task.title}</p>
                    <p className={`mt-1 flex items-center gap-2 text-xs ${MUTED}`}>
                      <span>{TYPE_LABEL[task.task_type] || task.task_type}</span>
                      <Badge tone={task.status === 'published' ? 'success' : 'neutral'} surface="soft" density="compact">
                        {task.status === 'published' ? tl("Pubblicato") : tl("Bozza")}
                      </Badge>
                    </p>
                  </div>
                  <span className="text-xs text-[var(--text-secondary)]">{task.due_at ? dateTime(task.due_at) : tl("Senza scadenza")}</span>
                  {task.status === 'published' ? (
                    <div className="space-y-1.5">
                      <p className="text-xs font-semibold text-[var(--text-primary)]">{delivered}/{studentCount || '—'}</p>
                      <Bar percent={studentCount > 0 ? delivered / studentCount * 100 : 0} />
                    </div>
                  ) : <span className={`text-xs ${MUTED}`}>—</span>}
                  <span className="text-xs font-semibold text-[var(--text-primary)]">
                    {task.task_type === 'quiz' && average != null ? `${average}%` : '—'}
                  </span>
                  <div className="flex items-center justify-end gap-1" onClick={e => e.stopPropagation()}>
                    {task.status === 'draft' ? (
                      <Button size="sm" tone="accent" surface="solid" onClick={() => publishTask.mutate(task.id)}>
                        <Check className="mr-1 h-3 w-3" />{tl("Pubblica")}
                      </Button>
                    ) : (
                      <ChevronRight className="h-4 w-4 text-[var(--text-muted)]" />
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </section>
  )
}

// ─── Workspace for one task ─────────────────────────────────────────────────

function TaskWorkspace({ task, sessionId, onBack, onPublish, onDelete }: {
  task: TaskData
  sessionId: string
  onBack: () => void
  onPublish: () => void
  onDelete: () => void
}) {
  const { toast } = useToast()
  const published = task.status === 'published'
  const [tab, setTab] = useState<WorkspaceTab>(published ? 'students' : 'task')
  const [analysis, setAnalysis] = useState<TaskAnalysisData | null>(null)
  const [busy, setBusy] = useState<'csv' | 'pdf' | null>(null)

  const { data: results, isLoading } = useQuery<TaskResults>({
    queryKey: ['task-results', sessionId, task.id],
    queryFn: async () => (await teacherApi.getTaskResults(sessionId, task.id)).data,
    enabled: published,
  })

  const analyze = useMutation({
    mutationFn: async () => (await teacherApi.analyzeTask(sessionId, task.id)).data as TaskAnalysisData,
    onSuccess: data => setAnalysis(data),
    onError: () => toast({ title: tl("Analisi non disponibile. Verifica i crediti docente e riprova."), variant: 'destructive' }),
  })

  const download = async (kind: 'csv' | 'pdf') => {
    setBusy(kind)
    try {
      const res = kind === 'csv'
        ? await teacherApi.downloadTaskResultsCsv(sessionId, task.id)
        : await teacherApi.downloadTaskReportPdf(sessionId, task.id, analysis)
      await saveBlob(res.data, safeName(task.title, kind))
    } catch {
      toast({ title: tl("Esportazione non riuscita"), variant: 'destructive' })
    } finally {
      setBusy(null)
    }
  }

  const tabs: Array<{ key: WorkspaceTab; label: string }> = [
    ...(published ? [
      { key: 'students' as const, label: tl("Consegne") },
      { key: 'table' as const, label: tl("Tabella risposte") },
      { key: 'summary' as const, label: tl("Riepilogo") },
    ] : []),
    { key: 'task', label: tl("Compito") },
  ]

  return (
    <section className="ds-panel rounded-[var(--ds-radius-panel)]">
      <div className="flex flex-wrap items-center gap-3 p-4">
        <Button size="sm" tone="neutral" surface="soft" onClick={onBack}><ArrowLeft className="mr-1.5 h-3.5 w-3.5" />{tl("Compiti")}</Button>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-[var(--text-primary)]">{task.title}</p>
          <p className={`text-xs ${MUTED}`}>
            {TYPE_LABEL[task.task_type] || task.task_type} · {task.due_at ? dateTime(task.due_at) : tl("Senza scadenza")}
            {results && ` · ${tl("Consegne")}: ${results.totals.submitted}/${results.totals.students}`}
          </p>
        </div>
        {published ? (
          <>
            <Button size="sm" tone="neutral" surface="soft" disabled={busy !== null || !results} onClick={() => void download('csv')}>
              <Download className="mr-1.5 h-3.5 w-3.5" />{busy === 'csv' ? tl("Download…") : 'CSV'}
            </Button>
            <Button size="sm" tone="accent" surface="solid" disabled={busy !== null || !results} onClick={() => void download('pdf')}>
              <FileText className="mr-1.5 h-3.5 w-3.5" />{busy === 'pdf' ? tl("Download…") : tl("Report PDF")}
            </Button>
          </>
        ) : (
          <Button size="sm" tone="accent" surface="solid" onClick={onPublish}><Check className="mr-1.5 h-3.5 w-3.5" />{tl("Pubblica")}</Button>
        )}
        <Button size="sm" tone="danger" surface="soft" onClick={onDelete} title={tl("Elimina compito")} aria-label={tl("Elimina compito {0}", task.title)}>
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>

      <div className="px-4 pb-4">
        <Tabs value={tab} onValueChange={value => setTab(value as WorkspaceTab)} density="compact" tone="accent">
          <TabsList>
            {tabs.map(item => <TabsTrigger key={item.key} value={item.key}>{item.label}</TabsTrigger>)}
          </TabsList>
        </Tabs>
      </div>

      <div className="px-4 pb-4">
        {tab === 'task' && <TaskDetailsTab task={task} sessionId={sessionId} />}
        {published && tab !== 'task' && (isLoading || !results ? (
          <p className={`py-8 text-center text-sm ${MUTED}`}>{tl("Caricamento...")}</p>
        ) : tab === 'students' ? (
          <StudentsTab task={task} sessionId={sessionId} results={results} />
        ) : tab === 'table' ? (
          <TableTab results={results} />
        ) : (
          <SummaryTab results={results} analysis={analysis} analyzing={analyze.isPending} onAnalyze={() => analyze.mutate()} />
        ))}
      </div>
    </section>
  )
}

// ─── Tab: students roster + individual answers ──────────────────────────────

function StudentsTab({ task, sessionId, results }: { task: TaskData; sessionId: string; results: TaskResults }) {
  const [openId, setOpenId] = useState<string | null>(null)
  const [onlyMissing, setOnlyMissing] = useState(false)
  const rows = onlyMissing ? results.rows.filter(r => !r.submitted) : results.rows
  const missing = results.rows.filter(r => !r.submitted).length

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone="success" surface="soft" density="compact">{results.totals.submitted} {tl("consegnati")}</Badge>
        <Badge tone="neutral" surface="soft" density="compact">{missing} {tl("mancanti")}</Badge>
        {missing > 0 && (
          <Button size="sm" tone="neutral" surface="ghost" className="ml-auto" onClick={() => setOnlyMissing(v => !v)}>
            {onlyMissing ? tl("Mostra tutti") : tl("Mostra solo chi non ha consegnato")}
          </Button>
        )}
      </div>
      {results.rows.length === 0 ? (
        <p className={`py-6 text-center text-sm ${MUTED}`}>{tl("Nessuno studente in questa sessione.")}</p>
      ) : (
        <div className="space-y-2">
          {rows.map(row => {
            const open = openId === row.student_id
            const pct = scorePercent(row.score)
            return (
              <div key={row.student_id} className="ui-card overflow-hidden">
                <button
                  type="button"
                  disabled={!row.submitted}
                  onClick={() => setOpenId(open ? null : row.student_id)}
                  aria-expanded={open}
                  className="flex w-full items-center gap-3 px-4 py-3 text-left outline-none focus-visible:shadow-[var(--ds-shadow-focus)] enabled:hover:bg-[var(--ds-control-hover)] disabled:cursor-default"
                >
                  <span className="min-w-0 flex-1 truncate text-sm font-semibold text-[var(--text-primary)]">{row.student_nickname}</span>
                  {row.submitted ? (
                    <>
                      <span className={`hidden text-xs sm:inline ${MUTED}`}>{dateTime(row.submitted_at)}</span>
                      {task.task_type === 'quiz' && row.score && (
                        <Badge tone="warning" surface="soft" density="compact">
                          {row.score.split('+')[0].trim()}{pct != null ? ` · ${pct}%` : ''}
                        </Badge>
                      )}
                      <Badge tone="success" surface="soft" density="compact">{tl("Consegnato")}</Badge>
                      <ChevronRight className={`h-4 w-4 text-[var(--text-muted)] transition-transform ${open ? 'rotate-90' : ''}`} />
                    </>
                  ) : (
                    <Badge tone="neutral" surface="soft" density="compact">{tl("Non consegnato")}</Badge>
                  )}
                </button>
                {open && <StudentDetail task={task} sessionId={sessionId} row={row} results={results} />}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

function StudentDetail({ task, sessionId, row, results }: { task: TaskData; sessionId: string; row: ResultRow; results: TaskResults }) {
  const { data: submissions } = useQuery<SubmissionData[]>({
    queryKey: ['task-submissions', sessionId, task.id],
    queryFn: async () => (await teacherApi.getTaskSubmissions(sessionId, task.id)).data,
  })
  const submission = submissions?.find(s => s.id === row.submission_id)

  return (
    <div className="space-y-3 px-4 pb-4">
      {results.questions.length > 0 ? (
        <div className={`${SOFT_BLOCK} overflow-x-auto`}>
          <table className="w-full text-left text-xs">
            <thead>
              <tr className={META_LABEL}>
                <th className="w-8 px-3 py-2">#</th><th className="px-3 py-2">{tl("Domanda")}</th><th className="px-3 py-2">{tl("Risposta")}</th><th className="w-16 px-3 py-2">{tl("Esito")}</th>
              </tr>
            </thead>
            <tbody>
              {results.questions.map(q => {
                const cell = row.answers[q.index]
                return (
                  <tr key={q.index} className="align-top">
                    <td className={`px-3 py-2 ${MUTED}`}>{q.index + 1}</td>
                    <td className="px-3 py-2 font-medium text-[var(--text-primary)]">{q.text}</td>
                    <td className="whitespace-pre-wrap px-3 py-2 text-[var(--text-primary)]">
                      {cell?.answered ? cell.display : <span className={MUTED}>{tl("Nessuna risposta")}</span>}
                      {cell?.correct === false && q.correct_index != null && (
                        <span className="mt-0.5 block text-[var(--logo-blue-strong)]">{tl("Corretta:")} {q.options[q.correct_index]}</span>
                      )}
                    </td>
                    <td className="px-3 py-2 font-bold">
                      {cell?.correct === true ? <span className="text-[var(--logo-blue-strong)]">✓</span>
                        : cell?.correct === false ? <span className="text-[var(--logo-pink)]">✗</span>
                        : <span className={MUTED}>—</span>}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      ) : submission ? (
        <div className={`${SOFT_BLOCK} p-3`}><SubmissionContentPreview submission={submission} task={task} /></div>
      ) : (
        <p className={`${SOFT_BLOCK} whitespace-pre-wrap p-3 text-sm text-[var(--text-primary)]`}>{row.text || tl("Risposta vuota.")}</p>
      )}
      {submission && task.task_type === 'exercise' && <ExerciseCorrectionPanel submission={submission} task={task} sessionId={sessionId} />}
      {submission && <SubmissionFeedbackEditor submission={submission} task={task} sessionId={sessionId} />}
    </div>
  )
}

// ─── Tab: spreadsheet (only students who handed in) ─────────────────────────

function TableTab({ results }: { results: TaskResults }) {
  const baseGrid = useMemo(() => {
    const head = [tl("Studente"), tl("Consegnato il")]
    if (results.questions.length) {
      head.push(...results.questions.map(q => `D${q.index + 1}. ${q.text}`), tl("Punteggio"), '%')
    } else {
      head.push(tl("Risposta"), tl("Voto"))
    }
    head.push(tl("Feedback docente"))
    const body = results.rows.filter(row => row.submitted).map(row => {
      const line = [row.student_nickname, dateTime(row.submitted_at)]
      if (results.questions.length) {
        line.push(...results.questions.map(q => row.answers[q.index]?.display ?? ''))
        const pct = scorePercent(row.score)
        line.push(row.score ?? '', pct == null ? '' : String(pct))
      } else {
        line.push(row.text ?? '', row.score ?? '')
      }
      line.push(row.feedback ?? '')
      return line
    })
    return [head, ...body]
  }, [results])

  // Local working copy: sorting, filters, formulas and charts never touch the real answers.
  const [data, setData] = useState<string[][]>(baseGrid)
  useEffect(() => setData(baseGrid), [baseGrid])
  const [chart, setChart] = useState<SheetChartConfig>({ type: 'bar', title: tl("Grafico risposte"), xCol: 0, yCol: results.questions.length ? 2 + results.questions.length + 1 : 1, showRegression: false })

  if (results.totals.submitted === 0) {
    return <p className={`py-8 text-center text-sm ${MUTED}`}>{tl("Nessuna consegna ancora.")}</p>
  }
  return (
    <div className="space-y-3">
      <p className={`ui-supporting-text ${MUTED}`}>
        {tl("Una riga per ogni studente che ha consegnato, una colonna per domanda. Puoi ordinare, filtrare e aggiungere formule o grafici: le modifiche restano solo in questa vista (usa CSV/XLSX per esportare).")}
      </p>
      <SpreadsheetEditor data={data} onDataChange={setData} chartConfig={chart} onChartConfigChange={setChart} />
    </div>
  )
}

// ─── Tab: summary (stats + AI brief) ────────────────────────────────────────

function SummaryTab({ results, analysis, analyzing, onAnalyze }: {
  results: TaskResults
  analysis: TaskAnalysisData | null
  analyzing: boolean
  onAnalyze: () => void
}) {
  const [ignored, setIgnored] = useState<Set<string>>(new Set())
  const pcts = results.rows.map(r => scorePercent(r.score)).filter((v): v is number => v != null)
  const average = pcts.length ? Math.round(pcts.reduce((a, b) => a + b, 0) / pcts.length) : null
  const flags = (analysis?.student_flags ?? [])
    .flatMap(s => s.flags.map((flag, i) => ({ ...flag, name: s.student_nickname, key: `${s.student_id}:${flag.type}:${i}:${flag.evidence}` })))
    .filter(f => !ignored.has(f.key))

  const stats = [
    { label: tl("Consegne"), value: `${results.totals.submitted}/${results.totals.students}` },
    { label: tl("Mancanti"), value: String(results.totals.students - results.totals.submitted) },
    ...(results.task.task_type === 'quiz' ? [{ label: tl("Media quiz"), value: average == null ? '—' : `${average}%` }] : []),
  ]

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {stats.map(stat => (
          <div key={stat.label} className="ui-card p-4">
            <p className={META_LABEL}>{stat.label}</p>
            <p className="mt-1 text-xl font-bold text-[var(--text-primary)]">{stat.value}</p>
          </div>
        ))}
      </div>

      {results.questions.length > 0 && (
        <div className="space-y-3">
          <p className="ui-control-label text-[var(--text-primary)]">{tl("Risposte per domanda")}</p>
          {results.questions.map((q, i) => {
            const qs = results.question_stats[i]
            const total = Math.max(qs.answered, 1)
            return (
              <div key={q.index} className="ui-card space-y-3 p-4">
                <div className="flex items-start justify-between gap-3">
                  <p className="text-sm font-semibold text-[var(--text-primary)]">{q.index + 1}. {q.text}</p>
                  <span className={`shrink-0 text-xs ${MUTED}`}>{qs.answered}/{qs.submitted} {tl("risposte")}</span>
                </div>
                {q.type === 'mcq' && (
                  <div className="space-y-2">
                    {qs.correct_percent != null && <p className="text-xs font-semibold text-[var(--logo-blue-strong)]">{qs.correct_percent}% {tl("corrette")}</p>}
                    {q.options.map((opt, j) => {
                      const n = qs.distribution?.[j] ?? 0
                      const good = j === q.correct_index
                      return (
                        <div key={j} className="grid grid-cols-[minmax(0,40%)_1fr_28px] items-center gap-3 text-xs">
                          <span className={`truncate ${good ? 'font-semibold text-[var(--logo-blue-strong)]' : 'text-[var(--text-secondary)]'}`} title={opt}>{good && '✓ '}{opt}</span>
                          <Bar percent={n / total * 100} tone={good ? 'strong' : 'violet'} />
                          <span className={`text-right ${MUTED}`}>{n}</span>
                        </div>
                      )
                    })}
                  </div>
                )}
                {q.type === 'scale' && (
                  <div className="space-y-2">
                    <p className="text-xs font-semibold text-[var(--text-primary)]">{tl("Media")}: {qs.average ?? '—'} ({q.min}–{q.max})</p>
                    {(qs.distribution ?? []).map((n, j) => (
                      <div key={j} className="grid grid-cols-[28px_1fr_28px] items-center gap-3 text-xs">
                        <span className={MUTED}>{q.min + j}</span>
                        <Bar percent={n / total * 100} tone="violet" />
                        <span className={`text-right ${MUTED}`}>{n}</span>
                      </div>
                    ))}
                  </div>
                )}
                {q.type === 'open' && <p className={`text-xs ${MUTED}`}>{tl("Domanda aperta: leggi le risposte nella tabella o genera il riepilogo AI.")}</p>}
              </div>
            )
          })}
        </div>
      )}

      <div className="ui-card space-y-4 p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <p className="ui-control-label flex items-center gap-2 text-[var(--text-primary)]"><Brain className="h-4 w-4 text-[var(--logo-violet-strong)]" />{tl("Riepilogo AI")}</p>
            <p className={`ui-supporting-text mt-1 ${MUTED}`}>
              {tl("Sintetizza le risposte (comprese quelle aperte) in punti di forza, lacune e azioni. Viene incluso nel report PDF se generato prima del download. Non assegna voti.")}
            </p>
          </div>
          <Button size="sm" tone="accent" surface="solid" onClick={onAnalyze} disabled={analyzing || results.totals.submitted === 0} className="shrink-0">
            <Brain className="mr-1.5 h-3.5 w-3.5" />
            {analyzing ? tl("Analisi in corso…") : analysis ? tl("Rigenera riepilogo") : tl("Genera riepilogo")}
          </Button>
        </div>
        {analysis && (
          <div className="space-y-4">
            <p className="text-sm leading-6 text-[var(--text-primary)]">{analysis.overview.summary}</p>
            {analysis.overview.completion_summary && <p className={`text-xs ${MUTED}`}>{analysis.overview.completion_summary}</p>}
            <div className="grid gap-3 md:grid-cols-3">
              {[
                { title: tl("Punti di forza"), values: analysis.overview.strengths, tone: 'bg-[var(--surface-logo-blue)]' },
                { title: tl("Da approfondire"), values: analysis.overview.gaps, tone: 'bg-[var(--surface-logo-violet)]' },
                { title: tl("Azioni suggerite"), values: analysis.overview.suggestions, tone: 'bg-[var(--surface-muted)]' },
              ].map(section => (
                <div key={section.title} className={`rounded-[var(--ds-radius-control)] p-3 ${section.tone}`}>
                  <p className="ui-control-label text-[var(--text-primary)]">{section.title}</p>
                  {section.values.length ? (
                    <ul className="mt-2 list-disc space-y-1 pl-4 text-xs leading-5 text-[var(--text-primary)]">{section.values.map((v, i) => <li key={i}>{v}</li>)}</ul>
                  ) : <p className={`mt-2 text-xs ${MUTED}`}>{tl("Nessun elemento rilevato.")}</p>}
                </div>
              ))}
            </div>
            {flags.length > 0 && (
              <div className="space-y-2">
                <p className="ui-control-label text-[var(--text-primary)]">{tl("Flag sulle consegne")} <span className={`ml-1 ${META_LABEL}`}>{tl("Da verificare dal docente")}</span></p>
                {flags.map(flag => {
                  const meta = FORMATIVE_FLAG_META[flag.type]
                  return (
                    <div key={flag.key} className={`flex items-start justify-between gap-3 rounded-[var(--ds-radius-control)] p-3 ${meta.className}`}>
                      <div className="min-w-0">
                        <p className="text-xs"><span className="font-bold">{flag.name}</span> · {meta.label}</p>
                        <p className="mt-1 text-xs leading-5">{flag.reason}</p>
                        {flag.evidence && <blockquote className="mt-1 pl-2 text-xs italic">“{flag.evidence}”</blockquote>}
                      </div>
                      <Button size="sm" tone="neutral" surface="soft" onClick={() => setIgnored(prev => new Set(prev).add(flag.key))}>{tl("Ignora")}</Button>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Tab: task definition ───────────────────────────────────────────────────

function TaskDetailsTab({ task, sessionId }: { task: TaskData; sessionId: string }) {
  const queryClient = useQueryClient()
  const { toast } = useToast()
  const [editing, setEditing] = useState(false)
  const [dueAt, setDueAt] = useState(() => toDateTimeLocalValue(task.due_at))
  const update = useMutation({
    mutationFn: (payload: { title?: string; description?: string; due_at?: string | null; content_json?: string }) =>
      teacherApi.updateTask(sessionId, task.id, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['session-tasks', sessionId] })
      setEditing(false)
      toast({ title: tl("Compito aggiornato") })
    },
    onError: () => toast({ title: tl("Errore aggiornamento compito"), variant: 'destructive' }),
  })
  const isDraft = task.status === 'draft'

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-[var(--text-secondary)]">
          {isDraft ? tl("Questa attività è in bozza: puoi modificarla prima della pubblicazione.") : tl("Puoi aggiornare la scadenza anche dopo la pubblicazione.")}
        </p>
        <Button size="sm" tone="neutral" surface="soft" onClick={() => setEditing(v => !v)}>
          {editing ? tl("Annulla Modifica") : isDraft ? tl("Modifica Bozza") : tl("Modifica Scadenza")}
        </Button>
      </div>
      {editing ? (
        isDraft ? (
          <TaskBuilder
            mode="edit"
            initialData={task}
            onSubmit={data => update.mutate({ title: data.title, description: data.description, due_at: data.due_at, content_json: data.content_json })}
            onCancel={() => setEditing(false)}
            isLoading={update.isPending}
          />
        ) : (
          <div className={`${SOFT_BLOCK} space-y-3 p-3`}>
            <label className="ui-control-label block text-[var(--text-primary)]">{tl("Scadenza")}
              <Input type="datetime-local" value={dueAt} onChange={e => setDueAt(e.target.value)} className="mt-1" />
            </label>
            <div className="flex justify-end">
              <Button size="sm" tone="accent" surface="solid" disabled={update.isPending} onClick={() => update.mutate({ due_at: dueAt ? new Date(dueAt).toISOString() : null })}>{tl("Salva modifiche")}</Button>
            </div>
          </div>
        )
      ) : (
        <div className="space-y-3">
          {task.description && <p className="text-sm text-[var(--text-primary)]"><span className="font-semibold">{tl("Descrizione:")}</span> {task.description}</p>}
          {task.content_json && <TaskContentPreview task={task} />}
        </div>
      )}
    </div>
  )
}
