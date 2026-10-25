import { Loader2, Square } from '@/components/icons'

interface Props {
  title: string
  /** Escape rooms and quizzes close differently: the copy adapts. */
  kind?: 'slides' | 'escape_room'
  /** Draft whose public lobby is open: closing only shuts the lobby. */
  lobby?: boolean
  pending?: boolean
  onConfirm: () => void
  onCancel: () => void
}

/** Always-on confirmation before a live session is closed: it ends for every connected student. */
export default function EndSessionDialog({ title, kind = 'slides', lobby = false, pending = false, onConfirm, onCancel }: Props) {
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/50 p-4 backdrop-blur-sm" onMouseDown={() => { if (!pending) onCancel() }}>
      <div role="alertdialog" aria-modal="true" aria-labelledby="end-live-title" className="ds-popover w-full max-w-md rounded-[var(--ds-radius-panel)] p-6" onMouseDown={event => event.stopPropagation()}>
        <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-red-100 text-red-600"><Square className="h-5 w-5" /></div>
        <h2 id="end-live-title" className="mt-4 text-lg font-bold text-slate-900">{lobby ? 'Chiudere la lobby?' : 'Chiudere la sessione per tutti?'}</h2>
        <p className="mt-1 text-sm font-semibold text-slate-700">{title}</p>
        <p className="mt-2 text-sm leading-6 text-slate-500">
          {lobby
            ? 'Gli studenti in attesa non vedranno più la stanza e il link pubblico smetterà di funzionare.'
            : kind === 'escape_room'
              ? 'La sessione terminerà subito per tutti gli studenti collegati, anche per chi non ha finito. Verrà calcolata la classifica finale e il link pubblico sarà disattivato.'
              : 'La sessione terminerà subito per tutti gli studenti collegati, anche per chi non ha ancora risposto. Il link pubblico sarà disattivato e non potrai riaprirla.'}
        </p>
        <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button type="button" onClick={onCancel} disabled={pending} className="rounded-xl bg-slate-100 px-4 py-2.5 text-sm font-bold text-slate-700 hover:bg-slate-200 disabled:opacity-60">Continua la sessione</button>
          <button type="button" onClick={onConfirm} disabled={pending} className="flex items-center justify-center gap-2 rounded-xl bg-red-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-red-700 disabled:opacity-60">
            {pending && <Loader2 className="h-4 w-4 animate-spin" />}{lobby ? 'Chiudi lobby' : 'Chiudi per tutti'}
          </button>
        </div>
      </div>
    </div>
  )
}
