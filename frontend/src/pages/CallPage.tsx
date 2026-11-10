import { useEffect, useState, type FormEvent } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { io, type Socket } from 'socket.io-client'
import { ArrowLeft, Loader2, LogIn, Plus, UserPlus, Video } from '@/components/icons'
import { Button, Card, Dialog, DialogBody, DialogContent, DialogDescription, DialogHeader, DialogTitle, Input } from '@/design'
import { useToast } from '@/components/ui/use-toast'
import { VoiceRoomPanel } from '@/components/VoiceRoomPanel'
import ChatSidebar from '@/components/ChatSidebar'
import { CalendarEventDialog, type CalendarDraft } from '@/components/calendar/CalendarEventDialog'
import { VoiceCallCodeTag, VoiceCallLinkCard, formatCallWhen, voiceCallsQueryKey } from '@/components/voice-calls/VoiceCallLinkCard'
import { voiceCallsApi, type VoiceCall } from '@/lib/api'
import { useAuthStore } from '@/stores/auth'
import { tl } from '@/i18n/tl'

const CODE_RE = /^[a-z]{3}-[a-z]{4}-[a-z]{3}$/

function normalizeCode(raw: string): string | null {
  const text = raw.trim().toLowerCase().replace(/\/+$/, '')
  const letters = (text.includes('/') ? text.slice(text.lastIndexOf('/') + 1) : text).replace(/[^a-z]/g, '')
  if (letters.length !== 10) return null
  const code = `${letters.slice(0, 3)}-${letters.slice(3, 7)}-${letters.slice(7)}`
  return CODE_RE.test(code) ? code : null
}

function useCallIdentity() {
  const { user, accessToken, studentSession } = useAuthStore()
  const studentToken = typeof window !== 'undefined' ? localStorage.getItem('student_token') : null
  if (user && accessToken) return { kind: 'teacher' as const, token: accessToken, userId: user.id, name: tl("Docente"), sessionId: null, home: '/teacher' }
  if (studentSession && studentToken) return { kind: 'student' as const, token: studentToken, userId: studentSession.student_id, name: studentSession.nickname, sessionId: studentSession.session_id, home: '/student' }
  return null
}

function PageShell({ children, onBack, title, subtitle, right }: {
  children: React.ReactNode
  onBack?: () => void
  title: string
  subtitle?: string
  right?: React.ReactNode
}) {
  return (
    <div className="min-h-[100dvh] bg-[var(--ds-canvas)] text-[var(--text-primary)]">
      <header className="mx-auto flex max-w-6xl flex-wrap items-center gap-3 px-4 py-4 sm:px-6">
        {onBack && (
          <Button type="button" tone="neutral" surface="ghost" density="icon" aria-label={tl("Indietro")} onClick={onBack}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
        )}
        <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-2xl bg-[var(--ds-surface-raised)] shadow-[var(--shadow-sm)]">
          <Video className="h-5 w-5 text-[var(--text-secondary)]" />
        </div>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-lg font-bold">{title}</h1>
          {subtitle && <p className="truncate text-xs text-[var(--text-secondary)]">{subtitle}</p>}
        </div>
        {right}
      </header>
      <main className="mx-auto max-w-6xl px-4 pb-10 sm:px-6">{children}</main>
    </div>
  )
}

