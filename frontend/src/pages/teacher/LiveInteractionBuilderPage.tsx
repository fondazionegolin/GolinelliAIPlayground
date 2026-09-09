import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { motion, AnimatePresence, Reorder, useDragControls } from 'framer-motion'
import { liveInteractionApi } from '@/lib/api'
import { useToast } from '@/components/ui/use-toast'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import {
  Plus, Minus, Trash2, Play, ChevronDown,
  ListChecks, CloudLightning, MessageSquare, ThumbsUp, GripVertical, Pencil,
  Radio, FileBarChart2, HelpCircle, X, SkipForward, BarChart2, Smartphone,
  ArrowRight, CheckCircle2, Zap, Pause,
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

interface EditableSlide {
  key: string
  slide: Slide
}

const editableSlide = (slide: Slide): EditableSlide => ({
  key: typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`,
  slide,
})

interface LiveInteractionItem {
  id: string
  title: string
  status: string
  slides_count: number
  slides_json?: Slide[]
  current_slide_index: number
  created_at: string
}

const SLIDE_LABELS: Record<SlideType, string> = {
  mcq: 'Risposta multipla',
  wordwall: 'Word Wall',
  opinion: 'Opinione libera',
  feedback: 'Feedback rapido',
}

const SLIDE_ICONS: Record<SlideType, React.ElementType> = {
  mcq: ListChecks,
  wordwall: CloudLightning,
  opinion: MessageSquare,
  feedback: ThumbsUp,
}

const SLIDE_COLORS: Record<SlideType, string> = {
  mcq: 'bg-indigo-100 text-indigo-700 border-indigo-200',
  wordwall: 'bg-amber-100 text-amber-700 border-amber-200',
  opinion: 'bg-emerald-100 text-emerald-700 border-emerald-200',
  feedback: 'bg-rose-100 text-rose-700 border-rose-200',
}

function defaultSlide(type: SlideType): Slide {
  switch (type) {
    case 'mcq':      return { type, question: '', options: ['', '', '', ''], correct_option: null, max_seconds: 30, show_ranking: false }
    case 'wordwall': return { type, prompt: '', max_seconds: 60, max_words: 3 }
    case 'opinion':  return { type, prompt: '', max_seconds: 90 }
    case 'feedback': return { type, prompt: '', max_seconds: 30 }
  }
}

// ── Tutorial ──

const TUTORIAL_STEPS = [
  {
    num: 1,
    icon: Plus,
    grad: 'from-indigo-500 to-purple-600',
    ring: 'ring-indigo-400/40',
    glow: 'shadow-indigo-500/25',
    title: 'Crea le slide',
    desc: 'Componi la tua sessione aggiungendo slide di 4 tipi: risposta multipla, word wall, opinione libera e feedback rapido. Ogni slide ha un timer personalizzabile.',
    visual: () => (
      <div className="space-y-2">
        {[
          { label: 'Risposta multipla', color: 'bg-indigo-400', text: 'bg-indigo-100 text-indigo-700' },
          { label: 'Word Wall',         color: 'bg-amber-400',  text: 'bg-amber-100 text-amber-700' },
          { label: 'Opinione libera',   color: 'bg-emerald-400',text: 'bg-emerald-100 text-emerald-700' },
          { label: 'Feedback rapido',   color: 'bg-rose-400',   text: 'bg-rose-100 text-rose-700' },
        ].map((item, i) => (
          <motion.div
            key={item.label}
            initial={{ opacity: 0, x: -14 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: i * 0.12, type: 'spring', stiffness: 280 }}
            className="flex items-center gap-2.5 bg-white/10 rounded-xl px-3 py-2"
          >
            <div className={`w-2.5 h-2.5 rounded-full ${item.color} flex-shrink-0`} />
            <span className="text-sm text-white/90 font-medium">{item.label}</span>
            <div className="ml-auto flex gap-1">
              {[30, 40, 60, 20][i] > 0 && (
                <span className="text-xs text-white/40">{[30, 60, 90, 30][i]}s</span>
              )}
            </div>
          </motion.div>
        ))}
      </div>
    ),
  },
  {
    num: 2,
    icon: Play,
    grad: 'from-emerald-500 to-teal-600',
    ring: 'ring-emerald-400/40',
    glow: 'shadow-emerald-500/25',
    title: 'Avvia in classe',
    desc: 'Con un click gli studenti connessi alla sessione vedono automaticamente la prima slide sul loro dispositivo — nessun codice da inserire.',
    visual: () => (
      <div className="flex items-center gap-4">
        {/* Teacher */}
        <div className="flex flex-col items-center gap-1.5">
          <div className="w-14 h-10 bg-white/15 rounded-xl flex items-center justify-center">
            <div className="w-9 h-6 bg-indigo-400/60 rounded-md" />
          </div>
          <span className="text-xs text-white/50">Docente</span>
          <motion.div
            animate={{ scale: [1, 1.08, 1] }}
            transition={{ repeat: Infinity, duration: 1.6, ease: 'easeInOut' }}
            className="flex items-center gap-1 bg-emerald-500/80 rounded-lg px-2 py-1"
          >
            <Play className="h-3 w-3 text-white" />
            <span className="text-xs text-white font-bold">Avvia</span>
          </motion.div>
        </div>

        {/* Animated arrows */}
        <div className="flex flex-col gap-1.5">
          {[0, 1, 2].map(i => (
            <motion.div
              key={i}
              animate={{ x: [0, 5, 0], opacity: [0.4, 1, 0.4] }}
              transition={{ repeat: Infinity, duration: 1.2, delay: i * 0.2 }}
            >
              <ArrowRight className="h-4 w-4 text-emerald-400" />
            </motion.div>
          ))}
        </div>

        {/* Students */}
        <div className="flex flex-col gap-2 flex-1">
          {['Giulia', 'Marco', 'Sofia'].map((name, i) => (
            <motion.div
              key={name}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: i * 0.25 + 0.3 }}
              className="flex items-center gap-2 bg-white/10 rounded-xl px-2.5 py-1.5"
            >
              <Smartphone className="h-3.5 w-3.5 text-white/60" />
              <span className="text-xs text-white/80">{name}</span>
              <motion.div
                animate={{ opacity: [0.4, 1, 0.4] }}
                transition={{ repeat: Infinity, duration: 2, delay: i * 0.4 }}
                className="ml-auto w-2 h-2 rounded-full bg-emerald-400"
              />
            </motion.div>
          ))}
        </div>
      </div>
    ),
  },
  {
    num: 3,
    icon: SkipForward,
    grad: 'from-amber-400 to-orange-500',
    ring: 'ring-amber-400/40',
    glow: 'shadow-amber-500/25',
    title: 'Controlla live',
    desc: 'Dal pannello docente vedi le risposte aggiornarsi in tempo reale. Avanza slide per slide e monitora quanti studenti hanno risposto.',
    visual: () => {
      const bars = [
        { label: 'A', pct: 58, color: 'bg-indigo-400' },
        { label: 'B', pct: 25, color: 'bg-amber-400' },
        { label: 'C', pct: 12, color: 'bg-emerald-400' },
        { label: 'D', pct: 5,  color: 'bg-rose-400' },
      ]
      return (
        <div className="space-y-2.5">
          <div className="flex items-center gap-2 mb-1">
            <motion.div
              animate={{ opacity: [1, 0.4, 1] }}
              transition={{ repeat: Infinity, duration: 1.2 }}
              className="w-2 h-2 rounded-full bg-emerald-400"
            />
            <span className="text-xs text-white/60 font-medium">18 di 24 hanno risposto</span>
          </div>
          {bars.map((bar, i) => (
            <div key={bar.label} className="flex items-center gap-2">
              <span className="text-xs text-white/50 w-4 font-bold">{bar.label}</span>
              <div className="flex-1 h-3.5 rounded-full bg-white/10 overflow-hidden">
                <motion.div
                  initial={{ width: 0 }}
                  animate={{ width: `${bar.pct}%` }}
                  transition={{ delay: i * 0.15, duration: 0.8, ease: 'easeOut' }}
                  className={`h-full rounded-full ${bar.color}`}
                />
              </div>
              <span className="text-xs text-white/40 tabular-nums w-7 text-right">{bar.pct}%</span>
            </div>
          ))}
        </div>
      )
    },
  },
  {
    num: 4,
    icon: BarChart2,
    grad: 'from-rose-500 to-pink-600',
    ring: 'ring-rose-400/40',
    glow: 'shadow-rose-500/25',
    title: 'Leggi il report',
    desc: 'A sessione conclusa trovi il report completo: grafici, word cloud, risposte testuali, classifica e tutti i dati esportati in JSON.',
    visual: () => (
      <div className="space-y-3">
        <motion.div
          initial={{ opacity: 0, y: -6 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex items-center gap-2 bg-emerald-500/20 rounded-xl px-3 py-2"
        >
          <CheckCircle2 className="h-4 w-4 text-emerald-400 flex-shrink-0" />
          <span className="text-sm text-white/90 font-semibold">Sessione completata!</span>
        </motion.div>
        <div className="grid grid-cols-3 gap-2">
          {[
            { v: '24', l: 'studenti' },
            { v: '4',  l: 'slide' },
            { v: '96', l: 'risposte' },
          ].map(({ v, l }, i) => (
            <motion.div
              key={l}
              initial={{ opacity: 0, scale: 0.85 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: i * 0.12 + 0.15, type: 'spring', stiffness: 260 }}
              className="bg-white/10 rounded-xl py-2.5 text-center"
            >
              <div className="text-xl font-black text-white">{v}</div>
              <div className="text-xs text-white/50">{l}</div>
            </motion.div>
          ))}
        </div>
        <div className="space-y-1.5">
          {[
            { e: '😊', pct: 62, color: 'bg-emerald-500' },
            { e: '😐', pct: 25, color: 'bg-amber-400' },
            { e: '😞', pct: 13, color: 'bg-red-400' },
          ].map((row, i) => (
            <div key={row.e} className="flex items-center gap-2">
              <span className="text-base w-6">{row.e}</span>
              <div className="flex-1 h-2.5 rounded-full bg-white/10 overflow-hidden">
                <motion.div
                  initial={{ width: 0 }}
                  animate={{ width: `${row.pct}%` }}
                  transition={{ delay: i * 0.15 + 0.4, duration: 0.7, ease: 'easeOut' }}
                  className={`h-full rounded-full ${row.color}`}
                />
              </div>
              <span className="text-xs text-white/40 w-7 text-right tabular-nums">{row.pct}%</span>
            </div>
          ))}
        </div>
      </div>
    ),
  },
]

function HowItWorks({ onDismiss }: { onDismiss: () => void }) {
  const [active, setActive] = useState(0)
  const [paused, setPaused] = useState(false)

  useEffect(() => {
    if (paused) return
    const id = setInterval(() => setActive(prev => (prev + 1) % TUTORIAL_STEPS.length), 3000)
    return () => clearInterval(id)
  }, [paused])

  const step = TUTORIAL_STEPS[active]
  const StepIcon = step.icon
  const Visual = step.visual

  return (
    <div
      className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-slate-900 via-slate-800 to-indigo-950 p-6 md:p-8 shadow-2xl mb-8"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
    >
      {/* Background decoration */}
      <div className="absolute top-0 right-0 w-72 h-72 bg-white/[0.02] rounded-full -translate-y-24 translate-x-20 pointer-events-none" />
      <div className="absolute bottom-0 left-0 w-48 h-48 bg-white/[0.02] rounded-full translate-y-16 -translate-x-10 pointer-events-none" />

      {/* Dismiss */}
      <button
        onClick={onDismiss}
        className="absolute top-4 right-4 w-8 h-8 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-white/60 hover:text-white transition-colors"
        title="Chiudi tutorial"
      >
        <X className="h-4 w-4" />
      </button>
      <button
        onClick={() => setPaused(prev => !prev)}
        className="absolute top-4 right-14 w-8 h-8 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-white/60 hover:text-white transition-colors"
        title={paused ? 'Riprendi tutorial' : 'Ferma tutorial'}
      >
        {paused ? <Play className="h-4 w-4" /> : <Pause className="h-4 w-4" />}
      </button>

      {/* Header */}
      <div className="mb-6">
        <div className="flex items-center gap-2 mb-1">
          <Zap className="h-4 w-4 text-indigo-400" />
          <span className="text-xs font-semibold text-indigo-400 uppercase tracking-widest">Tutorial</span>
        </div>
        <h2 className="text-2xl font-black text-white leading-tight">
          Come funziona<br />Live Interaction
        </h2>
        <p className="text-white/50 text-sm mt-1">
          Coinvolgi la classe con domande interattive in tempo reale
        </p>
      </div>

      {/* Step indicators */}
      <div className="grid grid-cols-4 gap-2 mb-6">
        {TUTORIAL_STEPS.map((s, i) => {
          const Icon = s.icon
          const isActive = i === active
          return (
            <button
              key={i}
              onClick={() => setActive(i)}
              className={`relative rounded-2xl p-3 flex flex-col items-center gap-2 transition-all duration-300 text-left ${
                isActive ? 'bg-white/15 ring-1 ' + s.ring : 'bg-white/5 hover:bg-white/10'
              }`}
            >
              <div className={`w-9 h-9 rounded-xl bg-gradient-to-br ${s.grad} flex items-center justify-center flex-shrink-0 ${isActive ? 'shadow-lg ' + s.glow : ''} transition-all duration-300`}>
                <Icon className="h-4.5 w-4.5 text-white" style={{ width: 18, height: 18 }} />
              </div>
              <span className={`text-xs font-semibold leading-tight text-center ${isActive ? 'text-white' : 'text-white/50'}`}>
                {s.title}
              </span>
              {isActive && (
                <motion.div
                  layoutId="step-indicator"
                  className={`absolute bottom-0 left-1/2 -translate-x-1/2 translate-y-px w-8 h-0.5 rounded-full bg-gradient-to-r ${s.grad}`}
                />
              )}
            </button>
          )
        })}
      </div>

      {/* Content area */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
        {/* Description */}
        <AnimatePresence mode="wait">
          <motion.div
            key={`desc-${active}`}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.25 }}
            className="flex flex-col justify-center"
          >
            <div className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-gradient-to-r ${step.grad} mb-4 w-fit`}>
              <span className="text-xs font-black text-white">STEP {step.num}</span>
              <StepIcon className="h-3.5 w-3.5 text-white/80" />
            </div>
            <h3 className="text-xl font-black text-white mb-2">{step.title}</h3>
            <p className="text-white/60 text-sm leading-relaxed">{step.desc}</p>
          </motion.div>
        </AnimatePresence>

        {/* Mini visual */}
        <AnimatePresence mode="wait">
          <motion.div
            key={`visual-${active}`}
            initial={{ opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.96 }}
            transition={{ duration: 0.25 }}
            className="bg-white/5 rounded-2xl p-4 border border-white/10"
          >
            <Visual />
          </motion.div>
        </AnimatePresence>
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between">
        {/* Progress dots */}
        <div className="flex gap-1.5">
          {TUTORIAL_STEPS.map((_, i) => (
            <button
              key={i}
              onClick={() => setActive(i)}
              className={`rounded-full transition-all duration-300 ${
                i === active ? 'w-5 h-1.5 bg-white/70' : 'w-1.5 h-1.5 bg-white/25 hover:bg-white/40'
              }`}
            />
          ))}
        </div>

        {/* Dismiss */}
        <button
          onClick={onDismiss}
          className="flex items-center gap-2 bg-white text-slate-800 font-bold text-sm px-5 py-2.5 rounded-xl hover:bg-slate-100 transition-colors shadow-lg"
        >
          Ho capito, inizia! →
        </button>
      </div>
    </div>
  )
}

