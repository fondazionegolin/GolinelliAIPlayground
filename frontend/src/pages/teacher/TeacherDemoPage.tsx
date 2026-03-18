import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { teacherApi, teacherbotsApi } from '@/lib/api'
import { Wand2, ChevronDown } from 'lucide-react'
import TeacherbotTestChat from '@/components/teacher/TeacherbotTestChat'

interface Teacherbot {
  id: string
  name: string
  color: string
  icon: string | null
  synopsis: string | null
  status: string
}

interface SessionOption {
  id: string
  title: string
  class_name: string
  status: string
}

const TILE_STYLES: Record<string, { card: string; iconBg: string; icon: string }> = {
  indigo:  { card: 'bg-indigo-50/80 border border-indigo-200/70 hover:border-indigo-300/80 hover:bg-indigo-50 hover:shadow-indigo-100/60',      iconBg: 'bg-indigo-100',  icon: 'text-indigo-700' },
  blue:    { card: 'bg-blue-50/80 border border-blue-200/70 hover:border-blue-300/80 hover:bg-blue-50 hover:shadow-blue-100/60',                iconBg: 'bg-blue-100',    icon: 'text-blue-700' },
  green:   { card: 'bg-emerald-50/80 border border-emerald-200/70 hover:border-emerald-300/80 hover:bg-emerald-50 hover:shadow-emerald-100/60', iconBg: 'bg-emerald-100', icon: 'text-emerald-700' },
  red:     { card: 'bg-red-50/80 border border-red-200/70 hover:border-red-300/80 hover:bg-red-50 hover:shadow-red-100/60',                    iconBg: 'bg-red-100',     icon: 'text-red-700' },
  purple:  { card: 'bg-purple-50/80 border border-purple-200/70 hover:border-purple-300/80 hover:bg-purple-50 hover:shadow-purple-100/60',      iconBg: 'bg-purple-100',  icon: 'text-purple-700' },
  pink:    { card: 'bg-pink-50/80 border border-pink-200/70 hover:border-pink-300/80 hover:bg-pink-50 hover:shadow-pink-100/60',                iconBg: 'bg-pink-100',    icon: 'text-pink-700' },
  orange:  { card: 'bg-orange-50/80 border border-orange-200/70 hover:border-orange-300/80 hover:bg-orange-50 hover:shadow-orange-100/60',      iconBg: 'bg-orange-100',  icon: 'text-orange-700' },
  teal:    { card: 'bg-teal-50/80 border border-teal-200/70 hover:border-teal-300/80 hover:bg-teal-50 hover:shadow-teal-100/60',                iconBg: 'bg-teal-100',    icon: 'text-teal-700' },
  cyan:    { card: 'bg-cyan-50/80 border border-cyan-200/70 hover:border-cyan-300/80 hover:bg-cyan-50 hover:shadow-cyan-100/60',                iconBg: 'bg-cyan-100',    icon: 'text-cyan-700' },
}

function getTileStyle(color: string) {
  return TILE_STYLES[color] ?? TILE_STYLES.indigo
}

