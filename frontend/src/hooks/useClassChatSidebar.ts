import { useCallback, useEffect, useState } from 'react'

const storageKey = (role: 'teacher' | 'student', userId: string) => `class-chat:sidebar:${role}:${userId}`

export function useClassChatSidebar(role: 'teacher' | 'student', userId?: string) {
  const [open, setOpen] = useState(() => userId ? localStorage.getItem(storageKey(role, userId)) === 'open' : false)

  useEffect(() => {
    setOpen(userId ? localStorage.getItem(storageKey(role, userId)) === 'open' : false)
  }, [role, userId])

  const setPreference = useCallback((value: boolean | ((previous: boolean) => boolean)) => {
    setOpen((previous) => {
      const next = typeof value === 'function' ? value(previous) : value
      if (userId) localStorage.setItem(storageKey(role, userId), next ? 'open' : 'closed')
      return next
    })
  }, [role, userId])

  return [open, setPreference] as const
}
