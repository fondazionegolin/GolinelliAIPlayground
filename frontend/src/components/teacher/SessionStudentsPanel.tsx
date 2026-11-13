import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate, useLocation } from 'react-router-dom'
import { KeyRound, Loader2, MessageSquare, RefreshCw, Search, Snowflake, Sun, X } from '@/components/icons'
import { teacherApi } from '@/lib/api'
import { useAuthStore } from '@/stores/auth'
import { useToast } from '@/components/ui/use-toast'
import { tl } from '@/i18n/tl'

export interface SessionStudentSummary { id: string; nickname: string; is_frozen: boolean }
export interface OnlineUserLike { student_id: string; nickname?: string; role?: string }

interface Props {
  sessionId: string
  onlineUsers: OnlineUserLike[]
  /** Cap the list height (the floating window already scrolls on its own). */
  className?: string
}

const iconBtn = 'flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-slate-400 transition-colors disabled:opacity-40'

function generatePassword(): string {
  const alphabet = 'abcdefghjkmnpqrstuvwxyz23456789'
  const bytes = new Uint32Array(8)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (n) => alphabet[n % alphabet.length]).join('')
}

/**
 * Student controls for a live session: direct chat, freeze/unfreeze, subjective view and
 * password reset. Shared by the floating students window and the class-chat "Studenti" tab.
 */
