import { useState, useEffect, useRef, Dispatch, SetStateAction, useCallback } from 'react'
import { chatApi, filesApi } from '@/lib/api'
import { useSocket, ChatMessage, OnlineUser } from '@/hooks/useSocket'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Send, MessageSquare, Bell, Paperclip, X, Image as ImageIcon,
  MessagesSquare, MessageCircle, Pin, PinOff,
  FileText, FileSpreadsheet, File, Download, ExternalLink, Wand2, Users, Folder, Search, Upload, List, Grid2X2, Minus, Plus
} from 'lucide-react'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { DEFAULT_STUDENT_ACCENT, getStudentAccentTheme, type StudentAccentId } from '@/lib/studentAccent'
import { getTeacherAccentTheme } from '@/lib/teacherAccent'

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
              className="flex items-center gap-2 px-4 py-2 bg-[#181b1e] text-white rounded-lg hover:bg-[#0f1113] transition-colors"
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
              className="p-2 text-slate-500 hover:text-[#181b1e] hover:bg-[#181b1e]/5 rounded-lg transition-colors"
              title="Apri in nuova scheda"
            >
              <ExternalLink className="h-4 w-4" />
            </a>
            <a
              href={file.url}
              download={file.filename}
              className="p-2 text-slate-500 hover:text-[#181b1e] hover:bg-[#181b1e]/5 rounded-lg transition-colors"
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

type TabType = 'session' | 'private' | 'users' | 'files'

interface SessionFile {
  id: string
  filename: string
  mime_type: string
  size_bytes: number
  url: string
  created_at: string
  owner_type: 'student' | 'teacher'
}

interface ChatSidebarProps {
  sessionId: string
  userType: 'teacher' | 'student'
  currentUserId: string
  currentUserName: string
  studentAccent?: StudentAccentId
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
  userType,
  currentUserId,
  studentAccent = DEFAULT_STUDENT_ACCENT,
  onNotificationClick,
  isMobileView = false,
  onToggle,
  isPinned,
  onPinToggle,
  className,
  onWidthChange,
  initialWidth = 380
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
  const [sessionFiles, setSessionFiles] = useState<SessionFile[]>([])
  const [isLoadingFiles, setIsLoadingFiles] = useState(false)
  const [filesSearch, setFilesSearch] = useState('')
  const [filesDropActive, setFilesDropActive] = useState(false)
  const [activeFolder, setActiveFolder] = useState<string | null>(null)
  const [activeFilter, setActiveFilter] = useState<'all' | 'images' | 'pdf' | 'docs' | 'csv' | 'audio' | 'video' | 'other'>('all')
  const [fileTags, setFileTags] = useState<Record<string, string[]>>({})
  const [tagInputs, setTagInputs] = useState<Record<string, string>>({})
  const [filesViewMode, setFilesViewMode] = useState<'grid' | 'list'>('grid')
  const [filesIconScale, setFilesIconScale] = useState(1)
  const [loadMessagesBlocked, setLoadMessagesBlocked] = useState(false)
  const studentAccentTheme = getStudentAccentTheme(studentAccent)
  const scrollRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const libraryFileInputRef = useRef<HTMLInputElement>(null)
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

  const getRelativePath = (file: File) => {
    const relativePath = (file as any).webkitRelativePath as string | undefined
    return relativePath && relativePath.length > 0 ? relativePath : null
  }

  const getDisplayName = (file: File) => getRelativePath(file) || file.name

