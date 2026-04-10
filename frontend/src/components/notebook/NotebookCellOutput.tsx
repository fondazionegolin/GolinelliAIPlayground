import type { CellOutput } from '@/hooks/usePyodide'

interface Props {
  outputs: CellOutput[]
  executionCount: number | null
}

export default function NotebookCellOutput({ outputs, executionCount }: Props) {
  if (!outputs || outputs.length === 0) return null

  return (
    <div className="border-t border-[#2a2d36] bg-[#1a1d23] rounded-b-xl font-mono text-xs">
      {/* Output counter */}
      <div className="flex items-center gap-2 px-3 py-1 border-b border-[#2a2d36]">
        <span className="text-[10px] text-slate-500">
          {executionCount !== null ? `[${executionCount}]` : '[ ]'}
        </span>
        <span className="text-[10px] text-slate-500">output</span>
      </div>

      <div className="p-3 space-y-2">
        {outputs.map((out, i) => (
          <OutputBlock key={i} output={out} />
        ))}
      </div>
    </div>
  )
}

function OutputBlock({ output }: { output: CellOutput }) {
  if (output.output_type === 'display_data' && output.data?.['image/png']) {
    return (
      <div className="my-2">
        <img
          src={`data:image/png;base64,${output.data['image/png']}`}
          alt="plot output"
          className="max-w-full rounded-lg shadow-md"
          style={{ maxHeight: '400px', objectFit: 'contain' }}
        />
      </div>
    )
  }

  if (output.output_type === 'error') {
    return (
      <div className="text-red-400 whitespace-pre-wrap leading-relaxed">
        <span className="font-bold text-red-300">{output.ename}</span>
        {output.evalue ? <span className="text-red-400">: {output.evalue}</span> : null}
        {output.traceback && output.traceback.length > 0 && (
          <div className="mt-1 text-red-500/80 text-[11px]">
            {output.traceback
              .filter(l => !l.includes(output.ename || ''))
              .join('\n')}
          </div>
        )}
      </div>
    )
  }

  if (output.text) {
    // Render ANSI-like red (stderr) — simple approach: detect \x1b[31m
    const isError = output.text.includes('\x1b[31m')
    const cleanText = output.text.replace(/\x1b\[[0-9;]*m/g, '')
    return (
      <pre
        className={`whitespace-pre-wrap leading-relaxed ${isError ? 'text-red-400' : 'text-emerald-300'}`}
      >
        {cleanText}
      </pre>
    )
  }

  return null
}
