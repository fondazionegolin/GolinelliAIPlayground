import { useEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { adminApi } from '@/lib/api'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { useToast } from '@/components/ui/use-toast'
import { RotateCcw, Save, Code2, Palette, Clock, Eye } from 'lucide-react'

// ─── Types ───────────────────────────────────────────────────────────────────

interface EmailConfig {
  headerTitle: string
  color1: string
  color2: string
  greeting: string
  bodyText: string
  buttonLabel: string
  warningText: string
  footerText: string
}

type TemplateEntry = {
  label: string
  description: string
  placeholders: string[]
  subject: string
  html: string
  text: string
}
type EmailTemplatesPayload = Record<string, TemplateEntry>
type TemplateHistoryResponse = {
  template_key: string
  items: Array<{
    id: string
    version: number
    subject: string
    html: string
    text: string
    created_at?: string | null
    updated_by?: { id?: string | null; email?: string | null; name?: string | null }
  }>
}

// ─── Per-template defaults ────────────────────────────────────────────────────

const DEFAULT_CONFIGS: Record<string, EmailConfig> = {
  teacher_invitation: {
    headerTitle: '🎓 Golinelli.ai',
    color1: '#667eea',
    color2: '#764ba2',
    greeting: 'Ciao, {first_name}!',
    bodyText:
      'Sei stato invitato a unirti alla piattaforma Golinelli.ai come docente.\n\nPer accettare l\'invito e configurare il tuo account, clicca sul pulsante qui sotto:',
    buttonLabel: 'Accetta invito',
    warningText: '⚠️ Questo link scadrà tra 7 giorni.',
    footerText: 'Questa email è stata inviata automaticamente dalla piattaforma Golinelli.ai.',
  },
  teacher_activation: {
    headerTitle: '🎓 Golinelli.ai',
    color1: '#667eea',
    color2: '#764ba2',
    greeting: 'Benvenuto/a, {first_name}!',
    bodyText:
      'Siamo lieti di informarti che la tua richiesta di account docente è stata approvata.\n\nPer completare l\'attivazione del tuo account, clicca sul pulsante qui sotto:',
    buttonLabel: 'Attiva il tuo account',
    warningText: '⚠️ Questo link è personale e scadrà tra 72 ore. Non condividerlo con nessuno.',
    footerText:
      'Questa email è stata inviata automaticamente dalla piattaforma Golinelli.ai.\nSe non hai richiesto questo account, puoi ignorare questa email.',
  },
  password_reset: {
    headerTitle: '🔐 Golinelli.ai',
    color1: '#f093fb',
    color2: '#f5576c',
    greeting: 'Ciao, {first_name}!',
    bodyText:
      'Un amministratore ha impostato una nuova password temporanea per il tuo account.\n\nLa tua password temporanea è: {temporary_password}\n\nPer accedere, clicca sul pulsante qui sotto:',
    buttonLabel: 'Vai al login',
    warningText: '⚠️ Per sicurezza, cambia la password subito dopo il primo accesso.',
    footerText: 'Questa email è stata inviata automaticamente dalla piattaforma Golinelli.ai.',
  },
}

// link variable per template
const LINK_VAR: Record<string, string> = {
  teacher_invitation: '{invitation_link}',
  teacher_activation: '{activation_link}',
  password_reset: '{login_url}',
}

// sample values for live preview
const PREVIEW_SAMPLES: Record<string, string> = {
  '{first_name}': 'Mario',
  '{last_name}': 'Rossi',
  '{invitation_link}': '#',
  '{activation_link}': '#',
  '{login_url}': '#',
  '{temporary_password}': 'Abc123xyz!',
}

// ─── HTML builder ─────────────────────────────────────────────────────────────

function buildHtmlFromConfig(config: EmailConfig, templateKey: string): string {
  const linkVar = LINK_VAR[templateKey] || '{invitation_link}'
  const bodyParagraphs = config.bodyText
    .split('\n')
    .map((line) => (line.trim() === '' ? '' : `<p style="margin: 0 0 12px 0;">${line}</p>`))
    .join('\n        ')

  const meta = JSON.stringify({
    headerTitle: config.headerTitle,
    color1: config.color1,
    color2: config.color2,
    greeting: config.greeting,
    bodyText: config.bodyText,
    buttonLabel: config.buttonLabel,
    warningText: config.warningText,
    footerText: config.footerText,
  })

  return `<!-- VISUAL_CONFIG:${meta} -->
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
  <div style="background: linear-gradient(135deg, ${config.color1} 0%, ${config.color2} 100%); padding: 30px; border-radius: 10px 10px 0 0; text-align: center;">
    <h1 style="color: white; margin: 0; font-size: 28px;">${config.headerTitle}</h1>
  </div>
  <div style="background: #ffffff; padding: 30px; border: 1px solid #e0e0e0; border-top: none; border-radius: 0 0 10px 10px;">
    <h2 style="color: #333; margin-top: 0;">${config.greeting}</h2>
    ${bodyParagraphs}
    <div style="text-align: center; margin: 30px 0;">
      <a href="${linkVar}" style="background: linear-gradient(135deg, ${config.color1} 0%, ${config.color2} 100%); color: white; padding: 15px 30px; text-decoration: none; border-radius: 8px; font-weight: bold; display: inline-block; font-size: 16px;">
        ${config.buttonLabel}
      </a>
    </div>
    ${config.warningText ? `<p style="color: #666; font-size: 14px;">${config.warningText}</p>` : ''}
    <hr style="border: none; border-top: 1px solid #e0e0e0; margin: 30px 0;">
    <p style="color: #999; font-size: 12px; text-align: center; white-space: pre-line;">${config.footerText}</p>
  </div>
</body>
</html>`
}

function buildTextFromConfig(config: EmailConfig): string {
  return `${config.greeting}\n\n${config.bodyText}\n\n${config.warningText}\n\n---\n${config.footerText}`
}

function extractConfigFromHtml(html: string, templateKey: string): EmailConfig {
  const match = html.match(/<!--\s*VISUAL_CONFIG:(.*?)\s*-->/)
  if (match) {
    try {
      const parsed = JSON.parse(match[1])
      return {
        headerTitle: parsed.headerTitle ?? DEFAULT_CONFIGS[templateKey]?.headerTitle ?? '',
        color1: parsed.color1 ?? '#667eea',
        color2: parsed.color2 ?? '#764ba2',
        greeting: parsed.greeting ?? '',
        bodyText: parsed.bodyText ?? '',
        buttonLabel: parsed.buttonLabel ?? '',
        warningText: parsed.warningText ?? '',
        footerText: parsed.footerText ?? '',
      }
    } catch {
      // fall through to default
    }
  }
  return DEFAULT_CONFIGS[templateKey] ?? DEFAULT_CONFIGS.teacher_invitation
}

function applyPreviewSamples(html: string): string {
  let out = html
  for (const [key, val] of Object.entries(PREVIEW_SAMPLES)) {
    out = out.split(key).join(val)
  }
  return out
}

// ─── Color field ──────────────────────────────────────────────────────────────

function ColorField({
  label,
  value,
  onChange,
}: {
  label: string
  value: string
  onChange: (v: string) => void
}) {
  return (
    <div className="flex items-center gap-2">
      <input
        type="color"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-8 w-8 cursor-pointer rounded border border-slate-200 p-0.5"
        title={label}
      />
      <div className="flex-1">
        <p className="text-[11px] font-medium text-slate-500">{label}</p>
        <Input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="h-7 font-mono text-xs"
        />
      </div>
    </div>
  )
}

// ─── Visual editor ────────────────────────────────────────────────────────────

function VisualEmailEditor({
  templateKey,
  config,
  onChange,
}: {
  templateKey: string
  config: EmailConfig
  onChange: (c: EmailConfig) => void
}) {
  const set = (patch: Partial<EmailConfig>) => onChange({ ...config, ...patch })
  const placeholders = {
    teacher_invitation: ['{first_name}', '{invitation_link}'],
    teacher_activation: ['{first_name}', '{last_name}', '{activation_link}'],
    password_reset: ['{first_name}', '{last_name}', '{temporary_password}', '{login_url}'],
  }[templateKey] ?? []

  return (
    <div className="space-y-4">
      {/* Tema */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-sm font-semibold">
            <Palette className="h-4 w-4 text-[#e85c8d]" />
            Tema
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 p-4 pt-0">
          <div>
            <Label className="mb-1 block text-xs font-medium">Titolo header</Label>
            <Input
              value={config.headerTitle}
              onChange={(e) => set({ headerTitle: e.target.value })}
              className="text-sm"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <ColorField label="Colore primario" value={config.color1} onChange={(v) => set({ color1: v })} />
            <ColorField label="Colore secondario" value={config.color2} onChange={(v) => set({ color2: v })} />
          </div>
          <div
            className="h-6 w-full rounded"
            style={{ background: `linear-gradient(135deg, ${config.color1} 0%, ${config.color2} 100%)` }}
          />
        </CardContent>
      </Card>

      {/* Messaggio */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold">Messaggio</CardTitle>
          {placeholders.length > 0 && (
            <CardDescription className="text-xs">
              Variabili:{' '}
              {placeholders.map((p) => (
                <code key={p} className="mx-0.5 rounded bg-slate-100 px-1 text-[11px] font-mono text-slate-700">
                  {p}
                </code>
              ))}
            </CardDescription>
          )}
        </CardHeader>
        <CardContent className="space-y-3 p-4 pt-0">
          <div>
            <Label className="mb-1 block text-xs font-medium">Saluto</Label>
            <Input
              value={config.greeting}
              onChange={(e) => set({ greeting: e.target.value })}
              className="text-sm"
            />
          </div>
          <div>
            <Label className="mb-1 block text-xs font-medium">Corpo del messaggio</Label>
            <Textarea
              value={config.bodyText}
              onChange={(e) => set({ bodyText: e.target.value })}
              className="min-h-[100px] resize-y text-sm"
            />
            <p className="mt-1 text-[11px] text-slate-400">Ogni riga diventa un paragrafo separato.</p>
          </div>
          <div>
            <Label className="mb-1 block text-xs font-medium">Testo del pulsante</Label>
            <Input
              value={config.buttonLabel}
              onChange={(e) => set({ buttonLabel: e.target.value })}
              className="text-sm"
            />
          </div>
        </CardContent>
      </Card>

      {/* Note */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold">Note e footer</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 p-4 pt-0">
          <div>
            <Label className="mb-1 block text-xs font-medium">Avviso sotto al pulsante</Label>
            <Input
              value={config.warningText}
              onChange={(e) => set({ warningText: e.target.value })}
              className="text-sm"
            />
          </div>
          <div>
            <Label className="mb-1 block text-xs font-medium">Testo footer</Label>
            <Textarea
              value={config.footerText}
              onChange={(e) => set({ footerText: e.target.value })}
              className="min-h-[60px] resize-y text-sm"
            />
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

// ─── Main page ────────────────────────────────────────────────────────────────

const VISUAL_KEYS = new Set(['teacher_invitation', 'teacher_activation', 'password_reset'])

const formatDateTime = (raw?: string | null) => {
  if (!raw) return '—'
  const d = new Date(raw)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleString('it-IT')
}

export default function EmailPage() {
  const queryClient = useQueryClient()
  const { toast } = useToast()
  const iframeRef = useRef<HTMLIFrameElement>(null)

  const [templateKey, setTemplateKey] = useState('teacher_invitation')
  const [templateDrafts, setTemplateDrafts] = useState<EmailTemplatesPayload>({})
  const [mode, setMode] = useState<'visual' | 'html'>('visual')
  const [visualConfig, setVisualConfig] = useState<EmailConfig>(
    DEFAULT_CONFIGS.teacher_invitation
  )

  // Track whether we've done the initial load from server
  const initializedRef = useRef(false)
  // Track the previous templateKey to distinguish user-switch from mount
  const prevTemplateKeyRef = useRef<string | null>(null)

  const { data: emailTemplates } = useQuery<EmailTemplatesPayload>({
    queryKey: ['admin-email-templates'],
    queryFn: async () => (await adminApi.getEmailTemplates()).data,
  })

  const { data: templateHistory } = useQuery<TemplateHistoryResponse>({
    queryKey: ['admin-email-templates-history', templateKey],
    queryFn: async () => (await adminApi.getEmailTemplateHistory(templateKey, 15)).data,
    enabled: Boolean(templateKey),
  })

  // First load only: initialize drafts AND visual config from server
  useEffect(() => {
    if (!emailTemplates || initializedRef.current) return
    initializedRef.current = true
    setTemplateDrafts(emailTemplates)

    // Fix initial templateKey if needed
    let activeKey = templateKey
    if (!emailTemplates[templateKey]) {
      const firstKey = Object.keys(emailTemplates)[0]
      if (firstKey) {
        setTemplateKey(firstKey)
        activeKey = firstKey
      }
    }

    // Extract visual config from what's actually saved on the server
    if (VISUAL_KEYS.has(activeKey)) {
      const tpl = emailTemplates[activeKey]
      setVisualConfig(extractConfigFromHtml(tpl?.html || '', activeKey))
    }
    prevTemplateKeyRef.current = activeKey
  }, [emailTemplates])

  // When user switches template key (not on initial mount)
  useEffect(() => {
    if (prevTemplateKeyRef.current === null) {
      // First run at mount: skip, handled by emailTemplates effect above
      prevTemplateKeyRef.current = templateKey
      return
    }
    if (prevTemplateKeyRef.current === templateKey) return
    prevTemplateKeyRef.current = templateKey

    const tpl = templateDrafts[templateKey]
    if (tpl && VISUAL_KEYS.has(templateKey)) {
      setVisualConfig(extractConfigFromHtml(tpl.html || '', templateKey))
    } else if (VISUAL_KEYS.has(templateKey)) {
      setVisualConfig(DEFAULT_CONFIGS[templateKey] ?? DEFAULT_CONFIGS.teacher_invitation)
    }
    setMode('visual')
  }, [templateKey])

  // Sync html draft whenever visual config changes (user edits)
  useEffect(() => {
    if (mode !== 'visual' || !VISUAL_KEYS.has(templateKey)) return
    const html = buildHtmlFromConfig(visualConfig, templateKey)
    const text = buildTextFromConfig(visualConfig)
    setTemplateDrafts((prev) => ({
      ...prev,
      [templateKey]: { ...prev[templateKey], html, text },
    }))
  }, [visualConfig, mode, templateKey])

  const selectedTemplate = templateDrafts[templateKey]
  const isVisualTemplate = VISUAL_KEYS.has(templateKey)

  const updateHtml = (html: string) => {
    setTemplateDrafts((prev) => ({ ...prev, [templateKey]: { ...prev[templateKey], html } }))
  }
  const updateSubject = (subject: string) => {
    setTemplateDrafts((prev) => ({ ...prev, [templateKey]: { ...prev[templateKey], subject } }))
  }

  const handleSwitchToHtml = () => {
    setMode('html')
  }

  const handleSwitchToVisual = () => {
    // re-extract config from current html
    const html = selectedTemplate?.html || ''
    setVisualConfig(extractConfigFromHtml(html, templateKey))
    setMode('visual')
  }

  const previewHtml = applyPreviewSamples(selectedTemplate?.html || '')

  const saveTemplatesMutation = useMutation({
    mutationFn: () => adminApi.updateEmailTemplates(templateDrafts as any),
    onSuccess: async () => {
      // Only refresh history — NOT the templates query (would reset the draft)
      await queryClient.invalidateQueries({ queryKey: ['admin-email-templates-history', templateKey] })
      toast({ title: 'Template salvato' })
    },
    onError: (error: any) => {
      toast({
        variant: 'destructive',
        title: 'Errore salvataggio',
        description: error?.response?.data?.detail || 'Impossibile salvare',
      })
    },
  })

  const resetTemplateMutation = useMutation({
    mutationFn: () => adminApi.resetEmailTemplate(templateKey),
    onSuccess: async () => {
      // Explicitly reload after reset
      const refreshed = (await adminApi.getEmailTemplates()).data
      setTemplateDrafts(refreshed)
      if (VISUAL_KEYS.has(templateKey) && refreshed[templateKey]) {
        setVisualConfig(extractConfigFromHtml(refreshed[templateKey].html || '', templateKey))
      }
      await queryClient.invalidateQueries({ queryKey: ['admin-email-templates-history', templateKey] })
      setMode('visual')
      toast({ title: 'Template ripristinato' })
    },
  })

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Email & Messaggi</h1>
        <p className="text-sm text-slate-500 mt-0.5">
          Personalizza le email automatiche e il disclaimer beta.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-4">
        {/* ── Left: editor ── */}
        <div className="xl:col-span-3 space-y-4">
          {/* Template selector */}
          <Card>
            <CardContent className="p-4 space-y-3">
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold uppercase text-slate-500 tracking-wide">
                  Caso d'uso
                </Label>
                <select
                  className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm focus:outline-none focus:ring-1 focus:ring-[#e85c8d]"
                  value={templateKey}
                  onChange={(e) => setTemplateKey(e.target.value)}
                >
                  {Object.entries(templateDrafts).map(([key, tpl]) => (
                    <option key={key} value={key}>{tpl.label}</option>
                  ))}
                </select>
                {selectedTemplate?.description && (
                  <p className="text-xs text-slate-500">{selectedTemplate.description}</p>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Subject */}
          {templateKey !== 'beta_disclaimer' && (
            <Card>
              <CardContent className="p-4 space-y-1.5">
                <Label className="text-xs font-semibold uppercase text-slate-500 tracking-wide">
                  Oggetto email
                </Label>
                <Input
                  value={selectedTemplate?.subject || ''}
                  onChange={(e) => updateSubject(e.target.value)}
                  placeholder="Inserisci l'oggetto…"
                  className="text-sm"
                />
              </CardContent>
            </Card>
          )}

          {isVisualTemplate ? (
            <>
              {/* Mode toggle */}
              <div className="flex items-center gap-2">
                <button
                  onClick={() => handleSwitchToVisual()}
                  className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-all ${
                    mode === 'visual'
                      ? 'bg-[#e85c8d] text-white shadow-sm'
                      : 'border border-slate-200 bg-white text-slate-600 hover:border-slate-300'
                  }`}
                >
                  <Palette className="h-3.5 w-3.5" />
                  Visuale
                </button>
                <button
                  onClick={handleSwitchToHtml}
                  className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-all ${
                    mode === 'html'
                      ? 'bg-slate-800 text-white shadow-sm'
                      : 'border border-slate-200 bg-white text-slate-600 hover:border-slate-300'
                  }`}
                >
                  <Code2 className="h-3.5 w-3.5" />
                  HTML sorgente
                </button>
                {mode === 'html' && (
                  <p className="ml-1 text-xs text-amber-600">
                    ⚠️ Le modifiche HTML potrebbero non essere riconvertite in visuale.
                  </p>
                )}
              </div>

              {mode === 'visual' ? (
                /* ── VISUAL + PREVIEW side by side ── */
                <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                  <div>
                    <VisualEmailEditor
                      templateKey={templateKey}
                      config={visualConfig}
                      onChange={setVisualConfig}
                    />
                  </div>
                  <div className="sticky top-4 self-start">
                    <Card>
                      <CardHeader className="pb-2">
                        <CardTitle className="flex items-center gap-2 text-sm font-semibold">
                          <Eye className="h-4 w-4 text-slate-400" />
                          Anteprima live
                        </CardTitle>
                        <CardDescription className="text-xs">
                          Valori di esempio: {Object.entries(PREVIEW_SAMPLES).slice(0, 3).map(([k]) => k).join(', ')}…
                        </CardDescription>
                      </CardHeader>
                      <CardContent className="p-0 overflow-hidden rounded-b-lg">
                        <iframe
                          ref={iframeRef}
                          srcDoc={previewHtml}
                          className="h-[560px] w-full border-0"
                          title="Anteprima email"
                          sandbox="allow-same-origin"
                        />
                      </CardContent>
                    </Card>
                  </div>
                </div>
              ) : (
                /* ── HTML mode ── */
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-semibold">HTML sorgente</CardTitle>
                  </CardHeader>
                  <CardContent className="p-4 pt-0">
                    <Textarea
                      className="min-h-[400px] font-mono text-xs resize-y"
                      value={selectedTemplate?.html || ''}
                      onChange={(e) => updateHtml(e.target.value)}
                    />
                  </CardContent>
                </Card>
              )}
            </>
          ) : (
            /* ── beta_disclaimer or other plain templates ── */
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-semibold">Contenuto</CardTitle>
              </CardHeader>
              <CardContent className="p-4 pt-0">
                <Textarea
                  className="min-h-[200px] font-mono text-xs resize-y"
                  value={selectedTemplate?.html || ''}
                  onChange={(e) => updateHtml(e.target.value)}
                />
              </CardContent>
            </Card>
          )}

          {/* Actions */}
          <div className="flex justify-between gap-2">
            <Button
              variant="outline"
              className="gap-2"
              onClick={() => resetTemplateMutation.mutate()}
              disabled={resetTemplateMutation.isPending}
            >
              <RotateCcw className="h-4 w-4" />
              {resetTemplateMutation.isPending ? 'Ripristino…' : 'Ripristina default'}
            </Button>
            <Button
              className="gap-2"
              style={{ backgroundColor: '#e85c8d' }}
              onClick={() => saveTemplatesMutation.mutate()}
              disabled={
                saveTemplatesMutation.isPending ||
                (templateKey !== 'beta_disclaimer' && !selectedTemplate?.subject?.trim())
              }
            >
              <Save className="h-4 w-4" />
              {saveTemplatesMutation.isPending ? 'Salvataggio…' : 'Salva template'}
            </Button>
          </div>
        </div>

        {/* ── Right: version history ── */}
        <div className="space-y-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-sm font-semibold">
                <Clock className="h-4 w-4 text-slate-400" />
                Storico versioni
              </CardTitle>
            </CardHeader>
            <CardContent className="p-4 pt-0">
              <div className="max-h-[500px] space-y-1.5 overflow-auto">
                {(templateHistory?.items || []).length === 0 ? (
                  <p className="text-xs text-slate-400">Nessuna versione salvata.</p>
                ) : (
                  (templateHistory?.items || []).map((item) => (
                    <div
                      key={item.id}
                      className="rounded-lg border border-slate-100 bg-slate-50 px-3 py-2"
                    >
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-semibold text-slate-700">v{item.version}</span>
                        <span className="text-slate-400">{formatDateTime(item.created_at)}</span>
                      </div>
                      <p className="mt-0.5 truncate text-[11px] text-slate-500">
                        {item.updated_by?.email || item.updated_by?.name || 'sistema'}
                      </p>
                      <p className="mt-0.5 truncate text-[11px] text-slate-400 italic">
                        {item.subject}
                      </p>
                    </div>
                  ))
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
