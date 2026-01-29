// Haptic Feedback API wrapper
// Uses the Vibration API on Android and iOS 13+ WKWebView

type HapticType = 'light' | 'medium' | 'heavy' | 'success' | 'warning' | 'error' | 'selection'

// Vibration patterns for different feedback types (in milliseconds)
const VIBRATION_PATTERNS: Record<HapticType, number | number[]> = {
  light: 10,
  medium: 20,
  heavy: 40,
  success: [10, 50, 20],
  warning: [20, 30, 20],
  error: [30, 50, 30, 50, 30],
  selection: 5,
}

// Check if haptic feedback is supported
export function isHapticSupported(): boolean {
  return 'vibrate' in navigator
}

// Trigger haptic feedback
export function triggerHaptic(type: HapticType = 'light'): void {
  if (!isHapticSupported()) return

  try {
    const pattern = VIBRATION_PATTERNS[type]
    navigator.vibrate(pattern)
  } catch (error) {
    // Silently fail if vibration is not allowed
    console.debug('Haptic feedback not available:', error)
  }
}

// Specialized haptic functions for common use cases
export const haptics = {
  // Tab selection
  tabSelect: () => triggerHaptic('light'),

  // Button press
  buttonPress: () => triggerHaptic('selection'),

  // Pull-to-refresh threshold reached
  pullRefresh: () => triggerHaptic('medium'),

  // Swipe action triggered
  swipeAction: () => triggerHaptic('medium'),

  // Long press activated
  longPress: () => triggerHaptic('heavy'),

  // Success feedback
  success: () => triggerHaptic('success'),

  // Error feedback
  error: () => triggerHaptic('error'),

  // Warning feedback
  warning: () => triggerHaptic('warning'),

  // Navigation back
  back: () => triggerHaptic('light'),

  // Item deleted
  delete: () => triggerHaptic('warning'),
}

export default haptics
