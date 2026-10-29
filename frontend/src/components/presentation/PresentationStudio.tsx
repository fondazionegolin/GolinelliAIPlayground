import { useEffect, useMemo, useRef, useState } from 'react'
import { ColorPicker } from '@/components/ui/ColorPicker'
import { Button } from '@/components/ui/button'
import { useToast } from '@/components/ui/use-toast'
import {
  ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Check, Copy, Loader2, MonitorPlay, Plus, RotateCcw, Sparkles, Trash2, Wand2, X,
} from '@/components/icons'
import {
  DEFAULT_THEME_OPTIONS, LAYOUT_FIELDS, LAYOUT_LABELS, STYLE_QUESTIONS, emptyOutlineSlide, generateDeckImages, optionsFromAnswers,
  pendingImageSlots, presentationStudioApi, rankThemes, withImage,
  type OutlineSlide, type RenderedDeck, type ResolvedTheme, type StudioBrief, type StudioLayout, type StudioOutline,
  type StudioSlide, type StyleAnswers, type ThemeOptions,
} from '@/lib/presentationStudio'
import { StudioSlidePreview } from './StudioSlidePreview'
import { tl } from '@/i18n/tl'

type Step = 'brief' | 'outline' | 'style'
type Format = '16:9' | '4:3'

const DIMS: Record<Format, { width: number; height: number }> = {
  '16:9': { width: 960, height: 540 },
  '4:3': { width: 800, height: 600 },
}
const DRAFT_KEY = 'presentation-studio-draft-v1'

const AUDIENCES = [tl("Scuola primaria"), tl("Secondaria di I grado"), tl("Secondaria di II grado"), tl("Università"), tl("Docenti e adulti")]
const GOALS = [tl("Spiegare un argomento"), tl("Introdurre un tema"), tl("Ripassare"), tl("Presentare un progetto"), tl("Formazione")]
const DENSITIES: { value: StudioBrief['density']; label: string; hint: string }[] = [
  { value: 'essenziale', label: tl("Essenziale"), hint: tl("Parole chiave, dettagli nelle note") },
  { value: 'bilanciata', label: tl("Bilanciata"), hint: tl("Frasi brevi e complete") },
  { value: 'dettagliata', label: tl("Dettagliata"), hint: tl("Per lo studio autonomo") },
]
const FONT_OPTIONS: { value: ThemeOptions['font']; label: string }[] = [
  { value: 'theme', label: tl("Quelli del template") },
  { value: 'leggibile', label: tl("Alta leggibilità (Lexend)") },
  { value: 'serif', label: tl("Classico (titoli serif)") },
  { value: 'moderno', label: tl("Moderno (Plus Jakarta)") },
]

const EMPTY_BRIEF: StudioBrief = {
  topic: '', audience: '', goal: '', tone: '', slide_count: 8, density: 'bilanciata', source_text: '',
}

type Props = {
  onClose: () => void
  onCreate: (deck: RenderedDeck) => void
  /** Skip the AI flow and open an empty deck. */
  onBlank?: () => void
  initialTopic?: string
}

const errorMessage = (error: any, fallback: string) => {
  if (error?.response?.status === 402) return tl("Crediti IA esauriti per questo periodo.")
  const detail = error?.response?.data?.detail
  return typeof detail === 'string' ? detail : fallback
}

/** Slides whose layout misses the content it needs (shown as a warning dot in the outline). */
const slideProblems = (slide: OutlineSlide): string[] => {
  const problems: string[] = []
  const fields = LAYOUT_FIELDS[slide.layout]
  if (fields.includes('title') && !slide.title.trim() && slide.layout !== 'big_stat') problems.push(tl("Manca il titolo"))
  if (slide.layout === 'big_stat' && !slide.stat_value.trim()) problems.push(tl("Manca il dato"))
  if (slide.layout === 'quote' && !slide.quote.trim()) problems.push(tl("Manca la citazione"))
  if (slide.layout === 'cards' && (slide.points.length < 2 || slide.points.length > 4)) problems.push(tl("Le schede devono essere da 2 a 4"))
  if (slide.layout === 'timeline' && slide.points.length < 2) problems.push(tl("Servono almeno 2 passaggi"))
  if (['title_bullets', 'summary', 'image_split'].includes(slide.layout) && slide.points.length === 0) problems.push(tl("Elenco vuoto"))
  if (slide.points.length > 6) problems.push(tl("Troppi punti: sposta i dettagli nelle note"))
  return problems
}

