import { useState, useEffect, useRef } from 'react'
import { Sparkles, X, Check, Loader2, Zap, Expand } from 'lucide-react'
import { llmApi } from '@/lib/api'
import { Button } from '@/components/ui/button'

interface TeacherbotPromptOptimizerProps {
    selectedText: string
    teacherbotName: string
    teacherbotSynopsis: string
    position: { x: number; y: number }
    onClose: () => void
    onApply: (newText: string) => void
    /** 'full' = rewrite entire prompt structure (default, for new bots)
     *  'expand' = expand a single rule/fragment into concrete behavioral guidelines */
    mode?: 'full' | 'expand'
}

export function TeacherbotPromptOptimizer({
    selectedText,
    teacherbotName,
    teacherbotSynopsis,
    position,
    onClose,
    onApply,
    mode = 'full',
}: TeacherbotPromptOptimizerProps) {
    const [isLoading, setIsLoading] = useState(false)
    const [result, setResult] = useState<string | null>(null)
    const [error, setError] = useState<string | null>(null)
    const panelRef = useRef<HTMLDivElement>(null)
    const [adjustedPosition, setAdjustedPosition] = useState(position)

    useEffect(() => {
        if (panelRef.current) {
            const rect = panelRef.current.getBoundingClientRect()
            const viewportWidth = window.innerWidth
            const viewportHeight = window.innerHeight
            let newX = position.x
            let newY = position.y
            if (position.x + rect.width > viewportWidth - 20) newX = viewportWidth - rect.width - 20
            if (newX < 20) newX = 20
            if (position.y + rect.height > viewportHeight - 20) newY = position.y - rect.height - 10
            if (newY < 80) newY = 80
            setAdjustedPosition({ x: newX, y: newY })
        }
    }, [position, result])

    useEffect(() => {
        const handleClickOutside = (e: MouseEvent) => {
            if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
                if (!isLoading) onClose()
            }
        }
        document.addEventListener('mousedown', handleClickOutside)
        return () => document.removeEventListener('mousedown', handleClickOutside)
    }, [onClose, isLoading])

    const buildPrompt = () => {
        if (mode === 'expand') {
            return `Sei un esperto di Prompt Engineering per chatbot educativi.

Il docente ha scritto questa istruzione/bozza per il suo chatbot:
"""
${selectedText}
"""

Espandi questa istruzione in 4-6 regole comportamentali SPECIFICHE, CONCRETE e DIRETTAMENTE APPLICABILI che il chatbot deve seguire per realizzare l'intento espresso.

Ogni regola deve:
- Essere un'istruzione diretta al chatbot (inizia con un verbo imperativo)
- Essere sufficientemente specifica da guidare il comportamento senza ambiguità
- Coprire un aspetto diverso dell'intenzione originale (tono, metodo, limite, risposta agli errori, ecc.)

Output: SOLO le regole in formato elenco puntato (usa -), nessun commento o introduzione.`
        }

        // mode === 'full'
        return `Agisci come un esperto di Prompt Engineering per LLM (Large Language Models) in contesto educativo.
Il tuo compito è scrivere un SYSTEM PROMPT ottimizzato per un chatbot educativo ("Teacherbot").

Dati del Teacherbot:
- Nome: ${teacherbotName}
- Sinossi: ${teacherbotSynopsis}

Bozza attuale dell'utente (o parte di essa):
"""
${selectedText}
"""

Obiettivo:
Crea una versione espansa, professionale e ben strutturata del System Prompt basandoti sulla bozza e sui dati del bot.
Il prompt deve definire chiaramente:
1. Ruolo e Identità
2. Obiettivi pedagogici
3. Tono di voce
4. Regole di comportamento e limiti
5. Metodologia didattica (es. Socratica, Spiegazione passo-passo, ecc.)

Rispondi SOLO con il testo del System Prompt ottimizzato, pronto per essere incollato. Nessuna premessa o commento.`
    }

    const handleOptimize = async () => {
        setIsLoading(true)
        setError(null)
        try {
            const response = await llmApi.teacherChat(
                buildPrompt(), [], 'teacher_support', 'anthropic', 'claude-haiku-4-5-20251001'
            )
            const msg = response.data?.response || response.data?.content || ''
            if (msg) setResult(msg.trim())
            else setError('Nessuna risposta ricevuta')
        } catch (err: any) {
            setError(err.response?.data?.detail || 'Errore durante la generazione')
        } finally {
            setIsLoading(false)
        }
    }

    const isExpand = mode === 'expand'

    return (
        <div
            ref={panelRef}
            className="fixed z-[9999] bg-white rounded-xl shadow-2xl border border-slate-200 overflow-hidden w-80 md:w-96 flex flex-col"
            style={{ left: adjustedPosition.x, top: adjustedPosition.y }}
        >
            {/* Header */}
            <div className={`px-4 py-2 flex items-center justify-between shrink-0 ${isExpand ? 'bg-gradient-to-r from-indigo-700 to-indigo-900' : 'bg-gradient-to-r from-[#181b1e] to-slate-800'}`}>
                <div className="flex items-center gap-2 text-white">
                    {isExpand ? <Expand className="h-4 w-4" /> : <Sparkles className="h-4 w-4" />}
                    <span className="font-medium text-sm">
                        {isExpand ? 'Espandi in Regole' : 'Ottimizzatore Prompt AI'}
                    </span>
                </div>
                <button onClick={onClose} className="text-white/80 hover:text-white transition-colors" disabled={isLoading}>
                    <X className="h-4 w-4" />
                </button>
            </div>

            <div className="p-4 flex flex-col gap-4 max-h-[80vh] overflow-hidden">
                {/* Input Preview */}
                {!result && (
                    <div className="bg-slate-50 p-3 rounded-lg border border-slate-100">
                        <p className="text-xs text-slate-500 font-medium mb-1">
                            {isExpand ? 'Regola da espandere:' : 'Testo selezionato:'}
                        </p>
                        <p className="text-sm text-slate-700 italic line-clamp-3">"{selectedText}"</p>
                    </div>
                )}

                {isExpand && !result && !isLoading && (
                    <p className="text-xs text-slate-500 text-center">
                        L'AI trasformerà questa istruzione in 4-6 regole comportamentali concrete e specifiche.
                    </p>
                )}

                {/* Action Button */}
                {!result && !isLoading && (
                    <Button
                        onClick={handleOptimize}
                        className={`w-full text-white gap-2 ${isExpand ? 'bg-indigo-700 hover:bg-indigo-800' : 'bg-[#181b1e] hover:bg-[#0f1113]'}`}
                    >
                        {isExpand ? <Expand className="h-4 w-4" /> : <Zap className="h-4 w-4" />}
                        {isExpand ? 'Genera Regole' : 'Espandi System Prompt'}
                    </Button>
                )}

                {/* Loading */}
                {isLoading && (
                    <div className="py-8 flex flex-col items-center justify-center gap-3">
                        <Loader2 className={`h-8 w-8 animate-spin ${isExpand ? 'text-indigo-600' : 'text-[#181b1e]'}`} />
                        <p className="text-sm text-slate-600 font-medium">
                            {isExpand ? 'Generazione regole in corso...' : "L'AI sta scrivendo il prompt migliore..."}
                        </p>
                    </div>
                )}

                {/* Error */}
                {error && (
                    <div className="bg-red-50 text-red-600 p-3 rounded-lg text-sm">
                        {error}
                        <Button variant="link" onClick={() => setError(null)} className="h-auto p-0 ml-2">Riprova</Button>
                    </div>
                )}

                {/* Result */}
                {result && (
                    <div className="flex flex-col gap-3 flex-1 overflow-hidden">
                        <div className="flex items-center justify-between">
                            <span className="text-sm font-medium text-slate-800">
                                {isExpand ? 'Regole generate:' : 'Proposta AI:'}
                            </span>
                        </div>
                        <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 overflow-y-auto min-h-[120px] max-h-64">
                            <p className="text-xs font-mono whitespace-pre-wrap text-slate-700">{result}</p>
                        </div>
                        <div className="flex gap-2 shrink-0">
                            <Button variant="outline" onClick={() => setResult(null)} className="flex-1">Indietro</Button>
                            <Button
                                onClick={() => { onApply(result); onClose() }}
                                className={`flex-1 text-white gap-2 ${isExpand ? 'bg-indigo-600 hover:bg-indigo-700' : 'bg-green-600 hover:bg-green-700'}`}
                            >
                                <Check className="h-4 w-4" />
                                Applica
                            </Button>
                        </div>
                    </div>
                )}
            </div>
        </div>
    )
}
