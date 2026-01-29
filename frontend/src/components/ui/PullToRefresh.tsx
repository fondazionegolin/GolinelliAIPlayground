import { useState, useRef, useCallback, ReactNode } from 'react'
import { motion, useMotionValue, useTransform, AnimatePresence } from 'framer-motion'
import { Loader2, ArrowDown } from 'lucide-react'
import { triggerHaptic } from '@/lib/haptics'

interface PullToRefreshProps {
  children: ReactNode
  onRefresh?: () => Promise<void>
  isLoading?: boolean
  threshold?: number
  className?: string
}

export function PullToRefresh({
  children,
  onRefresh,
  isLoading = false,
  threshold = 80,
  className = '',
}: PullToRefreshProps) {
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [isPulling, setIsPulling] = useState(false)
  const startY = useRef<number | null>(null)
  const scrollTop = useRef(0)
  const hasTriggeredHaptic = useRef(false)

  const pullDistance = useMotionValue(0)
  const pullProgress = useTransform(pullDistance, [0, threshold], [0, 1])

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    if (isRefreshing || isLoading) return

    const scrollElement = e.currentTarget
    scrollTop.current = scrollElement.scrollTop

    // Only start pull if we're at the top
    if (scrollTop.current <= 0) {
      startY.current = e.touches[0].clientY
      hasTriggeredHaptic.current = false
    }
  }, [isRefreshing, isLoading])

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (startY.current === null || isRefreshing || isLoading) return

    const currentY = e.touches[0].clientY
    const deltaY = currentY - startY.current

    // Only pull down, not up
    if (deltaY > 0 && scrollTop.current <= 0) {
      setIsPulling(true)
      // Apply resistance
      const resistedDelta = Math.min(deltaY * 0.5, threshold * 1.5)
      pullDistance.set(resistedDelta)

      // Trigger haptic when threshold is reached
      if (resistedDelta >= threshold && !hasTriggeredHaptic.current) {
        triggerHaptic('medium')
        hasTriggeredHaptic.current = true
      } else if (resistedDelta < threshold && hasTriggeredHaptic.current) {
        hasTriggeredHaptic.current = false
      }

      // Prevent default scroll when pulling
      e.preventDefault()
    }
  }, [isRefreshing, isLoading, pullDistance, threshold])

  const handleTouchEnd = useCallback(async () => {
    if (startY.current === null || isRefreshing || isLoading) return

    const currentPull = pullDistance.get()

    if (currentPull >= threshold && onRefresh) {
      setIsRefreshing(true)
      triggerHaptic('success')

      try {
        await onRefresh()
      } finally {
        setIsRefreshing(false)
      }
    }

    // Reset
    startY.current = null
    setIsPulling(false)
    pullDistance.set(0)
  }, [isRefreshing, isLoading, onRefresh, pullDistance, threshold])

  const showRefreshing = isRefreshing || isLoading

  return (
    <div className={`relative overflow-hidden ${className}`}>
      {/* Pull indicator */}
      <AnimatePresence>
        {(isPulling || showRefreshing) && (
          <motion.div
            initial={{ opacity: 0, y: -40 }}
            animate={{
              opacity: 1,
              y: showRefreshing ? 0 : -20,
            }}
            exit={{ opacity: 0, y: -40 }}
            className="absolute top-0 left-0 right-0 flex justify-center py-4 z-10"
          >
            <motion.div
              className={`
                w-10 h-10 rounded-full bg-white shadow-lg border border-slate-200
                flex items-center justify-center
              `}
              style={{
                scale: isPulling && !showRefreshing ? pullProgress : 1,
              }}
            >
              {showRefreshing ? (
                <Loader2 className="h-5 w-5 text-sky-500 animate-spin" />
              ) : (
                <motion.div
                  style={{
                    rotate: useTransform(pullProgress, [0, 1], [0, 180]),
                  }}
                >
                  <ArrowDown className="h-5 w-5 text-slate-400" />
                </motion.div>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Content */}
      <motion.div
        style={{
          y: isPulling || showRefreshing ? pullDistance : 0,
        }}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        className="h-full overflow-y-auto"
      >
        {children}
      </motion.div>
    </div>
  )
}

export default PullToRefresh
