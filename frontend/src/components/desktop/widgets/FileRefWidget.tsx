import { FileText, Image, FileArchive, File, Eye } from 'lucide-react'

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

interface FileRefWidgetProps {
  config: FileRefConfig
  onOpen?: (file: { url: string; filename: string; type?: string }) => void
}

export default function FileRefWidget({ config, onOpen }: FileRefWidgetProps) {
  const handleOpen = () => {
    if (!config.url) return
    if (onOpen) {
      onOpen({ url: config.url, filename: config.filename || 'File', type: config.mime_type })
    } else {
      window.open(config.url, '_blank')
    }
  }

  return (
    <div className="h-full flex flex-col items-center justify-center gap-3 p-4 cursor-pointer" onClick={handleOpen}>
      <FileIcon mime={config.mime_type} />
      <div className="text-center">
        <div className="text-sm font-medium text-white/80 break-all line-clamp-2">
          {config.filename || 'File'}
        </div>
        {config.mime_type && (
          <div className="text-[12px] text-white/30 mt-0.5">{config.mime_type}</div>
        )}
      </div>
      {config.url && (
        <button
          onClick={e => { e.stopPropagation(); handleOpen() }}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 transition-colors text-sm text-white/70"
        >
          <Eye className="h-3 w-3" />
          Apri
        </button>
      )}
    </div>
  )
}
