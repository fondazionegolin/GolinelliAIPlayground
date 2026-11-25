import { collaboratorColor } from '@/lib/collaborators'
import { tl } from '@/i18n/tl'

export type TeamMember = { id: string; name: string; role: 'teacher' | 'student'; pending?: boolean; owner?: boolean }

/** Creator + collaborators of the open Vibe Lab project, always visible in the toolbar. */
export function CodingTeamAvatars({ members, dark = false, max = 5, onClick }: {
  members: TeamMember[]
  dark?: boolean
  max?: number
  onClick?: () => void
}) {
  if (members.length < 2) return null
  const ring = dark ? '#0f172a' : '#ffffff'
  const shown = members.slice(0, max)
  const content = (
    <span className="flex items-center -space-x-1.5" role="group" aria-label={tl("Persone del progetto")}>
      {shown.map((person) => {
        const color = collaboratorColor(person.id)
        const role = person.owner ? tl("creatore") : person.pending ? tl("invitato") : tl("collaboratore")
        return (
          <span
            key={person.id}
            title={`${person.name} · ${role}`}
            className={`flex h-7 w-7 items-center justify-center rounded-full text-[10px] font-semibold text-white ${person.pending ? 'opacity-45' : ''}`}
            style={{ backgroundColor: color, boxShadow: `0 0 0 2px ${ring}${person.role === 'teacher' ? `, 0 0 0 4px ${color}55` : ''}` }}
          >
            {person.name.slice(0, 2).toUpperCase()}
          </span>
        )
      })}
      {members.length > max && (
        <span
          className="flex h-7 w-7 items-center justify-center rounded-full bg-slate-300 text-[10px] font-semibold text-slate-700"
          style={{ boxShadow: `0 0 0 2px ${ring}` }}
          title={members.slice(max).map((person) => person.name).join(', ')}
        >+{members.length - max}</span>
      )}
    </span>
  )
  return onClick ? (
    <button type="button" onClick={onClick} className="shrink-0 rounded-full px-1.5 py-1" title={tl("Gestisci i collaboratori")}>{content}</button>
  ) : <span className="shrink-0 px-1.5 py-1">{content}</span>
}
