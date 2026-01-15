import { io, Socket } from 'socket.io-client'

let socket: Socket | null = null

export function getSocket(): Socket {
  if (!socket) {
    const token = localStorage.getItem('student_token') || localStorage.getItem('access_token')
    
    socket = io('/', {
      path: '/socket.io',
      auth: { token },
      autoConnect: false,
    })
  }
  return socket
}

export function connectSocket(token: string): Socket {
  if (socket) {
    socket.disconnect()
  }
  
  socket = io('/', {
    path: '/socket.io',
    auth: { token },
  })
  
  socket.on('connect', () => {
    console.log('Socket connected')
  })
  
  socket.on('disconnect', () => {
    console.log('Socket disconnected')
  })
  
  socket.on('connect_error', (error) => {
    console.error('Socket connection error:', error)
  })
  
  return socket
}

export function disconnectSocket(): void {
  if (socket) {
    socket.disconnect()
    socket = null
  }
}
