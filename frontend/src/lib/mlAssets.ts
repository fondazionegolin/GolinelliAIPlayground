/** Where the self-hosted ML models and wasm live. Empty in the app; the platform origin inside the Vibe Lab preview iframe. */
let base = ''
export function setAssetBase(url: string) { base = url.replace(/\/+$/, '') }
export function assetUrl(path: string): string { return `${base}${path}` }
