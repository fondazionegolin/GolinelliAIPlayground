import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { llmApi, type ModelScope } from '@/lib/api'
import { SearchableSelect } from '@/components/ui/searchable-select'
import { tl } from '@/i18n/tl'
import { modelChoiceKey, modelValue, splitModelValue, storedModelChoice } from '@/lib/modelChoice'

/*
 * Model menu of one platform section. The list is the one the admin enabled for that section
 * (Admin → Modelli); the empty value means "the section default", which the server resolves.
 */

export type ScopedModel = { provider: string; model: string; name: string; description?: string }
type ScopedModels = { models: ScopedModel[]; default_provider: string | null; default_model: string | null; default_name?: string }

const PROVIDER_LABEL: Record<string, string> = {
  openai: 'OpenAI', anthropic: 'Anthropic', deepseek: 'DeepSeek', openrouter: 'OpenRouter', gemini: 'Gemini', ollama: 'Ollama',
}

export { modelValue, splitModelValue, storedModelChoice }

export function useScopedModels(scope: ModelScope) {
  return useQuery<ScopedModels>({
    queryKey: ['scoped-models', scope],
    queryFn: async () => (await llmApi.getAvailableModels(scope)).data,
    staleTime: 60_000,
  })
}

/** The user's choice for a section, remembered per browser; dropped when the admin disables that model. */
export function useScopedModelChoice(scope: ModelScope) {
  const storageKey = modelChoiceKey(scope)
  const { data } = useScopedModels(scope)
  const [value, setValue] = useState(() => {
    try { return localStorage.getItem(storageKey) || '' } catch { return '' }
  })
  const update = (next: string) => {
    setValue(next)
    try { localStorage.setItem(storageKey, next) } catch { /* private mode: keep it for this page only */ }
  }
  useEffect(() => {
    if (data && value && !data.models.some((m) => modelValue(m.provider, m.model) === value)) update('')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, value])
  return { value, setValue: update, selection: splitModelValue(value), data }
}

export function ScopedModelSelect({ scope, value, onChange, className = '', label }: {
  scope: ModelScope
  value: string
  onChange: (value: string) => void
  className?: string
  label?: string
}) {
  const { data } = useScopedModels(scope)
  if (!data?.models.length) return null
  const options = [
    { value: '', label: tl("Predefinito"), description: data.default_name || data.default_model || undefined },
    ...data.models.map((m) => ({
      value: modelValue(m.provider, m.model),
      label: m.name,
      description: [PROVIDER_LABEL[m.provider] ?? m.provider, m.description].filter(Boolean).join(' · '),
      searchText: m.model,
    })),
  ]
  return <SearchableSelect value={value} options={options} onChange={onChange} label={label || tl("Modello AI")} className={className} />
}
