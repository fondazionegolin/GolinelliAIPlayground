import { describe, expect, it } from 'vitest'
import { observationVerdict, vibeValidationLabel, type VibeValidation } from './vibeValidation'

describe('Vibe Lab verification', () => {
  it('never treats a quiet timeout as a successful startup', () => {
    expect(observationVerdict(false, 0, true)).toBe('unverified')
    expect(observationVerdict(true, 0, true)).toBe('clean')
    expect(observationVerdict(true, 1, true)).toBe('failed')
    expect(observationVerdict(true, 0, false)).toBe('stale')
  })
  it('separates generation, build and observed startup', () => {
    const base: VibeValidation = { source_hash: 'hash', generation: 'completed', build: 'not_checked', runtime: 'not_checked', features: 'not_checked' }
    expect(vibeValidationLabel(base)).toBe('Generato · non verificato')
    expect(vibeValidationLabel({ ...base, build: 'passed' })).toContain('anteprima da verificare')
    expect(vibeValidationLabel({ ...base, build: 'passed', runtime: 'observed' })).toContain('funzioni da collaudare')
    expect(vibeValidationLabel({ ...base, build: 'passed', features: 'incomplete' })).toBe('Generato · da correggere')
    expect(vibeValidationLabel({ ...base, build: 'passed', runtime: 'failed' })).toBe('Generato · da correggere')
  })
})
