import { useEffect, useMemo, useState } from 'react'
import { ColorPicker } from '@/components/ui/ColorPicker'
import { Button } from '@/components/ui/button'
import { useToast } from '@/components/ui/use-toast'
import { AlertTriangle, Check, Image as ImageIcon, Loader2, Palette, Play, ShieldCheck, X } from '@/components/icons'
import PresentationPlayer from './PresentationPlayer'
import { HeaderIconButton } from '@/components/documents/DocumentEditorHeader'
import {
  DEFAULT_THEME_OPTIONS, QUALITY_LABELS, generateDeckImages, pendingImageSlots, presentationStudioApi,
  type DeckTheme, type QualityIssue, type ResolvedTheme, type StudioSlide, type ThemeOptions,
} from '@/lib/presentationStudio'
import { tl } from '@/i18n/tl'

type Props = {
  slides: StudioSlide[]
  theme?: DeckTheme | null
  dims: { width: number; height: number }
  onApply: (slides: StudioSlide[], theme?: DeckTheme) => void
  onJump: (slideIndex: number, blockId: string | null) => void
  /** Replace one image block's picture (patched on the latest deck, edits made meanwhile survive). */
  onPatchImage: (slideId: string, blockId: string, url: string) => void
  deckTitle: string
  format: '16:9' | '4:3'
  currentSlideIndex: number
  disabled?: boolean
}

const FONT_LABELS: Record<ThemeOptions['font'], string> = {
  theme: tl("Quelli del template"), leggibile: tl("Alta leggibilità (Lexend)"), serif: tl("Classico (titoli serif)"), moderno: tl("Moderno"),
}

