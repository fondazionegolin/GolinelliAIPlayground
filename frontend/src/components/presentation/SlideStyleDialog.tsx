import { useEffect, useMemo, useState } from 'react'
import { ColorPicker } from '@/components/ui/ColorPicker'
import { useToast } from '@/components/ui/use-toast'
import { Button, Input, Select } from '@/design'
import { Check, Loader2, Palette, Save, Trash2, X } from '@/components/icons'
import {
  presentationStudioApi, type DeckTheme, type SavedSlideStyle, type SlideStyleSpec, type SlideTextStyle, type StudioSlide,
} from '@/lib/presentationStudio'
import { ensureFontFamily } from '@/lib/slideFonts'
import { tl } from '@/i18n/tl'

type Props = {
  slides: StudioSlide[]
  currentSlideIndex: number
  theme?: DeckTheme | null
  dims: { width: number; height: number }
  onApply: (slides: StudioSlide[]) => void
  onClose: () => void
}

const FALLBACK_FONTS = ['Inter', 'Lexend', 'Plus Jakarta Sans', 'Georgia', 'Merriweather', 'Playfair Display', 'Montserrat', 'Poppins', 'Roboto Slab']
const BACKGROUND_PRESETS = ['#FFFFFF', '#F8FAFC', '#FBF7F0', '#FEF9C3', '#DBEAFE', '#1A1A2E', '#0F172A', '#000000']
const KEEP = ''

