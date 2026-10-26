import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildSheet } from './snapshot'

/**
 * Renders the scenes dumped by backend/scripts/visual_eval as the reviewer sees them (one tile per step).
 * Opt-in: VC_EVAL_DIR=dir npx vitest run evalDumps. Writes <case>-render.svg (and -reviewed.svg after run_critic).
 */
const dir = process.env.VC_EVAL_DIR
describe.skipIf(!dir || !existsSync(dir))('golden set render', () => {
  for (const file of dir ? readdirSync(dir).filter(f => f.endsWith('.json')) : []) {
    it(file, () => {
      const path = join(dir!, file), dump = JSON.parse(readFileSync(path, 'utf8'))
      if (!dump.ok) return console.log(`${dump.case}: FAILED ${dump.error}`)
      if (!dump.scene) return console.log(`${dump.case}: no drawing (skipped after invalid scenes)`)
      const source = 'data:image/png;base64,' + readFileSync(join(dir!, `${dump.case}.png`)).toString('base64')
      const first = buildSheet(dump.scene, dump.regions, source, dump.width, dump.height)
      writeFileSync(join(dir!, `${dump.case}-render.svg`), first.svg)
      writeFileSync(path, JSON.stringify({ ...dump, issues: first.issues }, null, 1))
      console.log(`${dump.case}: ${dump.scene.steps.length} steps, ${dump.scene.elements.length} marks, ${first.issues.filter(i => i.startsWith('aperto')).length} open issues`)
      if (dump.scene_reviewed) writeFileSync(join(dir!, `${dump.case}-reviewed.svg`), buildSheet(dump.scene_reviewed, dump.regions, source, dump.width, dump.height).svg)
      expect(first.svg).not.toContain('NaN')
    })
  }
})