/** `/call` without a code: join by code, and (teachers) the list of your calls with their links. */
function CallLobby() {
  const navigate = useNavigate()
  const identity = useCallIdentity()
  const queryClient = useQueryClient()
  const { toast } = useToast()
  const [code, setCode] = useState('')
  const [title, setTitle] = useState('')
  const [draft, setDraft] = useState<CalendarDraft | null>(null)
  const isTeacher = identity?.kind === 'teacher'

  const { data: calls = [], isLoading } = useQuery({
    queryKey: [...voiceCallsQueryKey, 'mine'],
    queryFn: async () => (await voiceCallsApi.list()).data,
    enabled: isTeacher,
  })
  const create = useMutation({
    mutationFn: async () => (await voiceCallsApi.create({ title: title.trim() || tl("Videochiamata") })).data,
    onSuccess: () => {
      setTitle('')
      queryClient.invalidateQueries({ queryKey: voiceCallsQueryKey })
    },
    onError: (error: any) => toast({ title: tl("Impossibile creare la videochiamata"), description: error?.response?.data?.detail, variant: 'destructive' }),
  })

  const submit = (e: FormEvent) => {
    e.preventDefault()
    const normalized = normalizeCode(code)
    if (!normalized) {
      toast({ title: tl("Codice non valido"), description: tl("Il codice ha la forma abc-defg-hij."), variant: 'destructive' })
      return
    }
    navigate(`/call/${normalized}`)
  }

  const schedule = (call: VoiceCall) => {
    const start = new Date()
    start.setMinutes(0, 0, 0)
    start.setHours(start.getHours() + 1)
    setDraft({ start, end: new Date(start.getTime() + 60 * 60 * 1000), allDay: false, title: call.title, voiceCall: call })
  }

  return (
    <PageShell
      title={tl("Videochiamate")}
      subtitle={tl("Entra con un codice o gestisci i link di invito")}
      onBack={identity ? () => navigate(identity.home) : undefined}
    >
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
        <Card className="h-fit p-5">
          <form className="grid gap-3" onSubmit={submit}>
            <label className="grid gap-1 text-xs font-semibold text-[var(--text-secondary)]">
              {tl("Codice della videochiamata")}
              <Input value={code} onChange={(e) => setCode(e.target.value)} placeholder="abc-defg-hij" autoFocus className="font-mono" />
            </label>
            <Button type="submit" tone="accent" surface="solid" disabled={!code.trim()}>
              <LogIn className="mr-1.5 h-4 w-4" />{tl("Partecipa")}
            </Button>
          </form>
        </Card>

        {isTeacher && (
          <div className="grid gap-3">
            <Card className="p-5">
              <form className="flex flex-wrap gap-2" onSubmit={(e) => { e.preventDefault(); create.mutate() }}>
                <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={tl("Titolo della nuova videochiamata")} maxLength={200} className="min-w-0 flex-1" />
                <Button type="submit" tone="accent" surface="solid" disabled={create.isPending}>
                  {create.isPending ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Plus className="mr-1.5 h-4 w-4" />}{tl("Nuovo link")}
                </Button>
              </form>
              <p className="mt-2 text-xs text-[var(--text-secondary)]">
                {tl("Per invitare una classe crea il link dalla chat della sessione o aggiungilo a un evento del calendario con la classe tra gli invitati.")}
              </p>
            </Card>
            {isLoading && <Loader2 className="mx-auto h-5 w-5 animate-spin text-[var(--text-secondary)]" />}
            {calls.map((call) => (
              <Card key={call.id} className="p-5">
                <div className="mb-3 flex items-center gap-2">
                  <span className={`h-2.5 w-2.5 rounded-full ${call.live ? 'animate-pulse bg-emerald-500' : 'bg-slate-300'}`} />
                  <h2 className="min-w-0 flex-1 truncate text-sm font-bold">{call.title}</h2>
                  <span className="truncate text-xs text-[var(--text-secondary)]">{call.session_label || call.class_label || (call.is_owner ? '' : call.owner_name)}</span>
                </div>
                <VoiceCallLinkCard call={call} onSchedule={call.is_owner ? schedule : undefined} />
              </Card>
            ))}
          </div>
        )}
      </div>
      {isTeacher && (
        <CalendarEventDialog open={!!draft} onOpenChange={(open) => { if (!open) setDraft(null) }} draft={draft} canCreate />
      )}
    </PageShell>
  )
}

type JoinState =
  | { status: 'connecting' }
  | { status: 'joined'; role: 'moderator' | 'participant'; active: boolean }
  | { status: 'error'; message: string }
  | { status: 'closed'; message: string }

