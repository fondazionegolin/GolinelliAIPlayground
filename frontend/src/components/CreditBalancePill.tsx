import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { ProgressRing } from '@/components/ui/ProgressGlyph'
import { creditsApi, studentApi } from '@/lib/api'
import { useToast } from '@/components/ui/use-toast'
import { tl } from '@/i18n/tl'

type CreditBalance = {
  credits_remaining: number | null
  credits_used: number
  credits_cap: number | null
  limit_level?: string | null
  limit_id?: string | null
  bonus_credits?: number
  low_balance?: boolean
  exhausted?: boolean
  classes?: Array<{
    class_id: string
    class_name: string
    credits_remaining: number | null
    credits_used: number
    credits_cap: number | null
    low_balance?: boolean
    exhausted?: boolean
  }>
}

type CreditHistoryItem = {
  id: string
  timestamp: string
  student_name?: string | null
  class_name?: string | null
  session_title?: string | null
  service?: string | null
  provider?: string | null
  model?: string | null
  usage_details?: Record<string, unknown> | null
  cost_credits: number
}

interface CreditBalancePillProps {
  audience: 'teacher' | 'student' | 'studentPool'
  accentColor: string
}

const teacherCreditColor = '#16a34a'
const poolCreditColor = '#c026d3'

function formatCreditValue(value: number) {
  if (value === 0) return '0'
  return value.toLocaleString('it-IT', {
    minimumFractionDigits: 0,
    maximumFractionDigits: value < 1 ? 6 : 2,
  })
}

function formatWhen(value: string) {
  return new Intl.DateTimeFormat('it-IT', {
    day: 'numeric',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value))
}

const CreditRing = ProgressRing

