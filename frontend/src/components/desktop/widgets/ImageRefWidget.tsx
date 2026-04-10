import { useState } from 'react'
import { X } from 'lucide-react'

interface ImageRefConfig {
  url?: string
  filename?: string
}

export default function ImageRefWidget({ config }: { config: ImageRefConfig }) {
  const [fullscreen, setFullscreen] = useState(false)

  if (!config.url) {
    return (
      <div className="h-full flex items-center justify-center">
        <span className="text-xs text-white/30">Nessuna immagine</span>
      </div>
    )
  }

  return (
    <>
      <div
        className="h-full cursor-zoom-in overflow-hidden rounded-2xl"
        onClick={() => setFullscreen(true)}
      >
        <img
          src={config.url}
          alt={config.filename ?? 'Immagine'}
          className="w-full h-full object-cover"
          draggable={false}
        />
      </div>

      {fullscreen && (
        <div
          className="fixed inset-0 z-[200] bg-black/90 backdrop-blur-sm flex items-center justify-center"
          onClick={() => setFullscreen(false)}
        >
          <button
            className="absolute top-4 right-4 w-8 h-8 rounded-full bg-white/10 flex items-center justify-center"
            onClick={() => setFullscreen(false)}
          >
            <X className="h-4 w-4 text-white" />
          </button>
          <img
            src={config.url}
            alt={config.filename ?? 'Immagine'}
            className="max-w-[90vw] max-h-[90vh] object-contain rounded-xl shadow-2xl"
            onClick={e => e.stopPropagation()}
          />
        </div>
      )}
    </>
  )
}
