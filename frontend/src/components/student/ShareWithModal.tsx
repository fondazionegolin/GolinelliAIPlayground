import { useEffect, useState } from 'react'
import { X, Users, Loader2, Check, Search } from 'lucide-react'
import { collaborationApi } from '@/lib/api'
import type { SharedRoom, SharedParticipant } from './SharedChatPanel'

export interface ShareTarget {
  kind: 'teacherbot' | 'assistant'
  teacherbotId?: string
  profileKey?: string
  title: string
}

interface ShareWithModalProps {
  target: ShareTarget
  language: 'it' | 'en'
  accent: { accent: string; text: string; soft: string }
  seedMessages?: { role: string; content: string; sender_nickname?: string }[]
  onClose: () => void
  onCreated: (room: SharedRoom) => void
}

export default function ShareWithModal({ target, language, accent, seedMessages, onClose, onCreated }: ShareWithModalProps) {
  const isEnglish = language === 'en'
  const [participants, setParticipants] = useState<SharedParticipant[]>([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [search, setSearch] = useState('')
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    collaborationApi.listParticipants()
      .then((res) => { if (!cancelled) setParticipants(res.data as SharedParticipant[]) })
      .catch(() => { if (!cancelled) setError(isEnglish ? 'Could not load classmates.' : 'Impossibile caricare i compagni.') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [isEnglish])

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  const create = async () => {
    if (selected.size === 0 || creating) return
    setCreating(true)
    setError(null)
    try {
      const res = await collaborationApi.createRoom({
        kind: target.kind,
        teacherbot_id: target.teacherbotId,
        profile_key: target.profileKey,
        participant_ids: Array.from(selected),
        title: target.title,
        seed_messages: seedMessages,
      })
      onCreated(res.data as SharedRoom)
    } catch (e: any) {
      setError(e?.response?.data?.detail || (isEnglish ? 'Could not create the shared chat.' : 'Impossibile creare la chat condivisa.'))
      setCreating(false)
    }
  }

  const filtered = participants.filter((p) =>
    p.nickname.toLowerCase().includes(search.trim().toLowerCase())
  )

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-md" onClick={onClose}>
      <div className="w-full max-w-md overflow-hidden rounded-2xl bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-3 border-b border-slate-100 px-5 py-4">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl" style={{ backgroundColor: accent.soft, color: accent.text }}>
            <Users className="h-4 w-4" />
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="truncate text-sm font-bold text-slate-900">{isEnglish ? 'Share with…' : 'Condividi con…'}</h3>
            <p className="truncate text-xs text-slate-500">{target.title}</p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600"><X className="h-5 w-5" /></button>
        </div>

        <div className="px-5 py-4">
          <p className="mb-3 text-xs text-slate-500">
            {isEnglish
              ? 'Pick classmates to open a shared chat. The bot answers everyone; use @name to message a peer privately.'
              : 'Scegli i compagni per aprire una chat condivisa. Il bot risponde a tutti; usa @nome per scrivere in privato a un compagno.'}
          </p>

          <div className="relative mb-3">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-300" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={isEnglish ? 'Search…' : 'Cerca…'}
              className="w-full rounded-lg border border-slate-200 bg-slate-50 py-2 pl-9 pr-3 text-sm outline-none focus:ring-2 focus:ring-slate-300"
            />
          </div>

          <div className="max-h-64 space-y-1.5 overflow-y-auto">
            {loading ? (
              <div className="flex justify-center py-6 text-slate-400"><Loader2 className="h-5 w-5 animate-spin" /></div>
            ) : filtered.length === 0 ? (
              <p className="py-6 text-center text-sm text-slate-400">
                {isEnglish ? 'No classmates in the session.' : 'Nessun compagno nella sessione.'}
              </p>
            ) : (
              filtered.map((p) => {
                const active = selected.has(p.id)
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => toggle(p.id)}
                    className={`flex w-full items-center gap-3 rounded-lg border px-3 py-2 text-left transition-all ${
                      active ? 'border-transparent' : 'border-slate-200 hover:bg-slate-50'
                    }`}
                    style={active ? { backgroundColor: accent.soft } : undefined}
                  >
                    <div className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-100 text-xs font-bold text-slate-500">
                      {p.avatar_url ? <img src={p.avatar_url} alt="" className="h-8 w-8 rounded-full object-cover" /> : p.nickname.slice(0, 2).toUpperCase()}
                    </div>
                    <span className="flex-1 truncate text-sm font-medium text-slate-700">{p.nickname}</span>
                    {active && <Check className="h-4 w-4" style={{ color: accent.text }} />}
                  </button>
                )
              })
            )}
          </div>

          {error && <p className="mt-3 text-xs font-medium text-rose-600">{error}</p>}
        </div>

        <div className="flex items-center justify-between border-t border-slate-100 px-5 py-3">
          <span className="text-xs text-slate-400">
            {selected.size > 0 ? (isEnglish ? `${selected.size} selected` : `${selected.size} selezionati`) : (isEnglish ? 'Select at least one' : 'Selezionane almeno uno')}
          </span>
          <button
            type="button"
            onClick={() => void create()}
            disabled={selected.size === 0 || creating}
            className="inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-bold text-white transition-all disabled:bg-slate-200 disabled:text-slate-400"
            style={selected.size > 0 && !creating ? { backgroundColor: accent.accent } : undefined}
          >
            {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Users className="h-4 w-4" />}
            {isEnglish ? 'Start shared chat' : 'Avvia chat condivisa'}
          </button>
        </div>
      </div>
    </div>
  )
}
