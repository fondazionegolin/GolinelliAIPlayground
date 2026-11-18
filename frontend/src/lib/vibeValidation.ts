export interface VibeValidation {
  source_hash: string
  generation: string
  build: 'passed' | 'failed' | 'not_checked'
  runtime: 'observed' | 'failed' | 'not_checked'
  features_required?: boolean
  features: 'checked' | 'incomplete' | 'not_checked'
}

export function vibeValidationLabel(value?: VibeValidation | null): string {
  if (value?.build === 'failed' || value?.runtime === 'failed' || value?.features === 'incomplete') return 'Generato · da correggere'
  if (value?.features_required && value.features === 'not_checked') return 'Generato · requisiti da verificare'
  if (value?.runtime === 'observed' && value.build === 'passed') return 'Anteprima avviata · funzioni da collaudare'
  if (value?.build === 'passed') return 'Generato · build verificata · anteprima da verificare'
  return 'Generato · non verificato'
}

export function observationVerdict(ready: boolean, errorCount: number, unchanged: boolean): 'clean' | 'failed' | 'unverified' | 'stale' {
  if (!unchanged) return 'stale'
  if (errorCount) return 'failed'
  return ready ? 'clean' : 'unverified'
}
