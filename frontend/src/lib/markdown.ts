import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'
import { renderToStaticMarkup } from 'react-dom/server'

export function looksLikeMarkdown(text: string) {
  if (!text) return false
  if (/<[a-z][\s\S]*>/i.test(text)) return false
  return /(^|\n)\s{0,3}#|\n\s*[-*+]\s|\n\s*\d+\.\s|```|\*\*|__|~~|\$[^$]+\$|\$\$[\s\S]+\$\$|\\\(|\\\)|\\\[|\\\]/.test(text)
}

export function renderMarkdownToHtml(markdown: string) {
  return renderToStaticMarkup(
    <ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeKatex]}>
      {markdown}
    </ReactMarkdown>
  )
}
