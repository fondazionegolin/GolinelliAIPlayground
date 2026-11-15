import { useCallback, useState } from 'react'
import MLLabEditor from './MLLabEditor'
import MLLabLibrary from './MLLabLibrary'
import type { Mode } from '@/lib/mlFeatures'
import { useOpenParam } from '@/lib/useOpenParam'
import { takeHandoff } from '@/lib/platformHandoff'

type View = { kind: 'library' } | { kind: 'editor'; projectId: string | null; mode?: Mode; seed?: { name?: string; classes?: string[] }; key: number }
const MODES: Mode[] = ['image', 'pose', 'hand', 'face']

/** ML Lab: the library of image-classifier projects first, the editor when one is opened or created. */
export default function MLLabImageStudio({ sessionId }: { sessionId?: string }) {
  const openProject = useOpenParam('project')
  const [view, setView] = useState<View>(() => {
    // Agentic hand-off from the chat: a new project of the right kind, with the proposed classes.
    const handoff = openProject ? null : takeHandoff(['ml_lab'])
    if (handoff) {
      const mode = MODES.find((m) => m === handoff.hints.mode) ?? 'image'
      return { kind: 'editor', projectId: null, mode, seed: { name: handoff.title || handoff.hints.name, classes: handoff.hints.classes }, key: Date.now() }
    }
    return openProject ? { kind: 'editor', projectId: openProject, key: Date.now() } : { kind: 'library' }
  })
  const toLibrary = useCallback(() => setView({ kind: 'library' }), [])
  if (view.kind === 'editor') return <MLLabEditor key={view.key} projectId={view.projectId} newMode={view.mode} seed={view.seed} sessionId={sessionId} onBack={toLibrary} />
  return (
    <MLLabLibrary
      onOpen={(projectId) => setView({ kind: 'editor', projectId, key: Date.now() })}
      onNew={(mode) => setView({ kind: 'editor', projectId: null, mode, key: Date.now() })}
      onImported={(projectId) => setView({ kind: 'editor', projectId, key: Date.now() })}
    />
  )
}
