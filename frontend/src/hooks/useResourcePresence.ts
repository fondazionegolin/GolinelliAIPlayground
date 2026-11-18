import { useEffect, useMemo, useState } from 'react'
import { currentCollaboratorId, type Collaborator } from '@/lib/collaborators'

export type PresenceKind = 'board' | 'document' | 'model3d'

/** Who has this shared resource open right now (live socket, access-checked server side). `others` excludes me. */
export function useResourcePresence(kind: PresenceKind, id: string | null | undefined, role: 'teacher' | 'student') {
  const [viewers, setViewers] = useState<Collaborator[]>([])
  const [socket, setSocket] = useState<any>(() => (window as any).socket || null)
  const me = useMemo(() => currentCollaboratorId(role), [role])

  // The shared socket is created by the page shell and may appear (or be replaced) after this component mounts.
  useEffect(() => {
    const timer = window.setInterval(() => {
      const current = (window as any).socket || null
      setSocket((previous: any) => (previous === current ? previous : current))
    }, 1500)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    setViewers([])
    if (!socket || !id) return
    const toCollaborator = (u: any): Collaborator => ({
      id: String(u.id),
      name: String(u.name || (u.role === 'teacher' ? 'Docente' : 'Studente')),
      role: u.role === 'teacher' ? 'teacher' : 'student',
      avatarUrl: u.avatar_url || undefined,
    })
    const apply = (list: any[]) => setViewers((list || []).map(toCollaborator))
    const here = () => socket.emit('resource_presence', { kind, id, state: 'here' }, (response: { viewers?: any[] }) => {
      if (response?.viewers) apply(response.viewers)
    })
    const onPresence = (data: any) => { if (data?.kind === kind && String(data?.id) === String(id)) apply(data.viewers) }
    here()
    const heartbeat = window.setInterval(() => { if (socket.connected) here() }, 20000)
    socket.on('connect', here)
    socket.on('resource_presence', onPresence)
    return () => {
      window.clearInterval(heartbeat)
      socket.emit('resource_presence', { kind, id, state: 'left' })
      socket.off('connect', here)
      socket.off('resource_presence', onPresence)
    }
  }, [socket, kind, id])

  const others = useMemo(() => viewers.filter((viewer) => viewer.id !== me), [viewers, me])
  return { viewers, others, me }
}
