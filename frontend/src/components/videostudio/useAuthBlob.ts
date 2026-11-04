import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { adminApi } from '@/lib/api'

/** Blob URL of a protected project file (needs the Bearer token, so it cannot be a plain src). */
export function useAuthBlobUrl(projectId: string, name: string, version?: string | number) {
  const { data } = useQuery<Blob>({
    queryKey: ['vs', 'blob', projectId, name, version ?? ''],
    queryFn: async () => (await adminApi.videoStudio.file(projectId, name)).data,
    enabled: !!name,
    staleTime: Infinity,
    gcTime: 10 * 60 * 1000,
    structuralSharing: false,
  })
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    if (!data) { setUrl(null); return }
    const next = URL.createObjectURL(data)
    setUrl(next)
    return () => URL.revokeObjectURL(next)
  }, [data])
  return url
}
