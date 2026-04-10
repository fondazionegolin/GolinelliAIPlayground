import { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import {
  X, Download, ExternalLink, File, FileText, FileSpreadsheet, Image as ImageIcon
} from 'lucide-react'

export interface FileViewerFile {
  url: string
  filename: string
  type?: string
}

function getFileType(filename: string, mimeType?: string): string {
  const ext = filename.split('.').pop()?.toLowerCase() || ''
  if (mimeType?.startsWith('image/') || ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp'].includes(ext)) return 'image'
  if (ext === 'pdf' || mimeType === 'application/pdf') return 'pdf'
  if (['doc', 'docx'].includes(ext) || mimeType?.includes('word')) return 'word'
  if (['xls', 'xlsx', 'csv'].includes(ext) || mimeType?.includes('spreadsheet') || mimeType?.includes('excel') || mimeType?.includes('csv')) return 'excel'
  if (['ppt', 'pptx'].includes(ext) || mimeType?.includes('presentation')) return 'powerpoint'
  return 'other'
}

function FileViewerContent({ file, onClose }: { file: FileViewerFile; onClose: () => void }) {
  const { t } = useTranslation()
  const fileType = getFileType(file.filename, file.type)
  const [csvData, setCsvData] = useState<string[][] | null>(null)
  const [textContent, setTextContent] = useState<string | null>(null)

  useEffect(() => {
    const ext = file.filename.split('.').pop()?.toLowerCase() || ''
    if (ext === 'csv') {
      fetch(file.url)
        .then(res => res.text())
        .then(text => setCsvData(text.split('\n').map(row => row.split(',').map(cell => cell.trim()))))
        .catch(() => setCsvData(null))
    } else if (['txt', 'json', 'xml', 'md'].includes(ext)) {
      fetch(file.url)
        .then(res => res.text())
        .then(text => setTextContent(text))
        .catch(() => setTextContent(null))
    }
  }, [file])

  const getFileIcon = () => {
    switch (fileType) {
      case 'pdf': return <FileText className="h-5 w-5 text-red-500" />
      case 'word': return <FileText className="h-5 w-5 text-blue-500" />
      case 'excel': return <FileSpreadsheet className="h-5 w-5 text-green-500" />
      case 'powerpoint': return <FileText className="h-5 w-5 text-orange-500" />
      case 'image': return <ImageIcon className="h-5 w-5 text-purple-500" />
      default: return <File className="h-5 w-5 text-slate-500" />
    }
  }

  const renderContent = () => {
    switch (fileType) {
      case 'image':
        return (
          <img src={file.url} alt={file.filename} className="max-w-full max-h-[80vh] object-contain rounded-lg shadow-lg" />
        )
      case 'pdf':
        return (
          <iframe src={file.url} className="w-full h-[80vh] rounded-lg border-0" title={file.filename} />
        )
      case 'excel': {
        const ext = file.filename.split('.').pop()?.toLowerCase()
        if (ext === 'csv' && csvData) {
          return (
            <div className="w-full h-[80vh] overflow-auto bg-white rounded-lg">
              <table className="min-w-full border-collapse">
                <thead className="bg-slate-100 sticky top-0">
                  {csvData[0] && (
                    <tr>
                      {csvData[0].map((cell, i) => (
                        <th key={i} className="border border-slate-200 px-3 py-2 text-left text-xs font-semibold text-slate-700">{cell}</th>
                      ))}
                    </tr>
                  )}
                </thead>
                <tbody>
                  {csvData.slice(1).map((row, rowIdx) => (
                    <tr key={rowIdx} className={rowIdx % 2 === 0 ? 'bg-white' : 'bg-slate-50'}>
                      {row.map((cell, cellIdx) => (
                        <td key={cellIdx} className="border border-slate-200 px-3 py-2 text-xs text-slate-600">{cell}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        }
        return (
          <div className="flex flex-col items-center justify-center p-12 bg-slate-100 rounded-lg">
            <FileSpreadsheet className="h-24 w-24 text-green-500 mb-4" />
            <p className="text-lg font-medium text-slate-700 mb-2">{file.filename}</p>
            <p className="text-sm text-slate-500 mb-6">{t('chat_sidebar.preview_excel_unavailable')}</p>
            <a href={file.url} download={file.filename} className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors">
              <Download className="h-4 w-4" />{t('chat_sidebar.download_excel')}
            </a>
          </div>
        )
      }
      case 'word':
        return (
          <div className="flex flex-col items-center justify-center p-12 bg-slate-100 rounded-lg">
            <FileText className="h-24 w-24 text-blue-500 mb-4" />
            <p className="text-lg font-medium text-slate-700 mb-2">{file.filename}</p>
            <p className="text-sm text-slate-500 mb-6">{t('chat_sidebar.preview_word_unavailable')}</p>
            <a href={file.url} download={file.filename} className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors">
              <Download className="h-4 w-4" />{t('chat_sidebar.download_word')}
            </a>
          </div>
        )
      case 'powerpoint':
        return (
          <div className="flex flex-col items-center justify-center p-12 bg-slate-100 rounded-lg">
            <FileText className="h-24 w-24 text-orange-500 mb-4" />
            <p className="text-lg font-medium text-slate-700 mb-2">{file.filename}</p>
            <p className="text-sm text-slate-500 mb-6">{t('chat_sidebar.preview_ppt_unavailable')}</p>
            <a href={file.url} download={file.filename} className="flex items-center gap-2 px-4 py-2 bg-orange-600 text-white rounded-lg hover:bg-orange-700 transition-colors">
              <Download className="h-4 w-4" />{t('chat_sidebar.download_ppt')}
            </a>
          </div>
        )
      default:
        if (textContent !== null) {
          return (
            <div className="w-full h-[80vh] overflow-auto bg-slate-900 rounded-lg p-4">
              <pre className="text-sm text-slate-100 font-mono whitespace-pre-wrap">{textContent}</pre>
            </div>
          )
        }
        return (
          <div className="flex flex-col items-center justify-center p-12 bg-slate-100 rounded-lg">
            <File className="h-24 w-24 text-slate-400 mb-4" />
            <p className="text-lg font-medium text-slate-700 mb-2">{file.filename}</p>
            <p className="text-sm text-slate-500 mb-6">{t('chat_sidebar.preview_unavailable')}</p>
            <a href={file.url} download={file.filename} className="flex items-center gap-2 px-4 py-2 bg-[#181b1e] text-white rounded-lg hover:bg-[#0f1113] transition-colors">
              <Download className="h-4 w-4" />{t('chat_sidebar.download_file')}
            </a>
          </div>
        )
    }
  }

  return (
    <div
      className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-[100] p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-xl shadow-2xl max-w-5xl w-full max-h-[95vh] overflow-hidden flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b bg-slate-50">
          <div className="flex items-center gap-3">
            {getFileIcon()}
            <span className="font-medium text-slate-700 truncate max-w-md">{file.filename}</span>
          </div>
          <div className="flex items-center gap-2">
            <a href={file.url} target="_blank" rel="noopener noreferrer"
              className="p-2 text-slate-500 hover:text-[#181b1e] hover:bg-[#181b1e]/5 rounded-lg transition-colors"
              title={t('chat_sidebar.open_new_tab')}>
              <ExternalLink className="h-4 w-4" />
            </a>
            <a href={file.url} download={file.filename}
              className="p-2 text-slate-500 hover:text-[#181b1e] hover:bg-[#181b1e]/5 rounded-lg transition-colors"
              title={t('chat_sidebar.download')}>
              <Download className="h-4 w-4" />
            </a>
            <button onClick={onClose} className="p-2 text-slate-500 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors">
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
        <div className="flex-1 overflow-auto p-4 flex items-center justify-center bg-slate-100">
          {renderContent()}
        </div>
      </div>
    </div>
  )
}

export default function FileViewerModal({ file, onClose }: { file: FileViewerFile | null; onClose: () => void }) {
  if (!file) return null
  return createPortal(<FileViewerContent file={file} onClose={onClose} />, document.body)
}
