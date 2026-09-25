import { useCallback, useEffect, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { solidModelerApi, type SolidModelSummary } from '@/lib/api'
import type { SceneObject } from './types'

export type SaveStatus = 'idle' | 'dirty' | 'saving' | 'saved' | 'error'

const DEFAULT_NAME = 'Progetto senza titolo'
const CURRENT_KEY = 'solid_modeler_current_server_v1'
// Pre-database prototype projects lived in localStorage: offered once for import.
const LEGACY_KEY = 'solid_modeler_projects_v1'
const LEGACY_DONE_KEY = 'solid_modeler_legacy_imported_v1'
const THUMB_EVERY_MS = 10_000
const AUTOSAVE_DELAY_MS = 1200

interface LegacyProject { id: string; name: string; objects: SceneObject[] }

const sig = (name: string, objects: SceneObject[]) => `${name}\u0000${JSON.stringify(objects)}`

function readStorage(key: string): string | null {
  try { return localStorage.getItem(key) } catch { return null }
}
function writeStorage(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key)
    else localStorage.setItem(key, value)
  } catch { /* private mode */ }
}

function legacyProjects(): LegacyProject[] {
  if (readStorage(LEGACY_DONE_KEY)) return []
  try {
    const list = JSON.parse(readStorage(LEGACY_KEY) || '[]') as LegacyProject[]
    return Array.isArray(list) ? list.filter(p => Array.isArray(p.objects) && p.objects.length) : []
  } catch {
    return []
  }
}

interface Options {
  objects: SceneObject[]
  /** Replace the editor scene (clears undo history + selection). */
  resetScene: (objects: SceneObject[]) => void
  snapshot: () => string | null
}

