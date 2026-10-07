import { Upload } from '@/components/icons'

/** Full-area drop target highlight. Pointer-transparent so it never steals the drag events it is announcing. */
export function DropOverlay({ active, label = 'Rilascia qui i file', hint }: { active: boolean; label?: string; hint?: string }) {
  if (!active) return null
  return (
    <div className="pointer-events-none absolute inset-0 z-[60] flex items-center justify-center rounded-[inherit] bg-primary/10 p-3 backdrop-blur-[2px] animate-in fade-in duration-100">
      <div className="absolute inset-2 rounded-2xl border-2 border-dashed border-primary/60" />
      <div className="relative flex flex-col items-center gap-2 rounded-2xl bg-[var(--ds-popover-solid)] px-6 py-4 text-center shadow-[var(--ds-shadow-popover)]">
        <span className="flex h-11 w-11 items-center justify-center rounded-full bg-primary/15 text-primary"><Upload className="h-5 w-5" /></span>
        <p className="text-sm font-extrabold text-foreground">{label}</p>
        {hint && <p className="max-w-[16rem] text-[11px] text-muted-foreground">{hint}</p>}
      </div>
    </div>
  )
}
