import { useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, Loader2, Plus, Settings, Users, X } from '@/components/icons'
import { teacherApi } from '@/lib/api'
import { PLATFORM_REALTIME_EVENT, type PlatformRealtimeDetail } from '@/lib/realtimeEvents'
import { tl } from '@/i18n/tl'

export interface MobileSessionOption {
  id: string
  name: string
  className: string
  studentCount: number
  joinCode?: string
}

const QUERY_KEY = ['teacher-active-sessions']

async function loadActiveSessions(): Promise<MobileSessionOption[]> {
  const classes = (await teacherApi.getClasses()).data as { id: string; name: string }[]
  const perClass = await Promise.all(classes.map(async (cls) => {
    try {
      const sessions = (await teacherApi.getSessions(cls.id)).data as { id: string; title: string; status: string; student_count?: number; join_code?: string }[]
      return sessions
        .filter((session) => session.status === 'active')
        .map((session) => ({ id: session.id, name: session.title, className: cls.name, studentCount: session.student_count || 0, joinCode: session.join_code }))
    } catch {
      return []
    }
  }))
  return perClass.flat()
}

/**
 * Phone: the list of sessions to work on, as a bottom sheet. Opens straight from the header's session slot, so a
 * teacher with no session selected picks one right there instead of hunting through the menu.
 */
export function MobileSessionsSheet({ open, currentSessionId, onClose, onSelect, onManage, onCreate }: {
  open: boolean
  currentSessionId?: string | null
  onClose: () => void
  onSelect: (session: MobileSessionOption) => void
  onManage: (session: MobileSessionOption) => void
  onCreate: () => void
}) {
  const queryClient = useQueryClient()
  const { data: sessions = [], isLoading, isError, refetch } = useQuery({ queryKey: QUERY_KEY, queryFn: loadActiveSessions, enabled: open, staleTime: 15_000 })

  useEffect(() => {
    const onRealtime = (event: Event) => {
      const detail = (event as CustomEvent<PlatformRealtimeDetail>).detail
      if (detail?.type === 'platform_change' && (detail.payload.entity === 'class' || detail.payload.entity === 'session')) {
        void queryClient.invalidateQueries({ queryKey: QUERY_KEY })
      }
    }
    window.addEventListener(PLATFORM_REALTIME_EVENT, onRealtime)
    return () => window.removeEventListener(PLATFORM_REALTIME_EVENT, onRealtime)
  }, [queryClient])

  useEffect(() => {
    if (!open) return
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => { document.body.style.overflow = previous; window.removeEventListener('keydown', onKey) }
  }, [open, onClose])

  if (!open) return null
  return (
    <div className="fixed inset-0 z-[80]" role="dialog" aria-modal="true" aria-label={tl("Sessioni disponibili")}>
      <button type="button" className="absolute inset-0 bg-slate-950/45" onClick={onClose} aria-label={tl("Chiudi")} />
      <div className="absolute inset-x-0 bottom-0 flex max-h-[82dvh] flex-col rounded-t-[1.75rem] bg-white shadow-2xl animate-in slide-in-from-bottom duration-200">
        <div className="mx-auto mt-2 h-1 w-10 shrink-0 rounded-full bg-slate-300" aria-hidden="true" />
        <div className="flex items-start gap-3 px-5 pb-3 pt-3">
          <div className="min-w-0 flex-1">
            <h2 className="text-lg font-black text-slate-950">{tl("Sessioni disponibili")}</h2>
            <p className="text-xs text-slate-500">{tl("Scegli la sessione su cui lavorare.")}</p>
          </div>
          <button type="button" onClick={onClose} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-slate-700" aria-label={tl("Chiudi")}><X className="h-5 w-5" /></button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-2">
          {isLoading ? (
            <div className="flex justify-center py-10"><Loader2 className="h-6 w-6 animate-spin text-slate-400" /></div>
          ) : isError ? (
            <div className="py-8 text-center">
              <p className="text-sm text-slate-500">{tl("Non riesco a caricare le sessioni.")}</p>
              <button type="button" onClick={() => void refetch()} className="mt-3 rounded-full bg-slate-100 px-4 py-2 text-sm font-bold text-slate-700">{tl("Riprova")}</button>
            </div>
          ) : sessions.length === 0 ? (
            <div className="px-4 py-10 text-center">
              <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-slate-100"><Users className="h-7 w-7 text-slate-400" /></div>
              <p className="text-sm font-bold text-slate-700">{tl("Nessuna sessione attiva")}</p>
              <p className="mt-1 text-xs text-slate-400">{tl("Avvia una sessione da una delle tue classi per iniziare.")}</p>
            </div>
          ) : (
            <ul className="space-y-1.5">
              {sessions.map((session) => {
                const selected = session.id === currentSessionId
                return (
                  <li key={session.id} className={`flex items-stretch overflow-hidden rounded-2xl ${selected ? 'ds-selected' : 'bg-slate-50 active:bg-slate-100'}`}>
                    <button type="button" onClick={() => onSelect(session)} className="flex min-w-0 flex-1 items-center gap-3 px-4 py-3.5 text-left">
                      <span className={`h-3 w-3 shrink-0 rounded-full ${selected ? 'bg-green-500 shadow-sm shadow-green-300' : 'bg-slate-300'}`} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[15px] font-bold text-slate-900">{session.name}</span>
                        <span className="mt-0.5 flex min-w-0 items-center gap-2 text-xs text-slate-500">
                          <span className="truncate">{session.className}</span>
                          {session.studentCount > 0 && <span className="shrink-0">· {session.studentCount} {tl("studenti")}</span>}
                          {session.joinCode && <span className="shrink-0 rounded-md bg-white/70 px-1.5 py-0.5 font-mono text-[10px] font-black tracking-widest text-slate-600">{session.joinCode}</span>}
                        </span>
                      </span>
                      {selected && <Check className="h-4 w-4 shrink-0 text-slate-700" />}
                    </button>
                    <button type="button" onClick={() => onManage(session)} className="flex w-12 shrink-0 items-center justify-center text-slate-400 active:bg-white/70" aria-label={`${tl("Configura la sessione")}: ${session.name}`}>
                      <Settings className="h-4 w-4" />
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </div>

        <div className="shrink-0 border-t border-slate-100 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          <button type="button" onClick={onCreate} className="flex w-full items-center justify-center gap-2 rounded-2xl bg-slate-100 px-4 py-3.5 text-sm font-black text-slate-700 active:bg-slate-200">
            <Plus className="h-4 w-4" />{tl("Tutte le sessioni e le classi")}
          </button>
        </div>
      </div>
    </div>
  )
}
