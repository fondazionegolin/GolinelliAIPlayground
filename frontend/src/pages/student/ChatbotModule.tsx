import { useState, useRef, useEffect, useCallback, useMemo, type CSSProperties } from 'react'
import { useTranslation } from 'react-i18next'
import { useMutation, useQuery } from '@tanstack/react-query'
import { motion } from 'framer-motion'
import { llmApi, studentApi, teacherbotsApi } from '@/lib/api'
import DataFileCard, { type DataFilePreview } from '@/components/DataFileCard'
import { Button } from '@/components/ui/button'
import {
  Send, Bot, User, GraduationCap, BookOpen, Plus,
  Lightbulb, ClipboardCheck, Sparkles,
  Paperclip, X, File, Database, Download, Loader2,
  Trash2, ChevronLeft, ChevronRight, Wand2, Palette, ChevronDown, Check, ImageIcon,
  FlaskConical, ScrollText, Languages, Landmark, Sigma, Microscope, BookText, type LucideIcon
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
import EnvironmentalImpactPill from '@/components/chat/EnvironmentalImpactPill'

interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: Date
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
}

const PROFILE_ICONS: Record<string, React.ReactNode> = {
  'tutor': <GraduationCap className="h-6 w-6" />,
  'quiz': <ClipboardCheck className="h-6 w-6" />,
  'interview': <Bot className="h-6 w-6" />,
  'oral_exam': <User className="h-6 w-6" />,
  'dataset_generator': <Database className="h-6 w-6" />,
  'math_coach': <Lightbulb className="h-6 w-6" />,
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
}

interface AttachedFile {
  file: globalThis.File
  preview?: string
  type: 'image' | 'document' | 'data'
  dataPreview?: DataFilePreview
}

const LEARNING_IMAGE_PREFIX = '__GENERATE_LEARNING_IMAGE__::'

