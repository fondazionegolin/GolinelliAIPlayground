import { useState, useEffect, useCallback, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { io, Socket } from 'socket.io-client'
import { liveInteractionApi } from '@/lib/api'
import { useToast } from '@/components/ui/use-toast'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import {
  Clock, Users, CheckCircle2, Zap, CloudLightning,
  ListChecks, MessageSquare, ThumbsUp, BarChart2, ArrowRight,
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
  active: boolean
  live_interaction_id?: string
  title?: string
  current_slide_index?: number
  total_slides?: number
  current_slide?: Slide
  current_slide_started_at?: string
  already_answered?: boolean
  response_count?: number
  total_students?: number
}

interface Props {
  sessionId: string
}

// ── Visual constants ──

const SLIDE_GRAD: Record<SlideType, string> = {
  mcq:      'from-indigo-500 to-purple-600',
  wordwall: 'from-amber-400 to-orange-500',
  opinion:  'from-emerald-500 to-teal-600',
  feedback: 'from-rose-500 to-pink-600',
}

const SLIDE_SUBMIT: Record<SlideType, string> = {
  mcq:      'from-indigo-500 to-purple-600 hover:from-indigo-600 hover:to-purple-700 shadow-indigo-200',
  wordwall: 'from-amber-400 to-orange-500 hover:from-amber-500 hover:to-orange-600 shadow-amber-200',
  opinion:  'from-emerald-500 to-teal-600 hover:from-emerald-600 hover:to-teal-700 shadow-emerald-200',
  feedback: 'from-rose-500 to-pink-600 hover:from-rose-600 hover:to-pink-700 shadow-rose-200',
}

const SLIDE_LABEL: Record<SlideType, string> = {
  mcq: 'Risposta multipla', wordwall: 'Word Wall', opinion: 'Opinione libera', feedback: 'Feedback rapido',
}

const SLIDE_ICON: Record<SlideType, React.ElementType> = {
  mcq: ListChecks, wordwall: CloudLightning, opinion: MessageSquare, feedback: ThumbsUp,
}

// ── Timer hook ──

function useTimer(startedAt: string | null | undefined, maxSeconds: number) {
  const [remaining, setRemaining] = useState<number | null>(null)
  useEffect(() => {
    if (!startedAt) { setRemaining(null); return }
    const tick = () => {
      const elapsed = (Date.now() - new Date(startedAt).getTime()) / 1000
      setRemaining(Math.max(0, Math.round(maxSeconds - elapsed)))
    }
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [startedAt, maxSeconds])
  return remaining
}

// ── Input components ──

function McqInput({ options, selected, onSelect, disabled, slideType }: {
  options: string[]; selected: number | null; onSelect: (i: number) => void
  disabled: boolean; slideType: SlideType
}) {
  const selectedBg: Record<SlideType, string> = {
    mcq:      'border-indigo-500 bg-indigo-500 text-white shadow-lg shadow-indigo-200',
    wordwall: 'border-amber-500 bg-amber-500 text-white shadow-lg shadow-amber-200',
    opinion:  'border-emerald-500 bg-emerald-500 text-white shadow-lg shadow-emerald-200',
    feedback: 'border-rose-500 bg-rose-500 text-white shadow-lg shadow-rose-200',
  }
  return (
    <div className="space-y-2.5">
      {options.map((opt, i) => {
        const isSelected = selected === i
        return (
          <motion.button
            key={i}
            disabled={disabled}
            onClick={() => onSelect(i)}
            whileTap={!disabled ? { scale: 0.98 } : {}}
            className={`w-full flex items-center gap-3 px-4 py-3.5 rounded-2xl border-2 text-left transition-all duration-150 font-medium text-base ${
              isSelected
                ? selectedBg[slideType]
                : disabled
                ? 'border-slate-200 text-slate-400 cursor-not-allowed bg-slate-50'
                : 'border-slate-200 hover:border-indigo-300 hover:bg-indigo-50/40 text-slate-700 bg-white'
            }`}
          >
            <span className={`w-9 h-9 rounded-xl flex items-center justify-center text-sm font-bold flex-shrink-0 transition-colors ${
              isSelected ? 'bg-white/25 text-white' : 'bg-slate-100 text-slate-600'
            }`}>
              {String.fromCharCode(65 + i)}
            </span>
            <span className="leading-snug">{opt}</span>
          </motion.button>
        )
      })}
    </div>
  )
}

function WordwallInput({ maxWords, value, onChange, disabled }: {
  maxWords: number; value: string[]; onChange: (w: string[]) => void; disabled: boolean
}) {
  const [current, setCurrent] = useState('')
  const add = () => {
    const w = current.trim()
    if (!w || value.includes(w) || value.length >= maxWords) return
    onChange([...value, w])
    setCurrent('')
  }
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2 min-h-[2.5rem]">
        {value.map(w => (
          <span key={w} className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-amber-100 text-amber-800 rounded-full text-sm font-semibold">
            {w}
            {!disabled && (
              <button
                onClick={() => onChange(value.filter(x => x !== w))}
                className="w-4 h-4 rounded-full bg-amber-300 hover:bg-amber-400 text-amber-900 text-xs flex items-center justify-center font-bold transition-colors"
              >
                ×
              </button>
            )}
          </span>
        ))}
      </div>
      {!disabled && value.length < maxWords && (
        <div className="flex gap-2">
          <Input
            value={current}
            onChange={e => setCurrent(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); add() } }}
            placeholder={`Parola ${value.length + 1} di ${maxWords}...`}
            className="flex-1 rounded-xl border-slate-200 focus:border-amber-400 focus:ring-amber-200"
          />
          <button
            onClick={add}
            disabled={!current.trim()}
            className="px-4 py-2 rounded-xl bg-amber-100 text-amber-700 font-semibold text-sm hover:bg-amber-200 transition-colors disabled:opacity-50"
          >
            + Aggiungi
          </button>
        </div>
      )}
      <p className="text-xs text-slate-400 text-center">{value.length} / {maxWords} parole · Invio per aggiungere</p>
    </div>
  )
}