/** `/call/:code`: full-page videoconference on a call's own room. */
function CallRoom({ code }: { code: string }) {
  const navigate = useNavigate()
  const identity = useCallIdentity()
  const queryClient = useQueryClient()
  const [socket, setSocket] = useState<Socket | null>(null)
  const [join, setJoin] = useState<JoinState>({ status: 'connecting' })
  const [draft, setDraft] = useState<CalendarDraft | null>(null)
  const [showInvite, setShowInvite] = useState(false)

  const { data: call, error, isLoading } = useQuery({
    queryKey: [...voiceCallsQueryKey, 'code', code],
    queryFn: async () => (await voiceCallsApi.byCode(code)).data,
    enabled: !!identity,
    retry: false,
    refetchInterval: 60_000,
  })
  const callId = call?.id

  useEffect(() => {
    if (!identity || !callId) return
    const sock = io(window.location.origin, {
      path: '/socket.io',
      auth: { token: identity.token },
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionDelay: 2000,
    })
    const doJoin = () => {
      sock.emit('voice_call_join', { call_id: callId }, (response: { error?: string; role?: 'moderator' | 'participant'; active?: boolean }) => {
        if (response?.error || !response?.role) {
          setJoin({ status: 'error', message: response?.error === 'Forbidden' ? tl("Non hai accesso a questa videochiamata.") : response?.error || tl("Impossibile entrare nella videochiamata.") })
          return
        }
        setJoin({ status: 'joined', role: response.role, active: !!response.active })
      })
    }
    sock.on('connect', doJoin)
    sock.on('connect_error', () => setJoin((prev) => prev.status === 'joined' ? prev : { status: 'error', message: tl("Connessione al server non riuscita. Riprovo…") }))
    sock.on('voice_room_state', (state: { call_id?: string | null; active?: boolean }) => {
      if (state.call_id !== callId) return
      setJoin((prev) => prev.status === 'joined' ? { ...prev, active: !!state.active } : prev)
    })
    sock.on('voice_call_closed', (payload: { call_id: string; reason: string }) => {
      if (payload.call_id !== callId) return
      if (payload.reason === 'deleted') {
        setJoin({ status: 'closed', message: tl("La videochiamata è stata eliminata da chi l'ha creata.") })
      } else {
        // Link disabled: the owner stays, everybody else is re-checked on the next join.
        queryClient.invalidateQueries({ queryKey: [...voiceCallsQueryKey, 'code', code] })
        doJoin()
      }
    })
    setSocket(sock)
    return () => {
      sock.emit('voice_call_leave', { call_id: callId })
      sock.disconnect()
      setSocket(null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [identity?.token, callId])

  useEffect(() => {
    if (call) document.title = `${call.title} · Golinelli.ai`
  }, [call])

  if (!identity) {
    return (
      <PageShell title={tl("Videochiamata")} subtitle={code}>
        <Card className="mx-auto max-w-md p-6 text-center">
          <Video className="mx-auto h-8 w-8 text-[var(--text-secondary)]" />
          <h2 className="mt-3 text-lg font-bold">{tl("Accedi per partecipare")}</h2>
          <p className="mt-1 text-sm text-[var(--text-secondary)]">
            {tl("Gli studenti entrano nella loro sessione con il codice della classe, i docenti con il proprio account. Poi riapri questo link.")}
          </p>
          <div className="mt-4 flex flex-wrap justify-center gap-2">
            <Button tone="neutral" surface="soft" onClick={() => navigate('/join')}>{tl("Sono uno studente")}</Button>
            <Button tone="accent" surface="solid" onClick={() => navigate('/login')}>{tl("Sono un docente")}</Button>
          </div>
        </Card>
      </PageShell>
    )
  }

  const back = () => navigate(identity.home)
  const errorMessage = (error as any)?.response?.data?.detail || (error ? tl("Videochiamata non trovata.") : null)
  if (isLoading || errorMessage || !call) {
    return (
      <PageShell title={tl("Videochiamata")} subtitle={code} onBack={back}>
        <Card className="mx-auto max-w-md p-6 text-center">
          {isLoading ? <Loader2 className="mx-auto h-6 w-6 animate-spin text-[var(--text-secondary)]" /> : (
            <>
              <h2 className="text-lg font-bold">{tl("Impossibile entrare")}</h2>
              <p className="mt-1 text-sm text-[var(--text-secondary)]">{errorMessage}</p>
              <Button className="mt-4" tone="neutral" surface="soft" onClick={() => navigate('/call')}>{tl("Inserisci un altro codice")}</Button>
            </>
          )}
        </Card>
      </PageShell>
    )
  }

  const isModerator = join.status === 'joined' && join.role === 'moderator'
  // Right column: the class chat of the call's session (students: always their own session's chat).
  const chatSessionId = identity.kind === 'student' ? identity.sessionId : call.session_id

  return (
    <div className="flex h-[100dvh] flex-col gap-3 overflow-hidden bg-[var(--ds-canvas)] p-3 text-[var(--text-primary)]">
      <header className="flex flex-shrink-0 items-center gap-3 px-1">
        <Button type="button" tone="neutral" surface="ghost" density="icon" aria-label={tl("Indietro")} onClick={back}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <h1 className="min-w-0 flex-1 truncate text-base font-bold">{call.title}</h1>
        <VoiceCallCodeTag code={call.code} />
        <Button type="button" tone="neutral" surface="soft" density="compact" onClick={() => setShowInvite(true)}>
          <UserPlus className="mr-1.5 h-4 w-4" />{tl("Invita")}
        </Button>
      </header>

      {join.status === 'joined' && socket ? (
        <VoiceRoomPanel
          callId={call.id}
          canModerate={isModerator}
          variant="page"
          userType={identity.kind}
          currentUserId={identity.userId}
          socket={socket}
          onLeave={back}
          waitingHint={call.next_event ? tl("Programmata per {0}. Resta su questa pagina: entri appena inizia.", formatCallWhen(call.next_event.starts_at)) : undefined}
          chatPanel={chatSessionId ? (
            <ChatSidebar
              key={chatSessionId}
              sessionId={chatSessionId}
              userType={identity.kind}
              currentUserId={identity.userId}
              currentUserName={identity.name}
              embedded
              className="h-full w-full !bg-transparent !shadow-none"
            />
          ) : undefined}
        />
      ) : (
        <div className="flex flex-1 items-center justify-center rounded-3xl bg-slate-950 p-6 text-center text-white">
          {join.status === 'connecting' ? (
            <span className="flex items-center gap-2 text-sm text-white/70"><Loader2 className="h-4 w-4 animate-spin" />{tl("Connessione alla videochiamata…")}</span>
          ) : (
            <div className="grid gap-3">
              <p className="text-sm font-semibold">{join.status === 'error' || join.status === 'closed' ? join.message : ''}</p>
              <Button tone="neutral" surface="soft" onClick={back}>{tl("Torna alla piattaforma")}</Button>
            </div>
          )}
        </div>
      )}

      <Dialog open={showInvite} onOpenChange={setShowInvite}>
        <DialogContent size="sm">
          <DialogHeader>
            <DialogTitle className="text-xl">{tl("Invita alla videochiamata")}</DialogTitle>
            <DialogDescription>
              {[call.session_label || call.class_label, call.next_event ? formatCallWhen(call.next_event.starts_at) : null].filter(Boolean).join(' · ') || tl("Condividi il link o il codice.")}
            </DialogDescription>
          </DialogHeader>
          <DialogBody>
            <VoiceCallLinkCard
              call={call}
              hideJoin
              onChanged={(next) => queryClient.setQueryData([...voiceCallsQueryKey, 'code', code], next)}
              onDeleted={() => navigate('/call')}
              onSchedule={call.is_owner ? (c) => {
                const start = new Date()
                start.setMinutes(0, 0, 0)
                start.setHours(start.getHours() + 1)
                setShowInvite(false)
                setDraft({ start, end: new Date(start.getTime() + 60 * 60 * 1000), allDay: false, title: c.title, voiceCall: c })
              } : undefined}
            />
          </DialogBody>
        </DialogContent>
      </Dialog>
      {call.is_owner && (
        <CalendarEventDialog open={!!draft} onOpenChange={(open) => { if (!open) setDraft(null) }} draft={draft} canCreate defaultSessionId={call.session_id ?? undefined} />
      )}
    </div>
  )
}

export default function CallPage() {
  const { code: raw } = useParams<{ code?: string }>()
  const navigate = useNavigate()
  const code = raw ? normalizeCode(raw) : null

  useEffect(() => {
    // Canonicalize "/call/KQFMXTAVBE" → "/call/kqf-mxta-vbe" so the link people copy is clean.
    if (raw && code && raw !== code) navigate(`/call/${code}`, { replace: true })
  }, [raw, code, navigate])

  if (!raw) return <CallLobby />
  if (!code) {
    return (
      <PageShell title={tl("Videochiamata")} subtitle={raw} onBack={() => navigate('/call')}>
        <Card className="mx-auto max-w-md p-6 text-center">
          <h2 className="text-lg font-bold">{tl("Codice non valido")}</h2>
          <p className="mt-1 text-sm text-[var(--text-secondary)]">{tl("Il codice ha la forma abc-defg-hij.")}</p>
          <Button className="mt-4" tone="neutral" surface="soft" onClick={() => navigate('/call')}>{tl("Inserisci un codice")}</Button>
        </Card>
      </PageShell>
    )
  }
  return <CallRoom code={code} />
}
