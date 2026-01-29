import { motion } from 'framer-motion'
import { Home, MessageSquare, Bot, Brain } from 'lucide-react'
import { triggerHaptic } from '@/lib/haptics'

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
        bg-white/95 backdrop-blur-md
        border-t border-slate-200/80
        px-2
        pb-[env(safe-area-inset-bottom)]
      "
    >
      <div className="relative flex justify-around items-center h-14">
        {/* Animated pill indicator */}
        <motion.div
          className="absolute top-1 h-12 bg-violet-100 rounded-2xl -z-10"
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
              className={`
                flex flex-col items-center justify-center
                w-full h-14 gap-0.5
                transition-colors duration-200
                ${isActive ? 'text-violet-600' : 'text-slate-400'}
              `}
              whileTap={{ scale: 0.9 }}
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

              <span
                className={`text-[10px] font-medium leading-none transition-all duration-200 ${
                  isActive ? 'text-violet-600' : 'text-slate-400'
                }`}
              >
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
