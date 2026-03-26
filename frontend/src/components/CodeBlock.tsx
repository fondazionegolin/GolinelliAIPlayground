import { useState } from 'react'
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism'
import { Check, Copy } from 'lucide-react'
import type { Components } from 'react-markdown'

/** Inline code (backtick) — minimal styling, no syntax highlighting */
export function InlineCode({ children, darkMode }: { children: React.ReactNode; darkMode?: boolean }) {
  return (
    <code
      className={`px-1.5 py-0.5 rounded text-xs font-mono ${
        darkMode ? 'bg-white/15 text-emerald-300' : 'bg-slate-100 text-fuchsia-600'
      }`}
    >
      {children}
    </code>
  )
}

/** Fenced code block with syntax highlighting, language badge, and copy button */
export function CodeBlock({ className, children }: { className?: string; children?: React.ReactNode }) {
  const [copied, setCopied] = useState(false)
  const language = className?.replace('language-', '') || 'text'
  const code = String(children).replace(/\n$/, '')

  const handleCopy = () => {
    navigator.clipboard.writeText(code).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }

  return (
    <div className="my-3 rounded-xl overflow-hidden border border-white/10 shadow-lg">
      {/* Top bar */}
      <div className="flex items-center justify-between px-4 py-1.5 bg-[#1a1d23] border-b border-white/10">
        <span className="text-[11px] font-mono text-slate-400 tracking-wide">{language}</span>
        <button
          onClick={handleCopy}
          className="flex items-center gap-1 text-[11px] text-slate-400 hover:text-slate-200 transition-colors"
        >
          {copied ? (
            <>
              <Check className="h-3 w-3 text-emerald-400" />
              <span className="text-emerald-400">Copiato</span>
            </>
          ) : (
            <>
              <Copy className="h-3 w-3" />
              <span>Copia</span>
            </>
          )}
        </button>
      </div>
      {/* Code */}
      <SyntaxHighlighter
        language={language}
        style={oneDark}
        customStyle={{
          margin: 0,
          borderRadius: 0,
          fontSize: '0.78rem',
          lineHeight: '1.6',
          padding: '1rem',
          background: '#282c34',
        }}
        wrapLongLines={false}
        showLineNumbers={code.split('\n').length > 5}
        lineNumberStyle={{ color: '#4b5263', fontSize: '0.7rem', minWidth: '2.5em' }}
      >
        {code}
      </SyntaxHighlighter>
    </div>
  )
}

/**
 * Returns the `components` props for ReactMarkdown `code` and `pre` fields.
 * Usage: <ReactMarkdown components={markdownCodeComponents(darkMode)} ...>
 */
export function markdownCodeComponents(darkMode?: boolean): Partial<Components> {
  return {
    pre: ({ children }) => <>{children}</>,
    code: ({ className, children }) => {
      const isBlock = !!className
      return isBlock ? (
        <CodeBlock className={className}>{children}</CodeBlock>
      ) : (
        <InlineCode darkMode={darkMode}>{children}</InlineCode>
      )
    },
  }
}
