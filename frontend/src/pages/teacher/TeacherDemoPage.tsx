import { useState, useRef, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { teacherApi, teacherbotsApi, llmApi } from '@/lib/api'
import {
  Wand2, ChevronDown, Send, Loader2, RefreshCw,
  GraduationCap, ClipboardCheck, MessageSquare, User, Database, Lightbulb, Bot,
  ArrowLeft, Save, RotateCcw, MessageCircle, FileText, Sparkles,
} from 'lucide-react'
import TeacherbotTestChat from '@/components/teacher/TeacherbotTestChat'
import { TeacherbotPromptOptimizer } from '@/components/teacher/TeacherbotPromptOptimizer'
import { Button } from '@/components/ui/button'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { useToast } from '@/components/ui/use-toast'

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

interface ProfileOverrideData {
  profile_key: string
  name: string
  description: string
  default_prompt: string
  custom_prompt: string | null
}

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

const PROFILE_STYLES: Record<string, { card: string; iconBg: string; icon: string; accent: string }> = {
  tutor:             { card: 'bg-emerald-50/80 border border-emerald-200/70 hover:bg-emerald-50 hover:border-emerald-300/80', iconBg: 'bg-emerald-100', icon: 'text-emerald-700', accent: '#10b981' },
  quiz:              { card: 'bg-rose-50/80 border border-rose-200/70 hover:bg-rose-50 hover:border-rose-300/80',             iconBg: 'bg-rose-100',    icon: 'text-rose-700',    accent: '#f43f5e' },
  interview:         { card: 'bg-violet-50/80 border border-violet-200/70 hover:bg-violet-50 hover:border-violet-300/80',     iconBg: 'bg-violet-100',  icon: 'text-violet-700',  accent: '#7c3aed' },
  oral_exam:         { card: 'bg-amber-50/80 border border-amber-200/70 hover:bg-amber-50 hover:border-amber-300/80',         iconBg: 'bg-amber-100',   icon: 'text-amber-700',   accent: '#f59e0b' },
  dataset_generator: { card: 'bg-sky-50/80 border border-sky-200/70 hover:bg-sky-50 hover:border-sky-300/80',                 iconBg: 'bg-sky-100',     icon: 'text-sky-700',     accent: '#0ea5e9' },
  math_coach:        { card: 'bg-blue-50/80 border border-blue-200/70 hover:bg-blue-50 hover:border-blue-300/80',             iconBg: 'bg-blue-100',    icon: 'text-blue-800',    accent: '#3b82f6' },
}

const FALLBACK_STYLE = { card: '', iconBg: 'bg-slate-100', icon: 'text-slate-600', accent: '#6366f1' }

function ProfileIcon({ iconKey, className }: { iconKey: string; className: string }) {
  const icons: Record<string, React.ReactNode> = {
    'graduation-cap':  <GraduationCap className={className} />,
    'clipboard-check': <ClipboardCheck className={className} />,
    'mic':             <MessageSquare className={className} />,
    'user-check':      <User className={className} />,
    'database':        <Database className={className} />,
    'calculator':      <Lightbulb className={className} />,
  }
  return <>{icons[iconKey] ?? <Bot className={className} />}</>
}

// ─── Profile Chat (Prova tab) ──────────────────────────────────────────────

function ProfileDemoChat({ profile }: { profile: ChatbotProfile }) {
  const [messages, setMessages] = useState<Msg[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const endRef = useRef<HTMLDivElement>(null)
  const s = PROFILE_STYLES[profile.key] ?? FALLBACK_STYLE

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
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center opacity-50 min-h-[200px]">
            <ProfileIcon iconKey={profile.icon} className={`h-12 w-12 mb-4 ${s.icon}`} />
            <p className="text-slate-500 font-medium">{profile.name}</p>
            <p className="text-sm text-slate-400 text-center max-w-xs mt-1">{profile.description}</p>
            {profile.suggested_prompts && (
              <div className="mt-4 flex flex-wrap gap-2 justify-center">
                {profile.suggested_prompts.slice(0, 3).map(p => (
                  <button
                    key={p}
                    onClick={() => { setInput(p); }}
                    className="text-xs bg-slate-100 hover:bg-slate-200 text-slate-600 px-3 py-1.5 rounded-full transition-colors"
                  >
                    {p}
                  </button>
                ))}
              </div>
            )}
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

      <div className="p-4 border-t border-slate-100 flex items-center gap-2">
        <button onClick={() => setMessages([])} className="p-2 rounded-lg hover:bg-slate-100 transition-colors" title="Ricomincia">
          <RefreshCw className="h-4 w-4 text-slate-400" />
        </button>
        <input
          type="text" value={input} onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend() } }}
          placeholder="Scrivi un messaggio di prova..."
          className="flex-1 px-4 py-2 border border-slate-200 rounded-full focus:ring-2 focus:ring-[#181b1e] focus:border-transparent text-sm"
          disabled={busy}
        />
        <Button onClick={handleSend} disabled={!input.trim() || busy} className="rounded-full bg-[#181b1e] hover:bg-[#0f1113] shrink-0">
          <Send className="h-4 w-4" />
        </Button>
      </div>
    </div>
  )
}