function hexToRgba(hex: string, opacity: number) {
  const normalized = hex.replace('#', '')
  const full = normalized.length === 3
    ? normalized.split('').map((char) => char + char).join('')
    : normalized
  const bigint = parseInt(full, 16)
  const r = (bigint >> 16) & 255
  const g = (bigint >> 8) & 255
  const b = bigint & 255
  return `rgba(${r}, ${g}, ${b}, ${opacity})`
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

function buildLearningUnitsMessage(topic: string, lesson: string, units: LearningUnit[]) {
  return [
    `📖 **Percorso: ${topic}**`,
    '',
    lesson,
    '',
    'Apri le unità qui sotto: ogni blocco approfondisce solo ciò che è stato trattato e può generare un quiz mirato.',
    '',
    '```learning_units',
    JSON.stringify({ topic, units }, null, 2),
    '```',
  ].join('\n')
}

function buildLearningQuizPrompt(topic: string, unit: LearningUnit) {
  const source = [
    `Titolo unità: ${unit.title}`,
    `Sintesi: ${unit.summary}`,
    `Spiegazione: ${unit.explanation}`,
    unit.keyPoints.length > 0 ? `Punti chiave:\n- ${unit.keyPoints.join('\n- ')}` : '',
  ].filter(Boolean).join('\n')

  return [
    `Genera un quiz SOLO sull'unità di apprendimento seguente del percorso "${topic}".`,
    'Non introdurre argomenti, termini o esempi non presenti nel testo sorgente.',
    'Crea esattamente 4 domande a scelta multipla in italiano, con 4 opzioni ciascuna, una sola corretta.',
    'Per ogni domanda aggiungi una breve spiegazione della risposta corretta.',
    'Rispondi esclusivamente con un blocco ```quiz contenente JSON valido compatibile con l’interfaccia.',
    '',
    'TESTO SORGENTE VINCOLANTE:',
    source,
  ].join('\n')
}

function buildLearningImagePrompt(topic: string, unit: LearningUnit) {
  const source = [
    `Titolo unità: ${unit.title}`,
    `Sintesi: ${unit.summary}`,
    `Spiegazione: ${unit.explanation}`,
    unit.keyPoints.length > 0 ? `Punti chiave:\n- ${unit.keyPoints.join('\n- ')}` : '',
  ].filter(Boolean).join('\n')

  return `${LEARNING_IMAGE_PREFIX}${[
    `Crea un'illustrazione didattica ispirata SOLO a questa unità del percorso "${topic}".`,
    'L’immagine deve aiutare a spiegare il concetto in modo chiaro, visivo, scolastico e concreto.',
    'Privilegia diagrammi, relazioni spaziali, elementi etichettabili, scene esplicative e composizione pulita.',
    'Non introdurre contenuti o dettagli non presenti nel testo sorgente.',
    'Stile: educational infographic, clean glossy pastel, high clarity, minimal visual noise.',
    '',
    'TESTO SORGENTE VINCOLANTE:',
    source,
  ].join('\n')}`
}

function getSidebarMenuTheme(key: 'assistants' | 'teacherbots' | 'learning') {
  if (key === 'assistants') {
    return {
      surface: 'rgba(186, 230, 253, 0.34)',
      surfaceStrong: 'rgba(125, 211, 252, 0.24)',
      iconBg: 'rgba(14,165,233,0.14)',
      iconColor: '#0369a1',
    }
  }
  if (key === 'teacherbots') {
    return {
      surface: 'rgba(221, 214, 254, 0.4)',
      surfaceStrong: 'rgba(196, 181, 253, 0.28)',
      iconBg: 'rgba(139,92,246,0.14)',
      iconColor: '#6d28d9',
    }
  }
  return {
    surface: 'rgba(254, 215, 170, 0.42)',
    surfaceStrong: 'rgba(253, 186, 116, 0.28)',
    iconBg: 'rgba(249,115,22,0.14)',
    iconColor: '#c2410c',
  }
}

type TeacherbotVisual = {
  Icon: LucideIcon
  label: string
  detail: string
}

function getTeacherbotVisual(bot: Teacherbot): TeacherbotVisual {
  const source = `${bot.name} ${bot.synopsis} ${bot.description}`.toLowerCase()

  if (/(mat|alge|geometr|calcol|equaz|statistic)/.test(source)) {
    return { Icon: Sigma, label: 'Area matematica', detail: 'Esercizi, metodo e passaggi guidati' }
  }
  if (/(scienz|chim|fisic|biolog|lab|esperiment)/.test(source)) {
    return { Icon: FlaskConical, label: 'Area scientifica', detail: 'Concetti, esperimenti e fenomeni' }
  }
  if (/(stori|filosof|diritt|societ|politic|civica)/.test(source)) {
    return { Icon: Landmark, label: 'Area storico-sociale', detail: 'Contesto, interpretazione e collegamenti' }
  }
  if (/(ingles|frances|spagnol|tedesc|lingu|traduz)/.test(source)) {
    return { Icon: Languages, label: 'Area linguistica', detail: 'Comprensione, lessico e produzione' }
  }
  if (/(tema|scritt|letter|analisi|testo|narrativ)/.test(source)) {
    return { Icon: ScrollText, label: 'Area testuale', detail: 'Analisi, sintesi e scrittura' }
  }
  if (/(ricerc|metod|studio|tesi|fonte|document)/.test(source)) {
    return { Icon: BookText, label: 'Metodo di studio', detail: 'Fonti, organizzazione e approfondimento' }
  }
  if (/(tecnolog|coding|informat|programmaz|ai|dato)/.test(source)) {
    return { Icon: Microscope, label: 'Area tecnico-digitale', detail: 'Procedure, strumenti e problem solving' }
  }

  return { Icon: Wand2, label: 'Assistente personalizzato', detail: 'Supporto dedicato creato dal docente' }
}

function getTeacherbotSurface(color: string) {
  const themeMap: Record<string, { soft: string; border: string; icon: string; badge: string }> = {
    indigo: { soft: 'bg-indigo-50', border: 'border-indigo-200/70', icon: 'bg-indigo-100 text-indigo-700', badge: 'bg-indigo-100 text-indigo-700' },
    blue: { soft: 'bg-blue-50', border: 'border-blue-200/70', icon: 'bg-blue-100 text-blue-700', badge: 'bg-blue-100 text-blue-700' },
    green: { soft: 'bg-emerald-50', border: 'border-emerald-200/70', icon: 'bg-emerald-100 text-emerald-700', badge: 'bg-emerald-100 text-emerald-700' },
    red: { soft: 'bg-rose-50', border: 'border-rose-200/70', icon: 'bg-rose-100 text-rose-700', badge: 'bg-rose-100 text-rose-700' },
    purple: { soft: 'bg-violet-50', border: 'border-violet-200/70', icon: 'bg-violet-100 text-violet-700', badge: 'bg-violet-100 text-violet-700' },
    pink: { soft: 'bg-pink-50', border: 'border-pink-200/70', icon: 'bg-pink-100 text-pink-700', badge: 'bg-pink-100 text-pink-700' },
    orange: { soft: 'bg-amber-50', border: 'border-amber-200/70', icon: 'bg-amber-100 text-amber-700', badge: 'bg-amber-100 text-amber-700' },
    teal: { soft: 'bg-teal-50', border: 'border-teal-200/70', icon: 'bg-teal-100 text-teal-700', badge: 'bg-teal-100 text-teal-700' },
    cyan: { soft: 'bg-cyan-50', border: 'border-cyan-200/70', icon: 'bg-cyan-100 text-cyan-700', badge: 'bg-cyan-100 text-cyan-700' },
  }

  return themeMap[color] || themeMap.indigo
}

// Mobile navigation state
type MobileViewState = 'profiles' | 'conversations' | 'chat'

export default function ChatbotModule({ sessionId, studentId, initialTeacherbotId, oggiImparoContext, onOggiImparoContextConsumed, onInputFocusChange, isTeacherPreview, studentAccent: accentProp }: ChatbotModuleProps) {
  const { t } = useTranslation()
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
  const [imageProvider, setImageProvider] = useState<'dall-e' | 'gpt-image-1'>('dall-e')
  const messagesContainerRef = useRef<HTMLDivElement>(null)
  const [imageSize, setImageSize] = useState<string>('1024x1024')
  const [imageMode, setImageMode] = useState(false)
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
  const [mainTab, setMainTab] = useState<'assistants' | 'teacherbots' | 'learning'>('assistants')
  const [learningSessions, setLearningSessions] = useState<LearningSession[]>([])
  const [activeLearningSession, setActiveLearningSession] = useState<LearningSession | null>(null)
  const [learningMode, setLearningMode] = useState(false)
  const [showNewLessonDialog, setShowNewLessonDialog] = useState(false)
  const [newLessonTopic, setNewLessonTopic] = useState('')
  const [generatingLesson, setGeneratingLesson] = useState(false)
  const [expandingLearningSessionId, setExpandingLearningSessionId] = useState<string | null>(null)
  const activeLearningSessionRef = useRef<string | null>(null)
  const [defaultModelKey, setDefaultModelKey] = useState(localStorage.getItem('student_default_model') || '')
  const [isStreaming, setIsStreaming] = useState(false)
  const [streamingStatus, setStreamingStatus] = useState<string | null>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const modelMenuRef = useRef<HTMLDivElement>(null)
  const isGeneratingRef = useRef(false)
  const inputRef = useRef<HTMLInputElement>(null)
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
    backgroundColor: `${accentTheme.accent}15`,
    color: accentTheme.text,
    borderColor: `${accentTheme.accent}40`,
    backdropFilter: 'blur(8px)',
  }) as CSSProperties, [accentTheme])
  const selectedSolidStyle = useMemo(() => ({
    backgroundColor: accentTheme.accent,
    color: '#ffffff',
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
        `Espandi questa microlezione in piccole unità di apprendimento chiare, progressive e non ridondanti.`,
        `Argomento: "${session.topic}"`,
        `Microlezione di partenza: "${session.lesson}"`,
        '',
        'Rispondi SOLO con JSON valido nel formato:',
        '{',
        '  "units": [',
        '    {',
        '      "title": "stringa breve",',
        '      "summary": "1 frase breve",',
        '      "explanation": "spiegazione completa ma compatta, 80-160 parole",',
        '      "keyPoints": ["punto 1", "punto 2", "punto 3"]',
        '    }',
        '  ]',
        '}',
        '',
        'Regole:',
        '- crea da 3 a 5 unità',
        '- ogni unità deve trattare solo contenuti realmente coerenti con la microlezione iniziale',
        '- non introdurre argomenti esterni o avanzati non necessari',
        '- usa italiano chiaro e didattico',
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
  }, [learningSessions])

  async function openLearningSession(session: LearningSession) {
    setMainTab('learning')
    const expandedSession = await expandLearningSession(session)
    setActiveLearningSession(expandedSession)
    activeLearningSessionRef.current = session.id
    setLearningMode(true)
    setSelectedTeacherbot(null)
    setSelectedProfile('tutor')
    setActiveMasterPrompt(
      `Sei un tutor educativo dedicato. Il tema di studio è: "${expandedSession.topic}". La micro-lezione di base è: "${expandedSession.lesson}". Le unità di apprendimento già spiegate sono: ${normalizeLearningUnits(expandedSession.units, expandedSession.topic, expandedSession.lesson).map((unit) => `"${unit.title}: ${unit.explanation}"`).join(' | ')}. Aiuta lo studente in italiano con esempi pratici e domande stimolanti. Quando generi quiz, usa soltanto i contenuti realmente spiegati nelle unità già mostrate. Se lo studente carica documenti, analizzali nel contesto del tema.`
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
          normalizeLearningUnits(expandedSession.units, expandedSession.topic, expandedSession.lesson)
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
        description: fallback.description,
        suggested_prompts: fallback.suggested_prompts,
      }
    })
  }, [profilesData])

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

  const runStudentStreamRequest = useCallback(async (convId: string, content: string) => {
    const studentToken = localStorage.getItem('student_token')
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
        body: JSON.stringify({ content }),
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
              if (data.content) {
                setMessages(prev => prev.map(m =>
                  m.id === assistantId ? { ...m, content: data.content } : m
                ))
              }
            } else if (data.type === 'error') {
              throw new Error(data.message || 'Errore stream')
            }
          }
        }
      }
    } catch (err) {
      console.error('Student stream error:', err)
      setMessages(prev => prev.map(m =>
        m.id === assistantId
          ? { ...m, content: `Mi dispiace, si è verificato un errore durante la generazione della risposta.` }
          : m
      ))
    } finally {
      setIsStreaming(false)
      setStreamingStatus(null)
      refetchConversations()
      setTimeout(() => inputRef.current?.focus(), 0)
    }
  }, [refetchConversations, inputRef])

  const currentProfile = profiles.find(p => p.key === selectedProfile)
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

  const sendMessageMutation = useMutation({
    mutationFn: async ({ content, files, existingHistory }: { content: string; files: globalThis.File[]; existingHistory?: Message[] }) => {
      // TEACHERBOT MODE
      if (selectedTeacherbot) {
        // Teacher preview: use the test endpoint (no student session needed)
        if (isTeacherPreview) {
          const history = messages.map(m => ({ role: m.role, content: m.content }))
          const res = await teacherbotsApi.test(selectedTeacherbot.id, content, history)
          return { content: res.data.content, id: Date.now().toString() }
        }

        let convId = teacherbotConversationId
        if (!convId) {
          const convRes = await teacherbotsApi.startConversation(selectedTeacherbot.id, sessionId)
          convId = convRes.data.id
          setTeacherbotConversationId(convId)
        }

        if (files.length > 0) {
          const res = await teacherbotsApi.sendMessageWithFiles(convId!, content, files)
          return res.data
        }

        const res = await teacherbotsApi.sendMessage(convId!, content)
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
          modelName
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
            await llmApi.sendMessage(convId!, msg.content, undefined, undefined, undefined)
          }
        }
      }

      if (files.length > 0) {
        const res = await llmApi.sendMessageWithFiles(convId!, content, files)
        return res.data
      }

      const res = await llmApi.sendMessage(convId!, content, imageProvider, imageSize, verboseMode)
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
      }
      setMessages((prev) => [...prev, assistantMessage])
      setAttachedFiles([])

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
  })

  const handleImageGeneration = useCallback(async (messageContent: string) => {
    const userMessage: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: messageContent,
      timestamp: new Date(),
    }
    setMessages(prev => [...prev, userMessage])
    setInput('')

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
      const expansionRes = await llmApi.studentChat(expansionPrompt, history, 'tutor', 'openai', 'gpt-5-mini')
      const enhancedPrompt = expansionRes.data?.response?.trim() || messageContent

      setImageGenerationProgress({ status: 'Generazione immagine in corso...', step: 'generating', enhancedPrompt })

      const genRes = await llmApi.generateImage(enhancedPrompt, imageProvider)
      const imageUrl = genRes.data?.image_url

      setImageGenerationProgress(null)

      if (imageUrl) {
        const assistantMessage: Message = {
          id: `img-${Date.now()}`,
          role: 'assistant',
          content: `**Immagine Generata**\n\n![Generata](${imageUrl})\n\n**Prompt:** \`${enhancedPrompt}\``,
          timestamp: new Date(),
        }
        setMessages(prev => [...prev, assistantMessage])
      } else {
        throw new Error('Nessuna immagine ricevuta dal server')
      }
    } catch (err: any) {
      setImageGenerationProgress(null)
      const errMessage: Message = {
        id: `err-${Date.now()}`,
        role: 'assistant',
        content: `Mi dispiace, si è verificato un errore nella generazione: ${err.response?.data?.detail || err.message}`,
        timestamp: new Date(),
      }
      setMessages(prev => [...prev, errMessage])
    }
  }, [messages, imageProvider])

  const handleSend = useCallback((content?: string, files?: globalThis.File[]) => {
    const messageContent = content ?? input
    const messageFiles = files ?? attachedFiles.map(af => af.file)

    if ((!messageContent.trim() && messageFiles.length === 0) || sendMessageMutation.isPending || isStreaming) return

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
          content: 'Perfetto, ho raccolto le informazioni principali. Da ora usero queste indicazioni per guidare il chatbot in modo personalizzato. Scrivi la tua prima richiesta quando vuoi.',
          timestamp: new Date(),
        }
        setMessages((prev) => [...prev, assistantMessage])
      }

      setInput('')
      return
    }

    // IMAGE GENERATION MODE — intercept before normal flow
    if (imageMode && !selectedTeacherbot && !profileInterview.active) {
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
      contentForApi = `CONTESTO DIDATTICO DA APPLICARE:\n${activeMasterPrompt}\n\nRichiesta studente:\n${rawUserContent}`
      setIsMasterPromptApplied(true)
    }

    const userMessage: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: (rawUserContent || 'Analizza questi documenti') + filesInfo,
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
    conversationId,
    messages,
    profileInterview,
    buildMasterPrompt,
    selectedTeacherbot,
    activeMasterPrompt,
    isMasterPromptApplied,
    isStreaming,
    isTeacherPreview,
    runStudentStreamRequest,
    imageMode,
    handleImageGeneration,
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
    if (PROACTIVE_PROFILE_KEYS.includes(profileKey as ProactiveProfileKey)) {
      startProfileInterview(profileKey as ProactiveProfileKey)
      if (isMobile) {
        setMobileView('chat')
      }
    }
  }, [isMobile, teacherbotConversationId, resetProfileInterview, startProfileInterview])

  const handleStartNewConversation = useCallback(() => {
    triggerHaptic('light')
    setMessages([])
    setConversationId(null)
    setTeacherbotConversationId(null)
    setActiveMasterPrompt(null)
    setIsMasterPromptApplied(false)
    resetProfileInterview()
    if (isMobile) {
      setMobileView('chat')
    }
  }, [isMobile, resetProfileInterview])

  const handleGenerateLesson = async () => {
    if (!newLessonTopic.trim() || generatingLesson) return
    setGeneratingLesson(true)
    const prompt = `Genera una microlezione educativa breve in italiano sull'argomento: "${newLessonTopic.trim()}". La microlezione deve essere un fatto interessante, un concetto chiave o una curiosità stimolante per studenti delle scuole superiori o universitari. MASSIMO 400 caratteri. Rispondi SOLO con il testo della microlezione, senza titoli né introduzioni.`
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

  const loadConversation = async (convId: string, isTeacherbotMsg = false) => {
    loadingConvIdRef.current = convId
    setConversationId(convId)
    setMessages([])  // Clear immediately so old messages don't bleed into the new view
    // Determine if it's a teacherbot conversation from the list
    const tbConv = teacherbotConversationsData?.find(c => c.id === convId)
    const isTeacherbot = isTeacherbotMsg || !!tbConv

    if (isTeacherbot && tbConv) {
      setTeacherbotConversationId(convId)
      const bot = availableTeacherbots.find(b => b.id === tbConv.teacherbot_id)
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
          timestamp: new Date(m.created_at)
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
      const serverMessages: Message[] = res.data.map((m: { id: string; role: string; content: string; created_at: string }) => ({
        id: m.id,
        role: m.role as 'user' | 'assistant',
        content: m.content,
        timestamp: new Date(m.created_at),
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
              normalizeLearningUnits(learningSession.units, learningSession.topic, learningSession.lesson)
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
    setMainTab('teacherbots')
    setTeacherbotConversationId(null)
    setSelectedProfile(null)
    setConversationId(null)
    setActiveMasterPrompt(null)
    setIsMasterPromptApplied(false)
    resetProfileInterview()

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
  }, [isMobile, teacherbotConversationId, resetProfileInterview])

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
  const availableTeacherbots = teacherbotsData || []
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
    if (!initialTeacherbotId || availableTeacherbots.length === 0) return
    if (selectedTeacherbot?.id === initialTeacherbotId) return
    if (lastAppliedTeacherbotIdRef.current === initialTeacherbotId) return

    const bot = availableTeacherbots.find(b => b.id === initialTeacherbotId)
    if (bot) {
      lastAppliedTeacherbotIdRef.current = initialTeacherbotId
      handleSelectTeacherbot(bot)
    }
  }, [initialTeacherbotId, availableTeacherbots, selectedTeacherbot, handleSelectTeacherbot])

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
    return (
      <div className="h-full flex flex-col overflow-hidden" style={{ backgroundColor: '#f8fafc' }}>
        {/* Tab nav */}
        <div className="flex items-center gap-1 px-3 pt-3 pb-2 flex-shrink-0 overflow-x-auto scrollbar-none">
          {([
            { key: 'assistants' as const, label: 'Assistenti AI', icon: <Bot className="h-3 w-3" /> },
            { key: 'teacherbots' as const, label: 'Teacherbots', icon: <Wand2 className="h-3 w-3" />, badge: availableTeacherbots.length },
            { key: 'learning' as const, label: 'Oggi Imparo', icon: <BookOpen className="h-3 w-3" />, badge: learningSessions.length },
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
                className="w-full relative overflow-hidden rounded-2xl border p-4 text-left shadow-sm"
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
                    className="relative overflow-hidden rounded-2xl border p-3 text-left shadow-sm"
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
                    className={`w-full relative overflow-hidden rounded-2xl border text-left shadow-sm ${idx === 0 ? 'p-4' : 'p-3'}`}
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

          {/* Mobile: Oggi Imparo */}
          {mainTab === 'learning' && (
            <div className="space-y-2">
              <motion.button whileTap={{ scale: 0.98 }} onClick={() => setShowNewLessonDialog(true)}
                className="w-full relative overflow-hidden rounded-2xl border p-4 text-left shadow-sm"
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
                  className="p-3 rounded-2xl bg-white border border-slate-100 cursor-pointer shadow-sm group"
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
        </div>

        {/* New lesson dialog */}
        {showNewLessonDialog && (
          <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-end justify-center" onClick={() => setShowNewLessonDialog(false)}>
            <div className="bg-white rounded-t-3xl p-6 w-full max-w-lg" onClick={e => e.stopPropagation()}>
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
                  className="px-4 py-2 text-sm font-semibold bg-violet-600 text-white rounded-xl disabled:opacity-50 flex items-center gap-1.5"
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
        isLoading={sendMessageMutation.isPending || isStreaming}
        suggestedPrompts={[]}
        isTeacherbot={true}
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
        messages={messages}
        onSend={handleSend}
        onBack={() => {
          triggerHaptic('light')
          setMobileView('conversations')
        }}
        isLoading={sendMessageMutation.isPending || isStreaming}
        suggestedPrompts={currentProfile?.suggested_prompts}
      />
    )
  }

  const isDesktopSelection = !selectedProfile && !selectedTeacherbot && !learningMode
  const profileUsageCounts = (conversationsData || []).reduce<Record<string, number>>((acc, c) => {
    acc[c.profile_key] = (acc[c.profile_key] || 0) + 1
    return acc
  }, {})
  const topProfiles = Object.entries(profileUsageCounts).sort((a, b) => b[1] - a[1]).slice(0, 4)
  const maxUsage = Math.max(1, ...topProfiles.map(([, count]) => count))
  const learningTopics = [...new Set(learningSessions.map((session) => session.topic).filter(Boolean))]
  const openDesktopSection = (tab: 'assistants' | 'teacherbots' | 'learning') => {
    setMainTab(tab)
    if (!isDesktopSelection) {
      void handleNewChat()
    }
  }
  const composerContent = (
    <>
      {attachedFiles.length > 0 && (
        <div className="flex gap-1 mb-1 flex-wrap bg-white/90 backdrop-blur-sm rounded-t-xl p-2 border border-b-0 border-slate-200 md:border-0 md:rounded-none md:bg-transparent md:p-0 md:mb-3">
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

      <div className="p-2 md:p-3 bg-white/95 backdrop-blur-sm md:bg-transparent">
        <div
          className="relative flex items-end gap-2 bg-white border-2 rounded-[2rem] p-1.5 pl-3 transition-all shadow-sm"
          style={{ borderColor: accentTheme.border, boxShadow: `0 0 0 0 ${accentTheme.accent}` }}
        >
          <input type="file" ref={fileInputRef} className="hidden" multiple
            accept="image/*,.pdf,.doc,.docx,.ppt,.pptx,.txt,.csv,.xlsx,.xls,.json"
            onChange={(e) => {
              const files = Array.from(e.target.files || [])
              files.forEach(file => addFileWithPreview(file))
              e.target.value = ''
            }}
          />

          <VoiceRecorder
            onInsertText={(text) => {
              setInput(text)
              setTimeout(() => inputRef.current?.focus(), 50)
            }}
          />

          <Button
            variant="ghost" size="icon" className="h-9 w-9 text-slate-400 hover:bg-slate-100 rounded-full flex-shrink-0"
            style={{ color: 'inherit' }}
            onClick={() => fileInputRef.current?.click()}
          >
            <Paperclip className="h-5 w-5" />
          </Button>

          <Button
            variant="ghost" size="icon"
            className={`h-9 w-9 rounded-full flex-shrink-0 transition-all ${imageMode ? 'bg-fuchsia-50 text-fuchsia-600' : 'text-slate-400 hover:bg-slate-100'}`}
            onClick={() => setImageMode(v => !v)}
            title={imageMode ? 'Disattiva modalità immagini' : 'Attiva modalità immagini'}
          >
            <ImageIcon className="h-5 w-5" />
          </Button>

          <div className="flex-1 relative min-w-0">
            <input
              ref={inputRef}
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
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
              placeholder={profileInterview.active ? t('chatbot.guided_placeholder') : (imageMode ? 'Descrivi l\'immagine da generare...' : (attachedFiles.length > 0 ? t('chatbot.describe_placeholder') : 'Scrivi un messaggio...'))}
              disabled={sendMessageMutation.isPending || isStreaming}
              className="w-full py-2.5 bg-transparent border-none text-sm focus:ring-0 focus:outline-none outline-none placeholder:text-slate-400"
            />
          </div>

          <Button
            onClick={() => handleSend()}
            disabled={(!input.trim() && attachedFiles.length === 0) || sendMessageMutation.isPending || isStreaming}
            size="icon"
            className={`h-9 w-9 rounded-full transition-all flex-shrink-0 ${(!input.trim() && attachedFiles.length === 0) ? 'bg-slate-200 text-slate-400' : 'hover:scale-105 shadow-md text-white'}`}
            style={(!input.trim() && attachedFiles.length === 0) ? undefined : selectedSolidStyle}
          >
            <Send className="h-4 w-4 ml-0.5" />
          </Button>
        </div>
      </div>

      {imageMode && (
        <div className="flex items-center justify-center gap-4 mt-2 pb-3 flex-wrap animate-in fade-in slide-in-from-bottom-1 duration-150">
          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-400">Modello:</span>
            <div className="flex items-center bg-slate-100 rounded-lg p-0.5">
              {([
                { id: 'dall-e' as const, label: 'DALL-E 3' },
                { id: 'gpt-image-1' as const, label: 'GPT Image 1' },
              ]).map((m) => (
                <button
                  key={m.id}
                  onClick={() => setImageProvider(m.id)}
                  className={`px-2 py-1 text-[10px] rounded-md transition-all ${imageProvider === m.id ? 'bg-white shadow text-fuchsia-600 font-bold' : 'text-slate-500 hover:text-slate-700'}`}
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
              className="text-xs bg-slate-100 border-0 rounded-lg px-2 py-1 text-slate-600 focus:ring-1 focus:ring-fuchsia-300"
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
      className="relative flex h-full min-h-0 w-full md:rounded-[30px] overflow-hidden md:shadow-lg md:border"
      style={{
        ...accentVars,
        backgroundColor: accentTheme.soft,
        borderColor: accentTheme.id === 'black' ? hexToRgba('#0f172a', 0.08) : hexToRgba(accentTheme.accent, 0.18),
      }}
    >
      <aside
        className="hidden md:flex w-[24.5rem] shrink-0 border-r bg-white/88 backdrop-blur-xl flex-col"
        style={{ borderRightColor: accentTheme.id === 'black' ? hexToRgba('#0f172a', 0.08) : hexToRgba(accentTheme.accent, 0.14) }}
      >
        <div
          className="px-10 py-10 border-b"
          style={{
            borderBottomColor: accentTheme.id === 'black' ? hexToRgba('#0f172a', 0.08) : hexToRgba(accentTheme.accent, 0.14),
            backgroundColor: accentTheme.id === 'black' ? 'rgba(255,255,255,0.96)' : hexToRgba(accentTheme.accent, 0.08),
          }}
        >
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em]" style={{ color: accentTheme.text }}>Chatbot</p>
          <h2 className="mt-2 text-xl font-semibold text-slate-900">Spazio AI studente</h2>
          <p className="mt-1 text-sm leading-6 text-slate-600">Navigazione stabile, superfici più morbide e colori pastello coerenti con il pannello studente.</p>
        </div>

        <nav className="px-10 py-8 space-y-4">
          {[
            { key: 'assistants' as const, label: 'Assistenti AI', icon: Bot, badge: profiles.length, note: 'Tutor, quiz e strumenti di studio' },
            { key: 'teacherbots' as const, label: 'Teacherbot', icon: Wand2, badge: availableTeacherbots.length, note: 'Assistenti coordinati dal docente' },
            { key: 'learning' as const, label: 'Oggi Imparo', icon: BookOpen, badge: learningSessions.length, note: 'Microlezioni e ripasso strutturato' },
          ].map(({ key, label, icon: Icon, badge, note }) => {
            const active = mainTab === key
            const menuTheme = getSidebarMenuTheme(key)
            return (
              <button
                key={key}
                onClick={() => openDesktopSection(key)}
                className={`w-full rounded-[24px] border px-5 py-4 text-left transition-all ${
                  active ? 'shadow-sm' : 'hover:shadow-sm'
                }`}
                style={active ? {
                  borderColor: accentTheme.id === 'black' ? hexToRgba('#ffffff', 0.12) : hexToRgba(accentTheme.accent, 0.16),
                  backgroundColor: menuTheme.surface,
                } : {
                  borderColor: hexToRgba('#ffffff', 0),
                  backgroundColor: 'rgba(255,255,255,0.74)',
                }}
              >
                <div className="flex items-center gap-3">
                  <div
                    className="flex h-11 w-11 items-center justify-center rounded-2xl"
                    style={active ? {
                      backgroundColor: menuTheme.surfaceStrong,
                      color: menuTheme.iconColor,
                    } : {
                      backgroundColor: menuTheme.iconBg,
                      color: menuTheme.iconColor,
                    }}
                  >
                    <Icon className="h-4 w-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-semibold text-slate-800">{label}</span>
                      <span
                        className="rounded-full px-2 py-0.5 text-[11px] font-semibold"
                        style={active ? {
                          backgroundColor: 'rgba(255,255,255,0.82)',
                          color: menuTheme.iconColor,
                        } : {
                          backgroundColor: 'rgba(255,255,255,0.82)',
                          color: menuTheme.iconColor,
                        }}
                      >
                        {badge}
                      </span>
                    </div>
                    <p className="mt-0.5 text-xs leading-5 text-slate-600">{note}</p>
                  </div>
                </div>
              </button>
            )
          })}
        </nav>

        <div className="mt-auto px-10 pb-10 pt-6">
          <div className="rounded-[24px] border p-5" style={{ borderColor: accentTheme.id === 'black' ? hexToRgba('#ffffff', 0.1) : hexToRgba(accentTheme.accent, 0.14), backgroundColor: accentTheme.id === 'black' ? 'rgba(255,255,255,0.92)' : hexToRgba(accentTheme.accent, 0.08) }}>
            <p className="text-xs font-semibold" style={{ color: accentTheme.text }}>Panoramica</p>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <div className="rounded-2xl bg-white/90 p-3.5 border" style={{ borderColor: accentTheme.id === 'black' ? hexToRgba('#0f172a', 0.06) : hexToRgba(accentTheme.accent, 0.12) }}>
                <div className="text-[11px] text-slate-400">Chat salvate</div>
                <div className="mt-1 text-lg font-semibold text-slate-900">{conversations.length}</div>
              </div>
              <div className="rounded-2xl bg-white/90 p-3.5 border" style={{ borderColor: accentTheme.id === 'black' ? hexToRgba('#0f172a', 0.06) : hexToRgba(accentTheme.accent, 0.12) }}>
                <div className="text-[11px] text-slate-400">Lezioni</div>
                <div className="mt-1 text-lg font-semibold text-slate-900">{learningSessions.length}</div>
              </div>
            </div>
          </div>
        </div>
      </aside>

      <div className="flex-1 min-w-0 min-h-0 flex overflow-hidden">
        {(selectedProfile || selectedTeacherbot) && (
          <div className={`${showHistory ? 'w-64' : 'w-10'} hidden md:flex min-h-0 border-r bg-white flex-col transition-all duration-200 shrink-0`} style={{ borderRightColor: accentTheme.border }}>
            {showHistory ? (
              <>
                <div className="p-3 border-b bg-white" style={{ borderBottomColor: accentTheme.border }}>
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
                    className="w-full text-left px-3 py-2 rounded-lg text-sm transition-colors flex items-center gap-2 border"
                    style={selectedSoftStyle}
                  >
                    <Sparkles className="h-4 w-4" />
                    Nuova chat
                  </button>
                  {conversations
                    .filter(c => selectedTeacherbot
                      ? c.profile_key === `teacherbot-${selectedTeacherbot.id}`
                      : c.profile_key === selectedProfile)
                    .map((conv) => (
                      <div
                        key={conv.id}
                        className={`group relative w-full text-left px-3 py-2 rounded-lg text-sm transition-colors cursor-pointer border ${conversationId === conv.id ? '' : 'hover:bg-slate-100 text-slate-600'}`}
                        style={conversationId === conv.id ? selectedSoftStyle : undefined}
                        onClick={() => loadConversation(conv.id)}
                      >
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
                  {conversations.filter(c => selectedTeacherbot
                    ? c.profile_key === `teacherbot-${selectedTeacherbot.id}`
                    : c.profile_key === selectedProfile).length === 0 && (
                      <p className="text-xs text-slate-400 text-center py-4">Nessuna conversazione precedente</p>
                    )}
                </div>
                {conversations.filter(c => selectedTeacherbot
                  ? c.profile_key === `teacherbot-${selectedTeacherbot.id}`
                  : c.profile_key === selectedProfile).length > 0 && (
                    <div className="p-2 border-t border-slate-200 bg-white">
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
          className="flex-1 flex flex-col min-w-0 min-h-0"
        style={chatBg ? { backgroundColor: chatBg } : undefined}
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
          {isDesktopSelection ? (
            <>
              <div
                className="border-b bg-white px-6 py-5"
                style={{
                  borderBottomColor: accentTheme.border,
                  backgroundColor: accentTheme.id === 'black' ? 'rgba(255,255,255,0.96)' : accentTheme.soft,
                }}
              >
                {mainTab === 'assistants' && (
                  <div className="flex items-end justify-between gap-4">
                    <div>
                      <p className="text-[11px] font-semibold uppercase tracking-[0.18em]" style={{ color: accentTheme.text }}>Assistenti AI</p>
                      <h3 className="mt-2 text-2xl font-semibold text-slate-900">Scegli il tipo di supporto</h3>
                      <p className="mt-1 text-sm text-slate-600">Landing iniziale del modulo: nessun chatbot viene aperto automaticamente.</p>
                    </div>
                    <div className="hidden xl:flex gap-3">
                      {topProfiles.map(([key, count]) => (
                        <div key={key} className="rounded-2xl border px-4 py-3 min-w-[132px]" style={{ borderColor: accentTheme.border, backgroundColor: accentTheme.soft }}>
                          <div className="text-[11px] text-slate-400">{profiles.find((profile) => profile.key === key)?.name || key}</div>
                          <div className="mt-1 text-lg font-semibold text-slate-900">{count}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {mainTab === 'teacherbots' && (
                  <div className="flex items-end justify-between gap-4">
                    <div>
                      <p className="text-[11px] font-semibold uppercase tracking-[0.18em]" style={{ color: accentTheme.text }}>Teacherbot</p>
                      <h3 className="mt-2 text-2xl font-semibold text-slate-900">Assistenti pubblicati dal docente</h3>
                      <p className="mt-1 text-sm text-slate-600">Card uniformi, più ordinate e con una resa visiva coerente con la tipologia.</p>
                    </div>
                    <div className="rounded-2xl border px-4 py-3" style={{ borderColor: accentTheme.border, backgroundColor: accentTheme.soft }}>
                      <div className="text-[11px] text-slate-400">Disponibili ora</div>
                      <div className="mt-1 text-lg font-semibold text-slate-900">{availableTeacherbots.length}</div>
                    </div>
                  </div>
                )}
                {mainTab === 'learning' && (
                  <div className="flex items-end justify-between gap-4">
                    <div>
                      <p className="text-[11px] font-semibold uppercase tracking-[0.18em]" style={{ color: accentTheme.text }}>Oggi Imparo</p>
                      <h3 className="mt-2 text-2xl font-semibold text-slate-900">Microlezioni organizzate</h3>
                      <p className="mt-1 text-sm text-slate-600">Vista più strutturata, con indicatori sintetici e tabella dei contenuti.</p>
                    </div>
                    <Button
                      onClick={() => setShowNewLessonDialog(true)}
                      className="rounded-xl text-white shadow-sm"
                      style={selectedSolidStyle}
                    >
                      <Plus className="mr-2 h-4 w-4" />
                      Nuova microlezione
                    </Button>
                  </div>
                )}
              </div>

              <div className="flex-1 overflow-y-auto p-6">
                {mainTab === 'assistants' && (
                  <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                    {profiles.map((profile) => {
                      const usage = profileUsageCounts[profile.key] || 0
                      const accent = profile.key === 'tutor'
                        ? { surface: 'rgba(220,252,231,0.72)', icon: 'rgba(16,185,129,0.14)', color: '#0f766e' }
                        : profile.key === 'quiz'
                          ? { surface: 'rgba(255,228,230,0.72)', icon: 'rgba(244,63,94,0.14)', color: '#be123c' }
                          : profile.key === 'interview'
                            ? { surface: 'rgba(243,232,255,0.74)', icon: 'rgba(139,92,246,0.14)', color: '#7c3aed' }
                            : profile.key === 'oral_exam'
                              ? { surface: 'rgba(255,237,213,0.78)', icon: 'rgba(245,158,11,0.14)', color: '#c2410c' }
                              : profile.key === 'dataset_generator'
                                ? { surface: 'rgba(207,250,254,0.78)', icon: 'rgba(14,165,233,0.14)', color: '#0369a1' }
                                : { surface: 'rgba(224,231,255,0.76)', icon: 'rgba(99,102,241,0.14)', color: '#4338ca' }

                      return (
                        <motion.button
                          key={profile.key}
                          whileTap={{ scale: 0.99 }}
                          onClick={() => handleSelectProfile(profile.key)}
                          className="group relative flex h-[220px] flex-col overflow-hidden rounded-3xl border bg-white p-5 text-left shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md"
                          style={{ borderColor: accentTheme.border }}
                        >
                          <div className="absolute inset-x-0 top-0 h-28" style={{ backgroundColor: accent.surface }} />
                          <div className="relative flex h-full flex-col">
                            <div className="flex items-start justify-between gap-3">
                              <div className="flex h-12 w-12 items-center justify-center rounded-2xl shadow-sm" style={{ backgroundColor: accent.icon, color: accent.color }}>
                                <div className="scale-90">{PROFILE_ICONS[profile.key] || <Bot className="h-5 w-5" />}</div>
                              </div>
                              <span className="rounded-full px-2.5 py-1 text-[11px] font-medium" style={{ backgroundColor: accentTheme.soft, color: accentTheme.text }}>
                                {usage > 0 ? `${usage} chat` : 'Nuovo'}
                              </span>
                            </div>
                            <div className="mt-5">
                              <h4 className="text-base font-semibold text-slate-900">{profile.name}</h4>
                              <p className="mt-2 line-clamp-3 text-sm leading-6 text-slate-600">{profile.description}</p>
                            </div>
                            <div className="mt-auto">
                              <div className="flex flex-wrap gap-1.5">
                                {(profile.suggested_prompts || []).slice(0, 2).map((prompt) => (
                                  <span key={prompt} className="rounded-full border px-2.5 py-1 text-[11px]" style={{ borderColor: accentTheme.border, backgroundColor: accentTheme.soft, color: accentTheme.text }}>
                                    {prompt}
                                  </span>
                                ))}
                              </div>
                              <div className="mt-4 h-1.5 rounded-full bg-slate-100 overflow-hidden">
                                <div
                                  className="h-full rounded-full"
                                  style={{ width: `${(usage / maxUsage) * 100}%`, backgroundColor: accentTheme.accent }}
                                />
                              </div>
                            </div>
                          </div>
                        </motion.button>
                      )
                    })}
                  </div>
                )}

                {mainTab === 'teacherbots' && (
                  availableTeacherbots.length === 0 ? (
                    <div className="flex h-full min-h-[360px] items-center justify-center rounded-3xl border border-dashed border-slate-300 bg-white">
                      <div className="text-center">
                        <Wand2 className="mx-auto h-10 w-10 text-slate-300" />
                        <p className="mt-4 text-sm font-medium text-slate-500">Nessun teacherbot disponibile</p>
                        <p className="mt-1 text-sm text-slate-400">Quando il docente ne pubblica uno, comparirà qui.</p>
                      </div>
                    </div>
                  ) : (
                    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                      {availableTeacherbots.map((bot) => {
                        const visual = getTeacherbotVisual(bot)
                        const surface = getTeacherbotSurface(bot.color)
                        return (
                          <motion.button
                            key={bot.id}
                            whileTap={{ scale: 0.99 }}
                            onClick={() => handleSelectTeacherbot(bot)}
                            className={`group flex h-[258px] flex-col overflow-hidden rounded-3xl border bg-white text-left shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md ${surface.border}`}
                          >
                            <div className={`relative overflow-hidden border-b px-5 py-5 ${surface.soft} ${surface.border}`}>
                              <div className="absolute -right-4 -top-4 h-24 w-24 rounded-full bg-white/55" />
                              <div className="absolute right-5 bottom-4 opacity-10">
                                <visual.Icon className="h-16 w-16 text-slate-900" />
                              </div>
                              <div className={`relative flex h-12 w-12 items-center justify-center rounded-2xl ${surface.icon}`}>
                                <visual.Icon className="h-5 w-5" />
                              </div>
                              <div className="relative mt-4">
                                <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">{visual.label}</p>
                                <p className="mt-1 text-sm text-slate-600">{visual.detail}</p>
                              </div>
                            </div>
                            <div className="flex flex-1 flex-col px-5 py-4">
                              <div className="flex items-start justify-between gap-3">
                                <h4 className="line-clamp-2 text-base font-semibold text-slate-900">{bot.name}</h4>
                                <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${surface.badge}`}>Docente</span>
                              </div>
                              <p className="mt-3 line-clamp-4 text-sm leading-6 text-slate-500">{bot.synopsis || bot.description || 'Assistente personalizzato per la sessione.'}</p>
                              <div className="mt-auto pt-4 text-xs font-medium text-slate-400">Apri conversazione</div>
                            </div>
                          </motion.button>
                        )
                      })}
                    </div>
                  )
                )}

                {mainTab === 'learning' && (
                  <div className="space-y-5">
                    <div className="grid gap-4 md:grid-cols-3">
                      {[
                        { label: 'Microlezioni', value: learningSessions.length, icon: BookOpen },
                        { label: 'Con chat attiva', value: learningSessions.filter((session) => session.conversationId).length, icon: ClipboardCheck },
                        { label: 'Argomenti unici', value: learningTopics.length, icon: Sparkles },
                      ].map(({ label, value, icon: Icon }) => (
                        <div key={label} className="rounded-3xl border bg-white p-5 shadow-sm" style={{ borderColor: accentTheme.border }}>
                          <div className="flex items-center justify-between">
                            <p className="text-sm font-medium text-slate-600">{label}</p>
                            <div className="flex h-10 w-10 items-center justify-center rounded-2xl" style={{ backgroundColor: accentTheme.soft, color: accentTheme.text }}>
                              <Icon className="h-4 w-4" />
                            </div>
                          </div>
                          <div className="mt-4 text-3xl font-semibold text-slate-900">{value}</div>
                        </div>
                      ))}
                    </div>

                    <div className="overflow-hidden rounded-3xl border bg-white shadow-sm" style={{ borderColor: accentTheme.border }}>
                      <div
                        className="grid grid-cols-[minmax(0,1.2fr)_minmax(0,2fr)_140px_120px] gap-4 border-b px-5 py-3 text-[11px] font-semibold uppercase tracking-[0.16em]"
                        style={{ borderBottomColor: accentTheme.border, backgroundColor: accentTheme.soft, color: accentTheme.text }}
                      >
                        <div>Argomento</div>
                        <div>Sintesi</div>
                        <div>Data</div>
                        <div>Stato</div>
                      </div>
                      {learningSessions.length === 0 ? (
                        <div className="px-5 py-14 text-center">
                          <BookOpen className="mx-auto h-10 w-10 text-slate-300" />
                          <p className="mt-4 text-sm font-medium text-slate-500">Nessuna microlezione disponibile</p>
                          <p className="mt-1 text-sm text-slate-400">Usa il pulsante in alto per crearne una nuova.</p>
                        </div>
                      ) : (
                        learningSessions.map((session) => (
                          <button
                            key={session.id}
                            onClick={() => expandingLearningSessionId !== session.id && openLearningSession(session)}
                            className="grid w-full grid-cols-[minmax(0,1.2fr)_minmax(0,2fr)_140px_120px] gap-4 border-b px-5 py-4 text-left transition-colors last:border-b-0"
                            style={{ borderBottomColor: accentTheme.softStrong }}
                          >
                            <div className="min-w-0">
                              <div className="truncate text-sm font-semibold text-slate-900">{session.topic}</div>
                            </div>
                            <div className="min-w-0">
                              <p className="line-clamp-2 text-sm leading-6 text-slate-600">{session.lesson}</p>
                            </div>
                            <div className="text-sm text-slate-600">
                              {new Date(session.createdAt).toLocaleDateString('it-IT', { day: '2-digit', month: 'short', year: 'numeric' })}
                            </div>
                            <div>
                              <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${expandingLearningSessionId === session.id ? 'bg-amber-100 text-amber-700' : session.conversationId ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-600'}`}>
                                {expandingLearningSessionId === session.id ? 'Espansione...' : session.conversationId ? 'Chat attiva' : 'Solo lezione'}
                              </span>
                            </div>
                          </button>
                        ))
                      )}
                    </div>
                  </div>
                )}
              </div>
            </>
          ) : (
            <>
              <div className="hidden md:flex shrink-0 items-center gap-3 px-4 py-3 bg-white border-b" style={{ borderBottomColor: accentTheme.border }}>
                <div className="w-10 h-10 rounded-xl flex items-center justify-center shadow-md" style={selectedSolidStyle}>
                  {selectedTeacherbot ? (
                    <div className="text-white scale-90 w-full h-full flex items-center justify-center">
                      <Wand2 className="h-5 w-5" />
                    </div>
                  ) : selectedProfile && PROFILE_ICONS[selectedProfile] ? (
                    <div className="text-white scale-90">{PROFILE_ICONS[selectedProfile]}</div>
                  ) : (
                    <Bot className="h-5 w-5 text-white" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <h3 className="font-semibold text-sm text-slate-800 truncate">
                    {learningMode && activeLearningSession ? activeLearningSession.topic : (selectedTeacherbot ? selectedTeacherbot.name : currentProfile?.name)}
                  </h3>
                  <p className="text-xs text-slate-500 truncate hidden lg:block">
                    {learningMode
                      ? 'Tutor contestualizzato sulla microlezione selezionata'
                      : (selectedTeacherbot ? 'Assistente pubblicato dal docente' : (effectiveSelectedModel?.name || 'Modello AI'))}
                  </p>
                </div>

                <div className="hidden lg:flex items-center gap-2 relative">
                  <div className="relative">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setShowBgPalette((v) => !v)}
                      className="text-slate-500 hover:text-slate-700"
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
                                    style={chatBg === color ? { backgroundColor: color, boxShadow: `0 0 0 2px ${accentTheme.accent}` } : { backgroundColor: color }}
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
                  </div>
                </div>

                {!selectedTeacherbot && (
                  <div className="hidden lg:block relative" ref={modelMenuRef}>
                    <button
                      onClick={() => setShowModelMenu(!showModelMenu)}
                      className="flex items-center gap-2 px-4 py-2 rounded-full text-xs font-bold transition-all shadow-sm hover:opacity-90 border"
                      style={selectedSoftStyle}
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
                      <span>{effectiveSelectedModel?.name || 'Modello AI'}</span>
                      <ChevronDown className={`h-3 w-3 transition-transform ${showModelMenu ? 'rotate-180' : ''}`} />
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
                              className={`mx-1 my-0.5 px-3 py-2 rounded-lg border cursor-pointer flex items-center justify-between ${selected ? '' : 'border-transparent hover:bg-slate-50'}`}
                              style={selected ? selectedSoftStyle : undefined}
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
                                style={isDefault ? selectedSolidStyle : undefined}
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

              <div
                ref={messagesContainerRef}
                className={`flex-1 min-h-0 overflow-y-auto overflow-x-hidden px-6 py-4 md:px-10 md:py-6 space-y-3 md:space-y-6 ${chatBgIsDark ? 'text-white' : ''}`}
                style={{ WebkitOverflowScrolling: 'touch', scrollBehavior: 'smooth' }}
              >
          {messages.length === 0 ? (
            <div className="text-center py-12">
              <div className={`inline-flex items-center justify-center w-20 h-20 rounded-2xl mb-6 shadow-lg ${selectedTeacherbot ? getTeacherbotColorClass(selectedTeacherbot.color) : ''}`} style={selectedTeacherbot ? undefined : selectedSolidStyle}>
                {selectedTeacherbot ? (
                  <Wand2 className="h-10 w-10 text-white" />
                ) : selectedProfile && PROFILE_ICONS[selectedProfile] ? (
                  <div className="text-white scale-125">{PROFILE_ICONS[selectedProfile]}</div>
                ) : (
                  <Bot className="h-10 w-10 text-white" />
                )}
              </div>
              <h3 className={`font-bold text-xl mb-2 ${chatBgIsDark ? 'text-white' : 'text-slate-800'}`}>{t('chatbot.greeting', { name: selectedTeacherbot ? selectedTeacherbot.name : currentProfile?.name })}</h3>
              <p className={`${chatBgIsDark ? 'text-white/70' : 'text-slate-500'} max-w-md mx-auto mb-8`}>{selectedTeacherbot ? '' : currentProfile?.description}</p>
              <div className="flex flex-wrap gap-2 justify-center max-w-lg mx-auto">
                {currentProfile?.suggested_prompts && !selectedTeacherbot && currentProfile.suggested_prompts.map((suggestion) => (
                  <button
                    key={suggestion}
                    onClick={() => setInput(suggestion)}
                    className={`px-4 py-2 rounded-full text-sm transition-all shadow-sm ${chatBgIsDark ? 'bg-white/10 border border-white/15 text-white hover:bg-white/15' : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50 hover:border-slate-300'}`}
                  >
                    {suggestion}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            messages.map((message) => (
              <div key={message.id} className={`flex gap-3 ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                {message.role === 'assistant' && (
                  <div className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 shadow-md ${selectedTeacherbot ? getTeacherbotColorClass(selectedTeacherbot.color) : ''}`} style={selectedTeacherbot ? undefined : selectedSolidStyle}>
                    {selectedTeacherbot ? (
                      <Wand2 className="h-5 w-5 text-white" />
                    ) : selectedProfile && PROFILE_ICONS[selectedProfile] ? (
                      <div className="text-white scale-75">{PROFILE_ICONS[selectedProfile]}</div>
                    ) : (
                      <Bot className="h-5 w-5 text-white" />
                    )}
                  </div>
                )}
                <div className={`max-w-[80%] rounded-2xl px-4 py-3 ${message.role === 'user'
                  ? 'text-white rounded-br-md shadow-md'
                  : `${chatBgIsDark ? 'bg-white/10 text-white border border-white/15' : 'bg-white border border-slate-100'} shadow-sm rounded-bl-md`
                  }`}
                  style={message.role === 'user' ? selectedSolidStyle : undefined}
                >
                  {message.role === 'assistant' ? (
                    <MessageContent 
                      content={message.content} 
                      onQuizSubmit={(answers) => setInput(answers)} 
                      onInput={(text) => {
                        setInput(text);
                        setTimeout(() => handleSend(text), 100);
                      }}
                      darkMode={chatBgIsDark} 
                    />
                  ) : (
                    <p className="text-sm whitespace-pre-wrap">{message.content}</p>
                  )}
                  {message.role === 'assistant' && (
                    <EnvironmentalImpactPill darkMode={chatBgIsDark} className="mt-3" />
                  )}
                </div>
                {message.role === 'user' && (
                  <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 shadow-sm border border-white/10 bg-slate-800/92">
                    <User className="h-5 w-5 text-white" />
                  </div>
                )}
              </div>
            ))
          )}
          {(sendMessageMutation.isPending && !isStreaming) && (
            <div className="flex gap-3">
              <div className={`w-9 h-9 rounded-xl flex items-center justify-center shadow-md ${selectedTeacherbot ? getTeacherbotColorClass(selectedTeacherbot.color) : ''}`} style={selectedTeacherbot ? undefined : selectedSolidStyle}>
                {selectedTeacherbot ? (
                  <Wand2 className="h-5 w-5 text-white" />
                ) : selectedProfile && PROFILE_ICONS[selectedProfile] ? (
                  <div className="text-white scale-75">{PROFILE_ICONS[selectedProfile]}</div>
                ) : (
                  <Bot className="h-5 w-5 text-white" />
                )}
              </div>
              <div className={`${chatBgIsDark ? 'bg-white/10 border border-white/15' : 'bg-white border border-slate-100'} shadow-sm rounded-2xl rounded-bl-md px-4 py-3`}>
                <div className="flex items-center gap-2">
                  <div className="flex gap-1">
                    <span className="w-2 h-2 rounded-full animate-bounce" style={{ animationDelay: '0ms', backgroundColor: chatBgIsDark ? '#ffffff' : accentTheme.accent }}></span>
                    <span className="w-2 h-2 rounded-full animate-bounce" style={{ animationDelay: '150ms', backgroundColor: chatBgIsDark ? '#ffffff' : accentTheme.accent }}></span>
                    <span className="w-2 h-2 rounded-full animate-bounce" style={{ animationDelay: '300ms', backgroundColor: chatBgIsDark ? '#ffffff' : accentTheme.accent }}></span>
                  </div>
                  <span className={`text-sm ${chatBgIsDark ? 'text-white/70' : 'text-slate-400'}`}>Sto pensando...</span>
                </div>
              </div>
            </div>
          )}
          {streamingStatus && (
            <div className="flex gap-3">
              <div className={`w-9 h-9 rounded-xl flex items-center justify-center shadow-md`} style={selectedSolidStyle}>
                <Loader2 className="h-4 w-4 text-white animate-spin" />
              </div>
              <div className={`${chatBgIsDark ? 'bg-white/10 border border-white/15' : 'bg-white border border-slate-100'} shadow-sm rounded-2xl rounded-bl-md px-3 py-2`}>
                <span className={`text-xs ${chatBgIsDark ? 'text-white/70' : 'text-slate-400'}`}>{streamingStatus}</span>
              </div>
            </div>
          )}
          {imageGenerationProgress && (
            <div className="flex gap-3 justify-start">
              <div className="w-9 h-9 rounded-xl flex items-center justify-center shadow-md flex-shrink-0" style={selectedSolidStyle}>
                <ImageIcon className="h-4 w-4 text-white" />
              </div>
              <div className="bg-white border border-slate-100 shadow-sm rounded-2xl rounded-bl-md px-4 py-3 max-w-[75%]">
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

              {isMobile ? (
                <div className={`fixed transition-all duration-200 z-50 ${isInputFocused ? 'bottom-0 left-0 right-0 p-2 bg-white border-t border-slate-200' : 'bottom-[calc(2.5rem+env(safe-area-inset-bottom))] left-2 right-2'}`}>
                  {composerContent}
                </div>
              ) : (
                <div className="hidden md:block shrink-0 border-t border-slate-200 bg-white/92">
                  {composerContent}
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {showNewLessonDialog && (
        <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4" onClick={() => setShowNewLessonDialog(false)}>
          <div className="bg-white rounded-2xl shadow-2xl border border-slate-100 p-6 w-full max-w-sm" onClick={e => e.stopPropagation()}>
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
                className="px-4 py-2 text-sm font-semibold bg-violet-600 hover:bg-violet-700 text-white rounded-xl disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-1.5"
              >
                {generatingLesson ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                Genera lezione
              </button>
            </div>
          </div>
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
  const [openUnitId, setOpenUnitId] = useState<string | null>(units[0]?.id || null)

  return (
    <div className="my-4 space-y-3">
      {units.map((unit, index) => {
        const isOpen = openUnitId === unit.id
        return (
          <div key={unit.id} className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
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
                <div className="rounded-2xl bg-slate-50 px-4 py-4">
                  <p className="text-sm leading-7 text-slate-700 whitespace-pre-wrap">{unit.explanation}</p>
                </div>
                {unit.keyPoints.length > 0 && (
                  <div className="mt-4">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">Punti chiave</p>
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
                    onClick={() => onGenerateImage?.(buildLearningImagePrompt(topic, unit))}
                    className="rounded-xl border border-sky-200 bg-sky-50 px-4 py-2 text-sm font-semibold text-sky-700 hover:bg-sky-100 transition-colors"
                  >
                    Genera immagine
                  </button>
                  <button
                    onClick={() => onGenerateQuiz?.(buildLearningQuizPrompt(topic, unit))}
                    className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 transition-colors"
                  >
                    Genera quiz
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
    <div className={`prose prose-sm max-w-none ${darkMode ? 'prose-invert text-white' : 'prose-slate'}`}>
      {cleanContent && (
        <ReactMarkdown
          remarkPlugins={[remarkGfm, remarkMath]}
          rehypePlugins={[rehypeKatex]}
          components={{
            p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
            ...markdownCodeComponents(darkMode),
            ul: ({ children }) => <ul className="list-disc pl-4 mb-2 space-y-1">{children}</ul>,
            ol: ({ children }) => <ol className="list-decimal pl-4 mb-2 space-y-1">{children}</ol>,
            li: ({ children }) => <li className={`text-sm ${darkMode ? 'text-white' : ''}`}>{children}</li>,
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
