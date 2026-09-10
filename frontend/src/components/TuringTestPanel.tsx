import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { Socket } from 'socket.io-client'
import { BarChart3, Bot, BrainCircuit, Check, HelpCircle, Loader2, RefreshCw, Send, Sparkles, Square, User, X } from 'lucide-react'

import { turingApi } from '@/lib/api'

type ExperimentStatus = 'LOBBY' | 'ACTIVE' | 'COMPLETED' | 'CANCELLED'
type ParticipantStatus = 'INVITED' | 'DELIVERED' | 'READY' | 'ACTIVE' | 'COMPLETED' | 'EXCLUDED'
type Role = 'SELF' | 'INTERLOCUTOR' | 'STUDENT' | 'TEACHER' | 'AI'

interface Message { id: string; role: Role; text: string; created_at: string }
interface Settings { persona_prompt: string; temperature: number; confidence_style: number; response_length: number; emoji_usage: number }
interface ExperimentInfo extends Settings { id: string; session_id?: string; title: string; status: ExperimentStatus; max_questions: number; participant_count?: number; started_at?: string | null; completed_at?: string | null }
interface Participant {
  id: string; student_id: string; nickname: string; status: ParticipantStatus; online: boolean
  question_count: number; has_guessed?: boolean; guess?: 'HUMAN' | 'AI' | null
  confidence?: number | null; rationale?: string | null; actual_role?: 'HUMAN' | 'AI' | null; messages: Message[]
}
interface TeacherState {
  active?: boolean; experiment: ExperimentInfo; human_participant?: Participant | null; participants: Participant[]
  report?: { total_participants: number; completed_participants: number; accuracy: number; human_recognized: boolean; false_human_guesses: number; average_confidence: number; confusion_matrix: { human_guessed_human: number; human_guessed_ai: number; ai_guessed_human: number; ai_guessed_ai: number } } | null
}
interface StudentState {
  active?: boolean; experiment: Omit<ExperimentInfo, keyof Settings> & Partial<Settings>
  participant: { id: string; status: ParticipantStatus; question_count: number; guess?: 'HUMAN' | 'AI' | null; confidence?: number | null; rationale?: string | null; actual_role?: 'HUMAN' | 'AI' | null; messages: Message[] }
}
interface Props { sessionId: string; userType: 'teacher' | 'student'; socket: Socket | null; onlineStudentCount: number; floatingTrigger?: boolean }

const DEFAULT_SETTINGS: Settings = {
  persona_prompt: 'Rispondo con tono cordiale, diretto e incoraggiante. Preferisco frasi chiare e non troppo lunghe. Insegno valorizzando il ragionamento e faccio esempi concreti.',
  temperature: 0.7, confidence_style: 3, response_length: 2, emoji_usage: 1,
}

function apiError(error: unknown): string {
  return (error as { response?: { data?: { detail?: string } } })?.response?.data?.detail || 'Operazione non riuscita. Riprova.'
}

