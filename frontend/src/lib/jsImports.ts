import { tsxLanguage } from '@codemirror/lang-javascript'

type Node = ReturnType<typeof tsxLanguage.parser.parse>['topNode']

/** Parse module references as syntax, so string literals and comments never become dependencies. */
export function extractModuleSpecifiers(source: string): string[] {
  const result = new Set<string>()
  const value = (node: Node) => source.slice(node.from, node.to)
  const addString = (node: Node | null) => {
    if (node?.name === 'String') result.add(value(node).slice(1, -1))
  }
  tsxLanguage.parser.parse(source).iterate({
    enter(ref) {
      const node = ref.node
      if (node.name === 'ImportDeclaration' || node.name === 'ExportDeclaration' || node.name === 'DynamicImport') {
        for (let child = node.firstChild; child; child = child.nextSibling) addString(child)
      }
      if (node.name === 'CallExpression' && ['import', 'require'].includes(node.firstChild ? value(node.firstChild) : '')) {
        const args = node.getChild('ArgList')
        for (let child = args?.firstChild || null; child; child = child.nextSibling) addString(child)
      }
    },
  })
  return [...result]
}
