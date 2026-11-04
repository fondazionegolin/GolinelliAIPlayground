import { describe, expect, it, vi } from 'vitest'
vi.mock('@/lib/api', () => ({ default: {} }))
import { isProtocolRequest } from './teachingProtocol'

describe('teaching protocol routing', () => {
  it.each([
    'Vai in modalità agentica e produci quello che serve',
    'Esegui il protocollo didattico',
    'Crea tutti i materiali del protocollo',
    'Vedetela tu con tutti i materiali',
    'Attiva la modalità agentica',
  ])('recognizes an execution request: %s', text => expect(isProtocolRequest(text)).toBe(true))
  it('understands a handoff with attached files', () => expect(isProtocolRequest('Veditela tu', true)).toBe(true))
  it.each([
    'Come funziona la modalità agentica?',
    'Non voglio la modalità agentica, crea solo un quiz',
    'Crea un protocollo didattico',
    'Crea un quiz di storia',
    'Spiegami come eseguire il protocollo',
    'Senza agenti, esegui il protocollo',
  ])('keeps ordinary requests in chat: %s', text => expect(isProtocolRequest(text)).toBe(false))
})