function FeedbackInput({ selected, onSelect, disabled }: {
  selected: 'positive' | 'neutral' | 'negative' | null
  onSelect: (s: 'positive' | 'neutral' | 'negative') => void
  disabled: boolean
}) {
  const opts = [
    { key: 'positive' as const, emoji: '😊', label: 'Positivo',
      active: 'bg-emerald-500 border-emerald-500 text-white shadow-xl shadow-emerald-200' },
    { key: 'neutral'  as const, emoji: '😐', label: 'Neutro',
      active: 'bg-amber-400 border-amber-400 text-white shadow-xl shadow-amber-200' },
    { key: 'negative' as const, emoji: '😞', label: 'Negativo',
      active: 'bg-red-500 border-red-500 text-white shadow-xl shadow-red-200' },
  ]
  return (
    <div className="flex gap-3 justify-center py-2">
      {opts.map(({ key, emoji, label, active }) => {
        const isSelected = selected === key
        return (
          <motion.button
            key={key}
            disabled={disabled}
            onClick={() => onSelect(key)}
            whileHover={!disabled ? { scale: 1.06, y: -2 } : {}}
            whileTap={!disabled ? { scale: 0.94 } : {}}
            animate={isSelected ? { scale: 1.08, y: -4 } : { scale: 1, y: 0 }}
            transition={{ type: 'spring', stiffness: 300, damping: 20 }}
            className={`flex flex-col items-center gap-2 px-5 py-5 rounded-3xl border-2 transition-colors duration-150 ${
              isSelected
                ? active
                : disabled
                ? 'border-slate-200 text-slate-400 cursor-not-allowed bg-white'
                : 'border-slate-200 hover:border-slate-300 text-slate-600 bg-white hover:shadow-md'
            }`}
          >
            <span className="text-5xl leading-none">{emoji}</span>
            <span className="text-sm font-bold">{label}</span>
          </motion.button>
        )
      })}
    </div>
  )
}

// ── Main overlay ──

