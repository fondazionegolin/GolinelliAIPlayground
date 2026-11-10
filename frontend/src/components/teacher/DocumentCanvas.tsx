import { buildBrochureHtml, buildBrochureHtmlFromPayload } from './brochureTemplate'
import { useState, useCallback, useMemo, useRef } from 'react'
import { X, Layout, FileText, GripVertical, Share2, Check, Download, Loader2, BarChart2 } from '@/components/icons'
import { Button } from '@/components/ui/button'
import { useToast } from '@/components/ui/use-toast'
import { InteractiveHtmlFrame } from '@/components/documents/InteractiveHtmlFrame'
import { chatApi, filesApi } from '@/lib/api'
import type { ResearchAgent, ResearchRound } from '@/components/teacher/ResearchPanel'
import { buildReportHtml, parseBrochurePayload, parseDispensaPayload, parseReportPayload } from '@/components/teacher/reportTemplates'
import { tl } from '@/i18n/tl'

// Toolbar pills — homogeneous with the main navbar (shared --selection-* tokens).
const TOOLBAR_PILL = 'ui-control-label inline-flex items-center gap-1 h-7 rounded-[var(--selection-radius)] border px-2.5 transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--selection-border-hover)] disabled:opacity-50'
const TOOLBAR_PILL_INACTIVE = 'border-transparent text-slate-600 hover:border-[color:var(--selection-border)] hover:bg-[image:var(--selection-bg)] hover:text-[var(--selection-text)]'
const TOOLBAR_PILL_ACTIVE = 'bg-[image:var(--selection-active-bg)] text-[var(--selection-active-text)] border-[color:var(--selection-border-hover)] shadow-[var(--selection-shadow)]'

export interface GeneratedDoc {
  type: 'brochure' | 'dispensa' | 'report' | 'html_page' | 'research'
  content: string
  version: number
  title: string
  /** Deep research only: sources numbered as cited in the markdown, and the trace of the sub-agents' run. */
  sources?: { n: number; url: string; title: string }[]
  run?: { agents: ResearchAgent[]; rounds: ResearchRound[] }
}

export interface SessionOption {
  id: string
  title: string
  class_name: string
}

interface DocumentCanvasProps {
  doc: GeneratedDoc
  onClose: () => void
  onRequestEdit?: (instruction: string) => void
  sessions?: SessionOption[]
  authorName?: string
}

// ─── Dispensa template ──────────────────────────────────────────────────────

