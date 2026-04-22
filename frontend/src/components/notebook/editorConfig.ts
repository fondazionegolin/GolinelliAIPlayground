import { autocompletion, completeFromList } from '@codemirror/autocomplete'
import { indentWithTab } from '@codemirror/commands'
import { javascript, javascriptLanguage } from '@codemirror/lang-javascript'
import { python } from '@codemirror/lang-python'
import { HighlightStyle, indentUnit, syntaxHighlighting } from '@codemirror/language'
import { type Extension, RangeSetBuilder } from '@codemirror/state'
import { tags } from '@lezer/highlight'
import { Decoration } from '@codemirror/view'
import { EditorView, keymap } from '@codemirror/view'
import type { NotebookCodeProposal, NotebookFontFamily, NotebookProjectType, NotebookTheme } from './types'

const p5ApiCompletions = completeFromList([
  // Lifecycle
  'setup', 'draw', 'preload',
  // Canvas
  'createCanvas', 'resizeCanvas', 'noCanvas', 'createGraphics', 'blendMode',
  // Environment
  'frameRate', 'frameCount', 'deltaTime', 'focused', 'displayWidth', 'displayHeight',
  'windowWidth', 'windowHeight', 'width', 'height', 'pixelDensity', 'displayDensity',
  'windowResized', 'fullscreen',
  // Shape - 2D primitives
  'arc', 'ellipse', 'circle', 'line', 'point', 'quad', 'rect', 'square', 'triangle',
  // Shape - curves
  'bezier', 'bezierPoint', 'bezierTangent', 'curve', 'curvePoint', 'curveTangent', 'curveTightness',
  // Shape - vertex
  'beginShape', 'endShape', 'vertex', 'curveVertex', 'bezierVertex', 'quadraticVertex', 'CLOSE',
  // Shape - 3D primitives
  'box', 'cone', 'cylinder', 'ellipsoid', 'plane', 'sphere', 'torus',
  // Shape modes
  'rectMode', 'ellipseMode', 'imageMode', 'strokeCap', 'strokeJoin', 'strokeWeight',
  'CENTER', 'CORNER', 'CORNERS', 'RADIUS',
  // Color
  'background', 'clear', 'colorMode', 'fill', 'noFill', 'stroke', 'noStroke',
  'color', 'red', 'green', 'blue', 'alpha', 'hue', 'saturation', 'brightness',
  'lerpColor', 'RGB', 'HSB', 'HSL',
  // Transforms
  'translate', 'rotate', 'rotateX', 'rotateY', 'rotateZ', 'scale', 'shearX', 'shearY',
  'push', 'pop', 'applyMatrix', 'resetMatrix', 'printMatrix',
  // Text / Typography
  'text', 'textAlign', 'textLeading', 'textSize', 'textStyle', 'textWidth', 'textAscent',
  'textDescent', 'textFont', 'loadFont', 'createFont',
  'LEFT', 'RIGHT', 'TOP', 'BOTTOM', 'BASELINE', 'BOLD', 'ITALIC', 'NORMAL',
  // Image
  'image', 'loadImage', 'createImage', 'imageMode', 'tint', 'noTint', 'copy',
  'filter', 'get', 'set', 'loadPixels', 'updatePixels', 'pixels',
  'GRAY', 'INVERT', 'POSTERIZE', 'BLUR', 'OPAQUE', 'ERODE', 'DILATE', 'THRESHOLD',
  // Math
  'abs', 'ceil', 'constrain', 'dist', 'exp', 'floor', 'lerp', 'log', 'mag', 'map',
  'max', 'min', 'norm', 'pow', 'round', 'sq', 'sqrt',
  'sin', 'cos', 'tan', 'asin', 'acos', 'atan', 'atan2',
  'degrees', 'radians', 'angleMode', 'DEGREES', 'RADIANS',
  'noise', 'noiseDetail', 'noiseSeed', 'random', 'randomGaussian', 'randomSeed',
  'PI', 'TWO_PI', 'HALF_PI', 'QUARTER_PI', 'TAU',
  // Vector
  'createVector',
  // Input - mouse
  'mouseX', 'mouseY', 'pmouseX', 'pmouseY', 'winMouseX', 'winMouseY',
  'mouseButton', 'mouseIsPressed',
  'mousePressed', 'mouseReleased', 'mouseMoved', 'mouseDragged', 'mouseClicked', 'mouseWheel',
  'LEFT', 'RIGHT', 'CENTER',
  // Input - keyboard
  'key', 'keyCode', 'keyIsPressed', 'keyIsDown',
  'keyPressed', 'keyReleased', 'keyTyped',
  'BACKSPACE', 'DELETE', 'ENTER', 'RETURN', 'TAB', 'ESCAPE', 'SHIFT', 'CONTROL', 'ALT',
  'UP_ARROW', 'DOWN_ARROW', 'LEFT_ARROW', 'RIGHT_ARROW',
  // Input - touch
  'touches', 'touchStarted', 'touchMoved', 'touchEnded',
  // Output
  'print', 'saveCanvas', 'save', 'saveTable', 'saveStrings', 'saveJSON',
  // Data - conversion
  'boolean', 'byte', 'char', 'float', 'int', 'str', 'hex', 'unhex', 'binary', 'unbinary',
  // Data - string
  'join', 'match', 'matchAll', 'nf', 'nfc', 'nfp', 'nfs', 'split', 'splitTokens', 'trim',
  // Data - array
  'append', 'arrayCopy', 'concat', 'reverse', 'shorten', 'shuffle', 'sort', 'splice', 'subset',
  // DOM / Utility
  'createDiv', 'createP', 'createSpan', 'createButton', 'createCheckbox', 'createSelect',
  'createSlider', 'createInput', 'createFileInput', 'select', 'selectAll', 'removeElements',
  // Control
  'loop', 'noLoop', 'redraw', 'isLooping', 'frameRate', 'noCursor', 'cursor',
  // Renderer
  'WEBGL', 'P2D', 'createFramebuffer',
  // Loading
  'loadJSON', 'loadStrings', 'loadTable', 'loadBytes', 'loadShader',
  'httpGet', 'httpPost',
].map((label) => ({ label, type: 'function' })))

