import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link2, Loader2, Share2, X } from 'lucide-react'
import { boardsApi, type BoardShareTarget } from '@/lib/api'
import { SearchPill } from '@/design'
import { useToast } from '@/components/ui/use-toast'

type SharesResponse = {
  teachers: BoardShareTarget[]
  students: BoardShareTarget[]
  teacher_candidates: { id: string; name: string; email?: string }[]
  student_candidates: { id: string; name: string }[]
}

export type ShareableBoard = {
  id: string
  session_id?: string | null
  session_title?: string | null
  visibility: 'private' | 'session_shared'
  students_can_edit: boolean
}

type Props = {
  board: ShareableBoard
  activeSessionId?: string
  isStudent: boolean
  onClose: () => void
  onBoardPatch: (patch: { visibility?: 'private' | 'session_shared'; students_can_edit?: boolean; session_id?: string }) => void
  boardPatchPending: boolean
}

export default function BoardShareDialog({ board, activeSessionId, isStudent, onClose, onBoardPatch, boardPatchPending }: Props) {
  const { toast } = useToast()
  const queryClient = useQueryClient()
  const [teachers, setTeachers] = useState<Record<string, boolean>>({})
  const [students, setStudents] = useState<Record<string, boolean>>({})
  const [teacherSearch, setTeacherSearch] = useState('')
  const [studentSearch, setStudentSearch] = useState('')

  const { data, isLoading } = useQuery({
    queryKey: ['board-shares', board.id, board.session_id],
    queryFn: async () => (await boardsApi.shares(board.id)).data as SharesResponse,
  })

  useEffect(() => {
    if (!data) return
    setTeachers(Object.fromEntries(data.teachers.map((t) => [t.id, t.can_edit])))
    setStudents(Object.fromEntries(data.students.map((s) => [s.id, s.can_edit])))
  }, [data])

  const save = useMutation({
    mutationFn: () => boardsApi.replaceShares(board.id, {
      teachers: Object.entries(teachers).map(([id, can_edit]) => ({ id, can_edit })),
      students: Object.entries(students).map(([id, can_edit]) => ({ id, can_edit })),
    }),
    onSuccess: (res) => {
      queryClient.setQueryData(['board-shares', board.id, board.session_id], res.data)
      queryClient.invalidateQueries({ queryKey: ['board-members', board.id] })
      toast({ title: 'Condivisione aggiornata' })
      onClose()
    },
    onError: (error: any) => {
      toast({ title: 'Condivisione non salvata', description: error?.response?.data?.detail || 'Riprova tra poco.', variant: 'destructive' })
    },
  })

  const filteredTeachers = useMemo(() => {
    const query = teacherSearch.trim().toLocaleLowerCase('it')
    return (data?.teacher_candidates || []).filter((t) => !query || `${t.name} ${t.email || ''}`.toLocaleLowerCase('it').includes(query))
  }, [data, teacherSearch])
  const filteredStudents = useMemo(() => {
    const query = studentSearch.trim().toLocaleLowerCase('it')
    return (data?.student_candidates || []).filter((s) => !query || s.name.toLocaleLowerCase('it').includes(query))
  }, [data, studentSearch])

  const sessionShared = board.visibility === 'session_shared'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <div className="ds-popover flex max-h-[88vh] w-full max-w-lg flex-col overflow-hidden rounded-[var(--ds-radius-card)]" role="dialog" aria-modal="true" aria-labelledby="board-share-title">
        <div className="flex items-start justify-between gap-4 px-6 pt-6">
          <div>
            <h3 id="board-share-title" className="flex items-center gap-2 text-lg font-black text-slate-900"><Share2 className="h-5 w-5" /> Condividi board</h3>
            <p className="mt-1 text-sm text-slate-500">Scegli chi può vedere la board e chi può modificarne i task.</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700" aria-label="Chiudi">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-6 py-5">
          <section className="space-y-2">
            <h4 className="text-xs font-black uppercase tracking-wide text-slate-500">Sessione</h4>
            {!board.session_id ? (
              <div className="rounded-[var(--ds-radius-control)] bg-slate-50 p-3 text-sm text-slate-600">
                <p>La board non è collegata a una sessione: per condividerla con gli studenti collegala alla sessione attiva.</p>
                {activeSessionId && !isStudent && (
                  <button
                    type="button"
                    disabled={boardPatchPending}
                    onClick={() => onBoardPatch({ session_id: activeSessionId })}
                    className="mt-2 inline-flex h-9 items-center gap-1 rounded-full border border-[color:var(--selection-border-hover)] bg-[image:var(--selection-active-bg)] px-3 text-xs font-bold text-[var(--selection-active-text)] disabled:opacity-40"
                  >
                    <Link2 className="h-4 w-4" /> Collega alla sessione attiva
                  </button>
                )}
              </div>
            ) : (
              <div className="space-y-2 rounded-[var(--ds-radius-control)] bg-slate-50 p-3">
                <label className="flex items-center gap-2 text-sm font-bold text-slate-700">
                  <input
                    type="checkbox"
                    checked={sessionShared}
                    disabled={boardPatchPending}
                    onChange={(event) => onBoardPatch({ visibility: event.target.checked ? 'session_shared' : 'private' })}
                  />
                  Condividi con tutta la sessione{board.session_title ? ` “${board.session_title}”` : ''}
                </label>
                {sessionShared && (
                  <label className="ml-6 flex items-center gap-2 text-xs font-bold text-slate-500">
                    <input type="checkbox" checked={board.students_can_edit} disabled={boardPatchPending} onChange={(event) => onBoardPatch({ students_can_edit: event.target.checked })} />
                    tutti gli studenti possono modificare i task
                  </label>
                )}
              </div>
            )}
          </section>

          {isLoading ? (
            <p className="flex items-center gap-2 text-sm text-slate-400"><Loader2 className="h-4 w-4 animate-spin" /> Caricamento…</p>
          ) : (
            <>
              {!isStudent && (
                <PeoplePicker
                  title="Docenti"
                  empty="Nessun altro docente nella scuola."
                  search={teacherSearch}
                  onSearch={setTeacherSearch}
                  people={filteredTeachers.map((t) => ({ id: t.id, name: t.name, detail: t.email }))}
                  selected={teachers}
                  onChange={setTeachers}
                />
              )}
              {board.session_id && (
                <PeoplePicker
                  title={isStudent ? 'Compagni di sessione' : 'Studenti specifici della sessione'}
                  empty="Nessuno studente nella sessione."
                  search={studentSearch}
                  onSearch={setStudentSearch}
                  people={filteredStudents}
                  selected={students}
                  onChange={setStudents}
                />
              )}
            </>
          )}
        </div>

        <div className="flex justify-end gap-2 border-t border-slate-100 px-6 py-4">
          <button type="button" onClick={onClose} className="h-10 rounded-lg px-4 text-sm font-bold text-slate-600 hover:bg-slate-100">Annulla</button>
          <button
            type="button"
            disabled={save.isPending || isLoading}
            onClick={() => save.mutate()}
            className="h-10 rounded-full border border-[color:var(--selection-border-hover)] bg-[image:var(--selection-active-bg)] px-4 text-sm font-bold text-[var(--selection-active-text)] disabled:cursor-not-allowed disabled:opacity-40"
          >
            {save.isPending ? 'Salvataggio…' : 'Salva condivisione'}
          </button>
        </div>
      </div>
    </div>
  )
}