export function CreditBalancePill({ audience, accentColor }: CreditBalancePillProps) {
  const [balance, setBalance] = useState<CreditBalance | null>(null)
  const [history, setHistory] = useState<CreditHistoryItem[]>([])
  const [open, setOpen] = useState(false)
  const [historyLoading, setHistoryLoading] = useState(false)
  const panelRef = useRef<HTMLDivElement>(null)
  const { toast } = useToast()
  const [requestOpen, setRequestOpen] = useState(false)
  const [requestCredits, setRequestCredits] = useState('500')
  const [requestReason, setRequestReason] = useState('')
  const [requestSending, setRequestSending] = useState(false)
  const [requestSent, setRequestSent] = useState(false)

  const sendRequest = async () => {
    const credits = Number(requestCredits.replace(',', '.'))
    if (!(credits > 0)) return
    setRequestSending(true)
    try {
      await creditsApi.createRequest({ credits, reason: requestReason.trim() || undefined, limit_id: balance?.limit_id ?? undefined })
      setRequestSent(true)
      setRequestOpen(false)
      toast({ title: tl("Richiesta inviata"), description: tl("L'amministratore riceverà la tua richiesta di crediti.") })
    } catch (err: any) {
      const detail = err?.response?.data?.detail
      toast({ variant: 'destructive', title: tl("Richiesta non inviata"), description: typeof detail === 'string' ? detail : tl("Riprova tra poco.") })
    } finally {
      setRequestSending(false)
    }
  }

  useEffect(() => {
    let mounted = true

    const loadBalance = async () => {
      try {
        const response = audience === 'student'
          ? await studentApi.getCreditBalance()
          : audience === 'studentPool'
            ? await creditsApi.getStudentPoolBalance()
            : await creditsApi.getBalance()
        if (mounted) setBalance(response.data)
      } catch (err) {
        if (mounted) setBalance(null)
      }
    }

    loadBalance()
    const interval = window.setInterval(loadBalance, 15000)
    window.addEventListener('focus', loadBalance)

    return () => {
      mounted = false
      window.clearInterval(interval)
      window.removeEventListener('focus', loadBalance)
    }
  }, [audience, open])

  useEffect(() => {
    if (!open) return
    let mounted = true

    const loadHistory = async () => {
      setHistoryLoading(true)
      try {
        const response = audience === 'student'
          ? await studentApi.getCreditHistory(50)
          : audience === 'studentPool'
            ? await creditsApi.getStudentPoolHistory(50)
            : await creditsApi.getHistory(50)
        if (mounted) setHistory(response.data)
      } catch (err) {
        if (mounted) setHistory([])
      } finally {
        if (mounted) setHistoryLoading(false)
      }
    }

    loadHistory()
    return () => {
      mounted = false
    }
  }, [audience, open])

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(event.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const remaining = balance?.credits_remaining
  const used = balance?.credits_used ?? 0
  const cap = balance?.credits_cap
  const isPool = audience === 'studentPool'
  const isStudentPoolLimiting = audience === 'student' && balance?.limit_level === 'STUDENT_POOL'
  const mainColor = isPool || isStudentPoolLimiting ? poolCreditColor : teacherCreditColor
  const remainingRatio = typeof cap === 'number' && cap > 0
    ? Math.max(0, Math.min((remaining ?? Math.max(cap - used, 0)) / cap, 1))
    : 1
  const ringColor = remainingRatio <= 0.1 ? '#dc2626' : remainingRatio <= 0.3 ? '#d97706' : mainColor
  const percentAvailable = Math.round(remainingRatio * 100)
  const title = isPool
    ? tl("Pool crediti studenti")
    : audience === 'student'
      ? (isStudentPoolLimiting ? tl("Pool della classe") : tl("I tuoi crediti"))
      : tl("Crediti AI docente")
  const remainingLabel = typeof remaining === 'number' ? formatCreditValue(remaining) : tl("Illimitati")

  return (
    <div className="relative" ref={panelRef}>
      <button
        type="button"
        className="navbar-inline-control relative flex h-8 w-9 items-center justify-center rounded-lg p-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-0"
        style={{
          color: ringColor,
          '--btn-tone': accentColor,
          '--tw-ring-color': accentColor,
        } as CSSProperties}
        aria-label={`${title}: ${percentAvailable}% disponibile, ${remainingLabel} crediti rimasti`}
        title={tl("{0} · {1}% disponibile", title, percentAvailable)}
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <CreditRing value={remainingRatio} color={ringColor} />
        {(balance?.low_balance || balance?.exhausted) && (
          <span
            className={`absolute right-0.5 top-0.5 h-2.5 w-2.5 rounded-full border border-white ${balance?.exhausted ? 'bg-red-500' : 'bg-amber-500'}`}
            aria-hidden="true"
          />
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full z-50 mt-2 w-[640px] max-w-[calc(100vw-24px)] ds-popover nav-cluster-unroll overflow-hidden rounded-[var(--ds-radius-panel)]">
          <div className="border-b border-slate-100 px-4 py-3.5">
            <div className="flex items-center gap-3">
              <CreditRing value={remainingRatio} color={ringColor} size={38} />
              <div>
                <p className="text-sm font-black text-slate-900">{title}</p>
                <p className="mt-0.5 text-xs font-medium text-slate-500">{tl("Aggiornato automaticamente ·")} {percentAvailable}{tl("% del plafond disponibile")}</p>
              </div>
            </div>
            <div className="mt-3 grid grid-cols-3 gap-2">
              {[
                [tl("Disponibili"), remainingLabel],
                [tl("Consumati"), formatCreditValue(used)],
                [tl("Plafond"), typeof cap === 'number' ? formatCreditValue(cap) : tl("Illimitato")],
              ].map(([label, value]) => (
                <div key={label} className="rounded-lg bg-slate-50 px-3 py-2">
                  <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">{label}</p>
                  <p className="mt-0.5 text-sm font-black tabular-nums text-slate-900">{value}</p>
                </div>
              ))}
            </div>
          </div>
          {(balance?.low_balance || balance?.exhausted) && (
            <div className={`border-b px-4 py-3 ${balance?.exhausted ? 'border-red-100 bg-red-50' : 'border-amber-100 bg-amber-50'}`}>
              <p className={`text-sm font-black ${balance?.exhausted ? 'text-red-700' : 'text-amber-800'}`}>
                {balance?.exhausted ? tl("Crediti esauriti") : tl("Crediti in esaurimento")}
              </p>
              <p className={`mt-0.5 text-xs ${balance?.exhausted ? 'text-red-700' : 'text-amber-700'}`}>
                {audience === 'student'
                  ? tl("Avvisa il tuo docente: potrà chiedere un nuovo bundle di crediti.")
                  : tl("Chiedi un nuovo bundle: l'amministratore riceve un avviso e può autorizzarlo subito.")}
              </p>
              {audience !== 'student' && (
                requestSent ? (
                  <p className="mt-2 text-xs font-bold text-slate-700">{tl("Richiesta inviata — in attesa dell'amministratore.")}</p>
                ) : requestOpen ? (
                  <div className="mt-2 flex flex-wrap items-end gap-2">
                    <label className="text-[11px] font-bold text-slate-600">
                      {tl("Crediti")}
                      <input
                        value={requestCredits}
                        onChange={(event) => setRequestCredits(event.target.value)}
                        inputMode="decimal"
                        className="mt-0.5 block h-8 w-24 rounded-lg border border-slate-200 bg-white px-2 text-right text-sm"
                      />
                    </label>
                    <label className="min-w-40 flex-1 text-[11px] font-bold text-slate-600">
                      {tl("Motivazione (facoltativa)")}
                      <input
                        value={requestReason}
                        onChange={(event) => setRequestReason(event.target.value)}
                        className="mt-0.5 block h-8 w-full rounded-lg border border-slate-200 bg-white px-2 text-sm font-normal"
                      />
                    </label>
                    <button
                      type="button"
                      onClick={sendRequest}
                      disabled={requestSending}
                      className="h-8 rounded-lg bg-slate-900 px-3 text-xs font-bold text-white disabled:opacity-50"
                    >
                      {requestSending ? tl("Invio…") : tl("Invia richiesta")}
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setRequestOpen(true)}
                    className="mt-2 h-8 rounded-lg bg-slate-900 px-3 text-xs font-bold text-white"
                  >
                    {tl("Richiedi nuovi crediti")}
                  </button>
                )
              )}
            </div>
          )}
          {isPool && (balance?.classes?.length ?? 0) > 0 && (
            <div className="border-b border-slate-100 px-4 py-3">
              <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">{tl("Budget per classe")}</p>
              <div className="mt-2 grid gap-1.5 sm:grid-cols-2">
                {balance!.classes!.map((cls) => (
                  <div key={cls.class_id} className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-1.5 text-xs">
                    <span className="truncate font-bold text-slate-700">{cls.class_name}</span>
                    <span className={`ml-2 shrink-0 font-black tabular-nums ${cls.exhausted ? 'text-red-600' : cls.low_balance ? 'text-amber-600' : 'text-slate-900'}`}>
                      {formatCreditValue(cls.credits_remaining ?? 0)} / {formatCreditValue(cls.credits_cap ?? 0)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
          <div className="border-b border-slate-100 px-4 py-2.5">
            <p className="text-xs font-black uppercase tracking-wide text-slate-600">{tl("Storico consumi")}</p>
          </div>
          <div className="max-h-80 overflow-auto">
            {historyLoading ? (
              <div className="px-3 py-6 text-center text-sm text-slate-500">{tl("Caricamento...")}</div>
            ) : history.length === 0 ? (
              <div className="px-3 py-6 text-center text-sm text-slate-500">{tl("Nessuna chiamata recente")}</div>
            ) : (
              <table className="w-full min-w-[560px] text-left text-xs">
                <thead className="sticky top-0 bg-slate-50 text-[10px] font-bold uppercase tracking-wide text-slate-400">
                  <tr>
                    <th className="px-4 py-2">{tl("Data")}</th>
                    <th className="px-3 py-2">{tl("Servizio")}</th>
                    {isPool && <th className="px-3 py-2">{tl("Studente / sessione")}</th>}
                    <th className="px-3 py-2">{tl("Provider / modello")}</th>
                    <th className="px-4 py-2 text-right">{tl("Crediti")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {history.map((item) => (
                    <tr key={item.id} className="hover:bg-slate-50/80">
                      <td className="whitespace-nowrap px-4 py-2.5 font-semibold text-slate-600">{formatWhen(item.timestamp)}</td>
                      <td className="px-3 py-2.5 font-black text-slate-800">{item.service || tl("Servizi AI")}</td>
                      {isPool && (
                        <td className="max-w-44 px-3 py-2.5">
                          <p className="truncate font-bold text-slate-700">{item.student_name || tl("Studente")}</p>
                          <p className="truncate text-[11px] text-slate-400">{[item.class_name, item.session_title].filter(Boolean).join(' · ') || tl("Sessione")}</p>
                        </td>
                      )}
                      <td className="max-w-48 px-3 py-2.5">
                        <p className="truncate font-semibold text-slate-600">{item.provider || '—'}</p>
                        <p className="truncate text-[11px] text-slate-400">{item.model || '—'}</p>
                      </td>
                      <td className="whitespace-nowrap px-4 py-2.5 text-right font-black tabular-nums" style={{ color: mainColor }}>
                        {formatCreditValue(item.cost_credits)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
