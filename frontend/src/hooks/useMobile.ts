import { useState, useEffect, useCallback } from 'react'

interface MobileState {
  isMobile: boolean
  isTablet: boolean
  isKeyboardOpen: boolean
  keyboardHeight: number
  safeAreaInsets: {
    top: number
    bottom: number
    left: number
    right: number
  }
  orientation: 'portrait' | 'landscape'
  viewportHeight: number
}

export function useMobile(): MobileState {
  const [state, setState] = useState<MobileState>(() => ({
    isMobile: typeof window !== 'undefined' && window.innerWidth < 768,
    isTablet: typeof window !== 'undefined' && window.innerWidth >= 768 && window.innerWidth < 1024,
    isKeyboardOpen: false,
    keyboardHeight: 0,
    safeAreaInsets: { top: 0, bottom: 0, left: 0, right: 0 },
    orientation: typeof window !== 'undefined' && window.innerWidth > window.innerHeight ? 'landscape' : 'portrait',
    viewportHeight: typeof window !== 'undefined' ? window.innerHeight : 0,
  }))

  useEffect(() => {
    // Detect screen size changes
    const handleResize = () => {
      const isMobile = window.innerWidth < 768
      const isTablet = window.innerWidth >= 768 && window.innerWidth < 1024
      const orientation = window.innerWidth > window.innerHeight ? 'landscape' : 'portrait'
      setState(prev => {
        // iOS fires resize continuously while its browser chrome expands/collapses. A height-only
        // update used to re-render every consumer (including the complete document workspace).
        if (prev.isMobile === isMobile && prev.isTablet === isTablet && prev.orientation === orientation) return prev
        return { ...prev, isMobile, isTablet, orientation, viewportHeight: window.innerHeight }
      })
    }

    // Detect keyboard using visualViewport API (more reliable than resize)
    let vvRafPending = false
    const handleVisualViewportResize = () => {
      if (vvRafPending) return
      vvRafPending = true
      requestAnimationFrame(() => {
        vvRafPending = false
        if (!window.visualViewport) return

        const viewportHeight = Math.round(window.visualViewport.height)
        const windowHeight = window.innerHeight
        const keyboardHeight = Math.max(0, Math.round(windowHeight - viewportHeight))
        const isKeyboardOpen = keyboardHeight > 150 // Threshold to detect keyboard

        setState(prev => {
          const nextKeyboardHeight = isKeyboardOpen ? keyboardHeight : 0
          const nextViewportHeight = isKeyboardOpen ? viewportHeight : prev.viewportHeight
          if (
            prev.isKeyboardOpen === isKeyboardOpen &&
            prev.keyboardHeight === nextKeyboardHeight &&
            prev.viewportHeight === nextViewportHeight
          ) return prev
          return {
            ...prev,
            isKeyboardOpen,
            keyboardHeight: nextKeyboardHeight,
            viewportHeight: nextViewportHeight,
          }
        })
      })
    }

    // Get safe area insets from CSS environment variables
    const getSafeAreaInsets = () => {
      const computedStyle = getComputedStyle(document.documentElement)
      const top = parseInt(computedStyle.getPropertyValue('--sat') || '0', 10) ||
                  parseInt(getComputedStyle(document.documentElement).getPropertyValue('env(safe-area-inset-top)') || '0', 10)
      const bottom = parseInt(computedStyle.getPropertyValue('--sab') || '0', 10) ||
                     parseInt(getComputedStyle(document.documentElement).getPropertyValue('env(safe-area-inset-bottom)') || '0', 10)
      const left = parseInt(computedStyle.getPropertyValue('--sal') || '0', 10) ||
                   parseInt(getComputedStyle(document.documentElement).getPropertyValue('env(safe-area-inset-left)') || '0', 10)
      const right = parseInt(computedStyle.getPropertyValue('--sar') || '0', 10) ||
                    parseInt(getComputedStyle(document.documentElement).getPropertyValue('env(safe-area-inset-right)') || '0', 10)

      setState(prev => ({
        ...prev,
        safeAreaInsets: { top, bottom, left, right },
      }))
    }

    // Initial setup
    handleResize()
    getSafeAreaInsets()

    // Event listeners
    window.addEventListener('resize', handleResize)
    window.visualViewport?.addEventListener('resize', handleVisualViewportResize)

    return () => {
      window.removeEventListener('resize', handleResize)
      window.visualViewport?.removeEventListener('resize', handleVisualViewportResize)
    }
  }, [])

  return state
}

// Hook specifically for detecting keyboard
export function useKeyboard() {
  const [isOpen, setIsOpen] = useState(false)
  const [height, setHeight] = useState(0)

  useEffect(() => {
    if (!window.visualViewport) return

    let rafPending = false
    const handleResize = () => {
      if (rafPending) return
      rafPending = true
      requestAnimationFrame(() => {
        rafPending = false
        const viewportHeight = window.visualViewport!.height
        const windowHeight = window.innerHeight
        const keyboardHeight = windowHeight - viewportHeight
        const keyboardOpen = keyboardHeight > 150

        setIsOpen(keyboardOpen)
        setHeight(keyboardOpen ? keyboardHeight : 0)
      })
    }

    window.visualViewport.addEventListener('resize', handleResize)
    window.visualViewport.addEventListener('scroll', handleResize)

    return () => {
      window.visualViewport?.removeEventListener('resize', handleResize)
      window.visualViewport?.removeEventListener('scroll', handleResize)
    }
  }, [])

  const dismiss = useCallback(() => {
    const activeElement = document.activeElement as HTMLElement
    if (activeElement && typeof activeElement.blur === 'function') {
      activeElement.blur()
    }
  }, [])

  return { isOpen, height, dismiss }
}

// Detect if device supports touch
export function useIsTouch(): boolean {
  const [isTouch, setIsTouch] = useState(false)

  useEffect(() => {
    setIsTouch('ontouchstart' in window || navigator.maxTouchPoints > 0)
  }, [])

  return isTouch
}

// Detect iOS specifically (for special handling)
export function useIsIOS(): boolean {
  const detectIOS = () => {
    if (typeof navigator === 'undefined' || typeof window === 'undefined') return false
    const userAgent = navigator.userAgent || navigator.vendor || ''
    return /iPad|iPhone|iPod/.test(userAgent) && !(window as unknown as { MSStream?: unknown }).MSStream
  }
  const [isIOS, setIsIOS] = useState(detectIOS)

  useEffect(() => {
    setIsIOS(detectIOS())
  }, [])

  return isIOS
}
