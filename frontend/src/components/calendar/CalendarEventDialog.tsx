import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Bell, Check, Clock, ExternalLink, Loader2, Trash2, Video } from '@/components/icons'
import {
  Button, Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
  Input, Select, Textarea,
} from '@/design'
import { useToast } from '@/components/ui/use-toast'
import { calendarApi, type CalendarRecurrence, type CalendarScope, type CalendarTargetType, type SharedCalendarEventInput } from '@/lib/api'
import { buildAccentNavClusterStyle } from '@/lib/navbarGlass'
import { tl } from '@/i18n/tl'
import { CalendarShareDropdown, targetKey } from './CalendarShareDropdown'
import { VoiceCallCodeTag, openVoiceCall, voiceCallsQueryKey } from '@/components/voice-calls/VoiceCallLinkCard'
import { EVENT_COLORS, RECURRENCE_LABEL, addDays, calendarQueryKey, dayKey, formatWhen, hhmm, type CalendarItem } from './calendarUtils'

type LinkedCall = { id: string; code: string; title: string; link_enabled?: boolean | null; live?: boolean }

/** A new-event slot; `voiceCall` preselects an existing call (e.g. "Programma" from the call manager). */
export type CalendarDraft = { start: Date; end: Date; allDay: boolean; title?: string; voiceCall?: LinkedCall | null }

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Existing event to view/edit, or a draft slot for a new event. */
  event?: CalendarItem | null
  draft?: CalendarDraft | null
  canCreate: boolean
  /** Session currently open in the navbar: preselected as target of new events. */
  defaultSessionId?: string
}

const combine = (day: string, time: string) => {
  const [y, m, d] = day.split('-').map(Number)
  const [hh, mm] = (time || '00:00').split(':').map(Number)
  return new Date(y, m - 1, d, hh, mm)
}

