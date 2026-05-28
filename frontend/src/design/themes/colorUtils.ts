export function hexToRgba(hex: string, opacity: number) {
  const normalized = hex.replace('#', '')
  const full = normalized.length === 3
    ? normalized.split('').map((char) => char + char).join('')
    : normalized
  const bigint = parseInt(full, 16)
  const r = (bigint >> 16) & 255
  const g = (bigint >> 8) & 255
  const b = bigint & 255
  return `rgba(${r}, ${g}, ${b}, ${opacity})`
}

function normalizeHex(hex: string) {
  const normalized = hex.replace('#', '')
  return normalized.length === 3
    ? normalized.split('').map((char) => char + char).join('')
    : normalized
}

export function hexToRgb(hex: string) {
  const full = normalizeHex(hex)
  const bigint = parseInt(full, 16)
  return {
    r: (bigint >> 16) & 255,
    g: (bigint >> 8) & 255,
    b: bigint & 255,
  }
}

export function rgbToHex(r: number, g: number, b: number) {
  const clamp = (value: number) => Math.max(0, Math.min(255, Math.round(value)))
  return `#${[clamp(r), clamp(g), clamp(b)].map((value) => value.toString(16).padStart(2, '0')).join('')}`
}

export function mixHexColors(colorA: string, colorB: string, weight = 0.5) {
  const ratio = Math.max(0, Math.min(1, weight))
  const a = hexToRgb(colorA)
  const b = hexToRgb(colorB)

  return rgbToHex(
    a.r + (b.r - a.r) * ratio,
    a.g + (b.g - a.g) * ratio,
    a.b + (b.b - a.b) * ratio
  )
}

export function rgbToHsl(r: number, g: number, b: number) {
  const rn = r / 255
  const gn = g / 255
  const bn = b / 255
  const max = Math.max(rn, gn, bn)
  const min = Math.min(rn, gn, bn)
  const delta = max - min

  let h = 0
  let s = 0
  const l = (max + min) / 2

  if (delta !== 0) {
    s = delta / (1 - Math.abs(2 * l - 1))
    switch (max) {
      case rn:
        h = 60 * (((gn - bn) / delta) % 6)
        break
      case gn:
        h = 60 * ((bn - rn) / delta + 2)
        break
      default:
        h = 60 * ((rn - gn) / delta + 4)
        break
    }
  }

  if (h < 0) h += 360
  return { h, s, l }
}

export function hslToRgb(h: number, s: number, l: number) {
  const c = (1 - Math.abs(2 * l - 1)) * s
  const hp = h / 60
  const x = c * (1 - Math.abs((hp % 2) - 1))

  let r1 = 0
  let g1 = 0
  let b1 = 0

  if (hp >= 0 && hp < 1) {
    r1 = c; g1 = x
  } else if (hp >= 1 && hp < 2) {
    r1 = x; g1 = c
  } else if (hp >= 2 && hp < 3) {
    g1 = c; b1 = x
  } else if (hp >= 3 && hp < 4) {
    g1 = x; b1 = c
  } else if (hp >= 4 && hp < 5) {
    r1 = x; b1 = c
  } else {
    r1 = c; b1 = x
  }

  const m = l - c / 2
  return {
    r: (r1 + m) * 255,
    g: (g1 + m) * 255,
    b: (b1 + m) * 255,
  }
}

export function setHexLightness(color: string, targetLightness: number, saturationScale = 1) {
  const { r, g, b } = hexToRgb(color)
  const { h, s } = rgbToHsl(r, g, b)
  const next = hslToRgb(h, Math.max(0, Math.min(1, s * saturationScale)), Math.max(0, Math.min(1, targetLightness)))
  return rgbToHex(next.r, next.g, next.b)
}
