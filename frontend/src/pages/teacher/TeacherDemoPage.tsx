import { useState, useRef, useEffect } from 'react'
import { useQuery, useMutation } from '@tanstack/react-query'
import { teacherApi, teacherbotsApi, llmApi } from '@/lib/api'
import {
  Wand2, ChevronDown, Send, Loader2, RefreshCw,
  GraduationCap, ClipboardCheck, MessageSquare, User, Database, Lightbulb, Bot
} from 'lucide-react'
import TeacherbotTestChat from '@/components/teacher/TeacherbotTestChat'
import { Button } from '@/components/ui/button'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

// ─── Types ────────────────────────────────────────────────────────────────────

interface Teacherbot {
  id: string; name: string; color: string; icon: string | null; synopsis: string | null; status: string
}

interface ChatbotProfile {
  key: string; name: string; description: string; icon: string; suggested_prompts?: string[]
}

interface SessionOption {
  id: string; title: string; class_name: string; status: string
}

interface Msg { id: string; role: 'user' | 'assistant'; content: string }

// ─── Style maps ───────────────────────────────────────────────────────────────

const TEACHERBOT_STYLES: Record<string, { card: string; iconBg: string; icon: string }> = {
  indigo:  { card: 'bg-indigo-50/80 border border-indigo-200/70 hover:bg-indigo-50 hover:border-indigo-300/80',      iconBg: 'bg-indigo-100',  icon: 'text-indigo-700' },
  blue:    { card: 'bg-blue-50/80 border border-blue-200/70 hover:bg-blue-50 hover:border-blue-300/80',              iconBg: 'bg-blue-100',    icon: 'text-blue-700' },
  green:   { card: 'bg-emerald-50/80 border border-emerald-200/70 hover:bg-emerald-50 hover:border-emerald-300/80',  iconBg: 'bg-emerald-100', icon: 'text-emerald-700' },
  red:     { card: 'bg-red-50/80 border border-red-200/70 hover:bg-red-50 hover:border-red-300/80',                  iconBg: 'bg-red-100',     icon: 'text-red-700' },
  purple:  { card: 'bg-purple-50/80 border border-purple-200/70 hover:bg-purple-50 hover:border-purple-300/80',      iconBg: 'bg-purple-100',  icon: 'text-purple-700' },
  pink:    { card: 'bg-pink-50/80 border border-pink-200/70 hover:bg-pink-50 hover:border-pink-300/80',              iconBg: 'bg-pink-100',    icon: 'text-pink-700' },
  orange:  { card: 'bg-orange-50/80 border border-orange-200/70 hover:bg-orange-50 hover:border-orange-300/80',      iconBg: 'bg-orange-100',  icon: 'text-orange-700' },
  teal:    { card: 'bg-teal-50/80 border border-teal-200/70 hover:bg-teal-50 hover:border-teal-300/80',              iconBg: 'bg-teal-100',    icon: 'text-teal-700' },
  cyan:    { card: 'bg-cyan-50/80 border border-cyan-200/70 hover:bg-cyan-50 hover:border-cyan-300/80',              iconBg: 'bg-cyan-100',    icon: 'text-cyan-700' },
}

const PROFILE_STYLES: Record<string, { card: string; iconBg: string; icon: string }> = {
  tutor:             { card: 'bg-emerald-50/80 border border-emerald-200/70 hover:bg-emerald-50 hover:border-emerald-300/80', iconBg: 'bg-emerald-100', icon: 'text-emerald-700' },
  quiz:              { card: 'bg-rose-50/80 border border-rose-200/70 hover:bg-rose-50 hover:border-rose-300/80',             iconBg: 'bg-rose-100',    icon: 'text-rose-700' },
  interview:         { card: 'bg-violet-50/80 border border-violet-200/70 hover:bg-violet-50 hover:border-violet-300/80',     iconBg: 'bg-violet-100',  icon: 'text-violet-700' },
  oral_exam:         { card: 'bg-amber-50/80 border border-amber-200/70 hover:bg-amber-50 hover:border-amber-300/80',         iconBg: 'bg-amber-100',   icon: 'text-amber-700' },
  dataset_generator: { card: 'bg-sky-50/80 border border-sky-200/70 hover:bg-sky-50 hover:border-sky-300/80',                 iconBg: 'bg-sky-100',     icon: 'text-sky-700' },
  math_coach:        { card: 'bg-blue-50/80 border border-blue-200/70 hover:bg-blue-50 hover:border-blue-300/80',             iconBg: 'bg-blue-100',    icon: 'text-blue-800' },
}

