import { describe, expect, it } from 'vitest'
import { isDeepResearchRequest } from './research'

describe('explicit deep research requests', () => {
  it.each(['voglio una deep research', 'Deep research su energia in Italia', 'Vorrei una ricerca approfondita sul clima', 'Fai una deep-research sulle elezioni europee'])('routes %s', text => expect(isDeepResearchRequest(text)).toBe(true))
  it.each(["Cos’è la deep research?", 'Come funziona la deep research?', 'Non voglio una deep research', 'Spiegami la fotosintesi', 'Ho letto un articolo sulla deep research', "I don't want a deep research"])('keeps normal chat for %s', text => expect(isDeepResearchRequest(text)).toBe(false))
})
