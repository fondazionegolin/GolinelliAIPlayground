/**
 * Widget Registry — single source of truth for all widget types.
 * Used by WidgetPalette, AgentSearchBar, and the backend agent system prompt.
 */

export interface WidgetSpec {
  type: string
  label: string
  description: string           // human-readable, injected into agent prompt
  configSchema: Record<string, unknown>  // JSON Schema for config_json
  defaultConfig: Record<string, unknown>
  defaultSize: { w: number; h: number }
  requiresSession?: boolean
  color: string                 // Tailwind text color class
  bg: string                    // Tailwind bg color class
  iconName: string              // lucide icon name (string, resolved at render time)
}

export const WIDGET_REGISTRY: WidgetSpec[] = [
  {
    type: 'CLOCK',
    label: 'Orologio',
    description: 'Orologio digitale con ora, secondi e data corrente.',
    configSchema: {
      type: 'object',
      properties: {
        show_seconds: { type: 'boolean', default: true },
        show_date:    { type: 'boolean', default: true },
      },
    },
    defaultConfig: { show_seconds: true, show_date: true },
    defaultSize: { w: 6, h: 3 },
    color: 'text-white/60',
    bg: 'bg-white/10',
    iconName: 'Clock',
  },
  {
    type: 'NOTE',
    label: 'Post-it',
    description: 'Nota libera colorata con testo libero. Colori disponibili: #fef08a (giallo), #bfdbfe (azzurro), #bbf7d0 (verde), #fecaca (rosso), #e9d5ff (viola). Dimensioni consigliate: 4×4.',
    configSchema: {
      type: 'object',
      properties: {
        text:  { type: 'string', default: '' },
        color: { type: 'string', default: '#fef08a', description: 'Colore esadecimale sfondo del post-it' },
      },
    },
    defaultConfig: { text: '', color: '#fef08a' },
    defaultSize: { w: 4, h: 4 },
    color: 'text-amber-400',
    bg: 'bg-amber-400/10',
    iconName: 'StickyNote',
  },
  {
    type: 'TASKLIST',
    label: 'Lista compiti',
    description: 'Lista di attività con checkbox. Items è un array di oggetti {text: string, done: boolean}.',
    configSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', default: 'Da fare' },
        items: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              text: { type: 'string' },
              done: { type: 'boolean', default: false },
            },
            required: ['text', 'done'],
          },
          default: [],
        },
      },
    },
    defaultConfig: { title: 'Da fare', items: [] },
    defaultSize: { w: 5, h: 5 },
    color: 'text-emerald-400',
    bg: 'bg-emerald-400/10',
    iconName: 'CheckSquare',
  },
  {
    type: 'CALENDAR',
    label: 'Calendario mensile',
    description: 'Calendario mensile con note personali per giorno. Config: {notes: {"YYYY-MM-DD": "testo nota"}}. Usa questo per eventi/note personali dello studente.',
    configSchema: {
      type: 'object',
      properties: {
        notes: {
          type: 'object',
          additionalProperties: { type: 'string' },
          default: {},
          description: 'Mappa data→nota: {"2026-04-15": "Compito matematica"}',
        },
      },
    },
    defaultConfig: { notes: {} },
    defaultSize: { w: 6, h: 5 },
    color: 'text-blue-400',
    bg: 'bg-blue-400/10',
    iconName: 'Calendar',
  },
  {
    type: 'WEEKLY_CALENDAR',
    label: 'Calendario sessione',
    description: 'Calendario settimanale condiviso della sessione. Richiede session_id. Solo per desktop con una sessione attiva.',
    configSchema: {
      type: 'object',
      properties: {
        session_id:   { type: 'string' },
        session_name: { type: 'string' },
      },
      required: ['session_id'],
    },
    defaultConfig: {},
    defaultSize: { w: 24, h: 6 },
    requiresSession: true,
    color: 'text-indigo-400',
    bg: 'bg-indigo-400/10',
    iconName: 'CalendarDays',
  },
  {
    type: 'FILE_REF',
    label: 'Riferimento file',
    description: 'Collegamento rapido a un documento con anteprima al click.',
    configSchema: {
      type: 'object',
      properties: {
        filename:  { type: 'string' },
        mime_type: { type: 'string' },
        url:       { type: 'string' },
      },
    },
    defaultConfig: { filename: 'File', mime_type: '' },
    defaultSize: { w: 4, h: 3 },
    color: 'text-violet-400',
    bg: 'bg-violet-400/10',
    iconName: 'FileText',
  },
  {
    type: 'IMAGE_REF',
    label: 'Immagine',
    description: 'Immagine con anteprima, click per ingrandire.',
    configSchema: {
      type: 'object',
      properties: {
        url:      { type: 'string' },
        filename: { type: 'string' },
      },
    },
    defaultConfig: { url: '', filename: '' },
    defaultSize: { w: 5, h: 4 },
    color: 'text-pink-400',
    bg: 'bg-pink-400/10',
    iconName: 'Image',
  },
]

/** Lookup by type string */
export function getWidgetSpec(type: string): WidgetSpec | undefined {
  return WIDGET_REGISTRY.find(s => s.type === type)
}

/** Prompt-ready description of all widget types for the agent */
export function buildWidgetRegistryPrompt(sessionId?: string): string {
  return WIDGET_REGISTRY
    .filter(s => !s.requiresSession || !!sessionId)
    .map(s => {
      const notesStr = s.configSchema.properties
        ? JSON.stringify(s.configSchema.properties, null, 2)
        : '{}'
      return `### ${s.type} — ${s.label}\n${s.description}\nDimensioni default: ${s.defaultSize.w}×${s.defaultSize.h} (larghezza×altezza in celle). Config properties:\n${notesStr}`
    })
    .join('\n\n')
}
