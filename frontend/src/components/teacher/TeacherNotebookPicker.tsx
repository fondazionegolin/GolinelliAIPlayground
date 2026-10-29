import { useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Database, CheckCircle2, Plus, Info } from '@/components/icons'
import { teacherRagApi } from '@/lib/api'
import { teacherRagSessionStore } from '@/lib/ragSessions'
import { tl } from '@/i18n/tl'

export interface AttachedNotebook {
  id: string
  name: string
}

const STORAGE_KEY = 'teacher_chat_attached_notebooks'

export function loadAttachedNotebooks(): AttachedNotebook[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]')
    return Array.isArray(parsed) ? parsed.filter((n) => n?.id).slice(0, 5) : []
  } catch { return [] }
}

export function saveAttachedNotebooks(list: AttachedNotebook[]) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(list)) } catch { /* noop */ }
}

/** Composer button: attach RAG notebooks (knowledge bases) to the generalist teacher chat. */
export default function TeacherNotebookPicker({
  attached, onChange, onOpenWorkspace, align = 'left',
}: {
  attached: AttachedNotebook[]
  onChange: (next: AttachedNotebook[]) => void
  onOpenWorkspace: () => void
  align?: 'left' | 'right'
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  const { data: projects = [] } = useQuery({
    queryKey: ['teacher-rag-projects'],
    queryFn: async () => (await teacherRagApi.listProjects()).data || [],
    enabled: open,
    staleTime: 15_000,
  })
  const counts = new Map(projects.map((p) => [p.project_id, p.document_count]))
  const notebooks = open ? teacherRagSessionStore.get() : []
  const isAttached = (id: string) => attached.some((a) => a.id === id)

  const toggle = (id: string, name: string) => {
    onChange(isAttached(id)
      ? attached.filter((a) => a.id !== id)
      : [...attached, { id, name }].slice(0, 5))
  }

  return (
    <div className="relative flex-shrink-0" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        title={tl("Notebook RAG: allega una knowledge base alla chat")}
        className={`relative flex h-8 w-8 items-center justify-center rounded-lg transition-colors hover:bg-slate-100 ${
          attached.length ? 'text-emerald-600' : 'text-slate-400 hover:text-slate-700'
        }`}
      >
        <Database className="h-4 w-4" />
        {attached.length > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-emerald-500 px-0.5 text-[9px] font-bold text-white">
            {attached.length}
          </span>
        )}
      </button>

      {open && (
        <div className={`absolute bottom-full z-50 mb-2 w-80 rounded-xl border border-slate-200 bg-white p-2 shadow-xl ${align === 'right' ? 'right-0' : 'left-0'}`}>
          <p className="px-2 py-1 text-[10px] font-bold uppercase tracking-wide text-slate-400">{tl("Notebook RAG da usare nella chat")}</p>
          <div className="max-h-52 space-y-0.5 overflow-y-auto">
            {notebooks.length === 0 && (
              <p className="px-2 py-3 text-center text-[11px] text-slate-400">{tl("Nessun notebook ancora: creane uno e caricaci i tuoi documenti.")}</p>
            )}
            {notebooks.map((nb) => {
              const docs = counts.get(nb.id) ?? 0
              const on = isAttached(nb.id)
              return (
                <button key={nb.id} type="button" onClick={() => toggle(nb.id, nb.name)}
                  className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-slate-50 ${on ? 'bg-emerald-50' : ''}`}>
                  <span className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${on ? 'border-emerald-500 bg-emerald-500 text-white' : 'border-slate-300'}`}>
                    {on && <CheckCircle2 className="h-3 w-3" />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-xs font-semibold text-slate-700">{nb.name}</span>
                    <span className="block text-[10px] text-slate-400">{docs} {docs === 1 ? tl("documento") : tl("documenti")} indicizzati</span>
                  </span>
                </button>
              )
            })}
          </div>
          <button type="button" onClick={() => { setOpen(false); onOpenWorkspace() }}
            className="mt-1 flex w-full items-center gap-2 rounded-lg border border-slate-200 px-2 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50">
            <Plus className="h-3.5 w-3.5" /> {tl("Gestisci / crea notebook")}
          </button>
          <div className="mt-2 flex gap-1.5 rounded-lg bg-slate-50 p-2 text-[10px] leading-relaxed text-slate-500">
            <Info className="mt-0.5 h-3 w-3 shrink-0" />
            <p>
              <strong>RAG ≠ context learning.</strong> {tl("Con il RAG i documenti sono indicizzati e il modello riceve solo i frammenti pertinenti alla richiesta (citati con [[n]]): ideale per creare quiz, infografiche e documenti da molti materiali. Il context learning incolla invece tutto nel prompt, entro i limiti di lunghezza.")}
            </p>
          </div>
        </div>
      )}
    </div>
  )
}
