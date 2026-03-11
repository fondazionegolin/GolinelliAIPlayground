import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { adminApi } from '@/lib/api'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { useToast } from '@/components/ui/use-toast'
import { RotateCcw, Save, Eye, Clock } from 'lucide-react'

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

const formatDateTime = (raw?: string | null) => {
  if (!raw) return '—'
  const d = new Date(raw)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleString('it-IT')
}

export default function EmailPage() {
  const queryClient = useQueryClient()
  const { toast } = useToast()

  const [templateKey, setTemplateKey] = useState('teacher_activation')
  const [templateDrafts, setTemplateDrafts] = useState<EmailTemplatesPayload>({})

  const { data: emailTemplates } = useQuery<EmailTemplatesPayload>({
    queryKey: ['admin-email-templates'],
    queryFn: async () => (await adminApi.getEmailTemplates()).data,
  })

  const { data: templateHistory } = useQuery<TemplateHistoryResponse>({
    queryKey: ['admin-email-templates-history', templateKey],
    queryFn: async () => (await adminApi.getEmailTemplateHistory(templateKey, 15)).data,
    enabled: Boolean(templateKey),
  })

  useEffect(() => {
    if (!emailTemplates) return
    setTemplateDrafts(emailTemplates)
    if (!emailTemplates[templateKey]) {
      const firstKey = Object.keys(emailTemplates)[0]
      if (firstKey) setTemplateKey(firstKey)
    }
  }, [emailTemplates])

  const saveTemplatesMutation = useMutation({
    mutationFn: () => adminApi.updateEmailTemplates(templateDrafts as any),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['admin-email-templates'] })
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
      await queryClient.invalidateQueries({ queryKey: ['admin-email-templates'] })
      await queryClient.invalidateQueries({ queryKey: ['admin-email-templates-history', templateKey] })
      toast({ title: 'Template ripristinato' })
    },
  })

  const selectedTemplate = templateDrafts[templateKey]
  const updateSelected = (patch: Partial<TemplateEntry>) => {
    if (!selectedTemplate) return
    setTemplateDrafts((prev) => ({ ...prev, [templateKey]: { ...prev[templateKey], ...patch } }))
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Email & Messaggi</h1>
        <p className="text-sm text-slate-500 mt-0.5">
          Personalizza le email automatiche e il disclaimer beta.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        {/* Left: editor */}
        <div className="xl:col-span-2 space-y-4">
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
                {selectedTemplate?.placeholders?.length ? (
                  <p className="text-xs text-slate-500">
                    Variabili disponibili:{' '}
                    {selectedTemplate.placeholders.map((p) => (
                      <code key={p} className="mx-0.5 rounded bg-slate-100 px-1 py-0.5 text-[11px] font-mono text-slate-700">
                        {p}
                      </code>
                    ))}
                  </p>
                ) : null}
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
                  onChange={(e) => updateSelected({ subject: e.target.value })}
                  placeholder="Inserisci l'oggetto…"
                  className="text-sm"
                />
              </CardContent>
            </Card>
          )}

          {/* HTML editor */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold">HTML</CardTitle>
              <CardDescription className="text-xs">Supporta CSS inline e blocchi style.</CardDescription>
            </CardHeader>
            <CardContent className="p-4 pt-0">
              <Textarea
                className="min-h-[240px] font-mono text-xs resize-y"
                value={selectedTemplate?.html || ''}
                onChange={(e) => updateSelected({ html: e.target.value })}
              />
            </CardContent>
          </Card>

          {/* Plain text */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold">Testo piano</CardTitle>
              <CardDescription className="text-xs">Fallback per client email senza HTML.</CardDescription>
            </CardHeader>
            <CardContent className="p-4 pt-0">
              <Textarea
                className="min-h-[120px] font-mono text-xs resize-y"
                value={selectedTemplate?.text || ''}
                onChange={(e) => updateSelected({ text: e.target.value })}
              />
            </CardContent>
          </Card>

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

        {/* Right: preview + history */}
        <div className="space-y-4">
          {/* Live preview */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <Eye className="h-4 w-4 text-slate-500" />
                Anteprima
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <div className="max-h-[360px] overflow-auto p-4">
                <div
                  className="prose prose-sm max-w-none text-sm"
                  dangerouslySetInnerHTML={{
                    __html: selectedTemplate?.html || '<p class="text-slate-400 text-xs">Nessun contenuto HTML</p>',
                  }}
                />
              </div>
            </CardContent>
          </Card>

          {/* Version history */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <Clock className="h-4 w-4 text-slate-500" />
                Storico versioni
              </CardTitle>
            </CardHeader>
            <CardContent className="p-4 pt-0">
              <div className="max-h-[300px] space-y-1.5 overflow-auto">
                {(templateHistory?.items || []).length === 0 ? (
                  <p className="text-xs text-slate-400">Nessuna versione salvata</p>
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
