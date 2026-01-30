import { useState, useRef, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Bell, Check, X, Users, MonitorPlay, Loader2 } from 'lucide-react'
import { teacherApi } from '@/lib/api'
import { useToast } from '@/components/ui/use-toast'
import { Button } from '@/components/ui/button'

interface TeacherInfo {
  id: string
  email: string
  first_name: string | null
  last_name: string | null
  avatar_url: string | null
}

interface ClassInvitation {
  id: string
  class_id: string
  class_name: string
  inviter: TeacherInfo
  status: string
  created_at: string
}

interface SessionInvitation {
  id: string
  session_id: string
  session_title: string
  class_name: string
  inviter: TeacherInfo
  status: string
  created_at: string
}

interface InvitationsData {
  class_invitations: ClassInvitation[]
  session_invitations: SessionInvitation[]
  total_pending: number
}

export function InvitationsPanel() {
  const [isOpen, setIsOpen] = useState(false)
  const panelRef = useRef<HTMLDivElement>(null)
  const queryClient = useQueryClient()
  const { toast } = useToast()

  const { data: invitations, isLoading } = useQuery<InvitationsData>({
    queryKey: ['invitations'],
    queryFn: async () => {
      const res = await teacherApi.getInvitations()
      return res.data
    },
    refetchInterval: 30000, // Poll every 30 seconds
  })

  const respondToClassMutation = useMutation({
    mutationFn: ({ id, accept }: { id: string; accept: boolean }) =>
      teacherApi.respondToClassInvitation(id, accept),
    onSuccess: (_, { accept }) => {
      queryClient.invalidateQueries({ queryKey: ['invitations'] })
      queryClient.invalidateQueries({ queryKey: ['classes'] })
      toast({
        title: accept ? 'Invito accettato' : 'Invito rifiutato',
        description: accept ? 'Ora hai accesso alla classe' : 'Hai rifiutato l\'invito',
      })
    },
    onError: () => {
      toast({ variant: 'destructive', title: 'Errore nella risposta all\'invito' })
    },
  })

  const respondToSessionMutation = useMutation({
    mutationFn: ({ id, accept }: { id: string; accept: boolean }) =>
      teacherApi.respondToSessionInvitation(id, accept),
    onSuccess: (_, { accept }) => {
      queryClient.invalidateQueries({ queryKey: ['invitations'] })
      toast({
        title: accept ? 'Invito accettato' : 'Invito rifiutato',
        description: accept ? 'Ora hai accesso alla sessione' : 'Hai rifiutato l\'invito',
      })
    },
    onError: () => {
      toast({ variant: 'destructive', title: 'Errore nella risposta all\'invito' })
    },
  })

  // Close panel when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(event.target as Node)) {
        setIsOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const pendingCount = invitations?.total_pending || 0
  const isPending = respondToClassMutation.isPending || respondToSessionMutation.isPending

  const formatInviterName = (inviter: TeacherInfo) => {
    if (inviter.first_name || inviter.last_name) {
      return `${inviter.first_name || ''} ${inviter.last_name || ''}`.trim()
    }
    return inviter.email
  }

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr)
    const now = new Date()
    const diffMs = now.getTime() - date.getTime()
    const diffMins = Math.floor(diffMs / 60000)
    const diffHours = Math.floor(diffMins / 60)
    const diffDays = Math.floor(diffHours / 24)

    if (diffMins < 60) return `${diffMins} min fa`
    if (diffHours < 24) return `${diffHours} ore fa`
    if (diffDays < 7) return `${diffDays} giorni fa`
    return date.toLocaleDateString('it-IT')
  }

  return (
    <div className="relative" ref={panelRef}>
      {/* Bell Button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="relative p-2 rounded-lg hover:bg-cyan-100 transition-colors"
        aria-label="Notifiche inviti"
      >
        <Bell className="h-5 w-5 text-slate-600" />
        {pendingCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 flex items-center justify-center bg-red-500 text-white text-xs font-bold rounded-full animate-pulse">
            {pendingCount > 9 ? '9+' : pendingCount}
          </span>
        )}
      </button>

      {/* Dropdown Panel */}
      {isOpen && (
        <div className="absolute right-0 mt-2 w-96 bg-white rounded-2xl shadow-2xl border border-slate-100 overflow-hidden animate-in fade-in zoom-in-95 duration-150 origin-top-right z-50">
          {/* Header */}
          <div className="px-5 py-4 border-b border-slate-100 bg-gradient-to-r from-violet-50 to-purple-50">
            <h3 className="font-bold text-slate-800">Inviti Ricevuti</h3>
            <p className="text-xs text-slate-500 mt-0.5">
              {pendingCount > 0 ? `${pendingCount} inviti in attesa` : 'Nessun invito in attesa'}
            </p>
          </div>

          {/* Content */}
          <div className="max-h-96 overflow-y-auto">
            {isLoading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-6 w-6 animate-spin text-violet-500" />
              </div>
            ) : pendingCount === 0 ? (
              <div className="text-center py-12 px-4">
                <div className="w-16 h-16 rounded-full bg-slate-100 flex items-center justify-center mx-auto mb-4">
                  <Bell className="h-8 w-8 text-slate-400" />
                </div>
                <p className="text-slate-500 text-sm">Nessun invito in attesa</p>
                <p className="text-slate-400 text-xs mt-1">
                  Qui vedrai gli inviti a classi e sessioni
                </p>
              </div>
            ) : (
              <div className="divide-y divide-slate-100">
                {/* Class Invitations */}
                {invitations?.class_invitations.map((inv) => (
                  <div key={inv.id} className="p-4 hover:bg-slate-50 transition-colors">
                    <div className="flex items-start gap-3">
                      <div className="p-2 bg-violet-100 rounded-lg flex-shrink-0">
                        <Users className="h-5 w-5 text-violet-600" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-slate-900">
                          Invito alla classe
                        </p>
                        <p className="text-sm font-semibold text-violet-700 truncate">
                          {inv.class_name}
                        </p>
                        <p className="text-xs text-slate-500 mt-1">
                          Da: {formatInviterName(inv.inviter)} - {formatDate(inv.created_at)}
                        </p>
                      </div>
                    </div>
                    <div className="flex gap-2 mt-3 ml-11">
                      <Button
                        size="sm"
                        className="flex-1 bg-violet-600 hover:bg-violet-700 h-8"
                        onClick={() => respondToClassMutation.mutate({ id: inv.id, accept: true })}
                        disabled={isPending}
                      >
                        <Check className="h-4 w-4 mr-1" />
                        Accetta
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="flex-1 h-8 text-slate-600"
                        onClick={() => respondToClassMutation.mutate({ id: inv.id, accept: false })}
                        disabled={isPending}
                      >
                        <X className="h-4 w-4 mr-1" />
                        Rifiuta
                      </Button>
                    </div>
                  </div>
                ))}

                {/* Session Invitations */}
                {invitations?.session_invitations.map((inv) => (
                  <div key={inv.id} className="p-4 hover:bg-slate-50 transition-colors">
                    <div className="flex items-start gap-3">
                      <div className="p-2 bg-cyan-100 rounded-lg flex-shrink-0">
                        <MonitorPlay className="h-5 w-5 text-cyan-600" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-slate-900">
                          Invito alla sessione
                        </p>
                        <p className="text-sm font-semibold text-cyan-700 truncate">
                          {inv.session_title}
                        </p>
                        <p className="text-xs text-slate-400 truncate">
                          {inv.class_name}
                        </p>
                        <p className="text-xs text-slate-500 mt-1">
                          Da: {formatInviterName(inv.inviter)} - {formatDate(inv.created_at)}
                        </p>
                      </div>
                    </div>
                    <div className="flex gap-2 mt-3 ml-11">
                      <Button
                        size="sm"
                        className="flex-1 bg-cyan-600 hover:bg-cyan-700 h-8"
                        onClick={() => respondToSessionMutation.mutate({ id: inv.id, accept: true })}
                        disabled={isPending}
                      >
                        <Check className="h-4 w-4 mr-1" />
                        Accetta
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="flex-1 h-8 text-slate-600"
                        onClick={() => respondToSessionMutation.mutate({ id: inv.id, accept: false })}
                        disabled={isPending}
                      >
                        <X className="h-4 w-4 mr-1" />
                        Rifiuta
                      </Button>
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
