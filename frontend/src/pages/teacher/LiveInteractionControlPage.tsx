import { useState, useEffect, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { io, Socket } from 'socket.io-client'
import { motion } from 'framer-motion'
import { useAuthStore } from '@/stores/auth'
import { liveInteractionApi } from '@/lib/api'
import { useToast } from '@/components/ui/use-toast'
import {
  Play, SkipForward, Square, Users, Clock, CheckCircle2,
  ListChecks, CloudLightning, MessageSquare, ThumbsUp, Zap, ArrowLeft, Trophy,
} from 'lucide-react'

// ── Types ──

type SlideType = 'mcq' | 'wordwall' | 'opinion' | 'feedback'

interface Slide {
  type: SlideType
  question?: string
  prompt?: string
  options?: string[]
  correct_option?: number | null
  max_seconds: number
  show_ranking?: boolean
  max_words?: number
}

interface LiveState {
  live_interaction_id: string
  title: string
  status: 'ACTIVE' | 'CLOSED'
  current_slide_index: number
  total_slides: number
  current_slide: Slide | null
  current_slide_started_at: string | null
  response_count: number
  total_students: number
}

interface ResponseItem {
  student_nickname: string
  response: Record<string, unknown>
  created_at: string
}

interface ResultsData {
  live_interaction_id: string
  title: string
  status: string
  slides: Slide[]
  results: Array<{
    slide_index: number
    slide_config: Slide
    responses: ResponseItem[]
  }>
}

// ── Visual constants ──

const SLIDE_GRAD: Record<SlideType, string> = {
  mcq:      'from-indigo-500 to-purple-600',
  wordwall: 'from-amber-400 to-orange-500',
  opinion:  'from-emerald-500 to-teal-600',
  feedback: 'from-rose-500 to-pink-600',
}

const SLIDE_LABEL: Record<SlideType, string> = {
  mcq: 'Risposta multipla', wordwall: 'Word Wall', opinion: 'Opinione libera', feedback: 'Feedback rapido',
}

const SLIDE_ICON: Record<SlideType, React.ElementType> = {
  mcq: ListChecks, wordwall: CloudLightning, opinion: MessageSquare, feedback: ThumbsUp,
}

const MCQ_COLORS = ['#6366f1', '#f59e0b', '#10b981', '#ef4444', '#8b5cf6', '#06b6d4']

const WW_TAGS = [
  'bg-indigo-100 text-indigo-700',
  'bg-amber-100 text-amber-700',
  'bg-rose-100 text-rose-700',
  'bg-emerald-100 text-emerald-700',
  'bg-purple-100 text-purple-700',
  'bg-cyan-100 text-cyan-700',
  'bg-orange-100 text-orange-700',
  'bg-teal-100 text-teal-700',
]

const AVATAR_COLORS = [
  'bg-indigo-500', 'bg-purple-500', 'bg-emerald-500',
  'bg-rose-500', 'bg-amber-500', 'bg-cyan-500', 'bg-orange-500', 'bg-teal-500',
]

// ── SVG Ring gauge (timer + response count) ──

function RingGauge({ value, max, topLabel, bottomLabel, urgent = false, success = false }: {
  value: number | null; max: number; topLabel: React.ReactNode; bottomLabel: string
  urgent?: boolean; success?: boolean
}) {
  const r = 38
  const circ = 2 * Math.PI * r
  const pct = value !== null && max > 0 ? Math.min(1, value / max) : (value !== null ? 1 : 0)
  const dash = circ * pct
  const stroke = urgent ? '#ef4444' : success ? '#10b981' : '#6366f1'
  const track = urgent ? '#fee2e2' : success ? '#d1fae5' : '#e0e7ff'
  return (
    <div className="relative w-28 h-28">
      <svg className="absolute inset-0 -rotate-90 w-full h-full" viewBox="0 0 84 84">
        <circle cx="42" cy="42" r={r} fill="none" stroke={track} strokeWidth="7" />
        <circle
          cx="42" cy="42" r={r} fill="none"
          stroke={stroke} strokeWidth="7" strokeLinecap="round"
          strokeDasharray={`${dash} ${circ}`}
          style={{ transition: 'stroke-dasharray 0.9s ease, stroke 0.4s ease' }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-0.5">
        <div className={`text-[28px] font-black tabular-nums leading-none ${
          urgent ? 'text-red-600' : success ? 'text-emerald-600' : 'text-slate-800'
        }`}>
          {topLabel}
        </div>
        <div className="text-[11px] text-slate-400 font-medium">{bottomLabel}</div>
      </div>
    </div>
  )
}

// ── Charts ──

function McqBars({ responses, options, correctOption }: {
  responses: ResponseItem[]; options: string[]; correctOption?: number | null
}) {
  const total = responses.length || 1
  const counts = options.map((opt, i) => ({
    label: String.fromCharCode(65 + i),
    name: opt || `Opzione ${String.fromCharCode(65 + i)}`,
    value: responses.filter(r => r.response.selected_option === i).length,
    isCorrect: correctOption !== null && correctOption !== undefined && correctOption === i,
    color: (correctOption !== null && correctOption !== undefined)
      ? (correctOption === i ? '#10b981' : '#94a3b8')
      : MCQ_COLORS[i % MCQ_COLORS.length],
  }))
  if (responses.length === 0) {
    return <p className="text-sm text-slate-400 py-4 text-center">In attesa delle risposte...</p>
  }
  return (
    <div className="space-y-3">
      {counts.map((item, i) => (
        <div key={i} className="flex items-center gap-3">
          <div className={`w-9 h-9 rounded-xl flex items-center justify-center text-sm font-bold flex-shrink-0 shadow-sm ${
            item.isCorrect ? 'bg-emerald-500 text-white' : 'bg-slate-100 text-slate-600'
          }`}>
            {item.label}
          </div>
          <div className="flex-1">
            <div className="flex justify-between items-center text-sm mb-1.5">
              <span className="text-slate-700 truncate max-w-[190px] font-medium">{item.name}</span>
              <span className="font-bold text-slate-800 tabular-nums ml-2 flex-shrink-0">
                {item.value}
                <span className="text-xs text-slate-400 font-normal ml-1">
                  ({Math.round((item.value / total) * 100)}%)
                </span>
              </span>
            </div>
            <div className="h-4 rounded-full bg-slate-100 overflow-hidden shadow-inner">
              <div
                className="h-full rounded-full transition-all duration-700"
                style={{
                  width: `${Math.max(item.value > 0 ? 4 : 0, (item.value / total) * 100)}%`,
                  backgroundColor: item.color,
                }}
              />
            </div>
          </div>
          {item.isCorrect && <CheckCircle2 className="h-4 w-4 text-emerald-500 flex-shrink-0" />}
        </div>
      ))}
    </div>
  )
}

function McqRanking({ responses, correctOption }: {
  responses: ResponseItem[]; correctOption: number
}) {
  const correct = responses
    .filter(r => r.response.selected_option === correctOption)
    .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
    .slice(0, 10)

  const podiumStyle = [
    'from-yellow-50 to-amber-50 border-amber-300',
    'from-slate-50 to-gray-100 border-slate-300',
    'from-orange-50 to-amber-50 border-orange-200',
  ]
  const medals = ['🥇', '🥈', '🥉']

  if (correct.length === 0) {
    return (
      <div className="text-center py-5 text-slate-400 text-sm">
        <Trophy className="h-8 w-8 mx-auto mb-2 opacity-25" />
        Nessuna risposta corretta ancora
      </div>
    )
  }
  return (
    <div className="space-y-2">
      {correct.map((r, i) => (
        <motion.div
          key={`${r.student_nickname}-${i}`}
          initial={{ opacity: 0, x: -20 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: i * 0.07, duration: 0.3, type: 'spring', stiffness: 200 }}
          className={`flex items-center gap-3 px-4 py-2.5 rounded-xl border bg-gradient-to-r ${podiumStyle[i] || 'from-white to-slate-50 border-slate-200'}`}
        >
          <span className="text-xl w-8 text-center flex-shrink-0">
            {i < 3 ? medals[i] : <span className="text-sm font-bold text-slate-500">{i + 1}°</span>}
          </span>
          <span className="font-semibold text-slate-800 flex-1 truncate">{r.student_nickname}</span>
          <span className="text-xs text-slate-400 flex-shrink-0 tabular-nums">
            {new Date(r.created_at).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
          </span>
        </motion.div>
      ))}
      <p className="text-xs text-slate-400 text-center pt-1">
        {correct.length} corrette su {responses.length} risposte totali
      </p>
    </div>
  )
}

function WordwallCloud({ responses }: { responses: ResponseItem[] }) {
  const counts: Record<string, number> = {}
  responses.forEach(r => {
    ((r.response.words as string[]) || []).forEach(w => {
      const n = w.toLowerCase().trim()
      if (n) counts[n] = (counts[n] || 0) + 1
    })
  })
  const data = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 24)
  const maxCount = data[0]?.[1] || 1
  if (data.length === 0) return <p className="text-sm text-slate-400 py-4 text-center">In attesa delle parole...</p>
  return (
    <div className="flex flex-wrap gap-2.5 py-2">
      {data.map(([word, count], i) => (
        <motion.span
          key={word}
          initial={{ opacity: 0, scale: 0.7 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: i * 0.04, type: 'spring', stiffness: 260, damping: 20 }}
          className={`inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full font-semibold shadow-sm ${WW_TAGS[i % WW_TAGS.length]}`}
          style={{ fontSize: `${Math.max(13, Math.min(28, 13 + (count / maxCount) * 15))}px` }}
        >
          {word}
          {count > 1 && <span className="text-xs opacity-50 font-normal">×{count}</span>}
        </motion.span>
      ))}
    </div>
  )
}

function OpinionBubbles({ responses }: { responses: ResponseItem[] }) {
  if (responses.length === 0) return <p className="text-sm text-slate-400 py-4 text-center">In attesa delle opinioni...</p>
  return (
    <div className="space-y-3 max-h-64 overflow-y-auto pr-1">
      {responses.map((r, i) => (
        <div key={i} className="flex gap-3 items-start">
          <div className={`w-9 h-9 rounded-full ${AVATAR_COLORS[i % AVATAR_COLORS.length]} flex items-center justify-center text-white text-sm font-bold flex-shrink-0 shadow-sm`}>
            {(r.student_nickname || '?')[0].toUpperCase()}
          </div>
          <div className="flex-1 bg-slate-50 rounded-2xl rounded-tl-sm px-4 py-3 border border-slate-100">
            <div className="text-xs font-semibold text-slate-500 mb-1">{r.student_nickname}</div>
            <div className="text-sm text-slate-800 leading-relaxed">{r.response.text as string}</div>
          </div>
        </div>
      ))}
    </div>
  )
}

function FeedbackBars({ responses }: { responses: ResponseItem[] }) {
  const counts = {
    positive: responses.filter(r => r.response.sentiment === 'positive').length,
    neutral:  responses.filter(r => r.response.sentiment === 'neutral').length,
    negative: responses.filter(r => r.response.sentiment === 'negative').length,
  }
  const total = responses.length || 1
  const items = [
    { key: 'positive' as const, emoji: '😊', label: 'Positivo', color: 'bg-emerald-500' },
    { key: 'neutral'  as const, emoji: '😐', label: 'Neutro',   color: 'bg-amber-400' },
    { key: 'negative' as const, emoji: '😞', label: 'Negativo', color: 'bg-red-400' },
  ]
  return (
    <div className="space-y-5">
      {items.map(({ key, emoji, label, color }) => {
        const pct = Math.round((counts[key] / total) * 100)
        return (
          <div key={key} className="flex items-center gap-4">
            <span className="text-4xl w-12 text-center flex-shrink-0">{emoji}</span>
            <div className="flex-1">
              <div className="flex justify-between text-sm mb-2">
                <span className="font-semibold text-slate-700">{label}</span>
                <span className="font-bold text-slate-800 tabular-nums">
                  {counts[key]}
                  <span className="text-xs text-slate-400 font-normal ml-1">({pct}%)</span>
                </span>
              </div>
              <div className="h-5 rounded-full bg-slate-100 overflow-hidden shadow-inner">
                <div
                  className={`h-full rounded-full ${color} transition-all duration-700 shadow-sm`}
                  style={{ width: `${Math.max(counts[key] > 0 ? 5 : 0, pct)}%` }}
                />
              </div>
            </div>
          </div>
        )
      })}
      {responses.length === 0 && (
        <p className="text-sm text-slate-400 text-center py-2">In attesa dei feedback...</p>
      )}
    </div>
  )
}

// ── Timer hook ──

function useTimer(startedAt: string | null | undefined, maxSeconds: number, active: boolean) {
  const [remaining, setRemaining] = useState<number | null>(null)
  useEffect(() => {
    if (!startedAt || !active) { setRemaining(null); return }
    const tick = () => {
      const elapsed = (Date.now() - new Date(startedAt).getTime()) / 1000
      setRemaining(Math.max(0, Math.round(maxSeconds - elapsed)))
    }
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [startedAt, maxSeconds, active])
  return remaining
}

// ── Slide chart dispatcher ──

function SlideChart({ slide, responses }: { slide: Slide; responses: ResponseItem[] }) {
  if (slide.type === 'mcq') {
    return (
      <div className="space-y-4">
        <McqBars responses={responses} options={slide.options || []} correctOption={slide.correct_option} />
        {slide.show_ranking && slide.correct_option !== null && slide.correct_option !== undefined && (
          <div className="border-t border-slate-100 pt-4 mt-4">
            <div className="flex items-center gap-2 mb-3">
              <Trophy className="h-4 w-4 text-amber-500" />
              <h4 className="text-sm font-bold text-slate-700">Classifica velocità</h4>
            </div>
            <McqRanking responses={responses} correctOption={slide.correct_option} />
          </div>
        )}
      </div>
    )
  }
  if (slide.type === 'wordwall') return <WordwallCloud responses={responses} />
  if (slide.type === 'opinion')  return <OpinionBubbles responses={responses} />
  if (slide.type === 'feedback') return <FeedbackBars responses={responses} />
  return null
}

// ── Main page ──

export default function LiveInteractionControlPage() {
  const { interactionId } = useParams<{ interactionId: string }>()
  const navigate = useNavigate()
  const { toast } = useToast()
  const queryClient = useQueryClient()
  const socketRef = useRef<Socket | null>(null)

  const [liveState, setLiveState] = useState<LiveState | null>(null)
  const [answerCount, setAnswerCount] = useState<{ count: number; total: number } | null>(null)

  const { data: interaction, isLoading } = useQuery({
    queryKey: ['live-interaction', interactionId],
    queryFn: () => liveInteractionApi.get(interactionId!).then(r => r.data),
    enabled: !!interactionId,
  })

  const { data: results, refetch: refetchResults } = useQuery<ResultsData>({
    queryKey: ['live-interaction-results', interactionId],
    queryFn: () => liveInteractionApi.results(interactionId!).then(r => r.data),
    enabled: false,
    staleTime: 0,
  })

  useEffect(() => {
    if (interaction?.status === 'ACTIVE' || interaction?.status === 'CLOSED') {
      refetchResults()
    }
  }, [interaction?.status])

  useEffect(() => {
    if (!interaction?.session_id) return
    const { accessToken } = useAuthStore.getState()
    if (!accessToken) return

    const socket = io(window.location.origin, {
      path: '/socket.io',
      auth: { token: accessToken },
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionDelay: 2000,
    })
    socketRef.current = socket

    socket.on('connect', () => {
      socket.emit('join_session', { session_id: interaction.session_id })
    })

    socket.on('live_interaction_state', (data: LiveState) => {
      if (data.live_interaction_id !== interactionId) return
      setLiveState(data)
      setAnswerCount({ count: data.response_count, total: data.total_students })
      if (data.status === 'CLOSED') {
        refetchResults()
        queryClient.invalidateQueries({ queryKey: ['live-interaction', interactionId] })
      }
    })

    socket.on('live_interaction_answer_count', (data: {
      live_interaction_id: string; slide_index: number
      response_count: number; total_students: number; all_answered: boolean
    }) => {
      if (data.live_interaction_id !== interactionId) return
      setAnswerCount({ count: data.response_count, total: data.total_students })
      refetchResults()
      if (data.all_answered) toast({ title: '✓ Tutti gli studenti hanno risposto!' })
    })

    return () => { socket.disconnect(); socketRef.current = null }
  }, [interaction?.session_id, interactionId])

  // ── Mutations ──

  const startMutation = useMutation({
    mutationFn: () => liveInteractionApi.start(interactionId!),
    onSuccess: (res) => {
      setLiveState(prev => ({
        live_interaction_id: interactionId!,
        title: interaction?.title || '',
        status: 'ACTIVE',
        current_slide_index: res.data.current_slide_index,
        total_slides: interaction?.slides_json?.length || 0,
        current_slide: interaction?.slides_json?.[res.data.current_slide_index] || null,
        current_slide_started_at: new Date().toISOString(),
        response_count: 0,
        total_students: prev?.total_students || 0,
      }))
      setAnswerCount(prev => ({ count: 0, total: prev?.total || 0 }))
      refetchResults()
    },
    onError: () => toast({ title: 'Errore nell\'avvio', variant: 'destructive' }),
  })

  const nextMutation = useMutation({
    mutationFn: () => liveInteractionApi.next(interactionId!),
    onSuccess: (res) => {
      if (res.data.status === 'CLOSED') {
        setLiveState(prev => prev ? { ...prev, status: 'CLOSED' } : null)
        refetchResults()
      } else {
        const nextIdx = res.data.current_slide_index
        setLiveState(prev => prev ? {
          ...prev,
          current_slide_index: nextIdx,
          current_slide: interaction?.slides_json?.[nextIdx] || null,
          current_slide_started_at: new Date().toISOString(),
          response_count: 0,
        } : null)
        setAnswerCount(prev => ({ count: 0, total: prev?.total || 0 }))
        refetchResults()
      }
    },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      toast({ title: msg || 'Errore durante l\'avanzamento', variant: 'destructive' })
    },
  })

  const endMutation = useMutation({
    mutationFn: () => liveInteractionApi.end(interactionId!),
    onSuccess: () => {
      setLiveState(prev => prev ? { ...prev, status: 'CLOSED' } : null)
      refetchResults()
    },
    onError: () => toast({ title: 'Errore', variant: 'destructive' }),
  })

  // ── Derived state ──

  const status = liveState?.status || interaction?.status
  const currentSlide: Slide | null = liveState?.current_slide
    || (interaction?.slides_json?.[liveState?.current_slide_index ?? interaction?.current_slide_index ?? 0]) || null
  const slideIndex     = liveState?.current_slide_index ?? interaction?.current_slide_index ?? 0
  const totalSlides    = liveState?.total_slides ?? interaction?.slides_json?.length ?? 0
  const responseCount  = answerCount?.count ?? liveState?.response_count ?? 0
  const totalStudents  = answerCount?.total ?? liveState?.total_students ?? 0
  const startedAt      = liveState?.current_slide_started_at
  const isLastSlide    = slideIndex >= totalSlides - 1
  const isClosed       = status === 'CLOSED'
  const isActive       = status === 'ACTIVE'
  const isDraft        = !status || status === 'DRAFT'
  const remaining      = useTimer(startedAt, currentSlide?.max_seconds || 60, isActive)
  const timerUrgent    = remaining !== null && remaining <= 10
  const allAnswered    = totalStudents > 0 && responseCount >= totalStudents

  const currentSlideResults = results?.results.find(r => r.slide_index === slideIndex)?.responses || []

  if (isLoading) return (
    <div className="flex items-center justify-center h-full">
      <div className="text-slate-400">Caricamento...</div>
    </div>
  )

  if (!interaction) return (
    <div className="flex items-center justify-center h-full">
      <div className="text-center">
        <p className="text-slate-500 mb-4">Sessione non trovata.</p>
        <button onClick={() => navigate('/teacher/live-interaction')} className="text-indigo-600 hover:underline text-sm">
          ← Torna alla lista
        </button>
      </div>
    </div>
  )

  const SlideIcon = currentSlide ? SLIDE_ICON[currentSlide.type] : Zap
  const slideGrad  = currentSlide ? SLIDE_GRAD[currentSlide.type] : 'from-indigo-500 to-purple-600'

  return (
    <div className="max-w-5xl mx-auto px-4 py-6 space-y-6">

      {/* ── Header ── */}
      <div className="flex items-center gap-3">
        <button
          onClick={() => navigate('/teacher/live-interaction')}
          className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700 transition-colors flex-shrink-0"
        >
          <ArrowLeft className="h-4 w-4" /> Lista
        </button>
        <h1 className="flex-1 text-xl font-bold text-slate-800 truncate">{interaction.title}</h1>
        {isActive && (
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-100 text-emerald-700 text-sm font-semibold flex-shrink-0">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" /> LIVE
          </span>
        )}
        {isClosed && (
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-slate-100 text-slate-600 text-sm font-medium flex-shrink-0">
            <CheckCircle2 className="h-3.5 w-3.5" /> Completata
          </span>
        )}
        {isDraft && (
          <span className="px-3 py-1 rounded-full bg-amber-100 text-amber-700 text-sm font-medium flex-shrink-0">Bozza</span>
        )}
      </div>

      {/* ── DRAFT: start prompt ── */}
      {isDraft && (
        <div className="relative overflow-hidden bg-gradient-to-br from-indigo-600 via-purple-600 to-pink-600 rounded-3xl p-12 text-center text-white shadow-2xl">
          <div className="absolute top-0 right-0 w-72 h-72 bg-white/5 rounded-full -translate-y-24 translate-x-24" />
          <div className="absolute bottom-0 left-0 w-48 h-48 bg-white/5 rounded-full translate-y-16 -translate-x-12" />
          <div className="relative z-10">
            <div className="w-24 h-24 rounded-2xl bg-white/20 backdrop-blur-sm flex items-center justify-center mx-auto mb-6 shadow-inner">
              <Play className="h-12 w-12 text-white" />
            </div>
            <h2 className="text-3xl font-black mb-3">Pronto per iniziare?</h2>
            <p className="text-white/70 mb-8 text-base max-w-sm mx-auto">
              {totalSlides} {totalSlides === 1 ? 'domanda' : 'domande'} · Gli studenti vedranno la prima slide non appena premi Avvia
            </p>
            <button
              onClick={() => startMutation.mutate()}
              disabled={startMutation.isPending}
              className="inline-flex items-center gap-3 bg-white text-indigo-700 font-bold px-10 py-4 rounded-2xl shadow-xl hover:shadow-2xl hover:bg-indigo-50 transition-all duration-200 disabled:opacity-60 text-lg"
            >
              <Play className="h-6 w-6" />
              {startMutation.isPending ? 'Avvio in corso...' : 'Avvia sessione live'}
            </button>
          </div>
        </div>
      )}

      {/* ── ACTIVE: control panel ── */}
      {isActive && currentSlide && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">

          {/* Left: slide card + chart */}
          <div className="lg:col-span-2 space-y-4">

            {/* Slide card */}
            <div className="bg-white rounded-2xl shadow-sm overflow-hidden border border-slate-100">
              <div className={`bg-gradient-to-r ${slideGrad} px-5 py-3.5 flex items-center gap-2`}>
                <SlideIcon className="h-4 w-4 text-white/80" />
                <span className="text-white/90 text-sm font-semibold">{SLIDE_LABEL[currentSlide.type]}</span>
                <span className="ml-auto text-white/70 text-sm font-medium">
                  Slide {slideIndex + 1} / {totalSlides}
                </span>
              </div>
              <div className="px-6 py-5">
                <p className="text-xl font-bold text-slate-800 leading-snug">
                  {currentSlide.question || currentSlide.prompt}
                </p>
                {currentSlide.type === 'mcq' && currentSlide.options && (
                  <div className="mt-4 grid grid-cols-2 gap-2">
                    {currentSlide.options.map((opt, i) => (
                      <div key={i} className={`px-3 py-2 rounded-xl text-sm border font-medium ${
                        currentSlide.correct_option === i
                          ? 'border-emerald-300 bg-emerald-50 text-emerald-700'
                          : 'border-slate-200 bg-slate-50 text-slate-600'
                      }`}>
                        <span className="font-bold mr-1.5">{String.fromCharCode(65 + i)}.</span>{opt}
                      </div>
                    ))}
                  </div>
                )}
                {currentSlide.type === 'feedback' && (
                  <div className="mt-4 flex gap-3">
                    {[{ e: '😊', l: 'Positivo' }, { e: '😐', l: 'Neutro' }, { e: '😞', l: 'Negativo' }].map(({ e, l }) => (
                      <div key={l} className="flex items-center gap-1.5 px-3 py-2 rounded-xl border border-slate-200 bg-slate-50 text-sm text-slate-600">
                        <span>{e}</span> {l}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Live chart */}
            <div className="bg-white rounded-2xl shadow-sm border border-slate-100 px-6 py-5">
              <div className="flex items-center justify-between mb-5">
                <h3 className="text-sm font-bold text-slate-700">Risposte in tempo reale</h3>
                <span className="flex items-center gap-1.5 text-xs text-emerald-600 font-semibold">
                  <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" /> live
                </span>
              </div>
              <SlideChart slide={currentSlide} responses={currentSlideResults} />
            </div>
          </div>

          {/* Right: rings + controls */}
          <div className="flex flex-col gap-4">

            {/* Rings */}
            <div className="bg-white rounded-2xl shadow-sm border border-slate-100 px-4 py-5">
              <div className="flex justify-around items-start">
                <div className="flex flex-col items-center gap-2">
                  <RingGauge
                    value={remaining}
                    max={currentSlide.max_seconds || 60}
                    topLabel={remaining ?? '—'}
                    bottomLabel="sec"
                    urgent={timerUrgent}
                  />
                  <div className="flex items-center gap-1 text-xs text-slate-500 font-medium">
                    <Clock className="h-3 w-3" /> Tempo
                  </div>
                </div>
                <div className="flex flex-col items-center gap-2">
                  <RingGauge
                    value={responseCount}
                    max={totalStudents || 1}
                    topLabel={responseCount}
                    bottomLabel={totalStudents > 0 ? `di ${totalStudents}` : 'risp.'}
                    success={allAnswered}
                  />
                  <div className="flex items-center gap-1 text-xs text-slate-500 font-medium">
                    <Users className="h-3 w-3" /> Risposte
                  </div>
                  {allAnswered && (
                    <span className="text-xs text-emerald-600 font-bold -mt-1">Tutti pronti! ✓</span>
                  )}
                </div>
              </div>
            </div>

            {/* Navigation buttons */}
            <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-4 space-y-3">
              <button
                onClick={() => nextMutation.mutate()}
                disabled={nextMutation.isPending}
                className={`w-full flex items-center justify-center gap-2 font-bold py-4 rounded-xl text-white transition-all duration-200 shadow-lg hover:shadow-xl hover:scale-[1.02] active:scale-[0.98] disabled:opacity-60 disabled:cursor-not-allowed text-base ${
                  isLastSlide
                    ? 'bg-gradient-to-r from-emerald-500 to-teal-600'
                    : 'bg-gradient-to-r from-indigo-500 to-purple-600'
                }`}
              >
                {isLastSlide ? <CheckCircle2 className="h-5 w-5" /> : <SkipForward className="h-5 w-5" />}
                {nextMutation.isPending ? 'Avanzamento...' : isLastSlide ? 'Termina sessione' : 'Prossima slide →'}
              </button>
              <button
                onClick={() => { if (confirm('Terminare la sessione anticipatamente?')) endMutation.mutate() }}
                disabled={endMutation.isPending}
                className="w-full flex items-center justify-center gap-2 font-medium py-2.5 rounded-xl border border-red-200 text-red-600 bg-red-50 hover:bg-red-100 transition-all duration-200 disabled:opacity-60 text-sm"
              >
                <Square className="h-4 w-4" /> Termina ora
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── CLOSED: full report ── */}
      {isClosed && (
        <div className="space-y-5">

          {/* Banner */}
          <div className="relative overflow-hidden bg-gradient-to-r from-emerald-500 to-teal-600 rounded-2xl p-8 text-white text-center shadow-xl">
            <div className="absolute top-0 right-0 w-40 h-40 bg-white/10 rounded-full -translate-y-10 translate-x-10" />
            <div className="w-16 h-16 rounded-2xl bg-white/20 flex items-center justify-center mx-auto mb-4">
              <CheckCircle2 className="h-9 w-9 text-white" />
            </div>
            <h2 className="text-2xl font-black mb-1">Sessione completata!</h2>
            <p className="text-white/80 text-sm">
              {results?.results?.length || totalSlides} slide · {totalStudents} studenti partecipanti
            </p>
          </div>

          {/* Per-slide cards */}
          {results?.results.map(slideResult => {
            const slide = slideResult.slide_config
            const type  = slide.type as SlideType
            const SIcon = SLIDE_ICON[type] || Zap
            const grad  = SLIDE_GRAD[type] || 'from-indigo-500 to-purple-600'
            return (
              <div key={slideResult.slide_index} className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
                <div className={`bg-gradient-to-r ${grad} px-5 py-3.5 flex items-center gap-2`}>
                  <SIcon className="h-4 w-4 text-white/80" />
                  <span className="text-white/90 text-sm font-semibold">{SLIDE_LABEL[type]}</span>
                  <span className="ml-auto text-white/80 text-sm font-bold">
                    {slideResult.responses.length} {slideResult.responses.length === 1 ? 'risposta' : 'risposte'}
                  </span>
                </div>
                <div className="px-6 py-5">
                  <p className="font-bold text-slate-800 text-lg mb-5">{slide.question || slide.prompt}</p>
                  <SlideChart slide={slide} responses={slideResult.responses} />
                </div>
              </div>
            )
          })}

          {(!results || results.results.length === 0) && (
            <div className="text-center py-16 text-slate-400">
              <Zap className="h-14 w-14 mx-auto mb-4 opacity-15" />
              <p className="text-sm">Nessuna risposta raccolta.</p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