const DISPENSA_CSS = `
*{box-sizing:border-box;margin:0;padding:0}
html{scroll-behavior:smooth}
body{font-family:'Inter',sans-serif;background:#f7f5f8;color:#1a1a2e;line-height:1.78;font-size:15px}

#progress-bar{position:fixed;top:0;left:0;height:3px;width:0%;background:linear-gradient(90deg,#fe004d,#f29db8);z-index:9999;transition:width .1s linear}

.layout{display:flex;min-height:100vh}

.sidebar{width:240px;flex-shrink:0;background:linear-gradient(180deg,#1a1a2e 0%,#232340 100%);position:sticky;top:0;height:100vh;overflow-y:auto;padding:22px 0 40px;z-index:100}
.sidebar-logo{padding:0 18px 18px;border-bottom:1px solid rgba(255,255,255,.1);margin-bottom:16px}
.sidebar-logo .badge{background:#fe004d;color:#fff;font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:1.5px;padding:4px 10px;border-radius:20px;display:inline-block;margin-bottom:8px;box-shadow:0 10px 24px rgba(232,92,141,.25)}
.sidebar-logo h2{color:#fff;font-size:12px;font-weight:600;line-height:1.4;opacity:.9}
.sidebar-section{padding:10px 18px 4px;color:rgba(255,255,255,.3);font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:1.5px}
.sidebar nav a{display:flex;align-items:center;gap:8px;padding:8px 18px;color:rgba(255,255,255,.64);text-decoration:none;font-size:12px;font-weight:500;border-left:3px solid transparent;transition:all .2s}
.sidebar nav a:hover,.sidebar nav a.active{color:#fff;background:rgba(255,255,255,.08);border-left-color:#fe004d}
.sidebar nav a .sn{background:rgba(255,255,255,.12);color:#f3a2be;font-size:9px;font-weight:700;width:20px;height:20px;border-radius:50%;display:flex;align-items:center;justify-content:center;flex-shrink:0;font-family:'JetBrains Mono',monospace}

.main{flex:1;min-width:0;padding-bottom:80px}

.hero{background:
linear-gradient(135deg,#1a1a2e 0%,#2a2346 52%,#fe004d 180%);
padding:64px 56px 54px;position:relative;overflow:hidden}
.hero::before{content:'';position:absolute;top:-40px;right:-40px;width:350px;height:350px;background:radial-gradient(circle,rgba(232,92,141,.2) 0%,transparent 70%);pointer-events:none}
.hero::after{content:'';position:absolute;left:8%;bottom:-120px;width:420px;height:220px;background:radial-gradient(circle,rgba(255,255,255,.12) 0%,transparent 72%);pointer-events:none}
.hero-badge{display:inline-flex;align-items:center;gap:6px;background:rgba(255,255,255,.12);border:1px solid rgba(255,255,255,.2);color:#ffd2e1;padding:5px 14px;border-radius:30px;font-size:11px;font-weight:600;letter-spacing:.8px;text-transform:uppercase;margin-bottom:22px}
.hero h1{font-size:2.9em;font-weight:800;color:#fff;line-height:1.12;margin-bottom:14px;max-width:720px}
.hero h1 span{color:#ffb9d0}
.hero-sub{font-size:1.1em;color:rgba(255,255,255,.7);margin-bottom:28px;max-width:560px;font-weight:300;line-height:1.6}
.hero-meta{display:flex;gap:20px;flex-wrap:wrap}
.hero-meta-item{display:flex;flex-direction:column;gap:2px}
.hero-meta-item .label{font-size:9px;text-transform:uppercase;letter-spacing:1.2px;color:rgba(255,255,255,.35);font-weight:600}
.hero-meta-item .value{font-size:12px;color:rgba(255,255,255,.82);font-weight:500}

.content{padding:44px 56px;max-width:960px}

.abstract-box{background:#fff;border:1px solid #efdbe4;border-radius:18px;padding:30px 34px;margin-bottom:40px;box-shadow:0 12px 34px rgba(26,26,46,.06)}
.abstract-box h3{font-size:10px;text-transform:uppercase;letter-spacing:2px;color:#a94f66;font-weight:700;margin-bottom:14px}
.abstract-box p{color:#5c5968;font-size:14px;line-height:1.8;margin-bottom:16px}
.abstract-box ol{padding-left:18px}
.abstract-box ol li{color:#1a1a2e;font-size:13.5px;margin-bottom:5px;font-weight:500}

.section-header{display:flex;align-items:center;gap:14px;margin-bottom:28px;padding-bottom:18px;border-bottom:2px solid #f1d9e4}
.section-num{font-family:'JetBrains Mono',monospace;font-size:12px;font-weight:700;color:#fff;background:#fe004d;padding:6px 12px;border-radius:999px;letter-spacing:1px;box-shadow:0 10px 24px rgba(232,92,141,.18)}
.section-header h2{font-size:1.82em;font-weight:750;color:#1a1a2e;line-height:1.2}

section{margin-bottom:56px;scroll-margin-top:20px}
.content p{margin-bottom:16px;color:#3f4657;line-height:1.9}
.content h3{font-size:1.08em;font-weight:700;color:#1a1a2e;margin:24px 0 10px;padding-left:10px;border-left:3px solid #fe004d}
.content ul,.content ol{padding-left:22px;margin-bottom:16px}
.content ul li,.content ol li{margin-bottom:7px;line-height:1.7;color:#3f4657}
.content ul li strong,.content ol li strong{color:#1a1a2e}

.definition-box,.theorem-box,.example-box,.warning-box,.exercise-box,.note-box{border-radius:8px;padding:18px 20px;margin:20px 0}
.box-label{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:1.5px;margin-bottom:8px;display:flex;align-items:center;gap:5px}
.box-title{font-size:14px;font-weight:700;margin-bottom:8px;color:#1a1a2e}
.definition-box{background:#eef6ff;border-left:4px solid #4c8eda}
.definition-box .box-label{color:#326baf}
.theorem-box{background:#f7efff;border-left:4px solid #9b68d4}
.theorem-box .box-label{color:#7f46bc}
.example-box{background:#edf9f3;border-left:4px solid #30a36b}
.example-box .box-label{color:#22804f}
.warning-box{background:#fff5fa;border-left:4px solid #fe004d}
.warning-box .box-label{color:#b73e68}
.exercise-box{background:#fff4ec;border-left:4px solid #f19b61}
.exercise-box .box-label{color:#b06227}
.note-box{background:#f3f1fb;border-left:4px solid #6d6ad9}
.note-box .box-label{color:#5450b6}
.exercise-box details{margin-top:12px}
.exercise-box details summary{cursor:pointer;font-weight:600;color:#d94f1e;font-size:13px;padding:7px 0;user-select:none}
.solution-content{background:rgba(255,255,255,.7);border-radius:6px;padding:12px 14px;margin-top:6px}

.summary-card{background:linear-gradient(135deg,#1a1a2e,#34345b);border-radius:16px;padding:22px 26px;margin:24px 0;color:#fff;box-shadow:0 16px 30px rgba(26,26,46,.18)}
.summary-title{font-size:11px;text-transform:uppercase;letter-spacing:1.5px;font-weight:700;color:#ffb9d0;margin-bottom:14px}
.summary-card ul{padding-left:0;list-style:none}
.summary-card ul li{padding:5px 0 5px 18px;position:relative;color:rgba(255,255,255,.88);font-size:13.5px;border-bottom:1px solid rgba(255,255,255,.07)}
.summary-card ul li:last-child{border-bottom:none}
.summary-card ul li::before{content:'▸';position:absolute;left:0;color:#ffb9d0;font-size:12px}

.data-table{width:100%;border-collapse:collapse;margin:20px 0;font-size:13.5px;border-radius:14px;overflow:hidden;box-shadow:0 8px 24px rgba(26,26,46,.07)}
.data-table thead{background:#1a1a2e;color:#fff}
.data-table th{padding:11px 14px;text-align:left;font-weight:600;font-size:12px;letter-spacing:.5px}
.data-table td{padding:10px 14px;border-bottom:1px solid #f4e7ee;color:#3f4657}
.data-table tbody tr:nth-child(even){background:#fff8fb}
.data-table tbody tr:hover{background:#fdebf2}

.formula-block{background:#1a1a2e;border-radius:14px;padding:18px 24px;margin:20px 0;text-align:center;overflow-x:auto}
.formula-block .MJX-TEX{color:#fff!important}

.ref-list{list-style:none;padding:0}
.ref-list li{padding:10px 0;border-bottom:1px solid #f1d9e4;color:#3f4657;font-size:14px;line-height:1.6}
.ref-list li:last-child{border-bottom:none}
.ref-list li strong{color:#1a1a2e}
`

