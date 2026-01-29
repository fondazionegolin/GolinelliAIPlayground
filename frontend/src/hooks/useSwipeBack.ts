import { useRef, useEffect, useCallback, useState } from 'react'
import { triggerHaptic } from '@/lib/haptics'

interface UseSwipeBackOptions {
  onSwipeBack: () => void
  enabled?: boolean
  threshold?: number // percentage of screen width (0-1)
  edgeWidth?: number // pixels from left edge to trigger
}

interface SwipeState {
  isActive: boolean
  progress: number // 0-1
  x: number
}

export function useSwipeBack({
  onSwipeBack,
  enabled = true,
  threshold = 0.4,
  edgeWidth = 20,
}: UseSwipeBackOptions) {
  const startXRef = useRef<number | null>(null)
  const startYRef = useRef<number | null>(null)
  const isSwipingRef = useRef(false)
  const hasTriggeredHapticRef = useRef(false)
  const [swipeState, setSwipeState] = useState<SwipeState>({
    isActive: false,
    progress: 0,
    x: 0,
  })

  const handleTouchStart = useCallback((e: TouchEvent) => {
    if (!enabled) return

    const touch = e.touches[0]
    // Only start if touch begins near the left edge
    if (touch.clientX <= edgeWidth) {
      startXRef.current = touch.clientX
      startYRef.current = touch.clientY
      isSwipingRef.current = false
      hasTriggeredHapticRef.current = false
    }
  }, [enabled, edgeWidth])

  const handleTouchMove = useCallback((e: TouchEvent) => {
    if (startXRef.current === null || startYRef.current === null) return

    const touch = e.touches[0]
    const deltaX = touch.clientX - startXRef.current
    const deltaY = touch.clientY - startYRef.current

    // Determine if this is a horizontal swipe (not vertical scroll)
    if (!isSwipingRef.current) {
      // If vertical movement is greater, cancel the swipe
      if (Math.abs(deltaY) > Math.abs(deltaX) && Math.abs(deltaY) > 10) {
        startXRef.current = null
        startYRef.current = null
        setSwipeState({ isActive: false, progress: 0, x: 0 })
        return
      }

      // If horizontal movement is significant, start swiping
      if (deltaX > 10) {
        isSwipingRef.current = true
        // Trigger light haptic when swipe starts
        triggerHaptic('light')
      }
    }

    if (isSwipingRef.current && deltaX > 0) {
      // Prevent default to stop scrolling during swipe
      e.preventDefault()

      const screenWidth = window.innerWidth
      const progress = Math.min(deltaX / screenWidth, 1)

      // Trigger medium haptic when threshold is reached
      if (progress >= threshold && !hasTriggeredHapticRef.current) {
        triggerHaptic('medium')
        hasTriggeredHapticRef.current = true
      } else if (progress < threshold && hasTriggeredHapticRef.current) {
        hasTriggeredHapticRef.current = false
      }

      setSwipeState({
        isActive: true,
        progress,
        x: deltaX,
      })
    }
  }, [threshold])

  const handleTouchEnd = useCallback(() => {
    if (isSwipingRef.current && swipeState.progress >= threshold) {
      // Trigger success haptic
      triggerHaptic('success')
      onSwipeBack()
    }

    // Reset state
    startXRef.current = null
    startYRef.current = null
    isSwipingRef.current = false
    hasTriggeredHapticRef.current = false
    setSwipeState({ isActive: false, progress: 0, x: 0 })
  }, [swipeState.progress, threshold, onSwipeBack])

  useEffect(() => {
    if (!enabled) return

    const options: AddEventListenerOptions = { passive: false }

    document.addEventListener('touchstart', handleTouchStart, options)
    document.addEventListener('touchmove', handleTouchMove, options)
    document.addEventListener('touchend', handleTouchEnd)
    document.addEventListener('touchcancel', handleTouchEnd)

    return () => {
      document.removeEventListener('touchstart', handleTouchStart)
      document.removeEventListener('touchmove', handleTouchMove)
      document.removeEventListener('touchend', handleTouchEnd)
      document.removeEventListener('touchcancel', handleTouchEnd)
    }
  }, [enabled, handleTouchStart, handleTouchMove, handleTouchEnd])

  return swipeState
}

// Hook for element-level swipe (not edge-based)
export function useSwipeGesture(
  elementRef: React.RefObject<HTMLElement>,
  options: {
    onSwipeLeft?: () => void
    onSwipeRight?: () => void
    threshold?: number // pixels
  }
) {
  const { onSwipeLeft, onSwipeRight, threshold = 50 } = options
  const startX = useRef<number | null>(null)
  const startY = useRef<number | null>(null)

  useEffect(() => {
    const element = elementRef.current
    if (!element) return

    const handleTouchStart = (e: TouchEvent) => {
      startX.current = e.touches[0].clientX
      startY.current = e.touches[0].clientY
    }

    const handleTouchEnd = (e: TouchEvent) => {
      if (startX.current === null || startY.current === null) return

      const endX = e.changedTouches[0].clientX
      const endY = e.changedTouches[0].clientY
      const deltaX = endX - startX.current
      const deltaY = endY - startY.current

      // Only trigger if horizontal movement is greater than vertical
      if (Math.abs(deltaX) > Math.abs(deltaY) && Math.abs(deltaX) > threshold) {
        if (deltaX > 0 && onSwipeRight) {
          triggerHaptic('light')
          onSwipeRight()
        } else if (deltaX < 0 && onSwipeLeft) {
          triggerHaptic('light')
          onSwipeLeft()
        }
      }

      startX.current = null
      startY.current = null
    }

    element.addEventListener('touchstart', handleTouchStart)
    element.addEventListener('touchend', handleTouchEnd)

    return () => {
      element.removeEventListener('touchstart', handleTouchStart)
      element.removeEventListener('touchend', handleTouchEnd)
    }
  }, [elementRef, onSwipeLeft, onSwipeRight, threshold])
}
