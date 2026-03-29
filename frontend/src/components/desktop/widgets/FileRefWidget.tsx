import { FileText, Image, FileArchive, File, ExternalLink } from 'lucide-react'

interface FileRefConfig {
  file_id?: string
  filename?: string
  mime_type?: string
  url?: string
}

function FileIcon({ mime }: { mime?: string }) {
  if (!mime) return <File className="h-8 w-8 text-white/40" />
  if (mime.startsWith('image/')) return <Image className="h-8 w-8 text-cyan-400/70" />
  if (mime === 'application/pdf') return <FileText className="h-8 w-8 text-red-400/70" />
  if (mime.includes('word') || mime.includes('document')) return <FileText className="h-8 w-8 text-blue-400/70" />
  if (mime.includes('zip') || mime.includes('archive')) return <FileArchive className="h-8 w-8 text-amber-400/70" />
  return <FileText className="h-8 w-8 text-white/40" />
}

export default function FileRefWidget({ config }: { config: FileRefConfig }) {
  const handleOpen = () => {
    if (config.url) window.open(config.url, '_blank')
  }

  return (
    <div className="h-full flex flex-col items-center justify-center gap-3 p-4">
      <FileIcon mime={config.mime_type} />
      <div className="text-center">
        <div className="text-xs font-medium text-white/80 break-all line-clamp-2">
          {config.filename || 'File'}
        </div>
        {config.mime_type && (
          <div className="text-[10px] text-white/30 mt-0.5">{config.mime_type}</div>
        )}
      </div>
      {config.url && (
        <button
          onClick={handleOpen}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 transition-colors text-xs text-white/70"
        >
          <ExternalLink className="h-3 w-3" />
          Apri
        </button>
      )}
    </div>
  )
}
