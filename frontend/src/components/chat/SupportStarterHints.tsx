import { useState, type ComponentType } from 'react'
import {
  BarChart3, BookOpen, Box, CalendarDays, ClipboardCheck, Code2, Cpu, Database, FileText, Film,
  Image as ImageIcon, LayoutDashboard, Microscope, Presentation, Radio, ScanText, Sparkles, Table2, Workflow, Wand2,
} from '@/components/icons'
import { tl } from '@/i18n/tl'

type HintIcon = ComponentType<{ className?: string }>

export interface SupportHint {
  icon: HintIcon
  title: string
  description: string
  /** Text placed in the composer; the teacher completes the "…" and sends. */
  prompt: string
  /** Optional chat mode to switch to when the hint is picked. */
  mode?: 'protocol'
}

/** Pool of starter hints: the chat shows a different random few each time it opens empty. */
const HINT_POOL: SupportHint[] = [
  {
    icon: Wand2,
    title: tl("Modalità agentica"),
    description: tl("Descrivi un obiettivo complesso: l'AI lo scompone in passi e li esegue per te."),
    prompt: tl("Prepara l'intera unità didattica su … per una classe …: obiettivi, lezione, verifica e materiali."),
    mode: 'protocol',
  },
  {
    icon: Wand2,
    title: tl("Dal piano all'azione"),
    description: tl("La modalità agentica orchestra più strumenti della piattaforma in un solo flusso."),
    prompt: tl("Pianifica due settimane di lezioni su … e prepara slide, quiz finale e promemoria in calendario."),
    mode: 'protocol',
  },
  {
    icon: FileText,
    title: tl("Crea un documento"),
    description: tl("Chiedi e ottieni un documento pronto, che si apre nell'editor per rifinirlo."),
    prompt: tl("Crea un documento che parli di … con introduzione, sezioni e un riepilogo finale."),
  },
  {
    icon: Presentation,
    title: tl("Presentazione in un attimo"),
    description: tl("Slide con struttura, immagini e layout: dal prompt all'editor di presentazioni."),
    prompt: tl("Crea una presentazione di 10 slide su … per studenti di …, con immagini e domande di verifica."),
  },
  {
    icon: Database,
    title: tl("Genera un dataset"),
    description: tl("Dati realistici per esercitarsi con statistica, Python o Machine Learning."),
    prompt: tl("Genera un dataset di 200 righe su … con colonne numeriche e categoriche adatte a un'analisi in classe."),
  },
  {
    icon: ImageIcon,
    title: tl("Genera un'immagine"),
    description: tl("Illustrazioni per lezioni, schede e presentazioni, nello stile che preferisci."),
    prompt: tl("Genera un'immagine che illustri … in stile illustrazione didattica, sfondo chiaro."),
  },
  {
    icon: ClipboardCheck,
    title: tl("Quiz su misura"),
    description: tl("Verifiche con livelli di difficoltà e correzione, pubblicabili alla classe."),
    prompt: tl("Crea un quiz di 10 domande a risposta multipla su … con tre livelli di difficoltà."),
  },
  {
    icon: Radio,
    title: tl("Live Interaction"),
    description: tl("Sondaggi, word wall e quiz in tempo reale: anche a partire da un PDF."),
    prompt: tl("Prepara una sessione live interattiva su … con quiz, word wall e una domanda d'opinione."),
  },
  {
    icon: Microscope,
    title: tl("Deep Research"),
    description: tl("Ricerca approfondita con fonti: un rapporto strutturato, non una semplice risposta."),
    prompt: tl("Fai una ricerca approfondita su … e preparami un rapporto con fonti e punti chiave per la lezione."),
  },
  {
    icon: Code2,
    title: tl("Vibe Lab"),
    description: tl("Descrivi un'app o un gioco e guardalo prendere vita, pronto da provare."),
    prompt: tl("Crea con Vibe Lab una piccola app interattiva per imparare … da usare in classe."),
  },
  {
    icon: Box,
    title: tl("Modelli 3D"),
    description: tl("Dal testo a un modello 3D da ruotare, modificare e condividere con un QR."),
    prompt: tl("Crea un modello 3D di … da mostrare agli studenti e condividere con un link."),
  },
  {
    icon: Workflow,
    title: tl("Dataflow Studio"),
    description: tl("Costruisci flussi di lavoro con nodi AI, senza scrivere codice."),
    prompt: tl("Costruisci un flusso che prende un testo, lo riassume e ne ricava cinque domande di comprensione."),
  },
  {
    icon: Cpu,
    title: tl("Machine Learning in classe"),
    description: tl("Allena un classificatore con la webcam: immagini, pose e gesti delle mani."),
    prompt: tl("Prepara un'attività di ML Lab in cui gli studenti allenano un modello a riconoscere …"),
  },
  {
    icon: Table2,
    title: tl("Foglio di calcolo"),
    description: tl("Tabelle con formule già impostate, pronte da compilare o analizzare."),
    prompt: tl("Crea un foglio di calcolo per … con formule, totali e un riepilogo."),
  },
  {
    icon: BookOpen,
    title: tl("Dispensa con esercizi"),
    description: tl("Spiegazioni, esempi ed esercizi svolti in un'unica dispensa da stampare."),
    prompt: tl("Prepara una dispensa su … con spiegazioni, esempi svolti ed esercizi graduati."),
  },
  {
    icon: LayoutDashboard,
    title: tl("Pagina interattiva"),
    description: tl("Una pagina web didattica con simulazioni e componenti cliccabili."),
    prompt: tl("Crea una pagina interattiva che spieghi … con una simulazione che gli studenti possano manipolare."),
  },
  {
    icon: CalendarDays,
    title: tl("Calendario a parole"),
    description: tl("Scrivi cosa ti serve: l'evento viene creato e condiviso con classe e colleghi."),
    prompt: tl("Metti in calendario una verifica di … giovedì prossimo alle 10 per la classe …"),
  },
  {
    icon: ScanText,
    title: tl("Da foto e PDF a testo"),
    description: tl("Allega una scansione o un compito a mano: ottieni trascrizione e testo ordinato."),
    prompt: tl("Trascrivi il documento allegato e restituiscimi un testo pulito, con tabelle ben formattate."),
  },
  {
    icon: Film,
    title: tl("Video Studio"),
    description: tl("Un breve video didattico con scene coerenti, dallo script alla clip."),
    prompt: tl("Prepara un breve video che spieghi … in 5 scene, per studenti di …"),
  },
  {
    icon: BarChart3,
    title: tl("Analisi dei dati"),
    description: tl("Allega un file e chiedi grafici, tendenze e una lettura commentata."),
    prompt: tl("Analizza i dati allegati: mostrami i grafici principali e commenta cosa emerge."),
  },
  {
    icon: Sparkles,
    title: tl("Chiedi in linguaggio naturale"),
    description: tl("Non serve scegliere lo strumento: il chatbot capisce e apre quello giusto."),
    prompt: tl("Aiutami a preparare la prossima lezione su …: dimmi cosa conviene creare."),
  },
]

