import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Area, AreaChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { Activity, AlertTriangle, CheckCircle2, Cpu, Database, Download, Gauge, Loader2, Play, RefreshCw, Server, Square, Terminal, Trash2, Users, XCircle, Zap } from '@/components/icons'
import { Button } from '@/design'
import { AdminBadge, AdminNotice, AdminPageHeader, AdminSection, AdminStat, AdminStatGrid, AdminTabs, AdminEmpty } from '@/components/admin/AdminUI'
import { useAuthStore } from '@/stores/auth'
import { useUiThemeStore } from '@/stores/uiTheme'
import { cn } from '@/lib/utils'
import { tl } from '@/i18n/tl'

/*
 * Admin «Stress test»: configures and launches a load test on the separate `loadtest` service
 * (backend/app/loadtest), follows it live over SSE (virtual users, platform readings, container logs)
 * and shows the saved reports with plain-language findings.
 */

const API = '/loadtest/api'

type Scenario = { key: string; label: string; description: string }
type Info = {
  scenarios: Scenario[]
  max_users: number
  default_prompt: string
  simulation_available: boolean
  docker_available: boolean
  containers: string[]
  log_services: string[]
  target: string
  current: RunSnapshot | null
}
type RunSnapshot = { id: string; status: string; created_at: string; ended_at?: string | null; users: number; label?: string; seq: number; config: Record<string, any> }
type UserState = { i: number; scenario: string; nick: string; state: string; detail: string; error?: string | null; files: number; events: number; project_id?: string | null; job_id?: string | null; valid?: boolean | null; problems?: string[] }
type LogLine = { seq: number; t: number; source: string; level: 'info' | 'warn' | 'error'; msg: string; user?: number | null }
type Metric = {
  t: number; rps: number; errors: number; lat_p50: number | null; lat_p95: number | null
  states: Record<string, number>; probes: Record<string, number | null>
  containers: Record<string, { cpu?: number; mem_mb?: number; error?: string }>
  db: { total?: number; active?: number; idle?: number; idle_in_tx?: number; lock_wait?: number; max?: number; jobs_running?: number; error?: string }
}
type StepSummary = { label: string; count: number; ok: number; failed: number; p50: number | null; p95: number | null; p99: number | null; max: number | null; errors: Record<string, number> }
type Finding = { severity: 'ok' | 'warn' | 'critical'; title: string; detail: string }
type Report = {
  id: string; label?: string; status: string; created_at: string; ended_at?: string; duration_s: number; config: Record<string, any>
  scenarios: Record<string, { users: number; done: number; error: number; stopped: number; other: number; errors: Record<string, number>; valid?: number; invalid?: number; problems?: Record<string, number> }>
  steps: Record<string, StepSummary>; probes: Record<string, { p50: number | null; p95: number | null; max: number | null; failures: number }>
  peaks: Record<string, any>; findings: Finding[]; users: UserState[]; timeline: Metric[]
  logs: { lines: Record<string, number>; errors: Record<string, number>; dropped: Record<string, number> }
  created: { student_ids: string[]; project_ids: string[]; job_ids: string[] }
  cleanup?: { deleted: Record<string, number>; errors: string[] }
  cost?: { total: number; calls: number; prompt_tokens: number; completion_tokens: number; unit: string; by_model: { provider: string; model: string; calls: number; cost: number; prompt_tokens: number; completion_tokens: number }[] } | null
}
type ReportRow = { id: string; label?: string; status: string; created_at: string; duration_s: number; users: number; llm_mode: string; scenarios: Record<string, number>; gen_p50: number | null; gen_ok: number | null; gen_failed: number | null; valid?: number; invalid?: number; cost?: number | null; critical: number; cleaned: boolean; created_rows: Record<string, number> }

// Categorical palette (validated light/dark steps, fixed order — never cycled).
const SERIES = {
  light: ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#6250d6', '#e34948'],
  dark: ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#0ca30c', '#9085e9', '#e66767'],
}
const STATE_META: Record<string, { label: string; slot: number | 'muted' }> = {
  waiting: { label: 'In attesa', slot: 'muted' },
  login: { label: 'Login', slot: 0 },
  open: { label: 'Apre Vibe Lab', slot: 6 },
  idle: { label: 'Sulla pagina', slot: 2 },
  chat: { label: 'Chat AI', slot: 4 },
  creating: { label: 'Crea progetto', slot: 3 },
  generating: { label: 'Genera codice', slot: 1 },
  done: { label: 'Completato', slot: 5 },
  invalid: { label: 'Generato ma non valido', slot: 3 },
  error: { label: 'Errore', slot: 7 },
  stopped: { label: 'Interrotto', slot: 'muted' },
}
const STATE_ORDER = ['waiting', 'login', 'open', 'idle', 'chat', 'creating', 'generating', 'done', 'invalid', 'error', 'stopped']
// A finished generation whose saved result failed the checks is shown as its own state.
const viewState = (u: UserState) => (u.state === 'done' && u.valid === false ? 'invalid' : u.state)
const MAX_LOG_LINES = 6000

function authHeaders(): Record<string, string> {
  const token = useAuthStore.getState().accessToken
  return token ? { Authorization: `Bearer ${token}` } : {}
}

