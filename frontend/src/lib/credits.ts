/**
 * La piattaforma parla solo in crediti. Il backend conserva internamente la spesa
 * in unità di importo (1 credito = 0,01 unità): questo modulo converte al confine.
 */
export const CREDITS_PER_UNIT = 100

/** Valore interno del backend → crediti. */
export const toCredits = (internal: number | null | undefined): number =>
  Math.round(Number(internal || 0) * CREDITS_PER_UNIT * 100) / 100

/** Crediti inseriti dall'utente → valore interno atteso dagli endpoint legacy. */
export const fromCredits = (credits: number | string | null | undefined): number =>
  Number(credits || 0) / CREDITS_PER_UNIT

/** Formatta già-in-crediti, es. "1.250" / "3,5". */
export function formatCreditAmount(credits: number | null | undefined, maxDecimals = 1): string {
  const value = Number(credits || 0)
  return value.toLocaleString('it-IT', { minimumFractionDigits: 0, maximumFractionDigits: maxDecimals })
}

/** Valore interno del backend → "123 crediti"-style stringa breve. */
export function formatInternalCredits(internal: number | null | undefined, maxDecimals = 1): string {
  return `${formatCreditAmount(toCredits(internal), maxDecimals)} cr.`
}

export function formatCredits(credits: number | null | undefined, maxDecimals = 1): string {
  return `${formatCreditAmount(credits, maxDecimals)} cr.`
}
