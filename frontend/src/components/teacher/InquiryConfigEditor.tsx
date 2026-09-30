import { useState } from 'react'
import { Loader2, ImageIcon, Sparkles, Crosshair } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Plus, Trash2, ChevronDown, ChevronUp } from 'lucide-react'
import { INQUIRY_FLAGS, llmApi, type InquiryClue, type InquiryConfig, type InquiryFlag, type InquirySuspect } from '@/lib/api'
import { useToast } from '@/components/ui/use-toast'

const VOICES = ['marin', 'cedar', 'alloy', 'ash', 'ballad', 'coral', 'echo', 'sage', 'shimmer', 'verse']

export function emptySuspect(id: string): InquirySuspect {
  return { id, name: '', role: '', personality: '', knowledge: '', avatar_url: null, voice: null, is_culprit: false }
}

/** Merge a stored config over the defaults, folding legacy single-NPC fields into a suspect. */
export function normalizeInquiryConfig(raw: Partial<InquiryConfig> | null | undefined): InquiryConfig {
  const cfg = { ...emptyInquiryConfig(), ...(raw || {}) } as InquiryConfig
  if (!raw?.suspects?.length) {
    cfg.suspects = [{ ...emptySuspect('s1'), name: raw?.npc_name || '', role: raw?.npc_role || '', personality: raw?.npc_personality || '' }]
  }
  cfg.clues = (cfg.clues || []).map((c) => ({ ...c, suspect_id: c.suspect_id ?? null }))
  return cfg
}

export function emptyInquiryConfig(): InquiryConfig {
  return {
    npc_name: '',
    npc_role: '',
    npc_personality: '',
    suspects: [emptySuspect('s1')],
    case_title: '',
    case_brief: '',
    truth: '',
    final_question: '',
    correct_answer: '',
    min_clues: 3,
    clues: [],
    flag_intensity: { defensive: 2, nervous: 2, persuasive: 2, dramatic: 2, humorous: 2, cooperative: 2 },
  }
}

const inputCls =
  'w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 outline-none transition focus:border-slate-400 focus:ring-2 focus:ring-slate-200'

function Label({ children }: { children: React.ReactNode }) {
  return <label className="mb-1 block text-xs font-bold uppercase tracking-[0.08em] text-slate-500">{children}</label>
}

const FLAG_LABEL: Record<InquiryFlag, string> = {
  defensive: 'Difensivo',
  nervous: 'Nervoso',
  persuasive: 'Persuasivo',
  dramatic: 'Drammatico',
  humorous: 'Umoristico',
  cooperative: 'Cooperativo',
}
const INTENSITY_LABEL = ['Off', 'Lieve', 'Marcato', 'Forte']

interface Props {
  value: InquiryConfig
  onChange: (next: InquiryConfig) => void
  teacherbotId?: string
}