// ─── Profile Detail View ──────────────────────────────────────────────────────

function ProfileDetailView({
  profile,
  sessionId,
  onBack,
}: {
  profile: ChatbotProfile
  sessionId: string
  onBack: () => void
}) {
  const { toast } = useToast()
  const queryClient = useQueryClient()
  const [activeTab, setActiveTab] = useState<'prompt' | 'chat'>('prompt')
  const [promptValue, setPromptValue] = useState('')
  const [defaultPrompt, setDefaultPrompt] = useState('')
  const [saving, setSaving] = useState(false)
  const [hasCustom, setHasCustom] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const [selection, setSelection] = useState<{ text: string; position: { x: number; y: number }; start: number; end: number } | null>(null)

  const s = PROFILE_STYLES[profile.key] ?? FALLBACK_STYLE

  // Load prompt (session override if session selected, else default)
  const { isLoading } = useQuery({
    queryKey: ['session-chatbot-profiles', sessionId],
    queryFn: async () => {
      const res = await teacherApi.getSessionChatbotProfiles(sessionId)
      const items: ProfileOverrideData[] = res.data
      const item = items.find(p => p.profile_key === profile.key)
      if (item) {
        setDefaultPrompt(item.default_prompt)
        setPromptValue(item.custom_prompt ?? item.default_prompt)
        setHasCustom(!!item.custom_prompt)
      }
      return items
    },
    enabled: !!sessionId && sessionId !== 'all',
  })

  // Load default prompt when no session selected
  useEffect(() => {
    if (sessionId === 'all') {
      // Fetch default from the profiles endpoint
      llmApi.getChatbotProfilesFull().then(res => {
        const profiles: Record<string, { system_prompt: string }> = res.data
        const p = profiles[profile.key]
        if (p) {
          setDefaultPrompt(p.system_prompt)
          setPromptValue(p.system_prompt)
          setHasCustom(false)
        }
      }).catch(() => {})
    }
  }, [sessionId, profile.key])

  const handleMouseUp = (e: React.MouseEvent<HTMLTextAreaElement>) => {
    const textarea = textareaRef.current
    if (!textarea) return
    const start = textarea.selectionStart
    const end = textarea.selectionEnd
    const selected = textarea.value.substring(start, end).trim()
    if (selected.length < 5) { setSelection(null); return }
    setSelection({ text: selected, start, end, position: { x: e.clientX, y: e.clientY + 20 } })
  }

  const handleApplyOptimization = (newText: string) => {
    if (!selection) return
    const before = promptValue.substring(0, selection.start)
    const after = promptValue.substring(selection.end)
    setPromptValue(before + newText + after)
    setSelection(null)
  }

  const handleSave = async () => {
    if (sessionId === 'all') return
    setSaving(true)
    try {
      const isDefault = promptValue.trim() === defaultPrompt.trim()
      await teacherApi.upsertSessionChatbotProfile(sessionId, profile.key, isDefault ? null : promptValue)
      queryClient.invalidateQueries({ queryKey: ['session-chatbot-profiles', sessionId] })
      setHasCustom(!isDefault)
      toast({
        title: 'Prompt salvato',
        description: isDefault
          ? 'Ripristinato al prompt predefinito.'
          : `Il prompt personalizzato per "${profile.name}" è ora attivo per questa sessione.`,
      })
    } catch {
      toast({ title: 'Errore', description: 'Impossibile salvare il prompt.', variant: 'destructive' })
    } finally {
      setSaving(false)
    }
  }

  const handleReset = async () => {
    if (sessionId === 'all') return
    try {
      await teacherApi.deleteSessionChatbotProfileOverride(sessionId, profile.key)
      queryClient.invalidateQueries({ queryKey: ['session-chatbot-profiles', sessionId] })
      setPromptValue(defaultPrompt)
      setHasCustom(false)
      toast({ title: 'Ripristinato', description: 'Prompt riportato al default.' })
    } catch {
      toast({ title: 'Errore', variant: 'destructive' })
    }
  }

  return (
    <div className="flex flex-col h-full max-h-[calc(100vh-120px)]">
      {/* Header */}
      <div className="flex items-center gap-3 mb-4 flex-shrink-0">
        <Button variant="ghost" size="sm" onClick={onBack} className="gap-1.5">
          <ArrowLeft className="h-4 w-4" /> Indietro
        </Button>
        <div className={`w-9 h-9 rounded-xl ${s.iconBg} flex items-center justify-center`}>
          <ProfileIcon iconKey={profile.icon} className={`h-5 w-5 ${s.icon}`} />
        </div>
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <h2 className="font-bold text-slate-800">{profile.name}</h2>
            {hasCustom && sessionId !== 'all' && (
              <span className="text-[10px] bg-indigo-100 text-indigo-700 font-semibold px-2 py-0.5 rounded-full">
                Personalizzato
              </span>
            )}
          </div>
          <p className="text-xs text-slate-500">{profile.description}</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 p-1 bg-slate-100 rounded-lg mb-4 flex-shrink-0 w-fit">
        <button
          onClick={() => setActiveTab('prompt')}
          className={`flex items-center gap-1.5 px-4 py-2 rounded-md text-sm font-medium transition-all ${activeTab === 'prompt' ? 'bg-white shadow-sm text-slate-800' : 'text-slate-500 hover:text-slate-700'}`}
        >
          <FileText className="h-3.5 w-3.5" /> System Prompt
        </button>
        <button
          onClick={() => setActiveTab('chat')}
          className={`flex items-center gap-1.5 px-4 py-2 rounded-md text-sm font-medium transition-all ${activeTab === 'chat' ? 'bg-white shadow-sm text-slate-800' : 'text-slate-500 hover:text-slate-700'}`}
        >
          <MessageCircle className="h-3.5 w-3.5" /> Prova Chat
        </button>
      </div>

      {/* Tab content */}
      {activeTab === 'prompt' ? (
        <div className="flex-1 flex flex-col min-h-0">
          {/* Session context notice */}
          {sessionId === 'all' ? (
            <div className="mb-3 px-3 py-2 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-700 flex-shrink-0">
              <strong>Sola lettura.</strong> Seleziona una sessione specifica nella lista principale per personalizzare il prompt per quella sessione.
            </div>
          ) : (
            <div className="mb-3 px-3 py-2 bg-indigo-50 border border-indigo-200 rounded-lg text-xs text-indigo-700 flex-shrink-0">
              <strong>Sessione attiva.</strong> Le modifiche si applicano solo a questa sessione. Seleziona il testo nel prompt per ottenere suggerimenti AI granulari.
              <span className="ml-1 inline-flex items-center gap-0.5 font-medium"><Sparkles className="h-3 w-3" /> Trascina per selezionare</span>
            </div>
          )}

          {isLoading ? (
            <div className="flex-1 flex items-center justify-center">
              <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
            </div>
          ) : (
            <>
              <div className="relative flex-1 min-h-0">
                <textarea
                  ref={textareaRef}
                  value={promptValue}
                  onChange={e => { if (sessionId !== 'all') setPromptValue(e.target.value) }}
                  onMouseUp={handleMouseUp}
                  readOnly={sessionId === 'all'}
                  className={`w-full h-full text-xs font-mono border border-slate-200 rounded-xl p-4 resize-none focus:outline-none focus:ring-2 focus:ring-indigo-300 focus:border-transparent ${sessionId === 'all' ? 'bg-slate-50 text-slate-500 cursor-default' : 'bg-white'}`}
                  spellCheck={false}
                />
                {selection && sessionId !== 'all' && (
                  <TeacherbotPromptOptimizer
                    selectedText={selection.text}
                    teacherbotName={profile.name}
                    teacherbotSynopsis={profile.description}
                    position={selection.position}
                    mode="expand"
                    onClose={() => setSelection(null)}
                    onApply={handleApplyOptimization}
                  />
                )}
              </div>

              {sessionId !== 'all' && (
                <div className="flex items-center justify-between pt-3 flex-shrink-0">
                  <div className="flex items-center gap-3">
                    <button
                      onClick={() => setPromptValue(defaultPrompt)}
                      className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-700 transition-colors"
                    >
                      <RotateCcw className="h-3 w-3" /> Usa default come base
                    </button>
                    {hasCustom && (
                      <button
                        onClick={handleReset}
                        className="flex items-center gap-1.5 text-xs text-red-500 hover:text-red-700 transition-colors"
                      >
                        Rimuovi personalizzazione
                      </button>
                    )}
                  </div>
                  <Button
                    size="sm"
                    disabled={saving}
                    onClick={handleSave}
                    className="bg-indigo-600 hover:bg-indigo-700 text-white"
                  >
                    {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <><Save className="h-3.5 w-3.5 mr-1.5" />Salva per sessione</>}
                  </Button>
                </div>
              )}
            </>
          )}
        </div>
      ) : (
        <div className="flex-1 bg-white rounded-xl border border-slate-200 overflow-hidden min-h-0">
          <ProfileDemoChat profile={profile} />
        </div>
      )}
    </div>
  )
}