export default function PresentationStudio({ onClose, onCreate, onBlank, initialTopic }: Props) {
  const { toast } = useToast()
  const restored = useMemo(() => {
    try {
      const raw = window.localStorage.getItem(DRAFT_KEY)
      return raw ? JSON.parse(raw) as { brief: StudioBrief; outline: StudioOutline | null; step: Step } : null
    } catch { return null }
  }, [])
  const [step, setStep] = useState<Step>(initialTopic ? 'brief' : restored?.step || 'brief')
  const [brief, setBrief] = useState<StudioBrief>(initialTopic ? { ...EMPTY_BRIEF, topic: initialTopic } : restored?.brief || EMPTY_BRIEF)
  const [outline, setOutline] = useState<StudioOutline | null>(initialTopic ? null : restored?.outline || null)
  const [outlineHistory, setOutlineHistory] = useState<StudioOutline[]>([])
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [busy, setBusy] = useState<null | 'outline' | 'revise' | 'slide' | 'render'>(null)
  const [reviseText, setReviseText] = useState('')
  const [slideInstruction, setSlideInstruction] = useState('')
  const abortRef = useRef<AbortController | null>(null)

  // Style step
  const [themes, setThemes] = useState<ResolvedTheme[]>([])
  const [answers, setAnswers] = useState<StyleAnswers>({ venue: null, mood: null, readability: 'standard' })
  const [themeId, setThemeId] = useState<string | null>(null)
  const [options, setOptions] = useState<ThemeOptions>(DEFAULT_THEME_OPTIONS)
  const [format, setFormat] = useState<Format>('16:9')
  const [galleryPreviews, setGalleryPreviews] = useState<Record<string, StudioSlide[]>>({})
  const [selectedPreview, setSelectedPreview] = useState<StudioSlide[]>([])
  const [previewLoading, setPreviewLoading] = useState(false)
  const [generateImages, setGenerateImages] = useState(true)
  const [imageProgress, setImageProgress] = useState<{ done: number; total: number } | null>(null)
  const imageAbortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    try { window.localStorage.setItem(DRAFT_KEY, JSON.stringify({ brief, outline, step })) } catch { /* storage unavailable */ }
  }, [brief, outline, step])

  useEffect(() => () => abortRef.current?.abort(), [])

  const resetAll = () => {
    if (outline && !window.confirm(tl("Ricominciare da capo? La scaletta attuale andrà persa."))) return
    setBrief(EMPTY_BRIEF); setOutline(null); setOutlineHistory([]); setStep('brief'); setSelectedIndex(0)
    try { window.localStorage.removeItem(DRAFT_KEY) } catch { /* ignore */ }
  }

  // ── Outline (AI) ──────────────────────────────────────────────────────────
  const runOutline = async (mode: 'create' | 'revise' | 'slide') => {
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    setBusy(mode === 'create' ? 'outline' : mode)
    try {
      const response = await presentationStudioApi.outline({
        brief,
        mode,
        outline: mode === 'create' ? undefined : outline || undefined,
        instruction: mode === 'revise' ? reviseText : mode === 'slide' ? slideInstruction : undefined,
        slide_index: mode === 'slide' ? selectedIndex : undefined,
      }, controller.signal)
      if (outline) setOutlineHistory(history => [...history.slice(-9), outline])
      setOutline(response.data)
      if (mode === 'create') { setSelectedIndex(0); setStep('outline') }
      if (mode === 'revise') { setReviseText(''); setSelectedIndex(index => Math.min(index, response.data.slides.length - 1)) }
      if (mode === 'slide') setSlideInstruction('')
    } catch (error: any) {
      if (error?.name === 'CanceledError' || error?.code === 'ERR_CANCELED') return
      toast({ title: tl("Scaletta non generata"), description: errorMessage(error, tl("Riprova tra poco.")), variant: 'destructive' })
    } finally {
      setBusy(null)
    }
  }

  const undoOutline = () => {
    const previous = outlineHistory[outlineHistory.length - 1]
    if (!previous) return
    setOutline(previous)
    setOutlineHistory(history => history.slice(0, -1))
    setSelectedIndex(index => Math.min(index, previous.slides.length - 1))
  }

  const updateSlide = (index: number, patch: Partial<OutlineSlide>) => {
    setOutline(current => current ? { ...current, slides: current.slides.map((slide, i) => i === index ? { ...slide, ...patch } : slide) } : current)
  }
  const moveSlide = (index: number, delta: -1 | 1) => {
    setOutline(current => {
      if (!current) return current
      const target = index + delta
      if (target < 0 || target >= current.slides.length) return current
      const slides = [...current.slides]
      ;[slides[index], slides[target]] = [slides[target], slides[index]]
      return { ...current, slides }
    })
    setSelectedIndex(index + delta)
  }
  const duplicateSlide = (index: number) => {
    setOutline(current => current ? { ...current, slides: [...current.slides.slice(0, index + 1), { ...current.slides[index], id: crypto.randomUUID() }, ...current.slides.slice(index + 1)] } : current)
    setSelectedIndex(index + 1)
  }
  const deleteSlide = (index: number) => {
    setOutline(current => current && current.slides.length > 1 ? { ...current, slides: current.slides.filter((_, i) => i !== index) } : current)
    setSelectedIndex(i => Math.max(0, Math.min(i, (outline?.slides.length || 2) - 2)))
  }
  const addSlide = () => {
    setOutline(current => current ? { ...current, slides: [...current.slides.slice(0, selectedIndex + 1), emptyOutlineSlide(), ...current.slides.slice(selectedIndex + 1)] } : current)
    setSelectedIndex(i => i + 1)
  }

  // ── Style ─────────────────────────────────────────────────────────────────
  const previewIndexes = useMemo(() => {
    if (!outline) return [0]
    const content = outline.slides.findIndex((slide, index) => index > 0 && !['section', 'cover'].includes(slide.layout))
    return [0, content > 0 ? content : Math.min(1, outline.slides.length - 1)]
  }, [outline])

  const rankedThemes = useMemo(
    () => rankThemes(themes, answers, outline?.recommended_templates || []),
    [themes, answers, outline?.recommended_templates],
  )

  const goToStyle = async () => {
    if (!outline) return
    setStep('style')
    setPreviewLoading(true)
    try {
      const catalog = themes.length ? themes : (await presentationStudioApi.templates()).data.themes
      setThemes(catalog)
      const preview = await presentationStudioApi.preview({
        outline, theme_ids: catalog.map(theme => theme.id), options: { ...DEFAULT_THEME_OPTIONS, dark: options.dark }, dims: DIMS[format], slide_indexes: previewIndexes,
      })
      setGalleryPreviews(preview.data.previews)
      if (!themeId) setThemeId(rankThemes(catalog, answers, outline.recommended_templates)[0]?.id || 'aula')
    } catch (error: any) {
      toast({ title: tl("Anteprime non disponibili"), description: errorMessage(error, tl("Riprova.")), variant: 'destructive' })
    } finally {
      setPreviewLoading(false)
    }
  }

  // Large preview of the chosen template with the chosen options (deterministic, debounced).
  useEffect(() => {
    if (step !== 'style' || !outline || !themeId) return
    const timer = window.setTimeout(async () => {
      try {
        const indexes = outline.slides.slice(0, 6).map((_, index) => index)
        const response = await presentationStudioApi.preview({ outline, theme_ids: [themeId], options, dims: DIMS[format], slide_indexes: indexes })
        setSelectedPreview(response.data.previews[themeId] || [])
      } catch { /* the gallery thumbnails stay usable */ }
    }, 250)
    return () => window.clearTimeout(timer)
  }, [step, outline, themeId, options, format])

  // Gallery thumbnails follow the light/dark choice so every card shows what will really be produced.
  useEffect(() => {
    if (step !== 'style' || !outline || themes.length === 0) return
    let cancelled = false
    presentationStudioApi.preview({
      outline, theme_ids: themes.map(theme => theme.id), options: { ...DEFAULT_THEME_OPTIONS, dark: options.dark }, dims: DIMS[format], slide_indexes: previewIndexes,
    }).then(response => { if (!cancelled) setGalleryPreviews(response.data.previews) }).catch(() => undefined)
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [options.dark])

  const setAnswer = <K extends keyof StyleAnswers>(key: K, value: StyleAnswers[K]) => {
    const next = { ...answers, [key]: value }
    setAnswers(next)
    setOptions(current => optionsFromAnswers(next, current))
    const best = rankThemes(themes, next, outline?.recommended_templates || [])[0]
    if (best) setThemeId(best.id)
  }

  const createDeck = async () => {
    if (!outline || !themeId) return
    setBusy('render')
    try {
      const response = await presentationStudioApi.render({ outline, theme_id: themeId, options, format, dims: DIMS[format] })
      let slides = response.data.slides
      if (generateImages && options.images && pendingImageSlots(slides).length > 0) {
        const controller = new AbortController()
        imageAbortRef.current = controller
        const result = await generateDeckImages(
          slides,
          { deckTitle: response.data.title, theme: response.data.theme },
          (slot, url) => { slides = withImage(slides, slot.slideId, slot.blockId, url) },
          (done, total) => setImageProgress({ done, total }),
          controller.signal,
        )
        if (result.failed > 0) {
          toast({ title: tl("{0} immagini non generate", result.failed), description: tl("Restano gli spazi segnaposto: puoi rigenerarle dal Controllo qualità.") })
        }
      }
      try { window.localStorage.removeItem(DRAFT_KEY) } catch { /* ignore */ }
      onCreate({ ...response.data, slides, format })
    } catch (error: any) {
      toast({ title: tl("Presentazione non creata"), description: errorMessage(error, tl("Riprova.")), variant: 'destructive' })
    } finally {
      setBusy(null)
      setImageProgress(null)
      imageAbortRef.current = null
    }
  }

  const selectedSlide = outline?.slides[selectedIndex]
  const problemsCount = outline ? outline.slides.filter(slide => slideProblems(slide).length > 0).length : 0
  const reasonFor = (id: string) => outline?.recommended_templates.find(item => item.id === id)?.reason

  // ── Render ────────────────────────────────────────────────────────────────
  const steps: { key: Step; label: string }[] = [
    { key: 'brief', label: tl("1 · Contenuti") },
    { key: 'outline', label: tl("2 · Scaletta") },
    { key: 'style', label: tl("3 · Stile") },
  ]

  return (
    <div className="fixed inset-0 z-[60] flex flex-col bg-slate-50" role="dialog" aria-modal="true" aria-label={tl("Presentation Studio")}>
      <header className="flex items-center gap-3 border-b border-slate-200 bg-white px-4 py-3">
        <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-indigo-50 text-indigo-700"><MonitorPlay className="h-5 w-5" /></span>
        <div className="min-w-0">
          <h2 className="truncate text-base font-bold text-slate-900">{tl("Presentation Studio")}</h2>
          <p className="hidden text-xs text-slate-500 sm:block">{tl("Prima i contenuti, poi lo stile: rivedi tutto prima di creare le slide.")}</p>
        </div>
        <nav className="mx-auto hidden items-center gap-1 rounded-full bg-slate-100 p-1 md:flex" aria-label={tl("Passaggi")}>
          {steps.map(item => {
            const reachable = item.key === 'brief' || (item.key === 'outline' && Boolean(outline)) || (item.key === 'style' && Boolean(outline))
            return (
              <button
                key={item.key}
                type="button"
                disabled={!reachable || Boolean(busy)}
                onClick={() => (item.key === 'style' ? void goToStyle() : setStep(item.key))}
                className={`rounded-full px-3 py-1.5 text-xs font-bold transition-colors ${step === item.key ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-800 disabled:opacity-40'}`}
              >{item.label}</button>
            )
          })}
        </nav>
        <div className="ml-auto flex items-center gap-1 md:ml-0">
          {(outline || brief.topic) && (
            <button type="button" onClick={resetAll} className="rounded-lg px-2.5 py-1.5 text-xs font-semibold text-slate-500 hover:bg-slate-100">{tl("Ricomincia")}</button>
          )}
          <button type="button" onClick={onClose} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100" aria-label={tl("Chiudi")}><X className="h-4 w-4" /></button>
        </div>
      </header>

      {/* ── Step 1: brief ─────────────────────────────────────────────── */}
      {step === 'brief' && (
        <div className="flex-1 overflow-y-auto">
          <div className="mx-auto max-w-3xl space-y-6 px-4 py-8">
            <section>
              <label className="text-sm font-bold text-slate-900" htmlFor="studio-topic">{tl("Di cosa parla la presentazione?")}</label>
              <textarea
                id="studio-topic"
                value={brief.topic}
                onChange={(event) => setBrief({ ...brief, topic: event.target.value })}
                rows={3}
                placeholder={tl("Es. La fotosintesi: come le piante producono energia e perché è importante per la vita sulla Terra")}
                className="mt-2 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm shadow-sm focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100"
              />
            </section>
            <section>
              <label className="text-sm font-bold text-slate-900" htmlFor="studio-source">{tl("Materiali di partenza")} <span className="font-normal text-slate-500">(facoltativo)</span></label>
              <p className="text-xs text-slate-500">{tl("Incolla appunti, un testo o un indice: l'IA li userà come fonte principale invece di inventare.")}</p>
              <textarea
                id="studio-source"
                value={brief.source_text}
                onChange={(event) => setBrief({ ...brief, source_text: event.target.value.slice(0, 60000) })}
                rows={5}
                className="mt-2 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm shadow-sm focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100"
              />
            </section>
            <section className="grid gap-5 sm:grid-cols-2">
              <ChipField label={tl("Per chi è")} value={brief.audience} options={AUDIENCES} onChange={(audience) => setBrief({ ...brief, audience })} />
              <ChipField label={tl("Obiettivo")} value={brief.goal} options={GOALS} onChange={(goal) => setBrief({ ...brief, goal })} />
            </section>
            <section className="grid gap-5 sm:grid-cols-2">
              <div>
                <span className="text-sm font-bold text-slate-900">{tl("Numero di slide:")} {brief.slide_count}</span>
                <input type="range" min={4} max={16} value={brief.slide_count} onChange={(event) => setBrief({ ...brief, slide_count: Number(event.target.value) })} className="mt-3 w-full accent-indigo-600" aria-label={tl("Numero di slide")} />
              </div>
              <div>
                <span className="text-sm font-bold text-slate-900">{tl("Quanto testo per slide")}</span>
                <div className="mt-2 grid grid-cols-3 gap-1.5">
                  {DENSITIES.map(item => (
                    <button key={item.value} type="button" onClick={() => setBrief({ ...brief, density: item.value })}
                      className={`rounded-lg border px-2 py-1.5 text-left text-xs ${brief.density === item.value ? 'border-indigo-400 bg-indigo-50 text-indigo-900' : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300'}`}>
                      <span className="block font-bold">{item.label}</span><span className="block text-[11px] text-slate-500">{item.hint}</span>
                    </button>
                  ))}
                </div>
              </div>
            </section>
            <section>
              <label className="text-sm font-bold text-slate-900" htmlFor="studio-tone">{tl("Tono")} <span className="font-normal text-slate-500">(facoltativo)</span></label>
              <input id="studio-tone" value={brief.tone} onChange={(event) => setBrief({ ...brief, tone: event.target.value })} placeholder={tl("Es. coinvolgente, con domande alla classe")}
                className="mt-2 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm shadow-sm focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100" />
            </section>
            <div className="flex items-center justify-end gap-2 border-t border-slate-200 pt-5">
              {onBlank && <button type="button" onClick={onBlank} className="mr-auto text-xs font-semibold text-slate-500 underline-offset-2 hover:text-slate-800 hover:underline">{tl("Inizia da una presentazione vuota")}</button>}
              {outline && <Button tone="neutral" surface="soft" onClick={() => setStep('outline')}>{tl("Torna alla scaletta")}</Button>}
              <Button tone="accent" disabled={brief.topic.trim().length < 3 || busy === 'outline'} onClick={() => void runOutline('create')}>
                {busy === 'outline' ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Sparkles className="mr-1.5 h-4 w-4" />}
                {busy === 'outline' ? tl("Scrivo la scaletta…") : outline ? tl("Riscrivi la scaletta") : tl("Scrivi la scaletta")}
              </Button>
            </div>
            {busy === 'outline' && <p className="text-right text-xs text-slate-500">{tl("Progetto i contenuti slide per slide: di solito servono 20–40 secondi.")}</p>}
          </div>
        </div>
      )}

      {/* ── Step 2: outline ───────────────────────────────────────────── */}
      {step === 'outline' && outline && (
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 bg-white px-4 py-2.5">
            <input value={outline.title} onChange={(event) => setOutline({ ...outline, title: event.target.value })} aria-label={tl("Titolo della presentazione")}
              className="min-w-[12rem] flex-1 rounded-lg border border-transparent px-2 py-1 text-sm font-bold text-slate-900 hover:border-slate-200 focus:border-indigo-300 focus:outline-none" />
            <form className="flex min-w-[18rem] flex-[2] items-center gap-1.5" onSubmit={(event) => { event.preventDefault(); if (reviseText.trim()) void runOutline('revise') }}>
              <input value={reviseText} onChange={(event) => setReviseText(event.target.value)} disabled={Boolean(busy)}
                placeholder={tl("Chiedi all'IA di cambiare la scaletta (es. aggiungi un esempio pratico, accorcia a 6 slide…)")}
                className="flex-1 rounded-lg border border-slate-200 px-3 py-1.5 text-sm focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100" />
              <Button tone="accent" surface="soft" density="compact" type="submit" disabled={!reviseText.trim() || Boolean(busy)}>
                {busy === 'revise' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wand2 className="h-4 w-4" />}
              </Button>
            </form>
            {outlineHistory.length > 0 && (
              <button type="button" onClick={undoOutline} disabled={Boolean(busy)} className="flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-100">
                <RotateCcw className="h-3.5 w-3.5" /> {tl("Annulla modifica IA")}
              </button>
            )}
          </div>
          <div className="flex min-h-0 flex-1">
            <aside className="w-72 shrink-0 overflow-y-auto border-r border-slate-200 bg-white p-2">
              <ol className="space-y-1">
                {outline.slides.map((slide, index) => {
                  const problems = slideProblems(slide)
                  return (
                    <li key={slide.id}>
                      <button type="button" onClick={() => setSelectedIndex(index)}
                        className={`flex w-full items-start gap-2 rounded-lg px-2 py-2 text-left ${selectedIndex === index ? 'bg-indigo-50 ring-1 ring-indigo-200' : 'hover:bg-slate-50'}`}>
                        <span className="mt-0.5 w-5 shrink-0 text-right text-xs font-bold text-slate-400">{index + 1}</span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-semibold text-slate-900">{slide.title || slide.stat_value || slide.quote || tl("Senza titolo")}</span>
                          <span className="block text-[11px] text-slate-500">{LAYOUT_LABELS[slide.layout]}</span>
                        </span>
                        {problems.length > 0 && <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-amber-500" title={problems.join(' · ')} />}
                      </button>
                    </li>
                  )
                })}
              </ol>
              <button type="button" onClick={addSlide} className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-slate-300 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50">
                <Plus className="h-3.5 w-3.5" /> {tl("Aggiungi slide")}
              </button>
            </aside>
            <main className="min-w-0 flex-1 overflow-y-auto">
              {selectedSlide && (
                <div className="mx-auto max-w-3xl space-y-4 px-5 py-5">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-bold text-slate-900">Slide {selectedIndex + 1}</span>
                    <select value={selectedSlide.layout} onChange={(event) => updateSlide(selectedIndex, { layout: event.target.value as StudioLayout })} aria-label="Layout"
                      className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs font-semibold text-slate-700">
                      {(Object.keys(LAYOUT_LABELS) as StudioLayout[]).map(key => <option key={key} value={key}>{LAYOUT_LABELS[key]}</option>)}
                    </select>
                    <div className="ml-auto flex items-center gap-0.5">
                      <IconAction label={tl("Sposta su")} disabled={selectedIndex === 0} onClick={() => moveSlide(selectedIndex, -1)}><ArrowUp className="h-4 w-4" /></IconAction>
                      <IconAction label={tl("Sposta giù")} disabled={selectedIndex === outline.slides.length - 1} onClick={() => moveSlide(selectedIndex, 1)}><ArrowDown className="h-4 w-4" /></IconAction>
                      <IconAction label={tl("Duplica")} onClick={() => duplicateSlide(selectedIndex)}><Copy className="h-4 w-4" /></IconAction>
                      <IconAction label={tl("Elimina")} disabled={outline.slides.length <= 1} onClick={() => deleteSlide(selectedIndex)}><Trash2 className="h-4 w-4" /></IconAction>
                    </div>
                  </div>
                  {slideProblems(selectedSlide).length > 0 && (
                    <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs font-medium text-amber-800">{slideProblems(selectedSlide).join(' · ')}</p>
                  )}
                  <OutlineSlideFields slide={selectedSlide} onChange={(patch) => updateSlide(selectedIndex, patch)} />
                  <label className="block">
                    <span className="text-xs font-bold uppercase tracking-wide text-slate-500">{tl("Note per chi presenta")}</span>
                    <textarea value={selectedSlide.notes} onChange={(event) => updateSlide(selectedIndex, { notes: event.target.value })} rows={4}
                      className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100" />
                  </label>
                  <form className="flex items-center gap-1.5 rounded-xl border border-indigo-100 bg-indigo-50/60 p-2" onSubmit={(event) => { event.preventDefault(); void runOutline('slide') }}>
                    <Sparkles className="ml-1 h-4 w-4 shrink-0 text-indigo-500" />
                    <input value={slideInstruction} onChange={(event) => setSlideInstruction(event.target.value)} disabled={Boolean(busy)}
                      placeholder={tl("Riscrivi questa slide con l'IA (es. più semplice, aggiungi un esempio, trasformala in un confronto)")}
                      className="flex-1 bg-transparent px-1 py-1 text-sm focus:outline-none" />
                    <Button tone="accent" surface="soft" density="compact" type="submit" disabled={Boolean(busy)}>
                      {busy === 'slide' ? <Loader2 className="h-4 w-4 animate-spin" /> : tl("Riscrivi")}
                    </Button>
                  </form>
                </div>
              )}
            </main>
          </div>
          <footer className="flex items-center gap-3 border-t border-slate-200 bg-white px-4 py-3">
            <Button tone="neutral" surface="soft" onClick={() => setStep('brief')}><ArrowLeft className="mr-1.5 h-4 w-4" /> {tl("Contenuti")}</Button>
            <span className="ml-auto text-xs text-slate-500">
              {outline.slides.length} slide{problemsCount > 0 ? ` · ${problemsCount} da sistemare` : tl(" · pronta")}
            </span>
            <Button tone="accent" disabled={Boolean(busy)} onClick={() => void goToStyle()}>{tl("Scegli lo stile")} <ArrowRight className="ml-1.5 h-4 w-4" /></Button>
          </footer>
        </div>
      )}

      {/* ── Step 3: style ─────────────────────────────────────────────── */}
      {step === 'style' && outline && (
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
            <main className="min-w-0 flex-1 overflow-y-auto px-5 py-5">
              <div className="grid gap-4 md:grid-cols-3">
                {STYLE_QUESTIONS.map(question => (
                  <div key={question.key}>
                    <p className="text-xs font-bold uppercase tracking-wide text-slate-500">{question.question}</p>
                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                      {question.options.map(option => {
                        const active = answers[question.key] === option.value
                        return (
                          <button key={option.value} type="button" onClick={() => setAnswer(question.key, (active && question.key !== 'readability' ? null : option.value) as never)}
                            className={`rounded-full border px-3 py-1 text-xs font-semibold ${active ? 'border-indigo-400 bg-indigo-50 text-indigo-900' : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300'}`}>
                            {option.label}
                          </button>
                        )
                      })}
                    </div>
                  </div>
                ))}
              </div>
              <h3 className="mt-6 text-sm font-bold text-slate-900">{tl("Template consigliati")}</h3>
              {previewLoading && <p className="mt-2 flex items-center gap-2 text-xs text-slate-500"><Loader2 className="h-3.5 w-3.5 animate-spin" /> {tl("Preparo le anteprime con le tue slide…")}</p>}
              <div className="mt-2 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {rankedThemes.slice(0, 3).map(theme => (
                  <ThemeCard key={theme.id} theme={theme} slides={galleryPreviews[theme.id] || []} format={format} selected={themeId === theme.id}
                    reason={reasonFor(theme.id)} onSelect={() => setThemeId(theme.id)} large />
                ))}
              </div>
              <h3 className="mt-6 text-sm font-bold text-slate-900">{tl("Altri template")}</h3>
              <div className="mt-2 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
                {rankedThemes.slice(3).map(theme => (
                  <ThemeCard key={theme.id} theme={theme} slides={galleryPreviews[theme.id] || []} format={format} selected={themeId === theme.id}
                    reason={reasonFor(theme.id)} onSelect={() => setThemeId(theme.id)} />
                ))}
              </div>
            </main>
            <aside className="w-full shrink-0 overflow-y-auto border-t border-slate-200 bg-white p-4 lg:w-[22rem] lg:border-l lg:border-t-0">
              <p className="text-xs font-bold uppercase tracking-wide text-slate-500">{tl("Anteprima")}</p>
              <div className="mt-2 grid grid-cols-2 gap-2">
                {selectedPreview.map(slide => <StudioSlidePreview key={slide.id} slide={slide} format={format} />)}
              </div>
              <div className="mt-5 space-y-3">
                <label className="block text-xs font-bold text-slate-700">{tl("Caratteri")}
                  <select value={options.font} onChange={(event) => setOptions({ ...options, font: event.target.value as ThemeOptions['font'] })}
                    className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-sm font-normal">
                    {FONT_OPTIONS.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}
                  </select>
                </label>
                <div className="flex items-center gap-2 text-xs font-bold text-slate-700">
                  {tl("Colore d'accento")}
                  <ColorPicker value={options.accent || themes.find(t => t.id === themeId)?.colors.accent || '#0891B2'} onChange={(color) => setOptions({ ...options, accent: color })} title={tl("Colore d'accento")} />
                  {options.accent && <button type="button" onClick={() => setOptions({ ...options, accent: null })} className="text-[11px] font-semibold text-indigo-600">{tl("del template")}</button>}
                </div>
                <Toggle label={tl("Testo più grande")} checked={options.large_text} onChange={(large_text) => setOptions({ ...options, large_text })} />
                <Toggle label={tl("Numeri di pagina")} checked={options.slide_numbers} onChange={(slide_numbers) => setOptions({ ...options, slide_numbers })} />
                <Toggle label={tl("Versione scura (stesso sfondo scuro su tutte le slide)")} checked={options.dark || themes.find(t => t.id === themeId)?.brightness === 'dark'}
                  onChange={(dark) => setOptions({ ...options, dark })} disabled={themes.find(t => t.id === themeId)?.brightness === 'dark'} />
                <Toggle label={tl("Slide con immagini")} checked={options.images} onChange={(images) => setOptions({ ...options, images })} />
                <Toggle label={tl("Genera le immagini con l'IA")} checked={generateImages && options.images} disabled={!options.images} onChange={setGenerateImages} />
                <div className="flex items-center gap-2 text-xs font-bold text-slate-700">
                  {tl("Formato")}
                  {(['16:9', '4:3'] as Format[]).map(value => (
                    <button key={value} type="button" onClick={() => setFormat(value)}
                      className={`rounded-md border px-2 py-0.5 text-xs ${format === value ? 'border-indigo-400 bg-indigo-50 text-indigo-900' : 'border-slate-200 text-slate-600'}`}>{value}</button>
                  ))}
                </div>
                <p className="rounded-lg bg-emerald-50 px-3 py-2 text-[11px] text-emerald-800">
                  {tl("Colori e contrasti sono verificati automaticamente: il testo resta sempre leggibile, qualunque scelta tu faccia. Potrai cambiare template anche dopo, dall'editor.")}
                </p>
              </div>
            </aside>
          </div>
          <footer className="flex items-center gap-3 border-t border-slate-200 bg-white px-4 py-3">
            <Button tone="neutral" surface="soft" onClick={() => setStep('outline')}><ArrowLeft className="mr-1.5 h-4 w-4" /> {tl("Scaletta")}</Button>
            {imageProgress && (
              <span className="ml-auto flex items-center gap-2 text-xs text-slate-600">
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> {tl("Genero le immagini")} {imageProgress.done}/{imageProgress.total}…
                <button type="button" onClick={() => imageAbortRef.current?.abort()} className="font-semibold text-indigo-600 hover:underline">{tl("Salta")}</button>
              </span>
            )}
            <Button tone="accent" className={imageProgress ? '' : 'ml-auto'} disabled={!themeId || busy === 'render'} onClick={() => void createDeck()}>
              {busy === 'render' ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Check className="mr-1.5 h-4 w-4" />}
              {tl("Crea la presentazione")}
            </Button>
          </footer>
        </div>
      )}
    </div>
  )
}