const firstFont = (stack?: string) => (stack || '').split(',')[0].trim().replace(/^['"]|['"]$/g, '')
const isHeading = (block: StudioSlide['blocks'][number]) => {
  if (block.type !== 'text') return false
  const style = block.style as { fontSize?: number; fontWeight?: string }
  const bold = ['bold', '600', '700', '800', '900'].includes(String(style.fontWeight || '').toLowerCase())
  return (style.fontSize ?? 18) >= 30 || (bold && (style.fontSize ?? 18) >= 22)
}

/** What the current slide looks like, to prefill the form (so the preview is truthful before any change). */
function readStyle(slide?: StudioSlide): SlideStyleSpec {
  const texts = (slide?.blocks || []).filter(block => block.type === 'text')
  const pick = (block?: StudioSlide['blocks'][number]): SlideTextStyle => {
    const style = (block?.style || {}) as SlideTextStyle
    return { fontFamily: firstFont(style.fontFamily) || undefined, fontSize: style.fontSize, color: style.color }
  }
  return { background: slide?.backgroundColor || '#FFFFFF', title: pick(texts.find(isHeading)), body: pick(texts.find(block => !isHeading(block))) }
}

/** Slide look editor: background, title and body typography, accent; applied to one slide or the whole deck
 * (deterministic, no AI credits) and savable as a named style reusable later. */
export default function SlideStyleDialog({ slides, currentSlideIndex, theme, dims, onApply, onClose }: Props) {
  const { toast } = useToast()
  const [scope, setScope] = useState<'slide' | 'deck'>('slide')
  // Only what the user changes is part of the style (applied and saved). The slide's current look is shown as a hint,
  // never sent: otherwise its first title colour/size would be stamped on every slide.
  const current = useMemo(() => readStyle(slides[currentSlideIndex]), [slides, currentSlideIndex])
  const [style, setStyle] = useState<SlideStyleSpec>({})
  const [saved, setSaved] = useState<SavedSlideStyle[]>([])
  const [fonts, setFonts] = useState<string[]>(FALLBACK_FONTS)
  const [activeId, setActiveId] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [busy, setBusy] = useState<'apply' | 'save' | null>(null)

  useEffect(() => {
    presentationStudioApi.styles().then(response => { setSaved(response.data.styles); if (response.data.fonts?.length) setFonts(response.data.fonts) }).catch(() => undefined)
  }, [])
  useEffect(() => { [style.title?.fontFamily, style.body?.fontFamily].forEach(font => font && ensureFontFamily(firstFont(font))) }, [style.title?.fontFamily, style.body?.fontFamily])

  const setPart = (part: 'title' | 'body', patch: Partial<SlideTextStyle>) => setStyle(prev => {
    const next: SlideTextStyle = { ...prev[part], ...patch }
    ;(Object.keys(next) as (keyof SlideTextStyle)[]).forEach(key => { if (next[key] === undefined || next[key] === '') delete next[key] })
    const { [part]: _removed, ...rest } = prev
    return Object.keys(next).length ? { ...rest, [part]: next } : rest
  })
  const hasChanges = Boolean(style.background || style.accent || Object.keys(style.title || {}).length || Object.keys(style.body || {}).length)
  const fontOptions = useMemo(() => {
    const extra = [firstFont(style.title?.fontFamily), firstFont(style.body?.fontFamily)].filter(font => font && !fonts.includes(font))
    return [...new Set([...extra, ...fonts])]
  }, [fonts, style.title?.fontFamily, style.body?.fontFamily])

  const loadSaved = (item: SavedSlideStyle) => {
    setActiveId(item.id)
    setName(item.name)
    setStyle(item.style)
  }
  const apply = async () => {
    setBusy('apply')
    try {
      const response = await presentationStudioApi.applyStyle({ slides, style, slide_ids: scope === 'slide' ? [slides[currentSlideIndex]?.id].filter(Boolean) : null, theme, dims })
      onApply(response.data.slides)
      toast({ title: tl("Stile applicato"), description: scope === 'slide' ? tl("Slide corrente aggiornata. Puoi annullare con Ctrl+Z.") : tl("Tutte le slide aggiornate. Puoi annullare con Ctrl+Z.") })
      onClose()
    } catch (error: any) {
      toast({ title: tl("Stile non applicato"), description: error?.response?.data?.detail || error?.message, variant: 'destructive' })
    } finally { setBusy(null) }
  }
  const save = async (asNew: boolean) => {
    const label = name.trim()
    if (!label) { toast({ title: tl("Dai un nome allo stile"), variant: 'destructive' }); return }
    setBusy('save')
    try {
      const response = asNew || !activeId ? await presentationStudioApi.createStyle({ name: label, style }) : await presentationStudioApi.updateStyle(activeId, { name: label, style })
      setSaved(current => [response.data, ...current.filter(item => item.id !== response.data.id)])
      setActiveId(response.data.id)
      toast({ title: tl("Stile «{0}» salvato", response.data.name) })
    } catch (error: any) {
      toast({ title: tl("Stile non salvato"), description: error?.response?.data?.detail || error?.message, variant: 'destructive' })
    } finally { setBusy(null) }
  }
  const remove = async (item: SavedSlideStyle) => {
    try {
      await presentationStudioApi.deleteStyle(item.id)
      setSaved(current => current.filter(entry => entry.id !== item.id))
      if (activeId === item.id) { setActiveId(null); setName('') }
    } catch { toast({ title: tl("Stile non eliminato"), variant: 'destructive' }) }
  }

  const background = style.background || current.background || '#FFFFFF'
  const shown = (part: 'title' | 'body') => ({ ...current[part], ...style[part] })
  const familyOf = (part: 'title' | 'body') => shown(part).fontFamily ? `'${firstFont(shown(part).fontFamily)}', Inter, sans-serif` : undefined
  const titleFont = familyOf('title')
  const bodyFont = familyOf('body')
  const previewScale = 0.42

  const textFields = (part: 'title' | 'body', label: string) => {
    const chosen = style[part] || {}
    const now = current[part] || {}
    return (
      <fieldset className="space-y-2">
        <legend className="mb-1 text-xs font-bold uppercase tracking-wide text-[var(--text-secondary)]">{label}</legend>
        <div className="grid grid-cols-[1fr_88px] items-center gap-2">
          <Select density="compact" aria-label={tl("Carattere")} value={firstFont(chosen.fontFamily) || KEEP}
            onChange={(event) => setPart(part, { fontFamily: event.target.value || undefined })}>
            <option value={KEEP}>{now.fontFamily ? tl("Invariato ({0})", now.fontFamily) : tl("Invariato")}</option>
            {fontOptions.map(font => <option key={font} value={font}>{font}</option>)}
          </Select>
          <Input density="compact" type="number" min={10} max={140} aria-label={tl("Dimensione")} placeholder={now.fontSize ? String(now.fontSize) : 'px'} value={chosen.fontSize ?? ''}
            onChange={(event) => setPart(part, { fontSize: event.target.value ? Number(event.target.value) : undefined })} />
        </div>
        <div className="flex items-center gap-2 text-xs text-[var(--text-secondary)]">
          <ColorPicker value={chosen.color || now.color || '#1A1A2E'} onChange={(color) => setPart(part, { color })} title={tl("Colore del testo")} />
          {chosen.color
            ? <><span className="font-mono">{chosen.color.toUpperCase()}</span><button type="button" className="font-semibold" onClick={() => setPart(part, { color: undefined })}>{tl("Non cambiare")}</button></>
            : <span>{tl("Colore invariato")}</span>}
        </div>
      </fieldset>
    )
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 p-4" role="dialog" aria-modal="true" aria-label={tl("Stile delle slide")}
      onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <div className="ds-popover flex max-h-[92vh] w-full max-w-4xl flex-col overflow-hidden rounded-3xl">
        <div className="flex items-start gap-3 px-6 pb-3 pt-5">
          <div>
            <h3 className="text-lg font-bold text-[var(--text-primary)]">{tl("Stile delle slide")}</h3>
            <p className="text-sm text-[var(--text-secondary)]">{tl("Sfondo, caratteri, dimensioni e colori. Applicali a una slide o a tutta la presentazione e salvali come stile.")}</p>
          </div>
          <button type="button" onClick={onClose} className="ml-auto rounded-lg p-1.5 text-[var(--text-secondary)]" aria-label={tl("Chiudi")}><X className="h-4 w-4" /></button>
        </div>

        <div className="grid flex-1 gap-6 overflow-y-auto px-6 pb-4 md:grid-cols-[1fr_360px]">
          <div className="space-y-5">
            <div className="flex flex-wrap items-center gap-1 rounded-2xl p-1" role="group" aria-label={tl("Ambito")}>
              {([['slide', tl("Slide corrente")], ['deck', tl("Tutta la presentazione")]] as const).map(([key, label]) => (
                <Button key={key} type="button" tone="neutral" surface="ghost" density="compact" aria-pressed={scope === key}
                  className={scope === key ? 'ds-selected' : ''} onClick={() => setScope(key)}>{label}</Button>
              ))}
            </div>

            <fieldset>
              <legend className="mb-1 text-xs font-bold uppercase tracking-wide text-[var(--text-secondary)]">{tl("Sfondo")}</legend>
              <div className="flex flex-wrap items-center gap-2">
                {BACKGROUND_PRESETS.map(color => (
                  <button key={color} type="button" aria-label={color} aria-pressed={(style.background || '').toUpperCase() === color}
                    onClick={() => setStyle(prev => ({ ...prev, background: color }))}
                    className="flex h-8 w-8 items-center justify-center rounded-full shadow-[var(--ds-shadow-1)]" style={{ background: color }}>
                    {(style.background || '').toUpperCase() === color && <Check className="h-4 w-4" style={{ color: color === '#FFFFFF' || color === '#F8FAFC' || color === '#FBF7F0' || color === '#FEF9C3' || color === '#DBEAFE' ? '#111827' : '#FFFFFF' }} />}
                  </button>
                ))}
                <ColorPicker value={background} onChange={(color) => setStyle(prev => ({ ...prev, background: color }))} title={tl("Colore di sfondo")} />
              </div>
              <p className="mt-1 text-[11px] text-[var(--text-secondary)]">{tl("I testi che non si leggono sul nuovo sfondo vengono ricolorati in automatico.")}</p>
            </fieldset>

            {textFields('title', tl("Titoli"))}
            {textFields('body', tl("Testo"))}

            <fieldset>
              <legend className="mb-1 text-xs font-bold uppercase tracking-wide text-[var(--text-secondary)]">{tl("Colore di accento")}</legend>
              <div className="flex items-center gap-2">
                <ColorPicker value={style.accent || '#E85C8D'} onChange={(color) => setStyle(prev => ({ ...prev, accent: color }))} title={tl("Colore di accento")} />
                {style.accent && <button type="button" className="text-xs font-semibold text-[var(--text-secondary)]" onClick={() => setStyle(prev => { const { accent: _a, ...rest } = prev; return rest })}>{tl("Non cambiare")}</button>}
              </div>
            </fieldset>
          </div>

          <div className="space-y-4">
            <div className="overflow-hidden rounded-2xl shadow-[var(--ds-shadow-1)]" style={{ width: dims.width * previewScale, maxWidth: '100%', height: dims.height * previewScale }} aria-label={tl("Anteprima")}>
              <div className="theme-keep flex origin-top-left flex-col gap-3 px-10 pt-10" style={{ width: dims.width, height: dims.height, transform: `scale(${previewScale})`, background }}>
                <div style={{ fontFamily: titleFont, fontSize: shown('title').fontSize ?? 40, color: shown('title').color ?? '#1A1A2E', fontWeight: 700, lineHeight: 1.15 }}>{tl("Titolo della slide")}</div>
                {style.accent && <div className="h-1.5 w-20 rounded" style={{ background: style.accent }} />}
                <div style={{ fontFamily: bodyFont, fontSize: shown('body').fontSize ?? 24, color: shown('body').color ?? '#2D2D2D', lineHeight: 1.4 }}>
                  • {tl("Testo del paragrafo")}<br />• {tl("Un secondo punto dell’elenco")}
                </div>
              </div>
            </div>

            <div className="space-y-2">
              <div className="text-xs font-bold uppercase tracking-wide text-[var(--text-secondary)]">{tl("Stili salvati")}</div>
              {saved.length === 0 && <p className="text-xs text-[var(--text-secondary)]">{tl("Nessuno stile salvato: impostane uno e salvalo qui sotto.")}</p>}
              <ul className="flex max-h-32 flex-col gap-1 overflow-y-auto">
                {saved.map(item => (
                  <li key={item.id} className="flex items-center gap-1">
                    <Button type="button" tone="neutral" surface="ghost" density="compact" className={`flex-1 justify-start ${activeId === item.id ? 'ds-selected' : ''}`} onClick={() => loadSaved(item)}>
                      <span className="mr-2 h-4 w-4 shrink-0 rounded-full shadow-[var(--ds-shadow-1)]" style={{ background: item.style.background || '#FFFFFF' }} />
                      <span className="truncate">{item.name}</span>
                    </Button>
                    <button type="button" onClick={() => void remove(item)} className="rounded-lg p-1.5 text-[var(--text-secondary)]" aria-label={tl("Elimina stile «{0}»", item.name)}><Trash2 className="h-4 w-4" /></button>
                  </li>
                ))}
              </ul>
              <div className="flex items-center gap-2">
                <Input density="compact" value={name} onChange={(event) => setName(event.target.value)} placeholder={tl("Nome dello stile")} maxLength={120} aria-label={tl("Nome dello stile")} />
                <Button type="button" tone="neutral" surface="soft" density="compact" disabled={busy !== null || !hasChanges} onClick={() => void save(!activeId)}>
                  {busy === 'save' ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Save className="mr-1.5 h-4 w-4" />}{activeId ? tl("Aggiorna") : tl("Salva")}
                </Button>
              </div>
              {activeId && <button type="button" className="text-xs font-semibold text-[var(--text-secondary)]" onClick={() => void save(true)}>{tl("Salva come nuovo stile")}</button>}
            </div>
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 px-6 py-4">
          <Button type="button" tone="neutral" surface="ghost" onClick={onClose}>{tl("Annulla")}</Button>
          <Button type="button" tone="accent" surface="solid" disabled={busy !== null || !hasChanges} onClick={() => void apply()}>
            {busy === 'apply' ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Palette className="mr-1.5 h-4 w-4" />}
            {scope === 'slide' ? tl("Applica alla slide") : tl("Applica a tutta la presentazione")}
          </Button>
        </div>
      </div>
    </div>
  )
}
