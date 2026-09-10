import { useState, useRef, useEffect } from 'react'
import { useMobile } from '@/hooks/useMobile'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Plus, Trash2, Upload, Monitor, FileText, ChevronLeft, FileSpreadsheet, PenTool, Share2, User, Clock, MonitorPlay, Calendar, BookOpen, Search, X,
  History, ArrowUp, ArrowDown, GripVertical, CheckSquare, Save, Download, Loader2, FileUp
} from 'lucide-react'
import { filesApi, teacherApi } from '@/lib/api'
import { DOCUMENT_IMPORT_ACCEPT, downloadExportedDocument, isSupportedDocumentFile } from '@/lib/documentFiles'
import { useToast } from '@/components/ui/use-toast'
import { useQuery } from '@tanstack/react-query'
import { SlideEditor, SlideBlock, SlideBlockType, SlideSnapOptions, DEFAULT_SLIDE_SNAP_OPTIONS } from '@/components/SlideEditor'
import { createShapeBlock } from '@/lib/slideBlocks'
import { RichTextEditor } from '@/components/RichTextEditor'
import { UnifiedToolbar } from '@/components/UnifiedToolbar'
import DocumentAgentChat, { type DocumentAssistContext } from '@/components/documents/DocumentAgentChat'
import DocumentThumbnail from '@/components/documents/DocumentThumbnail'
import DocumentOpenModal, { type OpenableDocument } from '@/components/documents/DocumentOpenModal'
import { SheetChartConfig, SheetCellStyles, SheetDimensions, SpreadsheetEditor } from '@/components/SpreadsheetEditor'
import { CollaborativeCanvas } from '@/components/CollaborativeCanvas'
import { Editor } from '@tiptap/react'
import { useTranslation } from 'react-i18next'
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import {
  PASTEL_ICON_BACKGROUNDS,
  PASTEL_ICON_TEXT,
  PASTEL_SURFACES,
  type PastelTone,
} from '@/design/themes/pastelSurfaces'

// Types
type Format = 'a4' | '16:9' | '4:3'
type EditorMode = 'slides' | 'document' | 'sheet' | 'canvas' | 'web'

// Reuse SlideBlock type
type Block = SlideBlock

interface Slide {
  id: string
  title: string
  blocks: Block[]
  backgroundColor?: string
}

interface DocumentHeader {
  title: string
  subtitle: string
  logoUrl: string
}

interface Document {
  id: string
  title: string
  format: Format
  slides: Slide[]
  textContent?: string
  header?: DocumentHeader
  sheetData?: string[][]
  sheetChart?: SheetChartConfig
  sheetStyles?: SheetCellStyles
  sheetDimensions?: SheetDimensions
  canvasContent?: string
  webUrl?: string
  source?: { filename?: string; extension?: string; mimeType?: string; fileId?: string; url?: string; preservedOriginal?: boolean }
}

// Stored Document Metadata for Sidebar
interface StoredDocument {
  id: string
  taskId: string
  submissionId?: string | null
  source: 'teacher' | 'student'
  title: string
  type: 'presentation' | 'document' | 'sheet' | 'canvas'
  updatedAt: string
  sessionId: string
  sessionName: string
  className: string
  contentJson: string
  authorName: string
  correction?: DocumentCorrection | null
}

interface DocumentCorrection {
  status: 'pending' | 'accepted'
  original_content_json: string
  suggested_content_json: string
  teacher_name?: string
  updated_at?: string
}

interface DraftDocument {
  id: string
  title: string
  type: 'presentation' | 'document' | 'sheet' | 'canvas'
  updatedAt: string
  contentJson: string
}

interface DocumentDraftVersion {
  id: string
  draftId: string
  title: string
  type: string
  contentJson: string
  label?: string | null
  createdAt: string
}

// Format dimensions
const FORMAT_DIMENSIONS = {
  '16:9': { width: 960, height: 540, label: '16:9 (Presentazione)' },
  '4:3': { width: 800, height: 600, label: '4:3 (Standard)' },
  'a4': { width: 794, height: 1123, label: 'A4 (Documento)' }
}

const DOC_PAGE_GAP = 28
const EMPTY_DOC_HTML = '<p></p>'
const DEFAULT_SHEET_DATA = Array.from({ length: 20 }, () => Array.from({ length: 8 }, () => ''))
const DEFAULT_SHEET_CHART: SheetChartConfig = {
  type: 'line',
  title: 'Grafico tabella',
  xCol: 0,
  yCol: 1,
  showRegression: true,
}
const DEFAULT_CANVAS_CONTENT = JSON.stringify({ type: 'canvas_v1', items: [] })
const isFullHtmlDocument = (value?: string | null) => {
  if (!value) return false
  const trimmed = value.trim().toLowerCase()
  return trimmed.startsWith('<!doctype html') || trimmed.startsWith('<html')
}
const parseCanvasContent = (raw?: string) => {
  if (!raw) return { type: 'canvas_v1', items: [] as any[] }
  try {
    const parsed = JSON.parse(raw)
    if (parsed?.type === 'canvas_v1' && Array.isArray(parsed.items)) return parsed
  } catch {
    // no-op
  }
  return { type: 'canvas_v1', items: [] as any[] }
}

const DOC_TYPE_TONES: Record<'presentation' | 'document' | 'sheet' | 'canvas', PastelTone> = {
  presentation: 'indigo',
  document: 'emerald',
  sheet: 'sky',
  canvas: 'amber',
}

const docTone = (type: 'presentation' | 'document' | 'sheet' | 'canvas') => DOC_TYPE_TONES[type]

