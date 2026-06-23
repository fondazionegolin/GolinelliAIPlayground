import { useEffect, useMemo, useState } from 'react'
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Loader2,
  Palette,
  Pencil,
  Plus,
  Sparkles,
  Trash2,
  Type,
  Wand2,
  X,
} from 'lucide-react'
import { designSystemApi } from '@/lib/api'
import type { DesignSystem, DesignTokens } from '@/lib/api'

// System-safe font stacks (the preview sandbox has no network → no web fonts). Keys match the
// backend DS_FONT_STACKS so a chosen key renders identically here and in the generated app.
const FONT_STACKS: Record<string, { label: string; stack: string }> = {
  sans: { label: 'Sans (sistema)', stack: "system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif" },
  humanist: { label: 'Umanista', stack: "'Segoe UI', 'Helvetica Neue', Optima, 'Gill Sans', 'Trebuchet MS', system-ui, sans-serif" },
  geometric: { label: 'Geometrico', stack: "Futura, 'Century Gothic', 'Avenir Next', Avenir, 'Segoe UI', system-ui, sans-serif" },
  rounded: { label: 'Arrotondato', stack: "ui-rounded, 'SF Pro Rounded', 'Segoe UI', system-ui, sans-serif" },
  condensed: { label: 'Stretto', stack: "'Arial Narrow', 'Roboto Condensed', 'Helvetica Neue', 'Segoe UI', sans-serif" },
  serif: { label: 'Serif elegante', stack: "Georgia, 'Times New Roman', 'Iowan Old Style', serif" },
  slab: { label: 'Slab', stack: "Rockwell, 'Roboto Slab', 'Courier New', Georgia, serif" },
  didone: { label: 'Didone', stack: "Didot, 'Bodoni MT', 'Playfair Display', 'Hoefler Text', Georgia, serif" },
  mono: { label: 'Monospazio', stack: "ui-monospace, 'SF Mono', 'Cascadia Code', Menlo, Consolas, monospace" },
}

const MOODS = [
  { key: 'giocoso', label: 'Giocoso', hint: 'colori vivaci, forme morbide' },
  { key: 'elegante', label: 'Elegante', hint: 'sobrio, contrasti netti, serif' },
  { key: 'tech', label: 'Tech', hint: 'scuro, accenti brillanti, mono' },
  { key: 'editoriale', label: 'Editoriale', hint: 'tipografia forte, molto whitespace' },
  { key: 'naturale', label: 'Naturale', hint: 'toni caldi/terra, calmo' },
  { key: 'minimal', label: 'Minimal', hint: 'piatto, pochi colori, essenziale' },
]

const PRIORITY_OPTIONS = ['leggibilità', 'gerarchia', 'whitespace', 'densità informativa', 'vivacità', 'coerenza', 'accessibilità']

const DEFAULT_TOKENS: DesignTokens = {
  mood: '',
  palette: {
    primary: '#2563eb', primaryText: '#ffffff',
    accent: '#f59e0b', accentText: '#1f2937',
    background: '#f8fafc', surface: '#ffffff',
    text: '#0f172a', textMuted: '#64748b', border: '#e2e8f0',
    success: '#16a34a', danger: '#dc2626',
  },
  typography: { fontHeading: 'sans', fontBody: 'sans', baseSize: 16, scaleRatio: 1.25, headingWeight: 700, bodyWeight: 400 },
  shape: { radius: 12, buttonShape: 'soft', buttonStyle: 'solid', surfaceStyle: 'flat', shadowLevel: 'soft', borderWidth: 1 },
  spacing: { base: 8, density: 'comfortable' },
  priorities: ['leggibilità', 'gerarchia', 'coerenza'],
}

