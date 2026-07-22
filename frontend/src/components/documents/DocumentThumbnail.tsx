import { useEffect, useMemo, useRef, useState } from 'react'
import { FileText, PenTool } from 'lucide-react'
import type { SlideBlock } from '@/components/SlideEditor'

type ThumbnailType = 'presentation' | 'document' | 'sheet' | 'canvas' | 'pdf' | 'web'

interface DocumentThumbnailProps {
  contentJson: string
  type: ThumbnailType
  title: string
  className?: string
}

type ParsedContent = {
  format?: 'a4' | '16:9' | '4:3'
  slides?: Array<{ title?: string; blocks?: SlideBlock[]; backgroundColor?: string }>
  htmlContent?: string
  content?: string
  data?: string[][]
  url?: string
}

const DIMENSIONS = {
  '16:9': { width: 960, height: 540 },
  '4:3': { width: 800, height: 600 },
  a4: { width: 794, height: 1123 },
}

function SlidePreview({ content, title }: { content: ParsedContent; title: string }) {
  const hostRef = useRef<HTMLDivElement>(null)
  const [hostSize, setHostSize] = useState({ width: 0, height: 0 })
  const format = content.format && DIMENSIONS[content.format] ? content.format : '16:9'
  const dimensions = DIMENSIONS[format]
  const slide = content.slides?.[0]
  const scale = Math.min(hostSize.width / dimensions.width, hostSize.height / dimensions.height)

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    const update = () => setHostSize({ width: host.clientWidth, height: host.clientHeight })
    update()
    const observer = new ResizeObserver(update)
    observer.observe(host)
    return () => observer.disconnect()
  }, [])

  const blocks = useMemo(() => (slide?.blocks || [])
    .map((block, index) => ({ block, index }))
    .sort((a, b) => (a.block.zIndex ?? a.index) - (b.block.zIndex ?? b.index)), [slide?.blocks])

  return (
    <div ref={hostRef} className="relative h-full w-full overflow-hidden bg-slate-100">
      {hostSize.width > 0 && hostSize.height > 0 && (
        <div
          className="absolute left-0 top-0 origin-top-left overflow-hidden shadow-inner"
          style={{
            width: dimensions.width,
            height: dimensions.height,
            left: (hostSize.width - dimensions.width * scale) / 2,
            top: (hostSize.height - dimensions.height * scale) / 2,
            transform: `scale(${scale})`,
            backgroundColor: slide?.backgroundColor || '#fff',
          }}
        >
          {slide && !slide.blocks?.some(block => block.type === 'text' && block.y < 130 && (block.style.fontSize || 0) >= 26) && (
            <h3 className="pointer-events-none absolute inset-x-8 top-8 z-10 text-4xl font-bold text-slate-900">{slide.title || title}</h3>
          )}
          {!slide && (
            <div className="flex h-full items-center justify-center px-16 text-center text-4xl font-bold text-slate-300">
              {title}
            </div>
          )}
          {blocks.map(({ block, index }) => (
            <div
              key={block.id || index}
              className="absolute overflow-hidden"
              style={{
                left: block.x,
                top: block.y,
                width: block.width,
                height: block.height,
                zIndex: block.zIndex ?? index,
                transform: block.rotation ? `rotate(${block.rotation}deg)` : undefined,
                transformOrigin: 'center center',
                ...(block.type === 'text' || block.type === 'image'
                  ? {
                      backgroundColor: block.style.backgroundColor || 'transparent',
                      borderRadius: block.style.borderRadius,
                      padding: block.style.padding,
                    }
                  : block.type === 'rectangle' || block.type === 'ellipse'
                    ? {
                        backgroundColor: block.style.fill || 'transparent',
                        border: `${block.style.strokeWidth ?? 1}px solid ${block.style.stroke || '#1e293b'}`,
                        borderRadius: block.type === 'ellipse' ? '50%' : (block.style.cornerRadius ?? 0),
                      }
                    : {}),
              }}
            >
              {block.type === 'text' ? (
                <div
                  className="h-full w-full whitespace-pre-wrap"
                  style={{
                    fontFamily: block.style.fontFamily,
                    fontSize: block.style.fontSize,
                    color: block.style.color,
                    fontWeight: block.style.fontWeight,
                    fontStyle: block.style.fontStyle,
                    textDecoration: block.style.textDecoration,
                    textAlign: block.style.textAlign,
                    lineHeight: block.style.lineHeight,
                  }}
                >
                  {block.content}
                </div>
              ) : block.type === 'image' ? (
                <img src={block.content} alt="" className="h-full w-full object-cover" />
              ) : block.type === 'line' ? (
                <svg className="h-full w-full overflow-visible">
                  <line x1={0} y1={0} x2={block.width} y2={block.height} stroke={block.style.stroke || '#1e293b'} strokeWidth={block.style.strokeWidth ?? 2} />
                </svg>
              ) : null}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function DocumentPagePreview({ html }: { html: string }) {
  const hostRef = useRef<HTMLDivElement>(null)
  const [hostWidth, setHostWidth] = useState(0)
  const scale = hostWidth / DIMENSIONS.a4.width

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    const update = () => setHostWidth(host.clientWidth)
    update()
    const observer = new ResizeObserver(update)
    observer.observe(host)
    return () => observer.disconnect()
  }, [])

  return (
    <div ref={hostRef} className="relative h-full w-full overflow-hidden bg-slate-100">
      {hostWidth > 0 && (
        <article
          className="absolute left-0 top-0 origin-top-left overflow-hidden bg-white px-16 py-14 text-[16px] leading-7 text-slate-800 [&_h1]:mb-5 [&_h1]:text-4xl [&_h1]:font-bold [&_h2]:mb-4 [&_h2]:text-3xl [&_h2]:font-bold [&_h3]:mb-3 [&_h3]:text-2xl [&_h3]:font-semibold [&_img]:h-auto [&_img]:max-w-full [&_li]:my-1 [&_ol]:my-4 [&_ol]:pl-6 [&_p]:mb-4 [&_table]:w-full [&_ul]:my-4 [&_ul]:pl-6"
          style={{ width: DIMENSIONS.a4.width, height: DIMENSIONS.a4.height, transform: `scale(${scale})` }}
          dangerouslySetInnerHTML={{ __html: html }}
        />
      )}
    </div>
  )
}

function SheetPreview({ data }: { data: string[][] }) {
  const rows = data.slice(0, 8)
  const columns = Math.max(4, ...rows.map(row => row.length))
  return (
    <div className="h-full w-full overflow-hidden bg-white p-3">
      <div className="grid border-l border-t border-slate-200 text-[8px] text-slate-600" style={{ gridTemplateColumns: `repeat(${Math.min(columns, 7)}, minmax(0, 1fr))` }}>
        {Array.from({ length: Math.min(columns, 7) * Math.max(rows.length, 6) }, (_, index) => {
          const row = Math.floor(index / Math.min(columns, 7))
          const column = index % Math.min(columns, 7)
          return <div key={index} className="h-5 truncate border-b border-r border-slate-200 px-1 py-0.5">{rows[row]?.[column] || ''}</div>
        })}
      </div>
    </div>
  )
}

export default function DocumentThumbnail({ contentJson, type, title, className = '' }: DocumentThumbnailProps) {
  const content = useMemo<ParsedContent>(() => {
    try { return JSON.parse(contentJson || '{}') }
    catch { return {} }
  }, [contentJson])

  const html = content.htmlContent || content.content || ''
  const isFullHtml = /^\s*(?:<!doctype\s+html|<html)/i.test(html)
  const actualType: ThumbnailType = Array.isArray(content.slides)
    ? 'presentation'
    : Array.isArray(content.data)
      ? 'sheet'
      : isFullHtml
        ? 'web'
      : type

  return (
    <div className={`pointer-events-none relative aspect-[16/10] overflow-hidden rounded-xl border border-slate-200 bg-white shadow-inner ${className}`} aria-label={`Anteprima di ${title}`}>
      {actualType === 'presentation' ? <SlidePreview content={content} title={title} />
        : actualType === 'document' && html ? <DocumentPagePreview html={html} />
        : actualType === 'sheet' ? <SheetPreview data={content.data || []} />
        : actualType === 'pdf' && content.url ? <iframe src={`${content.url}#page=1&toolbar=0&navpanes=0`} title={title} className="h-full w-full border-0 bg-white" />
        : actualType === 'web' && (content.url || html) ? <iframe src={content.url} srcDoc={content.url ? undefined : html} sandbox="" title={title} className="h-full w-full border-0 bg-white" />
        : (
          <div className="flex h-full flex-col items-center justify-center gap-2 bg-slate-50 text-slate-300">
            {actualType === 'canvas' ? <PenTool className="h-9 w-9" /> : <FileText className="h-9 w-9" />}
            <span className="max-w-[80%] truncate text-xs font-semibold">{title}</span>
          </div>
        )}
      <span className="absolute inset-0 ring-1 ring-inset ring-black/5" />
    </div>
  )
}