export default function TuringTestPanel({ sessionId, userType, socket, onlineStudentCount, floatingTrigger = false }: Props) {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [typing, setTyping] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [teacherState, setTeacherState] = useState<TeacherState | null>(null)
  const [studentState, setStudentState] = useState<StudentState | null>(null)
  const [title, setTitle] = useState('Test di Turing')
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS)
  const [detectedStudentCount, setDetectedStudentCount] = useState(onlineStudentCount)
  const [selectedParticipantId, setSelectedParticipantId] = useState<string | null>(null)
  const [message, setMessage] = useState('')
  const [guess, setGuess] = useState<'HUMAN' | 'AI' | null>(null)
  const [confidence, setConfidence] = useState(3)
  const [rationale, setRationale] = useState('')
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const deliveredRef = useRef<string | null>(null)
  const studentAutoOpenedRef = useRef<string | null>(null)
  const experimentId = teacherState?.experiment.id || studentState?.experiment.id
  const status = teacherState?.experiment.status || studentState?.experiment.status
  const isRunning = status === 'LOBBY' || status === 'ACTIVE'

  const refresh = useCallback(async (specificId?: string) => {
    try {
      if (userType === 'teacher') {
        const response = specificId ? await turingApi.getTeacherExperiment(sessionId, specificId) : await turingApi.getTeacherCurrent(sessionId)
        setTeacherState(response.data?.experiment ? response.data as TeacherState : null)
      } else {
        const response = specificId ? await turingApi.getStudentExperiment(specificId) : await turingApi.getStudentCurrent()
        setStudentState(response.data?.experiment ? response.data as StudentState : null)
        const incomingId = response.data?.experiment?.id as string | undefined
        if (incomingId && response.data?.participant?.status !== 'EXCLUDED' && studentAutoOpenedRef.current !== incomingId) {
          studentAutoOpenedRef.current = incomingId
          setOpen(true)
        }
      }
    } catch (refreshError) {
      setError(apiError(refreshError))
    } finally {
      setLoading(false)
    }
  }, [sessionId, userType])

  useEffect(() => { void refresh() }, [refresh])
  useEffect(() => { setDetectedStudentCount(onlineStudentCount) }, [onlineStudentCount])
  useEffect(() => {
    if (userType !== 'teacher') return
    void turingApi.getTeacherSettings().then(response => setSettings(response.data as Settings)).catch(() => undefined)
  }, [userType])
  useEffect(() => {
    if (userType !== 'teacher' || !open || teacherState?.experiment.status === 'ACTIVE') return
    let cancelled = false
    const loadPresence = async () => {
      try {
        const response = await turingApi.getAvailableStudents(sessionId)
        if (!cancelled) setDetectedStudentCount(Number(response.data?.count || 0))
      } catch { /* the start endpoint still performs the authoritative check */ }
    }
    void loadPresence()
    const timer = window.setInterval(loadPresence, 2500)
    return () => { cancelled = true; window.clearInterval(timer) }
  }, [open, sessionId, teacherState?.experiment.status, userType])

  useEffect(() => {
    const participant = studentState?.participant
    const id = studentState?.experiment.id
    if (!id || studentState.experiment.status !== 'LOBBY' || participant?.status !== 'INVITED' || deliveredRef.current === id) return
    deliveredRef.current = id
    void turingApi.markDelivered(id).then(response => setStudentState(response.data as StudentState)).catch(() => { deliveredRef.current = null })
  }, [studentState])

  useEffect(() => {
    if (!socket) return
    const update = (payload: { experiment_id?: string; session_id?: string; type?: string }) => {
      if (payload.session_id && payload.session_id !== sessionId) return
      if (userType === 'student' && payload.type === 'INVITED') setOpen(true)
      if (payload.experiment_id) void refresh(payload.experiment_id)
    }
    const typingUpdate = (payload: { experiment_id?: string; typing?: boolean }) => {
      if (!experimentId || payload.experiment_id === experimentId) setTyping(Boolean(payload.typing))
    }
    socket.on('turing_update', update); socket.on('turing_message', update); socket.on('turing_typing', typingUpdate)
    return () => { socket.off('turing_update', update); socket.off('turing_message', update); socket.off('turing_typing', typingUpdate) }
  }, [experimentId, refresh, sessionId, socket, userType])

  useEffect(() => {
    if (!teacherState?.participants.length) return
    if (!teacherState.participants.some(item => item.id === selectedParticipantId)) {
      setSelectedParticipantId(teacherState.human_participant?.id || teacherState.participants[0].id)
    }
  }, [selectedParticipantId, teacherState])
  useEffect(() => {
    if (userType !== 'teacher' || teacherState?.experiment.status !== 'LOBBY') return
    const timer = window.setInterval(() => { void refresh(teacherState.experiment.id) }, 3000)
    return () => window.clearInterval(timer)
  }, [refresh, teacherState?.experiment.id, teacherState?.experiment.status, userType])
  useEffect(() => { if (open) messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [open, teacherState, studentState, typing])

  const selectedParticipant = useMemo(() => teacherState?.participants.find(item => item.id === selectedParticipantId) || teacherState?.human_participant || teacherState?.participants[0], [selectedParticipantId, teacherState])
  const visibleMessages = userType === 'teacher' ? selectedParticipant?.messages || [] : studentState?.participant.messages || []
  const lastRole = visibleMessages.at(-1)?.role
  const canTeacherReply = userType === 'teacher' && selectedParticipant?.actual_role === 'HUMAN' && lastRole === 'STUDENT'
  const canStudentAsk = userType === 'student' && status === 'ACTIVE' && !studentState?.participant.guess && (studentState?.participant.question_count || 0) < (studentState?.experiment.max_questions || 0) && lastRole !== 'SELF'
  const canGuess = userType === 'student' && status === 'ACTIVE' && !studentState?.participant.guess && (studentState?.participant.question_count || 0) >= (studentState?.experiment.max_questions || 1) && lastRole !== 'SELF'

  const prepare = async () => {
    setSaving(true); setError(null)
    try {
      const response = await turingApi.prepare(sessionId, { title: title.trim(), max_questions: 5, ...settings })
      setTeacherState(response.data as TeacherState)
    } catch (e) { setError(apiError(e)) } finally { setSaving(false) }
  }
  const reinvite = async () => {
    if (!experimentId) return
    setSaving(true); setError(null)
    try { setTeacherState((await turingApi.reinvite(sessionId, experimentId)).data as TeacherState) }
    catch (e) { setError(apiError(e)) } finally { setSaving(false) }
  }
  const start = async () => {
    if (!experimentId) return
    setSaving(true); setError(null)
    try { setTeacherState((await turingApi.start(sessionId, experimentId)).data as TeacherState) }
    catch (e) { setError(apiError(e)); await refresh(experimentId) } finally { setSaving(false) }
  }
  const ready = async () => {
    if (!experimentId) return
    setSaving(true); setError(null)
    try { setStudentState((await turingApi.markReady(experimentId)).data as StudentState) }
    catch (e) { setError(apiError(e)) } finally { setSaving(false) }
  }
  const sendMessage = async () => {
    const text = message.trim()
    if (!text || !experimentId) return
    setSaving(true); setError(null); setMessage('')
    try {
      if (userType === 'teacher' && selectedParticipant) await turingApi.sendTeacherMessage(sessionId, experimentId, selectedParticipant.id, text)
      else { setTyping(true); await turingApi.sendStudentMessage(experimentId, text) }
      await refresh(experimentId)
    } catch (e) { setMessage(text); setTyping(false); setError(apiError(e)) } finally { setSaving(false) }
  }
  const submitGuess = async () => {
    if (!experimentId || !guess) return
    setSaving(true); setError(null)
    try { setStudentState((await turingApi.submitGuess(experimentId, { guess, confidence, rationale: rationale.trim() || undefined })).data as StudentState) }
    catch (e) { setError(apiError(e)) } finally { setSaving(false) }
  }
  const complete = async () => {
    if (!experimentId) return
    setSaving(true); setError(null)
    try { setTeacherState((await turingApi.complete(sessionId, experimentId)).data as TeacherState) }
    catch (e) { setError(apiError(e)) } finally { setSaving(false) }
  }
  const cancel = async () => {
    if (!experimentId) return
    setSaving(true)
    try { await turingApi.cancel(sessionId, experimentId); setTeacherState(null); setStudentState(null); setOpen(false) }
    catch (e) { setError(apiError(e)) } finally { setSaving(false) }
  }

  const trigger = userType === 'teacher' || isRunning ? <button type="button" onClick={() => setOpen(true)} title="Avvia o apri il Test di Turing" className={`${floatingTrigger ? 'fixed bottom-20 right-4 z-[90] h-11 px-4 text-xs shadow-xl' : 'h-7 px-2.5 text-[10px]'} flex items-center gap-1.5 rounded-full border font-bold transition ${isRunning ? 'border-violet-300 bg-violet-100 text-violet-800' : 'border-slate-200 bg-white text-slate-600 hover:border-violet-300'}`}><BrainCircuit className="h-3.5 w-3.5" /><span className={floatingTrigger ? '' : 'hidden min-[420px]:inline'}>Test di Turing</span>{isRunning && <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />}</button> : null

  const modal = open ? createPortal(<div className="fixed inset-0 z-[200] flex items-center justify-center bg-slate-950/45 p-3 backdrop-blur-sm md:p-6">
    <div className="flex max-h-[92dvh] w-full max-w-6xl flex-col overflow-hidden rounded-[28px] border border-white/70 bg-white shadow-2xl">
      <header className="flex items-center gap-3 border-b border-slate-200 px-5 py-4"><span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-violet-100 text-violet-700"><BrainCircuit className="h-5 w-5" /></span><div className="min-w-0 flex-1"><h2 className="truncate text-base font-extrabold text-slate-900">{teacherState?.experiment.title || studentState?.experiment.title || 'Test di Turing'}</h2><p className="text-xs text-slate-500">Interlocutore umano o intelligenza artificiale?</p></div>{status === 'LOBBY' && <Badge text="Verifica disponibilità" amber />}{status === 'ACTIVE' && <Badge text="In corso" />}<button type="button" onClick={() => setOpen(false)} className="flex h-9 w-9 items-center justify-center rounded-full text-slate-500 hover:bg-slate-100" aria-label="Chiudi"><X className="h-4 w-4" /></button></header>
      {loading ? <div className="flex min-h-80 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-violet-500" /></div>
        : userType === 'teacher' && !teacherState ? <Setup title={title} setTitle={setTitle} settings={settings} setSettings={setSettings} online={detectedStudentCount} saving={saving} prepare={prepare} />
        : userType === 'teacher' && status === 'LOBBY' && teacherState ? <TeacherLobby state={teacherState} saving={saving} reinvite={reinvite} start={start} cancel={cancel} />
        : userType === 'student' && status === 'LOBBY' && studentState ? <StudentLobby state={studentState} saving={saving} ready={ready} />
        : userType === 'teacher' && status === 'COMPLETED' && teacherState ? <TeacherReport state={teacherState} onNew={() => { setTeacherState(null); setError(null) }} />
        : userType === 'student' && status === 'COMPLETED' && studentState ? <StudentResult state={studentState} />
        : status === 'CANCELLED' || studentState?.participant.status === 'EXCLUDED' ? <div className="flex min-h-[380px] flex-col items-center justify-center p-8 text-center"><Square className="h-10 w-10 text-slate-300" /><h3 className="mt-4 text-lg font-extrabold text-slate-900">Non partecipi a questo test</h3><p className="mt-2 text-sm text-slate-500">Il test è stato annullato oppure non eri più disponibile al momento dell’avvio.</p></div>
        : <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
          <section className="flex min-h-[460px] min-w-0 flex-1 flex-col">
            {userType === 'student' && visibleMessages.length === 0 && <div className="border-b border-violet-100 bg-violet-50 px-5 py-4 text-xs leading-relaxed text-violet-900"><strong>Test avviato.</strong> Puoi porre 5 domande, una alla volta, poi dovrai indicare se dall’altra parte c’era una persona o un’AI.</div>}
            {userType === 'teacher' && selectedParticipant && <div className="flex items-center gap-3 border-b border-slate-100 px-5 py-3"><Avatar name={selectedParticipant.nickname} /><div className="min-w-0 flex-1"><p className="truncate text-sm font-bold text-slate-800">{selectedParticipant.nickname}</p><p className="text-[11px] text-slate-400">{selectedParticipant.actual_role === 'HUMAN' ? 'Conversazione con il docente' : 'Conversazione gestita dal chatbot · sola lettura'}</p></div><Badge text={selectedParticipant.actual_role === 'HUMAN' ? 'Umano' : 'AI'} /></div>}
            <div className="flex-1 space-y-3 overflow-y-auto bg-slate-50/70 p-5">{visibleMessages.length === 0 && <EmptyChat text={userType === 'teacher' ? 'Questa conversazione non contiene ancora messaggi.' : 'Scrivi la prima domanda per iniziare.'} />}{visibleMessages.map(item => { const mine = userType === 'teacher' ? item.role === 'TEACHER' || item.role === 'AI' : item.role === 'SELF'; return <div key={item.id} className={`flex ${mine ? 'justify-end' : 'justify-start'}`}><div className={`max-w-[82%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${mine ? item.role === 'AI' ? 'bg-violet-700 text-white' : 'bg-slate-900 text-white' : 'border border-slate-200 bg-white text-slate-800 shadow-sm'}`}>{item.text}</div></div> })}{typing && <div className="text-xs font-semibold text-slate-400">L’interlocutore sta scrivendo…</div>}<div ref={messagesEndRef} /></div>
            {canGuess ? <div className="space-y-3 border-t border-slate-200 bg-white p-4"><p className="text-sm font-extrabold">Chi pensi ci sia dall’altra parte?</p><div className="grid grid-cols-2 gap-2"><GuessButton selected={guess === 'HUMAN'} onClick={() => setGuess('HUMAN')} icon={User} label="Una persona" /><GuessButton selected={guess === 'AI'} onClick={() => setGuess('AI')} icon={Bot} label="Un’AI" /></div><label className="block text-xs font-bold text-slate-600">Sicurezza: {confidence}/5<input type="range" min={1} max={5} value={confidence} onChange={e => setConfidence(Number(e.target.value))} className="mt-1 block w-full accent-violet-600" /></label><textarea value={rationale} onChange={e => setRationale(e.target.value)} placeholder="Cosa ti ha convinto? (facoltativo)" rows={2} className="w-full resize-none rounded-xl border border-slate-200 p-3 text-xs" /><button type="button" disabled={!guess || saving} onClick={submitGuess} className="h-11 w-full rounded-xl bg-violet-700 text-sm font-bold text-white disabled:opacity-40">Conferma valutazione</button></div>
              : studentState?.participant.guess ? <div className="border-t border-slate-200 bg-emerald-50 p-4 text-center text-sm font-bold text-emerald-800">Valutazione registrata. Attendi la conclusione.</div>
              : <div className="flex gap-2 border-t border-slate-200 bg-white p-4"><input value={message} onChange={e => setMessage(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); void sendMessage() } }} disabled={saving || !(canTeacherReply || canStudentAsk)} placeholder={userType === 'teacher' ? (selectedParticipant?.actual_role === 'AI' ? 'Conversazione AI in sola lettura' : 'In attesa della domanda…') : 'Scrivi la tua domanda…'} className="h-11 min-w-0 flex-1 rounded-xl border border-slate-200 px-3 text-sm disabled:bg-slate-50" /><button type="button" onClick={sendMessage} disabled={!message.trim() || saving || !(canTeacherReply || canStudentAsk)} className="flex h-11 w-11 items-center justify-center rounded-xl bg-slate-900 text-white disabled:opacity-30"><Send className="h-4 w-4" /></button></div>}
          </section>
          {userType === 'teacher' && teacherState && <aside className="w-full border-t border-slate-200 bg-white p-5 lg:w-80 lg:border-l lg:border-t-0"><div className="flex items-center justify-between"><h3 className="text-sm font-extrabold">Interazioni live</h3><span className="text-xs font-bold text-violet-700">{teacherState.participants.filter(p => p.has_guessed).length}/{teacherState.participants.length}</span></div><p className="mt-1 text-[11px] text-slate-400">Seleziona uno studente per osservare la chat.</p><div className="mt-4 max-h-80 space-y-2 overflow-y-auto">{teacherState.participants.map(item => <button type="button" key={item.id} onClick={() => setSelectedParticipantId(item.id)} className={`flex w-full items-center gap-2 rounded-xl border px-3 py-2.5 text-left ${selectedParticipant?.id === item.id ? 'border-violet-300 bg-violet-50' : 'border-transparent bg-slate-50'}`}><span className={`h-2 w-2 rounded-full ${item.has_guessed ? 'bg-emerald-500' : item.messages.length ? 'bg-violet-500' : 'bg-slate-300'}`} /><span className="min-w-0 flex-1 truncate text-xs font-semibold">{item.nickname}</span><span className="text-[9px] font-black text-slate-400">{item.actual_role}</span><span className="text-[10px] text-slate-400">{item.question_count}/5</span></button>)}</div><div className="mt-5 space-y-2"><button type="button" onClick={complete} disabled={saving} className="flex h-10 w-full items-center justify-center gap-2 rounded-xl bg-violet-700 text-xs font-bold text-white"><BarChart3 className="h-4 w-4" />Concludi e mostra report</button><button type="button" onClick={cancel} disabled={saving} className="flex h-10 w-full items-center justify-center gap-2 rounded-xl border border-slate-200 text-xs font-bold text-slate-500"><Square className="h-3.5 w-3.5" />Annulla test</button></div></aside>}
        </div>}
      {error && <div className="border-t border-rose-200 bg-rose-50 px-5 py-3 text-xs font-semibold text-rose-700">{error}</div>}
    </div>
  </div>, document.body) : null
  return <>{trigger}{modal}</>
}

