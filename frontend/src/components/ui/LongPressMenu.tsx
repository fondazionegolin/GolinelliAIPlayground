import { ReactNode, useState, useRef, useCallback, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { triggerHaptic } from '@/lib/haptics'

interface MenuItem {
  label: string
  icon?: ReactNode
  onClick: () => void
  variant?: 'default' | 'danger'
}

interface LongPressMenuProps {
  children: ReactNode
  items: MenuItem[]
  delay?: number
  disabled?: boolean
  className?: string
}

export function LongPressMenu({
  children,
  items,
  delay = 500,
  disabled = false,
  className = '',
}: LongPressMenuProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [position, setPosition] = useState({ x: 0, y: 0 })
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const touchStartPos = useRef({ x: 0, y: 0 })

  // Clear timer on unmount
  useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current)
      }
    }
  }, [])

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    if (disabled) return

    const touch = e.touches[0]
    touchStartPos.current = { x: touch.clientX, y: touch.clientY }

    timerRef.current = setTimeout(() => {
      triggerHaptic('heavy')

      // Calculate menu position
      const rect = containerRef.current?.getBoundingClientRect()
      if (rect) {
        const menuWidth = 200
        const menuHeight = items.length * 44 + 8 // Approximate height

        let x = touch.clientX - rect.left
        let y = touch.clientY - rect.top

        // Adjust if menu would go off screen
        if (x + menuWidth > window.innerWidth - 16) {
          x = window.innerWidth - menuWidth - 16 - rect.left
        }
        if (y + menuHeight > window.innerHeight - 16) {
          y = touch.clientY - menuHeight - rect.top
        }

        setPosition({ x, y })
      }

      setIsOpen(true)
    }, delay)
  }, [disabled, delay, items.length])

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    // Cancel if moved too far
    const touch = e.touches[0]
    const deltaX = Math.abs(touch.clientX - touchStartPos.current.x)
    const deltaY = Math.abs(touch.clientY - touchStartPos.current.y)

    if (deltaX > 10 || deltaY > 10) {
      if (timerRef.current) {
        clearTimeout(timerRef.current)
        timerRef.current = null
      }
    }
  }, [])

  const handleTouchEnd = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }, [])

  const handleClose = useCallback(() => {
    setIsOpen(false)
  }, [])

  const handleItemClick = useCallback((item: MenuItem) => {
    triggerHaptic('light')
    item.onClick()
    setIsOpen(false)
  }, [])

  return (
    <div
      ref={containerRef}
      className={`relative ${className}`}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      onContextMenu={(e) => {
        if (!disabled) {
          e.preventDefault()
          triggerHaptic('heavy')
          setPosition({ x: e.nativeEvent.offsetX, y: e.nativeEvent.offsetY })
          setIsOpen(true)
        }
      }}
    >
      {children}

      {/* Backdrop */}
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/20 backdrop-blur-sm z-50"
            onClick={handleClose}
            onTouchEnd={handleClose}
          />
        )}
      </AnimatePresence>

      {/* Menu */}
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.9 }}
            transition={{ type: 'spring', stiffness: 400, damping: 25 }}
            className="fixed z-50 bg-white rounded-xl shadow-2xl border border-slate-200 overflow-hidden min-w-[180px]"
            style={{
              left: position.x,
              top: position.y,
            }}
          >
            <div className="py-1">
              {items.map((item, index) => (
                <button
                  key={index}
                  onClick={() => handleItemClick(item)}
                  className={`
                    w-full text-left px-4 py-2.5 flex items-center gap-3 text-sm
                    ${item.variant === 'danger'
                      ? 'text-red-600 hover:bg-red-50'
                      : 'text-slate-700 hover:bg-slate-50'
                    }
                  `}
                >
                  {item.icon && (
                    <span className={item.variant === 'danger' ? 'text-red-500' : 'text-slate-400'}>
                      {item.icon}
                    </span>
                  )}
                  {item.label}
                </button>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

export default LongPressMenu
