/** Shared by every "who is here" indicator (canvas, boards, documents, 3D): same colour per person everywhere. */
export type Collaborator = { id: string; name: string; role: 'teacher' | 'student'; avatarUrl?: string }

const COLLABORATOR_COLORS = ['#2563eb', '#7c3aed', '#db2777', '#ea580c', '#059669', '#0891b2', '#4f46e5', '#be123c']

export function collaboratorColor(userId: string): string {
  let hash = 0
  for (let index = 0; index < userId.length; index += 1) hash = ((hash << 5) - hash + userId.charCodeAt(index)) | 0
  return COLLABORATOR_COLORS[Math.abs(hash) % COLLABORATOR_COLORS.length]
}

/** Id of the signed-in user, read from the JWT of the current role. */
export function currentCollaboratorId(role: 'teacher' | 'student'): string {
  const token = role === 'student' ? localStorage.getItem('student_token') : localStorage.getItem('access_token')
  if (!token) return ''
  try {
    const encoded = token.split('.')[1]?.replace(/-/g, '+').replace(/_/g, '/') || ''
    return String(JSON.parse(atob(encoded.padEnd(Math.ceil(encoded.length / 4) * 4, '=')))?.sub || '')
  } catch {
    return ''
  }
}
