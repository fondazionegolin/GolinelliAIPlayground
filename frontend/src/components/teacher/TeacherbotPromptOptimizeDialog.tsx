import { useEffect, useState } from 'react'
import { Check, Loader2, Wand2 } from '@/components/icons'
import { teacherbotsApi } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'

interface TeacherbotPromptOptimizeDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  systemPrompt: string
  teacherbotName: string
  teacherbotSynopsis: string
  hasKnowledgeBase: boolean
  onApply: (newPrompt: string) => void
}

/** Rewrites the whole system prompt along prompt-design principles, steered by what the teacher asks for. */
export function TeacherbotPromptOptimizeDialog({
  open,
  onOpenChange,
  systemPrompt,
  teacherbotName,
  teacherbotSynopsis,
  hasKnowledgeBase,
  onApply,
}: TeacherbotPromptOptimizeDialogProps) {
  const [instructions, setInstructions] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<{ prompt: string; changes: string[] } | null>(null)

  useEffect(() => {
    if (!open) {
      setResult(null)
      setError(null)
    }
  }, [open])

  const handleOptimize = async () => {
    setIsLoading(true)
    setError(null)
    try {
      const response = await teacherbotsApi.optimizePrompt({
        system_prompt: systemPrompt,
        instructions,
        name: teacherbotName,
        synopsis: teacherbotSynopsis,
        has_knowledge_base: hasKnowledgeBase,
      })
      if (response.data?.prompt?.trim()) setResult({ prompt: response.data.prompt.trim(), changes: response.data.changes || [] })
      else setError('Nessuna risposta ricevuta')
    } catch (err: any) {
      setError(err.response?.data?.detail || 'Errore durante l\'ottimizzazione')
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!isLoading) onOpenChange(next) }}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Wand2 className="h-5 w-5 text-indigo-600" />
            Ottimizza il system prompt
          </DialogTitle>
          <DialogDescription>
            L'AI riscrive il prompt secondo i principi di prompt design (ruolo, obiettivi, metodo, regole, stile) mantenendo le tue scelte.
          </DialogDescription>
        </DialogHeader>

        {!result && (
          <div className="flex flex-col gap-3">
            <label className="text-sm font-medium text-slate-700" htmlFor="prompt-optimize-instructions">
              Cosa vuoi migliorare? <span className="font-normal text-slate-400">(facoltativo)</span>
            </label>
            <textarea
              id="prompt-optimize-instructions"
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
              disabled={isLoading}
              rows={4}
              className="resize-y rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-800 outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-200"
              placeholder="Es.: deve guidare gli studenti con domande senza dare subito la soluzione; tono più informale; rimanere sugli argomenti dei documenti allegati."
            />
            {!systemPrompt.trim() && (
              <p className="text-xs text-slate-500">Il prompt è vuoto: l'AI ne scriverà uno partendo da nome, descrizione e dalla tua richiesta.</p>
            )}
            {error && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-600">{error}</p>}
          </div>
        )}

        {result && (
          <div className="flex min-h-0 flex-col gap-3">
            {result.changes.length > 0 && (
              <ul className="list-disc space-y-1 rounded-lg border border-indigo-100 bg-indigo-50/60 py-2 pl-7 pr-3 text-sm text-indigo-900">
                {result.changes.map((change, i) => <li key={i}>{change}</li>)}
              </ul>
            )}
            <pre className="max-h-[45vh] overflow-y-auto whitespace-pre-wrap rounded-lg border border-slate-200 bg-slate-50 p-3 font-mono text-xs leading-5 text-slate-700">
              {result.prompt}
            </pre>
          </div>
        )}

        <DialogFooter className="gap-2">
          {!result ? (
            <>
              <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isLoading}>Annulla</Button>
              <Button onClick={handleOptimize} disabled={isLoading} className="gap-2">
                {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wand2 className="h-4 w-4" />}
                {isLoading ? 'Ottimizzazione…' : 'Ottimizza'}
              </Button>
            </>
          ) : (
            <>
              <Button variant="outline" onClick={() => setResult(null)}>Indietro</Button>
              <Button onClick={() => { onApply(result.prompt); onOpenChange(false) }} className="gap-2 bg-green-600 text-white hover:bg-green-700">
                <Check className="h-4 w-4" />
                Sostituisci il prompt
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