function Setup({ title, setTitle, settings, setSettings, online, saving, prepare }: { title: string; setTitle: (v: string) => void; settings: Settings; setSettings: (v: Settings) => void; online: number; saving: boolean; prepare: () => void }) {
  const update = <K extends keyof Settings>(key: K, value: Settings[K]) => setSettings({ ...settings, [key]: value })
  return <div className="grid min-h-0 flex-1 overflow-y-auto lg:grid-cols-[1.1fr_0.9fr]"><div className="space-y-5 p-6"><label className="block text-xs font-bold text-slate-700">Titolo<input value={title} onChange={e => setTitle(e.target.value)} className="mt-1.5 h-11 w-full rounded-xl border border-slate-200 px-3 text-sm" /></label><label className="block text-xs font-bold text-slate-700">Profilo del docente simulato<textarea value={settings.persona_prompt} onChange={e => update('persona_prompt', e.target.value)} rows={7} maxLength={4000} className="mt-1.5 w-full resize-none rounded-xl border border-slate-200 p-3 text-sm leading-relaxed" /><span className="mt-1 block text-[11px] font-normal text-slate-400">Tono, modi di dire e informazioni non sensibili. Il profilo viene salvato per i test futuri.</span></label></div><aside className="border-t border-slate-200 bg-slate-50 p-6 lg:border-l lg:border-t-0"><h3 className="text-sm font-extrabold">Comportamento simulato</h3><div className="mt-5 space-y-5"><Slider label="Temperatura" value={settings.temperature} display={settings.temperature.toFixed(1)} min={0} max={1.2} step={0.1} onChange={v => update('temperature', v)} /><Slider label="Confidenza" value={settings.confidence_style} display={`${settings.confidence_style}/5`} min={1} max={5} onChange={v => update('confidence_style', v)} /><Slider label="Lunghezza risposte" value={settings.response_length} display={`${settings.response_length}/5`} min={1} max={5} onChange={v => update('response_length', v)} /><Slider label="Uso emoticon" value={settings.emoji_usage} display={`${settings.emoji_usage}/3`} min={0} max={3} onChange={v => update('emoji_usage', v)} /></div><div className={`mt-6 rounded-2xl border p-4 ${online >= 2 ? 'border-emerald-200 bg-emerald-50' : 'border-amber-200 bg-amber-50'}`}><p className="text-2xl font-black">{online}</p><p className="text-xs font-semibold text-slate-600">studenti rilevati · minimo 2</p></div><button type="button" onClick={prepare} disabled={saving || online < 2 || settings.persona_prompt.trim().length < 20} className="mt-4 flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-[#fe004d] text-sm font-extrabold text-white disabled:opacity-40">{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}Verifica disponibilità</button></aside></div>
}

