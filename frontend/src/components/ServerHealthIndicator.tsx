import { useQuery } from '@tanstack/react-query'
import { systemApi, type ServerHealthResponse, type ServerHealthStatus } from '@/lib/api'


const LIGHTS: ServerHealthStatus[] = ['red', 'yellow', 'green']
const ACTIVE_CLASS: Record<ServerHealthStatus, string> = {
  green: 'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.7)]',
  yellow: 'bg-amber-400 shadow-[0_0_8px_rgba(251,191,36,0.7)]',
  red: 'bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.7)]',
}

function withNetworkLatency(data: ServerHealthResponse, networkMs: number): ServerHealthResponse {
  let status = data.status
  const reasons = [...data.reasons]
  if (networkMs >= 2500) {
    status = 'red'
    reasons.unshift('Connessione al server molto lenta')
  } else if (networkMs >= 900 && status === 'green') {
    status = 'yellow'
    reasons.unshift('Connessione al server rallentata')
  }
  return {
    ...data,
    status,
    summary: status === data.status
      ? data.summary
      : status === 'red'
        ? 'Server non raggiungibile o molto lento'
        : 'Possibili rallentamenti',
    reasons,
    metrics: { ...data.metrics, network_ms: Math.round(networkMs) },
  }
}

export function useServerHealth() {
  return useQuery({
    queryKey: ['system-health'],
    queryFn: async (): Promise<ServerHealthResponse> => {
      const started = performance.now()
      try {
        const response = await systemApi.health()
        return withNetworkLatency(response.data, performance.now() - started)
      } catch {
        return {
          status: 'red',
          summary: 'Server non raggiungibile',
          reasons: ['La piattaforma non risponde o si sta aggiornando'],
          metrics: { network_ms: Math.round(performance.now() - started) },
        }
      }
    },
    refetchInterval: 30_000,
    staleTime: 15_000,
    retry: false,
    refetchOnWindowFocus: true,
  })
}

function metric(value: number | null | undefined) {
  return value == null ? 'n/d' : `${Math.round(value)}%`
}

export function ServerHealthIndicator() {
  const { data } = useServerHealth()
  const health: ServerHealthResponse = data ?? {
    status: 'yellow',
    summary: 'Controllo del server…',
    reasons: ['Raccolta dello stato in corso'],
  }

  return (
    <div className="group/health relative flex items-center" onClick={(event) => event.stopPropagation()}>
      <button
        type="button"
        className="flex items-center gap-1 rounded-full border border-slate-200/90 bg-white/80 px-1.5 py-1 shadow-sm transition hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-300"
        aria-label={`Stato server: ${health.summary}`}
        title={health.summary}
      >
        {LIGHTS.map((light) => (
          <span
            key={light}
            className={`h-2 w-2 rounded-full transition ${health.status === light ? ACTIVE_CLASS[light] : 'bg-slate-200'}`}
            aria-hidden="true"
          />
        ))}
      </button>

      <div className="pointer-events-none absolute left-0 top-full z-[80] mt-2 hidden w-72 rounded-xl border border-slate-200 bg-white p-3 text-left shadow-xl group-hover/health:block group-focus-within/health:block">
        <div className="flex items-center gap-2">
          <span className={`h-2.5 w-2.5 rounded-full ${ACTIVE_CLASS[health.status]}`} />
          <p className="text-sm font-black text-slate-900">{health.summary}</p>
        </div>
        <ul className="mt-2 space-y-1 text-xs text-slate-600">
          {health.reasons.map((reason) => <li key={reason}>• {reason}</li>)}
        </ul>
        <div className="mt-3 grid grid-cols-4 gap-1 border-t border-slate-100 pt-2 text-center text-[10px] text-slate-500">
          <div><strong className="block text-slate-700">CPU</strong>{metric(health.metrics?.cpu_percent)}</div>
          <div><strong className="block text-slate-700">RAM</strong>{metric(health.metrics?.memory_percent)}</div>
          <div><strong className="block text-slate-700">GPU</strong>{health.metrics?.gpu_available === false ? 'assente' : metric(health.metrics?.gpu_percent)}</div>
          <div><strong className="block text-slate-700">Rete</strong>{health.metrics?.network_ms == null ? 'n/d' : `${health.metrics.network_ms} ms`}</div>
        </div>
      </div>
    </div>
  )
}
