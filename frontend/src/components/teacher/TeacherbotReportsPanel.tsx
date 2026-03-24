import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { ArrowLeft, FileText, User, Calendar, MessageSquare, ChevronDown, ChevronUp, Loader2, Bot } from 'lucide-react'
import { teacherbotsApi } from '@/lib/api'

interface TeacherbotReportsPanelProps {
  teacherbotId: string
  onBack: () => void
}

interface Report {
  id: string
  conversation_id: string
  teacherbot_id: string
  teacherbot_name: string
  student_id: string
  student_nickname: string
  session_id: string
  session_title: string
  summary: string | null
  observations: string | null
  suggestions: string | null
  topics: string[] | null
  message_count: number
  report_generated_at: string | null
  conversation_created_at: string
}

interface ConvMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  created_at: string
}

function MessageTranscript({ teacherbotId, conversationId }: { teacherbotId: string; conversationId: string }) {
  const { data: messages, isLoading } = useQuery({
    queryKey: ['teacherbot-conv-messages', teacherbotId, conversationId],
    queryFn: async () => {
      const res = await teacherbotsApi.getTeacherConversationMessages(teacherbotId, conversationId)
      return res.data as ConvMessage[]
    },
  })

  if (isLoading) {
    return (
      <div className="flex justify-center py-4">
        <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
      </div>
    )
  }

  if (!messages || messages.length === 0) {
    return <p className="text-xs text-slate-400 py-2">Nessun messaggio registrato.</p>
  }

  return (
    <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
      {messages.map((msg) => (
        <div key={msg.id} className={`flex gap-2 ${msg.role === 'user' ? 'flex-row-reverse' : 'flex-row'}`}>
          <div className={`flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold ${
            msg.role === 'user' ? 'bg-slate-200 text-slate-600' : 'bg-[#181b1e] text-white'
          }`}>
            {msg.role === 'user' ? <User className="h-3 w-3" /> : <Bot className="h-3 w-3" />}
          </div>
          <div className={`flex-1 text-xs rounded-lg px-3 py-2 max-w-[85%] ${
            msg.role === 'user' ? 'bg-slate-100 text-slate-700 ml-auto' : 'bg-white border border-slate-200 text-slate-700'
          }`}>
            <p className="whitespace-pre-wrap leading-relaxed">{msg.content}</p>
          </div>
        </div>
      ))}
    </div>
  )
}

