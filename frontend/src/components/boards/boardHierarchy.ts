import { tl } from '@/i18n/tl'

export type CardType = 'epic' | 'story' | 'task'

export const CARD_TYPES: CardType[] = ['epic', 'story', 'task']
export const CARD_RANK: Record<CardType, number> = { epic: 0, story: 1, task: 2 }
export const typeOf = (card: { card_type?: CardType | null }): CardType => card.card_type || 'task'

export const TYPE_META: Record<CardType, { label: string; plural: string; hint: string; color: string; badge: string; tile: string; rail: string }> = {
  epic: {
    label: 'Epic', plural: 'Epic', color: '#a855f7',
    hint: tl("Un obiettivo grande, che raccoglie più user story"),
    badge: 'bg-violet-100 text-violet-700',
    tile: 'bg-violet-500/[0.09] ring-1 ring-violet-500/30',
    rail: 'border-violet-400/60',
  },
  story: {
    label: 'User story', plural: 'User story', color: '#0ea5e9',
    hint: tl("Un risultato per l’utente, scomposto in task"),
    badge: 'bg-sky-100 text-sky-700',
    tile: 'bg-sky-500/[0.09] ring-1 ring-sky-500/30',
    rail: 'border-sky-400/60',
  },
  task: {
    label: 'Task', plural: 'Task', color: '#737373',
    hint: tl("Un’attività concreta da svolgere"),
    badge: 'bg-slate-100 text-slate-600',
    tile: '',
    rail: 'border-slate-300',
  },
}

/** Types a card of `type` may sit under: an epic holds stories and tasks, a story holds tasks. */
export const allowedParentTypes = (type: CardType): CardType[] => CARD_TYPES.filter((candidate) => CARD_RANK[candidate] < CARD_RANK[type])

type Node = { id: string; parent_card_id?: string | null; card_type?: CardType | null }

/** Number of descendants by type, for the summary line of an epic or story. */
export function countDescendants<T extends Node>(cards: T[], id: string): Record<CardType, number> {
  const counts: Record<CardType, number> = { epic: 0, story: 0, task: 0 }
  const walk = (parentId: string) => cards.forEach((card) => {
    if (card.parent_card_id === parentId) { counts[typeOf(card)] += 1; walk(card.id) }
  })
  walk(id)
  return counts
}
