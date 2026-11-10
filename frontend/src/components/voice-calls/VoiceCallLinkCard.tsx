import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Calendar, Check, Copy, ExternalLink, Link2, Loader2, RefreshCw, Trash2, Video } from '@/components/icons'
import { Button } from '@/design'
import { useToast } from '@/components/ui/use-toast'
import { buildAccentNavClusterStyle } from '@/lib/navbarGlass'
import { voiceCallUrl, voiceCallsApi, type VoiceCall } from '@/lib/api'
import { tl } from '@/i18n/tl'
import { calendarQueryKey } from '@/components/calendar/calendarUtils'

export const voiceCallsQueryKey = ['voice-calls'] as const

export async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text)
  } catch {
    // Clipboard API unavailable (http, old browser): fall back to a hidden textarea.
    const area = document.createElement('textarea')
    area.value = text
    area.style.position = 'fixed'
    area.style.opacity = '0'
    document.body.appendChild(area)
    area.select()
    document.execCommand('copy')
    area.remove()
  }
}

/** Opens the call page in a new tab: the class chat (and its own voice room) stays where it is. */
export function openVoiceCall(code: string) {
  window.open(`/call/${code}`, '_blank', 'noopener')
}

export function formatCallWhen(iso: string) {
  const date = new Date(iso)
  const today = new Date()
  const sameDay = date.toDateString() === today.toDateString()
  const time = date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
  return sameDay ? tl("oggi alle {0}", time) : `${date.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })} · ${time}`
}

