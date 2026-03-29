import { useEffect, useRef, useState, useCallback } from 'react'
import { io, Socket } from 'socket.io-client'
import { useAuthStore } from '@/stores/auth'
import { chatApi } from '@/lib/api'

export interface ChatMessage {
  id: string
  sender_type: 'TEACHER' | 'STUDENT'
  sender_id: string
  sender_name?: string
  sender_avatar_url?: string
  sender_accent?: string
  text: string
  attachments?: unknown[]
  created_at: string
  room_type?: 'PUBLIC' | 'DM'
  is_private?: boolean
  target_id?: string
  is_notification?: boolean
  notification_type?: 'task' | 'document' | 'quiz' | 'system' | 'teacherbot_published'
  notification_data?: Record<string, unknown>
  reply_to_id?: string
  reply_preview?: string
}

export interface OnlineUser {
  student_id: string
  nickname?: string
  avatar_url?: string
  ui_accent?: string
  role?: 'student' | 'teacher'
  activity?: {
    module_key?: string
    step?: string
  }
}

export interface PrivateChat {
  oderId: string
  peerName: string
  peerAvatarUrl?: string
  messages: ChatMessage[]
  unreadCount: number
}

type PublicChatCache = {
  messages: ChatMessage[]
  nextCursor: string | null
  hasMore: boolean
  updatedAt: number
}

const PUBLIC_CHAT_CACHE = new Map<string, PublicChatCache>()
const CACHE_TTL_MS = 2 * 60 * 1000
const DEFAULT_CHUNK_SIZE = 30
const MAX_IN_MEMORY_MESSAGES = 300
const PERSISTED_CACHE_TTL_MS = 10 * 60 * 1000

const getPersistedCacheKey = (sessionId: string) => `chat:session:${sessionId}:v2`

interface UseSocketReturn {
  socket: Socket | null
  connected: boolean
  messages: ChatMessage[]
  onlineUsers: OnlineUser[]
  privateChats: Record<string, PrivateChat>
  sendPublicMessage: (text: string, attachmentUrls?: string[], filenameMap?: Record<string, string>, replyToId?: string, replyPreview?: string) => Promise<void>
  sendPrivateMessage: (targetId: string, text: string, attachmentUrls?: string[], filenameMap?: Record<string, string>) => void
  startPrivateChat: (user: OnlineUser) => void
  markPrivateChatRead: (oderId: string) => void
  notifications: ChatMessage[]
  clearNotification: (id: string) => void
  currentUserId: string | null
  loadOlderPublicMessages: () => Promise<void>
  hasMorePublicMessages: boolean
  loadingOlderPublicMessages: boolean
  loadingInitialMessages: boolean
}

const dedupeById = (messages: ChatMessage[]): ChatMessage[] => {
  const seen = new Set<string>()
  const result: ChatMessage[] = []
  for (const msg of messages) {
    if (!msg?.id || seen.has(msg.id)) continue
    seen.add(msg.id)
    result.push(msg)
  }
  return result
}

