import { useState, useRef, useEffect, useCallback, useMemo, type CSSProperties } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { motion } from 'framer-motion'
import { llmApi, studentApi, teacherbotsApi } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import {
  Send, Bot, User, GraduationCap,
  Lightbulb, ClipboardCheck, ArrowLeft, Sparkles,
  Paperclip, X, File, Database, Download, Loader2,
  Trash2, ChevronLeft, ChevronRight, Menu, Wand2, Palette, ChevronDown, Check
} from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'
import 'katex/dist/katex.min.css'
import { useMobile } from '@/hooks/useMobile'
import { triggerHaptic } from '@/lib/haptics'
import ChatConversationList from '@/components/student/ChatConversationList'
import ChatConversationView from '@/components/student/ChatConversationView'
import { DEFAULT_STUDENT_ACCENT, getStudentAccentTheme, loadStudentAccent } from '@/lib/studentAccent'

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
  initialTeacherbotId?: string | null
  onInputFocusChange?: (focused: boolean) => void
}

const PROFILE_ICONS: Record<string, React.ReactNode> = {
  'tutor': <GraduationCap className="h-6 w-6" />,
  'quiz': <ClipboardCheck className="h-6 w-6" />,
  'interview': <Bot className="h-6 w-6" />,
  'oral_exam': <User className="h-6 w-6" />,
  'dataset_generator': <Database className="h-6 w-6" />,
  'math_coach': <Lightbulb className="h-6 w-6" />,
}

const PROFILE_COLORS: Record<string, string> = {
  'tutor': 'bg-slate-100 text-slate-700 border-slate-200',
  'quiz': 'bg-slate-100 text-slate-700 border-slate-200',
  'interview': 'bg-slate-100 text-slate-700 border-slate-200',
  'oral_exam': 'bg-slate-100 text-slate-700 border-slate-200',
  'dataset_generator': 'bg-slate-100 text-slate-700 border-slate-200',
  'math_coach': 'bg-slate-100 text-slate-700 border-slate-200',
}

const FALLBACK_PROFILES: ChatbotProfile[] = [
  { key: 'tutor', name: 'Tutor AI', description: 'Spiega argomenti passo passo con esempi semplici e mirati al tuo livello.', icon: 'graduation-cap', suggested_prompts: ['Spiegami questo concetto', 'Fammi un esempio pratico'] },
  { key: 'quiz', name: 'Quiz Master', description: 'Costruisce quiz personalizzati e ti aiuta a ripassare in modo attivo.', icon: 'clipboard-check', suggested_prompts: ['Voglio un quiz guidato', 'Allenami su questo argomento'] },
  { key: 'interview', name: 'Intervista', description: 'Simula dialoghi con personaggi storici o scientifici per capire meglio il contesto.', icon: 'mic', suggested_prompts: ['Voglio intervistare un personaggio', 'Suggeriscimi chi intervistare'] },
  { key: 'oral_exam', name: 'Interrogazione', description: 'Simula un orale realistico con domande progressive e feedback su chiarezza e completezza.', icon: 'user-check', suggested_prompts: ['Interrogami su un argomento', 'Fammi una simulazione orale'] },
  { key: 'dataset_generator', name: 'Generatore Dataset', description: 'Crea dataset CSV coerenti con scenario, variabili e difficoltà richiesti.', icon: 'database', suggested_prompts: ['Guidami a creare un dataset', 'Genera un CSV per analisi'] },
  { key: 'math_coach', name: 'Math Coach', description: 'Ti guida nella risoluzione dei problemi con metodo, passaggi chiari e controllo errori.', icon: 'calculator', suggested_prompts: ['Guidami su un problema', 'Verifica il mio procedimento'] },
]

type InterviewStep = { key: string; question: string }
type ProactiveProfileKey = 'quiz' | 'interview' | 'oral_exam' | 'dataset_generator' | 'math_coach'

const PROACTIVE_PROFILE_KEYS: ProactiveProfileKey[] = ['quiz', 'interview', 'oral_exam', 'dataset_generator', 'math_coach']

