import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { X, UserPlus, Crown, Users, Trash2, Loader2, Mail, Clock } from 'lucide-react'
import { teacherApi } from '@/lib/api'
import { useToast } from '@/components/ui/use-toast'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

interface TeacherInfo {
  id: string
  email: string
  first_name: string | null
  last_name: string | null
  avatar_url: string | null
}

interface TeacherEntry {
  id: string | null
  teacher: TeacherInfo
  added_at: string
  added_by: TeacherInfo
  is_owner: boolean
  via_class?: boolean
}

interface PendingInvitation {
  id: string
  invitee: TeacherInfo
  created_at: string
}

interface TeachersData {
  teachers: TeacherEntry[]
  pending_invitations: PendingInvitation[]
  is_owner: boolean
}

interface TeachersManagementModalProps {
  type: 'class' | 'session'
  targetId: string
  targetName: string
  className?: string // For session, the parent class name
  onClose: () => void
}

export function TeachersManagementModal({
  type,
  targetId,
  targetName,
  className,
  onClose,
}: TeachersManagementModalProps) {
  const [email, setEmail] = useState('')
  const queryClient = useQueryClient()
  const { toast } = useToast()

  const queryKey = type === 'class'
    ? ['classTeachers', targetId]
    : ['sessionTeachers', targetId]

  const { data, isLoading } = useQuery<TeachersData>({
    queryKey,
    queryFn: async () => {
      const res = type === 'class'
        ? await teacherApi.getClassTeachers(targetId)
        : await teacherApi.getSessionTeachers(targetId)
      return res.data
    },
  })

  const inviteMutation = useMutation({
    mutationFn: (email: string) =>
      type === 'class'
        ? teacherApi.inviteTeacherToClass(targetId, email)
        : teacherApi.inviteTeacherToSession(targetId, email),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey })
      setEmail('')
      toast({ title: 'Invito inviato!' })
    },
    onError: (error: { response?: { data?: { detail?: string } } }) => {
      const detail = error.response?.data?.detail || 'Errore nell\'invio dell\'invito'
      toast({ variant: 'destructive', title: detail })
    },
  })

  const removeMutation = useMutation({
    mutationFn: (teacherId: string) =>
      type === 'class'
        ? teacherApi.removeTeacherFromClass(targetId, teacherId)
        : teacherApi.removeTeacherFromSession(targetId, teacherId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey })
      queryClient.invalidateQueries({ queryKey: ['classes'] })
      toast({ title: 'Docente rimosso' })
    },
    onError: (error: { response?: { data?: { detail?: string } } }) => {
      const detail = error.response?.data?.detail || 'Errore nella rimozione'
      toast({ variant: 'destructive', title: detail })
    },
  })

  const handleInvite = (e: React.FormEvent) => {
    e.preventDefault()
    if (email.trim()) {
      inviteMutation.mutate(email.trim())
    }
  }

  const formatName = (teacher: TeacherInfo) => {
    if (teacher.first_name || teacher.last_name) {
      return `${teacher.first_name || ''} ${teacher.last_name || ''}`.trim()
    }
    return teacher.email
  }

  const getInitials = (teacher: TeacherInfo) => {
    if (teacher.first_name && teacher.last_name) {
      return `${teacher.first_name[0]}${teacher.last_name[0]}`.toUpperCase()
    }
    return teacher.email[0].toUpperCase()
  }

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString('it-IT', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    })
  }

  return (
    <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl w-full max-w-lg shadow-2xl border border-slate-100 overflow-hidden animate-in zoom-in-95 duration-200">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 bg-gradient-to-r from-violet-50 to-purple-50">
          <div>
            <h2 className="text-lg font-bold text-slate-900">
              {type === 'class' ? 'Docenti della Classe' : 'Docenti della Sessione'}
            </h2>
            <p className="text-sm text-slate-600 mt-0.5">{targetName}</p>
            {className && (
              <p className="text-xs text-slate-400">{className}</p>
            )}
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-slate-100 rounded-lg transition-colors"
          >
            <X className="h-5 w-5 text-slate-500" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-6 max-h-[60vh] overflow-y-auto">
          {/* Invite Form */}
          <form onSubmit={handleInvite} className="space-y-3">
            <label className="block text-sm font-semibold text-slate-700">
              Invita un docente
            </label>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                <Input
                  type="email"
                  placeholder="Email del docente..."
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="pl-10"
                />
              </div>
              <Button
                type="submit"
                disabled={!email.trim() || inviteMutation.isPending}
                className="bg-violet-600 hover:bg-violet-700"
              >
                {inviteMutation.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <>
                    <UserPlus className="h-4 w-4 mr-2" />
                    Invita
                  </>
                )}
              </Button>
            </div>
            <p className="text-xs text-slate-500">
              Il docente deve essere registrato nella stessa organizzazione
            </p>
          </form>

          {/* Loading State */}
          {isLoading && (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-violet-500" />
            </div>
          )}

          {/* Teachers List */}
          {data && (
            <>
              <div>
                <h3 className="text-sm font-semibold text-slate-700 mb-3 flex items-center gap-2">
                  <Users className="h-4 w-4" />
                  Docenti attuali ({data.teachers.length})
                </h3>
                <div className="space-y-2">
                  {data.teachers.map((entry, idx) => (
                    <div
                      key={entry.teacher.id || idx}
                      className="flex items-center gap-3 p-3 bg-slate-50 rounded-xl"
                    >
                      {/* Avatar */}
                      {entry.teacher.avatar_url ? (
                        <img
                          src={entry.teacher.avatar_url}
                          alt=""
                          className="w-10 h-10 rounded-full object-cover"
                        />
                      ) : (
                        <div className="w-10 h-10 rounded-full bg-violet-100 flex items-center justify-center text-violet-600 font-semibold text-sm">
                          {getInitials(entry.teacher)}
                        </div>
                      )}

                      {/* Info */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-slate-900 truncate">
                            {formatName(entry.teacher)}
                          </span>
                          {entry.is_owner && (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-amber-100 text-amber-700 text-xs font-medium rounded-full">
                              <Crown className="h-3 w-3" />
                              Proprietario
                            </span>
                          )}
                          {entry.via_class && !entry.is_owner && (
                            <span className="px-2 py-0.5 bg-blue-100 text-blue-700 text-xs font-medium rounded-full">
                              Via classe
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-slate-500 truncate">
                          {entry.teacher.email}
                        </p>
                      </div>

                      {/* Remove Button (only if owner and not removing self/owner) */}
                      {data.is_owner && !entry.is_owner && !entry.via_class && entry.id && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-red-500 hover:text-red-600 hover:bg-red-50 h-8 w-8 p-0"
                          onClick={() => removeMutation.mutate(entry.teacher.id)}
                          disabled={removeMutation.isPending}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              {/* Pending Invitations */}
              {data.pending_invitations.length > 0 && (
                <div>
                  <h3 className="text-sm font-semibold text-slate-700 mb-3 flex items-center gap-2">
                    <Clock className="h-4 w-4" />
                    Inviti in attesa ({data.pending_invitations.length})
                  </h3>
                  <div className="space-y-2">
                    {data.pending_invitations.map((inv) => (
                      <div
                        key={inv.id}
                        className="flex items-center gap-3 p-3 bg-amber-50 rounded-xl border border-amber-100"
                      >
                        {/* Avatar */}
                        {inv.invitee.avatar_url ? (
                          <img
                            src={inv.invitee.avatar_url}
                            alt=""
                            className="w-10 h-10 rounded-full object-cover opacity-75"
                          />
                        ) : (
                          <div className="w-10 h-10 rounded-full bg-amber-100 flex items-center justify-center text-amber-600 font-semibold text-sm">
                            {getInitials(inv.invitee)}
                          </div>
                        )}

                        {/* Info */}
                        <div className="flex-1 min-w-0">
                          <span className="font-medium text-slate-700 truncate block">
                            {formatName(inv.invitee)}
                          </span>
                          <p className="text-xs text-slate-500 truncate">
                            {inv.invitee.email}
                          </p>
                          <p className="text-xs text-amber-600 mt-0.5">
                            Inviato il {formatDate(inv.created_at)}
                          </p>
                        </div>

                        <span className="px-2 py-1 bg-amber-200 text-amber-800 text-xs font-medium rounded-lg">
                          In attesa
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-slate-100 bg-slate-50/50">
          <Button variant="outline" onClick={onClose} className="w-full">
            Chiudi
          </Button>
        </div>
      </div>
    </div>
  )
}
