import { describe, expect, it } from 'vitest'
import { canvasLabelColor } from './canvasColors'

describe('document label contrast', () => {
  it('keeps readable author colours', () => {
    expect(canvasLabelColor('#ffffff', '#0369a1')).toBe('#0369a1')
    expect(canvasLabelColor('#171717', '#ffffff')).toBe('#ffffff')
  })
  it('adapts text for dark notes and shape fills', () => {
    expect(canvasLabelColor('#171717')).toBe('#ffffff')
    expect(canvasLabelColor('#ffffff', '#ffffff')).toBe('#171717')
    expect(canvasLabelColor('#fef9c3')).toBe('#171717')
    expect(canvasLabelColor('#777777')).toBe('#000000')
  })
  it('makes a light frame border colour readable as a title', () => {
    expect(canvasLabelColor('#ffffff99', '#3ea9f4')).toBe('#171717')
  })
  it('accounts for alpha and shape fill opacity over paper', () => {
    expect(canvasLabelColor('#0000')).toBe('#171717')
    expect(canvasLabelColor('#00000033')).toBe('#171717')
    expect(canvasLabelColor('#000000', '#171717', 0.1)).toBe('#171717')
    expect(canvasLabelColor('transparent')).toBe('#171717')
  })
})