function ProfileIcon({ iconKey, className }: { iconKey: string; className: string }) {
  const icons: Record<string, React.ReactNode> = {
    'graduation-cap': <GraduationCap className={className} />,
    'clipboard-check': <ClipboardCheck className={className} />,
    'mic': <MessageSquare className={className} />,
    'user-check': <User className={className} />,
    'database': <Database className={className} />,
    'calculator': <Lightbulb className={className} />,
  }
  return <>{icons[iconKey] ?? <Bot className={className} />}</>
}

// ─── Profile chat (base profiles) ────────────────────────────────────────────

function ProfileDemoChat({ profile, onBack }: { profile: ChatbotProfile; onBack: () => void }) {
  const [messages, setMessages] = useState<Msg[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const endRef = useRef<HTMLDivElement>(null)
  const s = PROFILE_STYLES[profile.key] ?? PROFILE_STYLES.tutor

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages])

  const sendMutation = useMutation({
    mutationFn: (content: string) =>
      llmApi.teacherChat(content, messages.map(m => ({ role: m.role, content: m.content })), profile.key),
    onSuccess: (res) => {
      setMessages(prev => [...prev, { id: `a-${Date.now()}`, role: 'assistant', content: res.data.content ?? res.data.response ?? '' }])
    },
  })

  const handleSend = async () => {
    const text = input.trim()
    if (!text || busy) return
    setMessages(prev => [...prev, { id: `u-${Date.now()}`, role: 'user', content: text }])
    setInput('')
    setBusy(true)
    try { await sendMutation.mutateAsync(text) } finally { setBusy(false) }
  }

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center gap-4 mb-4">
        <Button variant="ghost" onClick={onBack}><span className="mr-1">←</span> Indietro</Button>
        <div className={`w-10 h-10 rounded-lg ${s.iconBg} flex items-center justify-center`}>
          <ProfileIcon iconKey={profile.icon} className={`h-5 w-5 ${s.icon}`} />
        </div>
        <div className="flex-1">
          <div className="font-bold text-slate-800">{profile.name}</div>
          <div className="text-xs text-slate-500">Profilo base</div>
        </div>
        <Button variant="outline" onClick={() => setMessages([])}>
          <RefreshCw className="h-4 w-4 mr-1" /> Ricomincia
        </Button>
      </div>

      <div className="flex-1 bg-white rounded-xl border border-slate-200 flex flex-col overflow-hidden">
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {messages.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center opacity-50">
              <ProfileIcon iconKey={profile.icon} className="h-12 w-12 text-slate-300 mb-4" />
              <p className="text-slate-400 font-medium">{profile.name}</p>
              <p className="text-sm text-slate-400">{profile.description}</p>
            </div>
          ) : messages.map(m => (
            <div key={m.id} className={`flex gap-3 ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              {m.role === 'assistant' && (
                <div className={`w-8 h-8 rounded-lg ${s.iconBg} flex items-center justify-center shrink-0`}>
                  <ProfileIcon iconKey={profile.icon} className={`h-4 w-4 ${s.icon}`} />
                </div>
              )}
              <div className={`max-w-[70%] px-4 py-3 rounded-2xl ${m.role === 'user' ? 'bg-[#181b1e] text-white rounded-tr-sm' : 'bg-slate-100 text-slate-800 rounded-tl-sm'}`}>
                {m.role === 'assistant'
                  ? <ReactMarkdown remarkPlugins={[remarkGfm]} className="prose prose-sm max-w-none prose-p:my-1">{m.content}</ReactMarkdown>
                  : <p className="text-sm">{m.content}</p>}
              </div>
            </div>
          ))}
          {busy && (
            <div className="flex gap-3">
              <div className={`w-8 h-8 rounded-lg ${s.iconBg} flex items-center justify-center`}>
                <ProfileIcon iconKey={profile.icon} className={`h-4 w-4 ${s.icon}`} />
              </div>
              <div className="bg-slate-100 px-4 py-3 rounded-2xl rounded-tl-sm">
                <Loader2 className="h-4 w-4 animate-spin text-slate-500" />
              </div>
            </div>
          )}
          <div ref={endRef} />
        </div>

        <div className="p-4 border-t border-slate-100">
          <div className="flex gap-2">
            <input
              type="text" value={input} onChange={e => setInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend() } }}
              placeholder="Scrivi un messaggio..."
              className="flex-1 px-4 py-2 border border-slate-200 rounded-full focus:ring-2 focus:ring-[#181b1e] focus:border-transparent text-sm"
              disabled={busy}
            />
            <Button onClick={handleSend} disabled={!input.trim() || busy} className="rounded-full bg-[#181b1e] hover:bg-[#0f1113]">
              <Send className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Main page ────────────────────────────────────────────────────────────────

type Selected = { type: 'teacherbot'; id: string } | { type: 'profile'; profile: ChatbotProfile } | null

export default function TeacherDemoPage() {
  const [selected, setSelected] = useState<Selected>(null)
  const [selectedSessionId, setSelectedSessionId] = useState<string>('all')

  // All classes → sessions
  const { data: classes } = useQuery({
    queryKey: ['classes'],
    queryFn: async () => { const res = await teacherApi.getClasses(); return res.data as { id: string; name: string }[] },
    staleTime: 1000 * 60 * 2,
  })

  const { data: sessions } = useQuery({
    queryKey: ['all-sessions-flat', classes?.map(c => c.id)],
    queryFn: async () => {
      if (!classes) return []
      const all: SessionOption[] = []
      await Promise.all(classes.map(async cls => {
        const res = await teacherApi.getSessions(cls.id)
        ;(res.data as SessionOption[]).forEach(s => all.push({ ...s, class_name: cls.name }))
      }))
      all.sort((a, b) => {
        if (a.status === 'active' && b.status !== 'active') return -1
        if (b.status === 'active' && a.status !== 'active') return 1
        return a.title.localeCompare(b.title)
      })
      return all
    },
    enabled: !!classes?.length,
    staleTime: 1000 * 60 * 2,
  })

  // Teacherbots: all or session-filtered
  const { data: teacherbots, isLoading: loadingBots } = useQuery({
    queryKey: ['teacherbots-demo', selectedSessionId],
    queryFn: async () => {
      const res = selectedSessionId === 'all'
        ? await teacherbotsApi.list()
        : await teacherbotsApi.listForSession(selectedSessionId)
      return res.data as Teacherbot[]
    },
    staleTime: 1000 * 60 * 2,
  })

  // Base profiles (always all — same for every session)
  const { data: profilesData } = useQuery({
    queryKey: ['chatbot-profiles'],
    queryFn: async () => {
      const res = await llmApi.getChatbotProfiles()
      return Object.values(res.data as Record<string, ChatbotProfile>) as ChatbotProfile[]
    },
    staleTime: 1000 * 60 * 10,
  })

  if (selected?.type === 'teacherbot') {
    return (
      <div className="max-w-2xl mx-auto p-6">
        <TeacherbotTestChat teacherbotId={selected.id} onBack={() => setSelected(null)} />
      </div>
    )
  }

  if (selected?.type === 'profile') {
    return (
      <div className="max-w-2xl mx-auto p-6">
        <ProfileDemoChat profile={selected.profile} onBack={() => setSelected(null)} />
      </div>
    )
  }

  const activeSessions = sessions?.filter(s => s.status === 'active') ?? []
  const otherSessions  = sessions?.filter(s => s.status !== 'active') ?? []

  return (
    <div className="max-w-3xl mx-auto p-6 md:p-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-800 mb-1">Vista Studente</h1>
        <p className="text-slate-500 text-sm">
          Vedi gli stessi chatbot che vedono i tuoi studenti. Ideale per condividere lo schermo in classe.
        </p>
      </div>

      {/* Session selector */}
      <div className="mb-8">
        <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1.5">Sessione</label>
        <div className="relative inline-block">
          <select
            value={selectedSessionId}
            onChange={e => { setSelectedSessionId(e.target.value); setSelected(null) }}
            className="appearance-none pl-3 pr-8 py-2 text-sm bg-white border border-slate-200 rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-slate-300 cursor-pointer"
          >
            <option value="all">Tutti i chatbot</option>
            {activeSessions.length > 0 && (
              <optgroup label="🟢 Sessioni attive">
                {activeSessions.map(s => <option key={s.id} value={s.id}>{s.class_name} — {s.title}</option>)}
              </optgroup>
            )}
            {otherSessions.length > 0 && (
              <optgroup label="Altre sessioni">
                {otherSessions.map(s => <option key={s.id} value={s.id}>{s.class_name} — {s.title}</option>)}
              </optgroup>
            )}
          </select>
          <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400 pointer-events-none" />
        </div>
      </div>

      {/* Base profiles */}
      {profilesData && profilesData.length > 0 && (
        <div className="mb-8">
          <h2 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3">Assistenti base</h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {profilesData.map(p => {
              const s = PROFILE_STYLES[p.key] ?? PROFILE_STYLES.tutor
              return (
                <button key={p.key} onClick={() => setSelected({ type: 'profile', profile: p })}
                  className={`aspect-square flex flex-col items-center justify-center p-4 rounded-2xl shadow-sm hover:shadow-md transition-all ${s.card}`}>
                  <div className={`w-12 h-12 rounded-xl ${s.iconBg} flex items-center justify-center mb-3`}>
                    <ProfileIcon iconKey={p.icon} className={`h-6 w-6 ${s.icon}`} />
                  </div>
                  <span className="text-sm font-semibold text-slate-800 text-center leading-tight line-clamp-2">{p.name}</span>
                  {p.description && (
                    <span className="text-xs text-slate-400 mt-1 text-center line-clamp-2 leading-tight">{p.description}</span>
                  )}
                </button>
              )
            })}
          </div>
        </div>
      )}

      {/* Teacherbots */}
      <div>
        <h2 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3">
          {selectedSessionId === 'all' ? 'I tuoi chatbot' : 'Chatbot della sessione'}
        </h2>
        {loadingBots ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {[...Array(3)].map((_, i) => <div key={i} className="aspect-square rounded-2xl bg-slate-100 animate-pulse" />)}
          </div>
        ) : !teacherbots || teacherbots.length === 0 ? (
          <div className="text-center py-10 text-slate-400">
            <Wand2 className="h-8 w-8 mx-auto mb-2 opacity-30" />
            <p className="text-sm">
              {selectedSessionId === 'all'
                ? 'Nessun chatbot creato'
                : 'Nessun chatbot pubblicato su questa sessione'}
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {teacherbots.map(bot => {
              const s = TEACHERBOT_STYLES[bot.color] ?? TEACHERBOT_STYLES.indigo
              return (
                <button key={bot.id} onClick={() => setSelected({ type: 'teacherbot', id: bot.id })}
                  className={`aspect-square flex flex-col items-center justify-center p-4 rounded-2xl shadow-sm hover:shadow-md transition-all ${s.card}`}>
                  <div className={`w-12 h-12 rounded-xl ${s.iconBg} flex items-center justify-center mb-3`}>
                    <Wand2 className={`h-6 w-6 ${s.icon}`} />
                  </div>
                  <span className="text-sm font-semibold text-slate-800 text-center leading-tight line-clamp-2">{bot.name}</span>
                  {bot.synopsis && (
                    <span className="text-xs text-slate-400 mt-1 text-center line-clamp-2 leading-tight">{bot.synopsis}</span>
                  )}
                </button>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
