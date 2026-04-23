import { ReactNode } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { ArrowLeft, User } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { triggerHaptic } from '@/lib/haptics'

interface MobileHeaderProps {
  title: string
  subtitle?: string
  showBack?: boolean
  onBack?: () => void
  rightAction?: ReactNode
  leftIcon?: ReactNode
  avatar?: string
  className?: string
}

export function MobileHeader({
  title,
  subtitle,
  showBack = false,
  onBack,
  rightAction,
  leftIcon,
  avatar,
  className = '',
}: MobileHeaderProps) {
  const handleBack = () => {
    triggerHaptic('light')
    onBack?.()
  }

  return (
    <header
      className={`
        md:hidden fixed top-0 left-0 right-0 z-50
        bg-white/95 backdrop-blur-md border-b border-slate-200/80
        px-3 h-14
        flex items-center gap-3
        pt-[env(safe-area-inset-top)]
        ${className}
      `}
    >
      {/* Back button or left icon */}
      <AnimatePresence mode="wait">
        {showBack && onBack ? (
          <motion.div
            key="back-button"
            initial={{ opacity: 0, x: -10 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -10 }}
            transition={{ duration: 0.15 }}
          >
            <Button
              variant="ghost"
              size="sm"
              onClick={handleBack}
              className="h-9 w-9 p-0 rounded-full text-slate-600 hover:text-slate-900 hover:bg-slate-100"
            >
              <ArrowLeft className="h-5 w-5" />
            </Button>
          </motion.div>
        ) : leftIcon ? (
          <motion.div
            key="left-icon"
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.8 }}
            transition={{ duration: 0.15 }}
            className="flex-shrink-0"
          >
            {leftIcon}
          </motion.div>
        ) : null}
      </AnimatePresence>

      {/* Title and subtitle */}
      <div className="flex-1 min-w-0">
        <AnimatePresence mode="wait">
          <motion.div
            key={title}
            initial={{ opacity: 0, y: 5 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -5 }}
            transition={{ duration: 0.2 }}
          >
            <h1 className="font-semibold text-slate-900 truncate leading-tight">
              {title}
            </h1>
            {subtitle && (
              <p className="text-xs text-slate-500 truncate">
                {subtitle}
              </p>
            )}
          </motion.div>
        </AnimatePresence>
      </div>

      {/* Right action or avatar */}
      <div className="flex-shrink-0 flex items-center gap-2">
        {rightAction}
        {avatar && (
          <div className="w-8 h-8 rounded-full bg-gradient-to-br from-violet-500 to-fuchsia-500 flex items-center justify-center text-white text-sm font-medium shadow-md">
            {avatar.charAt(0).toUpperCase()}
          </div>
        )}
        {!rightAction && !avatar && !showBack && (
          <div className="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center text-slate-400">
            <User className="h-4 w-4" />
          </div>
        )}
      </div>
    </header>
  )
}

// Preset header configurations
export function HomeHeader({ nickname }: { nickname: string }) {
  return (
    <MobileHeader
      title="GolinelliAI"
      avatar={nickname}
    />
  )
}

export function ChatbotHeader({
  profileName,
  profileIcon,
  onBack,
}: {
  profileName: string
  profileIcon?: ReactNode
  onBack: () => void
}) {
  return (
    <MobileHeader
      title={profileName}
      showBack
      onBack={onBack}
      leftIcon={
        !profileIcon ? undefined : (
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-sky-500 to-blue-600 flex items-center justify-center shadow-md">
            <div className="text-white scale-75">{profileIcon}</div>
          </div>
        )
      }
    />
  )
}

export function ClassChatHeader({ onlineCount }: { onlineCount?: number }) {
  return (
    <MobileHeader
      title="Chat di classe"
      subtitle={onlineCount !== undefined ? `${onlineCount} online` : undefined}
    />
  )
}

export function MLLabHeader({
  mode,
  onModeChange,
}: {
  mode: string
  onModeChange?: (mode: string) => void
}) {
  return (
    <MobileHeader
      title="ML Lab"
      subtitle={mode}
      rightAction={
        onModeChange && (
          <select
            value={mode}
            onChange={(e) => onModeChange(e.target.value)}
            className="text-xs bg-slate-100 border-0 rounded-lg px-2 py-1 text-slate-600"
          >
            <option value="images">Immagini</option>
            <option value="text">Testo</option>
            <option value="data">Dati</option>
          </select>
        )
      }
    />
  )
}

export default MobileHeader
