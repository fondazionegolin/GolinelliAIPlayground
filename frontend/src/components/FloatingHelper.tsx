import { useState } from 'react'
import { useLocation } from 'react-router-dom'
import { HelpCircle, X, ChevronRight, BookOpen, Users, PlayCircle, MessageSquare, FileText, Brain, ClipboardList, Bot, Layers } from 'lucide-react'

interface Step {
  icon: React.ReactNode
  title: string
  detail: string
}

interface HelpContent {
  title: string
  subtitle: string
  steps: Step[]
  tip?: string
}

const HELP_MAP: Record<string, HelpContent> = {
  '/teacher': {
    title: 'Chat di Supporto AI',
    subtitle: 'Il tuo assistente personale per preparare lezioni, generare materiali e ricevere supporto didattico.',
    steps: [
      { icon: <MessageSquare className="h-4 w-4" />, title: 'Scrivi una domanda', detail: 'Digita qualsiasi richiesta: "Crea un quiz sulle frazioni per la 3a media".' },
      { icon: <Layers className="h-4 w-4" />, title: 'Scegli la modalità', detail: 'Usa il menu in basso: modalità Default, Quiz, Dataset, Immagine o Report.' },
      { icon: <FileText className="h-4 w-4" />, title: 'Pubblica il risultato', detail: 'Quando l\'AI genera un quiz o documento, clicca "Pubblica" per inviarlo agli studenti.' },
      { icon: <Bot className="h-4 w-4" />, title: 'Scegli il modello AI', detail: 'Clicca sul nome del modello in basso per cambiare provider (GPT-4, Claude, Gemini…).' },
    ],
    tip: 'Esempio: "Genera 10 domande a scelta multipla sull\'ecosistema del lago, livello 2a media."',
  },
  '/teacher/classes': {
    title: 'Gestione Classi',
    subtitle: 'Crea le tue classi, aggiungi studenti e organizza il lavoro per gruppo.',
    steps: [
      { icon: <Users className="h-4 w-4" />, title: 'Crea una classe', detail: 'Clicca "+ Nuova Classe", assegna un nome e un anno scolastico.' },
      { icon: <PlayCircle className="h-4 w-4" />, title: 'Avvia una sessione', detail: 'Da ogni classe clicca "Avvia" per aprire una sessione live con gli studenti.' },
      { icon: <BookOpen className="h-4 w-4" />, title: 'Crea UDA', detail: 'Clicca "UDA" per creare un\'Unità Didattica con documenti e attività tematiche.' },
      { icon: <ChevronRight className="h-4 w-4" />, title: 'Condividi il codice', detail: 'Ogni classe ha un codice univoco: condividilo con gli studenti per farli accedere.' },
    ],
    tip: 'Esempio: crea la classe "3B Scienze 2025/26", poi avvia una sessione e condividi il codice JOIN con la classe.',
  },
  '/teacher/sessions': {
    title: 'Sessioni',
    subtitle: 'Gestisci le sessioni delle tue classi: avviale, mettile in pausa, monitorale.',
    steps: [
      { icon: <PlayCircle className="h-4 w-4" />, title: 'Seleziona la classe', detail: 'Scegli la classe dal menu a tendina per vedere le sue sessioni.' },
      { icon: <PlayCircle className="h-4 w-4" />, title: 'Crea una sessione', detail: 'Clicca "+ Nuova Sessione" e dai un titolo (es. "Lezione 15 marzo").' },
      { icon: <MessageSquare className="h-4 w-4" />, title: 'Avvia la sessione', detail: 'Clicca "Avvia" — la sessione diventa Attiva e gli studenti possono connettersi.' },
      { icon: <ChevronRight className="h-4 w-4" />, title: 'Monitora', detail: 'Clicca "Monitora" per vedere studenti online, chat, compiti e cronologia.' },
    ],
    tip: 'Una sessione può essere messa in Pausa e riattivata in qualsiasi momento.',
  },
  '/teacher/documents': {
    title: 'Documenti',
    subtitle: 'Crea e gestisci presentazioni, documenti, fogli di calcolo e canvas collaborativi.',
    steps: [
      { icon: <FileText className="h-4 w-4" />, title: 'Crea un documento', detail: 'Clicca "+ Nuovo" e scegli il tipo: Documento, Presentazione, Foglio o Canvas.' },
      { icon: <Brain className="h-4 w-4" />, title: 'Usa l\'AI per scrivere', detail: 'Seleziona del testo e usa l\'assistente AI integrato per riscrivere o espandere.' },
      { icon: <PlayCircle className="h-4 w-4" />, title: 'Pubblica in sessione', detail: 'Clicca "Pubblica" per rendere il documento visibile agli studenti della sessione.' },
      { icon: <ChevronRight className="h-4 w-4" />, title: 'Cerca', detail: 'Usa la barra di ricerca per trovare documenti per nome, tipo o sessione.' },
    ],
    tip: 'Le bozze sono visibili solo a te; pubblica in una sessione per condividerle.',
  },
  '/teacher/ml-lab': {
    title: 'ML Lab',
    subtitle: 'Laboratorio di Machine Learning per sperimentare con immagini, testi e dati strutturati.',
    steps: [
      { icon: <Brain className="h-4 w-4" />, title: 'Scegli un modulo', detail: 'Immagini (CNN), Testi (classificazione) o Dati (regressione/classificazione tabellare).' },
      { icon: <Layers className="h-4 w-4" />, title: 'Carica un dataset', detail: 'Trascina un file CSV o usa il Creatore Dataset per generarne uno sintetico.' },
      { icon: <PlayCircle className="h-4 w-4" />, title: 'Addestra il modello', detail: 'Clicca "Addestra" — il modello si allena direttamente nel browser con TensorFlow.js.' },
      { icon: <ChevronRight className="h-4 w-4" />, title: 'Testa e condividi', detail: 'Testa il modello con nuovi dati, poi condividi i risultati in chat.' },
    ],
    tip: 'Creatore Dataset: clicca "+ Crea Dataset", aggiungi colonne, scegli le correlazioni statistiche e genera dati sintetici.',
  },
}

