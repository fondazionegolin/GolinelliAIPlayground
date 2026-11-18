import { expect, it } from 'vitest'
import { extractModuleSpecifiers } from './jsImports'

it('does not infer packages from stopwords, comments or strings', () => {
  expect(extractModuleSpecifiers(`const words = ['by','from','not']; const text="import 'fake-package'"; // import 'another'\n`)).toEqual([])
})
it('reads static, dynamic imports and re-exports', () => {
  expect(extractModuleSpecifiers(`import { x } from 'real-package'; export * from './types'; import('dynamic-package'); require('required-package');`)).toEqual(['real-package', './types', 'dynamic-package', 'required-package'])
})
