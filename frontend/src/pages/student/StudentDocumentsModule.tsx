import { useState, useRef, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Bot, Copy, Layers, Plus, Save, Sparkles, Trash2, Monitor, FileText, ChevronLeft, ChevronRight, Send, CheckCircle, FileSpreadsheet, BookOpen, PenTool, Share2, User, Clock, MonitorPlay, Search, X, LayoutGrid, List
} from 'lucide-react'
import { studentApi, filesApi } from '@/lib/api'
import { useToast } from '@/components/ui/use-toast'
import { SlideEditor, SlideBlock, SlideBlockType, SlideSnapOptions, DEFAULT_SLIDE_SNAP_OPTIONS } from '@/components/SlideEditor'
import { createShapeBlock } from '@/lib/slideBlocks'
import { RichTextEditor } from '@/components/RichTextEditor'
import { UnifiedToolbar } from '@/components/UnifiedToolbar'
import { SheetChartConfig, SpreadsheetEditor } from '@/components/SpreadsheetEditor'
import { CollaborativeCanvas } from '@/components/CollaborativeCanvas'
import { Editor } from '@tiptap/react'
import { useTranslation } from 'react-i18next'
import DocumentAgentChat, { type DocumentAssistContext } from '@/components/documents/DocumentAgentChat'
import DocumentThumbnail from '@/components/documents/DocumentThumbnail'

// Types
type Format = 'a4' | '16:9' | '4:3'
type EditorMode = 'slides' | 'document' | 'sheet' | 'canvas' | 'pdf' | 'web'
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
  canvasContent?: string
  webUrl?: string
}

interface DraftDocument {
  id: string
  title: string
  type: 'presentation' | 'document' | 'sheet' | 'canvas'
  updatedAt: string
  contentJson: string
}

interface LessonDocument {
  id: string
  taskId: string
  title: string
  type: 'presentation' | 'document' | 'canvas' | 'pdf' | 'web'
  updatedAt: string
  contentJson: string
  authorName: string
  udaFolder?: string
  fileUrl?: string
  mimeType?: string
}

interface StudentTask {
  id: string
  title: string
  task_type: string
  content_json: string | null
  created_at: string
  author_name?: string
  uda_folder?: string
  submission?: {
    id: string
    content_json?: string | null
    submitted_at?: string
    correction?: DocumentCorrection | null
  } | null
}

interface DocumentCorrection {
  status: 'pending' | 'accepted'
  original_content_json: string
  suggested_content_json: string
  teacher_id?: string
  teacher_name?: string
  updated_at?: string
  accepted_at?: string
}

interface SubmittedDocument {
  id: string
  taskId: string
  submissionId: string
  title: string
  type: 'presentation' | 'document' | 'sheet' | 'canvas'
  updatedAt: string
  contentJson: string
  correction?: DocumentCorrection | null
}

interface PresentationTemplate {
  id: string
  name: string
  format: Format
  slides: Slide[]
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
  title: 'Grafico foglio',
  xCol: 0,
  yCol: 1,
  showRegression: true,
}
const DEFAULT_CANVAS_CONTENT = JSON.stringify({ type: 'canvas_v1', items: [] })
const PRESENTATION_TEMPLATE_STORAGE_KEY = 'student-presentation-templates:v1'
const isFullHtmlDocument = (value?: string | null) => {
  if (!value) return false
  const trimmed = value.trim().toLowerCase()
  return trimmed.startsWith('<!doctype html') || trimmed.startsWith('<html')
}

const cloneBlocks = (blocks: Block[]) =>
  blocks.map(block => ({ ...block, id: crypto.randomUUID(), style: { ...block.style } } as Block))

const cloneSlides = (slides: Slide[]) =>
  slides.map((slide, index) => ({
    ...slide,
    id: crypto.randomUUID(),
    title: slide.title || `Slide ${index + 1}`,
    blocks: cloneBlocks(slide.blocks || []),
  }))

interface StudentDocumentsModuleProps {
  sessionId: string
  openLessonTaskId?: string | null
  readOnlyCatalog?: boolean
}

