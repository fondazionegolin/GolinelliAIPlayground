/**
 * Dark mode by palette inversion.
 *
 * Every Tailwind palette colour is routed through a CSS variable (space-separated RGB so opacity
 * modifiers like `bg-white/80` keep working). In light mode the variables hold the stock Tailwind
 * values, so nothing changes. Under `.dark` they are remapped, which lets the ~7k hard-coded
 * `bg-white` / `text-slate-700` / `bg-violet-50` utilities flip without touching components:
 *
 *   --c-*  surfaces: backgrounds, borders, rings, gradients, fills (`colors`)
 *   --t-*  text + placeholders (`textColor`), mirrored separately so that e.g. `text-violet-700`
 *          gets lighter while `bg-violet-600` (a solid fill behind white text) stays put.
 *
 * `slate` is re-pointed at Tailwind's pure `neutral` greys in both themes (no blue-grey anywhere).
 * Neutral scales mirror onto one soft, near-hueless dark grey ramp; chromatic 50–300 surfaces
 * become low-alpha tints of their hue over the dark surface; chromatic text 500–950 lightens.
 *
 * "Dark islands" — elements painted bg-slate-700…950 (code blocks, terminals, dark chips and
 * buttons) or marked `.theme-keep` — get the light-mode variables back, so they and their
 * children (text-slate-100, border-slate-700…) render exactly as they do in light mode.
 */
const defaultColors = require('tailwindcss/colors')

const SHADES = ['50', '100', '200', '300', '400', '500', '600', '700', '800', '900', '950']
const NEUTRALS = ['slate', 'gray', 'zinc', 'neutral', 'stone']
const CHROMATIC = [
  'red', 'orange', 'amber', 'yellow', 'lime', 'green', 'emerald', 'teal', 'cyan',
  'sky', 'blue', 'indigo', 'violet', 'purple', 'fuchsia', 'pink', 'rose',
]
const SCALES = [...NEUTRALS, ...CHROMATIC]

// Light-mode source for each scale: slate is replaced by pure neutral grey.
const LIGHT_SOURCE = { slate: 'neutral' }

// Dark surface the chromatic tints are mixed onto (between --ds-surface and raised).
const DARK_BASE = '#1f2126'

// Neutral surface ramp: 50–300 step up gently from the raised card (#23262b); 900/950 sink
// below the canvas for wells.
const DARK_NEUTRAL_SURFACE = {
  50: '#282b30', 100: '#2d3036', 200: '#353940', 300: '#434750', 400: '#5a5f68',
  500: '#767c86', 600: '#50555e', 700: '#454951', 800: '#3a3e45', 900: '#17181b', 950: '#101113',
}
// Neutral text ramp: mirrored, capped below pure white for soft contrast.
const DARK_NEUTRAL_TEXT = {
  50: '#2a2d33', 100: '#31343b', 200: '#3d4148', 300: '#565b64', 400: '#7d838d',
  500: '#959aa4', 600: '#aeb3bc', 700: '#c5c9d0', 800: '#d6d9de', 900: '#e3e5e9', 950: '#eceef1',
}

const DARK_WHITE_SURFACE = '#23262b'
const DARK_BLACK_TEXT = '#eceef1'

function hexToRgb(hex) {
  const h = hex.replace('#', '')
  const n = parseInt(h.length === 3 ? h.replace(/./g, '$&$&') : h, 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

function channels(hex) {
  return hexToRgb(hex).join(' ')
}

function mix(hex, baseHex, amount) {
  const a = hexToRgb(hex)
  const b = hexToRgb(baseHex)
  return a.map((v, i) => Math.round(v * amount + b[i] * (1 - amount))).join(' ')
}

function darkChromaticSurface(scale, shade) {
  const s = defaultColors[scale]
  switch (shade) {
    case '50': return mix(s[500], DARK_BASE, 0.10)
    case '100': return mix(s[500], DARK_BASE, 0.16)
    case '200': return mix(s[500], DARK_BASE, 0.26)
    case '300': return mix(s[400], DARK_BASE, 0.45)
    default: return channels(s[shade])
  }
}

function darkChromaticText(scale, shade) {
  const s = defaultColors[scale]
  const lighter = { 500: '400', 600: '400', 700: '300', 800: '200', 900: '100', 950: '50' }[shade]
  return channels(s[lighter ?? shade])
}

function buildVars() {
  const light = {}
  const dark = {}
  for (const scale of SCALES) {
    for (const shade of SHADES) {
      const base = channels(defaultColors[LIGHT_SOURCE[scale] ?? scale][shade])
      light[`--c-${scale}-${shade}`] = base
      light[`--t-${scale}-${shade}`] = base
      if (NEUTRALS.includes(scale)) {
        dark[`--c-${scale}-${shade}`] = channels(DARK_NEUTRAL_SURFACE[shade])
        dark[`--t-${scale}-${shade}`] = channels(DARK_NEUTRAL_TEXT[shade])
      } else {
        dark[`--c-${scale}-${shade}`] = darkChromaticSurface(scale, shade)
        dark[`--t-${scale}-${shade}`] = darkChromaticText(scale, shade)
      }
    }
  }
  light['--c-white'] = '255 255 255'
  light['--t-white'] = '255 255 255'
  light['--c-black'] = '0 0 0'
  light['--t-black'] = '0 0 0'
  dark['--c-white'] = channels(DARK_WHITE_SURFACE)
  dark['--t-white'] = '255 255 255'
  dark['--c-black'] = '0 0 0'
  dark['--t-black'] = channels(DARK_BLACK_TEXT)
  return { light, dark }
}

function paletteFor(prefix) {
  const out = {
    inherit: 'inherit',
    current: 'currentColor',
    transparent: 'transparent',
    white: `rgb(var(--${prefix}-white) / <alpha-value>)`,
    black: `rgb(var(--${prefix}-black) / <alpha-value>)`,
  }
  for (const scale of SCALES) {
    out[scale] = Object.fromEntries(
      SHADES.map((shade) => [shade, `rgb(var(--${prefix}-${scale}-${shade}) / <alpha-value>)`]),
    )
  }
  return out
}

const ISLAND_OPACITIES = ['80', '85', '90', '95']

const ISLAND_SELECTOR = [
  '.theme-keep',
  ...['slate', 'gray', 'zinc', 'neutral', 'stone'].flatMap((scale) =>
    ['700', '800', '900', '950'].flatMap((shade) => [
      `[class~="bg-${scale}-${shade}"]`,
      // Near-opaque fills only: translucent ones (e.g. bg-slate-950/45) are modal backdrops that
      // *wrap* the dialog, and must not drag the dialog back to light colours.
      ...ISLAND_OPACITIES.map((alpha) => `[class~="bg-${scale}-${shade}/${alpha}"]`),
    ]),
  ),
  '[class~="bg-black"]',
].join(',\n')

const darkPalettePlugin = ({ addBase }) => {
  const { light, dark } = buildVars()
  addBase({
    ':root': light,
    '.dark': dark,
    [`.dark :is(${ISLAND_SELECTOR})`]: light,
  })
}

module.exports = {
  surfaceColors: paletteFor('c'),
  textColors: paletteFor('t'),
  darkPalettePlugin,
}
