import type { Scene } from './spec'
import water from './demos/water.json'
import moon from './demos/moon.json'
import pendulum from './demos/pendulum.json'
import enzyme from './demos/enzyme.json'

export type Demo = { key: string; title: string; description: string; scene: Scene }

/** Ready-made scenes: a gallery for building without the AI, and worked examples of the scene format. */
export const DEMOS: Demo[] = [
  { key: 'water', title: "Formazione dell'acqua", description: 'Chimica · legami che si rompono e si formano', scene: water as unknown as Scene },
  { key: 'moon', title: 'Le fasi della Luna', description: 'Astronomia · geometria Sole–Terra–Luna', scene: moon as unknown as Scene },
  { key: 'pendulum', title: 'Pendolo ed energia', description: 'Fisica · energia cinetica e potenziale', scene: pendulum as unknown as Scene },
  { key: 'enzyme', title: 'Enzima e substrato', description: 'Biochimica · sito attivo e adattamento indotto', scene: enzyme as unknown as Scene },
]
