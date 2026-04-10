import { useState, useRef, useEffect, KeyboardEvent } from 'react'
import { Loader2, ChevronRight, Check, X, Sparkles } from 'lucide-react'
import { desktopAgentApi } from '@/lib/api'

export interface AgentAction {
  type: string
  [key: string]: unknown
}

export interface AgentResult {
  reply: string
  actions: AgentAction[]
  requires_confirmation: boolean
}

interface AgentSearchBarProps {
  desktopId: string
  wallpaperKey: string
  widgets: Array<{
    id: string; widget_type: string; config_json: Record<string, unknown>
    grid_x: number; grid_y: number; grid_w: number; grid_h: number
  }>
  calendarEvents?: Array<{
    id: string; title: string; event_date: string; event_time?: string
    description?: string; color: string
  }>
  session?: { id?: string; name?: string; class_name?: string } | null
  userName: string
  userRole: 'teacher' | 'student'
  onActionsConfirmed: (actions: AgentAction[]) => void
}

export default function AgentSearchBar({
  desktopId,
  wallpaperKey,
  widgets,
  calendarEvents = [],
  session,
  userName,
  userRole,
  onActionsConfirmed,
}: AgentSearchBarProps) {
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<AgentResult | null>(null)
  const [focused, setFocused] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)

  // Close panel on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        if (!loading) {
          setResult(null)
          setFocused(false)
        }
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [loading])

  const submit = async () => {
    const msg = input.trim()
    if (!msg || loading) return

    setLoading(true)
    setResult(null)
    try {
      const res = await desktopAgentApi.chat({
        message: msg,
        context: {
          desktop_id: desktopId,
          wallpaper_key: wallpaperKey,
          widgets,
          calendar_events: calendarEvents,
          session: session ?? null,
          user_name: userName,
          user_role: userRole,
        },
      })
      setResult(res.data as AgentResult)
      if (!(res.data as AgentResult).requires_confirmation) {
        // Auto-execute if no confirmation needed
        const actions = (res.data as AgentResult).actions
        if (actions.length > 0) {
          onActionsConfirmed(actions)
        }
      }
    } catch (err) {
      setResult({
        reply: 'Si è verificato un errore. Riprova tra poco.',
        actions: [],
        requires_confirmation: false,
      })
    } finally {
      setLoading(false)
    }
  }

  const confirm = () => {
    if (!result) return
    onActionsConfirmed(result.actions)
    setResult(null)
    setInput('')
    inputRef.current?.blur()
    setFocused(false)
  }

  const dismiss = () => {
    setResult(null)
    setInput('')
    setFocused(false)
  }

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') submit()
    if (e.key === 'Escape') {
      setResult(null)
      setFocused(false)
      inputRef.current?.blur()
    }
  }

  const hasActions = (result?.actions.length ?? 0) > 0

  return (
    <div ref={panelRef} className="relative flex-1 min-w-0">
      {/* Input bar */}
      <div
        className={`
          flex items-center gap-2 h-8 px-3 rounded-xl
          bg-black/25 backdrop-blur-md
          ring-1 transition-all duration-200
          ${focused || result ? 'ring-white/30 bg-black/35' : 'ring-white/10'}
        `}
      >
        {loading ? (
          <Loader2 className="h-3.5 w-3.5 text-indigo-400 animate-spin flex-shrink-0" />
        ) : (
          <Sparkles className="h-3.5 w-3.5 text-indigo-400/70 flex-shrink-0" />
        )}
        <span className="text-white/30 text-sm font-mono select-none">›</span>
        <input
          ref={inputRef}
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={onKeyDown}
          onFocus={() => setFocused(true)}
          placeholder={loading ? 'Sto elaborando...' : 'Cosa vuoi che faccia?'}
          disabled={loading}
          className="flex-1 bg-transparent text-sm text-white placeholder-white/25 outline-none font-mono caret-indigo-400 min-w-0"
        />
        {input && !loading && (
          <button
            onClick={submit}
            className="flex-shrink-0 text-[10px] text-white/30 hover:text-white/60 px-1 transition-colors"
          >
            ↵
          </button>
        )}
      </div>

      {/* Response panel */}
      {result && (
        <div
          className="absolute top-full left-0 right-0 mt-1.5 z-50
            bg-[#0f0f1a]/95 backdrop-blur-xl
            ring-1 ring-white/15 rounded-xl
            shadow-2xl shadow-black/50
            overflow-hidden"
        >
          {/* Reply text */}
          <div className="px-4 py-3 text-sm text-white/80 leading-relaxed border-b border-white/8">
            <div className="flex items-start gap-2">
              <Sparkles className="h-3.5 w-3.5 text-indigo-400 flex-shrink-0 mt-0.5" />
              <span className="whitespace-pre-wrap">{result.reply}</span>
            </div>
          </div>

          {/* Actions preview */}
          {hasActions && (
            <div className="px-4 py-2 border-b border-white/8">
              <div className="text-[10px] text-white/30 uppercase tracking-wider mb-1.5">Azioni proposte</div>
              <div className="flex flex-col gap-1">
                {result.actions.map((action, i) => (
                  <ActionBadge key={i} action={action} />
                ))}
              </div>
            </div>
          )}

          {/* Confirmation buttons */}
          {result.requires_confirmation && hasActions ? (
            <div className="flex items-center gap-2 px-4 py-2.5">
              <button
                onClick={confirm}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-500/20 text-indigo-300 text-xs hover:bg-indigo-500/30 transition-colors"
              >
                <Check className="h-3 w-3" />
                Esegui
              </button>
              <button
                onClick={dismiss}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/5 text-white/40 text-xs hover:bg-white/10 transition-colors"
              >
                <X className="h-3 w-3" />
                Annulla
              </button>
              <span className="text-[10px] text-white/20 ml-auto">Premi Invio per confermare</span>
            </div>
          ) : (
            <div className="flex justify-end px-4 py-2">
              <button onClick={dismiss} className="text-[10px] text-white/30 hover:text-white/50 transition-colors">
                Chiudi
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function ActionBadge({ action }: { action: AgentAction }) {
  const labels: Record<string, (a: AgentAction) => string> = {
    create_widget: a => `Crea widget ${a.widget_type as string}${(a.config as any)?.text ? ` — "${String((a.config as any).text).slice(0, 40)}"` : ''}`,
    update_widget: a => `Modifica widget ${a.widget_id as string ? (a.widget_id as string).slice(0, 8) + '…' : ''}`,
    update_wallpaper: a => `Cambia sfondo → ${a.wallpaper_key as string}`,
    create_calendar_event: a => `Evento "${a.title as string}" il ${a.event_date as string}${a.event_time ? ` alle ${a.event_time as string}` : ''}`,
    update_calendar_note: a => `Nota personale il ${a.date as string}: "${String(a.note as string).slice(0, 40)}"`,
  }

  const colors: Record<string, string> = {
    create_widget: 'text-emerald-400 bg-emerald-400/10',
    update_widget: 'text-amber-400 bg-amber-400/10',
    update_wallpaper: 'text-violet-400 bg-violet-400/10',
    create_calendar_event: 'text-blue-400 bg-blue-400/10',
    update_calendar_note: 'text-cyan-400 bg-cyan-400/10',
  }

  const label = labels[action.type]?.(action) ?? `${action.type}`
  const color = colors[action.type] ?? 'text-white/50 bg-white/5'

  return (
    <div className={`flex items-center gap-1.5 text-xs px-2 py-1 rounded-lg ${color}`}>
      <ChevronRight className="h-2.5 w-2.5 flex-shrink-0" />
      <span>{label}</span>
    </div>
  )
}