export default function TeacherbotReportsPanel({ teacherbotId, onBack }: TeacherbotReportsPanelProps) {
  const [expandedReport, setExpandedReport] = useState<string | null>(null)
  const [expandedView, setExpandedView] = useState<'report' | 'transcript'>('report')

  const { data: reports, isLoading } = useQuery({
    queryKey: ['teacherbot-reports', teacherbotId],
    queryFn: async () => {
      const res = await teacherbotsApi.getReports(teacherbotId)
      return res.data as Report[]
    },
  })

  const { data: teacherbot } = useQuery({
    queryKey: ['teacherbot', teacherbotId],
    queryFn: async () => {
      const res = await teacherbotsApi.get(teacherbotId)
      return res.data
    },
  })

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString('it-IT', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  }

  const getColorClass = (color: string) => {
    const colorMap: Record<string, string> = {
      indigo: 'bg-[#181b1e]',
      blue: 'bg-blue-500',
      green: 'bg-green-500',
      purple: 'bg-purple-500',
      pink: 'bg-pink-500',
      orange: 'bg-orange-500',
      teal: 'bg-teal-500',
      cyan: 'bg-cyan-500',
      red: 'bg-red-500',
    }
    return colorMap[color] || 'bg-[#181b1e]'
  }

  const hasReport = (r: Report) => !!r.report_generated_at

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-[#181b1e]" />
      </div>
    )
  }

  const withReport = reports?.filter(hasReport).length ?? 0

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="flex items-center gap-4 mb-6">
        <Button variant="ghost" onClick={onBack} className="text-slate-600">
          <ArrowLeft className="h-4 w-4 mr-2" />
          Indietro
        </Button>
        <div className="flex-1 flex items-center gap-3">
          <div className={`w-10 h-10 rounded-lg ${getColorClass(teacherbot?.color)} flex items-center justify-center`}>
            <FileText className="h-5 w-5 text-white" />
          </div>
          <div>
            <h2 className="font-bold text-slate-800">Storico: {teacherbot?.name}</h2>
            <p className="text-xs text-slate-500">
              {reports?.length ?? 0} conversazioni · {withReport} con report
            </p>
          </div>
        </div>
      </div>

      {/* Reports List */}
      <div className="flex-1 overflow-y-auto">
        {reports && reports.length > 0 ? (
          <div className="space-y-3">
            {reports.map((report) => (
              <div
                key={report.id}
                className="bg-white rounded-xl border border-slate-200 overflow-hidden"
              >
                {/* Report Header */}
                <button
                  onClick={() => {
                    if (expandedReport === report.id) {
                      setExpandedReport(null)
                    } else {
                      setExpandedReport(report.id)
                      setExpandedView(hasReport(report) ? 'report' : 'transcript')
                    }
                  }}
                  className="w-full p-4 flex items-center gap-4 hover:bg-slate-50 transition-colors text-left"
                >
                  <div className="w-9 h-9 rounded-full bg-[#181b1e]/10 flex items-center justify-center flex-shrink-0">
                    <User className="h-4 w-4 text-[#181b1e]" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold text-slate-800 text-sm">{report.student_nickname}</div>
                    <div className="text-xs text-slate-500 truncate">{report.session_title}</div>
                  </div>
                  <div className="flex items-center gap-3 text-xs text-slate-400 flex-shrink-0">
                    {hasReport(report) ? (
                      <span className="px-1.5 py-0.5 rounded-full text-[10px] font-semibold bg-green-100 text-green-700">Report</span>
                    ) : (
                      <span className="px-1.5 py-0.5 rounded-full text-[10px] font-semibold bg-slate-100 text-slate-500">Solo chat</span>
                    )}
                    <span className="flex items-center gap-0.5">
                      <MessageSquare className="h-3 w-3" />
                      {report.message_count}
                    </span>
                    <span className="flex items-center gap-0.5 hidden sm:flex">
                      <Calendar className="h-3 w-3" />
                      {formatDate(report.conversation_created_at)}
                    </span>
                    {expandedReport === report.id ? (
                      <ChevronUp className="h-4 w-4" />
                    ) : (
                      <ChevronDown className="h-4 w-4" />
                    )}
                  </div>
                </button>

                {/* Expanded Content */}
                {expandedReport === report.id && (
                  <div className="border-t border-slate-100 p-4 bg-slate-50">
                    {/* Tab switcher when both available */}
                    {hasReport(report) && (
                      <div className="flex gap-1 bg-slate-100 rounded-lg p-1 mb-4 w-fit">
                        <button
                          onClick={() => setExpandedView('report')}
                          className={`px-3 py-1 rounded-md text-xs font-medium transition-all ${
                            expandedView === 'report' ? 'bg-white shadow-sm text-slate-900' : 'text-slate-500 hover:text-slate-700'
                          }`}
                        >
                          Report AI
                        </button>
                        <button
                          onClick={() => setExpandedView('transcript')}
                          className={`px-3 py-1 rounded-md text-xs font-medium transition-all ${
                            expandedView === 'transcript' ? 'bg-white shadow-sm text-slate-900' : 'text-slate-500 hover:text-slate-700'
                          }`}
                        >
                          Trascrizione
                        </button>
                      </div>
                    )}

                    {/* Report view */}
                    {expandedView === 'report' && hasReport(report) && (
                      <div className="space-y-4">
                        {report.summary && (
                          <div>
                            <h4 className="font-semibold text-slate-700 mb-2 flex items-center gap-2 text-sm">
                              <span className="w-2 h-2 rounded-full bg-[#181b1e]"></span>
                              Sintesi
                            </h4>
                            <p className="text-sm text-slate-600 bg-white p-3 rounded-lg border border-slate-200">
                              {report.summary}
                            </p>
                          </div>
                        )}
                        {report.topics && report.topics.length > 0 && (
                          <div>
                            <h4 className="font-semibold text-slate-700 mb-2 flex items-center gap-2 text-sm">
                              <span className="w-2 h-2 rounded-full bg-blue-500"></span>
                              Argomenti discussi
                            </h4>
                            <div className="flex flex-wrap gap-2">
                              {report.topics.map((topic, i) => (
                                <span key={i} className="px-3 py-1 bg-blue-100 text-blue-700 rounded-full text-xs">
                                  {topic}
                                </span>
                              ))}
                            </div>
                          </div>
                        )}
                        {report.observations && (
                          <div>
                            <h4 className="font-semibold text-slate-700 mb-2 flex items-center gap-2 text-sm">
                              <span className="w-2 h-2 rounded-full bg-green-500"></span>
                              Osservazioni
                            </h4>
                            <p className="text-sm text-slate-600 bg-white p-3 rounded-lg border border-slate-200">
                              {report.observations}
                            </p>
                          </div>
                        )}
                        {report.suggestions && (
                          <div>
                            <h4 className="font-semibold text-slate-700 mb-2 flex items-center gap-2 text-sm">
                              <span className="w-2 h-2 rounded-full bg-amber-500"></span>
                              Suggerimenti
                            </h4>
                            <p className="text-sm text-slate-600 bg-white p-3 rounded-lg border border-slate-200">
                              {report.suggestions}
                            </p>
                          </div>
                        )}
                        {report.report_generated_at && (
                          <div className="pt-2 border-t border-slate-200 text-xs text-slate-400">
                            Report generato il {formatDate(report.report_generated_at)}
                          </div>
                        )}
                      </div>
                    )}

                    {/* Transcript view */}
                    {(expandedView === 'transcript' || !hasReport(report)) && (
                      <div>
                        <h4 className="font-semibold text-slate-700 mb-3 flex items-center gap-2 text-sm">
                          <span className="w-2 h-2 rounded-full bg-slate-400"></span>
                          Trascrizione conversazione
                        </h4>
                        <MessageTranscript
                          teacherbotId={teacherbotId}
                          conversationId={report.conversation_id}
                        />
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <div className="w-16 h-16 rounded-full bg-slate-100 flex items-center justify-center mb-4">
              <FileText className="h-8 w-8 text-slate-400" />
            </div>
            <h3 className="text-lg font-semibold text-slate-800 mb-2">Nessuna conversazione</h3>
            <p className="text-sm text-slate-500 max-w-md">
              Le conversazioni degli studenti con questo teacherbot appariranno qui.
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