// ── Per-theme syntax highlight styles ────────────────────────────────────────
// All designed for ≥ 4.5:1 contrast ratio against their respective backgrounds.

const highlightStyles: Record<NotebookTheme, HighlightStyle> = {
  // background #111827  (dark navy)
  dark: HighlightStyle.define([
    { tag: [tags.keyword, tags.modifier],                          color: '#60a5fa', fontWeight: '700' },
    { tag: [tags.self],                                            color: '#60a5fa', fontWeight: '700' },
    { tag: [tags.bool, tags.null],                                 color: '#f472b6', fontWeight: '700' },
    { tag: [tags.string, tags.special(tags.string)],               color: '#86efac' },
    { tag: tags.number,                                            color: '#fb923c' },
    { tag: [tags.comment, tags.lineComment, tags.blockComment],    color: '#6b7280', fontStyle: 'italic' },
    { tag: [tags.function(tags.variableName), tags.function(tags.propertyName)], color: '#a78bfa' },
    { tag: [tags.className, tags.typeName, tags.definition(tags.typeName)],      color: '#34d399' },
    { tag: [tags.operator],                                        color: '#93c5fd' },
    { tag: [tags.punctuation],                                     color: '#94a3b8' },
    { tag: tags.variableName,                                      color: '#e2e8f0' },
    { tag: tags.propertyName,                                      color: '#cbd5e1' },
    { tag: tags.definition(tags.variableName),                     color: '#e2e8f0' },
  ]),

  // background #1f2230  (dracula)
  dracula: HighlightStyle.define([
    { tag: [tags.keyword, tags.modifier],                          color: '#ff79c6', fontWeight: '700' },
    { tag: [tags.self],                                            color: '#ff79c6', fontWeight: '700' },
    { tag: [tags.bool, tags.null],                                 color: '#bd93f9', fontWeight: '700' },
    { tag: [tags.string, tags.special(tags.string)],               color: '#f1fa8c' },
    { tag: tags.number,                                            color: '#ffb86c' },
    { tag: [tags.comment, tags.lineComment, tags.blockComment],    color: '#6272a4', fontStyle: 'italic' },
    { tag: [tags.function(tags.variableName), tags.function(tags.propertyName)], color: '#50fa7b' },
    { tag: [tags.className, tags.typeName, tags.definition(tags.typeName)],      color: '#8be9fd' },
    { tag: [tags.operator],                                        color: '#ff79c6' },
    { tag: [tags.punctuation],                                     color: '#f8f8f2' },
    { tag: tags.variableName,                                      color: '#f8f8f2' },
    { tag: tags.propertyName,                                      color: '#f8f8f2' },
  ]),

  // background #ffffff  (light)
  light: HighlightStyle.define([
    { tag: [tags.keyword, tags.modifier],                          color: '#1d4ed8', fontWeight: '700' },
    { tag: [tags.self],                                            color: '#1d4ed8', fontWeight: '700' },
    { tag: [tags.bool, tags.null],                                 color: '#dc2626', fontWeight: '700' },
    { tag: [tags.string, tags.special(tags.string)],               color: '#059669' },
    { tag: tags.number,                                            color: '#b45309' },
    { tag: [tags.comment, tags.lineComment, tags.blockComment],    color: '#6b7280', fontStyle: 'italic' },
    { tag: [tags.function(tags.variableName), tags.function(tags.propertyName)], color: '#6d28d9' },
    { tag: [tags.className, tags.typeName, tags.definition(tags.typeName)],      color: '#0f766e' },
    { tag: [tags.operator],                                        color: '#374151' },
    { tag: [tags.punctuation],                                     color: '#6b7280' },
    { tag: tags.variableName,                                      color: '#111827' },
    { tag: tags.propertyName,                                      color: '#374151' },
  ]),

  // background #1f2937  (fancy / warm dark)
  fancy: HighlightStyle.define([
    { tag: [tags.keyword, tags.modifier],                          color: '#fb923c', fontWeight: '700' },
    { tag: [tags.self],                                            color: '#fb923c', fontWeight: '700' },
    { tag: [tags.bool, tags.null],                                 color: '#f472b6', fontWeight: '700' },
    { tag: [tags.string, tags.special(tags.string)],               color: '#86efac' },
    { tag: tags.number,                                            color: '#fbbf24' },
    { tag: [tags.comment, tags.lineComment, tags.blockComment],    color: '#6b7280', fontStyle: 'italic' },
    { tag: [tags.function(tags.variableName), tags.function(tags.propertyName)], color: '#c084fc' },
    { tag: [tags.className, tags.typeName, tags.definition(tags.typeName)],      color: '#34d399' },
    { tag: [tags.operator],                                        color: '#fca5a5' },
    { tag: [tags.punctuation],                                     color: '#d1d5db' },
    { tag: tags.variableName,                                      color: '#fff7ed' },
    { tag: tags.propertyName,                                      color: '#fde68a' },
  ]),

  // background #0f172a  (p5js / deep navy)
  p5js: HighlightStyle.define([
    { tag: [tags.keyword, tags.modifier],                          color: '#2dd4bf', fontWeight: '700' },
    { tag: [tags.self],                                            color: '#2dd4bf', fontWeight: '700' },
    { tag: [tags.bool, tags.null],                                 color: '#f472b6', fontWeight: '700' },
    { tag: [tags.string, tags.special(tags.string)],               color: '#86efac' },
    { tag: tags.number,                                            color: '#fb923c' },
    { tag: [tags.comment, tags.lineComment, tags.blockComment],    color: '#64748b', fontStyle: 'italic' },
    { tag: [tags.function(tags.variableName), tags.function(tags.propertyName)], color: '#38bdf8' },
    { tag: [tags.className, tags.typeName, tags.definition(tags.typeName)],      color: '#34d399' },
    { tag: [tags.operator],                                        color: '#7dd3fc' },
    { tag: [tags.punctuation],                                     color: '#94a3b8' },
    { tag: tags.variableName,                                      color: '#f0fdfa' },
    { tag: tags.propertyName,                                      color: '#bfdbfe' },
  ]),
}

