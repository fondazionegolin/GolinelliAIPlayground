import { useState, useEffect, useRef, Dispatch, SetStateAction } from 'react'
import { chatApi } from '@/lib/api'
import { useSocket, ChatMessage } from '@/hooks/useSocket'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { 
  Send, MessageSquare, Bell, Paperclip, X, Image as ImageIcon
} from 'lucide-react'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'

export type { ChatMessage }

interface ChatSidebarProps {
  sessionId: string
  userType: 'teacher' | 'student'
  currentUserId: string
  currentUserName: string
  onNotificationClick?: (notification: ChatMessage) => void
  isMobileView?: boolean
  onToggle?: Dispatch<SetStateAction<boolean>>
}

export default function ChatSidebar({ 
  sessionId, 
  currentUserId,
  onNotificationClick,
  isMobileView = false
}: ChatSidebarProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [inputText, setInputText] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [dragActive, setDragActive] = useState(false)
  const [attachedFiles, setAttachedFiles] = useState<File[]>([])
  const [chatWidth, setChatWidth] = useState(320) // Default 320px (80 in rem)
  const [isResizing, setIsResizing] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const dragCounter = useRef(0)
  
  const { connected, messages: socketMessages, sendPublicMessage } = useSocket(sessionId)

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
      // Use smooth scrolling with a slight delay to ensure DOM is updated
      const scrollToBottom = () => {
        if (scrollRef.current) {
          scrollRef.current.scrollTo({
            top: scrollRef.current.scrollHeight,
            behavior: 'smooth'
          })
        }
      }
      
      // Immediate scroll for initial load
      scrollToBottom()
      
      // Delayed scroll to catch any late-rendering content (images, etc)
      const timer = setTimeout(scrollToBottom, 100)
      return () => clearTimeout(timer)
    }
  }, [messages])

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
        
        const token = localStorage.getItem('student_token') || localStorage.getItem('token') || localStorage.getItem('access_token')
        const res = await fetch(`/api/v1/chat/upload?session_id=${sessionId}`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${token}`,
          },
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
      // Send via useSocket hook which handles both API and WebSocket
      if (messageText || uploadedUrls.length > 0) {
        await sendPublicMessage(messageText || '📎 Allegato', uploadedUrls)
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
        const file = new File([blob], data.filename || 'chatbot-image.png', { type: blob.type || 'image/png' })
        setAttachedFiles(prev => [...prev, file])
        return // Don't process files if we handled custom data
      } catch (err) {
        console.error('Failed to parse custom drag data', err)
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

  const handleMouseDown = (e: React.MouseEvent) => {
    if (!isMobileView) {
      e.preventDefault()
      setIsResizing(true)
    }
  }

  useEffect(() => {
    if (!isResizing || isMobileView) return

    const handleMouseMove = (e: MouseEvent) => {
      const newWidth = window.innerWidth - e.clientX
      if (newWidth >= 280 && newWidth <= 800) {
        setChatWidth(newWidth)
      }
    }

    const handleMouseUp = () => {
      setIsResizing(false)
    }

    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)

    return () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
    }
  }, [isResizing, isMobileView])

  const containerClasses = isMobileView
    ? "flex flex-col h-full w-full bg-white"
    : "fixed top-16 right-0 h-[calc(100vh-4rem)] flex flex-col bg-white border-l border-slate-200 shadow-xl z-30"
  
  const containerStyle = isMobileView ? {} : { width: `${chatWidth}px` }

  return (
    <div 
      className={containerClasses}
      style={containerStyle}
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {!isMobileView && (
        <div
          className={`absolute left-0 top-0 w-1 h-full cursor-ew-resize hover:bg-indigo-500 transition-colors ${isResizing ? 'bg-indigo-500' : 'bg-transparent'}`}
          onMouseDown={handleMouseDown}
        />
      )}
      <div className="flex items-center justify-between px-4 py-4 border-b border-slate-100 bg-white">
        <div className="flex items-center gap-2">
          <div className={`w-2 h-2 rounded-full ${connected ? 'bg-emerald-500 animate-pulse' : 'bg-slate-300'}`} />
          <h3 className="font-bold text-xs uppercase tracking-widest text-slate-500">Live Chat</h3>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-6 bg-slate-50/30 scroll-smooth overscroll-contain" ref={scrollRef}>
        {messages.length === 0 && !isLoading && (
          <div className="h-full flex flex-col items-center justify-center text-slate-300 opacity-50">
            <MessageSquare className="h-8 w-8 mb-2" />
            <p className="text-[10px] font-medium uppercase">Nessun messaggio</p>
          </div>
        )}
        
        {messages.map((msg, idx) => {
          const isMe = msg.sender_id === currentUserId
          const isNotification = !!msg.notification_type
          const isSystem = msg.sender_id === 'system' && !isNotification
          const showAvatar = idx === 0 || messages[idx - 1].sender_id !== msg.sender_id
          
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

          const imageAttachments = Array.isArray(msg.attachments) 
            ? msg.attachments.filter((att: any) => att.type === 'image' && att.url)
            : []

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
                  {content}
                  {imageAttachments.length > 0 && (
                    <div className="mt-2 space-y-2">
                      {imageAttachments.map((att: any, idx: number) => (
                        <img 
                          key={idx}
                          src={att.url} 
                          alt={att.filename || 'Allegato'}
                          className="rounded-lg max-w-full max-h-64 object-contain cursor-pointer hover:opacity-90 transition-opacity"
                          onClick={() => window.open(att.url, '_blank')}
                        />
                      ))}
                    </div>
                  )}
                </div>
                <span className="text-[9px] text-slate-300 mt-1 font-medium">
                  {new Date(msg.created_at).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}
                </span>
              </div>
            </div>
          )
        })}
      </div>

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
            accept="image/*,.pdf,.doc,.docx"
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
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }}}
            placeholder="Scrivi un messaggio..."
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
      
      {dragActive && (
        <div className="absolute inset-0 bg-indigo-500/10 backdrop-blur-sm flex items-center justify-center z-50 border-4 border-dashed border-indigo-400 rounded-lg">
          <div className="text-center">
            <ImageIcon className="h-12 w-12 text-indigo-600 mx-auto mb-2" />
            <p className="text-sm font-semibold text-indigo-700">Trascina qui i file</p>
          </div>
        </div>
      )}
    </div>
  )
}