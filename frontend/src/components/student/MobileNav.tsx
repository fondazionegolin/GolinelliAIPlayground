import { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import { Home, MessageSquare, Bot, Brain } from 'lucide-react'
import { triggerHaptic } from '@/lib/haptics'
import { loadStudentAccent, getStudentAccentTheme } from '@/lib/studentAccent'

interface MobileNavProps {
  activeModule: string | null
  onNavigate: (module: string | null) => void
  unreadMessages?: number
  hidden?: boolean
}

const NAV_ITEMS = [
  { key: null, icon: Home, label: 'Home' },
  { key: 'chatbot', icon: Bot, label: 'AI' },
  { key: 'classe', icon: MessageSquare, label: 'Classe' },
  { key: 'classification', icon: Brain, label: 'ML' },
] as const

export function MobileNav({ activeModule, onNavigate, unreadMessages = 0, hidden = false }: MobileNavProps) {
  const [accentTheme, setAccentTheme] = useState(getStudentAccentTheme(loadStudentAccent()))

  useEffect(() => {
    // Refresh accent theme when localStorage changes (e.g. from settings modal)
    const handleStorage = () => {
      setAccentTheme(getStudentAccentTheme(loadStudentAccent()))
    }
    window.addEventListener('storage', handleStorage)
    // Custom event for same-window updates
    window.addEventListener('studentAccentChanged', handleStorage)
    return () => {
      window.removeEventListener('storage', handleStorage)
      window.removeEventListener('studentAccentChanged', handleStorage)
    }
  }, [])

  if (hidden) return null

  const activeIndex = NAV_ITEMS.findIndex(item => item.key === activeModule)

  const handleNavigate = (key: string | null) => {
    if (key !== activeModule) {
      triggerHaptic('light')
      onNavigate(key)
    }
  }

  return (
    <nav
      className="
        md:hidden fixed bottom-0 left-0 right-0 z-50
        bg-white/80 backdrop-blur-lg
        border-t border-slate-200/50
        px-2
        pb-[env(safe-area-inset-bottom)]
        shadow-[0_-4px_12px_rgba(0,0,0,0.03)]
      "
    >
      <div className="relative flex justify-around items-center h-14">
        {/* Animated pill indicator */}
        <motion.div
          className="absolute top-1.5 h-11 rounded-2xl -z-10 border shadow-sm"
          initial={false}
          animate={{
            x: `calc(${activeIndex * 100}% + ${activeIndex * 0.5}rem)`,
            width: `calc(25% - 0.5rem)`,
          }}
          transition={{
            type: 'spring',
            stiffness: 400,
            damping: 30,
          }}
          style={{
            left: '0.25rem',
            backgroundColor: `${accentTheme.accent}15`,
            borderColor: `${accentTheme.accent}30`,
          }}
        />

        {NAV_ITEMS.map((item) => {
          const isActive = activeModule === item.key
          const Icon = item.icon
          const showBadge = item.key === 'classe' && unreadMessages > 0

          return (
            <motion.button
              key={item.label}
              onClick={() => handleNavigate(item.key)}
              className="flex flex-col items-center justify-center w-full h-14 gap-0.5"
              whileTap={{ scale: 0.9 }}
              style={{ color: isActive ? accentTheme.text : '#94a3b8' }}
            >
              <div className="relative">
                <motion.div
                  animate={{
                    scale: isActive ? 1.1 : 1,
                  }}
                  transition={{ type: 'spring', stiffness: 400, damping: 17 }}
                >
                  <Icon
                    className={`h-5 w-5 transition-all duration-200 ${
                      isActive ? 'stroke-[2.5px]' : 'stroke-2'
                    }`}
                  />
                </motion.div>

                {/* Notification badge */}
                {showBadge && (
                  <motion.span
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    className="absolute -top-1 -right-1 flex h-4 w-4 items-center justify-center"
                  >
                    <span className="absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75 animate-ping" />
                    <span className="relative inline-flex rounded-full h-3 w-3 bg-red-500 text-[8px] text-white font-bold items-center justify-center">
                      {unreadMessages > 9 ? '9+' : unreadMessages}
                    </span>
                  </motion.span>
                )}
              </div>

              <span className="text-[10px] font-bold leading-none tracking-tight">
                {item.label}
              </span>
            </motion.button>
          )
        })}
      </div>
    </nav>
  )
}

export default MobileNav