async function lt<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API}${path}`, { ...init, headers: { 'Content-Type': 'application/json', ...authHeaders(), ...(init?.headers || {}) } })
  if (!response.ok) {
    const body = await response.json().catch(() => null)
    const error = new Error(typeof body?.detail === 'string' ? body.detail : `HTTP ${response.status}`) as Error & { status?: number }
    error.status = response.status
    throw error
  }
  return response.json()
}

function useIsDark() {
  return useUiThemeStore((s) => s.theme === 'dark')
}

function ms(value: number | null | undefined) {
  if (value == null) return '—'
  return value >= 10000 ? `${(value / 1000).toFixed(1)} s` : `${Math.round(value)} ms`
}

function fmtTime(t: number) {
  const m = Math.floor(t / 60)
  const s = Math.floor(t % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}

export default function AdminStressTestPage() {
  const [info, setInfo] = useState<Info | null>(null)
  const [infoError, setInfoError] = useState<string | null>(null)
  const [tab, setTab] = useState<'run' | 'history'>('run')
  const [reports, setReports] = useState<ReportRow[]>([])
  const [viewReport, setViewReport] = useState<Report | null>(null)

  const loadInfo = useCallback(async () => {
    try {
      const data = await lt<Info>('/info')
      setInfo(data)
      setInfoError(null)
    } catch (e: any) {
      setInfo(null)
      setInfoError(e?.status === 502 || e?.status === 404 || e?.status === 504 ? 'offline' : e?.message || 'errore')
    }
  }, [])

  const loadReports = useCallback(async () => {
    try {
      const data = await lt<{ reports: ReportRow[] }>('/runs')
      setReports(data.reports)
    } catch {
      setReports([])
    }
  }, [])

  useEffect(() => { void loadInfo(); void loadReports() }, [loadInfo, loadReports])

  const openReport = async (id: string) => {
    try {
      setViewReport(await lt<Report>(`/runs/${id}/report`))
      setTab('history')
    } catch (e: any) {
      alert(e?.message)
    }
  }

  return (
    <div className="space-y-4">
      <AdminPageHeader
        eyebrow={tl('Sistema')}
        title={tl('Stress test')}
        description={tl('Simula decine o centinaia di studenti che usano la piattaforma nello stesso momento e osserva in tempo reale cosa succede: tempi, errori, risorse dei container, database e log.')}
        actions={<AdminTabs value={tab} onChange={(v) => { setTab(v); if (v === 'history') void loadReports() }} options={[['run', tl('Prova')], ['history', tl('Report salvati')]] as const} />}
      />

      {infoError === 'offline' && (
        <AdminNotice tone="warning" icon={AlertTriangle}>
          <p className="font-medium">{tl('Il servizio di stress test non è attivo.')}</p>
          <p className="mt-1 text-[13px] text-[var(--admin-ink-2)]">{tl('È un container separato, spento di default. Avvialo sul server (solo sviluppo/staging) e ricarica:')}</p>
          <code className="mt-2 block rounded-md bg-[var(--admin-surface-2)] px-3 py-2 font-mono text-[12px]">docker compose -p dev_golinelli_ai --profile loadtest up -d --build loadtest</code>
          <Button className="mt-2" tone="neutral" surface="soft" density="compact" onClick={() => void loadInfo()}><RefreshCw /> {tl('Riprova')}</Button>
        </AdminNotice>
      )}
      {infoError && infoError !== 'offline' && <AdminNotice tone="danger" icon={XCircle}>{infoError}</AdminNotice>}

      {info && tab === 'run' && <RunTab info={info} onFinished={() => void loadReports()} />}
      {info && tab === 'history' && (
        viewReport
          ? <ReportView report={viewReport} onBack={() => setViewReport(null)} onChanged={async () => { await loadReports(); setViewReport(await lt<Report>(`/runs/${viewReport.id}/report`)) }} />
          : <HistoryTable reports={reports} onOpen={openReport} onChanged={loadReports} />
      )}
    </div>
  )
}

// ── Configuration + live view ───────────────────────────────────────────────────────────

function RunTab({ info, onFinished }: { info: Info; onFinished: () => void }) {
  const [counts, setCounts] = useState<Record<string, number>>({ vibe_access: 100, vibe_generate: 100, vibe_ai_chat: 0 })
  const [ramp, setRamp] = useState(20)
  const [mode, setMode] = useState<'simulated' | 'real'>('simulated')
  const [sim, setSim] = useState({ ttft_ms: 2500, tokens_per_s: 70, pad_lines: 40, error_rate: 0 })
  const [prompt, setPrompt] = useState(info.default_prompt)
  const [stay, setStay] = useState(180)
  const [chatRequests, setChatRequests] = useState(5)
  const [logServices, setLogServices] = useState<string[]>(['api', 'api-pool', 'nginx', 'vibe-qa', 'postgres'])
  const [logAccess, setLogAccess] = useState(true)
  const [label, setLabel] = useState('')
  const [confirmReal, setConfirmReal] = useState('')
  const [starting, setStarting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [runId, setRunId] = useState<string | null>(info.current && ['preparing', 'running', 'stopping'].includes(info.current.status) ? info.current.id : null)

  const total = Object.values(counts).reduce((a, b) => a + (b || 0), 0)

  const start = async () => {
    setStarting(true)
    setError(null)
    try {
      const run = await lt<RunSnapshot>('/runs', {
        method: 'POST',
        body: JSON.stringify({
          scenarios: counts, ramp_seconds: ramp, llm_mode: mode, sim, prompt, stay_seconds: stay,
          chat_requests: chatRequests, log_services: logServices, log_access: logAccess, label, confirm_real: confirmReal,
        }),
      })
      setRunId(run.id)
    } catch (e: any) {
      setError(e?.message || 'Errore')
    } finally {
      setStarting(false)
    }
  }

  return (
    <div className="space-y-4">
      {!runId && (
        <AdminSection title={tl('Nuova prova')} description={tl('Gli utenti virtuali entrano in una sessione dedicata («Stress test», tenant separato) passando da nginx come browser veri.')}>
          <div className="grid gap-4 lg:grid-cols-[1.3fr_1fr]">
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="admin-eyebrow">{tl('Preset')}</span>
                <Button tone="neutral" surface="soft" density="compact" onClick={() => setCounts({ vibe_access: 5, vibe_generate: 5, vibe_ai_chat: 0 })}>{tl('Prova veloce 5 + 5')}</Button>
                <Button tone="neutral" surface="soft" density="compact" onClick={() => setCounts({ vibe_access: 30, vibe_generate: 30, vibe_ai_chat: 0 })}>{tl('Una classe 30 + 30')}</Button>
                <Button tone="neutral" surface="soft" density="compact" onClick={() => setCounts({ vibe_access: 100, vibe_generate: 100, vibe_ai_chat: 0 })}>{tl('100 accessi + 100 progetti')}</Button>
              </div>
              <div className="overflow-hidden rounded-[var(--admin-radius)] border border-[var(--admin-line)]">
                <table>
                  <thead><tr><th>{tl('Sezione da testare')}</th><th className="w-28">{tl('Utenti')}</th></tr></thead>
                  <tbody>
                    {info.scenarios.map((s) => (
                      <tr key={s.key}>
                        <td>
                          <p className="font-medium">{s.label}</p>
                          <p className="text-[12px] text-[var(--admin-ink-2)]">{s.description}</p>
                        </td>
                        <td>
                          <input type="number" min={0} max={info.max_users} value={counts[s.key] ?? 0} aria-label={`${tl('Utenti')} ${s.label}`}
                            onChange={(e) => setCounts({ ...counts, [s.key]: Math.max(0, Math.min(info.max_users, Number(e.target.value) || 0)) })}
                            className="h-8 w-20 px-2 text-sm" />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-[var(--admin-ink-2)]">{tl('Richiesta di generazione (uguale per tutti i progetti)')}</span>
                <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} rows={3} className="w-full px-3 py-2 text-sm" />
              </label>
            </div>

            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <NumberField label={tl('Ramp-up (s)')} hint={tl('0 = tutti nello stesso istante')} value={ramp} onChange={setRamp} min={0} max={600} />
                <NumberField label={tl('Permanenza sulla pagina (s)')} hint={tl('Utenti «Accesso»')} value={stay} onChange={setStay} min={0} max={3600} />
                <NumberField label={tl('Domande chat per utente')} value={chatRequests} onChange={setChatRequests} min={1} max={50} />
                <label className="block">
                  <span className="mb-1 block text-xs font-medium text-[var(--admin-ink-2)]">{tl('Etichetta')}</span>
                  <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder={tl('es. dopo fix pool DB')} className="h-8 w-full px-2 text-sm" />
                </label>
              </div>

              <div>
                <span className="mb-1 block text-xs font-medium text-[var(--admin-ink-2)]">{tl('Modelli AI')}</span>
                <AdminTabs value={mode} onChange={setMode} options={[['simulated', tl('Simulati (gratis)')], ['real', tl('Reali (costi veri)')]] as const} />
                {mode === 'simulated' ? (
                  <div className="mt-2 space-y-2">
                    {!info.simulation_available && <AdminNotice tone="danger" icon={XCircle}>{tl('LOAD_TEST_SECRET non è configurato in .env: la simulazione non è disponibile.')}</AdminNotice>}
                    <p className="text-[12px] text-[var(--admin-ink-2)]">{tl('L’API risponde con un modello finto ma con tempi realistici: misuri la piattaforma (DB, job, stream, build) senza consumare crediti.')}</p>
                    <div className="grid grid-cols-2 gap-3">
                      <NumberField label={tl('Primo token (ms)')} value={sim.ttft_ms} onChange={(v) => setSim({ ...sim, ttft_ms: v })} min={0} max={120000} />
                      <NumberField label={tl('Velocità (token/s)')} value={sim.tokens_per_s} onChange={(v) => setSim({ ...sim, tokens_per_s: v })} min={1} max={5000} />
                      <NumberField label={tl('Righe per file')} value={sim.pad_lines} onChange={(v) => setSim({ ...sim, pad_lines: v })} min={0} max={2000} />
                      <NumberField label={tl('Errori provider (%)')} value={Math.round(sim.error_rate * 100)} onChange={(v) => setSim({ ...sim, error_rate: v / 100 })} min={0} max={100} />
                    </div>
                  </div>
                ) : (
                  <div className="mt-2 space-y-2">
                    <AdminNotice tone="warning" icon={AlertTriangle}>
                      {tl('Ogni progetto chiama davvero i modelli assegnati in Admin → Modelli (architetto + agenti paralleli + controlli). Con 100 progetti il costo è reale e i limiti di velocità dei provider entrano in gioco: è proprio ciò che vuoi misurare, ma consuma crediti.')}
                    </AdminNotice>
                    <label className="block">
                      <span className="mb-1 block text-xs font-medium text-[var(--admin-ink-2)]">{tl('Scrivi REALE per confermare')}</span>
                      <input value={confirmReal} onChange={(e) => setConfirmReal(e.target.value)} className="h-8 w-40 px-2 font-mono text-sm" />
                    </label>
                  </div>
                )}
              </div>

              <div>
                <span className="mb-1 block text-xs font-medium text-[var(--admin-ink-2)]">{tl('Log dei container da seguire')}</span>
                <div className="flex flex-wrap gap-1.5">
                  {info.log_services.map((service) => {
                    const on = logServices.includes(service)
                    const present = info.containers.includes(service)
                    return (
                      <button key={service} type="button" aria-pressed={on} disabled={!present}
                        onClick={() => setLogServices(on ? logServices.filter((s) => s !== service) : [...logServices, service])}
                        className={cn('admin-badge', on ? 'admin-badge-accent' : 'admin-badge-neutral', !present && 'opacity-40')}>
                        {service}
                      </button>
                    )
                  })}
                </div>
                <label className="mt-2 flex items-center gap-2 text-[12px] text-[var(--admin-ink-2)]">
                  <input type="checkbox" checked={logAccess} onChange={(e) => setLogAccess(e.target.checked)} />
                  {tl('Includi i log di accesso (una riga per richiesta)')}
                </label>
                {!info.docker_available && <p className="mt-1 text-[12px] text-amber-700 dark:text-amber-300">{tl('Socket Docker non disponibile: niente CPU, memoria e log dei container.')}</p>}
              </div>
            </div>
          </div>

          {error && <AdminNotice className="mt-3" tone="danger" icon={XCircle}>{error}</AdminNotice>}
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-[var(--admin-line)] pt-3">
            <p className="text-[13px] text-[var(--admin-ink-2)]">
              <strong className="text-[var(--admin-ink)]">{total}</strong> {tl('utenti virtuali')} · {tl('ramp-up')} {ramp} s · {mode === 'simulated' ? tl('modelli simulati') : tl('modelli REALI')}
            </p>
            <Button tone="accent" surface="solid" disabled={!total || starting || (mode === 'simulated' && !info.simulation_available) || (mode === 'real' && confirmReal !== 'REALE')} onClick={start}>
              {starting ? <Loader2 className="animate-spin" /> : <Play />} {tl('Avvia stress test')}
            </Button>
          </div>
        </AdminSection>
      )}

      {runId && <LiveRun runId={runId} onClose={() => { setRunId(null); onFinished() }} onFinished={onFinished} />}
    </div>
  )
}

function NumberField({ label, hint, value, onChange, min, max }: { label: string; hint?: string; value: number; onChange: (v: number) => void; min: number; max: number }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-[var(--admin-ink-2)]">{label}</span>
      <input type="number" min={min} max={max} value={value} onChange={(e) => onChange(Math.max(min, Math.min(max, Number(e.target.value) || 0)))} className="h-8 w-full px-2 text-sm" />
      {hint && <span className="mt-0.5 block text-[11px] text-[var(--admin-ink-3)]">{hint}</span>}
    </label>
  )
}

// ── Live run ────────────────────────────────────────────────────────────────────────────

function LiveRun({ runId, onClose, onFinished }: { runId: string; onClose: () => void; onFinished: () => void }) {
  const [status, setStatus] = useState('running')
  const [users, setUsers] = useState<Record<number, UserState>>({})
  const [metrics, setMetrics] = useState<Metric[]>([])
  const [logs, setLogs] = useState<LogLine[]>([])
  const [report, setReport] = useState<Report | null>(null)
  const [connection, setConnection] = useState<'connecting' | 'live' | 'retrying'>('connecting')
  const [userFilter, setUserFilter] = useState<number | null>(null)

  // Events arrive in bursts (hundreds per second): buffer them and flush to React twice a second.
  const pending = useRef<{ users: Record<number, UserState>; metrics: Metric[]; logs: LogLine[] }>({ users: {}, metrics: [], logs: [] })
  const lastSeq = useRef(0)

  useEffect(() => {
    let cancelled = false
    let controller: AbortController | null = null
    const flush = window.setInterval(() => {
      const p = pending.current
      if (Object.keys(p.users).length) { const batch = p.users; p.users = {}; setUsers((prev) => ({ ...prev, ...batch })) }
      if (p.metrics.length) { const batch = p.metrics; p.metrics = []; setMetrics((prev) => [...prev, ...batch].slice(-3600)) }
      if (p.logs.length) { const batch = p.logs; p.logs = []; setLogs((prev) => [...prev, ...batch].slice(-MAX_LOG_LINES)) }
    }, 500)

    const connect = async () => {
      while (!cancelled) {
        controller = new AbortController()
        try {
          const response = await fetch(`${API}/runs/${runId}/events?after=${lastSeq.current}`, { headers: authHeaders(), signal: controller.signal })
          if (response.status === 404) {
            // Run no longer in memory (service restarted): show the saved report.
            const saved = await lt<Report>(`/runs/${runId}/report`).catch(() => null)
            if (saved) { setReport(saved); setStatus(saved.status) }
            return
          }
          if (!response.ok || !response.body) throw new Error(`HTTP ${response.status}`)
          setConnection('live')
          const reader = response.body.getReader()
          const decoder = new TextDecoder()
          let buffer = ''
          for (;;) {
            const { value, done } = await reader.read()
            if (done) break
            buffer += decoder.decode(value, { stream: true })
            let index: number
            while ((index = buffer.indexOf('\n\n')) >= 0) {
              const frame = buffer.slice(0, index)
              buffer = buffer.slice(index + 2)
              if (!frame.startsWith('data: ')) continue
              const event = JSON.parse(frame.slice(6))
              if (event.seq) lastSeq.current = event.seq
              switch (event.kind) {
                case 'user': pending.current.users[event.i] = event; break
                case 'metrics': pending.current.metrics.push(event); break
                case 'log': pending.current.logs.push(event); break
                case 'status': setStatus(event.status); break
                case 'hello': setStatus(event.run.status); break
                case 'report': setReport(event.report); onFinished(); break
              }
            }
          }
          return
        } catch (e: any) {
          if (cancelled || e?.name === 'AbortError') return
          setConnection('retrying')
          await new Promise((r) => setTimeout(r, 2000))
        }
      }
    }
    void connect()
    return () => { cancelled = true; controller?.abort(); window.clearInterval(flush) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runId])

  const stop = async () => { await lt(`/runs/${runId}/stop`, { method: 'POST' }).catch(() => undefined) }
  const active = ['preparing', 'running', 'stopping'].includes(status)
  const userList = useMemo(() => Object.values(users).sort((a, b) => a.i - b.i), [users])
  const last = metrics[metrics.length - 1]
  const states = useMemo(() => {
    const c: Record<string, number> = {}
    for (const u of userList) c[viewState(u)] = (c[viewState(u)] || 0) + 1
    return c
  }, [userList])
  const checked = userList.filter((u) => u.valid != null).length
  const running = userList.length - (states.done || 0) - (states.invalid || 0) - (states.error || 0) - (states.stopped || 0) - (states.waiting || 0)

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <AdminBadge tone={status === 'running' ? 'accent' : status === 'completed' ? 'success' : status === 'failed' ? 'danger' : 'warning'}>
            {active && <Loader2 className="h-3 w-3 animate-spin" />} {statusLabel(status)}
          </AdminBadge>
          <span className="font-mono text-[12px] text-[var(--admin-ink-3)]">{runId}</span>
          {connection === 'retrying' && <AdminBadge tone="warning">{tl('riconnessione…')}</AdminBadge>}
          {last && <span className="text-[12px] text-[var(--admin-ink-2)]">{fmtTime(last.t)}</span>}
        </div>
        <div className="flex gap-2">
          {active
            ? <Button tone="danger" surface="soft" density="compact" disabled={status === 'stopping'} onClick={stop}><Square /> {tl('Ferma la prova')}</Button>
            : <Button tone="neutral" surface="soft" density="compact" onClick={onClose}><RefreshCw /> {tl('Nuova prova')}</Button>}
        </div>
      </div>

      <AdminStatGrid className="xl:grid-cols-8">
        <AdminStat label={tl('In corso')} value={running} icon={Users} hint={`${userList.length} ${tl('totali')}`} />
        <AdminStat label={tl('Completati e validi')} value={states.done || 0} icon={CheckCircle2} hint={checked ? `${checked} ${tl('verificati')}` : tl('versione, file e build verificati')} />
        <AdminStat label={tl('Errori')} value={(states.error || 0) + (states.invalid || 0)} icon={XCircle} tone={(states.error || states.invalid) ? 'danger' : 'neutral'} hint={states.invalid ? `${states.invalid} ${tl('generati ma non validi')}` : undefined} />
        <AdminStat label={tl('Richieste/s')} value={last?.rps ?? '—'} icon={Zap} hint={last?.errors ? `${last.errors} ${tl('fallite')}` : undefined} />
        <AdminStat label={tl('Latenza p95')} value={ms(last?.lat_p95)} icon={Gauge} tone={(last?.lat_p95 || 0) > 2000 ? 'warning' : 'neutral'} hint={tl('ultimi 5 s')} />
        <AdminStat label={tl('API /health')} value={ms(last?.probes?.api)} icon={Activity} tone={last && last.probes?.api == null ? 'danger' : (last?.probes?.api || 0) > 500 ? 'warning' : 'neutral'} hint={`pool ${ms(last?.probes?.['api-pool'])}`} />
        <AdminStat label={tl('Connessioni DB')} value={last?.db?.total != null ? `${last.db.total}/${last.db.max}` : '—'} icon={Database} hint={last?.db ? `${last.db.idle_in_tx ?? 0} idle in tx · ${last.db.lock_wait ?? 0} lock` : undefined} tone={last?.db?.max && (last.db.total || 0) / last.db.max > 0.8 ? 'danger' : 'neutral'} />
        <AdminStat label={tl('Job generazione')} value={last?.db?.jobs_running ?? '—'} icon={Server} hint={tl('vibe_generate in corso')} />
      </AdminStatGrid>

      <AdminSection title={tl('Utenti virtuali')} description={tl('Un quadrato per studente; passa sopra per i dettagli, clicca per filtrare i log.')}>
        <UserGrid users={userList} selected={userFilter} onSelect={setUserFilter} />
      </AdminSection>

      <Charts metrics={metrics} />

      <LogConsole logs={logs} userFilter={userFilter} onClearUser={() => setUserFilter(null)} />

      {report && <ReportView report={report} embedded onChanged={async () => setReport(await lt<Report>(`/runs/${runId}/report`))} />}
    </div>
  )
}

function statusLabel(status: string) {
  return ({ preparing: tl('Preparazione'), running: tl('In corso'), stopping: tl('Arresto…'), completed: tl('Completata'), stopped: tl('Interrotta'), failed: tl('Fallita') } as Record<string, string>)[status] || status
}

function useStateColor() {
  const dark = useIsDark()
  return useCallback((state: string) => {
    const slot = STATE_META[state]?.slot ?? 'muted'
    if (slot === 'muted') return dark ? '#4b4f58' : '#c4c8cf'
    return (dark ? SERIES.dark : SERIES.light)[slot]
  }, [dark])
}

function UserGrid({ users, selected, onSelect }: { users: UserState[]; selected: number | null; onSelect: (i: number | null) => void }) {
  const color = useStateColor()
  const present = STATE_ORDER.filter((s) => users.some((u) => viewState(u) === s))
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-[3px]">
        {users.map((u) => (
          <button key={u.i} type="button" onClick={() => onSelect(selected === u.i ? null : u.i)}
            title={`#${u.i} · ${u.nick} · ${STATE_META[viewState(u)]?.label || u.state}${u.detail ? `\n${u.detail}` : ''}${u.error ? `\n${u.error}` : ''}${u.problems?.length ? `\n${u.problems.join('\n')}` : ''}`}
            aria-label={`${tl('Utente')} ${u.i}: ${STATE_META[viewState(u)]?.label || u.state}`}
            className={cn('h-4 w-4 rounded-[4px] transition-transform', u.state === 'generating' && 'animate-pulse', selected === u.i && 'scale-125 ring-2 ring-[var(--admin-ink)]')}
            style={{ background: color(viewState(u)) }} />
        ))}
        {!users.length && <span className="text-sm text-[var(--admin-ink-3)]">{tl('In preparazione…')}</span>}
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1">
        {present.map((s) => (
          <span key={s} className="inline-flex items-center gap-1.5 text-[12px] text-[var(--admin-ink-2)]">
            <span className="h-2.5 w-2.5 rounded-[3px]" style={{ background: color(s) }} />
            {STATE_META[s]?.label || s} <strong className="text-[var(--admin-ink)]">{users.filter((u) => viewState(u) === s).length}</strong>
          </span>
        ))}
      </div>
    </div>
  )
}

