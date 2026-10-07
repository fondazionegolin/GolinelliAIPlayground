import { useEffect, useRef, useState } from 'react'
import { Bold, Hash, ImagePlus, Italic, Trash2, Type } from '@/components/icons'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { BandView, type BandKind } from '@/components/documents/DocumentPageDecorations'
import {
  DEFAULT_TEXT_STYLE, MAX_BAND_ITEMS, bandMetrics, imageFileToLogoDataUrl, newItemId,
  type BandItem, type HeaderFooterBand, type HeaderFooterConfig,
} from '@/lib/documentHeaderFooter'
import { DOC_FONTS } from '@/lib/documentTextFormat'

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  value: HeaderFooterConfig
  onChange: (next: HeaderFooterConfig) => void
  initialTab?: BandKind
  /** Sheet geometry (CSS px), so the preview is the real band at real proportions. */
  pageWidth: number
  marginHorizontal: number
  marginVertical: number
  isEnglish?: boolean
}

const SIZES = [6, 7, 8, 9, 10, 11, 12, 14, 16, 18, 20, 24]

export function DocumentHeaderFooterDialog({ open, onOpenChange, value, onChange, initialTab = 'header', pageWidth, marginHorizontal, marginVertical, isEnglish }: Props) {
  const t = (it: string, en: string) => (isEnglish ? en : it)
  const [tab, setTab] = useState<BandKind>(initialTab)
  const [seenTab, setSeenTab] = useState(initialTab)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [scale, setScale] = useState(0.5)
  const previewRef = useRef<HTMLDivElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const replaceRef = useRef<HTMLInputElement>(null)
  if (open && seenTab !== initialTab) { setSeenTab(initialTab); setTab(initialTab); setSelectedId(null) }

  useEffect(() => {
    if (!open) return
    const element = previewRef.current
    if (!element) return
    const measure = () => setScale(Math.min(1, element.clientWidth / pageWidth))
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [open, pageWidth, tab])

  const band = value[tab]
  const selected = band.items.find((item) => item.id === selectedId) ?? null
  const setBand = (next: HeaderFooterBand) => onChange({ ...value, [tab]: next })
  const patchItem = (id: string, changes: Partial<BandItem>) => setBand({ ...band, items: band.items.map((item) => (item.id === id ? { ...item, ...changes } : item)) })
  const addItem = (item: BandItem) => {
    if (band.items.length >= MAX_BAND_ITEMS) return
    setBand({ ...band, enabled: true, items: [...band.items, item] })
    setSelectedId(item.id)
  }
  const removeItem = (id: string) => { setBand({ ...band, items: band.items.filter((item) => item.id !== id) }); setSelectedId(null) }

  const loadLogo = async (file: File | undefined, replaceId?: string) => {
    if (!file) return
    setError('')
    try {
      const url = await imageFileToLogoDataUrl(file)
      if (replaceId) patchItem(replaceId, { url })
      else addItem({ id: newItemId(), type: 'logo', url, height: 36, x: band.items.some((item) => item.type === 'logo') ? 100 : 0 })
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t('Immagine non valida', 'Invalid image'))
    }
  }

  const itemLabel = (item: BandItem) => item.type === 'logo' ? t('Logo', 'Logo') : item.type === 'page' ? t('N. pagina', 'Page no.') : (item.text?.trim().slice(0, 14) || t('Testo', 'Text'))
  const slider = 'flex-1 accent-violet-600'
  const sectionLabel = 'w-24 shrink-0 text-xs font-semibold text-slate-600'
  const iconToggle = (active: boolean) => `flex h-8 w-8 items-center justify-center rounded-lg border text-slate-700 transition ${active ? 'border-violet-400 bg-violet-50 text-violet-700' : 'border-slate-200 hover:bg-slate-50'}`

  const metrics = bandMetrics(band, marginVertical)
  const previewHeight = metrics.outerHeight
  const textWidth = pageWidth - marginHorizontal * 2

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] max-w-xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t('Intestazione e piè di pagina', 'Header and footer')}</DialogTitle>
          <DialogDescription>{t('Aggiungi loghi e testi, trascinali nell’anteprima o nella pagina. Compaiono su ogni pagina, anche in Word e PDF.', 'Add logos and text, drag them in the preview or on the page. Shown on every page, also in Word and PDF.')}</DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-2 rounded-xl bg-slate-100 p-1 text-sm font-bold">
          {(['header', 'footer'] as const).map((key) => (
            <button key={key} type="button" onClick={() => { setTab(key); setSelectedId(null) }} className={`rounded-lg py-1.5 transition ${tab === key ? 'bg-white text-violet-700 shadow-sm' : 'text-slate-500'}`}>
              {key === 'header' ? t('Intestazione', 'Header') : t('Piè di pagina', 'Footer')}
            </button>
          ))}
        </div>

        <label className="flex items-center justify-between rounded-xl border border-slate-200 px-3 py-2.5">
          <span className="text-sm font-semibold text-slate-800">{t('Mostra su ogni pagina', 'Show on every page')}</span>
          <Switch checked={band.enabled} onCheckedChange={(enabled) => setBand({ ...band, enabled })} />
        </label>

        {/* WYSIWYG preview: the real band at the real page proportions, items are draggable */}
        <div ref={previewRef} className="w-full" onClick={() => setSelectedId(null)}>
          <div className="relative overflow-hidden rounded-md border border-slate-300 bg-white shadow-inner" style={{ height: (previewHeight + 12) * scale + 8 }}>
            <div className="absolute inset-y-0 left-0 bg-slate-100/70" style={{ width: marginHorizontal * scale }} />
            <div className="absolute inset-y-0 right-0 bg-slate-100/70" style={{ width: marginHorizontal * scale }} />
            <div className="absolute origin-top-left" style={{ left: marginHorizontal * scale, top: 4, width: textWidth, transform: `scale(${scale})` }} onClick={(event) => event.stopPropagation()}>
              <BandView
                band={{ ...band, enabled: true }}
                kind={tab}
                page={1}
                pageCount={3}
                marginVertical={marginVertical}
                isEnglish={isEnglish}
                style={{ width: textWidth }}
                selectedId={selectedId}
                onItemSelect={setSelectedId}
                onItemMove={(id, x) => patchItem(id, { x })}
              />
            </div>
            {band.items.length === 0 && <p className="absolute inset-0 flex items-center justify-center text-xs text-slate-400">{t('Aggiungi un logo, un testo o il numero di pagina', 'Add a logo, text or page number')}</p>}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <input ref={fileRef} type="file" accept="image/*" hidden onChange={(event) => { void loadLogo(event.target.files?.[0]); event.target.value = '' }} />
          <Button type="button" size="sm" variant="outline" disabled={band.items.length >= MAX_BAND_ITEMS} onClick={() => fileRef.current?.click()}><ImagePlus className="mr-1.5 h-4 w-4" />{t('Logo', 'Logo')}</Button>
          <Button type="button" size="sm" variant="outline" disabled={band.items.length >= MAX_BAND_ITEMS} onClick={() => addItem({ id: newItemId(), type: 'text', text: t('Testo', 'Text'), x: 100, ...DEFAULT_TEXT_STYLE })}><Type className="mr-1.5 h-4 w-4" />{t('Testo', 'Text')}</Button>
          <Button type="button" size="sm" variant="outline" disabled={band.items.length >= MAX_BAND_ITEMS || band.items.some((item) => item.type === 'page')} onClick={() => addItem({ id: newItemId(), type: 'page', x: 100, ...DEFAULT_TEXT_STYLE })}><Hash className="mr-1.5 h-4 w-4" />{t('N. pagina', 'Page no.')}</Button>
          <span className="mx-1 h-5 w-px bg-slate-200" />
          {band.items.map((item) => (
            <button key={item.id} type="button" onClick={() => setSelectedId(item.id)} className={`rounded-full border px-2.5 py-1 text-xs font-semibold transition ${selectedId === item.id ? 'border-violet-400 bg-violet-50 text-violet-700' : 'border-slate-200 text-slate-600 hover:bg-slate-50'}`}>{itemLabel(item)}</button>
          ))}
        </div>
        {error && <p className="text-xs font-medium text-red-600">{error}</p>}

        {selected ? (
          <div className="space-y-3 rounded-xl border border-slate-200 p-3">
            <div className="flex items-center justify-between">
              <p className="text-xs font-black uppercase tracking-wide text-slate-500">{itemLabel(selected)}</p>
              <Button type="button" variant="ghost" size="icon" onClick={() => removeItem(selected.id)} title={t('Rimuovi', 'Remove')}><Trash2 className="h-4 w-4" /></Button>
            </div>

            {selected.type === 'logo' && (
              <>
                <div className="flex items-center gap-3">
                  <img src={selected.url} alt="" className="h-10 max-w-[120px] rounded-lg border border-slate-200 bg-white object-contain p-1" />
                  <input ref={replaceRef} type="file" accept="image/*" hidden onChange={(event) => { void loadLogo(event.target.files?.[0], selected.id); event.target.value = '' }} />
                  <Button type="button" size="sm" variant="outline" onClick={() => replaceRef.current?.click()}>{t('Sostituisci', 'Replace')}</Button>
                </div>
                <div className="flex items-center gap-2">
                  <span className={sectionLabel}>{t('Altezza', 'Height')}</span>
                  <input type="range" min={16} max={Math.max(17, metrics.logoMax)} value={Math.min(selected.height ?? 36, metrics.logoMax)} onChange={(event) => patchItem(selected.id, { height: Number(event.target.value) })} className={slider} />
                  <span className="w-10 text-right text-xs tabular-nums text-slate-500">{Math.min(selected.height ?? 36, metrics.logoMax)}px</span>
                </div>
                <p className="text-[11px] text-slate-500">{t(`Altezza massima ${metrics.logoMax}px con i margini attuali: aumenta il margine superiore/inferiore dal righello per un logo più grande.`, `Max height ${metrics.logoMax}px with the current margins: increase the top/bottom margin on the ruler for a bigger logo.`)}</p>
              </>
            )}

            {selected.type === 'text' && (
              <input value={selected.text ?? ''} maxLength={200} onChange={(event) => patchItem(selected.id, { text: event.target.value })}
                placeholder={t('Es. Istituto Rossi · Classe 3B', 'E.g. School name · Class 3B')}
                className="h-9 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-800 outline-none focus:border-violet-300" />
            )}

            {selected.type !== 'logo' && (
              <div className="flex flex-wrap items-center gap-1.5">
                <select className="h-8 w-32 rounded-lg border border-slate-200 bg-white px-1.5 text-xs" value={selected.fontFamily ?? 'Arial'} onChange={(event) => patchItem(selected.id, { fontFamily: event.target.value })} aria-label={t('Carattere', 'Font')}>
                  {(DOC_FONTS.includes(selected.fontFamily ?? 'Arial') ? DOC_FONTS : [selected.fontFamily ?? 'Arial', ...DOC_FONTS]).map((font) => <option key={font} value={font}>{font}</option>)}
                </select>
                <select className="h-8 w-16 rounded-lg border border-slate-200 bg-white px-1.5 text-xs" value={selected.sizePt ?? 9} onChange={(event) => patchItem(selected.id, { sizePt: Number(event.target.value) })} aria-label={t('Dimensione', 'Size')}>
                  {(SIZES.includes(selected.sizePt ?? 9) ? SIZES : [...SIZES, selected.sizePt ?? 9].sort((a, b) => a - b)).map((size) => <option key={size} value={size}>{size} pt</option>)}
                </select>
                <input type="color" className="h-8 w-8 cursor-pointer rounded border border-slate-200 bg-white p-0.5" value={selected.color ?? '#64748b'} onChange={(event) => patchItem(selected.id, { color: event.target.value })} title={t('Colore', 'Colour')} />
                <button type="button" className={iconToggle(selected.bold === true)} aria-pressed={selected.bold === true} onClick={() => patchItem(selected.id, { bold: !selected.bold })} title={t('Grassetto', 'Bold')}><Bold className="h-4 w-4" /></button>
                <button type="button" className={iconToggle(selected.italic === true)} aria-pressed={selected.italic === true} onClick={() => patchItem(selected.id, { italic: !selected.italic })} title={t('Corsivo', 'Italic')}><Italic className="h-4 w-4" /></button>
              </div>
            )}

            <div className="flex items-center gap-2">
              <span className={sectionLabel}>{t('Posizione', 'Position')}</span>
              <input type="range" min={0} max={100} step={0.5} value={selected.x} onChange={(event) => patchItem(selected.id, { x: Number(event.target.value) })} className={slider} aria-label={t('Posizione orizzontale', 'Horizontal position')} />
              {([['◧', 0], ['▣', 50], ['◨', 100]] as const).map(([label, x]) => (
                <button key={x} type="button" className="rounded-lg px-2 py-1 text-xs font-bold text-slate-500 hover:bg-slate-100" onClick={() => patchItem(selected.id, { x })}>{label}</button>
              ))}
            </div>
          </div>
        ) : (
          band.items.length > 0 && <p className="text-xs text-slate-500">{t('Seleziona un elemento (chip o anteprima) per modificarlo.', 'Select an element (chip or preview) to edit it.')}</p>
        )}

        <div className="flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-2.5">
          <span className="w-40 shrink-0 text-sm font-semibold text-slate-800">{t('Distanza dal bordo pagina', 'Distance from page edge')}</span>
          <input type="range" min={0} max={60} value={band.edgeOffset} onChange={(event) => setBand({ ...band, edgeOffset: Number(event.target.value) })} className={slider} />
          <span className="w-10 text-right text-xs tabular-nums text-slate-500">{band.edgeOffset}px</span>
        </div>
        <label className="flex items-center justify-between rounded-xl border border-slate-200 px-3 py-2.5">
          <span className="text-sm font-semibold text-slate-800">{t('Linea di separazione', 'Separator line')}</span>
          <Switch checked={band.showRule} onCheckedChange={(showRule) => setBand({ ...band, showRule })} />
        </label>

        <div className="flex justify-end">
          <Button type="button" onClick={() => onOpenChange(false)}>{t('Fatto', 'Done')}</Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
