import { useState, useMemo } from 'react'
import { ChevronLeft, ChevronRight, Plus, X, Trash2, Pencil, Clock } from 'lucide-react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { calendarApi } from '@/lib/api'

interface CalendarEvent {
  id: string
  session_id: string
  title: string
  description?: string
  event_date: string  // YYYY-MM-DD
  event_time?: string // HH:MM:SS
  color: string
  created_by_teacher_id?: string
}

interface WeeklyCalendarConfig {
  session_id?: string
  session_name?: string
}

const DAY_LABELS = ['Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab', 'Dom']
const EVENT_COLORS = ['#6366f1', '#0ea5e9', '#10b981', '#f59e0b', '#ef4444', '#ec4899', '#8b5cf6']

function getMonday(d: Date): Date {
  const date = new Date(d)
  const day = date.getDay()
  const diff = (day === 0 ? -6 : 1) - day
  date.setDate(date.getDate() + diff)
  date.setHours(0, 0, 0, 0)
  return date
}

function addDays(d: Date, n: number): Date {
  const r = new Date(d)
  r.setDate(r.getDate() + n)
  return r
}

function toYMD(d: Date): string {
  return d.toISOString().slice(0, 10)
}

function formatDayLabel(d: Date): string {
  return d.toLocaleDateString('it-IT', { day: 'numeric', month: 'short' })
}

function formatHeader(monday: Date): string {
  const sunday = addDays(monday, 6)
  return `${formatDayLabel(monday)} – ${formatDayLabel(sunday)} ${sunday.getFullYear()}`
}

/** "HH:MM:SS" or "HH:MM" → "HH:MM" */
function fmtTime(t?: string): string {
  if (!t) return ''
  return t.slice(0, 5)
}

type FormMode = { type: 'add'; date: string } | { type: 'edit'; event: CalendarEvent } | null
type DetailEvent = CalendarEvent | null