function TeacherLobby({ state, saving, reinvite, start, cancel }: { state: TeacherState; saving: boolean; reinvite: () => void; start: () => void; cancel: () => void }) {
  const ready = state.participants.filter(p => p.status === 'READY' && p.online).length
  return <div className="min-h-0 flex-1 overflow-y-auto p-6"><div className="mx-auto max-w-3xl"><h3 className="text-xl font-black text-slate-900">Chi è davvero disponibile?</h3><p className="mt-1 text-sm text-slate-500">Il test partirà solo per chi ha ricevuto il modale, ha confermato e risulta ancora connesso al momento dello start.</p><div className="mt-6 overflow-hidden rounded-2xl border border-slate-200"><div className="grid grid-cols-[1fr_auto] bg-slate-50 px-4 py-3 text-[10px] font-black uppercase tracking-wide text-slate-400"><span>Studente</span><span>Stato</span></div><div className="divide-y divide-slate-100">{state.participants.map(p => <div key={p.id} className="flex items-center gap-3 px-4 py-3"><Avatar name={p.nickname} /><span className="min-w-0 flex-1 truncate text-sm font-bold text-slate-700">{p.nickname}</span><span className={`h-2 w-2 rounded-full ${p.online ? 'bg-emerald-500' : 'bg-slate-300'}`} /><span className="w-28 text-right text-xs font-bold text-slate-500">{!p.online ? 'Disconnesso' : p.status === 'READY' ? 'Pronto' : p.status === 'DELIVERED' ? 'Modale ricevuto' : 'Invitato'}</span></div>)}</div></div><div className="mt-5 flex flex-wrap items-center gap-3"><div className="mr-auto"><p className="text-2xl font-black">{ready}</p><p className="text-xs font-semibold text-slate-500">pronti e connessi</p></div><button type="button" onClick={reinvite} disabled={saving} className="flex h-11 items-center gap-2 rounded-xl border border-slate-200 px-4 text-xs font-bold"><RefreshCw className="h-4 w-4" />Aggiorna e reinvita</button><button type="button" onClick={cancel} disabled={saving} className="h-11 rounded-xl border border-slate-200 px-4 text-xs font-bold text-slate-500">Annulla</button><button type="button" onClick={start} disabled={saving || ready < 2} className="flex h-11 items-center gap-2 rounded-xl bg-[#fe004d] px-5 text-xs font-extrabold text-white disabled:opacity-40"><Sparkles className="h-4 w-4" />Avvia con {ready} studenti</button></div></div></div>
}