const DISPENSA_JS = `
(function(){
  var bar=document.getElementById('progress-bar');
  function upd(){if(!bar)return;var h=document.documentElement;var pct=(h.scrollTop||document.body.scrollTop)/(h.scrollHeight-h.clientHeight)*100;bar.style.width=pct+'%'}
  window.addEventListener('scroll',upd,{passive:true});
  var links=document.querySelectorAll('.sidebar nav a');
  var secs=document.querySelectorAll('section[id]');
  function hi(){var sy=window.scrollY+80;secs.forEach(function(s){if(s.offsetTop<=sy&&s.offsetTop+s.offsetHeight>sy){links.forEach(function(l){l.classList.toggle('active',l.getAttribute('href')==='#'+s.id)})}});}
  window.addEventListener('scroll',hi,{passive:true});
})();
`

function buildDispensaHtml(sections: string, docTitle: string, authorName?: string): string {
  // Extract TITLE/SUBTITLE comment from sections
  const titleMatch = sections.match(/<!--\s*TITLE:\s*([^|]+?)\s*\|\s*SUBTITLE:\s*([^-]+?)\s*-->/)
  const title = titleMatch ? titleMatch[1].trim() : docTitle
  const subtitle = titleMatch ? titleMatch[2].trim() : tl("Dispensa generata con Claude AI")
  // Strip that comment from content
  const cleanSections = sections.replace(/<!--\s*TITLE:[^>]*?-->/i, '').trim()

  // Build nav from section headers
  const sectionMatches = [...cleanSections.matchAll(/<section[^>]+id="([^"]+)"[\s\S]*?<h2[^>]*>([\s\S]*?)<\/h2>/gi)]
  const navItems = sectionMatches.map(([, id, h2raw]) => {
    const num = id.replace(/\D/g, '').padStart(2, '0')
    const label = h2raw.replace(/<[^>]+>/g, '').trim()
    return `<a href="#${id}"><span class="sn">${num}</span>${label}</a>`
  }).join('\n')

  return `<!DOCTYPE html>
<html lang="it">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>${title}</title>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&family=JetBrains+Mono:wght@400;600&display=swap" rel="stylesheet">
<script>window.MathJax={tex:{inlineMath:[['\\\\(','\\\\)']],displayMath:[['\\\\[','\\\\]']]},startup:{typeset:true}};</script>
<script async src="https://cdn.jsdelivr.net/npm/mathjax@3/es5/tex-mml-chtml.js"></script>
<style>${DISPENSA_CSS}</style>
</head>
<body>
<div id="progress-bar"></div>
<div class="layout">
  <aside class="sidebar">
    <div class="sidebar-logo">
      <div class="badge">Dispensa AI</div>
      <h2>${title}</h2>
    </div>
    <div class="sidebar-section">Indice</div>
    <nav>${navItems}</nav>
  </aside>
  <div class="main">
    <div class="hero">
      <div class="hero-badge">📄 Dispensa Universitaria</div>
      <h1><span>${title}</span></h1>
      <p class="hero-sub">${subtitle}</p>
      <div class="hero-meta">
        <div class="hero-meta-item"><span class="label">Autore</span><span class="value">${authorName || 'Docente'} · AI collaborator</span></div>
        <div class="hero-meta-item"><span class="label">Anno</span><span class="value">2026</span></div>
        <div class="hero-meta-item"><span class="label">Formato</span><span class="value">HTML + MathJax</span></div>
      </div>
    </div>
    <div class="content">
      ${cleanSections}
    </div>
  </div>
</div>
<script>${DISPENSA_JS}</script>
</body>
</html>`
}

