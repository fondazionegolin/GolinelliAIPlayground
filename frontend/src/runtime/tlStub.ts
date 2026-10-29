/** Stand-in for `@/i18n/tl` inside the standalone ML runtime bundle (vite.ml-runtime.config.ts):
 * the iframe runtime has no app i18n, so shared modules keep their Italian source text. */
export function tl(source: string, ...args: unknown[]): string {
  return args.length ? source.replace(/\{(\d+)\}/g, (match, index) => (Number(index) < args.length ? String(args[Number(index)] ?? '') : match)) : source
}
