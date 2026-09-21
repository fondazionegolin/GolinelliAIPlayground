import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate, useLocation } from 'react-router-dom'
import { adminApi } from '@/lib/api'
import { useAuthStore } from '@/stores/auth'
import { useToast } from '@/components/ui/use-toast'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Button } from '@/design'
import {
  Search, ChevronDown, ChevronUp, Loader2, ShieldCheck, ShieldAlert, Users, Activity, Euro, Clock, Eye,
} from 'lucide-react'

interface ConsentStatus {
  key: string
  version: string
  accepted_at: string | null
}

interface StudentRow {
  id: string
  nickname: string
  session_title: string
  class_name: string | null
  is_frozen: boolean
  created_at: string | null
  last_seen_at: string | null
  interactions: number
  cost: number
  last_interaction_at: string | null
  consents: ConsentStatus[]
}

interface ConsentDefinition {
  key: string
  title: string
  version: string
  source_url: string
  accept_label: string
}

interface StudentsResponse {
  consent_definitions: ConsentDefinition[]
  items: StudentRow[]
}

interface ActivityItem {
  id: string
  timestamp: string | null
  transaction_type: string | null
  provider: string | null
  model: string | null
  cost: number
  usage_details: Record<string, unknown> | null
}

const formatDateTime = (raw?: string | null) => {
  if (!raw) return '—'
  const d = new Date(raw)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleString('it-IT', { day: '2-digit', month: 'short', year: '2-digit', hour: '2-digit', minute: '2-digit' })
}
const formatCurrency = (v: number) => `€ ${Number(v || 0).toFixed(3)}`