export default function InquiryConfigEditor({ value, onChange, teacherbotId }: Props) {
  const { t } = useTranslation()
  const { toast } = useToast()
  const set = <K extends keyof InquiryConfig>(key: K, v: InquiryConfig[K]) => onChange({ ...value, [key]: v })
  const multi = value.suspects.length > 1
  const [genCount, setGenCount] = useState(3)
  const [generating, setGenerating] = useState(false)
  const [avatarBusy, setAvatarBusy] = useState<string | null>(null)
  const [avatarPrompts, setAvatarPrompts] = useState<Record<string, string>>({})

  const updateSuspect = (id: string, patch: Partial<InquirySuspect>) =>
    set('suspects', value.suspects.map((sp) => (sp.id === id ? { ...sp, ...patch } : sp)))
  const setCulprit = (id: string) =>
    set('suspects', value.suspects.map((sp) => ({ ...sp, is_culprit: sp.id === id })))
  const addSuspect = () => {
    const used = new Set(value.suspects.map((sp) => sp.id))
    let n = value.suspects.length + 1
    while (used.has(`s${n}`)) n += 1
    set('suspects', [...value.suspects, emptySuspect(`s${n}`)])
  }
  const removeSuspect = (id: string) => {
    if (value.suspects.length <= 1) return
    onChange({
      ...value,
      suspects: value.suspects.filter((sp) => sp.id !== id),
      clues: value.clues.map((c) => (c.suspect_id === id ? { ...c, suspect_id: null } : c)),
    })
  }

  const avatarPromptFor = (sp: InquirySuspect) =>
    `Square illustrated character portrait for an investigative mystery game. ${avatarPrompts[sp.id] || `${sp.name}, ${sp.role}. ${sp.personality}`}. ` +
    'Single centered face, head and shoulders, expressive, simple clean background, recognizable at small size, polished educational app style, no text, no letters, no logos.'

  const generateAvatar = async (sp: InquirySuspect): Promise<string | null> => {
    setAvatarBusy(sp.id)
    try {
      const res = await llmApi.generateImage(avatarPromptFor(sp), 'gpt-image-2-2026-04-21')
      const url = String(res.data.image_url)
      return url
    } catch (e: any) {
      toast({ title: t('common.error'), description: e?.response?.data?.detail || 'Generazione avatar non riuscita', variant: 'destructive' })
      return null
    } finally {
      setAvatarBusy(null)
    }
  }
  const generateOneAvatar = async (sp: InquirySuspect) => {
    const url = await generateAvatar(sp)
    if (url) updateSuspect(sp.id, { avatar_url: url })
  }
  const generateAllAvatars = async () => {
    let next = value.suspects
    for (const sp of value.suspects) {
      if (!(sp.name.trim() && (sp.personality.trim() || sp.role.trim() || avatarPrompts[sp.id]))) continue
      const url = await generateAvatar(sp)
      if (url) {
        next = next.map((x) => (x.id === sp.id ? { ...x, avatar_url: url } : x))
        onChange({ ...value, suspects: next })
      }
    }
  }

  const generateCast = async () => {
    if (!value.case_title.trim() && !value.case_brief.trim()) {
      toast({ title: t('common.error'), description: 'Scrivi almeno titolo o briefing del caso.', variant: 'destructive' })
      return
    }
    if (value.suspects.some((sp) => sp.name.trim()) && !window.confirm('Sostituire i sospettati e gli indizi attuali con quelli generati?')) return
    setGenerating(true)
    try {
      const { data } = await llmApi.generateInquirySuspects({
        case_title: value.case_title, case_brief: value.case_brief, truth: value.truth, count: genCount, language: 'it',
      })
      const prompts: Record<string, string> = {}
      const suspects: InquirySuspect[] = data.suspects.map((sp) => {
        prompts[sp.id] = sp.avatar_prompt
        const { avatar_prompt: _ignored, ...rest } = sp
        return rest
      })
      setAvatarPrompts(prompts)
      onChange({
        ...value,
        suspects,
        clues: data.clues,
        correct_answer: data.correct_answer || value.correct_answer,
        truth: value.truth.trim() ? value.truth : (data.truth || value.truth),
        final_question: value.final_question || 'Chi è il colpevole e perché?',
        min_clues: Math.min(Math.max(value.min_clues, 3), Math.max(1, data.clues.length)),
      })
      toast({ title: 'Cast generato', description: 'Rivedi i sospettati e gli indizi, poi genera gli avatar.' })
    } catch (e: any) {
      toast({ title: t('common.error'), description: e?.response?.data?.detail || 'Generazione non riuscita', variant: 'destructive' })
    } finally {
      setGenerating(false)
    }
  }

  const updateClue = (idx: number, patch: Partial<InquiryClue>) =>
    set('clues', value.clues.map((c, i) => (i === idx ? { ...c, ...patch } : c)))
  const addClue = () => {
    const used = new Set(value.clues.map((c) => c.id))
    let n = value.clues.length + 1
    while (used.has(`c${n}`)) n += 1
    set('clues', [...value.clues, { id: `c${n}`, text: '', tier: 1, unlock_hint: '', suspect_id: null }])
  }

  return (
    <div className="mb-4 space-y-4 rounded-xl border border-slate-200 bg-slate-50/60 p-4">
      <p className="text-xs leading-5 text-slate-500">
        {t('teacherbot.inquiry_intro', "L'NPC conosce la verità ma non vuole svelarla. Lo studente lo interroga a voce: solo le domande giuste sbloccano gli indizi. Dopo almeno il numero minimo di indizi, lo studente risponde alla domanda finale.")}
      </p>

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <Label>{t('teacherbot.inquiry_case_title', 'Titolo del caso')}</Label>
          <input className={inputCls} value={value.case_title} maxLength={200} onChange={(e) => set('case_title', e.target.value)} placeholder="es. Il furto della Gioconda" />
        </div>
        <div>
          <Label>{t('teacherbot.inquiry_min_clues', 'Indizi minimi per rispondere')}</Label>
          <input type="number" min={1} max={10} className={inputCls} value={value.min_clues} onChange={(e) => set('min_clues', Math.max(1, Math.min(10, Number(e.target.value) || 1)))} />
        </div>
      </div>
      <div>
        <Label>{t('teacherbot.inquiry_case_brief', 'Briefing per lo studente (visibile)')}</Label>
        <textarea className={`${inputCls} min-h-[60px]`} value={value.case_brief} maxLength={2000} onChange={(e) => set('case_brief', e.target.value)} placeholder="Cosa sa lo studente prima di iniziare l'interrogatorio." />
      </div>
      <div>
        <Label>{t('teacherbot.inquiry_truth', 'La verità completa (segreta)')}</Label>
        <textarea className={`${inputCls} min-h-[100px]`} value={value.truth} maxLength={6000} onChange={(e) => set('truth', e.target.value)} placeholder="Tutto ciò che l'NPC sa: chi, come, perché, cronologia… Non viene mai mostrato allo studente." />
      </div>

      {/* Cast */}
      <div>
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <Label>{t('teacherbot.inquiry_cast', 'Sospettati / interlocutori')}</Label>
          <div className="flex flex-wrap items-center gap-2">
            <select className="rounded-full border border-slate-200 bg-white px-2 py-1 text-xs font-semibold text-slate-700" value={genCount} onChange={(e) => setGenCount(Number(e.target.value))} title="Quanti sospettati generare">
              {[2, 3, 4, 5, 6].map((n) => <option key={n} value={n}>{n} sospettati</option>)}
            </select>
            <button type="button" onClick={generateCast} disabled={generating} className="inline-flex items-center gap-1 rounded-full bg-slate-900 px-3 py-1 text-xs font-bold text-white disabled:opacity-50">
              {generating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
              {generating ? 'Generazione…' : 'Genera con AI'}
            </button>
            <button type="button" onClick={generateAllAvatars} disabled={avatarBusy !== null} className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-bold text-slate-700 hover:bg-slate-100 disabled:opacity-50">
              <ImageIcon className="h-3.5 w-3.5" /> Avatar per tutti
            </button>
            <button type="button" onClick={addSuspect} disabled={value.suspects.length >= 8} className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-bold text-slate-700 hover:bg-slate-100 disabled:opacity-50">
              <Plus className="h-3.5 w-3.5" /> {t('teacherbot.inquiry_add_suspect', 'Aggiungi')}
            </button>
          </div>
        </div>
        <p className="mb-2 text-[11px] leading-4 text-slate-400">
          {multi
            ? 'Lo studente sceglie chi interrogare e alla fine accusa un sospettato. Ogni NPC conosce solo ciò che scrivi qui, non la soluzione completa.'
            : 'Con un solo NPC l\'intervista è diretta. Aggiungi altri sospettati per creare un caso a più voci.'}
        </p>
        <div className="space-y-3">
          {value.suspects.map((sp) => (
            <div key={sp.id} className={`rounded-lg border bg-white p-3 ${sp.is_culprit && multi ? 'border-rose-300' : 'border-slate-200'}`}>
              <div className="flex gap-3">
                <div className="flex shrink-0 flex-col items-center gap-1.5">
                  <span className="flex h-16 w-16 items-center justify-center overflow-hidden rounded-full bg-violet-700 text-xl font-black text-white ring-2 ring-white">
                    {sp.avatar_url ? <img src={sp.avatar_url} alt={sp.name} className="h-full w-full object-cover" /> : (sp.name.trim().slice(0, 1).toUpperCase() || '?')}
                  </span>
                  <button type="button" onClick={() => generateOneAvatar(sp)} disabled={avatarBusy !== null || !sp.name.trim()} className="inline-flex items-center gap-1 text-[10px] font-extrabold text-violet-700 disabled:opacity-40">
                    {avatarBusy === sp.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <ImageIcon className="h-3 w-3" />}
                    {sp.avatar_url ? 'Rigenera' : 'Avatar'}
                  </button>
                </div>
                <div className="min-w-0 flex-1 space-y-2">
                  <div className="grid gap-2 sm:grid-cols-2">
                    <input className={inputCls} value={sp.name} maxLength={80} onChange={(e) => updateSuspect(sp.id, { name: e.target.value })} placeholder="Nome (es. Dott. Bellandi)" />
                    <input className={inputCls} value={sp.role} maxLength={200} onChange={(e) => updateSuspect(sp.id, { role: e.target.value })} placeholder="Ruolo (es. custode del museo)" />
                  </div>
                  <textarea className={`${inputCls} min-h-[48px]`} value={sp.personality} maxLength={800} onChange={(e) => updateSuspect(sp.id, { personality: e.target.value })} placeholder="Personalità e modo di parlare: elegante, sospettoso, ama le digressioni…" />
                  <textarea className={`${inputCls} min-h-[72px]`} value={sp.knowledge} maxLength={3000} onChange={(e) => updateSuspect(sp.id, { knowledge: e.target.value })} placeholder={multi ? 'Cosa sa, cosa nasconde, che alibi o bugia racconta (segreto)' : 'Cosa sa in più della verità generale (facoltativo)'} />
                  <div className="flex flex-wrap items-center gap-3">
                    <select className="rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs font-semibold text-slate-700" value={sp.voice || ''} onChange={(e) => updateSuspect(sp.id, { voice: e.target.value || null })} title="Voce dell'NPC">
                      <option value="">Voce: scelta dallo studente</option>
                      {VOICES.map((v) => <option key={v} value={v}>Voce: {v}</option>)}
                    </select>
                    {multi && (
                      <label className="inline-flex cursor-pointer items-center gap-1.5 text-xs font-bold text-slate-700">
                        <input type="radio" name="inquiry-culprit" checked={sp.is_culprit} onChange={() => setCulprit(sp.id)} />
                        <Crosshair className="h-3.5 w-3.5 text-rose-500" /> È il colpevole
                      </label>
                    )}
                    <button type="button" onClick={() => removeSuspect(sp.id)} disabled={value.suspects.length <= 1} className="ml-auto rounded-lg p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600 disabled:opacity-30" aria-label="Rimuovi sospettato">
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <Label>{t('teacherbot.inquiry_final_question', 'Domanda finale')}</Label>
          <input className={inputCls} value={value.final_question} maxLength={400} onChange={(e) => set('final_question', e.target.value)} placeholder={multi ? 'Facoltativo — default: Chi è il colpevole e perché?' : "es. Chi è stato l'assassino?"} />
        </div>
        <div>
          <Label>{multi ? t('teacherbot.inquiry_correct_motive', 'Soluzione (movente e prove)') : t('teacherbot.inquiry_correct_answer', 'Risposta corretta')}</Label>
          <input className={inputCls} value={value.correct_answer} maxLength={1200} onChange={(e) => set('correct_answer', e.target.value)} placeholder={multi ? 'es. Il giardiniere, per vendetta: ha lasciato le impronte nel garage' : 'es. Il giardiniere, per vendetta'} />
        </div>
      </div>

      {/* Clues */}
      <div>
        <div className="mb-2 flex items-center justify-between">
          <Label>{t('teacherbot.inquiry_clues', 'Indizi')}</Label>
          <button type="button" onClick={addClue} className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-bold text-slate-700 hover:bg-slate-100">
            <Plus className="h-3.5 w-3.5" /> {t('teacherbot.inquiry_add_clue', 'Aggiungi')}
          </button>
        </div>
        {value.clues.length === 0 && <p className="text-xs text-slate-400">{t('teacherbot.inquiry_no_clues', 'Aggiungi almeno un indizio.')}</p>}
        <div className="space-y-2">
          {value.clues.map((clue, idx) => (
            <div key={idx} className="rounded-lg border border-slate-200 bg-white p-3">
              <div className="flex items-start gap-2">
                <textarea className={`${inputCls} min-h-[48px] flex-1`} value={clue.text} maxLength={1000} onChange={(e) => updateClue(idx, { text: e.target.value })} placeholder="Cosa lascia trapelare l'NPC quando lo sblocca" />
                {multi && (
                  <select className="rounded-lg border border-slate-200 bg-white px-2 py-2 text-xs font-semibold text-slate-700" value={clue.suspect_id || ''} onChange={(e) => updateClue(idx, { suspect_id: e.target.value || null })} title="Chi può dare questo indizio">
                    <option value="">Chiunque</option>
                    {value.suspects.map((sp) => <option key={sp.id} value={sp.id}>{sp.name || sp.id}</option>)}
                  </select>
                )}
                <select className="rounded-lg border border-slate-200 bg-white px-2 py-2 text-xs font-semibold text-slate-700" value={clue.tier} onChange={(e) => updateClue(idx, { tier: Number(e.target.value) as 1 | 2 | 3 })} title="Livello di segretezza">
                  <option value={1}>Livello 1 · facile</option>
                  <option value={2}>Livello 2 · fiducia/pressione</option>
                  <option value={3}>Livello 3 · tardivo</option>
                </select>
                <button type="button" onClick={() => set('clues', value.clues.filter((_, i) => i !== idx))} className="rounded-lg p-2 text-slate-400 hover:bg-rose-50 hover:text-rose-600" aria-label="Rimuovi indizio">
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
              <input className={`${inputCls} mt-2`} value={clue.unlock_hint} maxLength={400} onChange={(e) => updateClue(idx, { unlock_hint: e.target.value })} placeholder="Che tipo di domanda lo guadagna? (es. chiedere dove si trovava alle 22)" />
            </div>
          ))}
        </div>
      </div>

      {/* Flag tuning */}
      <div>
        <Label>{t('teacherbot.inquiry_flags', 'Teatralità (intensità dei flag)')}</Label>
        <div className="grid gap-2 sm:grid-cols-2">
          {INQUIRY_FLAGS.map((flag) => (
            <div key={flag} className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white px-3 py-2">
              <span className="text-sm font-semibold text-slate-700">{FLAG_LABEL[flag]}</span>
              <div className="flex items-center gap-2">
                <input type="range" min={0} max={3} step={1} value={value.flag_intensity[flag] ?? 2} onChange={(e) => set('flag_intensity', { ...value.flag_intensity, [flag]: Number(e.target.value) })} className="w-24" />
                <span className="w-14 text-right text-xs font-bold text-slate-500">{INTENSITY_LABEL[value.flag_intensity[flag] ?? 2]}</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {teacherbotId && <InquirySessionsReview teacherbotId={teacherbotId} />}
    </div>
  )
}

function InquirySessionsReview({ teacherbotId }: { teacherbotId: string }) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [expanded, setExpanded] = useState<string | null>(null)
  const { data, isLoading } = useQuery({
    queryKey: ['inquiry-sessions', teacherbotId],
    queryFn: async () => (await llmApi.listInquirySessions(teacherbotId)).data,
    enabled: open,
  })

  return (
    <div className="rounded-lg border border-slate-200 bg-white">
      <button type="button" onClick={() => setOpen(!open)} className="flex w-full items-center justify-between px-3 py-2 text-sm font-bold text-slate-700">
        {t('teacherbot.inquiry_sessions', 'Interviste svolte e trascrizioni')}
        {open ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
      </button>
      {open && (
        <div className="space-y-2 border-t border-slate-100 p-3">
          {isLoading && <p className="text-xs text-slate-400">…</p>}
          {data?.length === 0 && <p className="text-xs text-slate-400">{t('teacherbot.inquiry_no_sessions', 'Nessuna intervista ancora.')}</p>}
          {data?.map((s) => (
            <div key={s.id} className="rounded-lg border border-slate-100 p-2">
              <button type="button" onClick={() => setExpanded(expanded === s.id ? null : s.id)} className="flex w-full items-center justify-between text-left text-xs">
                <span className="font-semibold text-slate-700">
                  {s.is_test ? 'Test docente' : s.student || 'Studente'} · {s.status} · {s.clues_found} indizi · {s.attempts} tentativi
                  {s.verdict ? ` · ${s.verdict.score}/100` : ''}
                </span>
                <span className="text-slate-400">{s.created_at ? new Date(s.created_at).toLocaleString() : ''}</span>
              </button>
              {expanded === s.id && (
                <div className="mt-2 space-y-1 text-xs">
                  {s.final_answer && <p className="rounded bg-slate-50 p-2"><b>Risposta finale:</b> {s.final_answer}</p>}
                  {s.transcript.map((turn, i) => (
                    <p key={i} className={turn.role === 'user' ? 'text-slate-700' : 'text-indigo-700'}>
                      <b>{turn.role === 'user' ? 'Studente' : 'NPC'}</b>
                      {turn.flag ? ` [${turn.flag}]` : ''}: {turn.text}
                    </p>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