function PeoplePicker({ title, empty, search, onSearch, people, selected, onChange }: {
  title: string
  empty: string
  search: string
  onSearch: (value: string) => void
  people: { id: string; name: string; detail?: string }[]
  selected: Record<string, boolean>
  onChange: (next: Record<string, boolean>) => void
}) {
  const count = Object.keys(selected).length
  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <h4 className="text-xs font-black uppercase tracking-wide text-slate-500">{title}{count ? ` · ${count}` : ''}</h4>
        <SearchPill value={search} onValueChange={onSearch} placeholder="Cerca" aria-label={`Cerca ${title.toLowerCase()}`} className="w-40" />
      </div>
      <div className="max-h-52 space-y-1 overflow-y-auto rounded-[var(--ds-radius-control)] bg-slate-50 p-1">
        {people.length === 0 ? <p className="px-2 py-3 text-xs text-slate-400">{search ? 'Nessun risultato.' : empty}</p> : people.map((person) => {
          const isSelected = person.id in selected
          return (
            <div key={person.id} className={`flex items-center gap-2 rounded-lg px-2 py-1.5 ${isSelected ? 'bg-white shadow-[var(--ds-shadow-1)]' : ''}`}>
              <label className="flex min-w-0 flex-1 items-center gap-2 text-sm text-slate-700">
                <input
                  type="checkbox"
                  checked={isSelected}
                  onChange={(event) => {
                    const next = { ...selected }
                    if (event.target.checked) next[person.id] = true
                    else delete next[person.id]
                    onChange(next)
                  }}
                />
                <span className="min-w-0 truncate font-bold">{person.name}</span>
                {person.detail && <span className="hidden min-w-0 truncate text-xs text-slate-400 sm:inline">{person.detail}</span>}
              </label>
              {isSelected && (
                <select
                  value={selected[person.id] ? 'edit' : 'view'}
                  onChange={(event) => onChange({ ...selected, [person.id]: event.target.value === 'edit' })}
                  className="h-7 rounded-md border border-slate-200 bg-white px-1 text-xs"
                  aria-label={`Permesso per ${person.name}`}
                >
                  <option value="edit">Può modificare</option>
                  <option value="view">Solo lettura</option>
                </select>
              )}
            </div>
          )
        })}
      </div>
    </section>
  )
}
