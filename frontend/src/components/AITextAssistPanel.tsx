import { useState, useEffect, useRef } from 'react'
import { Sparkles, Expand, RefreshCw, Wand2, Loader2, X, Check } from 'lucide-react'
import { llmApi } from '@/lib/api'

interface AITextAssistPanelProps {
  selectedText: string
  position?: { x: number; y: number }
  onClose: () => void
  onApply: (newText: string) => void
  context?: string // Optional context about the document
  variant?: 'floating' | 'docked'
}

type AssistAction = 'expand' | 'reformat' | 'generate' | 'custom'

export function AITextAssistPanel({
  selectedText,
  position,
  onClose,
  onApply,
  context,
  variant = 'floating'
}: AITextAssistPanelProps) {
  const [isLoading, setIsLoading] = useState(false)
  const [result, setResult] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [activeAction, setActiveAction] = useState<AssistAction | null>(null)
  const [customInstruction, setCustomInstruction] = useState('')
  const panelRef = useRef<HTMLDivElement>(null)

  // Adjust position to stay within viewport
  const [adjustedPosition, setAdjustedPosition] = useState(position || { x: 20, y: 80 })

  useEffect(() => {
    if (variant !== 'floating') return
    if (!position) return
    if (panelRef.current) {
      const rect = panelRef.current.getBoundingClientRect()
      const viewportWidth = window.innerWidth
      const viewportHeight = window.innerHeight

      let newX = position.x
      let newY = position.y

      // Keep panel within horizontal bounds
      if (position.x + rect.width > viewportWidth - 20) {
        newX = viewportWidth - rect.width - 20
      }
      if (newX < 20) newX = 20

      // Keep panel within vertical bounds
      if (position.y + rect.height > viewportHeight - 20) {
        newY = position.y - rect.height - 10
      }
      if (newY < 80) newY = 80

      setAdjustedPosition({ x: newX, y: newY })
    }
  }, [position, variant])

  // Close on outside click
  useEffect(() => {
    if (variant !== 'floating') return
    const handleClickOutside = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        if (!isLoading) {
          onClose()
        }
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [onClose, isLoading, variant])

  // Close on Escape
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !isLoading) {
        onClose()
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [onClose, isLoading])

  const handleAction = async (action: AssistAction) => {
    setIsLoading(true)
    setError(null)
    setResult(null)
    setActiveAction(action)

    let prompt = ''
    const contextInfo = context ? `\n\nContesto del documento: ${context}` : ''

    switch (action) {
      case 'expand':
        prompt = `Espandi BREVEMENTE il seguente testo aggiungendo solo i dettagli essenziali. Mantieni il testo originale riconoscibile ma arricchiscilo in modo SINTETICO (massimo 2-3 frasi in più).${contextInfo}

Testo da espandere:
"""
${selectedText}
"""

Rispondi SOLO con il testo espanso, senza introduzioni. Sii conciso.`
        break

      case 'reformat':
        prompt = `Riformatta il seguente testo migliorando chiarezza e leggibilità. Mantieni la stessa lunghezza o riducila se possibile.${contextInfo}

Testo da riformattare:
"""
${selectedText}
"""

Rispondi SOLO con il testo riformattato, senza introduzioni.`
        break

      case 'generate':
        prompt = `Genera un contenuto BREVE e SINTETICO basandoti sulle indicazioni. Massimo 3-4 frasi o un breve elenco puntato.${contextInfo}

Indicazioni:
"""
${selectedText}
"""

Rispondi SOLO con il contenuto generato, senza introduzioni. Sii conciso e diretto.`
        break
      case 'custom':
        prompt = `Applica ESATTAMENTE l'istruzione seguente al testo selezionato, come se fosse una trasformazione diretta del documento. Non aggiungere commenti o spiegazioni.${contextInfo}

Istruzione:
"""
${customInstruction}
"""

Testo da trasformare:
"""
${selectedText}
"""

${/converti in formula|formula|latex/i.test(customInstruction)
  ? 'Se l\'istruzione richiede una formula, rispondi SOLO con LaTeX valido racchiuso tra $...$ (o $$...$$ se necessario), senza altro testo.'
  : 'Rispondi SOLO con il testo trasformato, senza introduzioni.'}`
        break
    }

    try {
      const response = await llmApi.teacherChat(
        prompt,
        [],
        'teacher_support',
        'anthropic',
        'claude-haiku-4-5-20251001'
      )

      const assistantMessage = response.data?.response || response.data?.content || ''
      if (assistantMessage) {
        setResult(assistantMessage.trim())
      } else {
        setError('Nessuna risposta ricevuta')
      }
    } catch (err: any) {
      console.error('AI assist error:', err)
      setError(err.response?.data?.detail || 'Errore durante la generazione')
    } finally {
      setIsLoading(false)
    }
  }

  const handleApplyResult = () => {
    if (result) {
      onApply(result)
      onClose()
    }
  }

  if (variant === 'docked') {
    return (
      <div
        ref={panelRef}
        className="absolute left-0 right-0 bottom-0 z-[60] overflow-hidden border-t border-slate-700 bg-slate-900 shadow-2xl"
      >
        <div className="flex items-center justify-between gap-3 px-4 py-3">
          <div className="min-w-0">
            <p className="text-xs font-medium text-slate-300">Assistente AI</p>
            <p className="truncate text-sm text-slate-100">
              {selectedText.length > 140 ? `${selectedText.substring(0, 140)}...` : selectedText}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {!isLoading && !result && (
              <>
                <button
                  onClick={() => handleAction('expand')}
                  className="rounded-md bg-white/10 px-2.5 py-1.5 text-xs text-white transition-colors hover:bg-white/20"
                >
                  Espandi
                </button>
                <button
                  onClick={() => handleAction('reformat')}
                  className="rounded-md bg-white/10 px-2.5 py-1.5 text-xs text-white transition-colors hover:bg-white/20"
                >
                  Riformatta
                </button>
                <button
                  onClick={() => handleAction('generate')}
                  className="rounded-md bg-white/10 px-2.5 py-1.5 text-xs text-white transition-colors hover:bg-white/20"
                >
                  Genera
                </button>
                <button
                  onClick={() => setActiveAction(activeAction === 'custom' ? null : 'custom')}
                  className="rounded-md bg-white/10 px-2.5 py-1.5 text-xs text-white transition-colors hover:bg-white/20"
                >
                  Personalizza
                </button>
              </>
            )}
            <button
              onClick={onClose}
              className="rounded-md p-1 text-slate-300 transition-colors hover:bg-white/10 hover:text-white"
              disabled={isLoading}
              aria-label="Chiudi assistente AI"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {activeAction === 'custom' && !isLoading && !result && (
          <div className="border-t border-slate-700 px-4 py-3">
            <textarea
              value={customInstruction}
              onChange={(e) => setCustomInstruction(e.target.value)}
              placeholder="Inserisci istruzione..."
              className="mb-2 h-20 w-full resize-none rounded-md border border-slate-600 bg-slate-800 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-400 focus:border-slate-500 focus:outline-none"
            />
            <button
              onClick={() => handleAction('custom')}
              disabled={!customInstruction.trim()}
              className="rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Applica istruzione
            </button>
          </div>
        )}

        {isLoading && (
          <div className="flex items-center gap-2 border-t border-slate-700 px-4 py-3 text-sm text-slate-200">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span>Elaborazione in corso...</span>
          </div>
        )}

        {error && (
          <div className="border-t border-slate-700 px-4 py-3">
            <p className="text-sm text-rose-300">{error}</p>
          </div>
        )}

        {result && !isLoading && (
          <div className="border-t border-slate-700 px-4 py-3">
            <div className="max-h-48 overflow-y-auto rounded-md border border-slate-700 bg-slate-800 p-3 text-sm text-slate-100">
              {result}
            </div>
            <div className="mt-3 flex justify-end gap-2">
              <button
                onClick={() => {
                  setResult(null)
                  setActiveAction(null)
                  setError(null)
                }}
                className="rounded-md border border-slate-600 px-3 py-1.5 text-xs text-slate-200 transition-colors hover:bg-white/10"
              >
                Annulla
              </button>
              <button
                onClick={handleApplyResult}
                className="rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-emerald-500"
              >
                Applica al testo
              </button>
            </div>
          </div>
        )}
      </div>
    )
  }

  return (
    <div
      ref={panelRef}
      className='fixed z-[9999] bg-white rounded-xl shadow-2xl border border-slate-200 overflow-hidden'
      style={{
          left: adjustedPosition.x,
          top: adjustedPosition.y,
          minWidth: 280,
          maxWidth: 400,
        }}
    >
      {/* Header */}
      <div className='bg-gradient-to-r from-violet-500 to-indigo-500 px-4 py-2 flex items-center justify-between'>
        <div className="flex items-center gap-2 text-white">
          <Sparkles className="h-4 w-4" />
          <span className="font-medium text-sm">Assistente AI</span>
        </div>
        <button
          onClick={onClose}
          className="text-white/80 hover:text-white transition-colors"
          disabled={isLoading}
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Selected text preview */}
      <div className="px-4 py-2 bg-slate-50 border-b">
        <p className="text-xs text-slate-500 mb-1">Testo selezionato:</p>
        <p className="text-sm text-slate-700 line-clamp-2 italic">
          "{selectedText.length > 100 ? selectedText.substring(0, 100) + '...' : selectedText}"
        </p>
      </div>

      {/* Actions */}
      {!result && !isLoading && (
        <div className="p-3 space-y-2">
          <button
            onClick={() => handleAction('expand')}
            className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-violet-50 transition-colors text-left group"
          >
            <div className="p-2 rounded-lg bg-violet-100 text-violet-600 group-hover:bg-violet-200 transition-colors">
              <Expand className="h-4 w-4" />
            </div>
            <div>
              <p className="font-medium text-sm text-slate-800">Espandi contenuto</p>
              <p className="text-xs text-slate-500">Arricchisce mantenendo il testo originale</p>
            </div>
          </button>

          <button
            onClick={() => handleAction('reformat')}
            className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-blue-50 transition-colors text-left group"
          >
            <div className="p-2 rounded-lg bg-blue-100 text-blue-600 group-hover:bg-blue-200 transition-colors">
              <RefreshCw className="h-4 w-4" />
            </div>
            <div>
              <p className="font-medium text-sm text-slate-800">Riformatta testo</p>
              <p className="text-xs text-slate-500">Migliora stile e chiarezza</p>
            </div>
          </button>

          <button
            onClick={() => handleAction('generate')}
            className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-emerald-50 transition-colors text-left group"
          >
            <div className="p-2 rounded-lg bg-emerald-100 text-emerald-600 group-hover:bg-emerald-200 transition-colors">
              <Wand2 className="h-4 w-4" />
            </div>
            <div>
              <p className="font-medium text-sm text-slate-800">Genera nuovo contenuto</p>
              <p className="text-xs text-slate-500">Crea da zero basandosi sul testo</p>
            </div>
          </button>
        </div>
      )}

      {/* Loading state */}
      {isLoading && (
        <div className="p-6 flex flex-col items-center gap-3">
          <Loader2 className="h-8 w-8 text-violet-500 animate-spin" />
          <p className="text-sm text-slate-600">
            {activeAction === 'expand' && 'Espansione in corso...'}
            {activeAction === 'reformat' && 'Riformattazione in corso...'}
            {activeAction === 'generate' && 'Generazione in corso...'}
          </p>
        </div>
      )}

      {/* Error state */}
      {error && (
        <div className="p-4">
          <div className="bg-red-50 text-red-700 px-3 py-2 rounded-lg text-sm mb-3">
            {error}
          </div>
          <button
            onClick={() => { setError(null); setActiveAction(null) }}
            className="w-full py-2 text-sm text-slate-600 hover:text-slate-800"
          >
            Riprova
          </button>
        </div>
      )}

      {/* Result state */}
      {result && (
        <div className="p-3">
          <p className="text-xs text-slate-500 mb-2">Risultato:</p>
          <div className="bg-slate-50 rounded-lg p-3 max-h-48 overflow-y-auto mb-3">
            <p className="text-sm text-slate-700 whitespace-pre-wrap">{result}</p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => { setResult(null); setActiveAction(null) }}
              className="flex-1 py-2 px-3 text-sm text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
            >
              Annulla
            </button>
            <button
              onClick={handleApplyResult}
              className="flex-1 py-2 px-3 text-sm bg-violet-600 text-white rounded-lg hover:bg-violet-700 transition-colors flex items-center justify-center gap-2"
            >
              <Check className="h-4 w-4" />
              Applica
            </button>
          </div>
        </div>
      )}

      {/* Custom instruction */}
      {!result && !isLoading && (
        <div className="p-3 pt-0">
          <div className="border-t border-slate-200 pt-3">
            <div className="flex items-center gap-2 text-slate-700 mb-2">
              <Wand2 className="h-4 w-4 text-pink-500" />
              <span className="text-sm font-semibold">Modifica personalizzata</span>
            </div>
            <textarea
              value={customInstruction}
              onChange={(e) => setCustomInstruction(e.target.value)}
              className="w-full min-h-[70px] text-sm border rounded-lg p-2 focus:outline-none focus:ring-2 focus:ring-pink-400/40"
              placeholder="Es: traduci tutto in inglese; togli tutte le maiuscole; riduci a un punto elenco."
            />
            <button
              onClick={() => handleAction('custom')}
              disabled={!customInstruction.trim()}
              className="mt-2 w-full py-2 text-sm bg-pink-600 text-white rounded-lg hover:bg-pink-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Applica istruzione
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
