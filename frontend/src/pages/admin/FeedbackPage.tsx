import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { feedbackApi } from '@/lib/api'
import { Bug, ChevronDown, ChevronUp, CheckCircle, Clock, Monitor, Globe, AlertTriangle } from 'lucide-react'

interface FeedbackReport {
  id: string
  user_type: string
  user_display_name: string | null
  message: string
  page_url: string | null
  browser_info: {
    user_agent?: string
    screen_width?: number
    screen_height?: number
    language?: string
    platform?: string
    viewport_width?: number
    viewport_height?: number
  }
  console_errors: string[]
  status: string
  created_at: string
}

function timeAgo(isoString: string): string {
  const diff = Date.now() - new Date(isoString).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'adesso'
  if (mins < 60) return `${mins}m fa`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h fa`
  const days = Math.floor(hrs / 24)
  return `${days}g fa`
}

function FeedbackCard({ report, onMarkReviewed }: { report: FeedbackReport; onMarkReviewed: (id: string) => void }) {
  const [expanded, setExpanded] = useState(false)
  const isNew = report.status === 'new'

  return (
    <div className={`rounded-xl border transition-all ${isNew ? 'border-pink-200 bg-pink-50/40' : 'border-slate-100 bg-white'}`}>
      <div className="p-4">
        <div className="flex items-start gap-3">
          {/* User avatar */}
          <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 ${
            report.user_type === 'teacher' ? 'bg-indigo-100 text-indigo-700' : 'bg-emerald-100 text-emerald-700'
          }`}>
            {(report.user_display_name?.[0] || '?').toUpperCase()}
          </div>

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm font-semibold text-slate-800">
                {report.user_display_name || 'Utente sconosciuto'}
              </span>
              <span className={`text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded-full ${
                report.user_type === 'teacher' ? 'bg-indigo-100 text-indigo-600' : 'bg-emerald-100 text-emerald-600'
              }`}>
                {report.user_type === 'teacher' ? 'Docente' : 'Studente'}
              </span>
              {isNew && (
                <span className="text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded-full bg-pink-100 text-pink-600">
                  Nuovo
                </span>
              )}
              <span className="text-xs text-slate-400 ml-auto">{timeAgo(report.created_at)}</span>
            </div>

            <p className="text-sm text-slate-700 mt-1.5 leading-relaxed">{report.message}</p>

            {report.page_url && (
              <div className="flex items-center gap-1 mt-1.5">
                <Globe className="h-3 w-3 text-slate-400" />
                <span className="text-[11px] text-slate-400 truncate max-w-xs">{report.page_url}</span>
              </div>
            )}
          </div>
        </div>

        {/* Expand/actions row */}
        <div className="flex items-center gap-2 mt-3 pt-3 border-t border-slate-100">
          {report.console_errors.length > 0 && (
            <div className="flex items-center gap-1 text-amber-600">
              <AlertTriangle className="h-3.5 w-3.5" />
              <span className="text-[11px] font-medium">{report.console_errors.length} errori console</span>
            </div>
          )}
          {(report.browser_info.user_agent || report.console_errors.length > 0) && (
            <button
              onClick={() => setExpanded(v => !v)}
              className="flex items-center gap-1 text-xs text-slate-400 hover:text-slate-600 transition-colors ml-1"
            >
              {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
              {expanded ? 'Meno dettagli' : 'Dettagli tecnici'}
            </button>
          )}
          <div className="flex-1" />
          {isNew && (
            <button
              onClick={() => onMarkReviewed(report.id)}
              className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-green-600 transition-colors px-2 py-1 rounded-lg hover:bg-green-50"
            >
              <CheckCircle className="h-3.5 w-3.5" />
              Segna come letto
            </button>
          )}
        </div>

        {/* Expanded technical details */}
        {expanded && (
          <div className="mt-3 space-y-2">
            {report.browser_info.user_agent && (
              <div className="flex items-start gap-2">
                <Monitor className="h-3.5 w-3.5 text-slate-400 mt-0.5 flex-shrink-0" />
                <div>
                  <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide">Browser</p>
                  <p className="text-[11px] text-slate-600 break-all">{report.browser_info.user_agent}</p>
                  {report.browser_info.screen_width && (
                    <p className="text-[11px] text-slate-400">
                      Schermo: {report.browser_info.screen_width}×{report.browser_info.screen_height}
                      {report.browser_info.viewport_width && ` · Viewport: ${report.browser_info.viewport_width}×${report.browser_info.viewport_height}`}
                      {report.browser_info.language && ` · ${report.browser_info.language}`}
                    </p>
                  )}
                </div>
              </div>
            )}
            {report.console_errors.length > 0 && (
              <div>
                <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide mb-1">Errori console</p>
                <div className="bg-slate-900 rounded-lg p-3 max-h-40 overflow-y-auto">
                  {report.console_errors.map((err, i) => (
                    <p key={i} className="text-[11px] text-red-300 font-mono leading-relaxed">{err}</p>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

export default function FeedbackPage() {
  const [filter, setFilter] = useState<'all' | 'new' | 'reviewed'>('all')
  const queryClient = useQueryClient()

  const { data: reports = [], isLoading } = useQuery({
    queryKey: ['admin-feedback', filter],
    queryFn: async () => {
      const res = await feedbackApi.list({ status_filter: filter === 'all' ? undefined : filter, limit: 200 })
      return res.data as FeedbackReport[]
    },
  })

  const markReviewedMutation = useMutation({
    mutationFn: (id: string) => feedbackApi.updateStatus(id, 'reviewed'),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-feedback'] })
    },
  })

  const newCount = reports.filter(r => r.status === 'new').length

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
            <Bug className="h-6 w-6" style={{ color: '#e85c8d' }} />
            Feedback Beta
          </h1>
          <p className="text-sm text-slate-500 mt-0.5">
            Segnalazioni bug e comportamenti inattesi dagli utenti
          </p>
        </div>
        {newCount > 0 && (
          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-semibold" style={{ backgroundColor: '#fce7f3', color: '#e85c8d' }}>
            <Clock className="h-4 w-4" />
            {newCount} nuovi
          </div>
        )}
      </div>

      {/* Filter tabs */}
      <div className="flex gap-1 bg-slate-100 rounded-xl p-1 w-fit">
        {(['all', 'new', 'reviewed'] as const).map(f => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-all ${
              filter === f ? 'bg-white shadow-sm text-slate-900' : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            {f === 'all' ? 'Tutti' : f === 'new' ? 'Nuovi' : 'Letti'}
          </button>
        ))}
      </div>

      {/* List */}
      {isLoading ? (
        <div className="flex justify-center py-16">
          <div className="h-8 w-8 border-2 border-slate-200 border-t-slate-600 rounded-full animate-spin" />
        </div>
      ) : reports.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <div className="w-14 h-14 rounded-full bg-slate-100 flex items-center justify-center mb-3">
            <Bug className="h-7 w-7 text-slate-400" />
          </div>
          <p className="text-slate-500 font-medium">Nessun feedback</p>
          <p className="text-sm text-slate-400 mt-1">I feedback degli utenti appariranno qui</p>
        </div>
      ) : (
        <div className="space-y-3">
          {reports.map(report => (
            <FeedbackCard
              key={report.id}
              report={report}
              onMarkReviewed={(id) => markReviewedMutation.mutate(id)}
            />
          ))}
        </div>
      )}
    </div>
  )
}
