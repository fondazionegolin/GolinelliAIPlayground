'use strict'
// Bundle the project like the platform would (entry mounts <App/>), with every library resolved locally.
const fs = require('fs')
const path = require('path')
const esbuild = require('esbuild')
const { importedPackages, installed } = require('./workspace')

// Libraries Sandpack offers that this image does not carry: a run that needs them is "not testable", never "broken".
const HEAVY = new Set(['three', '@react-three/fiber', '@react-three/drei', 'cannon-es', 'p5', 'd3', 'tone', 'phaser', 'pixi.js', 'mathjs',
  '@tensorflow/tfjs', '@tensorflow/tfjs-core', '@tensorflow/tfjs-converter', '@tensorflow/tfjs-backend-webgl', '@tensorflow/tfjs-backend-cpu',
  '@tensorflow-models/face-landmarks-detection', '@tensorflow-models/hand-pose-detection', '@tensorflow-models/pose-detection',
  '@tensorflow-models/coco-ssd', '@tensorflow-models/mobilenet', '@tensorflow-models/knn-classifier', '@vladmandic/face-api', 'ml5',
  'onnxruntime-web', '@xenova/transformers', '@mediapipe/tasks-vision', 'react-webcam'])

const ENTRY = `import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
${'${STYLES}'}
class Boundary extends React.Component<{ children: React.ReactNode }, { error: any }> {
  state = { error: null as any }
  static getDerivedStateFromError(error: any) { return { error } }
  componentDidCatch(error: any) { (window as any).__qaCrash = { message: String(error && error.message || error), stack: String(error && error.stack || '').slice(0, 600) } }
  render() { return this.state.error ? <pre data-qa-crash>Errore: {String((this.state.error as any).message || this.state.error)}</pre> : this.props.children }
}
createRoot(document.getElementById('root')!).render(<React.StrictMode><Boundary><App /></Boundary></React.StrictMode>)
`

async function bundleProject(ws, files) {
  const packages = importedPackages(files)
  const heavyMissing = packages.filter((pkg) => !installed(pkg) && HEAVY.has(pkg))
  if (heavyMissing.length) return { ok: false, skipped: true, reason: 'librerie pesanti non disponibili nel QA: ' + heavyMissing.join(', '), errors: [] }
  const hasCss = fs.existsSync(path.join(ws.root, 'styles.css'))
  fs.writeFileSync(path.join(ws.root, '__qa_entry.tsx'), ENTRY.replace("${STYLES}", hasCss ? "import './styles.css'" : ''))
  try {
    const result = await esbuild.build({
      entryPoints: [path.join(ws.root, '__qa_entry.tsx')], bundle: true, write: false, format: 'iife', platform: 'browser',
      jsx: 'automatic', outdir: path.join(ws.root, '__out'), logLevel: 'silent', sourcemap: false, target: 'es2020',
      loader: { '.png': 'dataurl', '.jpg': 'dataurl', '.svg': 'dataurl', '.woff2': 'dataurl' },
      define: { 'process.env.NODE_ENV': '"development"', global: 'window' },
      nodePaths: [path.join(__dirname, '..', 'node_modules')],
    })
    const js = result.outputFiles.find((f) => f.path.endsWith('.js'))
    const css = result.outputFiles.find((f) => f.path.endsWith('.css'))
    return { ok: true, js: js ? js.text : '', css: css ? css.text : '', errors: [] }
  } catch (error) {
    const errors = (error.errors || []).slice(0, 12).map((e) => ({
      file: e.location ? e.location.file : '', line: e.location ? e.location.line : 0, message: String(e.text || '').slice(0, 240),
    }))
    return { ok: false, skipped: false, errors, reason: errors[0] ? errors[0].message : String(error.message || error).slice(0, 240) }
  }
}

module.exports = { bundleProject }
