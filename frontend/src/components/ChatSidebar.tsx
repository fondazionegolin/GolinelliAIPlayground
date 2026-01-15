import { useState, useRef, useEffect } from 'react'
import { useSocket, ChatMessage, OnlineUser } from '@/hooks/useSocket'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { 
  MessageSquare, Send, Users, X, ChevronLeft, ChevronRight,
  Circle, FileText, ClipboardList, Bell, Lock, Paperclip, Image, FileSpreadsheet, Download
} from 'lucide-react'

interface ChatSidebarProps {
  sessionId: string
  userType: 'student' | 'teacher'
  currentUserId: string
  currentUserName?: string
  onNotificationClick?: (notification: ChatMessage) => void
}

interface FileAttachment {
  type: 'image' | 'csv' | 'file'
  name: string
  url: string
  data?: string // base64 for images
}

export default function ChatSidebar({ 
  sessionId, 
  userType, 
  currentUserId,
  onNotificationClick 
}: ChatSidebarProps) {
  const [isOpen, setIsOpen] = useState(true)
  const [activeTab, setActiveTab] = useState<'public' | 'private' | 'users'>('public')
  const [inputText, setInputText] = useState('')
  const [privateTarget, setPrivateTarget] = useState<OnlineUser | null>(null)
  const [privateMessages, setPrivateMessages] = useState<ChatMessage[]>([])
  const [pendingFile, setPendingFile] = useState<FileAttachment | null>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const privateMessagesEndRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const { 
    connected, 
    messages, 
    onlineUsers, 
    sendPublicMessage, 
    sendPrivateMessage,
    notifications,
    clearNotification 
  } = useSocket(sessionId)

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
    const fileMatch = text.match(/\[FILE:(image|csv|file):([^\]]+)\](data:[^[]+)\[\/FILE\](.*)/)
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
      return 'bg-emerald-100 ml-4'
    }
    if (msg.sender_type === 'TEACHER') {
      return 'bg-blue-50 border-l-4 border-blue-400'
    }
    return 'bg-gray-50 mr-4'
  }

  if (!isOpen) {
    return (
      <div className="fixed right-0 top-1/2 -translate-y-1/2 z-50">
        <Button
          onClick={() => setIsOpen(true)}
          className="rounded-l-lg rounded-r-none h-24 px-2 bg-emerald-600 hover:bg-emerald-700"
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

  return (
    <div className="fixed right-0 top-0 h-full w-80 bg-white border-l shadow-lg z-50 flex flex-col">
      {/* Header */}
      <div className="bg-emerald-600 text-white p-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <MessageSquare className="h-5 w-5" />
          <span className="font-semibold">Chat di Classe</span>
          {connected ? (
            <Circle className="h-2 w-2 fill-green-300 text-green-300" />
          ) : (
            <Circle className="h-2 w-2 fill-red-400 text-red-400" />
          )}
        </div>
        <Button variant="ghost" size="sm" onClick={() => setIsOpen(false)} className="text-white hover:bg-emerald-700">
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>

      {/* Tabs */}
      <div className="flex border-b">
        <button
          onClick={() => setActiveTab('public')}
          className={`flex-1 py-2 text-sm font-medium ${activeTab === 'public' ? 'border-b-2 border-emerald-600 text-emerald-600' : 'text-gray-500'}`}
        >
          <MessageSquare className="h-4 w-4 inline mr-1" />
          Classe
        </button>
        <button
          onClick={() => { setActiveTab('private'); }}
          className={`flex-1 py-2 text-sm font-medium relative ${activeTab === 'private' ? 'border-b-2 border-blue-600 text-blue-600' : 'text-gray-500'}`}
        >
          <Lock className="h-4 w-4 inline mr-1" />
          Privata
          {privateTarget && <span className="absolute top-1 right-1 w-2 h-2 bg-blue-500 rounded-full"></span>}
        </button>
        <button
          onClick={() => setActiveTab('users')}
          className={`flex-1 py-2 text-sm font-medium ${activeTab === 'users' ? 'border-b-2 border-emerald-600 text-emerald-600' : 'text-gray-500'}`}
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
      <div className="flex-1 overflow-hidden">
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
                            <img src={file.url} alt={file.name} className="max-w-full max-h-32 rounded" />
                          ) : (
                            <a 
                              href={file.url} 
                              download={file.name}
                              className="flex items-center gap-2 p-2 bg-white rounded border hover:bg-gray-50"
                            >
                              {file.type === 'csv' ? <FileSpreadsheet className="h-4 w-4 text-green-600" /> : <FileText className="h-4 w-4 text-blue-600" />}
                              <span className="text-xs truncate">{file.name}</span>
                              <Download className="h-3 w-3 ml-auto" />
                            </a>
                          )}
                        </div>
                      )}
                      {(cleanText || !file) && <p className="text-gray-800">{cleanText || msg.text}</p>}
                      {msg.is_notification && (
                        <span className="text-xs text-blue-500 mt-1 block">Clicca per aprire →</span>
                      )}
                    </div>
                  )
                })
              )}
              <div ref={messagesEndRef} />
            </div>
            <div className="p-3 border-t bg-gray-50">
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
                <Button onClick={handleSendWithFile} size="sm" disabled={!inputText.trim() && !pendingFile}>
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
                <div className="bg-blue-50 px-3 py-2 flex items-center justify-between border-b">
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 bg-blue-500 rounded-full flex items-center justify-center text-white text-sm">
                      {privateTarget.student_id === 'teacher' ? '👨‍🏫' : (privateTarget.nickname || 'S')[0].toUpperCase()}
                    </div>
                    <span className="text-blue-700 font-medium text-sm">{privateTarget.nickname || 'Utente'}</span>
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
                          className={`p-2 rounded-lg text-sm ${msg.sender_id === currentUserId ? 'bg-blue-100 ml-4' : 'bg-gray-50 mr-4'}`}
                        >
                          <div className="flex items-center gap-2 mb-1">
                            <span className="font-semibold text-xs text-blue-600">
                              {msg.sender_id === currentUserId ? 'Tu' : (msg.sender_name || 'Utente')}
                            </span>
                            <span className="text-xs text-gray-400">{formatTime(msg.created_at)}</span>
                          </div>
                          {file && (
                            <div className="mb-2">
                              {file.type === 'image' ? (
                                <img src={file.url} alt={file.name} className="max-w-full max-h-32 rounded" />
                              ) : (
                                <a 
                                  href={file.url} 
                                  download={file.name}
                                  className="flex items-center gap-2 p-2 bg-white rounded border hover:bg-gray-50"
                                >
                                  {file.type === 'csv' ? <FileSpreadsheet className="h-4 w-4 text-green-600" /> : <FileText className="h-4 w-4 text-blue-600" />}
                                  <span className="text-xs truncate">{file.name}</span>
                                  <Download className="h-3 w-3 ml-auto" />
                                </a>
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
                <div className="p-3 border-t bg-blue-50">
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
                      className="bg-blue-600 hover:bg-blue-700"
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
                    <div className="w-8 h-8 bg-emerald-500 rounded-full flex items-center justify-center text-white text-sm">
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
  )
}