export default function TeacherDemoPage() {
  const [selectedBotId, setSelectedBotId] = useState<string | null>(null)
  const [selectedSessionId, setSelectedSessionId] = useState<string>('all')

  // Fetch all classes to build session list
  const { data: classes } = useQuery({
    queryKey: ['classes'],
    queryFn: async () => {
      const res = await teacherApi.getClasses()
      return res.data as { id: string; name: string; sessions?: SessionOption[] }[]
    },
    staleTime: 1000 * 60 * 2,
  })

  // Fetch sessions for each class and flatten
  const { data: sessions } = useQuery({
    queryKey: ['all-sessions-flat', classes?.map(c => c.id)],
    queryFn: async () => {
      if (!classes) return []
      const all: SessionOption[] = []
      await Promise.all(classes.map(async (cls) => {
        const res = await teacherApi.getSessions(cls.id)
        const clsSessions = (res.data as SessionOption[]).map(s => ({
          ...s,
          class_name: cls.name,
        }))
        all.push(...clsSessions)
      }))
      // Sort: active first, then by title
      all.sort((a, b) => {
        if (a.status === 'active' && b.status !== 'active') return -1
        if (b.status === 'active' && a.status !== 'active') return 1
        return a.title.localeCompare(b.title)
      })
      return all
    },
    enabled: !!classes && classes.length > 0,
    staleTime: 1000 * 60 * 2,
  })

  // Fetch bots: all or session-specific
  const { data: teacherbots, isLoading } = useQuery({
    queryKey: ['teacherbots-demo', selectedSessionId],
    queryFn: async () => {
      if (selectedSessionId === 'all') {
        const res = await teacherbotsApi.list()
        return res.data as Teacherbot[]
      } else {
        const res = await teacherbotsApi.listForSession(selectedSessionId)
        return res.data as Teacherbot[]
      }
    },
    staleTime: 1000 * 60 * 2,
  })

  if (selectedBotId) {
    return (
      <div className="max-w-2xl mx-auto p-6">
        <TeacherbotTestChat
          teacherbotId={selectedBotId}
          onBack={() => setSelectedBotId(null)}
        />
      </div>
    )
  }

  const activeSessions = sessions?.filter(s => s.status === 'active') ?? []
  const otherSessions = sessions?.filter(s => s.status !== 'active') ?? []

  return (
    <div className="max-w-3xl mx-auto p-6 md:p-8">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-800 mb-1">Vista Studente</h1>
        <p className="text-slate-500 text-sm">
          Vedi gli stessi chatbot che vedono i tuoi studenti. Ideale per condividere lo schermo in classe.
        </p>
      </div>

      {/* Session selector */}
      <div className="mb-6">
        <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1.5">
          Sessione
        </label>
        <div className="relative inline-block">
          <select
            value={selectedSessionId}
            onChange={e => { setSelectedSessionId(e.target.value); setSelectedBotId(null) }}
            className="appearance-none pl-3 pr-8 py-2 text-sm bg-white border border-slate-200 rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-slate-300 cursor-pointer"
          >
            <option value="all">Tutti i chatbot</option>
            {activeSessions.length > 0 && (
              <optgroup label="🟢 Sessioni attive">
                {activeSessions.map(s => (
                  <option key={s.id} value={s.id}>{s.class_name} — {s.title}</option>
                ))}
              </optgroup>
            )}
            {otherSessions.length > 0 && (
              <optgroup label="Altre sessioni">
                {otherSessions.map(s => (
                  <option key={s.id} value={s.id}>{s.class_name} — {s.title}</option>
                ))}
              </optgroup>
            )}
          </select>
          <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400 pointer-events-none" />
        </div>
      </div>

      {/* Bot grid */}
      {isLoading ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="aspect-square rounded-2xl bg-slate-100 animate-pulse" />
          ))}
        </div>
      ) : !teacherbots || teacherbots.length === 0 ? (
        <div className="text-center py-20 text-slate-400">
          <Wand2 className="h-10 w-10 mx-auto mb-3 opacity-30" />
          {selectedSessionId === 'all' ? (
            <>
              <p className="font-medium">Nessun chatbot creato</p>
              <p className="text-sm mt-1">Crea dei teacherbot dalla sezione supporto</p>
            </>
          ) : (
            <>
              <p className="font-medium">Nessun chatbot in questa sessione</p>
              <p className="text-sm mt-1">Pubblica dei teacherbot sulla classe corrispondente</p>
            </>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {teacherbots.map((bot) => {
            const s = getTileStyle(bot.color)
            return (
              <button
                key={bot.id}
                onClick={() => setSelectedBotId(bot.id)}
                className={`aspect-square flex flex-col items-center justify-center p-4 rounded-2xl shadow-sm hover:shadow-md transition-all ${s.card}`}
              >
                <div className={`w-12 h-12 rounded-xl ${s.iconBg} flex items-center justify-center mb-3`}>
                  <Wand2 className={`h-6 w-6 ${s.icon}`} />
                </div>
                <span className="text-sm font-semibold text-slate-800 text-center leading-tight line-clamp-2">
                  {bot.name}
                </span>
                {bot.synopsis && (
                  <span className="text-xs text-slate-400 mt-1 text-center line-clamp-2 leading-tight">
                    {bot.synopsis}
                  </span>
                )}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
