import { useState, useEffect } from 'react'
import { Sparkles, Loader2, RefreshCw, ExternalLink } from 'lucide-react'
import { llmApi } from '@/lib/api'

interface OggiImparoConfig {
  cached_lesson?: string
  cached_date?: string  // 'YYYY-MM-DD'
}

interface OggiImparoWidgetProps {
  config: OggiImparoConfig
  onConfigChange: (config: OggiImparoConfig) => void
  userType?: 'teacher' | 'student'
  sessionName?: string
}

function todayISO(): string {
  return new Date().toISOString().slice(0, 10)
}

const DEFAULT_TOPICS = 'scienze, storia, geografia, tecnologia, matematica'

export default function OggiImparoWidget({
  config,
  onConfigChange,
  userType = 'student',
  sessionName,
}: OggiImparoWidgetProps) {
  const [lesson, setLesson] = useState<string>(config.cached_lesson ?? '')
  const [loading, setLoading] = useState(false)

  function chatCall(prompt: string, history: { role: string; content: string }[]) {
    if (userType === 'teacher') {
      return llmApi.teacherChat(prompt, history, 'default')
    }
    return llmApi.studentChat(prompt, history, 'default')
  }

  // Sync lesson from config when it changes (e.g. after save)
  useEffect(() => {
    if (config.cached_lesson && config.cached_date === todayISO()) {
      setLesson(config.cached_lesson)
    }
  }, [config.cached_lesson, config.cached_date])

  // Fetch on mount if no valid cache
  useEffect(() => {
    const today = todayISO()
    if (config.cached_date === today && config.cached_lesson) return
    fetchLesson()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function fetchLesson() {
    if (loading) return
    setLoading(true)
    const context = sessionName
      ? `Il contesto scolastico di oggi è: "${sessionName}".`
      : `Scegli un argomento a caso tra: ${DEFAULT_TOPICS}.`
    const prompt = `Genera una microlezione educativa breve in italiano per studenti delle scuole superiori o universitari. ${context} La microlezione deve essere un fatto interessante, un concetto chiave o una curiosità stimolante. MASSIMO 380 caratteri. Rispondi SOLO con il testo della microlezione, senza titoli né introduzioni.`
    try {
      const res = await chatCall(prompt, [])
      const text: string = res.data?.response ?? res.data?.content ?? ''
      const truncated = text.trim().slice(0, 400)
      setLesson(truncated)
      onConfigChange({ ...config, cached_lesson: truncated, cached_date: todayISO() })
    } catch {
      setLesson('Non è stato possibile caricare la microlezione. Riprova.')
    } finally {
      setLoading(false)
    }
  }

  function handleExpand() {
    // Dispatch a custom event — StudentDashboard listens and navigates to chatbot
    window.dispatchEvent(new CustomEvent('oggi-imparo:expand', {
      detail: { lesson, sessionName },
    }))
  }

  const today = new Date().toLocaleDateString('it-IT', {
    weekday: 'long', day: 'numeric', month: 'long',
  })

  return (
    <div className="h-full flex flex-col text-white select-none p-3 gap-3">
      {/* Header */}
      <div className="flex items-center justify-between flex-shrink-0">
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded-lg bg-violet-500/20 flex items-center justify-center flex-shrink-0">
            <Sparkles className="h-3.5 w-3.5 text-violet-400" />
          </div>
          <span className="text-xs font-bold text-white/80">Oggi Imparo</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] text-white/30 capitalize hidden sm:block">{today}</span>
          <button
            onClick={fetchLesson}
            disabled={loading}
            className="p-1 rounded-lg hover:bg-white/10 transition-colors text-white/30 hover:text-white/60"
            title="Nuova microlezione"
          >
            <RefreshCw className={`h-3 w-3 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* Lesson text */}
      <div className="flex-1 overflow-hidden">
        {loading ? (
          <div className="flex items-start gap-2 text-white/30">
            <Loader2 className="h-3.5 w-3.5 animate-spin mt-0.5 flex-shrink-0" />
            <span className="text-xs">Generazione microlezione...</span>
          </div>
        ) : (
          <p className="text-sm text-white/80 leading-relaxed font-light line-clamp-6">
            {lesson || '—'}
          </p>
        )}
      </div>

      {/* Expand button */}
      {!loading && lesson && (
        <div className="flex-shrink-0">
          <button
            onClick={handleExpand}
            className="flex items-center gap-1.5 text-[11px] font-semibold text-violet-400 hover:text-violet-300 transition-colors group"
          >
            <ExternalLink className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
            Espandi con il chatbot
          </button>
        </div>
      )}
    </div>
  )
}
