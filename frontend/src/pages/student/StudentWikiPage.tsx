import {
  Bot,
  Brain,
  FileCode2,
  FileText,
  LayoutDashboard,
} from 'lucide-react'
import WikiGuidePage, { type WikiSection } from '@/components/wiki/WikiGuidePage'
import { getStudentAccentTheme, loadStudentAccent } from '@/lib/studentAccent'

const STUDENT_WIKI_SECTIONS: WikiSection[] = [
  {
    id: 'chatbot',
    title: 'Chatbot',
    description: 'L area chatbot raccoglie tutor, assistenti specializzati, bot pubblicati dal docente e workspace RAG personale.',
    icon: Bot,
    features: [
      {
        title: 'Assistenti AI',
        path: 'Studente / Chatbot / Assistenti AI',
        description: 'Scegli un profilo come tutor, quiz coach, orale o math coach per lavorare in chat su un obiettivo preciso.',
        examples: [
          'Chiedere una spiegazione progressiva di un concetto difficile.',
          'Preparare una simulazione di interrogazione su un argomento di studio.',
          'Ottenere un ripasso guidato prima di un compito.',
        ],
        standardFlow: [
          'Apri Chatbot e scegli il profilo piu adatto.',
          'Scrivi l obiettivo o il materiale di partenza.',
          'Interagisci in piu turni fino a chiarire dubbi o ottenere l output desiderato.',
        ],
        extraOptions: [
          'Possibile allegare file o immagini al messaggio in base al profilo.',
          'Alcuni profili possono guidare con domande progressive invece di risposte uniche.',
        ],
        classSharing: 'No',
        outputFormat: 'Risposta in chat, eventuali quiz o contenuti strutturati generati nel flusso.',
      },
      {
        title: 'Assistenti del docente',
        path: 'Studente / Chatbot / Teacherbot',
        description: 'Sono assistenti pubblicati dal docente con istruzioni e knowledge base dedicate a una lezione o a una materia.',
        examples: [
          'Usare il bot di storia della classe per ripassare solo il programma assegnato.',
          'Fare domande su una dispensa caricata dal docente.',
          'Ricevere chiarimenti coerenti con il taglio didattico della sessione.',
        ],
        standardFlow: [
          'Apri Chatbot e seleziona un teacherbot disponibile.',
          'Fai domande sul tema o sul materiale collegato.',
          'Prosegui la conversazione nella cronologia salvata del bot.',
        ],
        extraOptions: [
          'Il comportamento dipende dalla configurazione fatta dal docente.',
          'Possono esistere teacherbot proattivi pubblicati solo per alcune sessioni.',
        ],
        classSharing: 'Dipende',
        outputFormat: 'Conversazione in chat con contesto definito dal docente.',
      },
      {
        title: 'Knowledge base personale (RAG)',
        path: 'Studente / Chatbot / Knowledge Base',
        description: 'Puoi caricare i tuoi documenti e interrogare solo quelle fonti, con citazioni cliccabili e pannello fonti.',
        examples: [
          'Caricare una dispensa e chiedere un riassunto per capitolo.',
          'Caricare un modulo fiscale o un referto e chiedere un dato puntuale presente nel testo.',
          'Confrontare piu documenti selezionati nella stessa sessione.',
        ],
        standardFlow: [
          'Carica uno o piu documenti nella colonna Documenti.',
          'Seleziona tutti i documenti o solo quelli rilevanti.',
          'Invia la domanda e controlla la colonna Fonti per i passaggi usati.',
        ],
        extraOptions: [
          'Le citazioni [[n]] portano al passaggio sorgente usato nella risposta.',
          'Le sessioni RAG salvano cronologia, filtri documentali e fonti recenti.',
        ],
        classSharing: 'No',
        outputFormat: 'Risposta in chat con citazioni e pannello laterale delle fonti recuperate.',
      },
      {
        title: 'Generatore dataset',
        path: 'Studente / Chatbot / Generatore Dataset',
        description: 'Un assistente specializzato puo aiutarti a progettare un dataset sintetico a partire da colonne, vincoli e numero di righe.',
        examples: [
          'Creare un dataset studenti-voti per testare grafici o modelli.',
          'Generare dati tabellari plausibili per un esercizio di machine learning.',
          'Preparare un CSV coerente con colonne personalizzate.',
        ],
        standardFlow: [
          'Seleziona il profilo dataset generator.',
          'Specifica contesto, colonne, numero di righe e regole.',
          'Verifica l output e scaricalo o riusalo nei moduli successivi.',
        ],
        extraOptions: [
          'Puoi imporre formati, range di valori e relazioni tra colonne.',
          'Utile come passaggio preparatorio per ML Lab o analisi dati.',
        ],
        classSharing: 'No',
        outputFormat: 'Dataset tabellare, tipicamente CSV o struttura tabellare esportabile.',
      },
    ],
  },
  {
    id: 'documents',
    title: 'Documenti',
    description: 'Qui lavori su compiti documentali, lezioni assegnate e materiali da produrre o completare.',
    icon: FileText,
    features: [
      {
        title: 'Compiti documentali',
        path: 'Studente / Documenti / Consegne',
        description: 'Il modulo documenti ospita consegne testuali, lezioni o presentazioni da completare dentro la piattaforma.',
        examples: [
          'Completare una scheda guidata assegnata dal docente.',
          'Preparare una mini presentazione partendo da una traccia.',
          'Scrivere una relazione o un testo argomentativo da consegnare.',
        ],
        standardFlow: [
          'Apri il modulo Documenti o entra da una notifica.',
          'Seleziona la consegna o la lezione da completare.',
          'Compila il contenuto e salva o invia secondo il task.',
        ],
        extraOptions: [
          'Le notifiche possono aprire direttamente il documento giusto.',
          'Il contenuto puo essere strutturato diversamente in base al tipo di task.',
        ],
        classSharing: 'Si',
        outputFormat: 'Documento o presentazione interna alla piattaforma, salvata come consegna.',
      },
    ],
  },
  {
    id: 'notebook',
    title: 'Notebook',
    description: 'Ambiente per scrivere codice, eseguire celle e ricevere supporto su attivita computazionali.',
    icon: FileCode2,
    features: [
      {
        title: 'Notebook di coding',
        path: 'Studente / Notebook',
        description: 'Permette di lavorare in un notebook con celle, codice eseguibile e supporto tutoriale.',
        examples: [
          'Scrivere script Python per analisi dati.',
          'Provare piccoli esercizi di programmazione o visualizzazione.',
          'Usare il tutor del notebook per capire errori o completare una cella.',
        ],
        standardFlow: [
          'Apri Notebook e crea o seleziona un progetto.',
          'Scrivi codice nelle celle e avvialo.',
          'Usa assist o tutor se serve supporto sul codice o sull output.',
        ],
        extraOptions: [
          'Adatto sia a esercizi guidati sia a progetti liberi.',
          'Puoi iterare rapidamente tra modifica, esecuzione e supporto.',
        ],
        classSharing: 'No',
        outputFormat: 'Notebook con celle e output eseguiti all interno della piattaforma.',
      },
    ],
  },
  {
    id: 'ml-lab',
    title: 'ML Lab',
    description: 'Spazio per attività di classificazione, esperimenti e lettura di risultati su dataset.',
    icon: Brain,
    features: [
      {
        title: 'Laboratorio di classificazione',
        path: 'Studente / ML Lab',
        description: 'Consente di lavorare con dataset, selezionare impostazioni e osservare i risultati di classificazione.',
        examples: [
          'Provare un dataset di esempio per capire come cambia il modello.',
          'Confrontare risultati variando colonne o impostazioni.',
          'Usare un dataset generato in precedenza nel chatbot.',
        ],
        standardFlow: [
          'Apri ML Lab e carica o scegli un dataset.',
          'Configura l esperimento o la classificazione richiesta.',
          'Avvia l elaborazione e interpreta le metriche o i grafici prodotti.',
        ],
        extraOptions: [
          'Puoi combinare questo modulo con dataset sintetici creati nel chatbot.',
          'Utile per attività introduttive sul machine learning e sulla lettura dei risultati.',
        ],
        classSharing: 'Dipende',
        outputFormat: 'Risultati di classificazione, metriche e visualizzazioni interne.',
      },
    ],
  },
  {
    id: 'tasks-and-class',
    title: 'Compiti, Classe e Desktop',
    description: 'Raccoglie le funzioni operative della sessione: task, chat di classe e spazio di lavoro personale.',
    icon: LayoutDashboard,
    features: [
      {
        title: 'Compiti e autovalutazione',
        path: 'Studente / Compiti',
        description: 'Qui trovi task, quiz ed esercizi assegnati, con apertura diretta dalle notifiche di sessione.',
        examples: [
          'Aprire un quiz assegnato dal docente.',
          'Completare un esercizio e inviarlo entro la scadenza.',
          'Rientrare su un task aperto da notifica.',
        ],
        standardFlow: [
          'Apri il modulo Compiti o entra da una notifica.',
          'Scegli il task in stato pending.',
          'Compila le risposte e invia la consegna.',
        ],
        extraOptions: [
          'I task documentali possono reindirizzare automaticamente al modulo Documenti.',
          'Il conteggio pending compare nella dashboard studente.',
        ],
        classSharing: 'Si',
        outputFormat: 'Tentativo quiz o consegna associata al task.',
      },
      {
        title: 'Chat di classe',
        path: 'Studente / Classe',
        description: 'Canale di comunicazione con classe e docente per messaggi pubblici o privati, se abilitati.',
        examples: [
          'Scrivere una domanda pubblica alla classe.',
          'Ricevere un messaggio privato dal docente.',
          'Seguire gli aggiornamenti di sessione in tempo reale.',
        ],
        standardFlow: [
          'Apri il modulo Classe.',
          'Leggi i messaggi correnti o seleziona il thread corretto.',
          'Invia il tuo messaggio secondo i permessi della sessione.',
        ],
        extraOptions: [
          'La chat privata puo essere attivata o disattivata dal docente.',
          'Le notifiche possono portarti al punto giusto del flusso.',
        ],
        classSharing: 'Si',
        outputFormat: 'Messaggi in tempo reale nella chat di sessione.',
      },
      {
        title: 'Desktop personale',
        path: 'Studente / Desktop',
        description: 'Workspace personalizzabile con widget e scorciatoie per organizzare lo studio.',
        examples: [
          'Aprire rapidamente il chatbot o un documento dalla schermata iniziale.',
          'Tenere a vista widget utili per la sessione.',
          'Usare il desktop come punto di accesso principale alla piattaforma.',
        ],
        standardFlow: [
          'Apri il Desktop.',
          'Aggiungi o sposta i widget disponibili.',
          'Usa il desktop come hub per entrare nei moduli principali.',
        ],
        extraOptions: [
          'La disposizione puo essere personalizzata.',
          'Alcuni widget guidano verso moduli specifici o attivita del momento.',
        ],
        classSharing: 'No',
        outputFormat: 'Layout personale con widget e configurazioni salvate.',
      },
    ],
  },
]

export default function StudentWikiPage() {
  const theme = getStudentAccentTheme(loadStudentAccent())

  return (
    <WikiGuidePage
      roleLabel="Wiki Studente"
      title="Guida operativa per la piattaforma studente"
      intro="Questa pagina raccoglie le principali funzionalita disponibili lato studente, organizzate per area. Ogni scheda spiega cosa fa la funzione, come si usa nel flusso standard, quali output produce e se il contenuto resta personale oppure puo essere condiviso nella sessione."
      sections={STUDENT_WIKI_SECTIONS}
      accentColor={theme.accent}
      accentSoft={theme.soft}
      accentText={theme.text}
    />
  )
}
