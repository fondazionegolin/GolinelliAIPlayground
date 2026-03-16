import { useState, useEffect, useCallback } from 'react'

interface KeyboardState {
  isOpen: boolean
  height: number
}

/**
 * Hook for detecting virtual keyboard state on mobile devices
 * Uses the Visual Viewport API for more accurate detection
 */
export function useKeyboard(): KeyboardState & { dismiss: () => void } {
  const [state, setState] = useState<KeyboardState>({
    isOpen: false,
    height: 0,
  })

  useEffect(() => {
    // Check if Visual Viewport API is available
    if (!window.visualViewport) {
      return
    }

    let rafPending = false
    const handleViewportResize = () => {
      if (rafPending) return
      rafPending = true
      requestAnimationFrame(() => {
        rafPending = false
        const viewportHeight = window.visualViewport!.height
        const windowHeight = window.innerHeight

        // Calculate keyboard height as difference between window and viewport
        const keyboardHeight = windowHeight - viewportHeight

        // Consider keyboard open if difference is significant (> 150px)
        const isKeyboardOpen = keyboardHeight > 150

        setState({
          isOpen: isKeyboardOpen,
          height: isKeyboardOpen ? keyboardHeight : 0,
        })
      })
    }

    // Listen to viewport resize events
    window.visualViewport.addEventListener('resize', handleViewportResize)
    window.visualViewport.addEventListener('scroll', handleViewportResize)

    // Initial check
    handleViewportResize()

    return () => {
      window.visualViewport?.removeEventListener('resize', handleViewportResize)
      window.visualViewport?.removeEventListener('scroll', handleViewportResize)
    }
  }, [])

  // Dismiss keyboard by blurring the active element
  const dismiss = useCallback(() => {
    const activeElement = document.activeElement as HTMLElement
    if (activeElement && typeof activeElement.blur === 'function') {
      activeElement.blur()
    }
  }, [])

  return {
    ...state,
    dismiss,
  }
}

/**
 * Hook for managing focus and keyboard behavior for input elements
 */
export function useInputFocus(options?: {
  onFocus?: () => void
  onBlur?: () => void
  scrollToOnFocus?: boolean
}) {
  const [isFocused, setIsFocused] = useState(false)
  const { isOpen: isKeyboardOpen, height: keyboardHeight } = useKeyboard()

  const handleFocus = useCallback((e: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    setIsFocused(true)
    options?.onFocus?.()

    // Scroll element into view when keyboard opens
    if (options?.scrollToOnFocus !== false) {
      setTimeout(() => {
        e.target.scrollIntoView({ behavior: 'smooth', block: 'center' })
      }, 300) // Delay to allow keyboard to open
    }
  }, [options])

  const handleBlur = useCallback(() => {
    setIsFocused(false)
    options?.onBlur?.()
  }, [options])

  return {
    isFocused,
    isKeyboardOpen,
    keyboardHeight,
    handlers: {
      onFocus: handleFocus,
      onBlur: handleBlur,
    },
  }
}

export default useKeyboard