export default function TeacherDocumentsPage() {
  const { toast } = useToast()
  const { i18n } = useTranslation()
  const [searchParams] = useSearchParams()
  const location = useLocation()
  const navigate = useNavigate()
  const isEnglish = i18n.resolvedLanguage?.startsWith('en') ?? false
  const { isMobile } = useMobile()
  const defaultDocumentTitle = isEnglish ? 'New Document' : 'Nuovo Documento'
  const defaultPresentationTitle = isEnglish ? 'New Presentation' : 'Nuova Presentazione'
  const defaultSheetTitle = isEnglish ? 'New Table' : 'Nuova Tabella'
  const defaultCanvasTitle = isEnglish ? 'New Board' : 'Nuova Lavagna'
  const dateLocale = isEnglish ? 'en-GB' : 'it-IT'
  const [draftId, setDraftId] = useState<string | null>(null)
  const draftIdRef = useRef<string | null>(null)
  const pendingDraftPayloadRef = useRef<{ title: string; doc_type: string; content_json: string } | null>(null)
  const isSavingDraftRef = useRef(false)
  const suppressNextDraftSaveRef = useRef(false)
  const lastDraftPayloadKeyRef = useRef<string | null>(null)
  const publishingDocumentRef = useRef(false)
  const activePublishedTaskIdRef = useRef<string | null>(null)
  const lastCorrectionPayloadRef = useRef<string | null>(null)
  
  // State
  const [mode, setMode] = useState<EditorMode>('document') 
  const [document, setDocument] = useState<Document>({
    id: crypto.randomUUID(),
    title: defaultDocumentTitle,
    format: 'a4',
    slides: [
      { id: crypto.randomUUID(), title: 'Slide 1', blocks: [] }
    ],
    textContent: EMPTY_DOC_HTML,
    header: { title: '', subtitle: '', logoUrl: '' },
    sheetData: DEFAULT_SHEET_DATA,
    sheetChart: DEFAULT_SHEET_CHART,
    canvasContent: DEFAULT_CANVAS_CONTENT,
    webUrl: '',
  })
  
  // Sidebar State
  const [storedDocuments, setStoredDocuments] = useState<StoredDocument[]>([])
  const [draftDocuments, setDraftDocuments] = useState<DraftDocument[]>([])
  const [docSearch, setDocSearch] = useState('')
  const [catalogRefreshKey, setCatalogRefreshKey] = useState(0)
  const [activePublishedTaskId, setActivePublishedTaskId] = useState<string | null>(null)
  const [activeStudentSubmissionId, setActiveStudentSubmissionId] = useState<string | null>(null)
  const [correctionSaveState, setCorrectionSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')

  // Editor State
  const [editor, setEditor] = useState<Editor | null>(null)
  
  // Slide Editor State
  const [currentSlideIndex, setCurrentSlideIndex] = useState(0)
  const [scale, setScale] = useState(1)
  const [docScale, setDocScale] = useState(1)
  const [docMargins, setDocMargins] = useState({ vertical: 56, horizontal: 56 })
  const [documentPageCount, setDocumentPageCount] = useState(1)
  const [showRuledLines, setShowRuledLines] = useState(false)
  const [selectedBlockId, setSelectedBlockId] = useState<string | null>(null)
  const [snapOptions, setSnapOptions] = useState<SlideSnapOptions>(DEFAULT_SLIDE_SNAP_OPTIONS)

  // Refs
  const canvasRef = useRef<HTMLDivElement>(null)
  const documentPageRef = useRef<HTMLDivElement>(null)
  const toolbarHostRef = useRef<HTMLDivElement>(null)
  
  // UI State
  const [showPublishModal, setShowPublishModal] = useState(false)
  const [selectedSessionId, setSelectedSessionId] = useState('')
  const [publishMode, setPublishMode] = useState<'published' | 'draft'>('published')
  const [showNewModal, setShowNewModal] = useState(false)
  const [documentToOpen, setDocumentToOpen] = useState<{ document: OpenableDocument; onEdit: () => void } | null>(null)
  const [draftSaveState, setDraftSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [viewMode, setViewMode] = useState<'list' | 'editor'>('list')
  const [studentDocsCollapsed, setStudentDocsCollapsed] = useState(false)
  const [aiPanelAnchor, setAiPanelAnchor] = useState<{ x: number; y: number } | null>(null)
  const [documentAgentOpen, setDocumentAgentOpen] = useState(false)
  const [documentSelection, setDocumentSelection] = useState<{ from: number; to: number; text: string } | null>(null)
  const [draggingMargin, setDraggingMargin] = useState<'left' | 'right' | null>(null)
  const [selectedSlideIds, setSelectedSlideIds] = useState<string[]>([])
  const [draggedSlideIds, setDraggedSlideIds] = useState<string[]>([])
  const [showVersionPanel, setShowVersionPanel] = useState(false)
  const [documentVersions, setDocumentVersions] = useState<DocumentDraftVersion[]>([])
  const [versionsLoading, setVersionsLoading] = useState(false)
  const [versionActionLoading, setVersionActionLoading] = useState(false)
  const [documentImporting, setDocumentImporting] = useState(false)
  const [documentDragActive, setDocumentDragActive] = useState(false)
  const [documentExporting, setDocumentExporting] = useState(false)
  const documentFileInputRef = useRef<HTMLInputElement>(null)

  const currentSlide = document.slides?.[currentSlideIndex] || { id: 'fallback', title: 'Slide', blocks: [] }
  const selectedBlock = currentSlide.blocks.find(b => b.id === selectedBlockId)
  const documentAssistContext: DocumentAssistContext | null = (() => {
    if (mode === 'document' && documentSelection) {
      return {
        id: `text-${documentSelection.from}-${documentSelection.to}-${documentSelection.text}`,
        kind: 'selected_text',
        label: isEnglish ? 'Selected text' : 'Testo selezionato',
        detail: documentSelection.text,
        target: { text: documentSelection.text, from: documentSelection.from, to: documentSelection.to },
        beforePreview: documentSelection.text,
      }
    }
    if (mode === 'slides' && selectedBlock) {
      const detail = selectedBlock.type === 'text'
        ? selectedBlock.content
        : selectedBlock.type === 'image'
          ? (isEnglish ? 'Selected image' : 'Immagine selezionata')
          : `${isEnglish ? 'Selected shape' : 'Forma selezionata'} (${selectedBlock.type})`
      return {
        id: `block-${currentSlideIndex}-${selectedBlock.id}`,
        kind: 'slide_block',
        label: isEnglish ? 'Slide object' : 'Oggetto della slide',
        detail,
        target: { block: selectedBlock, block_id: selectedBlock.id, slide_index: currentSlideIndex, slide_title: currentSlide.title },
        beforePreview: selectedBlock.content || selectedBlock.type,
      }
    }
    if (mode === 'slides') {
      return {
        id: `slide-${currentSlideIndex}-${currentSlide.id}`,
        kind: 'slide',
        label: isEnglish ? 'Current slide' : 'Slide corrente',
        detail: `${currentSlideIndex + 1}. ${currentSlide.title}`,
        target: { slide: currentSlide, slide_index: currentSlideIndex },
        beforePreview: `${currentSlide.title}\n${currentSlide.blocks.length} ${isEnglish ? 'objects' : 'oggetti'}`,
      }
    }
    return null
  })()
  const presentationAssistContext: DocumentAssistContext | null = mode === 'slides' ? {
    id: `presentation-${document.id}-${document.slides.length}`,
    kind: 'presentation',
    label: isEnglish ? 'Whole presentation' : 'Intera presentazione',
    detail: `${document.title} · ${document.slides.length} slide`,
    target: { title: document.title, format: document.format, slides: document.slides },
    beforePreview: `${document.title}\n${document.slides.length} slide`,
  } : null
  const selectedSlides = document.slides.filter((slide) => selectedSlideIds.includes(slide.id))
  const selectionAssistContext: DocumentAssistContext | null = mode === 'slides' && selectedSlides.length > 1 ? {
    id: `slide-selection-${selectedSlides.map((slide) => slide.id).join('-')}`,
    kind: 'presentation',
    label: isEnglish ? 'Selected slides' : 'Slide selezionate',
    detail: selectedSlides.map((slide, index) => `${document.slides.indexOf(slide) + 1}. ${slide.title || `Slide ${index + 1}`}`).join(' · '),
    target: {
      title: document.title,
      format: document.format,
      slides: selectedSlides,
      selected_slide_ids: selectedSlides.map((slide) => slide.id),
    },
    beforePreview: `${selectedSlides.length} ${isEnglish ? 'selected slides' : 'slide selezionate'}`,
  } : null

  useEffect(() => {
    if (!editor) return
    const trackSelection = () => {
      const { from, to } = editor.state.selection
      const text = editor.state.doc.textBetween(from, to, ' ').trim()
      if (text) setDocumentSelection({ from, to, text })
      else if (editor.isFocused) setDocumentSelection(null)
    }
    editor.on('selectionUpdate', trackSelection)
    return () => {
      editor.off('selectionUpdate', trackSelection)
    }
  }, [editor])

  const applyDocumentAgentProposal = (proposal: Record<string, unknown>) => {
    const clientContext = proposal.client_context && typeof proposal.client_context === 'object'
      ? proposal.client_context as Record<string, unknown>
      : {}
    if (proposal.kind === 'selected_text' && editor && typeof proposal.replacement_text === 'string') {
      const from = typeof clientContext.from === 'number' ? clientContext.from : documentSelection?.from
      const to = typeof clientContext.to === 'number' ? clientContext.to : documentSelection?.to
      if (from === undefined || to === undefined) return
      editor.chain().focus().deleteRange({ from, to }).insertContent(proposal.replacement_text).run()
      setDocumentSelection(null)
      return
    }
    if (proposal.kind === 'slide_block' && proposal.replacement_block && typeof proposal.replacement_block === 'object') {
      const replacement = proposal.replacement_block as Block
      const targetBlockId = typeof clientContext.block_id === 'string' ? clientContext.block_id : selectedBlockId
      const targetSlideIndex = typeof clientContext.slide_index === 'number' ? clientContext.slide_index : currentSlideIndex
      if (!targetBlockId) return
      setDocument((current) => ({
        ...current,
        slides: current.slides.map((slide, slideIndex) => slideIndex === targetSlideIndex
          ? { ...slide, blocks: slide.blocks.map((block) => block.id === targetBlockId ? { ...replacement, id: block.id, zIndex: block.zIndex } : block) }
          : slide),
      }))
      return
    }
    if (proposal.kind === 'slide' && proposal.replacement_slide && typeof proposal.replacement_slide === 'object') {
      const replacement = proposal.replacement_slide as Slide
      const targetSlideIndex = typeof clientContext.slide_index === 'number' ? clientContext.slide_index : currentSlideIndex
      setDocument((current) => ({
        ...current,
        slides: current.slides.map((slide, index) => index === targetSlideIndex ? { ...replacement, id: slide.id } : slide),
      }))
      setSelectedBlockId(null)
      return
    }
    if (proposal.kind === 'presentation' && proposal.replacement_presentation && typeof proposal.replacement_presentation === 'object') {
      const replacement = proposal.replacement_presentation as Partial<Document>
      if (!Array.isArray(replacement.slides) || replacement.slides.length === 0) return
      const selectedIds = Array.isArray(clientContext.selected_slide_ids)
        ? clientContext.selected_slide_ids.filter((id): id is string => typeof id === 'string')
        : []
      if (selectedIds.length > 1) {
        const replacements = replacement.slides as Slide[]
        const replacementById = new Map(selectedIds.map((id, index) => [id, replacements[index]]))
        setDocument((current) => ({
          ...current,
          slides: current.slides.map((slide) => {
            const next = replacementById.get(slide.id)
            return next ? { ...next, id: slide.id } : slide
          }),
        }))
        setSelectedBlockId(null)
        return
      }
      setDocument((current) => ({
        ...current,
        title: typeof replacement.title === 'string' && replacement.title.trim() ? replacement.title : current.title,
        format: replacement.format === '16:9' || replacement.format === '4:3' ? replacement.format : current.format,
        slides: replacement.slides as Slide[],
      }))
      setCurrentSlideIndex(0)
      setSelectedBlockId(null)
      setSelectedSlideIds([])
    }
  }
  const formatDocumentDateTime = (value: string) =>
    new Date(value).toLocaleString(dateLocale, {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })

  const createNewDocument = () => {
    const newDocId = crypto.randomUUID()
    setDocument({
      id: newDocId,
      title: defaultDocumentTitle,
      format: 'a4',
      slides: [],
      textContent: EMPTY_DOC_HTML,
      header: { title: '', subtitle: '', logoUrl: '' },
      sheetData: DEFAULT_SHEET_DATA,
      sheetChart: DEFAULT_SHEET_CHART,
      canvasContent: DEFAULT_CANVAS_CONTENT,
      webUrl: '',
    })
    setMode('document')
    setCurrentSlideIndex(0)
    setSelectedBlockId(null)
    setDraftId(null)
    draftIdRef.current = null
    activePublishedTaskIdRef.current = null
    setActivePublishedTaskId(null)
    setActiveStudentSubmissionId(null)
    suppressNextDraftSaveRef.current = true
    setDraftSaveState('idle')
    setViewMode('editor')
  }

  const createNewPresentation = () => {
    const newDocId = crypto.randomUUID()
    setDocument({
      id: newDocId,
      title: defaultPresentationTitle,
      format: '16:9',
      slides: [{ id: crypto.randomUUID(), title: 'Slide 1', blocks: [] }],
      textContent: '',
      sheetData: DEFAULT_SHEET_DATA,
      sheetChart: DEFAULT_SHEET_CHART,
      canvasContent: DEFAULT_CANVAS_CONTENT,
      webUrl: '',
    })
    setMode('slides')
    setCurrentSlideIndex(0)
    setSelectedBlockId(null)
    setDraftId(null)
    draftIdRef.current = null
    activePublishedTaskIdRef.current = null
    setActivePublishedTaskId(null)
    setActiveStudentSubmissionId(null)
    suppressNextDraftSaveRef.current = true
    setDraftSaveState('idle')
    setViewMode('editor')
  }

  const createNewSheet = () => {
    setDocument({
      id: crypto.randomUUID(), title: defaultSheetTitle, format: 'a4', slides: [], textContent: '',
      sheetData: DEFAULT_SHEET_DATA, sheetChart: DEFAULT_SHEET_CHART, canvasContent: DEFAULT_CANVAS_CONTENT, webUrl: '',
    })
    setMode('sheet')
    setDraftId(null)
    draftIdRef.current = null
    activePublishedTaskIdRef.current = null
    setActivePublishedTaskId(null)
    setActiveStudentSubmissionId(null)
    suppressNextDraftSaveRef.current = true
    setDraftSaveState('idle')
    setViewMode('editor')
  }

  const createNewCanvas = () => {
    const newDocId = crypto.randomUUID()
    setDocument({
      id: newDocId,
      title: defaultCanvasTitle,
      format: 'a4',
      slides: [],
      textContent: '',
      sheetData: DEFAULT_SHEET_DATA,
      sheetChart: DEFAULT_SHEET_CHART,
      canvasContent: DEFAULT_CANVAS_CONTENT,
      webUrl: '',
    })
    setMode('canvas')
    setCurrentSlideIndex(0)
    setSelectedBlockId(null)
    setDraftId(null)
    draftIdRef.current = null
    activePublishedTaskIdRef.current = null
    setActivePublishedTaskId(null)
    setActiveStudentSubmissionId(null)
    suppressNextDraftSaveRef.current = true
    setDraftSaveState('idle')
    setViewMode('editor')
  }

  const buildDraftPayload = () => {
    const type = mode === 'slides' ? 'presentation' : mode === 'sheet' ? 'sheet' : mode === 'canvas' ? 'canvas' : 'document'
    const nativeContent = mode === 'slides'
        ? { type: 'presentation_v2', format: document.format, slides: document.slides }
        : mode === 'sheet'
          ? { type: 'sheet_v1', data: document.sheetData || DEFAULT_SHEET_DATA, chart: document.sheetChart || DEFAULT_SHEET_CHART, styles: document.sheetStyles || {}, dimensions: document.sheetDimensions || {} }
          : mode === 'canvas'
            ? parseCanvasContent(document.canvasContent)
          : { type: 'document_v1', htmlContent: document.textContent || '', header: document.header, margins: docMargins }
    const contentJson = JSON.stringify({ ...nativeContent, ...(document.source ? { source: document.source, imported: true } : {}) })
    return {
      title: document.title || 'Senza titolo',
      doc_type: type,
      content_json: contentJson,
    }
  }

  const importDocumentFiles = async (files: File[]) => {
    const supported = files.filter(isSupportedDocumentFile)
    if (!supported.length) {
      toast({ title: isEnglish ? 'Unsupported format' : 'Formato non supportato', description: 'PDF, PPT/PPTX, DOC/DOCX, MD, XLS/XLSX, CSV', variant: 'destructive' })
      return
    }
    setDocumentImporting(true)
    try {
      let lastDraft: DraftDocument | null = null
      for (const file of supported) {
        const response = await filesApi.importDocument(file)
        const imported: DraftDocument = {
          id: response.data.id,
          title: response.data.title,
          type: response.data.doc_type,
          updatedAt: response.data.updated_at,
          contentJson: response.data.content_json,
        }
        setDraftDocuments(previous => [imported, ...previous.filter(item => item.id !== imported.id)])
        lastDraft = imported
      }
      if (lastDraft) loadDraft(lastDraft)
      toast({ title: isEnglish ? 'Document imported' : 'Documento importato', description: isEnglish ? 'The original file was preserved.' : 'Il file originale è stato conservato.' })
    } catch (error: any) {
      toast({ title: isEnglish ? 'Import failed' : 'Importazione non riuscita', description: error?.response?.data?.detail || error?.message, variant: 'destructive' })
    } finally {
      setDocumentImporting(false)
      if (documentFileInputRef.current) documentFileInputRef.current.value = ''
    }
  }

  const exportCurrentDocument = async (targetFormat: 'pdf' | 'ppt' | 'pptx' | 'doc' | 'docx' | 'xlsx') => {
    setDocumentExporting(true)
    try {
      const payload = buildDraftPayload()
      const response = await filesApi.exportDocument({ title: payload.title, content_json: payload.content_json, target_format: targetFormat })
      downloadExportedDocument(response.data, payload.title, targetFormat)
      toast({ title: isEnglish ? `Exported as ${targetFormat.toUpperCase()}` : `Esportato in ${targetFormat.toUpperCase()}` })
    } catch (error: any) {
      toast({ title: isEnglish ? 'Export failed' : 'Esportazione non riuscita', description: error?.response?.data?.detail || error?.message, variant: 'destructive' })
    } finally {
      setDocumentExporting(false)
    }
  }

  const flushDraftSaveQueue = async () => {
    if (isSavingDraftRef.current) return
    if (!pendingDraftPayloadRef.current) return
    if (publishingDocumentRef.current || activePublishedTaskIdRef.current) {
      pendingDraftPayloadRef.current = null
      return
    }

    const payload = pendingDraftPayloadRef.current
    pendingDraftPayloadRef.current = null
    isSavingDraftRef.current = true
    setDraftSaveState('saving')

    try {
      let savedDraftId: string
      if (draftIdRef.current) {
        const res = await teacherApi.updateDocumentDraft(draftIdRef.current, payload)
        savedDraftId = res.data.id
        if (publishingDocumentRef.current || activePublishedTaskIdRef.current) {
          await teacherApi.deleteDocumentDraft(savedDraftId).catch(() => undefined)
          return
        }
        const updated: DraftDocument = {
          id: res.data.id,
          title: res.data.title,
          type: res.data.doc_type,
          updatedAt: res.data.updated_at,
          contentJson: res.data.content_json,
        }
        setDraftDocuments(prev => [updated, ...prev.filter(d => d.id !== updated.id)])
      } else {
        const res = await teacherApi.createDocumentDraft(payload)
        savedDraftId = res.data.id
        if (publishingDocumentRef.current || activePublishedTaskIdRef.current) {
          await teacherApi.deleteDocumentDraft(savedDraftId).catch(() => undefined)
          return
        }
        draftIdRef.current = savedDraftId
        setDraftId(savedDraftId)
        const created: DraftDocument = {
          id: res.data.id,
          title: res.data.title,
          type: res.data.doc_type,
          updatedAt: res.data.updated_at,
          contentJson: res.data.content_json,
        }
        setDraftDocuments(prev => [created, ...prev.filter(d => d.id !== created.id)])
      }
      lastDraftPayloadKeyRef.current = JSON.stringify(payload)
      setDraftSaveState('saved')
    } catch (e) {
      console.error('Draft save failed', e)
      setDraftSaveState('error')
    } finally {
      isSavingDraftRef.current = false
      if (pendingDraftPayloadRef.current && !publishingDocumentRef.current && !activePublishedTaskIdRef.current) {
        void flushDraftSaveQueue()
      } else if (publishingDocumentRef.current || activePublishedTaskIdRef.current) {
        pendingDraftPayloadRef.current = null
      }
    }
  }

  const handleTitleChange = (value: string) => {
    setDocument(d => ({ ...d, title: value }))
  }

  const closeDocumentEditor = () => {
    const stateReturnTo = (location.state as { documentReturnTo?: unknown } | null)?.documentReturnTo
    const queryReturnTo = searchParams.get('returnTo')
    const returnTo = typeof stateReturnTo === 'string' ? stateReturnTo : queryReturnTo
    if (typeof returnTo === 'string' && returnTo.startsWith('/teacher/')) {
      navigate(returnTo)
      return
    }
    const nextParams = new URLSearchParams(searchParams)
    nextParams.delete('open')
    nextParams.delete('publish')
    nextParams.delete('returnTo')
    navigate({ pathname: location.pathname, search: nextParams.toString() }, { replace: true, state: null })
    setViewMode('list')
  }

  const handleDeleteDraft = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation()
    try {
      await teacherApi.deleteDocumentDraft(id)
      setDraftDocuments(prev => prev.filter(d => d.id !== id))
      if (draftId === id) {
        setDraftId(null)
        draftIdRef.current = null
        setViewMode('list')
      }
    } catch (e) {
      toast({ title: 'Errore eliminazione', variant: 'destructive' })
    }
  }

  const handleDeletePublished = async (e: React.MouseEvent, doc: StoredDocument) => {
    e.stopPropagation()
    try {
      await teacherApi.deleteTask(doc.sessionId, doc.taskId)
      setStoredDocuments(prev => prev.filter(d => d.id !== doc.id))
      if (document.id === doc.id) {
        setViewMode('list')
      }
    } catch (e) {
      toast({ title: 'Errore eliminazione', variant: 'destructive' })
    }
  }

  // Fetch classes and sessions
  const { data: classesData } = useQuery({
    queryKey: ['teacher-classes-docs'],
    queryFn: async () => {
      const classesRes = await teacherApi.getClasses()
      const classes = classesRes.data || []
      const allSessions: any[] = []
      for (const cls of classes) {
        try {
          const sessionsRes = await teacherApi.getSessions(cls.id)
          const sessions = sessionsRes.data || []
          sessions.forEach((s: any) => {
            allSessions.push({ id: s.id, name: s.title || s.name, class_name: cls.name })
          })
        } catch (e) { console.error(e) }
      }
      return allSessions
    },
  })

  // Load existing documents
  useEffect(() => {
    const refreshCatalog = () => setCatalogRefreshKey((value) => value + 1)
    window.addEventListener('golinelli:documents-refresh', refreshCatalog)
    return () => window.removeEventListener('golinelli:documents-refresh', refreshCatalog)
  }, [])

  useEffect(() => {
    const fetchDrafts = async () => {
      try {
        const res = await teacherApi.listDocumentDrafts()
        const drafts: DraftDocument[] = (res.data || []).map((d: any) => ({
          id: d.id,
          title: d.title,
          type: d.doc_type,
          updatedAt: d.updated_at,
          contentJson: d.content_json
        }))
        setDraftDocuments(drafts)
      } catch (e) {
        console.error('Failed to load drafts', e)
      }
    }
    fetchDrafts()

    const fetchDocuments = async () => {
      try {
        const res = await teacherApi.listSharedDocuments()
        const docs: StoredDocument[] = (res.data || []).map((d: any) => {
          let type: StoredDocument['type'] = d.doc_type === 'presentation' ? 'presentation' : 'document'
          try {
            const content = JSON.parse(d.content_json || '{}')
            if (content.type === 'presentation_v2') type = 'presentation'
            else if (content.type === 'sheet_v1') type = 'sheet'
            else if (content.type === 'canvas_v1') type = 'canvas'
          } catch {
            // keep backend-provided type
          }
          return {
            id: d.id,
            taskId: d.task_id,
            submissionId: d.submission_id,
            source: d.source,
            title: d.title,
            type,
            updatedAt: d.updated_at || d.created_at,
            sessionId: d.session_id,
            sessionName: d.session_name,
            className: d.class_name,
            contentJson: d.content_json,
            authorName: d.author_name || (d.source === 'student' ? 'Studente' : 'Docente'),
            correction: d.correction || null,
          }
        })
        setStoredDocuments(docs)
      } catch (e) {
        console.error('Failed to load shared documents', e)
      }
    }

    fetchDocuments()
  }, [classesData, catalogRefreshKey])

  useEffect(() => {
    draftIdRef.current = draftId
  }, [draftId])

  useEffect(() => {
    if (viewMode !== 'editor' || activePublishedTaskId) return
    const payload = buildDraftPayload()
    const payloadKey = JSON.stringify(payload)
    if (suppressNextDraftSaveRef.current) {
      suppressNextDraftSaveRef.current = false
      lastDraftPayloadKeyRef.current = payloadKey
      return
    }
    if (lastDraftPayloadKeyRef.current === payloadKey) return
    // Don't create a new draft for empty documents
    if (!draftIdRef.current) {
      const html = document.textContent || ''
      const stripped = html.replace(/<[^>]*>/g, '').trim()
      const isEmpty =
        mode === 'document' ? stripped.length === 0 :
        mode === 'slides' ? document.slides.every(s => !s.blocks || s.blocks.length === 0) :
        mode === 'canvas' ? parseCanvasContent(document.canvasContent).items.length === 0 :
        false
      if (isEmpty) return
    }
    const timer = setTimeout(() => {
      if (publishingDocumentRef.current || activePublishedTaskIdRef.current) return
      pendingDraftPayloadRef.current = payload
      void flushDraftSaveQueue()
    }, 600)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [document, mode, docMargins, viewMode, activePublishedTaskId])

  useEffect(() => {
    if (viewMode !== 'editor' || !activeStudentSubmissionId) return
    const contentJson = buildDraftPayload().content_json
    if (lastCorrectionPayloadRef.current === contentJson) return
    const timer = setTimeout(async () => {
      setCorrectionSaveState('saving')
      try {
        const response = await teacherApi.updateDocumentCorrection(activeStudentSubmissionId, contentJson)
        lastCorrectionPayloadRef.current = contentJson
        setCorrectionSaveState('saved')
        setStoredDocuments((previous) => previous.map((item) => (
          item.submissionId === activeStudentSubmissionId
            ? { ...item, correction: response.data }
            : item
        )))
      } catch (error) {
        console.error('Correction save failed', error)
        setCorrectionSaveState('error')
      }
    }, 700)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [document, mode, docMargins, viewMode, activeStudentSubmissionId])

  // Load document
  const loadDocument = (doc: StoredDocument) => {
    try {
      const correctionContent = doc.source === 'student' && doc.correction?.status === 'pending'
        ? doc.correction.suggested_content_json
        : doc.contentJson
      const content = JSON.parse(correctionContent)
      activePublishedTaskIdRef.current = doc.taskId
      setActivePublishedTaskId(doc.taskId)
      setActiveStudentSubmissionId(doc.source === 'student' ? doc.submissionId || null : null)
      lastCorrectionPayloadRef.current = doc.source === 'student' ? correctionContent : null
      setCorrectionSaveState(doc.correction?.status === 'pending' ? 'saved' : 'idle')
      suppressNextDraftSaveRef.current = true
      setDraftSaveState('idle')
      
      if (isFullHtmlDocument(content.htmlContent) || isFullHtmlDocument(content.content)) {
        setMode('web')
        setDraftId(null)
        draftIdRef.current = null
        setDocument({
          id: doc.id,
          title: doc.title,
          format: 'a4',
          slides: [],
          textContent: content.htmlContent || content.content || '',
          header: { title: '', subtitle: '', logoUrl: '' },
          sheetData: DEFAULT_SHEET_DATA,
          sheetChart: DEFAULT_SHEET_CHART,
          canvasContent: DEFAULT_CANVAS_CONTENT,
          webUrl: content.url || '',
          source: content.source,
        })
      } else if (doc.type === 'presentation' || content.type === 'presentation_v2' || content.slides) {
        setMode('slides')
        setDraftId(null)
        draftIdRef.current = null
        const safeSlides = (content.slides && Array.isArray(content.slides) && content.slides.length > 0) 
          ? content.slides.map((s: any) => ({
              id: s.id || crypto.randomUUID(),
              title: s.title || 'Slide',
              blocks: s.blocks || []
            }))
          : [{ id: crypto.randomUUID(), title: 'Slide 1', blocks: [] }]

        setDocument({
          id: doc.id,
          title: doc.title,
          format: content.format || '16:9',
          slides: safeSlides,
          textContent: '',
          webUrl: '',
          source: content.source,
        })
        setCurrentSlideIndex(0)
        setSelectedBlockId(null)
      } else if (doc.type === 'sheet' || content.type === 'sheet_v1' || content.data) {
        setMode('sheet')
        setDraftId(null)
        draftIdRef.current = null
        setDocument({
          id: doc.id,
          title: doc.title,
          format: 'a4',
          slides: [],
          textContent: '',
          sheetData: Array.isArray(content.data) ? content.data : DEFAULT_SHEET_DATA,
          sheetChart: content.chart || DEFAULT_SHEET_CHART,
          sheetStyles: content.styles || {},
          sheetDimensions: content.dimensions || {},
          canvasContent: DEFAULT_CANVAS_CONTENT,
          webUrl: '',
          source: content.source,
        })
      } else if (doc.type === 'canvas' || content.type === 'canvas_v1' || content.items) {
        setMode('canvas')
        setDraftId(null)
        draftIdRef.current = null
        setDocument({
          id: doc.id,
          title: doc.title,
          format: 'a4',
          slides: [],
          textContent: '',
          sheetData: DEFAULT_SHEET_DATA,
          sheetChart: DEFAULT_SHEET_CHART,
          canvasContent: JSON.stringify({ type: 'canvas_v1', items: Array.isArray(content.items) ? content.items : [] }),
          webUrl: '',
          source: content.source,
        })
      } else {
        setMode('document')
        setDraftId(null)
        draftIdRef.current = null
        if (content.margins) {
          setDocMargins({
            vertical: content.margins.vertical ?? content.margins.top ?? 56,
            horizontal: content.margins.horizontal ?? content.margins.left ?? 56,
          })
        }
        setDocument({
          id: doc.id,
          title: doc.title,
          format: 'a4',
          slides: [],
          textContent: content.htmlContent || content.content || EMPTY_DOC_HTML,
          header: content.header || { title: '', subtitle: '', logoUrl: '' },
          sheetData: DEFAULT_SHEET_DATA,
          sheetChart: DEFAULT_SHEET_CHART,
          canvasContent: DEFAULT_CANVAS_CONTENT,
          webUrl: '',
          source: content.source,
        })
      }
      
      setViewMode('editor')
    } catch (e) {
      console.error(e)
      toast({ title: "Errore caricamento", description: "Impossibile aprire questo documento.", variant: "destructive" })
    }
  }

  useEffect(() => {
    const openDocumentId = searchParams.get('open')
    if (!openDocumentId) return
    if (viewMode === 'editor' && document.id === openDocumentId) return
    const draft = draftDocuments.find((item) => item.id === openDocumentId)
    if (draft) {
      loadDraft(draft)
      if (searchParams.get('publish') === '1') {
        window.setTimeout(() => setShowPublishModal(true), 0)
      }
      return
    }
    const doc = storedDocuments.find((item) => item.id === openDocumentId || item.taskId === openDocumentId)
    if (doc) {
      loadDocument(doc)
      if (searchParams.get('publish') === '1') {
        window.setTimeout(() => setShowPublishModal(true), 0)
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, storedDocuments, draftDocuments])

  const loadDraft = (doc: DraftDocument) => {
    try {
      const content = JSON.parse(doc.contentJson)
      activePublishedTaskIdRef.current = null
      setActivePublishedTaskId(null)
      setActiveStudentSubmissionId(null)
      suppressNextDraftSaveRef.current = true
      setDraftSaveState('saved')
      if (isFullHtmlDocument(content.htmlContent) || isFullHtmlDocument(content.content)) {
        setMode('web')
        setDraftId(doc.id)
        draftIdRef.current = doc.id
        setDocument({
          id: doc.id,
          title: doc.title,
          format: 'a4',
          slides: [],
          textContent: content.htmlContent || content.content || '',
          header: { title: '', subtitle: '', logoUrl: '' },
          sheetData: DEFAULT_SHEET_DATA,
          sheetChart: DEFAULT_SHEET_CHART,
          canvasContent: DEFAULT_CANVAS_CONTENT,
          webUrl: content.url || '',
          source: content.source,
        })
      } else if (doc.type === 'presentation' || content.type === 'presentation_v2' || content.slides) {
        setMode('slides')
        setDraftId(doc.id)
        draftIdRef.current = doc.id
        const safeSlides = (content.slides && Array.isArray(content.slides) && content.slides.length > 0)
          ? content.slides.map((s: any) => ({
              id: s.id || crypto.randomUUID(),
              title: s.title || 'Slide',
              blocks: s.blocks || []
            }))
          : [{ id: crypto.randomUUID(), title: 'Slide 1', blocks: [] }]

        setDocument({
          id: doc.id,
          title: doc.title,
          format: content.format || '16:9',
          slides: safeSlides,
          textContent: '',
          webUrl: '',
          source: content.source,
        })
        setCurrentSlideIndex(0)
        setSelectedBlockId(null)
      } else if (doc.type === 'sheet' || content.type === 'sheet_v1' || content.data) {
        setMode('sheet')
        setDraftId(doc.id)
        draftIdRef.current = doc.id
        setDocument({
          id: doc.id,
          title: doc.title,
          format: 'a4',
          slides: [],
          textContent: '',
          sheetData: Array.isArray(content.data) ? content.data : DEFAULT_SHEET_DATA,
          sheetChart: content.chart || DEFAULT_SHEET_CHART,
          sheetStyles: content.styles || {},
          sheetDimensions: content.dimensions || {},
          canvasContent: DEFAULT_CANVAS_CONTENT,
          webUrl: '',
          source: content.source,
        })
      } else if (doc.type === 'canvas' || content.type === 'canvas_v1' || content.items) {
        setMode('canvas')
        setDraftId(doc.id)
        draftIdRef.current = doc.id
        setDocument({
          id: doc.id,
          title: doc.title,
          format: 'a4',
          slides: [],
          textContent: '',
          sheetData: DEFAULT_SHEET_DATA,
          sheetChart: DEFAULT_SHEET_CHART,
          canvasContent: JSON.stringify({ type: 'canvas_v1', items: Array.isArray(content.items) ? content.items : [] }),
          webUrl: '',
          source: content.source,
        })
      } else {
        setMode('document')
        setDraftId(doc.id)
        draftIdRef.current = doc.id
        if (content.margins) {
          setDocMargins({
            vertical: content.margins.vertical ?? content.margins.top ?? 56,
            horizontal: content.margins.horizontal ?? content.margins.left ?? 56,
          })
        }
        setDocument({
          id: doc.id,
          title: doc.title,
          format: 'a4',
          slides: [],
          textContent: content.htmlContent || content.content || '',
          header: content.header || { title: '', subtitle: '', logoUrl: '' },
          sheetData: DEFAULT_SHEET_DATA,
          sheetChart: DEFAULT_SHEET_CHART,
          canvasContent: DEFAULT_CANVAS_CONTENT,
          webUrl: '',
          source: content.source,
        })
      }
      setViewMode('editor')
    } catch (e) {
      console.error(e)
    }
  }

  const loadDocumentVersions = async () => {
    if (!draftIdRef.current) {
      setDocumentVersions([])
      return
    }
    setVersionsLoading(true)
    try {
      const response = await teacherApi.listDocumentDraftVersions(draftIdRef.current)
      setDocumentVersions((response.data || []).map((version: any) => ({
        id: version.id,
        draftId: version.draft_id,
        title: version.title,
        type: version.doc_type,
        contentJson: version.content_json,
        label: version.label,
        createdAt: version.created_at,
      })))
    } catch (error) {
      console.error('Version history load failed', error)
      toast({ title: isEnglish ? 'Unable to load version history' : 'Impossibile caricare la cronologia', variant: 'destructive' })
    } finally {
      setVersionsLoading(false)
    }
  }

  const createVersionCheckpoint = async () => {
    if (!draftIdRef.current) return
    setVersionActionLoading(true)
    try {
      const currentPayload = buildDraftPayload()
      pendingDraftPayloadRef.current = currentPayload
      await flushDraftSaveQueue()
      while (isSavingDraftRef.current) {
        await new Promise(resolve => window.setTimeout(resolve, 25))
      }
      if (pendingDraftPayloadRef.current) {
        await flushDraftSaveQueue()
      }
      if (lastDraftPayloadKeyRef.current !== JSON.stringify(currentPayload)) {
        throw new Error('Current document could not be saved before creating a version')
      }
      await teacherApi.createDocumentDraftVersion(draftIdRef.current, isEnglish ? 'Manual checkpoint' : 'Versione manuale')
      await loadDocumentVersions()
      toast({ title: isEnglish ? 'Version saved' : 'Versione salvata' })
    } catch (error) {
      console.error('Version checkpoint failed', error)
      toast({ title: isEnglish ? 'Unable to save version' : 'Impossibile salvare la versione', variant: 'destructive' })
    } finally {
      setVersionActionLoading(false)
    }
  }

  const restoreVersion = async (version: DocumentDraftVersion) => {
    if (!draftIdRef.current) return
    if (!window.confirm(isEnglish ? 'Restore this version? The current state will remain in history.' : 'Ripristinare questa versione? Lo stato corrente resterà nella cronologia.')) return
    setVersionActionLoading(true)
    try {
      const response = await teacherApi.restoreDocumentDraftVersion(draftIdRef.current, version.id)
      const restored: DraftDocument = {
        id: response.data.id,
        title: response.data.title,
        type: response.data.doc_type,
        updatedAt: response.data.updated_at,
        contentJson: response.data.content_json,
      }
      lastDraftPayloadKeyRef.current = null
      loadDraft(restored)
      setDraftDocuments(previous => [restored, ...previous.filter(item => item.id !== restored.id)])
      await loadDocumentVersions()
      toast({ title: isEnglish ? 'Version restored' : 'Versione ripristinata' })
    } catch (error) {
      console.error('Version restore failed', error)
      toast({ title: isEnglish ? 'Unable to restore version' : 'Impossibile ripristinare la versione', variant: 'destructive' })
    } finally {
      setVersionActionLoading(false)
    }
  }

  useEffect(() => {
    if (!showVersionPanel) return
    void loadDocumentVersions()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showVersionPanel, draftId])

  useEffect(() => {
    if (mode !== 'slides' || !currentSlide.id || selectedSlideIds.length > 0) return
    setSelectedSlideIds([currentSlide.id])
  }, [mode, currentSlide.id, selectedSlideIds.length])

  // Fit canvas
  useEffect(() => {
    const handleResize = () => {
      if (mode === 'slides' && canvasRef.current) {
        const parent = canvasRef.current.parentElement
        if (parent) {
          const dims = FORMAT_DIMENSIONS[document.format]
          const scaleX = (parent.clientWidth - 64) / dims.width
          const scaleY = (parent.clientHeight - 64) / dims.height
          setScale(Math.min(scaleX, scaleY, 1))
        }
      }
    }
    window.addEventListener('resize', handleResize)
    handleResize()
    return () => window.removeEventListener('resize', handleResize)
  }, [document.format, mode])

  // Actions
  const addSlide = () => {
    const newSlide: Slide = {
      id: crypto.randomUUID(),
      title: `Slide ${document.slides.length + 1}`,
      blocks: []
    }
    setDocument(prev => ({ ...prev, slides: [...prev.slides, newSlide] }))
    setCurrentSlideIndex(document.slides.length)
    setSelectedSlideIds([newSlide.id])
  }

  const selectSlide = (index: number, event: React.MouseEvent) => {
    const slide = document.slides[index]
    if (!slide) return
    if (event.shiftKey && document.slides[currentSlideIndex]) {
      const start = Math.min(currentSlideIndex, index)
      const end = Math.max(currentSlideIndex, index)
      setSelectedSlideIds(document.slides.slice(start, end + 1).map(item => item.id))
    } else if (event.metaKey || event.ctrlKey) {
      setSelectedSlideIds(previous => (
        previous.includes(slide.id)
          ? previous.filter(id => id !== slide.id)
          : [...previous, slide.id]
      ))
    } else {
      setSelectedSlideIds([slide.id])
    }
    setCurrentSlideIndex(index)
    setSelectedBlockId(null)
  }

  const deleteSelectedSlides = () => {
    if (selectedSlideIds.length === 0) return
    if (document.slides.length - selectedSlideIds.length < 1) {
      toast({ title: isEnglish ? 'Keep at least one slide' : 'Mantieni almeno una slide', variant: 'destructive' })
      return
    }
    if (!window.confirm(isEnglish ? `Delete ${selectedSlideIds.length} selected slides?` : `Eliminare ${selectedSlideIds.length} slide selezionate?`)) return
    const currentId = currentSlide.id
    const remaining = document.slides.filter(slide => !selectedSlideIds.includes(slide.id))
    const nextIndex = Math.max(0, remaining.findIndex(slide => slide.id === currentId))
    setDocument(previous => ({ ...previous, slides: remaining }))
    setCurrentSlideIndex(nextIndex)
    setSelectedSlideIds([remaining[nextIndex].id])
    setSelectedBlockId(null)
  }

  const moveSelectedSlides = (direction: -1 | 1) => {
    if (selectedSlideIds.length === 0) return
    const selectedSet = new Set(selectedSlideIds)
    const slides = [...document.slides]
    if (direction < 0) {
      for (let index = 1; index < slides.length; index += 1) {
        if (selectedSet.has(slides[index].id) && !selectedSet.has(slides[index - 1].id)) {
          ;[slides[index - 1], slides[index]] = [slides[index], slides[index - 1]]
        }
      }
    } else {
      for (let index = slides.length - 2; index >= 0; index -= 1) {
        if (selectedSet.has(slides[index].id) && !selectedSet.has(slides[index + 1].id)) {
          ;[slides[index], slides[index + 1]] = [slides[index + 1], slides[index]]
        }
      }
    }
    const currentId = currentSlide.id
    setDocument(previous => ({ ...previous, slides }))
    setCurrentSlideIndex(Math.max(0, slides.findIndex(slide => slide.id === currentId)))
  }

  const dropSelectedSlidesAt = (targetIndex: number) => {
    if (draggedSlideIds.length === 0) return
    const draggedSet = new Set(draggedSlideIds)
    const moving = document.slides.filter(slide => draggedSet.has(slide.id))
    const remaining = document.slides.filter(slide => !draggedSet.has(slide.id))
    const targetId = document.slides[targetIndex]?.id
    const insertionIndex = targetId ? Math.max(0, remaining.findIndex(slide => slide.id === targetId)) : remaining.length
    const slides = [...remaining.slice(0, insertionIndex), ...moving, ...remaining.slice(insertionIndex)]
    const currentId = currentSlide.id
    setDocument(previous => ({ ...previous, slides }))
    setCurrentSlideIndex(Math.max(0, slides.findIndex(slide => slide.id === currentId)))
    setDraggedSlideIds([])
  }

  const updateSlideBlocks = (blocks: Block[]) => {
    const newSlides = [...document.slides]
    newSlides[currentSlideIndex] = { ...newSlides[currentSlideIndex], blocks }
    setDocument(prev => ({ ...prev, slides: newSlides }))
  }

  const addSlideBlock = (type: SlideBlockType) => {
    const dims = FORMAT_DIMENSIONS[document.format]
    let newBlock: Block
    if (type === 'text') {
      newBlock = {
        id: crypto.randomUUID(),
        type: 'text',
        content: isEnglish ? 'New Text' : 'Nuovo Testo',
        x: dims.width / 2 - 100,
        y: dims.height / 2 - 50,
        width: 200,
        height: 100,
        style: {
          fontSize: 24,
          color: '#000000',
          backgroundColor: 'transparent',
          textAlign: 'center',
          padding: 10
        }
      }
    } else if (type === 'image') {
      newBlock = {
        id: crypto.randomUUID(),
        type: 'image',
        content: `https://placehold.co/400x300?text=${encodeURIComponent(isEnglish ? 'Image' : 'Immagine')}`,
        x: dims.width / 2 - 100,
        y: dims.height / 2 - 150,
        width: 200,
        height: 300,
        style: {}
      }
    } else {
      newBlock = createShapeBlock(type, dims)
    }
    updateSlideBlocks([...currentSlide.blocks, newBlock])
    setSelectedBlockId(newBlock.id)
  }

  const addSlideImage = (imageUrl: string) => {
    const dims = FORMAT_DIMENSIONS[document.format]
    const newBlock: Block = {
      id: crypto.randomUUID(),
      type: 'image',
      content: imageUrl,
      x: dims.width / 2 - 150,
      y: dims.height / 2 - 100,
      width: 300,
      height: 200,
      style: {}
    }
    updateSlideBlocks([...currentSlide.blocks, newBlock])
    setSelectedBlockId(newBlock.id)
  }

  const updateBlockStyle = (key: string, value: any) => {
    if (!selectedBlockId) return
    const newBlocks = currentSlide.blocks.map(b => {
      if (b.id !== selectedBlockId) return b
      if (key === 'rotation') return { ...b, rotation: value }
      // `key` is a dynamic string (toolbar only ever passes a key valid for the selected block's
      // own type), so TS can't narrow the resulting style shape back to the union member — safe cast.
      return { ...b, style: { ...b.style, [key]: value } } as Block
    })
    updateSlideBlocks(newBlocks)
  }

  const handlePublish = async () => {
    if (!selectedSessionId) return
    const isPublishingNow = publishMode === 'published'
    if (isPublishingNow) {
      publishingDocumentRef.current = true
      pendingDraftPayloadRef.current = null
    }
    try {
      let contentJson = ""
      let taskType = ""

      if (mode === 'slides') {
        contentJson = JSON.stringify({
          type: 'presentation_v2',
          format: document.format,
          title: document.title,
          slides: document.slides.map(s => ({
            id: s.id,
            title: s.title,
            blocks: s.blocks
          }))
        })
        taskType = 'presentation'
      } else if (mode === 'sheet') {
        contentJson = JSON.stringify({
          type: 'sheet_v1',
          title: document.title,
          data: document.sheetData || DEFAULT_SHEET_DATA,
          chart: document.sheetChart || DEFAULT_SHEET_CHART,
          styles: document.sheetStyles || {},
          dimensions: document.sheetDimensions || {},
        })
        taskType = 'lesson'
      } else if (mode === 'canvas') {
        contentJson = JSON.stringify(parseCanvasContent(document.canvasContent))
        taskType = 'lesson'
      } else {
        contentJson = JSON.stringify({
          type: 'document_v1',
          title: document.title,
          htmlContent: document.textContent,
          header: document.header,
          margins: docMargins
        })
        taskType = 'lesson'
      }

      if (document.source) {
        contentJson = JSON.stringify({ ...JSON.parse(contentJson), source: document.source, imported: true })
      }

      const response = await teacherApi.createTask(selectedSessionId, {
        title: document.title,
        description: `Documento creato con Golinelli AI Editor (${mode === 'slides' ? 'Presentazione' : mode === 'sheet' ? 'Tabelle' : mode === 'canvas' ? 'Lavagna' : 'Testo'})`,
        task_type: taskType,
        content_json: contentJson
      })

      const taskId = response.data?.id
      if (publishMode === 'published' && taskId) {
        await teacherApi.updateTask(selectedSessionId, taskId, { new_status: 'published' })
      }

      // Emit socket event only for published content
      if (publishMode === 'published' && taskId && window.socket) {
        window.socket.emit('teacher_publish_task', {
          session_id: selectedSessionId,
          task_id: taskId,
          title: document.title,
          task_type: taskType
        })
      }

      if (publishMode === 'published' && taskId) {
        activePublishedTaskIdRef.current = taskId
        setActivePublishedTaskId(taskId)
        const publishedAt = response.data?.created_at || new Date().toISOString()
        const selectedSession = (classesData || []).find((session: any) => session.id === selectedSessionId)
        const publishedDocument: StoredDocument = {
          id: taskId,
          taskId,
          submissionId: null,
          source: 'teacher',
          title: document.title,
          type: mode === 'slides' ? 'presentation' : mode === 'sheet' ? 'sheet' : mode === 'canvas' ? 'canvas' : 'document',
          updatedAt: publishedAt,
          sessionId: selectedSessionId,
          sessionName: selectedSession?.name || selectedSessionId,
          className: selectedSession?.class_name || '',
          contentJson,
          authorName: isEnglish ? 'Teacher' : 'Docente',
        }
        setStoredDocuments(prev => [publishedDocument, ...prev.filter(doc => doc.taskId !== taskId)])

        const publishedDraftId = draftIdRef.current
        if (publishedDraftId) {
          try {
            await teacherApi.deleteDocumentDraft(publishedDraftId)
          } catch (deleteError) {
            console.error('Failed to delete published draft', deleteError)
          }
          setDraftDocuments(prev => prev.filter(doc => doc.id !== publishedDraftId))
          setDraftId(null)
          draftIdRef.current = null
        }
        setDraftSaveState('idle')
      }

      publishingDocumentRef.current = false
      setShowPublishModal(false)
      toast({
        title: publishMode === 'published' ? "Documento pubblicato!" : "Documento salvato in bozza",
        className: publishMode === 'published' ? "bg-green-500 text-white" : undefined,
      })
    } catch (e) {
      publishingDocumentRef.current = false
      console.error('Publish error:', e)
      toast({ title: "Errore pubblicazione", variant: "destructive" })
    }
  }

  useEffect(() => {
    if (!draggingMargin || mode !== 'document') return

    const onMouseMove = (event: MouseEvent) => {
      const page = documentPageRef.current
      if (!page) return
      const rect = page.getBoundingClientRect()
      const pageWidth = FORMAT_DIMENSIONS.a4.width
      const scaleFactor = rect.width / pageWidth
      if (scaleFactor <= 0) return

      const rawMargin = draggingMargin === 'left'
        ? (event.clientX - rect.left) / scaleFactor
        : (rect.right - event.clientX) / scaleFactor

      const nextMargin = Math.max(16, Math.min(220, Math.round(rawMargin)))
      setDocMargins(prev => ({ ...prev, horizontal: nextMargin }))
    }

    const onMouseUp = () => setDraggingMargin(null)

    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onMouseUp)
    return () => {
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', onMouseUp)
    }
  }, [draggingMargin, mode])

  useEffect(() => {
    const updateAnchor = () => {
      if (!toolbarHostRef.current) return
      const rect = toolbarHostRef.current.getBoundingClientRect()
      setAiPanelAnchor({
        x: Math.max(20, rect.right - 360),
        y: rect.bottom + 8
      })
    }

    updateAnchor()
    window.addEventListener('resize', updateAnchor)
    return () => window.removeEventListener('resize', updateAnchor)
  }, [mode])

  // ── Fuzzy search helper ───────────────────────────────────────────────────
  const fuzzyMatch = (query: string, ...fields: string[]) => {
    if (!query.trim()) return true
    const terms = query.toLowerCase().split(/\s+/).filter(Boolean)
    const target = fields.join(' ').toLowerCase()
    return terms.every(term => target.includes(term))
  }

  // ── Document list view (default) ─────────────────────────────────────────
  if (!isMobile && viewMode === 'list') {
    const filteredDrafts = draftDocuments.filter(d => fuzzyMatch(docSearch, d.title, d.type))
    const filteredStored = storedDocuments.filter(d => fuzzyMatch(docSearch, d.title, d.sessionName, d.className, d.authorName))
    const filteredTeacherDocuments = filteredStored.filter(doc => doc.source === 'teacher')
    const filteredStudentDocuments = filteredStored.filter(doc => doc.source === 'student')
    const docIcon = (type: string) => {
      if (type === 'presentation') return <Monitor className="h-5 w-5" />
      if (type === 'sheet') return <FileSpreadsheet className="h-5 w-5" />
      if (type === 'canvas') return <PenTool className="h-5 w-5" />
      return <FileText className="h-5 w-5" />
    }
    const docColor = (type: 'presentation' | 'document' | 'sheet' | 'canvas') =>
      `${PASTEL_ICON_BACKGROUNDS[docTone(type)]} ${PASTEL_ICON_TEXT[docTone(type)]}`
    return (
      <>
        <div
          className="relative h-full flex flex-col bg-slate-100 overflow-hidden"
          onDragEnter={(event) => { event.preventDefault(); setDocumentDragActive(true) }}
          onDragOver={(event) => { event.preventDefault(); setDocumentDragActive(true) }}
          onDragLeave={(event) => { if (event.currentTarget === event.target) setDocumentDragActive(false) }}
          onDrop={(event) => {
            event.preventDefault()
            setDocumentDragActive(false)
            void importDocumentFiles(Array.from(event.dataTransfer.files))
          }}
        >
          <input ref={documentFileInputRef} type="file" multiple accept={DOCUMENT_IMPORT_ACCEPT} className="hidden" onChange={(event) => void importDocumentFiles(Array.from(event.target.files || []))} />
          <div className="h-14 bg-white/90 border-b border-slate-200/80 flex items-center px-6 z-20 shadow-sm shrink-0 backdrop-blur-sm">
            <div className="flex items-center gap-2">
              <FileText className="h-4 w-4 text-slate-500" />
              <h1 className="text-base font-bold text-slate-800">{isEnglish ? 'Documents' : 'Documenti'}</h1>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-6">
            <div className="max-w-6xl mx-auto space-y-7">

              <section className="mx-auto grid w-full max-w-6xl gap-2.5 sm:grid-cols-2 lg:grid-cols-5">
                <button type="button" onClick={createNewDocument} className="flex min-h-[76px] items-start gap-3 rounded-xl border border-emerald-200/80 bg-emerald-50/70 p-3 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-emerald-300 hover:bg-emerald-100/70 hover:shadow-md">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white text-emerald-700 shadow-sm"><FileText className="h-5 w-5" /></span>
                  <span className="min-w-0 pt-0.5"><span className="block text-[13px] font-black leading-5 text-slate-950">{isEnglish ? 'New document' : 'Nuovo documento'}</span><span className="mt-0.5 block text-[11px] leading-4 text-slate-500">{isEnglish ? 'Write and format.' : 'Scrivi e impagina.'}</span></span>
                </button>
                <button type="button" onClick={createNewPresentation} className="flex min-h-[76px] items-start gap-3 rounded-xl border border-indigo-200/80 bg-indigo-50/70 p-3 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-indigo-300 hover:bg-indigo-100/70 hover:shadow-md">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white text-indigo-700 shadow-sm"><MonitorPlay className="h-5 w-5" /></span>
                  <span className="min-w-0 pt-0.5"><span className="block text-[13px] font-black leading-5 text-slate-950">{isEnglish ? 'New presentation' : 'Nuova presentazione'}</span><span className="mt-0.5 block text-[11px] leading-4 text-slate-500">{isEnglish ? 'Create slides.' : 'Crea slide.'}</span></span>
                </button>
                <button type="button" onClick={createNewSheet} className="flex min-h-[76px] items-start gap-3 rounded-xl border border-cyan-200/80 bg-cyan-50/70 p-3 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-cyan-300 hover:bg-cyan-100/70 hover:shadow-md">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white text-cyan-700 shadow-sm"><FileSpreadsheet className="h-5 w-5" /></span>
                  <span className="min-w-0 pt-0.5"><span className="block text-[13px] font-black leading-5 text-slate-950">{isEnglish ? 'New table' : 'Nuova tabella'}</span><span className="mt-0.5 block text-[11px] leading-4 text-slate-500">{isEnglish ? 'Data and formulas.' : 'Dati e formule.'}</span></span>
                </button>
                <button type="button" onClick={createNewCanvas} className="flex min-h-[76px] items-start gap-3 rounded-xl border border-amber-200/80 bg-amber-50/70 p-3 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-amber-300 hover:bg-amber-100/70 hover:shadow-md">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white text-amber-700 shadow-sm"><PenTool className="h-5 w-5" /></span>
                  <span className="min-w-0 pt-0.5"><span className="block text-[13px] font-black leading-5 text-slate-950">{isEnglish ? 'New board' : 'Nuova lavagna'}</span><span className="mt-0.5 block text-[11px] leading-4 text-slate-500">{isEnglish ? 'Draw and collaborate.' : 'Disegna e collabora.'}</span></span>
                </button>
                <button type="button" disabled={documentImporting} onClick={() => documentFileInputRef.current?.click()} className="flex min-h-[76px] items-start gap-3 rounded-xl border border-sky-200/80 bg-sky-50/70 p-3 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-sky-300 hover:bg-sky-100/70 hover:shadow-md disabled:cursor-wait disabled:opacity-60">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white text-sky-700 shadow-sm">{documentImporting ? <Loader2 className="h-5 w-5 animate-spin" /> : <FileUp className="h-5 w-5" />}</span>
                  <span className="min-w-0 pt-0.5"><span className="block text-[13px] font-black leading-5 text-slate-950">{isEnglish ? 'Import file' : 'Importa file'}</span><span className="mt-0.5 block text-[11px] leading-4 text-slate-500">PDF · PPT · DOC · XLS · CSV</span></span>
                </button>
              </section>

              {/* Search */}
              {(draftDocuments.length > 0 || storedDocuments.length > 0) && (
                <div className={`relative max-w-sm rounded-2xl px-3 py-2 shadow-sm ${PASTEL_SURFACES.slate}`}>
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400 pointer-events-none" />
                  <input
                    type="text"
                    placeholder={isEnglish ? 'Search documents...' : 'Cerca documenti...'}
                    value={docSearch}
                    onChange={e => setDocSearch(e.target.value)}
                    className="w-full pl-9 pr-8 py-2 text-sm bg-transparent border-0 rounded-lg focus:outline-none focus:ring-0 text-slate-700"
                  />
                  {docSearch && (
                    <button onClick={() => setDocSearch('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
                      <X className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              )}

              {draftDocuments.length === 0 && storedDocuments.length === 0 && (
                <div className={`flex flex-col items-center justify-center py-24 text-center rounded-[28px] shadow-sm ${PASTEL_SURFACES.slate}`}>
                  <div className="w-20 h-20 rounded-[24px] bg-slate-100 flex items-center justify-center mb-5">
                    <FileText className="h-10 w-10 text-slate-500" />
                  </div>
                  <h3 className="text-lg font-bold text-slate-700 mb-1">{isEnglish ? 'No documents yet' : 'Nessun documento'}</h3>
                  <p className="text-sm text-slate-400 mb-6">{isEnglish ? 'Create a document or a presentation to get started' : 'Crea un documento oppure una presentazione per iniziare'}</p>
                  <Button onClick={createNewPresentation}>
                    <Plus className="h-4 w-4 mr-2" />
                    {isEnglish ? 'Create presentation' : 'Crea presentazione'}
                  </Button>
                </div>
              )}

              {filteredDrafts.length > 0 && (
                <section>
                  <h2 className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-3">{isEnglish ? 'My Drafts' : 'Le mie Bozze'} {docSearch && <span className="normal-case font-normal">({filteredDrafts.length})</span>}</h2>
                  <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-5">
                    {filteredDrafts.map(doc => (
                      <div
                        key={doc.id}
                        onClick={() => setDocumentToOpen({ document: doc, onEdit: () => loadDraft(doc) })}
                        className="group relative cursor-pointer overflow-hidden rounded-2xl border border-slate-200/80 bg-white/95 p-1.5 shadow-[0_6px_20px_-14px_rgba(15,23,42,0.55)] transition-all hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-md"
                      >
                        <DocumentThumbnail contentJson={doc.contentJson} type={doc.type} title={doc.title} />
                        <div className="px-1.5 pb-1.5 pt-2">
                          <p className="truncate text-[13px] font-bold text-slate-800">{doc.title}</p>
                          <p className="mt-1 text-[10px] text-slate-400">{formatDocumentDateTime(doc.updatedAt)}</p>
                        </div>
                        <button
                          onClick={(e) => handleDeleteDraft(e, doc.id)}
                          className="absolute right-3 top-3 rounded-lg bg-white/90 p-1.5 text-slate-400 opacity-0 shadow-sm transition-all hover:text-red-500 group-hover:opacity-100"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                </section>
              )}

              {docSearch && filteredDrafts.length === 0 && filteredTeacherDocuments.length === 0 && filteredStudentDocuments.length === 0 && (
                <div className="flex flex-col items-center justify-center py-16 text-center">
                  <Search className="h-8 w-8 text-slate-200 mb-3" />
                  <p className="text-sm text-slate-400">{isEnglish ? 'No document matches ' : 'Nessun documento corrisponde a '}<strong>"{docSearch}"</strong></p>
                </div>
              )}

              {filteredStudentDocuments.length > 0 && (
                <section className="rounded-[26px] border border-emerald-200/80 bg-emerald-50/70 p-4 shadow-sm">
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <div>
                      <h2 className="text-[10px] font-bold uppercase tracking-widest text-emerald-700">{isEnglish ? 'Shared by Students' : 'Condivisi dagli studenti'} {docSearch && <span className="normal-case font-normal">({filteredStudentDocuments.length})</span>}</h2>
                      <p className="mt-1 text-xs text-emerald-700/70">{isEnglish ? 'Latest submissions from the class' : 'Ultimi invii ricevuti dalla classe'}</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setStudentDocsCollapsed(value => !value)}
                      className="rounded-full bg-white/80 px-3 py-1.5 text-[11px] font-bold text-emerald-700 shadow-sm ring-1 ring-emerald-100 transition-colors hover:bg-white"
                    >
                      {studentDocsCollapsed ? (isEnglish ? 'Expand' : 'Espandi') : (isEnglish ? 'Collapse' : 'Comprimi')}
                    </button>
                  </div>

                  {studentDocsCollapsed ? (
                    <div className="flex min-h-10 items-center gap-2 overflow-x-auto rounded-2xl bg-white/65 px-2 py-2">
                      {filteredStudentDocuments.map(doc => (
                        <button
                          key={doc.id}
                          type="button"
                          onClick={() => setDocumentToOpen({ document: doc, onEdit: () => loadDocument(doc) })}
                          title={`${doc.title} · ${doc.authorName}`}
                          className={`flex max-w-[260px] shrink-0 items-center gap-2 rounded-xl px-2.5 py-2 text-left shadow-sm transition-transform hover:-translate-y-0.5 ${docColor(doc.type)}`}
                        >
                          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white/55">
                            {docIcon(doc.type)}
                          </span>
                          <span className="min-w-0">
                            <span className="block truncate text-[11px] font-bold leading-tight text-slate-800">{doc.authorName}</span>
                            <span className="block truncate text-[11px] leading-tight text-slate-600">{doc.title}</span>
                          </span>
                        </button>
                      ))}
                    </div>
                  ) : (
                    <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-5">
                      {filteredStudentDocuments.map(doc => (
                        <div
                          key={doc.id}
                          onClick={() => setDocumentToOpen({ document: doc, onEdit: () => loadDocument(doc) })}
                          className="group relative cursor-pointer overflow-hidden rounded-2xl border border-emerald-200/80 bg-white/95 p-1.5 shadow-[0_6px_20px_-14px_rgba(15,23,42,0.55)] transition-all hover:-translate-y-0.5 hover:border-emerald-300 hover:shadow-md"
                        >
                          <DocumentThumbnail contentJson={doc.contentJson} type={doc.type} title={doc.title} />
                          <div className="px-1.5 pb-1.5 pt-2">
                            <p className="truncate text-[13px] font-bold text-slate-800">{doc.title}</p>
                            <p className="mt-1 flex items-center gap-1 truncate text-[10px] text-slate-500">
                              <User className="h-3 w-3 text-emerald-500" />
                              {isEnglish ? 'Author' : 'Autore'}: {doc.authorName}
                            </p>
                            <p className="mt-1 truncate text-[10px] text-slate-400">{doc.className} · {formatDocumentDateTime(doc.updatedAt)}</p>
                          </div>
                          <button
                            onClick={(e) => handleDeletePublished(e, doc)}
                            className="absolute right-3 top-3 rounded-lg bg-white/90 p-1.5 text-slate-400 opacity-0 shadow-sm transition-all hover:text-red-500 group-hover:opacity-100"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </section>
              )}

              {filteredTeacherDocuments.length > 0 && (
                <section>
                  <h2 className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-3">{isEnglish ? 'Shared by Teacher' : 'Condivisi dal docente'} {docSearch && <span className="normal-case font-normal">({filteredTeacherDocuments.length})</span>}</h2>
                  <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-5">
                    {filteredTeacherDocuments.map(doc => (
                      <div
                        key={doc.id}
                        onClick={() => setDocumentToOpen({ document: doc, onEdit: () => loadDocument(doc) })}
                        className="group relative cursor-pointer overflow-hidden rounded-2xl border border-slate-200/80 bg-white/95 p-1.5 shadow-[0_6px_20px_-14px_rgba(15,23,42,0.55)] transition-all hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-md"
                      >
                        <DocumentThumbnail contentJson={doc.contentJson} type={doc.type} title={doc.title} />
                        <div className="px-1.5 pb-1.5 pt-2">
                          <p className="truncate text-[13px] font-bold text-slate-800">{doc.title}</p>
                          <p className="mt-1 flex items-center gap-1 truncate text-[10px] text-slate-500">
                            <User className="h-3 w-3 text-slate-400" />
                            {isEnglish ? 'Author' : 'Autore'}: {doc.authorName}
                          </p>
                          <p className="mt-1 truncate text-[10px] text-slate-400">{doc.className} · {formatDocumentDateTime(doc.updatedAt)}</p>
                        </div>
                        <button
                          onClick={(e) => handleDeletePublished(e, doc)}
                          className="absolute right-3 top-3 rounded-lg bg-white/90 p-1.5 text-slate-400 opacity-0 shadow-sm transition-all hover:text-red-500 group-hover:opacity-100"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                </section>
              )}
            </div>
          </div>
          {documentDragActive && (
            <div className="pointer-events-none absolute inset-4 z-50 flex items-center justify-center rounded-[28px] border-2 border-dashed border-sky-500 bg-sky-50/95 shadow-2xl backdrop-blur-sm">
              <div className="text-center"><FileUp className="mx-auto h-12 w-12 text-sky-600" /><p className="mt-3 text-lg font-black text-slate-900">{isEnglish ? 'Drop files to import' : 'Rilascia i file per importarli'}</p><p className="mt-1 text-sm text-slate-600">PDF, PPT/PPTX, DOC/DOCX, MD, XLS/XLSX, CSV</p></div>
            </div>
          )}
        </div>

        {documentToOpen && <DocumentOpenModal document={documentToOpen.document} onEdit={documentToOpen.onEdit} onClose={() => setDocumentToOpen(null)} isEnglish={isEnglish} />}
        {showNewModal && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
            <div className={`w-full max-w-md mx-4 rounded-[28px] p-6 shadow-xl ${PASTEL_SURFACES.slate}`}>
              <h3 className="text-lg font-semibold mb-2">{isEnglish ? 'Create new' : 'Crea nuovo'}</h3>
              <p className="text-sm text-gray-600 mb-4">{isEnglish ? 'Choose the type of content to create.' : 'Scegli il tipo di contenuto da creare.'}</p>
              <div className="flex flex-col gap-3">
                <Button className="w-full justify-center" onClick={() => { createNewDocument(); setShowNewModal(false) }}>
                  <FileText className="h-4 w-4 mr-2" />{isEnglish ? 'New document' : 'Nuovo documento'}
                </Button>
                <Button className="w-full justify-center" onClick={() => { createNewPresentation(); setShowNewModal(false) }}>
                  <Monitor className="h-4 w-4 mr-2" />{isEnglish ? 'New presentation' : 'Nuova presentazione'}
                </Button>
                <Button className="w-full justify-center" onClick={() => { createNewSheet(); setShowNewModal(false) }}>
                  <FileSpreadsheet className="h-4 w-4 mr-2" />{isEnglish ? 'Tables' : 'Tabelle'}
                </Button>
                <Button className="w-full justify-center" onClick={() => { createNewCanvas(); setShowNewModal(false) }}>
                  <PenTool className="h-4 w-4 mr-2" />{isEnglish ? 'New board' : 'Nuova lavagna'}
                </Button>
              </div>
              <div className="flex justify-end mt-4">
                <Button variant="outline" onClick={() => setShowNewModal(false)}>{isEnglish ? 'Cancel' : 'Annulla'}</Button>
              </div>
            </div>
          </div>
        )}
      </>
    )
  }

  // ── Mobile simplified view ────────────────────────────────────────────────
  if (isMobile) {
    const docTypeLabel: Record<string, string> = {
      presentation: isEnglish ? '📊 Presentation' : '📊 Presentazione',
      document: isEnglish ? '📄 Document' : '📄 Documento',
      sheet: isEnglish ? '📋 Tables' : '📋 Tabelle',
      canvas: '🎨 Canvas',
    }
    return (
      <div className="flex flex-col h-full bg-slate-50 p-4 gap-4 overflow-y-auto">
        <div className="flex items-center justify-between">
          <h1 className="text-base font-bold text-slate-800 flex items-center gap-2">
            <FileText className="h-5 w-5 text-slate-500" />
            {isEnglish ? 'Documents' : 'Documenti'}
          </h1>
          <p className="text-[10px] text-slate-400 text-right">
            {isEnglish ? <>Editor available<br />on desktop only</> : <>Editor disponibile<br />solo su desktop</>}
          </p>
        </div>

        {storedDocuments.length === 0 && draftDocuments.length === 0 && (
          <div className="text-center py-12 text-slate-400 text-sm">
            {isEnglish ? 'No documents found' : 'Nessun documento trovato'}
          </div>
        )}

        {draftDocuments.length > 0 && (
          <div>
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">{isEnglish ? 'Drafts' : 'Bozze'}</p>
            <div className="space-y-2">
              {draftDocuments.map(doc => (
                <div key={doc.id} className="bg-white rounded-xl border border-slate-200 px-4 py-3 flex items-center justify-between shadow-sm">
                  <div>
                    <p className="text-sm font-semibold text-slate-800 truncate max-w-[200px]">{doc.title}</p>
                    <p className="text-xs text-slate-400">{docTypeLabel[doc.type] || doc.type} · {new Date(doc.updatedAt).toLocaleDateString(dateLocale)}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {storedDocuments.length > 0 && (
          <div>
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">{isEnglish ? 'Published' : 'Pubblicati'}</p>
            <div className="space-y-2">
              {storedDocuments.map(doc => (
                <div key={doc.id} className="bg-white rounded-xl border border-slate-200 px-4 py-3 shadow-sm">
                  <p className="text-sm font-semibold text-slate-800 truncate">{doc.title}</p>
                  <p className="text-xs text-slate-400">{docTypeLabel[doc.type] || doc.type} · {doc.sessionName} · {new Date(doc.updatedAt).toLocaleDateString(dateLocale)}</p>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    )
  }

  return (
    <>
      <div className="h-full flex flex-col bg-slate-100 overflow-hidden">

        {/* Header / Meta-Toolbar */}
        <div className="relative h-16 bg-white border-b border-slate-200 flex items-center justify-between px-4 z-30 shrink-0">
          <div className="flex min-w-0 items-center gap-2">
             <Button
               variant="ghost"
               size="sm"
               onClick={closeDocumentEditor}
               className="shrink-0 text-slate-600 gap-1 font-semibold"
             >
               <ChevronLeft className="h-4 w-4" />
               {isEnglish ? 'All documents' : 'Tutti i documenti'}
             </Button>
             <div className="h-7 w-px bg-slate-200" />
             <Input
               value={document.title}
               onChange={(e) => handleTitleChange(e.target.value)}
               disabled={Boolean(activeStudentSubmissionId)}
               className="h-10 w-[min(28vw,360px)] border-indigo-200 bg-indigo-50/60 px-3 font-bold text-slate-900 shadow-none focus-visible:ring-indigo-200"
               placeholder={isEnglish ? 'Document title' : 'Titolo documento'}
             />
             <Button
               onClick={() => setShowNewModal(true)}
               tone="accent"
               surface="soft"
               density="default"
               className="shrink-0"
             >
               <Plus className="h-4 w-4 mr-2" />
               {isEnglish ? 'New' : 'Nuovo'}
             </Button>
          </div>

          <div className="flex items-center gap-2">
             <span className={`hidden text-xs font-semibold xl:inline ${draftSaveState === 'error' ? 'text-red-600' : draftSaveState === 'saved' ? 'text-emerald-600' : 'text-slate-400'}`}>
               {activeStudentSubmissionId
                 ? (correctionSaveState === 'saving' ? (isEnglish ? 'Saving correction…' : 'Salvataggio correzione…') : (isEnglish ? 'Tracked correction' : 'Correzione tracciata'))
                 : draftSaveState === 'saving' ? (isEnglish ? 'Saving…' : 'Salvataggio…')
                   : draftSaveState === 'saved' ? (isEnglish ? 'Saved' : 'Salvato')
                     : draftSaveState === 'error' ? (isEnglish ? 'Save error' : 'Errore salvataggio')
                       : ''}
             </span>
             <Button
               variant="ghost"
               size="icon"
               className="h-10 w-10 rounded-xl text-slate-600"
               disabled={!draftId}
               onClick={() => setShowVersionPanel(true)}
               title={isEnglish ? 'Version history' : 'Cronologia versioni'}
             >
               <History className="h-4 w-4" />
             </Button>
             {(mode === 'document' || mode === 'slides') && (
               <Button
                 variant={documentAgentOpen ? 'default' : 'outline'}
                 className="rounded-xl"
                 onClick={() => setDocumentAgentOpen(value => !value)}
               >
                 <MonitorPlay className="mr-2 h-4 w-4" />
                 {isEnglish ? 'Document assistant' : 'Assistente documento'}
               </Button>
             )}
             {mode !== 'canvas' && mode !== 'web' && (
               <label className="relative flex h-10 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-xs font-bold text-slate-700 shadow-sm">
                 {documentExporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                 <select
                   aria-label={isEnglish ? 'Export document' : 'Esporta documento'}
                   disabled={documentExporting}
                   defaultValue=""
                   className="max-w-[112px] cursor-pointer appearance-none bg-transparent pr-3 outline-none disabled:cursor-wait"
                   onChange={(event) => {
                     const format = event.target.value as 'pdf' | 'ppt' | 'pptx' | 'doc' | 'docx' | 'xlsx'
                     if (format) void exportCurrentDocument(format)
                     event.target.value = ''
                   }}
                 >
                   <option value="" disabled>{isEnglish ? 'Export…' : 'Esporta…'}</option>
                   <option value="pdf">PDF</option>
                   {mode === 'slides' && <option value="pptx">PowerPoint (.pptx)</option>}
                   {mode === 'slides' && <option value="ppt">PowerPoint 97-2003 (.ppt)</option>}
                   {(mode === 'document' || mode === 'slides' || mode === 'sheet') && <option value="docx">Word (.docx)</option>}
                   {mode === 'document' && <option value="pptx">PowerPoint (.pptx)</option>}
                   {mode === 'sheet' && <option value="xlsx">Excel (.xlsx)</option>}
                 </select>
               </label>
             )}
             {activeStudentSubmissionId ? (
               <span className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs font-bold text-amber-800">
                 {isEnglish ? 'Changes are sent to the student' : 'Le modifiche vengono inviate allo studente'}
               </span>
             ) : (
               <Button tone="accent" surface="solid" density="default" onClick={() => setShowPublishModal(true)}>
                 <Upload className="h-4 w-4 mr-2" />
                 {isEnglish ? 'Publish' : 'Pubblica'}
               </Button>
             )}
          </div>
        </div>

        {/* Unified Toolbar */}
        {mode !== 'sheet' && mode !== 'canvas' && mode !== 'web' && (
        <div ref={toolbarHostRef}>
          <UnifiedToolbar
            mode={mode}
            editor={editor}
            docScale={docScale}
            setDocScale={setDocScale}
            showRuledLines={showRuledLines}
            onToggleRuledLines={() => setShowRuledLines(v => !v)}
            scale={scale}
            setScale={setScale}
            onAddSlideBlock={addSlideBlock}
            onAddSlideImage={addSlideImage}
            selectedBlock={selectedBlock}
            onUpdateBlockStyle={updateBlockStyle}
            snapOptions={snapOptions}
            onChangeSnapOptions={setSnapOptions}
            onOpenAIAssist={() => setDocumentAgentOpen(true)}
            onAIAssistAnchorChange={setAiPanelAnchor}
          />
        </div>
        )}

        <div className="flex-1 flex overflow-hidden"> 
          
          {/* LEFT SIDEBAR: Documents & Slides */}
          <div className={`${mode === 'slides' ? 'w-64' : 'w-0'} bg-white border-r border-slate-200 flex flex-col transition-all duration-200 overflow-hidden shrink-0`}>
            
            {/* Slide Navigation (Only in Slide Mode) */}
            {mode === 'slides' && (
              <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-white">
                 <div className="flex min-h-12 items-center justify-between border-b border-slate-100 px-3">
                   <div className="flex items-center gap-2">
                     <span className="font-bold text-[10px] uppercase tracking-widest text-slate-400">{isEnglish ? 'Slides' : 'Slide'}</span>
                     {selectedSlideIds.length > 1 && <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-[10px] font-bold text-indigo-600">{selectedSlideIds.length}</span>}
                   </div>
                   <div className="flex items-center gap-0.5">
                     <Button size="icon" variant="ghost" className="h-7 w-7" disabled={selectedSlideIds.length === 0} onClick={() => moveSelectedSlides(-1)} title={isEnglish ? 'Move up' : 'Sposta su'}><ArrowUp className="h-3.5 w-3.5" /></Button>
                     <Button size="icon" variant="ghost" className="h-7 w-7" disabled={selectedSlideIds.length === 0} onClick={() => moveSelectedSlides(1)} title={isEnglish ? 'Move down' : 'Sposta giù'}><ArrowDown className="h-3.5 w-3.5" /></Button>
                     <Button size="icon" variant="ghost" className="h-7 w-7 text-slate-500 hover:text-red-600" disabled={selectedSlideIds.length === 0} onClick={deleteSelectedSlides} title={isEnglish ? 'Delete selected' : 'Elimina selezionate'}><Trash2 className="h-3.5 w-3.5" /></Button>
                     <Button size="icon" variant="ghost" className="h-7 w-7 text-indigo-600" onClick={addSlide} title={isEnglish ? 'Add slide' : 'Aggiungi slide'}><Plus className="h-4 w-4" /></Button>
                   </div>
                 </div>
                 <div className="flex-1 overflow-y-auto p-3 space-y-3 scrollbar-hide">
                   {document.slides.map((slide, idx) => (
                     <div 
                       key={slide.id}
                       draggable
                       onDragStart={() => {
                         const ids = selectedSlideIds.includes(slide.id) ? selectedSlideIds : [slide.id]
                         setSelectedSlideIds(ids)
                         setDraggedSlideIds(ids)
                       }}
                       onDragOver={(event) => event.preventDefault()}
                       onDrop={(event) => { event.preventDefault(); dropSelectedSlidesAt(idx) }}
                       onClick={(event) => selectSlide(idx, event)}
                       className={`group relative cursor-pointer rounded-xl border p-2 transition-all ${selectedSlideIds.includes(slide.id)
                         ? 'border-indigo-300 bg-indigo-50/70 shadow-sm ring-1 ring-indigo-100'
                         : 'border-slate-200 bg-white hover:border-slate-300 hover:shadow-sm'}`}
                     >
                       <div className="mb-2 flex items-center gap-2 px-0.5">
                         <GripVertical className="h-3.5 w-3.5 text-slate-300" />
                         <span className="text-[10px] font-bold uppercase tracking-wide text-slate-400">{idx + 1}</span>
                         <span className="min-w-0 flex-1 truncate text-xs font-semibold text-slate-700">{slide.title}</span>
                         <CheckSquare className={`h-3.5 w-3.5 ${selectedSlideIds.includes(slide.id) ? 'text-indigo-600' : 'text-slate-200'}`} />
                       </div>
                       <div className="relative aspect-video w-full overflow-hidden rounded-lg border border-slate-200 bg-white shadow-inner pointer-events-none">
                         <div
                           className="absolute left-0 top-0 origin-top-left"
                           style={{
                             width: FORMAT_DIMENSIONS[document.format].width,
                             height: FORMAT_DIMENSIONS[document.format].height,
                             transform: `scale(${216 / FORMAT_DIMENSIONS[document.format].width})`,
                           }}
                         >
                           <SlideEditor
                             blocks={slide.blocks}
                             onChange={() => undefined}
                             selectedBlockId={null}
                             onSelectBlock={() => undefined}
                             readOnly
                             slideWidth={FORMAT_DIMENSIONS[document.format].width}
                             slideHeight={FORMAT_DIMENSIONS[document.format].height}
                             snapOptions={snapOptions}
                           />
                         </div>
                       </div>
                     </div>
                   ))}
                 </div>
              </div>
            )}

            {/* Document Lists */}
            <div className="hidden">
              {/* Drafts Section */}
              <section>
                <div className="flex items-center justify-between mb-3 px-1">
                  <h3 className="font-bold text-[10px] uppercase tracking-widest text-slate-400">{isEnglish ? 'My Drafts' : 'Le mie Bozze'}</h3>
                  <span className="text-[10px] font-bold bg-slate-200 text-slate-500 px-1.5 py-0.5 rounded-full">{draftDocuments.length}</span>
                </div>
                
                <div className="space-y-2">
                  {draftDocuments.length === 0 && (
                    <div className={`text-center py-6 px-4 rounded-2xl border border-dashed shadow-sm ${PASTEL_SURFACES.slate}`}>
                      <p className="text-[10px] font-medium text-slate-400">{isEnglish ? 'No saved drafts' : 'Nessuna bozza salvata'}</p>
                    </div>
                  )}
                  {draftDocuments.map((doc) => (
                    <div
                      key={doc.id}
                      onClick={() => setDocumentToOpen({ document: doc, onEdit: () => loadDraft(doc) })}
                      className={`group flex flex-col p-3 rounded-2xl transition-all cursor-pointer shadow-sm ${draftId === doc.id ? PASTEL_SURFACES[docTone(doc.type)] : PASTEL_SURFACES.slate}`}
                    >
                      <div className="flex items-center gap-3 mb-2">
                        <div className={`p-2 rounded-xl shadow-sm ${PASTEL_ICON_BACKGROUNDS[docTone(doc.type)]} ${PASTEL_ICON_TEXT[docTone(doc.type)]}`}>
                          {doc.type === 'presentation' ? <MonitorPlay className="h-4 w-4" /> : 
                           doc.type === 'sheet' ? <FileSpreadsheet className="h-4 w-4" /> : 
                           doc.type === 'canvas' ? <PenTool className="h-4 w-4" /> : 
                           <FileText className="h-4 w-4" />}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className={`text-sm font-bold truncate ${draftId === doc.id ? PASTEL_ICON_TEXT[docTone(doc.type)] : 'text-slate-800'}`}>
                            {doc.title}
                          </p>
                        </div>
                        <button
                          onClick={(e) => handleDeleteDraft(e, doc.id)}
                          className="opacity-0 group-hover:opacity-100 p-1 text-slate-400 hover:text-red-500 transition-all"
                          title={isEnglish ? 'Delete draft' : 'Elimina bozza'}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                      
                      <div className="flex items-center justify-between mt-auto">
                        <div className="flex items-center gap-1.5 text-[10px] font-bold text-slate-400">
                          <Clock className="h-3 w-3" />
                          {formatDocumentDateTime(doc.updatedAt)}
                        </div>
                        <span className="text-[9px] font-black uppercase tracking-tighter text-slate-300">{isEnglish ? 'Personal Draft' : 'Bozza Personale'}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </section>

              {/* Stored/Published Section */}
              <section>
                <div className="flex items-center justify-between mb-3 px-1">
                  <h3 className="font-bold text-[10px] uppercase tracking-widest text-slate-400">{isEnglish ? 'Saved in Sessions' : 'Salvati nelle Sessioni'}</h3>
                  <span className="text-[10px] font-bold bg-indigo-100 text-indigo-600 px-1.5 py-0.5 rounded-full">{storedDocuments.length}</span>
                </div>

                <div className="space-y-2">
                  {storedDocuments.length === 0 && (
                    <div className={`text-center py-6 px-4 rounded-2xl border border-dashed shadow-sm ${PASTEL_SURFACES.slate}`}>
                      <p className="text-[10px] font-medium text-slate-400">{isEnglish ? 'No content published in sessions' : 'Nessun contenuto pubblicato nelle sessioni'}</p>
                    </div>
                  )}
                  {storedDocuments.map((doc) => (
                    <div
                      key={doc.id}
                      onClick={() => setDocumentToOpen({ document: doc, onEdit: () => loadDocument(doc) })}
                      className={`group flex flex-col p-3 rounded-2xl transition-all cursor-pointer shadow-sm ${document.id === doc.id ? PASTEL_SURFACES[docTone(doc.type)] : PASTEL_SURFACES.slate}`}
                    >
                      <div className="flex items-center gap-3 mb-2">
                        <div className={`p-2 rounded-xl shadow-sm ${PASTEL_ICON_BACKGROUNDS[docTone(doc.type)]} ${PASTEL_ICON_TEXT[docTone(doc.type)]}`}>
                          {doc.type === 'presentation' ? <Monitor className="h-4 w-4" /> : 
                           doc.type === 'canvas' ? <PenTool className="h-4 w-4" /> : 
                           <BookOpen className="h-4 w-4" />}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className={`text-sm font-bold truncate ${document.id === doc.id ? PASTEL_ICON_TEXT[docTone(doc.type)] : 'text-slate-800'}`}>
                            {doc.title}
                          </p>
                          <p className="text-[10px] font-medium text-slate-500 flex items-center gap-1">
                            <User className="h-2.5 w-2.5 text-indigo-500" />
                            {doc.authorName} • {doc.className}
                          </p>
                        </div>
                        <button
                          onClick={(e) => handleDeletePublished(e, doc)}
                          className="opacity-0 group-hover:opacity-100 p-1 text-slate-400 hover:text-red-500 transition-all"
                          title={isEnglish ? 'Remove from session' : 'Rimuovi dalla sessione'}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                      
                      <div className="flex items-center justify-between mt-auto">
                        <div className="flex items-center gap-1.5 text-[10px] font-bold text-slate-400">
                          <Calendar className="h-3 w-3" />
                          {formatDocumentDateTime(doc.updatedAt)}
                        </div>
                        <div className="flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-indigo-50 border border-indigo-200/70 text-[9px] font-black uppercase tracking-tighter text-indigo-600">
                          <Share2 className="h-2 w-2" />
                          {isEnglish ? 'Published' : 'Pubblicato'}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            </div>
          </div>

          {/* Main Area */}
          <div className={`flex-1 flex items-start justify-center p-2 md:p-3 relative overflow-y-auto ${activeStudentSubmissionId ? 'bg-amber-50/70' : 'bg-slate-100'}`}
               onClick={() => setSelectedBlockId(null)} // Deselect block when clicking background
          > 

             {mode === 'web' && (
               <div className="w-full max-w-6xl h-[calc(100vh-10rem)] bg-white rounded-2xl shadow-[0_10px_30px_rgba(15,23,42,0.12)] overflow-hidden">
                 {document.webUrl ? (
                   <iframe
                     src={document.webUrl}
                     className="w-full h-full border-0"
                     title={document.title}
                   />
                 ) : (
                   <iframe
                     srcDoc={document.textContent || ''}
                     sandbox="allow-same-origin allow-scripts"
                     className="w-full h-full border-0"
                     title={document.title}
                   />
                 )}
               </div>
             )}
             
             {/* MODE: DOCUMENT */}
             {mode === 'document' && (
               <div
                 ref={documentPageRef}
                 className="mb-6 print:shadow-none flex flex-col relative transition-all overflow-hidden"
                 style={{
                   width: FORMAT_DIMENSIONS.a4.width,
                   minHeight: FORMAT_DIMENSIONS.a4.height * documentPageCount + DOC_PAGE_GAP * Math.max(0, documentPageCount - 1),
                   transform: `scale(${docScale})`,
                   transformOrigin: 'top center',
                   backgroundImage: `repeating-linear-gradient(to bottom, #ffffff 0, #ffffff ${FORMAT_DIMENSIONS.a4.height}px, #e5e7eb ${FORMAT_DIMENSIONS.a4.height}px, #e5e7eb ${FORMAT_DIMENSIONS.a4.height + DOC_PAGE_GAP}px)`,
                   boxShadow: '0 10px 30px rgba(15, 23, 42, 0.12)',
                   padding: `${docMargins.vertical}px ${docMargins.horizontal}px`
                 }}
               >
                  {/* Top guides for lateral margins with drag handles */}
                  <div className="pointer-events-none absolute top-3 left-0 right-0 z-10">
                    <div className="relative h-4">
                      <div
                        className="absolute top-2 border-t border-slate-300"
                        style={{ left: docMargins.horizontal, right: docMargins.horizontal }}
                      />
                      <div
                        className="pointer-events-auto absolute top-0 h-4 border-l border-slate-400"
                        style={{ left: docMargins.horizontal }}
                      />
                      <div
                        className="pointer-events-auto absolute top-0 h-4 border-l border-slate-400"
                        style={{ right: docMargins.horizontal }}
                      />
                      <button
                        type="button"
                        className="pointer-events-auto absolute -top-0.5 h-3.5 w-3.5 -translate-x-1/2 cursor-ew-resize rounded-full border border-slate-500 bg-white shadow-sm"
                        style={{ left: docMargins.horizontal }}
                        onMouseDown={() => setDraggingMargin('left')}
                        aria-label={isEnglish ? 'Adjust left margin' : 'Regola margine sinistro'}
                        title={isEnglish ? 'Drag to adjust left margin' : 'Trascina per regolare margine sinistro'}
                      />
                      <button
                        type="button"
                        className="pointer-events-auto absolute -top-0.5 h-3.5 w-3.5 -translate-x-1/2 cursor-ew-resize rounded-full border border-slate-500 bg-white shadow-sm"
                        style={{ left: FORMAT_DIMENSIONS.a4.width - docMargins.horizontal }}
                        onMouseDown={() => setDraggingMargin('right')}
                        aria-label={isEnglish ? 'Adjust right margin' : 'Regola margine destro'}
                        title={isEnglish ? 'Drag to adjust right margin' : 'Trascina per regolare margine destro'}
                      />
                    </div>
                  </div>

                  {showRuledLines && (
                    <div
                      className="pointer-events-none absolute z-0"
                      style={{
                        top: docMargins.vertical,
                        right: docMargins.horizontal,
                        bottom: docMargins.vertical,
                        left: docMargins.horizontal,
                        backgroundImage: 'repeating-linear-gradient(to bottom, transparent 0, transparent 21px, rgba(148, 163, 184, 0.35) 21px, rgba(148, 163, 184, 0.35) 22px, transparent 22px, transparent 28px)'
                      }}
                    />
                  )}

                  <div
                    className="flex-1 flex flex-col relative z-10 cursor-text"
                    style={{ minHeight: FORMAT_DIMENSIONS.a4.height - docMargins.vertical * 2 }}
                    onMouseDown={(e) => {
                      if (e.target !== e.currentTarget) return
                      if (editor && mode === 'document') {
                        const view = (editor as any).view
                        if (view) {
                          const pos = view.posAtCoords({ left: e.clientX, top: e.clientY })
                          if (pos) {
                            editor.chain().focus().setTextSelection(pos.pos).run()
                            return
                          }
                        }
                        editor.chain().focus('end').run()
                      }
                    }}
                  >
                    <RichTextEditor
                      content={document.textContent || ''}
                      onChange={(html) => setDocument(d => ({ ...d, textContent: html }))}
                      onEditorReady={(e) => { setEditor(e); setTimeout(() => e.commands.focus('start'), 80) }}
                      contentClassName="h-full min-h-full max-w-none focus:outline-none p-0 cursor-text [&_.ProseMirror]:min-h-full [&_.ProseMirror]:h-full [&_.ProseMirror]:text-[16px] [&_.ProseMirror]:leading-7 [&_.ProseMirror_p]:m-0 [&_.ProseMirror_h1]:m-0 [&_.ProseMirror_h2]:m-0 [&_.ProseMirror_h3]:m-0 [&_.ProseMirror_ul]:my-0 [&_.ProseMirror_ol]:my-0"
                      aiPanelAnchor={aiPanelAnchor}
                      enableSelectionAssist={false}
                      pagination={{
                        pageHeight: FORMAT_DIMENSIONS.a4.height,
                        pageGap: DOC_PAGE_GAP,
                        marginTop: docMargins.vertical,
                        marginBottom: docMargins.vertical,
                        onPageCountChange: setDocumentPageCount,
                      }}
                      onMissingSelectionForAI={() => {
                        toast({
                          title: isEnglish ? 'Select text first' : 'Seleziona prima un testo',
                          description: isEnglish ? 'The AI assistant works on the selected text in the document.' : 'L’assistente AI lavora sul testo selezionato nel documento.',
                        })
                      }}
                    />
                  </div>
               </div>
             )}

             {/* MODE: SLIDES */}
             {mode === 'slides' && (
               <div 
                 ref={canvasRef}
                 className="bg-white shadow-xl relative transition-transform origin-center flex flex-col"
                 style={{
                   width: FORMAT_DIMENSIONS[document.format].width,
                   height: FORMAT_DIMENSIONS[document.format].height,
                   transform: `scale(${scale})`,
                   marginTop: '20px'
                 }}
                 onClick={(e) => e.stopPropagation()} // Prevent deselection when clicking slide background
               >
                  {!currentSlide.blocks.some(block => (
                    block.type === 'text'
                    && block.y < 130
                    && (block.style.fontSize || 0) >= 26
                  )) && <div className="absolute top-0 left-0 right-0 p-8 z-10 pointer-events-none">
                     <input
                       value={currentSlide.title}
                       onChange={(e) => {
                         const newSlides = [...document.slides]
                         newSlides[currentSlideIndex].title = e.target.value
                         setDocument(d => ({ ...d, slides: newSlides }))
                       }}
                       className="text-4xl font-bold bg-transparent border-none focus:outline-none w-full placeholder-slate-300 pointer-events-auto"
                       placeholder={isEnglish ? 'Slide Title' : 'Titolo Slide'}
                     />
                  </div>}

                  <div className="flex-1 relative">
                    <SlideEditor
                      blocks={currentSlide.blocks}
                      onChange={updateSlideBlocks}
                      selectedBlockId={selectedBlockId}
                      onSelectBlock={setSelectedBlockId}
                      scale={scale}
                      slideWidth={FORMAT_DIMENSIONS[document.format].width}
                      slideHeight={FORMAT_DIMENSIONS[document.format].height}
                      snapOptions={snapOptions}
                    />
                  </div>
               </div>
             )}

             {mode === 'sheet' && (
               <div className="w-full max-w-[1400px] p-2">
                 <SpreadsheetEditor
                   data={document.sheetData || DEFAULT_SHEET_DATA}
                   onDataChange={(next) => setDocument(d => ({ ...d, sheetData: next }))}
                   chartConfig={document.sheetChart || DEFAULT_SHEET_CHART}
                   onChartConfigChange={(next) => setDocument(d => ({ ...d, sheetChart: next }))}
                   styles={document.sheetStyles || {}}
                   onStylesChange={(next) => setDocument(d => ({ ...d, sheetStyles: next }))}
                   dimensions={document.sheetDimensions || {}}
                   onDimensionsChange={(next) => setDocument(d => ({ ...d, sheetDimensions: next }))}
                 />
               </div>
             )}
             {mode === 'canvas' && (
               <div className="w-full max-w-[1700px] p-2">
                 <CollaborativeCanvas
                   role="teacher"
                   sessionId={selectedSessionId || undefined}
                   title={document.title}
                   onTitleChange={handleTitleChange}
                   initialContent={document.canvasContent || DEFAULT_CANVAS_CONTENT}
                   onContentChange={(contentJson) => setDocument((d) => ({ ...d, canvasContent: contentJson }))}
                 />
               </div>
             )}

          </div>
          {documentAgentOpen && (mode === 'slides' || mode === 'document') && (
            <>
              <button
                type="button"
                className="fixed inset-0 z-40 bg-slate-950/30 backdrop-blur-[1px] xl:hidden"
                onClick={() => setDocumentAgentOpen(false)}
                aria-label={isEnglish ? 'Close document assistant' : 'Chiudi assistente documento'}
              />
              <DocumentAgentChat
                context={documentAssistContext}
                selectionContext={selectionAssistContext}
                presentationContext={presentationAssistContext}
                documentContext={{
                  title: document.title,
                  mode,
                  format: document.format,
                  current_slide_index: currentSlideIndex,
                }}
                dims={mode === 'slides' ? FORMAT_DIMENSIONS[document.format] : undefined}
                onApply={applyDocumentAgentProposal}
                onClose={() => setDocumentAgentOpen(false)}
              />
            </>
          )}
        </div>

        {showVersionPanel && (
          <div className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-950/35 p-4 backdrop-blur-sm" onClick={() => setShowVersionPanel(false)}>
            <div className="flex max-h-[78vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl" onClick={(event) => event.stopPropagation()}>
              <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
                <div>
                  <p className="m-0 text-xs font-bold uppercase tracking-widest text-indigo-500">{isEnglish ? 'Version control' : 'Controllo versioni'}</p>
                  <h3 className="m-0 mt-1 text-lg font-bold text-slate-900">{document.title}</h3>
                </div>
                <Button variant="ghost" size="icon" className="rounded-full" onClick={() => setShowVersionPanel(false)}><X className="h-4 w-4" /></Button>
              </div>
              <div className="flex items-center justify-between border-b border-slate-100 bg-slate-50 px-5 py-3">
                <p className="m-0 text-xs text-slate-500">{isEnglish ? 'Automatic snapshots every 5 minutes.' : 'Snapshot automatici ogni 5 minuti.'}</p>
                <Button size="sm" variant="outline" className="rounded-xl" disabled={versionActionLoading} onClick={createVersionCheckpoint}>
                  <Save className="mr-2 h-3.5 w-3.5" />{isEnglish ? 'Save version' : 'Salva versione'}
                </Button>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto p-3">
                {versionsLoading ? (
                  <div className="py-10 text-center text-sm text-slate-400">{isEnglish ? 'Loading history…' : 'Caricamento cronologia…'}</div>
                ) : documentVersions.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-slate-200 py-10 text-center text-sm text-slate-400">{isEnglish ? 'No versions saved yet.' : 'Nessuna versione salvata.'}</div>
                ) : (
                  <div className="space-y-2">
                    {documentVersions.map((version, index) => (
                      <div key={version.id} className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 hover:border-indigo-200 hover:bg-indigo-50/30">
                        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-slate-100 text-xs font-bold text-slate-600">v{documentVersions.length - index}</div>
                        <div className="min-w-0 flex-1">
                          <p className="m-0 truncate text-sm font-semibold text-slate-800">{version.label || (isEnglish ? 'Saved version' : 'Versione salvata')}</p>
                          <p className="m-0 mt-0.5 text-xs text-slate-400">{formatDocumentDateTime(version.createdAt)}</p>
                        </div>
                        <Button size="sm" variant="ghost" className="rounded-lg text-indigo-600 hover:bg-indigo-50 hover:text-indigo-700" disabled={versionActionLoading} onClick={() => restoreVersion(version)}>
                          <History className="mr-1.5 h-3.5 w-3.5" />{isEnglish ? 'Restore' : 'Ripristina'}
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* New Document Modal */}
        {documentToOpen && <DocumentOpenModal document={documentToOpen.document} onEdit={documentToOpen.onEdit} onClose={() => setDocumentToOpen(null)} isEnglish={isEnglish} />}
        {showNewModal && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
            <div className="bg-white rounded-lg p-6 w-full max-w-md mx-4 shadow-xl">
              <h3 className="text-lg font-semibold mb-2">{isEnglish ? 'Create new' : 'Crea nuovo'}</h3>
              <p className="text-sm text-gray-600 mb-4">
                {isEnglish ? 'Choose the type of content to create.' : 'Scegli il tipo di contenuto da creare.'}
              </p>
              <div className="flex flex-col gap-3">
                <Button
                  className="w-full justify-center bg-red-500 hover:bg-red-600 text-white"
                  onClick={() => {
                    createNewDocument()
                    setShowNewModal(false)
                  }}
                >
                  <FileText className="h-4 w-4 mr-2" />
                  {isEnglish ? 'New document' : 'Nuovo documento'}
                </Button>
                <Button
                  className="w-full justify-center bg-red-500 hover:bg-red-600 text-white"
                  onClick={() => {
                    createNewPresentation()
                    setShowNewModal(false)
                  }}
                >
                  <Monitor className="h-4 w-4 mr-2" />
                  {isEnglish ? 'New presentation' : 'Nuova presentazione'}
                </Button>
                <Button className="w-full justify-center bg-red-500 hover:bg-red-600 text-white" onClick={() => { createNewSheet(); setShowNewModal(false) }}>
                  <FileSpreadsheet className="h-4 w-4 mr-2" />{isEnglish ? 'Tables' : 'Tabelle'}
                </Button>
                <Button
                  className="w-full justify-center bg-red-500 hover:bg-red-600 text-white"
                  onClick={() => {
                    createNewCanvas()
                    setShowNewModal(false)
                  }}
                >
                  <PenTool className="h-4 w-4 mr-2" />
                  {isEnglish ? 'New board' : 'Nuova lavagna'}
                </Button>
              </div>
              <div className="flex justify-end mt-4">
                <Button variant="outline" onClick={() => setShowNewModal(false)}>{isEnglish ? 'Cancel' : 'Annulla'}</Button>
              </div>
            </div>
          </div>
        )}

        {/* Publish Modal */}
        {showPublishModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-full max-w-md mx-4 shadow-xl">
            <h3 className="text-lg font-semibold mb-4">{isEnglish ? 'Publish ' : 'Pubblica '}{mode === 'slides' ? (isEnglish ? 'Presentation' : 'Presentazione') : mode === 'sheet' ? (isEnglish ? 'Tables' : 'Tabelle') : mode === 'canvas' ? (isEnglish ? 'Board' : 'Lavagna') : (isEnglish ? 'Document' : 'Documento')}</h3>
            <p className="text-sm text-gray-600 mb-4">
              {isEnglish ? 'Save this content as an assignment or material for a class.' : 'Salva questo contenuto come compito/materiale per una classe.'}
            </p>
            <div className="mb-4">
              <label className="block text-sm font-medium mb-2">{isEnglish ? 'Select Session:' : 'Seleziona Sessione:'}</label>
              <select
                value={selectedSessionId}
                onChange={(e) => setSelectedSessionId(e.target.value)}
                className="w-full p-2 border rounded-md text-sm"
              >
                <option value="">{isEnglish ? '-- Select --' : '-- Seleziona --'}</option>
                {classesData?.map((session: any) => (
                  <option key={session.id} value={session.id}>
                    {session.name} - {session.class_name}
                  </option>
                ))}
              </select>
            </div>
            <div className="mb-4">
              <label className="block text-sm font-medium mb-2">{isEnglish ? 'Mode:' : 'Modalità:'}</label>
              <div className="flex gap-2">
                <button
                  onClick={() => setPublishMode('published')}
                  className={`text-xs px-3 py-1.5 rounded-full border ${publishMode === 'published' ? 'bg-violet-100 text-violet-700 border-violet-200 font-semibold' : 'text-slate-600 border-slate-200 hover:bg-slate-50'}`}
                >
                  {isEnglish ? 'Publish now' : 'Pubblica ora'}
                </button>
                <button
                  onClick={() => setPublishMode('draft')}
                  className={`text-xs px-3 py-1.5 rounded-full border ${publishMode === 'draft' ? 'bg-violet-100 text-violet-700 border-violet-200 font-semibold' : 'text-slate-600 border-slate-200 hover:bg-slate-50'}`}
                >
                  {isEnglish ? 'Save draft' : 'Salva bozza'}
                </button>
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setShowPublishModal(false)}>{isEnglish ? 'Cancel' : 'Annulla'}</Button>
              <Button onClick={handlePublish} disabled={!selectedSessionId}>
                {publishMode === 'published'
                  ? (isEnglish ? 'Publish now' : 'Pubblica ora')
                  : (isEnglish ? 'Save draft' : 'Salva bozza')}
              </Button>
            </div>
          </div>
        </div>
        )}
      </div>
    </>
  )
}