function Charts({ metrics }: { metrics: Metric[] }) {
  const dark = useIsDark()
  const palette = dark ? SERIES.dark : SERIES.light
  const axis = dark ? '#8f95a0' : '#666b76'
  const grid = dark ? '#22252b' : '#eceef1'
  const tooltipStyle = { background: dark ? '#1d2025' : '#ffffff', border: `1px solid ${dark ? '#363b43' : '#cfd4dc'}`, borderRadius: 8, fontSize: 12, color: dark ? '#e8eaee' : '#17151b' }
  const color = useStateColor()

  const services = useMemo(() => {
    const set = new Set<string>()
    for (const m of metrics) Object.entries(m.containers || {}).forEach(([k, v]) => { if (v && v.cpu != null) set.add(k) })
    const order = ['api', 'api-pool', 'postgres', 'vibe-qa', 'nginx', 'redis', 'frontend', 'pxt-compiler']
    return order.filter((s) => set.has(s))
  }, [metrics])

  const rows = useMemo(() => metrics.map((m) => {
    const row: Record<string, number | null | string> = { t: m.t, p50: m.lat_p50, p95: m.lat_p95, api: m.probes?.api ?? null, pool: m.probes?.['api-pool'] ?? null,
      db_total: m.db?.total ?? null, db_active: m.db?.active ?? null, db_idle_tx: m.db?.idle_in_tx ?? null, jobs: m.db?.jobs_running ?? null, rps: m.rps }
    for (const s of STATE_ORDER) row[`s_${s}`] = m.states?.[s] || 0
    for (const s of services) row[`cpu_${s}`] = m.containers?.[s]?.cpu ?? null
    return row
  }), [metrics, services])

  const presentStates = STATE_ORDER.filter((s) => metrics.some((m) => (m.states?.[s] || 0) > 0))
  const common = { margin: { top: 8, right: 12, bottom: 0, left: -8 } }
  const xAxis = <XAxis dataKey="t" tickFormatter={(v) => fmtTime(Number(v))} stroke={axis} tick={{ fontSize: 11 }} minTickGap={40} />
  const gridEl = <CartesianGrid stroke={grid} vertical={false} />
  const legend = <Legend iconType="plainline" wrapperStyle={{ fontSize: 12, color: axis }} />
  const tip = (unit: string) => <Tooltip contentStyle={tooltipStyle} labelFormatter={(v) => `t ${fmtTime(Number(v))}`} formatter={(v: any) => (v == null ? '—' : `${Math.round(Number(v) * 10) / 10}${unit}`)} />

  if (!metrics.length) return null
  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <AdminSection title={tl('Tempi di risposta')} description={tl('Richieste degli utenti (p50/p95, ultimi 5 s) e /health dei processi API: se /health sale, l’event loop è saturo.')}>
        <ResponsiveContainer width="100%" height={220}>
          <LineChart data={rows} {...common}>
            {gridEl}{xAxis}<YAxis stroke={axis} tick={{ fontSize: 11 }} unit=" ms" width={70} />{tip(' ms')}{legend}
            <Line dataKey="p50" name={tl('Richieste p50')} stroke={palette[0]} strokeWidth={2} dot={false} isAnimationActive={false} connectNulls />
            <Line dataKey="p95" name={tl('Richieste p95')} stroke={palette[1]} strokeWidth={2} dot={false} isAnimationActive={false} connectNulls />
            <Line dataKey="api" name="API /health" stroke={palette[2]} strokeWidth={2} dot={false} isAnimationActive={false} />
            <Line dataKey="pool" name="api-pool /health" stroke={palette[3]} strokeWidth={2} dot={false} isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      </AdminSection>
      <AdminSection title={tl('Utenti per stato')}>
        <ResponsiveContainer width="100%" height={220}>
          <AreaChart data={rows} {...common}>
            {gridEl}{xAxis}<YAxis stroke={axis} tick={{ fontSize: 11 }} allowDecimals={false} width={50} />{tip('')}{legend}
            {presentStates.map((s) => (
              <Area key={s} dataKey={`s_${s}`} name={STATE_META[s]?.label || s} stackId="1" stroke={dark ? '#16181c' : '#ffffff'} strokeWidth={1} fill={color(s)} fillOpacity={0.9} isAnimationActive={false} />
            ))}
          </AreaChart>
        </ResponsiveContainer>
      </AdminSection>
      <AdminSection title={tl('CPU dei container')} description={tl('100% = un core pieno. Un processo a un solo worker (api) satura a 100%.')}>
        {services.length ? (
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={rows} {...common}>
              {gridEl}{xAxis}<YAxis stroke={axis} tick={{ fontSize: 11 }} unit="%" width={55} />{tip('%')}{legend}
              {services.map((s, i) => (
                <Line key={s} dataKey={`cpu_${s}`} name={s} stroke={palette[i % palette.length]} strokeWidth={2} dot={false} isAnimationActive={false} connectNulls />
              ))}
            </LineChart>
          </ResponsiveContainer>
        ) : <AdminEmpty>{tl('Nessun dato dai container (socket Docker non disponibile?)')}</AdminEmpty>}
      </AdminSection>
      <AdminSection title={tl('Database e job')} description={tl('Connessioni Postgres e generazioni in corso sul server.')}>
        <ResponsiveContainer width="100%" height={220}>
          <LineChart data={rows} {...common}>
            {gridEl}{xAxis}<YAxis stroke={axis} tick={{ fontSize: 11 }} allowDecimals={false} width={50} />{tip('')}{legend}
            <Line dataKey="db_total" name={tl('Connessioni totali')} stroke={palette[0]} strokeWidth={2} dot={false} isAnimationActive={false} connectNulls />
            <Line dataKey="db_active" name={tl('Attive')} stroke={palette[1]} strokeWidth={2} dot={false} isAnimationActive={false} connectNulls />
            <Line dataKey="db_idle_tx" name={tl('Idle in transaction')} stroke={palette[2]} strokeWidth={2} dot={false} isAnimationActive={false} connectNulls />
            <Line dataKey="jobs" name={tl('Job di generazione')} stroke={palette[6]} strokeWidth={2} dot={false} isAnimationActive={false} connectNulls />
          </LineChart>
        </ResponsiveContainer>
      </AdminSection>
    </div>
  )
}

