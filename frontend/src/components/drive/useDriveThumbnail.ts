import { useEffect, useRef, useState } from 'react'
import { driveApi } from '@/lib/api'
import type { DriveItem } from './driveTypes'

const thumbCache = new Map<string, string>()

/** Lazy thumbnail: fetches the file only when its tile scrolls into view. */
export function useThumbnail(item: DriveItem, enabled: boolean) {
  const ref = useRef<HTMLDivElement>(null)
  const [url, setUrl] = useState<string | null>(() => item.thumbnail || thumbCache.get(item.id) || null)
  useEffect(() => {
    if (!enabled || url || !ref.current) return
    const node = ref.current
    let cancelled = false
    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return
      observer.disconnect()
      driveApi.content(item.id).then((res) => {
        if (cancelled) return
        const objectUrl = URL.createObjectURL(res.data)
        thumbCache.set(item.id, objectUrl)
        setUrl(objectUrl)
      }).catch(() => undefined)
    }, { rootMargin: '200px' })
    observer.observe(node)
    return () => { cancelled = true; observer.disconnect() }
  }, [enabled, item.id, url])
  return { ref, url }
}