function ChipField({ label, value, options, onChange }: { label: string; value: string; options: string[]; onChange: (value: string) => void }) {
  return (
    <div>
      <span className="text-sm font-bold text-slate-900">{label}</span>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {options.map(option => (
          <button key={option} type="button" onClick={() => onChange(value === option ? '' : option)}
            className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${value === option ? 'border-indigo-400 bg-indigo-50 text-indigo-900' : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300'}`}>
            {option}
          </button>
        ))}
      </div>
      <input value={options.includes(value) ? '' : value} onChange={(event) => onChange(event.target.value)} placeholder={tl("oppure scrivi tu…")}
        className="mt-2 w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs focus:border-indigo-400 focus:outline-none" />
    </div>
  )
}

function IconAction({ label, onClick, disabled, children }: { label: string; onClick: () => void; disabled?: boolean; children: React.ReactNode }) {
  return (
    <button type="button" title={label} aria-label={label} onClick={onClick} disabled={disabled}
      className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-800 disabled:opacity-30">{children}</button>
  )
}

function Toggle({ label, checked, onChange, disabled }: { label: string; checked: boolean; onChange: (value: boolean) => void; disabled?: boolean }) {
  return (
    <label className={`flex cursor-pointer items-center justify-between gap-3 text-xs font-bold text-slate-700 ${disabled ? 'opacity-50' : ''}`}>
      {label}
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(event) => onChange(event.target.checked)} className="h-4 w-4 shrink-0 accent-indigo-600" />
    </label>
  )
}

