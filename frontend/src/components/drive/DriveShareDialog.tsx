import { useEffect, useMemo, useState } from 'react'
import { Check, Copy, GraduationCap, Link2, Loader2, Mail, Shapes, Trash2, Users } from '@/components/icons'
import { Button, Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/design'
import { driveApi, type DriveShareTarget } from '@/lib/api'
import { useToast } from '@/components/ui/use-toast'
import type { DriveItem } from './driveTypes'
import { tl } from '@/i18n/tl'

interface ShareRow { target_type: 'session' | 'class' | 'teacher' | 'student'; target_id?: string; email?: string; role: 'viewer' | 'editor'; label?: string }
interface Targets { classes: { id: string; name: string }[]; sessions: { id: string; name: string; class_id: string; status: string }[]; students: { id: string; name: string; session: string }[]; teachers: { id: string; name: string }[] }

const ROLE_LABEL = { viewer: tl("Può vedere"), editor: tl("Può modificare") } as const
const TYPE_ICON = { session: Shapes, class: GraduationCap, teacher: Users, student: Users } as const

export function DriveShareDialog({ item, items = [item], isTeacher = true, onClose, onChanged }: { item: DriveItem; items?: DriveItem[]; isTeacher?: boolean; onClose: () => void; onChanged: () => void }) {
  const { toast } = useToast()
  const bulk = items.length > 1
  const [loadError, setLoadError] = useState(false)
  const [rows, setRows] = useState<ShareRow[]>([])
  const [inherited, setInherited] = useState<{ target_type: string; role: string; from: string }[]>([])
  const [targets, setTargets] = useState<Targets>({ classes: [], sessions: [], students: [], teachers: [] })
  const [publicToken, setPublicToken] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [pick, setPick] = useState('')
  const [email, setEmail] = useState('')
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    Promise.all([bulk ? Promise.resolve({ data: { shares: [], inherited: [], public_token: null } }) : driveApi.getShares(item.id), driveApi.shareTargets()])
      .then(([shares, available]) => {
        setRows(shares.data.shares)
        setInherited(shares.data.inherited)
        setPublicToken(shares.data.public_token)
        setTargets(available.data)
      })
      .catch(() => { setLoadError(true); toast({ variant: 'destructive', title: tl("Impossibile caricare gli accessi") }) })
      .finally(() => setLoading(false))
  }, [item.id, bulk])

  const classNames = useMemo(() => new Map(targets.classes.map((cls) => [cls.id, cls.name])), [targets])
  const labelFor = (row: ShareRow) => {
    if (row.label) return row.label
    if (row.target_type === 'class') return classNames.get(row.target_id || '') || tl("Classe")
    if (row.target_type === 'session') return targets.sessions.find((s) => s.id === row.target_id)?.name || tl("Sessione")
    if (row.target_type === 'student') return targets.students.find((student) => student.id === row.target_id)?.name || tl("Studente")
    return row.email || targets.teachers.find((teacher) => teacher.id === row.target_id)?.name || tl("Docente")
  }
  const taken = new Set(rows.map((row) => `${row.target_type}:${row.target_id}`))

  const addPicked = () => {
    if (!pick) return
    const [targetType, targetId] = pick.split(':') as [ShareRow['target_type'], string]
    if (!taken.has(pick)) setRows((current) => [...current, { target_type: targetType, target_id: targetId, role: 'viewer' }])
    setPick('')
  }
  const addEmail = () => {
    const value = email.trim()
    if (!value || !value.includes('@')) return
    if (rows.some((row) => row.email?.toLowerCase() === value.toLowerCase())) return
    setRows((current) => [...current, { target_type: 'teacher', email: value, role: 'viewer', label: value }])
    setEmail('')
  }

  const save = async () => {
    setSaving(true)
    try {
      const payload: DriveShareTarget[] = rows.map(({ target_type, target_id, email: mail, role }) => ({ target_type, target_id, email: mail, role }))
      if (bulk) await driveApi.addShares(items.map((entry) => entry.id), payload)
      else { const res = await driveApi.putShares(item.id, payload); setRows(res.data.shares) }
      toast({ title: rows.length ? tl("Condivisione aggiornata") : tl("Condivisione rimossa") })
      onChanged()
      onClose()
    } catch (err: any) {
      toast({ variant: 'destructive', title: tl("Condivisione non salvata"), description: err?.response?.data?.detail || tl("Riprova.") })
    } finally {
      setSaving(false)
    }
  }

  const togglePublic = async () => {
    try {
      const res = await driveApi.setPublicLink(item.id, !publicToken)
      setPublicToken(res.data.public_token)
      onChanged()
    } catch (err: any) {
      toast({ variant: 'destructive', title: tl("Link non aggiornato"), description: err?.response?.data?.detail })
    }
  }
  const publicUrl = publicToken ? `${window.location.origin}/api/v1/public/drive/${publicToken}` : ''
  const copyLink = async () => {
    await navigator.clipboard.writeText(publicUrl)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle className="truncate">{bulk ? tl("Condividi {0} elementi", items.length) : tl("Condividi «{0}»", item.name)}</DialogTitle>
          <DialogDescription>
            {bulk ? tl("Gli accessi scelti saranno aggiunti a tutti gli elementi. Gli accessi esistenti vengono conservati.") : item.kind === 'folder' ? tl("Chi riceve l’accesso vede la cartella e tutto il suo contenuto.") : tl("Scegli chi può vedere o modificare questo elemento.")}
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-5">
          {loading ? (
            <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-slate-400" /></div>
          ) : (
            <>
              <div className="space-y-2">
                <label className="text-[11px] font-semibold text-slate-400">{tl("Persone, classi e sessioni")}</label>
                <div className="flex gap-2">
                  <select
                    value={pick}
                    onChange={(event) => setPick(event.target.value)}
                    className="ds-control h-10 min-w-0 flex-1 rounded-xl px-3 text-sm"
                  >
                    <option value="">{tl("Scegli…")}</option>
                    {targets.students.length > 0 && <optgroup label={tl("Studenti")}>
                      {targets.students.map((student) => <option key={student.id} value={`student:${student.id}`} disabled={taken.has(`student:${student.id}`)}>{student.name} · {student.session}</option>)}
                    </optgroup>}
                    {targets.teachers.length > 0 && <optgroup label={tl("Docenti")}>
                      {targets.teachers.map((teacher) => <option key={teacher.id} value={`teacher:${teacher.id}`} disabled={taken.has(`teacher:${teacher.id}`)}>{teacher.name}</option>)}
                    </optgroup>}
                    {targets.classes.map((cls) => (
                      <optgroup key={cls.id} label={cls.name}>
                        <option value={`class:${cls.id}`} disabled={taken.has(`class:${cls.id}`)}>{tl("Tutta la classe")} {cls.name}</option>
                        {targets.sessions.filter((s) => s.class_id === cls.id).map((s) => (
                          <option key={s.id} value={`session:${s.id}`} disabled={taken.has(`session:${s.id}`)}>
                            {tl("Sessione ·")} {s.name}{s.status === 'active' ? tl(" (attiva)") : ''}
                          </option>
                        ))}
                      </optgroup>
                    ))}
                  </select>
                  <Button type="button" tone="accent" surface="soft" onClick={addPicked} disabled={!pick}>{tl("Aggiungi")}</Button>
                </div>
              </div>
              {isTeacher && <div className="space-y-2">
                <label className="text-[11px] font-semibold text-slate-400">{tl("Colleghi docenti")}</label>
                <div className="flex gap-2">
                  <div className="ds-control flex h-10 min-w-0 flex-1 items-center gap-2 rounded-xl px-3">
                    <Mail className="h-4 w-4 shrink-0 text-slate-400" />
                    <input
                      type="email"
                      value={email}
                      onChange={(event) => setEmail(event.target.value)}
                      onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); addEmail() } }}
                      placeholder="email@scuola.it"
                      className="min-w-0 flex-1 bg-transparent text-sm outline-none"
                    />
                  </div>
                  <Button type="button" tone="accent" surface="soft" onClick={addEmail} disabled={!email.includes('@')}>{tl("Aggiungi")}</Button>
                </div>
              </div>}

              <div className="space-y-1.5">
                <p className="text-[11px] font-semibold text-slate-400">{tl("Persone con accesso")}</p>
                <div className="flex items-center gap-3 rounded-xl px-2 py-2">
                  <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[var(--app-accent-soft)] text-[var(--app-accent-text)]"><Users className="h-4 w-4" /></span>
                  <span className="flex-1 text-sm font-semibold text-[var(--text-primary)]">Tu</span>
                  <span className="text-xs text-slate-400">{tl("Proprietario")}</span>
                </div>
                {rows.map((row, index) => {
                  const Icon = TYPE_ICON[row.target_type]
                  return (
                    <div key={`${row.target_type}:${row.target_id || row.email}`} className="flex items-center gap-3 rounded-xl px-2 py-1.5 hover:bg-[var(--ds-control-hover)]">
                      <span className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-100 text-slate-600"><Icon className="h-4 w-4" /></span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-semibold text-[var(--text-primary)]">{labelFor(row)}</span>
                        <span className="block text-[11px] text-slate-400">{row.target_type === 'class' ? tl("Tutti gli studenti della classe") : row.target_type === 'session' ? tl("Studenti della sessione") : row.target_type === 'student' ? tl("Studente") : tl("Docente")}</span>
                      </span>
                      <select
                        value={row.role}
                        onChange={(event) => setRows((current) => current.map((r, i) => (i === index ? { ...r, role: event.target.value as ShareRow['role'] } : r)))}
                        className="ds-field h-9 rounded-lg px-2 text-xs font-semibold"
                      >
                        <option value="viewer">{ROLE_LABEL.viewer}</option>
                        <option value="editor">{ROLE_LABEL.editor}</option>
                      </select>
                      <button type="button" onClick={() => setRows((current) => current.filter((_, i) => i !== index))} className="flex h-8 w-8 items-center justify-center rounded-full text-slate-400 hover:bg-red-50 hover:text-red-600" aria-label={tl("Rimuovi accesso")}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  )
                })}
                {inherited.length > 0 && (
                  <p className="px-2 pt-1 text-[11px] text-slate-400">
                    {tl("Accessi ereditati:")} {inherited.map((share) => `«${share.from}»`).filter((v, i, a) => a.indexOf(v) === i).join(', ')}
                  </p>
                )}
              </div>

              {!bulk && isTeacher && item.kind !== 'folder' && (
                <div className="rounded-2xl bg-slate-50 p-3">
                  <div className="flex items-center gap-3">
                    <span className="flex h-8 w-8 items-center justify-center rounded-full bg-white text-slate-600 shadow-[var(--ds-shadow-1)]"><Link2 className="h-4 w-4" /></span>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold text-[var(--text-primary)]">{tl("Link pubblico")}</p>
                      <p className="text-[11px] text-slate-500">{publicToken ? tl("Chiunque abbia il link può scaricare il file") : tl("Disattivato: solo le persone aggiunte")}</p>
                    </div>
                    <Button type="button" density="compact" tone={publicToken ? 'danger' : 'neutral'} surface="soft" onClick={() => void togglePublic()}>
                      {publicToken ? tl("Disattiva") : tl("Attiva")}
                    </Button>
                  </div>
                  {publicToken && (
                    <div className="mt-2 flex items-center gap-2">
                      <input readOnly value={publicUrl} className="ds-control h-9 min-w-0 flex-1 rounded-lg px-2 font-mono text-[11px]" onFocus={(event) => event.target.select()} />
                      <Button type="button" density="compact" tone="accent" surface="solid" onClick={() => void copyLink()}>
                        {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                      </Button>
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </DialogBody>
        <DialogFooter>
          <Button type="button" tone="neutral" surface="ghost" onClick={onClose}>{tl("Annulla")}</Button>
          <Button type="button" tone="accent" surface="solid" onClick={() => void save()} disabled={saving || loading || loadError || (bulk && rows.length === 0)}>
            {saving && <Loader2 className="h-4 w-4 animate-spin" />} {tl("Salva")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