const HINTS_SHOWN = 3

/** Fisher–Yates shuffle on a copy, then take the first n. */
function pickRandom<T>(items: T[], n: number): T[] {
  const copy = [...items]
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[copy[i], copy[j]] = [copy[j], copy[i]]
  }
  return copy.slice(0, n)
}

export function SupportStarterHints({ onPick }: { onPick: (hint: SupportHint) => void }) {
  // Chosen once per mount: a new random set each time the chat opens empty.
  const [hints] = useState(() => {
    const agentic = HINT_POOL.filter(h => h.mode === 'protocol')
    const others = HINT_POOL.filter(h => h.mode !== 'protocol')
    // The first hint always spotlights the agentic mode, the rest are random actions.
    return [...pickRandom(agentic, 1), ...pickRandom(others, HINTS_SHOWN - 1)]
  })

  return (
    <div className="w-full max-w-3xl">
      <div className="grid gap-3 sm:grid-cols-3">
        {hints.map(hint => {
          const Icon = hint.icon
          return (
            <button
              key={hint.title}
              type="button"
              onClick={() => onPick(hint)}
              className="ds-control flex flex-col gap-2 rounded-xl p-4 text-left text-slate-800"
            >
              <Icon className="h-5 w-5 shrink-0" />
              <strong className="block text-sm">{hint.title}</strong>
              <span className="block text-xs leading-snug text-slate-500">{hint.description}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
