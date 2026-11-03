/** Browsers expose pasted files through files, items, or both. */
export function clipboardFiles(data: Pick<DataTransfer, 'files' | 'items'>): File[] {
  const files = Array.from(data.files || [])
  if (files.length) return files
  return Array.from(data.items || []).filter((item) => item.kind === 'file')
    .map((item) => item.getAsFile()).filter((file): file is File => file !== null)
}