const PROFILE_INTERVIEWS: Record<ProactiveProfileKey, InterviewStep[]> = {
  quiz: [
    { key: 'topic', question: 'Modalita Quiz guidata attiva.\n\n1) Quale argomento vuoi allenare?' },
    { key: 'questionCount', question: '2) Quante domande vuoi? (numero)' },
    { key: 'difficulty', question: '3) Che livello desideri? (base, intermedio, avanzato)' },
    { key: 'focus', question: '4) Vuoi focus su teoria, applicazioni o entrambi?' },
  ],
  interview: [
    { key: 'character', question: 'Modalita Intervista guidata attiva.\n\n1) Quale personaggio ti piacerebbe intervistare? Se non hai un idea precisa, posso suggerirti qualcuno in base al periodo storico o all\'argomento.' },
    { key: 'period_or_topic', question: '2) Quale periodo storico o tema vuoi trattare?' },
    { key: 'tone', question: '3) Preferisci tono formale, divulgativo o creativo?' },
    { key: 'goal', question: '4) Obiettivo dell\'intervista: ripasso, approfondimento o preparazione verifica?' },
  ],
  oral_exam: [
    { key: 'subject', question: 'Modalita Interrogazione guidata attiva.\n\n1) Materia e argomento principale?' },
    { key: 'scope', question: '2) Quali sotto-argomenti vuoi includere?' },
    { key: 'difficulty', question: '3) Livello atteso: base, intermedio o avanzato?' },
    { key: 'feedback', question: '4) Vuoi feedback rapido o dettagliato dopo ogni risposta?' },
  ],
  dataset_generator: [
    { key: 'context', question: 'Modalita Dataset guidata attiva.\n\n1) In quale contesto vuoi usare il dataset?' },
    { key: 'columns', question: '2) Quali colonne principali vuoi avere?' },
    { key: 'rows', question: '3) Quante righe desideri? (numero)' },
    { key: 'constraints', question: '4) Vuoi vincoli specifici (range, correlazioni, categorie)?' },
  ],
  math_coach: [
    { key: 'topic', question: 'Modalita Math Coach guidata attiva.\n\n1) Su quale tema matematico vuoi lavorare?' },
    { key: 'goal', question: '2) Obiettivo: capire teoria, risolvere esercizi o preparare verifica?' },
    { key: 'level', question: '3) Livello attuale percepito: base, intermedio o avanzato?' },
    { key: 'style', question: '4) Preferisci spiegazioni sintetiche o dettagliate passo-passo?' },
  ],
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
  type: 'image' | 'document'
}

// Mobile navigation state
type MobileViewState = 'profiles' | 'conversations' | 'chat'

