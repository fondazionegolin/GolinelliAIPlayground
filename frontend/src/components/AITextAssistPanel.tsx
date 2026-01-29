import { useState, useEffect, useRef } from 'react'
import { Sparkles, Expand, RefreshCw, Wand2, Loader2, X, Check } from 'lucide-react'
import { llmApi } from '@/lib/api'

interface AITextAssistPanelProps {
  selectedText: string
  position: { x: number; y: number }
  onClose: () => void
  onApply: (newText: string) => void
  context?: string // Optional context about the document
}

type AssistAction = 'expand' | 'reformat' | 'generate'

export function AITextAssistPanel({
  selectedText,
  position,
  onClose,
  onApply,
  context
}: AITextAssistPanelProps) {
  const [isLoading, setIsLoading] = useState(false)
  const [result, setResult] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [activeAction, setActiveAction] = useState<AssistAction | null>(null)
  const panelRef = useRef<HTMLDivElement>(null)

  // Adjust position to stay within viewport
  const [adjustedPosition, setAdjustedPosition] = useState(position)

  useEffect(() => {
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
  }, [position])

  // Close on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        if (!isLoading) {
          onClose()
        }
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [onClose, isLoading])

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

  return (
    <div
      ref={panelRef}
      className="fixed z-[9999] bg-white rounded-xl shadow-2xl border border-slate-200 overflow-hidden"
      style={{
        left: adjustedPosition.x,
        top: adjustedPosition.y,
        minWidth: 280,
        maxWidth: 400,
      }}
    >
      {/* Header */}
      <div className="bg-gradient-to-r from-violet-500 to-indigo-500 px-4 py-2 flex items-center justify-between">
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
    </div>
  )
}
