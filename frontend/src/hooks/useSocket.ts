import { useEffect, useRef, useState, useCallback } from 'react'
import { io, Socket } from 'socket.io-client'
import { useAuthStore } from '@/stores/auth'
import { chatApi } from '@/lib/api'

export interface ChatMessage {
  id: string
  sender_type: 'TEACHER' | 'STUDENT'
  sender_id: string
  sender_name?: string
  text: string
  attachments?: unknown[]
  created_at: string
  room_type?: 'PUBLIC' | 'DM'
  is_private?: boolean
  target_id?: string
  is_notification?: boolean
  notification_type?: 'task' | 'document' | 'quiz' | 'system'
  notification_data?: Record<string, unknown>
}

export interface OnlineUser {
  student_id: string
  nickname?: string
  activity?: {
    module_key?: string
    step?: string
  }
}

interface UseSocketReturn {
  socket: Socket | null
  connected: boolean
  messages: ChatMessage[]
  onlineUsers: OnlineUser[]
  sendPublicMessage: (text: string) => void
  sendPrivateMessage: (targetId: string, text: string) => void
  notifications: ChatMessage[]
  clearNotification: (id: string) => void
}

export function useSocket(sessionId?: string): UseSocketReturn {
  const socketRef = useRef<Socket | null>(null)
  const [connected, setConnected] = useState(false)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [onlineUsers, setOnlineUsers] = useState<OnlineUser[]>([])
  const [notifications, setNotifications] = useState<ChatMessage[]>([])
  
  const { accessToken } = useAuthStore()
  const studentToken = typeof window !== 'undefined' ? localStorage.getItem('student_token') : null
  const authToken = accessToken || studentToken

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

  useEffect(() => {
    if (!authToken) return

    const socket = io(window.location.origin, {
      path: '/socket.io',
      auth: { token: authToken },
      transports: ['websocket', 'polling'],
    })

    socketRef.current = socket

    socket.on('connect', () => {
      setConnected(true)
      if (sessionId) {
        socket.emit('join_session', { session_id: sessionId })
      }
    })

    socket.on('disconnect', () => {
      setConnected(false)
    })

    socket.on('chat_message', (data: { room_type: string; message: ChatMessage; target_id?: string }) => {
      const msg = {
        ...data.message,
        id: data.message.id || `${Date.now()}-${Math.random()}`,
        room_type: data.room_type as 'PUBLIC' | 'DM',
        is_private: data.room_type === 'DM',
        target_id: data.target_id || data.message.target_id,
      }
      // Avoid duplicates
      setMessages(prev => {
        if (prev.find(m => m.id === msg.id)) return prev
        return [...prev, msg]
      })
    })

    socket.on('presence_update', (data: { student_id: string; status: string; nickname?: string }) => {
      if (data.status === 'online') {
        setOnlineUsers(prev => {
          if (prev.find(u => u.student_id === data.student_id)) return prev
          return [...prev, { student_id: data.student_id, nickname: data.nickname }]
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

    return () => {
      socket.disconnect()
      socketRef.current = null
    }
  }, [authToken, sessionId])

  const sendPublicMessage = useCallback(async (text: string) => {
    if (!sessionId || !text.trim()) return
    
    try {
      // Save to database via API
      const res = await chatApi.sendSessionMessage(sessionId, text.trim())
      const savedMessage = res.data
      
      // Add to local state
      setMessages(prev => [...prev, savedMessage])
      
      // Also emit via Socket.IO for real-time delivery to others
      if (socketRef.current) {
        socketRef.current.emit('chat_public_message', {
          session_id: sessionId,
          text: text.trim(),
        })
      }
    } catch (err) {
      console.error('Failed to send message:', err)
    }
  }, [sessionId])

  const sendPrivateMessage = useCallback((targetId: string, text: string) => {
    if (socketRef.current && text.trim()) {
      socketRef.current.emit('chat_private_message', {
        target_id: targetId,
        text: text.trim(),
      })
    }
  }, [])

  const clearNotification = useCallback((id: string) => {
    setNotifications(prev => prev.filter(n => n.id !== id))
  }, [])

  return {
    socket: socketRef.current,
    connected,
    messages,
    onlineUsers,
    sendPublicMessage,
    sendPrivateMessage,
    notifications,
    clearNotification,
  }
}