export default function StudentsPage() {
  const [search, setSearch] = useState('')
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [enteringId, setEnteringId] = useState<string | null>(null)
  const navigate = useNavigate()
  const location = useLocation()
  const { toast } = useToast()
  const authStore = useAuthStore()

  const { data, isLoading } = useQuery({
    queryKey: ['admin-students', search],
    queryFn: () => adminApi.getStudents(search || undefined),
    staleTime: 15_000,
  })
  const payload: StudentsResponse | undefined = data?.data
  const students = payload?.items || []
  const consentDefinitions = payload?.consent_definitions || []

  const enterSubjectiveView = async (student: StudentRow) => {
    if (enteringId) return
    setEnteringId(student.id)
    try {
      const response = await adminApi.createStudentSubjectiveView(student.id)
      const { token, student_id, session_id, session_title, nickname } = response.data
      if (authStore.accessToken && authStore.user) {
        localStorage.setItem('_teacher_token_backup', authStore.accessToken)
        localStorage.setItem('_teacher_user_backup', JSON.stringify(authStore.user))
      }
      localStorage.setItem('_subjective_mode', JSON.stringify({
        studentId: student_id,
        nickname,
        returnPath: `${location.pathname}${location.search}`,
      }))
      authStore.setObservedStudentSession({ student_id, session_id, session_title, nickname }, token)
      navigate('/student')
    } catch (error: any) {
      localStorage.removeItem('_subjective_mode')
      localStorage.removeItem('student_token')
      toast({
        variant: 'destructive',
        title: 'Vista soggettiva non disponibile',
        description: error?.response?.data?.detail || "Non è stato possibile accedere all'interfaccia dello studente.",
      })
    } finally {
      setEnteringId(null)
    }
  }

  return (
    <div className="mx-auto max-w-6xl space-y-4 p-4 md:p-6">
      <div>
        <h1 className="text-xl font-black text-slate-900">Studenti</h1>
        <p className="text-sm text-slate-500">
          Elenco degli studenti che hanno effettuato l'accesso, con log delle interazioni con i servizi AI della piattaforma
          e stato di accettazione delle informative richieste (es. DeepSeek).
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative w-72 max-w-full">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Cerca per nickname…" className="pl-9" />
        </div>
        <span className="text-xs font-semibold text-slate-400">{students.length} studenti</span>
      </div>

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="flex items-center justify-center gap-2 p-10 text-sm text-slate-400"><Loader2 className="h-4 w-4 animate-spin" /> Caricamento…</div>
          ) : students.length === 0 ? (
            <div className="flex flex-col items-center gap-2 p-10 text-sm text-slate-400"><Users className="h-6 w-6" /> Nessuno studente trovato.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-100 text-left text-[11px] font-bold uppercase tracking-wide text-slate-400">
                    <th className="px-4 py-3">Nickname</th>
                    <th className="px-4 py-3" />
                    <th className="px-4 py-3">Classe / Sessione</th>
                    <th className="px-4 py-3">Ultimo accesso</th>
                    <th className="px-4 py-3 text-right">Interazioni</th>
                    <th className="px-4 py-3 text-right">Costo</th>
                    {consentDefinitions.map((doc) => <th key={doc.key} className="px-4 py-3">{doc.title}</th>)}
                    <th className="px-4 py-3" />
                  </tr>
                </thead>
                <tbody>
                  {students.map((student) => (
                    <StudentRowView
                      key={student.id}
                      student={student}
                      consentDefinitions={consentDefinitions}
                      expanded={expandedId === student.id}
                      onToggle={() => setExpandedId((current) => current === student.id ? null : student.id)}
                      onEnterSubjectiveView={() => enterSubjectiveView(student)}
                      entering={enteringId === student.id}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

function StudentRowView({ student, consentDefinitions, expanded, onToggle, onEnterSubjectiveView, entering }: {
  student: StudentRow
  consentDefinitions: ConsentDefinition[]
  expanded: boolean
  onToggle: () => void
  onEnterSubjectiveView: () => void
  entering: boolean
}) {
  return (
    <>
      <tr className="cursor-pointer border-b border-slate-50 hover:bg-slate-50" onClick={onToggle}>
        <td className="px-4 py-3 font-bold text-slate-800">{student.nickname}{student.is_frozen && <span className="ml-2 rounded-full bg-slate-100 px-2 py-0.5 text-[9px] font-black uppercase text-slate-500">Congelato</span>}</td>
        <td className="px-4 py-3" onClick={(event) => event.stopPropagation()}>
          <Button tone="accent" surface="outline" density="compact" className="rounded-full" disabled={entering} onClick={onEnterSubjectiveView}>
            {entering ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Eye className="h-3.5 w-3.5" />} Vista studente
          </Button>
        </td>
        <td className="px-4 py-3 text-slate-600">{student.class_name || '—'} <span className="text-slate-400">· {student.session_title}</span></td>
        <td className="px-4 py-3 text-slate-500">{formatDateTime(student.last_seen_at)}</td>
        <td className="px-4 py-3 text-right font-semibold text-slate-700">{student.interactions}</td>
        <td className="px-4 py-3 text-right font-semibold text-slate-700">{formatCurrency(student.cost)}</td>
        {consentDefinitions.map((doc) => {
          const status = student.consents.find((item) => item.key === doc.key)
          return (
            <td key={doc.key} className="px-4 py-3">
              {status?.accepted_at ? (
                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-1 text-[10px] font-bold text-emerald-700" title={formatDateTime(status.accepted_at)}>
                  <ShieldCheck className="h-3 w-3" /> Accettato
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-1 text-[10px] font-bold text-amber-700">
                  <ShieldAlert className="h-3 w-3" /> In attesa
                </span>
              )}
            </td>
          )
        })}
        <td className="px-4 py-3 text-right">{expanded ? <ChevronUp className="ml-auto h-4 w-4 text-slate-400" /> : <ChevronDown className="ml-auto h-4 w-4 text-slate-400" />}</td>
      </tr>
      {expanded && (
        <tr className="border-b border-slate-100 bg-slate-50/60">
          <td colSpan={6 + consentDefinitions.length} className="px-4 py-4">
            <StudentActivityLog studentId={student.id} />
          </td>
        </tr>
      )}
    </>
  )
}

function StudentActivityLog({ studentId }: { studentId: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ['admin-student-activity', studentId],
    queryFn: () => adminApi.getStudentActivity(studentId, 50, 0),
    staleTime: 10_000,
  })
  const items: ActivityItem[] = data?.data?.items || []
  const total: number = data?.data?.total || 0

  if (isLoading) return <div className="flex items-center gap-2 text-xs text-slate-400"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Caricamento log interazioni…</div>
  if (!items.length) return <p className="text-xs text-slate-400">Nessuna interazione registrata per questo studente.</p>

  return (
    <div>
      <p className="mb-2 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-slate-400"><Activity className="h-3.5 w-3.5" /> Log interazioni ({total} totali, ultime {items.length})</p>
      <div className="max-h-72 overflow-y-auto rounded-xl border border-slate-200 bg-white">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-slate-100 text-left text-[10px] font-bold uppercase text-slate-400">
              <th className="px-3 py-2">Quando</th>
              <th className="px-3 py-2">Tipo</th>
              <th className="px-3 py-2">Provider / Modello</th>
              <th className="px-3 py-2 text-right">Costo</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.id} className="border-b border-slate-50 last:border-0">
                <td className="px-3 py-2 text-slate-500"><Clock className="mr-1 inline h-3 w-3" />{formatDateTime(item.timestamp)}</td>
                <td className="px-3 py-2 text-slate-600">{item.transaction_type || '—'}</td>
                <td className="px-3 py-2 text-slate-600">{item.provider || '—'} {item.model ? `· ${item.model}` : ''}</td>
                <td className="px-3 py-2 text-right font-semibold text-slate-700"><Euro className="mr-1 inline h-3 w-3" />{formatCurrency(item.cost)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
