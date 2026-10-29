import type { VisualLesson, Overlay, VisualStep } from './types'
import { tl } from '@/i18n/tl'

const focus = (id: string, label: string): Overlay[] => [
  { kind: 'spotlight', region_id: id, label, color: 'amber' },
  { kind: 'zoom', region_id: id, label: tl("La colonna, da vicino"), color: 'amber' },
]

function check(title: string, action: string, question: string, answer: string, hint: string, region: string): VisualStep {
  return {
    title, action, question, answer, hint,
    explanation: 'Concentrati solo sul dettaglio evidenziato. Rispondi a questo piccolo check: poi passiamo insieme al successivo.',
    overlays: focus(region, action),
  }
}

export const DEMO: VisualLesson = {
  objective: tl("Imparare a sommare 478 + 367 in colonna, verificando separatamente somma, cifra da scrivere e riporto."),
  grounding: {
    subject: tl("Addizione in colonna con riporti"), overview: tl("L’operazione 478 + 367, con tre caselle vuote per il risultato."), warnings: [],
    regions: [
      { id: 'unita', label: tl("Cifre delle unità"), text: '8 e 7', box: { x: 61.7, y: 46.8, width: 5.6, height: 22.5 }, confidence: 'high' },
      { id: 'decine', label: tl("Cifre delle decine"), text: '7 e 6', box: { x: 50.7, y: 46.8, width: 5.6, height: 22.5 }, confidence: 'high' },
      { id: 'centinaia', label: tl("Cifre delle centinaia"), text: '4 e 3', box: { x: 39.7, y: 46.8, width: 5.6, height: 22.5 }, confidence: 'high' },
      { id: 'scrivi-unita', label: tl("Casella delle unità"), text: '', box: { x: 61, y: 74.7, width: 7, height: 10 }, confidence: 'high' },
      { id: 'scrivi-decine', label: tl("Casella delle decine"), text: '', box: { x: 50, y: 74.7, width: 7, height: 10 }, confidence: 'high' },
      { id: 'riporto-decine', label: tl("Spazio del riporto alle decine"), text: '', box: { x: 50.8, y: 39.7, width: 5.4, height: 6 }, confidence: 'high' },
      { id: 'riporto-centinaia', label: tl("Spazio del riporto alle centinaia"), text: '', box: { x: 39.8, y: 39.7, width: 5.4, height: 6 }, confidence: 'high' },
      { id: 'risultato', label: tl("Le caselle del risultato"), text: '', box: { x: 39, y: 74.7, width: 29, height: 10 }, confidence: 'high' },
    ],
  },
  lesson: {
    title: tl("Sommiamo insieme, una piccola azione alla volta"),
    summary: tl("Partiamo dalla colonna di destra. Il tutor ti chiede una cosa per volta e verifica ogni risposta, inclusi i riporti."),
    steps: [
      check(tl("Somma le unità"), tl("Somma solo le due cifre nella colonna delle unità."), tl("Quanto fa 8 + 7?"), '15', tl("Puoi partire da 8 e aggiungere 7 in due piccoli salti."), 'unita'),
      check(tl("Scrivi una sola cifra"), tl("Scegli la cifra da scrivere nella casella delle unità."), tl("Quale cifra scrivi nelle unità del risultato?"), '5', tl("Guarda la cifra delle unità del totale che hai appena trovato."), 'scrivi-unita'),
      check(tl("Controlla il riporto"), tl("Separa le decine dalle unità della somma appena fatta."), tl("Quanto vale il riporto alla colonna delle decine?"), '1', tl("Nel totale precedente, conta le decine complete."), 'riporto-decine'),
      check(tl("Passa alle decine"), tl("Somma le due cifre delle decine includendo il riporto."), tl("Quanto fa 7 + 6 + il riporto?"), '14', tl("Somma prima le due cifre e poi aggiungi il riporto trovato."), 'decine'),
      check(tl("Scrivi la cifra delle decine"), tl("Scegli una sola cifra da scrivere nella casella delle decine."), tl("Quale cifra scrivi nelle decine del risultato?"), '4', tl("Considera solo la cifra delle unità del totale di questa colonna."), 'scrivi-decine'),
      check(tl("Controlla il nuovo riporto"), tl("Trova il riporto dalla colonna delle decine alle centinaia."), tl("Quanto riporti alle centinaia?"), '1', tl("Separa il totale della colonna in decine complete e unità."), 'riporto-centinaia'),
      check(tl("Completa le centinaia"), tl("Somma le cifre delle centinaia e il nuovo riporto."), tl("Quanto fa 4 + 3 + il nuovo riporto?"), '8', tl("Anche qui, somma le cifre e poi aggiungi il riporto."), 'centinaia'),
      check(tl("Ricomponi il risultato"), tl("Leggi insieme le tre cifre che hai trovato, da sinistra a destra."), tl("Qual è il risultato completo di 478 + 367?"), '845', tl("Riordina i tuoi risultati: centinaia, decine, unità."), tl("risultato")),
    ],
  },
}
