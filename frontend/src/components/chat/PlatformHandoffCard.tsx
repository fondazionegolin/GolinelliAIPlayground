import { ArrowRight, Sparkles } from '@/components/icons'
import { Button } from '@/design'
import type { PlatformHandoff } from '@/lib/platformHandoff'
import { tl } from '@/i18n/tl'

/** "Open in <section>" card shown under the chat's first reading of a request that belongs to a platform section. */
export function PlatformHandoffCard({ handoff, onOpen, disabledReason }: {
  handoff: PlatformHandoff
  onOpen: (handoff: PlatformHandoff) => void
  /** Why the section cannot be opened right now (e.g. no active session): shown instead of the action. */
  disabledReason?: string
}) {
  return (
    <div className="ds-semantic-surface mt-2 flex flex-wrap items-center gap-3 rounded-xl bg-[rgba(123,105,201,0.055)] p-3">
      <Sparkles className="h-5 w-5 flex-shrink-0 text-[var(--text-secondary)]" />
      <div className="min-w-0 flex-1">
        <div className="truncate text-xs font-bold text-[var(--text-primary)]">{handoff.title || handoff.label}</div>
        <div className="text-xs font-semibold text-[var(--text-secondary)]">
          {disabledReason || tl("Si apre in {0} con questa richiesta già pronta.", handoff.label)}
        </div>
      </div>
      {!disabledReason && (
        <Button tone="accent" surface="solid" density="compact" onClick={() => onOpen(handoff)}>
          {tl("Apri in {0}", handoff.label)} <ArrowRight className="ml-1 h-3.5 w-3.5" />
        </Button>
      )}
    </div>
  )
}