export default function WeeklyCalendarWidget({
  config,
  userType = 'student',
}: {
  config: WeeklyCalendarConfig
  userType?: 'teacher' | 'student'
}) {
  const qc = useQueryClient()
  const sessionId = config.session_id

  const [weekOffset, setWeekOffset] = useState(0)
  const [formMode, setFormMode] = useState<FormMode>(null)
  const [formTitle, setFormTitle] = useState('')
  const [formDesc, setFormDesc] = useState('')
  const [formTime, setFormTime] = useState('')
  const [formColor, setFormColor] = useState(EVENT_COLORS[0])
  const [detailEvent, setDetailEvent] = useState<DetailEvent>(null)

  const monday = useMemo(() => {
    const m = getMonday(new Date())
    m.setDate(m.getDate() + weekOffset * 7)
    return m
  }, [weekOffset])

  const fromDate = toYMD(monday)
  const toDate = toYMD(addDays(monday, 6))

  const { data: events = [] } = useQuery<CalendarEvent[]>({
    queryKey: ['calendar', sessionId, fromDate, toDate],
    queryFn: async () => {
      if (!sessionId) return []
      const res = await calendarApi.listEvents(sessionId, fromDate, toDate)
      return res.data
    },
    enabled: !!sessionId,
    staleTime: 30_000,
    refetchInterval: 60_000,
  })

  const invalidate = () => qc.invalidateQueries({ queryKey: ['calendar', sessionId] })

  const createEvent = useMutation({
    mutationFn: (data: { title: string; description?: string; event_date: string; event_time?: string; color: string }) =>
      calendarApi.createEvent(sessionId!, data),
    onSuccess: invalidate,
  })

  const updateEvent = useMutation({
    mutationFn: ({ id, data }: { id: string; data: { title?: string; description?: string; event_time?: string | null; color?: string } }) =>
      calendarApi.updateEvent(sessionId!, id, data),
    onSuccess: invalidate,
  })

  const deleteEvent = useMutation({
    mutationFn: (id: string) => calendarApi.deleteEvent(sessionId!, id),
    onSuccess: invalidate,
  })

  const openAdd = (dateStr: string) => {
    setFormMode({ type: 'add', date: dateStr })
    setFormTitle('')
    setFormDesc('')
    setFormTime('')
    setFormColor(EVENT_COLORS[0])
  }

  const openEdit = (event: CalendarEvent) => {
    setFormMode({ type: 'edit', event })
    setFormTitle(event.title)
    setFormDesc(event.description ?? '')
    setFormTime(fmtTime(event.event_time))
    setFormColor(event.color)
  }

  const closeForm = () => setFormMode(null)

  const submitForm = () => {
    if (!formTitle.trim()) return
    const timeVal = formTime || undefined
    if (formMode?.type === 'edit') {
      updateEvent.mutate({
        id: formMode.event.id,
        data: {
          title: formTitle.trim(),
          description: formDesc || undefined,
          event_time: timeVal ?? null,
          color: formColor,
        },
      })
    } else if (formMode?.type === 'add') {
      createEvent.mutate({
        title: formTitle.trim(),
        description: formDesc || undefined,
        event_date: formMode.date,
        event_time: timeVal,
        color: formColor,
      })
    }
    closeForm()
  }

  if (!sessionId) {
    return (
      <div className="h-full flex items-center justify-center text-[13px] text-white/30 text-center p-4">
        Nessuna sessione collegata.<br />Aggiungi dal pannello sessione attiva.
      </div>
    )
  }

  const today = toYMD(new Date())
  const formDateLabel = formMode?.type === 'add'
    ? formatDayLabel(new Date(formMode.date + 'T12:00:00'))
    : formMode?.type === 'edit'
    ? formatDayLabel(new Date(formMode.event.event_date + 'T12:00:00'))
    : ''

  return (
    <div className="h-full flex flex-col overflow-hidden select-none text-white relative">
      {/* Header */}
      <div className="flex items-center justify-between px-3 pt-2 pb-1 flex-shrink-0">
        <button
          className="w-6 h-6 rounded-lg bg-white/5 hover:bg-white/15 flex items-center justify-center transition-colors"
          onClick={() => setWeekOffset(w => w - 1)}
        >
          <ChevronLeft className="h-3.5 w-3.5 text-white/60" />
        </button>
        <div className="flex flex-col items-center">
          <div className="text-[12px] font-semibold text-white/50">{formatHeader(monday)}</div>
          {config.session_name && (
            <div className="text-[11px] text-white/20 uppercase tracking-wider">{config.session_name}</div>
          )}
        </div>
        <div className="flex items-center gap-1">
          {weekOffset !== 0 && (
            <button
              className="text-[11px] text-white/40 hover:text-white/70 px-1 transition-colors"
              onClick={() => setWeekOffset(0)}
            >
              oggi
            </button>
          )}
          <button
            className="w-6 h-6 rounded-lg bg-white/5 hover:bg-white/15 flex items-center justify-center transition-colors"
            onClick={() => setWeekOffset(w => w + 1)}
          >
            <ChevronRight className="h-3.5 w-3.5 text-white/60" />
          </button>
        </div>
      </div>

      {/* Grid */}
      <div className="flex-1 grid grid-cols-7 gap-px px-2 pb-2 overflow-hidden">
        {Array.from({ length: 7 }, (_, i) => {
          const day = addDays(monday, i)
          const ymd = toYMD(day)
          const isToday = ymd === today
          const dayEvents = events.filter(e => e.event_date === ymd)

          return (
            <div
              key={i}
              className={`flex flex-col rounded-xl ${isToday ? 'ring-1 ring-white/20' : ''}`}
              style={{ background: isToday ? 'rgba(255,255,255,0.07)' : 'rgba(255,255,255,0.03)' }}
            >
              {/* Day header */}
              <div className={`flex items-center justify-between px-1.5 py-1 rounded-t-xl ${isToday ? 'bg-white/10' : ''}`}>
                <div className="flex flex-col items-center min-w-0">
                  <span className="text-[10px] text-white/30 uppercase">{DAY_LABELS[i]}</span>
                  <span className={`text-[13px] font-bold leading-none ${isToday ? 'text-white' : 'text-white/50'}`}>
                    {day.getDate()}
                  </span>
                </div>
                {userType === 'teacher' && (
                  <button
                    className="w-5 h-5 rounded flex items-center justify-center bg-white/0 hover:bg-white/20 transition-all opacity-50 hover:opacity-100"
                    onClick={() => openAdd(ymd)}
                    title={`Aggiungi evento ${formatDayLabel(day)}`}
                  >
                    <Plus className="h-3 w-3 text-white" />
                  </button>
                )}
              </div>

              {/* Events */}
              <div className="flex-1 overflow-y-auto px-1 pb-1 space-y-0.5 min-h-0">
                {dayEvents.map(ev => (
                  <button
                    key={ev.id}
                    className="w-full text-left"
                    onClick={() => userType === 'teacher' ? openEdit(ev) : setDetailEvent(ev)}
                    title={ev.title + (ev.description ? `\n${ev.description}` : '')}
                  >
                    <div
                      className="px-1.5 py-0.5 rounded text-[11px] font-medium leading-tight truncate transition-opacity hover:opacity-80"
                      style={{ backgroundColor: ev.color + '33', color: ev.color, border: `1px solid ${ev.color}55` }}
                    >
                      {fmtTime(ev.event_time) && (
                        <span className="opacity-70 mr-0.5">{fmtTime(ev.event_time)}</span>
                      )}
                      {ev.title}
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )
        })}
      </div>

      {/* Teacher: Add / Edit bottom sheet */}
      {formMode && (
        <div
          className="absolute inset-0 bg-black/60 backdrop-blur-sm z-10 flex items-end p-3"
          onClick={closeForm}
        >
          <div
            className="w-full bg-[#1a1a2e] border border-white/15 rounded-2xl p-4 space-y-3"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-white/70">
                {formMode.type === 'add' ? `Nuovo evento — ${formDateLabel}` : `Modifica — ${formDateLabel}`}
              </span>
              <button onClick={closeForm}><X className="h-3.5 w-3.5 text-white/40" /></button>
            </div>
            <input
              autoFocus
              value={formTitle}
              onChange={e => setFormTitle(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') submitForm(); if (e.key === 'Escape') closeForm() }}
              className="w-full bg-white/10 border border-white/20 rounded-lg px-2.5 py-1.5 text-xs text-white placeholder-white/30 outline-none focus:border-white/40"
              placeholder="Titolo evento"
            />
            <div className="flex gap-2">
              <input
                value={formDesc}
                onChange={e => setFormDesc(e.target.value)}
                className="flex-1 bg-white/10 border border-white/20 rounded-lg px-2.5 py-1.5 text-xs text-white placeholder-white/30 outline-none"
                placeholder="Descrizione (opzionale)"
              />
              <div className="relative flex items-center">
                <Clock className="h-3 w-3 text-white/40 absolute left-2 pointer-events-none" />
                <input
                  type="time"
                  value={formTime}
                  onChange={e => setFormTime(e.target.value)}
                  className="bg-white/10 border border-white/20 rounded-lg pl-6 pr-2 py-1.5 text-xs text-white outline-none focus:border-white/40 w-[90px]"
                />
              </div>
            </div>
            <div className="flex gap-1.5">
              {EVENT_COLORS.map(c => (
                <button
                  key={c}
                  className="w-5 h-5 rounded-full transition-transform hover:scale-110 flex-shrink-0"
                  style={{ background: c, outline: formColor === c ? '2px solid white' : 'none', outlineOffset: '1px' }}
                  onClick={() => setFormColor(c)}
                />
              ))}
            </div>
            <div className="flex gap-2 pt-1">
              {formMode.type === 'edit' && (
                <button
                  onClick={() => { deleteEvent.mutate(formMode.event.id); closeForm() }}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-500/20 text-red-400 text-xs hover:bg-red-500/30 transition-colors"
                >
                  <Trash2 className="h-3 w-3" />Elimina
                </button>
              )}
              <button
                onClick={submitForm}
                disabled={!formTitle.trim()}
                className="flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/10 text-white/80 text-xs hover:bg-white/20 transition-colors disabled:opacity-40"
              >
                {formMode.type === 'add' ? <><Plus className="h-3 w-3" />Aggiungi</> : <><Pencil className="h-3 w-3" />Salva</>}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Student: Event detail bottom sheet */}
      {detailEvent && (
        <div
          className="absolute inset-0 bg-black/60 backdrop-blur-sm z-10 flex items-end p-3"
          onClick={() => setDetailEvent(null)}
        >
          <div
            className="w-full bg-[#1a1a2e] border border-white/15 rounded-2xl p-4 space-y-2"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <span
                  className="w-2.5 h-2.5 rounded-full flex-shrink-0 mt-0.5"
                  style={{ backgroundColor: detailEvent.color }}
                />
                <span className="text-sm font-semibold text-white leading-tight">{detailEvent.title}</span>
              </div>
              <button onClick={() => setDetailEvent(null)} className="flex-shrink-0">
                <X className="h-3.5 w-3.5 text-white/40" />
              </button>
            </div>
            <div className="flex items-center gap-3 text-[13px] text-white/40 pl-4">
              <span>{formatDayLabel(new Date(detailEvent.event_date + 'T12:00:00'))}</span>
              {fmtTime(detailEvent.event_time) && (
                <>
                  <span>·</span>
                  <span className="flex items-center gap-1">
                    <Clock className="h-2.5 w-2.5" />
                    {fmtTime(detailEvent.event_time)}
                  </span>
                </>
              )}
            </div>
            {detailEvent.description && (
              <p className="text-xs text-white/60 pl-4 leading-relaxed">{detailEvent.description}</p>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
