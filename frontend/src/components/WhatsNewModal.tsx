import { X, Sparkles, FileSpreadsheet, MessageSquareDiff, Wand2, Database, Bot, Zap } from 'lucide-react'
import { Button } from '@/components/ui/button'

// Bump this string on every release to re-trigger the modal for all users.
export const WHATS_NEW_VERSION = 'v2026.03.2'
const LS_KEY = 'whats_new_seen'

export function shouldShowWhatsNew(): boolean {
  try {
    return localStorage.getItem(LS_KEY) !== WHATS_NEW_VERSION
  } catch {
    return false
  }
}

export function markWhatsNewSeen() {
  try {
    localStorage.setItem(LS_KEY, WHATS_NEW_VERSION)
  } catch {}
}

interface Feature {
  icon: React.ReactNode
  title: string
  description: string
  badge: 'new' | 'improved'
}

const FEATURES: Feature[] = [
  {
    icon: <Database className="h-5 w-5 text-indigo-600" />,
    title: 'Knowledge Base per Teacherbot',
    description: 'Carica PDF, Word, Excel o CSV direttamente nel builder del tuo teacherbot. Il bot risponderà agli studenti usando i tuoi documenti come fonte di riferimento.',
    badge: 'new',
  },
  {
    icon: <MessageSquareDiff className="h-5 w-5 text-purple-600" />,
    title: 'System prompt personalizzabili',
    description: 'Modifica il comportamento del tuo assistente docente e di ogni chatbot di sessione. Ogni sessione può avere configurazioni diverse.',
    badge: 'new',
  },
  {
    icon: <FileSpreadsheet className="h-5 w-5 text-emerald-600" />,
    title: 'File Excel e CSV nei chatbot',
    description: 'Allega fogli Excel e file CSV ai chatbot. Il sistema mostra un\'anteprima ricca con statistiche per colonna e suggerisce analisi pertinenti.',
    badge: 'new',
  },
  {
    icon: <Wand2 className="h-5 w-5 text-amber-600" />,
    title: 'Assistente prompt granulare',
    description: 'Seleziona una porzione del system prompt e ottieni espansioni AI con regole comportamentali precise. Utile per raffinare il comportamento senza riscrivere tutto.',
    badge: 'new',
  },
  {
    icon: <Zap className="h-5 w-5 text-sky-600" />,
    title: 'Gemini Flash e nuovi modelli',
    description: 'Sono ora disponibili Gemini Flash Lite e ulteriori modelli veloci. Selezionali nelle impostazioni di sessione o nel builder del teacherbot.',
    badge: 'improved',
  },
  {
    icon: <Bot className="h-5 w-5 text-rose-600" />,
    title: 'Miglioramenti al pannello admin',
    description: 'Nuovo layout del pannello di controllo, gestione limiti di costo per docente, log transazioni e personalizzazione email.',
    badge: 'improved',
  },
]

const BADGE_STYLES = {
  new: 'bg-emerald-100 text-emerald-700',
  improved: 'bg-sky-100 text-sky-700',
}

interface WhatsNewModalProps {
  onClose: () => void
}

export default function WhatsNewModal({ onClose }: WhatsNewModalProps) {
  const handleClose = () => {
    markWhatsNewSeen()
    onClose()
  }

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[200] flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="px-6 pt-6 pb-4 border-b border-slate-100 flex items-start justify-between flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center shadow-md">
              <Sparkles className="h-5 w-5 text-white" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-slate-900">Novità nella piattaforma</h2>
              <p className="text-xs text-slate-400 mt-0.5">{WHATS_NEW_VERSION} · Marzo 2026</p>
            </div>
          </div>
          <button
            onClick={handleClose}
            className="text-slate-400 hover:text-slate-600 transition-colors mt-0.5"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Feature list */}
        <div className="overflow-y-auto flex-1 px-6 py-4 space-y-3">
          {FEATURES.map((f, i) => (
            <div key={i} className="flex gap-4 p-3 rounded-xl hover:bg-slate-50 transition-colors">
              <div className="w-9 h-9 rounded-lg bg-slate-100 flex items-center justify-center flex-shrink-0 mt-0.5">
                {f.icon}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-semibold text-slate-800 text-sm">{f.title}</span>
                  <span className={`text-[10px] font-bold uppercase px-1.5 py-0.5 rounded ${BADGE_STYLES[f.badge]}`}>
                    {f.badge === 'new' ? 'Nuovo' : 'Migliorato'}
                  </span>
                </div>
                <p className="text-sm text-slate-500 mt-0.5 leading-relaxed">{f.description}</p>
              </div>
            </div>
          ))}
        </div>

        {/* Footer */}
        <div className="px-6 pb-5 pt-4 border-t border-slate-100 flex justify-end flex-shrink-0">
          <Button
            onClick={handleClose}
            className="bg-[#181b1e] hover:bg-[#0f1113] text-white px-6"
          >
            Ottimo, grazie!
          </Button>
        </div>
      </div>
    </div>
  )
}
