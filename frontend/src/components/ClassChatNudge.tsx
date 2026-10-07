import { useEffect, useRef } from 'react'
import { MessageSquare } from '@/components/icons'

export function ClassChatNudge({ onOpen, onDone, showAt = 'lg' }: { onOpen: () => void; onDone: () => void; showAt?: 'md' | 'lg' }) {
  const onDoneRef = useRef(onDone)
  onDoneRef.current = onDone
  useEffect(() => {
    const timer = window.setTimeout(() => onDoneRef.current(), 4000)
    return () => window.clearTimeout(timer)
  }, [])

  return (
    <button
      type="button"
      onClick={onOpen}
      className={`class-chat-nudge fixed right-0 top-1/2 z-[55] hidden h-16 w-14 -translate-y-1/2 items-center justify-center rounded-l-2xl bg-white text-slate-700 shadow-lg ${showAt === 'md' ? 'md:flex' : 'lg:flex'}`}
      title="Nuovo messaggio nella chat di classe"
      aria-label="Apri chat di classe: nuovo messaggio"
    >
      <MessageSquare className="h-5 w-5" />
      <span className="absolute right-2 top-2 h-2 w-2 rounded-full bg-rose-500" />
    </button>
  )
}