/** Call id in the approved yellow code tag (same tokens as the session join code); a click copies the link. */
export function VoiceCallCodeTag({ code, size = 'sm' }: { code: string; size?: 'sm' | 'md' }) {
  const { toast } = useToast()
  const [copied, setCopied] = useState(false)
  return (
    <button
      type="button"
      onClick={async () => {
        await copyText(voiceCallUrl(code))
        setCopied(true)
        toast({ title: tl("Link di invito copiato"), description: voiceCallUrl(code) })
        window.setTimeout(() => setCopied(false), 1600)
      }}
      title={tl("Copia il link di invito")}
      aria-label={tl("Copia il link di invito della videochiamata {0}", code)}
      className={`flex shrink-0 items-center rounded-full bg-[var(--ds-session-code-bg)] font-mono font-black text-[var(--ds-session-code-ink)] transition-[filter,transform] hover:brightness-95 active:scale-95 ${size === 'sm' ? 'h-6 gap-1 px-2 text-[11px] tracking-[0.08em]' : 'h-9 gap-1.5 px-3 text-[15px] tracking-[0.12em]'}`}
    >
      {code}
      {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3 opacity-60" />}
    </button>
  )
}

function Segmented<T extends string | boolean>({ value, options, onChange, disabled, label }: {
  value: T
  options: { value: T; label: string }[]
  onChange: (value: T) => void
  disabled?: boolean
  label: string
}) {
  return (
    <div className="flex w-fit flex-wrap items-center gap-1 rounded-[var(--selection-radius)] p-1" style={buildAccentNavClusterStyle()} role="group" aria-label={label}>
      {options.map((option) => (
        <Button
          key={String(option.value)}
          type="button"
          tone="neutral"
          surface="ghost"
          density="compact"
          disabled={disabled}
          aria-pressed={value === option.value}
          className={value === option.value ? 'ds-selected' : ''}
          onClick={() => value !== option.value && onChange(option.value)}
        >
          {option.label}
        </Button>
      ))}
    </div>
  )
}

type Props = {
  call: VoiceCall
  onChanged?: (call: VoiceCall) => void
  onDeleted?: () => void
  /** Schedule the call: open a calendar event prefilled with this call. */
  onSchedule?: (call: VoiceCall) => void
  /** Hide the "Partecipa" button (already on the call page). */
  hideJoin?: boolean
}

/** Invite link management for one call: copy/open, regenerate the id, enable/disable, who may use it. */
export function VoiceCallLinkCard({ call, onChanged, onDeleted, onSchedule, hideJoin }: Props) {
  const { toast } = useToast()
  const queryClient = useQueryClient()
  const refresh = (next?: VoiceCall) => {
    queryClient.invalidateQueries({ queryKey: voiceCallsQueryKey })
    queryClient.invalidateQueries({ queryKey: calendarQueryKey })
    if (next) onChanged?.(next)
  }
  const fail = (error: any) => toast({ title: tl("Operazione non riuscita"), description: error?.response?.data?.detail || error?.message, variant: 'destructive' })

  const update = useMutation({
    mutationFn: async (data: { link_enabled?: boolean; open_to_teachers?: boolean }) => (await voiceCallsApi.update(call.id, data)).data,
    onSuccess: (next) => refresh(next),
    onError: fail,
  })
  const regenerate = useMutation({
    mutationFn: async () => (await voiceCallsApi.regenerateCode(call.id)).data,
    onSuccess: (next) => {
      refresh(next)
      toast({ title: tl("Nuovo codice generato"), description: tl("I link condivisi in precedenza non funzionano più.") })
    },
    onError: fail,
  })
  const remove = useMutation({
    mutationFn: () => voiceCallsApi.remove(call.id),
    onSuccess: () => {
      refresh()
      toast({ title: tl("Videochiamata eliminata") })
      onDeleted?.()
    },
    onError: fail,
  })
  const busy = update.isPending || regenerate.isPending || remove.isPending
  const linkOn = call.link_enabled !== false

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <VoiceCallCodeTag code={call.code} size="md" />
        <Button type="button" tone="neutral" surface="soft" density="compact" onClick={async () => {
          await copyText(voiceCallUrl(call.code))
          toast({ title: tl("Link di invito copiato"), description: voiceCallUrl(call.code) })
        }}>
          <Link2 className="mr-1.5 h-4 w-4" />{tl("Copia link")}
        </Button>
        {!hideJoin && (
          <Button type="button" tone="accent" surface="solid" density="compact" disabled={!linkOn && !call.is_owner} onClick={() => openVoiceCall(call.code)}>
            <Video className="mr-1.5 h-4 w-4" />{call.live ? tl("Partecipa ora") : tl("Apri")}
            <ExternalLink className="ml-1.5 h-3.5 w-3.5 opacity-70" />
          </Button>
        )}
      </div>
      <p className="break-all text-xs text-[var(--text-secondary)]">{voiceCallUrl(call.code)}</p>

      {call.next_event && (
        <p className="flex items-center gap-1.5 text-xs font-semibold text-[var(--text-primary)]">
          <Calendar className="h-3.5 w-3.5" />{tl("In calendario: {0}", formatCallWhen(call.next_event.starts_at))}
        </p>
      )}

      {call.is_owner && (
        <div className="grid gap-3 rounded-2xl bg-[var(--ds-surface-muted)] p-3">
          <div className="grid gap-1">
            <span className="text-xs font-semibold text-[var(--text-secondary)]">{tl("Link di invito")}</span>
            <Segmented
              label={tl("Link di invito")}
              value={linkOn}
              disabled={busy}
              onChange={(value) => update.mutate({ link_enabled: value })}
              options={[{ value: true, label: tl("Attivo") }, { value: false, label: tl("Disattivato") }]}
            />
          </div>
          <div className="grid gap-1">
            <span className="text-xs font-semibold text-[var(--text-secondary)]">{tl("Chi può entrare con il link")}</span>
            <Segmented
              label={tl("Chi può entrare con il link")}
              value={!!call.open_to_teachers}
              disabled={busy || !linkOn}
              onChange={(value) => update.mutate({ open_to_teachers: value })}
              options={[{ value: false, label: tl("Solo gli invitati") }, { value: true, label: tl("Anche altri docenti") }]}
            />
            <span className="text-[11px] text-[var(--text-secondary)]">
              {tl("Gli studenti entrano solo se la loro sessione o classe è invitata (sessione collegata o destinatari dell'evento).")}
            </span>
          </div>
          <div className="flex flex-wrap gap-2">
            {onSchedule && (
              <Button type="button" tone="neutral" surface="soft" density="compact" disabled={busy} onClick={() => onSchedule(call)}>
                <Calendar className="mr-1.5 h-4 w-4" />{tl("Programma in calendario")}
              </Button>
            )}
            <Button type="button" tone="neutral" surface="soft" density="compact" disabled={busy} onClick={() => {
              if (window.confirm(tl("Generare un nuovo codice? I link già condivisi smetteranno di funzionare."))) regenerate.mutate()
            }}>
              {regenerate.isPending ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-1.5 h-4 w-4" />}
              {tl("Nuovo codice")}
            </Button>
            <Button type="button" tone="danger" surface="ghost" density="compact" disabled={busy} onClick={() => {
              if (window.confirm(tl("Eliminare la videochiamata? Il link smetterà di funzionare e gli eventi collegati resteranno senza chiamata."))) remove.mutate()
            }}>
              <Trash2 className="mr-1.5 h-4 w-4" />{tl("Elimina")}
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
