import { create } from 'zustand'
import { persist } from 'zustand/middleware'

interface User {
  id: string
  email: string
  role: 'ADMIN' | 'TEACHER'
  tenant_id?: string
}

interface StudentSession {
  student_id: string
  session_id: string
  session_title: string
  nickname: string
}

interface AuthState {
  user: User | null
  accessToken: string | null
  studentSession: StudentSession | null
  isAuthenticated: boolean
  setUser: (user: User, token: string) => void
  setStudentSession: (session: StudentSession, token: string) => void
  logout: () => void
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      user: null,
      accessToken: null,
      studentSession: null,
      isAuthenticated: false,
      setUser: (user, token) =>
        set({
          user,
          accessToken: token,
          isAuthenticated: true,
          studentSession: null,
        }),
      setStudentSession: (session, token) => {
        localStorage.setItem('student_token', token)
        set({
          studentSession: session,
          user: null,
          accessToken: null,
          isAuthenticated: false,
        })
      },
      logout: () => {
        localStorage.removeItem('student_token')
        set({
          user: null,
          accessToken: null,
          studentSession: null,
          isAuthenticated: false,
        })
      },
    }),
    {
      name: 'eduai-auth',
    }
  )
)
