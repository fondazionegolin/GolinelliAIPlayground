import { useCallback, useState } from 'react'
import MLLabEditor from './MLLabEditor'
import MLLabLibrary from './MLLabLibrary'
import type { Mode } from '@/lib/mlFeatures'

type View = { kind: 'library' } | { kind: 'editor'; projectId: string | null; mode?: Mode; key: number }

/** ML Lab: the library of image-classifier projects first, the editor when one is opened or created. */
export default function MLLabImageStudio({ sessionId }: { sessionId?: string }) {
  const [view, setView] = useState<View>({ kind: 'library' })
  const toLibrary = useCallback(() => setView({ kind: 'library' }), [])
  if (view.kind === 'editor') return <MLLabEditor key={view.key} projectId={view.projectId} newMode={view.mode} sessionId={sessionId} onBack={toLibrary} />
  return (
    <MLLabLibrary
      onOpen={(projectId) => setView({ kind: 'editor', projectId, key: Date.now() })}
      onNew={(mode) => setView({ kind: 'editor', projectId: null, mode, key: Date.now() })}
      onImported={(projectId) => setView({ kind: 'editor', projectId, key: Date.now() })}
    />
  )
}
