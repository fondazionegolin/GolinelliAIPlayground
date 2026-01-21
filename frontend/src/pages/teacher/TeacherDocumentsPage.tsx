import { useState, useRef, useEffect } from 'react'
import { TeacherNavbar } from '@/components/TeacherNavbar'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { 
  Plus, Trash2, Image as ImageIcon, Type, 
  Wand2, Upload, Monitor, FileText,
  Bold, Italic, Underline, List, AlignLeft, AlignCenter, AlignRight,
  Maximize2, Minimize2, PenTool, BookOpen, ChevronLeft, ChevronRight
} from 'lucide-react'
import { teacherApi, llmApi } from '@/lib/api'
import { useToast } from '@/components/ui/use-toast'
import { useQuery } from '@tanstack/react-query'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription
} from "@/components/ui/dialog"

// Types
type Format = 'a4' | '16:9' | '4:3'
type EditorMode = 'slides' | 'document'

interface BlockStyle {
  backgroundColor?: string
  color?: string
  fontSize?: number
  fontFamily?: string
  textAlign?: 'left' | 'center' | 'right'
  borderRadius?: number
  padding?: number
}

interface Block {
  id: string
  type: 'text' | 'image'
  content: string // text content or image URL
  x: number
  y: number
  width: number
  height: number
  style: BlockStyle
}

interface Slide {
  id: string
  title: string
  blocks: Block[]
  backgroundColor?: string
}

interface Document {
  id: string
  title: string
  format: Format
  slides: Slide[]
  textContent?: string // For generic text document mode
}

// Stored Document Metadata for Sidebar
interface StoredDocument {
  id: string
  title: string
  type: 'presentation' | 'document'
  updatedAt: string
  sessionId: string
  sessionName: string
  contentJson: string
}

// Format dimensions (relative units or pixels for canvas)
const FORMAT_DIMENSIONS = {
  '16:9': { width: 960, height: 540, label: '16:9 (Presentazione)' },
  '4:3': { width: 800, height: 600, label: '4:3 (Standard)' },
  'a4': { width: 794, height: 1123, label: 'A4 (Documento)' } // A4 at 96 DPI
}

