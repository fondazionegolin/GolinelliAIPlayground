import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { Moon, Users } from 'lucide-react'
import { creditsApi, studentApi } from '@/lib/api'

type CreditBalance = {
  credits_remaining: number | null
  credits_used: number
  credits_cap: number | null
}

type CreditHistoryItem = {
  id: string
  timestamp: string
  student_name?: string | null
  class_name?: string | null
  session_title?: string | null
  provider?: string | null
  model?: string | null
  cost_eur: number
  cost_credits: number
}

interface CreditBalancePillProps {
  audience: 'teacher' | 'student' | 'studentPool'
  accentColor: string
}

const teacherCreditColor = '#f97316'
const poolCreditColor = '#0e7490'

function formatCreditValue(value: number) {
  if (value === 0) return '0'
  if (value < 0.001) return '<0,001'
  return value.toLocaleString('it-IT', {
    minimumFractionDigits: value < 1 ? 3 : 0,
    maximumFractionDigits: value < 1 ? 3 : 2,
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

export function CreditBalancePill({ audience, accentColor }: CreditBalancePillProps) {
  const [balance, setBalance] = useState<CreditBalance | null>(null)
  const [history, setHistory] = useState<CreditHistoryItem[]>([])
  const [open, setOpen] = useState(false)
  const [historyLoading, setHistoryLoading] = useState(false)
  const panelRef = useRef<HTMLDivElement>(null)

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
    const interval = window.setInterval(loadBalance, 30000)
    window.addEventListener('focus', loadBalance)

    return () => {
      mounted = false
      window.clearInterval(interval)
      window.removeEventListener('focus', loadBalance)
    }
  }, [audience])

  useEffect(() => {
    if (!open) return
    let mounted = true

    const loadHistory = async () => {
      setHistoryLoading(true)
      try {
        const response = audience === 'student'
          ? await studentApi.getCreditHistory(20)
          : audience === 'studentPool'
            ? await creditsApi.getStudentPoolHistory(50)
            : await creditsApi.getHistory(20)
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

  const credits = balance?.credits_remaining
  const isLow = typeof credits === 'number' && credits < 20
  const label = typeof credits === 'number' ? credits.toLocaleString('it-IT') : '--'
  const isPool = audience === 'studentPool'
  const mainColor = isPool ? poolCreditColor : teacherCreditColor
  const title = isPool ? 'Pool crediti studenti' : 'Crediti AI docente'
  const Icon = isPool ? Users : Moon

  return (
    <div className="relative" ref={panelRef}>
      <button
        type="button"
        className="navbar-inline-control flex h-9 min-w-[66px] flex-col items-center justify-center gap-0.5 rounded-xl px-3 leading-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-0"
        style={{
          color: isLow ? '#dc2626' : mainColor,
          borderColor: isLow ? 'rgba(220,38,38,0.35)' : 'transparent',
          '--btn-tone': accentColor,
          '--tw-ring-color': accentColor,
        } as CSSProperties}
        title={title}
        aria-label={`${title}: ${label}`}
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <span className="flex items-center gap-1 text-[15px] font-black tabular-nums">
          {label}
          <Icon className="h-3.5 w-3.5" strokeWidth={2.5} aria-hidden />
        </span>
        <span className="text-[8px] font-bold uppercase tracking-[0.12em] opacity-75">{isPool ? 'pool' : 'docente'}</span>
      </button>

      {open && (
        <div className="absolute right-0 top-full z-50 mt-2 w-[340px] overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl animate-in fade-in zoom-in-95 duration-100">
          <div className="border-b border-slate-100 px-4 py-3">
            <p className="text-sm font-black text-slate-900">{title}</p>
            <p className="mt-0.5 text-xs font-medium text-slate-500">
              {label} disponibili{typeof balance?.credits_cap === 'number' ? ` su ${balance.credits_cap.toLocaleString('it-IT')}` : ''}
            </p>
          </div>
          <div className="max-h-80 overflow-y-auto p-2">
            {historyLoading ? (
              <div className="px-3 py-6 text-center text-sm text-slate-500">Caricamento...</div>
            ) : history.length === 0 ? (
              <div className="px-3 py-6 text-center text-sm text-slate-500">Nessuna chiamata recente</div>
            ) : (
              <div className="space-y-1">
                {history.map((item) => (
                  <div key={item.id} className="grid grid-cols-[1fr_auto] gap-3 rounded-lg px-3 py-2 hover:bg-slate-50">
                    <div className="min-w-0">
                      <p className="text-xs font-bold text-slate-700">{formatWhen(item.timestamp)}</p>
                      {isPool ? (
                        <>
                          <p className="truncate text-xs font-semibold text-slate-600">{item.student_name || 'Studente'}</p>
                          <p className="truncate text-xs text-slate-500">{[item.class_name, item.session_title].filter(Boolean).join(' · ') || 'Sessione'}</p>
                        </>
                      ) : (
                        <p className="truncate text-xs text-slate-500">{item.provider || 'provider'}{item.model ? ` · ${item.model}` : ''}</p>
                      )}
                      {isPool && (
                        <p className="truncate text-[11px] text-slate-400">{item.provider || 'provider'}{item.model ? ` · ${item.model}` : ''}</p>
                      )}
                    </div>
                    <div className="self-center text-right text-xs font-black tabular-nums" style={{ color: mainColor }}>
                      {formatCreditValue(item.cost_credits)} crediti
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