const listText = (items: string[]) => items.join('\n')
const parseList = (text: string) => text.split('\n').map(line => line.replace(/^\s*[-•*]\s*/, '')).filter((line, index, all) => line.trim() || index < all.length - 1)

function OutlineSlideFields({ slide, onChange }: { slide: OutlineSlide; onChange: (patch: Partial<OutlineSlide>) => void }) {
  const fields = LAYOUT_FIELDS[slide.layout]
  const input = 'mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100'
  const label = 'text-xs font-bold uppercase tracking-wide text-slate-500'
  const pointsHint = slide.layout === 'cards' ? tl("una scheda per riga, nel formato «Concetto: spiegazione»")
    : slide.layout === 'timeline' ? tl("un passaggio per riga") : tl("un punto per riga")
  return (
    <div className="space-y-3">
      {fields.includes('stat_value') && (
        <div className="grid gap-3 sm:grid-cols-[10rem_1fr]">
          <label className="block"><span className={label}>{tl("Dato")}</span><input value={slide.stat_value} onChange={(e) => onChange({ stat_value: e.target.value })} placeholder="70%" className={input} /></label>
          <label className="block"><span className={label}>{tl("Che cosa indica")}</span><input value={slide.stat_label} onChange={(e) => onChange({ stat_label: e.target.value })} className={input} /></label>
        </div>
      )}
      {fields.includes('title') && (
        <label className="block"><span className={label}>{tl("Titolo")}</span><input value={slide.title} onChange={(e) => onChange({ title: e.target.value })} className={`${input} font-semibold`} /></label>
      )}
      {fields.includes('subtitle') && (
        <label className="block"><span className={label}>{slide.layout === 'section' ? tl("Etichetta (es. Parte 2)") : slide.layout === 'big_stat' ? tl("Contesto") : tl("Sottotitolo")}</span>
          <input value={slide.subtitle} onChange={(e) => onChange({ subtitle: e.target.value })} className={input} /></label>
      )}
      {fields.includes('quote') && (
        <>
          <label className="block"><span className={label}>{tl("Citazione")}</span><textarea value={slide.quote} onChange={(e) => onChange({ quote: e.target.value })} rows={3} className={input} /></label>
          <label className="block"><span className={label}>{tl("Autore")}</span><input value={slide.attribution} onChange={(e) => onChange({ attribution: e.target.value })} className={input} /></label>
        </>
      )}
      {slide.layout === 'two_column' ? (
        <div className="grid gap-3 sm:grid-cols-2">
          {([['left_label', 'points'], ['right_label', 'points_right']] as const).map(([labelKey, listKey], column) => (
            <div key={listKey} className="space-y-2 rounded-xl border border-slate-200 bg-white p-3">
              <input value={slide[labelKey]} onChange={(e) => onChange({ [labelKey]: e.target.value })} placeholder={column === 0 ? tl("Colonna sinistra") : tl("Colonna destra")}
                className="w-full rounded-md border border-slate-200 px-2 py-1 text-sm font-semibold" />
              <textarea value={listText(slide[listKey])} onChange={(e) => onChange({ [listKey]: parseList(e.target.value) })} rows={5} className="w-full rounded-md border border-slate-200 px-2 py-1.5 text-sm" placeholder={tl("un punto per riga")} />
            </div>
          ))}
        </div>
      ) : fields.includes('points') && (
        <label className="block"><span className={label}>{tl("Contenuto")} <span className="font-normal normal-case tracking-normal">· {pointsHint}</span></span>
          <textarea value={listText(slide.points)} onChange={(e) => onChange({ points: parseList(e.target.value) })} rows={Math.max(4, slide.points.length + 1)} className={input} /></label>
      )}
      {fields.includes('image_prompt') && (
        <label className="block"><span className={label}>{tl("Immagine da inserire")}</span>
          <input value={slide.image_prompt} onChange={(e) => onChange({ image_prompt: e.target.value })} placeholder={tl("Cosa deve mostrare l'immagine")} className={input} /></label>
      )}
    </div>
  )
}

