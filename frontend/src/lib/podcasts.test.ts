import { describe, expect, it } from 'vitest'
import { DEFAULT_PODCAST_OPTIONS, normalizePodcastOptions, podcastOptionsEqual } from './podcasts'

describe('podcast settings restored from the API', () => {
  const requested = { ...DEFAULT_PODCAST_OPTIONS, voice_id: 'voice123' }
  it('accepts identical settings regardless of JSONB property order', () => {
    const restored = Object.fromEntries(Object.entries(requested).reverse())
    expect(JSON.stringify(restored)).not.toBe(JSON.stringify(requested))
    expect(podcastOptionsEqual(requested, restored)).toBe(true)
    expect(podcastOptionsEqual(restored, requested)).toBe(true)
  })
  it.each([
    { voice_id: 'voice456' }, { duration_minutes: 5 }, { language: 'en' }, { tone: 'narrativo' },
    { audience: 'Docenti' }, { instructions: 'Usa esempi' }, { speed: 1.2 }, { stability: 0.9 },
  ])('requires a new preview for a real settings change: %o', patch => {
    expect(podcastOptionsEqual(requested, { ...requested, ...patch })).toBe(false)
  })
  it('fills defaults for older saved settings without mutating them', () => {
    const saved = { voice_id: 'voice123' }
    expect(podcastOptionsEqual(requested, saved)).toBe(true)
    expect(normalizePodcastOptions(saved)).toEqual(requested)
    expect(saved).toEqual({ voice_id: 'voice123' })
  })
})
