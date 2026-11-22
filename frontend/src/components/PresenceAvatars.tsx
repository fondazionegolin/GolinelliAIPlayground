import { collaboratorColor, type Collaborator } from '@/lib/collaborators'
import { tl } from '@/i18n/tl'

/** Round avatars of the people who have a shared item open right now: same look as on the canvas. */
export default function PresenceAvatars({ people, max = 4, className = '' }: { people: Collaborator[]; max?: number; className?: string }) {
  if (!people.length) return null
  return (
    <div className={`flex shrink-0 items-center -space-x-1.5 ${className}`} role="group" aria-label={tl("Utenti connessi")}>
      {people.slice(0, max).map((person) => {
        const color = collaboratorColor(person.id)
        return (
          <span
            key={person.id}
            title={`${person.name}${person.role === 'teacher' ? ` · ${tl("Docente")}` : ''} — ${tl("online ora")}`}
            className="relative flex h-7 w-7 items-center justify-center overflow-hidden rounded-full border-2 border-white text-[10px] font-semibold text-white shadow-sm"
            style={{ backgroundColor: color, boxShadow: person.role === 'teacher' ? `0 0 0 2px ${color}55` : undefined }}
          >
            {person.avatarUrl ? <img src={person.avatarUrl} alt="" className="h-full w-full object-cover" /> : person.name.slice(0, 2).toUpperCase()}
          </span>
        )
      })}
      {people.length > max && <span className="flex h-7 w-7 items-center justify-center rounded-full border-2 border-white bg-slate-200 text-[10px] font-semibold text-slate-600" title={people.slice(max).map((person) => person.name).join(', ')}>+{people.length - max}</span>}
    </div>
  )
}
