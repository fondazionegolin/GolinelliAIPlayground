import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { ArrowLeft, FileText, User, Calendar, MessageSquare, ChevronDown, ChevronUp, Loader2 } from 'lucide-react'
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

export default function TeacherbotReportsPanel({ teacherbotId, onBack }: TeacherbotReportsPanelProps) {
  const [expandedReport, setExpandedReport] = useState<string | null>(null)

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

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-[#181b1e]" />
      </div>
    )
  }

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
            <h2 className="font-bold text-slate-800">Report: {teacherbot?.name}</h2>
            <p className="text-xs text-slate-500">{reports?.length || 0} report generati</p>
          </div>
        </div>
      </div>

      {/* Reports List */}
      <div className="flex-1 overflow-y-auto">
        {reports && reports.length > 0 ? (
          <div className="space-y-4">
            {reports.map((report) => (
              <div
                key={report.id}
                className="bg-white rounded-xl border border-slate-200 overflow-hidden"
              >
                {/* Report Header */}
                <button
                  onClick={() => setExpandedReport(expandedReport === report.id ? null : report.id)}
                  className="w-full p-4 flex items-center gap-4 hover:bg-slate-50 transition-colors"
                >
                  <div className="w-10 h-10 rounded-full bg-[#181b1e]/10 flex items-center justify-center flex-shrink-0">
                    <User className="h-5 w-5 text-[#181b1e]" />
                  </div>
                  <div className="flex-1 text-left">
                    <div className="font-semibold text-slate-800">{report.student_nickname}</div>
                    <div className="text-sm text-slate-500">{report.session_title}</div>
                  </div>
                  <div className="flex items-center gap-4 text-sm text-slate-500">
                    <span className="flex items-center gap-1">
                      <MessageSquare className="h-4 w-4" />
                      {report.message_count}
                    </span>
                    <span className="flex items-center gap-1">
                      <Calendar className="h-4 w-4" />
                      {formatDate(report.conversation_created_at)}
                    </span>
                    {expandedReport === report.id ? (
                      <ChevronUp className="h-5 w-5" />
                    ) : (
                      <ChevronDown className="h-5 w-5" />
                    )}
                  </div>
                </button>

                {/* Expanded Report Content */}
                {expandedReport === report.id && (
                  <div className="border-t border-slate-100 p-4 bg-slate-50">
                    {report.summary && (
                      <div className="mb-4">
                        <h4 className="font-semibold text-slate-700 mb-2 flex items-center gap-2">
                          <span className="w-2 h-2 rounded-full bg-[#181b1e]"></span>
                          Sintesi
                        </h4>
                        <p className="text-sm text-slate-600 bg-white p-3 rounded-lg border border-slate-200">
                          {report.summary}
                        </p>
                      </div>
                    )}

                    {report.topics && report.topics.length > 0 && (
                      <div className="mb-4">
                        <h4 className="font-semibold text-slate-700 mb-2 flex items-center gap-2">
                          <span className="w-2 h-2 rounded-full bg-blue-500"></span>
                          Argomenti discussi
                        </h4>
                        <div className="flex flex-wrap gap-2">
                          {report.topics.map((topic, i) => (
                            <span
                              key={i}
                              className="px-3 py-1 bg-blue-100 text-blue-700 rounded-full text-sm"
                            >
                              {topic}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}

                    {report.observations && (
                      <div className="mb-4">
                        <h4 className="font-semibold text-slate-700 mb-2 flex items-center gap-2">
                          <span className="w-2 h-2 rounded-full bg-green-500"></span>
                          Osservazioni sullo studente
                        </h4>
                        <p className="text-sm text-slate-600 bg-white p-3 rounded-lg border border-slate-200">
                          {report.observations}
                        </p>
                      </div>
                    )}

                    {report.suggestions && (
                      <div>
                        <h4 className="font-semibold text-slate-700 mb-2 flex items-center gap-2">
                          <span className="w-2 h-2 rounded-full bg-amber-500"></span>
                          Suggerimenti per il docente
                        </h4>
                        <p className="text-sm text-slate-600 bg-white p-3 rounded-lg border border-slate-200">
                          {report.suggestions}
                        </p>
                      </div>
                    )}

                    {report.report_generated_at && (
                      <div className="mt-4 pt-4 border-t border-slate-200 text-xs text-slate-400">
                        Report generato il {formatDate(report.report_generated_at)}
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
            <h3 className="text-lg font-semibold text-slate-800 mb-2">Nessun report</h3>
            <p className="text-sm text-slate-500 max-w-md">
              I report verranno generati automaticamente quando gli studenti termineranno le conversazioni con questo teacherbot.
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
