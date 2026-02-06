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

interface UseSocketReturn {
  socket: Socket | null
  connected: boolean
  messages: ChatMessage[]
  onlineUsers: OnlineUser[]
  privateChats: Record<string, PrivateChat>
  sendPublicMessage: (text: string, attachmentUrls?: string[]) => Promise<void>
  sendPrivateMessage: (targetId: string, text: string, attachmentUrls?: string[]) => void
  startPrivateChat: (user: OnlineUser) => void
  markPrivateChatRead: (oderId: string) => void
  notifications: ChatMessage[]
  clearNotification: (id: string) => void
  currentUserId: string | null
}

export function useSocket(sessionId?: string): UseSocketReturn {
  const socketRef = useRef<Socket | null>(null)
  const [connected, setConnected] = useState(false)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [onlineUsers, setOnlineUsers] = useState<OnlineUser[]>([])
  const [privateChats, setPrivateChats] = useState<Record<string, PrivateChat>>({})
  const [notifications, setNotifications] = useState<ChatMessage[]>([])
  const [currentUserId, setCurrentUserId] = useState<string | null>(null)

  // Refs for socket listeners to avoid closure issues
  const currentUserIdRef = useRef<string | null>(null)
  const onlineUsersRef = useRef<OnlineUser[]>([])

  const { accessToken } = useAuthStore()
  const studentToken = typeof window !== 'undefined' ? localStorage.getItem('student_token') : null
  const authToken = accessToken || studentToken

  // Sync refs with state
  useEffect(() => {
    currentUserIdRef.current = currentUserId
  }, [currentUserId])

  useEffect(() => {
    onlineUsersRef.current = onlineUsers
  }, [onlineUsers])

  // Parse current user ID from token
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

  // Load messages from database on mount
  useEffect(() => {
    if (!sessionId) return
    
    const loadMessages = async () => {
      try {
        const res = await chatApi.getSessionMessages(sessionId)
        if (res.data?.messages) {
          setMessages(res.data.messages)
        }
      } catch (err) {
        console.error('Failed to load chat messages:', err)
      }
    }
    
    loadMessages()
  }, [sessionId])

  // Function to refresh online users list
  const refreshOnlineUsers = useCallback((socket: Socket, session: string) => {
    socket.emit('join_session', { session_id: session }, (response: { online_students?: OnlineUser[] }) => {
      if (response?.online_students) {
        console.log('[Socket] Refreshed online users:', response.online_students.length)
        setOnlineUsers(response.online_students)
      }
    })
  }, [])

  useEffect(() => {
    if (!authToken) return

    const socket = io(window.location.origin, {
      path: '/socket.io',
      auth: { token: authToken },
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: 10,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      timeout: 20000,
    })

    socketRef.current = socket
    // Expose socket globally for components that need to emit events
    ;(window as any).socket = socket

    // Periodic refresh of online users (every 30 seconds)
    let refreshInterval: NodeJS.Timeout | null = null

    socket.on('connect', () => {
      console.log('[Socket] Connected, socket id:', socket.id)
      setConnected(true)
      if (sessionId) {
        // Initial join and get online users
        refreshOnlineUsers(socket, sessionId)

        // Set up periodic refresh
        refreshInterval = setInterval(() => {
          if (socket.connected && sessionId) {
            refreshOnlineUsers(socket, sessionId)
          }
        }, 30000) // Refresh every 30 seconds
      }
    })

    socket.on('disconnect', (reason) => {
      console.log('[Socket] Disconnected:', reason)
      setConnected(false)
      // Clear online users on disconnect - they'll be repopulated on reconnect
      setOnlineUsers([])
      // Clear refresh interval
      if (refreshInterval) {
        clearInterval(refreshInterval)
        refreshInterval = null
      }
    })

    socket.on('connect_error', (error) => {
      console.error('[Socket] Connection error:', error.message)
      setConnected(false)
    })

    // Handle reconnection
    socket.on('reconnect', (attemptNumber) => {
      console.log('[Socket] Reconnected after', attemptNumber, 'attempts')
      // Re-join session and refresh users on reconnect
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
        // Handle private message - determine the other person in the conversation
        const senderId = msg.sender_id
        const targetId = data.target_id || msg.target_id
        const myId = currentUserIdRef.current

        // Get current user ID to determine who the peer is
        let peerId: string
        let peerName: string
        let peerAvatarUrl: string | undefined

        if (senderId === myId) {
          // I sent this message, peer is the target
          peerId = targetId || 'unknown'
          // Try to find target info in online users
          const targetUser = onlineUsersRef.current.find(u => u.student_id === peerId)
          peerName = targetUser?.nickname || 'Destinatario'
          peerAvatarUrl = targetUser?.avatar_url
        } else {
          // Someone sent me this message, peer is the sender
          peerId = senderId
          peerName = msg.sender_name || 'Utente'
          peerAvatarUrl = msg.sender_avatar_url
        }

        setPrivateChats(prev => {
          const existingChat = prev[peerId]
          if (existingChat) {
            // Check for duplicates
            if (existingChat.messages.find(m => m.id === msg.id)) return prev
            return {
              ...prev,
              [peerId]: {
                ...existingChat,
                messages: [...existingChat.messages, msg],
                unreadCount: existingChat.unreadCount + (senderId !== myId ? 1 : 0),
              }
            }
          } else {
            // Create new private chat
            return {
              ...prev,
              [peerId]: {
                oderId: peerId,
                peerName: peerName,
                peerAvatarUrl: peerAvatarUrl,
                messages: [msg],
                unreadCount: senderId !== myId ? 1 : 0,
              }
            }
          }
        })
      } else {
        // Public message - avoid duplicates
        setMessages(prev => {
          if (prev.find(m => m.id === msg.id)) return prev
          return [...prev, msg]
        })
      }
    })

    socket.on('presence_update', (data: { student_id: string; status: string; nickname?: string; avatar_url?: string }) => {
      if (data.status === 'online') {
        setOnlineUsers(prev => {
          const existing = prev.find(u => u.student_id === data.student_id)
          if (existing) {
            // Update existing user info
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
      setOnlineUsers(prev => prev.map(u => 
        u.student_id === data.student_id 
          ? { ...u, activity: { module_key: data.module_key, step: data.step } }
          : u
      ))
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

    // Teacher notifications for student activity
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
  }, [authToken, sessionId, refreshOnlineUsers])

  const sendPublicMessage = useCallback(async (text: string, attachmentUrls: string[] = []) => {
    if (!sessionId || (!text.trim() && attachmentUrls.length === 0)) return
    
    try {
      // Helper to determine file type from URL
      const getFileType = (url: string): string => {
        const ext = url.split('.').pop()?.toLowerCase() || ''
        if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp'].includes(ext)) return 'image'
        if (ext === 'pdf') return 'pdf'
        if (['doc', 'docx'].includes(ext)) return 'document'
        if (['xls', 'xlsx'].includes(ext)) return 'spreadsheet'
        if (['ppt', 'pptx'].includes(ext)) return 'presentation'
        return 'file'
      }

      // Build attachments array
      const attachments = attachmentUrls.map(url => ({
        type: getFileType(url),
        url,
        filename: url.split('/').pop() || 'file'
      }))

      // Save to database via API
      await chatApi.sendSessionMessage(sessionId, text.trim(), attachments)
      
      // Emit via Socket.IO for real-time delivery (backend will broadcast to all including sender)
      if (socketRef.current) {
        socketRef.current.emit('chat_public_message', {
          session_id: sessionId,
          text: text.trim(),
          attachments,
        })
      }
    } catch (err) {
      console.error('Failed to send message:', err)
    }
  }, [sessionId])

  const sendPrivateMessage = useCallback((targetId: string, text: string, attachmentUrls: string[] = []) => {
    if (socketRef.current && (text.trim() || attachmentUrls.length > 0)) {
      // Helper to determine file type from URL
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
        filename: url.split('/').pop() || 'file'
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
        // Chat already exists, just return
        return prev
      }
      // Create new empty private chat
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
  }
}