export default function TeacherDocumentsPage() {
  const { toast } = useToast()
  
  // State
  const [mode, setMode] = useState<EditorMode>('document') // Default to document as requested
  const [document, setDocument] = useState<Document>({
    id: crypto.randomUUID(),
    title: 'Nuovo Documento',
    format: 'a4',
    slides: [
      { id: crypto.randomUUID(), title: 'Slide 1', blocks: [] }
    ],
    textContent: '<h1>Titolo del documento</h1><p>Inizia a scrivere qui...</p>'
  })
  
  // Sidebar State
  const [showSidebar, setShowSidebar] = useState(true)
  const [storedDocuments, setStoredDocuments] = useState<StoredDocument[]>([])
  const [isLoadingDocs, setIsLoadingDocs] = useState(false)

  // Slide Editor State
  const [currentSlideIndex, setCurrentSlideIndex] = useState(0)
  const [selectedBlockId, setSelectedBlockId] = useState<string | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [scale, setScale] = useState(1)
  
  // Refs
  const canvasRef = useRef<HTMLDivElement>(null)
  const textEditorRef = useRef<HTMLDivElement>(null)
  
  // UI State
  const [showPublishModal, setShowPublishModal] = useState(false)
  const [selectedSessionId, setSelectedSessionId] = useState('')

  // AI Modal State
  const [showAIModal, setShowAIModal] = useState(false)
  const [aiSelectedText, setAiSelectedText] = useState('')
  const selectionRangeRef = useRef<Range | null>(null)
  const [isAiLoading, setIsAiLoading] = useState(false)

  const currentSlide = document.slides?.[currentSlideIndex] || { id: 'fallback', title: 'Slide', blocks: [] }
  const selectedBlock = currentSlide.blocks?.find(b => b.id === selectedBlockId)

  // Fetch classes and sessions for publishing
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

  // Load existing documents (tasks)
  useEffect(() => {
    const fetchDocuments = async () => {
      if (!classesData || classesData.length === 0) return
      
      setIsLoadingDocs(true)
      const docs: StoredDocument[] = []
      
      for (const session of classesData) {
        try {
          const tasksRes = await teacherApi.getTasks(session.id)
          const tasks = tasksRes.data || []
          
          tasks.forEach((t: any) => {
            if (t.content_json) {
              try {
                const content = JSON.parse(t.content_json)
                if (content.type === 'document_v1' || content.type === 'presentation_v2' || 
                    t.task_type === 'presentation' || (t.task_type === 'lesson' && content.sections)) {
                  
                  docs.push({
                    id: t.id,
                    title: t.title,
                    type: (content.type === 'presentation_v2' || t.task_type === 'presentation') ? 'presentation' : 'document',
                    updatedAt: t.created_at,
                    sessionId: session.id,
                    sessionName: session.name,
                    contentJson: t.content_json
                  })
                }
              } catch (e) {
                // Ignore
              }
            }
          })
        } catch (e) {
          console.error(`Error fetching tasks for session ${session.id}`, e)
        }
      }
      
      docs.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
      setStoredDocuments(docs)
      setIsLoadingDocs(false)
    }

    fetchDocuments()
  }, [classesData])

  // Load a document into editor
  const loadDocument = (doc: StoredDocument) => {
    try {
      const content = JSON.parse(doc.contentJson)
      
      if (doc.type === 'presentation' || content.type === 'presentation_v2' || content.slides) {
        setMode('slides')
        
        // Normalize slides ensuring they have required fields
        const safeSlides = (content.slides && Array.isArray(content.slides) && content.slides.length > 0) 
          ? content.slides.map((s: any) => ({
              id: s.id || crypto.randomUUID(),
              title: s.title || 'Slide',
              blocks: s.blocks || [] // Ensure blocks exists
            }))
          : [{ id: crypto.randomUUID(), title: 'Slide 1', blocks: [] }]

        setDocument({
          id: doc.id,
          title: doc.title,
          format: content.format || '16:9',
          slides: safeSlides,
          textContent: ''
        })
        setCurrentSlideIndex(0)
      } else {
        setMode('document')
        setDocument({
          id: doc.id,
          title: doc.title,
          format: 'a4',
          slides: [], // Empty slides for doc mode
          textContent: content.htmlContent || content.content || ''
        })
      }
      
      toast({ title: "Documento caricato", description: `Hai aperto "${doc.title}"` })
    } catch (e) {
      console.error(e)
      toast({ title: "Errore caricamento", description: "Impossibile aprire questo documento.", variant: "destructive" })
    }
  }

  // Fit canvas to screen (Slide Mode)
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

  // --- Actions ---

  const switchMode = (newMode: EditorMode) => {
    setMode(newMode)
    if (newMode === 'document') {
      setDocument(d => ({ ...d, format: 'a4' }))
    } else {
      setDocument(d => ({ ...d, format: '16:9' }))
    }
  }

  const addSlide = () => {
    const newSlide: Slide = {
      id: crypto.randomUUID(),
      title: `Slide ${document.slides.length + 1}`,
      blocks: []
    }
    setDocument(prev => ({
      ...prev,
      slides: [...prev.slides, newSlide]
    }))
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

  const addBlock = (type: 'text' | 'image') => {
    const dims = FORMAT_DIMENSIONS[document.format]
    const newBlock: Block = {
      id: crypto.randomUUID(),
      type,
      content: type === 'text' ? 'Doppio click per modificare' : 'https://placehold.co/400x300?text=Immagine',
      x: dims.width / 2 - 100,
      y: dims.height / 2 - (type === 'text' ? 50 : 150),
      width: 200,
      height: type === 'text' ? 100 : 300,
      style: {
        fontSize: 16,
        color: '#000000',
        backgroundColor: type === 'text' ? '#ffffff00' : undefined,
        padding: 10
      }
    }
    updateSlideBlocks([...currentSlide.blocks, newBlock])
    setSelectedBlockId(newBlock.id)
  }

  const updateSlideBlocks = (blocks: Block[]) => {
    const newSlides = [...document.slides]
    newSlides[currentSlideIndex] = { ...newSlides[currentSlideIndex], blocks }
    setDocument(prev => ({ ...prev, slides: newSlides }))
  }

  const updateBlock = (id: string, updates: Partial<Block>) => {
    const newBlocks = currentSlide.blocks.map(b => b.id === id ? { ...b, ...updates } : b)
    updateSlideBlocks(newBlocks)
  }

  const updateBlockStyle = (id: string, styleUpdates: Partial<BlockStyle>) => {
    const block = currentSlide.blocks.find(b => b.id === id)
    if (block) {
      updateBlock(id, { style: { ...block.style, ...styleUpdates } })
    }
  }

  const handleMouseDown = (e: React.MouseEvent, blockId: string) => {
    e.stopPropagation()
    const block = currentSlide.blocks.find(b => b.id === blockId)
    if (!block) return
    setSelectedBlockId(blockId)
    setIsDragging(true)
  }

  const handleCanvasMouseMove = (e: React.MouseEvent) => {
    if (!isDragging || !selectedBlockId) return
    const canvas = canvasRef.current
    if (!canvas) return
    const rect = canvas.getBoundingClientRect()
    const x = (e.clientX - rect.left) / scale
    const y = (e.clientY - rect.top) / scale
    
    updateBlock(selectedBlockId, {
      x: x - (currentSlide.blocks.find(b => b.id === selectedBlockId)?.width || 100) / 2,
      y: y - (currentSlide.blocks.find(b => b.id === selectedBlockId)?.height || 50) / 2
    })
  }

  const handleMouseUp = () => {
    setIsDragging(false)
  }

  const isLocalUpdate = useRef(false)

  const execCmd = (command: string, value: string | undefined = undefined) => {
    (window.document as any).execCommand(command, false, value)
    if (textEditorRef.current) {
      textEditorRef.current.focus()
    }
  }

  const handleTextContentChange = () => {
    if (textEditorRef.current) {
      isLocalUpdate.current = true
      setDocument(d => ({ ...d, textContent: textEditorRef.current?.innerHTML || '' }))
      setTimeout(() => { isLocalUpdate.current = false }, 0)
    }
  }

  useEffect(() => {
    if (textEditorRef.current && document.textContent !== textEditorRef.current.innerHTML && !isLocalUpdate.current) {
      textEditorRef.current.innerHTML = document.textContent || ''
    }
  }, [document.textContent])

  const handleAIButtonClick = () => {
    if (mode === 'slides') {
      handleSlideAI()
    } else {
      const selection = window.getSelection()
      if (selection && selection.rangeCount > 0 && selection.toString().trim().length > 0) {
        selectionRangeRef.current = selection.getRangeAt(0).cloneRange()
        setAiSelectedText(selection.toString().trim())
        setShowAIModal(true)
      } else {
        toast({ title: "Seleziona del testo", description: "Evidenzia il testo che vuoi elaborare con l'AI.", variant: "destructive" })
      }
    }
  }

  const handleSlideAI = async () => {
    if (!selectedBlock || selectedBlock.type !== 'text') {
      toast({ title: "Seleziona un blocco di testo", variant: "destructive" })
      return
    }
    
    try {
      toast({ title: "L'AI sta scrivendo...", duration: 2000 })
      const prompt = `Migliora questo testo per una slide (sii sintetico): "${selectedBlock.content}"`
      
      const response = await llmApi.teacherChat(
        prompt,
        [{ role: 'system', content: 'Sei un assistente didattico.' }],
        'teacher_support',
        'openai',
        'gpt-5-mini'
      )

      if (response.data && response.data.response) {
        updateBlock(selectedBlock.id, { content: response.data.response })
        toast({ title: "Testo aggiornato!" })
      }
    } catch (e) {
      toast({ title: "Errore AI", variant: "destructive" })
    }
  }

  const executeAIAction = async (action: 'expand' | 'summarize' | 'exercise' | 'complete') => {
    if (!aiSelectedText) return
    
    setIsAiLoading(true)
    try {
      let instruction = ""
      const shouldAppend = action === 'complete' || action === 'exercise'

      switch (action) {
        case 'expand': 
          instruction = "Riscrivi il seguente testo espandendolo con dettagli, esempi educativi e spiegazioni chiare. Mantieni il concetto originale ma rendilo più completo."; 
          break; 
        case 'summarize': 
          instruction = "Sintetizza il seguente testo mantenendo i punti chiave in modo chiaro e conciso."; 
          break; 
        case 'exercise': 
          instruction = "Genera un breve esercizio o una domanda di verifica basata ESCLUSIVAMENTE sul testo seguente. Non riscrivere il testo, fornisci solo l'esercizio."; 
          break; 
        case 'complete': 
          instruction = "Completa la frase o il concetto logico iniziato nel testo seguente. Non ripetere la parte iniziale, scrivi solo la continuazione coerente."; 
          break;
      }

      const prompt = `EDITOR_AI: TESTO DI PARTENZA: "${aiSelectedText}"

ISTRUZIONE: ${instruction}

CONTESTO DOCUMENTO: "${document.title}"`
      
      const systemPrompt = "Sei un assistente educativo per la produzione di materiali didattici. Rispondi ESCLUSIVAMENTE utilizzando codice HTML valido (usa tag <p>, <ul>, <li>, <strong>, <em>, ecc.) per formattare il testo. NON usare Markdown, NON usare blocchi codice ```html. Il tuo output sarà inserito direttamente in un editor WYSIWYG."

      const response = await llmApi.teacherChat(
        prompt,
        [{ role: 'system', content: systemPrompt }],
        'teacher_support',
        'openai',
        'gpt-5-mini'
      )

      if (response.data && response.data.response) {
        let newText = response.data.response
        newText = newText.replace(/```html/g, '').replace(/```/g, '')

        if (selectionRangeRef.current && textEditorRef.current) {
          textEditorRef.current.focus()
          
          const sel = window.getSelection()
          sel?.removeAllRanges()
          sel?.addRange(selectionRangeRef.current)
          
          if (shouldAppend) {
            sel?.collapseToEnd()
            if (action === 'exercise') newText = `<br/><hr/>${newText}`
            else newText = ` ${newText}`
          }
          
          execCmd('insertHTML', newText)
          handleTextContentChange()
        }
        
        setShowAIModal(false)
        toast({ title: "Contenuto generato!" })
      }
    } catch (e) {
      console.error(e)
      toast({ title: "Errore generazione AI", variant: "destructive" })
    } finally {
      setIsAiLoading(false)
    }
  }

  const handlePublish = async () => {
    if (!selectedSessionId) return
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
      } else {
        contentJson = JSON.stringify({
          type: 'document_v1',
          title: document.title,
          htmlContent: document.textContent
        })
        taskType = 'lesson'
      }

      await teacherApi.createTask(selectedSessionId, {
        title: document.title,
        description: `Documento creato con Golinelli AI Editor (${mode === 'slides' ? 'Presentazione' : 'Testo'})`,
        task_type: taskType,
        content_json: contentJson
      })

      setShowPublishModal(false)
      toast({ title: "Documento pubblicato!", className: "bg-green-500 text-white" })
    } catch (e) {
      toast({ title: "Errore pubblicazione", variant: "destructive" })
    }
  }

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) {
       const reader = new FileReader()
       reader.onload = (ev) => {
         const result = ev.target?.result as string
         if (mode === 'slides' && selectedBlockId) {
           updateBlock(selectedBlockId, { content: result })
         } else if (mode === 'document') {
            execCmd('insertImage', result)
            handleTextContentChange()
         }
       }
       reader.readAsDataURL(file)
    }
  }

  return (
    <>
      <TeacherNavbar />
      <div className="pt-16 h-screen flex flex-col bg-slate-100 overflow-hidden" onMouseUp={handleMouseUp}> 
        
        {/* Toolbar */}
        <div className="h-14 bg-white border-b flex items-center justify-between px-4 z-20 shadow-sm">
          <div className="flex items-center gap-4">
             <Button 
               variant="ghost" 
               size="sm"
               onClick={() => setShowSidebar(!showSidebar)}
               className="mr-2 text-slate-500"
             >
               {showSidebar ? <ChevronLeft className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
             </Button>

             <div className="flex items-center gap-2 bg-slate-100 p-1 rounded-md mr-2">
                <Button 
                  size="sm" 
                  variant={mode === 'document' ? 'secondary' : 'ghost'}
                  className={mode === 'document' ? 'shadow-sm bg-white' : ''}
                  onClick={() => switchMode('document')}
                >
                  <FileText className="h-4 w-4 mr-2" />
                  Documento
                </Button>
                <Button 
                  size="sm" 
                  variant={mode === 'slides' ? 'secondary' : 'ghost'}
                  className={mode === 'slides' ? 'shadow-sm bg-white' : ''}
                  onClick={() => switchMode('slides')}
                >
                  <Monitor className="h-4 w-4 mr-2" />
                  Slide
                </Button>
             </div>

             <div className="h-6 w-px bg-slate-200" />

             <Input 
               value={document.title}
               onChange={(e) => setDocument(d => ({ ...d, title: e.target.value }))}
               className="font-bold border-transparent hover:border-slate-200 focus:border-violet-500 w-64 text-lg"
               placeholder="Titolo documento..."
             />
          </div>
          
          <div className="flex gap-2">
             <Button variant="outline" onClick={() => setShowPublishModal(true)}>
               <Upload className="h-4 w-4 mr-2" />
               Pubblica
             </Button>
          </div>
        </div>

        {/* Text Editor Toolbar (Only in Document Mode) */}
        {mode === 'document' && (
          <div className="h-10 bg-white border-b flex items-center justify-center gap-1 px-4">
            <Button variant="ghost" size="sm" onClick={() => execCmd('bold')}><Bold className="h-4 w-4" /></Button>
            <Button variant="ghost" size="sm" onClick={() => execCmd('italic')}><Italic className="h-4 w-4" /></Button>
            <Button variant="ghost" size="sm" onClick={() => execCmd('underline')}><Underline className="h-4 w-4" /></Button>
            <div className="h-4 w-px bg-slate-200 mx-2" />
            <Button variant="ghost" size="sm" onClick={() => execCmd('justifyLeft')}><AlignLeft className="h-4 w-4" /></Button>
            <Button variant="ghost" size="sm" onClick={() => execCmd('justifyCenter')}><AlignCenter className="h-4 w-4" /></Button>
            <Button variant="ghost" size="sm" onClick={() => execCmd('justifyRight')}><AlignRight className="h-4 w-4" /></Button>
            <div className="h-4 w-px bg-slate-200 mx-2" />
            <Button variant="ghost" size="sm" onClick={() => execCmd('insertUnorderedList')}><List className="h-4 w-4" /></Button>
            <Button variant="ghost" size="sm" onClick={handleAIButtonClick} className="ml-2 text-violet-600 bg-violet-50 hover:bg-violet-100 border border-violet-200">
              <Wand2 className="h-3 w-3 mr-2" />
              AI Writer
            </Button>
          </div>
        )}

        <div className="flex-1 flex overflow-hidden"> 
          
          {/* LEFT SIDEBAR: Existing Documents */}
          <div className={`${showSidebar ? 'w-64' : 'w-0'} bg-white border-r flex flex-col transition-all duration-300 overflow-hidden`}>
            <div className="p-4 border-b bg-slate-50">
              <h3 className="font-semibold text-sm text-slate-700">I tuoi Documenti</h3>
            </div>
            <div className="flex-1 overflow-y-auto p-2">
              {isLoadingDocs && (
                <p className="text-xs text-center text-slate-400 py-4">Caricamento...</p>
              )}
              {!isLoadingDocs && storedDocuments.length === 0 && (
                <p className="text-xs text-center text-slate-400 py-4">Nessun documento trovato.</p>
              )}
              {storedDocuments.map((doc) => (
                <div 
                  key={doc.id}
                  onClick={() => loadDocument(doc)}
                  className="group flex items-start gap-3 p-3 rounded-lg hover:bg-slate-100 cursor-pointer transition-colors border border-transparent hover:border-slate-200 mb-1"
                >
                  <div className={`p-2 rounded-md ${doc.type === 'presentation' ? 'bg-indigo-100 text-indigo-600' : 'bg-emerald-100 text-emerald-600'}`}>
                    {doc.type === 'presentation' ? <Monitor className="h-4 w-4" /> : <FileText className="h-4 w-4" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-slate-700 truncate">{doc.title}</p>
                    <p className="text-xs text-slate-400 truncate">{new Date(doc.updatedAt).toLocaleDateString()}</p>
                  </div>
                </div>
              ))}
            </div>
            <div className="p-3 border-t bg-slate-50">
               <Button 
                 variant="outline" 
                 className="w-full text-xs"
                 onClick={() => {
                   setDocument({
                     id: crypto.randomUUID(),
                     title: 'Nuovo Documento',
                     format: 'a4',
                     slides: [{ id: crypto.randomUUID(), title: 'Slide 1', blocks: [] }],
                     textContent: '<h1>Titolo del documento</h1><p>Inizia a scrivere qui...</p>'
                   })
                   setMode('document')
                 }}
               >
                 <Plus className="h-3 w-3 mr-2" />
                 Nuovo
               </Button>
            </div>
          </div>

          {/* Sidebar Slides (Only in Slide Mode) */}
          {mode === 'slides' && (
            <div className="w-56 bg-white border-r flex flex-col overflow-y-auto">
               <div className="p-4 border-b flex justify-between items-center">
                 <span className="font-semibold text-sm">Slide</span>
                 <Button size="icon" variant="ghost" onClick={addSlide}>
                   <Plus className="h-4 w-4" />
                 </Button>
               </div>
               <div className="p-2 space-y-2">
                 {document.slides.map((slide, idx) => (
                   <div 
                     key={slide.id}
                     onClick={() => setCurrentSlideIndex(idx)}
                     className={`p-3 rounded-lg border cursor-pointer transition-all group relative ${currentSlideIndex === idx ? 'ring-2 ring-violet-500 bg-violet-50' : 'hover:bg-slate-50'}`}
                   >
                     <div className="text-xs font-bold text-slate-500 mb-1">#{idx + 1}</div>
                     <div className="text-sm truncate font-medium">{slide.title}</div>
                     <button 
                       onClick={(e) => { e.stopPropagation(); deleteSlide(idx); }}
                       className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 text-slate-400 hover:text-red-500"
                     >
                       <Trash2 className="h-3 w-3" />
                     </button>
                   </div>
                 ))}
               </div>
            </div>
          )}

          {/* Main Area */}
          <div className="flex-1 bg-slate-100 flex items-start justify-center p-8 relative overflow-y-auto"> 
             
             {/* MODE: DOCUMENT */}
             {mode === 'document' && (
               <div className="w-full max-w-[800px] bg-white min-h-[1100px] shadow-lg p-[50px] mb-20 outline-none print:shadow-none">
                  <div 
                    ref={textEditorRef}
                    contentEditable
                    className="outline-none min-h-[900px] text-lg leading-relaxed prose max-w-none empty:before:content-[attr(data-placeholder)] empty:before:text-slate-300"
                    onInput={handleTextContentChange}
                    suppressContentEditableWarning={true}
                    data-placeholder="Inizia a scrivere il tuo documento... Seleziona il testo per usare l'AI."
                  />
               </div>
             )}

             {/* MODE: SLIDES */}
             {mode === 'slides' && (
               <div 
                 ref={canvasRef}
                 className="bg-white shadow-xl relative transition-transform origin-center"
                 style={{
                   width: FORMAT_DIMENSIONS[document.format].width,
                   height: FORMAT_DIMENSIONS[document.format].height,
                   transform: `scale(${scale})`,
                   marginTop: '20px'
                 }}
                 onMouseMove={handleCanvasMouseMove}
               >
                  <div className="absolute top-0 left-0 right-0 p-8 z-10">
                     <input
                       value={currentSlide.title}
                       onChange={(e) => {
                         const newSlides = [...document.slides]
                         newSlides[currentSlideIndex].title = e.target.value
                         setDocument(d => ({ ...d, slides: newSlides }))
                       }}
                       className="text-4xl font-bold bg-transparent border-none focus:outline-none w-full placeholder-slate-300"
                       placeholder="Titolo Slide"
                     />
                  </div>

                  {currentSlide.blocks.map(block => (
                    <div
                      key={block.id}
                      onMouseDown={(e) => handleMouseDown(e, block.id)}
                      className={`absolute cursor-move group ${selectedBlockId === block.id ? 'ring-2 ring-violet-500' : 'hover:ring-1 hover:ring-slate-300'}`}
                      style={{
                        left: block.x,
                        top: block.y,
                        width: block.width,
                        height: block.height,
                        backgroundColor: block.style.backgroundColor,
                        borderRadius: block.style.borderRadius,
                      }}
                    >
                      {block.type === 'text' ? (
                        <textarea
                          value={block.content}
                          onChange={(e) => updateBlock(block.id, { content: e.target.value })}
                          className="w-full h-full bg-transparent resize-none focus:outline-none p-2"
                          style={{
                            color: block.style.color,
                            fontSize: block.style.fontSize,
                            fontFamily: block.style.fontFamily,
                            textAlign: block.style.textAlign
                          }}
                        />
                      ) : (
                        <img 
                          src={block.content} 
                          className="w-full h-full object-cover pointer-events-none" 
                          alt="block" 
                        />
                      )}
                      
                      {selectedBlockId === block.id && (
                        <button 
                           onClick={() => {
                              const newBlocks = currentSlide.blocks.filter(b => b.id !== block.id)
                              updateSlideBlocks(newBlocks)
                              setSelectedBlockId(null)
                           }}
                           className="absolute -top-3 -right-3 bg-red-500 text-white rounded-full p-1 shadow-md hover:scale-110 transition-transform"
                        >
                          <Trash2 className="h-3 w-3" />
                        </button>
                      )}
                    </div>
                  ))}
               </div>
             )}

          </div>

          {/* Properties Panel (Only in Slides Mode) */}
          {mode === 'slides' && (
            <div className="w-72 bg-white border-l p-4 flex flex-col gap-6 overflow-y-auto">
               <div>
                 <h3 className="text-xs font-bold text-slate-500 uppercase mb-3">Aggiungi Elemento</h3>
                 <div className="grid grid-cols-2 gap-2">
                   <Button variant="outline" onClick={() => addBlock('text')} className="h-20 flex flex-col gap-2">
                     <Type className="h-6 w-6 text-slate-600" />
                     <span className="text-xs">Testo</span>
                   </Button>
                   <Button variant="outline" onClick={() => addBlock('image')} className="h-20 flex flex-col gap-2">
                     <ImageIcon className="h-6 w-6 text-slate-600" />
                     <span className="text-xs">Immagine</span>
                   </Button>
                 </div>
               </div>

               {selectedBlock ? (
                 <div className="space-y-4 border-t pt-4">
                   <h3 className="text-xs font-bold text-violet-600 uppercase mb-3">Proprietà Blocco</h3>
                   
                   {selectedBlock.type === 'text' && (
                     <>
                        <div className="space-y-2">
                          <label className="text-xs">Dimensione Font</label>
                          <div className="flex items-center gap-2">
                            <Input 
                              type="number" 
                              value={selectedBlock.style.fontSize || 16} 
                              onChange={(e) => updateBlockStyle(selectedBlock.id, { fontSize: parseInt(e.target.value) })}
                            />
                            <span className="text-xs text-slate-500">px</span>
                          </div>
                        </div>

                        <div className="space-y-2">
                          <label className="text-xs">Colore Testo</label>
                          <Input 
                              type="color" 
                              value={selectedBlock.style.color || '#000000'} 
                              onChange={(e) => updateBlockStyle(selectedBlock.id, { color: e.target.value })}
                              className="h-10 p-1"
                          />
                        </div>

                        <Button 
                          onClick={handleAIButtonClick} 
                          className="w-full bg-gradient-to-r from-violet-500 to-purple-600 text-white shadow-md hover:from-violet-600 hover:to-purple-700"
                        >
                          <Wand2 className="h-4 w-4 mr-2" />
                          AI Completa Testo
                        </Button>
                     </>
                   )}

                   {selectedBlock.type === 'image' && (
                      <div className="space-y-2">
                        <label className="text-xs">Carica Immagine</label>
                        <Input type="file" accept="image/*" onChange={handleImageUpload} />
                      </div>
                   )}
                 </div>
               ) : (
                 <div className="flex-1 flex items-center justify-center text-slate-400 text-xs text-center p-4">
                   Seleziona un elemento per modificarlo
                 </div>
               )}
            </div>
          )}
        </div>

        {/* Publish Modal */}
        {showPublishModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-full max-w-md mx-4 shadow-xl">
            <h3 className="text-lg font-semibold mb-4">Pubblica {mode === 'slides' ? 'Presentazione' : 'Documento'}</h3>
            <p className="text-sm text-gray-600 mb-4">
              Salva questo contenuto come compito/materiale per una classe.
            </p>
            <div className="mb-4">
              <label className="block text-sm font-medium mb-2">Seleziona Sessione:</label>
              <select
                value={selectedSessionId}
                onChange={(e) => setSelectedSessionId(e.target.value)}
                className="w-full p-2 border rounded-md text-sm"
              >
                <option value="">-- Seleziona --</option>
                {classesData?.map((session: any) => (
                  <option key={session.id} value={session.id}>
                    {session.name} - {session.class_name}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setShowPublishModal(false)}>Annulla</Button>
              <Button onClick={handlePublish} disabled={!selectedSessionId} className="bg-violet-600 text-white">
                Pubblica Ora
              </Button>
            </div>
          </div>
        </div>
        )}

        {/* AI Writer Modal */}
        <Dialog open={showAIModal} onOpenChange={setShowAIModal}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Wand2 className="h-5 w-5 text-violet-600" />
                AI Writer
              </DialogTitle>
              <DialogDescription>
                Come vuoi che elabori il testo selezionato?
              </DialogDescription>
            </DialogHeader>
            
            <div className="p-4 bg-slate-50 rounded-lg border border-slate-200 max-h-32 overflow-y-auto mb-4">
              <p className="text-xs text-slate-500 font-medium mb-1">Selezione:</p>
              <p className="text-sm italic text-slate-700">"{aiSelectedText}"</p>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <Button variant="outline" onClick={() => executeAIAction('expand')} disabled={isAiLoading} className="justify-start">
                <Maximize2 className="h-4 w-4 mr-2 text-blue-600" />
                Espandi & Dettaglia
              </Button>
              <Button variant="outline" onClick={() => executeAIAction('summarize')} disabled={isAiLoading} className="justify-start">
                <Minimize2 className="h-4 w-4 mr-2 text-orange-600" />
                Sintetizza
              </Button>
              <Button variant="outline" onClick={() => executeAIAction('exercise')} disabled={isAiLoading} className="justify-start">
                <PenTool className="h-4 w-4 mr-2 text-purple-600" />
                Crea Esercizio
              </Button>
              <Button variant="outline" onClick={() => executeAIAction('complete')} disabled={isAiLoading} className="justify-start">
                <BookOpen className="h-4 w-4 mr-2 text-emerald-600" />
                Completa Frase
              </Button>
            </div>

            {isAiLoading && (
              <div className="flex items-center justify-center py-2 text-sm text-violet-600 animate-pulse">
                <Wand2 className="h-4 w-4 mr-2 animate-spin" />
                Generazione in corso...
              </div>
            )}
          </DialogContent>
        </Dialog>
      </div>
    </>
  )
}