export function useSolidProject({ objects, resetScene, snapshot }: Options) {
  const queryClient = useQueryClient()
  const [projectId, setProjectId] = useState<string | null>(null)
  const [name, setName] = useState(DEFAULT_NAME)
  const [status, setStatus] = useState<SaveStatus>('idle')
  const [ready, setReady] = useState(false)
  const [legacy, setLegacy] = useState<LegacyProject[]>(legacyProjects)

  const idRef = useRef<string | null>(null)
  const nameRef = useRef(name)
  const objectsRef = useRef(objects)
  const savedSig = useRef(sig(DEFAULT_NAME, []))
  const inFlight = useRef<Promise<void> | null>(null)
  const lastThumbAt = useRef(0)
  nameRef.current = name
  objectsRef.current = objects

  const projects = useQuery({
    queryKey: ['solid-models'],
    queryFn: async () => (await solidModelerApi.list()).data,
  })

  const applyLoaded = useCallback((id: string | null, loadedName: string, scene: SceneObject[]) => {
    idRef.current = id
    setProjectId(id)
    setName(loadedName)
    nameRef.current = loadedName
    savedSig.current = sig(loadedName, scene)
    objectsRef.current = scene
    resetScene(scene)
    setStatus(id ? 'saved' : 'idle')
    writeStorage(CURRENT_KEY, id)
  }, [resetScene])

  const save = useCallback(async (force = false): Promise<void> => {
    if (inFlight.current) {
      await inFlight.current
      if (!force && sig(nameRef.current, objectsRef.current) === savedSig.current) return
    }
    const run = (async () => {
      const currentName = nameRef.current
      const scene = objectsRef.current
      const currentSig = sig(currentName, scene)
      if (idRef.current && currentSig === savedSig.current) return
      if (!idRef.current && !force && currentSig === savedSig.current) return
      // An untouched blank project is not worth a database row (unless explicitly needed, e.g. to share it).
      if (!force && !idRef.current && !scene.length && currentName === DEFAULT_NAME) return
      setStatus('saving')
      const withThumb = !idRef.current || Date.now() - lastThumbAt.current > THUMB_EVERY_MS
      const thumbnail = withThumb ? snapshot() : undefined
      if (withThumb) lastThumbAt.current = Date.now()
      try {
        if (!idRef.current) {
          const res = await solidModelerApi.create({ name: currentName, scene, thumbnail })
          idRef.current = res.data.id
          setProjectId(res.data.id)
          writeStorage(CURRENT_KEY, res.data.id)
        } else {
          try {
            await solidModelerApi.update(idRef.current, { name: currentName, scene, ...(thumbnail !== undefined ? { thumbnail } : {}) })
          } catch (err) {
            // Project deleted server-side (another tab, admin cleanup): recreate it from the in-memory scene.
            if ((err as { response?: { status?: number } })?.response?.status !== 404) throw err
            const res = await solidModelerApi.create({ name: currentName, scene, thumbnail: snapshot() })
            idRef.current = res.data.id
            setProjectId(res.data.id)
            writeStorage(CURRENT_KEY, res.data.id)
          }
        }
        savedSig.current = currentSig
        setStatus(sig(nameRef.current, objectsRef.current) === currentSig ? 'saved' : 'dirty')
        queryClient.invalidateQueries({ queryKey: ['solid-models'] })
      } catch {
        setStatus('error')
      }
    })()
    inFlight.current = run
    try { await run } finally { if (inFlight.current === run) inFlight.current = null }
  }, [queryClient, snapshot])

  // Initial load: last opened project, else the most recent one, else a blank scene.
  useEffect(() => {
    if (ready || !projects.isSuccess) return
    const list = projects.data
    const wanted = readStorage(CURRENT_KEY)
    const target = list.find(p => p.id === wanted) ?? list[0]
    if (!target) {
      applyLoaded(null, DEFAULT_NAME, [])
      setReady(true)
      return
    }
    solidModelerApi.get(target.id)
      .then(res => applyLoaded(res.data.id, res.data.name, res.data.scene as SceneObject[]))
      .catch(() => applyLoaded(null, DEFAULT_NAME, []))
      .finally(() => setReady(true))
  }, [projects.isSuccess, projects.data, ready, applyLoaded])

  // Debounced autosave.
  useEffect(() => {
    if (!ready) return
    if (sig(name, objects) === savedSig.current) return
    setStatus('dirty')
    const handle = setTimeout(() => { void save() }, AUTOSAVE_DELAY_MS)
    return () => clearTimeout(handle)
  }, [objects, name, ready, save])

  // When the tab regains focus, make sure the open project still exists; if not, recreate it from memory.
  useEffect(() => {
    if (!ready) return
    const check = () => {
      const id = idRef.current
      if (!id || document.visibilityState !== 'visible') return
      solidModelerApi.get(id).catch(err => {
        if ((err as { response?: { status?: number } })?.response?.status === 404 && idRef.current === id) {
          savedSig.current = ''
          void save()
        }
      })
    }
    window.addEventListener('focus', check)
    document.addEventListener('visibilitychange', check)
    return () => { window.removeEventListener('focus', check); document.removeEventListener('visibilitychange', check) }
  }, [ready, save])

  // Best-effort flush when leaving the page / the editor.
  useEffect(() => {
    const flush = () => { if (sig(nameRef.current, objectsRef.current) !== savedSig.current) void save() }
    window.addEventListener('beforeunload', flush)
    return () => { window.removeEventListener('beforeunload', flush); flush() }
  }, [save])

  const openProject = useCallback(async (id: string) => {
    await save()
    const res = await solidModelerApi.get(id)
    applyLoaded(res.data.id, res.data.name, res.data.scene as SceneObject[])
  }, [save, applyLoaded])

  const newProject = useCallback(async () => {
    await save()
    applyLoaded(null, DEFAULT_NAME, [])
  }, [save, applyLoaded])

  const deleteProject = useCallback(async (id: string) => {
    await solidModelerApi.remove(id)
    if (id === idRef.current) applyLoaded(null, DEFAULT_NAME, [])
    queryClient.invalidateQueries({ queryKey: ['solid-models'] })
  }, [applyLoaded, queryClient])

  /** Ensure the project exists server-side (needed before sharing). */
  const ensureSaved = useCallback(async (): Promise<string | null> => {
    await save(true)
    return idRef.current
  }, [save])

  const importLegacy = useCallback(async () => {
    for (const p of legacy) {
      await solidModelerApi.create({ name: p.name || DEFAULT_NAME, scene: p.objects })
    }
    writeStorage(LEGACY_DONE_KEY, '1')
    setLegacy([])
    queryClient.invalidateQueries({ queryKey: ['solid-models'] })
  }, [legacy, queryClient])

  const dismissLegacy = useCallback(() => {
    writeStorage(LEGACY_DONE_KEY, '1')
    setLegacy([])
  }, [])

  const current: SolidModelSummary | undefined = projects.data?.find(p => p.id === projectId)

  return {
    projectId, name, setName, status, ready, current,
    projects: projects.data ?? [], projectsLoading: projects.isLoading,
    openProject, newProject, deleteProject, ensureSaved, save,
    legacy, importLegacy, dismissLegacy,
  }
}
