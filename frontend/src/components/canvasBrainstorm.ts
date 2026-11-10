import { tl } from '@/i18n/tl'

/** One-click requests for collective brainstorming boards. They act on the selection (a selected section includes its
 *  contents), or on the whole board when nothing is selected; the assistant plans and the client runs the steps. */
export type BrainstormAction = { key: string; label: string; prompt: string }

const SCOPE = 'Lavora sugli elementi selezionati (se è selezionata una sezione, su tutto ciò che contiene); se non c’è selezione, su tutti i post-it e i testi della lavagna.'

export const BRAINSTORM_ACTIONS: BrainstormAction[] = [
  { key: 'cluster', label: tl('Raggruppa per somiglianza'), prompt: `Riordina le idee raggruppandole per somiglianza: crea un cluster per tema con nome e sintesi. ${SCOPE}` },
  { key: 'summary', label: tl('Riassumi'), prompt: `Fai una sintesi delle idee emerse: temi principali, quante idee li sostengono, tensioni e domande aperte. ${SCOPE}` },
  { key: 'infographic', label: tl('Crea un’infografica'), prompt: `Crea un’infografica che restituisca al gruppo i temi emersi, con titolo, schede per tema e i numeri chiave. ${SCOPE}` },
  { key: 'animation', label: tl('Spiega con un’animazione'), prompt: `Crea un’animazione concettuale che spieghi i concetti emersi: le idee compaiono, si raggruppano per tema, si collegano e arrivano a una sintesi. ${SCOPE}` },
  { key: 'verify', label: tl('Verifica la comprensione'), prompt: `Crea una sezione «Mettiti alla prova» con 2-4 card interattive (quiz a scelta multipla, flashcard, domanda aperta con verifica) sui concetti chiave. ${SCOPE}` },
  { key: 'illustrate', label: tl('Illustra i concetti'), prompt: `Scegli i 2-3 concetti chiave emersi, scrivi per ciascuno un brief visivo e illustralo con un’immagine generata e una didascalia sotto. ${SCOPE}` },
]