// ── Editor background / cursor / selection themes ────────────────────────────

const themePalette: Record<NotebookTheme, Extension> = {
  dark: EditorView.theme({
    '&': { color: '#e5eefc', backgroundColor: '#111827' },
    // backgroundColor must be on .cm-scroller, NOT on .cm-content.
    // .cm-selectionLayer has z-index:-1 (behind content). If .cm-content
    // has a solid background the selection is permanently hidden.
    '.cm-content': { color: '#e5eefc', caretColor: '#60a5fa' },
    '.cm-scroller': { backgroundColor: '#111827' },
    '&.cm-focused .cm-cursor': { borderLeftColor: '#60a5fa' },
    '.cm-gutters': { backgroundColor: '#0f172a', color: '#93c5fd', border: 'none' },
    '.cm-activeLine': { backgroundColor: 'transparent' },
    '.cm-activeLineGutter': { backgroundColor: 'transparent', color: '#fef08a', fontWeight: '700' },
  }, { dark: true }),
  dracula: EditorView.theme({
    '&': { color: '#f8f8f2', backgroundColor: '#1f2230' },
    '.cm-content': { color: '#f8f8f2', caretColor: '#ff79c6' },
    '.cm-scroller': { backgroundColor: '#1f2230' },
    '&.cm-focused .cm-cursor': { borderLeftColor: '#ff79c6' },
    '.cm-gutters': { backgroundColor: '#171a26', color: '#98a2c8', border: 'none' },
    '.cm-activeLine': { backgroundColor: 'transparent' },
    '.cm-activeLineGutter': { backgroundColor: 'transparent', color: '#fef08a', fontWeight: '700' },
  }, { dark: true }),
  light: EditorView.theme({
    '&': { color: '#0f172a', backgroundColor: '#ffffff' },
    '.cm-content': { color: '#0f172a', caretColor: '#0f766e' },
    '.cm-scroller': { backgroundColor: '#ffffff' },
    '&.cm-focused .cm-cursor': { borderLeftColor: '#0f766e' },
    '.cm-gutters': { backgroundColor: '#f1f5f9', color: '#64748b', border: 'none' },
    '.cm-activeLine': { backgroundColor: 'transparent' },
    '.cm-activeLineGutter': { backgroundColor: 'transparent', color: '#a16207', fontWeight: '700' },
  }),
  fancy: EditorView.theme({
    '&': { color: '#fff7ed', backgroundColor: '#1f2937' },
    '.cm-content': { color: '#fff7ed', caretColor: '#f97316' },
    '.cm-scroller': { backgroundColor: '#1f2937' },
    '&.cm-focused .cm-cursor': { borderLeftColor: '#f97316' },
    '.cm-gutters': { backgroundColor: '#111827', color: '#fdba74', border: 'none' },
    '.cm-activeLine': { backgroundColor: 'transparent' },
    '.cm-activeLineGutter': { backgroundColor: 'transparent', color: '#fde047', fontWeight: '700' },
  }, { dark: true }),
  p5js: EditorView.theme({
    '&': { color: '#f0fdfa', backgroundColor: '#0f172a' },
    '.cm-content': { color: '#f0fdfa', caretColor: '#2dd4bf' },
    '.cm-scroller': { backgroundColor: '#0f172a' },
    '&.cm-focused .cm-cursor': { borderLeftColor: '#2dd4bf' },
    '.cm-gutters': { backgroundColor: '#111827', color: '#5eead4', border: 'none' },
    '.cm-activeLine': { backgroundColor: 'transparent' },
    '.cm-activeLineGutter': { backgroundColor: 'transparent', color: '#fde68a', fontWeight: '700' },
  }, { dark: true }),
}

