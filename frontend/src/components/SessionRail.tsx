import { useEffect, useRef, useState, type CSSProperties, type ComponentType, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { teacherApi, llmApi, filesApi } from '@/lib/api'
import { tl } from '@/i18n/tl'

export interface SessionRailItem {
  key: string
  icon: ComponentType<{ className?: string }>
  title: string
  onClick: () => void
  active?: boolean
  badge?: ReactNode
  /** Popover shown on hover; the button itself stays clickable. */
  preview: ReactNode
}

/**
 * Floating session shortcuts docked to the left of the page frame. Hovering an icon opens a
 * small preview of that section (no click needed); clicking still navigates.
 */
export function SessionRail({ items, style }: { items: SessionRailItem[]; style: CSSProperties }) {
  const [hovered, setHovered] = useState<string | null>(null)
  const timer = useRef<number>()
  useEffect(() => () => window.clearTimeout(timer.current), [])
  const enter = (key: string) => { window.clearTimeout(timer.current); setHovered(key) }
  const leave = () => { window.clearTimeout(timer.current); timer.current = window.setTimeout(() => setHovered(null), 140) }

  return (
    <>
      {items.map((item) => {
        const Icon = item.icon
        return (
          <div key={item.key} className="relative" onMouseEnter={() => enter(item.key)} onMouseLeave={leave}>
            <button
              type="button"
              aria-label={item.title}
              onClick={() => { setHovered(null); item.onClick() }}
              onFocus={() => enter(item.key)}
              onBlur={leave}
              className={`app-button-chrome relative flex h-9 w-9 items-center justify-center !rounded-full ${item.active ? 'app-button-chrome-active' : ''}`}
              style={style}
            >
              <Icon className="h-4 w-4" />
              {item.badge}
            </button>
            {hovered === item.key && (
              <div className="ds-popover nav-cluster-unroll absolute left-full top-0 z-[70] ml-3 w-72 overflow-hidden rounded-[var(--ds-radius-panel)]">
                {item.preview}
              </div>
            )}
          </div>
        )
      })}
    </>
  )
}

function PreviewShell({ title, subtitle, children, hint }: { title: string; subtitle?: string; children: ReactNode; hint?: string }) {
  return (
    <div>
      <div className="px-4 pb-2 pt-3">
        <p className="text-sm font-bold text-slate-800">{title}</p>
        {subtitle && <p className="text-[11px] text-slate-400">{subtitle}</p>}
      </div>
      <div className="max-h-[min(50vh,22rem)] space-y-1.5 overflow-y-auto px-4 pb-3">{children}</div>
      {hint && <p className="px-4 pb-3 text-[10px] text-slate-400">{hint}</p>}
    </div>
  )
}

const Empty = ({ children }: { children: ReactNode }) => <p className="py-3 text-xs text-slate-400">{children}</p>

export function LiveSessionPreview({ name, className, joinCode, online, enrolled }: { name: string; className: string; joinCode?: string; online: number; enrolled: number }) {
  return (
    <PreviewShell title={name} subtitle={className} hint={tl("Clic per aprire la sessione live")}>
      {joinCode && <p className="text-xs text-slate-600">{tl("Codice")}: <span className="font-mono font-bold tracking-widest">{joinCode}</span></p>}
      <p className="text-xs text-slate-600">{online} online · {enrolled} {tl("iscritti")}</p>
    </PreviewShell>
  )
}

export function TasksPreview({ sessionId }: { sessionId: string }) {
  const { data = [], isLoading } = useQuery<Array<{ id: string; title: string; status: string; due_at: string | null; submission_count?: number }>>({
    queryKey: ['session-tasks', sessionId],
    queryFn: async () => (await teacherApi.getTasks(sessionId)).data,
  })
  return (
    <PreviewShell title={tl("Compiti")} subtitle={`${data.length}`} hint={tl("Clic per gestire i compiti")}>
      {isLoading ? <Empty>…</Empty> : data.length === 0 ? <Empty>{tl("Nessun compito")}</Empty> : data.slice(0, 5).map((task) => (
        <div key={task.id} className="min-w-0">
          <p className="truncate text-xs font-semibold text-slate-700">{task.title}</p>
          <p className="text-[10px] text-slate-400">
            {task.due_at ? new Date(task.due_at).toLocaleDateString() : tl("Senza scadenza")}
            {typeof task.submission_count === 'number' ? ` · ${task.submission_count} ${tl("consegne")}` : ''}
          </p>
        </div>
      ))}
    </PreviewShell>
  )
}

export function HistoryPreview({ sessionId }: { sessionId: string }) {
  const { data = [], isLoading } = useQuery<Array<{ id: string; student_nickname: string; title: string | null; message_count: number; updated_at: string }>>({
    queryKey: ['session-conversations', sessionId],
    queryFn: async () => (await llmApi.getSessionConversations(sessionId)).data,
  })
  const recent = [...data].sort((a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at)).slice(0, 5)
  return (
    <PreviewShell title={tl("Cronologia chat")} subtitle={`${data.length} ${tl("conversazioni")}`} hint={tl("Clic per aprire la cronologia")}>
      {isLoading ? <Empty>…</Empty> : recent.length === 0 ? <Empty>{tl("Nessuna conversazione")}</Empty> : recent.map((c) => (
        <div key={c.id} className="min-w-0">
          <p className="truncate text-xs font-semibold text-slate-700">{c.student_nickname}</p>
          <p className="truncate text-[10px] text-slate-400">{c.title || tl("Senza titolo")} · {c.message_count} msg</p>
        </div>
      ))}
    </PreviewShell>
  )
}

export function FilesPreview({ sessionId }: { sessionId: string }) {
  const { data = [], isLoading } = useQuery<Array<{ id: string; filename: string; size_bytes?: number }>>({
    queryKey: ['session-files-preview', sessionId],
    queryFn: async () => (await filesApi.listSessionFiles(sessionId)).data,
  })
  return (
    <PreviewShell title={tl("File della sessione")} subtitle={`${data.length}`} hint={tl("Clic per aprire i file")}>
      {isLoading ? <Empty>…</Empty> : data.length === 0 ? <Empty>{tl("Nessun file")}</Empty> : data.slice(0, 6).map((f) => (
        <p key={f.id} className="truncate text-xs text-slate-700">{f.filename}</p>
      ))}
    </PreviewShell>
  )
}
