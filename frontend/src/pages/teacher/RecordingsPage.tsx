import { SectionHeading } from '@/design/primitives/SectionHeading'
import { SessionCallsPanel } from '@/components/voice-calls/SessionCallsPanel'
import { tl } from '@/i18n/tl'

/** Personal recordings of the teacher (navbar «rec» icon): same list/detail as the session «Chiamate» tab. */
export default function RecordingsPage() {
  return (
    <div className="space-y-4 p-4 sm:p-0">
      <SectionHeading section="/teacher/sessions" className="text-2xl font-bold text-slate-900" subtitle={<>{tl("Trascrizione, riassunto e strumenti AI delle tue registrazioni")}</>} subtitleClassName="text-sm text-slate-500 mt-0.5">
        {tl("Registrazioni")}
      </SectionHeading>
      <SessionCallsPanel personal />
    </div>
  )
}
