import { useState, useRef, useEffect, useCallback, useMemo, lazy, type CSSProperties, Suspense } from 'react'
import { type RagSession, getRagSessions, saveRagSession, createRagSession, deleteRagSession } from '@/lib/ragSessions'
import { useTranslation } from 'react-i18next'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { motion } from 'framer-motion'
import { llmApi, studentApi, studentbotsApi, teacherbotsApi } from '@/lib/api'
import DataFileCard, { type DataFilePreview } from '@/components/DataFileCard'
import { Button } from '@/components/ui/button'
import {
  Send, Bot, User, GraduationCap, BookOpen, Plus,
  Lightbulb, ClipboardCheck, Sparkles,
  Paperclip, X, File, Database, Download, Loader2,
  Trash2, ChevronLeft, ChevronRight, Wand2, Palette, ChevronDown, Check, ImageIcon,
  FlaskConical, ScrollText, Languages, Landmark, Sigma, Microscope, BookText, Search, Mic, Users, AtSign, PanelRightClose, PanelRightOpen, MessageSquare, Square, LayoutGrid, List, type LucideIcon
} from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'
import { markdownCodeComponents } from '@/components/CodeBlock'
import 'katex/dist/katex.min.css'
import { useMobile } from '@/hooks/useMobile'
import { triggerHaptic } from '@/lib/haptics'
import ChatConversationList from '@/components/student/ChatConversationList'
import ChatConversationView from '@/components/student/ChatConversationView'
import { VoiceRecorder } from '@/components/VoiceRecorder'
import { DEFAULT_STUDENT_ACCENT, getStudentAccentTheme, loadStudentAccent, type StudentAccentId } from '@/lib/studentAccent'
import {
  PASTEL_SURFACES,
  type PastelTone,
} from '@/design/themes/pastelSurfaces'
import EnvironmentalImpactPill from '@/components/chat/EnvironmentalImpactPill'
import type { TokenUsageJson } from '@/lib/environmentalImpact'
import { AcademicAiIcon } from '@/components/icons/AcademicAiIcon'

const StudentRagWorkspace = lazy(() => import('@/components/student/StudentRagWorkspace'))
const RealtimeInterrogationPanel = lazy(() => import('@/components/student/RealtimeInterrogationPanel'))
const TeacherbotForm = lazy(() => import('@/components/teacher/TeacherbotForm'))
import type { VoiceSessionSource } from '@/components/student/RealtimeInterrogationPanel'
const ShareWithModal = lazy(() => import('@/components/student/ShareWithModal'))
import type { SharedRoom } from '@/components/student/SharedChatPanel'
import type { ShareTarget } from '@/components/student/ShareWithModal'
import { collaborationApi } from '@/lib/api'
import { resolveTeacherbotIcon } from '@/lib/teacherbotIcons'

// Deterministic colour per nickname so each collaborator is visually distinct.
const COLLAB_NAME_COLORS = ['#e3004a', '#7b69c9', '#1278bd', '#0d9488', '#d97706', '#9333ea', '#0891b2']
function collabNameColor(name: string): string {
  let h = 0
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0
  return COLLAB_NAME_COLORS[h % COLLAB_NAME_COLORS.length]
}

interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: Date
  provider?: string
  model?: string
  token_usage_json?: TokenUsageJson | null
  // Collaboration: present on messages coming from a shared room
  senderStudentId?: string | null
  senderNickname?: string | null
  isPeer?: boolean
}

interface QuizQuestion {
  question: string
  options: string[]
  correctIndex: number
  explanation?: string
  points?: number
}

interface QuizData {
  title: string
  description?: string
  questions: QuizQuestion[]
  total_points?: number
  time_limit_minutes?: number
}

interface ExerciseData {
  title: string
  description: string
  instructions: string
  examples?: string[]
  hint?: string
  difficulty?: string
}

interface ChatbotProfile {
  key: string
  name: string
  description: string
  icon: string
  suggested_prompts: string[]
}

interface LLMModel {
  provider: string
  model: string
  name: string
  description: string
}

interface ChatbotModuleProps {
  sessionId: string
  studentId?: string
  initialTeacherbotId?: string | null
  oggiImparoContext?: string
  onOggiImparoContextConsumed?: () => void
  onInputFocusChange?: (focused: boolean) => void
  isTeacherPreview?: boolean
  studentAccent?: StudentAccentId
  collaborationEnabled?: boolean
  onMinimize?: () => void
  onClose?: () => void
  onExpand?: () => void
  sidebarMode?: boolean
  dockArmed?: boolean
}

// Card visual language for the "Spazio AI" library — same tinted-surface/pill pattern as the
// "Materiali del docente" document cards, one fixed hue per chatbot category.
const CHATBOT_CARD_STYLES = {
  violet: {
    card: 'border-[rgba(123,105,201,0.18)] bg-[rgba(123,105,201,0.075)] hover:border-[rgba(123,105,201,0.30)] hover:bg-[rgba(123,105,201,0.11)]',
    icon: 'bg-violet-100 text-violet-800',
    badge: 'border-violet-200 bg-violet-100 text-violet-800',
  },
  amber: {
    card: 'border-[rgba(180,131,13,0.18)] bg-[rgba(180,131,13,0.075)] hover:border-[rgba(180,131,13,0.30)] hover:bg-[rgba(180,131,13,0.11)]',
    icon: 'bg-amber-100 text-amber-800',
    badge: 'border-amber-200 bg-amber-100 text-amber-800',
  },
  emerald: {
    card: 'border-[rgba(16,150,105,0.18)] bg-[rgba(16,150,105,0.075)] hover:border-[rgba(16,150,105,0.30)] hover:bg-[rgba(16,150,105,0.11)]',
    icon: 'bg-emerald-100 text-emerald-800',
    badge: 'border-emerald-200 bg-emerald-100 text-emerald-800',
  },
  rose: {
    card: 'border-[rgba(225,29,72,0.18)] bg-[rgba(225,29,72,0.075)] hover:border-[rgba(225,29,72,0.30)] hover:bg-[rgba(225,29,72,0.11)]',
    icon: 'bg-rose-100 text-rose-800',
    badge: 'border-rose-200 bg-rose-100 text-rose-800',
  },
} as const

const PROFILE_ICONS: Record<string, React.ReactNode> = {
  'tutor': <GraduationCap className="h-6 w-6" />,
  'quiz': <ClipboardCheck className="h-6 w-6" />,
  'interview': <Bot className="h-6 w-6" />,
  'oral_exam': <User className="h-6 w-6" />,
  'dataset_generator': <Database className="h-6 w-6" />,
  'math_coach': <Lightbulb className="h-6 w-6" />,
}

const BOT_ACCENT_COLORS: Record<string, string> = {
  indigo: '#6366f1',
  blue: '#2563eb',
  green: '#059669',
  red: '#e11d48',
  purple: '#7c3aed',
  pink: '#db2777',
  orange: '#ea580c',
  teal: '#0d9488',
  cyan: '#0891b2',
  amber: '#d97706',
}

const PROFILE_ACCENT_COLORS: Record<string, string> = {
  tutor: BOT_ACCENT_COLORS.teal,
  quiz: BOT_ACCENT_COLORS.pink,
  interview: BOT_ACCENT_COLORS.purple,
  oral_exam: BOT_ACCENT_COLORS.orange,
  dataset_generator: BOT_ACCENT_COLORS.cyan,
  math_coach: BOT_ACCENT_COLORS.blue,
}

const PROFILE_ACCENT_CLASSES: Record<string, string> = {
  tutor: 'bg-teal-600',
  quiz: 'bg-pink-600',
  interview: 'bg-violet-600',
  oral_exam: 'bg-orange-600',
  dataset_generator: 'bg-cyan-600',
  math_coach: 'bg-blue-600',
}

function resolveBotAccent(teacherbotColor?: string, profileKey?: string | null): string {
  if (teacherbotColor?.startsWith('#')) return teacherbotColor
  if (teacherbotColor && BOT_ACCENT_COLORS[teacherbotColor]) return BOT_ACCENT_COLORS[teacherbotColor]
  return (profileKey && PROFILE_ACCENT_COLORS[profileKey]) || BOT_ACCENT_COLORS.indigo
}

// Macro-area containers carry the four logo colours, but as translucent tinted
// surfaces with an in-tint border (same visual language as the cards), so they
// read as section headers while staying light and distinct from nested items.
type MacroAreaKey = 'assistants' | 'teacherbots' | 'learning' | 'rag'
const MACRO_AREA_COLORS: Record<MacroAreaKey, {
  surface: string
  iconChip: string
  badge: string
  line: string
}> = {
  assistants: {
    surface: 'bg-[rgba(254,0,77,0.07)] border-[rgba(254,0,77,0.20)] hover:bg-[rgba(254,0,77,0.10)] hover:border-[rgba(254,0,77,0.30)]',
    iconChip: 'bg-[rgba(254,0,77,0.14)] text-[#e3004a]',
    badge: 'bg-[rgba(254,0,77,0.13)] text-[#cf0a45]',
    line: 'rgba(254,0,77,0.30)',
  },
  teacherbots: {
    surface: 'bg-[rgba(123,105,201,0.08)] border-[rgba(123,105,201,0.20)] hover:bg-[rgba(123,105,201,0.12)] hover:border-[rgba(123,105,201,0.30)]',
    iconChip: 'bg-[rgba(123,105,201,0.16)] text-[#55449c]',
    badge: 'bg-[rgba(123,105,201,0.16)] text-[#55449c]',
    line: 'rgba(123,105,201,0.32)',
  },
  learning: {
    surface: 'bg-[rgba(62,169,244,0.09)] border-[rgba(62,169,244,0.22)] hover:bg-[rgba(62,169,244,0.13)] hover:border-[rgba(62,169,244,0.32)]',
    iconChip: 'bg-[rgba(62,169,244,0.16)] text-[#1278bd]',
    badge: 'bg-[rgba(62,169,244,0.16)] text-[#1278bd]',
    line: 'rgba(62,169,244,0.34)',
  },
  rag: {
    surface: 'bg-[rgba(23,21,27,0.05)] border-[rgba(23,21,27,0.14)] hover:bg-[rgba(23,21,27,0.08)] hover:border-[rgba(23,21,27,0.20)]',
    iconChip: 'bg-[rgba(23,21,27,0.08)] text-[#17151b]',
    badge: 'bg-[rgba(23,21,27,0.08)] text-[#17151b]',
    line: 'rgba(23,21,27,0.22)',
  },
}

// Tree connector (vertical rail + curved elbow) linking a nested item to its
// macro-area header, in the area's logo tint — like the reference sidebar.
function NavTreeConnector({ tint, isLast }: { tint: string; isLast: boolean }) {
  return (
    <>
      <span
        className="pointer-events-none absolute left-2 top-0 h-[calc(50%+1px)] w-3.5 rounded-bl-[10px] border-b border-l"
        style={{ borderColor: tint }}
      />
      {!isLast && (
        <span
          className="pointer-events-none absolute left-2 top-1/2 bottom-0 w-px"
          style={{ backgroundColor: tint }}
        />
      )}
    </>
  )
}



function getFallbackProfiles(t: (key: string) => string): ChatbotProfile[] {
  return [
    { key: 'tutor', name: t('chatbot.profile_tutor'), description: t('chatbot.profile_tutor_desc'), icon: 'graduation-cap', suggested_prompts: [t('chatbot.profile_tutor_p1'), t('chatbot.profile_tutor_p2')] },
    { key: 'quiz', name: t('chatbot.profile_quiz'), description: t('chatbot.profile_quiz_desc'), icon: 'clipboard-check', suggested_prompts: [t('chatbot.profile_quiz_p1'), t('chatbot.profile_quiz_p2')] },
    { key: 'interview', name: t('chatbot.profile_interview'), description: t('chatbot.profile_interview_desc'), icon: 'mic', suggested_prompts: [t('chatbot.profile_interview_p1'), t('chatbot.profile_interview_p2')] },
    { key: 'oral_exam', name: t('chatbot.profile_oral'), description: t('chatbot.profile_oral_desc'), icon: 'user-check', suggested_prompts: [t('chatbot.profile_oral_p1'), t('chatbot.profile_oral_p2')] },
    { key: 'dataset_generator', name: t('chatbot.profile_dataset'), description: t('chatbot.profile_dataset_desc'), icon: 'database', suggested_prompts: [t('chatbot.profile_dataset_p1'), t('chatbot.profile_dataset_p2')] },
    { key: 'math_coach', name: t('chatbot.profile_math'), description: t('chatbot.profile_math_desc'), icon: 'calculator', suggested_prompts: [t('chatbot.profile_math_p1'), t('chatbot.profile_math_p2')] },
  ]
}

type InterviewStep = { key: string; question: string }
type ProactiveProfileKey = 'quiz' | 'interview' | 'oral_exam' | 'dataset_generator' | 'math_coach'

const PROACTIVE_PROFILE_KEYS: ProactiveProfileKey[] = ['quiz', 'interview', 'oral_exam', 'dataset_generator', 'math_coach']

function getProfileInterviews(t: (key: string) => string): Record<ProactiveProfileKey, InterviewStep[]> {
  return {
    quiz: [
      { key: 'topic', question: t('chatbot.quiz_interview_intro') },
      { key: 'questionCount', question: t('chatbot.quiz_interview_q2') },
      { key: 'difficulty', question: t('chatbot.quiz_interview_q3') },
      { key: 'focus', question: t('chatbot.quiz_interview_q4') },
    ],
    interview: [
      { key: 'character', question: t('chatbot.interview_intro') },
      { key: 'period_or_topic', question: t('chatbot.interview_q2') },
      { key: 'tone', question: t('chatbot.interview_q3') },
      { key: 'goal', question: t('chatbot.interview_q4') },
    ],
    oral_exam: [
      { key: 'subject', question: t('chatbot.oral_intro') },
      { key: 'scope', question: t('chatbot.oral_q2') },
      { key: 'difficulty', question: t('chatbot.oral_q3') },
      { key: 'feedback', question: t('chatbot.oral_q4') },
    ],
    dataset_generator: [
      { key: 'context', question: t('chatbot.dataset_intro') },
      { key: 'columns', question: t('chatbot.dataset_q2') },
      { key: 'rows', question: t('chatbot.dataset_q3') },
      { key: 'constraints', question: t('chatbot.dataset_q4') },
    ],
    math_coach: [
      { key: 'topic', question: t('chatbot.math_intro') },
      { key: 'goal', question: t('chatbot.math_q2') },
      { key: 'level', question: t('chatbot.math_q3') },
      { key: 'style', question: t('chatbot.math_q4') },
    ],
  }
}

interface ConversationHistory {
  id: string
  title: string
  profile_key: string
  updated_at: string
}

interface LearningUnit {
  id: string
  title: string
  summary: string
  explanation: string
  keyPoints: string[]
}

interface LearningSession {
  id: string
  topic: string
  lesson: string
  createdAt: string
  conversationId?: string | null
  units?: LearningUnit[]
}

interface Teacherbot {
  id: string
  name: string
  synopsis: string
  description: string
  icon: string
  color: string
  is_proactive: boolean
  proactive_message: string | null
  enable_live_voice?: boolean
  is_studentbot?: boolean
}

interface StudentbotListItem {
  id: string
  name: string
  synopsis: string | null
  icon: string
  color: string
  status: string
  updated_at: string
  conversation_count: number
}

interface AttachedFile {
  file: globalThis.File
  preview?: string
  type: 'image' | 'document' | 'data'
  dataPreview?: DataFilePreview
}

const LEARNING_IMAGE_PREFIX = '__GENERATE_LEARNING_IMAGE__::'

function isAbortLikeError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false
  const error = err as { name?: string; code?: string; message?: string }
  return error.name === 'AbortError' || error.code === 'ERR_CANCELED' || error.message === 'canceled'
}

function normalizeLearningUnits(units: LearningUnit[] | undefined, topic: string, lesson: string): LearningUnit[] {
  if (units && units.length > 0) return units
  return [{
    id: 'unit-1',
    title: topic,
    summary: lesson,
    explanation: lesson,
    keyPoints: [],
  }]
}

function buildLearningUnitsMessage(topic: string, lesson: string, units: LearningUnit[], uiLanguage: 'it' | 'en') {
  const isEnglish = uiLanguage === 'en'
  return [
    isEnglish ? `📖 **Path: ${topic}**` : `📖 **Percorso: ${topic}**`,
    '',
    lesson,
    '',
    isEnglish
      ? 'Open the units below: each block expands only what has already been covered and can generate a focused quiz.'
      : 'Apri le unità qui sotto: ogni blocco approfondisce solo ciò che è stato trattato e può generare un quiz mirato.',
    '',
    '```learning_units',
    JSON.stringify({ topic, units }, null, 2),
    '```',
  ].join('\n')
}

function buildLearningQuizPrompt(topic: string, unit: LearningUnit, uiLanguage: 'it' | 'en') {
  const isEnglish = uiLanguage === 'en'
  const source = [
    isEnglish ? `Unit title: ${unit.title}` : `Titolo unità: ${unit.title}`,
    isEnglish ? `Summary: ${unit.summary}` : `Sintesi: ${unit.summary}`,
    isEnglish ? `Explanation: ${unit.explanation}` : `Spiegazione: ${unit.explanation}`,
    unit.keyPoints.length > 0 ? `${isEnglish ? 'Key points' : 'Punti chiave'}:\n- ${unit.keyPoints.join('\n- ')}` : '',
  ].filter(Boolean).join('\n')

  return [
    isEnglish
      ? `Generate a quiz ONLY about the following learning unit from the path "${topic}".`
      : `Genera un quiz SOLO sull'unità di apprendimento seguente del percorso "${topic}".`,
    isEnglish
      ? 'Do not introduce topics, terms, or examples that are not present in the source text.'
      : 'Non introdurre argomenti, termini o esempi non presenti nel testo sorgente.',
    isEnglish
      ? 'Create exactly 4 multiple-choice questions in English, with 4 options each and only one correct answer.'
      : 'Crea esattamente 4 domande a scelta multipla in italiano, con 4 opzioni ciascuna, una sola corretta.',
    isEnglish
      ? 'Add a short explanation of the correct answer for each question.'
      : 'Per ogni domanda aggiungi una breve spiegazione della risposta corretta.',
    isEnglish
      ? 'Reply only with a ```quiz block containing valid JSON compatible with the interface.'
      : 'Rispondi esclusivamente con un blocco ```quiz contenente JSON valido compatibile con l’interfaccia.',
    '',
    isEnglish ? 'MANDATORY SOURCE TEXT:' : 'TESTO SORGENTE VINCOLANTE:',
    source,
  ].join('\n')
}