// Match for session live page
function getSessionLiveHelp(tab: string): HelpContent {
  const tabs: Record<string, HelpContent> = {
    modules: {
      title: 'Sessione Live — Moduli',
      subtitle: 'Attiva o disattiva i moduli disponibili per gli studenti in questa sessione.',
      steps: [
        { icon: <Brain className="h-4 w-4" />, title: 'Attiva moduli', detail: 'Usa gli switch per abilitare Chatbot, ML Lab, Quiz autonomo e Chat.' },
        { icon: <Bot className="h-4 w-4" />, title: 'Configura il Teacherbot', detail: 'Clicca "Configura" per personalizzare il comportamento dell\'AI per questa sessione.' },
        { icon: <Users className="h-4 w-4" />, title: 'Monitora studenti', detail: 'Nel pannello laterale vedi chi è online e cosa sta facendo ogni studente.' },
        { icon: <MessageSquare className="h-4 w-4" />, title: 'Chat di classe', detail: 'Usa il tab "Chat" per comunicare con tutta la classe in tempo reale.' },
      ],
      tip: 'Congela uno studente cliccando sull\'icona ❄️ accanto al suo nome per bloccargli l\'accesso temporaneamente.',
    },
    tasks: {
      title: 'Sessione Live — Compiti',
      subtitle: 'Crea e monitora compiti, quiz e attività per gli studenti.',
      steps: [
        { icon: <ClipboardList className="h-4 w-4" />, title: 'Crea un compito', detail: 'Clicca "+ Nuovo" per creare un compito scritto, quiz a scelta multipla o attività libera.' },
        { icon: <PlayCircle className="h-4 w-4" />, title: 'Pubblica il compito', detail: 'Clicca "Pubblica" — il compito appare subito nell\'interfaccia degli studenti.' },
        { icon: <ChevronRight className="h-4 w-4" />, title: 'Leggi le risposte', detail: 'Clicca su un compito per espanderlo e vedere tutte le consegne degli studenti.' },
        { icon: <Brain className="h-4 w-4" />, title: 'Cerca', detail: 'Usa la barra di ricerca per trovare compiti per nome, descrizione o tipo.' },
      ],
      tip: 'I quiz vengono corretti automaticamente — vedi immediatamente il punteggio di ogni studente.',
    },
    history: {
      title: 'Sessione Live — Cronologia',
      subtitle: 'Visualizza tutta l\'attività degli studenti durante la sessione.',
      steps: [
        { icon: <Users className="h-4 w-4" />, title: 'Filtra per studente', detail: 'Clicca sul nome di uno studente per vedere solo la sua attività.' },
        { icon: <MessageSquare className="h-4 w-4" />, title: 'Leggi le chat', detail: 'Vedi le conversazioni degli studenti con il Chatbot AI.' },
        { icon: <ChevronRight className="h-4 w-4" />, title: 'Esporta', detail: 'Usa il pulsante Export per scaricare la cronologia in CSV.' },
      ],
      tip: 'La cronologia è ordinata per ora — gli eventi più recenti sono in cima.',
    },
    chat: {
      title: 'Sessione Live — Chat',
      subtitle: 'Comunicazione in tempo reale con gli studenti della sessione.',
      steps: [
        { icon: <MessageSquare className="h-4 w-4" />, title: 'Messaggio pubblico', detail: 'Scrivi nella chat per mandare un messaggio a tutti gli studenti online.' },
        { icon: <Users className="h-4 w-4" />, title: 'Chat privata', detail: 'Clicca sul nome di uno studente per aprire una chat privata con lui.' },
        { icon: <ChevronRight className="h-4 w-4" />, title: 'Carica file', detail: 'Trascina un file nella chat per condividerlo con la classe.' },
      ],
      tip: 'Gli studenti ricevono una notifica per ogni tuo messaggio, anche se non sono sulla chat.',
    },
  }
  return tabs[tab] || tabs.modules
}

