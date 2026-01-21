import { useState, useRef, useEffect } from 'react'
import { useSocket, ChatMessage, OnlineUser } from '@/hooks/useSocket'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useToast } from '@/components/ui/use-toast'
import { 
  MessageSquare, Send, Users, X, ChevronLeft, ChevronRight,
  Circle, FileText, ClipboardList, Bell, Lock, Paperclip, Image, FileSpreadsheet, Download,
  Sparkles
} from 'lucide-react'
import { ArtifactPreviewModal } from '@/components/ArtifactPreviewModal'
import { teacherApi } from '@/lib/api'

interface ChatSidebarProps {
  sessionId: string
  userType: 'student' | 'teacher'
  currentUserId: string
  currentUserName?: string
  onNotificationClick?: (notification: ChatMessage) => void
  isMobileView?: boolean
  onToggle?: (isOpen: boolean) => void
}

interface FileAttachment {
  type: 'image' | 'csv' | 'file'
  name: string
  url: string
  data?: string // base64 for images
}

interface ArtifactData {
  type: 'lesson' | 'presentation' | 'quiz' | 'exercise'
  data: any
}

export default function ChatSidebar({ 
  sessionId, 
  userType, 
  currentUserId,
  onNotificationClick,
  isMobileView = false,
  onToggle
}: ChatSidebarProps) {
  const { toast } = useToast()
  const [isOpen, setIsOpen] = useState(true)
  const [activeTab, setActiveTab] = useState<'public' | 'private' | 'users'>('public')
  const [inputText, setInputText] = useState('')
  const [privateTarget, setPrivateTarget] = useState<OnlineUser | null>(null)
  const [privateMessages, setPrivateMessages] = useState<ChatMessage[]>([])
  const [pendingFile, setPendingFile] = useState<FileAttachment | null>(null)
  const [readPrivateIds, setReadPrivateIds] = useState<Set<string>>(new Set())
  const [sidebarWidth, setSidebarWidth] = useState(320) // 320px = w-80 default
  const [isResizing, setIsResizing] = useState(false)
  
  // Artifact Preview State
  const [previewData, setPreviewData] = useState<ArtifactData | null>(null)
  const [isSavingArtifact, setIsSavingArtifact] = useState(false)

  const messagesEndRef = useRef<HTMLDivElement>(null)
  const privateMessagesEndRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const MIN_WIDTH = 320 // Minimum width (current default)
  const MAX_WIDTH = 600 // Maximum width

  const { 
    connected, 
    messages, 
    onlineUsers, 
    sendPublicMessage, 
    sendPrivateMessage,
    notifications,
    clearNotification 
  } = useSocket(sessionId)

  // Handle resize
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizing) return
      const newWidth = window.innerWidth - e.clientX
      setSidebarWidth(Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, newWidth)))
    }

    const handleMouseUp = () => {
      setIsResizing(false)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }

    if (isResizing) {
      document.body.style.cursor = 'ew-resize'
      document.body.style.userSelect = 'none'
      document.addEventListener('mousemove', handleMouseMove)
      document.addEventListener('mouseup', handleMouseUp)
    }

    return () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
    }
  }, [isResizing, MIN_WIDTH, MAX_WIDTH])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // Filter private messages for current target
  useEffect(() => {
    if (privateTarget) {
      const targetId = privateTarget.student_id
      const filtered = messages.filter(m => {
        if (!m.is_private && m.room_type !== 'DM') return false
        
        // For teacher viewing student messages
        if (userType === 'teacher') {
          // Messages sent by this student to teacher OR messages sent by teacher to this student
          const fromStudent = m.sender_id === targetId && (m.target_id === 'teacher' || !m.target_id)
          const toStudent = m.sender_id === currentUserId && m.target_id === targetId
          return fromStudent || toStudent
        }
        
        // For student viewing messages
        const isSentByMe = m.sender_id === currentUserId
        const isSentByTarget = m.sender_id === targetId
        const isSentToTarget = m.target_id === targetId
        const isSentToTeacher = m.target_id === 'teacher'
        
        // Student to teacher conversation
        if (targetId === 'teacher') {
          return (isSentByMe && isSentToTeacher) || (m.sender_type === 'TEACHER' && m.target_id === currentUserId)
        }
        
        // Student to student
        return (isSentByMe && isSentToTarget) || (isSentByTarget && m.target_id === currentUserId)
      })
      setPrivateMessages(filtered)
    } else {
      setPrivateMessages([])
    }
  }, [messages, privateTarget, currentUserId, userType])

  useEffect(() => {
    privateMessagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [privateMessages])

  // Mark private messages as read when viewing them
  useEffect(() => {
    if (activeTab === 'private' && privateTarget) {
      const newReadIds = new Set(readPrivateIds)
      privateMessages.forEach(m => newReadIds.add(m.id))
      setReadPrivateIds(newReadIds)
    }
  }, [activeTab, privateTarget, privateMessages])

  // Count unread private messages
  const unreadPrivateCount = messages.filter(m => 
    (m.is_private || m.room_type === 'DM') && 
    m.sender_id !== currentUserId && 
    !readPrivateIds.has(m.id)
  ).length

  const handleSend = () => {
    if (!inputText.trim()) return
    
    if (privateTarget) {
      sendPrivateMessage(privateTarget.student_id, inputText)
    } else {
      sendPublicMessage(inputText)
    }
    setInputText('')
  }

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    const reader = new FileReader()
    reader.onload = (event) => {
      const data = event.target?.result as string
      const isImage = file.type.startsWith('image/')
      const isCsv = file.name.endsWith('.csv') || file.type === 'text/csv'
      
      setPendingFile({
        type: isImage ? 'image' : isCsv ? 'csv' : 'file',
        name: file.name,
        url: data,
        data: data
      })
    }
    reader.readAsDataURL(file)
  }

  const handleSendWithFile = () => {
    if (!pendingFile && !inputText.trim()) return
    
    const messageText = pendingFile 
      ? `[FILE:${pendingFile.type}:${pendingFile.name}]${pendingFile.data}[/FILE]${inputText ? ' ' + inputText : ''}`
      : inputText
    
    if (privateTarget) {
      sendPrivateMessage(privateTarget.student_id, messageText)
    } else {
      sendPublicMessage(messageText)
    }
    setInputText('')
    setPendingFile(null)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const parseFileFromMessage = (text: string): { file: FileAttachment | null; cleanText: string } => {
    const fileMatch = text.match(/\[FILE:(image|csv|file):([^\]]+)\](data:[^\[]+)\[\/FILE\](.*)/s)
    if (fileMatch) {
      return {
        file: {
          type: fileMatch[1] as 'image' | 'csv' | 'file',
          name: fileMatch[2],
          url: fileMatch[3],
          data: fileMatch[3]
        },
        cleanText: fileMatch[4]?.trim() || ''
      }
    }
    return { file: null, cleanText: text }
  }

  // Detect special artifact JSON blocks in messages
  const parseArtifactFromMessage = (text: string): { artifact: ArtifactData | null; cleanText: string } => {
    // Check for Lesson Data
    const lessonMatch = text.match(/```lesson_data\s*([\s\S]*?)\s*```/)
    if (lessonMatch) {
      try {
        const data = JSON.parse(lessonMatch[1])
        return {
          artifact: { type: 'lesson', data },
          cleanText: text.replace(lessonMatch[0], '').trim()
        }
      } catch (e) {
        console.error("Failed to parse lesson JSON", e)
      }
    }

    // Check for Presentation Data
    const presentationMatch = text.match(/```presentation_data\s*([\s\S]*?)\s*```/)
    if (presentationMatch) {
      try {
        const data = JSON.parse(presentationMatch[1])
        return {
          artifact: { type: 'presentation', data },
          cleanText: text.replace(presentationMatch[0], '').trim()
        }
      } catch (e) {
         console.error("Failed to parse presentation JSON", e)
      }
    }

    // Check for Quiz Data (reusing existing logic from teacher agent)
    const quizMatch = text.match(/```quiz_data\s*([\s\S]*?)\s*```/)
    if (quizMatch) {
      try {
        const data = JSON.parse(quizMatch[1])
        return {
          artifact: { type: 'quiz', data },
          cleanText: text.replace(quizMatch[0], '').trim()
        }
      } catch (e) {
         console.error("Failed to parse quiz JSON", e)
      }
    }
    
    // Check for Exercise Data
    const exerciseMatch = text.match(/```exercise_data\s*([\s\S]*?)\s*```/)
    if (exerciseMatch) {
      try {
        const data = JSON.parse(exerciseMatch[1])
        return {
          artifact: { type: 'exercise', data },
          cleanText: text.replace(exerciseMatch[0], '').trim()
        }
      } catch (e) {
         console.error("Failed to parse exercise JSON", e)
      }
    }

    return { artifact: null, cleanText: text }
  }

  const handleNotificationClick = (notif: ChatMessage) => {
    clearNotification(notif.id)
    onNotificationClick?.(notif)
  }

  const formatTime = (dateStr: string) => {
    const date = new Date(dateStr)
    return date.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })
  }

  const getMessageStyle = (msg: ChatMessage) => {
    if (msg.is_notification) {
      return 'bg-amber-50 border-l-4 border-amber-400'
    }
    if (msg.sender_id === currentUserId) {
      return 'bg-violet-100 ml-4'
    }
    if (msg.sender_type === 'TEACHER') {
      return 'bg-purple-50 border-l-4 border-purple-400'
    }
    return 'bg-gray-50 mr-4'
  }

  const handleToggle = (open: boolean) => {
    setIsOpen(open)
    onToggle?.(open)
  }

  // Save artifact as draft task
  const handleSaveArtifact = async (data: any) => {
    if (userType !== 'teacher' || !previewData) return

    setIsSavingArtifact(true)
    try {
      await teacherApi.createTask(sessionId, {
        title: data.title,
        description: data.description,
        task_type: previewData.type,
        content_json: JSON.stringify(data)
      })
      toast({ title: "Contenuto salvato come bozza!", description: "Puoi trovarlo e pubblicarlo nella sezione Compiti." })
      setPreviewData(null)
    } catch (error) {
      console.error("Error saving artifact:", error)
      toast({ variant: "destructive", title: "Errore nel salvataggio", description: "Riprova più tardi." })
    } finally {
      setIsSavingArtifact(false)
    }
  }

  if (!isOpen && !isMobileView) {
    return (
      <div className="fixed right-0 top-1/2 -translate-y-1/2 z-50">
        <Button
          onClick={() => handleToggle(true)}
          className="rounded-l-lg rounded-r-none h-24 px-2 bg-violet-500 hover:bg-violet-600"
        >
          <div className="flex flex-col items-center gap-1">
            <ChevronLeft className="h-4 w-4" />
            <MessageSquare className="h-5 w-5" />
            {notifications.length > 0 && (
              <span className="bg-red-500 text-white text-xs rounded-full w-5 h-5 flex items-center justify-center">
                {notifications.length}
              </span>
            )}
          </div>
        </Button>
      </div>
    )
  }

  const containerClass = isMobileView
    ? "w-full h-full bg-white flex flex-col"
    : "fixed right-0 top-0 h-full bg-white border-l shadow-lg z-50 flex flex-col"

  const containerStyle = isMobileView ? {} : { width: `${sidebarWidth}px` }

  return (
    <>
      <div 
        className={containerClass}
        style={containerStyle}
      >
        {/* Resize handle - Desktop only */}
        {!isMobileView && (
          <div
            className="absolute left-0 top-0 bottom-0 w-1 cursor-ew-resize hover:bg-violet-300 transition-colors"
            onMouseDown={() => setIsResizing(true)}
          />
        )}
        
        {/* Header */}
        <div className="bg-gradient-to-r from-violet-500 to-purple-600 text-white p-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <MessageSquare className="h-5 w-5" />
            <span className="font-semibold">Chat di Classe</span>
            {connected ? (
              <Circle className="h-2 w-2 fill-green-300 text-green-300" />
            ) : (
              <Circle className="h-2 w-2 fill-red-400 text-red-400" />
            )}
          </div>
          {!isMobileView && (
            <Button variant="ghost" size="sm" onClick={() => handleToggle(false)} className="text-white hover:bg-violet-600">
              <ChevronRight className="h-4 w-4" />
            </Button>
          )}
        </div>

        {/* Tabs */}
        <div className="flex border-b">
          <button
            onClick={() => setActiveTab('public')}
            className={`flex-1 py-2 text-sm font-medium ${activeTab === 'public' ? 'border-b-2 border-violet-500 text-violet-600' : 'text-gray-500'}`}
          >
            <MessageSquare className="h-4 w-4 inline mr-1" />
            Classe
          </button>
          <button
            onClick={() => { setActiveTab('private'); }}
            className={`flex-1 py-2 text-sm font-medium relative ${activeTab === 'private' ? 'border-b-2 border-purple-600 text-purple-600' : 'text-gray-500'}`}
          >
            <Lock className="h-4 w-4 inline mr-1" />
            Privata
            {unreadPrivateCount > 0 && (
              <span className="absolute -top-1 right-1 bg-red-500 text-white text-xs rounded-full w-5 h-5 flex items-center justify-center animate-pulse">
                {unreadPrivateCount > 9 ? '9+' : unreadPrivateCount}
              </span>
            )}
            {privateTarget && unreadPrivateCount === 0 && <span className="absolute top-1 right-1 w-2 h-2 bg-purple-500 rounded-full"></span>}
          </button>
          <button
            onClick={() => setActiveTab('users')}
            className={`flex-1 py-2 text-sm font-medium ${activeTab === 'users' ? 'border-b-2 border-violet-500 text-violet-600' : 'text-gray-500'}`}
          >
            <Users className="h-4 w-4 inline mr-1" />
            ({onlineUsers.length})
          </button>
        </div>

        {/* Notifications Banner */}
        {notifications.length > 0 && (
          <div className="bg-amber-50 border-b border-amber-200 p-2">
            <div className="flex items-center gap-2 text-amber-800 text-sm font-medium mb-1">
              <Bell className="h-4 w-4" />
              Notifiche ({notifications.length})
            </div>
            <div className="space-y-1 max-h-24 overflow-y-auto">
              {notifications.slice(0, 3).map(notif => (
                <div 
                  key={notif.id}
                  onClick={() => handleNotificationClick(notif)}
                  className="text-xs bg-white p-2 rounded cursor-pointer hover:bg-amber-100 flex items-center gap-2"
                >
                  {notif.notification_type === 'task' && <ClipboardList className="h-3 w-3 text-blue-500" />}
                  {notif.notification_type === 'quiz' && <ClipboardList className="h-3 w-3 text-purple-500" />}
                  {notif.notification_type === 'document' && <FileText className="h-3 w-3 text-green-500" />}
                  <span className="truncate">{notif.text}</span>
                  <X className="h-3 w-3 ml-auto text-gray-400 hover:text-gray-600" />
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Content */}
        <div className="flex-1 overflow-hidden pb-24 md:pb-0">
          {/* PUBLIC CHAT TAB */}
          {activeTab === 'public' && (
            <div className="h-full flex flex-col">
              <div className="flex-1 overflow-y-auto p-3 space-y-2">
                {messages.filter(m => !m.is_private).length === 0 ? (
                  <p className="text-center text-gray-400 text-sm py-8">
                    Nessun messaggio. Inizia la conversazione!
                  </p>
                ) : (
                  messages.filter(m => !m.is_private).map((msg) => {
                    const { file, cleanText } = parseFileFromMessage(msg.text)
                    const { artifact, cleanText: artifactText } = parseArtifactFromMessage(cleanText)
                    
                    return (
                      <div
                        key={msg.id}
                        className={`p-2 rounded-lg text-sm ${getMessageStyle(msg)} ${msg.is_notification ? 'cursor-pointer' : ''}`}
                        onClick={() => msg.is_notification && handleNotificationClick(msg)}
                      >
                        <div className="flex items-center gap-2 mb-1">
                          <span className={`font-semibold text-xs ${msg.sender_type === 'TEACHER' ? 'text-blue-600' : 'text-gray-600'}`}>
                            {msg.sender_id === currentUserId ? 'Tu' : (msg.sender_name || (msg.sender_type === 'TEACHER' ? '👨‍🏫 Docente' : 'Studente'))}
                          </span>
                          <span className="text-xs text-gray-400">{formatTime(msg.created_at)}</span>
                        </div>
                        {file && (
                          <div className="mb-2">
                            {file.type === 'image' ? (
                              <img 
                                src={file.url} 
                                alt={file.name} 
                                className="max-w-full max-h-32 rounded cursor-grab"
                                draggable
                                onDragStart={(e) => {
                                  e.dataTransfer.setData('application/x-chatbot-image', file.url)
                                  e.dataTransfer.effectAllowed = 'copy'
                                }}
                              />
                            ) : (
                              <div
                                className="flex items-center gap-2 p-2 bg-white rounded border hover:bg-gray-50 cursor-grab"
                                draggable
                                onDragStart={(e) => {
                                  if (file.type === 'csv' && file.data) {
                                    // Decode base64 CSV data
                                    const base64Data = file.data.split(',')[1]
                                    const csvContent = decodeURIComponent(escape(atob(base64Data)))
                                    e.dataTransfer.setData('application/x-chatbot-csv', csvContent)
                                  }
                                  e.dataTransfer.effectAllowed = 'copy'
                                }}
                              >
                                {file.type === 'csv' ? <FileSpreadsheet className="h-4 w-4 text-green-600" /> : <FileText className="h-4 w-4 text-blue-600" />}
                                <span className="text-xs truncate flex-1">{file.name}</span>
                                <a href={file.url} download={file.name} onClick={(e) => e.stopPropagation()}>
                                  <Download className="h-3 w-3" />
                                </a>
                              </div>
                            )}
                          </div>
                        )}
                        
                        {/* Render Text Content */}
                        {(artifactText || !file) && <p className="text-gray-800 whitespace-pre-wrap">{artifactText || cleanText}</p>}
                        
                        {/* Render Artifact Button */}
                        {artifact && (
                          <div className="mt-3">
                            <Button 
                              size="sm" 
                              className="w-full bg-violet-100 text-violet-700 hover:bg-violet-200 border border-violet-200"
                              onClick={() => setPreviewData(artifact)}
                            >
                              <Sparkles className="h-4 w-4 mr-2" />
                              Anteprima {artifact.type === 'lesson' ? 'Lezione' : artifact.type === 'presentation' ? 'Presentazione' : 'Contenuto'}
                            </Button>
                          </div>
                        )}

                        {msg.is_notification && (
                          <span className="text-xs text-blue-500 mt-1 block">Clicca per aprire →</span>
                        )}
                      </div>
                    )
                  })
                )}
                <div ref={messagesEndRef} />
              </div>
              <div 
                className={isMobileView 
                  ? "fixed bottom-[76px] left-4 right-4 z-40 rounded-2xl shadow-xl bg-white/95 backdrop-blur-sm border border-slate-200/60 p-2"
                  : "p-3 border-t bg-gray-50"
                }
                onDragOver={(e) => {
                  e.preventDefault()
                  e.currentTarget.classList.add('bg-violet-100')
                }}
                onDragLeave={(e) => {
                  e.currentTarget.classList.remove('bg-violet-100')
                }}
                onDrop={(e) => {
                  e.preventDefault()
                  e.currentTarget.classList.remove('bg-violet-100')
                  
                  // Handle image from chatbot
                  const imageData = e.dataTransfer.getData('application/x-chatbot-image')
                  if (imageData) {
                    setPendingFile({
                      type: 'image',
                      name: `immagine_${Date.now()}.png`,
                      url: imageData,
                      data: imageData
                    })
                    return
                  }
                  
                  // Handle CSV from chatbot dataset generator
                  const csvData = e.dataTransfer.getData('application/x-chatbot-csv')
                  if (csvData) {
                    const base64Csv = btoa(unescape(encodeURIComponent(csvData)))
                    setPendingFile({
                      type: 'csv',
                      name: `dataset_${Date.now()}.csv`,
                      url: `data:text/csv;base64,${base64Csv}`,
                      data: `data:text/csv;base64,${base64Csv}`
                    })
                    return
                  }
                  
                  // Handle external file drops
                  const files = Array.from(e.dataTransfer.files)
                  if (files.length > 0) {
                    const file = files[0]
                    const reader = new FileReader()
                    reader.onload = (event) => {
                      const data = event.target?.result as string
                      const isImage = file.type.startsWith('image/')
                      const isCsv = file.name.endsWith('.csv') || file.type === 'text/csv'
                      setPendingFile({
                        type: isImage ? 'image' : isCsv ? 'csv' : 'file',
                        name: file.name,
                        url: data,
                        data: data
                      })
                    }
                    reader.readAsDataURL(file)
                  }
                }}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*,.csv"
                  onChange={handleFileSelect}
                  className="hidden"
                />
                {pendingFile && (
                  <div className="mb-2 p-2 bg-white rounded border flex items-center gap-2">
                    {pendingFile.type === 'image' ? <Image className="h-4 w-4 text-purple-600" /> : <FileSpreadsheet className="h-4 w-4 text-green-600" />}
                    <span className="text-xs truncate flex-1">{pendingFile.name}</span>
                    <Button variant="ghost" size="sm" onClick={() => setPendingFile(null)} className="h-6 w-6 p-0">
                      <X className="h-3 w-3" />
                    </Button>
                  </div>
                )}
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={() => fileInputRef.current?.click()} className="px-2">
                    <Paperclip className="h-4 w-4" />
                  </Button>
                  <Input
                    value={inputText}
                    onChange={(e) => setInputText(e.target.value)}
                    onKeyPress={handleKeyPress}
                    placeholder="Scrivi alla classe..."
                    className="flex-1"
                  />
                  <Button onClick={handleSendWithFile} size="sm" disabled={!inputText.trim() && !pendingFile} className="bg-violet-600 hover:bg-violet-700">
                    <Send className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </div>
          )}

          {/* PRIVATE CHAT TAB */}
          {activeTab === 'private' && (
            <div className="h-full flex flex-col">
              {!privateTarget ? (
                <div className="flex-1 flex flex-col items-center justify-center p-4 text-center">
                  <Lock className="h-12 w-12 text-gray-300 mb-4" />
                  <p className="text-gray-500 text-sm mb-2">Nessuna chat privata attiva</p>
                  <p className="text-gray-400 text-xs">Seleziona un utente dal tab "Online" per iniziare</p>
                </div>
              ) : (
                <>
                  <div className="bg-purple-50 px-3 py-2 flex items-center justify-between border-b">
                    <div className="flex items-center gap-2">
                      <div className="w-8 h-8 bg-purple-500 rounded-full flex items-center justify-center text-white text-sm">
                        {privateTarget.student_id === 'teacher' ? '👨‍🏫' : (privateTarget.nickname || 'S')[0].toUpperCase()}
                      </div>
                      <span className="text-purple-700 font-medium text-sm">{privateTarget.nickname || 'Utente'}</span>
                    </div>
                    <Button variant="ghost" size="sm" onClick={() => setPrivateTarget(null)}>
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                  <div className="flex-1 overflow-y-auto p-3 space-y-2">
                    {privateMessages.length === 0 ? (
                      <p className="text-center text-gray-400 text-sm py-8">
                        Inizia una conversazione privata
                      </p>
                    ) : (
                      privateMessages.map((msg) => {
                        const { file, cleanText } = parseFileFromMessage(msg.text)
                        return (
                          <div
                            key={msg.id}
                            className={`p-2 rounded-lg text-sm ${msg.sender_id === currentUserId ? 'bg-violet-100 ml-4' : 'bg-gray-50 mr-4'}`}
                          >
                            <div className="flex items-center gap-2 mb-1">
                              <span className="font-semibold text-xs text-purple-600">
                                {msg.sender_id === currentUserId ? 'Tu' : (msg.sender_name || 'Utente')}
                              </span>
                              <span className="text-xs text-gray-400">{formatTime(msg.created_at)}</span>
                            </div>
                            {file && (
                              <div className="mb-2">
                                {file.type === 'image' ? (
                                  <img 
                                    src={file.url} 
                                    alt={file.name} 
                                    className="max-w-full max-h-32 rounded cursor-grab"
                                    draggable
                                    onDragStart={(e: React.DragEvent) => {
                                      e.dataTransfer.setData('application/x-chatbot-image', file.url)
                                      e.dataTransfer.effectAllowed = 'copy'
                                    }}
                                  />
                                ) : (
                                  <div
                                    className="flex items-center gap-2 p-2 bg-white rounded border hover:bg-gray-50 cursor-grab"
                                    draggable
                                    onDragStart={(e: React.DragEvent) => {
                                      if (file.type === 'csv' && file.data) {
                                        const base64Data = file.data.split(',')[1]
                                        const csvContent = decodeURIComponent(escape(atob(base64Data)))
                                        e.dataTransfer.setData('application/x-chatbot-csv', csvContent)
                                      }
                                      e.dataTransfer.effectAllowed = 'copy'
                                    }}
                                  >
                                    {file.type === 'csv' ? <FileSpreadsheet className="h-4 w-4 text-green-600" /> : <FileText className="h-4 w-4 text-blue-600" />}
                                    <span className="text-xs truncate flex-1">{file.name}</span>
                                    <a href={file.url} download={file.name} onClick={(e: React.MouseEvent) => e.stopPropagation()}>
                                      <Download className="h-3 w-3" />
                                    </a>
                                  </div>
                                )}
                              </div>
                            )}
                            {(cleanText || !file) && <p className="text-gray-800">{cleanText || msg.text}</p>}
                          </div>
                        )
                      })
                    )}
                    <div ref={privateMessagesEndRef} />
                  </div>
                  <div className={isMobileView 
                    ? "fixed bottom-[76px] left-4 right-4 z-40 rounded-2xl shadow-xl bg-white/95 backdrop-blur-sm border border-slate-200/60 p-2"
                    : "p-3 border-t bg-purple-50"
                  }>
                    <div className="flex gap-2">
                      <Button variant="outline" size="sm" onClick={() => fileInputRef.current?.click()} className="px-2 bg-white">
                        <Paperclip className="h-4 w-4" />
                      </Button>
                      <Input
                        value={inputText}
                        onChange={(e) => setInputText(e.target.value)}
                        onKeyPress={handleKeyPress}
                        placeholder={`Messaggio a ${privateTarget.nickname}...`}
                        className="flex-1 bg-white"
                      />
                      <Button 
                        onClick={handleSendWithFile} 
                        size="sm" 
                        disabled={!inputText.trim() && !pendingFile}
                        className="bg-violet-600 hover:bg-violet-700"
                      >
                        <Send className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                </>
              )}
            </div>
          )}

          {/* USERS TAB */}
          {activeTab === 'users' && (
            <div className="p-3 space-y-2">
              {/* ... same as before ... */}
              {userType === 'student' && (
                <div 
                  className="flex items-center gap-3 p-2 rounded-lg bg-blue-50 cursor-pointer hover:bg-blue-100"
                  onClick={() => {
                    setPrivateTarget({ student_id: 'teacher', nickname: 'Docente' })
                    setActiveTab('private')
                  }}
                >
                  <div className="relative">
                    <div className="w-8 h-8 bg-blue-500 rounded-full flex items-center justify-center text-white text-sm">
                      👨‍🏫
                    </div>
                    <Circle className="absolute -bottom-0.5 -right-0.5 h-3 w-3 fill-green-400 text-green-400" />
                  </div>
                  <div className="flex-1">
                    <p className="font-medium text-sm">Docente</p>
                    <p className="text-xs text-gray-500">Clicca per chat privata</p>
                  </div>
                </div>
              )}

              {onlineUsers.length === 0 ? (
                <p className="text-center text-gray-400 text-sm py-4">
                  Nessun altro studente online
                </p>
              ) : (
                onlineUsers.map((user) => (
                  <div 
                    key={user.student_id}
                    className="flex items-center gap-3 p-2 rounded-lg hover:bg-gray-100 cursor-pointer"
                    onClick={() => {
                      setPrivateTarget(user)
                      setActiveTab('private')
                    }}
                  >
                    <div className="relative">
                      <div className="w-8 h-8 bg-sky-500 rounded-full flex items-center justify-center text-white text-sm">
                        {(user.nickname || 'S')[0].toUpperCase()}
                      </div>
                      <Circle className="absolute -bottom-0.5 -right-0.5 h-3 w-3 fill-green-400 text-green-400" />
                    </div>
                    <div className="flex-1">
                      <p className="font-medium text-sm">{user.nickname || `Studente ${user.student_id.slice(0, 4)}`}</p>
                      {user.activity?.module_key && (
                        <p className="text-xs text-gray-500">
                          📍 {user.activity.module_key}
                        </p>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      </div>

      {/* Artifact Preview Modal */}
      {previewData && (
        <ArtifactPreviewModal 
          isOpen={true}
          onClose={() => setPreviewData(null)}
          onSave={handleSaveArtifact}
          artifactType={previewData.type}
          initialData={previewData.data}
          isSaving={isSavingArtifact}
        />
      )}
    </>
  )
}