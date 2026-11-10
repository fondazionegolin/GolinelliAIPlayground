import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ChevronDown, ExternalLink, Loader2, Plus, Settings2, Video } from '@/components/icons'
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/design'
import { useToast } from '@/components/ui/use-toast'
import { voiceCallsApi, type VoiceCall } from '@/lib/api'
import { tl } from '@/i18n/tl'
import { CalendarEventDialog, type CalendarDraft } from '@/components/calendar/CalendarEventDialog'
import { VoiceCallLinkCard, formatCallWhen, openVoiceCall, voiceCallsQueryKey } from './VoiceCallLinkCard'

/**
 * Invite-link video calls of the session, under the class voice room in the chat sidebar.
 * Teachers create a link (bound to this session), manage it and schedule it in the calendar; students
 * see the calls they are invited to and join them in a new tab (videoconference page /call/:code).
 */
export function SessionVoiceCalls({ sessionId, isTeacher }: { sessionId: string; isTeacher: boolean }) {
  const { toast } = useToast()
  const queryClient = useQueryClient()
  const [expanded, setExpanded] = useState(false)
  const [managedId, setManagedId] = useState<string | null>(null)
  const [draft, setDraft] = useState<CalendarDraft | null>(null)

  const { data: calls = [] } = useQuery({
    queryKey: [...voiceCallsQueryKey, 'session', sessionId],
    queryFn: async () => (await voiceCallsApi.list(sessionId)).data,
    enabled: !!sessionId,
    refetchInterval: 30_000,
    staleTime: 10_000,
  })
  const managed = calls.find((call) => call.id === managedId) ?? null

  const create = useMutation({
    mutationFn: async () => (await voiceCallsApi.create({ title: tl("Videochiamata di classe"), session_id: sessionId })).data,
    onSuccess: (call) => {
      queryClient.setQueryData<VoiceCall[]>([...voiceCallsQueryKey, 'session', sessionId], (prev) => [call, ...(prev ?? [])])
      queryClient.invalidateQueries({ queryKey: voiceCallsQueryKey })
      setExpanded(true)
      setManagedId(call.id)
    },
    onError: (error: any) => toast({ title: tl("Impossibile creare la videochiamata"), description: error?.response?.data?.detail, variant: 'destructive' }),
  })

  const live = calls.filter((call) => call.live)
  if (!isTeacher && calls.length === 0) return null
  const visible = expanded ? calls : live

  const schedule = (call: VoiceCall) => {
    const start = new Date()
    start.setMinutes(0, 0, 0)
    start.setHours(start.getHours() + 1)
    setManagedId(null)
    setDraft({ start, end: new Date(start.getTime() + 60 * 60 * 1000), allDay: false, title: call.title, voiceCall: call })
  }

  return (
    <div className="mx-3 mt-2 rounded-2xl bg-[var(--ds-surface-muted)] px-3 py-2">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => setExpanded((value) => !value)}
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
          aria-expanded={expanded}
        >
          <Video className="h-3.5 w-3.5 flex-shrink-0 text-[var(--text-secondary)]" />
          <span className="truncate text-[11px] font-bold uppercase tracking-wide text-[var(--text-secondary)]">{tl("Videochiamate con link")}</span>
          {live.length > 0 && <span className="h-2 w-2 flex-shrink-0 animate-pulse rounded-full bg-emerald-500" aria-label={tl("In corso")} />}
          <span className="text-[10px] font-semibold text-[var(--text-secondary)]">{calls.length}</span>
          <ChevronDown className={`ml-auto h-3.5 w-3.5 flex-shrink-0 text-[var(--text-secondary)] transition-transform ${expanded ? 'rotate-180' : ''}`} />
        </button>
        {isTeacher && (
          <button
            type="button"
            onClick={() => create.mutate()}
            disabled={create.isPending}
            className="flex h-6 items-center gap-1 rounded-full bg-[var(--ds-surface)] px-2 text-[10px] font-bold text-[var(--text-primary)] hover:bg-[var(--ds-surface-raised)] disabled:opacity-60"
            title={tl("Crea un link di invito per una videochiamata con questa sessione")}
          >
            {create.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />}{tl("Link")}
          </button>
        )}
      </div>

      {visible.length > 0 && (
        <div className="mt-1.5 space-y-1">
          {visible.map((call) => (
            <div key={call.id} className="flex items-center gap-2 rounded-xl bg-[var(--ds-surface)] px-2 py-1.5">
              <span className={`h-2 w-2 flex-shrink-0 rounded-full ${call.live ? 'animate-pulse bg-emerald-500' : 'bg-slate-300'}`} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-xs font-semibold text-[var(--text-primary)]">{call.title}</div>
                <div className="truncate font-mono text-[10px] text-[var(--text-secondary)]">
                  {call.live ? tl("In corso") : call.next_event ? formatCallWhen(call.next_event.starts_at) : call.code}
                </div>
              </div>
              {call.is_owner && (
                <button type="button" onClick={() => setManagedId(call.id)} className="rounded-full p-1 text-[var(--text-secondary)] hover:bg-[var(--ds-surface-muted)]" title={tl("Gestisci link")} aria-label={tl("Gestisci link")}>
                  <Settings2 className="h-3.5 w-3.5" />
                </button>
              )}
              <button
                type="button"
                onClick={() => openVoiceCall(call.code)}
                className={`flex h-6 items-center gap-1 rounded-full px-2 text-[10px] font-bold ${call.live ? 'bg-emerald-600 text-white hover:bg-emerald-700' : 'bg-[var(--ds-surface-muted)] text-[var(--text-primary)] hover:brightness-95'}`}
              >
                {call.live ? tl("Entra") : tl("Apri")}<ExternalLink className="h-3 w-3 opacity-70" />
              </button>
            </div>
          ))}
        </div>
      )}
      {expanded && calls.length === 0 && (
        <p className="mt-1.5 text-[11px] text-[var(--text-secondary)]">{tl("Crea un link per invitare la classe a una videochiamata, anche programmata in calendario.")}</p>
      )}

      <Dialog open={!!managed} onOpenChange={(open) => { if (!open) setManagedId(null) }}>
        <DialogContent size="sm">
          <DialogHeader>
            <DialogTitle className="text-xl">{managed?.title}</DialogTitle>
            <DialogDescription>{tl("Condividi il link o il codice: gli studenti della sessione entrano dalla pagina della videochiamata.")}</DialogDescription>
          </DialogHeader>
          <DialogBody>
            {managed && (
              <VoiceCallLinkCard call={managed} onSchedule={schedule} onDeleted={() => setManagedId(null)} />
            )}
          </DialogBody>
        </DialogContent>
      </Dialog>

      {isTeacher && (
        <CalendarEventDialog
          open={!!draft}
          onOpenChange={(open) => { if (!open) setDraft(null) }}
          draft={draft}
          canCreate
          defaultSessionId={sessionId}
        />
      )}
    </div>
  )
}