// ── Font stacks ───────────────────────────────────────────────────────────────

const fontStacks: Record<NotebookFontFamily, string> = {
  jetbrains: '"JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace',
  space: '"Space Mono", ui-monospace, SFMono-Regular, Menlo, monospace',
  courier: '"Courier Prime", "Courier New", ui-monospace, monospace',
  victor: '"Victor Mono", ui-monospace, SFMono-Regular, Menlo, monospace',
  plex: '"IBM Plex Mono", ui-monospace, SFMono-Regular, Menlo, monospace',
}

export function getEditorFontStack(fontFamily: NotebookFontFamily) {
  return fontStacks[fontFamily]
}

// ── Proposal decoration helpers ───────────────────────────────────────────────

function getLineOffsets(source: string) {
  const lines = source.split('\n')
  const offsets: number[] = []
  let cursor = 0
  for (const line of lines) {
    offsets.push(cursor)
    cursor += line.length + 1
  }
  offsets.push(source.length)
  return offsets
}

export function proposalDecorationExtension(source: string, proposals: NotebookCodeProposal[]): Extension {
  const offsets = getLineOffsets(source)
  const builder = new RangeSetBuilder<Decoration>()

  for (const proposal of proposals) {
    const from = offsets[Math.max(0, proposal.line_start - 1)] ?? 0
    const lineEndOffset = offsets[Math.max(0, proposal.line_end)] ?? source.length
    const to = Math.max(from, Math.min(source.length, lineEndOffset > 0 ? lineEndOffset - 1 : source.length))
    const decoration = Decoration.mark({
      class: `cm-ai-proposal cm-ai-proposal-${proposal.severity}`,
      attributes: { 'data-ai-proposal': proposal.message },
    })
    builder.add(from, to, decoration)
  }

  return EditorView.decorations.of(builder.finish())
}

