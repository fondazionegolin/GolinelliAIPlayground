import { ReactNode, useRef, useState, useCallback } from 'react'
import { motion, PanInfo, useMotionValue, useTransform } from 'framer-motion'
import { Copy, Reply, Trash2 } from 'lucide-react'
import { triggerHaptic } from '@/lib/haptics'

interface SwipeableMessageProps {
  children: ReactNode
  onSwipeRight?: () => void  // Primary action (copy/reply)
  onSwipeLeft?: () => void   // Secondary action (delete)
  rightIcon?: ReactNode
  leftIcon?: ReactNode
  rightColor?: string
  leftColor?: string
  threshold?: number
  disabled?: boolean
  className?: string
}

export function SwipeableMessage({
  children,
  onSwipeRight,
  onSwipeLeft,
  rightIcon = <Copy className="h-5 w-5 text-white" />,
  leftIcon = <Trash2 className="h-5 w-5 text-white" />,
  rightColor = 'bg-sky-500',
  leftColor = 'bg-red-500',
  threshold = 80,
  disabled = false,
  className = '',
}: SwipeableMessageProps) {
  const x = useMotionValue(0)
  const [isDragging, setIsDragging] = useState(false)
  const hasTriggeredHaptic = useRef(false)

  // Transform for action backgrounds
  const rightOpacity = useTransform(x, [0, threshold], [0, 1])
  const leftOpacity = useTransform(x, [-threshold, 0], [1, 0])
  const rightScale = useTransform(x, [0, threshold], [0.5, 1])
  const leftScale = useTransform(x, [-threshold, 0], [1, 0.5])

  const handleDragStart = useCallback(() => {
    setIsDragging(true)
    hasTriggeredHaptic.current = false
  }, [])

  const handleDrag = useCallback((_: unknown, info: PanInfo) => {
    // Trigger haptic when threshold is crossed
    if (Math.abs(info.offset.x) >= threshold && !hasTriggeredHaptic.current) {
      triggerHaptic('medium')
      hasTriggeredHaptic.current = true
    } else if (Math.abs(info.offset.x) < threshold && hasTriggeredHaptic.current) {
      hasTriggeredHaptic.current = false
    }
  }, [threshold])

  const handleDragEnd = useCallback((_: unknown, info: PanInfo) => {
    setIsDragging(false)

    if (info.offset.x >= threshold && onSwipeRight) {
      triggerHaptic('success')
      onSwipeRight()
    } else if (info.offset.x <= -threshold && onSwipeLeft) {
      triggerHaptic('warning')
      onSwipeLeft()
    }
  }, [threshold, onSwipeRight, onSwipeLeft])

  if (disabled) {
    return <div className={className}>{children}</div>
  }

  return (
    <div className={`relative overflow-hidden ${className}`}>
      {/* Right swipe action (copy/reply) */}
      {onSwipeRight && (
        <motion.div
          className={`absolute inset-y-0 left-0 w-20 ${rightColor} flex items-center justify-center`}
          style={{ opacity: rightOpacity }}
        >
          <motion.div style={{ scale: rightScale }}>
            {rightIcon}
          </motion.div>
        </motion.div>
      )}

      {/* Left swipe action (delete) */}
      {onSwipeLeft && (
        <motion.div
          className={`absolute inset-y-0 right-0 w-20 ${leftColor} flex items-center justify-center`}
          style={{ opacity: leftOpacity }}
        >
          <motion.div style={{ scale: leftScale }}>
            {leftIcon}
          </motion.div>
        </motion.div>
      )}

      {/* Swipeable content */}
      <motion.div
        drag="x"
        dragConstraints={{
          left: onSwipeLeft ? -threshold * 1.2 : 0,
          right: onSwipeRight ? threshold * 1.2 : 0
        }}
        dragElastic={0.2}
        onDragStart={handleDragStart}
        onDrag={handleDrag}
        onDragEnd={handleDragEnd}
        animate={{ x: 0 }}
        style={{ x }}
        className={`relative bg-transparent ${isDragging ? 'cursor-grabbing' : 'cursor-grab'}`}
      >
        {children}
      </motion.div>
    </div>
  )
}

// Preset for chat messages
export function SwipeableChatMessage({
  children,
  onCopy,
  onReply,
  onDelete,
  isOwnMessage = false,
}: {
  children: ReactNode
  onCopy?: () => void
  onReply?: () => void
  onDelete?: () => void
  isOwnMessage?: boolean
}) {
  return (
    <SwipeableMessage
      onSwipeRight={onCopy || onReply}
      onSwipeLeft={isOwnMessage ? onDelete : undefined}
      rightIcon={onCopy ? <Copy className="h-5 w-5 text-white" /> : <Reply className="h-5 w-5 text-white" />}
      rightColor={onCopy ? 'bg-sky-500' : 'bg-indigo-500'}
    >
      {children}
    </SwipeableMessage>
  )
}

export default SwipeableMessage
