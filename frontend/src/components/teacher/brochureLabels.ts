export const BROCHURE_LABELS_IT = {
  overview: 'Panoramica', features: 'Caratteristiche', featuresTitle: 'Elementi distintivi',
  benefits: 'Vantaggi', benefitsTitle: 'Perché conta', benefit: 'Beneficio',
  method: 'Metodo', methodTitle: 'Come funziona', step: 'Passaggio',
  stats: 'Indicatori', statsTitle: 'Numeri e segnali', faq: 'FAQ', faqTitle: 'Domande frequenti',
  closing: 'Prossimi passi', footer: 'Generato con AI · Fondazione Golinelli',
}
export type BrochureLabels = typeof BROCHURE_LABELS_IT
const BROCHURE_LABELS_EN: BrochureLabels = {
  overview: 'Overview', features: 'Features', featuresTitle: 'Key features',
  benefits: 'Benefits', benefitsTitle: 'Why it matters', benefit: 'Benefit',
  method: 'Method', methodTitle: 'How it works', step: 'Step',
  stats: 'Key figures', statsTitle: 'Facts and figures', faq: 'FAQ', faqTitle: 'Frequently asked questions',
  closing: 'Next steps', footer: 'Generated with AI · Fondazione Golinelli',
}

/** Labels belong to the authored document, independently of the platform's UI language. */
export function brochureLabels(language?: string, overrides?: Partial<BrochureLabels>): BrochureLabels {
  const defaults = language?.toLowerCase().startsWith('en') ? BROCHURE_LABELS_EN : BROCHURE_LABELS_IT
  return Object.fromEntries(Object.entries(defaults).map(([key, fallback]) => {
    const value = overrides?.[key as keyof BrochureLabels]
    return [key, typeof value === 'string' ? value : fallback]
  })) as BrochureLabels
}