function StudentLobby({ state, saving, ready }: { state: StudentState; saving: boolean; ready: () => void }) {
  const isReady = state.participant.status === 'READY'
  return <div className="flex min-h-[440px] flex-col items-center justify-center p-8 text-center"><span className="flex h-20 w-20 items-center justify-center rounded-[28px] bg-violet-100 text-violet-700"><BrainCircuit className="h-9 w-9" /></span><h3 className="mt-5 text-2xl font-black">Invito al Test di Turing</h3><p className="mt-2 max-w-lg text-sm leading-relaxed text-slate-600">Il docente sta verificando chi è disponibile. Quando il test inizierà potrai fare 5 domande a un interlocutore, senza sapere se è una persona o un’AI.</p>{isReady ? <div className="mt-6 rounded-2xl bg-emerald-50 px-6 py-4 text-sm font-bold text-emerald-800"><Check className="mr-2 inline h-4 w-4" />Sei pronto. Mantieni aperta la sessione.</div> : <button type="button" onClick={ready} disabled={saving} className="mt-6 flex h-12 items-center gap-2 rounded-2xl bg-[#fe004d] px-8 text-sm font-extrabold text-white">{saving && <Loader2 className="h-4 w-4 animate-spin" />}Sono pronto</button>}</div>
}

function Slider({ label, value, display, min, max, step = 1, onChange }: { label: string; value: number; display: string; min: number; max: number; step?: number; onChange: (v: number) => void }) { return <label className="block"><span className="flex justify-between text-xs font-bold text-slate-700"><span>{label}</span><span className="text-violet-700">{display}</span></span><input type="range" value={value} min={min} max={max} step={step} onChange={e => onChange(Number(e.target.value))} className="mt-2 block w-full accent-violet-700" /></label> }
function Badge({ text, amber = false }: { text: string; amber?: boolean }) { return <span className={`rounded-full px-2.5 py-1 text-[10px] font-bold ${amber ? 'bg-amber-50 text-amber-700' : 'bg-emerald-50 text-emerald-700'}`}>{text}</span> }
function Avatar({ name }: { name: string }) { return <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-slate-900 text-xs font-black text-white">{name.slice(0, 1).toUpperCase()}</span> }
function EmptyChat({ text }: { text: string }) { return <div className="flex h-full min-h-64 flex-col items-center justify-center text-center"><HelpCircle className="h-8 w-8 text-slate-300" /><p className="mt-3 max-w-xs text-xs text-slate-400">{text}</p></div> }
function GuessButton({ selected, onClick, icon: Icon, label }: { selected: boolean; onClick: () => void; icon: typeof User; label: string }) { return <button type="button" onClick={onClick} className={`flex h-12 items-center justify-center gap-2 rounded-xl border text-sm font-bold ${selected ? 'border-violet-400 bg-violet-100 text-violet-900' : 'border-slate-200 bg-white text-slate-600'}`}><Icon className="h-4 w-4" />{label}</button> }

function StudentResult({ state }: { state: StudentState }) { const actual = state.participant.actual_role; const correct = state.participant.guess === actual; return <div className="flex min-h-[440px] flex-col items-center justify-center p-8 text-center"><span className={`flex h-20 w-20 items-center justify-center rounded-[28px] ${correct ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>{correct ? <Check className="h-9 w-9" /> : <HelpCircle className="h-9 w-9" />}</span><h3 className="mt-5 text-2xl font-black">{correct ? 'Hai indovinato!' : 'Ti ha sorpreso!'}</h3><p className="mt-2 text-sm text-slate-600">Il tuo interlocutore era <strong>{actual === 'HUMAN' ? 'il docente' : 'un chatbot AI'}</strong>.</p></div> }
function TeacherReport({ state, onNew }: { state: TeacherState; onNew: () => void }) { const r = state.report; if (!r) return null; const m = r.confusion_matrix; return <div className="min-h-0 flex-1 overflow-y-auto p-6"><div className="mb-5 flex items-center justify-between"><div><h3 className="text-lg font-black">Report conclusivo</h3><p className="text-xs text-slate-500">I risultati rimangono disponibili dopo la chiusura.</p></div><button type="button" onClick={onNew} className="flex h-10 items-center gap-2 rounded-xl bg-[#fe004d] px-4 text-xs font-bold text-white"><Sparkles className="h-4 w-4" />Nuovo test</button></div><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"><Metric label="Accuratezza" value={`${Math.round(r.accuracy * 100)}%`} /><Metric label="Valutazioni" value={`${r.completed_participants}/${r.total_participants}`} /><Metric label="Docente riconosciuto" value={r.human_recognized ? 'Sì' : 'No'} /><Metric label="AI scambiate per umane" value={String(r.false_human_guesses)} /></div><div className="mt-6 grid gap-6 lg:grid-cols-[0.8fr_1.2fr]"><section className="rounded-2xl border border-slate-200 p-5"><h3 className="text-sm font-extrabold">Matrice di confusione</h3><div className="mt-4 grid grid-cols-2 gap-2"><Matrix label="Umano → Umano" value={m.human_guessed_human} good /><Matrix label="Umano → AI" value={m.human_guessed_ai} /><Matrix label="AI → Umano" value={m.ai_guessed_human} /><Matrix label="AI → AI" value={m.ai_guessed_ai} good /></div></section><section className="overflow-hidden rounded-2xl border border-slate-200"><div className="border-b px-4 py-3 text-sm font-extrabold">Risultati individuali</div>{state.participants.map(p => <div key={p.id} className="flex items-center gap-3 border-b border-slate-100 px-4 py-3"><Avatar name={p.nickname} /><span className="min-w-0 flex-1 truncate text-xs font-bold">{p.nickname}</span><span className="text-[10px] text-slate-400">{p.actual_role} → {p.guess || '–'}</span></div>)}</section></div></div> }
function Metric({ label, value }: { label: string; value: string }) { return <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4"><p className="text-2xl font-black">{value}</p><p className="text-xs text-slate-500">{label}</p></div> }
function Matrix({ label, value, good = false }: { label: string; value: number; good?: boolean }) { return <div className={`rounded-xl p-3 ${good ? 'bg-emerald-50' : 'bg-rose-50'}`}><p className={`text-xl font-black ${good ? 'text-emerald-700' : 'text-rose-700'}`}>{value}</p><p className="text-[10px] text-slate-500">{label}</p></div> }