export function CalendarEventDialog({ open, onOpenChange, event, draft, canCreate, defaultSessionId }: Props) {
  const { toast } = useToast()
  const queryClient = useQueryClient()
  const editable = event ? event.can_edit : canCreate

  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [allDay, setAllDay] = useState(false)
  const [startDay, setStartDay] = useState('')
  const [startTime, setStartTime] = useState('09:00')
  const [endDay, setEndDay] = useState('')
  const [endTime, setEndTime] = useState('10:00')
  const [color, setColor] = useState(EVENT_COLORS[0])
  const [targets, setTargets] = useState<Set<string>>(new Set())
  const [repeat, setRepeat] = useState<'none' | CalendarRecurrence['freq']>('none')
  const [interval, setInterval_] = useState(1)
  const [weekdays, setWeekdays] = useState<number[]>([])
  const [until, setUntil] = useState('')
  const [scope, setScope] = useState<CalendarScope>('one')
  const [withCall, setWithCall] = useState(false)
  const existingCall: LinkedCall | null = event?.voice_call ?? draft?.voiceCall ?? null

  useEffect(() => {
    if (!open) return
    const start = event?.start ?? draft?.start ?? new Date()
    const end = event ? event.end : draft?.end ?? new Date(start.getTime() + 60 * 60 * 1000)
    setTitle(event?.title ?? draft?.title ?? '')
    setWithCall(!!(event?.voice_call ?? draft?.voiceCall))
    setDescription(event?.description ?? '')
    setAllDay(event?.all_day ?? draft?.allDay ?? false)
    setStartDay(dayKey(start))
    setStartTime(hhmm(start))
    setEndDay(dayKey(end))
    setEndTime(hhmm(end))
    setColor(event?.color ?? EVENT_COLORS[0])
    setTargets(new Set(
      event
        ? event.targets.map((t) => targetKey(t.target_type, t.target_id))
        : defaultSessionId ? [targetKey('session', defaultSessionId)] : [],
    ))
    const rule = event?.recurrence
    setRepeat(rule?.freq ?? 'none')
    setInterval_(rule?.interval ?? 1)
    setWeekdays(rule?.weekdays?.length ? rule.weekdays : [(start.getDay() + 6) % 7])
    setUntil(rule?.until ?? dayKey(addDays(start, 90)))
    setScope('one')
  }, [open, event, draft, defaultSessionId])

  const buildRecurrence = (): CalendarRecurrence | null => repeat === 'none' ? null : {
    freq: repeat,
    interval: Math.max(1, Math.min(12, interval || 1)),
    until: until || null,
    count: null,
    weekdays: repeat === 'weekly' ? [...weekdays].sort() : [],
  }
  const sameRule = (a?: CalendarRecurrence | null, b?: CalendarRecurrence | null) => {
    const norm = (r?: CalendarRecurrence | null) => r ? JSON.stringify({ f: r.freq, i: r.interval || 1, u: r.until || null, w: r.freq === 'weekly' ? [...(r.weekdays || [])].sort() : [] }) : 'none'
    return norm(a) === norm(b)
  }
  const isSeries = !!event?.series_id

  const { data: shareTargets, isLoading: targetsLoading } = useQuery({
    queryKey: ['calendar-share-targets'],
    queryFn: async () => (await calendarApi.shareTargets()).data,
    enabled: open && editable,
    staleTime: 5 * 60_000,
  })

  const buildPayload = (): SharedCalendarEventInput | null => {
    if (!title.trim() || !startDay) return null
    const start = allDay ? combine(startDay, '00:00') : combine(startDay, startTime)
    let end = allDay ? combine(endDay || startDay, '23:59') : combine(endDay || startDay, endTime)
    if (end < start) end = allDay ? combine(startDay, '23:59') : new Date(start.getTime() + 60 * 60 * 1000)
    return {
      title: title.trim(),
      description: description.trim() || null,
      starts_at: start.toISOString(),
      ends_at: end.toISOString(),
      all_day: allDay,
      color,
      targets: [...targets].map((key) => {
        const [target_type, target_id] = key.split(':') as [CalendarTargetType, string]
        return { target_type, target_id }
      }),
      recurrence: buildRecurrence(),
      ...callFields(),
    }
  }

  // Video call: keep / link the existing one, create a new one, or detach it.
  const callFields = (): Pick<SharedCalendarEventInput, 'voice_call_id' | 'with_voice_call'> => {
    const had = !!event?.voice_call
    if (withCall) {
      if (had) return {}
      return existingCall ? { voice_call_id: existingCall.id } : { with_voice_call: true }
    }
    return had ? { voice_call_id: null } : {}
  }

  const save = useMutation({
    mutationFn: async () => {
      const payload = buildPayload()
      if (!payload) throw new Error(tl("Inserisci un titolo"))
      if (!event) return calendarApi.createShared(payload)
      const { recurrence, ...rest } = payload
      // The rule is sent only when it changed: that regenerates the series from this occurrence on.
      const changedRule = !sameRule(event.recurrence, recurrence)
      return calendarApi.updateShared(event.id, changedRule ? payload : rest, changedRule && scope === 'one' ? 'following' : scope)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: calendarQueryKey })
      queryClient.invalidateQueries({ queryKey: voiceCallsQueryKey })
      toast({ title: event ? tl("Evento aggiornato") : tl("Evento creato") })
      onOpenChange(false)
    },
    onError: (error: any) => toast({ title: tl("Impossibile salvare l'evento"), description: error?.response?.data?.detail || error?.message, variant: 'destructive' }),
  })

  const remove = useMutation({
    mutationFn: () => calendarApi.deleteShared(event!.id, scope),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: calendarQueryKey })
      toast({ title: tl("Evento eliminato") })
      onOpenChange(false)
    },
    onError: () => toast({ title: tl("Impossibile eliminare l'evento"), variant: 'destructive' }),
  })

  // ── Read-only view (students, invited teachers, legacy session events) ──
  if (event && !editable) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent size="sm">
          <DialogHeader>
            <div className="flex items-center gap-2">
              <span className="h-3 w-3 flex-shrink-0 rounded-full" style={{ backgroundColor: event.color }} />
              <DialogTitle className="text-xl">{event.title}</DialogTitle>
            </div>
            <DialogDescription className="flex items-center gap-1.5"><Clock className="h-3.5 w-3.5" />{formatWhen(event)}</DialogDescription>
          </DialogHeader>
          <DialogBody>
            {event.recurrence && <p className="text-xs font-semibold text-[var(--text-secondary)]">↻ {RECURRENCE_LABEL(event.recurrence.freq, event.recurrence.interval)}{event.recurrence.until ? ` · ${tl("fino al {0}", new Date(`${event.recurrence.until}T00:00:00`).toLocaleDateString())}` : ''}</p>}
            {event.description && <p className="whitespace-pre-wrap text-sm text-[var(--text-primary)]">{event.description}</p>}
            {event.voice_call && (
              <div className="flex flex-wrap items-center gap-2 rounded-2xl bg-[var(--ds-surface-muted)] p-3">
                <Video className="h-4 w-4 text-[var(--text-secondary)]" />
                <span className="text-sm font-semibold text-[var(--text-primary)]">{tl("Videochiamata di classe")}</span>
                <VoiceCallCodeTag code={event.voice_call.code} />
                <Button type="button" tone="accent" surface="solid" density="compact" className="ml-auto" onClick={() => openVoiceCall(event.voice_call!.code)}>
                  {event.voice_call.live ? tl("Partecipa ora") : tl("Partecipa")}<ExternalLink className="ml-1.5 h-3.5 w-3.5 opacity-70" />
                </Button>
              </div>
            )}
            {event.owner_name && <p className="text-xs text-[var(--text-secondary)]">{tl("Creato da {0}", event.owner_name)}</p>}
            {event.targets.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {event.targets.map((t) => (
                  <span key={targetKey(t.target_type, t.target_id)} className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-600">{t.label}</span>
                ))}
              </div>
            )}
          </DialogBody>
        </DialogContent>
      </Dialog>
    )
  }

  const busy = save.isPending || remove.isPending

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg" className="max-h-[calc(100vh-2rem)] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-xl">{event ? tl("Modifica evento") : tl("Nuovo evento")}</DialogTitle>
          <DialogDescription className="flex items-center gap-1.5">
            <Bell className="h-3.5 w-3.5" />
            {tl("Gli invitati ricevono un promemoria 10 minuti prima, anche nella chat di classe.")}
          </DialogDescription>
        </DialogHeader>

        <form
          className="grid gap-4"
          onSubmit={(e) => { e.preventDefault(); save.mutate() }}
        >
          <Input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder={tl("Titolo dell'evento")} maxLength={200} aria-label={tl("Titolo")} />

          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-1 rounded-[var(--selection-radius)] p-1" style={buildAccentNavClusterStyle()}>
              {[{ value: false, label: tl("Con orario") }, { value: true, label: tl("Tutto il giorno") }].map((option) => (
                <Button
                  key={String(option.value)}
                  type="button"
                  tone="neutral"
                  surface="ghost"
                  density="compact"
                  aria-pressed={allDay === option.value}
                  className={allDay === option.value ? 'ds-selected' : ''}
                  onClick={() => setAllDay(option.value)}
                >
                  {option.label}
                </Button>
              ))}
            </div>
            <div className="flex items-center gap-1.5" role="radiogroup" aria-label={tl("Colore")}>
              {EVENT_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  role="radio"
                  aria-checked={color === c}
                  aria-label={c}
                  onClick={() => setColor(c)}
                  className="flex h-6 w-6 items-center justify-center rounded-full transition-transform hover:scale-110"
                  style={{ backgroundColor: c }}
                >
                  {color === c && <Check className="h-3.5 w-3.5 text-white" />}
                </button>
              ))}
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="grid gap-1 text-xs font-semibold text-[var(--text-secondary)]">
              {tl("Inizio")}
              <div className="flex gap-2">
                <Input type="date" value={startDay} onChange={(e) => {
                  const value = e.target.value
                  setStartDay(value)
                  if (!endDay || value > endDay) setEndDay(value)
                }} required />
                {!allDay && <Input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} className="w-32" required />}
              </div>
            </label>
            <label className="grid gap-1 text-xs font-semibold text-[var(--text-secondary)]">
              {tl("Fine")}
              <div className="flex gap-2">
                <Input type="date" value={endDay} min={startDay} onChange={(e) => setEndDay(e.target.value)} />
                {!allDay && <Input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} className="w-32" />}
              </div>
            </label>
          </div>
          {allDay && <p className="-mt-2 text-xs text-[var(--text-secondary)]">{tl("Gli eventi di tutto il giorno non inviano il promemoria dei 10 minuti.")}</p>}

          <div className="grid gap-2">
            <div className="flex flex-wrap items-end gap-2">
              <label className="grid gap-1 text-xs font-semibold text-[var(--text-secondary)]">
                {tl("Ripeti")}
                <Select density="compact" className="w-44" value={repeat} onChange={(e) => setRepeat(e.target.value as typeof repeat)}>
                  <option value="none">{tl("Non si ripete")}</option>
                  <option value="daily">{tl("Ogni giorno")}</option>
                  <option value="weekly">{tl("Ogni settimana")}</option>
                  <option value="monthly">{tl("Ogni mese")}</option>
                </Select>
              </label>
              {repeat !== 'none' && (
                <>
                  <label className="grid gap-1 text-xs font-semibold text-[var(--text-secondary)]">
                    {repeat === 'daily' ? tl("Ogni quanti giorni") : repeat === 'weekly' ? tl("Ogni quante settimane") : tl("Ogni quanti mesi")}
                    <Input type="number" min={1} max={12} value={interval} onChange={(e) => setInterval_(Number(e.target.value) || 1)} className="w-24" />
                  </label>
                  <label className="grid gap-1 text-xs font-semibold text-[var(--text-secondary)]">
                    {tl("Fino al")}
                    <Input type="date" value={until} min={startDay} onChange={(e) => setUntil(e.target.value)} className="w-44" />
                  </label>
                </>
              )}
            </div>
            {repeat === 'weekly' && (
              <div className="flex items-center gap-1" role="group" aria-label={tl("Giorni della settimana")}>
                {['L', 'M', 'M', 'G', 'V', 'S', 'D'].map((label, idx) => {
                  const on = weekdays.includes(idx)
                  return (
                    <button key={idx} type="button" aria-pressed={on}
                      onClick={() => setWeekdays((prev) => on ? (prev.length > 1 ? prev.filter((d) => d !== idx) : prev) : [...prev, idx])}
                      className={`flex h-8 w-8 items-center justify-center rounded-full text-xs font-bold transition-colors ${on ? 'ds-selected' : 'bg-[var(--ds-field-bg)] text-[var(--ds-field-ink)] hover:bg-[var(--ds-field-hover)]'}`}>
                      {label}
                    </button>
                  )
                })}
              </div>
            )}
          </div>

          {isSeries && (
            <div className="grid gap-1">
              <span className="text-xs font-semibold text-[var(--text-secondary)]">{tl("Questo evento fa parte di una serie: applica a")}</span>
              <div className="flex w-fit flex-wrap items-center gap-1 rounded-[var(--selection-radius)] p-1" style={buildAccentNavClusterStyle()}>
                {([['one', tl("Solo questo")], ['following', tl("Questo e i successivi")], ['all', tl("Tutta la serie")]] as const).map(([value, label]) => (
                  <Button key={value} type="button" tone="neutral" surface="ghost" density="compact" aria-pressed={scope === value}
                    className={scope === value ? 'ds-selected' : ''} onClick={() => setScope(value)}>
                    {label}
                  </Button>
                ))}
              </div>
            </div>
          )}

          <div className="grid gap-2">
            <span className="flex items-center gap-1.5 text-xs font-semibold text-[var(--text-secondary)]"><Video className="h-3.5 w-3.5" />{tl("Videochiamata di classe")}</span>
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex w-fit items-center gap-1 rounded-[var(--selection-radius)] p-1" style={buildAccentNavClusterStyle()}>
                {[{ value: false, label: tl("Nessuna") }, { value: true, label: tl("Con link di videochiamata") }].map((option) => (
                  <Button key={String(option.value)} type="button" tone="neutral" surface="ghost" density="compact" aria-pressed={withCall === option.value}
                    className={withCall === option.value ? 'ds-selected' : ''} onClick={() => setWithCall(option.value)}>
                    {option.label}
                  </Button>
                ))}
              </div>
              {withCall && existingCall && (
                <>
                  <VoiceCallCodeTag code={existingCall.code} />
                  <Button type="button" tone="neutral" surface="ghost" density="compact" onClick={() => openVoiceCall(existingCall.code)}>
                    {tl("Apri")}<ExternalLink className="ml-1.5 h-3.5 w-3.5 opacity-70" />
                  </Button>
                </>
              )}
            </div>
            {withCall && !existingCall && (
              <p className="text-xs text-[var(--text-secondary)]">{tl("Al salvataggio viene generato un link di invito univoco (es. abc-defg-hij): lo vedono gli invitati nell'evento e nel promemoria.")}</p>
            )}
            {withCall && existingCall?.link_enabled === false && (
              <p className="text-xs font-semibold text-[var(--logo-pink)]">{tl("Il link di invito è disattivato: riattivalo dalla gestione della videochiamata.")}</p>
            )}
            {!withCall && event?.voice_call && (
              <p className="text-xs text-[var(--text-secondary)]">{tl("La videochiamata verrà scollegata dall'evento (il link resta valido finché non lo elimini).")}</p>
            )}
          </div>

          <Textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder={tl("Descrizione (facoltativa)")} rows={3} maxLength={5000} />

          <CalendarShareDropdown
            targets={targets}
            onChange={setTargets}
            shareTargets={shareTargets}
            loading={targetsLoading}
            currentSessionId={defaultSessionId}
            existingLabels={Object.fromEntries((event?.targets ?? []).map((t) => [targetKey(t.target_type, t.target_id), t.label]))}
          />

          <DialogFooter className="items-center sm:justify-between">
            <div>
              {event && (
                <Button type="button" tone="danger" surface="ghost" disabled={busy} onClick={() => { if (window.confirm(isSeries && scope !== 'one' ? tl("Eliminare questi eventi della serie per tutti gli invitati?") : tl("Eliminare l'evento per tutti gli invitati?"))) remove.mutate() }}>
                  <Trash2 className="mr-1.5 h-4 w-4" />{tl("Elimina")}
                </Button>
              )}
            </div>
            <div className="flex flex-col-reverse gap-2 sm:flex-row">
              <Button type="button" tone="neutral" surface="ghost" onClick={() => onOpenChange(false)}>{tl("Annulla")}</Button>
              <Button type="submit" tone="accent" surface="solid" disabled={busy || !title.trim()}>
                {save.isPending && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
                {event ? tl("Salva") : tl("Crea evento")}
              </Button>
            </div>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