function ThemeCard({ theme, slides, format, selected, reason, onSelect, large }: {
  theme: ResolvedTheme; slides: StudioSlide[]; format: Format; selected: boolean; reason?: string; onSelect: () => void; large?: boolean
}) {
  return (
    <button type="button" onClick={onSelect}
      className={`group flex flex-col overflow-hidden rounded-2xl border bg-white text-left transition-shadow ${selected ? 'border-indigo-500 ring-2 ring-indigo-200' : 'border-slate-200 hover:shadow-md'}`}>
      <div className={`grid gap-1 bg-slate-100 p-1.5 ${large && slides.length > 1 ? 'grid-cols-2' : 'grid-cols-1'}`}>
        {(large ? slides : slides.slice(0, 1)).map(slide => <StudioSlidePreview key={slide.id} slide={slide} format={format} />)}
        {slides.length === 0 && (
          <div className="flex aspect-video items-center justify-center rounded-md" style={{ background: theme.colors.background }}>
            <span className="h-2 w-1/2 rounded" style={{ background: theme.colors.primary }} />
          </div>
        )}
      </div>
      <div className="flex flex-1 flex-col gap-1 p-3">
        <div className="flex items-center gap-2">
          <span className="text-sm font-bold text-slate-900">{theme.name}</span>
          <span className="ml-auto flex gap-0.5">
            {['background', 'primary', 'accent', 'text'].map(role => <span key={role} className="h-3.5 w-3.5 rounded-full border border-slate-200" style={{ background: theme.colors[role] }} />)}
          </span>
          {selected && <Check className="h-4 w-4 text-indigo-600" />}
        </div>
        <p className="text-xs text-slate-500">{theme.description}</p>
        {reason && <p className="mt-1 flex items-start gap-1 text-[11px] font-medium text-indigo-700"><Sparkles className="mt-0.5 h-3 w-3 shrink-0" />{reason}</p>}
      </div>
    </button>
  )
}
