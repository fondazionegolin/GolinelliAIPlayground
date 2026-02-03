import { useState, useEffect, useRef, Dispatch, SetStateAction } from 'react'
import { chatApi } from '@/lib/api'
import { useSocket, ChatMessage, OnlineUser } from '@/hooks/useSocket'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Send, MessageSquare, Bell, Paperclip, X, Image as ImageIcon,
  MessagesSquare, MessageCircle, Pin, PinOff,
  FileText, FileSpreadsheet, File, Download, ExternalLink, Wand2, Users
} from 'lucide-react'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'

// File Viewer Modal Component
function FileViewerModal({
  file,
  onClose
}: {
  file: { url: string; filename: string; type?: string } | null;
  onClose: () => void
}) {
  if (!file) return null

  const getFileType = (filename: string, mimeType?: string): string => {
    const ext = filename.split('.').pop()?.toLowerCase() || ''
    if (mimeType?.startsWith('image/') || ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp'].includes(ext)) return 'image'
    if (ext === 'pdf' || mimeType === 'application/pdf') return 'pdf'
    if (['doc', 'docx'].includes(ext) || mimeType?.includes('word')) return 'word'
    if (['xls', 'xlsx', 'csv'].includes(ext) || mimeType?.includes('spreadsheet') || mimeType?.includes('excel') || mimeType?.includes('csv')) return 'excel'
    if (['ppt', 'pptx'].includes(ext) || mimeType?.includes('presentation')) return 'powerpoint'
    return 'other'
  }

  const fileType = getFileType(file.filename, file.type)

  const [csvData, setCsvData] = useState<string[][] | null>(null)
  const [textContent, setTextContent] = useState<string | null>(null)

  // Load CSV or text content
  useEffect(() => {
    if (!file) return

    const ext = file.filename.split('.').pop()?.toLowerCase() || ''

    if (ext === 'csv') {
      fetch(file.url)
        .then(res => res.text())
        .then(text => {
          const rows = text.split('\n').map(row => row.split(',').map(cell => cell.trim()))
          setCsvData(rows)
        })
        .catch(() => setCsvData(null))
    } else if (['txt', 'json', 'xml', 'md'].includes(ext)) {
      fetch(file.url)
        .then(res => res.text())
        .then(text => setTextContent(text))
        .catch(() => setTextContent(null))
    }
  }, [file])

  const renderContent = () => {
    switch (fileType) {
      case 'image':
        return (
          <img
            src={file.url}
            alt={file.filename}
            className="max-w-full max-h-[80vh] object-contain rounded-lg shadow-lg"
          />
        )
      case 'pdf':
        return (
          <iframe
            src={file.url}
            className="w-full h-[80vh] rounded-lg border-0"
            title={file.filename}
          />
        )
      case 'excel':
        // Check if it's a CSV file
        const ext = file.filename.split('.').pop()?.toLowerCase()
        if (ext === 'csv' && csvData) {
          return (
            <div className="w-full h-[80vh] overflow-auto bg-white rounded-lg">
              <table className="min-w-full border-collapse">
                <thead className="bg-slate-100 sticky top-0">
                  {csvData[0] && (
                    <tr>
                      {csvData[0].map((cell, i) => (
                        <th key={i} className="border border-slate-200 px-3 py-2 text-left text-xs font-semibold text-slate-700">
                          {cell}
                        </th>
                      ))}
                    </tr>
                  )}
                </thead>
                <tbody>
                  {csvData.slice(1).map((row, rowIdx) => (
                    <tr key={rowIdx} className={rowIdx % 2 === 0 ? 'bg-white' : 'bg-slate-50'}>
                      {row.map((cell, cellIdx) => (
                        <td key={cellIdx} className="border border-slate-200 px-3 py-2 text-xs text-slate-600">
                          {cell}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        }
        // Fall through to default for xlsx files
        return (
          <div className="flex flex-col items-center justify-center p-12 bg-slate-100 rounded-lg">
            <FileSpreadsheet className="h-24 w-24 text-green-500 mb-4" />
            <p className="text-lg font-medium text-slate-700 mb-2">{file.filename}</p>
            <p className="text-sm text-slate-500 mb-6">Anteprima Excel non disponibile. Scarica il file per visualizzarlo.</p>
            <a
              href={file.url}
              download={file.filename}
              className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors"
            >
              <Download className="h-4 w-4" />
              Scarica file Excel
            </a>
          </div>
        )
      case 'word':
        return (
          <div className="flex flex-col items-center justify-center p-12 bg-slate-100 rounded-lg">
            <FileText className="h-24 w-24 text-blue-500 mb-4" />
            <p className="text-lg font-medium text-slate-700 mb-2">{file.filename}</p>
            <p className="text-sm text-slate-500 mb-6">Anteprima Word non disponibile. Scarica il file per visualizzarlo.</p>
            <a
              href={file.url}
              download={file.filename}
              className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
            >
              <Download className="h-4 w-4" />
              Scarica file Word
            </a>
          </div>
        )
      case 'powerpoint':
        return (
          <div className="flex flex-col items-center justify-center p-12 bg-slate-100 rounded-lg">
            <FileText className="h-24 w-24 text-orange-500 mb-4" />
            <p className="text-lg font-medium text-slate-700 mb-2">{file.filename}</p>
            <p className="text-sm text-slate-500 mb-6">Anteprima PowerPoint non disponibile. Scarica il file per visualizzarlo.</p>
            <a
              href={file.url}
              download={file.filename}
              className="flex items-center gap-2 px-4 py-2 bg-orange-600 text-white rounded-lg hover:bg-orange-700 transition-colors"
            >
              <Download className="h-4 w-4" />
              Scarica file PowerPoint
            </a>
          </div>
        )
      default:
        // Check for text-based files
        if (textContent !== null) {
          return (
            <div className="w-full h-[80vh] overflow-auto bg-slate-900 rounded-lg p-4">
              <pre className="text-sm text-slate-100 font-mono whitespace-pre-wrap">{textContent}</pre>
            </div>
          )
        }
        return (
          <div className="flex flex-col items-center justify-center p-12 bg-slate-100 rounded-lg">
            <File className="h-24 w-24 text-slate-400 mb-4" />
            <p className="text-lg font-medium text-slate-700 mb-2">{file.filename}</p>
            <p className="text-sm text-slate-500 mb-6">Anteprima non disponibile per questo tipo di file</p>
            <a
              href={file.url}
              download={file.filename}
              className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors"
            >
              <Download className="h-4 w-4" />
              Scarica file
            </a>
          </div>
        )
    }
  }

  const getFileIcon = () => {
    switch (fileType) {
      case 'pdf': return <FileText className="h-5 w-5 text-red-500" />
      case 'word': return <FileText className="h-5 w-5 text-blue-500" />
      case 'excel': return <FileSpreadsheet className="h-5 w-5 text-green-500" />
      case 'powerpoint': return <FileText className="h-5 w-5 text-orange-500" />
      case 'image': return <ImageIcon className="h-5 w-5 text-purple-500" />
      default: return <File className="h-5 w-5 text-slate-500" />
    }
  }

  return (
    <div
      className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-[100] p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-xl shadow-2xl max-w-5xl w-full max-h-[95vh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b bg-slate-50">
          <div className="flex items-center gap-3">
            {getFileIcon()}
            <span className="font-medium text-slate-700 truncate max-w-md">{file.filename}</span>
          </div>
          <div className="flex items-center gap-2">
            <a
              href={file.url}
              target="_blank"
              rel="noopener noreferrer"
              className="p-2 text-slate-500 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors"
              title="Apri in nuova scheda"
            >
              <ExternalLink className="h-4 w-4" />
            </a>
            <a
              href={file.url}
              download={file.filename}
              className="p-2 text-slate-500 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors"
              title="Scarica"
            >
              <Download className="h-4 w-4" />
            </a>
            <button
              onClick={onClose}
              className="p-2 text-slate-500 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-auto p-4 flex items-center justify-center bg-slate-100">
          {renderContent()}
        </div>
      </div>
    </div>
  )
}

export type { ChatMessage }

type TabType = 'session' | 'private' | 'users'

interface ChatSidebarProps {
  sessionId: string
  userType: 'teacher' | 'student'
  currentUserId: string
  currentUserName: string
  onNotificationClick?: (notification: ChatMessage) => void
  isMobileView?: boolean
  onToggle?: Dispatch<SetStateAction<boolean>>
  isPinned?: boolean
  onPinToggle?: () => void
  className?: string
  onWidthChange?: (width: number) => void
  initialWidth?: number
}

export default function ChatSidebar({
  sessionId,
  currentUserId,
  onNotificationClick,
  isMobileView = false,
  onToggle,
  isPinned,
  onPinToggle,
  className,
  onWidthChange,
  initialWidth = 320
}: ChatSidebarProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [inputText, setInputText] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [dragActive, setDragActive] = useState(false)
  const [attachedFiles, setAttachedFiles] = useState<File[]>([])
  const [chatWidth, setChatWidth] = useState(initialWidth)
  const [isResizing, setIsResizing] = useState(false)
  const [activeTab, setActiveTab] = useState<TabType>('session')
  const [activePrivateChat, setActivePrivateChat] = useState<string | null>(null)
  const [viewingFile, setViewingFile] = useState<{ url: string; filename: string; type?: string } | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const dragCounter = useRef(0)

  const {
    connected,
    messages: socketMessages,
    sendPublicMessage,

    privateChats,
    sendPrivateMessage,
    startPrivateChat,
    markPrivateChatRead,
    currentUserId: socketCurrentUserId,
    onlineUsers
  } = useSocket(sessionId)

  useEffect(() => {
    setMessages(socketMessages)
  }, [socketMessages])

  useEffect(() => {
    if (messages.length === 0 && !isLoading) {
      const loadMessages = async () => {
        setIsLoading(true)
        try {
          const res = await chatApi.getSessionMessages(sessionId)
          const messageData = res.data?.messages || res.data
          if (messageData && Array.isArray(messageData)) {
            setMessages(messageData)
          }
        } catch (e) {
          console.error("Failed to load messages", e)
        } finally {
          setIsLoading(false)
        }
      }
      loadMessages()
    }
  }, [sessionId, messages.length, isLoading])

  useEffect(() => {
    if (scrollRef.current) {
      const scrollToBottom = () => {
        if (scrollRef.current) {
          scrollRef.current.scrollTo({
            top: scrollRef.current.scrollHeight,
            behavior: 'smooth'
          })
        }
      }
      scrollToBottom()
      const timer = setTimeout(scrollToBottom, 100)
      return () => clearTimeout(timer)
    }
  }, [messages, activePrivateChat, privateChats])

  // Mark private chat as read when viewing
  useEffect(() => {
    if (activeTab === 'private' && activePrivateChat) {
      markPrivateChatRead(activePrivateChat)
    }
  }, [activeTab, activePrivateChat, markPrivateChatRead])

  // Listen for external openPrivateChat events (e.g., from Chat Diretta action)
  useEffect(() => {
    const handleOpenPrivateChat = (event: CustomEvent<{ id: string; nickname: string }>) => {
      const student = event.detail
      if (student && student.id) {
        // Create a minimal OnlineUser to start private chat
        const user: OnlineUser = {
          student_id: student.id,
          nickname: student.nickname,
          role: 'student'
        }
        startPrivateChat(user)
        setActivePrivateChat(student.id)
        setActiveTab('private')
      }
    }

    window.addEventListener('openPrivateChat', handleOpenPrivateChat as EventListener)
    return () => {
      window.removeEventListener('openPrivateChat', handleOpenPrivateChat as EventListener)
    }
  }, [startPrivateChat])

  const handleSend = async () => {
    if (!inputText.trim() && attachedFiles.length === 0) return

    const messageText = inputText.trim()
    setInputText('')

    // Upload files first if any
    let uploadedUrls: string[] = []
    if (attachedFiles.length > 0) {
      try {
        const formData = new FormData()
        attachedFiles.forEach(file => formData.append('files', file))

        const studentToken = localStorage.getItem('student_token')
        const accessToken = localStorage.getItem('access_token') || localStorage.getItem('token')

        const headers: Record<string, string> = {}
        if (studentToken) {
          headers['student-token'] = studentToken
        } else if (accessToken) {
          headers['Authorization'] = `Bearer ${accessToken}`
        }

        const res = await fetch(`/api/v1/chat/upload?session_id=${sessionId}`, {
          method: 'POST',
          headers,
          body: formData
        })

        if (!res.ok) {
          throw new Error('Upload failed')
        }

        const data = await res.json()
        uploadedUrls = data.urls || []
      } catch (e) {
        console.error("Failed to upload files", e)
      }
      setAttachedFiles([])
    }

    try {
      if (activeTab === 'private' && activePrivateChat) {
        // Send private message
        if (messageText || uploadedUrls.length > 0) {
          sendPrivateMessage(activePrivateChat, messageText || '📎 Allegato', uploadedUrls)
        }
      } else {
        // Send public message
        if (messageText || uploadedUrls.length > 0) {
          await sendPublicMessage(messageText || '📎 Allegato', uploadedUrls)
        }
      }
    } catch (e) {
      console.error("Failed to send", e)
    }
  }

  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    dragCounter.current++
    if (e.dataTransfer.items && e.dataTransfer.items.length > 0) {
      setDragActive(true)
    }
  }

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    dragCounter.current--
    if (dragCounter.current === 0) {
      setDragActive(false)
    }
  }

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
  }

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setDragActive(false)
    dragCounter.current = 0

    // Check for custom data (e.g., chatbot generated images) FIRST
    const customImageData = e.dataTransfer.getData('application/x-chatbot-image')
    if (customImageData) {
      try {
        const data = JSON.parse(customImageData)
        // Convert base64/URL to File
        const res = await fetch(data.url)
        const blob = await res.blob()
        const filename = data.filename || 'chatbot-image.png'
        const fileType = blob.type || 'image/png'
        // Create file object
        const fileObj = new (window.File as any)([blob], filename, { type: fileType }) as File
        setAttachedFiles(prev => [...prev, fileObj])
        return
      } catch (err) {
        console.error('Failed to parse custom drag data', err)
      }
    }

    // Check for CSV data from chatbot
    const csvData = e.dataTransfer.getData('application/x-chatbot-csv')
    if (csvData) {
      try {
        const blob = new Blob([csvData], { type: 'text/csv' })
        const filename = `dataset_${Date.now()}.csv`
        const fileObj = new (window.File as any)([blob], filename, { type: 'text/csv' }) as File
        setAttachedFiles(prev => [...prev, fileObj])
        return
      } catch (err) {
        console.error('Failed to parse CSV drag data', err)
      }
    }

    // Check for regular files
    const files = Array.from(e.dataTransfer.files)
    if (files.length > 0) {
      setAttachedFiles(prev => [...prev, ...files])
    }
  }

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || [])
    if (files.length > 0) {
      setAttachedFiles(prev => [...prev, ...files])
    }
  }

  const removeFile = (index: number) => {
    setAttachedFiles(prev => prev.filter((_, i) => i !== index))
  }

  const sidebarRef = useRef<HTMLDivElement>(null)

  const handleMouseDown = (e: React.MouseEvent) => {
    if (!isMobileView) {
      e.preventDefault()
      setIsResizing(true)
    }
  }

  useEffect(() => {
    if (!isResizing || isMobileView) return

    const handleMouseMove = (e: MouseEvent) => {
      // Calculate width based on sidebar position
      if (sidebarRef.current) {
        const rect = sidebarRef.current.getBoundingClientRect()
        const newWidth = rect.right - e.clientX
        if (newWidth >= 280 && newWidth <= 800) {
          setChatWidth(newWidth)
        }
      } else {
        // Fallback for non-pinned mode
        const newWidth = window.innerWidth - e.clientX
        if (newWidth >= 280 && newWidth <= 800) {
          setChatWidth(newWidth)
        }
      }
    }

    const handleMouseUp = () => {
      setIsResizing(false)
    }

    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)
    // Prevent text selection while resizing
    document.body.style.userSelect = 'none'
    document.body.style.cursor = 'ew-resize'

    return () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
      document.body.style.userSelect = ''
      document.body.style.cursor = ''
    }
  }, [isResizing, isMobileView])

  // Notify parent when width changes
  useEffect(() => {
    onWidthChange?.(chatWidth)
  }, [chatWidth, onWidthChange])



  const containerClasses = `relative flex flex-col h-full bg-white border-l border-slate-200 overflow-hidden ${className || (isMobileView
    ? "w-full"
    : isPinned
      ? "relative"
      : "fixed top-16 right-0 h-[calc(100vh-4rem)] shadow-xl z-30")}`

  // When className is provided, the parent wrapper handles width, so we only notify via onWidthChange
  // When no className, we apply width directly (fixed positioning mode)
  const containerStyle = (isMobileView || className) ? {} : { width: `${chatWidth}px`, minWidth: '280px', maxWidth: '800px' }

  // Calculate total unread count for private chats
  const totalUnreadPrivate = Object.values(privateChats).reduce((acc, chat) => acc + chat.unreadCount, 0)

  // Linkify function
  const linkify = (text: string) => {
    const urlRegex = /(https?:\/\/[^\s]+)/g
    return text.split(urlRegex).map((part, i) => {
      if (part.match(urlRegex)) {
        return <a key={i} href={part} target="_blank" rel="noopener noreferrer" className="text-indigo-200 hover:text-white underline break-all">{part}</a>
      }
      return part
    })
  }

  const renderMessage = (msg: ChatMessage, idx: number, messageList: ChatMessage[]) => {
    const isMe = msg.sender_id === currentUserId || msg.sender_id === socketCurrentUserId
    const isNotification = !!msg.notification_type
    const isSystem = msg.sender_id === 'system' && !isNotification
    const showAvatar = idx === 0 || messageList[idx - 1].sender_id !== msg.sender_id

    const content = msg.text || (msg as any).content || ''

    if (isSystem) {
      return (
        <div key={msg.id} className="flex justify-center">
          <span className="text-[10px] font-bold text-slate-400 uppercase tracking-tighter bg-slate-100 px-2 py-0.5 rounded">
            {content}
          </span>
        </div>
      )
    }

    if (isNotification) {
      // Special rendering for teacherbot_published notifications
      if (msg.notification_type === 'teacherbot_published' && msg.notification_data) {
        const data = typeof msg.notification_data === 'string'
          ? JSON.parse(msg.notification_data)
          : msg.notification_data

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
        const botColor = colorMap[data.color] || 'bg-indigo-500'

        return (
          <div
            key={msg.id}
            className="mx-2 p-3 bg-gradient-to-br from-indigo-50 to-purple-50 border border-indigo-200 rounded-xl shadow-sm"
          >
            <div className="flex items-center gap-3">
              <div className={`w-10 h-10 rounded-lg ${botColor} flex items-center justify-center shadow-md flex-shrink-0`}>
                <Wand2 className="h-5 w-5 text-white" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5 mb-0.5">
                  <span className="text-[10px] font-bold text-indigo-600 uppercase">Nuovo Assistente</span>
                </div>
                <p className="text-sm font-semibold text-slate-800 truncate">{data.name}</p>
                {data.synopsis && (
                  <p className="text-xs text-slate-500 line-clamp-2 mt-0.5">{data.synopsis}</p>
                )}
              </div>
            </div>
            <button
              onClick={() => onNotificationClick?.(msg)}
              className="mt-3 w-full py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold rounded-lg transition-colors flex items-center justify-center gap-1.5"
            >
              <Wand2 className="h-3.5 w-3.5" />
              Prova ora
            </button>
          </div>
        )
      }

      // Default notification rendering
      return (
        <div
          key={msg.id}
          onClick={() => onNotificationClick?.(msg)}
          className="mx-2 p-3 bg-indigo-50 border border-indigo-100 rounded-xl cursor-pointer hover:bg-indigo-100 transition-colors shadow-sm group"
        >
          <div className="flex items-center gap-2 mb-1">
            <Bell className="h-3 w-3 text-indigo-600" />
            <span className="text-[10px] font-bold text-indigo-600 uppercase">Notifica</span>
          </div>
          <p className="text-xs font-semibold text-slate-800 group-hover:text-indigo-700">{content}</p>
        </div>
      )
    }

    const allAttachments = Array.isArray(msg.attachments)
      ? msg.attachments.filter((att: any) => att.url)
      : []
    const imageAttachments = allAttachments.filter((att: any) => att.type === 'image')
    const fileAttachments = allAttachments.filter((att: any) => att.type !== 'image')

    return (
      <div key={msg.id} className={`flex gap-3 ${isMe ? 'flex-row-reverse' : ''}`}>
        <div className="flex-shrink-0 w-7 flex flex-col items-center">
          {showAvatar ? (
            <Avatar className="h-7 w-7 border-none shadow-sm">
              {msg.sender_avatar_url ? (
                <img
                  src={msg.sender_avatar_url}
                  alt={msg.sender_name || 'Avatar'}
                  className="w-full h-full object-cover rounded-full"
                />
              ) : (
                <AvatarFallback className={`text-[9px] font-black ${isMe ? 'bg-indigo-600 text-white' : 'bg-slate-200 text-slate-600'}`}>
                  {(msg.sender_name || '?').substring(0, 2).toUpperCase()}
                </AvatarFallback>
              )}
            </Avatar>
          ) : <div className="w-7" />}
        </div>

        <div className={`flex flex-col max-w-[85%] ${isMe ? 'items-end' : 'items-start'}`}>
          {showAvatar && (
            <span className="text-[10px] font-bold text-slate-400 mb-1 mx-1 uppercase tracking-tighter">
              {msg.sender_name || 'User'}
            </span>
          )}
          <div className={`
            px-3.5 py-2.5 text-sm leading-snug shadow-sm
            ${isMe
              ? 'bg-indigo-600 text-white rounded-2xl rounded-tr-none'
              : 'bg-white text-slate-700 border border-slate-100 rounded-2xl rounded-tl-none'}
          `}>
            {isMe ? linkify(content) : (
              // For received messages, basic linkify with darker link color
              content.split(/(https?:\/\/[^\s]+)/g).map((part: string, i: number) => {
                if (part.match(/(https?:\/\/[^\s]+)/g)) {
                  return <a key={i} href={part} target="_blank" rel="noopener noreferrer" className="text-indigo-600 hover:text-indigo-800 underline break-all">{part}</a>
                }
                return part
              })
            )}
            {imageAttachments.length > 0 && (
              <div className="mt-2 space-y-2">
                {imageAttachments.map((att: any, idx: number) => (
                  <img
                    key={idx}
                    src={att.url}
                    alt={att.filename || 'Allegato'}
                    className="rounded-lg max-w-full max-h-64 object-contain cursor-pointer hover:opacity-90 transition-opacity"
                    onClick={() => setViewingFile({ url: att.url, filename: att.filename || 'image.png', type: att.type })}
                  />
                ))}
              </div>
            )}
            {fileAttachments.length > 0 && (
              <div className="mt-2 space-y-1">
                {fileAttachments.map((att: any, idx: number) => (
                  <button
                    key={idx}
                    onClick={() => setViewingFile({ url: att.url, filename: att.filename || 'file', type: att.type })}
                    className={`flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium transition-colors w-full text-left ${isMe
                      ? 'bg-indigo-500/30 hover:bg-indigo-500/50 text-white'
                      : 'bg-slate-100 hover:bg-slate-200 text-slate-700'
                      }`}
                  >
                    <Paperclip className="h-3.5 w-3.5 flex-shrink-0" />
                    <span className="truncate">{att.filename || 'Allegato'}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
          <span className="text-[9px] text-slate-300 mt-1 font-medium">
            {new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </span>
        </div>
      </div>
    )
  }



  const renderPrivateChatsTab = () => {
    const chatList = Object.values(privateChats)

    if (chatList.length === 0) {
      return (
        <div className="flex-1 flex flex-col items-center justify-center text-slate-300 opacity-50 p-4">
          <MessagesSquare className="h-8 w-8 mb-2" />
          <p className="text-[10px] font-medium uppercase text-center">Nessuna chat privata</p>
          <p className="text-[9px] mt-1 text-center">Inizia una chat dalla lista studenti</p>
        </div>
      )
    }

    const currentChatMessages = activePrivateChat ? privateChats[activePrivateChat]?.messages || [] : []

    return (
      <div className="flex-1 flex overflow-hidden">
        {/* Vertical tabs for private chats */}
        <div className="w-16 bg-slate-100 border-r border-slate-200 overflow-y-auto flex flex-col items-center py-2 gap-2 flex-shrink-0">
          {chatList.map((chat) => (
            <button
              key={chat.oderId}
              onClick={() => {
                setActivePrivateChat(chat.oderId)
                markPrivateChatRead(chat.oderId)
              }}
              className={`relative w-12 h-12 rounded-xl flex items-center justify-center transition-all ${activePrivateChat === chat.oderId
                ? 'bg-indigo-600 shadow-md'
                : 'bg-white hover:bg-indigo-50 border border-slate-200'
                }`}
              title={chat.peerName}
            >
              <Avatar className="h-8 w-8">
                {chat.peerAvatarUrl ? (
                  <img
                    src={chat.peerAvatarUrl}
                    alt={chat.peerName}
                    className="w-full h-full object-cover rounded-full"
                  />
                ) : (
                  <AvatarFallback className={`text-xs font-bold ${activePrivateChat === chat.oderId
                    ? 'bg-indigo-500 text-white'
                    : 'bg-slate-200 text-slate-600'
                    }`}>
                    {chat.peerName.substring(0, 2).toUpperCase()}
                  </AvatarFallback>
                )}
              </Avatar>
              {chat.unreadCount > 0 && (
                <span className="absolute -top-1 -right-1 w-5 h-5 bg-red-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center">
                  {chat.unreadCount > 9 ? '9+' : chat.unreadCount}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* Chat messages area */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {activePrivateChat ? (
            <>
              {/* Chat header */}
              <div className="px-3 py-2 border-b border-slate-100 bg-white">
                <p className="font-semibold text-sm text-slate-700">
                  {privateChats[activePrivateChat]?.peerName || 'Chat'}
                </p>
              </div>
              {/* Messages */}
              <div className="flex-1 overflow-y-auto p-3 space-y-4 bg-slate-50/30" ref={scrollRef}>
                {currentChatMessages.length === 0 ? (
                  <div className="h-full flex flex-col items-center justify-center text-slate-300 opacity-50">
                    <MessageCircle className="h-6 w-6 mb-2" />
                    <p className="text-[10px] font-medium uppercase">Inizia la conversazione</p>
                  </div>
                ) : (
                  currentChatMessages.map((msg, idx) => renderMessage(msg, idx, currentChatMessages))
                )}
              </div>
            </>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center text-slate-300 opacity-50 p-4">
              <MessageCircle className="h-6 w-6 mb-2" />
              <p className="text-[10px] font-medium uppercase">Seleziona una chat</p>
            </div>
          )}
        </div>
      </div>
    )
  }

  const renderSessionChat = () => {
    return (
      <div className="flex-1 overflow-y-auto p-4 space-y-6 bg-slate-50/30 scroll-smooth overscroll-contain" ref={scrollRef}>
        {messages.length === 0 && !isLoading && (
          <div className="h-full flex flex-col items-center justify-center text-slate-300 opacity-50">
            <MessageSquare className="h-8 w-8 mb-2" />
            <p className="text-[10px] font-medium uppercase">Nessun messaggio</p>
          </div>
        )}

        {messages.map((msg, idx) => renderMessage(msg, idx, messages))}
      </div>
    )
  }

  const renderUsersTab = () => {
    return (
      <div className="flex-1 overflow-y-auto p-4 space-y-2 bg-slate-50/30">
        <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-4 px-1">
          Online ({onlineUsers.length})
        </h3>
        {onlineUsers.length === 0 ? (
          <div className="text-center py-8 text-slate-400">
            <p className="text-xs">Nessun utente online</p>
          </div>
        ) : (
          onlineUsers.map(user => (
            <div
              key={user.student_id}
              className="flex items-center justify-between p-3 bg-white border border-slate-100 rounded-xl shadow-sm hover:border-indigo-200 transition-all"
            >
              <div className="flex items-center gap-3">
                <Avatar className="h-8 w-8">
                  <AvatarFallback className="bg-indigo-100 text-indigo-600 text-xs font-bold">
                    {(user.nickname || 'Guest').substring(0, 2).toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                <div>
                  <p className="font-semibold text-sm text-slate-800">{user.nickname || 'Unknown'}</p>
                  <div className="flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                    <p className="text-[10px] text-slate-500 uppercase font-medium">{user.role === 'teacher' ? 'Docente' : 'Studente'}</p>
                  </div>
                </div>
              </div>
              {user.student_id !== currentUserId && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    startPrivateChat(user)
                    setActiveTab('private')
                    setActivePrivateChat(user.student_id)
                  }}
                  className="h-8 w-8 p-0 rounded-full text-slate-400 hover:text-indigo-600 hover:bg-indigo-50"
                >
                  <MessageCircle className="h-4 w-4" />
                </Button>
              )}
            </div>
          ))
        )}
      </div>
    )
  }

  const showInputArea = activeTab === 'session' || (activeTab === 'private' && activePrivateChat)

  return (
    <div
      ref={sidebarRef}
      className={containerClasses}
      style={containerStyle}
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Resize handle - trasparente, blu solo su hover */}
      <div
        className={`absolute left-0 top-0 bottom-0 w-2 cursor-ew-resize z-10 transition-all ${isResizing
          ? 'bg-indigo-500 w-3'
          : 'bg-slate-200/50 hover:bg-indigo-500 hover:w-3'
          }`}
        onMouseDown={handleMouseDown}
        title="Trascina per ridimensionare"
      />

      {/* Header with connection status */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100 bg-white">
        <div className="flex items-center gap-2">
          <div className={`w-2 h-2 rounded-full ${connected ? 'bg-emerald-500 animate-pulse' : 'bg-slate-300'}`} />
          <h3 className="font-bold text-xs uppercase tracking-widest text-slate-500">Live Chat</h3>
        </div>
        <div className="flex items-center gap-1">
          {onPinToggle && (
            <Button
              variant="ghost"
              size="icon"
              className={`h-6 w-6 ${isPinned ? 'text-indigo-600 bg-indigo-50' : 'text-slate-400'}`}
              onClick={onPinToggle}
              title={isPinned ? "Sblocca Sidebar" : "Fissa Sidebar"}
            >
              {isPinned ? <PinOff className="h-3 w-3" /> : <Pin className="h-3 w-3" />}
            </Button>
          )}
          {onToggle && !isPinned && (
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6 text-slate-400"
              onClick={() => onToggle(false)}
            >
              <X className="h-3 w-3" />
            </Button>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-slate-100 bg-white">
        <button
          onClick={() => setActiveTab('session')}
          className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 text-[10px] font-bold uppercase tracking-wider transition-all ${activeTab === 'session'
            ? 'text-indigo-600 border-b-2 border-indigo-600 bg-indigo-50/50'
            : 'text-slate-400 hover:text-slate-600 hover:bg-slate-50'
            }`}
        >
          <MessageSquare className="h-3.5 w-3.5" />
          Sessione
        </button>

        <button
          onClick={() => setActiveTab('private')}
          className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 text-[10px] font-bold uppercase tracking-wider transition-all relative ${activeTab === 'private'
            ? 'text-indigo-600 border-b-2 border-indigo-600 bg-indigo-50/50'
            : 'text-slate-400 hover:text-slate-600 hover:bg-slate-50'
            }`}
        >
          <MessagesSquare className="h-3.5 w-3.5" />
          Private
          {totalUnreadPrivate > 0 && (
            <span className="ml-1 px-1.5 py-0.5 text-[8px] bg-red-500 text-white rounded-full">
              {totalUnreadPrivate > 9 ? '9+' : totalUnreadPrivate}
            </span>
          )}
        </button>

        <button
          onClick={() => setActiveTab('users')}
          className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 text-[10px] font-bold uppercase tracking-wider transition-all ${activeTab === 'users'
            ? 'text-indigo-600 border-b-2 border-indigo-600 bg-indigo-50/50'
            : 'text-slate-400 hover:text-slate-600 hover:bg-slate-50'
            }`}
        >
          <Users className="h-3.5 w-3.5" />
          Utenti
        </button>
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-hidden flex flex-col">
        {activeTab === 'session' && renderSessionChat()}

        {activeTab === 'private' && renderPrivateChatsTab()}

        {activeTab === 'users' && renderUsersTab()}
      </div>

      {/* Input area - only show for session chat or when a private chat is selected */}
      {showInputArea && (
        <div className="p-4 bg-white border-t border-slate-100">
          {attachedFiles.length > 0 && (
            <div className="mb-3 flex flex-wrap gap-2">
              {attachedFiles.map((file, idx) => (
                <div key={idx} className="relative group">
                  {file.type.startsWith('image/') ? (
                    <div className="relative w-16 h-16 rounded-lg overflow-hidden border border-slate-200">
                      <img
                        src={URL.createObjectURL(file)}
                        alt={file.name}
                        className="w-full h-full object-cover"
                      />
                      <button
                        onClick={() => removeFile(idx)}
                        className="absolute -top-1 -right-1 w-5 h-5 bg-red-500 text-white rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2 bg-slate-100 rounded-lg px-3 py-2 pr-8 relative">
                      <Paperclip className="h-4 w-4 text-slate-500" />
                      <span className="text-xs text-slate-600 truncate max-w-[100px]">{file.name}</span>
                      <button
                        onClick={() => removeFile(idx)}
                        className="absolute -top-1 -right-1 w-5 h-5 bg-red-500 text-white rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          <div className="relative flex items-center bg-slate-50 rounded-full border border-slate-200 focus-within:border-indigo-400 focus-within:ring-2 focus-within:ring-indigo-100 transition-all px-1">
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,.json,.xml,.zip,.rar"
              onChange={handleFileSelect}
              className="hidden"
            />
            <Button
              size="icon"
              variant="ghost"
              onClick={() => fileInputRef.current?.click()}
              className="w-8 h-8 rounded-full text-slate-500 hover:text-indigo-600 hover:bg-indigo-50"
            >
              <Paperclip className="h-4 w-4" />
            </Button>
            <Input
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
              placeholder={activeTab === 'private' ? "Messaggio privato..." : "Scrivi un messaggio..."}
              className="border-none bg-transparent focus-visible:ring-0 rounded-full h-10 text-sm px-2 flex-1"
            />
            <Button
              size="icon"
              onClick={handleSend}
              disabled={!inputText.trim() && attachedFiles.length === 0}
              className={`w-8 h-8 rounded-full ${(!inputText.trim() && attachedFiles.length === 0) ? 'bg-slate-200 text-slate-400' : 'bg-indigo-600 text-white shadow-md'}`}
            >
              <Send className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}

      {dragActive && (
        <div className="absolute inset-0 bg-indigo-500/10 backdrop-blur-sm flex items-center justify-center z-50 border-4 border-dashed border-indigo-400 rounded-lg">
          <div className="text-center">
            <ImageIcon className="h-12 w-12 text-indigo-600 mx-auto mb-2" />
            <p className="text-sm font-semibold text-indigo-700">Trascina qui i file</p>
          </div>
        </div>
      )}

      {/* File Viewer Modal */}
      <FileViewerModal file={viewingFile} onClose={() => setViewingFile(null)} />
    </div>
  )
}
