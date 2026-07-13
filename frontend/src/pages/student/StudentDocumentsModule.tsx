import { useState, useRef, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Bot, Copy, Layers, MessageSquare, Plus, Save, Sparkles, Trash2, Monitor, FileText, ChevronLeft, ChevronRight, Send, CheckCircle, FileSpreadsheet, BookOpen, PenTool, Share2, User, Clock, MonitorPlay, Search, X
} from 'lucide-react'
import { studentApi, filesApi, llmApi } from '@/lib/api'
import { useToast } from '@/components/ui/use-toast'
import { SlideEditor, SlideBlock, SlideBlockType, SlideSnapOptions, DEFAULT_SLIDE_SNAP_OPTIONS } from '@/components/SlideEditor'
import { createShapeBlock } from '@/lib/slideBlocks'
import { RichTextEditor } from '@/components/RichTextEditor'
import { UnifiedToolbar } from '@/components/UnifiedToolbar'
import { SheetChartConfig, SpreadsheetEditor } from '@/components/SpreadsheetEditor'
import { CollaborativeCanvas } from '@/components/CollaborativeCanvas'
import { Editor } from '@tiptap/react'
import { useTranslation } from 'react-i18next'

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
}

export default function StudentDocumentsModule({ sessionId, openLessonTaskId }: StudentDocumentsModuleProps) {
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
  const [docSearch, setDocSearch] = useState('')
  const [draftId, setDraftId] = useState<string | null>(null)
  const [isReadOnlyLesson, setIsReadOnlyLesson] = useState(false)
  const [activeLessonTaskId, setActiveLessonTaskId] = useState<string | null>(null)

  // Editor State
  const [editor, setEditor] = useState<Editor | null>(null)

  // Slide Editor State
  const [currentSlideIndex, setCurrentSlideIndex] = useState(0)
  const [scale, setScale] = useState(1)
  const [docScale, setDocScale] = useState(1)
  const [docMargins, setDocMargins] = useState({ vertical: 56, horizontal: 56 })
  const [showRuledLines, setShowRuledLines] = useState(false)
  const [selectedBlockId, setSelectedBlockId] = useState<string | null>(null)
  const [snapOptions, setSnapOptions] = useState<SlideSnapOptions>(DEFAULT_SLIDE_SNAP_OPTIONS)

  // Refs
  const canvasRef = useRef<HTMLDivElement>(null)
  const documentPageRef = useRef<HTMLDivElement>(null)
  const toolbarHostRef = useRef<HTMLDivElement>(null)

  // UI State
  const [showSubmitModal, setShowSubmitModal] = useState(false)
  const [showNewModal, setShowNewModal] = useState(false)
  const [draggingMargin, setDraggingMargin] = useState<'left' | 'right' | null>(null)
  const [aiPanelAnchor, setAiPanelAnchor] = useState<{ x: number; y: number } | null>(null)
  const [aiOpenRequestId, setAiOpenRequestId] = useState(0)
  const [viewMode, setViewMode] = useState<'list' | 'editor'>('list')
  const [presentationTemplates, setPresentationTemplates] = useState<PresentationTemplate[]>([])
  const [presentationChatOpen, setPresentationChatOpen] = useState(false)
  const [presentationChatInput, setPresentationChatInput] = useState('')
  const [presentationChatMessages, setPresentationChatMessages] = useState<{ role: 'user' | 'assistant'; content: string }[]>([])
  const [isPresentationAgentRunning, setIsPresentationAgentRunning] = useState(false)

  const currentSlide = document.slides?.[currentSlideIndex] || { id: 'fallback', title: 'Slide', blocks: [] }
  const selectedBlock = currentSlide.blocks.find(b => b.id === selectedBlockId)

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
    if (isReadOnlyLesson) return
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
  }, [sessionId])

  useEffect(() => {
    if (viewMode !== 'editor') return
    if (isReadOnlyLesson) return
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
  }, [document, mode, docMargins, isReadOnlyLesson, viewMode])

  const loadDocumentFromJson = (
    doc: { id: string; title: string; type: 'presentation' | 'document' | 'sheet' | 'canvas' | 'pdf' | 'web'; contentJson: string },
    options?: { readOnlyLesson?: boolean; lessonTaskId?: string | null }
  ) => {
    try {
      const content = JSON.parse(doc.contentJson)
      setIsReadOnlyLesson(Boolean(options?.readOnlyLesson))
      setActiveLessonTaskId(options?.lessonTaskId || null)

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
        setDraftId(options?.readOnlyLesson ? null : doc.id)
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
        setDraftId(options?.readOnlyLesson ? null : doc.id)
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
        setDraftId(options?.readOnlyLesson ? null : doc.id)
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
        setDraftId(options?.readOnlyLesson ? null : doc.id)
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
    loadDocumentFromJson(doc, { readOnlyLesson: false, lessonTaskId: null })
  }

  const loadLesson = (doc: LessonDocument) => {
    loadDocumentFromJson(
      {
        id: doc.id,
        title: doc.title,
        type: doc.type,
        contentJson: doc.contentJson,
      },
      { readOnlyLesson: true, lessonTaskId: doc.taskId }
    )
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
  }, [document.format, mode, showSidebar])

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
    if (mode !== 'slides' || isReadOnlyLesson) return
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

  const handlePresentationChatSubmit = async () => {
    const prompt = presentationChatInput.trim()
    if (!prompt || mode !== 'slides' || isReadOnlyLesson || isPresentationAgentRunning) return
    const dims = FORMAT_DIMENSIONS[document.format]
    const lower = prompt.toLowerCase()
    setPresentationChatMessages(prev => [...prev, { role: 'user', content: prompt }])
    setPresentationChatInput('')

    if (lower.includes('template') && (lower.includes('salva') || lower.includes('save'))) {
      saveCurrentPresentationAsTemplate()
      setPresentationChatMessages(prev => [...prev, { role: 'assistant', content: isEnglishUi ? 'I saved the current deck as a reusable template.' : 'Ho salvato questa presentazione come template riutilizzabile.' }])
      return
    }

    setIsPresentationAgentRunning(true)
    setPresentationChatMessages(prev => [
      ...prev,
      {
        role: 'assistant',
        content: isEnglishUi
          ? 'Strategist is reading the brief. Art director and composer will build structure, style and editable slides.'
          : 'Lo strategist sta leggendo il brief. Art director e composer costruiranno struttura, stile e slide editabili.'
      }
    ])

    try {
      const response = await llmApi.presentationAgent({
        prompt,
        mode: lower.includes('modifica') || lower.includes('cambia') || lower.includes('aggiungi') || lower.includes('add') || lower.includes('change') || lower.includes('refine') ? 'edit' : 'create',
        format: document.format,
        dims: { width: dims.width, height: dims.height },
        current_presentation: {
          title: document.title,
          format: document.format,
          currentSlideIndex,
          slides: document.slides,
        },
      })
      const data = response.data as {
        title?: string
        format?: Format
        slides?: Slide[]
        agent_steps?: { agent?: string; summary?: string }[]
      }
      if (!Array.isArray(data.slides) || data.slides.length === 0) {
        throw new Error(isEnglishUi ? 'The agent did not return renderable slides.' : 'L’agente non ha restituito slide renderizzabili.')
      }
      setDocument(prev => ({
        ...prev,
        title: data.title || prev.title,
        format: data.format || prev.format,
        slides: data.slides!,
      }))
      setCurrentSlideIndex(0)
      setSelectedBlockId(null)
      const steps = (data.agent_steps || [])
        .map(step => `${step.agent || 'Agent'}: ${step.summary || ''}`.trim())
        .filter(Boolean)
        .join('\n')
      setPresentationChatMessages(prev => [
        ...prev,
        {
          role: 'assistant',
          content: steps
            ? `${steps}\n\n${isEnglishUi ? 'Done: I applied the generated editable deck to the canvas.' : 'Fatto: ho applicato al canvas la presentazione editabile generata.'}`
            : (isEnglishUi ? 'Done: I applied the generated editable deck to the canvas.' : 'Fatto: ho applicato al canvas la presentazione editabile generata.')
        }
      ])
    } catch (error: any) {
      setPresentationChatMessages(prev => [
        ...prev,
        {
          role: 'assistant',
          content: error?.response?.data?.detail || error?.message || (isEnglishUi ? 'Presentation agent failed.' : 'Agente presentazione non riuscito.')
        }
      ])
    } finally {
      setIsPresentationAgentRunning(false)
    }
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
    if (isReadOnlyLesson) return
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
    const filteredDrafts = draftDocuments.filter(d => fuzzyMatch(docSearch, d.title, d.type))
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
                  {isEnglishUi ? 'Drafts, teacher materials, and deliverables' : 'Bozze, materiali del docente e consegne'}
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
                <div className="mt-5 flex justify-center">
                  <Button tone="neutral" surface="solid" onClick={() => setShowNewModal(true)} className="px-4">
                    <Plus className="h-4 w-4 mr-2" />
                    {t('documents.new')}
                  </Button>
                </div>
              </div>
            </div>
          </section>

          <div className="flex-1 overflow-y-auto px-4 pb-8 pt-5 md:px-6">
            <div className="mx-auto w-full max-w-6xl space-y-8">

              {docSearch && filteredDrafts.length === 0 && filteredLessons.length === 0 && (
                <p className="text-center text-sm text-slate-400 py-12">
                  {isEnglishUi ? `No document matches "${docSearch}"` : `Nessun documento corrisponde a "${docSearch}"`}
                </p>
              )}

              {!docSearch && draftDocuments.length === 0 && lessonDocuments.length === 0 && (
                <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-slate-300 bg-white px-6 py-20 text-center shadow-sm">
                  <div className="w-20 h-20 rounded-xl border border-emerald-200 bg-emerald-100 flex items-center justify-center mb-5 shadow-sm">
                    <FileText className="h-10 w-10 text-emerald-800" />
                  </div>
                  <h3 className="text-lg font-black text-slate-950 mb-1">{isEnglishUi ? 'No documents yet' : 'Nessun documento'}</h3>
                  <p className="text-sm text-slate-500 mb-6">{isEnglishUi ? 'Create your first document to get started' : 'Crea il tuo primo documento per iniziare'}</p>
                  <Button tone="neutral" surface="solid" onClick={() => setShowNewModal(true)}>
                    <Plus className="h-4 w-4 mr-2" />
                    {isEnglishUi ? 'Create document' : 'Crea documento'}
                  </Button>
                </div>
              )}

              {filteredDrafts.length > 0 && (
                <section>
                  <div className="mb-3 flex items-center justify-between">
                    <h2 className="text-[11px] font-black uppercase tracking-[0.18em] text-slate-600">{t('documents.my_drafts')}</h2>
                    <span className="rounded-full border border-emerald-200 bg-emerald-100 px-2 py-0.5 text-[10px] font-black text-emerald-800">{filteredDrafts.length}</span>
                  </div>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                    {filteredDrafts.map(doc => (
                      <div
                        key={doc.id}
                        onClick={() => loadDraft(doc)}
                        className={`group relative min-h-[148px] cursor-pointer overflow-hidden rounded-[24px] border p-4 shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-lg ${docCardStyle(doc.type)}`}
                      >
                        <div className={`w-11 h-11 rounded-lg mb-3 flex items-center justify-center shadow-sm ${docColor(doc.type)}`}>
                          {docIcon(doc.type)}
                        </div>
                        <span className={`absolute right-9 top-4 rounded-full border px-2.5 py-1 text-[10px] font-black ${docBadge(doc.type)}`}>{docLabel(doc.type)}</span>
                        <p className="text-sm font-black text-slate-950 truncate mb-1">{doc.title}</p>
                        <p className="text-[11px] font-medium text-slate-500">{new Date(doc.updatedAt).toLocaleDateString(dateLocale, { day: 'numeric', month: 'short', year: 'numeric' })}</p>
                        <button
                          onClick={(e) => handleDeleteDraft(e, doc.id)}
                          className="absolute right-3 top-3 rounded-lg p-1 text-slate-400 opacity-0 transition-all hover:bg-red-50 hover:text-red-600 group-hover:opacity-100"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                </section>
              )}

              {filteredLessons.length > 0 && (() => {
                // Group by udaFolder; non-UDA docs go under undefined key
                const udaFolders: Record<string, LessonDocument[]> = {}
                const regularLessons: LessonDocument[] = []
                filteredLessons.forEach(doc => {
                  if (doc.udaFolder) {
                    if (!udaFolders[doc.udaFolder]) udaFolders[doc.udaFolder] = []
                    udaFolders[doc.udaFolder].push(doc)
                  } else {
                    regularLessons.push(doc)
                  }
                })
                const LessonCard = ({ doc }: { doc: LessonDocument }) => (
                  <div
                    key={doc.id}
                    onClick={() => loadLesson(doc)}
                    className={`group relative min-h-[148px] cursor-pointer overflow-hidden rounded-[24px] border p-4 shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-lg ${docCardStyle(doc.type)}`}
                  >
                    <div className={`w-11 h-11 rounded-lg mb-3 flex items-center justify-center shadow-sm ${docColor(doc.type)}`}>
                      {docIcon(doc.type)}
                    </div>
                    <span className={`absolute right-4 top-4 rounded-full border px-2.5 py-1 text-[10px] font-black ${docBadge(doc.type)}`}>{docLabel(doc.type)}</span>
                    <p className="text-sm font-black text-slate-950 truncate mb-1">{doc.title}</p>
                    <p className="text-[11px] font-medium text-slate-500">{doc.authorName} · {new Date(doc.updatedAt).toLocaleDateString(dateLocale, { day: 'numeric', month: 'short', year: 'numeric' })}</p>
                    <div className="mt-2 inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-100 px-2 py-0.5 text-[10px] font-black text-emerald-800">
                      <BookOpen className="h-3 w-3" />
                      {t('documents.read_only')}
                    </div>
                  </div>
                )
                return (
                  <>
                    {regularLessons.length > 0 && (
                      <section>
                        <h2 className="mb-3 text-[11px] font-black uppercase tracking-[0.18em] text-slate-600">{t('documents.teacher_materials')}</h2>
                        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                          {regularLessons.map(doc => <LessonCard key={doc.id} doc={doc} />)}
                        </div>
                      </section>
                    )}
                    {Object.entries(udaFolders).map(([folderName, docs]) => (
                      <section key={folderName}>
                        <h2 className="mb-3 text-[11px] font-black uppercase tracking-[0.18em] text-slate-600">📁 {folderName}</h2>
                        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                          {docs.map(doc => <LessonCard key={doc.id} doc={doc} />)}
                        </div>
                      </section>
                    ))}
                  </>
                )
              })()}
            </div>
          </div>
        </div>

        {showNewModal && (
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

  return (
    <>
      <div className="h-full flex flex-col bg-slate-100 overflow-hidden">

        {/* Header / Meta-Toolbar */}
        <div className="border-b border-slate-200/80 bg-white/90 px-4 py-3 z-20 shadow-sm shrink-0">
          <div className="mx-auto flex max-w-7xl items-center justify-between gap-4">
          <div className="flex min-w-0 items-center gap-3">
             <Button
               variant="ghost"
               size="sm"
               onClick={() => setViewMode('list')}
               className="rounded-lg border border-emerald-200 bg-white text-emerald-800 gap-1 hover:bg-emerald-50"
             >
               <ChevronLeft className="h-4 w-4" />
               {t('documents.title_my_documents')}
             </Button>

             <Button
               variant="ghost"
               size="sm"
               onClick={() => setShowSidebar(!showSidebar)}
               className="mr-1 rounded-lg border border-emerald-200 bg-white text-emerald-800 shadow-sm hover:bg-emerald-50"
             >
               {showSidebar ? <ChevronLeft className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
             </Button>

             <Button
               tone="neutral"
               surface="solid"
               onClick={() => setShowNewModal(true)}
               className="rounded-lg border border-emerald-200 bg-emerald-100 px-4 font-black text-emerald-800 hover:bg-emerald-200"
             >
               <Plus className="h-4 w-4 mr-2" />
               {t('documents.new')}
             </Button>

             <div className="h-6 w-px bg-slate-200" />

             <Input
               value={document.title}
               onChange={(e) => handleTitleChange(e.target.value)}
               disabled={isReadOnlyLesson}
               className="w-64 border-slate-300 bg-white font-black text-lg text-slate-950 shadow-sm hover:border-slate-400 focus:border-slate-600"
               placeholder={filenamePlaceholder}
             />
             {isReadOnlyLesson && (
               <span className="inline-flex items-center rounded-full border border-emerald-200 bg-emerald-100 px-2.5 py-1 text-xs font-black text-emerald-800">
                 {isEnglishUi ? 'Lesson' : 'Lezione'}
               </span>
             )}
          </div>

          <div className="flex shrink-0 gap-2">
             {mode === 'slides' && !isReadOnlyLesson && (
               <>
                 <Button
                   variant="outline"
                   onClick={() => setPresentationChatOpen(v => !v)}
                   className="rounded-lg border-slate-200 bg-white font-bold text-slate-700"
                 >
                   <Bot className="h-4 w-4 mr-2" />
                   {isEnglishUi ? 'Presentation AI' : 'AI presentazione'}
                 </Button>
                 <Button
                   variant="outline"
                   onClick={saveCurrentPresentationAsTemplate}
                   className="rounded-lg border-slate-200 bg-white font-bold text-slate-700"
                 >
                   <Save className="h-4 w-4 mr-2" />
                   Template
                 </Button>
               </>
             )}
             {isReadOnlyLesson ? (
               <Button variant="outline" disabled>
                 <BookOpen className="h-4 w-4 mr-2" />
                 {isEnglishUi ? 'Teacher content (read only)' : 'Contenuto del docente (sola lettura)'}
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

        {/* Unified Toolbar */}
        {!isReadOnlyLesson && mode !== 'sheet' && mode !== 'canvas' && mode !== 'pdf' && mode !== 'web' && (
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
              if (!toolbarHostRef.current) return
              const rect = toolbarHostRef.current.getBoundingClientRect()
              setAiPanelAnchor({
                x: Math.max(20, rect.right - 360),
                y: rect.bottom + 8
              })
              setAiOpenRequestId(v => v + 1)
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

        {mode === 'slides' && selectedBlock && !isReadOnlyLesson && (
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
          <div className={`${showSidebar ? 'w-72' : 'w-0'} bg-white/85 border-r border-slate-200 flex flex-col transition-all duration-300 overflow-hidden shrink-0 shadow-sm`}>

            {/* Slide Navigation (Only in Slide Mode) */}
            {mode === 'slides' && !isReadOnlyLesson && (
              <div className="flex-shrink-0 flex flex-col overflow-hidden max-h-64 border-b">
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

            <div className="flex-1 overflow-y-auto p-3 space-y-6">
              {mode === 'slides' && !isReadOnlyLesson && (
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
              <div className="p-4 bg-emerald-50 border-t flex items-center justify-center gap-2">
                <CheckCircle className="h-4 w-4 text-emerald-600" />
                <span className="text-xs font-bold text-emerald-700 uppercase tracking-tight">{t('documents.sent_status')}</span>
              </div>
            )}
          </div>

          {/* Main Area */}
          <div className="flex-1 bg-slate-100 flex items-start justify-center p-4 md:p-6 relative overflow-y-auto"
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
                   minHeight: FORMAT_DIMENSIONS.a4.height,
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
                      readOnly={isReadOnlyLesson}
                      contentClassName="h-full min-h-full max-w-none focus:outline-none p-0 cursor-text [&_.ProseMirror]:min-h-full [&_.ProseMirror]:h-full [&_.ProseMirror]:text-[16px] [&_.ProseMirror]:leading-7 [&_.ProseMirror_p]:m-0 [&_.ProseMirror_h1]:m-0 [&_.ProseMirror_h2]:m-0 [&_.ProseMirror_h3]:m-0 [&_.ProseMirror_ul]:my-0 [&_.ProseMirror_ol]:my-0"
                      aiPanelAnchor={aiPanelAnchor}
                      aiOpenRequestId={aiOpenRequestId}
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
               <div
                 ref={canvasRef}
                 className="bg-white shadow-xl relative transition-transform origin-center flex flex-col"
                 style={{
                   width: FORMAT_DIMENSIONS[document.format].width,
                   height: FORMAT_DIMENSIONS[document.format].height,
                   transform: `scale(${scale})`,
                   marginTop: '20px'
                 }}
                 onClick={(e) => e.stopPropagation()}
               >
                  <div className="absolute top-0 left-0 right-0 p-8 z-10 pointer-events-none">
                     <input
                       value={currentSlide.title}
                       onChange={(e) => {
                         const newSlides = [...document.slides]
                         newSlides[currentSlideIndex].title = e.target.value
                         setDocument(d => ({ ...d, slides: newSlides }))
                       }}
                       disabled={isReadOnlyLesson}
                       className="text-4xl font-bold bg-transparent border-none focus:outline-none w-full placeholder-slate-300 pointer-events-auto"
                       placeholder={t('documents.slide_title_placeholder')}
                     />
                  </div>

                  <div className="flex-1 relative">
                    <SlideEditor
                      blocks={currentSlide.blocks}
                      onChange={updateSlideBlocks}
                      selectedBlockId={selectedBlockId}
                      onSelectBlock={setSelectedBlockId}
                      scale={scale}
                      readOnly={isReadOnlyLesson}
                      slideWidth={FORMAT_DIMENSIONS[document.format].width}
                      slideHeight={FORMAT_DIMENSIONS[document.format].height}
                      snapOptions={snapOptions}
                      onContextAddBlock={addSlideBlock}
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
                  readOnly={isReadOnlyLesson}
                 />
               </div>
             )}

          </div>
          {mode === 'slides' && presentationChatOpen && !isReadOnlyLesson && (
            <aside className="flex w-[340px] shrink-0 flex-col border-l border-slate-200 bg-white shadow-sm">
              <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
                <div className="min-w-0">
                  <h3 className="flex items-center gap-2 text-sm font-black text-slate-950">
                    <MessageSquare className="h-4 w-4 text-emerald-700" />
                    {isEnglishUi ? 'Presentation agent' : 'Agente presentazione'}
                  </h3>
                  <p className="mt-0.5 text-[11px] font-medium text-slate-500">
                    {isEnglishUi ? 'Create slides, layouts and edits.' : 'Crea slide, impaginati e modifiche.'}
                  </p>
                </div>
                <button className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700" onClick={() => setPresentationChatOpen(false)}>
                  <X className="h-4 w-4" />
                </button>
              </div>
              <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
                {presentationChatMessages.length === 0 && (
                  <div className="rounded-lg border border-emerald-100 bg-emerald-50 p-3 text-xs leading-5 text-emerald-900">
                    {isEnglishUi
                      ? 'Describe what you want to represent. Example: create an elegant presentation about photosynthesis with diagrams and a final summary.'
                      : 'Descrivi cosa vuoi rappresentare. Esempio: crea una presentazione elegante sulla fotosintesi con schemi e sintesi finale.'}
                  </div>
                )}
                {presentationChatMessages.map((message, index) => (
                  <div
                    key={`${message.role}-${index}`}
                    className={`whitespace-pre-line rounded-lg px-3 py-2 text-sm leading-5 ${
                      message.role === 'user'
                        ? 'ml-8 bg-slate-950 text-white'
                        : 'mr-8 border border-slate-200 bg-slate-50 text-slate-800'
                    }`}
                  >
                    {message.content}
                  </div>
                ))}
              </div>
              <div className="border-t border-slate-200 p-3">
                <div className="mb-2 flex flex-wrap gap-1.5">
                  {[
                    isEnglishUi ? 'Create a complete deck' : 'Crea presentazione completa',
                    isEnglishUi ? 'Add a summary slide' : 'Aggiungi slide sintesi',
                    isEnglishUi ? 'Refine current slide' : 'Modifica slide corrente',
                    isEnglishUi ? 'Save as template' : 'Salva come template',
                  ].map(sample => (
                    <button
                      key={sample}
                      type="button"
                      className="rounded-full border border-slate-200 bg-white px-2 py-1 text-[11px] font-bold text-slate-600 hover:bg-slate-50"
                      onClick={() => setPresentationChatInput(sample)}
                    >
                      {sample}
                    </button>
                  ))}
                </div>
                <form
                  onSubmit={(e) => {
                    e.preventDefault()
                    handlePresentationChatSubmit()
                  }}
                  className="flex gap-2"
                >
                  <textarea
                    value={presentationChatInput}
                    onChange={(e) => setPresentationChatInput(e.target.value)}
                    placeholder={isEnglishUi ? 'Describe the presentation...' : 'Descrivi la presentazione...'}
                    disabled={isPresentationAgentRunning}
                    className="min-h-[76px] flex-1 resize-none rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-emerald-200"
                  />
                  <Button type="submit" size="icon" disabled={isPresentationAgentRunning || !presentationChatInput.trim()} className="h-[76px] w-10 rounded-lg bg-emerald-700 text-white hover:bg-emerald-800 disabled:opacity-60">
                    <Sparkles className="h-4 w-4" />
                  </Button>
                </form>
              </div>
            </aside>
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
