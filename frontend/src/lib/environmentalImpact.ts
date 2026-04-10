export interface TokenUsageJson {
  prompt_tokens?: number
  completion_tokens?: number
  total_tokens?: number
  image_count?: number
  estimated_tokens?: boolean
  environmental_impact?: EnvironmentalImpactMetrics
}

export interface EnvironmentalImpactMetrics {
  energy_wh: number
  co2_grams: number
  water_ml: number
  water_drops: number
  prompt_tokens?: number
  completion_tokens?: number
  total_tokens?: number
  image_count?: number
  request_equivalent?: number
  model_intensity?: number
}

export interface EnvironmentalFootprintResponse {
  totals: EnvironmentalImpactMetrics & {
    interaction_count: number
    estimated_entry_count: number
  }
  actor_type: 'teacher' | 'student'
}

const BASELINE_ENERGY_WH = 0.24
const BASELINE_CO2_GRAMS = 0.03
const BASELINE_WATER_ML = 0.26
const BASELINE_WATER_DROPS = 5
const INPUT_TOKEN_WEIGHT = 0.35
const OUTPUT_TOKEN_WEIGHT = 1.0
const BASELINE_WEIGHTED_TOKENS = 1600

const MODEL_INTENSITY_OVERRIDES: Record<string, number> = {
  'gpt-5-nano': 0.7,
  'gpt-5-mini': 1.0,
  'gpt-4o-mini': 0.9,
  'gpt-4o': 1.4,
  'claude-haiku-4-5-20251001': 1.05,
  'claude-3-haiku-20240307': 0.95,
  'claude-3-5-sonnet-20241022': 1.35,
  'gemini-2.0-flash-lite': 0.8,
  'gemini-2.0-flash': 0.9,
  'gemini-3.1-flash-lite-preview': 0.82,
  'mistral-nemo': 0.95,
  mistral: 1.0,
  'deepseek-chat': 0.9,
  'deepseek-reasoner': 1.3,
}

const PROVIDER_INTENSITY_FALLBACK: Record<string, number> = {
  openai: 1.0,
  anthropic: 1.15,
  gemini: 0.9,
  deepseek: 0.92,
  ollama: 0.98,
  flux: 1.6,
  system: 0,
  fallback: 1.0,
}

const IMAGE_REQUEST_EQUIVALENT: Record<string, number> = {
  'dall-e-3': 4.5,
  'gpt-image-1': 4.8,
  'flux-schnell': 2.6,
  'flux-dev': 3.0,
  sdxl: 2.9,
}

function modelIntensity(provider?: string, model?: string) {
  const normalizedModel = (model || '').trim()
  const normalizedProvider = (provider || '').trim().toLowerCase()

  if (MODEL_INTENSITY_OVERRIDES[normalizedModel] != null) {
    return MODEL_INTENSITY_OVERRIDES[normalizedModel]
  }

  const prefixHit = Object.entries(MODEL_INTENSITY_OVERRIDES).find(([key]) => normalizedModel.startsWith(key))
  if (prefixHit) return prefixHit[1]
  if (normalizedModel.startsWith('gpt-5')) return 1.05
  if (normalizedModel.startsWith('gpt-4')) return 1.35
  if (normalizedModel.startsWith('claude')) return 1.2
  if (normalizedModel.startsWith('gemini')) return 0.9

  return PROVIDER_INTENSITY_FALLBACK[normalizedProvider] ?? 1
}

export function estimateEnvironmentalImpact(
  tokenUsage?: TokenUsageJson | null,
  provider?: string | null,
  model?: string | null,
): EnvironmentalImpactMetrics | null {
  if (tokenUsage?.environmental_impact) {
    return tokenUsage.environmental_impact
  }

  const promptTokens = Math.max(0, Number(tokenUsage?.prompt_tokens || 0))
  const completionTokens = Math.max(0, Number(tokenUsage?.completion_tokens || 0))
  const imageCount = Math.max(0, Number(tokenUsage?.image_count || 0))
  const hasData = promptTokens > 0 || completionTokens > 0 || imageCount > 0 || provider || model
  if (!hasData) return null

  const weightedTokens = promptTokens * INPUT_TOKEN_WEIGHT + completionTokens * OUTPUT_TOKEN_WEIGHT
  const tokenRequestEquivalent = weightedTokens / BASELINE_WEIGHTED_TOKENS
  const imageEquivalent = imageCount > 0 ? (IMAGE_REQUEST_EQUIVALENT[(model || '').trim()] ?? 3.0) * imageCount : 0
  const requestEquivalent = Math.max(imageEquivalent, tokenRequestEquivalent, weightedTokens === 0 && imageCount === 0 ? 1 : 0)
  const intensity = modelIntensity(provider || undefined, model || undefined)
  const impactFactor = requestEquivalent * intensity
  const waterMl = BASELINE_WATER_ML * impactFactor

  return {
    energy_wh: Number((BASELINE_ENERGY_WH * impactFactor).toFixed(4)),
    co2_grams: Number((BASELINE_CO2_GRAMS * impactFactor).toFixed(4)),
    water_ml: Number(waterMl.toFixed(4)),
    water_drops: Math.max(0, Math.round((waterMl / BASELINE_WATER_ML) * BASELINE_WATER_DROPS)),
    prompt_tokens: promptTokens,
    completion_tokens: completionTokens,
    total_tokens: promptTokens + completionTokens,
    image_count: imageCount,
    request_equivalent: Number(requestEquivalent.toFixed(4)),
    model_intensity: Number(intensity.toFixed(4)),
  }
}
