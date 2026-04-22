import {
  Bot,
  FileText,
  LayoutDashboard,
  MessageSquare,
  Users,
} from 'lucide-react'
import WikiGuidePage, { type WikiSection } from '@/components/wiki/WikiGuidePage'
import { DEFAULT_TEACHER_ACCENT, getTeacherAccentTheme, type TeacherAccentId } from '@/lib/teacherAccent'

const TEACHER_WIKI_SECTIONS: WikiSection[] = [
  {
    id: 'support-chat',
    title: 'Supporto docente AI',
    description: 'Area principale del docente per generare materiali, bozze, analisi e contenuti didattici assistiti.',
    icon: MessageSquare,
    features: [
      {
        title: 'Chat di supporto docente',
        path: 'Docente / Supporto / Chat',
        description: 'E il punto di ingresso principale per lavorare con l assistente docente su richieste libere o strutturate.',
        examples: [
          'Preparare una spiegazione semplificata di un argomento.',
          'Chiedere una scaletta per una lezione o una verifica.',
          'Riformulare un testo per livelli diversi della classe.',
        ],
        standardFlow: [
          'Apri la pagina principale docente.',
          'Seleziona il tipo di richiesta o scrivi il prompt.',
          'Rivedi l output, iteralo e trasformalo nel formato finale utile.',
        ],
        extraOptions: [
          'Puoi allegare file, dati o immagini secondo il flusso scelto.',
          'Sono disponibili modalita specifiche come report, quiz, immagine, dataset, analisi, brochure e dispensa.',
        ],
        classSharing: 'No',
        outputFormat: 'Conversazione, bozze testuali o payload strutturati per i moduli collegati.',
      },
      {
        title: 'Generazione immagini',
        path: 'Docente / Supporto / Immagine',
        description: 'Modalita dedicata alla creazione di immagini o visual utili per materiali, slide e attivita.',
        examples: [
          'Generare un illustrazione per una lezione.',
          'Creare un immagine concettuale per una brochure o una dispensa.',
          'Preparare visual per spiegazioni o schede.',
        ],
        standardFlow: [
          'Apri il supporto docente e seleziona la modalita immagine.',
          'Descrivi in modo preciso stile, contenuto e uso previsto.',
          'Rivedi il risultato e genera varianti se necessario.',
        ],
        extraOptions: [
          'Le immagini possono essere riusate in documenti o materiali generati dopo.',
        ],
        classSharing: 'No',
        outputFormat: 'Asset immagine generato in chat o collegabile a materiali successivi.',
      },
      {
        title: 'Generatore dataset',
        path: 'Docente / Supporto / Dataset',
        description: 'Permette di costruire dataset sintetici per laboratori, esempi o esercitazioni guidate.',
        examples: [
          'Creare un dataset per un laboratorio di classificazione.',
          'Preparare dati di esempio per statistica o grafici.',
          'Simulare dati coerenti con un caso di studio disciplinare.',
        ],
        standardFlow: [
          'Seleziona la modalita dataset.',
          'Definisci colonne, volume, vincoli e scenario didattico.',
          'Verifica la struttura e riusa il dataset nei moduli successivi.',
        ],
        extraOptions: [
          'Utile come ponte verso ML Lab o attivita notebook.',
        ],
        classSharing: 'Si',
        outputFormat: 'Dataset tabellare, tipicamente CSV o struttura esportabile.',
      },
    ],
  },
  {
    id: 'classes-sessions',
    title: 'Classi e sessioni',
    description: 'Gestione organizzativa del lavoro didattico: classi, sessioni, moduli attivi e monitoraggio live.',
    icon: Users,
    features: [
      {
        title: 'Classi',
        path: 'Docente / Classi',
        description: 'Serve a creare e organizzare le classi, da cui poi dipendono le sessioni operative.',
        examples: [
          'Creare una nuova classe per un corso o una materia.',
          'Aggiornare il nome o il grado scolastico.',
          'Accedere rapidamente alle sessioni associate.',
        ],
        standardFlow: [
          'Apri Classi.',
          'Crea o modifica la classe desiderata.',
          'Entra nelle sessioni della classe per attivare il lavoro con gli studenti.',
        ],
        extraOptions: [
          'Le classi fanno da contenitore organizzativo per sessioni e UDA.',
        ],
        classSharing: 'Si',
        outputFormat: 'Configurazione di classe salvata in piattaforma.',
      },
      {
        title: 'Sessioni',
        path: 'Docente / Sessioni',
        description: 'Le sessioni definiscono il contesto operativo concreto della classe, con moduli attivi e codice di accesso.',
        examples: [
          'Aprire una nuova sessione per una lezione laboratoriale.',
          'Abilitare o disabilitare moduli per una specifica attività.',
          'Gestire il join code della sessione.',
        ],
        standardFlow: [
          'Apri Sessioni o entra da una classe.',
          'Crea la sessione e configura i moduli necessari.',
          'Avvia il lavoro e distribuisci il codice di accesso agli studenti.',
        ],
        extraOptions: [
          'Ogni sessione puo avere moduli e impostazioni diverse.',
        ],
        classSharing: 'Si',
        outputFormat: 'Sessione didattica configurata con stato, moduli e accesso.',
      },
      {
        title: 'Monitor live della sessione',
        path: 'Docente / Sessione live',
        description: 'Pagina operativa per osservare la sessione, seguire la classe, aprire task e vedere lo storico.',
        examples: [
          'Controllare chi e connesso.',
          'Aprire il tab dei compiti dalla sessione corrente.',
          'Consultare cronologia o chat legata alla lezione.',
        ],
        standardFlow: [
          'Apri una sessione specifica.',
          'Usa i tab laterali per live, compiti e storico.',
          'Intervieni sul lavoro della classe in tempo reale.',
        ],
        extraOptions: [
          'La sidebar chat puo essere fissata o nascosta in base allo spazio disponibile.',
        ],
        classSharing: 'Si',
        outputFormat: 'Vista operativa della sessione e dei suoi dati live.',
      },
    ],
  },
  {
    id: 'teacherbots-and-studentbot',
    title: 'Teacherbot e Studentbot',
    description: 'Strumenti per creare assistenti dedicati agli studenti o vedere l esperienza studente in anteprima.',
    icon: Bot,
    features: [
      {
        title: 'Teacherbot',
        path: 'Docente / Supporto / Teacherbot',
        description: 'Permette di creare e pubblicare assistenti verticali con istruzioni, knowledge base e comportamento controllato.',
        examples: [
          'Pubblicare un bot di storia legato a una dispensa.',
          'Creare un assistente per una simulazione guidata di materia.',
          'Distribuire un bot con knowledge base specifica della lezione.',
        ],
        standardFlow: [
          'Apri il pannello Teacherbot.',
          'Configura identita, istruzioni e documenti di knowledge base.',
          'Pubblica il bot e rendilo disponibile agli studenti della sessione.',
        ],
        extraOptions: [
          'Sono disponibili configurazioni proattive e knowledge base dedicate.',
        ],
        classSharing: 'Si',
        outputFormat: 'Assistente pubblicato e accessibile agli studenti autorizzati.',
      },
      {
        title: 'Studentbot / anteprima studente',
        path: 'Docente / Studentbot',
        description: 'Consente di visualizzare l interfaccia studente e verificare come vengono mostrati moduli e strumenti.',
        examples: [
          'Controllare l esperienza utente prima della lezione.',
          'Verificare che un modulo sia effettivamente visibile.',
          'Testare il comportamento di un percorso lato studente.',
        ],
        standardFlow: [
          'Apri Studentbot dalla navbar docente.',
          'Naviga l interfaccia studente in anteprima.',
          'Esci dall anteprima e torna al pannello docente.',
        ],
        extraOptions: [
          'Utile per QA rapido prima di una sessione live.',
        ],
        classSharing: 'No',
        outputFormat: 'Vista anteprima dell esperienza studente.',
      },
    ],
  },
  {
    id: 'documents-and-notebooks',
    title: 'Documenti e notebook',
    description: 'Area per produrre materiali, canvas strutturati e notebook di lavoro.',
    icon: FileText,
    features: [
      {
        title: 'Materiali e documenti docente',
        path: 'Docente / Documenti',
        description: 'Modulo per creare, modificare o rifinire contenuti documentali e materiali didattici.',
        examples: [
          'Preparare una brochure o una dispensa.',
          'Costruire una scheda o un report con layout strutturato.',
          'Rivedere contenuti prima della distribuzione.',
        ],
        standardFlow: [
          'Apri Documenti.',
          'Scegli il formato o il task documentale da costruire.',
          'Genera, modifica e valida il materiale finale.',
        ],
        extraOptions: [
          'Puoi partire da output del supporto docente e rifinirli nel canvas.',
        ],
        classSharing: 'Si',
        outputFormat: 'Documento, canvas o materiale strutturato pronto per uso didattico.',
      },
      {
        title: 'Notebook',
        path: 'Docente / Notebook',
        description: 'Ambiente di notebook per coding, prototipi didattici e attività tecniche.',
        examples: [
          'Preparare un notebook guida per una lezione.',
          'Costruire esempi Python da mostrare in classe.',
          'Verificare piccoli script o flussi dati.',
        ],
        standardFlow: [
          'Apri Notebook.',
          'Crea o seleziona un progetto.',
          'Scrivi, esegui e aggiorna le celle fino alla versione finale.',
        ],
        extraOptions: [
          'Puoi usare il notebook come supporto per attivita computazionali o coding.',
        ],
        classSharing: 'Dipende',
        outputFormat: 'Notebook con celle, codice e output eseguiti.',
      },
    ],
  },
  {
    id: 'ml-and-desktop',
    title: 'ML Lab e Desktop',
    description: 'Strumenti per attività dati e per la personalizzazione dello spazio operativo del docente.',
    icon: LayoutDashboard,
    features: [
      {
        title: 'ML Lab',
        path: 'Docente / ML Lab',
        description: 'Laboratorio per dataset, esperimenti e lettura dei risultati in chiave didattica.',
        examples: [
          'Preparare un esperimento da mostrare alla classe.',
          'Caricare un dataset e confrontare risultati.',
          'Usare dati sintetici creati poco prima nel supporto docente.',
        ],
        standardFlow: [
          'Apri ML Lab.',
          'Seleziona dataset e configurazione.',
          'Lancia l esperimento e analizza metriche e visualizzazioni.',
        ],
        extraOptions: [
          'Si presta a dimostrazioni in classe o a preparazione di esercitazioni.',
        ],
        classSharing: 'Si',
        outputFormat: 'Dataset, esperimenti, metriche e grafici interni al laboratorio.',
      },
      {
        title: 'Desktop docente',
        path: 'Docente / Desktop',
        description: 'Workspace personalizzabile con widget, scorciatoie e disposizione del lavoro.',
        examples: [
          'Organizzare i widget piu usati per la giornata.',
          'Tenere a portata di mano chat, sessioni o moduli preferiti.',
          'Separare flussi diversi in desktop distinti.',
        ],
        standardFlow: [
          'Apri Desktop.',
          'Aggiungi, sposta o ridimensiona i widget disponibili.',
          'Salva il layout operativo piu utile per il tuo lavoro.',
        ],
        extraOptions: [
          'Il desktop puo essere usato come hub personale del docente.',
        ],
        classSharing: 'No',
        outputFormat: 'Layout personale con widget e configurazioni salvate.',
      },
    ],
  },
]

interface TeacherWikiPageProps {
  accentId?: TeacherAccentId
}

export default function TeacherWikiPage({ accentId = DEFAULT_TEACHER_ACCENT }: TeacherWikiPageProps) {
  const theme = getTeacherAccentTheme(accentId)

  return (
    <WikiGuidePage
      roleLabel="Wiki Docente"
      title="Guida operativa per la piattaforma docente"
      intro="Questa wiki organizza le funzionalita lato docente per aree di lavoro. Ogni scheda mostra lo scopo della funzione, il flusso standard d uso, alcuni esempi concreti e il tipo di output atteso, cosi da avere una mappa unica della piattaforma."
      sections={TEACHER_WIKI_SECTIONS}
      accentColor={theme.accent}
      accentSoft={theme.soft}
      accentText={theme.text}
    />
  )
}
