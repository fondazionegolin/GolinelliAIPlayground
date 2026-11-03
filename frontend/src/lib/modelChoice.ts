import type { ModelScope } from '@/lib/api'

/** Menu value of a model: "provider|model"; the empty value is the section default resolved by the server. */
export const modelValue = (provider: string, model: string) => `${provider}|${model}`

export function splitModelValue(value: string): { llm_provider?: string; llm_model?: string } {
  const at = value.indexOf('|')
  return at > 0 ? { llm_provider: value.slice(0, at), llm_model: value.slice(at + 1) } : {}
}

export const modelChoiceKey = (scope: ModelScope) => `model-choice:${scope}`

/** Choice saved by ``useScopedModelChoice``, for code that builds a request outside the component holding the menu. */
export function storedModelChoice(scope: ModelScope) {
  try { return splitModelValue(localStorage.getItem(modelChoiceKey(scope)) || '') } catch { return {} }
}
