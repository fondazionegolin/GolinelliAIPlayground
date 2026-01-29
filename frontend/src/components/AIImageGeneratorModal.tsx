import { useState } from 'react'
import { Loader2, X, Sparkles, Image as ImageIcon } from 'lucide-react'
import { Button } from './ui/button'
import { llmApi } from '@/lib/api'

interface AIImageGeneratorModalProps {
  isOpen: boolean
  onClose: () => void
  onImageGenerated: (imageUrl: string) => void
}

export function AIImageGeneratorModal({
  isOpen,
  onClose,
  onImageGenerated
}: AIImageGeneratorModalProps) {
  const [prompt, setPrompt] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [generatedImage, setGeneratedImage] = useState<string | null>(null)

  if (!isOpen) return null

  const handleGenerate = async () => {
    if (!prompt.trim()) return

    setIsLoading(true)
    setError(null)
    setGeneratedImage(null)

    try {
      const response = await llmApi.generateImage(prompt, 'dall-e')
      const imageUrl = response.data?.image_url || response.data?.url
      if (imageUrl) {
        setGeneratedImage(imageUrl)
      } else {
        setError('Nessuna immagine generata')
      }
    } catch (err: any) {
      console.error('Image generation error:', err)
      setError(err.response?.data?.detail || 'Errore durante la generazione')
    } finally {
      setIsLoading(false)
    }
  }

  const handleApply = () => {
    if (generatedImage) {
      onImageGenerated(generatedImage)
      handleClose()
    }
  }

  const handleClose = () => {
    setPrompt('')
    setError(null)
    setGeneratedImage(null)
    setIsLoading(false)
    onClose()
  }

  const handleUrlInsert = () => {
    const url = window.prompt('Inserisci URL immagine:')
    if (url) {
      onImageGenerated(url)
      handleClose()
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg mx-4 overflow-hidden">
        {/* Header */}
        <div className="bg-gradient-to-r from-violet-500 to-indigo-500 px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3 text-white">
            <ImageIcon className="h-5 w-5" />
            <span className="font-semibold">Aggiungi Immagine</span>
          </div>
          <button
            onClick={handleClose}
            className="text-white/80 hover:text-white transition-colors"
            disabled={isLoading}
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="p-6">
          {/* URL Option */}
          <div className="mb-6">
            <Button
              variant="outline"
              className="w-full justify-start gap-2"
              onClick={handleUrlInsert}
            >
              <ImageIcon className="h-4 w-4" />
              Inserisci da URL
            </Button>
          </div>

          <div className="relative mb-6">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-slate-200"></div>
            </div>
            <div className="relative flex justify-center">
              <span className="bg-white px-3 text-sm text-slate-500">oppure genera con AI</span>
            </div>
          </div>

          {/* AI Generation */}
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-2">
                Descrivi l'immagine da generare
              </label>
              <textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder="Es: Un grafico che mostra la fotosintesi clorofilliana, stile educativo..."
                className="w-full h-24 px-3 py-2 border border-slate-200 rounded-lg text-sm resize-none focus:ring-2 focus:ring-violet-500 focus:border-transparent"
                disabled={isLoading}
              />
            </div>

            {error && (
              <div className="bg-red-50 text-red-700 px-4 py-3 rounded-lg text-sm">
                {error}
              </div>
            )}

            {generatedImage && (
              <div className="border rounded-lg overflow-hidden">
                <img
                  src={generatedImage}
                  alt="Generated"
                  className="w-full h-48 object-contain bg-slate-50"
                />
              </div>
            )}

            <div className="flex gap-3">
              {!generatedImage ? (
                <Button
                  onClick={handleGenerate}
                  disabled={!prompt.trim() || isLoading}
                  className="flex-1 bg-violet-600 hover:bg-violet-700"
                >
                  {isLoading ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Generazione...
                    </>
                  ) : (
                    <>
                      <Sparkles className="h-4 w-4 mr-2" />
                      Genera Immagine
                    </>
                  )}
                </Button>
              ) : (
                <>
                  <Button
                    variant="outline"
                    onClick={() => setGeneratedImage(null)}
                    className="flex-1"
                  >
                    Rigenera
                  </Button>
                  <Button
                    onClick={handleApply}
                    className="flex-1 bg-violet-600 hover:bg-violet-700"
                  >
                    Usa Immagine
                  </Button>
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
