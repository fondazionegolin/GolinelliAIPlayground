import {
  Bot,
  Brain,
  FileCode2,
  FileText,
  LayoutDashboard,
} from '@/components/icons'
import WikiGuidePage, { type WikiSection } from '@/components/wiki/WikiGuidePage'
import { getStudentAccentTheme, loadStudentAccent } from '@/lib/studentAccent'
import { useTranslation } from 'react-i18next'
import { tl } from '@/i18n/tl'

function getStudentWikiSections(isEnglish: boolean): WikiSection[] {
  const sharing = isEnglish
    ? { yes: 'Yes', no: 'No', depends: 'Depends' }
    : { yes: 'Si', no: 'No', depends: 'Dipende' }

  if (isEnglish) {
    return [
      {
        id: 'chatbot',
        title: 'Chatbot',
        description: 'The chatbot area gathers tutors, specialised assistants, teacher-published bots, and your personal RAG workspace.',
        icon: Bot,
        features: [
          {
            title: tl("AI Assistants"),
            path: 'Student / Chatbot / AI Assistants',
            description: 'Choose a profile such as tutor, quiz coach, oral practice coach, or math coach to work in chat on a specific goal.',
            examples: [
              'Ask for a step-by-step explanation of a difficult concept.',
              'Prepare an oral exam simulation on a study topic.',
              'Get a guided review before a test.',
            ],
            standardFlow: [
              'Open Chatbot and choose the most suitable profile.',
              'Write your goal or provide the starting material.',
              'Continue the conversation across multiple turns until the answer is clear or the output is ready.',
            ],
            extraOptions: [
              'You can attach files or images depending on the selected profile.',
              'Some profiles guide you with progressive questions instead of a single direct answer.',
            ],
            classSharing: sharing.no,
            outputFormat: 'Chat response, quizzes, or structured study content generated inside the conversation.',
          },
          {
            title: 'Teacherbots',
            path: 'Student / Chatbot / Teacherbot',
            description: 'These are assistants published by the teacher with dedicated instructions and a knowledge base linked to a lesson or subject.',
            examples: [
              'Use the class history bot to review only the assigned syllabus.',
              'Ask questions about a handout uploaded by the teacher.',
              'Receive explanations aligned with the teaching approach of the session.',
            ],
            standardFlow: [
              'Open Chatbot and select an available teacherbot.',
              'Ask questions about the topic or linked materials.',
              'Continue the conversation inside the saved bot history.',
            ],
            extraOptions: [
              'Behaviour depends on how the teacher configured the bot.',
              'Some teacherbots may be proactive and published only for specific sessions.',
            ],
            classSharing: sharing.depends,
            outputFormat: 'Chat conversation shaped by the teacher-defined context.',
          },
          {
            title: 'Personal Knowledge Base (RAG)',
            path: 'Student / Chatbot / Knowledge Base',
            description: 'Upload your own documents and query only those sources, with clickable citations and a source panel.',
            examples: [
              'Upload a handout and ask for a chapter-by-chapter summary.',
              'Upload a form or report and ask for a precise detail found in the text.',
              'Compare multiple selected documents in the same session.',
            ],
            standardFlow: [
              'Upload one or more documents in the Documents column.',
              'Select all documents or only the relevant ones.',
              'Send your question and review the Sources column for the passages used.',
            ],
            extraOptions: [
              'Citations like [[n]] open the exact source passage used in the answer.',
              'RAG sessions save history, document filters, and recent sources.',
            ],
            classSharing: sharing.no,
            outputFormat: 'Chat answer with citations and a side panel showing retrieved sources.',
          },
          {
            title: 'Dataset Generator',
            path: 'Student / Chatbot / Dataset Generator',
            description: 'A specialised assistant can help you design a synthetic dataset from columns, constraints, and a target number of rows.',
            examples: [
              'Create a student-grades dataset to test charts or models.',
              'Generate plausible tabular data for a machine learning exercise.',
              'Prepare a CSV with custom columns and consistent values.',
            ],
            standardFlow: [
              'Select the dataset generator profile.',
              'Define the context, columns, row count, and rules.',
              'Review the output and download it or reuse it in later modules.',
            ],
            extraOptions: [
              'You can impose formats, value ranges, and relationships between columns.',
              'This is useful as a preparation step for ML Lab or data analysis.',
            ],
            classSharing: sharing.no,
            outputFormat: 'Tabular dataset, usually as CSV or another exportable table structure.',
          },
        ],
      },
      {
        id: 'documents',
        title: 'Documents',
        description: 'This area is where you work on document-based assignments, teacher lessons, and materials to complete or submit.',
        icon: FileText,
        features: [
          {
            title: 'Document Assignments',
            path: 'Student / Documents / Assignments',
            description: 'The documents module hosts text assignments, lessons, or presentations that you complete inside the platform.',
            examples: [
              'Complete a guided worksheet assigned by the teacher.',
              'Prepare a short presentation starting from a prompt.',
              'Write a report or argumentative text to submit.',
            ],
            standardFlow: [
              'Open the Documents module or enter from a notification.',
              'Select the assignment or lesson to complete.',
              'Fill in the content and save or submit according to the task.',
            ],
            extraOptions: [
              'Notifications can open the correct document directly.',
              'The structure changes depending on the type of assignment.',
            ],
            classSharing: sharing.yes,
            outputFormat: 'Document or presentation stored in the platform as a submission.',
          },
        ],
      },
      {
        id: 'notebook',
        title: 'Coding Lab',
        description: 'An environment for writing code, running cells, and receiving support during computational activities.',
        icon: FileCode2,
        features: [
          {
            title: 'Coding Notebook',
            path: 'Student / Coding Lab',
            description: 'Work inside a notebook with cells, executable code, and tutorial support.',
            examples: [
              'Write Python scripts for data analysis.',
              'Try small programming or visualisation exercises.',
              'Use the notebook tutor to understand errors or complete a cell.',
            ],
            standardFlow: [
              'Open Coding Lab and create or select a project.',
              'Write code in the cells and run it.',
              'Use assistive tools or tutor support if you need help with the code or output.',
            ],
            extraOptions: [
              'It works both for guided exercises and open projects.',
              'You can iterate quickly between editing, execution, and support.',
            ],
            classSharing: sharing.no,
            outputFormat: 'Notebook with cells and executed outputs stored inside the platform.',
          },
        ],
      },
      {
        id: 'ml-lab',
        title: 'ML Lab',
        description: 'A workspace for classification activities, experiments, and result interpretation on datasets.',
        icon: Brain,
        features: [
          {
            title: 'Classification Lab',
            path: 'Student / ML Lab',
            description: 'Work with datasets, select settings, and inspect classification results.',
            examples: [
              'Test a sample dataset to understand how the model changes.',
              'Compare outcomes by varying columns or settings.',
              'Reuse a dataset generated earlier in the chatbot.',
            ],
            standardFlow: [
              'Open ML Lab and upload or choose a dataset.',
              'Configure the requested experiment or classification setup.',
              'Run the process and interpret the resulting metrics or charts.',
            ],
            extraOptions: [
              'You can combine this module with synthetic datasets created in the chatbot.',
              'It is useful for introductory machine learning activities and result reading.',
            ],
            classSharing: sharing.depends,
            outputFormat: 'Classification results, metrics, and internal visualisations.',
          },
        ],
      },
      {
        id: 'tasks-and-class',
        title: 'Tasks, Class, and Desktop',
        description: 'This section gathers the operational tools of the session: tasks, class chat, and your personal workspace.',
        icon: LayoutDashboard,
        features: [
          {
            title: 'Tasks and Self-Assessment',
            path: 'Student / Tasks',
            description: 'Here you find assigned tasks, quizzes, and exercises, with direct access from session notifications.',
            examples: [
              'Open a quiz assigned by the teacher.',
              'Complete an exercise and submit it before the deadline.',
              'Resume a task that was opened from a notification.',
            ],
            standardFlow: [
              'Open the Tasks module or enter from a notification.',
              'Choose a task that is still pending.',
              'Fill in your answers and submit the work.',
            ],
            extraOptions: [
              'Document-based tasks can redirect automatically to the Documents module.',
              'The pending counter is shown in the student dashboard.',
            ],
            classSharing: sharing.yes,
            outputFormat: 'Quiz attempt or assignment submission linked to the task.',
          },
          {
            title: tl("Class Chat"),
            path: 'Student / Class',
            description: 'A communication channel with classmates and teacher for public or private messages when enabled.',
            examples: [
              'Write a public question to the class.',
              'Receive a private message from the teacher.',
              'Follow live updates during the session.',
            ],
            standardFlow: [
              'Open the Class module.',
              'Read current messages or select the correct thread.',
              'Send your message according to the session permissions.',
            ],
            extraOptions: [
              'Private chat can be enabled or disabled by the teacher.',
              'Notifications can take you to the correct point of the workflow.',
            ],
            classSharing: sharing.yes,
            outputFormat: 'Real-time messages inside the session chat.',
          },
          {
            title: 'Personal Desktop',
            path: 'Student / Desktop',
            description: 'A customisable workspace with widgets and shortcuts to organise your study flow.',
            examples: [
              'Open the chatbot or a document quickly from the home screen.',
              'Keep useful widgets visible during the session.',
              'Use the desktop as the main entry point to the platform.',
            ],
            standardFlow: [
              'Open Desktop.',
              'Add or move the available widgets.',
              'Use the desktop as a hub to enter the main modules.',
            ],
            extraOptions: [
              'The layout can be personalised.',
              'Some widgets point directly to key modules or current activities.',
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
      id: 'chatbot',
      title: 'Chatbot',
      description: tl("L area chatbot raccoglie tutor, assistenti specializzati, bot pubblicati dal docente e workspace RAG personale."),
      icon: Bot,
      features: [
        {
          title: tl("Assistenti AI"),
          path: 'Studente / Chatbot / Assistenti AI',
          description: tl("Scegli un profilo come tutor, quiz coach, orale o math coach per lavorare in chat su un obiettivo preciso."),
          examples: [
            tl("Chiedere una spiegazione progressiva di un concetto difficile."),
            tl("Preparare una simulazione di interrogazione su un argomento di studio."),
            tl("Ottenere un ripasso guidato prima di un compito."),
          ],
          standardFlow: [
            tl("Apri Chatbot e scegli il profilo piu adatto."),
            tl("Scrivi l obiettivo o il materiale di partenza."),
            tl("Interagisci in piu turni fino a chiarire dubbi o ottenere l output desiderato."),
          ],
          extraOptions: [
            tl("Possibile allegare file o immagini al messaggio in base al profilo."),
            tl("Alcuni profili possono guidare con domande progressive invece di risposte uniche."),
          ],
          classSharing: sharing.no,
          outputFormat: tl("Risposta in chat, eventuali quiz o contenuti strutturati generati nel flusso."),
        },
        {
          title: tl("Assistenti del docente"),
          path: 'Studente / Chatbot / Teacherbot',
          description: tl("Sono assistenti pubblicati dal docente con istruzioni e knowledge base dedicate a una lezione o a una materia."),
          examples: [
            tl("Usare il bot di storia della classe per ripassare solo il programma assegnato."),
            tl("Fare domande su una dispensa caricata dal docente."),
            tl("Ricevere chiarimenti coerenti con il taglio didattico della sessione."),
          ],
          standardFlow: [
            tl("Apri Chatbot e seleziona un teacherbot disponibile."),
            tl("Fai domande sul tema o sul materiale collegato."),
            tl("Prosegui la conversazione nella cronologia salvata del bot."),
          ],
          extraOptions: [
            tl("Il comportamento dipende dalla configurazione fatta dal docente."),
            tl("Possono esistere teacherbot proattivi pubblicati solo per alcune sessioni."),
          ],
          classSharing: sharing.depends,
          outputFormat: tl("Conversazione in chat con contesto definito dal docente."),
        },
        {
          title: tl("Knowledge base personale (RAG)"),
          path: 'Studente / Chatbot / Knowledge Base',
          description: tl("Puoi caricare i tuoi documenti e interrogare solo quelle fonti, con citazioni cliccabili e pannello fonti."),
          examples: [
            tl("Caricare una dispensa e chiedere un riassunto per capitolo."),
            tl("Caricare un modulo o un referto e chiedere un dato puntuale presente nel testo."),
            tl("Confrontare piu documenti selezionati nella stessa sessione."),
          ],
          standardFlow: [
            tl("Carica uno o piu documenti nella colonna Documenti."),
            tl("Seleziona tutti i documenti o solo quelli rilevanti."),
            tl("Invia la domanda e controlla la colonna Fonti per i passaggi usati."),
          ],
          extraOptions: [
            tl("Le citazioni [[n]] portano al passaggio sorgente usato nella risposta."),
            tl("Le sessioni RAG salvano cronologia, filtri documentali e fonti recenti."),
          ],
          classSharing: sharing.no,
          outputFormat: tl("Risposta in chat con citazioni e pannello laterale delle fonti recuperate."),
        },
        {
          title: tl("Generatore dataset"),
          path: 'Studente / Chatbot / Generatore Dataset',
          description: tl("Un assistente specializzato puo aiutarti a progettare un dataset sintetico a partire da colonne, vincoli e numero di righe."),
          examples: [
            tl("Creare un dataset studenti-voti per testare grafici o modelli."),
            tl("Generare dati tabellari plausibili per un esercizio di machine learning."),
            tl("Preparare un CSV coerente con colonne personalizzate."),
          ],
          standardFlow: [
            tl("Seleziona il profilo dataset generator."),
            tl("Specifica contesto, colonne, numero di righe e regole."),
            tl("Verifica l output e scaricalo o riusalo nei moduli successivi."),
          ],
          extraOptions: [
            tl("Puoi imporre formati, range di valori e relazioni tra colonne."),
            tl("Utile come passaggio preparatorio per ML Lab o analisi dati."),
          ],
          classSharing: sharing.no,
          outputFormat: tl("Dataset tabellare, tipicamente CSV o struttura tabellare esportabile."),
        },
      ],
    },
    {
      id: 'documents',
      title: tl("Documenti"),
      description: tl("Qui lavori su compiti documentali, lezioni assegnate e materiali da produrre o completare."),
      icon: FileText,
      features: [
        {
          title: tl("Compiti documentali"),
          path: 'Studente / Documenti / Consegne',
          description: tl("Il modulo documenti ospita consegne testuali, lezioni o presentazioni da completare dentro la piattaforma."),
          examples: [
            tl("Completare una scheda guidata assegnata dal docente."),
            tl("Preparare una mini presentazione partendo da una traccia."),
            tl("Scrivere una relazione o un testo argomentativo da consegnare."),
          ],
          standardFlow: [
            tl("Apri il modulo Documenti o entra da una notifica."),
            tl("Seleziona la consegna o la lezione da completare."),
            tl("Compila il contenuto e salva o invia secondo il task."),
          ],
          extraOptions: [
            tl("Le notifiche possono aprire direttamente il documento giusto."),
            tl("Il contenuto puo essere strutturato diversamente in base al tipo di task."),
          ],
          classSharing: sharing.yes,
          outputFormat: tl("Documento o presentazione interna alla piattaforma, salvata come consegna."),
        },
      ],
    },
    {
      id: 'notebook',
      title: 'Coding Lab',
      description: tl("Ambiente per scrivere codice, eseguire celle e ricevere supporto su attivita computazionali."),
      icon: FileCode2,
      features: [
        {
          title: tl("Notebook di coding"),
          path: 'Studente / Coding Lab',
          description: tl("Permette di lavorare in un notebook con celle, codice eseguibile e supporto tutoriale."),
          examples: [
            tl("Scrivere script Python per analisi dati."),
            tl("Provare piccoli esercizi di programmazione o visualizzazione."),
            tl("Usare il tutor del notebook per capire errori o completare una cella."),
          ],
          standardFlow: [
            tl("Apri Coding Lab e crea o seleziona un progetto."),
            tl("Scrivi codice nelle celle e avvialo."),
            tl("Usa assist o tutor se serve supporto sul codice o sull output."),
          ],
          extraOptions: [
            tl("Adatto sia a esercizi guidati sia a progetti liberi."),
            tl("Puoi iterare rapidamente tra modifica, esecuzione e supporto."),
          ],
          classSharing: sharing.no,
          outputFormat: tl("Notebook con celle e output eseguiti all interno della piattaforma."),
        },
      ],
    },
    {
      id: 'ml-lab',
      title: 'ML Lab',
      description: tl("Spazio per attivita di classificazione, esperimenti e lettura di risultati su dataset."),
      icon: Brain,
      features: [
        {
          title: tl("Laboratorio di classificazione"),
          path: 'Studente / ML Lab',
          description: tl("Consente di lavorare con dataset, selezionare impostazioni e osservare i risultati di classificazione."),
          examples: [
            tl("Provare un dataset di esempio per capire come cambia il modello."),
            tl("Confrontare risultati variando colonne o impostazioni."),
            tl("Usare un dataset generato in precedenza nel chatbot."),
          ],
          standardFlow: [
            tl("Apri ML Lab e carica o scegli un dataset."),
            tl("Configura l esperimento o la classificazione richiesta."),
            tl("Avvia l elaborazione e interpreta le metriche o i grafici prodotti."),
          ],
          extraOptions: [
            tl("Puoi combinare questo modulo con dataset sintetici creati nel chatbot."),
            tl("Utile per attivita introduttive sul machine learning e sulla lettura dei risultati."),
          ],
          classSharing: sharing.depends,
          outputFormat: tl("Risultati di classificazione, metriche e visualizzazioni interne."),
        },
      ],
    },
    {
      id: 'tasks-and-class',
      title: tl("Compiti, Classe e Desktop"),
      description: tl("Raccoglie le funzioni operative della sessione: task, chat di classe e spazio di lavoro personale."),
      icon: LayoutDashboard,
      features: [
        {
          title: tl("Compiti e autovalutazione"),
          path: 'Studente / Compiti',
          description: tl("Qui trovi task, quiz ed esercizi assegnati, con apertura diretta dalle notifiche di sessione."),
          examples: [
            tl("Aprire un quiz assegnato dal docente."),
            tl("Completare un esercizio e inviarlo entro la scadenza."),
            tl("Rientrare su un task aperto da notifica."),
          ],
          standardFlow: [
            tl("Apri il modulo Compiti o entra da una notifica."),
            tl("Scegli il task in stato pending."),
            tl("Compila le risposte e invia la consegna."),
          ],
          extraOptions: [
            tl("I task documentali possono reindirizzare automaticamente al modulo Documenti."),
            tl("Il conteggio pending compare nella dashboard studente."),
          ],
          classSharing: sharing.yes,
          outputFormat: tl("Tentativo quiz o consegna associata al task."),
        },
        {
          title: tl("Chat di classe"),
          path: 'Studente / Classe',
          description: tl("Canale di comunicazione con classe e docente per messaggi pubblici o privati, se abilitati."),
          examples: [
            tl("Scrivere una domanda pubblica alla classe."),
            tl("Ricevere un messaggio privato dal docente."),
            tl("Seguire gli aggiornamenti di sessione in tempo reale."),
          ],
          standardFlow: [
            tl("Apri il modulo Classe."),
            tl("Leggi i messaggi correnti o seleziona il thread corretto."),
            tl("Invia il tuo messaggio secondo i permessi della sessione."),
          ],
          extraOptions: [
            tl("La chat privata puo essere attivata o disattivata dal docente."),
            tl("Le notifiche possono portarti al punto giusto del flusso."),
          ],
          classSharing: sharing.yes,
          outputFormat: tl("Messaggi in tempo reale nella chat di sessione."),
        },
        {
          title: tl("Desktop personale"),
          path: 'Studente / Desktop',
          description: tl("Workspace personalizzabile con widget e scorciatoie per organizzare lo studio."),
          examples: [
            tl("Aprire rapidamente il chatbot o un documento dalla schermata iniziale."),
            tl("Tenere a vista widget utili per la sessione."),
            tl("Usare il desktop come punto di accesso principale alla piattaforma."),
          ],
          standardFlow: [
            tl("Apri il Desktop."),
            tl("Aggiungi o sposta i widget disponibili."),
            tl("Usa il desktop come hub per entrare nei moduli principali."),
          ],
          extraOptions: [
            tl("La disposizione puo essere personalizzata."),
            tl("Alcuni widget guidano verso moduli specifici o attivita del momento."),
          ],
          classSharing: sharing.no,
          outputFormat: tl("Layout personale con widget e configurazioni salvate."),
        },
      ],
    },
  ]
}

export default function StudentWikiPage() {
  const { i18n } = useTranslation()
  const isEnglish = i18n.resolvedLanguage?.startsWith('en') ?? false
  const theme = getStudentAccentTheme(loadStudentAccent())

  return (
    <WikiGuidePage
      roleLabel={isEnglish ? 'Student Wiki' : 'Wiki Studente'}
      title={isEnglish ? 'Operational guide for the student platform' : 'Guida operativa per la piattaforma studente'}
      intro={isEnglish
        ? 'This page gathers the main student-side features organised by area. Each card explains what the feature does, how it is used in the standard flow, which outputs it produces, and whether the content stays personal or can be shared in the session.'
        : 'Questa pagina raccoglie le principali funzionalita disponibili lato studente, organizzate per area. Ogni scheda spiega cosa fa la funzione, come si usa nel flusso standard, quali output produce e se il contenuto resta personale oppure puo essere condiviso nella sessione.'}
      sections={getStudentWikiSections(isEnglish)}
      accentColor={theme.accent}
      accentSoft={theme.soft}
      accentText={theme.text}
    />
  )
}