function buildLearningImagePrompt(topic: string, unit: LearningUnit, uiLanguage: 'it' | 'en') {
  const isEnglish = uiLanguage === 'en'
  const source = [
    isEnglish ? `Unit title: ${unit.title}` : `Titolo unità: ${unit.title}`,
    isEnglish ? `Summary: ${unit.summary}` : `Sintesi: ${unit.summary}`,
    isEnglish ? `Explanation: ${unit.explanation}` : `Spiegazione: ${unit.explanation}`,
    unit.keyPoints.length > 0 ? `${isEnglish ? 'Key points' : 'Punti chiave'}:\n- ${unit.keyPoints.join('\n- ')}` : '',
  ].filter(Boolean).join('\n')

  return `${LEARNING_IMAGE_PREFIX}${[
    isEnglish
      ? `Create an educational illustration inspired ONLY by this unit from the path "${topic}".`
      : `Crea un'illustrazione didattica ispirata SOLO a questa unità del percorso "${topic}".`,
    isEnglish
      ? 'The image must help explain the concept clearly, visually, and concretely for a school setting.'
      : 'L’immagine deve aiutare a spiegare il concetto in modo chiaro, visivo, scolastico e concreto.',
    isEnglish
      ? 'Prefer diagrams, spatial relationships, label-friendly elements, explanatory scenes, and a clean composition.'
      : 'Privilegia diagrammi, relazioni spaziali, elementi etichettabili, scene esplicative e composizione pulita.',
    isEnglish
      ? 'Do not introduce content or details that are not present in the source text.'
      : 'Non introdurre contenuti o dettagli non presenti nel testo sorgente.',
    'Stile: educational infographic, clean glossy pastel, high clarity, minimal visual noise.',
    '',
    isEnglish ? 'MANDATORY SOURCE TEXT:' : 'TESTO SORGENTE VINCOLANTE:',
    source,
  ].join('\n')}`
}

type TeacherbotVisual = {
  Icon: LucideIcon
  label: string
  detail: string
}

function getTeacherbotVisual(bot: Teacherbot, uiLanguage: 'it' | 'en'): TeacherbotVisual {
  const source = `${bot.name} ${bot.synopsis} ${bot.description}`.toLowerCase()
  const isEnglish = uiLanguage === 'en'

  if (/(mat|alge|geometr|calcol|equaz|statistic)/.test(source)) {
    return isEnglish
      ? { Icon: Sigma, label: 'Math area', detail: 'Exercises, method, and guided steps' }
      : { Icon: Sigma, label: 'Area matematica', detail: 'Esercizi, metodo e passaggi guidati' }
  }
  if (/(scienz|chim|fisic|biolog|lab|esperiment)/.test(source)) {
    return isEnglish
      ? { Icon: FlaskConical, label: 'Science area', detail: 'Concepts, experiments, and phenomena' }
      : { Icon: FlaskConical, label: 'Area scientifica', detail: 'Concetti, esperimenti e fenomeni' }
  }
  if (/(stori|filosof|diritt|societ|politic|civica)/.test(source)) {
    return isEnglish
      ? { Icon: Landmark, label: 'History and society', detail: 'Context, interpretation, and connections' }
      : { Icon: Landmark, label: 'Area storico-sociale', detail: 'Contesto, interpretazione e collegamenti' }
  }
  if (/(ingles|frances|spagnol|tedesc|lingu|traduz)/.test(source)) {
    return isEnglish
      ? { Icon: Languages, label: 'Language area', detail: 'Comprehension, vocabulary, and production' }
      : { Icon: Languages, label: 'Area linguistica', detail: 'Comprensione, lessico e produzione' }
  }
  if (/(tema|scritt|letter|analisi|testo|narrativ)/.test(source)) {
    return isEnglish
      ? { Icon: ScrollText, label: 'Text area', detail: 'Analysis, synthesis, and writing' }
      : { Icon: ScrollText, label: 'Area testuale', detail: 'Analisi, sintesi e scrittura' }
  }
  if (/(ricerc|metod|studio|tesi|fonte|document)/.test(source)) {
    return isEnglish
      ? { Icon: BookText, label: 'Study method', detail: 'Sources, organisation, and deeper learning' }
      : { Icon: BookText, label: 'Metodo di studio', detail: 'Fonti, organizzazione e approfondimento' }
  }
  if (/(tecnolog|coding|informat|programmaz|ai|dato)/.test(source)) {
    return isEnglish
      ? { Icon: Microscope, label: 'Technical and digital area', detail: 'Procedures, tools, and problem solving' }
      : { Icon: Microscope, label: 'Area tecnico-digitale', detail: 'Procedure, strumenti e problem solving' }
  }

  return isEnglish
    ? { Icon: Wand2, label: 'Custom assistant', detail: 'Dedicated support created by the teacher' }
    : { Icon: Wand2, label: 'Assistente personalizzato', detail: 'Supporto dedicato creato dal docente' }
}

/** Renders a teacherbot's avatar icon — a custom lucide/emoji pick if the teacher set one,
 * otherwise the existing subject-keyword auto-detected icon. */
function TeacherbotAvatarIcon({ bot, uiLanguage, className }: { bot: Teacherbot; uiLanguage: 'it' | 'en'; className: string }) {
  const resolved = resolveTeacherbotIcon(bot.icon)
  if (resolved.kind === 'lucide') return <resolved.Icon className={className} />
  if (resolved.kind === 'emoji') {
    // Emoji glyphs don't respect h-*/w-* box classes like lucide icons do — approximate a
    // matching font-size from the Tailwind h-N unit (N * 0.25rem, the default spacing scale).
    const sizeMatch = className.match(/\bh-(\d+(?:\.\d+)?)\b/)
    const remSize = sizeMatch ? Number(sizeMatch[1]) * 0.25 : 1.25
    return <span className={className} style={{ fontSize: `${remSize}rem`, lineHeight: 1 }}>{resolved.emoji}</span>
  }
  const AutoIcon = getTeacherbotVisual(bot, uiLanguage).Icon
  return <AutoIcon className={className} />
}

// Mobile navigation state
type MobileViewState = 'profiles' | 'conversations' | 'chat'

export default function ChatbotModule({ sessionId, studentId, initialTeacherbotId, oggiImparoContext, onOggiImparoContextConsumed, onInputFocusChange, isTeacherPreview, studentAccent: accentProp, collaborationEnabled, onMinimize, onClose, onExpand, sidebarMode = false, dockArmed = false }: ChatbotModuleProps) {
  const { t, i18n } = useTranslation()
  // True once "Apri in sidebar" has been clicked but the panel is still full-page — the dock only
  // takes effect on the next navigation, so the button pulses green to confirm the click registered.
  const isDockArmed = dockArmed && !sidebarMode
  const uiLanguage: 'it' | 'en' = i18n.resolvedLanguage?.startsWith('en') ? 'en' : 'it'
  const queryClient = useQueryClient()
  const FALLBACK_PROFILES = getFallbackProfiles(t)
  const PROFILE_INTERVIEWS = getProfileInterviews(t)
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [conversationId, setConversationId] = useState<string | null>(null)
  const loadingConvIdRef = useRef<string | null>(null)
  const [showHistory, setShowHistory] = useState(false)
  const [selectedProfile, setSelectedProfile] = useState<string | null>(null)
  const [selectedModel, setSelectedModel] = useState<LLMModel | null>(null)
  const [showModelMenu, setShowModelMenu] = useState(false)
  const [attachedFiles, setAttachedFiles] = useState<AttachedFile[]>([])
  const [imageProvider, setImageProvider] = useState<'dall-e' | 'gpt-image-1.5'>('gpt-image-1.5')
  const messagesContainerRef = useRef<HTMLDivElement>(null)
  const [imageSize, setImageSize] = useState<string>('1024x1024')
  const [chatMode, setChatMode] = useState<'normal' | 'image' | 'quiz' | 'dataset'>('normal')
  const [showChatModeMenu, setShowChatModeMenu] = useState(false)
  const [showActionMenu, setShowActionMenu] = useState(false)
  const [showVoiceInterrogation, setShowVoiceInterrogation] = useState(false)
  const [voiceSource, setVoiceSource] = useState<VoiceSessionSource | undefined>(undefined)
  // Collaboration ("Condividi con") shared chat
  const [sharePickerTarget, setSharePickerTarget] = useState<ShareTarget | null>(null)
  const [activeSharedRoom, setActiveSharedRoom] = useState<SharedRoom | null>(null)
  const [sharedInvites, setSharedInvites] = useState<SharedRoom[]>([])
  const [expandedSection, setExpandedSection] = useState<'assistants' | 'teacherbots' | 'learning' | 'rag' | null>(null)
  const [imageGenerationProgress, setImageGenerationProgress] = useState<{
    status: string
    step: 'enhancing' | 'generating' | 'done' | 'error'
    enhancedPrompt?: string
  } | null>(null)
  const [verboseMode] = useState(false)
  const [chatBg, setChatBg] = useState<string>('')
  const [chatBgDefault, setChatBgDefault] = useState<string>('')
  const [showBgPalette, setShowBgPalette] = useState(false)
  const [profileInterview, setProfileInterview] = useState<{
    active: boolean
    profileKey: ProactiveProfileKey | null
    stepIndex: number
    answers: Record<string, string>
  }>({
    active: false,
    profileKey: null,
    stepIndex: 0,
    answers: {},
  })
  const [activeMasterPrompt, setActiveMasterPrompt] = useState<string | null>(null)
  const [isMasterPromptApplied, setIsMasterPromptApplied] = useState(false)
  // Learning section
  const [mainTab, setMainTab] = useState<'assistants' | 'teacherbots' | 'studentbots' | 'learning' | 'rag'>('assistants')
  const [navCollapsed, setNavCollapsed] = useState(false)
  const [ragSessions, setRagSessions] = useState<RagSession[]>(() => getRagSessions())
  const [activeRagSessionId, setActiveRagSessionId] = useState<string | null>(null)
  const [learningSessions, setLearningSessions] = useState<LearningSession[]>([])
  const [activeLearningSession, setActiveLearningSession] = useState<LearningSession | null>(null)
  const [learningMode, setLearningMode] = useState(false)
  const [chatbotSearch, setChatbotSearch] = useState('')
  const [librarySection, setLibrarySection] = useState<'favorites' | 'assistants' | 'teacherbots' | 'studentbots' | 'rag'>('assistants')
  const [studentbotEditorTarget, setStudentbotEditorTarget] = useState<'create' | string | null>(null)
  const [libraryViewMode, setLibraryViewMode] = useState<'grid' | 'list'>(() =>
    localStorage.getItem('student_ai_library_view') === 'list' ? 'list' : 'grid'
  )
  const [showNewLessonDialog, setShowNewLessonDialog] = useState(false)
  const [newLessonTopic, setNewLessonTopic] = useState('')
  const [generatingLesson, setGeneratingLesson] = useState(false)
  const [expandingLearningSessionId, setExpandingLearningSessionId] = useState<string | null>(null)
  const activeLearningSessionRef = useRef<string | null>(null)
  const [defaultModelKey, setDefaultModelKey] = useState(localStorage.getItem('student_default_model') || '')

  useEffect(() => {
    localStorage.setItem('student_ai_library_view', libraryViewMode)
  }, [libraryViewMode])
  const [isStreaming, setIsStreaming] = useState(false)
  const [streamingStatus, setStreamingStatus] = useState<string | null>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const modelMenuRef = useRef<HTMLDivElement>(null)
  const isGeneratingRef = useRef(false)
  const activeGenerationAbortRef = useRef<AbortController | null>(null)
  const lastEscapeKeyAtRef = useRef(0)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [isInputFocused, setIsInputFocused] = useState(false)
  const [studentAccent, setStudentAccent] = useState<StudentAccentId>(accentProp || DEFAULT_STUDENT_ACCENT)

  useEffect(() => {
    if (accentProp) {
      setStudentAccent(accentProp)
    } else {
      setStudentAccent(loadStudentAccent())
    }
  }, [accentProp])

  const accentTheme = useMemo(() => getStudentAccentTheme(studentAccent), [studentAccent])
  const accentVars = useMemo(() => ({
    '--student-accent': accentTheme.accent,
    '--student-accent-text': accentTheme.text,
    '--student-accent-soft': accentTheme.soft,
    '--student-accent-soft-strong': accentTheme.softStrong,
    '--student-accent-border': accentTheme.border,
  }) as CSSProperties, [accentTheme])
  const selectedSoftStyle = useMemo(() => ({
    backgroundColor: `color-mix(in srgb, ${accentTheme.accent} 10%, white)`,
    color: accentTheme.text,
    borderColor: `color-mix(in srgb, ${accentTheme.accent} 28%, transparent)`,
    backdropFilter: 'blur(8px)',
    boxShadow: `0 1px 2px color-mix(in srgb, ${accentTheme.accent} 10%, transparent)`,
  }) as CSSProperties, [accentTheme])
  const isDarkColor = (color: string) => {
    const hex = color.replace('#', '')
    const bigint = parseInt(hex.length === 3 ? hex.split('').map((c) => c + c).join('') : hex, 16)
    const r = (bigint >> 16) & 255
    const g = (bigint >> 8) & 255
    const b = bigint & 255
    const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255
    return luminance < 0.5
  }

  useEffect(() => {
    try {
      const storedDefault = localStorage.getItem('studentChatBgDefault')
      if (storedDefault) setChatBgDefault(storedDefault)
    } catch (e) {
      console.error('Failed to load default chat background', e)
    }
  }, [])

  useEffect(() => {
    try {
      const stored = localStorage.getItem(`studentChatBg:${sessionId}`)
      if (stored) {
        setChatBg(stored)
      } else if (chatBgDefault) {
        setChatBg(chatBgDefault)
      } else {
        setChatBg('')
      }
    } catch (e) {
      console.error('Failed to load chat background', e)
    }
  }, [sessionId, chatBgDefault])

  useEffect(() => {
    try {
      if (chatBg) {
        localStorage.setItem(`studentChatBg:${sessionId}`, chatBg)
      } else {
        localStorage.removeItem(`studentChatBg:${sessionId}`)
      }
    } catch (e) {
      console.error('Failed to save chat background', e)
    }
  }, [chatBg, sessionId])

  useEffect(() => {
    const handleResize = () => {
      if (window.innerWidth < 1200) {
        setShowHistory(false)
      }
    }
    handleResize()
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  const handleSetDefaultChatBg = (color: string) => {
    try {
      localStorage.setItem('studentChatBgDefault', color)
      setChatBgDefault(color)
    } catch (e) {
      console.error('Failed to save default chat background', e)
    }
  }

  const chatBgIsDark = chatBg ? isDarkColor(chatBg) : false

  const paletteGroups = useMemo(() => ([
    {
      label: 'Toni di grigio',
      colors: ['#f8fafc', '#f1f5f9', '#e2e8f0', '#cbd5e1', '#94a3b8'],
    },
    {
      label: 'Toni di azzurro',
      colors: ['#eff6ff', '#dbeafe', '#bfdbfe', '#93c5fd', '#60a5fa'],
    },
    {
      label: 'Toni di verde',
      colors: ['#ecfdf5', '#d1fae5', '#a7f3d0', '#6ee7b7', '#34d399'],
    },
    {
      label: 'Toni di viola',
      colors: ['#f5f3ff', '#ede9fe', '#ddd6fe', '#c4b5fd', '#a78bfa'],
    },
  ]), [])

  const modelKey = (m: Pick<LLMModel, 'provider' | 'model'> | null) =>
    m ? `${m.provider}:${m.model}` : ''

  // Mobile state
  const { isMobile } = useMobile()
  const [mobileView, setMobileView] = useState<MobileViewState>('profiles')

  // Teacherbot state
  const [selectedTeacherbot, setSelectedTeacherbot] = useState<Teacherbot | null>(null)
  const [teacherbotConversationId, setTeacherbotConversationId] = useState<string | null>(null)

  // Save/restore last conversation — key is per-student to avoid cross-student bleed on shared devices
  const convStorageKey = studentId
    ? `chatbot_last_conversation_${sessionId}_${studentId}`
    : null

  useEffect(() => {
    return () => {
      if (convStorageKey && conversationId && selectedProfile) {
        localStorage.setItem(convStorageKey, JSON.stringify({
          conversationId,
          profile: selectedProfile
        }))
      }
    }
  }, [conversationId, selectedProfile, convStorageKey])

  useEffect(() => {
    if (!convStorageKey) return
    const saved = localStorage.getItem(convStorageKey)
    if (saved) {
      try {
        const { conversationId: savedConvId, profile: savedProfile } = JSON.parse(saved)
        if (savedConvId && savedProfile) {
          setConversationId(savedConvId)
          setSelectedProfile(savedProfile)
          if (isMobile) {
            setMobileView('chat')
          }
          loadConversation(savedConvId).catch(() => {
            // Stale conversation (403/404) — clear it and start fresh
            localStorage.removeItem(convStorageKey)
            setConversationId(null)
            setSelectedProfile(null)
            setMessages([])
            if (isMobile) setMobileView('profiles')
          })
        }
      } catch (err) {
        console.error('Error restoring conversation:', err)
        if (convStorageKey) localStorage.removeItem(convStorageKey)
      }
    }
  }, [convStorageKey])

  // Fetch chatbot profiles
  const { data: profilesData } = useQuery({
    queryKey: ['chatbot-profiles'],
    queryFn: async () => {
      const res = await llmApi.getChatbotProfiles()
      return res.data as Record<string, ChatbotProfile>
    },
    staleTime: 1000 * 60 * 10,
  })

  // Fetch available LLM models
  const { data: modelsData } = useQuery({
    queryKey: ['available-models'],
    queryFn: async () => {
      const res = await llmApi.getAvailableModels()
      return res.data as { models: LLMModel[]; default_provider: string; default_model: string }
    },
    staleTime: 1000 * 60 * 10,
  })

  // Fetch session data to get teacher's default model
  const { data: sessionData } = useQuery({
    queryKey: ['student-session'],
    queryFn: async () => {
      const res = await studentApi.getSession()
      return res.data as { session: { default_llm_provider?: string; default_llm_model?: string } }
    },
    staleTime: 1000 * 60 * 5,
    enabled: !isTeacherPreview,
  })

  // Fetch conversation history — include studentId in key so different students don't share cache
  const { data: conversationsData, refetch: refetchConversations } = useQuery({
    queryKey: ['conversations', sessionId, studentId],
    queryFn: async () => {
      const res = await llmApi.getConversations(sessionId)
      return res.data as ConversationHistory[]
    },
    staleTime: 1000 * 60 * 2,
    enabled: !isTeacherPreview,
  })

  // Fetch available teacherbots for this session
  const { data: teacherbotsData } = useQuery({
    queryKey: ['student-teacherbots'],
    queryFn: async () => {
      const res = await teacherbotsApi.listAvailable()
      return res.data as Teacherbot[]
    },
    staleTime: 1000 * 60 * 2,
    enabled: !isTeacherPreview,
  })

  const { data: studentbotsData = [], isLoading: studentbotsLoading } = useQuery({
    queryKey: ['studentbots'],
    queryFn: async () => {
      const res = await studentbotsApi.list()
      return res.data as StudentbotListItem[]
    },
    staleTime: 1000 * 60,
    enabled: !isTeacherPreview,
  })

  const deleteStudentbotMutation = useMutation({
    mutationFn: (id: string) => studentbotsApi.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['studentbots'] })
      queryClient.invalidateQueries({ queryKey: ['student-teacherbots'] })
    },
  })

  // In teacher preview mode, load the specific bot via teacher API
  const { data: previewBotData } = useQuery({
    queryKey: ['teacherbot-preview', initialTeacherbotId],
    queryFn: async () => {
      const res = await teacherbotsApi.get(initialTeacherbotId!)
      return res.data as Teacherbot
    },
    enabled: !!isTeacherPreview && !!initialTeacherbotId,
    staleTime: 1000 * 60 * 5,
  })

  // Auto-select the bot in teacher preview mode
  useEffect(() => {
    if (isTeacherPreview && previewBotData) {
      setSelectedTeacherbot(previewBotData)
      setSelectedProfile(null)
      if (previewBotData.is_proactive && previewBotData.proactive_message) {
        setMessages([{
          id: 'proactive',
          role: 'assistant',
          content: previewBotData.proactive_message,
          timestamp: new Date(),
        }])
      } else {
        setMessages([])
      }
    }
  }, [isTeacherPreview, previewBotData])

  // Learning sessions localStorage helpers
  const learningStorageKey = `oggi_imparo_sessions_${sessionId ?? ''}`

  function loadLearningSessionsFromStorage(): LearningSession[] {
    try {
      const raw = localStorage.getItem(learningStorageKey)
      return raw ? JSON.parse(raw) : []
    } catch { return [] }
  }

  function saveLearningSessionToStorage(sessions: LearningSession[]) {
    try { localStorage.setItem(learningStorageKey, JSON.stringify(sessions)) } catch {}
  }

  function updateLearningSession(sessionId: string, updater: (session: LearningSession) => LearningSession) {
    const updated = learningSessions.map((session) =>
      session.id === sessionId ? updater(session) : session
    )
    setLearningSessions(updated)
    saveLearningSessionToStorage(updated)
    return updated.find((session) => session.id === sessionId) || null
  }

  function addLearningSession(session: LearningSession) {
    const updated = [session, ...learningSessions]
    setLearningSessions(updated)
    saveLearningSessionToStorage(updated)
  }

  function updateLearningSessionConvId(sessionId: string, convId: string) {
    const updated = learningSessions.map(s =>
      s.id === sessionId ? { ...s, conversationId: convId } : s
    )
    setLearningSessions(updated)
    saveLearningSessionToStorage(updated)
  }

  const expandLearningSession = useCallback(async (session: LearningSession) => {
    const existingUnits = normalizeLearningUnits(session.units, session.topic, session.lesson)
    if (session.units && session.units.length > 0) {
      return { ...session, units: existingUnits }
    }

    setExpandingLearningSessionId(session.id)
    try {
      const prompt = [
        uiLanguage === 'en'
          ? 'Expand this micro-lesson into small learning units that are clear, progressive, and non-redundant.'
          : 'Espandi questa microlezione in piccole unità di apprendimento chiare, progressive e non ridondanti.',
        uiLanguage === 'en' ? `Topic: "${session.topic}"` : `Argomento: "${session.topic}"`,
        uiLanguage === 'en' ? `Starting micro-lesson: "${session.lesson}"` : `Microlezione di partenza: "${session.lesson}"`,
        '',
        uiLanguage === 'en' ? 'Reply ONLY with valid JSON in this format:' : 'Rispondi SOLO con JSON valido nel formato:',
        '{',
        '  "units": [',
        '    {',
        uiLanguage === 'en' ? '      "title": "short string",' : '      "title": "stringa breve",',
        uiLanguage === 'en' ? '      "summary": "1 short sentence",' : '      "summary": "1 frase breve",',
        uiLanguage === 'en' ? '      "explanation": "compact but complete explanation, 80-160 words",' : '      "explanation": "spiegazione completa ma compatta, 80-160 parole",',
        uiLanguage === 'en' ? '      "keyPoints": ["point 1", "point 2", "point 3"]' : '      "keyPoints": ["punto 1", "punto 2", "punto 3"]',
        '    }',
        '  ]',
        '}',
        '',
        uiLanguage === 'en' ? 'Rules:' : 'Regole:',
        uiLanguage === 'en' ? '- create 3 to 5 units' : '- crea da 3 a 5 unità',
        uiLanguage === 'en' ? '- each unit must stay strictly aligned with the starting micro-lesson' : '- ogni unità deve trattare solo contenuti realmente coerenti con la microlezione iniziale',
        uiLanguage === 'en' ? '- do not introduce unnecessary external or advanced topics' : '- non introdurre argomenti esterni o avanzati non necessari',
        uiLanguage === 'en' ? '- use clear educational English' : '- usa italiano chiaro e didattico',
      ].join('\n')

      const res = await llmApi.studentChat(prompt, [], 'tutor')
      const raw = (res.data?.response ?? res.data?.content ?? '').trim()
      const parsed = JSON.parse(raw)
      const units = Array.isArray(parsed?.units)
        ? parsed.units.map((unit: any, index: number) => ({
            id: `unit-${index + 1}`,
            title: String(unit?.title || `Unità ${index + 1}`),
            summary: String(unit?.summary || ''),
            explanation: String(unit?.explanation || ''),
            keyPoints: Array.isArray(unit?.keyPoints)
              ? unit.keyPoints.map((point: unknown) => String(point)).filter(Boolean).slice(0, 5)
              : [],
          })).filter((unit: LearningUnit) => unit.title && unit.explanation)
        : []

      const normalizedUnits = normalizeLearningUnits(units, session.topic, session.lesson)
      const updatedSession = updateLearningSession(session.id, (current) => ({
        ...current,
        units: normalizedUnits,
      }))

      return updatedSession || { ...session, units: normalizedUnits }
    } catch (error) {
      console.error('Failed to expand learning session', error)
      return { ...session, units: existingUnits }
    } finally {
      setExpandingLearningSessionId(null)
    }
  }, [learningSessions, uiLanguage])

  async function openLearningSession(session: LearningSession) {
    setMainTab('learning')
    const expandedSession = await expandLearningSession(session)
    setActiveLearningSession(expandedSession)
    activeLearningSessionRef.current = session.id
    setLearningMode(true)
    setSelectedTeacherbot(null)
    setSelectedProfile('tutor')
    setActiveMasterPrompt(
      uiLanguage === 'en'
        ? `You are a dedicated educational tutor. The study topic is: "${expandedSession.topic}". The base micro-lesson is: "${expandedSession.lesson}". The learning units already explained are: ${normalizeLearningUnits(expandedSession.units, expandedSession.topic, expandedSession.lesson).map((unit) => `"${unit.title}: ${unit.explanation}"`).join(' | ')}. Help the student in English with practical examples and stimulating questions. When you generate quizzes, use only the content that has actually been explained in the units already shown. If the student uploads documents, analyse them within the context of the topic.`
        : `Sei un tutor educativo dedicato. Il tema di studio è: "${expandedSession.topic}". La micro-lezione di base è: "${expandedSession.lesson}". Le unità di apprendimento già spiegate sono: ${normalizeLearningUnits(expandedSession.units, expandedSession.topic, expandedSession.lesson).map((unit) => `"${unit.title}: ${unit.explanation}"`).join(' | ')}. Aiuta lo studente in italiano con esempi pratici e domande stimolanti. Quando generi quiz, usa soltanto i contenuti realmente spiegati nelle unità già mostrate. Se lo studente carica documenti, analizzali nel contesto del tema.`
    )
    setIsMasterPromptApplied(false)
    if (expandedSession.conversationId) {
      loadConversation(expandedSession.conversationId)
    } else {
      setConversationId(null)
      setMessages([{
        id: 'learning-intro',
        role: 'assistant' as const,
        content: buildLearningUnitsMessage(
          expandedSession.topic,
          expandedSession.lesson,
          normalizeLearningUnits(expandedSession.units, expandedSession.topic, expandedSession.lesson),
          uiLanguage
        ),
        timestamp: new Date(),
      }])
      if (isMobile) setMobileView('chat')
    }
  }

  // Auto-init from OggiImparo widget — creates a new Learning session
  useEffect(() => {
    if (!oggiImparoContext) return
    const sessions = loadLearningSessionsFromStorage()
    const newSession: LearningSession = {
      id: crypto.randomUUID(),
      topic: oggiImparoContext.slice(0, 80).trim(),
      lesson: oggiImparoContext,
      createdAt: new Date().toISOString(),
    }
    const updated = [newSession, ...sessions]
    setLearningSessions(updated)
    saveLearningSessionToStorage(updated)
    setMainTab('learning')
    openLearningSession(newSession)
    onOggiImparoContextConsumed?.()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [oggiImparoContext])

  // Load learning sessions on mount
  useEffect(() => {
    setLearningSessions(loadLearningSessionsFromStorage())
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [learningStorageKey])

  // Fetch teacherbot conversations
  const { data: teacherbotConversationsData, refetch: refetchTeacherbotConversations } = useQuery({
    queryKey: ['teacherbot-conversations', sessionId, studentId],
    queryFn: async () => {
      const res = await teacherbotsApi.getConversations()
      // Map to compatible format
      return (res.data as any[]).map(c => ({
        id: c.id,
        title: c.title,
        teacherbot_id: c.teacherbot_id,
        updated_at: c.created_at || new Date().toISOString(), // Use created_at if updated_at is missing
        is_teacherbot: true
      }))
    },
    staleTime: 1000 * 60 * 2,
    enabled: !isTeacherPreview,
  })

  const profiles: ChatbotProfile[] = useMemo(() => {
    const sourceProfiles = profilesData ? Object.values(profilesData) : FALLBACK_PROFILES
    const fallbackMap = new Map(FALLBACK_PROFILES.map((p) => [p.key, p]))
    return sourceProfiles.map((profile) => {
      const fallback = fallbackMap.get(profile.key)
      if (!fallback) return profile
      return {
        ...profile,
        name: fallback.name,
        description: fallback.description,
        suggested_prompts: fallback.suggested_prompts,
      }
    })
  }, [FALLBACK_PROFILES, profilesData])

  const addFileWithPreview = async (file: globalThis.File) => {
    const isImage = file.type.startsWith('image/')
    const isData = /\.(xlsx|xls|csv|json)$/i.test(file.name) ||
      file.type.includes('spreadsheet') || file.type.includes('excel') ||
      file.type === 'text/csv' || file.type === 'application/json'

    if (isImage) {
      const reader = new FileReader()
      reader.onload = (ev) => {
        setAttachedFiles(prev => [...prev, { file, type: 'image', preview: ev.target?.result as string }])
      }
      reader.readAsDataURL(file)
      return
    }

    if (isData) {
      // Add immediately as data type, then enrich with preview
      const attached: AttachedFile = { file, type: 'data' }
      setAttachedFiles(prev => [...prev, attached])
      try {
        const res = await llmApi.filePreview(file)
        const preview: DataFilePreview = res.data
        setAttachedFiles(prev =>
          prev.map(af => af.file === file ? { ...af, dataPreview: preview } : af)
        )
      } catch {
        // preview fetch failed — still keep the file
      }
      return
    }

    setAttachedFiles(prev => [...prev, { file, type: 'document' }])
  }

  const handleInputPaste = (e: React.ClipboardEvent) => {
    const fileItems = Array.from(e.clipboardData.items).filter(item => item.kind === 'file')
    if (fileItems.length === 0) return
    e.preventDefault()
    fileItems.forEach(item => {
      const file = item.getAsFile()
      if (!file) return
      addFileWithPreview(file)
    })
  }

  const typewriterEffect = (fullContent: string, messageId: string) => {
    isGeneratingRef.current = false
    setMessages(prev => prev.map(m =>
      m.id === messageId ? { ...m, content: fullContent } : m
    ))
  }

  const stopActiveGeneration = useCallback(() => {
    activeGenerationAbortRef.current?.abort()
    activeGenerationAbortRef.current = null
    setIsStreaming(false)
    setStreamingStatus(null)
    setImageGenerationProgress(null)
    setTimeout(() => inputRef.current?.focus(), 0)
  }, [])

  const runStudentStreamRequest = useCallback(async (convId: string, content: string) => {
    const studentToken = localStorage.getItem('student_token')
    const abortController = new AbortController()
    activeGenerationAbortRef.current?.abort()
    activeGenerationAbortRef.current = abortController
    setIsStreaming(true)
    const assistantId = `stream-${Date.now()}`
    setMessages(prev => [...prev, { id: assistantId, role: 'assistant' as const, content: '', timestamp: new Date() }])

    try {
      const response = await fetch(llmApi.sendMessageStreamUrl(convId), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(studentToken ? { 'student-token': studentToken } : {}),
        },
        credentials: 'include',
        signal: abortController.signal,
        body: JSON.stringify({ content, chat_mode: chatMode }),
      })

      if (!response.ok) throw new Error('Stream request failed')

      const reader = response.body?.getReader()
      const decoder = new TextDecoder()

      if (reader) {
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          const raw = decoder.decode(value)
          for (const line of raw.split('\n')) {
            if (!line.startsWith('data: ')) continue
            let data: any
            try { data = JSON.parse(line.slice(6)) } catch { continue }

            if (data.type === 'chunk') {
              setMessages(prev => prev.map(m =>
                m.id === assistantId ? { ...m, content: m.content + data.content } : m
              ))
            } else if (data.type === 'status') {
              setStreamingStatus(data.message)
            } else if (data.type === 'done') {
              setMessages(prev => prev.map(m =>
                m.id === assistantId ? {
                  ...m,
                  content: data.content || m.content,
                  provider: data.provider,
                  model: data.model,
                  token_usage_json: data.token_usage,
                } : m
              ))
              queryClient.invalidateQueries({ queryKey: ['llm-environmental-footprint'] })
            } else if (data.type === 'error') {
              throw new Error(data.message || 'Errore stream')
            }
          }
        }
      }
    } catch (err) {
      if (isAbortLikeError(err)) {
        setMessages(prev => prev.filter(m => m.id !== assistantId || m.content.trim().length > 0))
        return
      }
      console.error('Student stream error:', err)
      setMessages(prev => prev.map(m =>
        m.id === assistantId
          ? { ...m, content: `Mi dispiace, si è verificato un errore durante la generazione della risposta.` }
          : m
      ))
    } finally {
      if (activeGenerationAbortRef.current === abortController) {
        activeGenerationAbortRef.current = null
      }
      setIsStreaming(false)
      setStreamingStatus(null)
      refetchConversations()
      setTimeout(() => inputRef.current?.focus(), 0)
    }
  }, [queryClient, refetchConversations, inputRef, chatMode])

  const currentProfile = profiles.find(p => p.key === selectedProfile)
  const activeBotAccent = useMemo(
    () => resolveBotAccent(selectedTeacherbot?.color, selectedProfile),
    [selectedTeacherbot?.color, selectedProfile]
  )
  const activeBotSolidStyle = useMemo(() => ({
    backgroundColor: activeBotAccent,
    color: '#ffffff',
    boxShadow: `0 8px 20px color-mix(in srgb, ${activeBotAccent} 22%, transparent)`,
  }) as CSSProperties, [activeBotAccent])
  const activeBotSoftStyle = useMemo(() => ({
    backgroundColor: `color-mix(in srgb, ${activeBotAccent} 9%, white)`,
    borderColor: `color-mix(in srgb, ${activeBotAccent} 25%, transparent)`,
    color: `color-mix(in srgb, ${activeBotAccent} 82%, #0f172a)`,
  }) as CSSProperties, [activeBotAccent])

  const handleDockOrClose = useCallback(() => {
    if (sidebarMode) onClose?.()
    else onMinimize?.()
  }, [onClose, onMinimize, sidebarMode])
  const buildMasterPrompt = useCallback((profileKey: ProactiveProfileKey, answers: Record<string, string>) => {
    const payload = Object.entries(answers)
      .map(([k, v]) => `- ${k}: ${v}`)
      .join('\n')
    return [
      `Profilo attivo: ${profileKey}`,
      'Istruzioni operative:',
      '- Adatta tono, difficoltà e formato alle specifiche raccolte.',
      '- Rimani focalizzato sul compito didattico del profilo attivo.',
      '- Mantieni risposte chiare, progressive e adatte a studenti.',
      '- Quando utile, proponi il prossimo passo in modo proattivo.',
      '',
      'Specifiche raccolte:',
      payload,
    ].join('\n')
  }, [])

  const resetProfileInterview = useCallback(() => {
    setProfileInterview({ active: false, profileKey: null, stepIndex: 0, answers: {} })
  }, [])

  const startProfileInterview = useCallback((profileKey: ProactiveProfileKey) => {
    const steps = PROFILE_INTERVIEWS[profileKey]
    setProfileInterview({
      active: true,
      profileKey,
      stepIndex: 0,
      answers: {},
    })
    setMessages([
      {
        id: `proactive-${Date.now()}`,
        role: 'assistant',
        content: steps[0].question,
        timestamp: new Date(),
      },
    ])
    setActiveMasterPrompt(null)
    setIsMasterPromptApplied(false)
  }, [])

  const scrollToBottom = () => {
    if (!isGeneratingRef.current) {
      const container = messagesContainerRef.current
      if (container) {
        container.scrollTo({ top: container.scrollHeight, behavior: 'instant' as ScrollBehavior })
      }
    }
  }

  useEffect(() => {
    if (messages.length > 0) {
      const lastMessage = messages[messages.length - 1]
      if (lastMessage.role === 'user' || !isGeneratingRef.current) {
        scrollToBottom()
      }
    }
  }, [messages.length])

  // Keep the auto-growing composer in sync when `input` changes programmatically
  // (cleared after send, suggestion clicks, voice transcription, …).
  useEffect(() => {
    const el = inputRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`
  }, [input])

  // Collaboration: load ongoing shared rooms + listen for invitations.
  useEffect(() => {
    if (!collaborationEnabled || isTeacherPreview) return
    let cancelled = false
    collaborationApi.listRooms()
      .then((res) => { if (!cancelled) setSharedInvites((res.data as SharedRoom[]) || []) })
      .catch(() => { /* noop */ })

    const socket = (window as any).socket as { on: (e: string, cb: (d: any) => void) => void; off: (e: string, cb: (d: any) => void) => void } | undefined
    if (!socket) return () => { cancelled = true }

    const onInvite = (data: { room: SharedRoom }) => {
      setSharedInvites((prev) => prev.some((r) => r.id === data.room.id) ? prev : [data.room, ...prev])
    }
    const onClosed = (data: { room_id: string }) => {
      setSharedInvites((prev) => prev.filter((r) => r.id !== data.room_id))
      setActiveSharedRoom((cur) => (cur && cur.id === data.room_id ? null : cur))
    }
    socket.on('share_chat_invite', onInvite)
    socket.on('share_chat_closed', onClosed)
    return () => {
      cancelled = true
      socket.off('share_chat_invite', onInvite)
      socket.off('share_chat_closed', onClosed)
    }
  }, [collaborationEnabled, isTeacherPreview])

  // Collaboration: when a shared room is active, mirror its messages into the
  // normal chat (keeping every feature) and subscribe to live updates.
  const preSharedMessagesRef = useRef<Message[] | null>(null)
  const mapSharedMessage = useCallback((m: any): Message => ({
    id: m.id,
    role: m.role,
    content: m.content,
    timestamp: m.created_at ? new Date(m.created_at) : new Date(),
    senderStudentId: m.sender_student_id ?? null,
    senderNickname: m.sender_nickname ?? null,
    isPeer: !!m.is_peer,
  }), [])

  useEffect(() => {
    if (!activeSharedRoom) return
    const roomId = activeSharedRoom.id
    if (preSharedMessagesRef.current === null) preSharedMessagesRef.current = messages

    // Select the room's bot/profile so the chat view renders with the right header,
    // even for an invited student who hadn't opened any chatbot yet.
    if (activeSharedRoom.kind === 'assistant' && activeSharedRoom.profile_key) {
      setSelectedTeacherbot(null)
      setSelectedProfile(activeSharedRoom.profile_key)
    } else if (activeSharedRoom.kind === 'teacherbot' && activeSharedRoom.teacherbot_id) {
      const bot = (teacherbotsData || []).find((b) => b.id === activeSharedRoom.teacherbot_id)
      setSelectedProfile(null)
      if (bot) setSelectedTeacherbot(bot)
    }
    setLearningMode(false)
    setMainTab((prev) => (prev === 'rag' ? 'assistants' : prev))

    let cancelled = false
    collaborationApi.getRoom(roomId)
      .then((res) => {
        if (cancelled) return
        const data = res.data as { messages?: any[] }
        setMessages((data.messages || []).map(mapSharedMessage))
      })
      .catch(() => { /* keep optimistic */ })

    const socket = (window as any).socket as { on: (e: string, cb: (d: any) => void) => void; off: (e: string, cb: (d: any) => void) => void } | undefined
    const onMessage = (d: { room_id: string; message: any }) => {
      if (d.room_id !== roomId) return
      setMessages((prev) => prev.some((x) => x.id === d.message.id) ? prev : [...prev, mapSharedMessage(d.message)])
    }
    const onClosed = (d: { room_id: string }) => { if (d.room_id === roomId) setActiveSharedRoom(null) }
    socket?.on('share_chat_message', onMessage)
    socket?.on('share_chat_closed', onClosed)
    return () => {
      cancelled = true
      socket?.off('share_chat_message', onMessage)
      socket?.off('share_chat_closed', onClosed)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSharedRoom, mapSharedMessage])

  // Restore the normal conversation when leaving shared mode.
  useEffect(() => {
    if (activeSharedRoom) return
    if (preSharedMessagesRef.current !== null) {
      setMessages(preSharedMessagesRef.current)
      preSharedMessagesRef.current = null
    }
  }, [activeSharedRoom])

  // Open a shared room requested from elsewhere (e.g. the notification bell).
  // Handles both a live event and a pending request stored before this module mounted.
  useEffect(() => {
    const openRoom = (room: SharedRoom) => {
      setActiveSharedRoom(room)
      setSharedInvites((prev) => prev.some((r) => r.id === room.id) ? prev : [room, ...prev])
    }
    const onEvent = (e: Event) => {
      const room = (e as CustomEvent<{ room?: SharedRoom }>).detail?.room
      if (room) { openRoom(room); try { localStorage.removeItem('pending_shared_chat') } catch { /* noop */ } }
    }
    window.addEventListener('golinelli:open-shared-chat', onEvent as EventListener)
    try {
      const pending = localStorage.getItem('pending_shared_chat')
      if (pending) { openRoom(JSON.parse(pending)); localStorage.removeItem('pending_shared_chat') }
    } catch { /* noop */ }
    return () => window.removeEventListener('golinelli:open-shared-chat', onEvent as EventListener)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const sendMessageMutation = useMutation({
    mutationFn: async ({ content, files, existingHistory }: { content: string; files: globalThis.File[]; existingHistory?: Message[] }) => {
      const abortController = new AbortController()
      activeGenerationAbortRef.current?.abort()
      activeGenerationAbortRef.current = abortController
      const { signal } = abortController

      // TEACHERBOT MODE
      if (selectedTeacherbot) {
        // Teacher preview: use the test endpoint (no student session needed)
        if (isTeacherPreview) {
          const history = messages.map(m => ({ role: m.role, content: m.content }))
          const res = await teacherbotsApi.test(selectedTeacherbot.id, content, history, signal)
          return { content: res.data.content, id: Date.now().toString() }
        }

        let convId = teacherbotConversationId
        if (!convId) {
          const convRes = await teacherbotsApi.startConversation(selectedTeacherbot.id, sessionId, signal)
          convId = convRes.data.id
          setTeacherbotConversationId(convId)
        }

        if (files.length > 0) {
          const res = await teacherbotsApi.sendMessageWithFiles(convId!, content, files, signal)
          return res.data
        }

        const res = await teacherbotsApi.sendMessage(convId!, content, signal)
        return res.data
      }

      // STANDARD PROFILE MODE
      let convId = conversationId
      if (!convId) {
        const modelProvider = effectiveSelectedModel?.provider || sessionData?.session?.default_llm_provider
        const modelName = effectiveSelectedModel?.model || sessionData?.session?.default_llm_model
        const convRes = await llmApi.createConversation(
          sessionId,
          selectedProfile || 'tutor',
          undefined,
          modelProvider,
          modelName,
          signal
        )
        convId = convRes.data.id
        setConversationId(convId)

        // If in a learning session, store the new conversationId
        if (activeLearningSessionRef.current && convId) {
          updateLearningSessionConvId(activeLearningSessionRef.current, convId)
        }

        // If we had history (e.g. from a proactive interview), we might want to persist it.
        // But for the FIRST message from user, existingHistory will likely be empty or just the current message.
        // We only want to send messages that are NOT the current one.
        if (existingHistory && existingHistory.length > 0) {
          const actualHistory = existingHistory.filter(m => m.content !== content);
          for (const msg of actualHistory) {
            await llmApi.sendMessage(convId!, msg.content, undefined, undefined, undefined, signal)
          }
        }
      }

      if (files.length > 0) {
        const res = await llmApi.sendMessageWithFiles(convId!, content, files, signal)
        return res.data
      }

      const res = await llmApi.sendMessage(convId!, content, imageProvider, imageSize, verboseMode, signal)
      return res.data
    },
    onSuccess: (data) => {
      const fullContent = data.content || data.assistant_message || 'Risposta ricevuta'
      const messageId = data.id || Date.now().toString()
      const hasBase64Image = fullContent.includes('data:image') && fullContent.includes('base64')

      const assistantMessage: Message = {
        id: messageId,
        role: 'assistant',
        content: hasBase64Image ? fullContent : '',
        timestamp: new Date(),
        provider: data.provider,
        model: data.model,
        token_usage_json: data.token_usage_json,
      }
      setMessages((prev) => [...prev, assistantMessage])
      setAttachedFiles([])
      queryClient.invalidateQueries({ queryKey: ['llm-environmental-footprint'] })

      if (!hasBase64Image) {
        typewriterEffect(fullContent, messageId)
      }

      if (!selectedTeacherbot) {
        refetchConversations()
      } else if (!isTeacherPreview) {
        refetchTeacherbotConversations()
      }

      // Focus input after bot response so user can type immediately
      setTimeout(() => {
        inputRef.current?.focus()
      }, 0)
    },
    onError: (e: any) => {
      if (isAbortLikeError(e)) return
      console.error("Student chat error:", e)
      if (e.response) {
        console.error("Server Error Data:", e.response.data)
        console.error("Server Error Status:", e.response.status)
      }
      const errorMessage: Message = {
        id: Date.now().toString(),
        role: 'assistant',
        content: `Mi dispiace, si è verificato un errore: ${e.response?.data?.detail || e.message}. Controlla la console per i dettagli.`,
        timestamp: new Date(),
      }
      setMessages((prev) => [...prev, errorMessage])
    },
    onSettled: () => {
      activeGenerationAbortRef.current = null
    },
  })

  const isGeneratingResponse = sendMessageMutation.isPending || isStreaming || Boolean(imageGenerationProgress)

  useEffect(() => {
    if (!isGeneratingResponse) return

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      const now = Date.now()
      if (now - lastEscapeKeyAtRef.current <= 500) {
        event.preventDefault()
        stopActiveGeneration()
        lastEscapeKeyAtRef.current = 0
      } else {
        lastEscapeKeyAtRef.current = now
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [isGeneratingResponse, stopActiveGeneration])

  const handleImageGeneration = useCallback(async (messageContent: string) => {
    const userMessage: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: messageContent,
      timestamp: new Date(),
    }
    setMessages(prev => [...prev, userMessage])
    setInput('')

    const abortController = new AbortController()
    activeGenerationAbortRef.current?.abort()
    activeGenerationAbortRef.current = abortController

    try {
      setImageGenerationProgress({ status: 'Ottimizzazione del prompt con il contesto della chat...', step: 'enhancing' })

      const expansionPrompt = `Sei un esperto Prompt Engineer per la generazione di immagini AI. Analizza la conversazione precedente e crea un prompt dettagliato e ottimizzato per generare un'immagine.

Richiesta utente: "${messageContent}"

REGOLE IMPORTANTI:
- Scrivi SOLO il prompt in inglese, nient'altro.
- Usa il contesto della conversazione precedente se rilevante (stile, soggetti, ambientazione già discussi).
- Sii molto descrittivo: specifica stile artistico, illuminazione, composizione, colori e dettagli.
- NON scrivere spiegazioni, commenti o testo aggiuntivo.
- Rispondi SOLO con il prompt ottimizzato.`

      const history = messages.map(m => ({ role: m.role, content: m.content }))
      const expansionRes = await llmApi.studentChat(expansionPrompt, history, 'tutor', 'openai', 'gpt-5.4-mini', abortController.signal)
      const enhancedPrompt = expansionRes.data?.response?.trim() || messageContent

      setImageGenerationProgress({ status: 'Generazione immagine in corso...', step: 'generating', enhancedPrompt })

      const genRes = await llmApi.generateImage(enhancedPrompt, imageProvider, abortController.signal)
      const imageUrl = genRes.data?.image_url

      setImageGenerationProgress(null)

      if (imageUrl) {
        const assistantMessage: Message = {
          id: `img-${Date.now()}`,
          role: 'assistant',
          content: `**Immagine Generata**\n\n![Generata](${imageUrl})\n\n**Prompt:** \`${enhancedPrompt}\``,
          timestamp: new Date(),
          provider: imageProvider === 'dall-e' || imageProvider === 'gpt-image-1.5' ? 'openai' : 'flux',
          model: imageProvider === 'dall-e' ? 'dall-e-3' : imageProvider,
          token_usage_json: { image_count: 1 },
        }
        setMessages(prev => [...prev, assistantMessage])
        queryClient.invalidateQueries({ queryKey: ['llm-environmental-footprint'] })
      } else {
        throw new Error('Nessuna immagine ricevuta dal server')
      }
    } catch (err: any) {
      if (isAbortLikeError(err)) return
      setImageGenerationProgress(null)
      const errMessage: Message = {
        id: `err-${Date.now()}`,
        role: 'assistant',
        content: `Mi dispiace, si è verificato un errore nella generazione: ${err.response?.data?.detail || err.message}`,
        timestamp: new Date(),
      }
      setMessages(prev => [...prev, errMessage])
    } finally {
      if (activeGenerationAbortRef.current === abortController) {
        activeGenerationAbortRef.current = null
      }
      setImageGenerationProgress(null)
      setTimeout(() => inputRef.current?.focus(), 0)
    }
  }, [messages, imageProvider, queryClient])

  const handleSend = useCallback((content?: string, files?: globalThis.File[]) => {
    const messageContent = content ?? input
    const messageFiles = files ?? attachedFiles.map(af => af.file)

    if ((!messageContent.trim() && messageFiles.length === 0) || isGeneratingResponse) return

    // COLLABORATION MODE — send to the shared room; the socket echoes the message
    // (and the bot reply) back to every participant. Voice transcribes into the
    // input, so it works here too; @nickname keeps a message peer-only.
    if (activeSharedRoom) {
      const text = messageContent.trim()
      if (!text) return
      setInput('')
      collaborationApi.sendMessage(activeSharedRoom.id, text).catch(() => {})
      return
    }

    if (profileInterview.active && profileInterview.profileKey) {
      const steps = PROFILE_INTERVIEWS[profileInterview.profileKey]
      const currentStep = steps[profileInterview.stepIndex]
      if (!currentStep) return

      const value = messageContent.trim()
      if (!value) return

      const userMessage: Message = {
        id: Date.now().toString(),
        role: 'user',
        content: value,
        timestamp: new Date(),
      }
      setMessages((prev) => [...prev, userMessage])

      const nextAnswers = { ...profileInterview.answers, [currentStep.key]: value }
      const isLast = profileInterview.stepIndex >= steps.length - 1
      if (!isLast) {
        const nextStepIndex = profileInterview.stepIndex + 1
        setProfileInterview({
          active: true,
          profileKey: profileInterview.profileKey,
          stepIndex: nextStepIndex,
          answers: nextAnswers,
        })
        const assistantMessage: Message = {
          id: `proactive-next-${Date.now()}`,
          role: 'assistant',
          content: steps[nextStepIndex].question,
          timestamp: new Date(),
        }
        setMessages((prev) => [...prev, assistantMessage])
      } else {
        const masterPrompt = buildMasterPrompt(profileInterview.profileKey, nextAnswers)
        setActiveMasterPrompt(masterPrompt)
        setIsMasterPromptApplied(false)
        setProfileInterview({
          active: false,
          profileKey: profileInterview.profileKey,
          stepIndex: steps.length,
          answers: nextAnswers,
        })
        const assistantMessage: Message = {
          id: `proactive-done-${Date.now()}`,
          role: 'assistant',
          content: uiLanguage === 'en'
            ? 'Perfect, I have collected the main information. From now on I will use these directions to guide the chatbot in a more personalised way. Write your first request whenever you are ready.'
            : 'Perfetto, ho raccolto le informazioni principali. Da ora usero queste indicazioni per guidare il chatbot in modo personalizzato. Scrivi la tua prima richiesta quando vuoi.',
          timestamp: new Date(),
        }
        setMessages((prev) => [...prev, assistantMessage])
      }

      setInput('')
      return
    }

    // IMAGE GENERATION MODE — intercept before normal flow (works for both regular chatbot and teacherbot)
    if (chatMode === 'image' && !profileInterview.active) {
      handleImageGeneration(messageContent.trim())
      return
    }

    if (messageContent.startsWith(LEARNING_IMAGE_PREFIX)) {
      handleImageGeneration(messageContent.slice(LEARNING_IMAGE_PREFIX.length).trim())
      return
    }

    const filesInfo = messageFiles.length > 0
      ? ` [Allegati: ${messageFiles.map(f => f.name).join(', ')}]`
      : ''

    const rawUserContent = messageContent.trim()
    let contentForApi = rawUserContent
    if (!selectedTeacherbot && activeMasterPrompt && !isMasterPromptApplied && rawUserContent) {
      contentForApi = uiLanguage === 'en'
        ? `LEARNING CONTEXT TO APPLY:\n${activeMasterPrompt}\n\nStudent request:\n${rawUserContent}`
        : `CONTESTO DIDATTICO DA APPLICARE:\n${activeMasterPrompt}\n\nRichiesta studente:\n${rawUserContent}`
      setIsMasterPromptApplied(true)
    }

    // QUIZ MODE — inject structured quiz generation instruction (works for both regular chatbot and teacherbot)
    if (chatMode === 'quiz' && !profileInterview.active) {
      const quizInstruction = [
        uiLanguage === 'en'
          ? 'Generate a multiple-choice quiz in English based on the following request.'
          : 'Genera un quiz a scelta multipla in italiano basato sulla richiesta seguente.',
        uiLanguage === 'en'
          ? 'Reply ONLY with a ```quiz block containing valid JSON in this format:'
          : 'Rispondi ESCLUSIVAMENTE con un blocco ```quiz contenente JSON valido nel formato:',
        '{"title":"titolo quiz","questions":[{"question":"...","options":["a","b","c","d"],"correctIndex":0,"explanation":"..."}]}',
        uiLanguage === 'en'
          ? 'Create exactly 4 questions with 4 options each. Only one correct option. Add a short explanation for each answer.'
          : 'Crea esattamente 4 domande con 4 opzioni ciascuna. Una sola opzione corretta. Aggiungi una breve spiegazione per ogni risposta.',
        '',
        `${uiLanguage === 'en' ? 'Request' : 'Richiesta'}: ${rawUserContent}`,
      ].join('\n')
      contentForApi = quizInstruction
    }

    // DATASET MODE — inject dataset generation instruction (works for both regular chatbot and teacherbot)
    if (chatMode === 'dataset' && !profileInterview.active) {
      const datasetInstruction = [
        uiLanguage === 'en'
          ? 'Generate a structured, realistic, and immediately usable dataset based on the following request.'
          : 'Genera un dataset strutturato, realistico e immediatamente utilizzabile basato sulla richiesta seguente.',
        uiLanguage === 'en'
          ? 'Reply with the dataset in CSV format (well-defined columns, realistic data, at least 10 rows).'
          : 'Rispondi con il dataset in formato CSV (colonne ben definite, dati realistici, almeno 10 righe).',
        uiLanguage === 'en'
          ? 'If the request explicitly asks for JSON or another format, use that. Do not add any text outside the dataset.'
          : 'Se la richiesta specifica JSON o altro formato, usa quello. Non aggiungere testo aggiuntivo fuori dal dataset.',
        '',
        `${uiLanguage === 'en' ? 'Request' : 'Richiesta'}: ${rawUserContent}`,
      ].join('\n')
      contentForApi = datasetInstruction
    }

    const userMessage: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: (rawUserContent || (uiLanguage === 'en' ? 'Analyse these documents' : 'Analizza questi documenti')) + filesInfo,
      timestamp: new Date(),
    }
    setMessages((prev) => [...prev, userMessage])
    setInput('')
    setAttachedFiles([])

    // Text-only standard profile mode → use streaming endpoint for typewriter + web search feedback
    if (!selectedTeacherbot && !isTeacherPreview && messageFiles.length === 0 && conversationId) {
      runStudentStreamRequest(conversationId, contentForApi)
      return
    }

    // All other cases: teacherbot, files, teacher preview, or no convId yet
    sendMessageMutation.mutate({
      content: contentForApi,
      files: messageFiles,
      existingHistory: !conversationId && messages.length > 0 ? messages : undefined
    })
  }, [
    input,
    attachedFiles,
    sendMessageMutation,
    isGeneratingResponse,
    conversationId,
    messages,
    profileInterview,
    buildMasterPrompt,
    selectedTeacherbot,
    activeMasterPrompt,
    isMasterPromptApplied,
    isTeacherPreview,
    runStudentStreamRequest,
    chatMode,
    handleImageGeneration,
    activeSharedRoom,
  ])

  const handleNewChat = useCallback(async () => {
    triggerHaptic('light')
    // In learning mode, go back to the learning list instead of full reset
    if (learningMode) {
      setMessages([])
      setConversationId(null)
      setSelectedProfile(null)
      setActiveMasterPrompt(null)
      setIsMasterPromptApplied(false)
      setLearningMode(false)
      setActiveLearningSession(null)
      activeLearningSessionRef.current = null
      return
    }

    // End teacherbot conversation if exists
    if (teacherbotConversationId) {
      try {
        await teacherbotsApi.endConversation(teacherbotConversationId)
      } catch (err) {
        console.error('Error ending teacherbot conversation:', err)
      }
    }

    setMessages([])
    setConversationId(null)
    setSelectedProfile(null)
    setSelectedModel(null)
    setSelectedTeacherbot(null)
    setTeacherbotConversationId(null)
    setActiveMasterPrompt(null)
    setIsMasterPromptApplied(false)
    resetProfileInterview()
    if (isMobile) {
      setMobileView('profiles')
    }
  }, [isMobile, learningMode, teacherbotConversationId, resetProfileInterview])

  const loadConversation = async (convId: string, isTeacherbotMsg = false) => {
    loadingConvIdRef.current = convId
    setConversationId(convId)
    setMessages([])  // Clear immediately so old messages don't bleed into the new view
    // Determine if it's a teacherbot conversation from the list
    const tbConv = teacherbotConversationsData?.find(c => c.id === convId)
    const isTeacherbot = isTeacherbotMsg || !!tbConv

    if (isTeacherbot && tbConv) {
      setTeacherbotConversationId(convId)
      const bot = allAvailableTeacherbots.find(b => b.id === tbConv.teacherbot_id)
      if (bot) {
        setSelectedTeacherbot(bot)
        setSelectedProfile(null)
      }
      try {
        const res = await teacherbotsApi.getConversationMessages(convId)
        if (loadingConvIdRef.current !== convId) return  // Stale response — a newer load superseded this one
        const loadedMessages: Message[] = res.data.map((m: any) => ({
          id: m.id,
          role: m.role,
          content: m.content,
          timestamp: new Date(m.created_at),
          provider: m.provider,
          model: m.model,
          token_usage_json: m.token_usage_json,
        }))
        setMessages(loadedMessages)
        if (isMobile) setMobileView('chat')
      } catch (err) {
        console.error('Error loading tb conv', err)
      }
      return
    }

    // Regular conversation load
    setTeacherbotConversationId(null)
    setSelectedTeacherbot(null)

    try {
      const res = await llmApi.getMessages(convId)
      if (loadingConvIdRef.current !== convId) return  // Stale response — a newer load superseded this one
      const serverMessages: Message[] = res.data.map((m: { id: string; role: string; content: string; created_at: string; provider?: string; model?: string; token_usage_json?: TokenUsageJson }) => ({
        id: m.id,
        role: m.role as 'user' | 'assistant',
        content: m.content,
        timestamp: new Date(m.created_at),
        provider: m.provider,
        model: m.model,
        token_usage_json: m.token_usage_json,
      }))
      const learningSession = activeLearningSessionRef.current
        ? learningSessions.find((session) => session.id === activeLearningSessionRef.current)
        : null
      const introMessage = learningSession
        ? {
            id: `learning-intro-${learningSession.id}`,
            role: 'assistant' as const,
            content: buildLearningUnitsMessage(
              learningSession.topic,
              learningSession.lesson,
              normalizeLearningUnits(learningSession.units, learningSession.topic, learningSession.lesson),
              uiLanguage
            ),
            timestamp: new Date(learningSession.createdAt),
          }
        : null

      setMessages(introMessage ? [introMessage, ...serverMessages] : serverMessages)

      const conv = conversationsData?.find(c => c.id === convId)
      if (conv) {
        setSelectedProfile(conv.profile_key)
      }
      if (isMobile) {
        setMobileView('chat')
      }
    } catch (err) {
      console.error('Error loading conversation:', err)
      throw err  // re-throw so callers can handle (e.g. restore effect clearing stale entry)
    }
  }

  const handleSelectProfile = useCallback(async (profileKey: string) => {
    triggerHaptic('selection')

    // End teacherbot conversation if switching from teacherbot to profile
    if (teacherbotConversationId) {
      try {
        await teacherbotsApi.endConversation(teacherbotConversationId)
      } catch (err) {
        console.error('Error ending teacherbot conversation:', err)
      }
    }

    setSelectedProfile(profileKey)
    setMainTab('assistants')
    setSelectedTeacherbot(null)
    setTeacherbotConversationId(null)
    setMessages([])
    setConversationId(null)
    setActiveMasterPrompt(null)
    setIsMasterPromptApplied(false)
    resetProfileInterview()
    if (isMobile) {
      setMobileView('conversations')
    }

    // Auto-resume most recent conversation for this profile
    const recentConv = (conversationsData || [])
      .slice() // don't mutate
      .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime())
      .find(c => c.profile_key === profileKey)

    if (recentConv) {
      loadConversation(recentConv.id)
      return
    }

    if (PROACTIVE_PROFILE_KEYS.includes(profileKey as ProactiveProfileKey) && chatMode !== 'dataset') {
      startProfileInterview(profileKey as ProactiveProfileKey)
      if (isMobile) {
        setMobileView('chat')
      }
    }
  }, [isMobile, teacherbotConversationId, resetProfileInterview, startProfileInterview, conversationsData, loadConversation, chatMode])

  const handleStartNewConversation = useCallback(() => {
    triggerHaptic('light')
    if (mainTab === 'rag') {
      const nextSession = createRagSession()
      saveRagSession(nextSession)
      setRagSessions(getRagSessions())
      setActiveRagSessionId(nextSession.id)
      setSelectedProfile(null)
      setSelectedTeacherbot(null)
      setLearningMode(false)
      setActiveLearningSession(null)
      return
    }
    setMessages([])
    setConversationId(null)
    setTeacherbotConversationId(null)
    setActiveMasterPrompt(null)
    setIsMasterPromptApplied(false)
    resetProfileInterview()
    if (isMobile) {
      setMobileView('chat')
    }
  }, [isMobile, mainTab, resetProfileInterview])

  const handleGenerateLesson = async () => {
    if (!newLessonTopic.trim() || generatingLesson) return
    setGeneratingLesson(true)
    const prompt = uiLanguage === 'en'
      ? `Generate a short educational micro-lesson in English about: "${newLessonTopic.trim()}". The micro-lesson should present an interesting fact, a key concept, or a stimulating curiosity for secondary school or university students. MAX 400 characters. Reply ONLY with the micro-lesson text, with no title or introduction.`
      : `Genera una microlezione educativa breve in italiano sull'argomento: "${newLessonTopic.trim()}". La microlezione deve essere un fatto interessante, un concetto chiave o una curiosità stimolante per studenti delle scuole superiori o universitari. MASSIMO 400 caratteri. Rispondi SOLO con il testo della microlezione, senza titoli né introduzioni.`
    try {
      const res = await llmApi.studentChat(prompt, [], 'tutor')
      const text: string = res.data?.response ?? res.data?.content ?? ''
      const lesson = text.trim().slice(0, 420)
      const newSession: LearningSession = {
        id: crypto.randomUUID(),
        topic: newLessonTopic.trim(),
        lesson,
        createdAt: new Date().toISOString(),
      }
      addLearningSession(newSession)
      setShowNewLessonDialog(false)
      setNewLessonTopic('')
      openLearningSession(newSession)
    } catch {
      // silently fail
    } finally {
      setGeneratingLesson(false)
    }
  }

  const handleChangeModel = (model: LLMModel | null) => {
    setSelectedModel(model)
    setConversationId(null)
    setShowModelMenu(false)
  }

  const handleDeleteConversation = useCallback(async (convId: string) => {
    triggerHaptic('warning')
    await llmApi.deleteConversation(convId)
    refetchConversations()
    if (conversationId === convId) {
      handleNewChat()
    }
  }, [conversationId, refetchConversations, handleNewChat])

  const handleSelectTeacherbot = useCallback(async (teacherbot: Teacherbot) => {
    triggerHaptic('selection')

    // End previous teacherbot conversation if exists
    if (teacherbotConversationId) {
      try {
        await teacherbotsApi.endConversation(teacherbotConversationId)
      } catch (err) {
        console.error('Error ending previous conversation:', err)
      }
    }

    setSelectedTeacherbot(teacherbot)
    setMainTab(teacherbot.is_studentbot ? 'studentbots' : 'teacherbots')
    setTeacherbotConversationId(null)
    setSelectedProfile(null)
    setConversationId(null)
    setActiveMasterPrompt(null)
    setIsMasterPromptApplied(false)
    resetProfileInterview()

    // Auto-resume most recent teacherbot conversation
    const recentTBConv = (teacherbotConversationsData || [])
      .slice()
      .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime())
      .find(c => c.teacherbot_id === teacherbot.id)

    if (recentTBConv) {
      setTeacherbotConversationId(recentTBConv.id)
      loadConversation(recentTBConv.id, true)
      if (isMobile) setMobileView('conversations')
      return
    }

    // If proactive, show initial message
    if (teacherbot.is_proactive && teacherbot.proactive_message) {
      setMessages([{
        id: 'proactive',
        role: 'assistant',
        content: teacherbot.proactive_message,
        timestamp: new Date(),
      }])
    } else {
      setMessages([])
    }

    if (isMobile) {
      setMobileView('conversations')
    }
  }, [isMobile, teacherbotConversationId, resetProfileInterview, teacherbotConversationsData, loadConversation])

  useEffect(() => {
    const onRestore = (event: Event) => {
      const detail = (event as CustomEvent<{ id?: string; kind?: 'assistant' | 'teacherbot'; conversationId?: string | null }>).detail
      if (!detail?.id) return

      if (detail.kind === 'teacherbot') {
        const teacherbotId = detail.id.replace(/^teacherbot-/, '')
        const bot = (teacherbotsData || []).find((item) => item.id === teacherbotId)
        if (bot) {
          void handleSelectTeacherbot(bot)
          if (detail.conversationId) {
            setTeacherbotConversationId(detail.conversationId)
            loadConversation(detail.conversationId, true)
          }
        }
        return
      }

      const profileKey = detail.id.replace(/^assistant-/, '')
      handleSelectProfile(profileKey)
      if (detail.conversationId) {
        loadConversation(detail.conversationId)
      }
    }

    window.addEventListener('golinelli:restore-student-chatbot', onRestore as EventListener)
    return () => window.removeEventListener('golinelli:restore-student-chatbot', onRestore as EventListener)
  }, [handleSelectProfile, handleSelectTeacherbot, loadConversation, teacherbotsData])

  const conversations = [
    ...(conversationsData || []),
    ...(teacherbotConversationsData || []).map(c => ({
      id: c.id,
      title: c.title,
      profile_key: `teacherbot-${c.teacherbot_id}`,
      updated_at: c.updated_at
    }))
  ].sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime())
  const availableModels = modelsData?.models || []
  const teacherDefaultModel = useMemo(
    () => availableModels.find((m) =>
      m.provider === sessionData?.session?.default_llm_provider &&
      m.model === sessionData?.session?.default_llm_model),
    [availableModels, sessionData]
  )
  const savedDefaultModel = useMemo(
    () => availableModels.find((m) => modelKey(m) === defaultModelKey),
    [availableModels, defaultModelKey]
  )
  const effectiveSelectedModel = selectedModel || savedDefaultModel || teacherDefaultModel || null
  const allAvailableTeacherbots = teacherbotsData || []
  const availableTeacherbots = allAvailableTeacherbots.filter((bot) => !bot.is_studentbot)
  const availableStudentbots = allAvailableTeacherbots.filter((bot) => bot.is_studentbot)
  const normalizedChatbotSearch = chatbotSearch.trim().toLowerCase()
  const filteredProfiles = useMemo(() => {
    if (!normalizedChatbotSearch) return profiles
    return profiles.filter((profile) =>
      [profile.name, profile.description, ...(profile.suggested_prompts || [])]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(normalizedChatbotSearch))
    )
  }, [normalizedChatbotSearch])
  const filteredTeacherbots = useMemo(() => {
    if (!normalizedChatbotSearch) return availableTeacherbots
    return availableTeacherbots.filter((bot) =>
      [bot.name, bot.synopsis, bot.description]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(normalizedChatbotSearch))
    )
  }, [availableTeacherbots, normalizedChatbotSearch])
  const filteredStudentbots = useMemo(() => {
    if (!normalizedChatbotSearch) return studentbotsData
    return studentbotsData.filter((bot) =>
      [bot.name, bot.synopsis]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(normalizedChatbotSearch))
    )
  }, [studentbotsData, normalizedChatbotSearch])
  const filteredLearningSessions = useMemo(() => {
    if (!normalizedChatbotSearch) return learningSessions
    return learningSessions.filter((session) =>
      [session.topic, session.lesson]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(normalizedChatbotSearch))
    )
  }, [learningSessions, normalizedChatbotSearch])
  const lastAppliedTeacherbotIdRef = useRef<string | null>(null)

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (modelMenuRef.current && !modelMenuRef.current.contains(event.target as Node)) {
        setShowModelMenu(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const handleSetDefaultModel = (model: LLMModel, e: React.MouseEvent) => {
    e.stopPropagation()
    const key = modelKey(model)
    localStorage.setItem('student_default_model', key)
    setDefaultModelKey(key)
  }

  const getTeacherbotColorClass = (color: string) => {
    const colorMap: Record<string, string> = {
      indigo: 'bg-indigo-500',
      blue: 'bg-blue-500',
      green: 'bg-green-500',
      red: 'bg-red-500',
      purple: 'bg-purple-500',
      pink: 'bg-pink-500',
      orange: 'bg-orange-500',
      teal: 'bg-teal-500',
      cyan: 'bg-cyan-500',
    }
    return colorMap[color] || 'bg-indigo-500'
  }

  useEffect(() => {
    if (!initialTeacherbotId || allAvailableTeacherbots.length === 0) return
    if (selectedTeacherbot?.id === initialTeacherbotId) return
    if (lastAppliedTeacherbotIdRef.current === initialTeacherbotId) return

    const bot = allAvailableTeacherbots.find(b => b.id === initialTeacherbotId)
    if (bot) {
      lastAppliedTeacherbotIdRef.current = initialTeacherbotId
      handleSelectTeacherbot(bot)
    }
  }, [initialTeacherbotId, allAvailableTeacherbots, selectedTeacherbot, handleSelectTeacherbot])

  const activeRagSession = ragSessions.find((s) => s.id === activeRagSessionId) ?? null

  const handleDeleteRagSession = useCallback((id: string) => {
    deleteRagSession(id)
    const updatedSessions = getRagSessions()
    setRagSessions(updatedSessions)

    if (activeRagSessionId === id) {
      if (updatedSessions.length > 0) {
        setActiveRagSessionId(updatedSessions[0].id)
      } else {
        const nextSession = createRagSession()
        saveRagSession(nextSession)
        setRagSessions([nextSession])
        setActiveRagSessionId(nextSession.id)
      }
    }
  }, [activeRagSessionId])

  useEffect(() => {
    if (!activeRagSessionId && ragSessions.length > 0) {
      setActiveRagSessionId(ragSessions[0].id)
    }
  }, [activeRagSessionId, ragSessions])

  // Mobile: Profile selection screen
  if (isMobile && mobileView === 'profiles') {
    const BOT_SURFACES_MOB: Record<string, { bg: string; icon: string; text: string }> = {
      indigo: { bg: 'rgba(224,231,255,0.78)', icon: 'rgba(99,102,241,0.16)', text: '#4338ca' },
      blue: { bg: 'rgba(219,234,254,0.82)', icon: 'rgba(59,130,246,0.16)', text: '#1d4ed8' },
      green: { bg: 'rgba(220,252,231,0.82)', icon: 'rgba(34,197,94,0.16)', text: '#15803d' },
      red: { bg: 'rgba(254,226,226,0.82)', icon: 'rgba(239,68,68,0.14)', text: '#b91c1c' },
      purple: { bg: 'rgba(243,232,255,0.82)', icon: 'rgba(168,85,247,0.16)', text: '#7e22ce' },
      pink: { bg: 'rgba(252,231,243,0.82)', icon: 'rgba(236,72,153,0.16)', text: '#be185d' },
      orange: { bg: 'rgba(255,237,213,0.86)', icon: 'rgba(249,115,22,0.16)', text: '#c2410c' },
      teal: { bg: 'rgba(204,251,241,0.86)', icon: 'rgba(20,184,166,0.16)', text: '#0f766e' },
      cyan: { bg: 'rgba(207,250,254,0.86)', icon: 'rgba(6,182,212,0.16)', text: '#0e7490' },
    }
    const PROFILE_SURFACES_MOB: Record<string, { bg: string; icon: string; text: string }> = {
      tutor: { bg: 'rgba(220,252,231,0.9)', icon: 'rgba(16,185,129,0.16)', text: '#0f766e' },
      quiz: { bg: 'rgba(255,228,230,0.9)', icon: 'rgba(244,63,94,0.16)', text: '#be123c' },
      interview: { bg: 'rgba(243,232,255,0.9)', icon: 'rgba(139,92,246,0.16)', text: '#7c3aed' },
      oral_exam: { bg: 'rgba(255,237,213,0.92)', icon: 'rgba(245,158,11,0.16)', text: '#c2410c' },
      math_coach: { bg: 'rgba(219,234,254,0.9)', icon: 'rgba(59,130,246,0.16)', text: '#1d4ed8' },
      dataset_generator: { bg: 'rgba(207,250,254,0.9)', icon: 'rgba(14,165,233,0.16)', text: '#0369a1' },
    }
    if (studentbotEditorTarget) {
      return (
        <div className="h-full min-h-0 bg-slate-50">
          <Suspense fallback={<div className="flex h-full items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-violet-500" /></div>}>
            <TeacherbotForm
              variant="studentbot"
              teacherbotId={studentbotEditorTarget === 'create' ? undefined : studentbotEditorTarget}
              onBack={() => setStudentbotEditorTarget(null)}
              onSaved={() => setStudentbotEditorTarget(null)}
            />
          </Suspense>
        </div>
      )
    }
    return (
      <div className="h-full flex flex-col overflow-hidden" style={{ backgroundColor: '#f8fafc' }}>
        {/* Tab nav */}
        <div className="flex items-center gap-1 px-3 pt-3 pb-2 flex-shrink-0 overflow-x-auto scrollbar-none">
          {([
            { key: 'assistants' as const, label: 'Assistenti AI', icon: <Bot className="h-3 w-3" /> },
            { key: 'teacherbots' as const, label: 'Teacherbots', icon: <Wand2 className="h-3 w-3" />, badge: availableTeacherbots.length },
            { key: 'studentbots' as const, label: 'Studentbot', icon: <Sparkles className="h-3 w-3" />, badge: studentbotsData.length },
            { key: 'rag' as const, label: 'RAG', icon: <Database className="h-3 w-3" /> },
          ]).map(({ key, label, icon, badge }) => (
            <button key={key} onClick={() => setMainTab(key)}
              className={`flex items-center gap-1 px-3 py-1.5 rounded-xl text-[11px] font-semibold transition-all whitespace-nowrap flex-shrink-0 ${
                mainTab === key ? 'bg-white shadow-md text-slate-800' : 'text-slate-500 hover:bg-white/60'
              }`}
            >
              {icon}{label}
              {badge !== undefined && badge > 0 && (
                <span className={`text-[8px] font-bold px-1 py-0.5 rounded-full ${mainTab === key ? 'bg-indigo-100 text-indigo-700' : 'bg-slate-200 text-slate-500'}`}>{badge}</span>
              )}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto px-3 pb-20">
          {/* Mobile: Assistenti AI */}
          {mainTab === 'assistants' && (
            <div className="space-y-2">
              {/* Tutor hero */}
              <motion.button whileTap={{ scale: 0.98 }} onClick={() => handleSelectProfile('tutor')}
                className="w-full relative overflow-hidden rounded-xl border p-4 text-left shadow-sm"
                style={{ backgroundColor: PROFILE_SURFACES_MOB.tutor.bg, borderColor: 'rgba(16,185,129,0.18)' }}
              >
                <div className="absolute right-3 top-3 opacity-[0.08]"><GraduationCap className="h-16 w-16" style={{ color: PROFILE_SURFACES_MOB.tutor.text }} /></div>
                <div className="w-9 h-9 rounded-xl flex items-center justify-center mb-2" style={{ backgroundColor: PROFILE_SURFACES_MOB.tutor.icon }}><GraduationCap className="h-4 w-4" style={{ color: PROFILE_SURFACES_MOB.tutor.text }} /></div>
                <h3 className="text-sm font-bold" style={{ color: PROFILE_SURFACES_MOB.tutor.text }}>{profiles.find(p => p.key === 'tutor')?.name || 'Tutor Personale'}</h3>
                <p className="text-[11px] mt-0.5 line-clamp-2 text-slate-600">{profiles.find(p => p.key === 'tutor')?.description}</p>
              </motion.button>
              {/* Other profiles 2-col */}
              <div className="grid grid-cols-2 gap-2">
                {profiles.filter(p => p.key !== 'tutor').map((profile) => {
                  const surface = PROFILE_SURFACES_MOB[profile.key] || PROFILE_SURFACES_MOB.math_coach
                  return (
                  <motion.button key={profile.key} whileTap={{ scale: 0.95 }} onClick={() => handleSelectProfile(profile.key)}
                    className="relative overflow-hidden rounded-xl border p-3 text-left shadow-sm"
                    style={{ backgroundColor: surface.bg, borderColor: 'rgba(148,163,184,0.16)' }}
                  >
                    <div className="w-7 h-7 rounded-lg flex items-center justify-center mb-1.5" style={{ backgroundColor: surface.icon }}>
                      <div className="scale-75" style={{ color: surface.text }}>{PROFILE_ICONS[profile.key] || <Bot className="h-4 w-4" />}</div>
                    </div>
                    <span className="text-[11px] font-bold leading-tight block" style={{ color: surface.text }}>{profile.name}</span>
                  </motion.button>
                )})}
              </div>
            </div>
          )}

          {/* Mobile: Teacherbots */}
          {mainTab === 'teacherbots' && (
            availableTeacherbots.length === 0 ? (
              <div className="text-center py-16">
                <Wand2 className="h-8 w-8 text-indigo-200 mx-auto mb-3" />
                <p className="text-sm text-slate-400 font-medium">Nessun teacherbot disponibile</p>
              </div>
            ) : (
              <div className="space-y-2">
                {availableTeacherbots.map((bot, idx) => (
                  (() => {
                    const surface = BOT_SURFACES_MOB[bot.color] || BOT_SURFACES_MOB.indigo
                    return (
                  <motion.button key={bot.id} whileTap={{ scale: 0.97 }} onClick={() => handleSelectTeacherbot(bot)}
                    className={`w-full relative overflow-hidden rounded-xl border text-left shadow-sm ${idx === 0 ? 'p-4' : 'p-3'}`}
                    style={{ backgroundColor: surface.bg, borderColor: 'rgba(148,163,184,0.16)' }}
                  >
                    <div className="absolute right-2 top-2 opacity-[0.08]"><Wand2 className={idx === 0 ? 'h-16 w-16' : 'h-10 w-10'} style={{ color: surface.text }} /></div>
                    <div className={`${idx === 0 ? 'w-10 h-10' : 'w-8 h-8'} rounded-xl flex items-center justify-center mb-2`} style={{ backgroundColor: surface.icon }}>
                      <Wand2 className={idx === 0 ? 'h-5 w-5' : 'h-4 w-4'} style={{ color: surface.text }} />
                    </div>
                    <h3 className={`${idx === 0 ? 'text-sm' : 'text-xs'} font-bold`} style={{ color: surface.text }}>{bot.name}</h3>
                    <p className="text-[11px] text-slate-600 mt-0.5 line-clamp-2">{bot.synopsis || bot.description}</p>
                  </motion.button>
                )})()
                ))}
              </div>
            )
          )}

          {mainTab === 'studentbots' && (
            <div className="space-y-2">
              <motion.button
                whileTap={{ scale: 0.98 }}
                onClick={() => setStudentbotEditorTarget('create')}
                className="w-full rounded-xl border border-violet-200 bg-violet-50 p-4 text-left shadow-sm"
              >
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-violet-100 text-violet-700"><Plus className="h-5 w-5" /></div>
                  <div><h3 className="text-sm font-bold text-violet-900">Crea il tuo bot personalizzato</h3><p className="text-[11px] text-violet-700/75">Configura personalità, istruzioni e allegati</p></div>
                </div>
              </motion.button>
              {studentbotsData.map((bot) => {
                const available = availableStudentbots.find((item) => item.id === bot.id)
                return (
                  <div key={bot.id} className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
                    <button type="button" onClick={() => available && handleSelectTeacherbot(available)} className="w-full text-left">
                      <p className="text-sm font-bold text-slate-900">{bot.name}</p>
                      <p className="mt-0.5 line-clamp-2 text-[11px] text-slate-500">{bot.synopsis || 'Il tuo assistente AI personalizzato'}</p>
                    </button>
                    <div className="mt-2 flex gap-2 border-t border-slate-100 pt-2">
                      <button type="button" onClick={() => setStudentbotEditorTarget(bot.id)} className="rounded-lg px-2 py-1 text-[11px] font-bold text-violet-700 hover:bg-violet-50">Configura</button>
                      <button type="button" onClick={() => { if (window.confirm(`Eliminare lo Studentbot “${bot.name}”?`)) deleteStudentbotMutation.mutate(bot.id) }} className="rounded-lg px-2 py-1 text-[11px] font-bold text-rose-600 hover:bg-rose-50">Elimina</button>
                    </div>
                  </div>
                )
              })}
            </div>
          )}

          {/* Mobile: Oggi Imparo is retained only for legacy deep links, not exposed in navigation. */}
          {false && mainTab === 'learning' && (
            <div className="space-y-2">
              <motion.button whileTap={{ scale: 0.98 }} onClick={() => setShowNewLessonDialog(true)}
                className="w-full relative overflow-hidden rounded-xl border p-4 text-left shadow-sm"
                style={{ backgroundColor: 'rgba(243,232,255,0.9)', borderColor: 'rgba(139,92,246,0.18)' }}
              >
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0" style={{ backgroundColor: 'rgba(139,92,246,0.14)' }}><Plus className="h-4 w-4 text-violet-700" /></div>
                  <div>
                    <h3 className="text-sm font-bold text-violet-800">Nuova microlezione</h3>
                    <p className="text-[11px] text-slate-600">Scegli un argomento</p>
                  </div>
                </div>
              </motion.button>
              {learningSessions.length === 0 ? (
                <div className="text-center py-10"><BookOpen className="h-8 w-8 text-slate-200 mx-auto mb-2" /><p className="text-sm text-slate-400">Nessuna lezione ancora</p></div>
              ) : learningSessions.map(session => (
                <motion.div key={session.id} whileTap={{ scale: 0.99 }} onClick={() => expandingLearningSessionId !== session.id && openLearningSession(session)}
                  className="p-3 rounded-xl bg-white border border-slate-100 cursor-pointer shadow-sm group"
                >
                  <div className="flex items-start gap-2.5">
                    <div className="w-8 h-8 rounded-xl bg-violet-100 flex items-center justify-center shrink-0"><BookOpen className="h-3.5 w-3.5 text-violet-600" /></div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-semibold text-slate-800 truncate">{session.topic}</p>
                      <p className="text-[10px] text-slate-400 mt-0.5 line-clamp-2">{session.lesson}</p>
                      {expandingLearningSessionId === session.id && (
                        <p className="text-[10px] font-medium text-violet-600 mt-1">Sto espandendo la lezione...</p>
                      )}
                    </div>
                  </div>
                </motion.div>
              ))}
            </div>
          )}

          {/* Mobile: RAG workspace */}
          {mainTab === 'rag' && (
            <div className="-mx-3 -mb-4 flex h-[calc(100vh-120px)] flex-col">
              <div className="flex shrink-0 items-center border-b border-slate-200 bg-white px-3 py-2">
                <button
                  type="button"
                  onClick={() => setMainTab('assistants')}
                  className="inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-bold text-slate-700 hover:bg-slate-100"
                >
                  <ChevronLeft className="h-4 w-4" />
                  Spazio AI
                </button>
              </div>
              <Suspense fallback={<div className="flex items-center justify-center h-full"><Loader2 className="h-6 w-6 animate-spin text-violet-400" /></div>}>
                {activeRagSession && (
                  <StudentRagWorkspace
                    key={activeRagSession.id}
                    theme={accentTheme}
                    session={activeRagSession}
                    onSessionUpdate={() => setRagSessions(getRagSessions())}
                    onNewSession={() => {
                      const s = createRagSession()
                      saveRagSession(s)
                      setRagSessions(getRagSessions())
                      setActiveRagSessionId(s.id)
                    }}
                    onSwitchSession={(id) => {
                      setRagSessions(getRagSessions())
                      setActiveRagSessionId(id)
                    }}
                    onDeleteSession={handleDeleteRagSession}
                  />
                )}
              </Suspense>
            </div>
          )}
        </div>

        {/* New lesson dialog */}
        {showNewLessonDialog && (
          <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-end justify-center" onClick={() => setShowNewLessonDialog(false)}>
            <div className="bg-white rounded-t-2xl p-6 w-full max-w-lg" onClick={e => e.stopPropagation()}>
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 rounded-xl bg-violet-100 flex items-center justify-center"><BookOpen className="h-5 w-5 text-violet-600" /></div>
                <div><h3 className="text-base font-bold text-slate-800">Oggi Imparo</h3><p className="text-xs text-slate-400">Genera una microlezione</p></div>
              </div>
              <input autoFocus type="text" value={newLessonTopic} onChange={e => setNewLessonTopic(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') handleGenerateLesson(); if (e.key === 'Escape') setShowNewLessonDialog(false) }}
                placeholder="Es: La fotosintesi, La Seconda Guerra Mondiale..."
                className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-100 mb-4"
              />
              <div className="flex gap-2 justify-end">
                <button onClick={() => { setShowNewLessonDialog(false); setNewLessonTopic('') }} className="px-4 py-2 text-sm text-slate-500">Annulla</button>
                <button onClick={handleGenerateLesson} disabled={!newLessonTopic.trim() || generatingLesson}
                  className="px-4 py-2 text-sm font-semibold bg-slate-900 text-white rounded-lg disabled:opacity-50 flex items-center gap-1.5"
                >
                  {generatingLesson ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                  Genera
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    )
  }

  // Mobile: Conversation list screen
  if (isMobile && mobileView === 'conversations' && (selectedProfile || selectedTeacherbot)) {
    const mobileProfileKey = selectedTeacherbot ? `teacherbot-${selectedTeacherbot.id}` : (selectedProfile || 'tutor')
    const mobileProfileName = selectedTeacherbot ? selectedTeacherbot.name : (currentProfile?.name || selectedProfile || 'Tutor')
    const mobileProfileIcon = selectedTeacherbot ? <Wand2 className="h-5 w-5" /> : (selectedProfile ? PROFILE_ICONS[selectedProfile] : undefined)

    return (
      <ChatConversationList
        profileKey={mobileProfileKey}
        profileName={mobileProfileName}
        profileIcon={mobileProfileIcon}
        conversations={conversations}
        onSelectConversation={loadConversation}
        onNewChat={handleStartNewConversation}
        onDeleteConversation={handleDeleteConversation}
        onRefresh={async () => {
          await refetchConversations()
          await refetchTeacherbotConversations()
        }}
      />
    )
  }

  // Mobile: Teacherbot chat view - uses ChatConversationView-like interface
  if (isMobile && mobileView === 'chat' && selectedTeacherbot) {
    return (
      <ChatConversationView
        conversationId={teacherbotConversationId}
        profileKey={`teacherbot-${selectedTeacherbot.id}`}
        profileName={selectedTeacherbot.name}
        profileIcon={<Wand2 className="h-5 w-5" />}
        profileColor={getTeacherbotColorClass(selectedTeacherbot.color)}
        messages={messages}
        onSend={handleSend}
        onBack={() => {
          triggerHaptic('light')
          setMobileView('conversations')
        }}
        isLoading={isGeneratingResponse}
        suggestedPrompts={[]}
        isTeacherbot={true}
        onMinimize={(onMinimize || onClose) ? handleDockOrClose : undefined}
      />
    )
  }

  // Mobile: Chat view
  if (isMobile && mobileView === 'chat' && selectedProfile) {
    return (
      <ChatConversationView
        conversationId={conversationId}
        profileKey={selectedProfile}
        profileName={currentProfile?.name || selectedProfile}
        profileIcon={PROFILE_ICONS[selectedProfile]}
        profileColor={PROFILE_ACCENT_CLASSES[selectedProfile] || 'bg-indigo-600'}
        messages={messages}
        onSend={handleSend}
        onBack={() => {
          triggerHaptic('light')
          setMobileView('conversations')
        }}
        isLoading={isGeneratingResponse}
        suggestedPrompts={currentProfile?.suggested_prompts}
        onMinimize={(onMinimize || onClose) ? handleDockOrClose : undefined}
      />
    )
  }

  const isDesktopSelection = !selectedProfile && !selectedTeacherbot && !activeSharedRoom && mainTab !== 'rag'
  const profileUsageCounts = (conversationsData || []).reduce<Record<string, number>>((acc, c) => {
    acc[c.profile_key] = (acc[c.profile_key] || 0) + 1
    return acc
  }, {})
  const topProfiles = Object.entries(profileUsageCounts).sort((a, b) => b[1] - a[1]).slice(0, 4)
  type FavoriteChatbotItem = {
    profileKey: string
    conversationId: string | null
    kind: 'assistant' | 'teacherbot'
    title: string
    description: string
    tone: PastelTone
    icon: React.ReactNode
  }
  const recentFavoriteChatbotItems = conversations.reduce<FavoriteChatbotItem[]>((items, conversation) => {
      if (items.some((item) => item.profileKey === conversation.profile_key)) return items

      if (conversation.profile_key.startsWith('teacherbot-')) {
        const teacherbotId = conversation.profile_key.replace('teacherbot-', '')
        const bot = allAvailableTeacherbots.find((item) => item.id === teacherbotId)
        if (!bot) return items
        items.push({
          profileKey: conversation.profile_key,
          conversationId: conversation.id,
          kind: 'teacherbot',
          title: bot.name,
          description: conversation.title || bot.synopsis || bot.description || 'Teacherbot recente',
          tone: 'amber',
          icon: <Wand2 className="h-4 w-4" />,
        })
        return items
      }

      const profile = profiles.find((item) => item.key === conversation.profile_key)
      if (!profile) return items
      items.push({
        profileKey: profile.key,
        conversationId: conversation.id,
        kind: 'assistant',
        title: profile.name,
        description: conversation.title || profile.description,
        tone: 'violet',
        icon: PROFILE_ICONS[profile.key] || <Bot className="h-4 w-4" />,
      })
      return items
    }, [])
  const topFavoriteChatbotItems = topProfiles.reduce<FavoriteChatbotItem[]>((items, [key]) => {
    if (conversations.some((conversation) => conversation.profile_key === key)) return items
    const profile = profiles.find((item) => item.key === key)
    if (!profile) return items
    items.push({
      profileKey: profile.key,
      conversationId: null,
      kind: 'assistant',
      title: profile.name,
      description: profile.description,
      tone: 'violet',
      icon: PROFILE_ICONS[profile.key] || <Bot className="h-4 w-4" />,
    })
    return items
  }, [])
  const favoriteChatbotItems = [...recentFavoriteChatbotItems, ...topFavoriteChatbotItems].slice(0, 8)
  const filteredFavoriteChatbotItems = normalizedChatbotSearch
    ? favoriteChatbotItems.filter((item) => [item.title, item.description, item.kind].some((value) => value.toLowerCase().includes(normalizedChatbotSearch)))
    : favoriteChatbotItems
  const filteredRagSessions = normalizedChatbotSearch
    ? ragSessions.filter((session) =>
        [session.name, ...session.messages.map((message) => message.content)]
          .filter(Boolean)
          .some((value) => value.toLowerCase().includes(normalizedChatbotSearch))
      )
    : ragSessions
  const visibleMessages = normalizedChatbotSearch
    ? messages.filter((message) => message.content.toLowerCase().includes(normalizedChatbotSearch))
    : messages

  const openRagSession = (session?: RagSession | null) => {
    let nextSession = session ?? activeRagSession ?? ragSessions[0] ?? null
    if (!nextSession) {
      nextSession = createRagSession()
      saveRagSession(nextSession)
      setRagSessions(getRagSessions())
    }
    setSelectedProfile(null)
    setSelectedTeacherbot(null)
    setLearningMode(false)
    setActiveLearningSession(null)
    setActiveRagSessionId(nextSession.id)
    setMainTab('rag')
  }

  const createAndOpenRagSession = () => {
    const nextSession = createRagSession()
    saveRagSession(nextSession)
    setRagSessions(getRagSessions())
    openRagSession(nextSession)
  }

  const returnToChatbotLibrary = () => {
    setSelectedProfile(null)
    setSelectedTeacherbot(null)
    setTeacherbotConversationId(null)
    setConversationId(null)
    setLearningMode(false)
    setActiveLearningSession(null)
    setActiveMasterPrompt(null)
    setIsMasterPromptApplied(false)
    resetProfileInterview()
    setMessages([])
    setMainTab('assistants')
  }

  // @mention autocomplete (collaboration): match a trailing "@partial" in the composer.
  const mentionMatch = activeSharedRoom ? /(^|\s)@([^\s@]*)$/.exec(input) : null
  const mentionQuery = mentionMatch ? mentionMatch[2].toLowerCase() : null
  const mentionCandidates = (mentionQuery !== null && activeSharedRoom)
    ? activeSharedRoom.participants.filter((p) => p.id !== studentId && p.nickname.toLowerCase().includes(mentionQuery))
    : []
  const insertMentionNickname = (nickname: string) => {
    setInput((prev) => prev.replace(/(^|\s)@([^\s@]*)$/, (_m, pre) => `${pre}@${nickname} `))
    setTimeout(() => inputRef.current?.focus(), 0)
  }

  const composerContent = (
    <>
      {attachedFiles.length > 0 && (
        <div className="mb-1 flex flex-wrap gap-1 rounded-t-lg border border-b-0 border-slate-200 bg-white p-2 md:mb-3 md:rounded-none md:border-0 md:bg-transparent md:p-0">
          {attachedFiles.map((af, idx) => (
            <div key={idx} className="relative group">
              {af.type === 'image' && af.preview ? (
                <img src={af.preview} alt="Preview" className="w-10 h-10 md:w-16 md:h-16 object-cover rounded-lg border" />
              ) : af.type === 'data' ? (
                <div className="w-full max-w-xs md:max-w-sm">
                  {af.dataPreview
                    ? <DataFileCard preview={af.dataPreview} compact />
                    : <div className="flex items-center gap-2 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2 text-xs text-emerald-700">
                        <Loader2 className="h-3 w-3 animate-spin" />
                        <span className="truncate">{af.file.name}</span>
                      </div>
                  }
                </div>
              ) : (
                <div className="w-10 h-10 md:w-16 md:h-16 bg-slate-100 rounded-lg border flex items-center justify-center">
                  <File className="h-4 w-4 md:h-6 md:w-6 text-slate-400" />
                </div>
              )}
              <button
                onClick={() => setAttachedFiles(prev => prev.filter((_, i) => i !== idx))}
                className="absolute -top-1 -right-1 w-4 h-4 md:w-5 md:h-5 bg-red-500 text-white rounded-full flex items-center justify-center z-10"
              >
                <X className="h-2 w-2 md:h-3 md:w-3" />
              </button>
            </div>
          ))}
        </div>
      )}
      {attachedFiles.some(af => af.type === 'data' && af.dataPreview?.suggested_prompts?.length) && (
        <div className="flex gap-1 mb-1 flex-wrap px-2">
          {attachedFiles
            .filter(af => af.type === 'data' && af.dataPreview?.suggested_prompts?.length)
            .flatMap(af => af.dataPreview!.suggested_prompts!.slice(0, 3))
            .slice(0, 4)
            .map((prompt, i) => (
              <button
                key={i}
                onClick={() => setInput(prompt)}
                className="text-xs bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200 rounded-full px-2.5 py-1 transition-colors"
              >
                {prompt}
              </button>
            ))}
        </div>
      )}

      <div className="bg-white p-2 md:bg-transparent md:p-3">
        <div
          className="relative flex items-center gap-1.5 rounded-[24px] border border-slate-200 bg-white p-1.5 shadow-sm transition-all focus-within:border-slate-300 focus-within:ring-2 focus-within:ring-slate-200"
        >
          {mentionCandidates.length > 0 && (
            <div className="absolute bottom-full left-2 z-30 mb-2 w-60 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl">
              <div className="border-b border-slate-100 px-3 py-1.5 text-[10px] font-bold uppercase tracking-wide text-slate-400">
                {uiLanguage === 'en' ? 'Mention (private)' : 'Menziona (privato)'}
              </div>
              {mentionCandidates.slice(0, 6).map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onMouseDown={(e) => { e.preventDefault(); insertMentionNickname(p.nickname) }}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-slate-50"
                >
                  <span className="flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-bold text-white" style={{ backgroundColor: collabNameColor(p.nickname) }}>
                    {p.nickname.slice(0, 1).toUpperCase()}
                  </span>
                  <span className="truncate text-sm font-medium text-slate-700">{p.nickname}</span>
                </button>
              ))}
            </div>
          )}
          <input type="file" ref={fileInputRef} className="hidden" multiple
            accept="image/*,.pdf,.doc,.docx,.ppt,.pptx,.txt,.csv,.xlsx,.xls,.json"
            onChange={(e) => {
              const files = Array.from(e.target.files || [])
              files.forEach(file => addFileWithPreview(file))
              e.target.value = ''
            }}
          />

          {sidebarMode && (
            <div className="relative flex-shrink-0">
              <Button
                variant="ghost"
                size="icon"
                className="h-9 w-9 rounded-full bg-slate-950 text-white hover:bg-slate-800"
                onClick={() => setShowActionMenu((prev) => !prev)}
                title="Strumenti chatbot"
              >
                <Plus className="h-4 w-4" />
              </Button>
              {showActionMenu && (
                <div className="absolute bottom-full left-0 z-40 mb-2 w-56 rounded-xl border border-slate-200 bg-white p-1.5 shadow-xl">
                  <div className="px-2 py-1 text-[10px] font-bold uppercase tracking-wide text-slate-400">Strumenti</div>
                  <div className="flex items-center gap-1 rounded-lg px-2 py-1.5">
                    <VoiceRecorder
                      onInsertText={(text) => {
                        setInput(text)
                        setShowActionMenu(false)
                        setTimeout(() => inputRef.current?.focus(), 50)
                      }}
                    />
                    <span className="text-xs font-medium text-slate-600">Dettatura vocale</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setShowActionMenu(false)
                      fileInputRef.current?.click()
                    }}
                    className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-xs font-medium text-slate-600 hover:bg-slate-100"
                  >
                    <Paperclip className="h-3.5 w-3.5" />
                    Allegati
                  </button>
                  {activeSharedRoom && (
                    <button
                      type="button"
                      onClick={() => {
                        setInput((prev) => (prev === '' || prev.endsWith(' ') ? prev + '@' : prev + ' @'))
                        setShowActionMenu(false)
                        setTimeout(() => inputRef.current?.focus(), 0)
                      }}
                      className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-xs font-medium text-slate-600 hover:bg-slate-100"
                    >
                      <AtSign className="h-3.5 w-3.5" />
                      Menzione privata
                    </button>
                  )}
                  <div className="my-1 h-px bg-slate-100" />
                  {([
                    { mode: 'normal' as const, label: 'Chat', icon: <MessageSquare className="h-3.5 w-3.5" /> },
                    { mode: 'image' as const, label: 'Immagine', icon: <ImageIcon className="h-3.5 w-3.5" /> },
                    { mode: 'quiz' as const, label: 'Quiz', icon: <ClipboardCheck className="h-3.5 w-3.5" /> },
                    { mode: 'dataset' as const, label: 'Dataset', icon: <Database className="h-3.5 w-3.5" /> },
                  ] as const).map(({ mode, label, icon }) => (
                    <button
                      key={mode}
                      type="button"
                      onClick={() => {
                        setChatMode(mode)
                        setShowActionMenu(false)
                      }}
                      className={`flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-xs font-medium transition-colors ${chatMode === mode ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100'}`}
                    >
                      {icon}
                      <span className="flex-1">{label}</span>
                      {chatMode === mode && <Check className="h-3.5 w-3.5" />}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {!sidebarMode && (
            <VoiceRecorder
              onInsertText={(text) => {
                setInput(text)
                setTimeout(() => inputRef.current?.focus(), 50)
              }}
            />
          )}

          {!sidebarMode && <Button
            variant="ghost" size="icon" className="h-9 w-9 flex-shrink-0 rounded-full text-slate-400 hover:bg-slate-100"
            style={{ color: 'inherit' }}
            onClick={() => fileInputRef.current?.click()}
          >
            <Paperclip className="h-4 w-4" />
          </Button>}

          {activeSharedRoom && !sidebarMode && (
            <Button
              variant="ghost" size="icon" className="h-9 w-9 flex-shrink-0 rounded-full text-slate-400 hover:bg-slate-100"
              style={{ color: 'inherit' }}
              onClick={() => {
                setInput((prev) => (prev === '' || prev.endsWith(' ') ? prev + '@' : prev + ' @'))
                setTimeout(() => inputRef.current?.focus(), 0)
              }}
              title={uiLanguage === 'en' ? 'Mention a classmate (private)' : 'Menziona un compagno (privato)'}
            >
              <AtSign className="h-4 w-4" />
            </Button>
          )}

          <div className={`relative hidden md:block flex-shrink-0 ${sidebarMode ? 'md:hidden' : ''}`}>
            <button
              type="button"
              onClick={() => setShowChatModeMenu((prev) => !prev)}
              className="inline-flex h-9 items-center gap-2 rounded-full border border-slate-200 bg-slate-50 pl-1 pr-3 text-xs font-semibold text-slate-900 shadow-sm transition-all hover:bg-slate-100"
              title="Cambia modalità"
            >
              <span
                className={`rounded-full px-3 py-1.5 text-xs font-bold ${
                  chatMode === 'normal'
                    ? 'bg-slate-900 text-white'
                    : chatMode === 'image'
                      ? 'bg-fuchsia-600 text-white'
                      : chatMode === 'quiz'
                        ? 'bg-amber-500 text-white'
                        : 'bg-emerald-600 text-white'
                }`}
              >
                {chatMode === 'normal' ? 'Chat' : chatMode === 'image' ? 'Immagine' : chatMode === 'quiz' ? 'Quiz' : 'Dataset'}
              </span>
              <ChevronDown className={`h-3.5 w-3.5 text-slate-700 transition-transform ${showChatModeMenu ? 'rotate-180' : ''}`} />
            </button>
            {showChatModeMenu && (
	              <div className="absolute bottom-full left-0 z-50 mb-2 w-44 rounded-xl border border-slate-200 bg-white p-1.5 shadow-xl">
                {([
                  { mode: 'normal' as const, label: 'Chat', icon: null },
                  { mode: 'image' as const, label: 'Immagine', icon: <ImageIcon className="h-3.5 w-3.5" /> },
                  { mode: 'quiz' as const, label: 'Quiz', icon: <ClipboardCheck className="h-3.5 w-3.5" /> },
                  { mode: 'dataset' as const, label: 'Dataset', icon: <Database className="h-3.5 w-3.5" /> },
                ] as const).map(({ mode, label, icon }) => {
                  const isSelected = chatMode === mode
                  return (
                    <button
                      key={mode}
                      type="button"
                      onClick={() => {
                        setChatMode(mode)
                        setShowChatModeMenu(false)
                      }}
                      className={`flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-xs font-medium transition-colors ${
                        isSelected ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100'
                      }`}
                    >
                      {icon}
                      <span className="flex-1">{label}</span>
                      {isSelected && <Check className="h-3.5 w-3.5" />}
                    </button>
                  )
                })}
              </div>
            )}
          </div>

          <div className="flex-1 relative min-w-0">
            <textarea
              ref={inputRef}
              rows={1}
              value={input}
              onChange={(e) => {
                setInput(e.target.value)
                const el = e.currentTarget
                el.style.height = 'auto'
                el.style.height = `${Math.min(el.scrollHeight, 160)}px`
              }}
              onFocus={() => {
                setIsInputFocused(true)
                onInputFocusChange?.(true)
                setTimeout(scrollToBottom, 300)
              }}
              onBlur={() => {
                setIsInputFocused(false)
                onInputFocusChange?.(false)
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  handleSend()
                }
              }}
              onPaste={handleInputPaste}
              placeholder={profileInterview.active ? t('chatbot.guided_placeholder') : (chatMode === 'image' ? 'Descrivi l\'immagine da generare...' : chatMode === 'quiz' ? 'Di cosa vuoi un quiz?' : chatMode === 'dataset' ? 'Descrivi il dataset da generare...' : (attachedFiles.length > 0 ? t('chatbot.describe_placeholder') : 'Scrivi un messaggio...'))}
              disabled={isGeneratingResponse}
              className="w-full resize-none bg-transparent px-1 py-2 text-[16px] leading-7 text-slate-800 outline-none placeholder:text-slate-400 focus:outline-none focus:ring-0"
            />
          </div>

          {isGeneratingResponse ? (
            <Button
              onClick={stopActiveGeneration}
              size="icon"
              title={uiLanguage === 'en' ? 'Stop generation' : 'Interrompi generazione'}
              className="h-9 w-9 flex-shrink-0 rounded-full bg-red-50 text-red-600 shadow-sm ring-1 ring-red-200 transition-all hover:bg-red-100 hover:text-red-700"
            >
              <Square className="h-3.5 w-3.5 fill-current" />
            </Button>
          ) : (
            <Button
              onClick={() => handleSend()}
              disabled={(!input.trim() && attachedFiles.length === 0)}
              size="icon"
              className={`h-9 w-9 flex-shrink-0 rounded-full transition-all ${(!input.trim() && attachedFiles.length === 0) ? 'bg-slate-100 text-slate-300' : 'text-white shadow-md hover:-translate-y-0.5'}`}
              style={(!input.trim() && attachedFiles.length === 0) ? undefined : activeBotSolidStyle}
            >
              <Send className="h-4 w-4 ml-0.5" />
            </Button>
          )}
        </div>
      </div>

      {(chatMode === 'image') && (
        <div className="flex items-center justify-center gap-4 mt-2 pb-3 flex-wrap animate-in fade-in slide-in-from-bottom-1 duration-150">
          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-400">Modello:</span>
            <div className={`flex items-center rounded-xl p-0.5 shadow-sm ${PASTEL_SURFACES.slate}`}>
              {([
                { id: 'dall-e' as const, label: 'DALL-E 3' },
                { id: 'gpt-image-1.5' as const, label: 'GPT Image 1.5' },
              ]).map((m) => (
                <button
                  key={m.id}
                  onClick={() => setImageProvider(m.id)}
                  className={`rounded-lg px-2 py-1 text-[10px] transition-all ${imageProvider === m.id ? 'bg-slate-900 font-bold text-white shadow' : 'text-slate-500 hover:text-slate-700'}`}
                >
                  {m.label}
                </button>
              ))}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-400">Formato:</span>
            <select
              value={imageSize}
              onChange={(e) => setImageSize(e.target.value)}
              className="rounded-xl border border-slate-200/80 bg-white/90 px-2 py-1 text-xs text-slate-600 shadow-sm focus:ring-1 focus:ring-slate-300"
            >
              <option value="1024x1024">1:1 Quadrato</option>
              <option value="1024x768">4:3 Orizzontale</option>
              <option value="768x1024">3:4 Verticale</option>
              <option value="1280x720">16:9 Panorama</option>
              <option value="720x1280">9:16 Portrait</option>
            </select>
          </div>
        </div>
      )}
    </>
  )

  // Desktop Chat interface
  return (
    <div
      className="relative flex h-full min-h-0 w-full gap-3 overflow-hidden bg-slate-100 p-4 text-slate-900"
      style={{
        ...accentVars,
      }}
    >
      <aside
        className="hidden"
      >
        {navCollapsed && mainTab === 'rag' ? (
          /* Collapsed strip */
          <div className="flex flex-col items-center gap-3 p-2 pt-3 h-full">
            <button onClick={() => setNavCollapsed(false)} title="Espandi sidebar"
              className="p-2 rounded-xl hover:bg-slate-100 transition-colors">
              <ChevronRight className="h-4 w-4 text-slate-500" />
            </button>
            <div className="w-px flex-1 bg-slate-200 mx-auto" />
            {[
              { key: 'assistants' as const, icon: Bot },
              { key: 'teacherbots' as const, icon: Wand2 },
              { key: 'learning' as const, icon: BookOpen },
              { key: 'rag' as const, icon: Database },
            ].map(({ key, icon: Icon }) => (
              <button key={key} onClick={() => { setNavCollapsed(false); setMainTab(key) }}
                title={key}
                className={`p-2 rounded-lg transition-colors ${mainTab === key ? 'bg-slate-100 text-slate-700' : 'text-slate-400 hover:bg-slate-100'}`}>
                <Icon className="h-4 w-4" />
              </button>
            ))}
          </div>
        ) : (
          <>
        <div className="border-b border-slate-200/70 bg-white/60 px-5 py-4 backdrop-blur-sm">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.18em]" style={{ color: accentTheme.text }}>Chatbot</p>
              <h2 className="mt-0.5 text-base font-semibold text-slate-900">Spazio AI</h2>
            </div>
            {mainTab === 'rag' && (
              <button onClick={() => setNavCollapsed(true)} title="Comprimi sidebar"
                className="p-1.5 rounded-xl text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors">
                <ChevronLeft className="h-4 w-4" />
              </button>
            )}
          </div>
        </div>

        <nav className="px-3 py-3 space-y-1 flex-1 overflow-y-auto">
          {[
            { key: 'assistants' as const, label: 'Assistenti AI', icon: Bot, badge: filteredProfiles.length, note: 'Tutor, quiz e strumenti' },
            { key: 'teacherbots' as const, label: 'Teacherbot', icon: Wand2, badge: filteredTeacherbots.length, note: 'Dal tuo docente' },
            { key: 'learning' as const, label: 'Oggi Imparo', icon: BookOpen, badge: filteredLearningSessions.length, note: 'Microlezioni' },
            { key: 'rag' as const, label: 'RAG', icon: Database, badge: undefined, note: 'Documenti & citazioni' },
          ].map(({ key, label, icon: Icon, badge, note }) => {
            const active = mainTab === key
            const isExpanded = expandedSection === key
            return (
              <div key={key}>
                <button
	                  className={`w-full rounded-2xl border px-3.5 py-3 text-left backdrop-blur-sm transition-all ${MACRO_AREA_COLORS[key].surface} ${
                      active || isExpanded
                        ? 'shadow-md ring-1 ring-inset ring-black/[0.04]'
                        : 'shadow-sm hover:shadow-md'
                    }`}
                  onClick={() => {
                    if (key === 'rag') {
                      const already = expandedSection === 'rag'
                      setExpandedSection(already ? null : 'rag')
                      setMainTab('rag')
                      setNavCollapsed(true)
                      // If no sessions yet, auto-create one and navigate
                      if (!already && ragSessions.length === 0) {
                        const s = createRagSession()
                        saveRagSession(s)
                        setRagSessions([s])
                        setActiveRagSessionId(s.id)
                        setExpandedSection(null)
                      }
                    } else {
                      setExpandedSection(prev => prev === key ? null : key)
                    }
                  }}
                >
                  <div className="flex items-center gap-2.5">
                    <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${MACRO_AREA_COLORS[key].iconChip}`}>
                      <Icon className="h-4 w-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-1">
                        <span className="text-sm font-bold tracking-tight text-slate-800">{label}</span>
                        <div className="flex items-center gap-1.5">
                          {badge !== undefined && (
                            <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${MACRO_AREA_COLORS[key].badge}`}>
                              {badge}
                            </span>
                          )}
                          <ChevronDown className={`h-3.5 w-3.5 transition-transform text-slate-400 ${isExpanded ? 'rotate-180' : ''}`} />
                        </div>
                      </div>
                      <p className="text-[11px] font-medium text-slate-500">{note}</p>
                    </div>
                  </div>
                </button>

                {/* Expanded sub-items — reference-style tree */}
                {isExpanded && key === 'assistants' && (
                  <div className="relative mt-1 ml-3 space-y-0.5">
                    {filteredProfiles.map((profile, i) => {
                      const isActive = selectedProfile === profile.key && !selectedTeacherbot && !learningMode
                      const usage = profileUsageCounts[profile.key] || 0
                      return (
                        <div key={profile.key} className="relative">
                          <NavTreeConnector tint={MACRO_AREA_COLORS.assistants.line} isLast={i === filteredProfiles.length - 1} />
                          <button
                            onClick={() => handleSelectProfile(profile.key)}
                            className={`ml-[26px] flex w-[calc(100%-26px)] items-center justify-between gap-2 rounded-[14px] px-3 py-2 text-left transition-all ${isActive ? 'bg-white shadow-[0_2px_8px_rgba(15,23,42,0.08)]' : 'hover:bg-white/70'}`}
                          >
                            <span className={`truncate text-[13px] ${isActive ? 'font-bold text-slate-900' : 'font-medium text-slate-500'}`}>{profile.name}</span>
                            {usage > 0 && (
                              <span className={`shrink-0 rounded-md px-1.5 py-0.5 text-[11px] font-bold ${MACRO_AREA_COLORS.assistants.badge}`}>{usage}</span>
                            )}
                          </button>
                        </div>
                      )
                    })}
                  </div>
                )}

                {isExpanded && key === 'teacherbots' && (
                  <div className="relative mt-1 ml-3 space-y-0.5">
                    {filteredTeacherbots.length === 0 ? (
                      <p className="ml-[26px] px-3 py-2 text-xs text-slate-400">{normalizedChatbotSearch ? 'Nessun risultato' : 'Nessun teacherbot disponibile'}</p>
                    ) : filteredTeacherbots.map((bot, i) => {
                      const isActive = selectedTeacherbot?.id === bot.id
                      return (
                        <div key={bot.id} className="relative">
                          <NavTreeConnector tint={MACRO_AREA_COLORS.teacherbots.line} isLast={i === filteredTeacherbots.length - 1} />
                          <button
                            onClick={() => handleSelectTeacherbot(bot)}
                            className={`ml-[26px] flex w-[calc(100%-26px)] items-center justify-between gap-2 rounded-[14px] px-3 py-2 text-left transition-all ${isActive ? 'bg-white shadow-[0_2px_8px_rgba(15,23,42,0.08)]' : 'hover:bg-white/70'}`}
                          >
                            <span className={`truncate text-[13px] ${isActive ? 'font-bold text-slate-900' : 'font-medium text-slate-500'}`}>{bot.name}</span>
                          </button>
                        </div>
                      )
                    })}
                  </div>
                )}

                {isExpanded && key === 'rag' && (() => {
                  const ragList = ragSessions.slice(0, 8)
                  return (
                    <div className="relative mt-1 ml-3 space-y-0.5">
                      <div className="relative">
                        <NavTreeConnector tint={MACRO_AREA_COLORS.rag.line} isLast={ragList.length === 0} />
                        <button
                          onClick={() => {
                            const s = createRagSession()
                            saveRagSession(s)
                            setRagSessions(getRagSessions())
                            setActiveRagSessionId(s.id)
                            setMainTab('rag')
                            setExpandedSection(null)
                            setNavCollapsed(true)
                          }}
                          className="ml-[26px] flex w-[calc(100%-26px)] items-center gap-1.5 rounded-[14px] px-3 py-2 text-left text-[13px] font-semibold text-slate-500 transition-all hover:bg-white/70 hover:text-slate-700 [&_svg]:h-3.5 [&_svg]:w-3.5"
                        >
                          <Plus />
                          Nuova sessione
                        </button>
                      </div>
                      {ragList.map((ragSession, i) => {
                        const isActive = activeRagSessionId === ragSession.id && mainTab === 'rag'
                        return (
                          <div key={ragSession.id} className="relative">
                            <NavTreeConnector tint={MACRO_AREA_COLORS.rag.line} isLast={i === ragList.length - 1} />
                            <button
                              onClick={() => {
                                setActiveRagSessionId(ragSession.id)
                                setMainTab('rag')
                                setExpandedSection(null)
                                setNavCollapsed(true)
                              }}
                              className={`ml-[26px] flex w-[calc(100%-26px)] items-center justify-between gap-2 rounded-[14px] px-3 py-2 text-left transition-all ${isActive ? 'bg-white shadow-[0_2px_8px_rgba(15,23,42,0.08)]' : 'hover:bg-white/70'}`}
                            >
                              <span className={`truncate text-[13px] ${isActive ? 'font-bold text-slate-900' : 'font-medium text-slate-500'}`}>{ragSession.name}</span>
                            </button>
                          </div>
                        )
                      })}
                    </div>
                  )
                })()}

                {isExpanded && key === 'learning' && (() => {
                  const lessonList = filteredLearningSessions.slice(0, 5)
                  return (
                    <div className="relative mt-1 ml-3 space-y-0.5">
                      <div className="relative">
                        <NavTreeConnector tint={MACRO_AREA_COLORS.learning.line} isLast={lessonList.length === 0} />
                        <button
                          onClick={() => setShowNewLessonDialog(true)}
                          className="ml-[26px] flex w-[calc(100%-26px)] items-center gap-1.5 rounded-[14px] px-3 py-2 text-left text-[13px] font-semibold text-slate-500 transition-all hover:bg-white/70 hover:text-slate-700 [&_svg]:h-3.5 [&_svg]:w-3.5"
                        >
                          <Plus />
                          Nuova microlezione
                        </button>
                      </div>
                      {lessonList.map((session, i) => {
                        const isActive = activeLearningSession?.id === session.id
                        return (
                          <div key={session.id} className="relative">
                            <NavTreeConnector tint={MACRO_AREA_COLORS.learning.line} isLast={i === lessonList.length - 1} />
                            <button
                              onClick={() => openLearningSession(session)}
                              className={`ml-[26px] flex w-[calc(100%-26px)] items-center justify-between gap-2 rounded-[14px] px-3 py-2 text-left transition-all ${isActive ? 'bg-white shadow-[0_2px_8px_rgba(15,23,42,0.08)]' : 'hover:bg-white/70'}`}
                            >
                              <span className={`truncate text-[13px] ${isActive ? 'font-bold text-slate-900' : 'font-medium text-slate-500'}`}>{session.topic}</span>
                            </button>
                          </div>
                        )
                      })}
                    </div>
                  )
                })()}
              </div>
            )
          })}
        </nav>

	        <div className="border-t border-slate-200/70 bg-white/45 px-3 py-3 backdrop-blur-sm">
          <div className="grid grid-cols-2 gap-1.5">
	            <div className={`rounded-lg px-3 py-2 shadow-sm ${PASTEL_SURFACES.slate}`}>
              <div className="text-[10px] uppercase tracking-wide text-slate-400">Chat</div>
              <div className="mt-0.5 text-base font-semibold text-slate-900">{conversations.length}</div>
            </div>
	            <div className={`rounded-lg px-3 py-2 shadow-sm ${PASTEL_SURFACES.slate}`}>
              <div className="text-[10px] uppercase tracking-wide text-slate-400">Lezioni</div>
              <div className="mt-0.5 text-base font-semibold text-slate-900">{learningSessions.length}</div>
            </div>
          </div>
        </div>
          </>
        )}
      </aside>

      <div className={`flex min-h-0 min-w-0 flex-1 overflow-hidden text-slate-900 ${sidebarMode ? 'rounded-none bg-white shadow-none' : `rounded-xl shadow-[0_18px_60px_rgba(15,23,42,0.10)] ${PASTEL_SURFACES.slate}`}`}>
        {!sidebarMode && (selectedProfile || selectedTeacherbot || mainTab === 'rag') && (
	          <div className={`${showHistory ? 'w-64' : 'w-10'} hidden md:flex min-h-0 shrink-0 flex-col border-r border-slate-200/70 bg-white/60 transition-all duration-200 backdrop-blur-sm`}>
            {showHistory ? (
              <>
	                <div className="border-b border-slate-200/70 bg-white/60 p-3 backdrop-blur-sm">
                  <div className="flex items-center justify-between">
                    <div>
                      <h4 className="font-semibold text-sm text-slate-700">Cronologia</h4>
                      <p className="text-[11px] text-slate-400 mt-0.5">Conversazioni della vista attiva</p>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setShowHistory(false)}
                      className="h-7 w-7 p-0"
                    >
                      <ChevronLeft className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
                <div className="flex-1 overflow-y-auto p-2 space-y-1">
                  <button
                    onClick={handleStartNewConversation}
                    className="flex w-full items-center gap-2 rounded-xl border px-3 py-2 text-left text-sm shadow-sm transition-colors"
                    style={selectedSoftStyle}
                  >
                    <Sparkles className="h-4 w-4" />
                    Nuova chat
                  </button>
                  {mainTab === 'rag' ? (
                    ragSessions.map((ragSession) => (
                      <div
                        key={ragSession.id}
                        onClick={() => {
                          setActiveRagSessionId(ragSession.id)
                          setMainTab('rag')
                        }}
                        className={`group relative cursor-pointer rounded-lg px-3 py-2 pr-8 text-sm transition-colors ${
                          ragSession.id === activeRagSessionId ? 'bg-white shadow-sm' : 'hover:bg-white/70'
                        }`}
                      >
                        <div className="truncate font-medium text-slate-800">{ragSession.name}</div>
                        <div className="mt-0.5 truncate text-[11px] text-slate-400">
                          {ragSession.messages.filter((message) => message.role === 'user').pop()?.content || 'Sessione RAG'}
                        </div>
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            if (confirm('Eliminare questa sessione RAG?')) {
                              handleDeleteRagSession(ragSession.id)
                            }
                          }}
                          className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded hover:bg-red-100 opacity-0 group-hover:opacity-100 transition-opacity"
                          title="Elimina sessione RAG"
                        >
                          <Trash2 className="h-3 w-3 text-red-500" />
                        </button>
                      </div>
                    ))
                  ) : conversations
                    .filter(c => selectedTeacherbot
                      ? c.profile_key === `teacherbot-${selectedTeacherbot.id}`
                      : c.profile_key === selectedProfile)
                    .map((conv) => (
                      <div
                        key={conv.id}
                        className={`group relative w-full cursor-pointer rounded-lg border px-3 py-2 text-left text-sm transition-colors ${conversationId === conv.id ? '' : 'border-transparent text-slate-600 hover:bg-white/80'}`}
                        style={conversationId === conv.id ? selectedSoftStyle : undefined}
                        onClick={() => loadConversation(conv.id)}
                      >
                        {(() => {
                          if (conv.profile_key.startsWith('teacherbot-')) {
                            const tbId = conv.profile_key.replace('teacherbot-', '')
                            const bot = allAvailableTeacherbots.find(b => b.id === tbId)
                            return bot ? (
                              <div className="text-[10px] font-semibold text-violet-600 mb-0.5 flex items-center gap-1">
                                <Wand2 className="h-2.5 w-2.5" />
                                {bot.name}
                              </div>
                            ) : null
                          }
                          const profile = profiles.find(p => p.key === conv.profile_key)
                          return profile ? (
                            <div className="text-[10px] font-semibold mb-0.5" style={{ color: accentTheme.text }}>
                              {profile.name}
                            </div>
                          ) : null
                        })()}
                        <div className="truncate font-medium pr-6">{conv.title || 'Conversazione'}</div>
                        <div className="text-xs text-slate-400">
                          {new Date(conv.updated_at).toLocaleDateString('it-IT', {
                            day: 'numeric',
                            month: 'short',
                            hour: '2-digit',
                            minute: '2-digit'
                          })}
                        </div>
                        <button
                          onClick={async (e) => {
                            e.stopPropagation()
                            if (confirm('Eliminare questa conversazione?')) {
                              await handleDeleteConversation(conv.id)
                            }
                          }}
                          className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded hover:bg-red-100 opacity-0 group-hover:opacity-100 transition-opacity"
                          title={t('chatbot.delete_conversation')}
                        >
                          <Trash2 className="h-3 w-3 text-red-500" />
                        </button>
                      </div>
                    ))}
                  {(mainTab === 'rag' ? ragSessions.length === 0 : conversations.filter(c => selectedTeacherbot
                    ? c.profile_key === `teacherbot-${selectedTeacherbot.id}`
                    : c.profile_key === selectedProfile).length === 0) && (
                      <p className="text-xs text-slate-400 text-center py-4">Nessuna conversazione precedente</p>
                    )}
                </div>
                {conversations.filter(c => selectedTeacherbot
                  ? c.profile_key === `teacherbot-${selectedTeacherbot.id}`
                  : c.profile_key === selectedProfile).length > 0 && (
                    <div className="border-t border-slate-200 bg-white/60 p-2">
                      <button
                        onClick={async () => {
                          if (confirm('Eliminare tutta la cronologia?')) {
                            await llmApi.deleteAllConversations(sessionId)
                            refetchConversations()
                            handleNewChat()
                          }
                        }}
                        className="w-full text-left px-3 py-2 rounded-lg text-xs text-red-600 hover:bg-red-50 transition-colors flex items-center gap-2"
                      >
                        <Trash2 className="h-3 w-3" />
                        Elimina tutta la cronologia
                      </button>
                    </div>
                  )}
              </>
            ) : (
              <div className="flex-1 flex items-center justify-center">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setShowHistory(true)}
                  className="h-full w-full p-0 rounded-none hover:bg-slate-100"
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            )}
          </div>
        )}

        <div
          className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
        style={chatBg && !sidebarMode ? { backgroundColor: chatBg } : undefined}
        onDragOver={(e) => {
          e.preventDefault()
          e.currentTarget.classList.add('ring-2', 'ring-inset')
        }}
        onDragLeave={(e) => {
          e.currentTarget.classList.remove('ring-2', 'ring-inset')
        }}
        onDrop={(e) => {
          e.preventDefault()
          e.currentTarget.classList.remove('ring-2', 'ring-inset')

          const sessionFileData = e.dataTransfer.getData('application/x-session-file')
          if (sessionFileData) {
            try {
              const data = JSON.parse(sessionFileData)
              let fileUrl = data.url as string
              const handleFile = (blob: Blob) => {
                const fileObj = new globalThis.File([blob], data.filename || 'file', {
                  type: data.mime_type || blob.type || 'application/octet-stream'
                })
                addFileWithPreview(fileObj)
              }
              if (fileUrl.includes('/api/v1/files/') && fileUrl.endsWith('/download-url')) {
                fetch(fileUrl)
                  .then(res => res.json())
                  .then(json => fetch(json.download_url || json.url || fileUrl))
                  .then(res => res.blob())
                  .then(handleFile)
              } else {
                fetch(fileUrl)
                  .then(res => res.blob())
                  .then(handleFile)
              }
            } catch (err) {
              console.error('Failed to handle session file drop', err)
            }
            return
          }

          const imageData = e.dataTransfer.getData('application/x-chatbot-image')
          if (imageData) {
            let imageUrl = imageData
            let imageFilename = `immagine_${Date.now()}.png`
            try {
              const parsed = JSON.parse(imageData)
              if (parsed?.url) imageUrl = parsed.url
              if (parsed?.filename) imageFilename = parsed.filename
            } catch {
              // Drag payload may be a raw URL/data URI.
            }
            fetch(imageUrl)
              .then(res => res.blob())
              .then(blob => {
                const fileObj = new globalThis.File([blob], imageFilename, {
                  type: blob.type || 'image/png',
                  lastModified: Date.now()
                })
                setAttachedFiles(prev => [...prev, { file: fileObj, type: 'image' as const, preview: imageUrl }])
              })
            return
          }

          const csvData = e.dataTransfer.getData('application/x-chatbot-csv')
          if (csvData) {
            const blob = new Blob([csvData], { type: 'text/csv' })
            const fileObj = Object.assign(blob, {
              name: `dataset_${Date.now()}.csv`,
              lastModified: Date.now()
            }) as File
            addFileWithPreview(fileObj as globalThis.File)
            return
          }

          const files = Array.from(e.dataTransfer.files)
          files.forEach(file => addFileWithPreview(file as globalThis.File))
        }}
        >
          {mainTab === 'rag' ? (
            <div className="flex min-h-0 flex-1 flex-col">
              <div className="flex shrink-0 items-center border-b border-slate-200 bg-white/95 px-4 py-2 shadow-sm">
                <button
                  type="button"
                  onClick={() => setMainTab('assistants')}
                  className="inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-bold text-slate-700 hover:bg-slate-100"
                >
                  <ChevronLeft className="h-4 w-4" />
                  Torna allo Spazio AI
                </button>
              </div>
              <Suspense fallback={<div className="flex h-full items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-violet-400" /></div>}>
                {activeRagSession && (
                  <StudentRagWorkspace
                    key={activeRagSession.id}
                    theme={accentTheme}
                    session={activeRagSession}
                    onSessionUpdate={() => setRagSessions(getRagSessions())}
                    onNewSession={() => {
                      const s = createRagSession()
                      saveRagSession(s)
                      setRagSessions(getRagSessions())
                      setActiveRagSessionId(s.id)
                    }}
                    onSwitchSession={(id) => {
                      setRagSessions(getRagSessions())
                      setActiveRagSessionId(id)
                    }}
                    onDeleteSession={handleDeleteRagSession}
                  />
                )}
              </Suspense>
            </div>
          ) : studentbotEditorTarget ? (
            <div className="min-h-0 flex-1 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
              <Suspense fallback={<div className="flex h-full items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-violet-500" /></div>}>
                <TeacherbotForm
                  variant="studentbot"
                  teacherbotId={studentbotEditorTarget === 'create' ? undefined : studentbotEditorTarget}
                  onBack={() => setStudentbotEditorTarget(null)}
                  onSaved={() => setStudentbotEditorTarget(null)}
                />
              </Suspense>
            </div>
          ) : isDesktopSelection ? (
            <div className="flex min-h-0 flex-1 flex-col">
              <section className="relative shrink-0 border-b border-slate-200 bg-white/70 backdrop-blur-sm">
                {(onMinimize || onClose) && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleDockOrClose}
                    className={isDockArmed
                      ? 'dock-armed-glow absolute right-4 top-4 rounded-xl border border-emerald-300 text-white shadow-sm'
                      : 'absolute right-4 top-4 rounded-xl border border-slate-200 bg-white text-slate-500 shadow-sm hover:bg-slate-50 hover:text-slate-700'}
                    title={sidebarMode ? 'Chiudi chatbot' : isDockArmed ? 'Andrà in sidebar al prossimo cambio pagina' : 'Apri in sidebar'}
                  >
                    {sidebarMode ? <X className="h-4 w-4" /> : <PanelRightClose className={`h-4 w-4 ${isDockArmed ? 'text-white' : ''}`} />}
                  </Button>
                )}
                <div className="mx-auto max-w-6xl px-4 py-7 md:px-6">
                  <div className="mx-auto max-w-3xl text-center">
                    <p className="text-[11px] font-bold uppercase tracking-[0.18em]" style={{ color: accentTheme.text }}>Chatbot</p>
                    <h2 className="mt-2 text-3xl font-black tracking-tight text-slate-950">Spazio AI</h2>
                    <p className="mx-auto mt-3 max-w-2xl text-sm leading-6 text-slate-600">
                      Assistenti per studio e quiz, teacherbot del docente, Studentbot personalizzati e sessioni RAG sui tuoi documenti.
                    </p>
                    <label className="mx-auto mt-6 flex max-w-xl items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-2.5 shadow-sm">
                      <Search className="h-4 w-4 shrink-0 text-slate-400" />
                      <input
                        value={chatbotSearch}
                        onChange={(event) => setChatbotSearch(event.target.value)}
                        placeholder="Cerca chatbot o messaggi..."
                        className="min-w-0 flex-1 bg-transparent text-sm font-medium text-slate-700 placeholder:text-slate-400 focus:outline-none"
                      />
                      {chatbotSearch && (
                        <button
                          type="button"
                          onClick={() => setChatbotSearch('')}
                          className="rounded-full p-1 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"
                          aria-label="Cancella ricerca"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </label>
                  </div>
                </div>
              </section>

              <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-8 pt-5 md:px-6">
                <div className="mx-auto w-full max-w-6xl">
                  <div className="mb-5 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
                      {([
                        { key: 'favorites' as const, label: 'Preferiti', icon: Sparkles, count: filteredFavoriteChatbotItems.length },
                        { key: 'assistants' as const, label: 'Chatbot didattici', icon: GraduationCap, count: filteredProfiles.length },
                        { key: 'teacherbots' as const, label: 'Teacherbot', icon: Wand2, count: filteredTeacherbots.length },
                        { key: 'studentbots' as const, label: 'Studentbot', icon: Sparkles, count: filteredStudentbots.length },
                        { key: 'rag' as const, label: 'RAG', icon: Database, count: filteredRagSessions.length },
                      ]).map(({ key, label, icon: Icon, count }) => (
                        <button
                          key={key}
                          type="button"
                          onClick={() => setLibrarySection(key)}
                          className={`flex min-w-0 items-center gap-2 rounded-xl border px-3 py-2 text-left text-xs font-bold transition-colors ${librarySection === key ? 'border-violet-300 bg-violet-100 text-violet-800 shadow-sm' : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'}`}
                        >
                          <Icon className="h-4 w-4 shrink-0" />
                          <span className="min-w-0 flex-1 truncate">{label}</span>
                          <span className="rounded-full bg-white/80 px-1.5 py-0.5 text-[9px]">{count}</span>
                        </button>
                      ))}
                    </div>
                    <div className="flex shrink-0 items-center rounded-xl border border-slate-200 bg-white p-0.5 shadow-sm" role="group" aria-label="Vista Spazio AI">
                      <button type="button" onClick={() => setLibraryViewMode('grid')} aria-pressed={libraryViewMode === 'grid'} title="Vista griglia" className={`flex h-8 w-8 items-center justify-center rounded-lg ${libraryViewMode === 'grid' ? 'bg-violet-100 text-violet-700' : 'text-slate-400 hover:bg-slate-50'}`}><LayoutGrid className="h-4 w-4" /></button>
                      <button type="button" onClick={() => setLibraryViewMode('list')} aria-pressed={libraryViewMode === 'list'} title="Vista elenco" className={`flex h-8 w-8 items-center justify-center rounded-lg ${libraryViewMode === 'list' ? 'bg-violet-100 text-violet-700' : 'text-slate-400 hover:bg-slate-50'}`}><List className="h-4 w-4" /></button>
                    </div>
                  </div>
                  {librarySection === 'favorites' && (
                  <section className="mb-7">
                    <div className="mb-3 flex items-center justify-between gap-3">
                      <div className="inline-flex items-center gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-rose-700">
                        <Sparkles className="h-4 w-4" />
                        <h3 className="text-xs font-extrabold uppercase tracking-wide">Preferiti</h3>
                        <span className="text-xs font-bold opacity-75">{filteredFavoriteChatbotItems.length}</span>
                      </div>
                      <span className="hidden text-xs text-slate-400 sm:inline">Chatbot usati di recente</span>
                    </div>
                    {filteredFavoriteChatbotItems.length === 0 ? (
                      <div className="rounded-lg border border-dashed border-slate-300 bg-white/70 px-4 py-5 text-sm text-slate-500">
                        {normalizedChatbotSearch ? 'Nessun preferito corrisponde alla ricerca.' : 'I chatbot usati di recente appariranno qui.'}
                      </div>
                    ) : (
                      <div className={libraryViewMode === 'grid' ? 'grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4' : 'flex flex-col gap-2'}>
                        {filteredFavoriteChatbotItems.map((item) => {
                          const style = item.kind === 'teacherbot' ? CHATBOT_CARD_STYLES.amber : CHATBOT_CARD_STYLES.violet
                          return (
                            <motion.button
                              key={`${item.kind}-${item.profileKey}`}
                              whileTap={{ scale: 0.98 }}
                              onClick={() => {
                                if (item.conversationId) {
                                  loadConversation(item.conversationId, item.kind === 'teacherbot')
                                } else if (item.kind === 'assistant') {
                                  handleSelectProfile(item.profileKey)
                                }
                              }}
                              className={`group relative overflow-hidden border text-left shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-lg ${libraryViewMode === 'grid' ? 'min-h-[112px] rounded-[18px] p-3' : 'grid min-h-[64px] grid-cols-[36px_minmax(0,1fr)_auto] grid-rows-2 items-center gap-x-3 rounded-xl px-3 py-2'} ${style.card}`}
                            >
                              <div className={`flex h-9 w-9 items-center justify-center rounded-lg shadow-sm ${libraryViewMode === 'list' ? 'col-start-1 row-span-2 row-start-1' : ''} ${style.icon}`}>
                                {item.icon}
                              </div>
                              <span className={`${libraryViewMode === 'grid' ? 'absolute right-4 top-4' : 'col-start-3 row-span-2 row-start-1 self-center'} rounded-full border px-2.5 py-1 text-[10px] font-black ${style.badge}`}>
                                {item.kind === 'teacherbot' ? 'Teacherbot' : 'Didattico'}
                              </span>
                              <p className={`${libraryViewMode === 'grid' ? 'mt-2' : 'col-start-2 row-start-1 self-end'} truncate text-sm font-black text-slate-950`}>{item.title}</p>
                              <p title={libraryViewMode === 'list' ? item.description : undefined} className={`${libraryViewMode === 'grid' ? 'mt-1' : 'col-start-2 row-start-2 self-start truncate'} text-[11px] font-medium text-slate-500`}>{item.description}</p>
                            </motion.button>
                          )
                        })}
                      </div>
                    )}
                  </section>
                  )}

                  {librarySection === 'assistants' && (
                  <section className="mb-7">
                    <div className="mb-3 flex items-center justify-between gap-3">
                      <div className="inline-flex items-center gap-2 rounded-lg border border-violet-200 bg-violet-50 px-3 py-2 text-violet-700">
                        <GraduationCap className="h-4 w-4" />
                        <h3 className="text-xs font-extrabold uppercase tracking-wide">Chatbot Didattici</h3>
                        <span className="text-xs font-bold opacity-75">{filteredProfiles.length}</span>
                      </div>
                      <span className="hidden text-xs text-slate-400 sm:inline">Assistenti AI per studio, quiz e strumenti</span>
                    </div>
                    {filteredProfiles.length === 0 ? (
                      <div className="rounded-lg border border-dashed border-slate-300 bg-white/70 px-4 py-5 text-sm text-slate-500">Nessun chatbot didattico trovato.</div>
                    ) : (
                      <div className={libraryViewMode === 'grid' ? 'grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4' : 'flex flex-col gap-2'}>
                        {filteredProfiles.map((profile) => {
                          const style = CHATBOT_CARD_STYLES.violet
                          const usage = profileUsageCounts[profile.key] || 0
                          return (
                            <motion.button
                              key={profile.key}
                              whileTap={{ scale: 0.98 }}
                              onClick={() => handleSelectProfile(profile.key)}
                              className={`group relative overflow-hidden border text-left shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-lg ${libraryViewMode === 'grid' ? 'min-h-[112px] rounded-[18px] p-3' : 'grid min-h-[64px] grid-cols-[36px_minmax(0,1fr)_auto] grid-rows-2 items-center gap-x-3 rounded-xl px-3 py-2'} ${style.card}`}
                            >
                              <div className={`flex h-9 w-9 items-center justify-center rounded-lg shadow-sm ${libraryViewMode === 'list' ? 'col-start-1 row-span-2 row-start-1' : ''} ${style.icon}`}>
                                {PROFILE_ICONS[profile.key] || <Bot className="h-5 w-5" />}
                              </div>
                              <span className={`${libraryViewMode === 'grid' ? 'absolute right-4 top-4' : 'col-start-3 row-span-2 row-start-1 self-center'} rounded-full border px-2.5 py-1 text-[10px] font-black ${style.badge}`}>
                                {usage > 0 ? usage : 'Nuovo'}
                              </span>
                              <p className={`${libraryViewMode === 'grid' ? 'mt-2' : 'col-start-2 row-start-1 self-end'} truncate text-sm font-black text-slate-950`}>{profile.name}</p>
                              <p title={libraryViewMode === 'list' ? profile.description : undefined} className={`${libraryViewMode === 'grid' ? 'mt-1' : 'col-start-2 row-start-2 self-start truncate'} text-[11px] font-medium text-slate-500`}>{profile.description}</p>
                            </motion.button>
                          )
                        })}
                      </div>
                    )}
                  </section>
                  )}

                  {librarySection === 'teacherbots' && (
                  <section className="mb-7">
                    <div className="mb-3 flex items-center justify-between gap-3">
                      <div className="inline-flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-amber-700">
                        <Wand2 className="h-4 w-4" />
                        <h3 className="text-xs font-extrabold uppercase tracking-wide">Teacherbot</h3>
                        <span className="text-xs font-bold opacity-75">{filteredTeacherbots.length}</span>
                      </div>
                      <span className="hidden text-xs text-slate-400 sm:inline">Assistenti pubblicati dal docente</span>
                    </div>
                    {filteredTeacherbots.length === 0 ? (
                      <div className="rounded-lg border border-dashed border-slate-300 bg-white/70 px-4 py-5 text-sm text-slate-500">
                        {normalizedChatbotSearch ? 'Nessun teacherbot trovato.' : 'Quando il docente pubblica un teacherbot, comparirà qui.'}
                      </div>
                    ) : (
                      <div className={libraryViewMode === 'grid' ? 'grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4' : 'flex flex-col gap-2'}>
                        {filteredTeacherbots.map((bot) => {
                          const style = CHATBOT_CARD_STYLES.amber
                          return (
                            <motion.button
                              key={bot.id}
                              whileTap={{ scale: 0.98 }}
                              onClick={() => handleSelectTeacherbot(bot)}
                              className={`group relative overflow-hidden border text-left shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-lg ${libraryViewMode === 'grid' ? 'min-h-[112px] rounded-[18px] p-3' : 'grid min-h-[64px] grid-cols-[36px_minmax(0,1fr)_auto] grid-rows-2 items-center gap-x-3 rounded-xl px-3 py-2'} ${style.card}`}
                            >
                              <div className={`flex h-9 w-9 items-center justify-center rounded-lg shadow-sm ${libraryViewMode === 'list' ? 'col-start-1 row-span-2 row-start-1' : ''} ${style.icon}`}>
                                <TeacherbotAvatarIcon bot={bot} uiLanguage={uiLanguage} className="h-5 w-5" />
                              </div>
                              <span className={`${libraryViewMode === 'grid' ? 'absolute right-4 top-4' : 'col-start-3 row-span-2 row-start-1 self-center'} rounded-full border px-2.5 py-1 text-[10px] font-black ${style.badge}`}>Docente</span>
                              <p className={`${libraryViewMode === 'grid' ? 'mt-2' : 'col-start-2 row-start-1 self-end'} truncate text-sm font-black text-slate-950`}>{bot.name}</p>
                              <p title={libraryViewMode === 'list' ? (bot.synopsis || bot.description || 'Assistente personalizzato per la sessione.') : undefined} className={`${libraryViewMode === 'grid' ? 'mt-1' : 'col-start-2 row-start-2 self-start truncate'} text-[11px] font-medium text-slate-500`}>{bot.synopsis || bot.description || 'Assistente personalizzato per la sessione.'}</p>
                            </motion.button>
                          )
                        })}
                      </div>
                    )}
                  </section>
                  )}

                  {librarySection === 'studentbots' && (
                  <section className="mb-7">
                    <div className="mb-3 flex items-center justify-between gap-3">
                      <div className="inline-flex items-center gap-2 rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-sky-700">
                        <Sparkles className="h-4 w-4" />
                        <h3 className="text-xs font-extrabold uppercase tracking-wide">Studentbot</h3>
                        <span className="text-xs font-bold opacity-75">{filteredStudentbots.length}</span>
                      </div>
                      <span className="hidden text-xs text-slate-400 sm:inline">I tuoi assistenti AI privati e personalizzati</span>
                    </div>
                    <div className={libraryViewMode === 'grid' ? 'grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4' : 'flex flex-col gap-2'}>
                      <motion.button
                        whileTap={{ scale: 0.98 }}
                        onClick={() => setStudentbotEditorTarget('create')}
                        className={`group relative overflow-hidden border text-left shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-lg ${libraryViewMode === 'grid' ? 'min-h-[112px] rounded-[18px] p-3' : 'grid min-h-[64px] grid-cols-[36px_minmax(0,1fr)_auto] grid-rows-2 items-center gap-x-3 rounded-xl px-3 py-2'} ${CHATBOT_CARD_STYLES.emerald.card}`}
                      >
                        <div className={`flex h-9 w-9 items-center justify-center rounded-lg shadow-sm ${libraryViewMode === 'list' ? 'col-start-1 row-span-2 row-start-1' : ''} ${CHATBOT_CARD_STYLES.emerald.icon}`}><Plus className="h-5 w-5" /></div>
                        <span className={`${libraryViewMode === 'grid' ? 'absolute right-4 top-4' : 'col-start-3 row-span-2 row-start-1 self-center'} rounded-full border px-2.5 py-1 text-[10px] font-black ${CHATBOT_CARD_STYLES.emerald.badge}`}>Nuovo</span>
                        <p className={`${libraryViewMode === 'grid' ? 'mt-2' : 'col-start-2 row-start-1 self-end'} truncate text-sm font-black text-slate-950`}>Crea il tuo bot personalizzato</p>
                        <p className={`${libraryViewMode === 'grid' ? 'mt-1' : 'col-start-2 row-start-2 self-start truncate'} text-[11px] font-medium text-slate-500`}>Scegli personalità, istruzioni e allegati.</p>
                      </motion.button>
                      {studentbotsLoading && <div className="flex min-h-[112px] items-center justify-center"><Loader2 className="h-5 w-5 animate-spin text-sky-500" /></div>}
                      {filteredStudentbots.map((bot) => {
                        const available = availableStudentbots.find((item) => item.id === bot.id)
                        return (
                          <div key={bot.id} className={`group relative overflow-hidden border text-left shadow-sm ${libraryViewMode === 'grid' ? 'min-h-[112px] rounded-[18px] p-3' : 'grid min-h-[64px] grid-cols-[36px_minmax(0,1fr)_auto] grid-rows-2 items-center gap-x-3 rounded-xl px-3 py-2'} ${CHATBOT_CARD_STYLES.emerald.card}`}>
                            <button type="button" onClick={() => available && handleSelectTeacherbot(available)} className="absolute inset-0 z-0" aria-label={`Apri ${bot.name}`} />
                            <div className={`relative z-10 flex h-9 w-9 items-center justify-center rounded-lg shadow-sm pointer-events-none ${libraryViewMode === 'list' ? 'col-start-1 row-span-2 row-start-1' : ''} ${CHATBOT_CARD_STYLES.emerald.icon}`}><Sparkles className="h-5 w-5" /></div>
                            <span className={`${libraryViewMode === 'grid' ? 'absolute right-3 top-3' : 'col-start-3 row-span-2 row-start-1 self-center'} z-20 flex gap-1`}>
                              <button type="button" onClick={() => setStudentbotEditorTarget(bot.id)} className="rounded-lg border border-white/80 bg-white/90 px-2 py-1 text-[10px] font-black text-sky-700 shadow-sm">Configura</button>
                              <button type="button" onClick={() => { if (window.confirm(`Eliminare lo Studentbot “${bot.name}”?`)) deleteStudentbotMutation.mutate(bot.id) }} className="rounded-lg border border-white/80 bg-white/90 px-2 py-1 text-[10px] font-black text-rose-600 shadow-sm">Elimina</button>
                            </span>
                            <p className={`${libraryViewMode === 'grid' ? 'relative z-10 mt-2 pr-28' : 'col-start-2 row-start-1 self-end'} truncate text-sm font-black text-slate-950 pointer-events-none`}>{bot.name}</p>
                            <p className={`${libraryViewMode === 'grid' ? 'relative z-10 mt-1' : 'col-start-2 row-start-2 self-start truncate'} text-[11px] font-medium text-slate-500 pointer-events-none`}>{bot.synopsis || 'Il tuo assistente AI personalizzato'}</p>
                          </div>
                        )
                      })}
                    </div>
                  </section>
                  )}

                  {librarySection === 'rag' && (
                  <section className="mb-2">
                    <div className="mb-3 flex items-center justify-between gap-3">
                      <div className="inline-flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-emerald-700">
                        <Database className="h-4 w-4" />
                        <h3 className="text-xs font-extrabold uppercase tracking-wide">RAG</h3>
                        <span className="text-xs font-bold opacity-75">{filteredRagSessions.length}</span>
                      </div>
                      <span className="hidden text-xs text-slate-400 sm:inline">Documenti, citazioni e sessioni salvate</span>
                    </div>
                    <div className={libraryViewMode === 'grid' ? 'grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4' : 'flex flex-col gap-2'}>
                      <motion.button
                        whileTap={{ scale: 0.98 }}
                        onClick={createAndOpenRagSession}
                        className={`group relative overflow-hidden border text-left shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-lg ${libraryViewMode === 'grid' ? 'min-h-[112px] rounded-[18px] p-3' : 'grid min-h-[64px] grid-cols-[36px_minmax(0,1fr)_auto] grid-rows-2 items-center gap-x-3 rounded-xl px-3 py-2'} ${CHATBOT_CARD_STYLES.emerald.card}`}
                      >
                        <div className={`flex h-9 w-9 items-center justify-center rounded-lg shadow-sm ${libraryViewMode === 'list' ? 'col-start-1 row-span-2 row-start-1' : ''} ${CHATBOT_CARD_STYLES.emerald.icon}`}>
                          <Plus className="h-5 w-5" />
                        </div>
                        <p className={`${libraryViewMode === 'grid' ? 'mt-2' : 'col-start-2 row-start-1 self-end'} truncate text-sm font-black text-slate-950`}>Nuova sessione RAG</p>
                        <p title={libraryViewMode === 'list' ? 'Interroga documenti e fonti caricate.' : undefined} className={`${libraryViewMode === 'grid' ? 'mt-1' : 'col-start-2 row-start-2 self-start truncate'} text-[11px] font-medium text-slate-500`}>Interroga documenti e fonti caricate.</p>
                      </motion.button>
                      {filteredRagSessions.slice(0, 7).map((ragSession) => (
                        <motion.button
                          key={ragSession.id}
                          whileTap={{ scale: 0.98 }}
                          onClick={() => openRagSession(ragSession)}
                          className={`group relative overflow-hidden border text-left shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-lg ${libraryViewMode === 'grid' ? 'min-h-[112px] rounded-[18px] p-3' : 'grid min-h-[64px] grid-cols-[36px_minmax(0,1fr)_auto] grid-rows-2 items-center gap-x-3 rounded-xl px-3 py-2'} ${CHATBOT_CARD_STYLES.emerald.card}`}
                        >
                          <div className={`flex h-9 w-9 items-center justify-center rounded-lg shadow-sm ${libraryViewMode === 'list' ? 'col-start-1 row-span-2 row-start-1' : ''} ${CHATBOT_CARD_STYLES.emerald.icon}`}>
                            <Database className="h-5 w-5" />
                          </div>
                          <span className={`${libraryViewMode === 'grid' ? 'absolute right-4 top-4' : 'col-start-3 row-span-2 row-start-1 self-center'} rounded-full border px-2.5 py-1 text-[10px] font-black ${CHATBOT_CARD_STYLES.emerald.badge}`}>
                            {ragSession.messages.length > 0 ? `${ragSession.messages.length} msg` : 'Pronta'}
                          </span>
                          <p className={`${libraryViewMode === 'grid' ? 'mt-2' : 'col-start-2 row-start-1 self-end'} truncate text-sm font-black text-slate-950`}>{ragSession.name}</p>
                          <p title={libraryViewMode === 'list' ? (ragSession.messages.length > 0 ? `${ragSession.messages.length} messaggi` : 'Sessione pronta') : undefined} className={`${libraryViewMode === 'grid' ? 'mt-1' : 'col-start-2 row-start-2 self-start truncate'} text-[11px] font-medium text-slate-500`}>
                            {ragSession.messages.length > 0 ? `${ragSession.messages.length} messaggi` : 'Sessione pronta'}
                          </p>
                        </motion.button>
                      ))}
                    </div>
                  </section>
                  )}
                </div>
              </div>
            </div>
          ) : (
            <>
	              <div
                  className="relative z-20 hidden shrink-0 items-center gap-3 border-b bg-white/95 px-4 py-2.5 shadow-[0_1px_0_rgba(15,23,42,0.03)] backdrop-blur-md md:flex"
                  style={{
                    borderBottomColor: `color-mix(in srgb, ${activeBotAccent} 24%, #e2e8f0)`,
                    backgroundImage: `linear-gradient(90deg, color-mix(in srgb, ${activeBotAccent} 8%, white), rgba(255,255,255,0.96) 38%)`,
                  }}
                >
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl" style={activeBotSolidStyle}>
                  {selectedTeacherbot ? (
                    <div className="text-white scale-90 w-full h-full flex items-center justify-center">
                      <TeacherbotAvatarIcon bot={selectedTeacherbot} uiLanguage={uiLanguage} className="h-5 w-5" />
                    </div>
                  ) : selectedProfile && PROFILE_ICONS[selectedProfile] ? (
                    <div className="text-white scale-90">{PROFILE_ICONS[selectedProfile]}</div>
                  ) : (
                    <AcademicAiIcon className="h-5 w-5 text-white" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <h3 className="truncate text-[15px] font-bold text-slate-900">
                    {learningMode && activeLearningSession ? activeLearningSession.topic : (selectedTeacherbot ? selectedTeacherbot.name : currentProfile?.name)}
                  </h3>
                  <p className="hidden truncate text-xs font-medium text-slate-500 lg:block">
                    {learningMode
                      ? 'Tutor contestualizzato sulla microlezione selezionata'
                      : (selectedTeacherbot ? 'Assistente pubblicato dal docente' : (effectiveSelectedModel?.name || 'Modello AI'))}
                  </p>
                </div>
                {!sidebarMode && (
                  <label className="hidden w-56 shrink-0 items-center gap-2 rounded-xl border bg-white/90 px-3 py-2 shadow-sm xl:flex" style={{ borderColor: `color-mix(in srgb, ${activeBotAccent} 18%, #e2e8f0)` }}>
                    <Search className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                    <input
                      value={chatbotSearch}
                      onChange={(event) => setChatbotSearch(event.target.value)}
                      placeholder="Cerca nella chat..."
                      className="min-w-0 flex-1 bg-transparent text-sm font-medium text-slate-700 placeholder:text-slate-400 focus:outline-none"
                    />
                    {chatbotSearch && (
                      <button
                        type="button"
                        onClick={() => setChatbotSearch('')}
                        className="rounded-full p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                        aria-label="Cancella ricerca chat"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    )}
                  </label>
                )}

                <div className="hidden lg:flex items-center gap-2 relative">
                  {!sidebarMode && (
                    <button
                      type="button"
                      onClick={returnToChatbotLibrary}
                      className="flex h-9 w-9 items-center justify-center rounded-xl border shadow-sm transition-transform hover:-translate-y-0.5"
                      style={activeBotSoftStyle}
                      title="Torna ai chatbot"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  )}
                  {sidebarMode ? (
                    <>
                      {onExpand && (
                        <button
                          type="button"
                          onClick={onExpand}
                          className="flex h-9 w-9 items-center justify-center rounded-xl border shadow-sm transition-transform hover:-translate-y-0.5"
                          style={activeBotSoftStyle}
                          title="Espandi a schermo intero"
                        >
                          <PanelRightOpen className="h-4 w-4" />
                        </button>
                      )}
                      {onClose && (
                        <button
                          type="button"
                          onClick={onClose}
                          className="app-button-chrome app-button-chrome-quiet flex h-9 w-9 items-center justify-center rounded-xl text-[var(--text-secondary)]"
                          title="Chiudi chatbot"
                        >
                          <X className="h-4 w-4" />
                        </button>
                      )}
                    </>
                  ) : onMinimize && (
                    <button
                      type="button"
                      onClick={handleDockOrClose}
                      className={isDockArmed
                        ? 'dock-armed-glow flex h-9 w-9 items-center justify-center rounded-lg border border-emerald-300 text-white shadow-sm'
                        : 'app-button-chrome app-button-chrome-quiet flex h-9 w-9 items-center justify-center rounded-xl text-[var(--text-secondary)]'}
                      title={isDockArmed ? 'Andrà in sidebar al prossimo cambio pagina' : 'Apri in sidebar'}
                    >
                      <PanelRightClose className={`h-4 w-4 ${isDockArmed ? 'text-white' : ''}`} />
                    </button>
                  )}
                  {!sidebarMode && selectedProfile === 'oral_exam' && !selectedTeacherbot && !isTeacherPreview && (
                    <button
                      type="button"
                      onClick={() => { setVoiceSource(undefined); setShowVoiceInterrogation(true) }}
                      className="inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-bold text-white shadow-sm transition-transform hover:-translate-y-0.5"
                      style={activeBotSolidStyle}
                      title={uiLanguage === 'en' ? 'Voice oral exam' : 'Interrogazione vocale'}
                    >
                      <Mic className="h-3.5 w-3.5" />
                      {uiLanguage === 'en' ? 'Voice exam' : 'Interrogazione vocale'}
                    </button>
                  )}
                  {!sidebarMode && selectedTeacherbot?.enable_live_voice && (
                    <button
                      type="button"
                      onClick={() => {
                        setVoiceSource({ kind: 'teacherbot', teacherbotId: selectedTeacherbot.id, botName: selectedTeacherbot.name })
                        setShowVoiceInterrogation(true)
                      }}
                      className="inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-bold text-white shadow-sm transition-transform hover:-translate-y-0.5"
                      style={activeBotSolidStyle}
                      title={uiLanguage === 'en' ? 'Live voice' : 'Voce live'}
                    >
                      <Mic className="h-3.5 w-3.5" />
                      {uiLanguage === 'en' ? 'Live voice' : 'Voce live'}
                    </button>
                  )}
                  {collaborationEnabled && !isTeacherPreview && !activeSharedRoom && (selectedTeacherbot || (selectedProfile && !learningMode)) && (
                    <button
                      type="button"
                      onClick={() => setSharePickerTarget(
                        selectedTeacherbot
                          ? { kind: 'teacherbot', teacherbotId: selectedTeacherbot.id, title: selectedTeacherbot.name }
                          : { kind: 'assistant', profileKey: selectedProfile!, title: currentProfile?.name || selectedProfile! }
                      )}
                      className="flex items-center gap-1.5 rounded-xl border px-3 py-2 text-xs font-bold shadow-sm transition-transform hover:-translate-y-0.5"
                      style={activeBotSoftStyle}
                      title={uiLanguage === 'en' ? 'Share with classmates' : 'Condividi con i compagni'}
                    >
                      <Users className="h-3.5 w-3.5" />
                      <span className={sidebarMode ? 'sr-only' : ''}>{uiLanguage === 'en' ? 'Share with' : 'Condividi con'}</span>
                    </button>
                  )}
                  {false && !sidebarMode && <div className="relative">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setShowBgPalette((v) => !v)}
                      className={`rounded-xl text-slate-500 shadow-sm hover:text-slate-700 ${PASTEL_SURFACES.slate}`}
                      title={t('chatbot.choose_color')}
                    >
                      <Palette className="h-4 w-4" />
                    </Button>
                    {showBgPalette && (
                      <div className="absolute right-0 top-10 z-30 w-64 rounded-xl border border-slate-200 bg-white p-3 shadow-xl">
                        <div className="space-y-3">
                          {paletteGroups.map((group) => (
                            <div key={group.label}>
                              <div className="text-[10px] text-slate-400 mb-1">{group.label}</div>
                              <div className="grid grid-cols-5 gap-1">
                                {group.colors.map((color) => (
                                  <button
                                    key={`${group.label}-${color}`}
                                    onClick={() => {
                                      setChatBg(color)
                                      setShowBgPalette(false)
                                    }}
                                    className={`h-6 w-6 rounded-md border transition-transform hover:scale-105 ${chatBg === color ? 'ring-2 ring-offset-1' : ''}`}
	                                    style={chatBg === color ? { backgroundColor: color, boxShadow: '0 0 0 2px #0f172a' } : { backgroundColor: color }}
                                    title={color}
                                  />
                                ))}
                              </div>
                            </div>
                          ))}
                        </div>
                        <div className="mt-2 flex items-center justify-between text-[10px] text-slate-400">
                          <span>Palette ridotta</span>
                          <div className="flex items-center gap-2">
                            <button
                              onClick={() => chatBg && handleSetDefaultChatBg(chatBg)}
                              className={`text-slate-500 hover:text-slate-700 ${chatBg ? '' : 'opacity-40 cursor-not-allowed'}`}
                              disabled={!chatBg}
                            >
                              {t('chatbot.set_default')}
                            </button>
                            {chatBgDefault && (
                              <button
                                onClick={() => {
                                  setChatBg(chatBgDefault)
                                  setShowBgPalette(false)
                                }}
                                className="text-slate-500 hover:text-slate-700"
                              >
                                Usa default
                              </button>
                            )}
                            <button
                              onClick={() => {
                                setChatBg('')
                                setShowBgPalette(false)
                              }}
                              className="text-slate-500 hover:text-slate-700"
                            >
                              Reset
                            </button>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>}
                </div>

                {!selectedTeacherbot && (
                  <div className="hidden lg:block relative" ref={modelMenuRef}>
                    <button
                      onClick={() => setShowModelMenu(!showModelMenu)}
                      className={sidebarMode
                        ? "flex h-9 w-9 items-center justify-center rounded-xl border shadow-sm"
                        : "flex items-center gap-2 rounded-xl border px-3 py-2 text-xs font-bold shadow-sm transition-transform hover:-translate-y-0.5"}
                      style={activeBotSoftStyle}
                      title="Seleziona modello"
                    >
                      {effectiveSelectedModel?.provider === 'openai' ? (
                        <img src="/icone_ai/OpenAI_logo_2025_(symbol).svg.png" alt="OpenAI" className="h-3.5 w-3.5 object-contain" />
                      ) : effectiveSelectedModel?.provider === 'anthropic' ? (
                        <img src="/icone_ai/anthropic.svg" alt="Anthropic" className="h-3.5 w-3.5 object-contain" />
                      ) : effectiveSelectedModel?.provider === 'deepseek' ? (
                        <img src="/icone_ai/deepseek-logo-icon.svg" alt="DeepSeek" className="h-3.5 w-3.5 object-contain" />
                      ) : (
                        <Bot className="h-3.5 w-3.5" />
                      )}
                      <span className={sidebarMode ? 'sr-only' : ''}>{effectiveSelectedModel?.name || 'Modello AI'}</span>
                      <ChevronDown className={`${sidebarMode ? 'hidden' : 'h-3 w-3'} transition-transform ${showModelMenu ? 'rotate-180' : ''}`} />
                    </button>
                    {showModelMenu && (
                      <div className="absolute right-0 top-full mt-2 w-72 rounded-xl border border-slate-200 bg-white shadow-xl z-40 py-1">
                        <div className="px-4 py-2 text-[10px] font-semibold text-slate-400 uppercase tracking-wide border-b border-slate-100">Seleziona modello</div>
                        {availableModels.map((m) => {
                          const selected = modelKey(effectiveSelectedModel) === modelKey(m)
                          const isDefault = defaultModelKey === modelKey(m)
                          return (
                            <div
                              key={modelKey(m)}
                              className={`mx-1 my-0.5 px-3 py-2 rounded-[var(--selection-radius)] border cursor-pointer flex items-center justify-between ${selected ? '' : 'border-transparent hover:bg-[image:var(--selection-bg)]'}`}
                                style={selected ? activeBotSoftStyle : undefined}
                              onClick={() => handleChangeModel(m)}
                            >
                              <div className="flex items-center gap-2.5 min-w-0">
                                <div className={`p-1.5 rounded-md ${selected ? '' : 'bg-slate-100'}`} style={selected ? { backgroundColor: 'rgba(255,255,255,0.3)' } : undefined}>
                                  {m.provider === 'openai' ? (
                                    <img src="/icone_ai/OpenAI_logo_2025_(symbol).svg.png" alt="OpenAI" className="h-4 w-4 object-contain" />
                                  ) : m.provider === 'anthropic' ? (
                                    <img src="/icone_ai/anthropic.svg" alt="Anthropic" className="h-4 w-4 object-contain" />
                                  ) : m.provider === 'deepseek' ? (
                                    <img src="/icone_ai/deepseek-logo-icon.svg" alt="DeepSeek" className="h-4 w-4 object-contain" />
                                  ) : (
                                    <Bot className="h-4 w-4" />
                                  )}
                                </div>
                                <div className="min-w-0">
                                  <div className="text-sm font-semibold truncate">{m.name}</div>
                                  <div className="text-[10px] text-slate-400 capitalize">{m.provider}</div>
                                </div>
                              </div>
                              <button
                                className={`w-4 h-4 rounded border flex items-center justify-center ${isDefault ? '' : 'border-slate-300'}`}
                                style={isDefault ? activeBotSolidStyle : undefined}
                                onClick={(e) => handleSetDefaultModel(m, e)}
                                title={t('chatbot.set_default')}
                              >
                                {isDefault && <Check className="h-3 w-3 text-white" />}
                              </button>
                            </div>
                          )
                        })}
                        <div className="px-3 pb-2 pt-1 border-t border-slate-100">
                          <button
                            onClick={() => handleChangeModel(null)}
                            className="text-xs text-slate-500 hover:text-slate-700"
                          >
                            Usa modello predefinito sessione
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Collaboration presence bar — connected users as named bubbles */}
              {activeSharedRoom && (
                <div className="flex shrink-0 items-center gap-2 border-b border-slate-200/70 bg-white px-4 py-2">
                  <Users className="h-3.5 w-3.5 flex-shrink-0 text-slate-400" />
                  <div className="flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto">
                    {activeSharedRoom.participants.map((p) => {
                      const me = p.id === studentId
                      const c = me ? accentTheme.accent : collabNameColor(p.nickname)
                      return (
                        <span key={p.id} className="inline-flex flex-shrink-0 items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-semibold"
                          style={{ borderColor: me ? accentTheme.accent : '#e2e8f0', backgroundColor: me ? accentTheme.soft : '#f8fafc', color: c }}>
                          <span className="flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold text-white" style={{ backgroundColor: c }}>
                            {p.nickname.slice(0, 1).toUpperCase()}
                          </span>
                          {me ? (uiLanguage === 'en' ? 'You' : 'Tu') : p.nickname}
                        </span>
                      )
                    })}
                  </div>
                  <button
                    type="button"
                    onClick={async () => {
                      if (activeSharedRoom.owner_student_id === studentId) {
                        try { await collaborationApi.closeRoom(activeSharedRoom.id) } catch { /* noop */ }
                      }
                      setActiveSharedRoom(null)
                      setSharedInvites((prev) => prev.filter((r) => r.id !== activeSharedRoom.id))
                    }}
                    className="flex-shrink-0 rounded-full border border-slate-200 bg-slate-50 px-3 py-0.5 text-xs font-bold text-slate-600 hover:bg-slate-100"
                  >
                    {activeSharedRoom.owner_student_id === studentId
                      ? (uiLanguage === 'en' ? 'End' : 'Termina')
                      : (uiLanguage === 'en' ? 'Leave' : 'Esci')}
                  </button>
                </div>
              )}

              {/* Mode toolbar */}
              <div
                ref={messagesContainerRef}
                className={`min-h-0 flex-1 space-y-3 overflow-y-auto overflow-x-hidden px-6 py-4 md:space-y-6 md:px-10 md:py-6 ${chatBg ? '' : 'bg-neutral-50'} ${chatBgIsDark ? 'text-white' : ''}`}
                style={{ WebkitOverflowScrolling: 'touch', scrollBehavior: 'smooth' }}
              >
          <div className="mx-auto w-full max-w-3xl">
          {messages.length === 0 ? (
            <div className="text-center py-12">
              <div className="mb-6 inline-flex h-20 w-20 items-center justify-center rounded-2xl" style={activeBotSolidStyle}>
                {selectedTeacherbot ? (
                  <TeacherbotAvatarIcon bot={selectedTeacherbot} uiLanguage={uiLanguage} className="h-10 w-10 text-white" />
                ) : selectedProfile && PROFILE_ICONS[selectedProfile] ? (
                  <div className="text-white scale-125">{PROFILE_ICONS[selectedProfile]}</div>
                ) : (
                  <AcademicAiIcon className="h-10 w-10 text-white" />
                )}
              </div>
              <h3 className={`font-bold text-xl mb-2 ${chatBgIsDark ? 'text-white' : 'text-slate-800'}`}>{t('chatbot.greeting', { name: selectedTeacherbot ? selectedTeacherbot.name : currentProfile?.name })}</h3>
              <p className={`${chatBgIsDark ? 'text-white/70' : 'text-slate-500'} max-w-md mx-auto mb-8`}>{selectedTeacherbot ? '' : currentProfile?.description}</p>
              <div className="flex flex-wrap gap-2 justify-center max-w-lg mx-auto">
                {currentProfile?.suggested_prompts && !selectedTeacherbot && currentProfile.suggested_prompts.map((suggestion) => (
                  <button
                    key={suggestion}
                    onClick={() => setInput(suggestion)}
                    className={`rounded-xl px-4 py-2 text-sm shadow-sm transition-all hover:-translate-y-0.5 ${chatBgIsDark ? 'border border-white/15 bg-white/10 text-white hover:bg-white/15' : PASTEL_SURFACES.slate}`}
                  >
                    {suggestion}
                  </button>
                ))}
              </div>
              {selectedProfile === 'oral_exam' && !selectedTeacherbot && !isTeacherPreview && (
                <button
                  type="button"
                  onClick={() => setShowVoiceInterrogation(true)}
                  className="mx-auto mt-8 inline-flex items-center gap-2 rounded-full px-6 py-3 text-sm font-bold text-white shadow-lg transition-transform hover:-translate-y-0.5"
                  style={activeBotSolidStyle}
                >
                  <Mic className="h-4 w-4" />
                  {uiLanguage === 'en' ? 'Start voice oral exam' : 'Avvia interrogazione vocale'}
                </button>
              )}
            </div>
          ) : visibleMessages.length === 0 ? (
            <div className="flex h-full min-h-[280px] items-center justify-center text-center">
              <div>
                <Search className="mx-auto h-8 w-8 text-slate-300" />
                <p className={`mt-3 text-sm font-semibold ${chatBgIsDark ? 'text-white' : 'text-slate-700'}`}>Nessun messaggio trovato</p>
                <p className={`mt-1 text-xs ${chatBgIsDark ? 'text-white/60' : 'text-slate-400'}`}>Cancella la ricerca per tornare alla chat completa.</p>
              </div>
            </div>
          ) : (
            visibleMessages.map((message) => {
              const isPeerUser = !!activeSharedRoom && message.role === 'user' && message.senderStudentId != null && message.senderStudentId !== studentId
              const isOwnUser = message.role === 'user' && !isPeerUser
              const nameColor = collabNameColor(message.senderNickname || '')
              const senderLabel = message.role === 'assistant'
                ? (selectedTeacherbot ? selectedTeacherbot.name : currentProfile?.name || 'Assistente')
                : isPeerUser ? (message.senderNickname || 'Compagno') : (uiLanguage === 'en' ? 'You' : 'Tu')
              return (
              <div key={message.id} className={`flex gap-3 ${isOwnUser ? 'flex-row-reverse' : ''}`}>
                <div className="flex w-8 shrink-0 flex-col items-center">
                  {message.role === 'assistant' ? (
                    <div className="flex h-8 w-8 items-center justify-center rounded-xl shadow-sm" style={activeBotSolidStyle}>
                      {selectedTeacherbot ? (
                        <TeacherbotAvatarIcon bot={selectedTeacherbot} uiLanguage={uiLanguage} className="h-4 w-4 text-white" />
                      ) : selectedProfile && PROFILE_ICONS[selectedProfile] ? (
                        <div className="scale-75 text-white">{PROFILE_ICONS[selectedProfile]}</div>
                      ) : (
                        <AcademicAiIcon className="h-4 w-4 text-white" />
                      )}
                    </div>
                  ) : isPeerUser ? (
                    <div className="flex h-8 w-8 items-center justify-center rounded-full text-[10px] font-black text-white shadow-sm" style={{ backgroundColor: nameColor }}>
                      {(message.senderNickname || '?').slice(0, 2).toUpperCase()}
                    </div>
                  ) : (
                    <div className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-700 text-[10px] font-black text-white shadow-sm">
                      {uiLanguage === 'en' ? 'YOU' : 'TU'}
                    </div>
                  )}
                </div>
                <div className={`flex max-w-[92%] flex-col md:max-w-[80%] ${isOwnUser ? 'items-end' : 'items-start'}`}>
                  <span className="mx-1 mb-1 truncate text-[11px] font-bold uppercase tracking-wide text-slate-400">
                    {senderLabel}
                    {message.isPeer && (
                      <span className="ml-1.5 normal-case text-amber-600">@ {uiLanguage === 'en' ? 'private' : 'privato'}</span>
                    )}
                  </span>
                  <div
                    className={`chat-markdown px-4 py-3 text-[16px] leading-7 shadow-sm transition-all ${isOwnUser
                      ? 'rounded-2xl rounded-tr-none border'
                      : 'rounded-2xl rounded-tl-none border border-slate-200 bg-white text-slate-700'
                      } ${message.isPeer ? 'ring-1 ring-amber-200' : ''}`}
                    style={isOwnUser ? activeBotSoftStyle : undefined}
                  >
                    {message.role === 'assistant' ? (
                      <MessageContent
                        content={message.content}
                        onQuizSubmit={(answers) => setInput(answers)}
                        onInput={(text) => {
                          setInput(text);
                          setTimeout(() => handleSend(text), 100);
                        }}
                        darkMode={false}
                      />
                    ) : (
                      <p className="whitespace-pre-wrap text-[16px] leading-7">{message.content}</p>
                    )}
                    {message.role === 'assistant' && (
                      <EnvironmentalImpactPill
                        darkMode={false}
                        className="mt-3"
                        provider={message.provider}
                        model={message.model}
                        tokenUsage={message.token_usage_json}
                      />
                    )}
                  </div>
                  <span className="mx-1 mt-1 text-[10px] font-medium text-slate-400">
                    {message.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </span>
                </div>
              </div>
              )
            })
          )}
          {(sendMessageMutation.isPending && !isStreaming) && (
            <div className="flex gap-3">
	              <div className="flex h-9 w-9 items-center justify-center rounded-xl" style={activeBotSolidStyle}>
                {selectedTeacherbot ? (
                  <TeacherbotAvatarIcon bot={selectedTeacherbot} uiLanguage={uiLanguage} className="h-5 w-5 text-white" />
                ) : selectedProfile && PROFILE_ICONS[selectedProfile] ? (
                  <div className="text-white scale-75">{PROFILE_ICONS[selectedProfile]}</div>
                ) : (
                  <AcademicAiIcon className="h-5 w-5 text-white" />
                )}
              </div>
	              <div className={`${chatBgIsDark ? 'bg-white/10 border border-white/15' : 'bg-white border border-slate-100'} shadow-sm rounded-xl rounded-bl-md px-4 py-3`}>
                <div className="flex items-center gap-2">
                  <div className="flex gap-1">
	                    <span className="w-2 h-2 rounded-full animate-bounce" style={{ animationDelay: '0ms', backgroundColor: chatBgIsDark ? '#ffffff' : '#64748b' }}></span>
	                    <span className="w-2 h-2 rounded-full animate-bounce" style={{ animationDelay: '150ms', backgroundColor: chatBgIsDark ? '#ffffff' : '#64748b' }}></span>
	                    <span className="w-2 h-2 rounded-full animate-bounce" style={{ animationDelay: '300ms', backgroundColor: chatBgIsDark ? '#ffffff' : '#64748b' }}></span>
                  </div>
                  <span className={`text-sm ${chatBgIsDark ? 'text-white/70' : 'text-slate-400'}`}>Sto pensando...</span>
                </div>
              </div>
            </div>
          )}
          {streamingStatus && (
            <div className="flex gap-3">
	              <div className="w-9 h-9 rounded-lg flex items-center justify-center bg-slate-900 shadow-md">
                <Loader2 className="h-4 w-4 text-white animate-spin" />
              </div>
	              <div className={`${chatBgIsDark ? 'bg-white/10 border border-white/15' : 'bg-white border border-slate-100'} shadow-sm rounded-xl rounded-bl-md px-3 py-2`}>
                <span className={`text-xs ${chatBgIsDark ? 'text-white/70' : 'text-slate-400'}`}>{streamingStatus}</span>
              </div>
            </div>
          )}
          {imageGenerationProgress && (
            <div className="flex gap-3 justify-start">
	              <div className="w-9 h-9 rounded-lg flex items-center justify-center bg-slate-900 shadow-md flex-shrink-0">
                <ImageIcon className="h-4 w-4 text-white" />
              </div>
	              <div className="bg-white border border-slate-100 shadow-sm rounded-xl rounded-bl-md px-4 py-3 max-w-[75%]">
                <div className="flex items-center gap-2 mb-1">
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-fuchsia-500" />
                  <span className="font-medium text-slate-700 text-sm">{imageGenerationProgress.status}</span>
                </div>
                {imageGenerationProgress.enhancedPrompt && (
                  <div className="text-xs text-slate-400 italic mt-2 border-t border-slate-100 pt-2">
                    "{imageGenerationProgress.enhancedPrompt.substring(0, 140)}{imageGenerationProgress.enhancedPrompt.length > 140 ? '...' : ''}"
                  </div>
                )}
              </div>
            </div>
          )}
          <div className="h-16 md:hidden" />
          <div ref={messagesEndRef} />
          </div>
              </div>

              {isMobile ? (
                <div className={`fixed left-0 right-0 bottom-0 transition-all duration-200 z-50 ${isInputFocused ? 'p-2 bg-white border-t border-slate-200' : 'p-2'}`}>
                  {composerContent}
                </div>
              ) : (
                <div className="hidden shrink-0 border-t border-slate-200/70 bg-white/60 backdrop-blur-sm md:block">
                  <div className="mx-auto w-full max-w-3xl">
                    {composerContent}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {showNewLessonDialog && (
        <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4" onClick={() => setShowNewLessonDialog(false)}>
	          <div className="bg-white rounded-xl shadow-2xl border border-slate-100 p-6 w-full max-w-sm" onClick={e => e.stopPropagation()}>
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-xl bg-violet-100 flex items-center justify-center">
                <BookOpen className="h-5 w-5 text-violet-600" />
              </div>
              <div>
                <h3 className="text-base font-bold text-slate-800">Oggi Imparo</h3>
                <p className="text-xs text-slate-400">Genera una microlezione su un argomento</p>
              </div>
            </div>
            <input
              autoFocus
              type="text"
              value={newLessonTopic}
              onChange={e => setNewLessonTopic(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleGenerateLesson(); if (e.key === 'Escape') setShowNewLessonDialog(false) }}
              placeholder="Es: La fotosintesi, La Seconda Guerra Mondiale..."
              className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-100 mb-4"
            />
            <p className="text-xs text-slate-400 mb-4">Dopo la microlezione potrai aprire il tutor contestualizzato e verificare la comprensione con il chatbot.</p>
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => { setShowNewLessonDialog(false); setNewLessonTopic('') }}
                className="px-4 py-2 text-sm text-slate-500 hover:text-slate-700 transition-colors"
              >
                Annulla
              </button>
              <button
                onClick={handleGenerateLesson}
                disabled={!newLessonTopic.trim() || generatingLesson}
                className="px-4 py-2 text-sm font-semibold bg-slate-900 hover:bg-slate-800 text-white rounded-lg disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-1.5"
              >
                {generatingLesson ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                Genera lezione
              </button>
            </div>
          </div>
        </div>
      )}

      {showVoiceInterrogation && (
        <Suspense fallback={null}>
          <RealtimeInterrogationPanel
            language={uiLanguage}
            accent={{
              accent: accentTheme.accent,
              text: accentTheme.text,
              soft: accentTheme.soft,
              softStrong: accentTheme.softStrong,
              border: accentTheme.border,
            }}
            sessionSource={voiceSource}
            onClose={() => setShowVoiceInterrogation(false)}
            onTurn={(role, text) => {
              setMessages((prev) => [
                ...prev,
                { id: `rt-${role}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, role, content: text, timestamp: new Date() },
              ])
            }}
          />
        </Suspense>
      )}

      {/* Collaboration: participant picker */}
      {sharePickerTarget && (
        <Suspense fallback={null}>
          <ShareWithModal
            target={sharePickerTarget}
            language={uiLanguage}
            accent={{ accent: accentTheme.accent, text: accentTheme.text, soft: accentTheme.soft }}
            seedMessages={messages
              .filter((m) => m.content && m.content.trim() && (m.role === 'user' || m.role === 'assistant'))
              .map((m) => ({ role: m.role, content: m.content }))}
            onClose={() => setSharePickerTarget(null)}
            onCreated={(room) => {
              setSharePickerTarget(null)
              setSharedInvites((prev) => prev.some((r) => r.id === room.id) ? prev : [room, ...prev])
              setActiveSharedRoom(room)
            }}
          />
        </Suspense>
      )}

      {/* Collaboration: invitations / ongoing shared chats banner */}
      {!activeSharedRoom && !sharePickerTarget && sharedInvites.length > 0 && (
        <div className="pointer-events-none fixed bottom-4 right-4 z-50 flex max-w-xs flex-col gap-2">
          {sharedInvites.slice(0, 3).map((room) => (
            <button
              key={room.id}
              type="button"
              onClick={() => setActiveSharedRoom(room)}
              className="pointer-events-auto flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-left shadow-lg transition-transform hover:-translate-y-0.5"
            >
              <span className="flex h-8 w-8 items-center justify-center rounded-full" style={{ backgroundColor: accentTheme.soft, color: accentTheme.text }}>
                <Users className="h-4 w-4" />
              </span>
              <span className="min-w-0">
                <span className="block truncate text-xs font-bold text-slate-800">{room.title}</span>
                <span className="block truncate text-[11px] text-slate-400">
                  {uiLanguage === 'en' ? 'Open shared chat' : 'Apri chat condivisa'} · {room.participants.length}
                </span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function extractBase64Images(content: string): { cleanContent: string; images: string[] } {
  const images: string[] = []
  let cleanContent = content

  const startPattern = /!\[[^\]]*\]\(data:image/g
  let match
  const matches: { start: number, end: number, url: string }[] = []

  while ((match = startPattern.exec(content)) !== null) {
    const urlStart = match.index + match[0].length - 'data:image'.length
    let depth = 1
    let i = match.index + match[0].length
    while (i < content.length && depth > 0) {
      if (content[i] === '(') depth++
      else if (content[i] === ')') depth--
      i++
    }
    if (depth === 0) {
      const url = content.substring(urlStart, i - 1)
      matches.push({ start: match.index, end: i, url })
    }
  }

  for (let i = matches.length - 1; i >= 0; i--) {
    images.unshift(matches[i].url)
    cleanContent = cleanContent.substring(0, matches[i].start) + cleanContent.substring(matches[i].end)
  }

  return { cleanContent: cleanContent.trim(), images }
}

function ActionMenu({ actions, onSelect, darkMode = false }: { actions: any[], onSelect: (value: string) => void, darkMode?: boolean }) {
  return (
    <div className="grid grid-cols-2 gap-2 my-4 animate-in fade-in slide-in-from-bottom-2 duration-300">
      {actions.map((action, idx) => (
        <button
          key={idx}
          onClick={() => onSelect(action.value)}
          className={`flex items-center gap-2 px-3 py-2.5 rounded-xl text-sm font-medium transition-all shadow-sm group border ${
            darkMode 
              ? 'bg-white/10 border-white/20 text-white hover:bg-white/20' 
              : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50 hover:border-slate-300'
          }`}
        >
          <span className="truncate">{action.label}</span>
        </button>
      ))}
    </div>
  )
}

function SessionSelector({ sessions, onSelect, darkMode = false }: { sessions: any[], onSelect: (id: string) => void, darkMode?: boolean }) {
  return (
    <div className={`border rounded-xl overflow-hidden shadow-sm my-4 animate-in fade-in slide-in-from-bottom-2 duration-300 ${
      darkMode ? 'bg-slate-900/50 border-white/10' : 'bg-white border-slate-200'
    }`}>
      <div className={`px-4 py-2 border-b flex items-center justify-between ${
        darkMode ? 'bg-white/5 border-white/10' : 'bg-slate-50 border-slate-200'
      }`}>
        <span className={`text-xs font-bold uppercase tracking-wider ${darkMode ? 'text-slate-300' : 'text-slate-700'}`}>Seleziona Sessione</span>
        <span className="text-[10px] text-slate-400">{sessions.length} sessioni attive</span>
      </div>
      <div className="p-2 grid grid-cols-1 gap-1 max-h-60 overflow-y-auto">
        {sessions.map(s => (
          <button
            key={s.id}
            onClick={() => onSelect(s.id)}
            className={`text-left px-3 py-2.5 rounded-lg border border-transparent transition-all group flex items-center justify-between ${
              darkMode 
                ? 'hover:bg-white/10 hover:text-white' 
                : 'hover:bg-sky-50 hover:text-sky-700 hover:border-sky-200'
            }`}
          >
            <div>
              <div className="text-sm font-semibold">{s.title}</div>
              <div className={`text-[10px] ${darkMode ? 'text-slate-400' : 'text-slate-400'}`}>{s.class_name} • {s.status}</div>
            </div>
            <ChevronRight className="h-4 w-4 text-slate-300 group-hover:translate-x-1 transition-transform" />
          </button>
        ))}
      </div>
    </div>
  )
}

function LearningUnitsBlock({ topic, units, onGenerateQuiz, onGenerateImage }: { topic: string; units: LearningUnit[]; onGenerateQuiz?: (prompt: string) => void; onGenerateImage?: (prompt: string) => void }) {
  const { i18n } = useTranslation()
  const uiLanguage: 'it' | 'en' = i18n.resolvedLanguage?.startsWith('en') ? 'en' : 'it'
  const [openUnitId, setOpenUnitId] = useState<string | null>(units[0]?.id || null)

  return (
    <div className="my-4 space-y-3">
      {units.map((unit, index) => {
        const isOpen = openUnitId === unit.id
        return (
          <div key={unit.id} className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
            <button
              onClick={() => setOpenUnitId(isOpen ? null : unit.id)}
              className="flex w-full items-start justify-between gap-3 px-4 py-4 text-left hover:bg-slate-50 transition-colors"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="inline-flex h-6 min-w-6 items-center justify-center rounded-full bg-sky-100 px-2 text-[11px] font-semibold text-sky-700">
                    {index + 1}
                  </span>
                  <h4 className="text-sm font-semibold text-slate-900">{unit.title}</h4>
                </div>
                <p className="mt-2 text-sm leading-6 text-slate-600">{unit.summary}</p>
              </div>
              <ChevronDown className={`mt-1 h-4 w-4 shrink-0 text-slate-400 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
            </button>

            {isOpen && (
              <div className="border-t border-slate-200 px-4 py-4">
                <div className="rounded-xl bg-slate-50 px-4 py-4">
                  <p className="text-sm leading-7 text-slate-700 whitespace-pre-wrap">{unit.explanation}</p>
                </div>
                {unit.keyPoints.length > 0 && (
                  <div className="mt-4">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">{uiLanguage === 'en' ? 'Key points' : 'Punti chiave'}</p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {unit.keyPoints.map((point) => (
                        <span key={point} className="rounded-full border border-sky-200 bg-sky-50 px-3 py-1 text-xs font-medium text-sky-700">
                          {point}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
                <div className="mt-4 flex flex-wrap justify-end gap-2">
                  <button
                    onClick={() => onGenerateImage?.(buildLearningImagePrompt(topic, unit, uiLanguage))}
                    className="rounded-xl border border-sky-200 bg-sky-50 px-4 py-2 text-sm font-semibold text-sky-700 hover:bg-sky-100 transition-colors"
                  >
                    {uiLanguage === 'en' ? 'Generate image' : 'Genera immagine'}
                  </button>
                  <button
                    onClick={() => onGenerateQuiz?.(buildLearningQuizPrompt(topic, unit, uiLanguage))}
                    className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 transition-colors"
                  >
                    {uiLanguage === 'en' ? 'Generate quiz' : 'Genera quiz'}
                  </button>
                </div>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

function StudentSelector({ students, onSelect, darkMode = false }: { students: any[], onSelect: (selectedIds: string[]) => void, darkMode?: boolean }) {
  const [selected, setSelected] = useState<string[]>([])
  
  const toggle = (id: string) => {
    setSelected(prev => prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id])
  }

  return (
    <div className={`border rounded-xl overflow-hidden shadow-sm my-4 animate-in fade-in slide-in-from-bottom-2 duration-300 ${
      darkMode ? 'bg-slate-900/50 border-white/10' : 'bg-white border-slate-200'
    }`}>
      <div className={`px-4 py-2 border-b flex items-center justify-between ${
        darkMode ? 'bg-white/5 border-white/10' : 'bg-slate-50 border-slate-200'
      }`}>
        <span className={`text-xs font-bold uppercase tracking-wider ${darkMode ? 'text-slate-300' : 'text-slate-700'}`}>Seleziona Studenti</span>
        <span className="text-[10px] text-slate-400">{students.length} studenti</span>
      </div>
      <div className="p-2 grid grid-cols-2 gap-2 max-h-60 overflow-y-auto">
        {students.map(s => (
          <div
            key={s.id}
            onClick={() => toggle(s.id)}
            className={`flex items-center gap-2 p-2 rounded-lg border cursor-pointer transition-all ${
              selected.includes(s.id) 
                ? (darkMode ? 'bg-sky-500/20 border-sky-500/50 text-sky-300' : 'bg-sky-50 border-sky-200 text-sky-700')
                : (darkMode ? 'bg-white/5 border-white/5 text-slate-400 hover:bg-white/10' : 'bg-slate-50 border-slate-100 text-slate-600 hover:bg-slate-100')
            }`}
          >
            <div className={`w-4 h-4 rounded border flex items-center justify-center ${
              selected.includes(s.id) 
                ? (darkMode ? 'bg-sky-500 border-sky-500' : 'bg-sky-500 border-sky-500') 
                : (darkMode ? 'bg-slate-800 border-white/20' : 'bg-white border-slate-300')
            }`}>
              {selected.includes(s.id) && <Check className="h-2.5 w-2.5 text-white" />}
            </div>
            <div className="text-xs font-medium truncate">{s.nickname}</div>
          </div>
        ))}
      </div>
      <div className={`p-3 border-t flex justify-end ${darkMode ? 'bg-white/5 border-white/10' : 'bg-slate-50 border-slate-100'}`}>
        <Button 
          size="sm" 
          disabled={selected.length === 0}
          className={`text-xs ${darkMode ? 'bg-sky-600 hover:bg-sky-700 text-white' : 'bg-sky-600 hover:bg-sky-700 text-white'}`}
          onClick={() => onSelect(selected)}
        >
          Seleziona ({selected.length})
        </Button>
      </div>
    </div>
  )
}

function MessageContent({ content, onQuizSubmit, onInput, darkMode = false }: {
  content: string;
  onQuizSubmit: (answers: string) => void;
  onInput?: (text: string) => void;
  darkMode?: boolean
}) {
  const { t } = useTranslation()
  const { quiz, exercise, csv, learningUnits, textContent, isGenerating, generationType, actionMenu, sessionSelector, studentSelector } = parseContentBlocks(content)
  const { cleanContent, images } = extractBase64Images(textContent)

  if (isGenerating) {
    return (
      <div className="flex flex-col items-center gap-3 py-4">
      <div className={`flex items-center gap-2 ${darkMode ? 'text-white' : 'text-fuchsia-600'}`}>
        <Loader2 className="h-5 w-5 animate-spin" />
        <span className="font-medium">
            {generationType === 'quiz' && 'Generazione quiz in corso...'}
            {generationType === 'image' && 'Generazione immagine in corso...'}
            {generationType === 'csv' && 'Generazione dataset in corso...'}
            {!generationType && 'Elaborazione in corso...'}
          </span>
        </div>
      <div className={`w-full max-w-xs rounded-full h-2 overflow-hidden ${darkMode ? 'bg-white/10' : 'bg-gray-200'}`}>
        <div className={`${darkMode ? 'bg-white/70' : 'bg-fuchsia-500'} h-2 rounded-full animate-pulse`} style={{ width: '60%' }}></div>
      </div>
    </div>
  )
  }

  const downloadCsv = (csvContent: string) => {
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `dataset_${Date.now()}.csv`
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)
  }

  return (
    <div className={`chat-markdown prose max-w-none text-[16px] leading-7 ${darkMode ? 'prose-invert text-white' : 'prose-slate'}`}>
      {cleanContent && (
        <ReactMarkdown
          remarkPlugins={[remarkGfm, remarkMath]}
          rehypePlugins={[rehypeKatex]}
          components={{
            p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
            ...markdownCodeComponents(darkMode),
            ul: ({ children }) => <ul className="list-disc pl-4 mb-2 space-y-1">{children}</ul>,
            ol: ({ children }) => <ol className="list-decimal pl-4 mb-2 space-y-1">{children}</ol>,
            li: ({ children }) => <li className={`${darkMode ? 'text-white' : ''}`}>{children}</li>,
            strong: ({ children }) => <strong className={`font-semibold ${darkMode ? 'text-white' : 'text-slate-800'}`}>{children}</strong>,
            h1: ({ children }) => <h1 className={`text-lg font-bold mb-2 ${darkMode ? 'text-white' : 'text-slate-800'}`}>{children}</h1>,
            h2: ({ children }) => <h2 className={`text-base font-bold mb-2 ${darkMode ? 'text-white' : 'text-slate-800'}`}>{children}</h2>,
            h3: ({ children }) => <h3 className={`text-sm font-bold mb-1 ${darkMode ? 'text-white' : 'text-slate-800'}`}>{children}</h3>,
            blockquote: ({ children }) => <blockquote className={`border-l-4 ${darkMode ? 'border-white/30 text-white/80' : 'border-fuchsia-300 text-slate-600'} pl-3 italic my-2`}>{children}</blockquote>,
            img: ({ src, alt, ...props }) => (
              <div
                className="relative group cursor-grab active:cursor-grabbing my-3 inline-block"
                draggable
                onDragStart={(e) => {
                  const imageData = JSON.stringify({
                    url: src,
                    filename: `chatbot-image-${Date.now()}.png`,
                    type: 'image/png'
                  })
                  e.dataTransfer.setData('text/plain', src || '')
                  e.dataTransfer.setData('application/x-chatbot-image', imageData)
                  e.dataTransfer.effectAllowed = 'copy'
                }}
              >
                <img
                  src={src}
                  alt={alt || 'Immagine generata'}
                  className="max-w-full h-auto rounded-lg shadow-md"
                  {...props}
                />
                <div className="absolute bottom-2 left-2 bg-fuchsia-500/90 text-white text-xs px-2 py-1 rounded opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
                  Trascina nella chat di classe
                </div>
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    if (!src) return
                    const link = document.createElement('a')
                    link.href = src
                    link.download = `immagine_${Date.now()}.png`
                    document.body.appendChild(link)
                    link.click()
                    document.body.removeChild(link)
                  }}
                  className="absolute top-2 right-2 bg-white/90 hover:bg-white p-2 rounded-lg shadow-md opacity-0 group-hover:opacity-100 transition-opacity"
                  title={t('chatbot.download_image')}
                >
                  <Download className="h-4 w-4 text-slate-700" />
                </button>
              </div>
            ),
          }}
        >
          {cleanContent}
        </ReactMarkdown>
      )}
      {images.length > 0 && (
        <div className="my-3 space-y-3">
          {images.map((imgSrc, idx) => (
            <div key={idx} className="relative group cursor-grab active:cursor-grabbing" draggable onDragStart={(e) => {
              const imageData = JSON.stringify({ url: imgSrc, filename: `chatbot-image-${Date.now()}.png`, type: 'image/png' })
              e.dataTransfer.setData('text/plain', imgSrc)
              e.dataTransfer.setData('application/x-chatbot-image', imageData)
              e.dataTransfer.effectAllowed = 'copy'
            }}>
              <img src={imgSrc} alt="Immagine generata" className="max-w-full h-auto rounded-lg shadow-md" style={{ maxHeight: '400px' }} loading="lazy" />
              <div className="absolute bottom-2 left-2 bg-fuchsia-500/90 text-white text-xs px-2 py-1 rounded opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
                Trascina nella chat di classe
              </div>
              <button onClick={() => {
                const link = document.createElement('a')
                link.href = imgSrc
                link.download = `immagine_${Date.now()}.png`
                document.body.appendChild(link)
                link.click()
                document.body.removeChild(link)
              }} className="absolute top-2 right-2 bg-white/90 hover:bg-white p-2 rounded-lg shadow-md opacity-0 group-hover:opacity-100 transition-opacity" title={t('chatbot.download_image')}>
                <Download className="h-4 w-4 text-slate-700" />
              </button>
            </div>
          ))}
        </div>
      )}
      {csv && (
        <div className="mt-3 border border-purple-200 rounded-lg overflow-hidden cursor-grab" draggable onDragStart={(e) => {
          e.dataTransfer.setData('application/x-chatbot-csv', csv)
          e.dataTransfer.effectAllowed = 'copy'
        }}>
          <div className="bg-purple-50 px-3 py-2 flex items-center justify-between">
            <span className="text-sm font-medium text-purple-700 flex items-center gap-2">
              <Database className="h-4 w-4" />
              Dataset CSV ({csv.split('\n').length - 1} righe)
              <span className="text-xs text-purple-400">• Trascinabile</span>
            </span>
            <Button size="sm" variant="outline" className="h-7 text-xs border-purple-300 text-purple-700 hover:bg-purple-100" onClick={() => downloadCsv(csv)}>
              <Download className="h-3 w-3 mr-1" />
              Scarica CSV
            </Button>
          </div>
          <pre className="bg-slate-900 text-slate-100 p-3 text-xs font-mono overflow-x-auto max-h-48">
            {csv.split('\n').slice(0, 10).join('\n')}
            {csv.split('\n').length > 10 && '\n...'}
          </pre>
        </div>
      )}
      {learningUnits && (
        <LearningUnitsBlock
          topic={learningUnits.topic}
          units={learningUnits.units}
          onGenerateQuiz={(prompt) => onInput?.(prompt)}
          onGenerateImage={(prompt) => onInput?.(prompt)}
        />
      )}
      {quiz && (
        <div className="mt-3">
          <InteractiveQuiz quiz={quiz} onSubmitAnswers={onQuizSubmit} />
        </div>
      )}
      {exercise && (
        <div className="mt-3">
          <InteractiveExercise exercise={exercise} />
        </div>
      )}
      {actionMenu && (
        <ActionMenu 
          actions={actionMenu} 
          onSelect={(value) => onInput?.(value)} 
          darkMode={darkMode}
        />
      )}
      {sessionSelector && (
        <SessionSelector 
          sessions={sessionSelector} 
          onSelect={(id) => {
            const session = sessionSelector.find(s => s.id === id);
            onInput?.(`Parlami della sessione: ${session?.title} (${id})`);
          }} 
          darkMode={darkMode}
        />
      )}
      {studentSelector && (
        <StudentSelector 
          students={studentSelector} 
          onSelect={(selectedIds) => {
            const names = studentSelector
              .filter(s => selectedIds.includes(s.id))
              .map(s => s.nickname)
              .join(', ');
            onInput?.(`Analizza questi studenti: ${names}`);
          }} 
          darkMode={darkMode}
        />
      )}
    </div>
  )
}

function InteractiveExercise({ exercise }: { exercise: ExerciseData }) {
  const [showHint, setShowHint] = useState(false)

  const difficultyLabel: Record<string, string> = {
    easy: 'Facile', medium: 'Medio', hard: 'Difficile'
  }
  const difficultyColor: Record<string, string> = {
    easy: 'bg-green-100 text-green-700', medium: 'bg-amber-100 text-amber-700', hard: 'bg-red-100 text-red-700'
  }
  const diff = exercise.difficulty || 'medium'

  return (
    <div className="rounded-xl p-4 border" style={{ backgroundColor: 'rgba(224, 242, 254, 0.72)', borderColor: 'rgba(125, 211, 252, 0.42)' }}>
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-bold text-lg text-sky-800">{exercise.title}</h3>
        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${difficultyColor[diff] || difficultyColor.medium}`}>
          {difficultyLabel[diff] || diff}
        </span>
      </div>
      <p className="text-sm text-slate-600 mb-3">{exercise.description}</p>
      <div className="bg-white rounded-lg p-3 mb-3 shadow-sm">
        <p className="text-xs font-semibold text-sky-700 mb-1 uppercase tracking-wide">Istruzioni</p>
        <div className="text-sm text-slate-700 whitespace-pre-wrap">{exercise.instructions}</div>
      </div>
      {exercise.examples && exercise.examples.length > 0 && (
        <div className="mb-3">
          <p className="text-xs font-semibold text-sky-700 mb-1 uppercase tracking-wide">Esempi</p>
          <ul className="space-y-1">
            {exercise.examples.map((ex, i) => (
              <li key={i} className="text-sm bg-white rounded-lg px-3 py-2 shadow-sm text-slate-700">
                <span className="text-sky-500 font-medium mr-1">{i + 1}.</span>{ex}
              </li>
            ))}
          </ul>
        </div>
      )}
      {exercise.hint && (
        <div>
          <button
            onClick={() => setShowHint(h => !h)}
            className="text-xs text-amber-600 hover:text-amber-700 font-medium underline"
          >
            {showHint ? 'Nascondi suggerimento' : '💡 Mostra suggerimento'}
          </button>
          {showHint && (
            <div className="mt-2 p-3 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-800">
              {exercise.hint}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function parseContentBlocks(content: string): {
  quiz: QuizData | null;
  exercise: ExerciseData | null;
  csv: string | null;
  learningUnits: { topic: string; units: LearningUnit[] } | null;
  textContent: string;
  isGenerating: boolean;
  generationType: string | null;
  sessionSelector: any[] | null;
  studentSelector: any[] | null;
  actionMenu: any[] | null;
} {
  let textContent = content
  let quiz: QuizData | null = null
  let exercise: ExerciseData | null = null
  let csv: string | null = null
  let learningUnits: { topic: string; units: LearningUnit[] } | null = null
  let sessionSelector: any[] | null = null
  let studentSelector: any[] | null = null
  let actionMenu: any[] | null = null
  let isGenerating = false
  let generationType: string | null = null

  const hasIncompleteQuiz = content.includes('```quiz') && !content.includes('```quiz')
    ? false
    : (content.match(/```quiz/g)?.length || 0) > (content.match(/```quiz[\s\S]*?```/g)?.length || 0)
  const hasIncompleteCsv = (content.match(/```csv/g)?.length || 0) > (content.match(/```csv[\s\S]*?```/g)?.length || 0)
  const hasIncompleteJson = content.includes('{"') && !content.includes('"}') && content.length < 500

  const generatingQuizPattern = /genero|creo|preparo.*quiz|sto.*generando.*quiz/i
  const generatingImagePattern = /genero|creo.*immagine|sto.*generando.*immagine|genera.*immagine/i
  const generatingCsvPattern = /genero|creo.*dataset|sto.*generando.*csv|genera.*csv/i

  const hasBase64Image = content.includes('data:image') && content.includes('base64')
  if (hasBase64Image) {
    return { quiz, exercise, csv, learningUnits, textContent, isGenerating: false, generationType: null, actionMenu, sessionSelector, studentSelector }
  }

  if (hasIncompleteQuiz || (generatingQuizPattern.test(content) && content.length < 200)) {
    isGenerating = true
    generationType = 'quiz'
    textContent = textContent.replace(/```quiz[\s\S]*$/, '').replace(/\{[\s\S]*$/, '').trim()
  } else if (hasIncompleteCsv || (generatingCsvPattern.test(content) && content.length < 200)) {
    isGenerating = true
    generationType = 'csv'
    textContent = textContent.replace(/```csv[\s\S]*$/, '').replace(/\{[\s\S]*$/, '').trim()
  } else if (generatingImagePattern.test(content) && content.length < 200) {
    isGenerating = true
    generationType = 'image'
  } else if (hasIncompleteJson) {
    isGenerating = true
    textContent = textContent.replace(/\{[\s\S]*$/, '').trim()
  }

  const quizMatch = content.match(/```quiz\s*([\s\S]*?)```/)
  if (quizMatch) {
    try {
      const parsed = JSON.parse(quizMatch[1].trim())
      if (parsed && Array.isArray(parsed.questions)) {
        quiz = parsed
        textContent = textContent.replace(/```quiz[\s\S]*?```/, '').trim()
        isGenerating = false
      }
    } catch (e) {
      if (quizMatch[1].includes('{')) {
        isGenerating = true
        generationType = 'quiz'
      }
    }
  }

  const csvMatch = content.match(/```csv\s*([\s\S]*?)```/)
  if (csvMatch) {
    csv = csvMatch[1].trim()
    textContent = textContent.replace(/```csv[\s\S]*?```/, '').trim()
    isGenerating = false
  }

  const learningUnitsMatch = content.match(/```learning_units\s*([\s\S]*?)```/)
  if (learningUnitsMatch) {
    try {
      const parsed = JSON.parse(learningUnitsMatch[1].trim())
      if (parsed?.topic && Array.isArray(parsed?.units)) {
        learningUnits = {
          topic: String(parsed.topic),
          units: parsed.units.map((unit: any, index: number) => ({
            id: String(unit?.id || `unit-${index + 1}`),
            title: String(unit?.title || `Unità ${index + 1}`),
            summary: String(unit?.summary || ''),
            explanation: String(unit?.explanation || ''),
            keyPoints: Array.isArray(unit?.keyPoints)
              ? unit.keyPoints.map((point: unknown) => String(point)).filter(Boolean)
              : [],
          })).filter((unit: LearningUnit) => unit.title && unit.explanation),
        }
        textContent = textContent.replace(/```learning_units[\s\S]*?```/, '').trim()
      }
    } catch (e) {
      console.error('Error parsing learning units', e)
    }
  }

  // Extract Action Menu
  const actionMenuMatch = content.match(/```action_menu\s*([\s\S]*?)```/)
  if (actionMenuMatch) {
    try {
      actionMenu = JSON.parse(actionMenuMatch[1].trim())
      textContent = textContent.replace(/```action_menu[\s\S]*?```/, '').trim()
    } catch (e) { console.error("Error parsing action menu", e) }
  }

  // Extract Session Selector
  const sessionMatch = content.match(/```session_selector\s*([\s\S]*?)```/)
  if (sessionMatch) {
    try {
      sessionSelector = JSON.parse(sessionMatch[1].trim())
      textContent = textContent.replace(/```session_selector[\s\S]*?```/, '').trim()
    } catch (e) { console.error("Error parsing session selector", e) }
  }

  // Extract Student Selector
  const studentMatch = content.match(/```student_selector\s*([\s\S]*?)```/)
  if (studentMatch) {
    try {
      studentSelector = JSON.parse(studentMatch[1].trim())
      textContent = textContent.replace(/```student_selector[\s\S]*?```/, '').trim()
    } catch (e) { console.error("Error parsing student selector", e) }
  }

  // Extract Exercise
  const exerciseMatch = content.match(/```exercise_data\s*([\s\S]*?)```/)
  if (exerciseMatch) {
    try {
      const parsed = JSON.parse(exerciseMatch[1].trim())
      if (parsed && parsed.title && parsed.instructions) {
        exercise = parsed
        textContent = textContent.replace(/```exercise_data[\s\S]*?```/, '').trim()
        isGenerating = false
      }
    } catch (e) {
      // partial block — ignore
    }
  }

  textContent = textContent.replace(/```json[\s\S]*?```/g, '').trim()

  return { quiz, exercise, csv, learningUnits, textContent, isGenerating, generationType, actionMenu, sessionSelector, studentSelector }
}

function InteractiveQuiz({ quiz, onSubmitAnswers }: { quiz: QuizData; onSubmitAnswers: (answers: string) => void }) {
  const [answers, setAnswers] = useState<Record<number, number>>({})
  const [submitted, setSubmitted] = useState(false)
  const [showExplanations, setShowExplanations] = useState(false)

  if (!quiz || !quiz.questions || !Array.isArray(quiz.questions)) {
    return null
  }

  const handleSelect = (questionIndex: number, optionIndex: number) => {
    if (submitted) return
    setAnswers(prev => ({ ...prev, [questionIndex]: optionIndex }))
  }

  const handleSubmit = () => {
    setSubmitted(true)
    setShowExplanations(true)

    const answerText = quiz.questions.map((_, idx) => {
      const selected = answers[idx]
      const letter = selected !== undefined ? String.fromCharCode(65 + selected) : '?'
      return `${idx + 1}${letter}`
    }).join(', ')

    onSubmitAnswers(`Le mie risposte: ${answerText}`)
  }

  const score = quiz.questions.reduce((acc, q, idx) => {
    return acc + (answers[idx] === q.correctIndex ? 1 : 0)
  }, 0)

  const allAnswered = quiz.questions.every((_, idx) => answers[idx] !== undefined)

  return (
    <div className="rounded-xl p-4 border" style={{ backgroundColor: 'rgba(250, 232, 255, 0.78)', borderColor: 'rgba(217, 70, 239, 0.22)' }}>
      <h3 className="font-bold text-lg text-fuchsia-800 mb-4 flex items-center gap-2">
        {quiz.title}
      </h3>

      <div className="space-y-4">
        {quiz.questions.map((q, qIndex) => {
          const isCorrect = answers[qIndex] === q.correctIndex
          const hasAnswered = answers[qIndex] !== undefined

          return (
            <div key={qIndex} className="bg-white rounded-lg p-4 shadow-sm">
              <p className="font-medium text-slate-800 mb-3">
                <span className="text-fuchsia-600">{qIndex + 1}.</span> {q.question}
              </p>

              <div className="space-y-2">
                {q.options.map((option, optIndex) => {
                  const isSelected = answers[qIndex] === optIndex
                  const isCorrectOption = q.correctIndex === optIndex

                  let buttonClass = "w-full text-left px-4 py-2 rounded-lg border transition-all text-sm "

                  if (submitted) {
                    if (isCorrectOption) {
                      buttonClass += "bg-green-100 border-green-400 text-green-800"
                    } else if (isSelected && !isCorrectOption) {
                      buttonClass += "bg-red-100 border-red-400 text-red-800"
                    } else {
                      buttonClass += "bg-slate-50 border-slate-200 text-slate-500"
                    }
                  } else if (isSelected) {
                    buttonClass += "bg-fuchsia-100 border-fuchsia-400 text-fuchsia-800"
                  } else {
                    buttonClass += "bg-white border-slate-200 hover:border-fuchsia-300 hover:bg-fuchsia-50"
                  }

                  return (
                    <button key={optIndex} onClick={() => handleSelect(qIndex, optIndex)} disabled={submitted} className={buttonClass}>
                      <span className="font-medium mr-2">{String.fromCharCode(65 + optIndex)})</span>
                      {option}
                      {submitted && isCorrectOption && <span className="ml-2 text-green-600 font-bold">[Corretto]</span>}
                      {submitted && isSelected && !isCorrectOption && <span className="ml-2 text-red-600 font-bold">[Errato]</span>}
                    </button>
                  )
                })}
              </div>

              {showExplanations && hasAnswered && (
                <div className={`mt-3 p-3 rounded-lg text-sm ${isCorrect ? 'bg-green-50 text-green-800' : 'bg-amber-50 text-amber-800'}`}>
                  <strong>{isCorrect ? 'Corretto!' : 'Spiegazione:'}</strong> {q.explanation}
                </div>
              )}
            </div>
          )
        })}
      </div>

      {!submitted ? (
        <button
          onClick={handleSubmit}
          disabled={!allAnswered}
          className={`mt-4 w-full py-3 rounded-xl font-medium transition-all ${allAnswered
            ? 'text-white shadow-sm'
            : 'bg-slate-200 text-slate-400 cursor-not-allowed'
            }`}
          style={allAnswered ? { backgroundColor: '#c026d3' } : undefined}
        >
          {allAnswered ? 'Verifica Risposte' : `Rispondi a tutte le domande (${Object.keys(answers).length}/${quiz.questions.length})`}
        </button>
      ) : (
        <div className="mt-4 p-4 bg-white rounded-xl shadow-sm text-center">
          <p className="text-2xl font-bold text-fuchsia-800">
            {score}/{quiz.questions.length}
          </p>
          <p className="text-slate-600">
            {score === quiz.questions.length ? 'Perfetto!' : score >= quiz.questions.length / 2 ? 'Buon lavoro!' : 'Continua a studiare!'}
          </p>
        </div>
      )}
    </div>
  )
}