export function SessionStudentsPanel({ sessionId, onlineUsers, className = '' }: Props) {
  const { toast } = useToast()
  const navigate = useNavigate()
  const location = useLocation()
  const queryClient = useQueryClient()
  const [busyId, setBusyId] = useState<string | null>(null)
  const [subjectiveId, setSubjectiveId] = useState<string | null>(null)
  const [resetId, setResetId] = useState<string | null>(null)
  const [newPassword, setNewPassword] = useState('')
  const [lastReset, setLastReset] = useState<{ id: string; password: string } | null>(null)

  const queryKey = ['session-live-students', sessionId]
  const { data: enrolled = [], isLoading } = useQuery<SessionStudentSummary[]>({
    queryKey,
    queryFn: async () => (await teacherApi.getSessionLive(sessionId)).data.students || [],
    refetchInterval: 20_000,
  })

  const online = onlineUsers.filter((user) => user.role !== 'teacher')
  const onlineIds = new Set(online.map((user) => user.student_id))
  const students = [
    ...enrolled,
    ...online
      .filter((user) => !enrolled.some((item) => item.id === user.student_id))
      .map((user) => ({ id: user.student_id, nickname: user.nickname || tl("Studente"), is_frozen: false })),
  ].sort((a, b) => (Number(onlineIds.has(b.id)) - Number(onlineIds.has(a.id))) || a.nickname.localeCompare(b.nickname, 'it'))

  const fail = (error: any, fallback: string) =>
    toast({ variant: 'destructive', title: tl("Operazione non riuscita"), description: error?.response?.data?.detail || fallback })

  const toggleFrozen = async (student: SessionStudentSummary) => {
    if (busyId) return
    setBusyId(student.id)
    try {
      if (student.is_frozen) await teacherApi.unfreezeStudent(sessionId, student.id)
      else await teacherApi.freezeStudent(sessionId, student.id)
      queryClient.setQueryData<SessionStudentSummary[]>(queryKey, (current = []) =>
        current.map((item) => (item.id === student.id ? { ...item, is_frozen: !student.is_frozen } : item)))
      toast({ title: student.is_frozen ? tl("Studente sbloccato") : tl("Studente bloccato") })
    } catch (error) {
      fail(error, tl("Impossibile aggiornare lo studente."))
    } finally {
      setBusyId(null)
    }
  }

  const enterSubjectiveView = async (student: SessionStudentSummary) => {
    if (subjectiveId) return
    setSubjectiveId(student.id)
    const authStore = useAuthStore.getState()
    try {
      const response = await teacherApi.createStudentSubjectiveView(sessionId, student.id)
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
    } catch (error) {
      localStorage.removeItem('_subjective_mode')
      localStorage.removeItem('student_token')
      fail(error, tl("Non è stato possibile accedere all’interfaccia dello studente."))
    } finally {
      setSubjectiveId(null)
    }
  }

  const submitReset = async (student: SessionStudentSummary) => {
    const password = newPassword.trim()
    if (password.length < 8) {
      toast({ variant: 'destructive', title: tl("Password troppo corta"), description: tl("Servono almeno 8 caratteri.") })
      return
    }
    setBusyId(student.id)
    try {
      await teacherApi.resetStudentPassword(sessionId, student.id, password)
      setLastReset({ id: student.id, password })
      setResetId(null)
      setNewPassword('')
      toast({ title: tl("Password aggiornata"), description: tl("Comunica la nuova password a {0}.", student.nickname) })
    } catch (error) {
      fail(error, tl("Impossibile reimpostare la password."))
    } finally {
      setBusyId(null)
    }
  }

  if (isLoading && students.length === 0) {
    return <div className="flex justify-center py-8"><Loader2 className="h-4 w-4 animate-spin text-slate-400" /></div>
  }
  if (students.length === 0) {
    return <p className="px-3 py-8 text-center text-xs text-slate-400">{tl("Nessuno studente nella sessione")}</p>
  }

  return (
    <div className={`p-2 ${className}`}>
      {students.map((student) => {
        const isOnline = onlineIds.has(student.id)
        const resetting = resetId === student.id
        return (
          <div key={student.id} className="rounded-xl px-2.5 py-2 hover:bg-slate-50">
            <div className="flex items-center gap-2">
              <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${isOnline ? 'bg-emerald-500' : 'bg-slate-300'}`} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-slate-700">{student.nickname}</p>
                <p className="text-[10px] text-slate-400">
                  {student.is_frozen ? tl("Bloccato") : isOnline ? 'Online' : tl("Disconnesso")}
                </p>
              </div>
              <button
                type="button"
                onClick={() => window.dispatchEvent(new CustomEvent('openPrivateChat', { detail: { id: student.id, nickname: student.nickname } }))}
                className={`${iconBtn} hover:bg-sky-50 hover:text-sky-600`}
                title={tl("Chat diretta con {0}", student.nickname)}
                aria-label={tl("Chat diretta con {0}", student.nickname)}
              >
                <MessageSquare className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={() => void toggleFrozen(student)}
                disabled={busyId !== null}
                className={`${iconBtn} hover:bg-amber-50 hover:text-amber-600`}
                title={student.is_frozen ? tl("Sblocca {0}", student.nickname) : tl("Blocca {0}", student.nickname)}
                aria-label={student.is_frozen ? tl("Sblocca {0}", student.nickname) : tl("Blocca {0}", student.nickname)}
              >
                {busyId === student.id && !resetting
                  ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  : student.is_frozen ? <Sun className="h-3.5 w-3.5" /> : <Snowflake className="h-3.5 w-3.5" />}
              </button>
              <button
                type="button"
                onClick={() => { setResetId(resetting ? null : student.id); setNewPassword(''); setLastReset(null) }}
                className={`${iconBtn} ${resetting ? 'bg-violet-50 text-violet-600' : 'hover:bg-violet-50 hover:text-violet-600'}`}
                title={tl("Reimposta la password di {0}", student.nickname)}
                aria-label={tl("Reimposta la password di {0}", student.nickname)}
              >
                <KeyRound className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={() => void enterSubjectiveView(student)}
                disabled={!isOnline || subjectiveId !== null}
                className={`${iconBtn} bg-white text-slate-500 hover:bg-slate-100 hover:text-slate-900`}
                title={isOnline ? tl("Entra nella vista soggettiva di {0}", student.nickname) : tl("Vista soggettiva disponibile solo quando lo studente è online")}
                aria-label={tl("Entra nella vista soggettiva di {0}", student.nickname)}
              >
                {subjectiveId === student.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />}
              </button>
            </div>

            {resetting && (
              <form
                className="mt-2 flex items-center gap-1.5"
                onSubmit={(event) => { event.preventDefault(); void submitReset(student) }}
              >
                <input
                  autoFocus
                  type="text"
                  value={newPassword}
                  onChange={(event) => setNewPassword(event.target.value)}
                  placeholder={tl("Nuova password (min. 8 caratteri)")}
                  autoComplete="off"
                  className="ds-field h-8 min-w-0 flex-1 rounded-[var(--control-radius)] bg-[var(--ds-control)] px-2.5 text-xs text-[var(--text-primary)] outline-none"
                />
                <button type="button" onClick={() => setNewPassword(generatePassword())} className={`${iconBtn} hover:bg-slate-100 hover:text-slate-700`} title={tl("Genera password")} aria-label={tl("Genera password")}>
                  <RefreshCw className="h-3.5 w-3.5" />
                </button>
                <button type="submit" disabled={busyId !== null} className="h-8 shrink-0 rounded-full bg-violet-600 px-3 text-xs font-bold text-white disabled:opacity-50">
                  {busyId === student.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : tl("Imposta")}
                </button>
                <button type="button" onClick={() => setResetId(null)} className={`${iconBtn} hover:bg-slate-100`} aria-label={tl("Annulla")}>
                  <X className="h-3.5 w-3.5" />
                </button>
              </form>
            )}
            {lastReset?.id === student.id && (
              <p className="mt-2 rounded-lg bg-emerald-50 px-2.5 py-1.5 text-[11px] text-emerald-700">
                {tl("Nuova password")}: <span className="select-all font-mono font-bold">{lastReset.password}</span>
              </p>
            )}
          </div>
        )
      })}
    </div>
  )
}