function LogConsole({ logs, userFilter, onClearUser }: { logs: LogLine[]; userFilter: number | null; onClearUser: () => void }) {
  const [sources, setSources] = useState<string[]>([])
  const [level, setLevel] = useState<'all' | 'warn' | 'error'>('all')
  const [query, setQuery] = useState('')
  const [follow, setFollow] = useState(true)
  const box = useRef<HTMLDivElement>(null)
  const allSources = useMemo(() => Array.from(new Set(logs.map((l) => l.source))).sort(), [logs])
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    return logs.filter((l) =>
      (!sources.length || sources.includes(l.source)) &&
      (level === 'all' || (level === 'error' ? l.level === 'error' : l.level !== 'info')) &&
      (userFilter == null || l.user === userFilter || (l.source !== 'client' && l.msg.includes(`#${userFilter} `))) &&
      (!q || l.msg.toLowerCase().includes(q)),
    ).slice(-1500)
  }, [logs, sources, level, query, userFilter])

  useEffect(() => {
    if (follow && box.current) box.current.scrollTop = box.current.scrollHeight
  }, [visible, follow])

  const download = () => {
    const text = logs.map((l) => `${fmtTime(l.t)}\t${l.source}\t${l.level}\t${l.msg}`).join('\n')
    const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }))
    const a = document.createElement('a')
    a.href = url
    a.download = 'stress-test-log.txt'
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <AdminSection title={<span className="inline-flex items-center gap-2"><Terminal className="h-4 w-4" /> {tl('Log in tempo reale')}</span>}
      description={tl('Client = cosa vedono gli studenti virtuali; gli altri sono i log dei container della piattaforma.')}
      actions={<Button tone="neutral" surface="ghost" density="compact" onClick={download}><Download /> {tl('Scarica')}</Button>} flush>
      <div className="flex flex-wrap items-center gap-2 border-b border-[var(--admin-line)] px-3 py-2">
        {allSources.map((s) => {
          const on = sources.includes(s)
          return (
            <button key={s} type="button" aria-pressed={on} onClick={() => setSources(on ? sources.filter((x) => x !== s) : [...sources, s])}
              className={cn('admin-badge', on ? 'admin-badge-accent' : 'admin-badge-neutral')}>{s}</button>
          )
        })}
        <select value={level} onChange={(e) => setLevel(e.target.value as any)} className="h-7 px-2 text-[12px]" aria-label={tl('Livello')}>
          <option value="all">{tl('Tutti i livelli')}</option>
          <option value="warn">{tl('Avvisi ed errori')}</option>
          <option value="error">{tl('Solo errori')}</option>
        </select>
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={tl('Cerca nei log…')} className="h-7 w-48 px-2 text-[12px]" />
        {userFilter != null && <button type="button" onClick={onClearUser} className="admin-badge admin-badge-accent">{tl('Utente')} #{userFilter} ✕</button>}
        <label className="ml-auto flex items-center gap-1.5 text-[12px] text-[var(--admin-ink-2)]">
          <input type="checkbox" checked={follow} onChange={(e) => setFollow(e.target.checked)} /> {tl('Segui')}
        </label>
        <span className="text-[11px] text-[var(--admin-ink-3)]">{visible.length}/{logs.length}</span>
      </div>
      <div ref={box} className="h-[420px] overflow-auto bg-[#0e0f12] px-3 py-2 font-mono text-[11.5px] leading-[1.55]" role="log" aria-live="off">
        {visible.map((l) => (
          <div key={l.seq} className="flex gap-2 whitespace-pre-wrap break-all">
            <span className="shrink-0 text-[#6b7280]">{fmtTime(l.t)}</span>
            <span className={cn('w-16 shrink-0 truncate', l.source === 'client' ? 'text-[#93c5fd]' : l.source === 'runner' ? 'text-[#c4b5fd]' : 'text-[#9ca3af]')}>{l.source}</span>
            <span className={l.level === 'error' ? 'text-[#fca5a5]' : l.level === 'warn' ? 'text-[#fcd34d]' : 'text-[#e5e7eb]'}>{l.msg}</span>
          </div>
        ))}
        {!visible.length && <p className="py-8 text-center text-[#6b7280]">{tl('Nessuna riga (ancora) per questi filtri.')}</p>}
      </div>
    </AdminSection>
  )
}

