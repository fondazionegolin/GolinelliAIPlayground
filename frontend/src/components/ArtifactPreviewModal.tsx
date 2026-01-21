import { useState } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { 
  BookOpen, Presentation, Save, Edit2, Loader2, ListChecks, 
  ChevronLeft, ChevronRight, Plus, Trash2, Check, Target, Sparkles, BookMarked 
} from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'
import 'katex/dist/katex.min.css'

interface ArtifactPreviewModalProps {
  isOpen: boolean
  onClose: () => void
  onSave: (data: any) => void
  artifactType: 'lesson' | 'presentation' | 'quiz' | 'exercise'
  initialData: any
  isSaving?: boolean
}

export function ArtifactPreviewModal({
  isOpen,
  onClose,
  onSave,
  artifactType,
  initialData,
  isSaving = false
}: ArtifactPreviewModalProps) {
  const [data, setData] = useState(initialData)
  const [isEditing, setIsEditing] = useState(false)

  const handleSave = () => {
    onSave(data)
  }

  const getIcon = () => {
    switch (artifactType) {
      case 'lesson': return <BookOpen className="h-5 w-5 text-emerald-600" />
      case 'presentation': return <Presentation className="h-5 w-5 text-indigo-600" />
      case 'quiz': return <ListChecks className="h-5 w-5 text-purple-600" />
      default: return <BookOpen className="h-5 w-5" />
    }
  }

  const getTitle = () => {
    switch (artifactType) {
      case 'lesson': return isEditing ? 'Modifica Lezione' : 'Anteprima Lezione'
      case 'presentation': return isEditing ? 'Modifica Presentazione' : 'Anteprima Presentazione'
      case 'quiz': return isEditing ? 'Modifica Quiz' : 'Anteprima Quiz'
      case 'exercise': return isEditing ? 'Modifica Esercizio' : 'Anteprima Esercizio'
      default: return 'Contenuto'
    }
  }

  return (
    <Dialog open={isOpen} onOpenChange={(open: boolean) => !open && onClose()}>
      <DialogContent className="max-w-5xl h-[90vh] flex flex-col p-0 gap-0">
        <DialogHeader className="p-4 md:p-6 border-b bg-slate-50/80 backdrop-blur-sm z-10">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2.5 bg-white rounded-xl border shadow-sm">
                {getIcon()}
              </div>
              <div>
                <DialogTitle className="text-xl">{getTitle()}</DialogTitle>
                <DialogDescription className="hidden md:block">
                  {isEditing 
                    ? "Modifica i contenuti generati prima di salvarli." 
                    : "Rivedi il contenuto come lo vedranno gli studenti."}
                </DialogDescription>
              </div>
            </div>
            <div className="flex gap-2">
              <Button
                variant={isEditing ? "secondary" : "outline"}
                size="sm"
                onClick={() => setIsEditing(!isEditing)}
                className="gap-2"
              >
                {isEditing ? (
                  <>
                    <BookOpen className="h-4 w-4" />
                    Torna all\'Anteprima
                  </>
                ) : (
                  <>
                    <Edit2 className="h-4 w-4" />
                    Modifica Contenuto
                  </>
                )}
              </Button>
            </div>
          </div>
        </DialogHeader>

        <div className="flex-1 overflow-hidden flex flex-col bg-white">
          {isEditing ? (
            <ScrollArea className="flex-1 p-6 bg-slate-50/50">
               <div className="max-w-3xl mx-auto pb-10">
                 {artifactType === 'lesson' && <LessonFormEditor content={data} onChange={setData} />}
                 {artifactType === 'presentation' && <PresentationFormEditor content={data} onChange={setData} />}
                 {artifactType === 'quiz' && <QuizFormEditor content={data} onChange={setData} />}
                 {artifactType === 'exercise' && <ExerciseFormEditor content={data} onChange={setData} />}
               </div>
            </ScrollArea>
          ) : (
            <div className="flex-1 overflow-hidden flex flex-col">
              {artifactType === 'lesson' ? (
                <LessonViewer content={data} />
              ) : artifactType === 'presentation' ? (
                <PresentationViewer content={data} />
              ) : (
                <ScrollArea className="flex-1 p-6 md:p-10">
                   <div className="max-w-3xl mx-auto">
                     <GenericViewer content={data} type={artifactType} />
                   </div>
                </ScrollArea>
              )}
            </div>
          )}
        </div>

        <DialogFooter className="p-4 border-t bg-white z-10">
          <div className="flex justify-between w-full items-center gap-4">
             <p className="text-xs text-slate-500 hidden md:block">
               {isEditing 
                 ? "Le modifiche vengono applicate immediatamente all\'anteprima." 
                 : "Salvando come bozza potrai assegnarlo successivamente."}
             </p>
             <div className="flex gap-2 ml-auto">
               <Button variant="outline" onClick={onClose}>Chiudi</Button>
               <Button onClick={handleSave} disabled={isSaving} className="bg-violet-600 hover:bg-violet-700 shadow-sm">
                 {isSaving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                 <Save className="h-4 w-4 mr-2" />
                 Salva Bozza
               </Button>
             </div>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ============================================================================ 
// VIEWERS (READ-ONLY)
// ============================================================================ 

function LessonViewer({ content }: { content: any }) {
  const [currentSection, setCurrentSection] = useState(0)
  const sections = content.sections || []

  // Ensure arrays exist
  const objectives = content.learning_objectives || content.objectives || []
  const keyConcepts = content.key_concepts || []
  const activities = content.activities || []

  return (
    <div className="flex h-full">
      {/* Sidebar Navigation */}
      <div className="w-64 border-r bg-slate-50 flex flex-col overflow-hidden hidden md:flex">
        <div className="p-4 border-b">
          <h3 className="font-semibold text-slate-800 text-sm">Indice Lezione</h3>
        </div>
        <ScrollArea className="flex-1 p-3">
          <div className="space-y-1">
            <button
              onClick={() => setCurrentSection(-1)}
              className={`w-full text-left px-3 py-2 rounded-lg text-sm font-medium transition-colors ${ currentSection === -1 ? 'bg-emerald-100 text-emerald-800' : 'text-slate-600 hover:bg-slate-100'}`}
            >
              Panoramica
            </button>
            {sections.map((s: any, idx: number) => (
              <button
                key={idx}
                onClick={() => setCurrentSection(idx)}
                className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors ${ currentSection === idx ? 'bg-white border shadow-sm text-emerald-700 font-medium' : 'text-slate-600 hover:bg-slate-100'}`}
              >
                {idx + 1}. {s.title}
              </button>
            ))}
            {(content.summary || activities.length > 0) && (
              <button
                onClick={() => setCurrentSection(sections.length)}
                className={`w-full text-left px-3 py-2 rounded-lg text-sm font-medium transition-colors ${ currentSection === sections.length ? 'bg-emerald-100 text-emerald-800' : 'text-slate-600 hover:bg-slate-100'}`}
              >
                Conclusioni & Attività
              </button>
            )}
          </div>
        </ScrollArea>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 bg-white flex flex-col h-full overflow-hidden">
        <ScrollArea className="flex-1 p-8 md:p-12">
          <div className="max-w-3xl mx-auto">
            {currentSection === -1 && (
              <div className="space-y-8 animate-in fade-in duration-300">
                <div className="border-b pb-6">
                  <h1 className="text-4xl font-bold text-slate-900 mb-4">{content.title}</h1>
                  <p className="text-xl text-slate-600 leading-relaxed">{content.description}</p>
                </div>

                {objectives.length > 0 && (
                  <div className="bg-amber-50 rounded-2xl p-6 border border-amber-100">
                    <h3 className="text-amber-900 font-bold mb-4 flex items-center gap-2">
                      <Target className="h-5 w-5" />
                      Obiettivi di Apprendimento
                    </h3>
                    <ul className="grid gap-3">
                      {objectives.map((obj: string, i: number) => (
                        <li key={i} className="flex items-start gap-3 text-amber-800">
                          <Check className="h-5 w-5 text-amber-500 shrink-0" />
                          <span>{obj}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {keyConcepts.length > 0 && (
                  <div>
                    <h3 className="font-bold text-slate-900 mb-4 flex items-center gap-2">
                      <Sparkles className="h-5 w-5 text-violet-500" />
                      Concetti Chiave
                    </h3>
                    <div className="flex flex-wrap gap-2">
                      {keyConcepts.map((concept: string, i: number) => (
                        <span key={i} className="px-4 py-2 bg-violet-50 text-violet-700 rounded-full font-medium border border-violet-100">
                          {concept}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
                
                <div className="pt-8 flex justify-center">
                   <Button onClick={() => setCurrentSection(0)} className="bg-emerald-600 hover:bg-emerald-700 text-white px-8">
                     Inizia la Lezione
                     <ChevronRight className="ml-2 h-4 w-4" />
                   </Button>
                </div>
              </div>
            )}

            {currentSection >= 0 && currentSection < sections.length && (
              <div className="animate-in slide-in-from-right-4 duration-300">
                <span className="text-sm font-bold text-emerald-600 mb-2 block tracking-wider uppercase">
                  Capitolo {currentSection + 1}
                </span>
                <h2 className="text-3xl font-bold text-slate-900 mb-8">{sections[currentSection].title}</h2>
                <div className="prose prose-lg prose-slate max-w-none prose-headings:text-slate-800 prose-p:text-slate-600">
                  <ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeKatex]}>
                    {sections[currentSection].content}
                  </ReactMarkdown>
                </div>
              </div>
            )}

            {currentSection === sections.length && (
              <div className="space-y-8 animate-in slide-in-from-right-4 duration-300">
                <h2 className="text-3xl font-bold text-slate-900 border-b pb-4">Riepilogo e Attività</h2>
                
                {content.summary && (
                   <div className="bg-blue-50 p-6 rounded-2xl border border-blue-100">
                     <h3 className="text-blue-900 font-bold mb-3 flex items-center gap-2">
                       <BookMarked className="h-5 w-5" />
                       In Sintesi
                     </h3>
                     <p className="text-blue-800 leading-relaxed">{content.summary}</p>
                   </div>
                )}

                {activities.length > 0 && (
                  <div>
                    <h3 className="font-bold text-slate-900 mb-4 text-xl">Attività Suggerite</h3>
                    <ul className="space-y-4">
                      {activities.map((act: string, i: number) => (
                        <li key={i} className="flex gap-4 p-4 bg-white border rounded-xl shadow-sm">
                          <span className="flex items-center justify-center w-8 h-8 rounded-full bg-slate-100 text-slate-600 font-bold shrink-0">
                            {i + 1}
                          </span>
                          <span className="text-slate-700 pt-1">{act}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}
          </div>
        </ScrollArea>
        
        {/* Footer Navigation */}
        <div className="p-4 border-t flex justify-between bg-white">
          <Button 
            variant="ghost" 
            onClick={() => setCurrentSection(prev => Math.max(-1, prev - 1))}
            disabled={currentSection === -1}
          >
            <ChevronLeft className="mr-2 h-4 w-4" /> Precedente
          </Button>
          <span className="text-sm text-slate-400 self-center">
            {currentSection === -1 ? "Introduzione" : currentSection === sections.length ? "Conclusioni" : `${currentSection + 1} / ${sections.length}`}
          </span>
          <Button 
            variant="ghost"
            onClick={() => setCurrentSection(prev => Math.min(sections.length, prev + 1))}
            disabled={currentSection === sections.length}
          >
            Successiva <ChevronRight className="ml-2 h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  )
}

function PresentationViewer({ content }: { content: any }) {
  const [currentSlide, setCurrentSlide] = useState(0)
  const slides = content.slides || []

  return (
    <div className="flex flex-col h-full bg-slate-100">
      {/* Slide Display Area */}
      <div className="flex-1 flex items-center justify-center p-8 overflow-hidden">
        <div className="w-full max-w-4xl aspect-video bg-white rounded-xl shadow-2xl flex flex-col overflow-hidden relative">
          {/* Header Strip */}
          <div className="h-2 bg-gradient-to-r from-indigo-500 to-purple-600"></div>
          
          <div className="flex-1 p-12 flex flex-col">
            {slides[currentSlide] ? (
               <>
                 <div className="flex justify-between items-start mb-8">
                   <h2 className="text-4xl font-bold text-slate-800 tracking-tight">
                     {slides[currentSlide].title}
                   </h2>
                   <span className="text-slate-300 text-6xl font-black opacity-20">
                     {currentSlide + 1}
                   </span>
                 </div>
                 <div className="flex-1 text-2xl text-slate-600 leading-relaxed prose prose-xl max-w-none">
                    <ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeKatex]}>
                      {slides[currentSlide].content}
                    </ReactMarkdown>
                 </div>
               </>
            ) : (
              <div className="flex items-center justify-center h-full text-slate-400">
                Nessuna slide disponibile
              </div>
            )}
          </div>
          
          {/* Footer Strip */}
          <div className="bg-slate-50 p-4 border-t flex justify-between items-center text-sm text-slate-400">
             <span>{content.title}</span>
             <span>{currentSlide + 1} / {slides.length}</span>
          </div>
        </div>
      </div>

      {/* Controls */}
      <div className="bg-white border-t p-4 flex justify-center items-center gap-4">
        <Button 
          variant="outline"
          size="lg"
          onClick={() => setCurrentSlide(prev => Math.max(0, prev - 1))}
          disabled={currentSlide === 0}
          className="w-32"
        >
          <ChevronLeft className="mr-2 h-5 w-5" /> Indietro
        </Button>
        
        <div className="flex gap-2 overflow-x-auto max-w-md px-2 py-1 scrollbar-hide">
          {slides.map((_: any, idx: number) => (
            <button
              key={idx}
              onClick={() => setCurrentSlide(idx)}
              className={`w-3 h-3 rounded-full transition-all ${ idx === currentSlide ? 'bg-indigo-600 w-8' : 'bg-slate-300 hover:bg-indigo-300'}`}
            />
          ))}
        </div>

        <Button 
          variant="default"
          size="lg"
          onClick={() => setCurrentSlide(prev => Math.min(slides.length - 1, prev + 1))}
          disabled={currentSlide === slides.length - 1}
          className="w-32 bg-indigo-600 hover:bg-indigo-700"
        >
          Avanti <ChevronRight className="ml-2 h-5 w-5" />
        </Button>
      </div>
      
      {/* Speaker Notes */}
      {slides[currentSlide]?.speaker_notes && (
        <div className="bg-yellow-50 border-t border-yellow-100 p-3 text-center text-sm text-yellow-800">
          <span className="font-bold mr-2">Note Relatore:</span>
          {slides[currentSlide].speaker_notes}
        </div>
      )}
    </div>
  )
}

function GenericViewer({ content, type }: { content: any, type: string }) {
  if (type === 'quiz') {
    return (
      <div className="space-y-6">
        <div className="text-center mb-8">
           <h1 className="text-3xl font-bold text-slate-900">{content.title}</h1>
           <p className="text-slate-500 mt-2">{content.description}</p>
        </div>
        {content.questions?.map((q: any, idx: number) => (
          <div key={idx} className="bg-white p-6 rounded-xl border shadow-sm">
            <h3 className="font-semibold text-lg mb-4 flex gap-3">
              <span className="bg-purple-100 text-purple-700 w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold shrink-0">
                {idx + 1}
              </span>
              {q.question}
            </h3>
            <div className="space-y-3 pl-11">
              {q.options?.map((opt: string, i: number) => (
                <div key={i} className={`p-3 rounded-lg border flex items-center gap-3 ${i === q.correctIndex ? 'bg-green-50 border-green-200 text-green-900' : 'bg-slate-50 border-slate-100'}`}>
                   <div className={`w-5 h-5 rounded-full border flex items-center justify-center text-xs ${i === q.correctIndex ? 'bg-green-500 border-green-500 text-white' : 'border-slate-300'}`}>
                     {i === q.correctIndex && <Check className="h-3 w-3" />}
                   </div>
                   {opt}
                   {i === q.correctIndex && <span className="ml-auto text-xs font-bold text-green-600 uppercase tracking-wider">Risposta Corretta</span>}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    )
  }
  return <pre className="bg-slate-100 p-4 rounded">{JSON.stringify(content, null, 2)}</pre>
}


// ============================================================================ 
// EDITORS (FORM-BASED)
// ============================================================================ 

function LessonFormEditor({ content, onChange }: { content: any; onChange: (c: any) => void }) {
  const updateField = (field: string, value: any) => onChange({ ...content, [field]: value })
  
  // Helpers for array updates
  const addArrayItem = (arrayName: string, item: any) => updateField(arrayName, [...(content[arrayName] || []), item])
  const removeArrayItem = (arrayName: string, index: number) => updateField(arrayName, (content[arrayName] || []).filter((_: any, i: number) => i !== index))

  // Helpers for sections
  const updateSection = (index: number, field: string, value: any) => {
    const newSections = [...(content.sections || [])]
    newSections[index] = { ...newSections[index], [field]: value }
    updateField('sections', newSections)
  }

  return (
    <div className="space-y-8 animate-in fade-in">
      <div className="bg-white p-6 rounded-xl border shadow-sm space-y-4">
        <h3 className="font-semibold text-slate-900 border-b pb-2">Informazioni Generali</h3>
        <div className="space-y-4">
           <div>
             <label className="text-sm font-medium text-slate-700 mb-1 block">Titolo</label>
             <Input value={content.title} onChange={(e) => updateField('title', e.target.value)} />
           </div>
           <div>
             <label className="text-sm font-medium text-slate-700 mb-1 block">Descrizione</label>
             <Textarea value={content.description} onChange={(e) => updateField('description', e.target.value)} rows={2} />
           </div>
        </div>
      </div>

      <div className="bg-white p-6 rounded-xl border shadow-sm space-y-4">
        <h3 className="font-semibold text-slate-900 border-b pb-2">Sezioni Lezione</h3>
        <div className="space-y-6">
          {(content.sections || []).map((section: any, idx: number) => (
            <div key={idx} className="p-4 bg-slate-50 border rounded-xl relative group">
              <Button 
                variant="ghost" 
                size="sm" 
                className="absolute top-2 right-2 text-red-500 opacity-0 group-hover:opacity-100 transition-opacity"
                onClick={() => removeArrayItem('sections', idx)}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
              <div className="space-y-4">
                <div className="flex gap-4">
                   <div className="w-12 h-12 bg-white rounded-lg border flex items-center justify-center font-bold text-slate-400 shrink-0">
                     {idx + 1}
                   </div>
                   <div className="flex-1">
                      <label className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-1 block">Titolo Capitolo</label>
                      <Input 
                        value={section.title} 
                        onChange={(e) => updateSection(idx, 'title', e.target.value)} 
                        className="font-semibold"
                      />
                   </div>
                </div>
                <div>
                   <label className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-1 block">Contenuto (Markdown)</label>
                   <Textarea 
                     value={section.content} 
                     onChange={(e) => updateSection(idx, 'content', e.target.value)} 
                     rows={6}
                     className="font-mono text-sm"
                   />
                </div>
              </div>
            </div>
          ))}
          <Button variant="outline" className="w-full border-dashed" onClick={() => addArrayItem('sections', { title: 'Nuova Sezione', content: '' })}>
            <Plus className="h-4 w-4 mr-2" /> Aggiungi Sezione
          </Button>
        </div>
      </div>
      
      {/* Learning Objectives Editor could go here */}
    </div>
  )
}

function PresentationFormEditor({ content, onChange }: { content: any; onChange: (c: any) => void }) {
  const updateField = (field: string, value: any) => onChange({ ...content, [field]: value })
  
  const updateSlide = (index: number, field: string, value: any) => {
    const newSlides = [...(content.slides || [])]
    newSlides[index] = { ...newSlides[index], [field]: value }
    updateField('slides', newSlides)
  }
  
  const addSlide = () => updateField('slides', [...(content.slides || []), { title: 'Nuova Slide', content: '- Punto 1\n- Punto 2' }])
  const removeSlide = (index: number) => updateField('slides', (content.slides || []).filter((_: any, i: number) => i !== index))

  return (
    <div className="space-y-8 animate-in fade-in">
       <div className="bg-white p-6 rounded-xl border shadow-sm space-y-4">
        <h3 className="font-semibold text-slate-900 border-b pb-2">Dettagli Presentazione</h3>
        <div className="space-y-4">
           <div>
             <label className="text-sm font-medium text-slate-700 mb-1 block">Titolo</label>
             <Input value={content.title} onChange={(e) => updateField('title', e.target.value)} />
           </div>
           <div>
             <label className="text-sm font-medium text-slate-700 mb-1 block">Descrizione</label>
             <Textarea value={content.description} onChange={(e) => updateField('description', e.target.value)} rows={2} />
           </div>
        </div>
      </div>

      <div className="space-y-4">
        <h3 className="font-semibold text-slate-900">Slide ({content.slides?.length})</h3>
        {(content.slides || []).map((slide: any, idx: number) => (
          <div key={idx} className="flex gap-4 p-4 bg-white border rounded-xl shadow-sm">
             <div className="w-48 bg-slate-100 rounded-lg flex flex-col items-center justify-center p-4 text-center shrink-0 border">
                <span className="text-xs text-slate-400 font-bold uppercase mb-2">Slide {idx + 1}</span>
                <Presentation className="h-8 w-8 text-slate-300" />
                <Button size="sm" variant="ghost" className="text-red-500 hover:text-red-700 mt-2" onClick={() => removeSlide(idx)}>
                  <Trash2 className="h-4 w-4" />
                </Button>
             </div>
             <div className="flex-1 space-y-4">
                <Input 
                  value={slide.title} 
                  onChange={(e) => updateSlide(idx, 'title', e.target.value)} 
                  placeholder="Titolo Slide"
                  className="font-semibold"
                />
                <Textarea 
                  value={slide.content} 
                  onChange={(e) => updateSlide(idx, 'content', e.target.value)} 
                  rows={4}
                  placeholder="- Punto elenco..."
                  className="font-mono text-sm"
                />
                <Input 
                   value={slide.speaker_notes || ''}
                   onChange={(e) => updateSlide(idx, 'speaker_notes', e.target.value)}
                   placeholder="Note per il relatore (opzionali)"
                   className="text-xs bg-yellow-50 border-yellow-200"
                />
             </div>
          </div>
        ))}
         <Button variant="outline" className="w-full border-dashed h-16" onClick={addSlide}>
            <Plus className="h-5 w-5 mr-2" /> Aggiungi Nuova Slide
          </Button>
      </div>
    </div>
  )
}

function QuizFormEditor({ content, onChange }: { content: any; onChange: (c: any) => void }) {
    const updateField = (field: string, value: any) => onChange({ ...content, [field]: value })
    
    return (
        <div className="space-y-4 p-4 bg-yellow-50 border border-yellow-200 rounded-lg text-yellow-800">
            <h3 className="font-bold">Editor Quiz (Parziale)</h3>
            <div>
                <label className="text-sm font-medium text-yellow-900 block mb-1">Titolo</label>
                <Input 
                    value={content.title} 
                    onChange={(e) => updateField('title', e.target.value)} 
                    className="bg-white border-yellow-300"
                />
            </div>
            <p className="text-sm">L'editor completo per le domande è in arrivo.</p>
        </div>
    )
}

function ExerciseFormEditor({ content, onChange }: { content: any; onChange: (c: any) => void }) {
    const updateField = (field: string, value: any) => onChange({ ...content, [field]: value })

    return (
        <div className="space-y-4 p-4 bg-yellow-50 border border-yellow-200 rounded-lg text-yellow-800">
             <h3 className="font-bold">Editor Esercizio (Parziale)</h3>
             <div>
                <label className="text-sm font-medium text-yellow-900 block mb-1">Titolo</label>
                <Input 
                    value={content.title} 
                    onChange={(e) => updateField('title', e.target.value)} 
                    className="bg-white border-yellow-300"
                />
            </div>
             <p className="text-sm">L'editor visuale completo per gli esercizi è in arrivo.</p>
        </div>
    )
}