  const formatFileSize = (bytes: number) => {
    if (!bytes && bytes !== 0) return ''
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`
  }

  const getFileTypeTag = (filename: string, mimeType?: string) => {
    const ext = filename.split('.').pop()?.toLowerCase() || ''
    if (mimeType?.startsWith('image/') || ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp'].includes(ext)) return 'IMG'
    if (ext === 'pdf' || mimeType === 'application/pdf') return 'PDF'
    if (['doc', 'docx'].includes(ext) || mimeType?.includes('word')) return 'DOC'
    if (['xls', 'xlsx', 'csv'].includes(ext) || mimeType?.includes('spreadsheet') || mimeType?.includes('excel') || mimeType?.includes('csv')) return 'CSV'
    if (['ppt', 'pptx'].includes(ext) || mimeType?.includes('presentation')) return 'PPT'
    if (['txt', 'md', 'json', 'xml'].includes(ext)) return 'TXT'
    return 'FILE'
  }

  const getFileCategory = (filename: string, mimeType?: string) => {
    const ext = filename.split('.').pop()?.toLowerCase() || ''
    if (mimeType?.startsWith('image/') || ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp'].includes(ext)) return 'images'
    if (ext === 'pdf' || mimeType === 'application/pdf') return 'pdf'
    if (['doc', 'docx', 'rtf', 'odt'].includes(ext) || mimeType?.includes('word')) return 'docs'
    if (['xls', 'xlsx', 'csv'].includes(ext) || mimeType?.includes('spreadsheet') || mimeType?.includes('excel') || mimeType?.includes('csv')) return 'csv'
    if (mimeType?.startsWith('audio/') || ['mp3', 'wav', 'ogg', 'm4a'].includes(ext)) return 'audio'
    if (mimeType?.startsWith('video/') || ['mp4', 'mov', 'webm', 'avi', 'mkv'].includes(ext)) return 'video'
    return 'other'
  }

  const addFileTag = (fileId: string, rawTag: string) => {
    const tag = rawTag.trim()
    if (!tag) return
    setFileTags(prev => {
      const current = prev[fileId] || []
      if (current.includes(tag)) return prev
      return { ...prev, [fileId]: [...current, tag] }
    })
  }

  const removeFileTag = (fileId: string, tag: string) => {
    setFileTags(prev => {
      const current = prev[fileId] || []
      const next = current.filter(t => t !== tag)
      return { ...prev, [fileId]: next }
    })
  }

  const loadSessionFiles = useCallback(async () => {
    setIsLoadingFiles(true)
    try {
      const res = await filesApi.listSessionFiles(sessionId)
      const filesData = Array.isArray(res.data) ? res.data : []
      setSessionFiles(filesData)
    } catch (e) {
      console.error("Failed to load session files", e)
    } finally {
      setIsLoadingFiles(false)
    }
  }, [sessionId])

  useEffect(() => {
    setMessages(socketMessages)
  }, [socketMessages])

  useEffect(() => {
    setLoadMessagesBlocked(false)
  }, [sessionId])

  useEffect(() => {
    if (messages.length === 0 && !isLoading) {
      if (loadMessagesBlocked) return
      const loadMessages = async () => {
        setIsLoading(true)
        try {
          const res = await chatApi.getSessionMessages(sessionId)
          const messageData = res.data?.messages || res.data
          if (messageData && Array.isArray(messageData)) {
            setMessages(messageData)
          }
        } catch (e: any) {
          console.error("Failed to load messages", e)
          const status = e?.response?.status
          // Avoid infinite retry noise when backend denies access.
          if (status === 403 || status === 401) {
            setLoadMessagesBlocked(true)
          }
        } finally {
          setIsLoading(false)
        }
      }
      loadMessages()
    }
  }, [sessionId, messages.length, isLoading, loadMessagesBlocked])

  useEffect(() => {
    if (activeTab === 'files') {
      loadSessionFiles()
    }
  }, [activeTab, loadSessionFiles])

  useEffect(() => {
    try {
      const stored = localStorage.getItem(`sessionFileTags:${sessionId}`)
      if (stored) {
        setFileTags(JSON.parse(stored))
      }
    } catch (e) {
      console.error('Failed to load file tags', e)
    }
  }, [sessionId])

  useEffect(() => {
    try {
      localStorage.setItem(`sessionFileTags:${sessionId}`, JSON.stringify(fileTags))
    } catch (e) {
      console.error('Failed to save file tags', e)
    }
  }, [fileTags, sessionId])

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
        attachedFiles.forEach(file => {
          formData.append('files', file, getDisplayName(file))
        })

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
      if (uploadedUrls.length > 0) {
        loadSessionFiles()
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
        if (fileUrl.includes('/api/v1/files/') && fileUrl.endsWith('/download-url')) {
          const res = await fetch(fileUrl)
          const json = await res.json()
          fileUrl = json.download_url || json.url || fileUrl
        }
        const res = await fetch(fileUrl)
        const blob = await res.blob()
        const fileObj = new globalThis.File([blob], data.filename || 'file', {
          type: data.mime_type || blob.type || 'application/octet-stream'
        })
        setAttachedFiles(prev => [...prev, fileObj])
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

  const uploadSessionFiles = async (files: File[]) => {
    if (files.length === 0) return
    try {
      const formData = new FormData()
      files.forEach(file => {
        formData.append('files', file, getDisplayName(file))
      })

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

      await res.json()
      await loadSessionFiles()
    } catch (e) {
      console.error("Failed to upload session files", e)
    }
  }

  const createFolderWithKeep = async () => {
    const rawName = window.prompt('Nome cartella')
    if (!rawName) return
    const safeName = rawName.trim().replace(/^\/+|\/+$/g, '')
    if (!safeName) return
    const keepFile = new globalThis.File([''], `${safeName}/.keep`, { type: 'text/plain' })
    await uploadSessionFiles([keepFile])
  }

  const handleLibraryFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || [])
    if (files.length > 0) {
      uploadSessionFiles(files)
    }
    e.target.value = ''
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

  const resolveAccentTheme = (accentId?: string) => {
    if (!accentId) return null
    try {
      if (accentId === 'pink' || accentId === 'blue' || accentId === 'cyan' || accentId === 'orange' || accentId === 'mustard') {
        return getStudentAccentTheme(accentId as StudentAccentId)
      }
      if (accentId === 'red' || accentId === 'indigo' || accentId === 'gray' || accentId === 'green' || accentId === 'slateblue') {
        return getTeacherAccentTheme(accentId)
      }
    } catch {
      return null
    }
    return null
  }

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
            className="mx-2 p-3 bg-gradient-to-br from-[#181b1e]/5 to-slate-50 border border-[#181b1e]/20 rounded-xl shadow-sm"
          >
            <div className="flex items-center gap-3">
              <div className={`w-10 h-10 rounded-lg ${botColor} flex items-center justify-center shadow-md flex-shrink-0`}>
                <Wand2 className="h-5 w-5 text-white" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5 mb-0.5">
                  <span className="text-[10px] font-bold text-[#181b1e] uppercase">Nuovo Assistente</span>
                </div>
                <p className="text-sm font-semibold text-slate-800 truncate">{data.name}</p>
                {data.synopsis && (
                  <p className="text-xs text-slate-500 line-clamp-2 mt-0.5">{data.synopsis}</p>
                )}
              </div>
            </div>
            <button
              onClick={() => onNotificationClick?.(msg)}
              className="mt-3 w-full py-2 bg-[#181b1e] hover:bg-[#0f1113] text-white text-xs font-semibold rounded-lg transition-colors flex items-center justify-center gap-1.5"
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
          className="mx-2 p-3 bg-[#181b1e]/5 border border-[#181b1e]/15 rounded-xl cursor-pointer hover:bg-[#181b1e]/10 transition-colors shadow-sm group"
        >
          <div className="flex items-center gap-2 mb-1">
            <Bell className="h-3 w-3 text-[#181b1e]" />
            <span className="text-[10px] font-bold text-[#181b1e] uppercase">Notifica</span>
          </div>
          <p className="text-xs font-semibold text-slate-800 group-hover:text-[#181b1e]">{content}</p>
        </div>
      )
    }

    const allAttachments = Array.isArray(msg.attachments)
      ? msg.attachments.filter((att: any) => att.url)
      : []
    const imageAttachments = allAttachments.filter((att: any) => att.type === 'image')
    const fileAttachments = allAttachments.filter((att: any) => att.type !== 'image')
    const accentFromSender = resolveAccentTheme(msg.sender_accent)
    const accentFallback = isMe && userType === 'student' ? studentAccentTheme : null
    const messageAccentTheme = accentFromSender || accentFallback

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
                <AvatarFallback className={`text-[9px] font-black ${isMe ? 'bg-gray-300 text-gray-700' : 'bg-gray-200 text-gray-600'}`}>
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
              ? messageAccentTheme
                ? 'border rounded-2xl rounded-tr-none'
                : 'bg-gray-100 text-gray-800 border border-gray-200 rounded-2xl rounded-tr-none'
              : 'bg-gray-50 text-gray-700 border border-gray-200 rounded-2xl rounded-tl-none'}
          `}
            style={messageAccentTheme ? { backgroundColor: messageAccentTheme.accent, borderColor: messageAccentTheme.accent, color: '#ffffff' } : undefined}
          >
            {isMe ? linkify(content, messageAccentTheme ? 'text-white/90 hover:text-white underline break-all' : undefined) : (
              // For received messages, basic linkify with darker link color
              content.split(/(https?:\/\/[^\s]+)/g).map((part: string, i: number) => {
                if (part.match(/(https?:\/\/[^\s]+)/g)) {
                  return <a key={i} href={part} target="_blank" rel="noopener noreferrer" className={messageAccentTheme ? 'text-white/90 hover:text-white underline break-all' : 'text-red-600 hover:text-red-700 underline break-all'}>{part}</a>
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
                      ? messageAccentTheme
                        ? 'text-slate-800 hover:brightness-95'
                        : 'bg-gray-200 hover:bg-gray-300 text-gray-700'
                      : 'bg-gray-100 hover:bg-gray-200 text-gray-700'
                      }`}
                    style={messageAccentTheme ? { backgroundColor: messageAccentTheme.softStrong, color: messageAccentTheme.text } : undefined}
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
                ? 'bg-[#181b1e] shadow-md'
                : 'bg-white hover:bg-[#181b1e]/5 border border-slate-200'
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
                    ? 'bg-[#181b1e] text-white'
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
              className="flex items-center justify-between p-3 bg-white border border-slate-100 rounded-xl shadow-sm hover:border-[#181b1e]/20 transition-all"
            >
              <div className="flex items-center gap-3">
                <Avatar className="h-8 w-8">
                  <AvatarFallback className="bg-[#181b1e]/10 text-[#181b1e] text-xs font-bold">
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
                  className="h-8 w-8 p-0 rounded-full text-slate-400 hover:text-[#181b1e] hover:bg-[#181b1e]/5"
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

  const renderFilesTab = () => {
    const search = filesSearch.trim().toLowerCase()
    const filteredFiles = sessionFiles.filter(file => {
      if (!search) return true
      return file.filename.toLowerCase().includes(search)
    })

    const gridMin = Math.max(140, Math.round(170 * filesIconScale))
    const gridGap = Math.max(8, Math.round(12 * filesIconScale))

    const rootFiles: Array<{ file: SessionFile; displayName: string }> = []
    const folderMap: Record<string, Array<{ file: SessionFile; displayName: string }>> = {}
    const folderNamesSet = new Set<string>()

    filteredFiles.forEach(file => {
      const parts = file.filename.split('/').filter(Boolean)
      if (parts.length > 1) {
        const folderName = parts[0]
        const displayName = parts.slice(1).join('/')
        folderNamesSet.add(folderName)
        if (displayName === '.keep') {
          return
        }
        if (!folderMap[folderName]) folderMap[folderName] = []
        folderMap[folderName].push({ file, displayName })
      } else {
        if (file.filename === '.keep') {
          return
        }
        rootFiles.push({ file, displayName: file.filename })
      }
    })

    const renderFileCard = (entry: { file: SessionFile; displayName: string }, isNested: boolean) => {
      const typeTag = getFileTypeTag(entry.displayName, entry.file.mime_type)
      const ownerTag = entry.file.owner_type === 'teacher' ? 'Docente' : 'Studente'
      const category = getFileCategory(entry.displayName, entry.file.mime_type)
      const typeTagStyles = typeTag === 'PDF'
        ? 'bg-red-100 text-red-700'
        : typeTag === 'IMG'
          ? 'bg-purple-100 text-purple-700'
          : typeTag === 'DOC'
            ? 'bg-blue-100 text-blue-700'
            : typeTag === 'CSV'
              ? 'bg-emerald-100 text-emerald-700'
              : typeTag === 'PPT'
                ? 'bg-orange-100 text-orange-700'
                : 'bg-slate-100 text-slate-600'

      const tags = fileTags[entry.file.id] || []
      const showByFilter = activeFilter === 'all' || category === activeFilter
      if (!showByFilter) return null

      if (filesViewMode === 'list') {
        const listThumbWidth = Math.max(48, Math.round(64 * filesIconScale))
        const listThumbHeight = Math.max(36, Math.round(48 * filesIconScale))

        return (
          <div
            key={entry.file.id}
            draggable
            onDragStart={(e) => {
              const payload = JSON.stringify({
                id: entry.file.id,
                filename: entry.file.filename,
                mime_type: entry.file.mime_type,
                size_bytes: entry.file.size_bytes,
                url: entry.file.url
              })
              e.dataTransfer.setData('application/x-session-file', payload)
              e.dataTransfer.setData('text/plain', entry.file.filename)
              e.dataTransfer.effectAllowed = 'copy'
            }}
            onClick={() => setViewingFile({ url: entry.file.url, filename: entry.file.filename, type: entry.file.mime_type })}
            className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white p-3 shadow-sm hover:shadow-md transition-all cursor-pointer"
          >
            <div
              className="rounded-lg overflow-hidden bg-slate-100 flex items-center justify-center flex-shrink-0"
              style={{ width: `${listThumbWidth}px`, height: `${listThumbHeight}px` }}
            >
              {category === 'images' ? (
                <img src={entry.file.url} alt={entry.displayName} className="w-full h-full object-cover" />
              ) : (
                <File className="h-5 w-5 text-slate-400" />
              )}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-slate-800 truncate">{entry.displayName}</p>
              <div className="flex items-center gap-2 mt-1 text-[10px] text-slate-400">
                <span>{formatFileSize(entry.file.size_bytes)}</span>
                <span>•</span>
                <span>{new Date(entry.file.created_at).toLocaleDateString()}</span>
              </div>
              <div className="mt-2 flex flex-wrap gap-1">
                {tags.map(tag => (
                  <button
                    key={tag}
                    onClick={(e) => {
                      e.stopPropagation()
                      removeFileTag(entry.file.id, tag)
                    }}
                    className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-slate-100 text-slate-600 hover:bg-red-50 hover:text-red-600"
                    title="Rimuovi tag"
                  >
                    {tag} ✕
                  </button>
                ))}
              </div>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase ${typeTagStyles}`}>{typeTag}</span>
              <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase bg-[#181b1e]/5 text-[#181b1e]">
                {ownerTag}
              </span>
            </div>
          </div>
        )
      }

      return (
        <div
          key={entry.file.id}
          draggable
          onDragStart={(e) => {
            const payload = JSON.stringify({
              id: entry.file.id,
              filename: entry.file.filename,
              mime_type: entry.file.mime_type,
              size_bytes: entry.file.size_bytes,
              url: entry.file.url
            })
            e.dataTransfer.setData('application/x-session-file', payload)
            e.dataTransfer.setData('text/plain', entry.file.filename)
            e.dataTransfer.effectAllowed = 'copy'
          }}
          className={`group rounded-xl border border-slate-200 bg-white shadow-sm hover:shadow-md transition-all cursor-pointer ${isNested ? 'ml-2' : ''}`}
          onClick={() => setViewingFile({ url: entry.file.url, filename: entry.file.filename, type: entry.file.mime_type })}
        >
          <div className="aspect-[4/3] w-full rounded-t-xl overflow-hidden bg-slate-100 flex items-center justify-center">
            {category === 'images' ? (
              <img src={entry.file.url} alt={entry.displayName} className="w-full h-full object-cover" />
            ) : (
              <div className="flex flex-col items-center gap-2 text-slate-400">
                <File className="h-8 w-8" />
                <span className="text-[10px] font-semibold uppercase">{typeTag}</span>
              </div>
            )}
          </div>
          <div className="p-3">
            <p className="text-sm font-semibold text-slate-800 truncate">{entry.displayName}</p>
            <div className="flex items-center gap-2 mt-1 text-[10px] text-slate-400">
              <span>{formatFileSize(entry.file.size_bytes)}</span>
              <span>•</span>
              <span>{new Date(entry.file.created_at).toLocaleDateString()}</span>
            </div>
            <div className="flex flex-wrap gap-1 mt-2">
              <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase ${typeTagStyles}`}>{typeTag}</span>
              <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase bg-[#181b1e]/5 text-[#181b1e]">
                {ownerTag}
              </span>
            </div>
            <div className="mt-2 flex flex-wrap gap-1">
              {tags.map(tag => (
                <button
                  key={tag}
                  onClick={(e) => {
                    e.stopPropagation()
                    removeFileTag(entry.file.id, tag)
                  }}
                  className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-slate-100 text-slate-600 hover:bg-red-50 hover:text-red-600"
                  title="Rimuovi tag"
                >
                  {tag} ✕
                </button>
              ))}
            </div>
            <div className="mt-2">
              <input
                value={tagInputs[entry.file.id] || ''}
                onChange={(e) => setTagInputs(prev => ({ ...prev, [entry.file.id]: e.target.value }))}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    addFileTag(entry.file.id, tagInputs[entry.file.id] || '')
                    setTagInputs(prev => ({ ...prev, [entry.file.id]: '' }))
                  }
                }}
                onClick={(e) => e.stopPropagation()}
                placeholder="Aggiungi tag…"
                className="w-full text-xs px-2 py-1 rounded-md border border-slate-200 focus:outline-none focus:ring-1 focus:ring-[#181b1e]"
              />
            </div>
          </div>
        </div>
      )
    }

    const folderNames = Array.from(new Set([...folderNamesSet, ...Object.keys(folderMap)])).sort((a, b) => a.localeCompare(b))

    const handleFilesDragOver = (e: React.DragEvent) => {
      e.preventDefault()
      setFilesDropActive(true)
    }

    const handleFilesDragLeave = () => {
      setFilesDropActive(false)
    }

    const handleFilesDrop = async (e: React.DragEvent) => {
      e.preventDefault()
      setFilesDropActive(false)
      const files = Array.from(e.dataTransfer.files || [])
      if (files.length > 0) {
        await uploadSessionFiles(files)
      }
    }

    return (
      <div
        className="flex-1 overflow-y-auto bg-slate-50/30"
        onDragOver={handleFilesDragOver}
        onDragLeave={handleFilesDragLeave}
        onDrop={handleFilesDrop}
      >
        <div className="sticky top-0 z-10 bg-white/95 backdrop-blur border-b border-slate-100 px-4 py-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
            <Input
              value={filesSearch}
              onChange={(e) => setFilesSearch(e.target.value)}
              placeholder="Cerca file o cartelle..."
              className="pl-9 h-9"
            />
          </div>
          <div className="mt-3 flex items-center gap-2">
            <div className="relative group">
              <Button
                size="icon"
                variant="outline"
                onClick={() => libraryFileInputRef.current?.click()}
                className="h-8 w-8"
                title="Carica file"
              >
                <Upload className="h-4 w-4" />
              </Button>
              <div className="pointer-events-none absolute -bottom-8 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-md bg-slate-900 px-2 py-1 text-[10px] text-white opacity-0 group-hover:opacity-100 transition-opacity">
                Carica file
              </div>
            </div>
            <div className="relative group">
              <Button
                size="icon"
                variant="outline"
                onClick={createFolderWithKeep}
                className="h-8 w-8"
                title="Nuova cartella"
              >
                <Folder className="h-4 w-4" />
              </Button>
              <div className="pointer-events-none absolute -bottom-8 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-md bg-slate-900 px-2 py-1 text-[10px] text-white opacity-0 group-hover:opacity-100 transition-opacity">
                Nuova cartella
              </div>
            </div>
            <div className="relative group">
              <Button
                size="icon"
                variant="outline"
                onClick={() => setFilesViewMode(prev => prev === 'grid' ? 'list' : 'grid')}
                className="h-8 w-8"
                title="Cambia vista"
              >
                {filesViewMode === 'grid' ? <List className="h-4 w-4" /> : <Grid2X2 className="h-4 w-4" />}
              </Button>
              <div className="pointer-events-none absolute -bottom-8 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-md bg-slate-900 px-2 py-1 text-[10px] text-white opacity-0 group-hover:opacity-100 transition-opacity">
                {filesViewMode === 'grid' ? 'Vista elenco' : 'Vista griglia'}
              </div>
            </div>
            <div className="relative group">
              <Button
                size="icon"
                variant="outline"
                onClick={() => setFilesIconScale((s) => Math.max(0.8, Number((s - 0.1).toFixed(2))))}
                className="h-8 w-8"
                title="Riduci icone"
              >
                <Minus className="h-4 w-4" />
              </Button>
              <div className="pointer-events-none absolute -bottom-8 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-md bg-slate-900 px-2 py-1 text-[10px] text-white opacity-0 group-hover:opacity-100 transition-opacity">
                Riduci icone
              </div>
            </div>
            <div className="relative group">
              <Button
                size="icon"
                variant="outline"
                onClick={() => setFilesIconScale((s) => Math.min(1.4, Number((s + 0.1).toFixed(2))))}
                className="h-8 w-8"
                title="Aumenta icone"
              >
                <Plus className="h-4 w-4" />
              </Button>
              <div className="pointer-events-none absolute -bottom-8 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-md bg-slate-900 px-2 py-1 text-[10px] text-white opacity-0 group-hover:opacity-100 transition-opacity">
                Aumenta icone
              </div>
            </div>
            <input
              ref={libraryFileInputRef}
              type="file"
              multiple
              className="hidden"
              onChange={handleLibraryFileSelect}
            />
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            {[
              { key: 'all', label: 'Tutti' },
              { key: 'images', label: 'Immagini' },
              { key: 'pdf', label: 'PDF' },
              { key: 'docs', label: 'Doc' },
              { key: 'csv', label: 'CSV' },
              { key: 'audio', label: 'Audio' },
              { key: 'video', label: 'Video' },
              { key: 'other', label: 'Altro' },
            ].map(item => (
              <button
                key={item.key}
                onClick={() => setActiveFilter(item.key as typeof activeFilter)}
                className={`px-3 py-1 rounded-full text-[10px] font-semibold uppercase transition-colors ${activeFilter === item.key
                  ? 'bg-[#181b1e] text-white'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                  }`}
              >
                {item.label}
              </button>
            ))}
          </div>
          <div className="mt-3 flex items-center gap-2 text-xs text-slate-400">
            <button
              onClick={() => setActiveFolder(null)}
              className={`font-semibold ${!activeFolder ? 'text-[#181b1e]' : 'text-slate-500 hover:text-[#181b1e]'}`}
            >
              Tutti i file
            </button>
            {activeFolder && (
              <>
                <span>/</span>
                <span className="font-semibold text-slate-700">{activeFolder}</span>
              </>
            )}
          </div>
        </div>

        <div className="p-3 space-y-3">
          {filesDropActive && (
            <div className="border-2 border-dashed border-[#181b1e]/40 bg-[#181b1e]/5/70 text-[#181b1e] rounded-xl p-6 text-center text-sm font-semibold">
              Rilascia qui per condividere i file con la classe
            </div>
          )}

          {isLoadingFiles && (
            <div className="text-center py-8 text-slate-400 text-xs">Caricamento file...</div>
          )}

          {!isLoadingFiles && filteredFiles.length === 0 && (
            <div className="text-center py-10 text-slate-300">
              <Folder className="h-8 w-8 mx-auto mb-2" />
              <p className="text-xs font-semibold uppercase tracking-wide">Nessun file</p>
              <p className="text-[10px] mt-1">Carica file o cartelle per condividerli con la classe</p>
            </div>
          )}

          {!activeFolder && folderNames.length > 0 && (
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              {folderNames.map(folder => (
                <button
                  key={folder}
                  onClick={() => setActiveFolder(folder)}
                  className="rounded-xl border border-slate-200 bg-white p-4 text-left hover:border-[#181b1e]/30 hover:shadow-sm transition-all"
                >
                  <div className="flex items-center gap-2">
                    <Folder className="h-5 w-5 text-[#181b1e]" />
                    <span className="font-semibold text-slate-800 truncate">{folder}</span>
                  </div>
                  <p className="text-[10px] text-slate-400 mt-2">{(folderMap[folder] || []).length} file</p>
                </button>
              ))}
            </div>
          )}

          <div
            className={`${filesViewMode === 'grid' ? 'grid' : 'space-y-2'}`}
            style={filesViewMode === 'grid' ? { gridTemplateColumns: `repeat(auto-fill, minmax(${gridMin}px, 1fr))`, gap: `${gridGap}px` } : undefined}
          >
            {(activeFolder ? (folderMap[activeFolder] || []) : rootFiles)
              .map(entry => renderFileCard(entry, !!activeFolder))
              .filter(Boolean)}
          </div>
        </div>
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
          ? 'bg-[#181b1e] w-3'
          : 'bg-slate-200/50 hover:bg-[#181b1e] hover:w-3'
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
              className={`h-6 w-6 ${isPinned ? 'text-[#181b1e] bg-[#181b1e]/5' : 'text-slate-400'}`}
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
          onDragEnter={(e) => {
            const types = Array.from(e.dataTransfer.types || [])
            if (types.includes('application/x-session-file') || types.includes('Files')) {
              setActiveTab('session')
            }
          }}
          className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 text-[10px] font-bold uppercase tracking-wider transition-all ${activeTab === 'session'
            ? 'text-[#181b1e] border-b-2 border-[#181b1e] bg-[#181b1e]/5'
            : 'text-slate-400 hover:text-slate-600 hover:bg-slate-50'
            }`}
        >
          <MessageSquare className="h-3.5 w-3.5" />
          Sessione
        </button>

        <button
          onClick={() => setActiveTab('private')}
          className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 text-[10px] font-bold uppercase tracking-wider transition-all relative ${activeTab === 'private'
            ? 'text-[#181b1e] border-b-2 border-[#181b1e] bg-[#181b1e]/5'
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
          onClick={() => setActiveTab('files')}
          className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 text-[10px] font-bold uppercase tracking-wider transition-all ${activeTab === 'files'
            ? 'text-[#181b1e] border-b-2 border-[#181b1e] bg-[#181b1e]/5'
            : 'text-slate-400 hover:text-slate-600 hover:bg-slate-50'
            }`}
        >
          <Folder className="h-3.5 w-3.5" />
          File
        </button>

        <button
          onClick={() => setActiveTab('users')}
          className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 text-[10px] font-bold uppercase tracking-wider transition-all ${activeTab === 'users'
            ? 'text-[#181b1e] border-b-2 border-[#181b1e] bg-[#181b1e]/5'
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

        {activeTab === 'files' && renderFilesTab()}

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

          <div className="relative flex items-center bg-slate-50 rounded-full border border-slate-200 focus-within:border-[#181b1e]/40 focus-within:ring-2 focus-within:ring-[#181b1e]/20 transition-all px-1">
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
              className="w-8 h-8 rounded-full text-slate-500 hover:text-[#181b1e] hover:bg-[#181b1e]/5"
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
              className={`w-8 h-8 rounded-full ${(!inputText.trim() && attachedFiles.length === 0) ? 'bg-slate-200 text-slate-400' : 'bg-[#181b1e] text-white shadow-md'}`}
            >
              <Send className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}

      {dragActive && (
        <div className="absolute inset-0 bg-[#181b1e]/10 backdrop-blur-sm flex items-center justify-center z-50 border-4 border-dashed border-[#181b1e]/40 rounded-lg">
          <div className="text-center">
            <ImageIcon className="h-12 w-12 text-[#181b1e] mx-auto mb-2" />
            <p className="text-sm font-semibold text-[#181b1e]">Trascina qui i file</p>
          </div>
        </div>
      )}

      {/* File Viewer Modal */}
      <FileViewerModal file={viewingFile} onClose={() => setViewingFile(null)} />
    </div>
  )
}
