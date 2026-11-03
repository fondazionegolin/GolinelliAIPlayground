import { describe, expect, it } from 'vitest'
import { clipboardFiles } from './clipboardFiles'

describe('pasted Excel attachments', () => {
  const file = { name: 'dati.xlsx', type: 'application/octet-stream' } as File
  const data = (files: File[], items: Partial<DataTransferItem>[]) => ({ files, items }) as unknown as DataTransfer
  const item = { kind: 'file', getAsFile: () => file }
  it('accepts browser FileList entries without duplicating items', () => {
    expect(clipboardFiles(data([file], [item]))).toEqual([file])
  })
  it('supports browsers that expose only file items', () => {
    expect(clipboardFiles(data([], [item, { kind: 'file', getAsFile: () => null }]))).toEqual([file])
  })
  it('leaves copied Excel cell text to the ordinary text paste handler', () => {
    expect(clipboardFiles(data([], [{ kind: 'string' }]))).toEqual([])
  })
})