export default function ChatbotModule({ sessionId, initialTeacherbotId, onInputFocusChange }: ChatbotModuleProps) {
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [conversationId, setConversationId] = useState<string | null>(null)
  const [showHistory, setShowHistory] = useState(true)
  const [mobileHistoryOpen, setMobileHistoryOpen] = useState(false)
  const [selectedProfile, setSelectedProfile] = useState<string | null>(null)
  const [selectedModel, setSelectedModel] = useState<LLMModel | null>(null)
  const [showModelMenu, setShowModelMenu] = useState(false)
  const [attachedFiles, setAttachedFiles] = useState<AttachedFile[]>([])
  const [imageProvider, setImageProvider] = useState<'dall-e' | 'flux-schnell'>('flux-schnell')
  const [imageSize, setImageSize] = useState<string>('1024x1024')
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
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const modelMenuRef = useRef<HTMLDivElement>(null)
  const isGeneratingRef = useRef(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [isInputFocused, setIsInputFocused] = useState(false)
  const [studentAccent, setStudentAccent] = useState(DEFAULT_STUDENT_ACCENT)

  useEffect(() => {
    setStudentAccent(loadStudentAccent())
  }, [])

  const accentTheme = useMemo(() => getStudentAccentTheme(studentAccent), [studentAccent])
  const accentVars = useMemo(() => ({
    '--student-accent': accentTheme.accent,
    '--student-accent-text': accentTheme.text,
    '--student-accent-soft': accentTheme.soft,
    '--student-accent-soft-strong': accentTheme.softStrong,
    '--student-accent-border': accentTheme.border,
  }) as CSSProperties, [accentTheme])
  const selectedSoftStyle = useMemo(() => ({
    backgroundColor: accentTheme.soft,
    color: accentTheme.text,
    borderColor: accentTheme.border,
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

  // Save/restore last conversation
  useEffect(() => {
    return () => {
      if (conversationId && selectedProfile) {
        localStorage.setItem(`chatbot_last_conversation_${sessionId}`, JSON.stringify({
          conversationId,
          profile: selectedProfile
        }))
      }
    }
  }, [conversationId, selectedProfile, sessionId])

  useEffect(() => {
    const saved = localStorage.getItem(`chatbot_last_conversation_${sessionId}`)
    if (saved) {
      try {
        const { conversationId: savedConvId, profile: savedProfile } = JSON.parse(saved)
        if (savedConvId && savedProfile) {
          setConversationId(savedConvId)
          setSelectedProfile(savedProfile)
          if (isMobile) {
            setMobileView('chat')
          }
          loadConversation(savedConvId)
        }
      } catch (err) {
        console.error('Error restoring conversation:', err)
      }
    }
  }, [sessionId])

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
  })

  // Fetch conversation history
  const { data: conversationsData, refetch: refetchConversations } = useQuery({
    queryKey: ['conversations', sessionId],
    queryFn: async () => {
      const res = await llmApi.getConversations(sessionId)
      return res.data as ConversationHistory[]
    },
    staleTime: 1000 * 60 * 2,
  })

  // Fetch available teacherbots for this session
  const { data: teacherbotsData } = useQuery({
    queryKey: ['student-teacherbots'],
    queryFn: async () => {
      const res = await teacherbotsApi.listAvailable()
      return res.data as Teacherbot[]
    },
    staleTime: 1000 * 60 * 2,
  })

  // Fetch teacherbot conversations
  const { data: teacherbotConversationsData, refetch: refetchTeacherbotConversations } = useQuery({
    queryKey: ['teacherbot-conversations', sessionId],
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

  const typewriterEffect = (fullContent: string, messageId: string) => {
    let currentIndex = 0
    const chunkSize = 3
    isGeneratingRef.current = true
    const interval = setInterval(() => {
      currentIndex += chunkSize
      if (currentIndex >= fullContent.length) {
        currentIndex = fullContent.length
        clearInterval(interval)
        isGeneratingRef.current = false
        setMessages(prev => prev.map(m =>
          m.id === messageId ? { ...m, content: fullContent } : m
        ))
      } else {
        setMessages(prev => prev.map(m =>
          m.id === messageId ? { ...m, content: fullContent.substring(0, currentIndex) } : m
        ))
      }
    }, 15)
  }

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

        if (existingHistory && existingHistory.length > 0 && convId) {
          for (const msg of existingHistory) {
            await llmApi.sendMessage(convId, msg.content, undefined, undefined, undefined)
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
      } else {
        refetchTeacherbotConversations()
      }

      // Focus input after bot response so user can type immediately
      setTimeout(() => {
        inputRef.current?.focus()
      }, 0)
    },
    onError: () => {
      const errorMessage: Message = {
        id: Date.now().toString(),
        role: 'assistant',
        content: 'Mi dispiace, si è verificato un errore. Riprova più tardi.',
        timestamp: new Date(),
      }
      setMessages((prev) => [...prev, errorMessage])
    },
  })

  const handleSend = useCallback((content?: string, files?: globalThis.File[]) => {
    const messageContent = content ?? input
    const messageFiles = files ?? attachedFiles.map(af => af.file)

    if ((!messageContent.trim() && messageFiles.length === 0) || sendMessageMutation.isPending) return

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
    sendMessageMutation.mutate({
      content: contentForApi,
      files: messageFiles,
      existingHistory: !conversationId && messages.length > 0 ? messages : undefined
    })
    setInput('')
    setAttachedFiles([])
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
    setConversationId(convId)
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
      const loadedMessages: Message[] = res.data.map((m: { id: string; role: string; content: string; created_at: string }) => ({
        id: m.id,
        role: m.role as 'user' | 'assistant',
        content: m.content,
        timestamp: new Date(m.created_at),
      }))
      setMessages(loadedMessages)
      const conv = conversationsData?.find(c => c.id === convId)
      if (conv) {
        setSelectedProfile(conv.profile_key)
      }
      if (isMobile) {
        setMobileView('chat')
      }
    } catch (err) {
      console.error('Error loading conversation:', err)
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
        <h2 className="text-lg font-bold text-slate-800 mb-4">Scegli un assistente AI</h2>
        <div className="grid grid-cols-2 gap-3">
          {profiles.map((profile) => (
            <motion.button
              key={profile.key}
              whileTap={{ scale: 0.97 }}
              onClick={() => handleSelectProfile(profile.key)}
              className={`text-left p-4 rounded-xl border-2 ${PROFILE_COLORS[profile.key] || 'border-gray-200'} bg-white shadow-sm active:shadow-none transition-all`}
            >
              <div className={`inline-flex items-center justify-center w-10 h-10 rounded-lg mb-2 ${PROFILE_COLORS[profile.key]?.split(' ').slice(0, 2).join(' ') || 'bg-gray-100'}`}>
                {PROFILE_ICONS[profile.key] || <Bot className="h-5 w-5" />}
              </div>
              <h3 className="font-semibold text-sm text-slate-800">{profile.name}</h3>
              <p className="text-xs text-slate-500 line-clamp-2 mt-1">{profile.description}</p>
            </motion.button>
          ))}
        </div>

        {/* Teacherbots section - Mobile */}
        {availableTeacherbots.length > 0 && (
          <div className="mt-6">
            <h3 className="text-base font-semibold text-slate-700 mb-3 flex items-center gap-2">
              <Wand2 className="h-4 w-4 text-indigo-600" />
              Teacherbots del Docente
            </h3>
            <div className="grid grid-cols-2 gap-3">
              {availableTeacherbots.map((bot) => (
                <motion.button
                  key={bot.id}
                  whileTap={{ scale: 0.97 }}
                  onClick={() => handleSelectTeacherbot(bot)}
                  className="text-left p-4 rounded-xl border-2 border-indigo-200 bg-white shadow-sm active:shadow-none transition-all"
                >
                  <div className={`inline-flex items-center justify-center w-10 h-10 rounded-lg mb-2 ${getTeacherbotColorClass(bot.color)}`}>
                    <Wand2 className="h-5 w-5 text-white" />
                  </div>
                  <h3 className="font-semibold text-sm text-slate-800">{bot.name}</h3>
                  <p className="text-xs text-slate-500 line-clamp-2 mt-1">{bot.synopsis}</p>
                </motion.button>
              ))}
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
        isLoading={sendMessageMutation.isPending}
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
        isLoading={sendMessageMutation.isPending}
        suggestedPrompts={currentProfile?.suggested_prompts}
      />
    )
  }

  // Profile selection screen (Desktop)
  if (!selectedProfile && !selectedTeacherbot) {
    return (
      <div className="h-full overflow-y-auto p-6 scrollbar-thin scrollbar-thumb-indigo-200 scrollbar-track-transparent">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {profiles.map((profile) => (
            <Card
              key={profile.key}
              className={`cursor-pointer transition-all hover:shadow-lg hover:scale-[1.02] border-2 ${PROFILE_COLORS[profile.key] || 'border-gray-200'}`}
              onClick={() => handleSelectProfile(profile.key)}
            >
              <CardHeader className="pb-2">
                <div className={`inline-flex items-center justify-center w-12 h-12 rounded-lg mb-2 ${PROFILE_COLORS[profile.key]?.split(' ').slice(0, 2).join(' ') || 'bg-gray-100'}`}>
                  {PROFILE_ICONS[profile.key] || <Bot className="h-6 w-6" />}
                </div>
                <CardTitle className="text-lg">{profile.name}</CardTitle>
                <CardDescription>{profile.description}</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex flex-wrap gap-1">
                  {profile.suggested_prompts.slice(0, 2).map((prompt, i) => (
                    <span key={i} className="text-xs px-2 py-1 bg-white/50 rounded-full">
                      {prompt}
                    </span>
                  ))}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Teacherbots section - Desktop */}
        {availableTeacherbots.length > 0 && (
          <div className="mt-8 pb-8">
            <h3 className="text-lg font-semibold text-slate-700 mb-4 flex items-center gap-2">
              <Wand2 className="h-5 w-5 text-indigo-600" />
              Teacherbots del Docente
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {availableTeacherbots.map((bot) => (
                <Card
                  key={bot.id}
                  className="cursor-pointer transition-all hover:shadow-lg hover:scale-[1.02] border-2 border-indigo-200 hover:border-indigo-400"
                  onClick={() => handleSelectTeacherbot(bot)}
                >
                  <CardHeader className="pb-2">
                    <div className={`inline-flex items-center justify-center w-12 h-12 rounded-lg mb-2 ${getTeacherbotColorClass(bot.color)}`}>
                      <Wand2 className="h-6 w-6 text-white" />
                    </div>
                    <CardTitle className="text-lg">{bot.name}</CardTitle>
                    <CardDescription>{bot.synopsis}</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <p className="text-xs text-slate-500 line-clamp-2">{bot.description}</p>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        )}
      </div>
    )
  }




  // Desktop Chat interface
  return (
    <div
      className="flex h-full md:h-[calc(100vh-7.2rem)] md:max-h-[920px] md:min-h-[500px] flex-col md:flex-row bg-slate-50 md:bg-white md:rounded-2xl overflow-hidden md:shadow-lg md:border md:border-slate-200 relative md:my-1.5 md:mb-5"
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
                      title="Elimina conversazione"
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
                const isImage = fileObj.type.startsWith('image/')
                const attached: AttachedFile = {
                  file: fileObj,
                  type: isImage ? 'image' : 'document',
                }
                if (isImage) {
                  const reader = new FileReader()
                  reader.onload = (ev) => {
                    attached.preview = ev.target?.result as string
                    setAttachedFiles(prev => [...prev, attached])
                  }
                  reader.readAsDataURL(fileObj)
                } else {
                  setAttachedFiles(prev => [...prev, attached])
                }
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
            fetch(imageData)
              .then(res => res.blob())
              .then(blob => {
                const fileObj = Object.assign(blob, {
                  name: `immagine_${Date.now()}.png`,
                  lastModified: Date.now()
                }) as File
                setAttachedFiles(prev => [...prev, { file: fileObj, type: 'image' as const, preview: imageData }])
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
            setAttachedFiles(prev => [...prev, { file: fileObj, type: 'document' as const }])
            return
          }

          const files = Array.from(e.dataTransfer.files)
          files.forEach(file => {
            const isImage = (file as File).type.startsWith('image/')
            const attached: AttachedFile = {
              file: file as File,
              type: isImage ? 'image' : 'document',
            }
            if (isImage) {
              const reader = new FileReader()
              reader.onload = (ev) => {
                attached.preview = ev.target?.result as string
                setAttachedFiles(prev => [...prev, attached])
              }
              reader.readAsDataURL(file as File)
            } else {
              setAttachedFiles(prev => [...prev, attached])
            }
          })
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
                title="Scegli colore"
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
                        Imposta default
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
                className="flex items-center gap-2 px-4 py-2 rounded-full text-xs font-semibold transition-all shadow-sm hover:opacity-90"
                style={selectedSolidStyle}
              >
                <Bot className="h-3.5 w-3.5 text-white/90" />
                <span>{effectiveSelectedModel?.name || 'Modello AI'}</span>
                <ChevronDown className={`h-3 w-3 text-white/80 transition-transform ${showModelMenu ? 'rotate-180' : ''}`} />
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
                        <div className="min-w-0">
                          <div className="text-sm font-semibold truncate">{m.name}</div>
                          <div className="text-[10px] text-slate-400">{m.provider}</div>
                        </div>
                        <button
                          className={`w-4 h-4 rounded border flex items-center justify-center ${isDefault ? '' : 'border-slate-300'}`}
                          style={isDefault ? selectedSolidStyle : undefined}
                          onClick={(e) => handleSetDefaultModel(m, e)}
                          title="Imposta come default"
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
        <div className={`flex-1 overflow-y-auto overflow-x-hidden px-3 py-3 md:px-4 md:py-6 space-y-3 md:space-y-6 ${chatBgIsDark ? 'text-white' : ''}`} style={{ WebkitOverflowScrolling: 'touch', scrollBehavior: 'smooth' }}>
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
              <h3 className={`font-bold text-xl mb-2 ${chatBgIsDark ? 'text-white' : 'text-slate-800'}`}>Ciao! Sono {selectedTeacherbot ? selectedTeacherbot.name : currentProfile?.name}</h3>
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
                    <MessageContent content={message.content} onQuizSubmit={(answers) => setInput(answers)} darkMode={chatBgIsDark} />
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
          {sendMessageMutation.isPending && (
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
                  ) : (
                    <div className="w-10 h-10 md:w-16 md:h-16 bg-slate-100 rounded-lg border flex items-center justify-center">
                      <File className="h-4 w-4 md:h-6 md:w-6 text-slate-400" />
                    </div>
                  )}
                  <button
                    onClick={() => setAttachedFiles(prev => prev.filter((_, i) => i !== idx))}
                    className="absolute -top-1 -right-1 w-4 h-4 md:w-5 md:h-5 bg-red-500 text-white rounded-full flex items-center justify-center"
                  >
                    <X className="h-2 w-2 md:h-3 md:w-3" />
                  </button>
                </div>
              ))}
            </div>
          )}

          <div className="p-2 md:p-3 bg-white/95 backdrop-blur-sm md:bg-transparent">
            <div
              className="relative flex items-end gap-2 bg-white border-2 rounded-[2rem] p-1.5 pl-3 transition-all shadow-sm"
              style={{ borderColor: accentTheme.border, boxShadow: `0 0 0 0 ${accentTheme.accent}` }}
            >
              <input type="file" ref={fileInputRef} className="hidden" multiple onChange={(e) => {
                const files = Array.from(e.target.files || [])
                files.forEach(file => {
                  const isImage = file.type.startsWith('image/')
                  const attached: AttachedFile = { file, type: isImage ? 'image' : 'document' }
                  if (isImage) {
                    const reader = new FileReader()
                    reader.onload = (ev) => {
                      attached.preview = ev.target?.result as string
                      setAttachedFiles(prev => [...prev, attached])
                    }
                    reader.readAsDataURL(file)
                  } else {
                    setAttachedFiles(prev => [...prev, attached])
                  }
                })
                e.target.value = ''
              }}
              />

              <Button
                variant="ghost" size="icon" className="h-9 w-9 text-slate-400 hover:bg-slate-100 rounded-full flex-shrink-0"
                style={{ color: 'inherit' }}
                onClick={() => fileInputRef.current?.click()}
              >
                <Paperclip className="h-5 w-5" />
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
                  placeholder={profileInterview.active ? "Rispondi alla domanda guidata..." : (attachedFiles.length > 0 ? "Descrivi..." : "Scrivi un messaggio...")}
                  disabled={sendMessageMutation.isPending}
                  className="w-full py-2.5 bg-transparent border-none text-sm focus:ring-0 focus:outline-none outline-none placeholder:text-slate-400"
                />
              </div>

              <Button
                onClick={() => handleSend()}
                disabled={(!input.trim() && attachedFiles.length === 0) || sendMessageMutation.isPending}
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

          <div className="hidden lg:flex items-center justify-center gap-4 mt-2 pb-4 flex-wrap">
            <div className="flex items-center gap-2">
              <span className="text-xs text-slate-400">Generatore:</span>
              <div className="flex items-center bg-slate-100 rounded-lg p-0.5">
                <button
                  onClick={() => setImageProvider('flux-schnell')}
                  className={`px-2 py-1 text-xs rounded-md transition-all ${imageProvider === 'flux-schnell' ? 'bg-white shadow text-fuchsia-600 font-medium' : 'text-slate-500 hover:text-slate-700'}`}
                >
                  Flux
                </button>
                <button
                  onClick={() => setImageProvider('dall-e')}
                  className={`px-2 py-1 text-xs rounded-md transition-all ${imageProvider === 'dall-e' ? 'bg-white shadow text-fuchsia-600 font-medium' : 'text-slate-500 hover:text-slate-700'}`}
                >
                  DALL-E
                </button>
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

function MessageContent({ content, onQuizSubmit, darkMode = false }: { content: string; onQuizSubmit: (answers: string) => void; darkMode?: boolean }) {
  const { quiz, csv, textContent, isGenerating, generationType } = parseContentBlocks(content)
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
            code: ({ className, children, ...props }) => {
              const isInline = !className
              return isInline ? (
                <code className={`${darkMode ? 'bg-white/10 text-white' : 'bg-slate-100 text-fuchsia-600'} px-1.5 py-0.5 rounded text-xs font-mono`} {...props}>
                  {children}
                </code>
              ) : (
                <code className={`block ${darkMode ? 'bg-white/10 text-white' : 'bg-slate-900 text-slate-100'} p-3 rounded-lg text-xs font-mono overflow-x-auto my-2`} {...props}>
                  {children}
                </code>
              )
            },
            pre: ({ children }) => <>{children}</>,
            ul: ({ children }) => <ul className="list-disc pl-4 mb-2 space-y-1">{children}</ul>,
            ol: ({ children }) => <ol className="list-decimal pl-4 mb-2 space-y-1">{children}</ol>,
            li: ({ children }) => <li className={`text-sm ${darkMode ? 'text-white' : ''}`}>{children}</li>,
            strong: ({ children }) => <strong className={`font-semibold ${darkMode ? 'text-white' : 'text-slate-800'}`}>{children}</strong>,
            h1: ({ children }) => <h1 className={`text-lg font-bold mb-2 ${darkMode ? 'text-white' : 'text-slate-800'}`}>{children}</h1>,
            h2: ({ children }) => <h2 className={`text-base font-bold mb-2 ${darkMode ? 'text-white' : 'text-slate-800'}`}>{children}</h2>,
            h3: ({ children }) => <h3 className={`text-sm font-bold mb-1 ${darkMode ? 'text-white' : 'text-slate-800'}`}>{children}</h3>,
            blockquote: ({ children }) => <blockquote className={`border-l-4 ${darkMode ? 'border-white/30 text-white/80' : 'border-fuchsia-300 text-slate-600'} pl-3 italic my-2`}>{children}</blockquote>,
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
              }} className="absolute top-2 right-2 bg-white/90 hover:bg-white p-2 rounded-lg shadow-md opacity-0 group-hover:opacity-100 transition-opacity" title="Scarica immagine">
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
    </div>
  )
}

interface QuizQuestion {
  question: string
  options: string[]
  correctIndex: number
  explanation?: string
}

interface QuizData {
  title: string
  questions: QuizQuestion[]
}

function parseContentBlocks(content: string): { quiz: QuizData | null; csv: string | null; textContent: string; isGenerating: boolean; generationType: string | null } {
  let textContent = content
  let quiz: QuizData | null = null
  let csv: string | null = null
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
    return { quiz, csv, textContent, isGenerating: false, generationType: null }
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
      quiz = JSON.parse(quizMatch[1].trim())
      textContent = textContent.replace(/```quiz[\s\S]*?```/, '').trim()
      isGenerating = false
    } catch {
      if (quizMatch[1].includes('{')) {
        isGenerating = true
        generationType = 'quiz'
        textContent = textContent.replace(/```quiz[\s\S]*?```/, '').trim()
      }
    }
  }

  const csvMatch = content.match(/```csv\s*([\s\S]*?)```/)
  if (csvMatch) {
    csv = csvMatch[1].trim()
    textContent = textContent.replace(/```csv[\s\S]*?```/, '').trim()
    isGenerating = false
  }

  textContent = textContent.replace(/```json[\s\S]*?```/g, '').trim()

  return { quiz, csv, textContent, isGenerating, generationType }
}

function InteractiveQuiz({ quiz, onSubmitAnswers }: { quiz: QuizData; onSubmitAnswers: (answers: string) => void }) {
  const [answers, setAnswers] = useState<Record<number, number>>({})
  const [submitted, setSubmitted] = useState(false)
  const [showExplanations, setShowExplanations] = useState(false)

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
