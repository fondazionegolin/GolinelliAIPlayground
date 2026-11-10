import { InteractiveHtmlFrame } from '@/components/documents/InteractiveHtmlFrame'
import { useEffect, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { teacherApi } from '@/lib/api'
import { Button, Input, Textarea } from '@/design'
import { useToast } from '@/components/ui/use-toast'
import { Save, Send } from '@/components/icons'
import { TrackedCorrectionText } from '@/components/tasks/TrackedCorrectionText'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'
import { markdownCodeComponents } from '@/components/CodeBlock'
import 'katex/dist/katex.min.css'
import { tl } from '@/i18n/tl'

export interface TaskData {
 id: string
 title: string
 description: string | null
 task_type: string
 status: string
 due_at: string | null
 points: string | null
 content_json?: string | null
 created_at: string
 submission_count?: number
 submission_scores?: Array<{ student_id: string; score: string }>
 score_summary?: {
 kind: 'quiz' | 'completion'
 average_percent?: number | null
 scored_count?: number
 completed_count?: number
 submission_count: number
 }
}

export interface SubmissionData {
 id: string
 student_id: string
 student_nickname: string
 content: string | null
 content_json?: string | null
 submitted_at: string
 score: string | null
 score_percent?: number | null
 result_kind?: 'quiz' | 'completion'
 feedback: string | null
 feedback_draft?: { overall_feedback?: string; answer_feedback?: Record<string, string> }
 answer_feedback?: Record<string, string>
 feedback_published_at?: string | null
 correction?: ExerciseCorrection | null
}

export interface ExerciseCorrection {
 kind: 'exercise_inline'
 status: 'pending' | 'read'
 original_content: string
 suggested_content: string
 teacher_name?: string
 updated_at: string
 read_at?: string | null
}

export interface QuizQuestion {
 question: string
 type?: 'mcq' | 'open' | 'scale'
 options: string[]
 correctIndex: number
}

export interface QuizWrongAnswerDetail {
 questionNumber: number
 question: string
 selectedAnswer: string
 correctAnswer: string
}

export type FormativeFlagType = 'incomplete' | 'misconception' | 'off_topic' | 'similar_answer' | 'strong_reasoning'

export interface FormativeFlag {
 type: FormativeFlagType
 title: string
 reason: string
 evidence: string
 confidence: number
}

export interface TaskAnalysisData {
 overview: {
 summary: string
 completion_summary: string
 strengths: string[]
 gaps: string[]
 suggestions: string[]
 }
 student_flags: Array<{
 student_id: string
 student_nickname: string
 flags: FormativeFlag[]
 }>
 submission_count: number
 total_students: number
}

export const FORMATIVE_FLAG_META: Record<FormativeFlagType, { label: string; className: string }> = {
 incomplete: { label: tl("Risposta incompleta"), className: 'bg-[var(--surface-logo-violet)] text-[var(--logo-violet-strong)]' },
 misconception: { label: tl("Possibile fraintendimento"), className: 'bg-[var(--surface-logo-violet)] text-[var(--logo-violet-strong)]' },
 off_topic: { label: tl("Possibile fuori tema"), className: 'bg-[var(--surface-logo-pink)] text-[var(--logo-pink)]' },
 similar_answer: { label: tl("Risposte molto simili"), className: 'bg-[var(--surface-logo-violet)] text-[var(--logo-violet-strong)]' },
 strong_reasoning: { label: tl("Ragionamento solido"), className: 'bg-[var(--surface-logo-blue)] text-[var(--logo-blue-strong)]' },
}

export function parseTaskContent(raw?: string | null): Record<string, any> | null {
 if (!raw) return null
 try {
 const parsed = JSON.parse(raw)
 return parsed && typeof parsed === 'object' ? parsed : null
 } catch {
 return null
 }
}

export function TaskContentPreview({ task }: { task: TaskData }) {
 const content = parseTaskContent(task.content_json)
 if (!task.content_json) return null

 if (content) {
 const html = content.html || content.htmlContent || content.content
 if (typeof html === 'string' && /<\/?[a-z][\s\S]*>/i.test(html)) {
 return (
 <div className="overflow-hidden rounded-lg bg-[var(--surface-base)]">
 <InteractiveHtmlFrame
 srcDoc={html}
 className="h-80 w-full border-0"
 title={tl("Contenuto {0}", task.title)}
 />
 </div>
 )
 }

 const slides = Array.isArray(content.slides) ? content.slides : null
 if (slides) {
 return (
 <div className="rounded-lg bg-[var(--surface-base)] p-3">
 <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">
 {tl("Presentazione ·")} {slides.length} slide
 </p>
 <div className="space-y-2">
 {slides.map((slide: any, index: number) => (
 <div key={slide.id || index} className="rounded-md bg-[var(--surface-muted)] p-2">
 <p className="text-sm font-semibold text-[var(--text-primary)]">{index + 1}. {slide.title || `Slide ${index + 1}`}</p>
 {Array.isArray(slide.blocks) && slide.blocks.length > 0 && (
 <p className="mt-1 text-xs text-[var(--text-muted)]">{slide.blocks.length} elementi</p>
 )}
 </div>
 ))}
 </div>
 </div>
 )
 }

 if (Array.isArray(content.questions)) {
 return (
 <div className="rounded-lg bg-[var(--surface-base)] p-3">
 <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">
 {tl("Quiz ·")} {content.questions.length} {tl("domande")}
 </p>
 <ol className="list-decimal space-y-2 pl-5 text-sm text-[var(--text-primary)]">
 {content.questions.map((question: any, index: number) => (
 <li key={index}>{question.question || question.text || tl("Domanda {0}", index + 1)}</li>
 ))}
 </ol>
 </div>
 )
 }

 const exerciseText = content.instructions || content.text || content.description
 if (typeof exerciseText === 'string' && exerciseText.trim()) {
 return (
 <div className="rounded-lg bg-[var(--surface-base)] p-3 text-sm leading-6 text-[var(--text-primary)]">
 {content.title && <p className="mb-2 font-semibold text-[var(--text-primary)]">{content.title}</p>}
 <div className="chat-markdown prose prose-sm max-w-none text-[var(--text-primary)]">
 <ReactMarkdown
 remarkPlugins={[remarkGfm, remarkMath]}
 rehypePlugins={[rehypeKatex]}
 components={markdownCodeComponents(false)}
 >
 {exerciseText}
 </ReactMarkdown>
 </div>
 </div>
 )
 }
 }

 return (
 <div className="rounded-lg bg-[var(--surface-muted)] px-3 py-2 text-sm text-[var(--text-muted)]">
 {tl("Il contenuto è disponibile, ma non può essere mostrato in anteprima.")}
 </div>
 )
}

export function SubmissionContentPreview({ submission, task }: { submission: SubmissionData; task: TaskData }) {
 const text = submission.content?.trim()
 const submissionContent = parseTaskContent(submission.content_json)
 const taskContent = parseTaskContent(task.content_json)

 if (task.task_type === 'quiz' && Array.isArray(submissionContent?.answers)) {
 const questions = Array.isArray(taskContent?.questions) ? taskContent.questions : []
 return (
 <div className="space-y-2">
 {text && <p className="text-sm text-[var(--text-primary)]">{text}</p>}
 <div className="rounded-lg bg-[var(--surface-base)] p-2">
 <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">
 {tl("Risposte quiz")}
 </p>
 <ol className="list-decimal space-y-2 pl-5 text-sm text-[var(--text-primary)]">
 {submissionContent.answers.map((answer: any, index: number) => {
 const questionIndex = Number(answer.questionIndex ?? index)
 const selectedIndex = Number(answer.selectedIndex)
 const question = questions[questionIndex]
 const selectedAnswer = Array.isArray(question?.options)
 ? question.options[selectedIndex]
 : tl("Opzione {0}", Number.isFinite(selectedIndex) ? selectedIndex + 1 : '-')
 return (
 <li key={`${submission.id}-answer-${index}`}>
 <span className="font-medium">{question?.question || tl("Domanda {0}", questionIndex + 1)}</span>
 <span className="block text-[var(--text-muted)]">{tl("Risposta:")} {selectedAnswer || tl("Non disponibile")}</span>
 </li>
 )
 })}
 </ol>
 </div>
 </div>
 )
 }

 const structuredText = submissionContent?.text || submissionContent?.content || submissionContent?.description
 if (typeof structuredText === 'string' && structuredText.trim()) {
 return <p className="whitespace-pre-wrap text-sm text-[var(--text-primary)]">{structuredText}</p>
 }

 if (text) {
 return <p className="whitespace-pre-wrap text-sm text-[var(--text-primary)]">{text}</p>
 }

 if (submission.content_json) {
 return (
 <details className="rounded-lg bg-[var(--surface-base)]">
 <summary className="cursor-pointer px-3 py-2 text-sm font-medium text-[var(--text-primary)]">{tl("Mostra dati consegna")}</summary>
 <pre className="overflow-x-auto whitespace-pre-wrap break-all p-3 text-xs">{submission.content_json}</pre>
 </details>
 )
 }

 return <p className="text-sm text-muted-foreground">{tl("Risposta vuota.")}</p>
}

export function ExerciseCorrectionPanel({
 submission,
 task,
 sessionId,
}: {
 submission: SubmissionData
 task: TaskData
 sessionId: string
}) {
 const queryClient = useQueryClient()
 const { toast } = useToast()
 const correction = submission.correction?.kind === 'exercise_inline' ? submission.correction : null
 const original = correction?.original_content ?? submission.content ?? ''
 const [isEditing, setIsEditing] = useState(false)
 const [correctedText, setCorrectedText] = useState(correction?.suggested_content ?? original)

 useEffect(() => {
 if (!isEditing) setCorrectedText(correction?.suggested_content ?? original)
 }, [correction?.suggested_content, original, isEditing])

 const saveCorrection = useMutation({
 mutationFn: () => teacherApi.correctExerciseSubmission(sessionId, task.id, submission.id, correctedText),
 onSuccess: () => {
 queryClient.invalidateQueries({ queryKey: ['task-submissions', sessionId, task.id] })
 setIsEditing(false)
 toast({ title: tl("Correzione inviata allo studente") })
 },
 onError: (error: any) => {
 const noChanges = error?.response?.status === 409
 toast({
 title: noChanges ? tl("Nessuna modifica da inviare") : tl("Impossibile salvare la correzione"),
 variant: 'destructive',
 })
 },
 })

 return (
 <div className="mt-3 overflow-hidden rounded-xl bg-[var(--surface-base)]">
 <div className="flex items-center justify-between gap-3 bg-[var(--surface-logo-violet)] px-3 py-2">
 <div>
 <p className="text-xs font-bold text-[var(--logo-violet-strong)]">{tl("Correzione in linea")}</p>
 <p className="text-[11px] text-[var(--logo-violet-strong)]">{tl("Le modifiche vengono evidenziate automaticamente.")}</p>
 </div>
 {correction && (
 <span className={`rounded-full px-2.5 py-1 text-[10px] font-bold ${
 correction.status === 'read'
 ? 'bg-[var(--surface-logo-blue)] text-[var(--logo-blue-strong)]'
 : 'bg-[var(--surface-logo-violet)] text-[var(--logo-violet-strong)]'
 }`}>
 {correction.status === 'read'
 ? `Letto${correction.read_at ? ` · ${new Date(correction.read_at).toLocaleString('it-IT')}` : ''}`
 : tl("Inviata · da leggere")}
 </span>
 )}
 </div>

 <div className="space-y-3 p-3">
 {isEditing ? (
 <>
 <Textarea
 value={correctedText}
 onChange={(event) => setCorrectedText(event.target.value)}
 className="min-h-[150px]"
 aria-label={tl("Correzione della risposta di {0}", submission.student_nickname)}
 />
 <div className="rounded-lg bg-[var(--surface-muted)] p-3">
 <p className="mb-2 text-[10px] font-bold uppercase tracking-wide text-[var(--text-muted)]">{tl("Anteprima per lo studente")}</p>
 <TrackedCorrectionText original={original} corrected={correctedText} />
 </div>
 <div className="flex justify-end gap-2">
 <Button
 size="sm"
 tone="neutral" surface="soft"
 onClick={() => {
 setCorrectedText(correction?.suggested_content ?? original)
 setIsEditing(false)
 }}
 >
 {tl("Annulla")}
 </Button>
 <Button
 size="sm"
 onClick={() => saveCorrection.mutate()}
 disabled={saveCorrection.isPending || !correctedText.trim() || correctedText.trim() === original.trim()}
 className="bg-[var(--logo-violet-strong)] text-white hover:bg-[var(--logo-violet-strong)]"
 >
 {saveCorrection.isPending ? tl("Invio…") : tl("Invia correzione")}
 </Button>
 </div>
 </>
 ) : correction ? (
 <>
 <TrackedCorrectionText original={original} corrected={correction.suggested_content} />
 <div className="flex justify-end">
 <Button size="sm" tone="neutral" surface="soft" onClick={() => setIsEditing(true)}>
 {tl("Modifica correzione")}
 </Button>
 </div>
 </>
 ) : (
 <div className="flex items-center justify-between gap-3">
 <p className="text-xs text-[var(--text-muted)]">{tl("La risposta originale non verrà modificata.")}</p>
 <Button size="sm" tone="neutral" surface="soft" onClick={() => setIsEditing(true)} disabled={!original.trim()}>
 {tl("Correggi risposta")}
 </Button>
 </div>
 )}
 </div>
 </div>
 )
}

export function SubmissionFeedbackEditor({ submission, task, sessionId }: { submission: SubmissionData; task: TaskData; sessionId: string }) {
 const queryClient = useQueryClient()
 const { toast } = useToast()
 const taskContent = parseTaskContent(task.content_json)
 const submissionContent = parseTaskContent(submission.content_json)
 const questions = Array.isArray(taskContent?.questions) ? taskContent.questions : []
 const answers = Array.isArray(submissionContent?.answers) ? submissionContent.answers : []
 const initialOverall = submission.feedback_draft?.overall_feedback ?? submission.feedback ?? ''
 const initialAnswers = submission.feedback_draft?.answer_feedback ?? submission.answer_feedback ?? {}
 const [overallFeedback, setOverallFeedback] = useState(initialOverall)
 const [answerFeedback, setAnswerFeedback] = useState<Record<string, string>>(initialAnswers)
 const [score, setScore] = useState(submission.score || '')

 useEffect(() => {
 setOverallFeedback(submission.feedback_draft?.overall_feedback ?? submission.feedback ?? '')
 setAnswerFeedback(submission.feedback_draft?.answer_feedback ?? submission.answer_feedback ?? {})
 setScore(submission.score || '')
 }, [submission.answer_feedback, submission.feedback, submission.feedback_draft, submission.score])

 const save = useMutation({
 mutationFn: (publish: boolean) => teacherApi.updateSubmissionFeedback(sessionId, task.id, submission.id, {
 overall_feedback: overallFeedback,
 answer_feedback: answerFeedback,
 score: score || undefined,
 publish,
 }),
 onSuccess: (_, publish) => {
 queryClient.invalidateQueries({ queryKey: ['task-submissions', sessionId, task.id] })
 toast({ title: publish ? tl("Feedback pubblicato allo studente") : tl("Bozza feedback salvata") })
 },
 onError: () => toast({ title: tl("Impossibile salvare il feedback"), variant: 'destructive' }),
 })

 return (
 <div className="mt-3 overflow-hidden rounded-xl bg-[var(--surface-base)]">
 <div className="flex items-center justify-between gap-3 bg-[var(--surface-logo-blue)] px-3 py-2">
 <div>
 <p className="text-xs font-bold text-[var(--logo-blue-strong)]">{tl("Feedback del docente")}</p>
 <p className="text-[11px] text-[var(--logo-blue-strong)]">{tl("Salva in bozza oppure pubblica quando è pronto.")}</p>
 </div>
 <span className={`rounded-full px-2 py-1 text-[10px] font-bold ${submission.feedback_published_at ? 'bg-[var(--surface-logo-blue)] text-[var(--logo-blue-strong)]' : 'bg-[var(--surface-muted)] text-[var(--text-muted)]'}`}>
 {submission.feedback_published_at ? tl("Pubblicato · {0}", new Date(submission.feedback_published_at).toLocaleDateString('it-IT')) : tl("Non pubblicato")}
 </span>
 </div>
 <div className="space-y-3 p-3">
 {task.task_type === 'quiz' && answers.map((answer: any, index: number) => {
 const questionIndex = Number(answer.questionIndex ?? index)
 const question = questions[questionIndex]
 return (
 <label key={`${submission.id}-feedback-${questionIndex}`} className="block rounded-lg bg-[var(--surface-muted)] p-2.5">
 <span className="mb-1.5 block text-[11px] font-bold text-[var(--text-primary)]">{questionIndex + 1}. {question?.question || tl("Risposta")}</span>
 <Textarea value={answerFeedback[String(questionIndex)] || ''} onChange={(event) => setAnswerFeedback(current => ({ ...current, [String(questionIndex)]: event.target.value }))} rows={2} density="compact" placeholder={tl("Commento su questa risposta…")} className="min-h-0" />
 </label>
 )
 })}
 <label className="block">
 <span className="mb-1.5 block text-[11px] font-bold text-[var(--text-primary)]">{tl("Feedback complessivo")}</span>
 <Textarea value={overallFeedback} onChange={(event) => setOverallFeedback(event.target.value)} rows={3} density="compact" placeholder={tl("Scrivi il riepilogo per lo studente…")} className="min-h-0" />
 </label>
 <label className="block max-w-40">
 <span className="mb-1.5 block text-[11px] font-bold text-[var(--text-primary)]">{tl("Voto (opzionale)")}</span>
 <Input density="compact" value={score} onChange={(event) => setScore(event.target.value)} placeholder="es. 8/10" />
 </label>
 <div className="flex justify-end gap-2 pt-3">
 <Button size="sm" tone="neutral" surface="soft" onClick={() => save.mutate(false)} disabled={save.isPending}><Save className="mr-1.5 h-3.5 w-3.5" />{tl("Salva bozza")}</Button>
 <Button size="sm" onClick={() => save.mutate(true)} disabled={save.isPending || (!overallFeedback.trim() && !Object.values(answerFeedback).some(value => value.trim()))}><Send className="mr-1.5 h-3.5 w-3.5" />{tl("Pubblica feedback")}</Button>
 </div>
 </div>
 </div>
 )
}

export function toDateTimeLocalValue(value: string | null): string {
 if (!value) return ''
 const date = new Date(value)
 if (Number.isNaN(date.getTime())) return ''
 const pad = (part: number) => String(part).padStart(2, '0')
 return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