function getHelp(pathname: string, search: string): HelpContent | null {
  // Session live page — tab-specific
  if (/\/teacher\/sessions\/[^/]+$/.test(pathname)) {
    const params = new URLSearchParams(search)
    const tab = params.get('tab') || 'modules'
    return getSessionLiveHelp(tab)
  }
  // Exact or prefix match
  const entry = Object.entries(HELP_MAP).find(([route]) => pathname === route || pathname.startsWith(route + '/'))
  if (entry) return entry[1]
  // Student pages
  if (pathname.startsWith('/student')) {
    return {
      title: 'Dashboard Studente',
      subtitle: 'Accedi ai moduli della tua sessione e partecipa alle attività.',
      steps: [
        { icon: <Bot className="h-4 w-4" />, title: 'Chatbot', detail: 'Chatta con l\'AI per fare domande e ricevere spiegazioni personalizzate.' },
        { icon: <ClipboardList className="h-4 w-4" />, title: 'Compiti', detail: 'Trovi qui i compiti assegnati dal docente — rispondi e consegna.' },
        { icon: <Brain className="h-4 w-4" />, title: 'ML Lab', detail: 'Sperimenta con Machine Learning: addestra modelli su immagini, testi e dati.' },
        { icon: <MessageSquare className="h-4 w-4" />, title: 'Chat di classe', detail: 'Partecipa alla chat pubblica della sessione o scrivi in privato al docente.' },
      ],
      tip: 'Usa il menu in basso per passare tra i moduli disponibili.',
    }
  }
  return null
}

export function FloatingHelper() {
  const [open, setOpen] = useState(false)
  const location = useLocation()
  const help = getHelp(location.pathname, location.search)

  if (!help) return null

  return (
    <>
      {/* Floating button */}
      <button
        onClick={() => setOpen(true)}
        className="fixed bottom-5 left-5 z-40 w-11 h-11 rounded-full bg-white border border-slate-200 shadow-lg flex items-center justify-center text-slate-500 hover:text-slate-800 hover:shadow-xl hover:scale-105 transition-all duration-200"
        title="Guida alla pagina"
        aria-label="Apri guida"
      >
        <HelpCircle className="h-5 w-5" />
      </button>

      {/* Modal overlay */}
      {open && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-start p-4 sm:p-6">
          <div className="absolute inset-0 bg-slate-900/20 backdrop-blur-[2px]" onClick={() => setOpen(false)} />

          <div className="relative w-full max-w-sm bg-white rounded-2xl shadow-2xl border border-slate-100 overflow-hidden animate-in slide-in-from-bottom-4 duration-200">
            {/* Header */}
            <div className="px-5 py-4 border-b border-slate-50 flex items-start justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-xl bg-slate-100 flex items-center justify-center flex-shrink-0">
                  <HelpCircle className="h-4 w-4 text-slate-600" />
                </div>
                <div>
                  <h2 className="text-sm font-bold text-slate-900 leading-tight">{help.title}</h2>
                  <p className="text-[11px] text-slate-400 mt-0.5 leading-snug">{help.subtitle}</p>
                </div>
              </div>
              <button onClick={() => setOpen(false)} className="text-slate-300 hover:text-slate-600 transition-colors flex-shrink-0 mt-0.5">
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Steps */}
            <div className="px-5 py-4 space-y-3">
              {help.steps.map((step, i) => (
                <div key={i} className="flex gap-3">
                  <div className="w-7 h-7 rounded-lg bg-slate-50 border border-slate-100 flex items-center justify-center flex-shrink-0 text-slate-500">
                    {step.icon}
                  </div>
                  <div className="flex-1 min-w-0 pt-0.5">
                    <p className="text-xs font-semibold text-slate-700">{step.title}</p>
                    <p className="text-[11px] text-slate-400 leading-relaxed mt-0.5">{step.detail}</p>
                  </div>
                </div>
              ))}
            </div>

            {/* Tip */}
            {help.tip && (
              <div className="mx-5 mb-4 px-3.5 py-2.5 bg-amber-50 border border-amber-100 rounded-xl">
                <p className="text-[11px] text-amber-700 leading-relaxed">
                  <span className="font-bold">Esempio: </span>{help.tip}
                </p>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  )
}