// ── Slide editor components ──

function McqEditor({ slide, onChange }: { slide: Slide; onChange: (s: Slide) => void }) {
  const options = slide.options || ['', '', '', '']
  return (
    <div className="space-y-3">
      <div>
        <label className="text-xs font-medium text-slate-600 mb-1 block">Domanda</label>
        <Textarea
          value={slide.question || ''}
          onChange={e => onChange({ ...slide, question: e.target.value })}
          placeholder="Scrivi la domanda..."
          className="resize-none"
          rows={2}
        />
      </div>
      <div>
        <label className="text-xs font-medium text-slate-600 mb-1 block">Opzioni di risposta</label>
        <div className="space-y-1.5">
          {options.map((opt, i) => (
            <div key={i} className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => onChange({ ...slide, correct_option: slide.correct_option === i ? null : i })}
                className={`w-6 h-6 rounded-full border-2 flex-shrink-0 transition-colors ${slide.correct_option === i ? 'bg-emerald-500 border-emerald-500' : 'border-slate-300 hover:border-emerald-400'}`}
                title="Segna come risposta corretta"
              />
              <Input
                value={opt}
                onChange={e => {
                  const next = [...options]; next[i] = e.target.value
                  onChange({ ...slide, options: next })
                }}
                placeholder={`Opzione ${String.fromCharCode(65 + i)}`}
                className="flex-1 h-8 text-sm"
              />
              {options.length > 2 && (
                <button
                  type="button"
                  onClick={() => {
                    const next = options.filter((_, j) => j !== i)
                    onChange({ ...slide, options: next, correct_option: slide.correct_option === i ? null : slide.correct_option })
                  }}
                  className="text-slate-400 hover:text-red-500"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          ))}
        </div>
        {options.length < 6 && (
          <button
            type="button"
            onClick={() => onChange({ ...slide, options: [...options, ''] })}
            className="mt-2 text-xs text-indigo-600 hover:text-indigo-800 flex items-center gap-1"
          >
            <Plus className="h-3 w-3" /> Aggiungi opzione
          </button>
        )}
      </div>
      <label className="flex items-center gap-2 text-xs text-slate-600 cursor-pointer">
        <input
          type="checkbox"
          checked={slide.show_ranking || false}
          onChange={e => onChange({ ...slide, show_ranking: e.target.checked })}
          className="rounded"
        />
        Mostra classifica velocità
      </label>
    </div>
  )
}

function WordwallEditor({ slide, onChange }: { slide: Slide; onChange: (s: Slide) => void }) {
  return (
    <div className="space-y-3">
      <div>
        <label className="text-xs font-medium text-slate-600 mb-1 block">Prompt</label>
        <Textarea
          value={slide.prompt || ''}
          onChange={e => onChange({ ...slide, prompt: e.target.value })}
          placeholder="Scrivi una parola che ti viene in mente quando pensi a..."
          className="resize-none"
          rows={2}
        />
      </div>
      <div>
        <label className="text-xs font-medium text-slate-600 mb-1 block">Parole max per studente</label>
        <Input
          type="number" min={1} max={10}
          value={slide.max_words || 3}
          onChange={e => onChange({ ...slide, max_words: parseInt(e.target.value) || 3 })}
          className="w-24 h-8 text-sm"
        />
      </div>
    </div>
  )
}

function OpinionEditor({ slide, onChange }: { slide: Slide; onChange: (s: Slide) => void }) {
  return (
    <div>
      <label className="text-xs font-medium text-slate-600 mb-1 block">Prompt</label>
      <Textarea
        value={slide.prompt || ''}
        onChange={e => onChange({ ...slide, prompt: e.target.value })}
        placeholder="In una frase, cosa pensi di..."
        className="resize-none"
        rows={2}
      />
    </div>
  )
}

function FeedbackEditor({ slide, onChange }: { slide: Slide; onChange: (s: Slide) => void }) {
  return (
    <div>
      <label className="text-xs font-medium text-slate-600 mb-1 block">Domanda</label>
      <Textarea
        value={slide.prompt || ''}
        onChange={e => onChange({ ...slide, prompt: e.target.value })}
        placeholder="Come hai trovato l'attività?"
        className="resize-none"
        rows={2}
      />
    </div>
  )
}

function SlideCard({
  item, index, expanded, onToggle, onChange, onDelete, onDragStart,
}: {
  item: EditableSlide; index: number; expanded: boolean
  onToggle: () => void; onChange: (s: Slide) => void; onDelete: () => void
  onDragStart: () => void
}) {
  const slide = item.slide
  const dragControls = useDragControls()
  const Icon = SLIDE_ICONS[slide.type]
  const colorCls = SLIDE_COLORS[slide.type]
  const title = slide.question || slide.prompt || `Slide ${index + 1}`

  return (
    <Reorder.Item
      value={item}
      dragListener={false}
      dragControls={dragControls}
      onDragStart={onDragStart}
      whileDrag={{ scale: 1.015, boxShadow: '0 18px 45px rgba(15, 23, 42, 0.16)' }}
      className="relative z-0 list-none rounded-xl data-[dragging=true]:z-20"
    >
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      <div
        className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-slate-50 transition-colors"
        onClick={onToggle}
      >
        <button
          type="button"
          aria-label={`Trascina per riordinare la slide ${index + 1}`}
          title="Trascina per cambiare posizione"
          onPointerDown={(event) => {
            event.stopPropagation()
            dragControls.start(event)
          }}
          onClick={event => event.stopPropagation()}
          className="-ml-1 flex h-8 w-7 flex-shrink-0 touch-none items-center justify-center rounded-lg text-slate-300 transition hover:bg-slate-100 hover:text-slate-600 active:cursor-grabbing"
          style={{ cursor: 'grab' }}
        >
          <GripVertical className="h-4 w-4" />
        </button>
        <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium border ${colorCls}`}>
          <Icon className="h-3 w-3" />
          {SLIDE_LABELS[slide.type]}
        </span>
        <span className="flex-1 text-sm text-slate-700 truncate">{title}</span>
        <span className="text-xs text-slate-400">{slide.max_seconds}s</span>
        <div className="flex items-center gap-1 ml-2" onClick={e => e.stopPropagation()}>
          <button onClick={onDelete} className="p-1 text-slate-400 hover:text-red-500">
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
        <motion.span
          animate={{ rotate: expanded ? 180 : 0 }}
          transition={{ duration: 0.2, ease: 'easeInOut' }}
          className="flex h-4 w-4 items-center justify-center text-slate-400"
        >
          <ChevronDown className="h-4 w-4" />
        </motion.span>
      </div>

      <AnimatePresence initial={false}>
      {expanded && (
        <motion.div
          key="slide-editor"
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: 'auto', opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          transition={{
            height: { duration: 0.24, ease: [0.4, 0, 0.2, 1] },
            opacity: { duration: 0.16, ease: 'easeOut' },
          }}
          className="overflow-hidden"
        >
        <div className="border-t border-slate-100 bg-slate-50/50 px-4 py-4">
          <div className="space-y-4">
            {slide.type === 'mcq'      && <McqEditor slide={slide} onChange={onChange} />}
            {slide.type === 'wordwall' && <WordwallEditor slide={slide} onChange={onChange} />}
            {slide.type === 'opinion'  && <OpinionEditor slide={slide} onChange={onChange} />}
            {slide.type === 'feedback' && <FeedbackEditor slide={slide} onChange={onChange} />}
            <div>
              <label className="text-xs font-medium text-slate-600 mb-1 block">Tempo massimo (secondi)</label>
              <div className="inline-flex h-9 items-stretch overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
                <button
                  type="button"
                  onClick={() => onChange({ ...slide, max_seconds: Math.max(10, slide.max_seconds - 5) })}
                  disabled={slide.max_seconds <= 10}
                  className="flex w-9 items-center justify-center border-r border-slate-200 text-slate-500 transition hover:bg-slate-100 hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-35"
                  aria-label="Riduci il tempo massimo di 5 secondi"
                  title="Riduci di 5 secondi"
                >
                  <Minus className="h-3.5 w-3.5" />
                </button>
                <Input
                  type="number"
                  min={10}
                  max={600}
                  step={5}
                  value={slide.max_seconds}
                  onChange={event => {
                    const nextValue = Number.parseInt(event.target.value, 10)
                    if (Number.isFinite(nextValue)) {
                      onChange({ ...slide, max_seconds: Math.min(600, Math.max(10, nextValue)) })
                    }
                  }}
                  className="h-full w-16 rounded-none border-0 px-2 text-center text-sm shadow-none focus-visible:ring-0"
                  aria-label="Tempo massimo in secondi"
                />
                <button
                  type="button"
                  onClick={() => onChange({ ...slide, max_seconds: Math.min(600, slide.max_seconds + 5) })}
                  disabled={slide.max_seconds >= 600}
                  className="flex w-9 items-center justify-center border-l border-slate-200 text-slate-500 transition hover:bg-slate-100 hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-35"
                  aria-label="Aumenta il tempo massimo di 5 secondi"
                  title="Aumenta di 5 secondi"
                >
                  <Plus className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          </div>
        </div>
        </motion.div>
      )}
      </AnimatePresence>
    </div>
    </Reorder.Item>
  )
}

function SlidePreviewStrip({ slides, count }: { slides?: Slide[]; count: number }) {
  const previewSlides = (slides || []).slice(0, 5)
  if (previewSlides.length === 0) {
    return (
      <div className="mt-3 flex items-center gap-2 text-xs text-slate-400">
        <div className="h-10 w-16 rounded-xl border border-dashed border-slate-200 bg-slate-50" />
        <span>{count} slide</span>
      </div>
    )
  }

  return (
    <div className="mt-3 flex items-center gap-2 overflow-hidden">
      {previewSlides.map((slide, idx) => {
        const Icon = SLIDE_ICONS[slide.type] || Zap
        const label = slide.question || slide.prompt || SLIDE_LABELS[slide.type]
        return (
          <div
            key={idx}
            className="flex h-[78px] w-[124px] flex-shrink-0 flex-col justify-between rounded-2xl border border-slate-200 bg-white/72 p-2.5 shadow-sm"
            title={label}
          >
            <div className="flex items-center justify-between gap-1">
              <span className={`inline-flex h-6 w-6 items-center justify-center rounded-lg border ${SLIDE_COLORS[slide.type]}`}>
                <Icon className="h-3.5 w-3.5" />
              </span>
              <span className="text-[11px] font-black text-slate-400">{idx + 1}</span>
            </div>
            <p className="line-clamp-3 text-[11px] font-semibold leading-[14px] text-slate-600">
              {label}
            </p>
          </div>
        )
      })}
      {count > previewSlides.length && (
        <div className="flex h-[78px] min-w-[60px] items-center justify-center rounded-2xl border border-slate-200 bg-slate-50 text-xs font-black text-slate-400">
          +{count - previewSlides.length}
        </div>
      )}
    </div>
  )
}

// ── Editor panel ──

function InteractionEditor({
  sessionId, interactionId, onSaved, onCancel,
}: {
  sessionId: string; interactionId: string | null; onSaved: () => void; onCancel: () => void
}) {
  const { toast } = useToast()
  const queryClient = useQueryClient()
  const navigate = useNavigate()

  const [title, setTitle] = useState('')
  const [slides, setSlides] = useState<EditableSlide[]>([])
  const [expandedIdx, setExpandedIdx] = useState<number | null>(0)
  const [showTypeMenu, setShowTypeMenu] = useState(false)

  const { data: existing, isLoading } = useQuery({
    queryKey: ['live-interaction', interactionId],
    queryFn: () => liveInteractionApi.get(interactionId!).then(r => r.data),
    enabled: !!interactionId,
  })

  useEffect(() => {
    if (existing) {
      setTitle(existing.title)
      setSlides(((existing.slides_json || []) as Slide[]).map(editableSlide))
    }
  }, [existing])

  const saveMutation = useMutation({
    mutationFn: async () => {
      const slidesJson = slides.map(item => item.slide)
      if (interactionId) return liveInteractionApi.update(interactionId, { title, slides_json: slidesJson })
      return liveInteractionApi.create({ session_id: sessionId, title, slides_json: slidesJson })
    },
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['live-interactions', sessionId] })
      toast({ title: 'Salvato!' })
      onSaved()
      if (!interactionId) navigate(`/teacher/live-interaction/${res.data.id}/control`)
    },
    onError: () => toast({ title: 'Errore durante il salvataggio', variant: 'destructive' }),
  })

  const addSlide = (type: SlideType) => {
    setSlides(prev => [...prev, editableSlide(defaultSlide(type))])
    setExpandedIdx(slides.length)
    setShowTypeMenu(false)
  }
  const updateSlide = (i: number, s: Slide) => setSlides(prev => prev.map((item, j) => j === i ? { ...item, slide: s } : item))
  const deleteSlide = (i: number) => setSlides(prev => prev.filter((_, j) => j !== i))

  if (isLoading) return <div className="p-8 text-center text-slate-400">Caricamento...</div>

  return (
    <div className="space-y-6">
      <div>
        <label className="text-sm font-medium text-slate-700 mb-1 block">Titolo sessione</label>
        <Input
          value={title}
          onChange={e => setTitle(e.target.value)}
          placeholder="Es. Quiz di storia dell'arte"
          className="text-base"
        />
      </div>

      <Reorder.Group axis="y" values={slides} onReorder={setSlides} className="space-y-2">
        {slides.map((item, i) => (
          <SlideCard
            key={item.key}
            item={item} index={i}
            expanded={expandedIdx === i}
            onToggle={() => setExpandedIdx(expandedIdx === i ? null : i)}
            onChange={s => updateSlide(i, s)}
            onDelete={() => deleteSlide(i)}
            onDragStart={() => setExpandedIdx(null)}
          />
        ))}
      </Reorder.Group>

      <div className="sticky bottom-0 z-30 space-y-3 border-t border-slate-100 bg-white/95 py-3 backdrop-blur">
      <div className="relative">
        <Button
          variant="outline"
          onClick={() => setShowTypeMenu(v => !v)}
          className="w-full border-dashed border-slate-300 text-slate-600 hover:border-indigo-400 hover:text-indigo-600"
        >
          <Plus className="h-4 w-4 mr-2" /> Aggiungi slide
        </Button>
        {showTypeMenu && (
          <div className="absolute bottom-full mb-1 left-0 right-0 bg-white rounded-xl shadow-lg border border-slate-200 z-20 p-2 grid grid-cols-2 gap-1">
            {(Object.keys(SLIDE_LABELS) as SlideType[]).map(type => {
              const Icon = SLIDE_ICONS[type]
              return (
                <button
                  key={type}
                  onClick={() => addSlide(type)}
                  className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium border transition-colors ${SLIDE_COLORS[type]} hover:opacity-80`}
                >
                  <Icon className="h-4 w-4" /> {SLIDE_LABELS[type]}
                </button>
              )
            })}
          </div>
        )}
      </div>

      <div className="flex justify-end gap-3">
        <Button tone="neutral" surface="ghost" onClick={onCancel}>Annulla</Button>
        <Button
          tone="accent" surface="solid"
          onClick={() => saveMutation.mutate()}
          disabled={!title.trim() || slides.length === 0 || saveMutation.isPending}
        >
          {saveMutation.isPending ? 'Salvataggio...' : interactionId ? 'Salva modifiche' : 'Salva e vai al pannello →'}
        </Button>
      </div>
      </div>
    </div>
  )
}

