import {
  Bot,
  FileText,
  LayoutDashboard,
  MessageSquare,
  Users,
} from '@/components/icons'
import WikiGuidePage, { type WikiSection } from '@/components/wiki/WikiGuidePage'
import { DEFAULT_TEACHER_ACCENT, getTeacherAccentTheme, type TeacherAccentId } from '@/lib/teacherAccent'
import { useTranslation } from 'react-i18next'
import { tl } from '@/i18n/tl'

function getTeacherWikiSections(isEnglish: boolean): WikiSection[] {
  const sharing = isEnglish
    ? { yes: 'Yes', no: 'No', depends: 'Depends' }
    : { yes: 'Si', no: 'No', depends: 'Dipende' }

  if (isEnglish) {
    return [
      {
        id: 'support-chat',
        title: tl("AI Teacher Support"),
        description: 'Main teacher workspace for generating teaching materials, drafts, analyses, and assisted classroom content.',
        icon: MessageSquare,
        features: [
          {
            title: tl("Teacher Support Chat"),
            path: 'Teacher / Support / Chat',
            description: 'This is the main entry point for working with the teacher assistant on open-ended or structured requests.',
            examples: [
              'Prepare a simplified explanation of a topic.',
              'Ask for a lesson outline or assessment structure.',
              'Rewrite a text for different student levels.',
            ],
            standardFlow: [
              'Open the main teacher page.',
              'Select the request type or write the prompt directly.',
              'Review the output, iterate on it, and turn it into the final material you need.',
            ],
            extraOptions: [
              'You can attach files, data, or images depending on the selected workflow.',
              'Specific modes are available for reports, quizzes, images, datasets, analysis, brochures, and lesson handouts.',
            ],
            classSharing: sharing.no,
            outputFormat: 'Conversation, textual drafts, or structured payloads for connected modules.',
          },
          {
            title: 'Image Generation',
            path: 'Teacher / Support / Image',
            description: 'A mode dedicated to creating images and visuals for materials, slides, and classroom activities.',
            examples: [
              'Generate an illustration for a lesson.',
              'Create a conceptual image for a brochure or handout.',
              'Prepare visuals for explanations or worksheets.',
            ],
            standardFlow: [
              'Open teacher support and select image mode.',
              'Describe style, content, and intended use precisely.',
              'Review the result and generate variants if needed.',
            ],
            extraOptions: [
              'Images can be reused later inside documents or generated materials.',
            ],
            classSharing: sharing.no,
            outputFormat: 'Generated image asset delivered in chat or connected to later materials.',
          },
          {
            title: 'Dataset Generator',
            path: 'Teacher / Support / Dataset',
            description: 'Build synthetic datasets for labs, examples, or guided exercises.',
            examples: [
              'Create a dataset for a classification lab.',
              'Prepare sample data for statistics or charts.',
              'Simulate data aligned with a subject-specific case study.',
            ],
            standardFlow: [
              'Select dataset mode.',
              'Define columns, volume, constraints, and teaching scenario.',
              'Review the structure and reuse the dataset in later modules.',
            ],
            extraOptions: [
              'Useful as a bridge toward ML Lab or notebook activities.',
            ],
            classSharing: sharing.yes,
            outputFormat: 'Tabular dataset, usually CSV or another exportable structure.',
          },
        ],
      },
      {
        id: 'classes-sessions',
        title: 'Classes and Sessions',
        description: 'Organisational management for teaching work: classes, sessions, active modules, and live monitoring.',
        icon: Users,
        features: [
          {
            title: 'Classes',
            path: 'Teacher / Classes',
            description: 'Create and organise classes, which act as the container for operational sessions.',
            examples: [
              'Create a new class for a course or subject.',
              'Update the class name or school grade.',
              'Open the related sessions quickly.',
            ],
            standardFlow: [
              'Open Classes.',
              'Create or edit the desired class.',
              'Enter the class sessions to activate work with students.',
            ],
            extraOptions: [
              'Classes act as the organisational container for sessions and learning units.',
            ],
            classSharing: sharing.yes,
            outputFormat: 'Class configuration saved in the platform.',
          },
          {
            title: 'Sessions',
            path: 'Teacher / Sessions',
            description: 'Sessions define the concrete working context for the class, including active modules and the join code.',
            examples: [
              'Open a new session for a lab lesson.',
              'Enable or disable modules for a specific activity.',
              'Manage the session join code.',
            ],
            standardFlow: [
              'Open Sessions or enter from a class.',
              'Create the session and configure the required modules.',
              'Start the activity and share the access code with students.',
            ],
            extraOptions: [
              'Each session can have different modules and settings.',
            ],
            classSharing: sharing.yes,
            outputFormat: 'Configured teaching session with status, modules, and access settings.',
          },
          {
            title: 'Live Session Monitor',
            path: 'Teacher / Live Session',
            description: 'Operational page for observing the session, following the class, opening tasks, and checking history.',
            examples: [
              'Check who is connected.',
              'Open the tasks tab of the current session.',
              'Review history or chat linked to the lesson.',
            ],
            standardFlow: [
              'Open a specific session.',
              'Use the side tabs for live view, tasks, and history.',
              'Intervene on class work in real time.',
            ],
            extraOptions: [
              'The chat sidebar can be pinned or hidden depending on available space.',
            ],
            classSharing: sharing.yes,
            outputFormat: 'Operational view of the session and its live data.',
          },
        ],
      },
      {
        id: 'teacherbots-and-studentbot',
        title: 'Teacherbot and Student Preview',
        description: 'Tools for creating student-facing assistants or previewing the student experience before class.',
        icon: Bot,
        features: [
          {
            title: 'Teacherbot',
            path: 'Teacher / Support / Teacherbot',
            description: 'Create and publish vertical assistants with instructions, a knowledge base, and controlled behaviour.',
            examples: [
              'Publish a history bot linked to a handout.',
              'Create an assistant for a guided subject simulation.',
              'Distribute a bot with lesson-specific knowledge base content.',
            ],
            standardFlow: [
              'Open the Teacherbot panel.',
              'Configure identity, instructions, and knowledge base documents.',
              'Publish the bot and make it available to the session students.',
            ],
            extraOptions: [
              'Proactive behaviours and dedicated knowledge bases are supported.',
            ],
            classSharing: sharing.yes,
            outputFormat: 'Published assistant available to authorised students.',
          },
          {
            title: 'Studentbot / Student Preview',
            path: 'Teacher / Studentbot',
            description: 'Preview the student interface and verify how modules and tools are presented.',
            examples: [
              'Check the user experience before the lesson.',
              'Verify that a module is actually visible.',
              'Test how a student-side path behaves.',
            ],
            standardFlow: [
              'Open Studentbot from the teacher navbar.',
              'Navigate the student interface in preview mode.',
              'Exit preview and return to the teacher panel.',
            ],
            extraOptions: [
              'Useful for quick QA before a live session.',
            ],
            classSharing: sharing.no,
            outputFormat: 'Preview view of the student experience.',
          },
        ],
      },
      {
        id: 'documents-and-notebooks',
        title: 'Documents and Notebook',
        description: 'Area for producing teaching materials, structured canvases, and technical notebook work.',
        icon: FileText,
        features: [
          {
            title: 'Teacher Materials and Documents',
            path: 'Teacher / Documents',
            description: 'Create, edit, and refine document-based materials and teaching assets.',
            examples: [
              'Prepare a brochure or handout.',
              'Build a worksheet or report with a structured layout.',
              'Review content before distribution.',
            ],
            standardFlow: [
              'Open Documents.',
              'Choose the format or document task to build.',
              'Generate, edit, and validate the final material.',
            ],
            extraOptions: [
              'You can start from teacher-support outputs and refine them in the canvas.',
            ],
            classSharing: sharing.yes,
            outputFormat: 'Document, canvas, or structured teaching material ready for classroom use.',
          },
          {
            title: 'Coding Lab',
            path: 'Teacher / Notebook',
            description: 'Notebook environment for coding, teaching prototypes, and technical activities.',
            examples: [
              'Prepare a guided notebook for a lesson.',
              'Build Python examples to show in class.',
              'Check small scripts or data flows.',
            ],
            standardFlow: [
              'Open Coding Lab.',
              'Create or select a project.',
              'Write, run, and update the cells until the notebook is ready.',
            ],
            extraOptions: [
              'Useful for computational activities, demonstrations, or coding support.',
            ],
            classSharing: sharing.depends,
            outputFormat: 'Notebook with cells, code, and executed outputs.',
          },
        ],
      },
      {
        id: 'ml-and-desktop',
        title: 'ML Lab and Desktop',
        description: 'Tools for data activities and for personalising the teacher workspace.',
        icon: LayoutDashboard,
        features: [
          {
            title: 'ML Lab',
            path: 'Teacher / ML Lab',
            description: 'Lab for datasets, experiments, and interpretation of results in a teaching context.',
            examples: [
              'Prepare an experiment to show to the class.',
              'Upload a dataset and compare outcomes.',
              'Reuse synthetic data created moments earlier in teacher support.',
            ],
            standardFlow: [
              'Open ML Lab.',
              'Select the dataset and configuration.',
              'Run the experiment and analyse metrics and visualisations.',
            ],
            extraOptions: [
              'It works well for in-class demonstrations or for preparing exercises.',
            ],
            classSharing: sharing.yes,
            outputFormat: 'Datasets, experiments, metrics, and charts inside the lab.',
          },
          {
            title: 'Teacher Desktop',
            path: 'Teacher / Desktop',
            description: 'Customisable workspace with widgets, shortcuts, and layout control.',
            examples: [
              'Organise the most-used widgets for the day.',
              'Keep chat, sessions, or favourite modules within reach.',
              'Separate different workflows into different desktop layouts.',
            ],
            standardFlow: [
              'Open Desktop.',
              'Add, move, or resize the available widgets.',
              'Save the working layout that best fits your routine.',
            ],
            extraOptions: [
              'The desktop can be used as the personal hub for teacher work.',
            ],
            classSharing: sharing.no,
            outputFormat: 'Personal layout with saved widgets and workspace settings.',
          },
        ],
      },
    ]
  }

  return [
    {
      id: 'support-chat',
      title: tl("Supporto docente AI"),
      description: tl("Area principale del docente per generare materiali, bozze, analisi e contenuti didattici assistiti."),
      icon: MessageSquare,
      features: [
        {
          title: tl("Chat di supporto docente"),
          path: 'Docente / Supporto / Chat',
          description: tl("E il punto di ingresso principale per lavorare con l assistente docente su richieste libere o strutturate."),
          examples: [
            tl("Preparare una spiegazione semplificata di un argomento."),
            tl("Chiedere una scaletta per una lezione o una verifica."),
            tl("Riformulare un testo per livelli diversi della classe."),
          ],
          standardFlow: [
            tl("Apri la pagina principale docente."),
            tl("Seleziona il tipo di richiesta o scrivi il prompt."),
            tl("Rivedi l output, iteralo e trasformalo nel formato finale utile."),
          ],
          extraOptions: [
            tl("Puoi allegare file, dati o immagini secondo il flusso scelto."),
            tl("Sono disponibili modalita specifiche come report, quiz, immagine, dataset, analisi, brochure e dispensa."),
          ],
          classSharing: sharing.no,
          outputFormat: tl("Conversazione, bozze testuali o payload strutturati per i moduli collegati."),
        },
        {
          title: tl("Generazione immagini"),
          path: 'Docente / Supporto / Immagine',
          description: tl("Modalita dedicata alla creazione di immagini o visual utili per materiali, slide e attivita."),
          examples: [
            tl("Generare un illustrazione per una lezione."),
            tl("Creare un immagine concettuale per una brochure o una dispensa."),
            tl("Preparare visual per spiegazioni o schede."),
          ],
          standardFlow: [
            tl("Apri il supporto docente e seleziona la modalita immagine."),
            tl("Descrivi in modo preciso stile, contenuto e uso previsto."),
            tl("Rivedi il risultato e genera varianti se necessario."),
          ],
          extraOptions: [
            tl("Le immagini possono essere riusate in documenti o materiali generati dopo."),
          ],
          classSharing: sharing.no,
          outputFormat: tl("Asset immagine generato in chat o collegabile a materiali successivi."),
        },
        {
          title: tl("Generatore dataset"),
          path: 'Docente / Supporto / Dataset',
          description: tl("Permette di costruire dataset sintetici per laboratori, esempi o esercitazioni guidate."),
          examples: [
            tl("Creare un dataset per un laboratorio di classificazione."),
            tl("Preparare dati di esempio per statistica o grafici."),
            tl("Simulare dati coerenti con un caso di studio disciplinare."),
          ],
          standardFlow: [
            tl("Seleziona la modalita dataset."),
            tl("Definisci colonne, volume, vincoli e scenario didattico."),
            tl("Verifica la struttura e riusa il dataset nei moduli successivi."),
          ],
          extraOptions: [
            tl("Utile come ponte verso ML Lab o attivita notebook."),
          ],
          classSharing: sharing.yes,
          outputFormat: tl("Dataset tabellare, tipicamente CSV o struttura esportabile."),
        },
      ],
    },
    {
      id: 'classes-sessions',
      title: tl("Classi e sessioni"),
      description: tl("Gestione organizzativa del lavoro didattico: classi, sessioni, moduli attivi e monitoraggio live."),
      icon: Users,
      features: [
        {
          title: tl("Classi"),
          path: 'Docente / Classi',
          description: tl("Serve a creare e organizzare le classi, da cui poi dipendono le sessioni operative."),
          examples: [
            tl("Creare una nuova classe per un corso o una materia."),
            tl("Aggiornare il nome o il grado scolastico."),
            tl("Accedere rapidamente alle sessioni associate."),
          ],
          standardFlow: [
            tl("Apri Classi."),
            tl("Crea o modifica la classe desiderata."),
            tl("Entra nelle sessioni della classe per attivare il lavoro con gli studenti."),
          ],
          extraOptions: [
            tl("Le classi fanno da contenitore organizzativo per sessioni e UDA."),
          ],
          classSharing: sharing.yes,
          outputFormat: tl("Configurazione di classe salvata in piattaforma."),
        },
        {
          title: tl("Sessioni"),
          path: 'Docente / Sessioni',
          description: tl("Le sessioni definiscono il contesto operativo concreto della classe, con moduli attivi e codice di accesso."),
          examples: [
            tl("Aprire una nuova sessione per una lezione laboratoriale."),
            tl("Abilitare o disabilitare moduli per una specifica attivita."),
            tl("Gestire il join code della sessione."),
          ],
          standardFlow: [
            tl("Apri Sessioni o entra da una classe."),
            tl("Crea la sessione e configura i moduli necessari."),
            tl("Avvia il lavoro e distribuisci il codice di accesso agli studenti."),
          ],
          extraOptions: [
            tl("Ogni sessione puo avere moduli e impostazioni diverse."),
          ],
          classSharing: sharing.yes,
          outputFormat: tl("Sessione didattica configurata con stato, moduli e accesso."),
        },
        {
          title: tl("Monitor live della sessione"),
          path: 'Docente / Sessione live',
          description: tl("Pagina operativa per osservare la sessione, seguire la classe, aprire task e vedere lo storico."),
          examples: [
            tl("Controllare chi e connesso."),
            tl("Aprire il tab dei compiti dalla sessione corrente."),
            tl("Consultare cronologia o chat legata alla lezione."),
          ],
          standardFlow: [
            tl("Apri una sessione specifica."),
            tl("Usa i tab laterali per live, compiti e storico."),
            tl("Intervieni sul lavoro della classe in tempo reale."),
          ],
          extraOptions: [
            tl("La sidebar chat puo essere fissata o nascosta in base allo spazio disponibile."),
          ],
          classSharing: sharing.yes,
          outputFormat: tl("Vista operativa della sessione e dei suoi dati live."),
        },
      ],
    },
    {
      id: 'teacherbots-and-studentbot',
      title: 'Teacherbot e Studentbot',
      description: tl("Strumenti per creare assistenti dedicati agli studenti o vedere l esperienza studente in anteprima."),
      icon: Bot,
      features: [
        {
          title: 'Teacherbot',
          path: 'Docente / Supporto / Teacherbot',
          description: tl("Permette di creare e pubblicare assistenti verticali con istruzioni, knowledge base e comportamento controllato."),
          examples: [
            tl("Pubblicare un bot di storia legato a una dispensa."),
            tl("Creare un assistente per una simulazione guidata di materia."),
            tl("Distribuire un bot con knowledge base specifica della lezione."),
          ],
          standardFlow: [
            tl("Apri il pannello Teacherbot."),
            tl("Configura identita, istruzioni e documenti di knowledge base."),
            tl("Pubblica il bot e rendilo disponibile agli studenti della sessione."),
          ],
          extraOptions: [
            tl("Sono disponibili configurazioni proattive e knowledge base dedicate."),
          ],
          classSharing: sharing.yes,
          outputFormat: tl("Assistente pubblicato e accessibile agli studenti autorizzati."),
        },
        {
          title: tl("Studentbot / anteprima studente"),
          path: 'Docente / Studentbot',
          description: tl("Consente di visualizzare l interfaccia studente e verificare come vengono mostrati moduli e strumenti."),
          examples: [
            tl("Controllare l esperienza utente prima della lezione."),
            tl("Verificare che un modulo sia effettivamente visibile."),
            tl("Testare il comportamento di un percorso lato studente."),
          ],
          standardFlow: [
            tl("Apri Studentbot dalla navbar docente."),
            tl("Naviga l interfaccia studente in anteprima."),
            tl("Esci dall anteprima e torna al pannello docente."),
          ],
          extraOptions: [
            tl("Utile per QA rapido prima di una sessione live."),
          ],
          classSharing: sharing.no,
          outputFormat: tl("Vista anteprima dell esperienza studente."),
        },
      ],
    },
    {
      id: 'documents-and-notebooks',
      title: tl("Documenti e notebook"),
      description: tl("Area per produrre materiali, canvas strutturati e notebook di lavoro."),
      icon: FileText,
      features: [
        {
          title: tl("Materiali e documenti docente"),
          path: 'Docente / Documenti',
          description: tl("Modulo per creare, modificare o rifinire contenuti documentali e materiali didattici."),
          examples: [
            tl("Preparare una brochure o una dispensa."),
            tl("Costruire una scheda o un report con layout strutturato."),
            tl("Rivedere contenuti prima della distribuzione."),
          ],
          standardFlow: [
            tl("Apri Documenti."),
            tl("Scegli il formato o il task documentale da costruire."),
            tl("Genera, modifica e valida il materiale finale."),
          ],
          extraOptions: [
            tl("Puoi partire da output del supporto docente e rifinirli nel canvas."),
          ],
          classSharing: sharing.yes,
          outputFormat: tl("Documento, canvas o materiale strutturato pronto per uso didattico."),
        },
        {
          title: 'Coding Lab',
          path: 'Docente / Notebook',
          description: tl("Ambiente di notebook per coding, prototipi didattici e attivita tecniche."),
          examples: [
            tl("Preparare un notebook guida per una lezione."),
            tl("Costruire esempi Python da mostrare in classe."),
            tl("Verificare piccoli script o flussi dati."),
          ],
          standardFlow: [
            tl("Apri Coding Lab."),
            tl("Crea o seleziona un progetto."),
            tl("Scrivi, esegui e aggiorna le celle fino alla versione finale."),
          ],
          extraOptions: [
            tl("Puoi usare il notebook come supporto per attivita computazionali o coding."),
          ],
          classSharing: sharing.depends,
          outputFormat: tl("Notebook con celle, codice e output eseguiti."),
        },
      ],
    },
    {
      id: 'ml-and-desktop',
      title: tl("ML Lab e Desktop"),
      description: tl("Strumenti per attivita dati e per la personalizzazione dello spazio operativo del docente."),
      icon: LayoutDashboard,
      features: [
        {
          title: 'ML Lab',
          path: 'Docente / ML Lab',
          description: tl("Laboratorio per dataset, esperimenti e lettura dei risultati in chiave didattica."),
          examples: [
            tl("Preparare un esperimento da mostrare alla classe."),
            tl("Caricare un dataset e confrontare risultati."),
            tl("Usare dati sintetici creati poco prima nel supporto docente."),
          ],
          standardFlow: [
            tl("Apri ML Lab."),
            tl("Seleziona dataset e configurazione."),
            tl("Lancia l esperimento e analizza metriche e visualizzazioni."),
          ],
          extraOptions: [
            tl("Si presta a dimostrazioni in classe o a preparazione di esercitazioni."),
          ],
          classSharing: sharing.yes,
          outputFormat: tl("Dataset, esperimenti, metriche e grafici interni al laboratorio."),
        },
        {
          title: tl("Desktop docente"),
          path: 'Docente / Desktop',
          description: tl("Workspace personalizzabile con widget, scorciatoie e disposizione del lavoro."),
          examples: [
            tl("Organizzare i widget piu usati per la giornata."),
            tl("Tenere a portata di mano chat, sessioni o moduli preferiti."),
            tl("Separare flussi diversi in desktop distinti."),
          ],
          standardFlow: [
            tl("Apri Desktop."),
            tl("Aggiungi, sposta o ridimensiona i widget disponibili."),
            tl("Salva il layout operativo piu utile per il tuo lavoro."),
          ],
          extraOptions: [
            tl("Il desktop puo essere usato come hub personale del docente."),
          ],
          classSharing: sharing.no,
          outputFormat: tl("Layout personale con widget e configurazioni salvate."),
        },
      ],
    },
  ]
}

interface TeacherWikiPageProps {
  accentId?: TeacherAccentId
}

export default function TeacherWikiPage({ accentId = DEFAULT_TEACHER_ACCENT }: TeacherWikiPageProps) {
  const { i18n } = useTranslation()
  const isEnglish = i18n.resolvedLanguage?.startsWith('en') ?? false
  const theme = getTeacherAccentTheme(accentId)

  return (
    <WikiGuidePage
      roleLabel={isEnglish ? 'Teacher Wiki' : 'Wiki Docente'}
      title={isEnglish ? 'Operational guide for the teacher platform' : 'Guida operativa per la piattaforma docente'}
      intro={isEnglish
        ? 'This wiki organises the teacher-side features by work area. Each card shows the goal of the feature, the standard usage flow, concrete examples, and the expected output so you have a single map of the platform.'
        : 'Questa wiki organizza le funzionalita lato docente per aree di lavoro. Ogni scheda mostra lo scopo della funzione, il flusso standard d uso, alcuni esempi concreti e il tipo di output atteso, cosi da avere una mappa unica della piattaforma.'}
      sections={getTeacherWikiSections(isEnglish)}
      accentColor={theme.accent}
      accentSoft={theme.soft}
      accentText={theme.text}
    />
  )
}