export default function LiveInteractionStudentOverlay({ sessionId }: Props) {
  const { toast } = useToast()
  const socketRef = useRef<Socket | null>(null)
  const [liveState, setLiveState] = useState<LiveState | null>(null)
  const [answered, setAnswered] = useState(false)
  const [responseCount, setResponseCount] = useState(0)
  const [totalStudents, setTotalStudents] = useState(0)
  const [allAnswered, setAllAnswered] = useState(false)

  const [mcqSelected, setMcqSelected] = useState<number | null>(null)
  const [words, setWords] = useState<string[]>([])
  const [opinionText, setOpinionText] = useState('')
  const [sentiment, setSentiment] = useState<'positive' | 'neutral' | 'negative' | null>(null)

  const resetAnswerState = useCallback(() => {
    setAnswered(false)
    setMcqSelected(null)
    setWords([])
    setOpinionText('')
    setSentiment(null)
    setAllAnswered(false)
  }, [])

  useEffect(() => {
    liveInteractionApi.currentStudent().then(r => {
      const data = r.data
      if (data.active) {
        setLiveState(data)
        setAnswered(data.already_answered || false)
        setResponseCount(data.response_count || 0)
        setTotalStudents(data.total_students || 0)
      }
    }).catch(() => {})
  }, [sessionId])

  useEffect(() => {
    const studentToken = localStorage.getItem('student_token')
    if (!studentToken || !sessionId) return

    const socket = io(window.location.origin, {
      path: '/socket.io',
      auth: { token: studentToken },
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionDelay: 3000,
    })
    socketRef.current = socket

    const handleState = (data: {
      live_interaction_id: string; title: string; status: string
      current_slide_index: number; total_slides: number; current_slide: Slide
      current_slide_started_at: string; response_count: number; total_students: number
    }) => {
      if (data.status === 'CLOSED') {
        setLiveState(prev => prev ? { ...prev, status: 'CLOSED' } as LiveState : null)
        setTimeout(() => setLiveState(null), 2500)
        return
      }
      const newState: LiveState = {
        active: true,
        live_interaction_id: data.live_interaction_id,
        title: data.title,
        current_slide_index: data.current_slide_index,
        total_slides: data.total_slides,
        current_slide: data.current_slide,
        current_slide_started_at: data.current_slide_started_at,
        response_count: data.response_count,
        total_students: data.total_students,
      }
      setLiveState(prev => {
        if (prev?.current_slide_index !== data.current_slide_index) resetAnswerState()
        return newState
      })
      setResponseCount(data.response_count || 0)
      setTotalStudents(data.total_students || 0)
    }

    const handleCount = (data: {
      live_interaction_id: string; response_count: number; total_students: number; all_answered: boolean
    }) => {
      setResponseCount(data.response_count)
      setTotalStudents(data.total_students)
      if (data.all_answered) setAllAnswered(true)
    }

    socket.on('live_interaction_state', handleState)
    socket.on('live_interaction_answer_count', handleCount)

    return () => { socket.disconnect(); socketRef.current = null }
  }, [sessionId, resetAnswerState])

  const submit = async () => {
    if (!liveState?.live_interaction_id || liveState.current_slide_index === undefined) return
    const slide = liveState.current_slide
    if (!slide) return

    let response: object
    if (slide.type === 'mcq') {
      if (mcqSelected === null) { toast({ title: 'Seleziona una risposta', variant: 'destructive' }); return }
      response = { selected_option: mcqSelected }
    } else if (slide.type === 'wordwall') {
      if (words.length === 0) { toast({ title: 'Aggiungi almeno una parola', variant: 'destructive' }); return }
      response = { words }
    } else if (slide.type === 'opinion') {
      if (!opinionText.trim()) { toast({ title: 'Scrivi la tua opinione', variant: 'destructive' }); return }
      response = { text: opinionText.trim() }
    } else if (slide.type === 'feedback') {
      if (!sentiment) { toast({ title: 'Seleziona un feedback', variant: 'destructive' }); return }
      response = { sentiment }
    } else return

    try {
      await liveInteractionApi.submitAnswer({
        live_interaction_id: liveState.live_interaction_id,
        slide_index: liveState.current_slide_index,
        response,
      })
      setAnswered(true)
    } catch {
      toast({ title: 'Errore nell\'invio', variant: 'destructive' })
    }
  }

  const remaining = useTimer(
    liveState?.active && liveState.current_slide ? liveState.current_slide_started_at : null,
    liveState?.current_slide?.max_seconds || 60
  )

  const slide    = liveState?.current_slide
  const isClosed = (liveState as { status?: string })?.status === 'CLOSED'
  const timedOut = remaining === 0
  const showInput = slide && !answered && !timedOut && !isClosed
  const showResult = slide && (answered || timedOut || isClosed)

  const slideGrad   = slide ? SLIDE_GRAD[slide.type]   : 'from-indigo-500 to-purple-600'
  const submitGrad  = slide ? SLIDE_SUBMIT[slide.type] : 'from-indigo-500 to-purple-600 shadow-indigo-200'
  const SlideIcon   = slide ? SLIDE_ICON[slide.type]   : Zap
  const timerUrgent = remaining !== null && remaining <= 5

  const pct = remaining !== null && slide?.max_seconds
    ? (remaining / slide.max_seconds) * 100
    : 100

  return (
    <AnimatePresence>
      {liveState && (
        <motion.div
          key="overlay"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.25 }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.92, y: 30 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            transition={{ type: 'spring', stiffness: 280, damping: 28 }}
            className="bg-white rounded-3xl shadow-2xl w-full max-w-lg overflow-hidden"
          >
            {/* ── Gradient header ── */}
            <div className={`bg-gradient-to-r ${slideGrad} px-6 pt-5 pb-4`}>
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2 text-white/80 text-xs font-medium">
                  <Zap className="h-3.5 w-3.5" />
                  <span className="uppercase tracking-wide">Live</span>
                  <span className="opacity-60">·</span>
                  <span className="max-w-[160px] truncate opacity-90">{liveState.title}</span>
                </div>
                {slide && (
                  <span className="text-white/70 text-xs font-medium tabular-nums">
                    {(liveState.current_slide_index || 0) + 1} / {liveState.total_slides}
                  </span>
                )}
              </div>

              {/* Timer bar */}
              {!isClosed && remaining !== null && slide && (
                <div className="flex items-center gap-3">
                  <Clock className={`h-5 w-5 flex-shrink-0 ${timerUrgent ? 'text-white animate-pulse' : 'text-white/70'}`} />
                  <span className={`text-4xl font-black tabular-nums leading-none ${timerUrgent ? 'text-white' : 'text-white/95'}`}>
                    {remaining}
                    <span className="text-base font-medium ml-1 opacity-70">s</span>
                  </span>
                  <div className="flex-1 h-2.5 bg-white/20 rounded-full overflow-hidden ml-1">
                    <div
                      className="h-full bg-white/80 rounded-full transition-all duration-1000"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>
              )}

              {/* Slide type tag */}
              {slide && (
                <div className="mt-3 flex items-center gap-1.5">
                  <SlideIcon className="h-3.5 w-3.5 text-white/70" />
                  <span className="text-white/70 text-xs font-medium">{SLIDE_LABEL[slide.type]}</span>
                </div>
              )}
            </div>

            {/* ── Content ── */}
            <div className="px-6 py-5">
              {slide ? (
                <>
                  {/* Question */}
                  <p className="text-2xl font-bold text-slate-800 leading-snug mb-5">
                    {slide.question || slide.prompt}
                  </p>

                  {/* Input */}
                  {showInput && (
                    <div className="space-y-4">
                      {slide.type === 'mcq' && (
                        <McqInput
                          options={slide.options || []}
                          selected={mcqSelected}
                          onSelect={setMcqSelected}
                          disabled={false}
                          slideType={slide.type}
                        />
                      )}
                      {slide.type === 'wordwall' && (
                        <WordwallInput maxWords={slide.max_words || 3} value={words} onChange={setWords} disabled={false} />
                      )}
                      {slide.type === 'opinion' && (
                        <Textarea
                          value={opinionText}
                          onChange={e => setOpinionText(e.target.value)}
                          placeholder="Scrivi la tua risposta in una frase..."
                          rows={3}
                          className="resize-none rounded-2xl border-slate-200 focus:border-emerald-400 focus:ring-emerald-200 text-base"
                        />
                      )}
                      {slide.type === 'feedback' && (
                        <FeedbackInput selected={sentiment} onSelect={setSentiment} disabled={false} />
                      )}
                      <button
                        onClick={submit}
                        className={`w-full flex items-center justify-center gap-2 py-4 rounded-2xl font-bold text-white text-lg bg-gradient-to-r shadow-xl transition-all duration-200 hover:shadow-2xl hover:scale-[1.02] active:scale-[0.98] ${submitGrad}`}
                      >
                        Invia risposta <ArrowRight className="h-5 w-5" />
                      </button>
                    </div>
                  )}

                  {/* Post-submit / time-out state */}
                  {showResult && (
                    <motion.div
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      className="space-y-4"
                    >
                      {/* Checkmark */}
                      <div className="flex flex-col items-center gap-3 py-3">
                        {isClosed ? (
                          <div className="w-16 h-16 rounded-2xl bg-slate-100 flex items-center justify-center text-4xl">🎉</div>
                        ) : (
                          <motion.div
                            initial={{ scale: 0 }}
                            animate={{ scale: 1 }}
                            transition={{ type: 'spring', stiffness: 320, damping: 22, delay: 0.05 }}
                            className="w-16 h-16 rounded-2xl bg-emerald-100 flex items-center justify-center"
                          >
                            <CheckCircle2 className="h-9 w-9 text-emerald-500" />
                          </motion.div>
                        )}
                        <div className="text-center">
                          <p className="text-lg font-bold text-slate-800">
                            {isClosed ? 'Sessione terminata!' : answered ? 'Risposta inviata!' : 'Tempo scaduto'}
                          </p>
                          {isClosed && (
                            <p className="text-sm text-slate-500 mt-0.5">Ottimo lavoro! 👏</p>
                          )}
                        </div>
                      </div>

                      {/* MCQ correct answer reveal */}
                      {slide.type === 'mcq' && answered && mcqSelected !== null && (
                        <div className="rounded-2xl border px-4 py-3 text-sm">
                          {slide.correct_option !== null && slide.correct_option !== undefined ? (
                            slide.correct_option === mcqSelected ? (
                              <div className="flex items-center gap-2 text-emerald-700">
                                <CheckCircle2 className="h-4 w-4 text-emerald-500 flex-shrink-0" />
                                <span><strong>Risposta corretta!</strong> {(slide.options || [])[mcqSelected]}</span>
                              </div>
                            ) : (
                              <div className="text-slate-600">
                                <span className="text-red-500 font-medium">✗ La tua risposta:</span> {(slide.options || [])[mcqSelected]}
                                <br />
                                <span className="text-emerald-600 font-medium">✓ Risposta corretta:</span> {(slide.options || [])[slide.correct_option!]}
                              </div>
                            )
                          ) : (
                            <div className="text-indigo-700">
                              <span className="font-medium">La tua risposta:</span> {(slide.options || [])[mcqSelected]}
                            </div>
                          )}
                        </div>
                      )}

                      {/* Response progress */}
                      {!isClosed && (
                        <div className="flex items-center gap-3 px-4 py-3 bg-slate-50 rounded-2xl">
                          <Users className="h-4 w-4 text-slate-400 flex-shrink-0" />
                          <span className="text-sm text-slate-600 flex-1">
                            <span className="font-bold text-slate-800">{responseCount}</span>
                            {totalStudents > 0 && <span className="text-slate-400"> di {totalStudents}</span>} hanno risposto
                          </span>
                          {totalStudents > 0 && (
                            <div className="w-20 h-2 rounded-full bg-slate-200 overflow-hidden">
                              <div
                                className="h-full rounded-full bg-emerald-400 transition-all duration-700"
                                style={{ width: `${Math.min(100, (responseCount / totalStudents) * 100)}%` }}
                              />
                            </div>
                          )}
                        </div>
                      )}

                      {(allAnswered || isClosed) && !isClosed && (
                        <div className="flex items-center justify-center gap-2 text-sm text-slate-500">
                          <BarChart2 className="h-4 w-4" />
                          <span>In attesa della prossima slide...</span>
                        </div>
                      )}

                      {!allAnswered && !isClosed && (
                        <p className="text-center text-xs text-slate-400">
                          In attesa che tutti rispondano...
                        </p>
                      )}
                    </motion.div>
                  )}
                </>
              ) : (
                <div className="text-center py-8 text-slate-400">
                  <Zap className="h-12 w-12 mx-auto mb-3 opacity-20" />
                  <p className="font-medium">In attesa della prossima domanda...</p>
                </div>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