/** Header tools for slide decks: theme switcher + quality check (both deterministic, no AI credits). */
export default function PresentationDeckTools({ slides, theme, dims, onApply, onJump, onPatchImage, deckTitle, format, currentSlideIndex, disabled }: Props) {
  const [presenting, setPresenting] = useState<number | null>(null)
  const { toast } = useToast()
  const [themeOpen, setThemeOpen] = useState(false)
  const [qualityOpen, setQualityOpen] = useState(false)
  const [issues, setIssues] = useState<QualityIssue[]>([])
  const [checking, setChecking] = useState(false)
  const [imageProgress, setImageProgress] = useState<{ done: number; total: number } | null>(null)
  const pendingImages = useMemo(() => pendingImageSlots(slides).length, [slides])

  const generateImages = async () => {
    const result = await generateDeckImages(slides, { deckTitle, theme }, (slot, url) => onPatchImage(slot.slideId, slot.blockId, url),
      (done, total) => setImageProgress({ done, total }))
    setImageProgress(null)
    toast({ title: tl("Immagini generate"), description: `${result.generated} pronte${result.failed ? `, ${result.failed} non riuscite` : ''}.` })
  }

  // Background check, debounced: keeps the badge current while the user edits.
  const signature = useMemo(() => JSON.stringify(slides.map(slide => slide.blocks)), [slides])
  useEffect(() => {
    if (disabled || slides.length === 0) { setIssues([]); return }
    let cancelled = false
    const timer = window.setTimeout(async () => {
      setChecking(true)
      try {
        const response = await presentationStudioApi.quality({ slides, theme, dims, fix: false })
        if (!cancelled) setIssues(response.data.issues)
      } catch { /* the badge simply stays as it was */ }
      finally { if (!cancelled) setChecking(false) }
    }, 1200)
    return () => { cancelled = true; window.clearTimeout(timer) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature, theme?.id, dims.width, dims.height, disabled])

  const fixAll = async () => {
    setChecking(true)
    try {
      const response = await presentationStudioApi.quality({ slides, theme, dims, fix: true })
      if (response.data.slides) onApply(response.data.slides)
      toast({ title: tl("Slide sistemate"), description: tl("{0} problemi corretti automaticamente.", response.data.issues.length) })
    } catch (error: any) {
      toast({ title: tl("Correzione non riuscita"), description: error?.response?.data?.detail || error?.message, variant: 'destructive' })
    } finally {
      setChecking(false)
    }
  }

  return (
    <>
      <HeaderIconButton label={tl("Presenta a schermo intero (dalla slide corrente)")} onClick={() => setPresenting(currentSlideIndex)}>
        <Play className="h-4 w-4" />
      </HeaderIconButton>
      {presenting !== null && <PresentationPlayer slides={slides} format={format} startIndex={presenting} onClose={() => setPresenting(null)} />}
      <HeaderIconButton label={tl("Tema della presentazione")} onClick={() => setThemeOpen(true)} active={themeOpen} disabled={disabled}>
        <Palette className="h-4 w-4" />
      </HeaderIconButton>
      <span className="relative">
        <HeaderIconButton label={issues.length ? tl("Controllo qualità: {0} problemi", issues.length) : tl("Controllo qualità")} onClick={() => setQualityOpen(value => !value)} active={qualityOpen} disabled={disabled}>
          <ShieldCheck className="h-4 w-4" />
        </HeaderIconButton>
        {issues.length + pendingImages > 0 && !disabled && (
          <span className="pointer-events-none absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-amber-500 px-1 text-[10px] font-bold text-white">{issues.length + pendingImages}</span>
        )}
      </span>

      {qualityOpen && (
        <div className="fixed right-4 top-16 z-50 w-80 rounded-2xl border border-slate-200 bg-white shadow-2xl" role="dialog" aria-label={tl("Controllo qualità")}>
          <div className="flex items-center gap-2 border-b border-slate-100 px-4 py-3">
            <ShieldCheck className="h-4 w-4 text-emerald-600" />
            <span className="text-sm font-bold text-slate-900">{tl("Controllo qualità")}</span>
            {checking && <Loader2 className="h-3.5 w-3.5 animate-spin text-slate-400" />}
            <button type="button" onClick={() => setQualityOpen(false)} className="ml-auto rounded p-1 text-slate-400 hover:bg-slate-100" aria-label={tl("Chiudi")}><X className="h-4 w-4" /></button>
          </div>
          {pendingImages > 0 && (
            <div className="flex items-center gap-2 border-b border-slate-100 px-4 py-3">
              <ImageIcon className="h-4 w-4 shrink-0 text-indigo-500" />
              <span className="flex-1 text-xs text-slate-700">{pendingImages} {pendingImages === 1 ? tl("spazio immagine da riempire") : tl("spazi immagine da riempire")}</span>
              <Button tone="accent" surface="soft" density="compact" disabled={Boolean(imageProgress)} onClick={() => void generateImages()}>
                {imageProgress ? `${imageProgress.done}/${imageProgress.total}` : tl("Genera con IA")}
              </Button>
            </div>
          )}
          {issues.length === 0 ? (
            <p className="flex items-center gap-2 px-4 py-5 text-sm text-slate-600"><Check className="h-4 w-4 text-emerald-600" /> {tl("Nessun problema: testi leggibili, nulla fuori dalla slide.")}</p>
          ) : (
            <>
              <ul className="max-h-80 overflow-y-auto px-2 py-2">
                {issues.map((issue, index) => (
                  <li key={`${issue.slide_index}-${issue.block_id}-${issue.code}-${index}`}>
                    <button type="button" onClick={() => onJump(issue.slide_index, issue.block_id)} className="flex w-full items-start gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-slate-50">
                      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500" />
                      <span className="text-xs text-slate-700"><b>Slide {issue.slide_index + 1}</b> · {QUALITY_LABELS[issue.code] || issue.message}</span>
                    </button>
                  </li>
                ))}
              </ul>
              <div className="border-t border-slate-100 p-3">
                <Button tone="accent" density="compact" className="w-full" disabled={checking} onClick={() => void fixAll()}>{tl("Correggi tutto automaticamente")}</Button>
                <p className="mt-2 text-[11px] text-slate-500">{tl("Ricolora i testi illeggibili, riporta dentro la slide gli oggetti e rimuove le forme vuote. Puoi annullare con Ctrl+Z.")}</p>
              </div>
            </>
          )}
        </div>
      )}

      {themeOpen && (
        <ThemeDialog
          current={theme}
          onClose={() => setThemeOpen(false)}
          onApply={async (themeId, options) => {
            try {
              const response = await presentationStudioApi.retheme({ slides, theme_id: themeId, options, dims })
              onApply(response.data.slides, response.data.theme)
              setThemeOpen(false)
              toast({ title: tl("Tema «{0}» applicato", response.data.resolved_theme.name), description: tl("Le modifiche fatte a mano sono state conservate.") })
            } catch (error: any) {
              toast({ title: tl("Tema non applicato"), description: error?.response?.data?.detail || error?.message, variant: 'destructive' })
            }
          }}
        />
      )}
    </>
  )
}

function ThemeDialog({ current, onClose, onApply }: {
  current?: DeckTheme | null
  onClose: () => void
  onApply: (themeId: string, options: Partial<ThemeOptions>) => Promise<void>
}) {
  const [themes, setThemes] = useState<ResolvedTheme[]>([])
  const [themeId, setThemeId] = useState(current?.id || 'aula')
  const [options, setOptions] = useState<ThemeOptions>({ ...DEFAULT_THEME_OPTIONS, ...(current?.options || {}) })
  const [applying, setApplying] = useState(false)

  useEffect(() => {
    presentationStudioApi.templates().then(response => setThemes(response.data.themes)).catch(() => setThemes([]))
  }, [])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label={tl("Tema della presentazione")}
      onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <div className="flex max-h-[90vh] w-full max-w-3xl flex-col rounded-2xl border border-slate-200 bg-white shadow-2xl">
        <div className="flex items-start gap-3 border-b border-slate-100 px-5 py-4">
          <div>
            <h3 className="text-lg font-bold text-slate-900">{tl("Tema della presentazione")}</h3>
            <p className="text-sm text-slate-500">{tl("Cambia colori e caratteri di tutte le slide. Contenuti e modifiche fatte a mano restano.")}</p>
          </div>
          <button type="button" onClick={onClose} className="ml-auto rounded-lg p-1.5 text-slate-500 hover:bg-slate-100" aria-label={tl("Chiudi")}><X className="h-4 w-4" /></button>
        </div>
        <div className="grid flex-1 grid-cols-2 gap-3 overflow-y-auto p-5 sm:grid-cols-3">
          {themes.length === 0 && <Loader2 className="h-5 w-5 animate-spin text-slate-400" />}
          {themes.map(theme => (
            <button key={theme.id} type="button" onClick={() => setThemeId(theme.id)}
              className={`overflow-hidden rounded-xl border text-left ${themeId === theme.id ? 'border-indigo-500 ring-2 ring-indigo-200' : 'border-slate-200 hover:shadow-md'}`}>
              <div className="flex aspect-video flex-col justify-center gap-1.5 px-4" style={{ background: theme.colors.background }}>
                <span className="text-sm font-bold" style={{ color: theme.colors.text, fontFamily: theme.fonts.heading }}>{tl("Titolo della slide")}</span>
                <span className="h-1 w-8 rounded" style={{ background: theme.colors.accent }} />
                <span className="text-[11px]" style={{ color: theme.colors.muted, fontFamily: theme.fonts.body }}>{tl("Testo del paragrafo")}</span>
                <span className="mt-1 h-4 w-16 rounded" style={{ background: theme.colors.primary }} />
              </div>
              <div className="px-3 py-2">
                <span className="block text-sm font-bold text-slate-900">{theme.name}</span>
                <span className="line-clamp-2 block text-[11px] text-slate-500">{theme.description}</span>
              </div>
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-slate-100 px-5 py-3 text-xs font-bold text-slate-700">
          <label className="flex items-center gap-1.5">{tl("Caratteri")}
            <select value={options.font} onChange={(event) => setOptions({ ...options, font: event.target.value as ThemeOptions['font'] })} className="rounded-md border border-slate-200 px-1.5 py-1 font-normal">
              {(Object.keys(FONT_LABELS) as ThemeOptions['font'][]).map(key => <option key={key} value={key}>{FONT_LABELS[key]}</option>)}
            </select>
          </label>
          <label className="flex items-center gap-1.5">{tl("Accento")}
            <ColorPicker value={options.accent || themes.find(t => t.id === themeId)?.colors.accent || '#0891B2'} onChange={(color) => setOptions({ ...options, accent: color })} title={tl("Colore")} />
            {options.accent && <button type="button" onClick={() => setOptions({ ...options, accent: null })} className="font-semibold text-indigo-600">reset</button>}
          </label>
          <label className="flex items-center gap-1.5"><input type="checkbox" checked={options.large_text} onChange={(event) => setOptions({ ...options, large_text: event.target.checked })} className="accent-indigo-600" /> {tl("Testo più grande")}</label>
          <label className="flex items-center gap-1.5"><input type="checkbox" checked={options.slide_numbers} onChange={(event) => setOptions({ ...options, slide_numbers: event.target.checked })} className="accent-indigo-600" /> {tl("Numeri di pagina")}</label>
          <Button tone="accent" density="compact" className="ml-auto" disabled={applying} onClick={async () => { setApplying(true); try { await onApply(themeId, options) } finally { setApplying(false) } }}>
            {applying ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Palette className="mr-1.5 h-4 w-4" />} {tl("Applica")}
          </Button>
        </div>
      </div>
    </div>
  )
}