function buildDispensaHtmlFromPayload(raw: string, docTitle: string, authorName?: string): string | null {
  const payload = parseDispensaPayload(raw)
  if (!payload) return null

  const objectivesHtml = payload.objectives && payload.objectives.length > 0
    ? `
      <div class="abstract-box">
        <h3>Obiettivi</h3>
        <ol>${payload.objectives.map((objective) => `<li>${objective}</li>`).join('')}</ol>
      </div>
    `
    : ''

  const blockMeta = {
    definition: { className: 'definition-box', label: tl("📘 Definizione") },
    theorem: { className: 'theorem-box', label: tl("📐 Teorema") },
    example: { className: 'example-box', label: tl("💡 Esempio") },
    warning: { className: 'warning-box', label: tl("⚠️ Attenzione") },
    note: { className: 'note-box', label: tl("📝 Nota") },
  } as const

  const sections = payload.sections.map((section, index) => `
    <section id="${section.id || `s${index + 1}`}">
      <div class="section-header">
        <span class="section-num">${String(index + 1).padStart(2, '0')}</span>
        <h2>${section.title}</h2>
      </div>
      <p>${section.intro}</p>
      ${(section.blocks || []).map((block) => {
        const meta = blockMeta[block.kind]
        return `
          <div class="${meta.className}">
            <div class="box-label">${meta.label}</div>
            <div class="box-title">${block.title}</div>
            <p>${block.content}</p>
          </div>
        `
      }).join('')}
      ${section.table ? `
        <table class="data-table">
          <thead><tr>${section.table.columns.map((column) => `<th>${column}</th>`).join('')}</tr></thead>
          <tbody>${section.table.rows.map((row) => `<tr>${row.map((cell) => `<td>${cell}</td>`).join('')}</tr>`).join('')}</tbody>
        </table>
      ` : ''}
      ${(section.bulletPoints || []).length > 0 ? `<ul>${section.bulletPoints!.map((point) => `<li>${point}</li>`).join('')}</ul>` : ''}
      ${(section.summaryPoints || []).length > 0 ? `
        <div class="summary-card">
          <div class="summary-title">🎯 Punti chiave</div>
          <ul>${section.summaryPoints!.map((point) => `<li>${point}</li>`).join('')}</ul>
        </div>
      ` : ''}
    </section>
  `).join('')

  const exercisesSection = payload.exercises && payload.exercises.length > 0
    ? `
      <section id="s9">
        <div class="section-header">
          <span class="section-num">09</span>
          <h2>Esercizi</h2>
        </div>
        ${payload.exercises.map((exercise) => `
          <div class="exercise-box">
            <div class="box-label">✏️ Esercizio</div>
            <div class="box-title">${exercise.title}</div>
            <p>${exercise.prompt}</p>
            ${exercise.solution ? `<details><summary>💡 Soluzione</summary><div class="solution-content">${exercise.solution}</div></details>` : ''}
          </div>
        `).join('')}
      </section>
    `
    : ''

  const referencesSection = payload.references && payload.references.length > 0
    ? `
      <section id="s10">
        <div class="section-header">
          <span class="section-num">10</span>
          <h2>Riferimenti</h2>
        </div>
        <ul class="ref-list">${payload.references.map((reference) => `<li>${reference}</li>`).join('')}</ul>
      </section>
    `
    : ''

  const allSections = `
    <div class="abstract-box">
      <h3>Abstract</h3>
      <p>${payload.abstract}</p>
    </div>
    ${objectivesHtml}
    ${sections}
    ${exercisesSection}
    ${referencesSection}
  `

  return buildDispensaHtml(`<!-- TITLE: ${payload.title} | SUBTITLE: ${payload.subtitle} -->${allSections}`, docTitle, authorName)
}

