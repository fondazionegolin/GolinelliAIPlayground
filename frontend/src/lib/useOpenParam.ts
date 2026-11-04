import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'

/** Reads a deep-link query parameter once (e.g. `?project=…` from the navbar quick menu) and removes it from the URL. */
export function useOpenParam(name: string): string | null {
  const [searchParams, setSearchParams] = useSearchParams()
  const [value] = useState(() => searchParams.get(name))
  useEffect(() => {
    if (!searchParams.has(name)) return
    const next = new URLSearchParams(searchParams)
    next.delete(name)
    setSearchParams(next, { replace: true })
  }, [searchParams, setSearchParams, name])
  return value
}