// --- contrast helpers (client mirror of the backend so feedback is instant) ---
function expandHex(hex: string): string {
  const h = (hex || '').trim()
  if (/^#[0-9a-fA-F]{3}$/.test(h)) return '#' + h.slice(1).split('').map((c) => c + c).join('')
  return /^#[0-9a-fA-F]{6}$/.test(h) ? h : '#000000'
}
function luminance(hex: string): number {
  const h = expandHex(hex).slice(1)
  const ch = [0, 2, 4].map((i) => {
    const c = parseInt(h.slice(i, i + 2), 16) / 255
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
  })
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2]
}
function contrast(fg: string, bg: string): number {
  const l1 = luminance(fg), l2 = luminance(bg)
  const hi = Math.max(l1, l2), lo = Math.min(l1, l2)
  return Math.round(((hi + 0.05) / (lo + 0.05)) * 100) / 100
}
function resolveStack(value: string): string {
  return FONT_STACKS[value]?.stack || value || FONT_STACKS.sans.stack
}
function btnRadius(t: DesignTokens): number {
  return t.shape.buttonShape === 'squared' ? 4 : t.shape.buttonShape === 'pill' ? 999 : t.shape.radius
}
function shadowValue(level: string): string {
  if (level === 'none') return 'none'
  if (level === 'strong') return '0 4px 6px rgba(15,23,42,.10), 0 12px 28px rgba(15,23,42,.16)'
  return '0 1px 2px rgba(15,23,42,.06), 0 6px 16px rgba(15,23,42,.08)'
}
function rgba(hex: string, alpha: number): string {
  const h = expandHex(hex).slice(1)
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16))
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}
function buttonCss(t: DesignTokens): { bg: string; color: string; border: string; backdrop: string; gradient: string } {
  const p = t.palette
  const bw = Math.max(1, (t.shape.borderWidth || 1) + 1)
  const gradient = `linear-gradient(135deg, ${p.primary}, ${p.accent})`
  const base = { bg: p.primary, color: p.primaryText, border: 'none', backdrop: 'none', gradient }
  switch (t.shape.buttonStyle) {
    case 'outline': return { ...base, bg: 'transparent', color: p.primary, border: `${bw}px solid ${p.primary}` }
    case 'soft': return { ...base, bg: rgba(p.primary, 0.14), color: p.primary }
    case 'gradient': return { ...base, bg: gradient }
    case 'glass': return { ...base, bg: rgba(p.primary, 0.18), color: p.primary, border: `1px solid ${rgba(p.primary, 0.4)}`, backdrop: 'blur(8px) saturate(140%)' }
    case 'glossy': return { ...base, bg: `linear-gradient(180deg, rgba(255,255,255,0.28), rgba(255,255,255,0) 55%), ${p.primary}` }
    default: return base
  }
}
function surfaceCss(t: DesignTokens): { bg: string; backdrop: string; border: string } {
  const p = t.palette
  const dark = luminance(p.surface) < 0.5
  const glassBorder = dark ? 'rgba(255,255,255,0.30)' : rgba(p.text, 0.10)
  switch (t.shape.surfaceStyle) {
    case 'transparent': return { bg: rgba(p.surface, 0.72), backdrop: 'none', border: glassBorder }
    case 'frosted': return { bg: rgba(p.surface, 0.55), backdrop: 'blur(14px) saturate(160%)', border: glassBorder }
    case 'glossy': return { bg: `linear-gradient(160deg, rgba(255,255,255,0.22), rgba(255,255,255,0) 55%), ${p.surface}`, backdrop: 'none', border: p.border }
    default: return { bg: p.surface, backdrop: 'none', border: p.border }
  }
}

function previewVars(t: DesignTokens): Record<string, string> {
  const btn = buttonCss(t)
  const surf = surfaceCss(t)
  return {
    ['--ds-gradient' as string]: btn.gradient,
    ['--ds-btn-bg' as string]: btn.bg,
    ['--ds-btn-color' as string]: btn.color,
    ['--ds-btn-border' as string]: btn.border,
    ['--ds-btn-backdrop' as string]: btn.backdrop,
    ['--ds-card-bg' as string]: surf.bg,
    ['--ds-card-border' as string]: surf.border,
    ['--ds-card-backdrop' as string]: surf.backdrop,
    ['--ds-color-primary' as string]: t.palette.primary,
    ['--ds-color-primary-text' as string]: t.palette.primaryText,
    ['--ds-color-accent' as string]: t.palette.accent,
    ['--ds-color-accent-text' as string]: t.palette.accentText,
    ['--ds-bg' as string]: t.palette.background,
    ['--ds-surface' as string]: t.palette.surface,
    ['--ds-text' as string]: t.palette.text,
    ['--ds-text-muted' as string]: t.palette.textMuted,
    ['--ds-border' as string]: t.palette.border,
    ['--ds-font-heading' as string]: resolveStack(t.typography.fontHeading),
    ['--ds-font-body' as string]: resolveStack(t.typography.fontBody),
    ['--ds-text-base' as string]: `${t.typography.baseSize}px`,
    ['--ds-btn-radius' as string]: `${btnRadius(t)}px`,
    ['--ds-radius' as string]: `${t.shape.radius}px`,
    ['--ds-shadow' as string]: shadowValue(t.shape.shadowLevel),
    ['--ds-space' as string]: `${t.spacing.base}px`,
  }
}

const CONTRAST_PAIRS: { label: string; fg: (p: DesignTokens['palette']) => string; bg: (p: DesignTokens['palette']) => string }[] = [
  { label: 'Testo su sfondo', fg: (p) => p.text, bg: (p) => p.background },
  { label: 'Testo su superficie', fg: (p) => p.text, bg: (p) => p.surface },
  { label: 'Testo attenuato', fg: (p) => p.textMuted, bg: (p) => p.background },
  { label: 'Bottone primario', fg: (p) => p.primaryText, bg: (p) => p.primary },
  { label: 'Bottone accento', fg: (p) => p.accentText, bg: (p) => p.accent },
]

type StudioProps = {
  /** When provided, an "Applica al progetto" action writes design-system.md into the open project. */
  onApply?: (file: { path: string; content: string; language: string }, name: string) => void
  onClose: () => void
}