// ── Main page ──

export default function LiveInteractionBuilderPage({ sessionId }: { sessionId?: string }) {
  const navigate = useNavigate()
  const { toast } = useToast()
  const queryClient = useQueryClient()

  const storedSession = (() => {
    try { return JSON.parse(localStorage.getItem('teacher_selected_session') || 'null') } catch { return null }
  })()
  const activeSessionId = sessionId || storedSession?.id || null

  const [editingId, setEditingId] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [showTutorial, setShowTutorial] = useState(true)

  const { data: interactions, isLoading } = useQuery<LiveInteractionItem[]>({
    queryKey: ['live-interactions', activeSessionId],
    queryFn: () => liveInteractionApi.list(activeSessionId!).then(r => r.data),
    enabled: !!activeSessionId,
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => liveInteractionApi.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['live-interactions', activeSessionId] })
      toast({ title: 'Eliminato' })
    },
    onError: () => toast({ title: 'Errore durante l\'eliminazione', variant: 'destructive' }),
  })

  if (creating || editingId !== null) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-8">
        <h2 className="text-xl font-bold text-slate-800 mb-6">
          {editingId ? 'Modifica sessione live' : 'Nuova sessione live'}
        </h2>
        <InteractionEditor
          sessionId={activeSessionId!}
          interactionId={editingId}
          onSaved={() => { setCreating(false); setEditingId(null) }}
          onCancel={() => { setCreating(false); setEditingId(null) }}
        />
      </div>
    )
  }

  return (
    <div className="max-w-3xl mx-auto px-4 py-8">

      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold text-slate-800">Live Interaction</h1>
            <button
              onClick={() => setShowTutorial(v => !v)}
              className="w-7 h-7 rounded-full bg-slate-100 hover:bg-slate-200 flex items-center justify-center text-slate-500 hover:text-slate-700 transition-colors"
              title={showTutorial ? 'Nascondi tutorial' : 'Mostra tutorial'}
            >
              <HelpCircle className="h-4 w-4" />
            </button>
          </div>
          <p className="text-sm text-slate-500 mt-0.5">
            {storedSession ? `Sessione: ${storedSession.name}` : 'Seleziona una sessione dalla navbar'}
          </p>
        </div>
        {activeSessionId && (
          <Button tone="accent" surface="solid" onClick={() => setCreating(true)}>
            <Plus className="h-4 w-4" /> Nuova sessione
          </Button>
        )}
      </div>

      {/* Tutorial */}
      <AnimatePresence>
        {showTutorial && (
          <motion.div
            initial={{ opacity: 0, y: -12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -12, height: 0 }}
            transition={{ duration: 0.3 }}
          >
            <HowItWorks onDismiss={() => setShowTutorial(false)} />
          </motion.div>
        )}
      </AnimatePresence>

      {/* Empty states */}
      {!activeSessionId && (
        <div className="text-center py-16 text-slate-400">
          <CloudLightning className="h-12 w-12 mx-auto mb-3 opacity-40" />
          <p>Seleziona una sessione attiva dalla navbar per gestire le sessioni live.</p>
        </div>
      )}

      {activeSessionId && isLoading && (
        <div className="text-center py-12 text-slate-400">Caricamento...</div>
      )}

      {activeSessionId && !isLoading && interactions?.length === 0 && (
        <div className="text-center py-16 text-slate-400 border-2 border-dashed border-slate-200 rounded-2xl">
          <CloudLightning className="h-12 w-12 mx-auto mb-3 opacity-40" />
          <p className="font-medium text-slate-600 mb-1">Nessuna sessione live ancora</p>
          <p className="text-sm">Crea la prima sessione live per questa classe!</p>
        </div>
      )}

      {/* List */}
      <div className="space-y-3">
        {interactions?.map(item => (
          <div key={item.id} className="border border-slate-200 rounded-[24px] bg-white/86 shadow-sm p-4 transition-all hover:-translate-y-0.5 hover:shadow-md">
            <div className="flex items-center gap-3">
            {item.status === 'ACTIVE' && (
              <span className="flex-shrink-0 w-2 h-2 rounded-full bg-green-500 animate-pulse" />
            )}

            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-semibold text-slate-800 truncate">{item.title}</span>
                {item.status === 'ACTIVE' && <Badge tone="success" surface="soft" density="compact">● Live</Badge>}
                {item.status === 'DRAFT'  && <Badge tone="warning" surface="soft" density="compact">Bozza</Badge>}
                {item.status === 'CLOSED' && <Badge tone="neutral" surface="soft" density="compact">Completata</Badge>}
              </div>
              <p className="text-xs text-slate-400 mt-0.5">
                {item.slides_count} slide · {new Date(item.created_at).toLocaleDateString('it-IT')}
              </p>
            </div>

            <div className="flex items-center gap-1.5 flex-shrink-0">
              {item.status === 'DRAFT' && (
                <Button tone="neutral" surface="outline" density="compact" onClick={() => setEditingId(item.id)}>
                  <Pencil className="h-3.5 w-3.5" /> Modifica
                </Button>
              )}
              {item.status !== 'DRAFT' && (
                <Button
                  tone="neutral" surface="outline" density="compact"
                  onClick={() => navigate(`/teacher/live-interaction/${item.id}/control`)}
                >
                  <FileBarChart2 className="h-3.5 w-3.5" /> Report
                </Button>
              )}
              {item.status === 'ACTIVE' && (
                <Button
                  tone="success" surface="solid" density="compact"
                  onClick={() => navigate(`/teacher/live-interaction/${item.id}/control`)}
                >
                  <Radio className="h-3.5 w-3.5" /> Pannello live
                </Button>
              )}
              {item.status === 'DRAFT' && (
                <Button
                  tone="accent" surface="solid" density="compact"
                  onClick={() => navigate(`/teacher/live-interaction/${item.id}/control`)}
                >
                  <Play className="h-3.5 w-3.5" /> Avvia
                </Button>
              )}
              {item.status !== 'ACTIVE' && (
                <Button
                  tone="danger" surface="ghost" density="compact"
                  onClick={() => { if (confirm('Eliminare questa sessione e tutte le risposte?')) deleteMutation.mutate(item.id) }}
                  disabled={deleteMutation.isPending}
                  title="Elimina"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              )}
            </div>
            </div>
            <SlidePreviewStrip slides={item.slides_json} count={item.slides_count} />
          </div>
        ))}
      </div>
    </div>
  )
}