export function useSocket(sessionId?: string): UseSocketReturn {
  const socketRef = useRef<Socket | null>(null)
  const [connected, setConnected] = useState(false)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [onlineUsers, setOnlineUsers] = useState<OnlineUser[]>([])
  const [privateChats, setPrivateChats] = useState<Record<string, PrivateChat>>({})
  const [notifications, setNotifications] = useState<ChatMessage[]>([])
  const [currentUserId, setCurrentUserId] = useState<string | null>(null)
  const [hasMorePublicMessages, setHasMorePublicMessages] = useState(true)
  const [loadingOlderPublicMessages, setLoadingOlderPublicMessages] = useState(false)
  const [loadingInitialMessages, setLoadingInitialMessages] = useState(!!sessionId)

  const currentUserIdRef = useRef<string | null>(null)
  const onlineUsersRef = useRef<OnlineUser[]>([])
  const nextCursorRef = useRef<string | null>(null)
  const hasMoreRef = useRef(true)
  // Batching for high-frequency activity updates
  const pendingActivityUpdatesRef = useRef<Map<string, { module_key?: string; step?: string }>>(new Map())
  const activityFlushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const { accessToken } = useAuthStore()
  const studentToken = typeof window !== 'undefined' ? localStorage.getItem('student_token') : null
  const authToken = accessToken || studentToken

  useEffect(() => {
    currentUserIdRef.current = currentUserId
  }, [currentUserId])

  useEffect(() => {
    onlineUsersRef.current = onlineUsers
  }, [onlineUsers])

  useEffect(() => {
    hasMoreRef.current = hasMorePublicMessages
  }, [hasMorePublicMessages])

  useEffect(() => {
    if (authToken) {
      try {
        const payload = JSON.parse(atob(authToken.split('.')[1]))
        setCurrentUserId(payload.sub || null)
      } catch {
        setCurrentUserId(null)
      }
    }
  }, [authToken])

  const updatePublicCache = useCallback((nextMessages: ChatMessage[], nextCursor: string | null, nextHasMore: boolean) => {
    if (!sessionId) return
    const payload: PublicChatCache = {
      messages: nextMessages,
      nextCursor,
      hasMore: nextHasMore,
      updatedAt: Date.now(),
    }
    PUBLIC_CHAT_CACHE.set(sessionId, payload)
    try {
      localStorage.setItem(getPersistedCacheKey(sessionId), JSON.stringify(payload))
    } catch {
      // ignore storage failures
    }
  }, [sessionId])

  const loadInitialPublicMessages = useCallback(async () => {
    if (!sessionId) return
    setLoadingInitialMessages(true)

    // Show from in-memory cache instantly (no spinner needed)
    const cached = PUBLIC_CHAT_CACHE.get(sessionId)
    if (cached && Date.now() - cached.updatedAt < CACHE_TTL_MS) {
      setMessages(cached.messages)
      nextCursorRef.current = cached.nextCursor
      setHasMorePublicMessages(cached.hasMore)
      setLoadingInitialMessages(false)
      return
    }

    // Show from localStorage cache while fetching fresh data
    try {
      const raw = localStorage.getItem(getPersistedCacheKey(sessionId))
      if (raw) {
        const parsed = JSON.parse(raw) as PublicChatCache
        if (Array.isArray(parsed?.messages) && Date.now() - Number(parsed?.updatedAt || 0) < PERSISTED_CACHE_TTL_MS) {
          setMessages(parsed.messages)
          nextCursorRef.current = parsed.nextCursor || null
          setHasMorePublicMessages(Boolean(parsed.hasMore))
          setLoadingInitialMessages(false) // cache hit — hide skeleton
        }
      }
    } catch {
      // ignore malformed cache
    }

    try {
      const res = await chatApi.getSessionMessages(sessionId, { limit: DEFAULT_CHUNK_SIZE })
      const list = Array.isArray(res.data?.messages) ? res.data.messages : []
      const hasMore = Boolean(res.data?.has_more)
      const nextCursor = (res.data?.next_cursor as string | null) || (list[0]?.created_at ?? null)
      setMessages(list)
      nextCursorRef.current = nextCursor
      setHasMorePublicMessages(hasMore)
      updatePublicCache(list, nextCursor, hasMore)
    } catch (err) {
      console.error('Failed to load chat messages:', err)
    } finally {
      setLoadingInitialMessages(false)
    }
  }, [sessionId, updatePublicCache])

  const loadOlderPublicMessages = useCallback(async () => {
    if (!sessionId || loadingOlderPublicMessages || !hasMorePublicMessages) return
    const cursor = nextCursorRef.current
    if (!cursor) {
      setHasMorePublicMessages(false)
      return
    }

    setLoadingOlderPublicMessages(true)
    try {
      const res = await chatApi.getSessionMessages(sessionId, {
        limit: DEFAULT_CHUNK_SIZE,
        before_created_at: cursor,
      })
      const older = Array.isArray(res.data?.messages) ? res.data.messages : []
      const hasMore = Boolean(res.data?.has_more)
      const nextCursor = (res.data?.next_cursor as string | null) || (older[0]?.created_at ?? null)

      setMessages((prev) => {
        const merged = dedupeById([...older, ...prev])
        const trimmed = merged.slice(-MAX_IN_MEMORY_MESSAGES)
        updatePublicCache(trimmed, nextCursor, hasMore)
        return trimmed
      })

      nextCursorRef.current = nextCursor
      setHasMorePublicMessages(hasMore)
    } catch (err) {
      console.error('Failed to load older chat messages:', err)
    } finally {
      setLoadingOlderPublicMessages(false)
    }
  }, [hasMorePublicMessages, loadingOlderPublicMessages, sessionId, updatePublicCache])

  useEffect(() => {
    if (!sessionId) return
    nextCursorRef.current = null
    setHasMorePublicMessages(true)
    void loadInitialPublicMessages()
  }, [sessionId, loadInitialPublicMessages])

  useEffect(() => {
    if (!sessionId) return
    const timer = window.setTimeout(() => {
      try {
        const payload: PublicChatCache = {
          messages,
          nextCursor: nextCursorRef.current,
          hasMore: hasMoreRef.current,
          updatedAt: Date.now(),
        }
        localStorage.setItem(getPersistedCacheKey(sessionId), JSON.stringify(payload))
      } catch {
        // ignore storage failures
      }
    }, 200)
    return () => window.clearTimeout(timer)
  }, [messages, sessionId])

  const refreshOnlineUsers = useCallback((socket: Socket, session: string) => {
    socket.emit('join_session', { session_id: session }, (response: { online_students?: OnlineUser[] }) => {
      if (response?.online_students) {
        setOnlineUsers(response.online_students)
      }
    })
  }, [])

  useEffect(() => {
    if (!authToken) return

    const socket = io(window.location.origin, {
      path: '/socket.io',
      auth: { token: authToken },
      // websocket first: much lower CPU than HTTP polling. Falls back to polling if blocked.
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 2000,
      reconnectionDelayMax: 30000,
      timeout: 20000,
    })

    socketRef.current = socket
    ;(window as any).socket = socket

    let refreshInterval: NodeJS.Timeout | null = null

    socket.on('connect', () => {
      setConnected(true)
      if (sessionId) {
        refreshOnlineUsers(socket, sessionId)
        refreshInterval = setInterval(() => {
          if (socket.connected && sessionId) {
            refreshOnlineUsers(socket, sessionId)
          }
        }, 30000)
      }
    })

    socket.on('disconnect', () => {
      setConnected(false)
      setOnlineUsers([])
      if (refreshInterval) {
        clearInterval(refreshInterval)
        refreshInterval = null
      }
    })

    socket.on('connect_error', () => {
      setConnected(false)
    })

    socket.on('reconnect', () => {
      if (sessionId) {
        refreshOnlineUsers(socket, sessionId)
      }
    })

    socket.on('chat_message', (data: { room_type: string; message: ChatMessage; target_id?: string }) => {
      const msg = {
        ...data.message,
        id: data.message.id || `${Date.now()}-${Math.random()}`,
        room_type: data.room_type as 'PUBLIC' | 'DM',
        is_private: data.room_type === 'DM',
        target_id: data.target_id || data.message.target_id,
      }

      if (data.room_type === 'DM') {
        const senderId = msg.sender_id
        const targetId = data.target_id || msg.target_id
        const myId = currentUserIdRef.current

        let peerId: string
        let peerName: string
        let peerAvatarUrl: string | undefined

        if (senderId === myId) {
          peerId = targetId || 'unknown'
          const targetUser = onlineUsersRef.current.find(u => u.student_id === peerId)
          peerName = targetUser?.nickname || 'Destinatario'
          peerAvatarUrl = targetUser?.avatar_url
        } else {
          peerId = senderId
          peerName = msg.sender_name || 'Utente'
          peerAvatarUrl = msg.sender_avatar_url
        }

        setPrivateChats(prev => {
          const existingChat = prev[peerId]
          if (existingChat) {
            if (existingChat.messages.find(m => m.id === msg.id)) return prev
            return {
              ...prev,
              [peerId]: {
                ...existingChat,
                messages: [...existingChat.messages, msg],
                unreadCount: existingChat.unreadCount + (senderId !== myId ? 1 : 0),
              }
            }
          }
          return {
            ...prev,
            [peerId]: {
              oderId: peerId,
              peerName,
              peerAvatarUrl,
              messages: [msg],
              unreadCount: senderId !== myId ? 1 : 0,
            }
          }
        })
      } else {
        setMessages(prev => {
          const merged = dedupeById([...prev, msg])
          const trimmed = merged.slice(-MAX_IN_MEMORY_MESSAGES)
          updatePublicCache(trimmed, nextCursorRef.current, hasMoreRef.current)
          return trimmed
        })
      }
    })

    socket.on('presence_update', (data: { student_id: string; status: string; nickname?: string; avatar_url?: string }) => {
      if (data.status === 'online') {
        setOnlineUsers(prev => {
          const existing = prev.find(u => u.student_id === data.student_id)
          if (existing) {
            return prev.map(u => u.student_id === data.student_id
              ? { ...u, nickname: data.nickname || u.nickname, avatar_url: data.avatar_url || u.avatar_url }
              : u
            )
          }
          return [...prev, { student_id: data.student_id, nickname: data.nickname, avatar_url: data.avatar_url }]
        })
      } else {
        setOnlineUsers(prev => prev.filter(u => u.student_id !== data.student_id))
      }
    })

    socket.on('activity_update', (data: { student_id: string; module_key?: string; step?: string }) => {
      // Batch activity updates: accumulate for 150ms then flush in one setState
      pendingActivityUpdatesRef.current.set(data.student_id, { module_key: data.module_key, step: data.step })
      if (activityFlushTimerRef.current) clearTimeout(activityFlushTimerRef.current)
      activityFlushTimerRef.current = setTimeout(() => {
        const updates = pendingActivityUpdatesRef.current
        if (updates.size === 0) return
        pendingActivityUpdatesRef.current = new Map()
        setOnlineUsers(prev => prev.map(u => {
          const upd = updates.get(u.student_id)
          return upd ? { ...u, activity: upd } : u
        }))
      }, 150)
    })

    socket.on('task_published', (data: { task_id: string; title: string; task_type: string }) => {
      const notification: ChatMessage = {
        id: `notif-${Date.now()}`,
        sender_type: 'TEACHER',
        sender_id: 'system',
        sender_name: 'Sistema',
        text: `📋 Nuovo compito: ${data.title}`,
        created_at: new Date().toISOString(),
        is_notification: true,
        notification_type: data.task_type === 'quiz' ? 'quiz' : 'task',
        notification_data: data,
      }
      setMessages(prev => [...prev, notification])
      setNotifications(prev => [...prev, notification])
    })

    socket.on('document_uploaded', (data: { document_id: string; filename: string }) => {
      const notification: ChatMessage = {
        id: `notif-${Date.now()}`,
        sender_type: 'TEACHER',
        sender_id: 'system',
        sender_name: 'Sistema',
        text: `📄 Nuovo documento: ${data.filename}`,
        created_at: new Date().toISOString(),
        is_notification: true,
        notification_type: 'document',
        notification_data: data,
      }
      setMessages(prev => [...prev, notification])
      setNotifications(prev => [...prev, notification])
    })

    socket.on('task_submission', (data: { task_id: string; task_title: string; student_id: string; student_name: string; submission_id: string }) => {
      const notification: ChatMessage = {
        id: `notif-${Date.now()}`,
        sender_type: 'STUDENT',
        sender_id: data.student_id,
        sender_name: data.student_name,
        text: `✅ ${data.student_name} ha completato: ${data.task_title}`,
        created_at: new Date().toISOString(),
        is_notification: true,
        notification_type: 'task',
        notification_data: data,
      }
      setMessages(prev => [...prev, notification])
      setNotifications(prev => [...prev, notification])
    })

    socket.on('user_frozen', (data: { student_id: string; reason: string }) => {
      const notification: ChatMessage = {
        id: `notif-${Date.now()}`,
        sender_type: 'TEACHER',
        sender_id: 'system',
        sender_name: 'Sistema',
        text: `⚠️ ${data.reason}`,
        created_at: new Date().toISOString(),
        is_notification: true,
        notification_type: 'system',
      }
      setNotifications(prev => [...prev, notification])
    })

    socket.on('teacher_notification', (data: { type: string; nickname: string; message: string; preview?: string; timestamp: string }) => {
      const notification: ChatMessage = {
        id: `teacher-notif-${Date.now()}-${Math.random()}`,
        sender_type: 'STUDENT',
        sender_id: 'system',
        sender_name: data.nickname,
        text: data.message,
        created_at: data.timestamp,
        is_notification: true,
        notification_type: 'system',
        notification_data: data,
      }
      setNotifications(prev => [...prev, notification])
    })

    return () => {
      if (refreshInterval) {
        clearInterval(refreshInterval)
      }
      socket.disconnect()
      socketRef.current = null
      ;(window as any).socket = null
    }
  }, [authToken, sessionId, refreshOnlineUsers, updatePublicCache])

  const sendPublicMessage = useCallback(async (text: string, attachmentUrls: string[] = [], filenameMap: Record<string, string> = {}, replyToId?: string, replyPreview?: string) => {
    if (!sessionId || (!text.trim() && attachmentUrls.length === 0)) return

    try {
      const getFileType = (url: string): string => {
        const ext = url.split('.').pop()?.toLowerCase() || ''
        if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp'].includes(ext)) return 'image'
        if (ext === 'pdf') return 'pdf'
        if (['doc', 'docx'].includes(ext)) return 'document'
        if (['xls', 'xlsx'].includes(ext)) return 'spreadsheet'
        if (['ppt', 'pptx'].includes(ext)) return 'presentation'
        return 'file'
      }

      const attachments = attachmentUrls.map(url => ({
        type: getFileType(url),
        url,
        filename: filenameMap[url] || url.split('/').pop() || 'file'
      }))

      await chatApi.sendSessionMessage(sessionId, text.trim(), attachments, replyToId)

      if (socketRef.current) {
        socketRef.current.emit('chat_public_message', {
          session_id: sessionId,
          text: text.trim(),
          attachments,
          reply_to_id: replyToId,
          reply_preview: replyPreview,
        })
      }
    } catch (err) {
      console.error('Failed to send message:', err)
    }
  }, [sessionId])

  const sendPrivateMessage = useCallback((targetId: string, text: string, attachmentUrls: string[] = [], filenameMap: Record<string, string> = {}) => {
    if (socketRef.current && (text.trim() || attachmentUrls.length > 0)) {
      const getFileType = (url: string): string => {
        const ext = url.split('.').pop()?.toLowerCase() || ''
        if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp'].includes(ext)) return 'image'
        if (ext === 'pdf') return 'pdf'
        if (['doc', 'docx'].includes(ext)) return 'document'
        if (['xls', 'xlsx'].includes(ext)) return 'spreadsheet'
        if (['ppt', 'pptx'].includes(ext)) return 'presentation'
        return 'file'
      }

      const attachments = attachmentUrls.map(url => ({
        type: getFileType(url),
        url,
        filename: filenameMap[url] || url.split('/').pop() || 'file'
      }))

      socketRef.current.emit('chat_private_message', {
        target_id: targetId,
        text: text.trim() || '📎 Allegato',
        attachments,
      })
    }
  }, [])

  const startPrivateChat = useCallback((user: OnlineUser) => {
    setPrivateChats(prev => {
      if (prev[user.student_id]) {
        return prev
      }
      return {
        ...prev,
        [user.student_id]: {
          oderId: user.student_id,
          peerName: user.nickname || 'Studente',
          peerAvatarUrl: user.avatar_url,
          messages: [],
          unreadCount: 0,
        }
      }
    })
  }, [])

  const markPrivateChatRead = useCallback((oderId: string) => {
    setPrivateChats(prev => {
      if (!prev[oderId]) return prev
      return {
        ...prev,
        [oderId]: {
          ...prev[oderId],
          unreadCount: 0,
        }
      }
    })
  }, [])

  const clearNotification = useCallback((id: string) => {
    setNotifications(prev => prev.filter(n => n.id !== id))
  }, [])

  return {
    socket: socketRef.current,
    connected,
    messages,
    onlineUsers,
    privateChats,
    sendPublicMessage,
    sendPrivateMessage,
    startPrivateChat,
    markPrivateChatRead,
    notifications,
    clearNotification,
    currentUserId,
    loadOlderPublicMessages,
    hasMorePublicMessages,
    loadingOlderPublicMessages,
    loadingInitialMessages,
  }
}