type Mode = { kind: 'list' } | { kind: 'edit'; id: string | null }

const STEPS = ['Identità', 'Palette', 'Tipografia', 'Forma', 'Priorità', 'Riepilogo'] as const

export default function DesignSystemStudio({ onApply, onClose }: StudioProps) {
  const [systems, setSystems] = useState<DesignSystem[]>([])
  const [loading, setLoading] = useState(true)
  const [mode, setMode] = useState<Mode>({ kind: 'list' })

  // editing state
  const [step, setStep] = useState(0)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [tokens, setTokens] = useState<DesignTokens>(DEFAULT_TOKENS)
  const [rationale, setRationale] = useState<Record<string, string>>({})
  const [suggesting, setSuggesting] = useState(false)
  const [saving, setSaving] = useState(false)
  const [score, setScore] = useState<number | null>(null)
  const [warnings, setWarnings] = useState<string[]>([])
  const [compiledMd, setCompiledMd] = useState<string>('')
  const [compiling, setCompiling] = useState(false)

  useEffect(() => { void refresh() }, [])
  const refresh = async () => {
    setLoading(true)
    try {
      const res = await designSystemApi.list()
      setSystems(res.data || [])
    } finally {
      setLoading(false)
    }
  }

  const startNew = () => {
    setStep(0); setName(''); setDescription(''); setTokens(DEFAULT_TOKENS)
    setRationale({}); setScore(null); setWarnings([]); setCompiledMd('')
    setMode({ kind: 'edit', id: null })
  }
  const startEdit = (ds: DesignSystem) => {
    setStep(0); setName(ds.name); setDescription(ds.description || '')
    setTokens({
      ...DEFAULT_TOKENS,
      ...ds.tokens_json,
      palette: { ...DEFAULT_TOKENS.palette, ...ds.tokens_json?.palette },
      typography: { ...DEFAULT_TOKENS.typography, ...ds.tokens_json?.typography },
      shape: { ...DEFAULT_TOKENS.shape, ...ds.tokens_json?.shape },
      spacing: { ...DEFAULT_TOKENS.spacing, ...ds.tokens_json?.spacing },
    })
    setRationale({}); setScore(null); setWarnings([]); setCompiledMd('')
    setMode({ kind: 'edit', id: ds.id })
  }

  const patch = (fn: (t: DesignTokens) => DesignTokens) => setTokens((prev) => fn(structuredClone(prev)))

  const runSuggest = async (mood: string) => {
    setSuggesting(true)
    patch((t) => ({ ...t, mood }))
    try {
      const res = await designSystemApi.suggest({ mood, idea: description, title: name })
      const next = res.data?.tokens
      if (next) {
        setTokens({ ...DEFAULT_TOKENS, ...next, mood, palette: { ...DEFAULT_TOKENS.palette, ...next.palette } })
        setRationale(res.data.rationale || {})
      }
    } finally {
      setSuggesting(false)
    }
  }

  const compile = async () => {
    setCompiling(true)
    try {
      const res = await designSystemApi.compile({ ...tokens, name, description })
      setScore(res.data.coherence_score)
      setWarnings(res.data.warnings || [])
      setCompiledMd(res.data.markdown)
      return res.data
    } finally {
      setCompiling(false)
    }
  }

  useEffect(() => {
    if (mode.kind === 'edit' && step === STEPS.length - 1) void compile()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step])

  const persist = async (): Promise<DesignSystem | null> => {
    if (!name.trim()) return null
    setSaving(true)
    try {
      if (mode.kind === 'edit' && mode.id) {
        const res = await designSystemApi.update(mode.id, { name: name.trim(), description, tokens })
        return res.data
      }
      const res = await designSystemApi.create({ name: name.trim(), description, tokens })
      return res.data
    } finally {
      setSaving(false)
    }
  }

  const handleSave = async () => {
    const saved = await persist()
    if (saved) { await refresh(); setMode({ kind: 'list' }) }
  }

  const handleApply = async (ds?: DesignSystem) => {
    let md = compiledMd
    const useTokens = ds ? ds.tokens_json : tokens
    const useName = ds ? ds.name : name
    const useDesc = ds ? ds.description || '' : description
    if (!ds || !md) {
      const res = await designSystemApi.compile({ ...useTokens, name: useName, description: useDesc })
      md = res.data.markdown
    }
    if (!ds) await persist().then(() => refresh())
    onApply?.({ path: 'design-system.md', content: md, language: 'markdown' }, useName || 'Design system')
    onClose()
  }

  const liveChecks = useMemo(
    () => CONTRAST_PAIRS.map((p) => {
      const fg = p.fg(tokens.palette), bg = p.bg(tokens.palette)
      const ratio = contrast(fg, bg)
      return { label: p.label, fg, bg, ratio, ok: ratio >= 4.5 }
    }),
    [tokens.palette],
  )

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-sm">
      <div className="flex h-[88vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
        <header className="flex items-center justify-between border-b border-slate-200 px-5 py-3">
          <div className="flex items-center gap-2">
            <Palette className="h-5 w-5 text-indigo-600" />
            <h2 className="text-base font-bold text-slate-800">Design System</h2>
            <span className="hidden text-xs text-slate-400 sm:inline">— coerenza visiva riutilizzabile</span>
          </div>
          <button onClick={onClose} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700">
            <X className="h-5 w-5" />
          </button>
        </header>

        {mode.kind === 'list' ? (
          <LibraryView
            systems={systems}
            loading={loading}
            onNew={startNew}
            onEdit={startEdit}
            onApply={onApply ? (ds) => handleApply(ds) : undefined}
            onDelete={async (id) => { await designSystemApi.remove(id); await refresh() }}
          />
        ) : (
          <div className="flex min-h-0 flex-1">
            {/* left: steps */}
            <div className="flex min-h-0 w-1/2 flex-col border-r border-slate-200">
              <Stepper step={step} />
              <div className="min-h-0 flex-1 overflow-y-auto p-5">
                {step === 0 && (
                  <StepIdentity
                    name={name} setName={setName} description={description} setDescription={setDescription}
                    mood={tokens.mood || ''} suggesting={suggesting} onSuggest={runSuggest}
                  />
                )}
                {step === 1 && <StepPalette tokens={tokens} patch={patch} checks={liveChecks} rationale={rationale.palette} />}
                {step === 2 && <StepTypography tokens={tokens} patch={patch} rationale={rationale.typography} />}
                {step === 3 && <StepShape tokens={tokens} patch={patch} rationale={rationale.shape} />}
                {step === 4 && <StepPriorities tokens={tokens} patch={patch} />}
                {step === 5 && (
                  <StepSummary
                    name={name} score={score} warnings={warnings} compiling={compiling} markdown={compiledMd}
                  />
                )}
              </div>
              <div className="flex items-center justify-between border-t border-slate-200 px-5 py-3">
                <button
                  onClick={() => (step === 0 ? setMode({ kind: 'list' }) : setStep((s) => s - 1))}
                  className="inline-flex items-center gap-1 rounded-lg px-3 py-1.5 text-sm font-semibold text-slate-600 hover:bg-slate-100"
                >
                  <ChevronLeft className="h-4 w-4" /> {step === 0 ? 'Libreria' : 'Indietro'}
                </button>
                {step < STEPS.length - 1 ? (
                  <button
                    onClick={() => setStep((s) => s + 1)}
                    disabled={step === 0 && !name.trim()}
                    className="inline-flex items-center gap-1 rounded-lg bg-indigo-600 px-4 py-1.5 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
                  >
                    Avanti <ChevronRight className="h-4 w-4" />
                  </button>
                ) : (
                  <div className="flex items-center gap-2">
                    <button
                      onClick={handleSave}
                      disabled={saving || !name.trim()}
                      className="inline-flex items-center gap-1 rounded-lg border border-indigo-200 bg-white px-3 py-1.5 text-sm font-semibold text-indigo-700 hover:bg-indigo-50 disabled:opacity-50"
                    >
                      {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Salva in libreria
                    </button>
                    {onApply && (
                      <button
                        onClick={() => handleApply()}
                        disabled={saving || !name.trim()}
                        className="inline-flex items-center gap-1 rounded-lg bg-indigo-600 px-4 py-1.5 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
                      >
                        <Wand2 className="h-4 w-4" /> Salva e applica
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>
            {/* right: live preview */}
            <div className="min-h-0 w-1/2 overflow-y-auto bg-slate-100 p-5">
              <p className="mb-3 text-xs font-bold uppercase tracking-wide text-slate-400">Anteprima coerenza</p>
              <LivePreview tokens={tokens} />
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function Stepper({ step }: { step: number }) {
  return (
    <div className="flex items-center gap-1 overflow-x-auto border-b border-slate-200 px-5 py-2.5">
      {STEPS.map((label, i) => (
        <div key={label} className="flex items-center gap-1">
          <span
            className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold ${
              i === step ? 'bg-indigo-600 text-white' : i < step ? 'bg-indigo-100 text-indigo-700' : 'bg-slate-200 text-slate-500'
            }`}
          >
            {i < step ? <Check className="h-3.5 w-3.5" /> : i + 1}
          </span>
          <span className={`whitespace-nowrap text-xs font-semibold ${i === step ? 'text-slate-800' : 'text-slate-400'}`}>{label}</span>
          {i < STEPS.length - 1 && <ChevronRight className="h-3.5 w-3.5 text-slate-300" />}
        </div>
      ))}
    </div>
  )
}

function LibraryView({ systems, loading, onNew, onEdit, onApply, onDelete }: {
  systems: DesignSystem[]; loading: boolean
  onNew: () => void; onEdit: (ds: DesignSystem) => void
  onApply?: (ds: DesignSystem) => void; onDelete: (id: string) => void
}) {
  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-5">
      <div className="mb-4 flex items-center justify-between">
        <p className="text-sm text-slate-500">I tuoi design system riutilizzabili. Creane uno e applicalo a qualsiasi progetto.</p>
        <button onClick={onNew} className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3.5 py-2 text-sm font-semibold text-white hover:bg-indigo-700">
          <Plus className="h-4 w-4" /> Nuovo
        </button>
      </div>
      {loading ? (
        <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-slate-400" /></div>
      ) : systems.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 px-6 py-12 text-center">
          <Sparkles className="mx-auto mb-2 h-8 w-8 text-indigo-300" />
          <p className="font-semibold text-slate-700">Ancora nessun design system</p>
          <p className="mt-1 text-sm text-slate-500">Costruiscine uno guidato: palette, tipografia, forma e priorità visive.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {systems.map((ds) => (
            <div key={ds.id} className="group rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="mb-3 flex items-start justify-between gap-2">
                <div>
                  <p className="font-bold text-slate-800">{ds.name}</p>
                  {ds.tokens_json?.mood && <p className="text-xs text-slate-400">{ds.tokens_json.mood}</p>}
                </div>
                <div className="flex gap-1 opacity-0 transition group-hover:opacity-100">
                  <button onClick={() => onEdit(ds)} title="Modifica" className="rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"><Pencil className="h-4 w-4" /></button>
                  <button onClick={() => onDelete(ds.id)} title="Elimina" className="rounded-md p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600"><Trash2 className="h-4 w-4" /></button>
                </div>
              </div>
              <div className="mb-3 flex gap-1.5">
                {[ds.tokens_json?.palette?.primary, ds.tokens_json?.palette?.accent, ds.tokens_json?.palette?.surface, ds.tokens_json?.palette?.text].filter(Boolean).map((c, i) => (
                  <span key={i} className="h-7 flex-1 rounded-md border border-slate-200" style={{ background: c as string }} />
                ))}
              </div>
              {onApply && (
                <button onClick={() => onApply(ds)} className="w-full rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-1.5 text-sm font-semibold text-indigo-700 hover:bg-indigo-100">
                  Applica al progetto
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="mb-4">
      <label className="mb-1 block text-sm font-semibold text-slate-700">{label}</label>
      {hint && <p className="mb-1.5 text-xs text-slate-400">{hint}</p>}
      {children}
    </div>
  )
}

function RationaleNote({ text }: { text?: string }) {
  if (!text) return null
  return (
    <div className="mb-4 flex gap-2 rounded-lg border border-indigo-100 bg-indigo-50 px-3 py-2 text-xs text-indigo-800">
      <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0" /> <span>{text}</span>
    </div>
  )
}

function StepIdentity({ name, setName, description, setDescription, mood, suggesting, onSuggest }: {
  name: string; setName: (v: string) => void; description: string; setDescription: (v: string) => void
  mood: string; suggesting: boolean; onSuggest: (mood: string) => void
}) {
  return (
    <div>
      <Field label="Nome del design system" hint="Es. “Brand scuola”, “Estate vivace”">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Dai un nome riconoscibile"
          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none" />
      </Field>
      <Field label="A cosa serve / che mood?" hint="Una riga: aiuta l’AI a proporre una base coerente">
        <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2}
          placeholder="Es. sito per una festa di scuola, allegro e colorato"
          className="w-full resize-none rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none" />
      </Field>
      <Field label="Parti da un’identità" hint="Scegli un mood: l’AI propone palette, font e forme coerenti (poi personalizzi tutto)">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {MOODS.map((m) => (
            <button key={m.key} onClick={() => onSuggest(m.key)} disabled={suggesting}
              className={`rounded-lg border p-2.5 text-left text-xs transition disabled:opacity-50 ${mood === m.key ? 'border-indigo-400 bg-indigo-50' : 'border-slate-200 hover:border-indigo-300'}`}>
              <span className="block font-bold text-slate-700">{m.label}</span>
              <span className="block text-slate-400">{m.hint}</span>
            </button>
          ))}
        </div>
        {suggesting && <p className="mt-2 inline-flex items-center gap-1.5 text-xs text-indigo-600"><Loader2 className="h-3.5 w-3.5 animate-spin" /> L’AI sta proponendo una base coerente…</p>}
      </Field>
    </div>
  )
}

function ColorInput({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex items-center gap-2">
      <input type="color" value={expandHex(value)} onChange={(e) => onChange(e.target.value)}
        className="h-9 w-9 cursor-pointer rounded border border-slate-300 bg-white p-0.5" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-xs font-semibold text-slate-600">{label}</p>
        <input value={value} onChange={(e) => onChange(e.target.value)}
          className="w-full rounded border border-slate-200 px-1.5 py-0.5 font-mono text-xs text-slate-500 focus:border-indigo-400 focus:outline-none" />
      </div>
    </div>
  )
}

function StepPalette({ tokens, patch, checks, rationale }: {
  tokens: DesignTokens; patch: (fn: (t: DesignTokens) => DesignTokens) => void
  checks: { label: string; ratio: number; ok: boolean }[]; rationale?: string
}) {
  const set = (key: keyof DesignTokens['palette']) => (v: string) => patch((t) => { t.palette[key] = v; return t })
  const pairs: [keyof DesignTokens['palette'], string][] = [
    ['primary', 'Primario'], ['primaryText', 'Testo su primario'],
    ['accent', 'Accento'], ['accentText', 'Testo su accento'],
    ['background', 'Sfondo'], ['surface', 'Superficie/Card'],
    ['text', 'Testo'], ['textMuted', 'Testo attenuato'],
    ['border', 'Bordi'], ['success', 'Successo'], ['danger', 'Errore'],
  ]
  return (
    <div>
      <RationaleNote text={rationale} />
      <div className="grid grid-cols-2 gap-3">
        {pairs.map(([k, label]) => <ColorInput key={k} label={label} value={tokens.palette[k]} onChange={set(k)} />)}
      </div>
      <div className="mt-4 rounded-lg border border-slate-200 bg-white p-3">
        <p className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-400">Controllo contrasto (AA ≥ 4.5)</p>
        <div className="space-y-1">
          {checks.map((c) => (
            <div key={c.label} className="flex items-center justify-between text-xs">
              <span className="text-slate-600">{c.label}</span>
              <span className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 font-semibold ${c.ok ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>
                {c.ok ? <Check className="h-3 w-3" /> : <X className="h-3 w-3" />} {c.ratio.toFixed(1)}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

function StepTypography({ tokens, patch, rationale }: { tokens: DesignTokens; patch: (fn: (t: DesignTokens) => DesignTokens) => void; rationale?: string }) {
  const t = tokens.typography
  return (
    <div>
      <RationaleNote text={rationale} />
      <Field label="Font titoli">
        <FontPicker value={t.fontHeading} onChange={(v) => patch((x) => { x.typography.fontHeading = v; return x })} />
      </Field>
      <Field label="Font corpo">
        <FontPicker value={t.fontBody} onChange={(v) => patch((x) => { x.typography.fontBody = v; return x })} />
      </Field>
      <Field label={`Dimensione base: ${t.baseSize}px`} hint="≥ 16px per buona leggibilità">
        <input type="range" min={14} max={20} value={t.baseSize} onChange={(e) => patch((x) => { x.typography.baseSize = Number(e.target.value); return x })} className="w-full" />
      </Field>
      <Field label={`Scala tipografica: ${t.scaleRatio}`} hint="Più alta = titoli più grandi, gerarchia più forte">
        <input type="range" min={1.1} max={1.6} step={0.05} value={t.scaleRatio} onChange={(e) => patch((x) => { x.typography.scaleRatio = Number(e.target.value); return x })} className="w-full" />
      </Field>
    </div>
  )
}

function FontPicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="grid grid-cols-2 gap-2">
      {Object.entries(FONT_STACKS).map(([key, { label, stack }]) => (
        <button key={key} onClick={() => onChange(key)}
          className={`rounded-lg border px-3 py-2 text-left text-sm transition ${value === key ? 'border-indigo-400 bg-indigo-50' : 'border-slate-200 hover:border-indigo-300'}`}>
          <span className="block text-xs text-slate-400">{label}</span>
          <span className="block font-semibold text-slate-700" style={{ fontFamily: stack }}>Aa Bb Cc</span>
        </button>
      ))}
    </div>
  )
}

function OptionRow<T extends string>({ label, value, options, onChange }: {
  label: string; value: T; options: { key: T; label: string }[]; onChange: (v: T) => void
}) {
  return (
    <Field label={label}>
      <div className="flex gap-2">
        {options.map((o) => (
          <button key={o.key} onClick={() => onChange(o.key)}
            className={`flex-1 rounded-lg border px-2 py-1.5 text-sm font-semibold transition ${value === o.key ? 'border-indigo-400 bg-indigo-50 text-indigo-700' : 'border-slate-200 text-slate-600 hover:border-indigo-300'}`}>
            {o.label}
          </button>
        ))}
      </div>
    </Field>
  )
}

function StepShape({ tokens, patch, rationale }: { tokens: DesignTokens; patch: (fn: (t: DesignTokens) => DesignTokens) => void; rationale?: string }) {
  return (
    <div>
      <RationaleNote text={rationale} />
      <OptionRow label="Forma bottoni" value={tokens.shape.buttonShape}
        options={[{ key: 'squared', label: 'Squadrati' }, { key: 'soft', label: 'Morbidi' }, { key: 'pill', label: 'Pillola' }]}
        onChange={(v) => patch((x) => { x.shape.buttonShape = v; return x })} />
      <Field label="Stile bottoni">
        <div className="grid grid-cols-3 gap-2">
          {([['solid', 'Pieno'], ['outline', 'Bordo'], ['soft', 'Tinta'], ['gradient', 'Gradiente'], ['glass', 'Vetro'], ['glossy', 'Lucido']] as const).map(([k, label]) => (
            <button key={k} onClick={() => patch((x) => { x.shape.buttonStyle = k; return x })}
              className={`rounded-lg border px-2 py-1.5 text-sm font-semibold transition ${tokens.shape.buttonStyle === k ? 'border-indigo-400 bg-indigo-50 text-indigo-700' : 'border-slate-200 text-slate-600 hover:border-indigo-300'}`}>
              {label}
            </button>
          ))}
        </div>
      </Field>
      <Field label="Stile card/superfici" hint="Vetro e translucido si vedono meglio su sfondi colorati">
        <div className="grid grid-cols-4 gap-2">
          {([['flat', 'Piene'], ['transparent', 'Translucide'], ['frosted', 'Vetro'], ['glossy', 'Lucide']] as const).map(([k, label]) => (
            <button key={k} onClick={() => patch((x) => { x.shape.surfaceStyle = k; return x })}
              className={`rounded-lg border px-2 py-1.5 text-xs font-semibold transition ${tokens.shape.surfaceStyle === k ? 'border-indigo-400 bg-indigo-50 text-indigo-700' : 'border-slate-200 text-slate-600 hover:border-indigo-300'}`}>
              {label}
            </button>
          ))}
        </div>
      </Field>
      <Field label={`Raggio angoli card: ${tokens.shape.radius}px`}>
        <input type="range" min={0} max={28} value={tokens.shape.radius} onChange={(e) => patch((x) => { x.shape.radius = Number(e.target.value); return x })} className="w-full" />
      </Field>
      <OptionRow label="Profondità (ombre)" value={tokens.shape.shadowLevel}
        options={[{ key: 'none', label: 'Piatto' }, { key: 'soft', label: 'Morbide' }, { key: 'strong', label: 'Marcate' }]}
        onChange={(v) => patch((x) => { x.shape.shadowLevel = v; return x })} />
      <OptionRow label="Densità spaziatura" value={tokens.spacing.density}
        options={[{ key: 'compact', label: 'Compatta' }, { key: 'comfortable', label: 'Comoda' }, { key: 'spacious', label: 'Ariosa' }]}
        onChange={(v) => patch((x) => { x.spacing.density = v; return x })} />
    </div>
  )
}

function StepPriorities({ tokens, patch }: { tokens: DesignTokens; patch: (fn: (t: DesignTokens) => DesignTokens) => void }) {
  const toggle = (p: string) => patch((t) => {
    const has = t.priorities.includes(p)
    t.priorities = has ? t.priorities.filter((x) => x !== p) : [...t.priorities, p].slice(0, 6)
    return t
  })
  return (
    <div>
      <p className="mb-3 text-sm text-slate-500">Cosa conta di più in questo design? L’ordine guida le scelte di gerarchia e layout dell’AI.</p>
      <div className="flex flex-wrap gap-2">
        {PRIORITY_OPTIONS.map((p) => {
          const idx = tokens.priorities.indexOf(p)
          const active = idx >= 0
          return (
            <button key={p} onClick={() => toggle(p)}
              className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-semibold transition ${active ? 'border-indigo-400 bg-indigo-600 text-white' : 'border-slate-200 text-slate-600 hover:border-indigo-300'}`}>
              {active && <span className="flex h-4 w-4 items-center justify-center rounded-full bg-white/25 text-[10px]">{idx + 1}</span>}
              {p}
            </button>
          )
        })}
      </div>
    </div>
  )
}

function StepSummary({ name, score, warnings, compiling, markdown }: {
  name: string; score: number | null; warnings: string[]; compiling: boolean; markdown: string
}) {
  const pct = score == null ? null : Math.round(score * 100)
  return (
    <div>
      <Field label="Coerenza visiva">
        {compiling ? (
          <p className="inline-flex items-center gap-1.5 text-sm text-slate-500"><Loader2 className="h-4 w-4 animate-spin" /> Calcolo…</p>
        ) : (
          <div className="flex items-center gap-3">
            <div className={`flex h-14 w-14 items-center justify-center rounded-full text-lg font-bold ${pct != null && pct >= 80 ? 'bg-green-100 text-green-700' : pct != null && pct >= 60 ? 'bg-amber-100 text-amber-700' : 'bg-red-100 text-red-700'}`}>
              {pct == null ? '—' : `${pct}`}
            </div>
            <p className="text-sm text-slate-600">{pct != null && pct >= 80 ? 'Ottima coerenza e leggibilità.' : 'Migliorabile: vedi le note sotto.'}</p>
          </div>
        )}
      </Field>
      {warnings.length > 0 && (
        <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-3">
          <p className="mb-1 text-xs font-bold uppercase tracking-wide text-amber-700">Da migliorare</p>
          <ul className="list-disc space-y-1 pl-4 text-xs text-amber-800">{warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>
        </div>
      )}
      <Field label={`design-system.md (verrà allegato a “${name || 'progetto'}”)`} hint="L’Ai è vincolata a queste regole quando genera il codice">
        <pre className="max-h-48 overflow-auto rounded-lg border border-slate-200 bg-slate-50 p-3 text-[11px] leading-snug text-slate-600">{markdown || '…'}</pre>
      </Field>
    </div>
  )
}

function LivePreview({ tokens }: { tokens: DesignTokens }) {
  const vars = previewVars(tokens) as React.CSSProperties
  const headingFont = resolveStack(tokens.typography.fontHeading)
  const bodyFont = resolveStack(tokens.typography.fontBody)
  const r = tokens.typography.scaleRatio
  const base = tokens.typography.baseSize
  // Decorate the page background with primary/accent blooms so glass/transparency effects read.
  const glassy = tokens.shape.surfaceStyle !== 'flat' || tokens.shape.buttonStyle === 'glass'
  const bg = glassy
    ? `radial-gradient(circle at 18% 12%, ${rgba(tokens.palette.primary, 0.30)}, transparent 42%), radial-gradient(circle at 88% 8%, ${rgba(tokens.palette.accent, 0.26)}, transparent 40%), var(--ds-bg)`
    : 'var(--ds-bg)'
  const cardStyle: React.CSSProperties = {
    background: 'var(--ds-card-bg)', border: '1px solid var(--ds-card-border)', borderRadius: 'var(--ds-radius)',
    boxShadow: 'var(--ds-shadow)', backdropFilter: 'var(--ds-card-backdrop)', WebkitBackdropFilter: 'var(--ds-card-backdrop)',
  }
  return (
    <div style={{ ...vars, background: bg, borderRadius: 16, padding: 'calc(var(--ds-space) * 3)', fontFamily: bodyFont, color: 'var(--ds-text)' }}>
      <h1 style={{ fontFamily: headingFont, fontWeight: tokens.typography.headingWeight, fontSize: base * Math.pow(r, 3), margin: 0, lineHeight: 1.2 }}>Titolo principale</h1>
      <p style={{ color: 'var(--ds-text-muted)', fontSize: base, marginTop: 'var(--ds-space)', lineHeight: 1.5 }}>
        Testo di esempio per valutare leggibilità, ritmo e coerenza dei colori.
      </p>
      <div style={{ display: 'flex', gap: 'var(--ds-space)', marginTop: 'calc(var(--ds-space) * 2)', flexWrap: 'wrap' }}>
        <button style={{ background: 'var(--ds-btn-bg)', color: 'var(--ds-btn-color)', border: 'var(--ds-btn-border)', borderRadius: 'var(--ds-btn-radius)', padding: '10px 18px', fontWeight: 600, boxShadow: 'var(--ds-shadow)', backdropFilter: 'var(--ds-btn-backdrop)', WebkitBackdropFilter: 'var(--ds-btn-backdrop)', cursor: 'pointer' }}>Azione primaria</button>
        <button style={{ background: 'var(--ds-color-accent)', color: 'var(--ds-color-accent-text)', border: 'none', borderRadius: 'var(--ds-btn-radius)', padding: '10px 18px', fontWeight: 600, cursor: 'pointer' }}>Accento</button>
        <button style={{ background: 'transparent', color: 'var(--ds-text)', border: 'var(--ds-border-width, 1px) solid var(--ds-border)', borderRadius: 'var(--ds-btn-radius)', padding: '10px 18px', fontWeight: 600, cursor: 'pointer' }}>Secondario</button>
      </div>
      <div style={{ ...cardStyle, padding: 'calc(var(--ds-space) * 2)', marginTop: 'calc(var(--ds-space) * 2)' }}>
        <h2 style={{ fontFamily: headingFont, fontWeight: tokens.typography.headingWeight, fontSize: base * Math.pow(r, 1.5), margin: 0 }}>Card di esempio</h2>
        <p style={{ color: 'var(--ds-text-muted)', fontSize: base * 0.9, marginTop: 6, lineHeight: 1.5 }}>Card su superficie, con bordo e ombra secondo il design system.</p>
        <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
          <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--ds-success)' }}>● Successo</span>
          <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--ds-danger)' }}>● Errore</span>
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 'calc(var(--ds-space) * 2)' }}>
        <Type className="h-3.5 w-3.5" style={{ color: 'var(--ds-text-muted)' }} />
        <input placeholder="Campo di testo" style={{ flex: 1, background: 'var(--ds-surface)', border: '1px solid var(--ds-border)', borderRadius: 'var(--ds-btn-radius)', padding: '8px 12px', color: 'var(--ds-text)', fontSize: base * 0.9 }} />
      </div>
    </div>
  )
}
