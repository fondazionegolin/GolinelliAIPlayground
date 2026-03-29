import { useState, useRef, useEffect, useCallback, useMemo, type CSSProperties } from 'react'
import { useTranslation } from 'react-i18next'
import { useMutation, useQuery } from '@tanstack/react-query'
import { motion } from 'framer-motion'
import { llmApi, studentApi, teacherbotsApi } from '@/lib/api'
import DataFileCard, { type DataFilePreview } from '@/components/DataFileCard'
import { Button } from '@/components/ui/button'
import {
  Send, Bot, User, GraduationCap,
  Lightbulb, ClipboardCheck, ArrowLeft, Sparkles,
  Paperclip, X, File, Database, Download, Loader2,
  Trash2, ChevronLeft, ChevronRight, Menu, Wand2, Palette, ChevronDown, Check, ImageIcon
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


const PROFILE_TILE_STYLES: Record<string, { card: string; iconBg: string; icon: string }> = {
  tutor:             { card: 'bg-emerald-50/80 border border-emerald-200/70 hover:border-emerald-300/80 hover:bg-emerald-50 hover:shadow-emerald-100/60', iconBg: 'bg-emerald-100', icon: 'text-emerald-700' },
  quiz:              { card: 'bg-rose-50/80 border border-rose-200/70 hover:border-rose-300/80 hover:bg-rose-50 hover:shadow-rose-100/60',             iconBg: 'bg-rose-100',    icon: 'text-rose-700' },
  interview:         { card: 'bg-violet-50/80 border border-violet-200/70 hover:border-violet-300/80 hover:bg-violet-50 hover:shadow-violet-100/60',    iconBg: 'bg-violet-100',  icon: 'text-violet-700' },
  oral_exam:         { card: 'bg-amber-50/80 border border-amber-200/70 hover:border-amber-300/80 hover:bg-amber-50 hover:shadow-amber-100/60',         iconBg: 'bg-amber-100',   icon: 'text-amber-700' },
  dataset_generator: { card: 'bg-sky-50/80 border border-sky-200/70 hover:border-sky-300/80 hover:bg-sky-50 hover:shadow-sky-100/60',                  iconBg: 'bg-sky-100',     icon: 'text-sky-700' },
  math_coach:        { card: 'bg-blue-50/80 border border-blue-200/70 hover:border-blue-300/80 hover:bg-blue-50 hover:shadow-blue-100/60',              iconBg: 'bg-blue-100',    icon: 'text-blue-800' },
}

const TEACHERBOT_TILE_STYLES: Record<string, { card: string; iconBg: string; icon: string }> = {
  indigo:  { card: 'bg-indigo-50/80 border border-indigo-200/70 hover:border-indigo-300/80 hover:bg-indigo-50 hover:shadow-indigo-100/60',    iconBg: 'bg-indigo-100',  icon: 'text-indigo-700' },
  blue:    { card: 'bg-blue-50/80 border border-blue-200/70 hover:border-blue-300/80 hover:bg-blue-50 hover:shadow-blue-100/60',              iconBg: 'bg-blue-100',    icon: 'text-blue-700' },
  green:   { card: 'bg-emerald-50/80 border border-emerald-200/70 hover:border-emerald-300/80 hover:bg-emerald-50 hover:shadow-emerald-100/60', iconBg: 'bg-emerald-100', icon: 'text-emerald-700' },
  red:     { card: 'bg-red-50/80 border border-red-200/70 hover:border-red-300/80 hover:bg-red-50 hover:shadow-red-100/60',                   iconBg: 'bg-red-100',     icon: 'text-red-700' },
  purple:  { card: 'bg-purple-50/80 border border-purple-200/70 hover:border-purple-300/80 hover:bg-purple-50 hover:shadow-purple-100/60',    iconBg: 'bg-purple-100',  icon: 'text-purple-700' },
  pink:    { card: 'bg-pink-50/80 border border-pink-200/70 hover:border-pink-300/80 hover:bg-pink-50 hover:shadow-pink-100/60',              iconBg: 'bg-pink-100',    icon: 'text-pink-700' },
  orange:  { card: 'bg-orange-50/80 border border-orange-200/70 hover:border-orange-300/80 hover:bg-orange-50 hover:shadow-orange-100/60',    iconBg: 'bg-orange-100',  icon: 'text-orange-700' },
  teal:    { card: 'bg-teal-50/80 border border-teal-200/70 hover:border-teal-300/80 hover:bg-teal-50 hover:shadow-teal-100/60',              iconBg: 'bg-teal-100',    icon: 'text-teal-700' },
  cyan:    { card: 'bg-cyan-50/80 border border-cyan-200/70 hover:border-cyan-300/80 hover:bg-cyan-50 hover:shadow-cyan-100/60',              iconBg: 'bg-cyan-100',    icon: 'text-cyan-700' },
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

// Mobile navigation state
type MobileViewState = 'profiles' | 'conversations' | 'chat'

export default function ChatbotModule({ sessionId, studentId, initialTeacherbotId, onInputFocusChange, isTeacherPreview, studentAccent: accentProp }: ChatbotModuleProps) {
  const { t } = useTranslation()
  const FALLBACK_PROFILES = getFallbackProfiles(t)
  const PROFILE_INTERVIEWS = getProfileInterviews(t)
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [conversationId, setConversationId] = useState<string | null>(null)
  const loadingConvIdRef = useRef<string | null>(null)
  const [showHistory, setShowHistory] = useState(false)
  const [mobileHistoryOpen, setMobileHistoryOpen] = useState(false)
  const [selectedProfile, setSelectedProfile] = useState<string | null>(null)
  const [selectedModel, setSelectedModel] = useState<LLMModel | null>(null)
  const [showModelMenu, setShowModelMenu] = useState(false)
  const [attachedFiles, setAttachedFiles] = useState<AttachedFile[]>([])
  const [imageProvider, setImageProvider] = useState<'dall-e' | 'gpt-image-1'>('dall-e')
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
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
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
    setMobileHistoryOpen(false)
    if (isMobile) {
      setMobileView('profiles')
    }
  }, [isMobile, teacherbotConversationId, resetProfileInterview])

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
      setMessages(serverMessages)

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

  const getTeacherbotTileStyle = (color: string) =>
    TEACHERBOT_TILE_STYLES[color] ?? TEACHERBOT_TILE_STYLES.indigo

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
    return (
      <div className="h-full overflow-y-auto p-4 pb-20">
        <h2 className="text-sm font-bold text-slate-700 mb-0.5">Assistenti AI</h2>
        <p className="text-[11px] text-slate-400 mb-3">Scegli il tipo di sessione</p>
        <div className="grid grid-cols-3 gap-2">
          {profiles.map((profile) => {
            const s = PROFILE_TILE_STYLES[profile.key] ?? { card: 'bg-slate-50/80 border border-slate-200/70 hover:bg-slate-50', iconBg: 'bg-slate-100', icon: 'text-slate-600' }
            return (
              <motion.button
                key={profile.key}
                whileTap={{ scale: 0.95 }}
                onClick={() => handleSelectProfile(profile.key)}
                className={`aspect-square flex flex-col items-center justify-center p-3 rounded-2xl shadow-sm active:shadow-none transition-all backdrop-blur-sm ${s.card}`}
              >
                <div className={`w-9 h-9 rounded-xl ${s.iconBg} flex items-center justify-center mb-1.5 ${s.icon}`}>
                  {PROFILE_ICONS[profile.key] || <Bot className="h-5 w-5" />}
                </div>
                <span className="text-[11px] font-semibold leading-tight text-center text-slate-800">{profile.name}</span>
              </motion.button>
            )
          })}
        </div>

        {/* Teacherbots section - Mobile */}
        {availableTeacherbots.length > 0 && (
          <div className="mt-5">
            <h2 className="text-sm font-bold text-slate-700 mb-0.5 flex items-center gap-1.5">
              <Wand2 className="h-3.5 w-3.5 text-indigo-500" />
              Teacherbots del Docente
            </h2>
            <p className="text-[11px] text-slate-400 mb-3">Assistenti personalizzati dal tuo docente</p>
            <div className="grid grid-cols-3 gap-2">
              {availableTeacherbots.map((bot) => {
                const s = getTeacherbotTileStyle(bot.color)
                return (
                  <motion.button
                    key={bot.id}
                    whileTap={{ scale: 0.95 }}
                    onClick={() => handleSelectTeacherbot(bot)}
                    className={`aspect-square flex flex-col items-center justify-center p-3 rounded-2xl shadow-sm active:shadow-none transition-all backdrop-blur-sm ${s.card}`}
                  >
                    <div className={`w-9 h-9 rounded-xl ${s.iconBg} flex items-center justify-center mb-1.5 ${s.icon}`}>
                      <Wand2 className="h-5 w-5" />
                    </div>
                    <span className="text-[11px] font-semibold leading-tight text-center text-slate-800 line-clamp-2">{bot.name}</span>
                  </motion.button>
                )
              })}
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

  // Profile selection screen (Desktop)
  if (!selectedProfile && !selectedTeacherbot) {
    return (
      <div className="h-full overflow-y-auto p-4 md:p-6 scrollbar-thin scrollbar-thumb-indigo-200 scrollbar-track-transparent">
        <div className="max-w-xl mx-auto">
        <h2 className="text-sm font-bold text-slate-700 mb-0.5">Assistenti AI</h2>
        <p className="text-xs text-slate-400 mb-4">Scegli il tipo di sessione di apprendimento</p>
        <div className="grid grid-cols-3 gap-3">
          {profiles.map((profile) => {
            const s = PROFILE_TILE_STYLES[profile.key] ?? { card: 'bg-slate-50/80 border border-slate-200/70 hover:bg-slate-50', iconBg: 'bg-slate-100', icon: 'text-slate-600' }
            return (
              <motion.button
                key={profile.key}
                whileTap={{ scale: 0.97 }}
                className={`aspect-square flex flex-col items-center justify-center p-4 rounded-2xl shadow-sm hover:shadow-md transition-all backdrop-blur-sm ${s.card}`}
                onClick={() => handleSelectProfile(profile.key)}
              >
                <div className={`w-11 h-11 rounded-xl ${s.iconBg} flex items-center justify-center mb-2.5 ${s.icon}`}>
                  {PROFILE_ICONS[profile.key] || <Bot className="h-6 w-6" />}
                </div>
                <span className="text-xs font-semibold leading-tight text-center text-slate-800">{profile.name}</span>
                <span className="text-[10px] text-slate-500 leading-tight mt-1 text-center line-clamp-2">{profile.description}</span>
              </motion.button>
            )
          })}
        </div>

        {/* Teacherbots section - Desktop */}
        {availableTeacherbots.length > 0 && (
          <div className="mt-6 pb-8">
            <h2 className="text-sm font-bold text-slate-700 mb-0.5 flex items-center gap-1.5">
              <Wand2 className="h-3.5 w-3.5 text-indigo-500" />
              Teacherbots del Docente
            </h2>
            <p className="text-xs text-slate-400 mb-4">Assistenti personalizzati dal tuo docente</p>
            <div className="grid grid-cols-3 gap-3">
              {availableTeacherbots.map((bot) => {
                const s = getTeacherbotTileStyle(bot.color)
                return (
                  <motion.button
                    key={bot.id}
                    whileTap={{ scale: 0.97 }}
                    className={`aspect-square flex flex-col items-center justify-center p-4 rounded-2xl shadow-sm hover:shadow-md transition-all backdrop-blur-sm ${s.card}`}
                    onClick={() => handleSelectTeacherbot(bot)}
                  >
                    <div className={`w-11 h-11 rounded-xl ${s.iconBg} flex items-center justify-center mb-2.5 ${s.icon}`}>
                      <Wand2 className="h-6 w-6" />
                    </div>
                    <span className="text-xs font-semibold leading-tight text-center text-slate-800">{bot.name}</span>
                    <span className="text-[10px] text-slate-500 leading-tight mt-1 text-center line-clamp-2">{bot.synopsis || bot.description}</span>
                  </motion.button>
                )
              })}
            </div>
          </div>
        )}
        </div>
      </div>
    )
  }




  // Desktop Chat interface
  return (
    <div
      className="flex h-full md:h-[calc(100vh-7.2rem)] md:max-h-[920px] md:min-h-[500px] flex-col md:flex-row bg-slate-50 md:bg-white md:rounded-2xl overflow-hidden md:shadow-lg md:border md:border-slate-200 relative md:my-1.5 md:mb-5 md:mx-3"
      style={accentVars}
    >
      {/* Mobile Header - Fixed height */}
      <div className="flex md:hidden items-center gap-2 px-3 py-1.5 bg-white border-b flex-shrink-0">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setMobileHistoryOpen(true)}
          className="text-slate-500 -ml-2 h-8 w-8 p-0"
        >
          <Menu className="h-4 w-4" />
        </Button>
        <div className="w-7 h-7 rounded-xl flex items-center justify-center shadow-md" style={selectedSolidStyle}>
          {selectedProfile && PROFILE_ICONS[selectedProfile] ? (
            <div className="text-white scale-90">{PROFILE_ICONS[selectedProfile]}</div>
          ) : (
            <Bot className="h-3.5 w-3.5 text-white" />
          )}
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="font-semibold text-sm text-slate-800 truncate">{currentProfile?.name}</h3>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={handleNewChat}
          className="text-slate-500 hover:text-slate-700 h-8 w-8 p-0"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
        </Button>
      </div>

      {/* Mobile History Overlay */}
      {(selectedProfile || selectedTeacherbot) && mobileHistoryOpen && (
        <div className="fixed inset-0 z-50 flex md:hidden">
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={() => setMobileHistoryOpen(false)} />
          <div className="relative w-[85%] max-w-xs bg-white h-full shadow-2xl animate-in slide-in-from-left duration-200 flex flex-col">
            <div className="p-3 border-b bg-white flex justify-between items-center">
              <h4 className="font-semibold text-sm text-slate-700">Cronologia</h4>
              <Button variant="ghost" size="sm" onClick={() => setMobileHistoryOpen(false)}><X className="h-5 w-5" /></Button>
            </div>
            <div className="flex-1 overflow-y-auto p-2 space-y-1">
              <button
                onClick={handleNewChat}
                className="w-full text-left px-3 py-2 rounded-lg text-sm transition-colors flex items-center gap-2 border"
                style={selectedSoftStyle}
              >
                <Sparkles className="h-4 w-4" />
                Nuova chat
              </button>
              {conversations
                .filter(c => selectedTeacherbot ? c.profile_key === `teacherbot-${selectedTeacherbot.id}` : c.profile_key === selectedProfile)
                .map((conv) => (
                  <div
                    key={conv.id}
                    className={`group relative w-full text-left px-3 py-2 rounded-lg text-sm transition-colors cursor-pointer border ${conversationId === conv.id
                      ? ''
                      : 'hover:bg-slate-100 text-slate-600'
                      }`}
                    style={conversationId === conv.id ? selectedSoftStyle : undefined}
                    onClick={() => { loadConversation(conv.id); setMobileHistoryOpen(false); }}
                  >
                    <div className="truncate font-medium pr-6">{conv.title || 'Conversazione'}</div>
                    <div className="text-xs text-slate-400">
                      {new Date(conv.updated_at).toLocaleDateString('it-IT', { day: 'numeric', month: 'short' })}
                    </div>
                  </div>
                ))}
            </div>
          </div>
        </div>
      )}

      {/* Desktop History Panel */}
      {(selectedProfile || selectedTeacherbot) && (
        <div className={`hidden md:flex ${showHistory ? 'w-64' : 'w-8'} border-r bg-slate-50 flex-col transition-all duration-200 shrink-0`}>
          {showHistory ? (
            <>
              <div className="p-3 border-b bg-white">
                <div className="flex items-center justify-between">
                  <h4 className="font-semibold text-sm text-slate-700">Cronologia</h4>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setShowHistory(false)}
                    className="h-6 w-6 p-0"
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </Button>
                </div>
              </div>
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
          {showHistory && (
            <div className="flex-1 overflow-y-auto p-2 space-y-1">
              <button
                onClick={handleNewChat}
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
                    className={`group relative w-full text-left px-3 py-2 rounded-lg text-sm transition-colors cursor-pointer border ${conversationId === conv.id
                      ? ''
                      : 'hover:bg-slate-100 text-slate-600'
                      }`}
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
                  <p className="text-xs text-slate-400 text-center py-4">
                    Nessuna conversazione precedente
                  </p>
                )}
            </div>
          )}
          {showHistory && conversations.filter(c => selectedTeacherbot
            ? c.profile_key === `teacherbot-${selectedTeacherbot.id}`
            : c.profile_key === selectedProfile).length > 0 && (
              <div className="p-2 border-t bg-white">
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
        </div>
      )}

      {/* Main Chat Area */}
      <div
        className="flex-1 flex flex-col"
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
        {/* Desktop Header */}
        <div className="hidden md:flex items-center gap-2 md:gap-3 px-3 py-2 md:px-4 md:py-3 bg-white border-b sticky top-0 z-20">
          <Button
            variant="ghost"
            size="sm"
            onClick={handleNewChat}
            className="text-slate-500 hover:text-slate-700"
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
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
              {selectedTeacherbot ? selectedTeacherbot.name : currentProfile?.name}
            </h3>
            <p className="text-xs text-slate-500 truncate hidden lg:block">
              {selectedTeacherbot ? '' : (effectiveSelectedModel?.name || 'Modello AI')}
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

        {/* Messages area */}
        <div className={`flex-1 overflow-y-auto px-6 py-4 md:px-10 md:py-6 space-y-3 md:space-y-6 ${chatBgIsDark ? 'text-white' : ''}`} style={{ WebkitOverflowScrolling: 'touch', scrollBehavior: 'smooth' }}>
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
                </div>
                {message.role === 'user' && (
                  <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-slate-700 to-slate-800 flex items-center justify-center flex-shrink-0 shadow-md">
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

        {/* Input area */}
        <div className={`fixed transition-all duration-200 z-50 md:static md:bottom-auto md:left-auto md:right-auto md:z-auto ${isInputFocused ? 'bottom-0 left-0 right-0 p-2 bg-white border-t border-slate-200' : 'bottom-[calc(2.5rem+env(safe-area-inset-bottom))] left-2 right-2'}`}>
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
          {/* Suggested prompts from data files */}
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
                className={`h-9 w-9 rounded-full transition-all flex-shrink-0 ${(!input.trim() && attachedFiles.length === 0)
                  ? 'bg-slate-200 text-slate-400'
                  : 'hover:scale-105 shadow-md text-white'
                  }`}
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
                    { id: 'dall-e' as const, label: '🎨 DALL-E 3' },
                    { id: 'gpt-image-1' as const, label: '✨ GPT Image 1' },
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
        </div>
      </div>
    </div >
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
  const { quiz, exercise, csv, textContent, isGenerating, generationType, actionMenu, sessionSelector, studentSelector } = parseContentBlocks(content)
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
    <div className="bg-gradient-to-br from-sky-50 to-indigo-50 rounded-xl p-4 border border-sky-200">
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
    return { quiz, exercise, csv, textContent, isGenerating: false, generationType: null, actionMenu, sessionSelector, studentSelector }
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

  return { quiz, exercise, csv, textContent, isGenerating, generationType, actionMenu, sessionSelector, studentSelector }
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
    <div className="bg-gradient-to-br from-fuchsia-50 to-violet-50 rounded-xl p-4 border border-fuchsia-200">
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
            ? 'bg-gradient-to-r from-fuchsia-500 to-violet-600 text-white hover:from-fuchsia-600 hover:to-violet-700 shadow-md'
            : 'bg-slate-200 text-slate-400 cursor-not-allowed'
            }`}
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