// ─── Main Page ────────────────────────────────────────────────────────────────

type Selected = { type: 'teacherbot'; id: string } | { type: 'profile'; profile: ChatbotProfile } | null

export default function TeacherDemoPage() {
  const [selected, setSelected] = useState<Selected>(null)
  const [selectedSessionId, setSelectedSessionId] = useState<string>('all')

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

  const { data: profilesData } = useQuery({
    queryKey: ['chatbot-profiles'],
    queryFn: async () => {
      const res = await llmApi.getChatbotProfiles()
      return Object.values(res.data as Record<string, ChatbotProfile>) as ChatbotProfile[]
    },
    staleTime: 1000 * 60 * 10,
  })

  // Load per-session overrides to show badge on cards
  const { data: sessionOverrides } = useQuery({
    queryKey: ['session-chatbot-profiles', selectedSessionId],
    queryFn: async () => {
      if (selectedSessionId === 'all') return []
      const res = await teacherApi.getSessionChatbotProfiles(selectedSessionId)
      return res.data as Array<{ profile_key: string; custom_prompt: string | null }>
    },
    enabled: selectedSessionId !== 'all',
    staleTime: 1000 * 30,
  })

  const customizedKeys = new Set(sessionOverrides?.filter(o => o.custom_prompt).map(o => o.profile_key) ?? [])

  const activeSessions = sessions?.filter(s => s.status === 'active') ?? []
  const otherSessions  = sessions?.filter(s => s.status !== 'active') ?? []

  // ── Teacherbot detail ──────────────────────────────────────────────────────
  if (selected?.type === 'teacherbot') {
    return (
      <div className="max-w-2xl mx-auto p-6">
        <TeacherbotTestChat teacherbotId={selected.id} onBack={() => setSelected(null)} />
      </div>
    )
  }

  // ── Profile detail ─────────────────────────────────────────────────────────
  if (selected?.type === 'profile') {
    return (
      <div className="max-w-3xl mx-auto p-6 md:p-8 h-full">
        <ProfileDetailView
          profile={selected.profile}
          sessionId={selectedSessionId}
          onBack={() => setSelected(null)}
        />
      </div>
    )
  }

  // ── Grid view ──────────────────────────────────────────────────────────────
  return (
    <div className="max-w-3xl mx-auto p-6 md:p-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-800 mb-1">Vista Studente</h1>
        <p className="text-slate-500 text-sm">
          Esplora e personalizza i chatbot che vedono i tuoi studenti. Seleziona una sessione e clicca su un profilo per modificarne il comportamento.
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
            <option value="all">Tutti i chatbot (sola lettura)</option>
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
        {selectedSessionId !== 'all' && (
          <p className="mt-1.5 text-xs text-indigo-600 font-medium">
            Clicca su un assistente base per personalizzare il suo comportamento per questa sessione.
          </p>
        )}
      </div>

      {/* Base profiles */}
      {profilesData && profilesData.length > 0 && (
        <div className="mb-8">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Assistenti base</h2>
            {selectedSessionId !== 'all' && customizedKeys.size > 0 && (
              <span className="text-xs text-indigo-600 font-medium">
                {customizedKeys.size} personalizzat{customizedKeys.size === 1 ? 'o' : 'i'}
              </span>
            )}
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {profilesData.map(p => {
              const s = PROFILE_STYLES[p.key] ?? FALLBACK_STYLE
              const isCustomized = customizedKeys.has(p.key)
              return (
                <button
                  key={p.key}
                  onClick={() => setSelected({ type: 'profile', profile: p })}
                  className={`aspect-square flex flex-col items-center justify-center p-4 rounded-2xl shadow-sm hover:shadow-md transition-all relative ${s.card}`}
                >
                  {isCustomized && (
                    <span className="absolute top-2 right-2 w-2 h-2 rounded-full bg-indigo-500" title="Prompt personalizzato" />
                  )}
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
              {selectedSessionId === 'all' ? 'Nessun chatbot creato' : 'Nessun chatbot pubblicato su questa sessione'}
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
