import { useState, useRef, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import {
  Send, Bot, Paperclip, X, Trash2, Plus, File, Image as ImageIcon, Loader2,
  Database, Download, ChevronDown, ChevronRight, Edit3
} from 'lucide-react'
import { llmApi, teacherApi } from '@/lib/api'
import { useToast } from '@/components/ui/use-toast'
import { useQuery } from '@tanstack/react-query'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'
import 'katex/dist/katex.min.css'
import { ContentEditorModal } from '@/components/ContentEditorModal'

// Constants
const AVAILABLE_MODELS = [
  { id: 'gpt-5-mini', name: 'GPT-5 Mini', provider: 'openai' },
  { id: 'gpt-5-nano', name: 'GPT-5 Nano', provider: 'openai' },
  { id: 'claude-haiku-4-5-20251001', name: 'Claude Haiku 4.5', provider: 'anthropic' },
  { id: 'mistral-nemo', name: 'Mistral Nemo', provider: 'ollama' },
  { id: 'deepseek-r1:8b', name: 'DeepSeek R1', provider: 'ollama' },
]

const AGENT_MODES = [
  { id: 'default', label: 'Chat' },
  { id: 'web_search', label: 'Web Search' },
  { id: 'report', label: 'Report' },
  { id: 'quiz', label: 'Quiz' },
  { id: 'image', label: 'Immagine' },
  { id: 'dataset', label: 'Dataset' },
] as const

type AgentMode = typeof AGENT_MODES[number]['id']

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

interface Message {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  timestamp: Date
}

interface Conversation {
  id: string
  title: string
  messages: Message[]
  createdAt: Date
}

interface AttachedFile {
  file: globalThis.File
  preview?: string
  type: 'image' | 'document'
}

interface WebSearchProgress {
  status: string
  sources: Array<{
    index: number
    title: string
    url: string
    status: 'fetching' | 'done' | 'error'
    content_length?: number
    error?: string
  }>
  intent?: string
  confidence?: number
}

export default function TeacherSupportChat() {
  const { toast } = useToast()
  const [messages, setMessages] = useState<Message[]>([])
  const [inputText, setInputText] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [selectedModel, setSelectedModel] = useState(AVAILABLE_MODELS[0].id)
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [currentConversationId, setCurrentConversationId] = useState<string | null>(null)
  const [attachedFiles, setAttachedFiles] = useState<AttachedFile[]>([])
  const [agentMode, setAgentMode] = useState<AgentMode>('default')
  const [imageProvider, setImageProvider] = useState<'dall-e' | 'flux-schnell'>('flux-schnell')
  const [imageSize, setImageSize] = useState<string>('1024x1024')
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false)
  const [webSearchProgress, setWebSearchProgress] = useState<WebSearchProgress | null>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Publish Modal State
  const [publishModal, setPublishModal] = useState<{ isOpen: boolean, type: 'quiz' | 'dataset', data: any }>({ 
    isOpen: false,
    type: 'quiz',
    data: null
  })

  // Editor Modal State (for editing quiz before publishing)
  const [editorModal, setEditorModal] = useState<{ isOpen: boolean, type: 'quiz' | 'dataset', data: any }>({ 
    isOpen: false,
    type: 'quiz',
    data: null
  })

  // Fetch classes/sessions for publishing
  const { data: classesData } = useQuery({
    queryKey: ['teacher-classes-publish'],
    queryFn: async () => {
      const classesRes = await teacherApi.getClasses()
      const classes = classesRes.data || []
      const allSessions: any[] = []
      for (const cls of classes) {
        try {
          const sessionsRes = await teacherApi.getSessions(cls.id)
          const sessions = sessionsRes.data || []
          sessions.forEach((s: any) => {
            allSessions.push({ id: s.id, name: s.title || s.name, class_name: cls.name })
          })
        } catch (e) { } // Ignore errors for individual session fetches
      }
      return allSessions
    },
  })

  // Auto-scroll
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // Load history
  useEffect(() => {
    const saved = localStorage.getItem('teacher_support_conversations')
    if (saved) {
      try {
        const parsed = JSON.parse(saved)
        setConversations(parsed.map((c: Conversation) => ({
          ...c,
          createdAt: new Date(c.createdAt),
          messages: c.messages.map(m => ({ ...m, timestamp: new Date(m.timestamp) }))
        })))
      } catch (e) { console.error(e) } // Handle potential JSON parsing errors
    }
  }, [])

  useEffect(() => {
    if (conversations.length > 0) {
      try {
        localStorage.setItem('teacher_support_conversations', JSON.stringify(conversations))
      } catch (e) {
        console.warn("Storage full, attempting to save without heavy content")
        try {
          // Create a lightweight copy of conversations for storage
          // Remove base64 images from content
          const cleanConversations = conversations.map(c => ({
            ...c,
            messages: c.messages.map(m => ({
              ...m,
              content: m.content.replace(/!\(.*\)\(data:image\/.*?\)/g, '![Immagine non salvata (troppo grande)]()')
            }))
          }))
          localStorage.setItem('teacher_support_conversations', JSON.stringify(cleanConversations))
        } catch (e2) {
          console.error("Failed to save history to localStorage even after cleanup:", e2)
        }
      }
    }
  }, [conversations])

  const addFiles = (files: globalThis.File[]) => {
    const newFiles: AttachedFile[] = files.map(file => {
      const isImage = file.type.startsWith('image/')
      const attached: AttachedFile = {
        file,
        type: isImage ? 'image' : 'document',
      }
      if (isImage) {
        attached.preview = URL.createObjectURL(file)
      }
      return attached
    })
    setAttachedFiles(prev => [...prev, ...newFiles])
  }

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) addFiles(Array.from(e.target.files))
  }

  const removeFile = (index: number) => {
    setAttachedFiles(prev => {
      const newFiles = [...prev]
      if (newFiles[index].preview) {
        URL.revokeObjectURL(newFiles[index].preview!)
      }
      newFiles.splice(index, 1)
      return newFiles
    })
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    
    // Handle image from chatbot
    const imageData = e.dataTransfer.getData('application/x-chatbot-image')
    if (imageData) {
      const data = JSON.parse(imageData)
      fetch(data.url)
        .then(res => res.blob())
        .then(blob => {
          const fileObj = Object.assign(blob, { 
            name: data.filename || `immagine_${Date.now()}.png`,
            lastModified: Date.now()
          }) as File
          setAttachedFiles(prev => [...prev, { file: fileObj, type: 'image' as const, preview: data.url }])
        })
      return
    }
    
    // Handle CSV from chatbot dataset generator
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

    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      addFiles(Array.from(e.dataTransfer.files))
    }
  }

  const handleSend = async () => {
    if ((!inputText.trim() && attachedFiles.length === 0) || isLoading) return

    const filesInfo = attachedFiles.length > 0 ? ` [Allegati: ${attachedFiles.map(f => f.file.name).join(', ')}]` : ''
    let messageContent = inputText.trim() || 'Analizza questi documenti'
    
    // Handle specific agent modes
    if (inputText.trim() && agentMode !== 'default' && agentMode !== 'image') {
      const prefixes = {
        web_search: '🌐 RICERCA WEB:',
        report: '📈 GENERA REPORT:',
        dataset: '📊 GENERA DATASET:',
        quiz: '❓ GENERA QUIZ:',
      }
      // Only append prefix if not already present
      // @ts-ignore
      const prefix = prefixes[agentMode] || ''
      if (prefix && !messageContent.startsWith(prefix)) {
        messageContent = `${prefix} ${messageContent}`
      }
    }

    const userMessage: Message = {
      id: `msg-${Date.now()}`,
      role: 'user',
      content: messageContent + filesInfo,
      timestamp: new Date()
    }

    setMessages(prev => [...prev, userMessage])
    setInputText('')
    const currentFiles = [...attachedFiles]
    setAttachedFiles([])
    setIsLoading(true)

    try {
      if (agentMode === 'image') {
        // IMAGE GENERATION FLOW
        // 1. Intent Detection & Prompt Design (Expansion)
        const expansionPrompt = `Sei un esperto Prompt Engineer. Il tuo compito è scrivere un prompt dettagliato e ottimizzato per generare un'immagine con il modello ${imageProvider === 'dall-e' ? 'DALL-E 3' : 'Flux Schnell'}.
        
        Descrizione utente: "${messageContent}"
        
        Regole:
        - Scrivi SOLO il prompt in inglese.
        - Sii molto descrittivo, specifica stile, illuminazione, composizione e dettagli.
        - Non aggiungere altro testo, solo il prompt.`

        const expansionResponse = await llmApi.teacherChat(
          expansionPrompt,
          [], // No history needed for prompt expansion context usually, or maybe beneficial?
          'teacher_support',
          'openai', // Use a smart model for expansion
          'gpt-5-mini'
        )
        
        const enhancedPrompt = expansionResponse.data?.response?.trim() || messageContent
        
        // 2. Generation Request
        console.log("Generating image with prompt:", enhancedPrompt, "Provider:", imageProvider)
        const genResponse = await llmApi.generateImage(enhancedPrompt, imageProvider)
        const imageUrl = genResponse.data?.image_url
        console.log("Image URL received:", imageUrl ? imageUrl.substring(0, 50) + "..." : "None")

        if (imageUrl) {
          const assistantMessage: Message = {
            id: `resp-${Date.now()}`,
            role: 'assistant',
            content: `🎨 **Immagine Generata**\n\n![Generata](${imageUrl})\n\n**Prompt Effettivo:**\n\`${enhancedPrompt}\``,
            timestamp: new Date()
          }
          if (currentConversationId) {
            setConversations(prev => prev.map(c => 
              c.id === currentConversationId ? { ...c, messages: [...c.messages, userMessage, assistantMessage] } : c
            ))
          } else {
             const newConv: Conversation = {
              id: `conv-${Date.now()}`,
              title: `Immagine: ${messageContent.substring(0, 30)}`,
              messages: [userMessage, assistantMessage],
              createdAt: new Date()
            }
            setConversations(prev => [newConv, ...prev])
            setCurrentConversationId(newConv.id)
          }
        } else {
          throw new Error("Nessuna URL immagine ricevuta")
        }

      } else if (agentMode === 'web_search' || agentMode === 'quiz' || agentMode === 'dataset') {
        // STREAMING WEB SEARCH, QUIZ or DATASET FLOW - Always use Claude Haiku
        const history = messages.map(m => ({ role: m.role, content: m.content }))

        // Initialize progress state
        setWebSearchProgress({ status: 'Inizializzazione...', sources: [] })

        try {
          const response = await fetch('/api/v1/llm/teacher/chat-stream', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            credentials: 'include', // Send cookies for authentication
            body: JSON.stringify({
              content: messageContent,
              history,
              provider: 'anthropic',
              model: 'claude-haiku-4-5-20251001'
            })
          })

          if (!response.ok) throw new Error('Stream request failed')

          const reader = response.body?.getReader()
          const decoder = new TextDecoder()
          let finalContent = ''

          if (reader) {
            while (true) {
              const { done, value } = await reader.read()
              if (done) break

              const chunk = decoder.decode(value)
              const lines = chunk.split('\n')

              for (const line of lines) {
                if (line.startsWith('data: ')) {
                  try {
                    const data = JSON.parse(line.slice(6))

                    if (data.type === 'status') {
                      setWebSearchProgress(prev => ({
                        ...prev!,
                        status: data.message
                      }))
                    } else if (data.type === 'intent') {
                      setWebSearchProgress(prev => ({
                        ...prev!,
                        intent: data.intent,
                        confidence: data.confidence
                      }))
                    } else if (data.type === 'source') {
                      setWebSearchProgress(prev => {
                        const sources = [...(prev?.sources || [])]
                        const existingIdx = sources.findIndex(s => s.index === data.index)
                        if (existingIdx >= 0) {
                          sources[existingIdx] = data
                        } else {
                          sources.push(data)
                        }
                        return { ...prev!, sources }
                      })
                    } else if (data.type === 'done') {
                      finalContent = data.content
                    } else if (data.type === 'error') {
                      throw new Error(data.message)
                    }
                  } catch (e) {
                    // Skip invalid JSON
                  }
                }
              }
            }
          }

          // Clear progress and show result
          setWebSearchProgress(null)

          const assistantMessage: Message = {
            id: `resp-${Date.now()}`,
            role: 'assistant',
            content: finalContent || 'Nessun risultato dalla generazione.',
            timestamp: new Date()
          }

          setMessages(prev => [...prev, assistantMessage])

          // Update History
          if (currentConversationId) {
            setConversations(prev => prev.map(c =>
              c.id === currentConversationId ? { ...c, messages: [...c.messages, userMessage, assistantMessage] } : c
            ))
          } else {
            const newConv: Conversation = {
              id: `conv-${Date.now()}`,
              title: `${agentMode === 'quiz' ? '❓' : '🌐'} ${userMessage.content.substring(0, 35)}`,
              messages: [userMessage, assistantMessage],
              createdAt: new Date()
            }
            setConversations(prev => [newConv, ...prev])
            setCurrentConversationId(newConv.id)
          }
        } catch (e) {
          setWebSearchProgress(null)
          throw e
        }
      } else {
        // STANDARD CHAT FLOW
        const history = messages.map(m => ({ role: m.role, content: m.content }))
        const modelInfo = AVAILABLE_MODELS.find(m => m.id === selectedModel)

        let response;
        if (currentFiles.length > 0) {
          response = await llmApi.teacherChatWithFiles(
            messageContent,
            history,
            'teacher_support',
            modelInfo?.provider || 'openai',
            selectedModel,
            currentFiles.map(f => f.file),
            imageProvider,
            imageSize
          )
        } else {
          response = await llmApi.teacherChat(
            userMessage.content,
            history,
            'teacher_support',
            modelInfo?.provider || 'openai',
            selectedModel,
            imageProvider,
            imageSize
          )
        }

        const assistantMessage: Message = {
          id: `resp-${Date.now()}`,
          role: 'assistant',
          content: response.data?.response || 'Errore nella risposta.',
          timestamp: new Date()
        }

        setMessages(prev => [...prev, assistantMessage])

        // Update History
        if (currentConversationId) {
          setConversations(prev => prev.map(c =>
            c.id === currentConversationId ? { ...c, messages: [...c.messages, userMessage, assistantMessage] } : c
          ))
        } else {
          const newConv: Conversation = {
            id: `conv-${Date.now()}`,
            title: userMessage.content.substring(0, 40) || 'Nuova conversazione',
            messages: [userMessage, assistantMessage],
            createdAt: new Date()
          }
          setConversations(prev => [newConv, ...prev])
          setCurrentConversationId(newConv.id)
        }
      }
    } catch (e) {
      console.error(e)
      toast({ title: "Errore", description: "Impossibile completare la richiesta.", variant: "destructive" })
      const errorMsg: Message = {
         id: `err-${Date.now()}`,
         role: 'assistant',
         content: "Si è verificato un errore durante la generazione. Riprova.",
         timestamp: new Date()
      }
      setMessages(prev => [...prev, errorMsg])
    } finally {
      setIsLoading(false)
    }
  }

  const handleNewChat = () => {
    setMessages([])
    setCurrentConversationId(null)
    setAttachedFiles([])
  }

  const handlePublish = async (sessionId: string) => {
    if (!publishModal.data) return
    
    try {
      let contentJson = ""
      let taskType = ""
      let title = ""
      let numQuestions = 0

      if (publishModal.type === 'quiz') {
        contentJson = JSON.stringify({
          type: 'quiz',
          questions: publishModal.data.questions.map((q: any) => ({
            question: q.question,
            options: q.options,
            correctIndex: q.correctIndex,
            explanation: q.explanation
          }))
        })
        taskType = 'quiz'
        title = publishModal.data.title || "Nuovo Quiz"
        numQuestions = publishModal.data.questions?.length || 0
      } else {
        contentJson = JSON.stringify({
          type: 'exercise',
          text: `Analizza il seguente dataset CSV:\n\n${publishModal.data}`
        })
        taskType = 'exercise'
        title = "Analisi Dataset CSV"
      }

      // Create the task
      await teacherApi.createTask(sessionId, {
        title,
        description: `Compito creato da AI Support (${publishModal.type})`,
        task_type: taskType,
        content_json: contentJson
      })

      // Send notification to class chat
      const notificationMessage = publishModal.type === 'quiz'
        ? `📝 **Nuovo Quiz Pubblicato!**\n\n🎯 **${title}**\n📊 ${numQuestions} domande\n\n👉 Vai alla sezione **Compiti** per completarlo!`
        : `📊 **Nuovo Compito Pubblicato!**\n\n🎯 **${title}**\n\n👉 Vai alla sezione **Compiti** per completarlo!`
      
      try {
        await teacherApi.sendClassMessage(sessionId, notificationMessage)
      } catch (chatErr) {
        console.warn("Could not send chat notification:", chatErr)
      }

      toast({ title: "Compito pubblicato!", description: "Notifica inviata agli studenti", className: "bg-green-500 text-white" })
      setPublishModal({ isOpen: false, type: 'quiz', data: null })
    } catch (e) {
      console.error(e)
      toast({ title: "Errore pubblicazione", variant: "destructive" })
    }
  }

  return (
    <>
      <div 
        className="flex h-full bg-slate-50 font-sans"
        onDragOver={(e) => e.preventDefault()}
        onDrop={handleDrop}
      >
        
        {/* SIDEBAR - History */}
        <aside className={`${isSidebarCollapsed ? 'w-12' : 'w-80'} bg-white border-r border-slate-200 flex flex-col hidden md:flex transition-all duration-300`}>
          <div className={`p-4 border-b border-slate-100 flex items-center ${isSidebarCollapsed ? 'justify-center' : 'justify-between'}`}>
            {!isSidebarCollapsed && <h2 className="text-sm font-semibold text-slate-800 tracking-tight">Cronologia</h2>}
            <div className="flex gap-1">
              {!isSidebarCollapsed && (
                <Button variant="ghost" size="sm" onClick={handleNewChat} className="h-8 w-8 p-0 hover:bg-slate-100" title="Nuova chat">
                  <Plus className="h-4 w-4 text-slate-600" />
                </Button>
              )}
              <Button 
                variant="ghost" 
                size="sm" 
                onClick={() => setIsSidebarCollapsed(!isSidebarCollapsed)} 
                className="h-8 w-8 p-0 hover:bg-slate-100"
                title={isSidebarCollapsed ? "Espandi cronologia" : "Comprimi cronologia"}
              >
                {isSidebarCollapsed ? <ChevronRight className="h-4 w-4 text-slate-600" /> : <ChevronDown className="h-4 w-4 text-slate-400 rotate-90" />}
              </Button>
            </div>
          </div>
          
          <div className="flex-1 overflow-y-auto p-3 space-y-1">
            {!isSidebarCollapsed ? (
              conversations.map(conv => (
                <button
                  key={conv.id}
                  onClick={() => { setMessages(conv.messages); setCurrentConversationId(conv.id); }}
                  className={`w-full text-left p-3 rounded-lg text-sm transition-all group ${ 
                    currentConversationId === conv.id 
                      ? 'bg-cyan-50 text-cyan-700 font-medium' 
                      : 'text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  <div className="truncate">{conv.title}</div>
                  <div className="flex items-center justify-between mt-1">
                    <span className="text-xs text-slate-400">{conv.createdAt.toLocaleDateString()}</span>
                    <button
                      className="text-slate-300 opacity-0 group-hover:opacity-100 hover:text-red-500 transition-opacity p-1"
                      onClick={(e) => {
                        e.stopPropagation()
                        if (confirm('Eliminare questa conversazione?')) {
                          setConversations(prev => prev.filter(c => c.id !== conv.id))
                          if (currentConversationId === conv.id) handleNewChat()
                        }
                      }}
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </div>
                </button>
              ))
            ) : (
              <div className="flex flex-col gap-2 items-center">
                <Button variant="ghost" size="icon" onClick={handleNewChat} title="Nuova chat" className="p-0">
                  <Plus className="h-5 w-5 text-cyan-600" />
                </Button>
                {conversations.map(conv => (
                  <div 
                    key={conv.id} 
                    className={`w-2 h-2 rounded-full cursor-pointer ${currentConversationId === conv.id ? 'bg-cyan-500' : 'bg-slate-300'}`}
                    title={conv.title}
                    onClick={() => { setMessages(conv.messages); setCurrentConversationId(conv.id); }}
                  />
                ))}
              </div>
            )}
          </div>
        </aside>

        {/* MAIN CHAT AREA */}
        <main className="flex-1 flex flex-col relative bg-slate-50/50">
          
          <header className="h-14 border-b border-slate-200 bg-white/80 backdrop-blur-sm px-6 flex items-center justify-between sticky top-0 z-10">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-cyan-600 flex items-center justify-center shadow-md">
                <Bot className="h-5 w-5 text-white" />
              </div>
              <div>
                <h1 className="text-sm font-bold text-slate-800">Supporto Docente AI</h1>
                <p className="text-xs text-slate-500">
                  {(agentMode === 'quiz' || agentMode === 'dataset' || agentMode === 'web_search') 
                    ? 'Claude Haiku' 
                    : AVAILABLE_MODELS.find(m => m.id === selectedModel)?.name}
                </p>
              </div>
            </div>
            
            {(agentMode === 'quiz' || agentMode === 'dataset' || agentMode === 'web_search') ? (
              <div className="text-xs bg-purple-100 text-purple-700 rounded-md px-3 py-1.5 font-medium">
                🤖 Claude Haiku (fisso)
              </div>
            ) : (
              <select 
                className="text-xs bg-slate-100 border-none rounded-md px-2 py-1 text-slate-600 focus:ring-0"
                value={selectedModel}
                onChange={(e) => setSelectedModel(e.target.value)}
              >
                {AVAILABLE_MODELS.map(m => (
                  <option key={m.id} value={m.id}>{m.name}</option>
                ))}
              </select>
            )}
          </header>

          <div className="flex-1 overflow-y-auto px-6 py-8 space-y-8">
            {messages.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center opacity-50">
                <Bot className="h-12 w-12 text-slate-300 mb-4" />
                <p className="text-slate-400 font-medium">Inizia una nuova conversazione o trascina dei file qui</p>
              </div>
            ) : (
              messages.map((msg) => (
                <div key={msg.id} className={`flex gap-4 ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  {msg.role === 'assistant' && (
                    <div className="w-8 h-8 rounded-full bg-white border border-slate-200 flex items-center justify-center flex-shrink-0">
                      <Bot className="h-4 w-4 text-cyan-600" />
                    </div>
                  )}
                  <div className={`max-w-[75%] space-y-1 ${msg.role === 'user' ? 'items-end flex flex-col' : 'items-start'}`}>
                    <div className={`px-5 py-3.5 text-sm leading-relaxed shadow-sm ${ 
                      msg.role === 'user' ? 'bg-cyan-500 text-cyan-950 rounded-2xl rounded-tr-sm' : 'bg-white text-slate-800 border border-slate-200 rounded-2xl rounded-tl-sm'
                    }`}> 
                      {msg.role === 'assistant' ? (
                        <MessageContent 
                          content={msg.content} 
                          onPublish={(type, data) => setPublishModal({ isOpen: true, type, data })}
                          onEdit={(type, data) => setEditorModal({ isOpen: true, type, data })}
                          toast={toast}
                        />
                      ) : (
                        <ReactMarkdown className="prose prose-sm max-w-none prose-cyan">
                          {convertEmoticons(msg.content)}
                        </ReactMarkdown>
                      )}
                    </div>
                    <span className="text-[10px] text-slate-400 px-1">{msg.timestamp.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</span>
                  </div>
                </div>
              ))
            )}
            {isLoading && !webSearchProgress && (
              <div className="flex gap-4 justify-start">
                <div className="w-8 h-8 rounded-full bg-white border border-slate-200 flex items-center justify-center">
                  <Bot className="h-4 w-4 text-cyan-600" />
                </div>
                <div className="bg-white border border-slate-200 px-4 py-3 rounded-2xl rounded-tl-sm shadow-sm">
                  <Loader2 className="h-4 w-4 animate-spin text-cyan-600" />
                </div>
              </div>
            )}

            {/* Web Search/Quiz Progress Panel */}
            {webSearchProgress && (
              <div className="flex gap-4 justify-start">
                <div className="w-8 h-8 rounded-full bg-blue-100 border border-blue-200 flex items-center justify-center flex-shrink-0">
                  <svg className="h-4 w-4 text-blue-600 animate-pulse" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                  </svg>
                </div>
                <div className="flex-1 max-w-[75%] bg-gradient-to-br from-blue-50 to-indigo-50 border border-blue-200 px-5 py-4 rounded-2xl rounded-tl-sm shadow-sm">
                  <div className="flex items-center gap-2 mb-3">
                    <Loader2 className="h-4 w-4 animate-spin text-blue-600" />
                    <span className="font-medium text-blue-800 text-sm">{webSearchProgress.status}</span>
                  </div>

                  {webSearchProgress.intent && (
                    <div className="text-xs text-blue-600 mb-3 bg-blue-100 px-2 py-1 rounded inline-block">
                      Modalità: {webSearchProgress.intent} (confidenza: {Math.round((webSearchProgress.confidence || 0) * 100)}%)
                    </div>
                  )}

                  {webSearchProgress.sources.length > 0 && (
                    <div className="space-y-2 mt-3 border-t border-blue-200 pt-3">
                      <div className="text-xs font-medium text-blue-700 mb-2">📰 Fonti in fase di lettura:</div>
                      {webSearchProgress.sources.map((source) => (
                        <div key={source.index} className="flex items-start gap-2 text-xs">
                          {source.status === 'fetching' && (
                            <Loader2 className="h-3 w-3 animate-spin text-blue-500 mt-0.5 flex-shrink-0" />
                          )}
                          {source.status === 'done' && (
                            <svg className="h-3 w-3 text-green-500 mt-0.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                            </svg>
                          )}
                          {source.status === 'error' && (
                            <svg className="h-3 w-3 text-red-500 mt-0.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                            </svg>
                          )}
                          <div className="flex-1 min-w-0">
                            <div className="font-medium text-slate-700 truncate">{source.title}</div>
                            <a href={source.url} target="_blank" rel="noopener noreferrer" className="text-blue-500 hover:underline truncate block">
                              {source.url.substring(0, 50)}...
                            </a>
                            {source.status === 'done' && source.content_length && (
                              <span className="text-green-600">✓ {source.content_length} caratteri estratti</span>
                            )}
                            {source.status === 'error' && source.error && (
                              <span className="text-red-500">✗ {source.error}</span>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          <div className="p-4 bg-white border-t border-slate-200">
            <div className="max-w-4xl mx-auto">
              
              <div className="flex gap-2 mb-3">
                {AGENT_MODES.map(m => (
                  <button
                    key={m.id}
                    onClick={() => setAgentMode(m.id)}
                    className={`text-xs px-3 py-1.5 rounded-full font-medium transition-colors ${ 
                      agentMode === m.id ? 'bg-cyan-100 text-cyan-700' : 'text-slate-500 hover:bg-slate-100'
                    }`}
                  >
                    {m.label}
                  </button>
                ))}
              </div>

              {attachedFiles.length > 0 && (
                <div className="flex flex-wrap gap-2 mb-2">
                  {attachedFiles.map((f, i) => (
                    <div key={i} className="bg-slate-100 px-3 py-1.5 rounded-lg text-xs flex items-center gap-2 text-slate-600 border border-slate-200">
                      {f.type === 'image' ? <ImageIcon className="h-3 w-3" /> : <File className="h-3 w-3" />}
                      <span className="max-w-[150px] truncate">{f.file.name}</span>
                      <button onClick={() => removeFile(i)} className="text-slate-400 hover:text-red-500">
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              <div className="relative flex items-end gap-2 bg-slate-50 border border-slate-200 rounded-xl p-2 focus-within:ring-2 focus-within:ring-cyan-500/20 transition-all shadow-inner">
                <input type="file" ref={fileInputRef} className="hidden" multiple onChange={handleFileSelect} />
                
                <Button 
                  variant="ghost" size="icon" className="h-10 w-10 text-slate-400 hover:text-cyan-600"
                  onClick={() => fileInputRef.current?.click()}
                >
                  <Paperclip className="h-5 w-5" />
                </Button>

                <textarea
                  value={inputText}
                  onChange={(e) => setInputText(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
                  placeholder="Scrivi o trascina file qui..."
                  className="flex-1 bg-transparent border-none focus:ring-0 resize-none py-2.5 text-sm text-slate-700"
                  rows={1}
                />

                <Button 
                  onClick={handleSend}
                  disabled={(!inputText.trim() && attachedFiles.length === 0) || isLoading}
                  className="h-10 w-10 bg-cyan-600 hover:bg-cyan-700 text-white rounded-lg"
                  size="icon"
                >
                  <Send className="h-4 w-4" />
                </Button>
              </div>

              {/* Image generation controls */}
              <div className="flex items-center justify-center gap-4 mt-2 flex-wrap">
                <div className="flex items-center gap-2">
                    <span className="text-xs text-slate-400">Generatore:</span>
                    <div className="flex items-center bg-slate-100 rounded-lg p-0.5">
                    <button
                        onClick={() => setImageProvider('flux-schnell')}
                        className={`px-2 py-1 text-xs rounded-md transition-all ${ 
                        imageProvider === 'flux-schnell' 
                            ? 'bg-white shadow text-cyan-600 font-medium' 
                            : 'text-slate-500 hover:text-slate-700'
                        }`}
                    >
                        ⚡ Flux
                    </button>
                    <button
                        onClick={() => setImageProvider('dall-e')}
                        className={`px-2 py-1 text-xs rounded-md transition-all ${ 
                        imageProvider === 'dall-e' 
                            ? 'bg-white shadow text-cyan-600 font-medium' 
                            : 'text-slate-500 hover:text-slate-700'
                        }`}
                    >
                        🎨 DALL-E
                    </button>
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    <span className="text-xs text-slate-400">Formato:</span>
                    <select
                    value={imageSize}
                    onChange={(e) => setImageSize(e.target.value)}
                    className="text-xs bg-slate-100 border-0 rounded-lg px-2 py-1 text-slate-600 focus:ring-1 focus:ring-cyan-300"
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
        </main>
      </div>

      {/* Publish Task Modal */}
      {publishModal.isOpen && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[70] p-4 backdrop-blur-sm">
          <div className="bg-white rounded-xl p-6 w-full max-w-md shadow-2xl animate-in zoom-in-95 duration-200">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-bold text-slate-800">Pubblica come Compito</h3>
              <Button variant="ghost" size="icon" onClick={() => setPublishModal({ ...publishModal, isOpen: false }) }>
                <X className="h-5 w-5" />
              </Button>
            </div>
            
            <p className="text-sm text-slate-600 mb-6">
              Scegli la sessione in cui pubblicare questo {publishModal.type === 'quiz' ? 'quiz' : 'dataset'} come attività per gli studenti.
            </p>

            <div className="space-y-3 mb-6 max-h-60 overflow-y-auto">
              {classesData?.map((session: any) => (
                <button
                  key={session.id}
                  onClick={() => handlePublish(session.id)}
                  className="w-full text-left p-3 rounded-lg border border-slate-200 hover:border-cyan-400 hover:bg-cyan-50 transition-all flex items-center justify-between group"
                >
                  <div>
                    <div className="font-semibold text-sm group-hover:text-cyan-700">{session.name}</div>
                    <div className="text-xs text-slate-500">{session.class_name}</div>
                  </div>
                  <ChevronRight className="h-4 w-4 text-slate-300 group-hover:text-cyan-500" />
                </button>
              ))}
              {(!classesData || classesData.length === 0) && (
                <p className="text-center text-xs text-slate-400 py-4">Nessuna sessione attiva trovata.</p>
              )}
            </div>

            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setPublishModal({ ...publishModal, isOpen: false })}>Annulla</Button>
            </div>
          </div>
        </div>
      )}

      {/* Editor Modal for editing quiz before publishing */}
      {editorModal.isOpen && editorModal.data && (
        <ContentEditorModal
          content={editorModal.data}
          type={editorModal.type === 'quiz' ? 'quiz' : 'exercise'}
          onSave={(editedData) => {
            // After editing, open publish modal with edited data
            setEditorModal({ isOpen: false, type: 'quiz', data: null })
            setPublishModal({ isOpen: true, type: editorModal.type, data: editedData })
          }}
          onCancel={() => setEditorModal({ isOpen: false, type: 'quiz', data: null })}
        />
      )}
    </>
  )
}

// Helpers
function convertEmoticons(text: string): string {
  const emoticons: Record<string, string> = {
    ':)': '😊', ':-)': '😊', '(:': '😊',
    ':D': '😄', ':-D': '😄', 'XD': '😆', 'xD': '😆',
    ':(': '😢', ':-(': '😢', '):': '😢',
    ';)': '😉', ';-)': '😉',
    ':P': '😛', ':-P': '😛', ':p': '😛', ':-p': '😛',
    ':O': '😮', ':-O': '😮', ':o': '😮', ':-o': '😮',
    '<3': '❤️', '</3': '💔',
    ':*': '😘', ':-*': '😘',
    ":'(": '😢', ":'-": '😢',
    ':S': '😕', ':-S': '😕',
    'B)': '😎', 'B-)': '😎',
    ':/': '😕', ':-/': '😕',
    ':3': '😺',
    'O:)': '😇', 'O:-)': '😇',
    '>:(': '😠', '>:-(': '😠',
    ':@': '😡',
    '^^': '😊', '^_^': '😊',
    '-_-': '😑', '-.-': '😑',
    'T_T': '😭', 'T.T': '😭',
    ':thumbsup:': '👍', ':thumbsdown:': '👎',
    ':fire:': '🔥', ':heart:': '❤️', ':star:': '⭐',
    ':ok:': '👌', ':wave:': '👋', ':clap:': '👏',
    ':100:': '💯', ':rocket:': '🚀', ':sparkles:': '✨',
  }
  
  let result = text
  // Sort by length descending to match longer emoticons first
  const sortedEmoticons = Object.entries(emoticons).sort((a, b) => b[0].length - a[0].length)
  for (const [emoticon, emoji] of sortedEmoticons) {
    result = result.split(emoticon).join(emoji)
  }
  return result
}

function extractBase64Images(content: string): { cleanContent: string; images: string[] } {
  const images: string[] = []
  let cleanContent = content
  // Correct regex to match markdown images with data URI: ![...](data:image...)
  const startPattern = /!\[[^\]]*\]\(data:image/g
  let match
  const matches: {start: number, end: number, url: string}[] = []
  
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
      matches.push({start: match.index, end: i, url})
    }
  }
  
  for (let i = matches.length - 1; i >= 0; i--) {
    images.unshift(matches[i].url)
    cleanContent = cleanContent.substring(0, matches[i].start) + cleanContent.substring(matches[i].end)
  }
  
  return { cleanContent: cleanContent.trim(), images }
}

function parseContentBlocks(content: string): { quiz: QuizData | null; csv: string | null; textContent: string; isGenerating: boolean; generationType: string | null } {
  let textContent = content
  let quiz: QuizData | null = null
  let csv: string | null = null
  let isGenerating = false
  let generationType: string | null = null

  // Check for generation indicators
  const generatingImagePattern = /genero|creo.*immagine|sto.*generando.*immagine|genera.*immagine/i
  const generatingCsvPattern = /genero|creo.*dataset|sto.*generando.*csv|genera.*csv/i
  const generatingQuizPattern = /genero|creo|preparo.*quiz|sto.*generando.*quiz/i
  
  const hasBase64Image = content.includes('data:image') && content.includes('base64')
  if (hasBase64Image) {
      return { quiz, csv, textContent, isGenerating: false, generationType: null }
  }

  const hasIncompleteQuiz = content.includes('```quiz') && !content.includes('```quiz') 
    ? false 
    : (content.match(/```quiz/g)?.length || 0) > (content.match(/```quiz[\s\S]*?```/g)?.length || 0)
  const hasIncompleteCsv = (content.match(/```csv/g)?.length || 0) > (content.match(/```csv[\s\S]*?```/g)?.length || 0)

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
  }

  // Extract quiz
  const quizMatch = content.match(/```quiz\s*([\s\S]*?)```/)
  if (quizMatch) {
    try {
      quiz = JSON.parse(quizMatch[1].trim())
      textContent = textContent.replace(/```quiz[\s\S]*?```/, '').trim()
      isGenerating = false
    } catch (e) {
      if (quizMatch[1].includes('{')) {
        isGenerating = true
        generationType = 'quiz'
      }
    }
  }

  // Extract CSV
  const csvMatch = content.match(/```csv\s*([\s\S]*?)```/)
  if (csvMatch) {
    csv = csvMatch[1].trim()
    textContent = textContent.replace(/```csv[\s\S]*?```/, '').trim()
    isGenerating = false
  }

  return { quiz, csv, textContent, isGenerating, generationType }
}

function MessageContent({ content, onPublish, onEdit, toast }: { content: string; onPublish: (type: 'quiz' | 'dataset', data: any) => void; onEdit: (type: 'quiz' | 'dataset', data: any) => void; toast: any }) {
  const { quiz, csv, textContent, isGenerating, generationType } = parseContentBlocks(content)
  const { cleanContent, images } = extractBase64Images(textContent)
  
  if (isGenerating) {
    return (
      <div className="flex flex-col items-center gap-3 py-4">
        <div className="flex items-center gap-2 text-cyan-600">
          <Loader2 className="h-5 w-5 animate-spin" />
          <span className="font-medium">
            {generationType === 'image' && 'Generazione immagine in corso...'}
            {generationType === 'csv' && 'Generazione dataset in corso...'}
            {generationType === 'quiz' && 'Generazione quiz in corso...'}
            {!generationType && 'Elaborazione in corso...'}
          </span>
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
    <div className="prose prose-sm max-w-none prose-p:text-slate-700">
      {cleanContent && (
        <ReactMarkdown 
          remarkPlugins={[remarkGfm, remarkMath]}
          rehypePlugins={[rehypeKatex]}
          components={{
            p: ({children}) => <p className="mb-2 last:mb-0">{children}</p>,
            code: ({className, children, ...props}) => {
                const isInline = !className
                return isInline ? (
                  <code className="bg-slate-100 px-1.5 py-0.5 rounded text-cyan-600 text-xs font-mono" {...props}>
                    {children}
                  </code>
                ) : (
                  <code className="block bg-slate-900 text-slate-100 p-3 rounded-lg text-xs font-mono overflow-x-auto my-2" {...props}>
                    {children}
                  </code>
                )
            },
            pre: ({children}) => <>{children}</>,
          }}
        >
          {cleanContent}
        </ReactMarkdown>
      )}
      
      {images.length > 0 && (
        <div className="my-3 space-y-3">
          {images.map((imgSrc, idx) => (
            <div 
              key={idx} 
              className="relative group cursor-grab active:cursor-grabbing"
              draggable
              onDragStart={(e) => {
                const imageData = JSON.stringify({
                  url: imgSrc,
                  filename: `teacher-image-${Date.now()}.png`
                })
                e.dataTransfer.setData('text/plain', imgSrc)
                e.dataTransfer.setData('application/x-chatbot-image', imageData)
                e.dataTransfer.effectAllowed = 'copy'
              }}
            >
              <img src={imgSrc} alt="Generata" className="max-w-full h-auto rounded-lg shadow-md" />
              <button
                onClick={() => {
                  const link = document.createElement('a')
                  link.href = imgSrc
                  link.download = `immagine_${Date.now()}.png`
                  document.body.appendChild(link)
                  link.click()
                  document.body.removeChild(link)
                }}
                className="absolute top-2 right-2 bg-white/90 hover:bg-white p-2 rounded-lg shadow-md opacity-0 group-hover:opacity-100 transition-opacity"
              >
                <Download className="h-4 w-4 text-slate-700" />
              </button>
            </div>
          ))}
        </div>
      )}

      {csv && (
        <div 
          className="mt-3 border border-purple-200 rounded-lg overflow-hidden cursor-grab"
          draggable
          onDragStart={(e) => {
            e.dataTransfer.setData('application/x-chatbot-csv', csv)
            e.dataTransfer.effectAllowed = 'copy'
          }}
        >
          <div className="bg-purple-50 px-3 py-2 flex items-center justify-between">
            <span className="text-sm font-medium text-purple-700 flex items-center gap-2">
              <Database className="h-4 w-4" />
              Dataset CSV ({csv.split('\n').length - 1} righe)
            </span>
            <div className="flex gap-2">
              <Button 
                size="sm" 
                variant="outline"
                className="h-7 text-xs border-purple-300 text-purple-700 hover:bg-purple-100"
                onClick={() => onPublish('dataset', csv)}
              >
                <Plus className="h-3 w-3 mr-1" />
                Pubblica
              </Button>
              <Button 
                size="sm" 
                variant="outline"
                className="h-7 text-xs border-purple-300 text-purple-700 hover:bg-purple-100"
                onClick={() => downloadCsv(csv)}
              >
                <Download className="h-3 w-3 mr-1" />
                Scarica
              </Button>
            </div>
          </div>
          <pre className="bg-slate-900 text-slate-100 p-3 text-xs font-mono overflow-x-auto max-h-48">
            {csv.split('\n').slice(0, 10).join('\n')}
            {csv.split('\n').length > 10 && '\n...'}
          </pre>
        </div>
      )}

      {quiz && (
        <div className="mt-3">
          <div className="bg-cyan-50 border border-cyan-200 rounded-t-lg px-4 py-2 flex items-center justify-between">
            <span className="text-sm font-medium text-cyan-700 flex items-center gap-2">
              📝 Quiz: {quiz.title}
            </span>
            <div className="flex gap-2">
              <Button 
                size="sm" 
                variant="outline"
                className="h-7 text-xs border-cyan-300 text-cyan-700 hover:bg-cyan-100"
                onClick={() => onEdit('quiz', quiz)}
              >
                <Edit3 className="h-3 w-3 mr-1" />
                Modifica
              </Button>
              <Button 
                size="sm" 
                className="h-7 text-xs bg-cyan-600 hover:bg-cyan-700 text-white"
                onClick={() => onPublish('quiz', quiz)}
              >
                <Plus className="h-3 w-3 mr-1" />
                Pubblica
              </Button>
            </div>
          </div>
          <InteractiveQuiz quiz={quiz} onSubmitAnswers={(_ans) => {
            toast({ title: "Risposte verificate", description: "Hai completato il quiz in anteprima." })
          }} />
        </div>
      )}
    </div>
  )
}

// Interactive Quiz Component
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
    
    // Format answers for sending to chatbot
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
    <div className="bg-gradient-to-br from-cyan-50 to-sky-50 rounded-xl p-4 border border-cyan-200 shadow-sm">
      <h3 className="font-bold text-lg text-cyan-800 mb-4 flex items-center gap-2">
        📝 {quiz.title}
      </h3>
      
      <div className="space-y-4">
        {quiz.questions.map((q, qIndex) => {
          const isCorrect = answers[qIndex] === q.correctIndex
          const hasAnswered = answers[qIndex] !== undefined
          
          return (
            <div key={qIndex} className="bg-white rounded-lg p-4 shadow-sm border border-cyan-100">
              <p className="font-medium text-slate-800 mb-3">
                <span className="text-cyan-600 font-bold">{qIndex + 1}.</span> {q.question}
              </p>
              
              <div className="space-y-2">
                {q.options.map((option, optIndex) => {
                  const isSelected = answers[qIndex] === optIndex
                  const isCorrectOption = q.correctIndex === optIndex
                  
                  let buttonClass = "w-full text-left px-4 py-2.5 rounded-lg border transition-all text-sm "
                  
                  if (submitted) {
                    if (isCorrectOption) {
                      buttonClass += "bg-green-100 border-green-400 text-green-800 font-medium"
                    } else if (isSelected && !isCorrectOption) {
                      buttonClass += "bg-red-100 border-red-400 text-red-800"
                    } else {
                      buttonClass += "bg-slate-50 border-slate-200 text-slate-500"
                    }
                  } else if (isSelected) {
                    buttonClass += "bg-cyan-100 border-cyan-400 text-cyan-800 font-medium"
                  } else {
                    buttonClass += "bg-white border-slate-200 hover:border-cyan-300 hover:bg-cyan-50"
                  }
                  
                  return (
                    <button
                      key={optIndex}
                      onClick={() => handleSelect(qIndex, optIndex)}
                      disabled={submitted}
                      className={buttonClass}
                    >
                      <span className="font-bold mr-3 text-xs opacity-60">{String.fromCharCode(65 + optIndex)})
</span>                      {option}
                      {submitted && isCorrectOption && <span className="ml-auto">✅</span>}
                      {submitted && isSelected && !isCorrectOption && <span className="ml-auto">❌</span>}
                    </button>
                  )
                })}
              </div>
              
              {showExplanations && hasAnswered && (
                <div className={`mt-3 p-3 rounded-lg text-xs ${isCorrect ? 'bg-green-50 text-green-800 border border-green-100' : 'bg-cyan-50 text-cyan-800 border border-cyan-100'}`}>
                  <div className="flex items-center gap-1.5 mb-1">
                    {isCorrect ? <div className="font-bold uppercase tracking-tighter">Corretto</div> : <div className="font-bold uppercase tracking-tighter">Spiegazione</div>}
                  </div>
                  {q.explanation}
                </div>
              )}
            </div>
          )
        })}
      </div>
      
      {!submitted ? (
        <Button
          onClick={handleSubmit}
          disabled={!allAnswered}
          className={`mt-6 w-full py-6 rounded-xl font-bold text-base transition-all ${ 
            allAnswered 
              ? 'bg-cyan-600 text-white hover:bg-cyan-700 shadow-lg shadow-cyan-200' 
              : 'bg-slate-200 text-slate-400 cursor-not-allowed'
          }`}
        >
          {allAnswered ? 'Verifica Risposte' : `Rispondi a tutte le domande (${Object.keys(answers).length}/${quiz.questions.length})`}
        </Button>
      ) : (
        <div className="mt-6 p-6 bg-white rounded-2xl shadow-inner border-2 border-cyan-100 text-center animate-in zoom-in duration-300">
          <div className="text-4xl font-black text-cyan-600 mb-1">
            {score} / {quiz.questions.length}
          </div>
          <div className="text-sm font-bold text-slate-500 uppercase tracking-widest mb-4">Punteggio Finale</div>
          <p className="text-slate-600 italic">
            {score === quiz.questions.length ? '🥇 Risultato Perfetto! Ottimo lavoro.' : score >= quiz.questions.length / 2 ? '👏 Buon lavoro! Hai una buona base.' : '📚 Ti consiglio di ripassare l\'argomento.'}
          </p>
        </div>
      )}
    </div>
  )
}