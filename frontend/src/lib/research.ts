/** Explicit research requests bypass probabilistic routing, including when files are attached. */
export function isDeepResearchRequest(text: string): boolean {
  if (/\b(?:non|senza|no|without|don't|do not)\s+(?:(?:voglio|vorrei|fare|una|la|a|the|want|use|need)\s+){0,3}(?:deep[\s-]*research|ricerca\s+approfondita)/i.test(text)) return false
  if (/(?:cos[’']?è|cosa (?:significa|vuol dire)|what is|come (?:funziona|si usa))\s+(?:(?:la|una|the|a)\s+)?(?:deep[\s-]*research|ricerca\s+approfondita)/i.test(text)) return false
  const artifact = /\b(?:deep[\s-]*research|ricerca\s+approfondita)\b/i.test(text)
  const action = /\b(?:voglio|vorrei|fai|fammi|esegui|avvia|crea|creami|prepara|conduci|svolgi|effettua|puoi|potresti|want|need|run|start|do|conduct)\b/i.test(text)
  const command = /^\s*(?:(?:una|la|a|the|modalità)\s+)?(?:deep[\s-]*research|ricerca\s+approfondita)\b/i.test(text)
  return artifact && (action || command)
}
