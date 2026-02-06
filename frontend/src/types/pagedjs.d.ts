declare module 'pagedjs' {
  export class Previewer {
    preview(html: string, styles?: string[], target?: HTMLElement): Promise<unknown>
  }
}