// ─── Brochure template ────────────────────────────────────────────────────────

// ─── Extract sections from content (strip code fences) ────────────────────────

function extractSections(raw: string): string {
  const s = raw.trim()
  const openMatch = s.match(/^```(?:html?)?\s*\n?/im)
  if (openMatch && openMatch.index !== undefined) {
    const innerStart = openMatch.index + openMatch[0].length
    const closingIdx = s.lastIndexOf('\n```')
    if (closingIdx > innerStart) {
      return s.substring(innerStart, closingIdx).trim()
    }
  }
  return s
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function DocumentCanvas({ doc, onClose, sessions = [], authorName }: DocumentCanvasProps) {
  const { toast } = useToast()
  const previewRef = useRef<HTMLIFrameElement>(null)
  const [exportingPdf, setExportingPdf] = useState(false)
  const [showSource, setShowSource] = useState(false)
  const [showShareMenu, setShowShareMenu] = useState(false)
  const [sharingSessionId, setSharingSessionId] = useState<string | null>(null)
  const [sharedSessionIds, setSharedSessionIds] = useState<Set<string>>(new Set())

  // Build final renderable HTML
  const renderedHtml = useMemo(() => {
    const trimmed = doc.content.trim()
    if (/^(?:<!doctype\s+html|<html)/i.test(trimmed)) return trimmed
    if (doc.type === 'html_page') return extractSections(doc.content)
    if (doc.type === 'brochure') {
      return buildBrochureHtmlFromPayload(doc.content, doc.title || 'Brochure')
        || buildBrochureHtml(extractSections(doc.content), doc.title || 'Brochure')
    }
    if (doc.type === 'report') {
      return buildReportHtml(doc.content, doc.title || 'Report')
    } else {
      return buildDispensaHtmlFromPayload(doc.content, doc.title || tl("Dispensa"), authorName)
        || buildDispensaHtml(extractSections(doc.content), doc.title || tl("Dispensa"), authorName)
    }
  }, [authorName, doc])

  // Raw content for source view (sections only)
  const sourceContent = useMemo(() => {
    if (doc.type === 'report') {
      const parsed = parseReportPayload(doc.content)
      return parsed ? JSON.stringify(parsed, null, 2) : doc.content
    }
    if (doc.type === 'brochure') {
      const parsed = parseBrochurePayload(doc.content)
      return parsed ? JSON.stringify(parsed, null, 2) : extractSections(doc.content)
    }
    const parsed = parseDispensaPayload(doc.content)
    return parsed ? JSON.stringify(parsed, null, 2) : extractSections(doc.content)
  }, [doc])

  const downloadPdf = async () => {
    if (exportingPdf) return
    setExportingPdf(true)
    try {
      const response = await filesApi.exportDocument({
        title: doc.title || 'Brochure', target_format: 'pdf',
        content_json: JSON.stringify({ type: 'html_v1', htmlContent: renderedHtml,
          viewport: { width: previewRef.current?.clientWidth || 880, height: previewRef.current?.clientHeight || 900 },
        }),
      })
      const url = URL.createObjectURL(response.data)
      const link = document.createElement('a')
      link.href = url; link.download = `${(doc.title || 'Brochure').replace(/[\\/:*?"<>|]/g, '_')}.pdf`
      link.click()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
    } catch {
      toast({ title: tl("Esportazione PDF non riuscita"), description: tl("Riprova tra poco."), variant: 'destructive' })
    } finally { setExportingPdf(false) }
  }

  const handleDragStart = useCallback((e: React.DragEvent) => {
    const filename = doc.type === 'brochure'
      ? `brochure_v${doc.version}.html`
      : doc.type === 'report'
        ? `report_v${doc.version}.html`
        : `dispensa_v${doc.version}.html`
    e.dataTransfer.setData('application/x-chatbot-document', JSON.stringify({
      type: doc.type,
      content: renderedHtml,
      filename,
      title: doc.title,
      mimeType: 'text/html',
    }))
    e.dataTransfer.effectAllowed = 'copy'
  }, [doc, renderedHtml])

  const shareToSession = useCallback(async (sessionId: string) => {
    setSharingSessionId(sessionId)
    setShowShareMenu(false)
    try {
      const targetSession = sessions.find((s) => s.id === sessionId)
      const filename = doc.type === 'brochure'
        ? `brochure_v${doc.version}.html`
        : doc.type === 'report'
          ? `report_v${doc.version}.html`
          : `dispensa_v${doc.version}.html`
      const file = new File([renderedHtml], filename, { type: 'text/html' })

      const uploadRes = await chatApi.uploadFiles(sessionId, [file])
      const urls: string[] = uploadRes.data?.urls || []
      if (urls.length === 0) throw new Error(tl("Upload fallito"))

      const attachments = urls.map((url, i) => ({
        type: 'file',
        url,
        filename: i === 0 ? filename : url.split('/').pop() || 'file',
      }))

      const label = doc.type === 'brochure' ? '📄 Brochure' : doc.type === 'report' ? tl("📊 Report interattivo") : doc.type === 'html_page' ? tl("🎮 Pagina Interattiva") : tl("📑 Dispensa")
      const text = `${label}: **${doc.title || 'Documento generato con AI'}** (v${doc.version})`
      await chatApi.sendSessionMessage(sessionId, text, attachments)
      setSharedSessionIds(prev => new Set([...prev, sessionId]))
      toast({
        title: tl("Documento pubblicato"),
        description: tl("Condiviso con {0}.", targetSession?.title || 'la classe'),
        className: 'border-emerald-200 bg-emerald-50 text-emerald-950 shadow-lg shadow-emerald-950/10',
      })
    } catch (e) {
      console.error('Share failed', e)
      toast({
        title: tl("Pubblicazione fallita"),
        description: tl("Non sono riuscito a inviare il documento nella chat di classe."),
        variant: 'destructive',
        className: 'shadow-lg',
      })
    } finally {
      setSharingSessionId(null)
    }
  }, [doc, renderedHtml, toast])

  const isDispensa = doc.type === 'dispensa'
  const isReport = doc.type === 'report'
  const iconBg = isReport
    ? 'bg-sky-100 text-sky-700'
    : isDispensa
      ? 'bg-amber-100 text-amber-700'
      : 'bg-fuchsia-100 text-fuchsia-700'
  const Icon = isReport ? BarChart2 : (isDispensa ? FileText : Layout)

  return (
    <div className="flex flex-col h-full bg-slate-50 border-l border-slate-200 overflow-hidden">
      {/* Header */}
      <div
        className="flex items-center gap-2 px-4 py-3 bg-white border-b border-slate-200 shrink-0"
        draggable
        onDragStart={handleDragStart}
        title={tl("Trascina nella chat di classe per condividere")}
        style={{ cursor: 'grab' }}
      >
        <GripVertical className="h-4 w-4 text-slate-300 flex-shrink-0" />
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <div className={`w-7 h-7 rounded-lg flex items-center justify-center ${iconBg}`}>
            <Icon className="h-3.5 w-3.5" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold text-slate-800 truncate">
                {doc.title || (isReport ? tl("Report interattivo") : isDispensa ? tl("Dispensa") : 'Brochure')}
              </span>
              <span className="text-[10px] bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded-full font-mono shrink-0">
                v{doc.version}
              </span>
            </div>
            <div className="text-[10px] text-slate-400">
              {isReport ? tl("Dashboard HTML interattiva") : (isDispensa ? tl("Dispensa HTML interattiva") : tl("Brochure HTML interattiva"))}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-1 shrink-0">
          <button
            onClick={() => setShowSource(v => !v)}
            className={`${TOOLBAR_PILL} ${showSource ? TOOLBAR_PILL_ACTIVE : TOOLBAR_PILL_INACTIVE}`}
          >
            {showSource ? 'Anteprima' : tl("Sorgente")}
          </button>

          {doc.type === 'brochure' && <Button tone="neutral" surface="soft" density="compact" disabled={exportingPdf} onClick={() => void downloadPdf()} aria-label={tl("Scarica PDF")}>
            {exportingPdf ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />} PDF
          </Button>}

          {sessions.length > 0 && (
            <div className="relative">
              <button
                onClick={() => setShowShareMenu(v => !v)}
                className={`${TOOLBAR_PILL} ${showShareMenu ? TOOLBAR_PILL_ACTIVE : TOOLBAR_PILL_INACTIVE}`}
              >
                <Share2 className="h-3.5 w-3.5" />{tl("Condividi")}
              </button>
              {showShareMenu && (
                <div className="absolute right-0 top-full mt-1 w-60 bg-white rounded-xl shadow-xl border border-slate-100 py-1 z-50 animate-in fade-in zoom-in-95 duration-100">
                  <div className="px-3 py-2 text-[10px] font-bold text-slate-400 uppercase tracking-wider border-b border-slate-100">
                    {tl("Invia nella chat di classe")}
                  </div>
                  {sessions.map(s => {
                    const isSending = sharingSessionId === s.id
                    const isDone = sharedSessionIds.has(s.id)
                    return (
                      <div key={s.id} className="px-2 py-1">
                        <div className="text-[10px] text-slate-400 px-2 pt-1">{s.class_name}</div>
                        <button
                          onClick={() => shareToSession(s.id)}
                          disabled={!!isSending}
                          className="w-full flex items-center gap-1.5 px-2 py-1.5 text-xs text-slate-700 hover:bg-slate-50 rounded-lg transition-colors"
                        >
                          {isSending ? <Loader2 className="h-3 w-3 animate-spin" />
                            : isDone ? <Check className="h-3 w-3 text-green-500" />
                              : <Icon className="h-3 w-3" />}
                          {s.title}
                        </button>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )}

          <Button variant="ghost" size="sm" onClick={onClose} className="h-7 w-7 p-0 text-slate-400">
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto">
        {showSource ? (
          <div className="h-full overflow-auto bg-[#1e1e2e] p-4">
            <pre className="text-xs text-green-300 font-mono whitespace-pre-wrap leading-relaxed">
              {sourceContent}
            </pre>
          </div>
        ) : (
          <InteractiveHtmlFrame
            ref={previewRef}
            srcDoc={renderedHtml}
            className="w-full h-full border-0 bg-white"
            title={isReport ? 'Report Preview' : (isDispensa ? tl("Dispensa HTML Preview") : 'Brochure HTML Preview')}
          />
        )}
      </div>

      <div className="px-4 py-2 bg-white border-t border-slate-100 shrink-0">
        <p className="text-[10px] text-slate-400 text-center">
          {tl("Trascina l'intestazione nella chat di classe per condividere · Continua la chat per modifiche")}
        </p>
      </div>
    </div>
  )
}