export default function StudentDocumentsModule({ sessionId, openLessonTaskId, readOnlyCatalog = false }: StudentDocumentsModuleProps) {
  const { toast } = useToast()
  const { t, i18n } = useTranslation()
  const isEnglishUi = i18n.resolvedLanguage?.startsWith('en') ?? false
  const dateLocale = isEnglishUi ? 'en-GB' : 'it-IT'
  const defaultDocumentTitle = t('documents.default_document_title')
  const defaultPresentationTitle = t('documents.default_presentation_title')
  const filenamePlaceholder = t('documents.filename_placeholder')

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
  const [showSidebar, setShowSidebar] = useState(true)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [draftDocuments, setDraftDocuments] = useState<DraftDocument[]>([])
  const [lessonDocuments, setLessonDocuments] = useState<LessonDocument[]>([])
  const [submittedDocuments, setSubmittedDocuments] = useState<SubmittedDocument[]>([])
  const [docSearch, setDocSearch] = useState('')
  const [catalogRefreshKey, setCatalogRefreshKey] = useState(0)
  const [catalogViewMode, setCatalogViewMode] = useState<'grid' | 'list'>(() =>
    localStorage.getItem('student_documents_catalog_view') === 'list' ? 'list' : 'grid'
  )
  const [draftId, setDraftId] = useState<string | null>(null)
  const [isReadOnlyLesson, setIsReadOnlyLesson] = useState(false)
  const [activeLessonTaskId, setActiveLessonTaskId] = useState<string | null>(null)
  const [activeSubmittedDocument, setActiveSubmittedDocument] = useState<SubmittedDocument | null>(null)
  const [isCorrectionPreview, setIsCorrectionPreview] = useState(false)
  const [isAcceptingCorrection, setIsAcceptingCorrection] = useState(false)
  const isEditorReadOnly = isReadOnlyLesson || Boolean(activeSubmittedDocument)

  useEffect(() => {
    localStorage.setItem('student_documents_catalog_view', catalogViewMode)
  }, [catalogViewMode])

  // Editor State
  const [editor, setEditor] = useState<Editor | null>(null)

  // Slide Editor State
  const [currentSlideIndex, setCurrentSlideIndex] = useState(0)
  const [scale, setScale] = useState(1)
  const [mobileSlideScale, setMobileSlideScale] = useState(1)
  const [docScale, setDocScale] = useState(1)
  const [docMargins, setDocMargins] = useState({ vertical: 56, horizontal: 56 })
  const [documentPageCount, setDocumentPageCount] = useState(1)
  const [showRuledLines, setShowRuledLines] = useState(false)
  const [selectedBlockId, setSelectedBlockId] = useState<string | null>(null)
  const [snapOptions, setSnapOptions] = useState<SlideSnapOptions>(DEFAULT_SLIDE_SNAP_OPTIONS)

  // Refs
  const canvasRef = useRef<HTMLDivElement>(null)
  const mobileSlidesViewportRef = useRef<HTMLDivElement>(null)
  const documentPageRef = useRef<HTMLDivElement>(null)
  const toolbarHostRef = useRef<HTMLDivElement>(null)

  // UI State
  const [showSubmitModal, setShowSubmitModal] = useState(false)
  const [showNewModal, setShowNewModal] = useState(false)
  const [draggingMargin, setDraggingMargin] = useState<'left' | 'right' | null>(null)
  const [aiPanelAnchor, setAiPanelAnchor] = useState<{ x: number; y: number } | null>(null)
  const [viewMode, setViewMode] = useState<'list' | 'editor'>('list')
  const [presentationTemplates, setPresentationTemplates] = useState<PresentationTemplate[]>([])
  const [presentationChatOpen, setPresentationChatOpen] = useState(false)
  const [documentSelection, setDocumentSelection] = useState<{ from: number; to: number; text: string } | null>(null)

  const currentSlide = document.slides?.[currentSlideIndex] || { id: 'fallback', title: 'Slide', blocks: [] }
  const selectedBlock = currentSlide.blocks.find(b => b.id === selectedBlockId)
  const documentAssistContext: DocumentAssistContext | null = (() => {
    if (mode === 'document' && documentSelection) {
      return {
        id: `text-${documentSelection.from}-${documentSelection.to}-${documentSelection.text}`,
        kind: 'selected_text',
        label: isEnglishUi ? 'Selected text' : 'Testo selezionato',
        detail: documentSelection.text,
        target: { text: documentSelection.text, from: documentSelection.from, to: documentSelection.to },
        beforePreview: documentSelection.text,
      }
    }
    if (mode === 'slides' && selectedBlock) {
      const detail = selectedBlock.type === 'text'
        ? selectedBlock.content
        : selectedBlock.type === 'image'
          ? (isEnglishUi ? 'Selected image' : 'Immagine selezionata')
          : `${isEnglishUi ? 'Selected shape' : 'Forma selezionata'} (${selectedBlock.type})`
      return {
        id: `block-${currentSlideIndex}-${selectedBlock.id}`,
        kind: 'slide_block',
        label: isEnglishUi ? 'Slide object' : 'Oggetto della slide',
        detail,
        target: { block: selectedBlock, block_id: selectedBlock.id, slide_index: currentSlideIndex, slide_title: currentSlide.title },
        beforePreview: selectedBlock.content || selectedBlock.type,
      }
    }
    if (mode === 'slides') {
      return {
        id: `slide-${currentSlideIndex}-${currentSlide.id}`,
        kind: 'slide',
        label: isEnglishUi ? 'Current slide' : 'Slide corrente',
        detail: `${currentSlideIndex + 1}. ${currentSlide.title}`,
        target: { slide: currentSlide, slide_index: currentSlideIndex },
        beforePreview: `${currentSlide.title}\n${currentSlide.blocks.length} oggetti`,
      }
    }
    return null
  })()

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
    const clientContext = (proposal.client_context && typeof proposal.client_context === 'object')
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
        slides: current.slides.map((slide, index) => index === targetSlideIndex
          ? { ...replacement, id: slide.id }
          : slide),
      }))
      setSelectedBlockId(null)
    }
  }

  useEffect(() => {
    try {
      const raw = localStorage.getItem(PRESENTATION_TEMPLATE_STORAGE_KEY)
      if (!raw) return
      const parsed = JSON.parse(raw)
      if (Array.isArray(parsed)) setPresentationTemplates(parsed)
    } catch {
      setPresentationTemplates([])
    }
  }, [])

  const persistPresentationTemplates = (templates: PresentationTemplate[]) => {
    setPresentationTemplates(templates)
    localStorage.setItem(PRESENTATION_TEMPLATE_STORAGE_KEY, JSON.stringify(templates))
  }

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
    setSubmitted(false)
    setCurrentSlideIndex(0)
    setSelectedBlockId(null)
    setDraftId(null)
    setIsReadOnlyLesson(false)
    setActiveLessonTaskId(null)
    setActiveSubmittedDocument(null)
    setIsCorrectionPreview(false)
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
    setSubmitted(false)
    setCurrentSlideIndex(0)
    setSelectedBlockId(null)
    setDraftId(null)
    setIsReadOnlyLesson(false)
    setActiveLessonTaskId(null)
    setActiveSubmittedDocument(null)
    setIsCorrectionPreview(false)
    setViewMode('editor')
  }

  const upsertDraft = async (titleOverride?: string) => {
    const type = mode === 'slides' ? 'presentation' : mode === 'sheet' ? 'sheet' : mode === 'canvas' ? 'canvas' : 'document'
    const contentJson = JSON.stringify(
      mode === 'slides'
        ? { type: 'presentation_v2', format: document.format, slides: document.slides }
        : mode === 'sheet'
          ? { type: 'sheet_v1', data: document.sheetData || DEFAULT_SHEET_DATA, chart: document.sheetChart || DEFAULT_SHEET_CHART }
          : mode === 'canvas'
            ? JSON.parse(document.canvasContent || DEFAULT_CANVAS_CONTENT)
          : { type: 'document_v1', htmlContent: document.textContent || '', header: document.header, margins: docMargins }
    )
    try {
      if (draftId) {
        const res = await studentApi.updateDocumentDraft(draftId, {
          title: titleOverride ?? document.title,
          doc_type: type,
          content_json: contentJson
        })
        const updated: DraftDocument = {
          id: res.data.id,
          title: res.data.title,
          type: res.data.doc_type,
          updatedAt: res.data.updated_at,
          contentJson: res.data.content_json,
        }
        setDraftDocuments(prev => [updated, ...prev.filter(d => d.id !== updated.id)])
      } else {
        const res = await studentApi.createDocumentDraft({
          title: titleOverride ?? document.title,
          doc_type: type,
          content_json: contentJson
        })
        setDraftId(res.data.id)
        const created: DraftDocument = {
          id: res.data.id,
          title: res.data.title,
          type: res.data.doc_type,
          updatedAt: res.data.updated_at,
          contentJson: res.data.content_json,
        }
        setDraftDocuments(prev => [created, ...prev.filter(d => d.id !== created.id)])
      }
    } catch (e) {
      console.error('Draft save failed', e)
    }
  }

  const handleTitleChange = (value: string) => {
    if (isEditorReadOnly) return
    setDocument(d => ({ ...d, title: value }))
    upsertDraft(value)
  }

  const handleDeleteDraft = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation()
    try {
      await studentApi.deleteDocumentDraft(id)
      setDraftDocuments(prev => prev.filter(d => d.id !== id))
      if (draftId === id) {
        setDraftId(null)
        setViewMode('list')
      }
    } catch (e) {
      toast({ title: 'Errore durante l\'eliminazione', variant: 'destructive' })
    }
  }

  useEffect(() => {
    const refreshCatalog = () => setCatalogRefreshKey((value) => value + 1)
    window.addEventListener('golinelli:documents-refresh', refreshCatalog)
    return () => window.removeEventListener('golinelli:documents-refresh', refreshCatalog)
  }, [])

  useEffect(() => {
    const fetchSidebarDocuments = async () => {
      try {
        const [draftsRes, tasksRes, filesRes] = await Promise.all([
          studentApi.listDocumentDrafts(),
          studentApi.getTasks(),
          filesApi.listSessionFiles(sessionId),
        ])

        const drafts: DraftDocument[] = (draftsRes.data || []).map((d: any) => ({
          id: d.id,
          title: d.title,
          type: d.doc_type,
          updatedAt: d.updated_at,
          contentJson: d.content_json
        }))
        setDraftDocuments(drafts)

        const submitted: SubmittedDocument[] = ((tasksRes.data || []) as StudentTask[])
          .filter((task) => task.task_type === 'student_submission' && task.submission?.content_json)
          .reduce<SubmittedDocument[]>((acc, task) => {
            const submission = task.submission
            if (!submission?.content_json) return acc
            try {
              const parsed = JSON.parse(submission.content_json)
              const type: SubmittedDocument['type'] =
                parsed?.type === 'presentation_v2' || Array.isArray(parsed?.slides)
                  ? 'presentation'
                  : parsed?.type === 'sheet_v1' || Array.isArray(parsed?.data)
                    ? 'sheet'
                    : parsed?.type === 'canvas_v1' || Array.isArray(parsed?.items)
                      ? 'canvas'
                      : 'document'
              acc.push({
                id: `submission-${submission.id}`,
                taskId: task.id,
                submissionId: submission.id,
                title: task.title.replace(/^\[Studente\]\s*/i, ''),
                type,
                updatedAt: submission.submitted_at || task.created_at,
                contentJson: submission.content_json,
                correction: submission.correction,
              })
            } catch {
              // Ignore malformed submissions without breaking the document area.
            }
            return acc
          }, [])
          .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
        setSubmittedDocuments(submitted)

        const lessons: LessonDocument[] = ((tasksRes.data || []) as StudentTask[])
          .filter((task) => task.task_type === 'lesson' || task.task_type === 'presentation')
          .reduce<LessonDocument[]>((acc, task) => {
            if (!task.content_json) return acc
            try {
              const parsed = JSON.parse(task.content_json)
              const type: 'presentation' | 'document' | 'canvas' | null =
                parsed?.type === 'presentation_v2'
                  ? 'presentation'
                  : (parsed?.type === 'document_v1' ? 'document' : parsed?.type === 'canvas_v1' ? 'canvas' : null)
              if (!type) return acc
              const doc: LessonDocument = {
                id: `lesson-${task.id}`,
                taskId: task.id,
                title: task.title,
                type,
                updatedAt: task.created_at,
                contentJson: task.content_json,
                authorName: task.author_name || t('documents.author_teacher'),
              }
              if (task.uda_folder) doc.udaFolder = task.uda_folder
              acc.push(doc)
            } catch {
              // skip malformed
            }
            return acc
          }, [])
          .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())

        const sharedSessionDocs: LessonDocument[] = ((filesRes.data || []) as any[])
          .filter((file) => {
            const filename = String(file?.filename || '').toLowerCase()
            const mimeType = String(file?.mime_type || '').toLowerCase()
            return mimeType === 'application/pdf'
              || filename.endsWith('.pdf')
              || mimeType === 'text/html'
              || filename.endsWith('.html')
              || filename.endsWith('.htm')
          })
          .map((file) => {
            const filename = String(file.filename || 'Documento condiviso')
            const mimeType = String(file.mime_type || '')
            const isPdf = mimeType === 'application/pdf' || filename.toLowerCase().endsWith('.pdf')
            return {
              id: `shared-file-${file.id}`,
              taskId: `shared-file-${file.id}`,
              title: filename,
              type: (isPdf ? 'pdf' : 'web') as 'pdf' | 'web',
              updatedAt: file.created_at,
              contentJson: JSON.stringify(
                isPdf
                  ? { type: 'pdf_v1', url: file.url, mimeType: file.mime_type, filename: file.filename }
                  : { type: 'html_v1', url: file.url, mimeType: file.mime_type, filename: file.filename }
              ),
              authorName: file.owner_type === 'teacher' ? t('documents.author_teacher') : t('documents.author_class'),
              fileUrl: file.url,
              mimeType: file.mime_type,
            }
          })

        setLessonDocuments([...sharedSessionDocs, ...lessons].sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()))
      } catch (e) {
        console.error('Failed to load document sidebar data', e)
      }
    }
    fetchSidebarDocuments()
  }, [sessionId, catalogRefreshKey])

  useEffect(() => {
    if (viewMode !== 'editor') return
    if (isEditorReadOnly) return
    if (mode === 'canvas') return
    if (!draftId) {
      const html = document.textContent || ''
      const stripped = html.replace(/<[^>]*>/g, '').trim()
      const isEmpty =
        mode === 'document' ? stripped.length === 0 :
        mode === 'slides' ? document.slides.every(s => !s.blocks || s.blocks.length === 0) :
        false
      if (isEmpty) return
    }
    const timer = setTimeout(() => {
      upsertDraft()
    }, 400)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [document, mode, docMargins, isEditorReadOnly, viewMode])

  const loadDocumentFromJson = (
    doc: { id: string; title: string; type: 'presentation' | 'document' | 'sheet' | 'canvas' | 'pdf' | 'web'; contentJson: string },
    options?: { readOnlyLesson?: boolean; lessonTaskId?: string | null; submittedDocument?: SubmittedDocument | null }
  ) => {
    try {
      const content = JSON.parse(doc.contentJson)
      const externalReadOnly = Boolean(options?.readOnlyLesson || options?.submittedDocument)
      setIsReadOnlyLesson(Boolean(options?.readOnlyLesson))
      setActiveLessonTaskId(options?.lessonTaskId || null)
      setActiveSubmittedDocument(options?.submittedDocument || null)

      if (doc.type === 'pdf' || content.type === 'pdf_v1') {
        setMode('pdf')
        setDraftId(null)
        setDocument({
          id: doc.id,
          title: doc.title,
          format: 'a4',
          slides: [],
          textContent: content.url || '',
          header: { title: '', subtitle: '', logoUrl: '' },
          sheetData: DEFAULT_SHEET_DATA,
          sheetChart: DEFAULT_SHEET_CHART,
          canvasContent: DEFAULT_CANVAS_CONTENT,
          webUrl: '',
        })
      } else if (doc.type === 'web' || content.type === 'html_v1' || isFullHtmlDocument(content.htmlContent) || isFullHtmlDocument(content.content)) {
        setMode('web')
        setDraftId(null)
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
        })
      } else if (doc.type === 'presentation' || content.type === 'presentation_v2' || content.slides) {
        setMode('slides')
        setDraftId(externalReadOnly ? null : doc.id)
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
        })
        setCurrentSlideIndex(0)
        setSelectedBlockId(null)
      } else if (doc.type === 'sheet' || content.type === 'sheet_v1' || content.data) {
        setMode('sheet')
        setDraftId(externalReadOnly ? null : doc.id)
        setDocument({
          id: doc.id,
          title: doc.title,
          format: 'a4',
          slides: [],
          textContent: '',
          sheetData: Array.isArray(content.data) ? content.data : DEFAULT_SHEET_DATA,
          sheetChart: content.chart || DEFAULT_SHEET_CHART,
          canvasContent: DEFAULT_CANVAS_CONTENT,
          webUrl: '',
        })
      } else if (doc.type === 'canvas' || content.type === 'canvas_v1' || content.items) {
        setIsReadOnlyLesson(Boolean(options?.readOnlyLesson))
        setMode('canvas')
        setDraftId(externalReadOnly ? null : doc.id)
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
        })
      } else {
        setMode('document')
        setDraftId(externalReadOnly ? null : doc.id)
        if (content.margins) {
          setDocMargins({
            vertical: content.margins.vertical ?? content.margins.top ?? 56,
            horizontal: content.margins.horizontal ?? content.margins.left ?? 56
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
        })
      }
      setViewMode('editor')
    } catch (e) {
      console.error(e)
    }
  }

  const loadDraft = (doc: DraftDocument) => {
    setIsCorrectionPreview(false)
    loadDocumentFromJson(doc, { readOnlyLesson: false, lessonTaskId: null, submittedDocument: null })
  }

  const loadLesson = (doc: LessonDocument) => {
    loadDocumentFromJson(
      {
        id: doc.id,
        title: doc.title,
        type: doc.type,
        contentJson: doc.contentJson,
      },
      { readOnlyLesson: true, lessonTaskId: doc.taskId, submittedDocument: null }
    )
  }

  const loadSubmittedDocument = (doc: SubmittedDocument, previewCorrection = false) => {
    const pendingCorrection = doc.correction?.status === 'pending' ? doc.correction : null
    const contentJson = previewCorrection && pendingCorrection
      ? pendingCorrection.suggested_content_json
      : doc.contentJson
    setIsCorrectionPreview(previewCorrection && Boolean(pendingCorrection))
    loadDocumentFromJson(
      { id: doc.id, title: doc.title, type: doc.type, contentJson },
      { readOnlyLesson: false, lessonTaskId: null, submittedDocument: doc }
    )
  }

  const acceptActiveCorrection = async () => {
    const active = activeSubmittedDocument
    if (!active || active.correction?.status !== 'pending' || isAcceptingCorrection) return
    setIsAcceptingCorrection(true)
    try {
      const response = await studentApi.acceptDocumentCorrection(active.submissionId)
      const acceptedContent = response.data.content_json || active.correction.suggested_content_json
      const updated: SubmittedDocument = {
        ...active,
        contentJson: acceptedContent,
        correction: response.data.correction || { ...active.correction, status: 'accepted' },
      }
      setSubmittedDocuments(previous => previous.map(item => item.submissionId === updated.submissionId ? updated : item))
      loadSubmittedDocument(updated, false)
      toast({
        title: isEnglishUi ? 'Corrections accepted' : 'Correzioni accettate',
        description: isEnglishUi ? 'Your submitted document now includes the teacher changes.' : 'La consegna ora include le modifiche del docente.',
      })
    } catch (error) {
      console.error('Correction acceptance failed', error)
      toast({ title: isEnglishUi ? 'Unable to accept corrections' : 'Impossibile accettare le correzioni', variant: 'destructive' })
    } finally {
      setIsAcceptingCorrection(false)
    }
  }

  useEffect(() => {
    if (!openLessonTaskId) return
    const target = lessonDocuments.find((doc) => doc.taskId === openLessonTaskId)
    if (target) {
      setShowSidebar(true)
      loadLesson(target)
    }
  }, [openLessonTaskId, lessonDocuments])

  // Fit canvas
  useEffect(() => {
    const handleResize = () => {
      if (mode === 'slides' && canvasRef.current) {
        const parent = canvasRef.current.parentElement
        if (parent) {
          if (parent.clientWidth <= 64 || parent.clientHeight <= 64) return
          const dims = FORMAT_DIMENSIONS[document.format]
          const scaleX = (parent.clientWidth - 64) / dims.width
          const scaleY = (parent.clientHeight - 64) / dims.height
          setScale(Math.max(0.1, Math.min(scaleX, scaleY, 1)))
        }
      }
    }
    window.addEventListener('resize', handleResize)
    handleResize()
    return () => window.removeEventListener('resize', handleResize)
  }, [document.format, mode, showSidebar, presentationChatOpen])

  useEffect(() => {
    if (!readOnlyCatalog || viewMode !== 'editor' || mode !== 'slides') return
    const viewport = mobileSlidesViewportRef.current
    if (!viewport) return

    const updateMobileSlideScale = () => {
      const availableWidth = viewport.clientWidth - 18
      if (availableWidth <= 0) return
      const slideWidth = FORMAT_DIMENSIONS[document.format].width
      setMobileSlideScale(Math.max(0.1, Math.min(availableWidth / slideWidth, 1)))
    }

    updateMobileSlideScale()
    const observer = new ResizeObserver(updateMobileSlideScale)
    observer.observe(viewport)
    return () => observer.disconnect()
  }, [document.format, mode, readOnlyCatalog, viewMode])

  const addSlide = () => {
    const newSlide: Slide = {
      id: crypto.randomUUID(),
      title: `Slide ${document.slides.length + 1}`,
      blocks: []
    }
    setDocument(prev => ({ ...prev, slides: [...prev.slides, newSlide] }))
    setCurrentSlideIndex(document.slides.length)
  }

  const deleteSlide = (index: number) => {
    if (document.slides.length <= 1) return
    const newSlides = document.slides.filter((_, i) => i !== index)
    setDocument(prev => ({ ...prev, slides: newSlides }))
    if (currentSlideIndex >= index && currentSlideIndex > 0) {
      setCurrentSlideIndex(currentSlideIndex - 1)
    }
  }

  const duplicateSlide = (index: number) => {
    const source = document.slides[index]
    if (!source) return
    const copy: Slide = {
      id: crypto.randomUUID(),
      title: `${source.title || `Slide ${index + 1}`} copia`,
      blocks: cloneBlocks(source.blocks || []),
      backgroundColor: source.backgroundColor,
    }
    const nextSlides = [...document.slides]
    nextSlides.splice(index + 1, 0, copy)
    setDocument(prev => ({ ...prev, slides: nextSlides }))
    setCurrentSlideIndex(index + 1)
    setSelectedBlockId(null)
  }

  const updateSlideBlocks = (blocks: Block[]) => {
    const newSlides = [...document.slides]
    newSlides[currentSlideIndex] = { ...newSlides[currentSlideIndex], blocks }
    setDocument(prev => ({ ...prev, slides: newSlides }))
  }

  const addSlideBlock = (type: SlideBlockType, position?: { x: number; y: number }) => {
    const dims = FORMAT_DIMENSIONS[document.format]
    let newBlock: Block
    if (type === 'text') {
      newBlock = {
        id: crypto.randomUUID(),
        type: 'text',
        content: isEnglishUi ? 'New Text' : 'Nuovo Testo',
        x: position ? Math.min(position.x, dims.width - 220) : dims.width / 2 - 100,
        y: position ? Math.min(position.y, dims.height - 120) : dims.height / 2 - 50,
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
        content: `https://placehold.co/400x300?text=${encodeURIComponent(isEnglishUi ? 'Image' : 'Immagine')}`,
        x: position ? Math.min(position.x, dims.width - 220) : dims.width / 2 - 100,
        y: position ? Math.min(position.y, dims.height - 320) : dims.height / 2 - 150,
        width: 200,
        height: 300,
        style: {}
      }
    } else {
      newBlock = createShapeBlock(type, dims)
      if (position) {
        newBlock = {
          ...newBlock,
          x: Math.min(position.x, dims.width - newBlock.width),
          y: Math.min(position.y, dims.height - newBlock.height),
        }
      }
    }
    updateSlideBlocks([...currentSlide.blocks, { ...newBlock, zIndex: currentSlide.blocks.length }])
    setSelectedBlockId(newBlock.id)
  }

  const moveSelectedBlockLayer = (action: 'front' | 'back' | 'forward' | 'backward') => {
    if (!selectedBlockId) return
    const ordered = currentSlide.blocks
      .map((block, index) => ({ block, index }))
      .sort((a, b) => (a.block.zIndex ?? a.index) - (b.block.zIndex ?? b.index))
      .map(({ block }) => block)
    const index = ordered.findIndex(block => block.id === selectedBlockId)
    if (index < 0) return
    const [block] = ordered.splice(index, 1)
    const targetIndex =
      action === 'front' ? ordered.length :
      action === 'back' ? 0 :
      action === 'forward' ? Math.min(ordered.length, index + 1) :
      Math.max(0, index - 1)
    ordered.splice(targetIndex, 0, block)
    updateSlideBlocks(ordered.map((block, layerIndex) => ({ ...block, zIndex: layerIndex })))
  }

  const saveCurrentPresentationAsTemplate = () => {
    if (mode !== 'slides' || isEditorReadOnly) return
    const name = window.prompt(isEnglishUi ? 'Template name' : 'Nome template', document.title || defaultPresentationTitle)
    if (!name?.trim()) return
    const template: PresentationTemplate = {
      id: crypto.randomUUID(),
      name: name.trim(),
      format: document.format,
      slides: cloneSlides(document.slides || []),
    }
    persistPresentationTemplates([template, ...presentationTemplates])
    toast({ title: isEnglishUi ? 'Template saved' : 'Template salvato' })
  }

  const applyPresentationTemplate = (templateId: string) => {
    const template = presentationTemplates.find(item => item.id === templateId)
    if (!template) return
    setDocument(prev => ({
      ...prev,
      format: template.format,
      slides: cloneSlides(template.slides),
    }))
    setMode('slides')
    setCurrentSlideIndex(0)
    setSelectedBlockId(null)
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

  const updateBlockStyle = (key: string, value: unknown) => {
    if (!selectedBlockId) return
    const newBlocks = currentSlide.blocks.map(b => {
      if (b.id !== selectedBlockId) return b
      if (key === 'rotation') return { ...b, rotation: value as number }
      // `key` is a dynamic string (toolbar only ever passes a key valid for the selected block's
      // own type), so TS can't narrow the resulting style shape back to the union member — safe cast.
      return { ...b, style: { ...b.style, [key]: value } } as Block
    })
    updateSlideBlocks(newBlocks)
  }

  // Submit document to teacher
  const handleSubmit = async () => {
    if (isEditorReadOnly) return
    setIsSubmitting(true)
    try {
      let contentJson = ""

      if (mode === 'slides') {
        contentJson = JSON.stringify({
          type: 'student_presentation',
          format: document.format,
          title: document.title,
          slides: document.slides.map(s => ({
            id: s.id,
            title: s.title,
            blocks: s.blocks
          }))
        })
      } else if (mode === 'sheet') {
        contentJson = JSON.stringify({
          type: 'student_sheet',
          title: document.title,
          data: document.sheetData || DEFAULT_SHEET_DATA,
          chart: document.sheetChart || DEFAULT_SHEET_CHART,
        })
      } else if (mode === 'canvas') {
        contentJson = JSON.stringify({
          type: 'student_canvas',
          title: document.title,
          ...JSON.parse(document.canvasContent || DEFAULT_CANVAS_CONTENT),
        })
      } else {
        contentJson = JSON.stringify({
          type: 'student_document',
          title: document.title,
          htmlContent: document.textContent,
          header: document.header,
          margins: docMargins
        })
      }

      // Submit as a student work/task submission
      await studentApi.submitDocument({
        title: document.title,
        content_type: mode === 'slides' ? 'presentation' : mode === 'sheet' ? 'sheet' : mode === 'canvas' ? 'canvas' : 'document',
        content_json: contentJson
      })

      setShowSubmitModal(false)
      setSubmitted(true)
      toast({
        title: "Documento inviato!",
        description: t('documents.sent_body'),
        className: "bg-green-500 text-white"
      })
    } catch (e) {
      console.error('Submit error:', e)
      toast({ title: "Errore invio", description: "Impossibile inviare il documento. Riprova.", variant: "destructive" })
    } finally {
      setIsSubmitting(false)
    }
  }

  const resetDocument = () => {
    createNewDocument()
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
  }, [mode, showSidebar])

  if (viewMode === 'list') {
    const fuzzyMatch = (query: string, ...fields: string[]) => {
      if (!query.trim()) return true
      const terms = query.toLowerCase().split(/\s+/).filter(Boolean)
      const target = fields.join(' ').toLowerCase()
      return terms.every(term => target.includes(term))
    }
    const filteredDrafts = readOnlyCatalog ? [] : draftDocuments.filter(d => fuzzyMatch(docSearch, d.title, d.type))
    const filteredSubmitted = submittedDocuments.filter(d => fuzzyMatch(docSearch, d.title, d.type, d.correction?.teacher_name || ''))
    const filteredLessons = lessonDocuments.filter(d => fuzzyMatch(docSearch, d.title, d.type, d.authorName || ''))
    const docIcon = (type: string) => {
      if (type === 'presentation') return <Monitor className="h-5 w-5" />
      if (type === 'web') return <MonitorPlay className="h-5 w-5" />
      if (type === 'sheet') return <FileSpreadsheet className="h-5 w-5" />
      if (type === 'canvas') return <PenTool className="h-5 w-5" />
      return <FileText className="h-5 w-5" />
    }
    const docColor = (type: string) => {
      if (type === 'presentation') return 'border border-indigo-200 bg-indigo-100 text-indigo-800'
      if (type === 'web') return 'border border-fuchsia-200 bg-fuchsia-100 text-fuchsia-800'
      if (type === 'sheet') return 'border border-sky-200 bg-sky-100 text-sky-800'
      if (type === 'canvas') return 'border border-amber-200 bg-amber-100 text-amber-800'
      return 'border border-emerald-200 bg-emerald-100 text-emerald-800'
    }
    const docCardStyle = (type: string) => {
      if (type === 'presentation') return 'border-[rgba(123,105,201,0.18)] bg-[rgba(123,105,201,0.075)] hover:border-[rgba(123,105,201,0.30)] hover:bg-[rgba(123,105,201,0.11)]'
      if (type === 'web') return 'border-[rgba(254,0,77,0.18)] bg-[rgba(254,0,77,0.075)] hover:border-[rgba(254,0,77,0.28)] hover:bg-[rgba(254,0,77,0.11)]'
      if (type === 'sheet') return 'border-[rgba(62,169,244,0.18)] bg-[rgba(62,169,244,0.075)] hover:border-[rgba(62,169,244,0.30)] hover:bg-[rgba(62,169,244,0.11)]'
      if (type === 'canvas') return 'border-[rgba(123,105,201,0.18)] bg-[rgba(123,105,201,0.075)] hover:border-[rgba(123,105,201,0.30)] hover:bg-[rgba(123,105,201,0.11)]'
      return 'border-[rgba(62,169,244,0.18)] bg-[rgba(62,169,244,0.075)] hover:border-[rgba(62,169,244,0.30)] hover:bg-[rgba(62,169,244,0.11)]'
    }
    const docBadge = (type: string) => {
      if (type === 'presentation') return 'border-indigo-200 bg-indigo-100 text-indigo-800'
      if (type === 'web') return 'border-fuchsia-200 bg-fuchsia-100 text-fuchsia-800'
      if (type === 'sheet') return 'border-sky-200 bg-sky-100 text-sky-800'
      if (type === 'canvas') return 'border-amber-200 bg-amber-100 text-amber-800'
      return 'border-emerald-200 bg-emerald-100 text-emerald-800'
    }
    const docLabel = (type: string) => {
      if (type === 'presentation') return 'Slide'
      if (type === 'sheet') return 'Sheet'
      if (type === 'canvas') return 'Canvas'
      if (type === 'web') return 'Web'
      return 'Doc'
    }
    return (
      <>
        <div className="h-full flex flex-col bg-slate-100 overflow-hidden">
          <section className="relative shrink-0 border-b border-slate-200/80 bg-white/90 backdrop-blur-sm shadow-sm">
            <div className="mx-auto max-w-6xl px-4 py-7 md:px-6">
              <div className="mx-auto max-w-3xl text-center">
                <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-emerald-700">Documenti</p>
                <h1 className="mt-2 text-3xl font-black tracking-tight text-slate-950">{t('documents.title_my_documents')}</h1>
                <p className="mx-auto mt-3 max-w-2xl text-sm leading-6 text-slate-600">
                  {readOnlyCatalog
                    ? (isEnglishUi ? 'Teacher materials and submitted work, in read-only mode' : 'Materiali del docente e consegne, in sola lettura')
                    : (isEnglishUi ? 'Drafts, teacher materials, and deliverables' : 'Bozze, materiali del docente e consegne')}
                </p>
                <label className="mx-auto mt-6 flex max-w-xl items-center gap-2 rounded-2xl border border-slate-300 bg-white px-4 py-2.5 shadow-sm">
                  <Search className="h-4 w-4 shrink-0 text-slate-400" />
                  <input
                    type="text"
                    value={docSearch}
                    onChange={e => setDocSearch(e.target.value)}
                    placeholder={isEnglishUi ? 'Search documents...' : 'Cerca documenti...'}
                    className="min-w-0 flex-1 bg-transparent text-sm font-medium text-slate-700 placeholder:text-slate-400 focus:outline-none"
                  />
                  {docSearch && (
                    <button onClick={() => setDocSearch('')} className="rounded-full p-1 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600">
                      <X className="h-3.5 w-3.5" />
                    </button>
                  )}
                </label>
                <div className="mx-auto mt-3 flex w-fit items-center rounded-xl border border-slate-200 bg-white p-0.5 shadow-sm" role="group" aria-label={isEnglishUi ? 'Document view' : 'Vista documenti'}>
                  <button type="button" onClick={() => setCatalogViewMode('grid')} aria-pressed={catalogViewMode === 'grid'} title={isEnglishUi ? 'Grid view' : 'Vista griglia'} className={`flex h-8 w-8 items-center justify-center rounded-lg ${catalogViewMode === 'grid' ? 'bg-emerald-100 text-emerald-800' : 'text-slate-400 hover:bg-slate-50'}`}><LayoutGrid className="h-4 w-4" /></button>
                  <button type="button" onClick={() => setCatalogViewMode('list')} aria-pressed={catalogViewMode === 'list'} title={isEnglishUi ? 'List view' : 'Vista elenco'} className={`flex h-8 w-8 items-center justify-center rounded-lg ${catalogViewMode === 'list' ? 'bg-emerald-100 text-emerald-800' : 'text-slate-400 hover:bg-slate-50'}`}><List className="h-4 w-4" /></button>
                </div>
                {!readOnlyCatalog && (
                  <div className="mx-auto mt-6 grid max-w-2xl gap-3 sm:grid-cols-2">
                    <button
                      type="button"
                      onClick={createNewDocument}
                      className="group flex min-h-[92px] items-center gap-4 rounded-2xl border border-sky-200 bg-sky-50/80 p-4 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-sky-300 hover:bg-sky-100/80 hover:shadow-md"
                    >
                      <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-white text-sky-700 shadow-sm"><FileText className="h-6 w-6" /></span>
                      <span className="min-w-0">
                        <span className="block text-sm font-black text-slate-950">{isEnglishUi ? 'New document' : 'Nuovo documento'}</span>
                        <span className="mt-1 block text-xs leading-5 text-slate-600">{isEnglishUi ? 'Write pages, reports and handouts.' : 'Scrivi pagine, relazioni e dispense.'}</span>
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={createNewPresentation}
                      className="group flex min-h-[92px] items-center gap-4 rounded-2xl border border-violet-200 bg-violet-50/80 p-4 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-violet-300 hover:bg-violet-100/80 hover:shadow-md"
                    >
                      <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-white text-violet-700 shadow-sm"><MonitorPlay className="h-6 w-6" /></span>
                      <span className="min-w-0">
                        <span className="block text-sm font-black text-slate-950">{isEnglishUi ? 'New presentation' : 'Nuova presentazione'}</span>
                        <span className="mt-1 block text-xs leading-5 text-slate-600">{isEnglishUi ? 'Create editable slides directly here.' : 'Crea slide modificabili direttamente qui.'}</span>
                      </span>
                    </button>
                  </div>
                )}
              </div>
            </div>
          </section>

          <div className="flex-1 overflow-y-auto px-4 pb-8 pt-5 md:px-6">
            <div className="mx-auto w-full max-w-6xl space-y-8">

              {docSearch && filteredDrafts.length === 0 && filteredSubmitted.length === 0 && filteredLessons.length === 0 && (
                <p className="text-center text-sm text-slate-400 py-12">
                  {isEnglishUi ? `No document matches "${docSearch}"` : `Nessun documento corrisponde a "${docSearch}"`}
                </p>
              )}

              {!docSearch && (!readOnlyCatalog ? draftDocuments.length === 0 : true) && submittedDocuments.length === 0 && lessonDocuments.length === 0 && (
                <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-slate-300 bg-white px-6 py-20 text-center shadow-sm">
                  <div className="w-20 h-20 rounded-xl border border-emerald-200 bg-emerald-100 flex items-center justify-center mb-5 shadow-sm">
                    <FileText className="h-10 w-10 text-emerald-800" />
                  </div>
                  <h3 className="text-lg font-black text-slate-950 mb-1">{isEnglishUi ? 'No documents yet' : 'Nessun documento'}</h3>
                  <p className={`text-sm text-slate-500 ${readOnlyCatalog ? '' : 'mb-6'}`}>{readOnlyCatalog ? (isEnglishUi ? 'Teacher materials will appear here.' : 'I materiali condivisi dal docente appariranno qui.') : (isEnglishUi ? 'Create a document or a slide presentation to get started.' : 'Crea un documento oppure una presentazione per iniziare.')}</p>
                  {!readOnlyCatalog && <Button tone="neutral" surface="solid" onClick={() => setShowNewModal(true)}>
                    <Plus className="h-4 w-4 mr-2" />
                    {isEnglishUi ? 'Choose what to create' : 'Scegli cosa creare'}
                  </Button>}
                </div>
              )}

              {filteredDrafts.length > 0 && (
                <section>
                  <div className="mb-3 flex items-center justify-between">
                    <h2 className="text-[11px] font-black uppercase tracking-[0.18em] text-slate-600">{t('documents.my_drafts')}</h2>
                    <span className="rounded-full border border-emerald-200 bg-emerald-100 px-2 py-0.5 text-[10px] font-black text-emerald-800">{filteredDrafts.length}</span>
                  </div>
                  <div className={catalogViewMode === 'grid' ? 'grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4' : 'flex flex-col gap-2'}>
                    {filteredDrafts.map(doc => (
                      <div
                        key={doc.id}
                        onClick={() => loadDraft(doc)}
                        className={`group relative cursor-pointer overflow-hidden border shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-lg ${catalogViewMode === 'grid' ? 'rounded-[18px] border-slate-200 bg-white p-2' : `grid min-h-[64px] grid-cols-[36px_minmax(0,1fr)_auto_28px] grid-rows-2 items-center gap-x-3 rounded-xl px-3 py-2 ${docCardStyle(doc.type)}`}`}
                      >
                        {catalogViewMode === 'grid' && <DocumentThumbnail contentJson={doc.contentJson} type={doc.type} title={doc.title} />}
                        {catalogViewMode === 'list' && <div className={`col-start-1 row-span-2 row-start-1 flex h-9 w-9 items-center justify-center rounded-lg shadow-sm ${docColor(doc.type)}`}>{docIcon(doc.type)}</div>}
                        <span className={`${catalogViewMode === 'grid' ? 'absolute left-4 top-4' : 'col-start-3 row-span-2 row-start-1 self-center'} rounded-full border px-2.5 py-1 text-[10px] font-black shadow-sm ${docBadge(doc.type)}`}>{docLabel(doc.type)}</span>
                        <p className={`${catalogViewMode === 'grid' ? 'mb-1 mt-2.5 px-1' : 'col-start-2 row-start-1 self-end'} truncate text-sm font-black text-slate-950`}>{doc.title}</p>
                        <p className={`${catalogViewMode === 'grid' ? 'px-1 pb-1' : 'col-start-2 row-start-2 self-start'} text-[11px] font-medium text-slate-500`}>{new Date(doc.updatedAt).toLocaleDateString(dateLocale, { day: 'numeric', month: 'short', year: 'numeric' })}</p>
                        <button
                          onClick={(e) => handleDeleteDraft(e, doc.id)}
                          className={`${catalogViewMode === 'grid' ? 'absolute right-4 top-4 bg-white/90 opacity-0 shadow-sm group-hover:opacity-100' : 'col-start-4 row-span-2 row-start-1 opacity-70'} rounded-lg p-1 text-slate-400 transition-all hover:bg-red-50 hover:text-red-600`}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                </section>
              )}

              {filteredSubmitted.length > 0 && (
                <section>
                  <div className="mb-3 flex items-center justify-between">
                    <h2 className="text-[11px] font-black uppercase tracking-[0.18em] text-slate-600">
                      {isEnglishUi ? 'Submitted work' : 'Le mie consegne'}
                    </h2>
                    <span className="rounded-full border border-amber-200 bg-amber-100 px-2 py-0.5 text-[10px] font-black text-amber-800">{filteredSubmitted.length}</span>
                  </div>
                  <div className={catalogViewMode === 'grid' ? 'grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4' : 'flex flex-col gap-2'}>
                    {filteredSubmitted.map(doc => {
                      const hasCorrection = doc.correction?.status === 'pending'
                      return (
                        <div
                          key={doc.id}
                          onClick={() => loadSubmittedDocument(doc)}
                          className={`group relative cursor-pointer overflow-hidden border shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-lg ${catalogViewMode === 'grid' ? `rounded-[18px] bg-white p-2 ${hasCorrection ? 'border-amber-300' : 'border-slate-200'}` : `grid min-h-[64px] grid-cols-[36px_minmax(0,1fr)_auto_auto] grid-rows-2 items-center gap-x-3 rounded-xl px-3 py-2 ${hasCorrection ? 'border-amber-300 bg-amber-50 hover:bg-amber-100/70' : docCardStyle(doc.type)}`}`}
                        >
                          {catalogViewMode === 'grid' && <DocumentThumbnail contentJson={doc.contentJson} type={doc.type} title={doc.title} />}
                          {catalogViewMode === 'list' && <div className={`col-start-1 row-span-2 row-start-1 flex h-9 w-9 items-center justify-center rounded-lg shadow-sm ${hasCorrection ? 'border border-amber-300 bg-amber-200 text-amber-900' : docColor(doc.type)}`}>{docIcon(doc.type)}</div>}
                          <span className={`${catalogViewMode === 'grid' ? 'absolute right-4 top-4 shadow-sm' : 'col-start-4 row-span-2 row-start-1 self-center'} rounded-full border px-2.5 py-1 text-[10px] font-black ${hasCorrection ? 'border-amber-300 bg-amber-200 text-amber-900' : docBadge(doc.type)}`}>
                            {hasCorrection ? (isEnglishUi ? 'Corrections' : 'Correzioni') : docLabel(doc.type)}
                          </span>
                          <p className={`${catalogViewMode === 'grid' ? 'mb-1 mt-2.5 px-1' : 'col-start-2 row-start-1 self-end'} truncate text-sm font-black text-slate-950`}>{doc.title}</p>
                          <p className={`${catalogViewMode === 'grid' ? 'px-1' : 'col-start-2 row-start-2 self-start'} text-[11px] font-medium text-slate-500`}>{new Date(doc.updatedAt).toLocaleDateString(dateLocale, { day: 'numeric', month: 'short', year: 'numeric' })}</p>
                          <div className={`${catalogViewMode === 'grid' ? 'mx-1 mb-1 mt-2 inline-flex' : 'col-start-3 row-span-2 row-start-1 hidden self-center sm:inline-flex'} items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-black ${hasCorrection ? 'border-amber-300 bg-amber-200 text-amber-900' : 'border-slate-200 bg-white/80 text-slate-600'}`}>
                            {hasCorrection ? <Sparkles className="h-3 w-3" /> : <CheckCircle className="h-3 w-3" />}
                            {hasCorrection ? (isEnglishUi ? 'Review requested' : 'Da revisionare') : (isEnglishUi ? 'Submitted' : 'Consegnato')}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </section>
              )}

              {filteredLessons.length > 0 && (() => {
                const LessonCard = ({ doc }: { doc: LessonDocument }) => (
                  <div
                    key={doc.id}
                    onClick={() => loadLesson(doc)}
                    className={`group relative cursor-pointer overflow-hidden border shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-lg ${catalogViewMode === 'grid' ? 'rounded-[18px] border-slate-200 bg-white p-2' : `grid min-h-[64px] grid-cols-[36px_minmax(0,1fr)_auto_auto] grid-rows-2 items-center gap-x-3 rounded-xl px-3 py-2 ${docCardStyle(doc.type)}`}`}
                  >
                    {catalogViewMode === 'grid' && <DocumentThumbnail contentJson={doc.contentJson} type={doc.type} title={doc.title} />}
                    {catalogViewMode === 'list' && <div className={`col-start-1 row-span-2 row-start-1 flex h-9 w-9 items-center justify-center rounded-lg shadow-sm ${docColor(doc.type)}`}>{docIcon(doc.type)}</div>}
                    <span className={`${catalogViewMode === 'grid' ? 'absolute right-4 top-4 shadow-sm' : 'col-start-4 row-span-2 row-start-1 self-center'} rounded-full border px-2.5 py-1 text-[10px] font-black ${docBadge(doc.type)}`}>{docLabel(doc.type)}</span>
                    <p className={`${catalogViewMode === 'grid' ? 'mb-1 mt-2.5 px-1' : 'col-start-2 row-start-1 self-end'} truncate text-sm font-black text-slate-950`}>{doc.title}</p>
                    <p className={`${catalogViewMode === 'grid' ? 'px-1' : 'col-start-2 row-start-2 self-start truncate'} text-[11px] font-medium text-slate-500`}>{doc.authorName} · {new Date(doc.updatedAt).toLocaleDateString(dateLocale, { day: 'numeric', month: 'short', year: 'numeric' })}</p>
                    <div className={`${catalogViewMode === 'grid' ? 'mx-1 mb-1 mt-2 inline-flex' : 'col-start-3 row-span-2 row-start-1 hidden self-center sm:inline-flex'} items-center gap-1 rounded-full border border-emerald-200 bg-emerald-100 px-2 py-0.5 text-[10px] font-black text-emerald-800`}>
                      <BookOpen className="h-3 w-3" />
                      {t('documents.read_only')}
                    </div>
                  </div>
                )
                return (
                  <section>
                    <h2 className="mb-3 text-[11px] font-black uppercase tracking-[0.18em] text-slate-600">{t('documents.teacher_materials')}</h2>
                    <div className={catalogViewMode === 'grid' ? 'grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4' : 'flex flex-col gap-2'}>
                      {filteredLessons.map(doc => <LessonCard key={doc.id} doc={doc} />)}
                    </div>
                  </section>
                )
              })()}
            </div>
          </div>
        </div>

        {!readOnlyCatalog && showNewModal && (
          <div className="fixed inset-0 bg-slate-950/60 flex items-center justify-center z-50 p-4">
            <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 shadow-2xl">
              <h3 className="text-lg font-black text-slate-950 mb-2">{t('documents.create_new_title')}</h3>
              <p className="text-sm text-slate-600 mb-4">{isEnglishUi ? 'Choose whether to create a new document or a new presentation.' : 'Scegli se creare un nuovo documento o una nuova presentazione.'}</p>
              <div className="flex flex-col gap-2">
                <button className="w-full flex items-center gap-3 p-3 rounded-lg border border-emerald-200 bg-emerald-100 text-emerald-900 hover:border-emerald-300 hover:bg-emerald-200 transition-all text-left shadow-sm" onClick={() => { createNewDocument(); setShowNewModal(false) }}>
                  <div className="w-9 h-9 rounded-lg border border-emerald-200 bg-white/80 flex items-center justify-center text-emerald-800 flex-shrink-0"><FileText className="h-4 w-4" /></div>
                  <span className="text-sm font-black">{t('documents.new_document')}</span>
                </button>
                <button className="w-full flex items-center gap-3 p-3 rounded-lg border border-emerald-200 bg-white text-emerald-900 hover:border-emerald-300 hover:bg-emerald-50 transition-all text-left shadow-sm" onClick={() => { createNewPresentation(); setShowNewModal(false) }}>
                  <div className="w-9 h-9 rounded-lg border border-emerald-200 bg-emerald-100 flex items-center justify-center text-emerald-800 flex-shrink-0"><Monitor className="h-4 w-4" /></div>
                  <span className="text-sm font-black">{t('documents.new_presentation')}</span>
                </button>
              </div>
              <div className="flex justify-end mt-4">
                <Button variant="outline" onClick={() => setShowNewModal(false)}>{isEnglishUi ? 'Cancel' : 'Annulla'}</Button>
              </div>
            </div>
          </div>
        )}
      </>
    )
  }

  if (readOnlyCatalog) {
    const slideDimensions = FORMAT_DIMENSIONS[document.format]
    return (
      <div className="flex h-full min-h-0 flex-col overflow-hidden bg-slate-100">
        <header className="z-10 flex h-14 shrink-0 items-center gap-2 border-b border-slate-200 bg-white/95 px-3 shadow-sm backdrop-blur-xl">
          <button
            type="button"
            onClick={() => setViewMode('list')}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-slate-700 active:scale-95"
            aria-label={isEnglishUi ? 'Back to documents' : 'Torna ai documenti'}
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
          <div className="min-w-0 flex-1 px-1">
            <h2 className="truncate text-sm font-black text-slate-950">{document.title}</h2>
            <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-sky-700">{isEnglishUi ? 'Read only' : 'Sola lettura'}</p>
          </div>
          {mode === 'slides' && document.slides.length > 1 && (
            <>
              <button
                type="button"
                onClick={() => setCurrentSlideIndex((index) => Math.max(0, index - 1))}
                disabled={currentSlideIndex === 0}
                className="hidden h-9 w-9 items-center justify-center rounded-xl bg-slate-100 text-slate-700 disabled:opacity-30 md:flex"
                aria-label={isEnglishUi ? 'Previous slide' : 'Slide precedente'}
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <span className="hidden min-w-9 text-center text-[11px] font-black tabular-nums text-slate-500 md:inline">{currentSlideIndex + 1}/{document.slides.length}</span>
              <button
                type="button"
                onClick={() => setCurrentSlideIndex((index) => Math.min(document.slides.length - 1, index + 1))}
                disabled={currentSlideIndex === document.slides.length - 1}
                className="hidden h-9 w-9 items-center justify-center rounded-xl bg-slate-100 text-slate-700 disabled:opacity-30 md:flex"
                aria-label={isEnglishUi ? 'Next slide' : 'Slide successiva'}
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </>
          )}
        </header>

        <main className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-3">
          {mode === 'pdf' && (
            <iframe src={document.textContent || ''} className="h-full min-h-[70dvh] w-full rounded-2xl border-0 bg-white shadow-sm" title={document.title} />
          )}
          {mode === 'web' && (
            document.webUrl
              ? <iframe src={document.webUrl} className="h-full min-h-[70dvh] w-full rounded-2xl border-0 bg-white shadow-sm" title={document.title} />
              : <iframe srcDoc={document.textContent || ''} sandbox="allow-same-origin allow-scripts" className="h-full min-h-[70dvh] w-full rounded-2xl border-0 bg-white shadow-sm" title={document.title} />
          )}
          {mode === 'document' && (
            <article className="mx-auto min-h-full w-full max-w-3xl rounded-2xl bg-white px-5 py-7 text-[16px] leading-7 text-slate-800 shadow-sm [&_h1]:mb-5 [&_h1]:text-3xl [&_h1]:font-black [&_h2]:mb-4 [&_h2]:text-2xl [&_h2]:font-black [&_h3]:mb-3 [&_h3]:text-xl [&_h3]:font-bold [&_img]:h-auto [&_img]:max-w-full [&_li]:my-1 [&_ol]:my-4 [&_ol]:pl-6 [&_p]:mb-4 [&_table]:w-full [&_table]:overflow-x-auto [&_ul]:my-4 [&_ul]:pl-6" dangerouslySetInnerHTML={{ __html: document.textContent || '' }} />
          )}
          {mode === 'slides' && (
            <>
            <div ref={mobileSlidesViewportRef} className="space-y-4 md:hidden">
              {document.slides.map((slide, index) => (
                <section key={slide.id} className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
                  <div className="flex items-center justify-between border-b border-slate-100 px-3 py-2">
                    <span className="text-[10px] font-black uppercase tracking-widest text-indigo-700">Slide {index + 1}</span>
                    <span className="max-w-[70%] truncate text-xs font-bold text-slate-700">{slide.title}</span>
                  </div>
                  <div className="flex justify-center overflow-hidden bg-slate-100 p-2">
                    <div className="relative origin-top bg-white" style={{ width: slideDimensions.width * mobileSlideScale, height: slideDimensions.height * mobileSlideScale }}>
                      <div className="relative origin-top-left bg-white" style={{ width: slideDimensions.width, height: slideDimensions.height, transform: `scale(${mobileSlideScale})` }}>
                        {!slide.blocks.some(block => block.type === 'text' && block.y < 130 && (block.style.fontSize || 0) >= 26) && <h3 className="pointer-events-none absolute inset-x-8 top-8 z-10 text-4xl font-bold text-slate-900">{slide.title}</h3>}
                        <SlideEditor blocks={slide.blocks} onChange={() => {}} selectedBlockId={null} onSelectBlock={() => {}} scale={mobileSlideScale} readOnly slideWidth={slideDimensions.width} slideHeight={slideDimensions.height} />
                      </div>
                    </div>
                  </div>
                </section>
              ))}
            </div>
            <div className="hidden min-h-full items-start justify-center pt-3 md:flex">
              <div className="overflow-hidden rounded-xl bg-white shadow-lg" style={{ width: slideDimensions.width * scale, height: slideDimensions.height * scale }}>
                <div
                  ref={canvasRef}
                  className="relative origin-top-left bg-white"
                  style={{ width: slideDimensions.width, height: slideDimensions.height, transform: `scale(${scale})` }}
                >
                  {!currentSlide.blocks.some(block => block.type === 'text' && block.y < 130 && (block.style.fontSize || 0) >= 26) && (
                    <h3 className="pointer-events-none absolute inset-x-8 top-8 z-10 text-4xl font-bold text-slate-900">{currentSlide.title}</h3>
                  )}
                  <SlideEditor
                    blocks={currentSlide.blocks}
                    onChange={() => {}}
                    selectedBlockId={null}
                    onSelectBlock={() => {}}
                    scale={scale}
                    readOnly
                    slideWidth={slideDimensions.width}
                    slideHeight={slideDimensions.height}
                  />
                </div>
              </div>
            </div>
            </>
          )}
          {mode === 'sheet' && (
            <div className="pointer-events-none min-w-[760px] rounded-2xl bg-white p-2 shadow-sm">
              <SpreadsheetEditor
                data={document.sheetData || DEFAULT_SHEET_DATA}
                onDataChange={() => {}}
                chartConfig={document.sheetChart || DEFAULT_SHEET_CHART}
                onChartConfigChange={() => {}}
              />
            </div>
          )}
          {mode === 'canvas' && (
            <div className="min-h-[70dvh] overflow-hidden rounded-2xl bg-white shadow-sm">
              <CollaborativeCanvas
                role="student"
                sessionId={sessionId}
                title={document.title}
                onTitleChange={() => {}}
                initialContent={document.canvasContent || DEFAULT_CANVAS_CONTENT}
                onContentChange={() => {}}
                readOnly
              />
            </div>
          )}
        </main>
      </div>
    )
  }

  return (
    <>
      <div className="h-full flex flex-col bg-slate-100 overflow-hidden">

        {/* Header / Meta-Toolbar */}
        <div className="relative z-30 flex h-16 shrink-0 items-center justify-between border-b border-slate-200 bg-white px-4">
          <div className="flex min-w-0 flex-1 items-center justify-between gap-4">
          <div className="flex min-w-0 items-center gap-2">
             <Button
               variant="ghost"
               size="sm"
               onClick={() => setViewMode('list')}
               className="shrink-0 gap-1 font-semibold text-slate-600"
             >
               <ChevronLeft className="h-4 w-4" />
               {t('documents.title_my_documents')}
             </Button>

             <div className="h-7 w-px bg-slate-200" />

             <Input
               value={document.title}
               onChange={(e) => handleTitleChange(e.target.value)}
               disabled={isEditorReadOnly}
               className="h-10 w-[min(28vw,360px)] border-indigo-200 bg-indigo-50/60 px-3 font-bold text-slate-900 shadow-none focus-visible:ring-indigo-200"
               placeholder={filenamePlaceholder}
             />
             <Button
               tone="accent"
               surface="soft"
               onClick={() => setShowNewModal(true)}
               className="shrink-0"
             >
               <Plus className="mr-2 h-4 w-4" />
               {t('documents.new')}
             </Button>
             {isReadOnlyLesson && (
               <span className="inline-flex items-center rounded-full border border-emerald-200 bg-emerald-100 px-2.5 py-1 text-xs font-black text-emerald-800">
                 {isEnglishUi ? 'Lesson' : 'Lezione'}
               </span>
             )}
             {activeSubmittedDocument && (
               <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-black ${activeSubmittedDocument.correction?.status === 'pending' ? 'border-amber-300 bg-amber-100 text-amber-900' : 'border-slate-200 bg-slate-100 text-slate-700'}`}>
                 {activeSubmittedDocument.correction?.status === 'pending'
                   ? (isEnglishUi ? 'Teacher corrections' : 'Correzioni del docente')
                   : (isEnglishUi ? 'Submitted work' : 'Consegna')}
               </span>
             )}
          </div>

          <div className="flex shrink-0 gap-2">
             {(mode === 'slides' || mode === 'document') && !isEditorReadOnly && (
                 <Button
                   variant="outline"
                   onClick={() => setPresentationChatOpen(v => !v)}
                   className={`rounded-lg font-bold ${presentationChatOpen ? 'border-violet-300 bg-violet-100 text-violet-800' : 'border-slate-200 bg-white text-slate-700'}`}
                 >
                   <Bot className="h-4 w-4 mr-2" />
                   {isEnglishUi ? 'Document Builder' : 'Assistente documento'}
                 </Button>
             )}
             {mode === 'slides' && !isEditorReadOnly && (
                 <Button
                   variant="outline"
                   onClick={saveCurrentPresentationAsTemplate}
                   className="rounded-lg border-slate-200 bg-white font-bold text-slate-700"
                 >
                   <Save className="h-4 w-4 mr-2" />
                   Template
                 </Button>
             )}
             {isReadOnlyLesson ? (
               <Button variant="outline" disabled>
                 <BookOpen className="h-4 w-4 mr-2" />
                 {isEnglishUi ? 'Teacher content (read only)' : 'Contenuto del docente (sola lettura)'}
               </Button>
             ) : activeSubmittedDocument ? (
               <Button variant="outline" disabled>
                 <CheckCircle className="h-4 w-4 mr-2" />
                 {isEnglishUi ? 'Submitted work (read only)' : 'Consegna (sola lettura)'}
               </Button>
             ) : submitted ? (
               <Button variant="outline" onClick={resetDocument}>
                 <Plus className="h-4 w-4 mr-2" />
                 {t('documents.new_document')}
               </Button>
             ) : (
               <Button
                 tone="accent"
                 surface="solid"
                 onClick={() => setShowSubmitModal(true)}
                 className="rounded-lg border border-emerald-200 bg-emerald-100 font-black text-emerald-800 hover:bg-emerald-200"
               >
                 <Send className="h-4 w-4 mr-2" />
                 {t('documents.send_to_teacher')}
               </Button>
             )}
          </div>
          </div>
        </div>

        {activeSubmittedDocument?.correction?.status === 'pending' && (
          <div
            className="group flex shrink-0 items-center justify-between gap-4 border-b border-amber-300 bg-amber-100 px-5 py-3 shadow-sm"
            onMouseEnter={() => loadSubmittedDocument(activeSubmittedDocument, true)}
            onMouseLeave={() => loadSubmittedDocument(activeSubmittedDocument, false)}
          >
            <div className="flex min-w-0 items-center gap-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-amber-300 bg-amber-200 text-amber-900">
                <Sparkles className="h-4 w-4" />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-black text-amber-950">
                  {isCorrectionPreview
                    ? (isEnglishUi ? 'Correction preview' : 'Anteprima delle correzioni')
                    : (isEnglishUi ? 'Teacher corrections available' : 'Correzioni del docente disponibili')}
                </p>
                <p className="truncate text-xs font-medium text-amber-800">
                  {isEnglishUi
                    ? 'Hover here to compare the corrected version, then accept the complete suggestion set.'
                    : 'Passa qui il mouse per confrontare la versione corretta, poi accetta l’intero gruppo di suggerimenti.'}
                </p>
              </div>
            </div>
            <Button
              type="button"
              onClick={(event) => { event.stopPropagation(); void acceptActiveCorrection() }}
              disabled={isAcceptingCorrection}
              className="shrink-0 border border-amber-400 bg-amber-700 font-black text-white hover:bg-amber-800"
            >
              <CheckCircle className="mr-2 h-4 w-4" />
              {isAcceptingCorrection
                ? (isEnglishUi ? 'Accepting…' : 'Accettazione…')
                : (isEnglishUi ? 'Accept all corrections' : 'Accetta tutte le correzioni')}
            </Button>
          </div>
        )}

        {/* Unified Toolbar */}
        {!isEditorReadOnly && mode !== 'sheet' && mode !== 'canvas' && mode !== 'pdf' && mode !== 'web' && (
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
            onOpenAIAssist={() => {
              setPresentationChatOpen(true)
            }}
            onAIAssistAnchorChange={() => {
              if (!toolbarHostRef.current) return
              const rect = toolbarHostRef.current.getBoundingClientRect()
              setAiPanelAnchor({
                x: Math.max(20, rect.right - 360),
                y: rect.bottom + 8
              })
            }}
          />
        </div>
        )}

        {mode === 'slides' && selectedBlock && !isEditorReadOnly && (
          <div className="flex h-10 shrink-0 items-center gap-2 border-b border-slate-200 bg-white px-4 text-xs text-slate-700">
            <span className="font-black uppercase tracking-wide text-slate-500">{isEnglishUi ? 'Layer' : 'Livello'}</span>
            <Button variant="ghost" size="sm" className="h-7 px-2" onClick={() => moveSelectedBlockLayer('back')}>
              {isEnglishUi ? 'Back' : 'Dietro'}
            </Button>
            <Button variant="ghost" size="sm" className="h-7 px-2" onClick={() => moveSelectedBlockLayer('backward')}>
              {isEnglishUi ? 'Down' : 'Giù'}
            </Button>
            <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-1 font-bold">
              {(selectedBlock.zIndex ?? currentSlide.blocks.findIndex(block => block.id === selectedBlock.id)) + 1} / {currentSlide.blocks.length}
            </span>
            <Button variant="ghost" size="sm" className="h-7 px-2" onClick={() => moveSelectedBlockLayer('forward')}>
              {isEnglishUi ? 'Up' : 'Su'}
            </Button>
            <Button variant="ghost" size="sm" className="h-7 px-2" onClick={() => moveSelectedBlockLayer('front')}>
              {isEnglishUi ? 'Front' : 'Davanti'}
            </Button>
          </div>
        )}

        <div className="flex-1 flex overflow-hidden">

          {/* LEFT SIDEBAR: Documents & Slides */}
          <div className={`${mode === 'slides' && !isEditorReadOnly ? 'w-64' : 'w-0'} flex shrink-0 flex-col overflow-hidden border-r border-slate-200 bg-white transition-all duration-200`}>

            {/* Slide Navigation (Only in Slide Mode) */}
            {mode === 'slides' && !isEditorReadOnly && (
              <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
                 <div className="p-3 border-b flex justify-between items-center bg-white">
                   <span className="font-black text-[10px] uppercase tracking-widest text-slate-600">{isEnglishUi ? 'Pages / Slides' : 'Pagine / Slide'}</span>
                   <Button size="icon" variant="ghost" className="h-7 w-7 rounded-lg bg-slate-900 text-white hover:bg-slate-800" onClick={addSlide}>
                     <Plus className="h-4 w-4" />
                   </Button>
                 </div>
                 <div className="flex-1 overflow-y-auto p-2 space-y-2 scrollbar-hide">
                   {document.slides.map((slide, idx) => (
                     <div
                       key={slide.id}
                       onClick={() => { setCurrentSlideIndex(idx); setSelectedBlockId(null); }}
                       className={`p-3 rounded-lg border transition-all group relative backdrop-blur-md ${currentSlideIndex === idx
                         ? 'bg-slate-950 text-white border-slate-950 shadow-sm'
                         : 'bg-white hover:bg-slate-50 border-slate-200 hover:border-slate-400'}`}
                     >
                       <div className="text-[10px] font-bold text-slate-400 uppercase mb-1">Slide {idx + 1}</div>
                       <div className={`text-sm truncate font-bold ${currentSlideIndex === idx ? 'text-white' : 'text-slate-800'}`}>{slide.title}</div>
                       <button
                         onClick={(e) => { e.stopPropagation(); deleteSlide(idx); }}
                         className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 text-slate-400 hover:text-red-500 transition-opacity"
                         title={isEnglishUi ? 'Delete slide' : 'Elimina slide'}
                       >
                         <Trash2 className="h-3.5 w-3.5" />
                       </button>
                       <button
                         onClick={(e) => { e.stopPropagation(); duplicateSlide(idx); }}
                         className="absolute bottom-2 right-2 opacity-0 group-hover:opacity-100 text-slate-400 hover:text-emerald-600 transition-opacity"
                         title={isEnglishUi ? 'Duplicate slide' : 'Duplica slide'}
                       >
                         <Copy className="h-3.5 w-3.5" />
                       </button>
                     </div>
                   ))}
                 </div>
              </div>
            )}

            <div className="hidden">
              {mode === 'slides' && !isEditorReadOnly && (
                <section>
                  <div className="mb-3 flex items-center justify-between px-1">
                    <h3 className="font-black text-[10px] uppercase tracking-widest text-slate-600">Template</h3>
                    <span className="text-[10px] font-bold bg-indigo-700 text-white px-1.5 py-0.5 rounded-full">{presentationTemplates.length}</span>
                  </div>
                  <div className="space-y-2">
                    {presentationTemplates.length === 0 ? (
                      <div className="rounded-lg border border-dashed border-slate-200 bg-white p-3 text-[11px] font-medium text-slate-400">
                        {isEnglishUi ? 'No templates saved' : 'Nessun template salvato'}
                      </div>
                    ) : presentationTemplates.map(template => (
                      <button
                        key={template.id}
                        type="button"
                        onClick={() => applyPresentationTemplate(template.id)}
                        className="flex w-full items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-left text-sm font-bold text-slate-800 hover:border-indigo-200 hover:bg-indigo-50"
                      >
                        <Layers className="h-4 w-4 text-indigo-600" />
                        <span className="min-w-0 flex-1 truncate">{template.name}</span>
                      </button>
                    ))}
                  </div>
                </section>
              )}

              {/* Drafts Section */}
              <section>
                <div className="flex items-center justify-between mb-3 px-1">
                  <h3 className="font-black text-[10px] uppercase tracking-widest text-slate-600">{t('documents.my_drafts')}</h3>
                  <span className="text-[10px] font-bold bg-slate-900 text-white px-1.5 py-0.5 rounded-full">{draftDocuments.length}</span>
                </div>
                
                <div className="space-y-2">
                  {draftDocuments.length === 0 && (
                    <div className="text-center py-6 px-4 bg-white/40 rounded-2xl border border-dashed border-slate-200">
                      <p className="text-[10px] font-medium text-slate-400">{isEnglishUi ? 'No saved documents' : 'Nessun documento salvato'}</p>
                    </div>
                  )}
                  {draftDocuments.map((doc) => (
                    <div
                      key={doc.id}
                      onClick={() => loadDraft(doc)}
                      className={`
                        group flex flex-col p-3 rounded-lg transition-all border cursor-pointer backdrop-blur-md
                        ${draftId === doc.id && !isReadOnlyLesson
                          ? 'bg-slate-950 border-slate-950 shadow-md text-white'
                          : 'bg-white border-slate-200 hover:bg-white hover:border-slate-400'}
                      `}
                    >
                      <div className="flex items-center gap-3 mb-2">
                        <div className={`p-2 rounded-xl shadow-sm ${
                          doc.type === 'presentation' ? 'bg-indigo-100 text-indigo-600' : 
                          doc.type === 'sheet' ? 'bg-sky-100 text-sky-700' : 
                          doc.type === 'canvas' ? 'bg-amber-100 text-amber-700' : 
                          'bg-emerald-100 text-emerald-600'
                        }`}>
                          {doc.type === 'presentation' ? <MonitorPlay className="h-4 w-4" /> : 
                           doc.type === 'sheet' ? <FileSpreadsheet className="h-4 w-4" /> : 
                           doc.type === 'canvas' ? <PenTool className="h-4 w-4" /> : 
                           <FileText className="h-4 w-4" />}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className={`text-sm font-bold truncate ${draftId === doc.id && !isReadOnlyLesson ? 'text-white' : 'text-slate-800'}`}>
                            {doc.title}
                          </p>
                        </div>
                        <button
                          onClick={(e) => handleDeleteDraft(e, doc.id)}
                          className="opacity-0 group-hover:opacity-100 p-1 text-slate-400 hover:text-red-500 transition-all"
                          title={t('documents.delete_draft')}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                      
                      <div className="flex items-center justify-between mt-auto">
                        <div className={`flex items-center gap-1.5 text-[10px] font-bold ${draftId === doc.id && !isReadOnlyLesson ? 'text-white/70' : 'text-slate-500'}`}>
                          <Clock className="h-3 w-3" />
                          {new Date(doc.updatedAt).toLocaleDateString(dateLocale, { day: 'numeric', month: 'short' })}
                        </div>
                        <div className="flex items-center gap-1.5">
                           <span className={`text-[9px] font-black uppercase tracking-tighter ${draftId === doc.id && !isReadOnlyLesson ? 'text-white/60' : 'text-slate-400'}`}>{t('documents.personal')}</span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </section>

              {/* Submitted documents and teacher corrections */}
              <section>
                <div className="mb-3 flex items-center justify-between px-1">
                  <h3 className="text-[10px] font-black uppercase tracking-widest text-slate-600">{isEnglishUi ? 'Submitted work' : 'Le mie consegne'}</h3>
                  <span className="rounded-full bg-amber-700 px-1.5 py-0.5 text-[10px] font-bold text-white">{submittedDocuments.length}</span>
                </div>
                <div className="space-y-2">
                  {submittedDocuments.length === 0 && (
                    <div className="rounded-2xl border border-dashed border-slate-200 bg-white/40 px-4 py-6 text-center">
                      <p className="text-[10px] font-medium text-slate-400">{isEnglishUi ? 'No submitted documents' : 'Nessuna consegna'}</p>
                    </div>
                  )}
                  {submittedDocuments.map(doc => {
                    const isActive = activeSubmittedDocument?.submissionId === doc.submissionId
                    const hasCorrection = doc.correction?.status === 'pending'
                    return (
                      <button
                        key={doc.id}
                        type="button"
                        onClick={() => loadSubmittedDocument(doc)}
                        className={`flex w-full flex-col rounded-lg border p-3 text-left transition-all ${isActive ? 'border-amber-500 bg-amber-500 text-white shadow-md' : hasCorrection ? 'border-amber-300 bg-amber-50 hover:bg-amber-100' : 'border-slate-200 bg-white hover:border-slate-400'}`}
                      >
                        <div className="flex w-full items-center gap-3">
                          <div className={`rounded-xl p-2 ${isActive ? 'bg-white/20 text-white' : hasCorrection ? 'bg-amber-200 text-amber-900' : 'bg-slate-100 text-slate-700'}`}>
                            {doc.type === 'presentation' ? <MonitorPlay className="h-4 w-4" /> : doc.type === 'sheet' ? <FileSpreadsheet className="h-4 w-4" /> : doc.type === 'canvas' ? <PenTool className="h-4 w-4" /> : <FileText className="h-4 w-4" />}
                          </div>
                          <span className="min-w-0 flex-1 truncate text-sm font-bold">{doc.title}</span>
                          {hasCorrection && <Sparkles className={`h-4 w-4 shrink-0 ${isActive ? 'text-white' : 'text-amber-700'}`} />}
                        </div>
                        <span className={`mt-2 text-[10px] font-black uppercase tracking-wide ${isActive ? 'text-white/80' : hasCorrection ? 'text-amber-800' : 'text-slate-400'}`}>
                          {hasCorrection ? (isEnglishUi ? 'Corrections available' : 'Correzioni disponibili') : (isEnglishUi ? 'Submitted' : 'Consegnato')}
                        </span>
                      </button>
                    )
                  })}
                </div>
              </section>

              {/* Lessons Section */}
              <section>
                <div className="flex items-center justify-between mb-3 px-1">
                  <h3 className="font-black text-[10px] uppercase tracking-widest text-slate-600">{t('documents.shared_materials')}</h3>
                  <span className="text-[10px] font-bold bg-emerald-700 text-white px-1.5 py-0.5 rounded-full">{lessonDocuments.length}</span>
                </div>

                <div className="space-y-2">
                  {lessonDocuments.length === 0 && (
                    <div className="text-center py-6 px-4 bg-white/40 rounded-2xl border border-dashed border-slate-200">
                      <p className="text-[10px] font-medium text-slate-400">{isEnglishUi ? 'No materials shared by the teacher' : 'Nessun materiale condiviso dal docente'}</p>
                    </div>
                  )}
                  {/* UDA folder headers inline in the list */}
                  {(() => {
                    const seen = new Set<string>()
                    return lessonDocuments.map((doc) => (
                      <>
                        {doc.udaFolder && !seen.has(doc.udaFolder) && (() => { seen.add(doc.udaFolder!); return (
                          <p key={`folder-${doc.udaFolder}`} className="text-[10px] font-bold uppercase tracking-widest text-indigo-400 mt-3 mb-1 px-1">📁 {doc.udaFolder}</p>
                        ) })()}
                    <div
                      key={doc.id}
                      onClick={() => loadLesson(doc)}
                      className={`
                        group flex flex-col p-3 rounded-lg transition-all border cursor-pointer backdrop-blur-md
                        ${activeLessonTaskId === doc.taskId
                          ? 'bg-emerald-700 border-emerald-700 shadow-md text-white'
                          : 'bg-white border-slate-200 hover:bg-white hover:border-slate-400'}
                      `}
                    >
                      <div className="flex items-center gap-3 mb-2">
                        <div className={`p-2 rounded-xl ${
                          doc.type === 'presentation' ? 'bg-indigo-100 text-indigo-700' :
                          doc.type === 'pdf' ? 'bg-red-100 text-red-700' :
                          doc.type === 'web' ? 'bg-fuchsia-100 text-fuchsia-700' :
                          doc.type === 'canvas' ? 'bg-amber-100 text-amber-700' :
                          'bg-emerald-100 text-emerald-700'
                        }`}>
                          {doc.type === 'presentation' ? <Monitor className="h-4 w-4" /> : 
                           doc.type === 'pdf' ? <FileText className="h-4 w-4" /> :
                           doc.type === 'web' ? <MonitorPlay className="h-4 w-4" /> :
                           doc.type === 'canvas' ? <PenTool className="h-4 w-4" /> : 
                           <BookOpen className="h-4 w-4" />}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className={`text-sm font-bold truncate ${activeLessonTaskId === doc.taskId ? 'text-white' : 'text-slate-800'}`}>
                            {doc.title}
                          </p>
                          <p className={`text-[10px] font-medium flex items-center gap-1 ${activeLessonTaskId === doc.taskId ? 'text-white/75' : 'text-slate-500'}`}>
                            <User className={`h-2.5 w-2.5 ${activeLessonTaskId === doc.taskId ? 'text-white/75' : 'text-emerald-600'}`} />
                            {doc.authorName}
                          </p>
                        </div>
                      </div>
                      
                      <div className="flex items-center justify-between mt-auto">
                        <div className={`flex items-center gap-1.5 text-[10px] font-bold ${activeLessonTaskId === doc.taskId ? 'text-white/70' : 'text-slate-500'}`}>
                          <Calendar className="h-3 w-3" />
                          {new Date(doc.updatedAt).toLocaleDateString(dateLocale, { day: 'numeric', month: 'short' })}
                        </div>
                        <div className="flex items-center gap-1.5">
                           <div className={`flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[9px] font-black uppercase tracking-tighter ${activeLessonTaskId === doc.taskId ? 'bg-white/15 text-white' : 'bg-emerald-700 text-white'}`}>
                             <Share2 className="h-2 w-2" />
                             {isEnglishUi ? 'Shared' : 'Condiviso'}
                           </div>
                        </div>
                      </div>
                    </div>
                    </>
                  ))
                  })()}
                </div>
              </section>
            </div>

            {/* Status indicator */}
            {submitted && (
              <div className="hidden">
                <CheckCircle className="h-4 w-4 text-emerald-600" />
                <span className="text-xs font-bold text-emerald-700 uppercase tracking-tight">{t('documents.sent_status')}</span>
              </div>
            )}
          </div>

          {/* Main Area */}
          <div className={`flex-1 flex items-start justify-center p-4 md:p-6 relative overflow-y-auto transition-colors ${isCorrectionPreview ? 'bg-amber-100' : 'bg-slate-100'}`}
               onClick={() => setSelectedBlockId(null)}
          >

             {/* MODE: PDF */}
             {mode === 'pdf' && (
               <div className="h-[calc(100vh-10rem)] w-full bg-white rounded-2xl shadow-[0_10px_30px_rgba(15,23,42,0.12)] overflow-hidden">
                 <iframe
                   src={document.textContent || ''}
                   className="w-full h-full border-0"
                   title={document.title}
                 />
               </div>
             )}

             {mode === 'web' && (
               <div className="h-[calc(100vh-10rem)] w-full bg-white rounded-2xl shadow-[0_10px_30px_rgba(15,23,42,0.12)] overflow-hidden">
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
                        aria-label={t('documents.margin_left')}
                        title={t('documents.margin_left_drag')}
                      />
                      <button
                        type="button"
                        className="pointer-events-auto absolute -top-0.5 h-3.5 w-3.5 -translate-x-1/2 cursor-ew-resize rounded-full border border-slate-500 bg-white shadow-sm"
                        style={{ left: FORMAT_DIMENSIONS.a4.width - docMargins.horizontal }}
                        onMouseDown={() => setDraggingMargin('right')}
                        aria-label={t('documents.margin_right')}
                        title={t('documents.margin_right_drag')}
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
                    className="flex-1 flex flex-col relative z-10"
                    style={{ minHeight: FORMAT_DIMENSIONS.a4.height - docMargins.vertical * 2 }}
                    onMouseDown={(e) => {
                      if (e.target !== e.currentTarget) return
                      if (editor && mode === 'document') {
                        editor.chain().focus('end').run()
                      }
                    }}
                  >
                    <RichTextEditor
                      content={document.textContent || ''}
                      onChange={(html) => setDocument(d => ({ ...d, textContent: html }))}
                      onEditorReady={setEditor}
                      readOnly={isEditorReadOnly}
                      enableSelectionAssist={false}
                      contentClassName="h-full min-h-full max-w-none focus:outline-none p-0 cursor-text [&_.ProseMirror]:min-h-full [&_.ProseMirror]:h-full [&_.ProseMirror]:text-[16px] [&_.ProseMirror]:leading-7 [&_.ProseMirror_p]:m-0 [&_.ProseMirror_h1]:m-0 [&_.ProseMirror_h2]:m-0 [&_.ProseMirror_h3]:m-0 [&_.ProseMirror_ul]:my-0 [&_.ProseMirror_ol]:my-0"
                      aiPanelAnchor={aiPanelAnchor}
                      pagination={{
                        pageHeight: FORMAT_DIMENSIONS.a4.height,
                        pageGap: DOC_PAGE_GAP,
                        marginTop: docMargins.vertical,
                        marginBottom: docMargins.vertical,
                        onPageCountChange: setDocumentPageCount,
                      }}
                      onMissingSelectionForAI={() => {
                        toast({
                          title: t('documents.select_text_first'),
                          description: t('documents.ai_needs_selection'),
                        })
                      }}
                    />
                  </div>
               </div>
             )}

             {/* MODE: SLIDES */}
             {mode === 'slides' && (
               <>
               <div className="flex w-full flex-col gap-2 border-b border-slate-200 bg-slate-50 p-3 md:hidden">
                 <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">Slide della presentazione</p>
                 {document.slides.map((slide, index) => (
                   <button key={slide.id} type="button" onClick={() => { setCurrentSlideIndex(index); setSelectedBlockId(null) }} className={`flex items-center gap-3 rounded-xl border px-3 py-2 text-left ${currentSlideIndex === index ? 'border-indigo-300 bg-indigo-50 text-indigo-950' : 'border-slate-200 bg-white text-slate-700'}`}>
                     <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-100 text-[10px] font-black">{index + 1}</span>
                     <span className="truncate text-xs font-bold">{slide.title || `Slide ${index + 1}`}</span>
                   </button>
                 ))}
               </div>
               <div
                 ref={canvasRef}
                 className="relative flex flex-col bg-white shadow-xl transition-transform origin-center"
                 style={{
                   width: FORMAT_DIMENSIONS[document.format].width,
                   height: FORMAT_DIMENSIONS[document.format].height,
                   transform: `scale(${scale})`,
                   marginTop: '20px'
                 }}
                 onClick={(e) => e.stopPropagation()}
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
                       disabled={isEditorReadOnly}
                       className="text-4xl font-bold bg-transparent border-none focus:outline-none w-full placeholder-slate-300 pointer-events-auto"
                       placeholder={t('documents.slide_title_placeholder')}
                     />
                  </div>}

                  <div className="flex-1 relative">
                    <SlideEditor
                      blocks={currentSlide.blocks}
                      onChange={updateSlideBlocks}
                      selectedBlockId={selectedBlockId}
                      onSelectBlock={setSelectedBlockId}
                      scale={scale}
                      readOnly={isEditorReadOnly}
                      slideWidth={FORMAT_DIMENSIONS[document.format].width}
                      slideHeight={FORMAT_DIMENSIONS[document.format].height}
                      snapOptions={snapOptions}
                      onContextAddBlock={addSlideBlock}
                    />
                  </div>
               </div>
               </>
             )}

             {mode === 'sheet' && (
               <div className={`w-full max-w-[1400px] p-2 ${isEditorReadOnly ? 'pointer-events-none' : ''}`}>
                 <SpreadsheetEditor
                   data={document.sheetData || DEFAULT_SHEET_DATA}
                   onDataChange={(next) => setDocument(d => ({ ...d, sheetData: next }))}
                   chartConfig={document.sheetChart || DEFAULT_SHEET_CHART}
                   onChartConfigChange={(next) => setDocument(d => ({ ...d, sheetChart: next }))}
                 />
               </div>
             )}
             {mode === 'canvas' && (
               <div className="w-full max-w-[1700px] p-2">
                 <CollaborativeCanvas
                   role="student"
                   sessionId={sessionId}
                   title={document.title}
                 onTitleChange={(nextTitle) => {
                   handleTitleChange(nextTitle)
                  }}
                  initialContent={document.canvasContent || DEFAULT_CANVAS_CONTENT}
                  onContentChange={(contentJson) => setDocument((d) => ({ ...d, canvasContent: contentJson }))}
                  readOnly={isEditorReadOnly}
                 />
               </div>
             )}

          </div>
          {presentationChatOpen && !isEditorReadOnly && (mode === 'slides' || mode === 'document') && (
            <DocumentAgentChat
              context={documentAssistContext}
              documentContext={{
                title: document.title,
                mode,
                format: document.format,
                current_slide_index: currentSlideIndex,
              }}
              dims={mode === 'slides' ? FORMAT_DIMENSIONS[document.format] : undefined}
              onApply={applyDocumentAgentProposal}
              onClose={() => setPresentationChatOpen(false)}
            />
          )}
        </div>

        {/* New Document Modal */}
        {showNewModal && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
            <div className="bg-white rounded-xl border border-emerald-200 p-6 w-full max-w-md mx-4 shadow-[var(--shadow-xl)]">
              <h3 className="text-lg font-black text-slate-950 mb-2">{t('documents.create_new_title')}</h3>
              <p className="text-sm text-slate-600 mb-4">
                {isEnglishUi ? 'Choose whether to create a new document or a new presentation.' : 'Scegli se creare un nuovo documento o una nuova presentazione.'}
              </p>
              <div className="flex flex-col gap-3">
                <Button
                  tone="neutral"
                  surface="solid"
                  className="w-full justify-center rounded-lg border border-emerald-200 bg-emerald-100 font-black text-emerald-900 hover:bg-emerald-200"
                  onClick={() => {
                    createNewDocument()
                    setShowNewModal(false)
                  }}
                >
                  <FileText className="h-4 w-4 mr-2" />
                  {t('documents.new_document')}
                </Button>
                <Button
                  tone="neutral"
                  surface="solid"
                  className="w-full justify-center rounded-lg border border-emerald-200 bg-white font-black text-emerald-900 hover:bg-emerald-50"
                  onClick={() => {
                    createNewPresentation()
                    setShowNewModal(false)
                  }}
                >
                  <Monitor className="h-4 w-4 mr-2" />
                  {t('documents.new_presentation')}
                </Button>
              </div>
              <div className="flex justify-end mt-4">
                <Button variant="outline" onClick={() => setShowNewModal(false)}>{isEnglishUi ? 'Cancel' : 'Annulla'}</Button>
              </div>
            </div>
          </div>
        )}

        {/* Submit Modal */}
        {showSubmitModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl border border-emerald-200 p-6 w-full max-w-md mx-4 shadow-xl">
            <h3 className="text-lg font-black text-slate-950 mb-2">{t('documents.send_to_teacher_title')}</h3>
            <p className="text-sm text-slate-600 mb-4">
              {t('documents.send_to_teacher_body', {
                type: mode === 'slides'
                  ? (isEnglishUi ? 'presentation' : 'presentazione')
                  : mode === 'sheet'
                    ? (isEnglishUi ? 'sheet' : 'foglio')
                    : mode === 'canvas'
                      ? (isEnglishUi ? 'board' : 'lavagna')
                      : (isEnglishUi ? 'document' : 'documento'),
                title: document.title,
              })}
            </p>
              <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-4 mb-4">
              <p className="text-sm font-medium text-emerald-800">
                {t('documents.sent_teacher_info')}
              </p>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setShowSubmitModal(false)} disabled={isSubmitting}>
                {isEnglishUi ? 'Cancel' : 'Annulla'}
              </Button>
              <Button
                tone="neutral"
                surface="solid"
                onClick={handleSubmit}
                disabled={isSubmitting}
                className="rounded-lg border border-emerald-200 bg-emerald-100 font-black text-emerald-900 hover:bg-emerald-200"
              >
                {isSubmitting ? t('documents.sending') : t('documents.confirm_send')}
              </Button>
            </div>
          </div>
        </div>
        )}
      </div>
    </>
  )
}

function Calendar(props: any) {
  return (
    <svg
      {...props}
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect width="18" height="18" x="3" y="4" rx="2" ry="2" />
      <line x1="16" x2="16" y1="2" y2="6" />
      <line x1="8" x2="8" y1="2" y2="6" />
      <line x1="3" x2="21" y1="10" y2="10" />
    </svg>
  )
}
