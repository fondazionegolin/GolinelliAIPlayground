import { isEnglishUi, tl } from '@/i18n/tl'

// The Dataflow Studio node catalogue is served by the backend with Italian labels. These helpers translate it at
// render time with the same `tl()` dictionary as the rest of the app (the Italian text is the key), so the UI follows
// the language chosen in the user settings. Ids, port names, option values and categories are logic keys: never touched.

type Labelled = { label?: string; optionLabels?: Record<string, string>; placeholder?: string }
type ParamLike = Labelled & { type?: string; name?: string; default?: unknown; variants?: Record<string, ParamLike> }
type PortLike = Labelled & { variants?: Record<string, Labelled> }
type FunctionLike = { label: string; description: string; sideEffects?: string }
type SpecLike = { label: string; description: string; inputs: PortLike[]; outputs: PortLike[]; params: ParamLike[]; functions?: FunctionLike[] }

const translate = (text: string | undefined) => (text ? tl(text) : text)
const translateMap = (map: Record<string, string>) => Object.fromEntries(Object.entries(map).map(([key, value]) => [key, tl(value)]))

// Text defaults are content for the new node (prompts, messages, sample names); the output-language default is the UI language.
function translateDefault<P extends ParamLike>(param: P): unknown {
  if (typeof param.default !== 'string' || !param.default) return param.default
  if (param.name === 'language') return 'English'
  return ['STRING', 'CODE'].includes(String(param.type)) ? tl(param.default) : param.default
}

// Only keys the item really has are rewritten: a variant without a label must not erase the base label on merge.
function localizeLabelled<L extends Labelled>(item: L): L {
  const next = { ...item }
  if (item.label) next.label = tl(item.label)
  if (item.optionLabels) next.optionLabels = translateMap(item.optionLabels)
  if (item.placeholder) next.placeholder = tl(item.placeholder)
  return next
}

function localizeParam<P extends ParamLike>(param: P): P {
  const variants = param.variants && Object.fromEntries(Object.entries(param.variants).map(([fn, variant]) =>
    [fn, { ...localizeLabelled(variant), ...(variant.default !== undefined ? { default: translateDefault({ ...param, ...variant }) } : {}) }]))
  return { ...localizeLabelled(param), ...(param.default !== undefined ? { default: translateDefault(param) } : {}), ...(variants ? { variants } : {}) }
}

function localizePort<P extends PortLike>(port: P): P {
  const variants = port.variants && Object.fromEntries(Object.entries(port.variants).map(([fn, variant]) => [fn, localizeLabelled(variant)]))
  return { ...localizeLabelled(port), ...(variants ? { variants } : {}) }
}

export function localizeSpec<S extends SpecLike>(spec: S): S {
  if (!isEnglishUi()) return spec
  return {
    ...spec,
    label: tl(spec.label),
    description: tl(spec.description),
    inputs: spec.inputs.map(localizePort),
    outputs: spec.outputs.map(localizePort),
    params: spec.params.map(localizeParam),
    ...(spec.functions ? { functions: spec.functions.map((fn) => ({ ...fn, label: tl(fn.label), description: tl(fn.description), sideEffects: translate(fn.sideEffects) })) } : {}),
  }
}
