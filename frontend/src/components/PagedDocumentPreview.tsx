import { useEffect, useRef } from 'react'
import { Previewer } from 'pagedjs'

interface DocumentHeader {
  title: string
  subtitle: string
  logoUrl: string
}

interface PagedDocumentPreviewProps {
  contentHtml: string
  header?: DocumentHeader
  margins: { vertical: number; horizontal: number }
  pageGap?: number
}

export function PagedDocumentPreview({
  contentHtml,
  header,
  margins,
  pageGap = 28
}: PagedDocumentPreviewProps) {
  const targetRef = useRef<HTMLDivElement>(null)
  const sourceRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!targetRef.current || !sourceRef.current) return
    let cancelled = false
    const timer = setTimeout(async () => {
      if (!targetRef.current || !sourceRef.current || cancelled) return
      targetRef.current.innerHTML = ''
      const previewer = new Previewer()
      const html = `
        <style>
          @page { size: A4; margin: 0; }
          .doc-root {
            box-sizing: border-box;
            padding: ${margins.vertical}px ${margins.horizontal}px;
            font-family: "Merriweather", "Times New Roman", serif;
            color: #0f172a;
          }
          .doc-header {
            display: flex;
            align-items: center;
            gap: 24px;
            padding-bottom: 16px;
            border-bottom: 1px solid #e2e8f0;
            margin-bottom: 16px;
          }
          .doc-logo {
            width: 80px;
            height: 80px;
            object-fit: contain;
            background: #f8fafc;
            border-radius: 12px;
            border: 1px dashed #cbd5f5;
          }
          .doc-title {
            font-size: 32px;
            font-weight: 700;
            margin: 0;
          }
          .doc-subtitle {
            font-size: 16px;
            color: #64748b;
            margin: 4px 0 0 0;
          }
          .doc-content {
            font-size: 16px;
            line-height: 1.6;
          }
          .doc-content h1 { font-size: 28px; margin: 24px 0 12px; }
          .doc-content h2 { font-size: 22px; margin: 20px 0 10px; }
          .doc-content h3 { font-size: 18px; margin: 16px 0 8px; }
          .doc-content p { margin: 0 0 12px; }
          .pagedjs_pages {
            display: flex;
            flex-direction: column;
            gap: ${pageGap}px;
          }
          .pagedjs_page {
            background: #ffffff;
            box-shadow: 0 10px 30px rgba(15, 23, 42, 0.12);
          }
        </style>
        <div class="doc-root">
          ${header ? `
            <div class="doc-header">
              ${header.logoUrl ? `<img class="doc-logo" src="${header.logoUrl}" alt="Logo" />` : ''}
              <div>
                <h1 class="doc-title">${header.title || ''}</h1>
                <p class="doc-subtitle">${header.subtitle || ''}</p>
              </div>
            </div>
          ` : ''}
          <div class="doc-content">${contentHtml || ''}</div>
        </div>
      `
      await previewer.preview(html, [], targetRef.current)
    }, 120)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [contentHtml, header?.title, header?.subtitle, header?.logoUrl, margins.horizontal, margins.vertical, pageGap])

  return (
    <div className="relative w-full">
      <div ref={sourceRef} className="hidden" />
      <div ref={targetRef} />
    </div>
  )
}