// ── Reports ─────────────────────────────────────────────────────────────────────────────

function ReportView({ report, embedded, onBack, onChanged }: { report: Report; embedded?: boolean; onBack?: () => void; onChanged: () => Promise<void> | void }) {
  const [busy, setBusy] = useState(false)
  const created = report.created || { student_ids: [], project_ids: [], job_ids: [] }
  const hasData = created.student_ids.length + created.project_ids.length > 0

  const cleanup = async () => {
    if (!window.confirm(tl('Elimino gli studenti, i progetti e i job creati da questa prova (solo i loro ID)?'))) return
    setBusy(true)
    try { await lt(`/runs/${report.id}/cleanup`, { method: 'POST' }); await onChanged() } catch (e: any) { alert(e?.message) } finally { setBusy(false) }
  }
  const download = () => {
    const url = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' }))
    const a = document.createElement('a')
    a.href = url
    a.download = `stress-test-${report.id}.json`
    a.click()
    URL.revokeObjectURL(url)
  }
  const stepOrder = ['join', 'session', 'credits', 'open_projects', 'open_briefs', 'open_design', 'poll_projects', 'poll_jobs', 'create_project', 'gen_ttfb', 'gen_first_event', 'gen_max_gap', 'gen_total', 'reload_project', 'ai_chat']
  const steps = Object.entries(report.steps).filter(([k]) => k !== 'gen_valid').sort(([a], [b]) => stepOrder.indexOf(a) - stepOrder.indexOf(b))

  return (
    <div className="space-y-4">
      {!embedded && <LiveCharts report={report} />}
      <AdminSection
        title={`${tl('Report')} ${report.label ? `· ${report.label}` : ''}`}
        description={`${report.id} · ${statusLabel(report.status)} · ${Math.round(report.duration_s)} s · ${report.users.length} ${tl('utenti')} · ${report.config?.llm_mode === 'real' ? tl('modelli reali') : tl('modelli simulati')}`}
        actions={<>
          {onBack && <Button tone="neutral" surface="ghost" density="compact" onClick={onBack}>{tl('Indietro')}</Button>}
          <Button tone="neutral" surface="soft" density="compact" onClick={download}><Download /> JSON</Button>
          {hasData && !report.cleanup && <Button tone="danger" surface="soft" density="compact" disabled={busy || report.status === 'running'} onClick={cleanup}>{busy ? <Loader2 className="animate-spin" /> : <Trash2 />} {tl('Pulisci dati di test')}</Button>}
        </>}
      >
        <div className="space-y-2">
          <p className="admin-eyebrow">{tl('Si può gestire questa concorrenza?')}</p>
          {report.findings.map((f, i) => (
            <AdminNotice key={i} tone={f.severity === 'ok' ? 'success' : f.severity === 'warn' ? 'warning' : 'danger'} icon={f.severity === 'ok' ? CheckCircle2 : f.severity === 'warn' ? AlertTriangle : XCircle}>
              <p className="font-medium">{f.title}</p>
              <p className="text-[13px] text-[var(--admin-ink-2)]">{f.detail}</p>
            </AdminNotice>
          ))}
          {report.cleanup && (
            <p className="text-[12px] text-[var(--admin-ink-2)]">
              {tl('Dati di test eliminati')}: {Object.entries(report.cleanup.deleted).map(([k, v]) => `${k} ${v}`).join(' · ') || '—'}
              {report.cleanup.errors?.length ? ` · ${tl('errori')}: ${report.cleanup.errors.join('; ')}` : ''}
            </p>
          )}
        </div>
      </AdminSection>

      <AdminSection title={tl('Tempi per passo')} flush>
        <div className="overflow-x-auto">
          <table>
            <thead><tr><th>{tl('Passo')}</th><th>{tl('Totale')}</th><th>OK</th><th>{tl('Falliti')}</th><th>p50</th><th>p95</th><th>p99</th><th>max</th><th>{tl('Errori principali')}</th></tr></thead>
            <tbody>
              {steps.map(([key, s]) => (
                <tr key={key}>
                  <td>{s.label}</td><td>{s.count}</td><td>{s.ok}</td>
                  <td>{s.failed ? <AdminBadge tone="danger">{s.failed}</AdminBadge> : 0}</td>
                  <td className="nowrap">{ms(s.p50)}</td><td className="nowrap">{ms(s.p95)}</td><td className="nowrap">{ms(s.p99)}</td><td className="nowrap">{ms(s.max)}</td>
                  <td className="text-[12px] text-[var(--admin-ink-2)]">{Object.entries(s.errors).map(([e, n]) => `${n}× ${e}`).join(' · ')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </AdminSection>

      <div className="grid gap-4 xl:grid-cols-2">
        <AdminSection title={tl('Esito per sezione')} flush>
          <table>
            <thead><tr><th>{tl('Sezione')}</th><th>{tl('Utenti')}</th><th>{tl('Completati')}</th><th>{tl('Errori')}</th><th>{tl('Interrotti')}</th><th>{tl('Validi')}</th><th>{tl('Non validi')}</th></tr></thead>
            <tbody>
              {Object.entries(report.scenarios).map(([k, row]) => (
                <tr key={k}><td>{k}</td><td>{row.users}</td><td>{row.done}</td><td>{row.error}</td><td>{row.stopped + row.other}</td>
                  <td>{row.valid ?? '—'}</td>
                  <td>{row.invalid ? <AdminBadge tone="danger">{row.invalid}</AdminBadge> : (row.valid != null ? 0 : '—')}</td></tr>
              ))}
            </tbody>
          </table>
        </AdminSection>
        <AdminSection title={tl('Picchi della piattaforma')} flush>
          <table>
            <tbody>
              {Object.entries(report.probes).map(([s, p]) => (
                <tr key={s}><td>{s} /health</td><td>p50 {ms(p.p50)} · p95 {ms(p.p95)} · max {ms(p.max)}{p.failures ? ` · ${p.failures} ${tl('fallimenti')}` : ''}</td></tr>
              ))}
              <tr><td>{tl('Connessioni DB (max)')}</td><td>{report.peaks.db_total ?? '—'} / {report.peaks.db_max ?? '—'} · {tl('idle in tx')} {report.peaks.db_idle_in_tx ?? 0} · {tl('lock')} {report.peaks.db_lock_wait ?? 0}</td></tr>
              <tr><td>{tl('Job di generazione (max)')}</td><td>{report.peaks.db_jobs_running ?? '—'}</td></tr>
              {Object.entries(report.peaks.cpu || {}).map(([s, v]) => (
                <tr key={s}><td><Cpu className="mr-1 inline h-3.5 w-3.5" />{s}</td><td>CPU {String(v)}% · RAM {report.peaks.mem_mb?.[s] ?? '—'} MB</td></tr>
              ))}
              <tr><td>{tl('Righe di log')}</td><td>{Object.entries(report.logs.lines).map(([s, n]) => `${s} ${n}${report.logs.errors[s] ? ` (${report.logs.errors[s]} err)` : ''}`).join(' · ')}</td></tr>
            </tbody>
          </table>
        </AdminSection>
      </div>

      {report.cost && (
        <AdminSection
          title={tl('Costo della prova')}
          description={report.config?.llm_mode === 'real' ? tl('Somma delle chiamate AI degli studenti creati da questa prova.') : tl('Modelli simulati: nessun costo reale, restano i token stimati.')}
        >
          <AdminStatGrid className="xl:grid-cols-4">
            <AdminStat label={tl('Costo totale')} value={`${report.cost.total.toFixed(3)} $`} icon={Zap} />
            <AdminStat label={tl('Per progetto valido')} value={(() => { const n = Object.values(report.scenarios).reduce((a, r) => a + (r.valid || 0), 0); return n ? `${(report.cost.total / n).toFixed(3)} $` : '—' })()} icon={CheckCircle2} />
            <AdminStat label={tl('Chiamate AI')} value={report.cost.calls} icon={Server} />
            <AdminStat label={tl('Token')} value={`${Math.round(report.cost.prompt_tokens / 1000)}k + ${Math.round(report.cost.completion_tokens / 1000)}k`} icon={Activity} hint={tl('ingresso + uscita')} />
          </AdminStatGrid>
          {report.cost.by_model.length > 0 && (
            <div className="mt-3 overflow-x-auto">
              <table>
                <thead><tr><th>{tl('Modello')}</th><th>{tl('Chiamate')}</th><th>{tl('Token in')}</th><th>{tl('Token out')}</th><th>{tl('Costo')}</th></tr></thead>
                <tbody>
                  {report.cost.by_model.map((m) => (
                    <tr key={`${m.provider}/${m.model}`}><td>{m.provider} · {m.model}</td><td>{m.calls}</td><td>{m.prompt_tokens.toLocaleString('it-IT')}</td><td>{m.completion_tokens.toLocaleString('it-IT')}</td><td className="nowrap">{m.cost.toFixed(4)} $</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </AdminSection>
      )}

      {report.users.some((u) => u.error || u.valid === false) && (
        <AdminSection title={tl('Utenti con errori')} flush>
          <div className="max-h-72 overflow-auto">
            <table>
              <thead><tr><th>#</th><th>{tl('Sezione')}</th><th>{tl('Errore')}</th></tr></thead>
              <tbody>
                {report.users.filter((u) => u.error || u.valid === false).slice(0, 300).map((u) => (
                  <tr key={u.i}><td>{u.i}</td><td>{u.scenario}</td><td className="text-[12px]">{u.error || `${tl('Generato ma non valido')}: ${(u.problems || []).join('; ')}`}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </AdminSection>
      )}
    </div>
  )
}

function LiveCharts({ report }: { report: Report }) {
  return <Charts metrics={report.timeline || []} />
}

function HistoryTable({ reports, onOpen, onChanged }: { reports: ReportRow[]; onOpen: (id: string) => void; onChanged: () => void }) {
  const remove = async (row: ReportRow) => {
    if (!window.confirm(tl('Eliminare questo report?'))) return
    try { await lt(`/runs/${row.id}`, { method: 'DELETE' }); onChanged() } catch (e: any) { alert(e?.message) }
  }
  const cleanup = async (row: ReportRow) => {
    if (!window.confirm(tl('Elimino gli studenti, i progetti e i job creati da questa prova (solo i loro ID)?'))) return
    try { await lt(`/runs/${row.id}/cleanup`, { method: 'POST' }); onChanged() } catch (e: any) { alert(e?.message) }
  }
  if (!reports.length) return <AdminSection><AdminEmpty>{tl('Nessun report salvato.')}</AdminEmpty></AdminSection>
  return (
    <AdminSection title={tl('Report salvati')} flush>
      <div className="overflow-x-auto">
        <table>
          <thead><tr><th>{tl('Data')}</th><th>{tl('Etichetta')}</th><th>{tl('Utenti')}</th><th>LLM</th><th>{tl('Generazioni')}</th><th>{tl('Valide')}</th><th>{tl('Mediana gen.')}</th><th>{tl('Costo')}</th><th>{tl('Esito')}</th><th>{tl('Dati di test')}</th><th /></tr></thead>
          <tbody>
            {reports.map((r) => (
              <tr key={r.id}>
                <td className="nowrap">{new Date(r.created_at).toLocaleString('it-IT')}</td>
                <td>{r.label || <span className="font-mono text-[11px] text-[var(--admin-ink-3)]">{r.id}</span>}</td>
                <td>{Object.entries(r.scenarios || {}).map(([k, v]) => `${v} ${k.replace('vibe_', '')}`).join(' · ')}</td>
                <td>{r.llm_mode === 'real' ? <AdminBadge tone="warning">{tl('reale')}</AdminBadge> : <AdminBadge>{tl('simulato')}</AdminBadge>}</td>
                <td>{r.gen_ok != null ? `${r.gen_ok} ok · ${r.gen_failed} ko` : '—'}</td>
                <td>{r.valid || r.invalid ? <>{r.valid} {r.invalid ? <AdminBadge tone="danger">{r.invalid} {tl('non valide')}</AdminBadge> : null}</> : '—'}</td>
                <td className="nowrap">{ms(r.gen_p50)}</td>
                <td className="nowrap">{r.cost != null ? `${r.cost.toFixed(3)} $` : '—'}</td>
                <td>{r.critical ? <AdminBadge tone="danger">{r.critical} {tl('critici')}</AdminBadge> : <AdminBadge tone="success">{statusLabel(r.status)}</AdminBadge>}</td>
                <td>{r.cleaned ? <AdminBadge>{tl('puliti')}</AdminBadge> : (r.created_rows?.student_ids || 0) > 0
                  ? <Button tone="danger" surface="ghost" density="compact" onClick={() => cleanup(r)}><Trash2 /> {tl('Pulisci')}</Button> : '—'}</td>
                <td className="nowrap">
                  <Button tone="neutral" surface="soft" density="compact" onClick={() => onOpen(r.id)}>{tl('Apri')}</Button>
                  <Button tone="neutral" surface="ghost" density="compact" onClick={() => remove(r)} aria-label={tl('Elimina report')}><Trash2 /></Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </AdminSection>
  )
}