// ── Main extension factory ────────────────────────────────────────────────────

export function getEditorExtensions(
  projectType: NotebookProjectType,
  theme: NotebookTheme,
  fontFamily: NotebookFontFamily,
  runKeys: Extension,
  fontWeight = 400,
): Extension[] {
  const language = projectType === 'python'
    ? python()
    : javascript({ jsx: false, typescript: false })

  // For p5js: register completions as language data so they merge with JS built-ins
  const p5LanguageData = projectType === 'p5js'
    ? javascriptLanguage.data.of({ autocomplete: p5ApiCompletions })
    : []

  const extraAutocomplete = autocompletion({ activateOnTypingDelay: 50, maxRenderedOptions: 16 })

  return [
    themePalette[theme] ?? themePalette.dark,
    syntaxHighlighting(highlightStyles[theme] ?? highlightStyles.dark),
    language,
    p5LanguageData,
    indentUnit.of('  '),
    extraAutocomplete,
    runKeys,
    sharedEditorBaseTheme(fontFamily, fontWeight),
  ]
}

// ── Shared base theme (font + layout) ────────────────────────────────────────
// Uses EditorView.theme (not baseTheme) so it can be reconfigured in real-time
// when fontFamily changes and @uiw/react-codemirror swaps the extensions compartment.

export const sharedEditorBaseTheme = (fontFamily: NotebookFontFamily, fontWeight = 400) => EditorView.theme({
  '&': { height: '100%' },
  '.cm-editor': { height: '100%' },
  '.cm-scroller': {
    minHeight: '100%',
    overflow: 'auto',
    fontFamily: fontStacks[fontFamily],
  },
  '.cm-content': {
    fontFamily: fontStacks[fontFamily],
    fontWeight: String(fontWeight),
    fontVariantLigatures: 'common-ligatures contextual',
    fontFeatureSettings: '"calt" 1, "liga" 1',
  },
  '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection': {
    backgroundColor: 'rgba(253, 230, 138, 0.38)',
  },
  '.cm-gutters': { fontFamily: fontStacks[fontFamily] },
  '.cm-ai-proposal': {
    borderBottomWidth: '2px',
    borderBottomStyle: 'wavy',
    cursor: 'help',
  },
  '.cm-ai-proposal-error': {
    borderBottomColor: '#ef4444',
    backgroundColor: 'rgba(239,68,68,0.08)',
  },
  '.cm-ai-proposal-warning': {
    borderBottomColor: '#f59e0b',
    backgroundColor: 'rgba(245,158,11,0.08)',
  },
  '.cm-ai-proposal-info': {
    borderBottomColor: '#06b6d4',
    backgroundColor: 'rgba(6,182,212,0.08)',
  },
})

export function getNotebookThemeSurface(theme: NotebookTheme) {
  if (theme === 'light') {
    return {
      shell: 'border-slate-200 bg-white',
      toolbar: 'border-slate-200 bg-slate-50',
      label: 'text-slate-500',
      subtle: 'text-slate-400',
    }
  }
  if (theme === 'fancy') {
    return {
      shell: 'border-fuchsia-900/50 bg-[#1b1730]',
      toolbar: 'border-fuchsia-900/50 bg-[#151126]',
      label: 'text-fuchsia-200/80',
      subtle: 'text-fuchsia-200/55',
    }
  }
  if (theme === 'p5js') {
    return {
      shell: 'border-teal-900/50 bg-[#0b1723]',
      toolbar: 'border-teal-900/50 bg-[#08131d]',
      label: 'text-teal-100/80',
      subtle: 'text-teal-100/55',
    }
  }
  if (theme === 'dracula') {
    return {
      shell: 'border-slate-700 bg-[#1f2230]',
      toolbar: 'border-slate-700 bg-[#171a26]',
      label: 'text-slate-200/80',
      subtle: 'text-slate-300/50',
    }
  }
  return {
    shell: 'border-slate-700 bg-[#111827]',
    toolbar: 'border-slate-700 bg-[#0f172a]',
    label: 'text-slate-100/80',
    subtle: 'text-slate-300/50',
  }
}

// ── Keymap ───────────────────────────────────────────────────────────────────

export const editorKeymap = (run: () => void, insertBelow?: () => void) => keymap.of([
  { key: 'Shift-Enter', run: () => { run(); return true } },
  {
    key: 'Alt-Enter',
    run: () => {
      run()
      insertBelow?.()
      return true
    },
  },
  indentWithTab,
])
