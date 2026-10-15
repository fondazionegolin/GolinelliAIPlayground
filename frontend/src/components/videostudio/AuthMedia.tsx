import { useEffect, useState } from 'react'
import { Loader2 } from '@/components/icons'
import { adminApi } from '@/lib/api'

interface Props {
  projectId: string
  name: string
  kind: 'img' | 'video'
  version?: string
  className?: string
  autoPlay?: boolean
}

/** Shows a protected project file (needs the Bearer token, so it is fetched as a blob). */
export function AuthMedia({ projectId, name, kind, version, className = '', autoPlay }: Props) {
  const [src, setSrc] = useState<string | null>(null)
  useEffect(() => {
    let url: string | null = null
    let alive = true
    setSrc(null)
    adminApi.videoStudio.file(projectId, name).then((res) => {
      if (!alive) return
      url = URL.createObjectURL(res.data)
      setSrc(url)
    }).catch(() => undefined)
    return () => { alive = false; if (url) URL.revokeObjectURL(url) }
  }, [projectId, name, version])

  if (!src) {
    return <div className={`flex items-center justify-center bg-[var(--ds-surface-muted)] text-[var(--text-secondary)] ${className}`}><Loader2 className="h-5 w-5 animate-spin" /></div>
  }
  return kind === 'img'
    ? <img src={src} alt="" className={className} draggable={false} />
    : <video src={src} controls autoPlay={autoPlay} playsInline className={className} />
}
