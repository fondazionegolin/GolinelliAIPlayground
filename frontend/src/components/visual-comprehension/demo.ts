import type { VisualLesson, Overlay, VisualStep } from './types'

const focus = (id: string, label: string): Overlay[] => [
  { kind: 'spotlight', region_id: id, label, color: 'amber' },
  { kind: 'zoom', region_id: id, label: 'La colonna, da vicino', color: 'amber' },
]

function check(title: string, action: string, question: string, answer: string, hint: string, region: string): VisualStep {
  return {
    title, action, question, answer, hint,
    explanation: 'Concentrati solo sul dettaglio evidenziato. Rispondi a questo piccolo check: poi passiamo insieme al successivo.',
    overlays: focus(region, action),
  }
}

export const DEMO: VisualLesson = {
  objective: 'Imparare a sommare 478 + 367 in colonna, verificando separatamente somma, cifra da scrivere e riporto.',
  grounding: {
    subject: 'Addizione in colonna con riporti', overview: 'L’operazione 478 + 367, con tre caselle vuote per il risultato.', warnings: [],
    regions: [
      { id: 'unita', label: 'Cifre delle unità', text: '8 e 7', box: { x: 61.7, y: 46.8, width: 5.6, height: 22.5 }, confidence: 'high' },
      { id: 'decine', label: 'Cifre delle decine', text: '7 e 6', box: { x: 50.7, y: 46.8, width: 5.6, height: 22.5 }, confidence: 'high' },
      { id: 'centinaia', label: 'Cifre delle centinaia', text: '4 e 3', box: { x: 39.7, y: 46.8, width: 5.6, height: 22.5 }, confidence: 'high' },
      { id: 'scrivi-unita', label: 'Casella delle unità', text: '', box: { x: 61, y: 74.7, width: 7, height: 10 }, confidence: 'high' },
      { id: 'scrivi-decine', label: 'Casella delle decine', text: '', box: { x: 50, y: 74.7, width: 7, height: 10 }, confidence: 'high' },
      { id: 'riporto-decine', label: 'Spazio del riporto alle decine', text: '', box: { x: 50.8, y: 39.7, width: 5.4, height: 6 }, confidence: 'high' },
      { id: 'riporto-centinaia', label: 'Spazio del riporto alle centinaia', text: '', box: { x: 39.8, y: 39.7, width: 5.4, height: 6 }, confidence: 'high' },
      { id: 'risultato', label: 'Le caselle del risultato', text: '', box: { x: 39, y: 74.7, width: 29, height: 10 }, confidence: 'high' },
    ],
  },
  lesson: {
    title: 'Sommiamo insieme, una piccola azione alla volta',
    summary: 'Partiamo dalla colonna di destra. Il tutor ti chiede una cosa per volta e verifica ogni risposta, inclusi i riporti.',
    steps: [
      check('Somma le unità', 'Somma solo le due cifre nella colonna delle unità.', 'Quanto fa 8 + 7?', '15', 'Puoi partire da 8 e aggiungere 7 in due piccoli salti.', 'unita'),
      check('Scrivi una sola cifra', 'Scegli la cifra da scrivere nella casella delle unità.', 'Quale cifra scrivi nelle unità del risultato?', '5', 'Guarda la cifra delle unità del totale che hai appena trovato.', 'scrivi-unita'),
      check('Controlla il riporto', 'Separa le decine dalle unità della somma appena fatta.', 'Quanto vale il riporto alla colonna delle decine?', '1', 'Nel totale precedente, conta le decine complete.', 'riporto-decine'),
      check('Passa alle decine', 'Somma le due cifre delle decine includendo il riporto.', 'Quanto fa 7 + 6 + il riporto?', '14', 'Somma prima le due cifre e poi aggiungi il riporto trovato.', 'decine'),
      check('Scrivi la cifra delle decine', 'Scegli una sola cifra da scrivere nella casella delle decine.', 'Quale cifra scrivi nelle decine del risultato?', '4', 'Considera solo la cifra delle unità del totale di questa colonna.', 'scrivi-decine'),
      check('Controlla il nuovo riporto', 'Trova il riporto dalla colonna delle decine alle centinaia.', 'Quanto riporti alle centinaia?', '1', 'Separa il totale della colonna in decine complete e unità.', 'riporto-centinaia'),
      check('Completa le centinaia', 'Somma le cifre delle centinaia e il nuovo riporto.', 'Quanto fa 4 + 3 + il nuovo riporto?', '8', 'Anche qui, somma le cifre e poi aggiungi il riporto.', 'centinaia'),
      check('Ricomponi il risultato', 'Leggi insieme le tre cifre che hai trovato, da sinistra a destra.', 'Qual è il risultato completo di 478 + 367?', '845', 'Riordina i tuoi risultati: centinaia, decine, unità.', 'risultato'),
    ],
  },
}
