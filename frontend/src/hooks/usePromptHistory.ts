import { useCallback, useRef, type KeyboardEvent } from 'react'

const MAX_ENTRIES = 50

function load(key: string): string[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(key) || '[]')
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : []
  } catch {
    return []
  }
}

function save(key: string, entries: string[]) {
  try {
    localStorage.setItem(key, JSON.stringify(entries))
  } catch {
    /* storage unavailable: history stays in memory only */
  }
}

/**
 * Shell-style prompt history for chat composers: ArrowUp on the first line recalls
 * earlier messages, ArrowDown on the last line walks forward and restores the draft.
 * Call `remember(text)` when a message is sent and `onHistoryKey` from onKeyDown.
 */
export function usePromptHistory(
  storageKey: string,
  value: string,
  setValue: (next: string) => void,
) {
  const entriesRef = useRef<string[] | null>(null)
  const indexRef = useRef(-1) // -1 = not browsing
  const draftRef = useRef('')
  const recalledRef = useRef<string | null>(null)

  const entries = () => (entriesRef.current ??= load(storageKey))

  const remember = useCallback((text: string) => {
    const trimmed = text.trim()
    indexRef.current = -1
    recalledRef.current = null
    if (!trimmed) return
    const list = entries().filter((e) => e !== trimmed)
    list.push(trimmed)
    entriesRef.current = list.slice(-MAX_ENTRIES)
    save(storageKey, entriesRef.current)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey])

  const onHistoryKey = useCallback((e: KeyboardEvent<HTMLTextAreaElement | HTMLInputElement>): boolean => {
    if ((e.key !== 'ArrowUp' && e.key !== 'ArrowDown') || e.shiftKey || e.altKey || e.ctrlKey || e.metaKey) return false
    if (e.nativeEvent.isComposing) return false
    const el = e.currentTarget
    const list = entries()
    // User edited the recalled text: leave history mode and let the caret move normally.
    if (indexRef.current !== -1 && recalledRef.current !== value) indexRef.current = -1

    const showAt = (idx: number, text: string) => {
      indexRef.current = idx
      recalledRef.current = text
      setValue(text)
      requestAnimationFrame(() => el.setSelectionRange(text.length, text.length))
    }

    if (e.key === 'ArrowUp') {
      const start = el.selectionStart ?? 0
      if (el.selectionEnd !== start || value.slice(0, start).includes('\n')) return false
      if (list.length === 0) return false
      if (indexRef.current === -1) {
        if (value.trim() && start !== 0) return false // only start browsing from an empty box or the very start
        draftRef.current = value
        e.preventDefault()
        showAt(list.length - 1, list[list.length - 1])
      } else if (indexRef.current > 0) {
        e.preventDefault()
        showAt(indexRef.current - 1, list[indexRef.current - 1])
      } else {
        e.preventDefault()
      }
      return true
    }

    if (indexRef.current === -1) return false
    const end = el.selectionEnd ?? value.length
    if (el.selectionStart !== end || value.slice(end).includes('\n')) return false
    e.preventDefault()
    if (indexRef.current < list.length - 1) {
      showAt(indexRef.current + 1, list[indexRef.current + 1])
    } else {
      indexRef.current = -1
      recalledRef.current = null
      setValue(draftRef.current)
    }
    return true
  }, [value, setValue])

  return { remember, onHistoryKey }
}
