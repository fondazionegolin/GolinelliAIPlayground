import { useState, useEffect, useRef, Dispatch, SetStateAction, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { chatApi, toyLmApi } from '@/lib/api'
import FileViewerModal from '@/components/ui/FileViewerModal'
import { useSocket, ChatMessage, OnlineUser } from '@/hooks/useSocket'
import { Button } from '@/components/ui/button'
import {
  Send, MessageSquare, Bell, Paperclip, X, Image as ImageIcon,
  MessagesSquare, MessageCircle, Pin, PinOff,
  File, Wand2, Users, ChevronDown, CornerUpLeft, Brain, ExternalLink, GraduationCap
} from 'lucide-react'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { DEFAULT_STUDENT_ACCENT, getStudentAccentTheme, type StudentAccentId } from '@/lib/studentAccent'
import { buildAccentNavClusterStyle } from '@/lib/navbarGlass'
import { VoiceRecorder } from '@/components/VoiceRecorder'
import { VoiceRoomPanel } from '@/components/VoiceRoomPanel'
import ToyLMInferencePanel, { type ToyLMGeneratePayload } from '@/components/toy-lm/ToyLMInferencePanel'
import TuringTestPanel from '@/components/TuringTestPanel'

export type { ChatMessage }

type TabType = 'session' | 'private' | 'users'

interface ToyLMModelAttachment {
  type: 'toy_lm_model'
  job_id: string
  name: string
  vocab_size?: number
  saved_epoch?: number
  param_count?: number
}

interface CodingProjectAttachment {
  type: 'coding_project'
  project_id: string
  version_id?: string
  title: string
  slug?: string
  file_count?: number
  total_lines?: number
}

interface CodingCommitAttachment {
  type: 'coding_commit'
  project_id: string
  contributor_project_id?: string
  contributor_name?: string
  status?: string
}

const RESOLVED_FILE_URL_CACHE = new Map<string, string>()

interface ChatSidebarProps {
  sessionId: string
  userType: 'teacher' | 'student'
  currentUserId: string
  currentUserName: string
  teacherTarget?: { id: string; name: string }
  privateChatEnabled?: boolean
  studentAccent?: StudentAccentId
  onNotificationClick?: (notification: ChatMessage) => void
  isMobileView?: boolean
  onToggle?: Dispatch<SetStateAction<boolean>>
  isPinned?: boolean
  onPinToggle?: () => void
  className?: string
  onWidthChange?: (width: number) => void
  /** Fired while the user drags the resize grip, so the parent can suspend width animations. */
  onResizingChange?: (resizing: boolean) => void
  /** Per-frame width during a drag. Parents apply it imperatively so no React render runs
   * mid-gesture; the committed value still arrives through `onWidthChange` on mouse up. */
  onResizePreview?: (width: number) => void
  initialWidth?: number
}

export default function ChatSidebar({
  sessionId,
  userType,
  currentUserId,
  currentUserName,
  teacherTarget,
  privateChatEnabled = true,
  studentAccent = DEFAULT_STUDENT_ACCENT,
  onNotificationClick,
  isMobileView = false,
  onToggle,
  isPinned,
  onPinToggle,
  className,
  onWidthChange,
  onResizingChange,
  onResizePreview,
  initialWidth = 380
}: ChatSidebarProps) {
  const { t, i18n } = useTranslation()
  const isEnglish = i18n.resolvedLanguage?.startsWith('en') ?? false
  const sidebarLabels = {
    resize: isEnglish ? 'Drag to resize' : 'Trascina per ridimensionare',
    studentHeader: isEnglish ? 'Class chat' : 'Chat di classe',
    teacherHeader: isEnglish ? 'Live chat' : 'Chat live',
    pin: isEnglish ? 'Pin sidebar' : 'Fissa Sidebar',
    unpin: isEnglish ? 'Unpin sidebar' : 'Sblocca Sidebar',
    sessionTab: isEnglish ? 'Class' : 'Classe',
    privateTab: isEnglish ? 'Private' : 'Privata',
    usersTab: isEnglish ? 'Users' : 'Utenti',
  }
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [inputText, setInputText] = useState('')
  const [dragActive, setDragActive] = useState(false)
  const [attachedFiles, setAttachedFiles] = useState<File[]>([])
  const [chatWidth, setChatWidth] = useState(initialWidth)
  const [isResizing, setIsResizing] = useState(false)
  const [activeTab, setActiveTab] = useState<TabType>('session')
  const [activePrivateChat, setActivePrivateChat] = useState<string | null>(null)
  const [viewingFile, setViewingFile] = useState<{ url: string; filename: string; type?: string } | null>(null)
  const [activeToyLMModel, setActiveToyLMModel] = useState<ToyLMModelAttachment | null>(null)
  const studentAccentTheme = getStudentAccentTheme(studentAccent)
  const scrollRef = useRef<HTMLDivElement>(null)
  const prependScrollHeightRef = useRef<number | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const dragCounter = useRef(0)
  const prevMessagesCountRef = useRef(0)
  const [isUserScrolledUp, setIsUserScrolledUp] = useState(false)
  const [unreadWhileScrolled, setUnreadWhileScrolled] = useState(0)
  const [replyingTo, setReplyingTo] = useState<ChatMessage | null>(null)

  const {
    socket,
    connected,
    messages: socketMessages,
    sendPublicMessage,

    privateChats,
    sendPrivateMessage,
    startPrivateChat,
    markPrivateChatRead,
    currentUserId: socketCurrentUserId,
    onlineUsers,
    loadOlderPublicMessages,
    hasMorePublicMessages,
    loadingOlderPublicMessages,
    loadingInitialMessages
  } = useSocket(sessionId)

  const availableTabs: TabType[] = userType === 'student'
    ? ['session', ...(privateChatEnabled ? (['private'] as const) : [])]
    : ['session', 'private', 'users']

  const getRelativePath = (file: File) => {
    const relativePath = (file as any).webkitRelativePath as string | undefined
    return relativePath && relativePath.length > 0 ? relativePath : null
  }

  const getDisplayName = (file: File) => getRelativePath(file) || file.name

  const isImageFile = (file: File) => file.type.startsWith('image/')

  const downscaleImage = async (file: File, maxSize = 1280, quality = 0.72): Promise<File> => {
    if (!isImageFile(file)) return file
    const imageUrl = URL.createObjectURL(file)
    try {
      const img = await new Promise<HTMLImageElement>((resolve, reject) => {
        const element = new Image()
        element.onload = () => resolve(element)
        element.onerror = reject
        element.src = imageUrl
      })
      const ratio = Math.min(1, maxSize / Math.max(img.width, img.height))
      const targetW = Math.max(1, Math.round(img.width * ratio))
      const targetH = Math.max(1, Math.round(img.height * ratio))
      const canvas = document.createElement('canvas')
      canvas.width = targetW
      canvas.height = targetH
      const ctx = canvas.getContext('2d')
      if (!ctx) return file
      ctx.drawImage(img, 0, 0, targetW, targetH)

      const blob = await new Promise<Blob | null>((resolve) => {
        canvas.toBlob(resolve, 'image/webp', quality)
      })
      if (!blob) return file

      const targetName = file.name.replace(/\.[^.]+$/, '') + '.webp'
      return new globalThis.File([blob], targetName, { type: 'image/webp' })
    } catch {
      return file
    } finally {
      URL.revokeObjectURL(imageUrl)
    }
  }

  const optimizeImagesForUpload = async (files: File[]): Promise<File[]> => {
    return Promise.all(files.map((file) => downscaleImage(file)))
  }

  const resolveDownloadUrl = async (fileUrl: string): Promise<string> => {
    if (!fileUrl.includes('/api/v1/files/') || !fileUrl.endsWith('/download-url')) {
      return fileUrl
    }
    const cached = RESOLVED_FILE_URL_CACHE.get(fileUrl)
    if (cached) return cached
    const res = await fetch(fileUrl)
    const json = await res.json()
    const resolved = json.download_url || json.url || fileUrl
    RESOLVED_FILE_URL_CACHE.set(fileUrl, resolved)
    return resolved
  }

  useEffect(() => {
    setMessages(socketMessages)
  }, [socketMessages])

  useEffect(() => {
    const container = scrollRef.current
    if (!container) return

    const prevCount = prevMessagesCountRef.current
    const currentCount = messages.length

    if (prependScrollHeightRef.current !== null) {
      const previousHeight = prependScrollHeightRef.current
      prependScrollHeightRef.current = null
      const delta = container.scrollHeight - previousHeight
      container.scrollTop = Math.max(0, container.scrollTop + delta)
    } else if (currentCount > prevCount) {
      if (!isUserScrolledUp || prevCount === 0) {
        // Use rAF so scroll fires after DOM paint (avoids stale scrollHeight)
        requestAnimationFrame(() => {
          if (!scrollRef.current) return
          // Instant for initial load, smooth for new messages
          if (prevCount === 0) {
            scrollRef.current.scrollTop = scrollRef.current.scrollHeight
          } else {
            scrollRef.current.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
          }
        })
        setUnreadWhileScrolled(0)
      } else {
        setUnreadWhileScrolled(prev => prev + (currentCount - prevCount))
      }
    }

    prevMessagesCountRef.current = currentCount
  }, [messages, activePrivateChat, privateChats, isUserScrolledUp])

  useEffect(() => {
    if (activeTab !== 'session') return
    const viewport = scrollRef.current
    if (!viewport) return

    let rafPending = false
    const onScroll = () => {
      if (rafPending) return
      rafPending = true
      requestAnimationFrame(() => {
        rafPending = false
        const distanceFromBottom = viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight
        const scrolledUp = distanceFromBottom > 200
        setIsUserScrolledUp(scrolledUp)
        if (!scrolledUp) setUnreadWhileScrolled(0)

        if (viewport.scrollTop > 120) return
        if (!hasMorePublicMessages || loadingOlderPublicMessages) return
        prependScrollHeightRef.current = viewport.scrollHeight
        void loadOlderPublicMessages()
      })
    }

    viewport.addEventListener('scroll', onScroll, { passive: true })
    return () => viewport.removeEventListener('scroll', onScroll)
  }, [activeTab, hasMorePublicMessages, loadingOlderPublicMessages, loadOlderPublicMessages])

  // Scroll to bottom when switching to session tab
  useEffect(() => {
    if (activeTab !== 'session') return
    const viewport = scrollRef.current
    if (!viewport) return
    requestAnimationFrame(() => {
      viewport.scrollTo({ top: viewport.scrollHeight, behavior: 'smooth' })
      setIsUserScrolledUp(false)
      setUnreadWhileScrolled(0)
    })
  }, [activeTab])

  // Mark private chat as read when viewing
  useEffect(() => {
    if (activeTab === 'private' && activePrivateChat) {
      markPrivateChatRead(activePrivateChat)
    }
  }, [activeTab, activePrivateChat, markPrivateChatRead])

  // Listen for external openPrivateChat events (e.g., from Chat Diretta action)
  useEffect(() => {
    if (userType !== 'teacher') return

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
  }, [startPrivateChat, userType])

  const uploadFilesForMessage = useCallback(async (files: File[]) => {
    if (files.length === 0) {
      return { uploadedUrls: [] as string[], filenameMap: {} as Record<string, string> }
    }

    const originalNames = files.map((file) => getDisplayName(file))
    const optimizedFiles = await optimizeImagesForUpload(files)
    const response = await chatApi.uploadFiles(sessionId, optimizedFiles)
    const uploadedUrls: string[] = response.data?.urls || []
    const filenameMap: Record<string, string> = {}
    uploadedUrls.forEach((url, index) => {
      filenameMap[url] = originalNames[index] || url.split('/').pop() || 'file'
    })
    return { uploadedUrls, filenameMap }
  }, [sessionId])

  const shareDroppedFilesToSession = useCallback(async (files: File[], fallbackText: string) => {
    if (activeTab !== 'session') {
      setAttachedFiles(prev => [...prev, ...files])
      return
    }

    try {
      const { uploadedUrls, filenameMap } = await uploadFilesForMessage(files)
      if (uploadedUrls.length > 0) {
        await sendPublicMessage(fallbackText, uploadedUrls, filenameMap)
      }
    } catch (error) {
      console.error('Failed to share dropped files to session', error)
      setAttachedFiles(prev => [...prev, ...files])
    }
  }, [activeTab, sendPublicMessage, uploadFilesForMessage])

  const handleSend = async () => {
    if (!inputText.trim() && attachedFiles.length === 0) return

    const messageText = inputText.trim()
    setInputText('')

    // Upload files first if any
    let uploadedUrls: string[] = []
    let filenameMap: Record<string, string> = {}
    if (attachedFiles.length > 0) {
      try {
        const uploadResult = await uploadFilesForMessage(attachedFiles)
        uploadedUrls = uploadResult.uploadedUrls
        filenameMap = uploadResult.filenameMap
      } catch (e) {
        console.error("Failed to upload files", e)
      }
      setAttachedFiles([])
    }

    try {
      if (activeTab === 'private' && activePrivateChat) {
        // Send private message
        if (messageText || uploadedUrls.length > 0) {
          sendPrivateMessage(activePrivateChat, messageText || '📎 Allegato', uploadedUrls, filenameMap)
        }
      } else {
        // Send public message
        if (messageText || uploadedUrls.length > 0) {
          const replyId = replyingTo?.id
          const replyPrev = replyingTo ? `${replyingTo.sender_name || 'Utente'}: ${replyingTo.text.slice(0, 80)}` : undefined
          setReplyingTo(null)
          await sendPublicMessage(messageText || '📎 Allegato', uploadedUrls, filenameMap, replyId, replyPrev)
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

    // Check for session file drag (from internal file manager)
    const sessionFileData = e.dataTransfer.getData('application/x-session-file')
    if (sessionFileData) {
      try {
        const data = JSON.parse(sessionFileData)
        let fileUrl = data.url as string
        fileUrl = await resolveDownloadUrl(fileUrl)
        const res = await fetch(fileUrl)
        const blob = await res.blob()
        const fileObj = new globalThis.File([blob], data.filename || 'file', {
          type: data.mime_type || blob.type || 'application/octet-stream'
        })
        await shareDroppedFilesToSession([fileObj], `📎 ${data.filename || 'File condiviso'}`)
        return
      } catch (err) {
        console.error('Failed to handle session file drop', err)
      }
    }

    // Check for custom data (e.g., chatbot generated images) FIRST
    const customImageData = e.dataTransfer.getData('application/x-chatbot-image')
    if (customImageData) {
      try {
        let data: { url?: string; filename?: string } = {}
        try {
          data = JSON.parse(customImageData)
        } catch {
          data = { url: customImageData }
        }
        // Convert base64/URL to File
        const fallbackUrl = e.dataTransfer.getData('text/plain')
        const sourceUrl = data.url || fallbackUrl
        if (!sourceUrl) throw new Error('Missing image URL in drag payload')
        const res = await fetch(sourceUrl)
        const blob = await res.blob()
        const filename = data.filename || 'chatbot-image.png'
        const fileType = blob.type || 'image/png'
        // Create file object
        const fileObj = new (window.File as any)([blob], filename, { type: fileType }) as File
        await shareDroppedFilesToSession([fileObj], `🖼️ ${filename}`)
        return
      } catch (err) {
        console.error('Failed to parse custom drag data', err)
      }
    }

    // Check for document (brochure/dispensa/pdf) from teacher canvas
    const docData = e.dataTransfer.getData('application/x-chatbot-document')
    if (docData) {
      try {
        const data = JSON.parse(docData) as { type: string; content?: string; blobUrl?: string; filename: string; title: string; mimeType: string }
        if (data.blobUrl) {
          const response = await fetch(data.blobUrl)
          const blob = await response.blob()
          const fileObj = new (window.File as any)([blob], data.filename, { type: 'application/pdf' }) as File
          await shareDroppedFilesToSession([fileObj], `📄 ${data.title || data.filename}`)
        } else if (data.content) {
          const blob = new Blob([data.content], { type: data.mimeType || 'text/plain' })
          const fileObj = new (window.File as any)([blob], data.filename, { type: data.mimeType || 'text/plain' }) as File
          await shareDroppedFilesToSession([fileObj], `📄 ${data.title || data.filename}`)
        }
        return
      } catch (err) {
        console.error('Failed to parse document drag data', err)
      }
    }

    // Check for CSV data from chatbot
    const csvData = e.dataTransfer.getData('application/x-chatbot-csv')
    if (csvData) {
      try {
        const blob = new Blob([csvData], { type: 'text/csv' })
        const filename = `dataset_${Date.now()}.csv`
        const fileObj = new (window.File as any)([blob], filename, { type: 'text/csv' }) as File
        await shareDroppedFilesToSession([fileObj], `📊 ${filename}`)
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

  const handleInputPaste = (e: React.ClipboardEvent) => {
    const fileItems = Array.from(e.clipboardData.items).filter(item => item.kind === 'file')
    if (fileItems.length === 0) return
    e.preventDefault()
    const files = fileItems.map(item => item.getAsFile()).filter(Boolean) as File[]
    if (files.length > 0) setAttachedFiles(prev => [...prev, ...files])
  }

  useEffect(() => {
    if (!availableTabs.includes(activeTab)) {
      setActiveTab(availableTabs[0])
    }
  }, [activeTab, availableTabs])

  useEffect(() => {
    if (userType === 'student' && !privateChatEnabled && activeTab === 'private') {
      setActiveTab('session')
      setActivePrivateChat(null)
    }
  }, [userType, privateChatEnabled, activeTab])

  useEffect(() => {
    if (userType !== 'student' || !privateChatEnabled || !teacherTarget?.id) return
    startPrivateChat({
      student_id: teacherTarget.id,
      nickname: teacherTarget.name,
      role: 'teacher',
    })
    setActivePrivateChat((current) => current || teacherTarget.id)
  }, [userType, privateChatEnabled, teacherTarget, startPrivateChat])

  const removeFile = (index: number) => {
    setAttachedFiles(prev => prev.filter((_, i) => i !== index))
  }

  const sidebarRef = useRef<HTMLDivElement>(null)
  const draggedWidthRef = useRef(initialWidth)

  const handleMouseDown = (e: React.MouseEvent) => {
    if (!isMobileView) {
      e.preventDefault()
      draggedWidthRef.current = chatWidth
      setIsResizing(true)
    }
  }

  useEffect(() => {
    if (!isResizing || isMobileView) return

    let frame: number | null = null

    const handleMouseMove = (e: MouseEvent) => {
      const right = sidebarRef.current?.getBoundingClientRect().right ?? window.innerWidth
      // Clamping (instead of dropping out-of-range values) keeps the drag continuous at the limits.
      draggedWidthRef.current = Math.min(800, Math.max(280, right - e.clientX))
      if (!onResizePreview) {
        setChatWidth(draggedWidthRef.current)
        return
      }
      if (frame === null) {
        frame = requestAnimationFrame(() => {
          frame = null
          onResizePreview(draggedWidthRef.current)
        })
      }
    }

    const handleMouseUp = () => {
      if (frame !== null) cancelAnimationFrame(frame)
      setChatWidth(draggedWidthRef.current)
      setIsResizing(false)
    }

    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)
    // Prevent text selection while resizing
    document.body.style.userSelect = 'none'
    document.body.style.cursor = 'ew-resize'

    return () => {
      if (frame !== null) cancelAnimationFrame(frame)
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
      document.body.style.userSelect = ''
      document.body.style.cursor = ''
    }
  }, [isResizing, isMobileView, onResizePreview])

  // Notify parent when width changes
  useEffect(() => {
    onWidthChange?.(chatWidth)
  }, [chatWidth, onWidthChange])

  useEffect(() => {
    onResizingChange?.(isResizing)
  }, [isResizing, onResizingChange])



  const containerClasses = `relative flex min-h-0 flex-col overflow-hidden ${isMobileView ? 'bg-white' : 'h-full bg-[var(--ds-surface)] shadow-[var(--ds-shadow-2)]'} ${className || (isMobileView
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
  const linkify = (text: string, linkClassName = 'text-red-600 hover:text-red-700 underline break-all') => {
    const urlRegex = /(https?:\/\/[^\s]+)/g
    return text.split(urlRegex).map((part, i) => {
      if (part.match(urlRegex)) {
        return <a key={i} href={part} target="_blank" rel="noopener noreferrer" className={linkClassName}>{part}</a>
      }
      return part
    })
  }

  const copyMessageText = useCallback(async (text: string) => {
    const value = text.trim()
    if (!value || !navigator.clipboard) return
    try {
      await navigator.clipboard.writeText(value)
    } catch {
      // Text remains selectable even when clipboard permissions are unavailable.
    }
  }, [])

  const generateSharedToyLMText = useCallback(async (payload: ToyLMGeneratePayload) => {
    if (!activeToyLMModel) return ''
    const res = await toyLmApi.generateShared(activeToyLMModel.job_id, sessionId, payload)
    return res.data?.generated ?? ''
  }, [activeToyLMModel, sessionId])

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
          indigo: 'bg-[#181b1e]',
          blue: 'bg-blue-500',
          green: 'bg-green-500',
          red: 'bg-red-500',
          purple: 'bg-purple-500',
          pink: 'bg-pink-500',
          orange: 'bg-orange-500',
          teal: 'bg-teal-500',
          cyan: 'bg-cyan-500',
        }
        const botColor = colorMap[data.color] || 'bg-[#181b1e]'

        return (
          <div
            key={msg.id}
            className="ds-semantic-surface mx-2 rounded-xl bg-[rgba(123,105,201,0.065)] p-3"
          >
            <div className="flex items-center gap-3">
              <div className={`w-10 h-10 rounded-lg ${botColor} flex items-center justify-center shadow-md flex-shrink-0`}>
                <Wand2 className="h-5 w-5 text-white" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5 mb-0.5">
                  <span className="text-[10px] font-bold text-neutral-900 uppercase">{t('chat_sidebar.new_assistant')}</span>
                </div>
                <p className="text-xs font-semibold text-slate-800 truncate">{data.name}</p>
                {data.synopsis && (
                  <p className="text-xs text-slate-500 line-clamp-2 mt-0.5">{data.synopsis}</p>
                )}
              </div>
            </div>
            <button
              onClick={() => onNotificationClick?.(msg)}
              className="mt-3 w-full py-2 border border-[color:var(--selection-border-hover)] bg-[image:var(--selection-active-bg)] hover:bg-[image:var(--selection-active-bg-hover)] text-[var(--selection-active-text)] text-xs font-semibold rounded-lg transition-colors flex items-center justify-center gap-1.5"
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
          className="ds-semantic-surface mx-2 cursor-pointer rounded-xl bg-[rgba(123,105,201,0.055)] p-3 transition-colors hover:bg-[rgba(123,105,201,0.09)] group"
        >
          <div className="flex items-center gap-2 mb-1">
            <Bell className="h-3 w-3 text-neutral-900" />
            <span className="text-[10px] font-bold text-neutral-900 uppercase">{t('chat_sidebar.notification')}</span>
          </div>
          <p className="text-xs font-semibold text-slate-800 group-hover:text-neutral-900">{content}</p>
        </div>
      )
    }

    const rawAttachments = Array.isArray(msg.attachments) ? msg.attachments : []
    const toyLmAttachments = rawAttachments.filter((att: any): att is ToyLMModelAttachment =>
      att?.type === 'toy_lm_model' && typeof att.job_id === 'string'
    )
    const codingProjectAttachments = rawAttachments.filter((att: any): att is CodingProjectAttachment =>
      att?.type === 'coding_project' && typeof att.project_id === 'string'
    )
    const codingCommitAttachments = rawAttachments.filter((att: any): att is CodingCommitAttachment =>
      att?.type === 'coding_commit' && typeof att.project_id === 'string'
    )
    const allAttachments = rawAttachments
      ? rawAttachments.filter((att: any) => att.url)
      : []
    const imageAttachments = allAttachments.filter((att: any) => att.type === 'image')
    const fileAttachments = allAttachments.filter((att: any) => att.type !== 'image')
    // Per-user accent tints removed: chat bubbles are neutral base surfaces
    // (light grey for own messages, white for received), not accent-coloured.
    const messageAccentTheme = null as (typeof studentAccentTheme | null)

    return (
      <div
        key={msg.id}
        className={`flex gap-3 group/msg ${isMe ? 'flex-row-reverse' : ''}`}
        draggable
        onDragStart={(e) => {
          const target = e.target as HTMLElement | null
          if (target?.closest('[data-chat-copyable="true"]')) {
            e.preventDefault()
            return
          }
          const payload = JSON.stringify({ text: msg.text, sender_name: msg.sender_name || 'Utente' })
          e.dataTransfer.setData('desktop/note', payload)
          e.dataTransfer.effectAllowed = 'copy'
        }}
      >
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
                <AvatarFallback className={`text-[9px] font-black ${isMe ? 'bg-gray-300 text-gray-700' : 'bg-gray-200 text-gray-600'}`}>
                  {(msg.sender_name || '?').substring(0, 2).toUpperCase()}
                </AvatarFallback>
              )}
            </Avatar>
          ) : <div className="w-7" />}
        </div>

        <div className={`flex flex-col max-w-[85%] ${isMe ? 'items-end' : 'items-start'}`}>
          <span className="mx-1 mb-1 inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-tighter text-slate-500">
            {msg.sender_is_class_owner && (
              <GraduationCap className="h-3 w-3 text-violet-600" aria-label="Docente proprietario della classe" />
            )}
            {msg.sender_name || (isMe ? currentUserName : 'Utente')}
          </span>
          <div className={`
            px-3.5 py-2.5 text-xs leading-snug shadow-sm backdrop-blur-md transition-all relative select-text cursor-text
            ${isMe
              ? messageAccentTheme
                ? 'rounded-2xl rounded-tr-none'
                : 'class-chat-bubble class-chat-bubble-own text-slate-800 rounded-2xl rounded-tr-none'
              : 'class-chat-bubble text-slate-700 rounded-2xl rounded-tl-none'}
          `}
            data-chat-copyable="true"
            draggable={false}
            onDoubleClick={(e) => {
              e.stopPropagation()
              void copyMessageText(content)
            }}
            title="Doppio click per copiare il testo"
            style={messageAccentTheme ? {
              backgroundColor: `${messageAccentTheme.accent}15`, // 15 is ~8% opacity for ethereal look
              borderColor: `${messageAccentTheme.accent}40`, // 40 is ~25% opacity for outline
              color: messageAccentTheme.text
            } : undefined}
          >
            {/* Reply quote */}
            {msg.reply_preview && (
              <div className="mb-1.5 px-2 py-1 rounded-lg bg-black/5 border-l-2 border-slate-400/60 text-[11px] text-slate-500 truncate">
                <CornerUpLeft className="inline h-2.5 w-2.5 mr-1 opacity-60" />
                {msg.reply_preview}
              </div>
            )}
            {isMe ? linkify(content, messageAccentTheme ? 'underline break-all' : undefined) : (
              // For received messages, basic linkify with darker link color
              content.split(/(https?:\/\/[^\s]+)/g).map((part: string, i: number) => {
                if (part.match(/(https?:\/\/[^\s]+)/g)) {
                  return <a key={i} href={part} target="_blank" rel="noopener noreferrer" className={messageAccentTheme ? 'underline break-all' : 'text-red-600 hover:text-red-700 underline break-all'}>{part}</a>
                }
                return part
              })
            )}
            {toyLmAttachments.length > 0 && (
              <div className="mt-2 space-y-2">
                {toyLmAttachments.map((att, idx) => (
                  <button
                    key={`${att.job_id}-${idx}`}
                    onClick={(e) => {
                      e.stopPropagation()
                      setActiveToyLMModel(att)
                    }}
                    className="w-full rounded-xl border border-violet-200 bg-violet-50 px-3 py-2 text-left shadow-sm transition-colors hover:border-violet-300 hover:bg-violet-100"
                  >
                    <div className="flex items-center gap-2">
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-violet-600 text-white">
                        <Brain className="h-4.5 w-4.5" style={{ width: 18, height: 18 }} />
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[10px] font-black uppercase tracking-wide text-violet-700">ToyGPT condiviso</p>
                        <p className="truncate text-xs font-semibold text-slate-800">{att.name || 'Modello ToyGPT'}</p>
                        <p className="mt-0.5 truncate text-[10px] text-slate-500">
                          {att.saved_epoch ?? 0} epoch · {Number(att.param_count || 0).toLocaleString()} parametri · vocab {att.vocab_size ?? 0}
                        </p>
                      </div>
                    </div>
                    <span className="mt-2 inline-flex w-full items-center justify-center rounded-lg bg-violet-600 px-2 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-violet-700">
                      Prova modello
                    </span>
                  </button>
                ))}
              </div>
            )}
            {codingProjectAttachments.length > 0 && (
              <div className="mt-2 space-y-2">
                {codingProjectAttachments.map((att, idx) => (
                  <button
                    key={`${att.project_id}-${idx}`}
                    onClick={(e) => {
                      e.stopPropagation()
                      window.dispatchEvent(new CustomEvent('coding-lab-open-shared-project', {
                        detail: {
                          projectId: att.project_id,
                          versionId: att.version_id,
                          title: att.title,
                        },
                      }))
                    }}
                    className="w-full rounded-xl border border-sky-200 bg-sky-50 px-3 py-2 text-left shadow-sm transition-colors hover:border-sky-300 hover:bg-sky-100"
                  >
                    <div className="flex items-center gap-2">
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-sky-600 text-white">
                        <File className="h-4.5 w-4.5" style={{ width: 18, height: 18 }} />
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[10px] font-black uppercase tracking-wide text-sky-700">Progetto Vibe Lab</p>
                        <p className="truncate text-xs font-semibold text-slate-800">{att.title || 'Mini app condivisa'}</p>
                        <p className="mt-0.5 truncate text-[10px] text-slate-500">
                          {att.file_count ?? 0} file · {att.total_lines ?? 0} righe
                        </p>
                      </div>
                    </div>
                    <span className="mt-2 inline-flex w-full items-center justify-center rounded-lg bg-sky-600 px-2 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-sky-700">
                      Apri nel Vibe Lab
                    </span>
                  </button>
                ))}
              </div>
            )}
            {codingCommitAttachments.length > 0 && (
              <div className="mt-2 space-y-2">
                {codingCommitAttachments.map((att, idx) => (
                  <button
                    key={`${att.project_id}-${att.contributor_project_id || idx}`}
                    onClick={(e) => {
                      e.stopPropagation()
                      window.dispatchEvent(new CustomEvent('coding-lab-open-shared-project', {
                        detail: {
                          projectId: att.project_id,
                          openCommits: true,
                        },
                      }))
                    }}
                    className="w-full rounded-xl border border-[rgba(123,105,201,0.20)] bg-[rgba(123,105,201,0.075)] px-3 py-2 text-left shadow-sm transition-colors hover:border-[rgba(123,105,201,0.34)] hover:bg-[rgba(123,105,201,0.11)]"
                  >
                    <div className="flex items-center gap-2">
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[rgba(123,105,201,0.14)] text-[var(--logo-violet-strong)]">
                        <CornerUpLeft className="h-4.5 w-4.5" style={{ width: 18, height: 18 }} />
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[10px] font-black uppercase tracking-wide text-[var(--logo-violet-strong)]">Commit Vibe Lab</p>
                        <p className="truncate text-xs font-semibold text-slate-800">
                          {att.contributor_name || 'Studente'} ha inviato una proposta
                        </p>
                        <p className="mt-0.5 truncate text-[10px] text-slate-500">{att.status || 'pending'}</p>
                      </div>
                    </div>
                    <span className="mt-2 inline-flex w-full items-center justify-center rounded-lg bg-[rgba(123,105,201,0.14)] px-2 py-1.5 text-xs font-semibold text-[var(--logo-violet-strong)] transition-colors hover:bg-[rgba(123,105,201,0.22)]">
                      Apri commit
                    </span>
                  </button>
                ))}
              </div>
            )}
            {imageAttachments.length > 0 && (
              <div className="mt-2 grid grid-cols-2 gap-2">
                {imageAttachments.map((att: any, idx: number) => (
                  <div
                    key={idx}
                    draggable
                    onDragStart={(e) => {
                      e.stopPropagation()
                      e.dataTransfer.setData('desktop/file', JSON.stringify({
                        filename: att.filename || 'image.png',
                        mime_type: att.type || 'image/png',
                        url: att.url,
                      }))
                      e.dataTransfer.effectAllowed = 'copy'
                    }}
                    className={`group relative aspect-[4/3] w-full overflow-hidden rounded-xl border text-left text-xs shadow-sm transition-colors cursor-grab active:cursor-grabbing ${
                      isMe
                        ? messageAccentTheme
                          ? 'hover:brightness-95'
                          : 'bg-gray-200 hover:bg-gray-300 text-gray-700'
                        : 'bg-gray-100 hover:bg-gray-200 text-gray-700'
                    }`}
                    style={messageAccentTheme ? { backgroundColor: messageAccentTheme.softStrong, color: messageAccentTheme.text } : undefined}
                    onClick={() => setViewingFile({ url: att.url, filename: att.filename || 'image.png', type: att.type })}
                  >
                    <img
                      src={att.url}
                      alt={att.filename || 'Immagine allegata'}
                      className="h-full w-full object-cover transition-transform duration-200 group-hover:scale-[1.03]"
                      loading="lazy"
                    />
                    <div className="absolute inset-x-0 bottom-0 flex items-center gap-1.5 bg-slate-950/70 px-2 py-1 text-white backdrop-blur-sm">
                      <ImageIcon className="h-3.5 w-3.5 flex-shrink-0" />
                      <span className="truncate text-[10px] font-semibold">{att.filename || 'Immagine'}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
            {fileAttachments.length > 0 && (
              <div className="mt-2 space-y-1">
                {fileAttachments.map((att: any, idx: number) => (
                  <button
                    key={idx}
                    type="button"
                    draggable
                    onDragStart={(e) => {
                      e.stopPropagation()
                      e.dataTransfer.setData('desktop/file', JSON.stringify({
                        filename: att.filename || 'file',
                        mime_type: att.type || 'application/octet-stream',
                        url: att.url,
                      }))
                      e.dataTransfer.effectAllowed = 'copy'
                    }}
                    onClick={(e) => {
                      e.stopPropagation()
                      setViewingFile({ url: att.url, filename: att.filename || 'file', type: att.type })
                    }}
                    title="Apri allegato"
                    className="class-chat-attachment group/att flex w-full cursor-pointer items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs font-semibold text-slate-700 transition-colors hover:bg-white"
                    style={messageAccentTheme ? {
                      borderColor: `${messageAccentTheme.accent}55`,
                      color: messageAccentTheme.text,
                    } : undefined}
                  >
                    <span
                      className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-slate-200 text-slate-600"
                      style={messageAccentTheme ? { backgroundColor: messageAccentTheme.accent, color: '#ffffff' } : undefined}
                    >
                      <Paperclip className="h-3 w-3" />
                    </span>
                    <span className="min-w-0 flex-1 break-words leading-snug [overflow-wrap:anywhere]">{att.filename || 'Allegato'}</span>
                    <ExternalLink className="h-3.5 w-3.5 shrink-0 opacity-45 transition-opacity group-hover/att:opacity-90" />
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className={`flex items-center gap-2 mt-1 ${isMe ? 'flex-row-reverse' : ''}`}>
            <span className="text-[9px] text-slate-300 font-medium">
              {new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </span>
            {activeTab !== 'private' && (
              <button
                onClick={() => setReplyingTo(msg)}
                className="opacity-0 group-hover/msg:opacity-100 transition-opacity p-0.5 rounded text-slate-400 hover:text-slate-600 hover:bg-slate-100"
                title="Rispondi"
              >
                <CornerUpLeft className="h-3 w-3" />
              </button>
            )}
          </div>
        </div>
      </div>
    )
  }



  const renderPrivateChatsTab = () => {
    const chatList = Object.values(privateChats)
    const currentChat = activePrivateChat ? privateChats[activePrivateChat] : null

    if (chatList.length === 0) {
      return (
        <div className="flex-1 flex flex-col items-center justify-center p-6 text-center">
          <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl border border-slate-200 bg-white text-slate-300 shadow-sm">
            <MessagesSquare className="h-6 w-6" />
          </div>
          <p className="text-xs font-bold uppercase tracking-wide text-slate-500">{t('chat_sidebar.no_private_chat')}</p>
          <p className="mt-1 max-w-48 text-[11px] leading-relaxed text-slate-400">
            {userType === 'teacher' ? t('chat_sidebar.start_chat_from_students') : t('chat_sidebar.wait_teacher_private_chat')}
          </p>
        </div>
      )
    }

    const currentChatMessages = activePrivateChat ? privateChats[activePrivateChat]?.messages || [] : []

    return (
      <div className="flex-1 flex overflow-hidden bg-white">
        {/* Vertical tabs for private chats */}
        <div className="w-[76px] flex-shrink-0 overflow-y-auto border-r border-slate-200 bg-slate-50/80 px-2 py-3">
          <div className="mb-3 text-center text-[9px] font-bold uppercase tracking-wide text-slate-400">
            Private
          </div>
          <div className="flex flex-col items-center gap-2">
          {chatList.map((chat) => (
            <button
              key={chat.oderId}
              onClick={() => {
                setActivePrivateChat(chat.oderId)
                markPrivateChatRead(chat.oderId)
              }}
              className={`relative flex h-12 w-12 items-center justify-center rounded-2xl border transition-all ${activePrivateChat === chat.oderId
                ? 'border-[var(--app-accent)] bg-[var(--app-accent-soft)] shadow-sm'
                : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-white'
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
                    ? 'bg-[var(--app-accent)] text-white'
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
        </div>

        {/* Chat messages area */}
        <div className="flex-1 flex min-w-0 flex-col overflow-hidden">
          {activePrivateChat ? (
            <>
              {/* Chat header */}
              <div className="flex items-center gap-3 border-b border-slate-100 bg-white px-4 py-3">
                <Avatar className="h-9 w-9 border border-slate-200">
                  {currentChat?.peerAvatarUrl ? (
                    <img
                      src={currentChat.peerAvatarUrl}
                      alt={currentChat.peerName}
                      className="h-full w-full rounded-full object-cover"
                    />
                  ) : (
                    <AvatarFallback className="bg-[var(--app-accent-soft)] text-xs font-black text-[var(--app-accent-text)]">
                      {(currentChat?.peerName || 'Chat').substring(0, 2).toUpperCase()}
                    </AvatarFallback>
                  )}
                </Avatar>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-bold text-slate-800">
                    {currentChat?.peerName || 'Chat privata'}
                  </p>
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                    Chat privata
                  </p>
                </div>
              </div>
              {/* Messages */}
              <div className="flex-1 overflow-y-auto space-y-4 bg-slate-50/50 p-4" ref={scrollRef}>
                {currentChatMessages.length === 0 ? (
                  <div className="flex h-full flex-col items-center justify-center text-center">
                    <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-2xl border border-slate-200 bg-white text-slate-300 shadow-sm">
                      <MessageCircle className="h-5 w-5" />
                    </div>
                    <p className="text-xs font-bold uppercase tracking-wide text-slate-400">{t('chat_sidebar.start_conversation')}</p>
                  </div>
                ) : (
                  currentChatMessages.map((msg, idx) => renderMessage(msg, idx, currentChatMessages))
                )}
              </div>
            </>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center p-6 text-center">
              <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-2xl border border-slate-200 bg-white text-slate-300 shadow-sm">
                <MessageCircle className="h-5 w-5" />
              </div>
              <p className="text-xs font-bold uppercase tracking-wide text-slate-400">{t('chat_sidebar.select_chat')}</p>
            </div>
          )}
        </div>
      </div>
    )
  }

  const renderSessionChat = () => {
    return (
      <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
        <div
          className="min-h-0 flex-1 overflow-y-auto space-y-6 bg-transparent p-4 scroll-smooth overscroll-contain"
          ref={scrollRef}
        >
          {loadingOlderPublicMessages && (
            <div className="flex justify-center py-2">
              <div className="flex items-center gap-1.5 text-[10px] text-slate-400 bg-white/80 px-3 py-1 rounded-full border border-slate-100">
                <span className="w-1.5 h-1.5 rounded-full bg-slate-300 animate-bounce" style={{ animationDelay: '0ms' }} />
                <span className="w-1.5 h-1.5 rounded-full bg-slate-300 animate-bounce" style={{ animationDelay: '150ms' }} />
                <span className="w-1.5 h-1.5 rounded-full bg-slate-300 animate-bounce" style={{ animationDelay: '300ms' }} />
              </div>
            </div>
          )}
          {!hasMorePublicMessages && messages.length > 0 && (
            <div className="text-center text-[10px] text-slate-300 uppercase tracking-wider">{t('chat_sidebar.chat_start')}</div>
          )}
          {messages.length === 0 && (
            loadingInitialMessages ? (
              /* Skeleton while initial messages load */
              <div className="space-y-4 pt-2 pointer-events-none select-none">
                {[60, 80, 45, 70, 55].map((w, i) => (
                  <div key={i} className={`flex gap-2 ${i % 2 === 1 ? 'justify-end' : 'justify-start'}`}>
                    {i % 2 === 0 && <div className="w-6 h-6 rounded-full bg-slate-200 animate-pulse flex-shrink-0 self-end" />}
                    <div className="flex flex-col gap-1" style={{ alignItems: i % 2 === 1 ? 'flex-end' : 'flex-start' }}>
                      <div className="h-8 rounded-2xl bg-slate-200 animate-pulse" style={{ width: `${w * 2.2}px`, animationDelay: `${i * 100}ms` }} />
                      <div className="h-2.5 rounded bg-slate-100 animate-pulse" style={{ width: `${w}px`, animationDelay: `${i * 100 + 50}ms` }} />
                    </div>
                    {i % 2 === 1 && <div className="w-6 h-6 rounded-full bg-slate-200 animate-pulse flex-shrink-0 self-end" />}
                  </div>
                ))}
              </div>
            ) : (
              <div className="h-full flex flex-col items-center justify-center text-slate-300 opacity-50">
                <MessageSquare className="h-8 w-8 mb-2" />
                <p className="text-[10px] font-medium uppercase">{t('chat_sidebar.no_messages')}</p>
              </div>
            )
          )}

          {messages.map((msg, idx) => renderMessage(msg, idx, messages))}
        </div>
        {isUserScrolledUp && (
          <button
            className="absolute bottom-3 left-1/2 -translate-x-1/2 flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-[color:var(--selection-border-hover)] bg-[image:var(--selection-active-bg)] text-[var(--selection-active-text)] text-[11px] font-medium shadow-lg hover:bg-[image:var(--selection-active-bg-hover)] transition-all z-10"
            onClick={() => {
              const container = scrollRef.current
              if (container) container.scrollTo({ top: container.scrollHeight, behavior: 'smooth' })
              setIsUserScrolledUp(false)
              setUnreadWhileScrolled(0)
            }}
          >
            <ChevronDown className="h-3.5 w-3.5" />
            {unreadWhileScrolled > 0 ? `${unreadWhileScrolled} nuovi messaggi` : 'Scorri in basso'}
          </button>
        )}
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
            <p className="text-xs">{t('chat_sidebar.no_users_online')}</p>
          </div>
        ) : (
          onlineUsers.map(user => (
            <div
              key={user.student_id}
              className="flex items-center justify-between p-3 bg-white border border-slate-100 rounded-xl shadow-sm hover:border-[#181b1e]/20 transition-all"
            >
              <div className="flex items-center gap-3">
                <Avatar className="h-8 w-8">
                  <AvatarFallback className="bg-[#181b1e]/10 text-neutral-900 text-xs font-bold">
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
              {userType === 'teacher' && user.role === 'student' && user.student_id !== currentUserId && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    startPrivateChat(user)
                    setActiveTab('private')
                    setActivePrivateChat(user.student_id)
                  }}
                  className="h-8 w-8 p-0 rounded-full text-slate-400 hover:text-neutral-900 hover:bg-[#181b1e]/5"
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
      className={`${containerClasses} class-chat-material`}
      style={containerStyle}
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Resize handle — grip centrato verticalmente, non su tutta l'altezza */}
      <div
        className={`${isMobileView ? 'hidden' : 'absolute'} group left-0 top-1/2 z-10 flex h-20 w-4 -translate-y-1/2 cursor-ew-resize items-center justify-center`}
        onMouseDown={handleMouseDown}
        title={sidebarLabels.resize}
      >
        <span
          className={`h-full rounded-full transition-all ${isResizing
            ? 'w-1.5 bg-[#181b1e]'
            : 'w-1 bg-slate-300/80 group-hover:w-1.5 group-hover:bg-[#181b1e]'
            }`}
        />
      </div>

      {/* Header with connection status */}
      <div className="flex items-center justify-between bg-[var(--ds-surface)] px-4 py-3 shadow-[var(--ds-shadow-1)]">
        <div className="flex items-center gap-2">
          <div className={`w-2 h-2 rounded-full ${connected ? 'bg-emerald-500 animate-pulse' : 'bg-slate-300'}`} />
          <h3 className="font-bold text-xs uppercase tracking-widest text-slate-500">
            {userType === 'student' ? sidebarLabels.studentHeader : sidebarLabels.teacherHeader}
          </h3>
        </div>
        <div className="flex items-center gap-1">
          {userType === 'teacher' && !isMobileView && (
            <TuringTestPanel
              sessionId={sessionId}
              userType={userType}
              socket={socket}
              onlineStudentCount={onlineUsers.filter(user => user.role !== 'teacher').length}
            />
          )}
          {onPinToggle && (
            <Button
              variant="ghost"
              size="icon"
              className={`h-6 w-6 ${isPinned ? 'text-neutral-900 bg-[#181b1e]/5' : 'text-slate-400'}`}
              onClick={onPinToggle}
              title={isPinned ? sidebarLabels.unpin : sidebarLabels.pin}
            >
              {isPinned ? <PinOff className="h-3 w-3" /> : <Pin className="h-3 w-3" />}
            </Button>
          )}
          {onToggle && !isPinned && (
            <Button
              variant="ghost"
              size="icon"
              className={`${isMobileView ? 'h-10 w-10 rounded-xl' : 'h-6 w-6'} text-slate-400`}
              onClick={() => onToggle(false)}
            >
              <X className={isMobileView ? 'h-5 w-5' : 'h-3 w-3'} />
            </Button>
          )}
        </div>
      </div>

      {/* Tabs — pill switcher */}
      <div className="shrink-0 bg-[var(--ds-surface)] px-2.5 pb-1.5 pt-2">
        <div
          className="ds-cluster flex items-center gap-1 rounded-[var(--selection-radius)] p-1"
          style={buildAccentNavClusterStyle(studentAccentTheme)}
        >
          {availableTabs.map((tab) => {
            const isTabActive = activeTab === tab
            const tabLabels = {
              session: sidebarLabels.sessionTab,
              private: sidebarLabels.privateTab,
              users: sidebarLabels.usersTab,
            }
            const TabIcons = { session: MessageSquare, private: MessagesSquare, users: Users }
            const TabIcon = TabIcons[tab]
            return (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                {...(tab === 'session' ? {
                  onDragEnter: (e: React.DragEvent) => {
                    const types = Array.from(e.dataTransfer.types || [])
                    if (
                      types.includes('application/x-session-file')
                      || types.includes('application/x-chatbot-document')
                      || types.includes('application/x-chatbot-csv')
                      || types.includes('application/x-chatbot-image')
                      || types.includes('Files')
                    ) setActiveTab('session')
                  }
                } : {})}
                className={[
                  'ui-control-label group relative flex flex-1 min-h-[var(--selection-height)] items-center justify-center gap-1 px-2 py-1.5 rounded-[var(--selection-radius)]',
                  'border-0 transition-all duration-150 focus-visible:outline-none focus-visible:shadow-[var(--ds-shadow-focus)]',
                  isTabActive
                    ? 'bg-[image:var(--selection-active-bg)] text-[var(--selection-active-text)] shadow-[var(--selection-shadow)]'
                    : 'bg-transparent text-slate-600 shadow-none hover:bg-[var(--ds-control-hover)] hover:text-[var(--selection-text)] hover:shadow-[var(--ds-shadow-1)]',
                ].join(' ')}
              >
                <TabIcon className="h-3.5 w-3.5 shrink-0" />
                {tabLabels[tab]}
                {tab === 'private' && totalUnreadPrivate > 0 && (
                  <span className="ml-0.5 px-1 py-0.5 text-[8px] bg-red-500 text-white rounded-full leading-none">
                    {totalUnreadPrivate > 9 ? '9+' : totalUnreadPrivate}
                  </span>
                )}
              </button>
            )
          })}
        </div>
      </div>

      {/* Tab content */}
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <VoiceRoomPanel
          sessionId={sessionId}
          userType={userType}
          currentUserId={currentUserId}
          socket={socket}
        />

        {activeTab === 'session' && renderSessionChat()}

        {activeTab === 'private' && renderPrivateChatsTab()}


        {activeTab === 'users' && renderUsersTab()}
      </div>

      {/* Input area - only show for session chat or when a private chat is selected */}
      {showInputArea && (
        <div
          className="shrink-0 bg-[var(--ds-surface)] p-4 shadow-[0_-4px_14px_rgba(23,23,23,0.045)]"
          style={isMobileView ? { paddingBottom: 'max(1rem, env(safe-area-inset-bottom))' } : undefined}
        >
          {attachedFiles.length > 0 && (
            <div className="mb-3 flex flex-wrap gap-2">
              {attachedFiles.map((file, idx) => (
                <div key={idx} className="relative group">
                  {file.type.startsWith('image/') ? (
                    <div className="relative w-16 h-16 rounded-lg overflow-hidden border border-slate-200">
                      <img
                        src={URL.createObjectURL(file)}
                        alt={getDisplayName(file)}
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
                      <span className="text-xs text-slate-600 truncate max-w-[100px]">{getDisplayName(file)}</span>
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

          {replyingTo && (
            <div className="flex items-center gap-2 px-3 py-1.5 mb-1 bg-slate-50 rounded-xl text-xs text-slate-500 shadow-[var(--ds-shadow-1)]">
              <CornerUpLeft className="h-3 w-3 flex-shrink-0 text-slate-400" />
              <span className="flex-1 truncate">
                <span className="font-semibold text-slate-700">{replyingTo.sender_name}</span>: {replyingTo.text.slice(0, 60)}
              </span>
              <button onClick={() => setReplyingTo(null)} className="flex-shrink-0 text-slate-400 hover:text-slate-600">
                <X className="h-3 w-3" />
              </button>
            </div>
          )}
          <div className="ds-control relative flex items-center rounded-[24px] p-1.5 transition-all focus-within:shadow-[var(--ds-shadow-focus)]">
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
              className="h-8 w-8 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-full flex-shrink-0"
              title="Allega file"
            >
              <Paperclip className="h-4 w-4" />
            </Button>
            <VoiceRecorder
              compact
              onInsertText={(text) => setInputText((prev) => prev ? prev + ' ' + text : text)}
            />
            <textarea
              rows={1}
              value={inputText}
              onChange={(e) => {
                setInputText(e.target.value)
                const el = e.currentTarget
                el.style.height = 'auto'
                el.style.height = `${Math.min(el.scrollHeight, 120)}px`
              }}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
              onPaste={handleInputPaste}
              placeholder={activeTab === 'private' ? "Messaggio privato..." : "Scrivi un messaggio..."}
              className="border-none bg-transparent focus-visible:ring-0 focus:outline-none resize-none text-sm px-2 py-2 leading-6 flex-1 shadow-none max-h-[120px]"
            />
            <Button
              size="icon"
              onClick={handleSend}
              disabled={!inputText.trim() && attachedFiles.length === 0}
              className={`h-8 w-8 rounded-full transition-all flex-shrink-0 ${(!inputText.trim() && attachedFiles.length === 0)
                ? 'bg-slate-100 text-slate-300'
                : 'border-0 bg-[image:var(--selection-active-bg)] hover:bg-[image:var(--selection-active-bg-hover)] text-[var(--selection-active-text)] shadow-[var(--ds-shadow-control)]'
                }`}
            >
              <Send className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}

      {dragActive && (
        <div className="absolute inset-0 bg-[#181b1e]/10 backdrop-blur-sm flex items-center justify-center z-50 border-4 border-dashed border-[#181b1e]/40 rounded-lg">
          <div className="text-center">
            <ImageIcon className="h-12 w-12 text-neutral-900 mx-auto mb-2" />
            <p className="text-sm font-semibold text-neutral-900">{t('chat_sidebar.drop_files_here')}</p>
          </div>
        </div>
      )}

      {/* File Viewer Modal */}
      <FileViewerModal file={viewingFile} onClose={() => setViewingFile(null)} />

      {activeToyLMModel && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-sm" onClick={() => setActiveToyLMModel(null)}>
          <div className="w-full max-w-2xl rounded-2xl border border-slate-200 bg-slate-50 p-5 shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="mb-4 flex items-start justify-between gap-3">
              <div className="flex min-w-0 items-center gap-3">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-violet-600 text-white shadow-sm">
                  <Brain className="h-5 w-5" />
                </span>
                <div className="min-w-0">
                  <p className="truncate text-base font-black text-slate-900">{activeToyLMModel.name || 'Modello ToyGPT'}</p>
                  <p className="text-xs text-slate-500">
                    {activeToyLMModel.saved_epoch ?? 0} epoch · {Number(activeToyLMModel.param_count || 0).toLocaleString()} parametri
                  </p>
                </div>
              </div>
              <button
                onClick={() => setActiveToyLMModel(null)}
                className="rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-white hover:text-slate-700"
                title="Chiudi"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white p-4">
              <ToyLMInferencePanel
                key={activeToyLMModel.job_id}
                canGenerate
                unavailableMessage="Modello non disponibile."
                onGenerate={generateSharedToyLMText}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
