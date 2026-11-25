import { type Extension } from '@codemirror/state'
import { Decoration, EditorView, WidgetType } from '@codemirror/view'

export type DiffOp = { op: 'eq' | 'add' | 'del'; text: string }

/** Line diff (common prefix/suffix trimmed, LCS in the middle). Very large middles fall back to «all removed, all added». */
export function lineDiff(before: string, after: string): DiffOp[] {
  const a = before.split('\n'), b = after.split('\n')
  let start = 0
  while (start < a.length && start < b.length && a[start] === b[start]) start++
  let endA = a.length, endB = b.length
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) { endA--; endB-- }
  const ops: DiffOp[] = a.slice(0, start).map(text => ({ op: 'eq', text }))
  const midA = a.slice(start, endA), midB = b.slice(start, endB)
  if (midA.length * midB.length > 4_000_000) {
    midA.forEach(text => ops.push({ op: 'del', text })); midB.forEach(text => ops.push({ op: 'add', text }))
  } else {
    const n = midA.length, m = midB.length
    const table = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1))
    for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--)
      table[i][j] = midA[i] === midB[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1])
    let i = 0, j = 0
    while (i < n && j < m) {
      if (midA[i] === midB[j]) { ops.push({ op: 'eq', text: midA[i] }); i++; j++ }
      else if (table[i + 1][j] >= table[i][j + 1]) ops.push({ op: 'del', text: midA[i++] })
      else ops.push({ op: 'add', text: midB[j++] })
    }
    while (i < n) ops.push({ op: 'del', text: midA[i++] })
    while (j < m) ops.push({ op: 'add', text: midB[j++] })
  }
  for (const text of a.slice(endA)) ops.push({ op: 'eq', text })
  return ops
}

export function diffStats(ops: DiffOp[]) {
  return { added: ops.filter(o => o.op === 'add').length, removed: ops.filter(o => o.op === 'del').length }
}

class RemovedLines extends WidgetType {
  constructor(readonly lines: string[]) { super() }
  eq(other: RemovedLines) { return other.lines.join('\n') === this.lines.join('\n') }
  toDOM() {
    const box = document.createElement('div')
    box.className = 'cm-diff-removed'
    box.setAttribute('aria-label', 'Righe rimosse dall’agente')
    for (const line of this.lines) {
      const row = document.createElement('div')
      row.className = 'cm-diff-removed-line'
      row.textContent = line || ' '
      box.appendChild(row)
    }
    return box
  }
  ignoreEvent() { return true }
}

/** Shows what the agent changed straight in the editor: added lines in green, removed lines as red ghost blocks. */
export function agentDiffExtension(before: string | null | undefined, after: string): Extension {
  if (before == null || before === after) return []
  const ranges: ReturnType<Decoration['range']>[] = []
  const lineStarts: number[] = []
  let offset = 0
  for (const line of after.split('\n')) { lineStarts.push(offset); offset += line.length + 1 }
  let newLine = 0, pending: string[] = []
  const flush = () => {
    if (!pending.length) return
    const at = newLine < lineStarts.length ? lineStarts[newLine] : after.length
    ranges.push(Decoration.widget({ widget: new RemovedLines(pending), block: true, side: -1 }).range(at))
    pending = []
  }
  for (const op of lineDiff(before, after)) {
    if (op.op === 'del') { pending.push(op.text); continue }
    flush()
    if (op.op === 'add') ranges.push(Decoration.line({ class: 'cm-diff-added' }).range(lineStarts[newLine]))
    newLine++
  }
  flush()
  return [EditorView.decorations.of(Decoration.set(ranges, true)), diffTheme]
}

const diffTheme = EditorView.baseTheme({
  '.cm-diff-added': { backgroundColor: 'rgba(34, 197, 94, 0.18)', boxShadow: 'inset 3px 0 0 #22c55e' },
  '.cm-diff-removed': { backgroundColor: 'rgba(239, 68, 68, 0.16)', boxShadow: 'inset 3px 0 0 #ef4444', padding: '0' },
  '.cm-diff-removed-line': { whiteSpace: 'pre', padding: '0 6px 0 12px', textDecoration: 'line-through', textDecorationColor: 'rgba(239, 68, 68, 0.7)', opacity: '0.85', color: '#ef4444' },
})
