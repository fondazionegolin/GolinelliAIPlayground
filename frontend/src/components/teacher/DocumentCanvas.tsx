import { useState, useCallback, useMemo, useEffect } from 'react'
import { X, Download, Layout, FileText, GripVertical, Share2, Check, Loader2, RotateCcw, BarChart2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useToast } from '@/components/ui/use-toast'
import { chatApi, llmApi } from '@/lib/api'
import { buildBrochureLatex, buildDispensaLatex, buildReportHtml, parseBrochurePayload, parseDispensaPayload, parseReportPayload } from '@/components/teacher/reportTemplates'

export interface GeneratedDoc {
  type: 'brochure' | 'dispensa' | 'report'
  content: string
  version: number
  title: string
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

#progress-bar{position:fixed;top:0;left:0;height:3px;width:0%;background:linear-gradient(90deg,#e85c8d,#f29db8);z-index:9999;transition:width .1s linear}

.layout{display:flex;min-height:100vh}

.sidebar{width:240px;flex-shrink:0;background:linear-gradient(180deg,#1a1a2e 0%,#232340 100%);position:sticky;top:0;height:100vh;overflow-y:auto;padding:22px 0 40px;z-index:100}
.sidebar-logo{padding:0 18px 18px;border-bottom:1px solid rgba(255,255,255,.1);margin-bottom:16px}
.sidebar-logo .badge{background:#e85c8d;color:#fff;font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:1.5px;padding:4px 10px;border-radius:20px;display:inline-block;margin-bottom:8px;box-shadow:0 10px 24px rgba(232,92,141,.25)}
.sidebar-logo h2{color:#fff;font-size:12px;font-weight:600;line-height:1.4;opacity:.9}
.sidebar-section{padding:10px 18px 4px;color:rgba(255,255,255,.3);font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:1.5px}
.sidebar nav a{display:flex;align-items:center;gap:8px;padding:8px 18px;color:rgba(255,255,255,.64);text-decoration:none;font-size:12px;font-weight:500;border-left:3px solid transparent;transition:all .2s}
.sidebar nav a:hover,.sidebar nav a.active{color:#fff;background:rgba(255,255,255,.08);border-left-color:#e85c8d}
.sidebar nav a .sn{background:rgba(255,255,255,.12);color:#f3a2be;font-size:9px;font-weight:700;width:20px;height:20px;border-radius:50%;display:flex;align-items:center;justify-content:center;flex-shrink:0;font-family:'JetBrains Mono',monospace}

.main{flex:1;min-width:0;padding-bottom:80px}

.hero{background:
linear-gradient(135deg,#1a1a2e 0%,#2a2346 52%,#e85c8d 180%);
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
.section-num{font-family:'JetBrains Mono',monospace;font-size:12px;font-weight:700;color:#fff;background:#e85c8d;padding:6px 12px;border-radius:999px;letter-spacing:1px;box-shadow:0 10px 24px rgba(232,92,141,.18)}
.section-header h2{font-size:1.82em;font-weight:750;color:#1a1a2e;line-height:1.2}

section{margin-bottom:56px;scroll-margin-top:20px}
.content p{margin-bottom:16px;color:#3f4657;line-height:1.9}
.content h3{font-size:1.08em;font-weight:700;color:#1a1a2e;margin:24px 0 10px;padding-left:10px;border-left:3px solid #e85c8d}
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
.warning-box{background:#fff5fa;border-left:4px solid #e85c8d}
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
  const subtitle = titleMatch ? titleMatch[2].trim() : 'Dispensa generata con Claude AI'
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
    definition: { className: 'definition-box', label: '📘 Definizione' },
    theorem: { className: 'theorem-box', label: '📐 Teorema' },
    example: { className: 'example-box', label: '💡 Esempio' },
    warning: { className: 'warning-box', label: '⚠️ Attenzione' },
    note: { className: 'note-box', label: '📝 Nota' },
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

const BROCHURE_CSS = `
*{box-sizing:border-box;margin:0;padding:0}
html{scroll-behavior:smooth}
body{font-family:'Inter',sans-serif;line-height:1.7;font-size:15px}
.container{max-width:880px;margin:0 auto;padding:0 28px}
section{padding:72px 0}

/* Hero */
.hero{min-height:480px;display:flex;align-items:center;position:relative;overflow:hidden;padding:80px 0}
.hero-badge{display:inline-block;font-size:11px;font-weight:700;letter-spacing:.35em;text-transform:uppercase;border:1px solid currentColor;opacity:.7;padding:5px 16px;border-radius:2px;margin-bottom:24px}
.hero-title{font-family:'Playfair Display',serif;font-size:clamp(2.4rem,5.5vw,3.8rem);font-weight:900;line-height:1.08;margin-bottom:16px}
.hero-title .accent{font-style:italic}
.hero-desc{font-size:1.05rem;max-width:580px;margin-bottom:36px;opacity:.82;font-weight:300;line-height:1.7}
.hero-cta{display:flex;gap:12px;flex-wrap:wrap;align-items:center}
.btn-primary,.btn-outline{display:inline-block;padding:13px 32px;border-radius:3px;font-weight:700;font-size:.87rem;letter-spacing:.1em;text-transform:uppercase;text-decoration:none;cursor:pointer;transition:transform .2s,box-shadow .2s,opacity .2s}
.btn-primary:hover,.btn-outline:hover{transform:translateY(-2px);opacity:.9;box-shadow:0 8px 24px rgba(0,0,0,.25)}

/* Section typography */
.section-label{font-size:.7rem;font-weight:700;letter-spacing:.4em;text-transform:uppercase;opacity:.55;margin-bottom:12px}
.section-title{font-family:'Playfair Display',serif;font-size:clamp(1.8rem,3.5vw,2.6rem);font-weight:900;line-height:1.15;margin-bottom:20px}
.section-lead{font-size:1.05rem;line-height:1.82;max-width:700px;margin-bottom:36px;opacity:.88}

/* Key list */
.key-list{list-style:none;display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:28px}
.key-list li{display:flex;align-items:flex-start;gap:10px;padding:14px 16px;border-radius:4px;font-size:.95rem;line-height:1.55;background:rgba(255,255,255,.08);border-left:3px solid currentColor}
.key-list .icon{font-size:1.25rem;flex-shrink:0;line-height:1}
@media(max-width:580px){.key-list{grid-template-columns:1fr}}

/* Card grid */
.card-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:20px;margin-top:32px}
.card{background:#fff;border-radius:8px;padding:26px 22px;box-shadow:0 2px 16px rgba(0,0,0,.08);transition:transform .2s,box-shadow .2s}
.card:hover{transform:translateY(-4px);box-shadow:0 10px 30px rgba(0,0,0,.14)}
.card-icon{font-size:2rem;margin-bottom:12px}
.card-title{font-weight:700;font-size:1rem;margin-bottom:8px}
.card-desc{font-size:.9rem;line-height:1.65;opacity:.75}

/* Benefit list */
.benefit-list{list-style:none;display:flex;flex-direction:column;gap:16px;margin-top:32px}
.benefit-list li{display:flex;gap:20px;align-items:flex-start;padding:20px 22px;border-radius:6px;background:rgba(255,255,255,.07);transition:background .2s}
.benefit-list li:hover{background:rgba(255,255,255,.13)}
.benefit-num{font-family:'Playfair Display',serif;font-size:2rem;font-weight:900;line-height:1;min-width:40px;opacity:.85}
.benefit-title{font-weight:700;font-size:.98rem;margin-bottom:5px}
.benefit-desc{font-size:.93rem;opacity:.8;line-height:1.6}

/* Steps */
.steps-list{display:flex;flex-direction:column;gap:0;margin-top:32px}
.steps-list li{display:flex;gap:24px;align-items:flex-start;padding:28px 0;border-bottom:1px solid rgba(255,255,255,.12)}
.steps-list li:last-child{border-bottom:none}
.step-num{font-family:'Playfair Display',serif;font-size:3rem;font-weight:900;line-height:1;min-width:56px;opacity:.2}
.step-title{font-weight:700;font-size:1.1rem;margin-bottom:8px}
.step-desc{font-size:.95rem;opacity:.82;line-height:1.7}

/* Stats grid */
.stats-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:20px;margin-top:40px}
.stat-box{border-radius:6px;padding:28px 18px;text-align:center;background:rgba(255,255,255,.12);transition:background .2s}
.stat-box:hover{background:rgba(255,255,255,.2)}
.stat-num{font-family:'Playfair Display',serif;font-size:2.8rem;font-weight:900;line-height:1;display:block;margin-bottom:6px}
.stat-label{font-size:.8rem;font-weight:600;letter-spacing:.08em;text-transform:uppercase;opacity:.8}
.stat-desc{font-size:.85rem;margin-top:8px;opacity:.7;line-height:1.5}

/* Quote */
.quote-block{border-left:4px solid currentColor;padding:20px 24px;margin:20px 0;background:rgba(255,255,255,.06);border-radius:0 6px 6px 0}
.quote-text{font-size:1.05rem;font-style:italic;line-height:1.8;margin-bottom:10px;opacity:.9}
.quote-author{font-weight:700;font-size:.85rem;opacity:.65}

/* FAQ */
.faq-list{list-style:none;display:flex;flex-direction:column;gap:2px;margin-top:28px}
.faq-list details{border-radius:6px;overflow:hidden;background:rgba(255,255,255,.07)}
.faq-list details summary{cursor:pointer;font-weight:600;font-size:.98rem;padding:16px 20px;user-select:none;list-style:none;display:flex;align-items:center;gap:8px}
.faq-list details summary::-webkit-details-marker{display:none}
.faq-list details[open] summary{border-bottom:1px solid rgba(255,255,255,.1)}
.faq-list details p{padding:16px 20px;font-size:.95rem;line-height:1.75;opacity:.85}
`

const BROCHURE_FONTS = `https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&family=Playfair+Display:ital,wght@0,700;0,900;1,700&display=swap`

function buildBrochureHtml(sections: string, docTitle: string): string {
  // Extract TITLE and PALETTE from first comment
  const metaMatch = sections.match(/<!--\s*TITLE:\s*([^|]+?)\s*\|\s*PALETTE:\s*([^-]+?)\s*-->/)
  const title = metaMatch ? metaMatch[1].trim() : docTitle
  const paletteStr = metaMatch ? metaMatch[2].trim() : '#1a1a2e,#e8a020,#2980b9,#27ae60,#8e44ad'
  const colors = paletteStr.split(',').map(c => c.trim()).filter(Boolean)
  const primary = colors[0] || '#1a1a2e'
  const accent = colors[1] || '#e8a020'
  const cleanSections = sections.replace(/<!--\s*TITLE:[^>]*?-->/i, '').trim()

  // Inject CSS variables based on AI palette
  const cssVars = `
    :root{--primary:${primary};--accent:${accent};--c3:${colors[2]||'#2980b9'};--c4:${colors[3]||'#27ae60'};--c5:${colors[4]||'#8e44ad'}}
    .accent{color:var(--accent)}
    .btn-primary{background:var(--accent);color:#fff}
    .btn-outline{background:transparent;color:currentColor;border:2px solid currentColor}
    a{color:inherit;text-decoration:none}
    @media(max-width:640px){section{padding:48px 0}.hero{padding:56px 0 48px;min-height:auto}.hero-title{font-size:2rem}}
  `

  return `<!DOCTYPE html>
<html lang="it">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>${title}</title>
<link href="${BROCHURE_FONTS}" rel="stylesheet">
<style>${BROCHURE_CSS}${cssVars}</style>
</head>
<body>
${cleanSections}
<footer style="background:${primary};color:rgba(255,255,255,.7);padding:32px 0;text-align:center;font-size:13px">
  <div class="container">Generato con Claude AI · Fondazione Golinelli · 2026</div>
</footer>
</body>
</html>`
}

function buildBrochureHtmlFromPayload(raw: string, docTitle: string): string | null {
  const payload = parseBrochurePayload(raw)
  if (!payload) return null

  const palette = payload.palette && payload.palette.length > 0
    ? payload.palette.slice(0, 5).join(',')
    : '#1a1a2e,#d97745,#2c6b8a,#7aa65a,#f6efe7'

  const heroAccent = payload.heroAccent ? `<span class="accent">${payload.heroAccent}</span>` : ''
  const sections = `
    <section id="hero" class="hero" style="background:linear-gradient(135deg,${payload.palette?.[0] || '#1a1a2e'} 0%,${payload.palette?.[1] || '#d97745'} 140%);color:#fff">
      <div class="container">
        <div class="hero-badge">${payload.heroBadge || 'Brochure AI'}</div>
        <h1 class="hero-title">${payload.title} ${heroAccent}</h1>
        <p class="hero-desc">${payload.heroDescription}</p>
        <div class="hero-cta">
          <a class="btn-primary" href="#overview">${payload.ctaPrimary || 'Scopri di più'}</a>
          <a class="btn-outline" href="#cta">${payload.ctaSecondary || 'Approfondisci'}</a>
        </div>
      </div>
    </section>
    <section id="overview" style="background:#f6efe7;color:#1a1a2e">
      <div class="container">
        <div class="section-label">Panoramica</div>
        <h2 class="section-title">${payload.overviewTitle || payload.title}</h2>
        <p class="section-lead">${payload.overviewLead || payload.subtitle}</p>
        <ul class="key-list">
          ${payload.keyPoints.map((point) => `<li><span class="icon">✦</span><span>${point}</span></li>`).join('')}
        </ul>
      </div>
    </section>
    <section id="features" style="background:#fff;color:#1a1a2e">
      <div class="container">
        <div class="section-label">Caratteristiche</div>
        <h2 class="section-title">Elementi distintivi</h2>
        <div class="card-grid">
          ${payload.features.map((feature) => `
            <article class="card">
              <div class="card-icon">${feature.icon || '✨'}</div>
              <div class="card-title">${feature.title}</div>
              <div class="card-desc">${feature.description}</div>
            </article>
          `).join('')}
        </div>
      </div>
    </section>
    <section id="benefits" style="background:${payload.palette?.[2] || '#2c6b8a'};color:#fff">
      <div class="container">
        <div class="section-label">Vantaggi</div>
        <h2 class="section-title">Perché conta</h2>
        <ul class="benefit-list">
          ${payload.benefits.map((benefit, index) => `
            <li>
              <div class="benefit-num">${String(index + 1).padStart(2, '0')}</div>
              <div><div class="benefit-title">Beneficio ${index + 1}</div><div class="benefit-desc">${benefit}</div></div>
            </li>
          `).join('')}
        </ul>
      </div>
    </section>
    <section id="method" style="background:${payload.palette?.[0] || '#1a1a2e'};color:#fff">
      <div class="container">
        <div class="section-label">Metodo</div>
        <h2 class="section-title">Come funziona</h2>
        <ul class="steps-list">
          ${payload.steps.map((step, index) => `
            <li>
              <div class="step-num">${index + 1}</div>
              <div><div class="step-title">Passaggio ${index + 1}</div><div class="step-desc">${step}</div></div>
            </li>
          `).join('')}
        </ul>
      </div>
    </section>
    <section id="stats" style="background:${payload.palette?.[3] || '#7aa65a'};color:#fff">
      <div class="container">
        <div class="section-label">Indicatori</div>
        <h2 class="section-title">Numeri e segnali</h2>
        <div class="stats-grid">
          ${payload.stats.map((stat) => `
            <article class="stat-box">
              <span class="stat-num">${stat.value}</span>
              <div class="stat-label">${stat.label}</div>
              ${stat.description ? `<div class="stat-desc">${stat.description}</div>` : ''}
            </article>
          `).join('')}
        </div>
      </div>
    </section>
    <section id="faq" style="background:#fff;color:#1a1a2e">
      <div class="container">
        <div class="section-label">FAQ</div>
        <h2 class="section-title">Domande frequenti</h2>
        <div class="faq-list">
          ${payload.faq.map((item) => `<details><summary>❓ ${item.question}</summary><p>${item.answer}</p></details>`).join('')}
        </div>
      </div>
    </section>
    <section id="cta" style="background:${payload.palette?.[1] || '#d97745'};color:#fff">
      <div class="container">
        <div class="section-label">Call To Action</div>
        <h2 class="section-title">${payload.closingTitle || 'Prossimi passi'}</h2>
        <p class="section-lead">${payload.closingText || payload.subtitle}</p>
        ${payload.closingQuote ? `<div class="quote-block"><div class="quote-text">${payload.closingQuote}</div>${payload.closingAuthor ? `<div class="quote-author">${payload.closingAuthor}</div>` : ''}</div>` : ''}
        <div class="hero-cta">
          <a class="btn-primary" href="#hero">${payload.ctaPrimary || 'Inizia'}</a>
          <a class="btn-outline" href="#overview">${payload.ctaSecondary || 'Rivedi overview'}</a>
        </div>
      </div>
    </section>
  `

  return buildBrochureHtml(`<!-- TITLE: ${payload.title} | PALETTE: ${palette} -->${sections}`, docTitle)
}

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
  const [showSource, setShowSource] = useState(false)
  const [showShareMenu, setShowShareMenu] = useState(false)
  const [sharingSessionId, setSharingSessionId] = useState<string | null>(null)
  const [sharedSessionIds, setSharedSessionIds] = useState<Set<string>>(new Set())
  const [pdfBlobUrl, setPdfBlobUrl] = useState<string | null>(null)
  const [pdfBytes, setPdfBytes] = useState<ArrayBuffer | null>(null)
  const [pdfLoading, setPdfLoading] = useState(false)
  const [pdfError, setPdfError] = useState<string | null>(null)

  // Build final renderable HTML
  const renderedHtml = useMemo(() => {
    const trimmed = doc.content.trim()
    if (trimmed.startsWith('<!DOCTYPE') || trimmed.startsWith('<html')) return trimmed
    if (doc.type === 'brochure') {
      return buildBrochureHtmlFromPayload(doc.content, doc.title || 'Brochure')
        || buildBrochureHtml(extractSections(doc.content), doc.title || 'Brochure')
    }
    if (doc.type === 'report') {
      return buildReportHtml(doc.content, doc.title || 'Report')
    } else {
      return buildDispensaHtmlFromPayload(doc.content, doc.title || 'Dispensa', authorName)
        || buildDispensaHtml(extractSections(doc.content), doc.title || 'Dispensa', authorName)
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

  const latexContent = useMemo(() => {
    if (doc.type === 'dispensa') return buildDispensaLatex(doc.content, doc.title || 'Dispensa', authorName || 'Docente')
    if (doc.type === 'brochure') return buildBrochureLatex(doc.content, doc.title || 'Brochure', authorName || 'Docente')
    return null
  }, [authorName, doc])

  const compilePdf = useCallback(async (): Promise<{ bytes: ArrayBuffer; objectUrl: string } | null> => {
    if (!latexContent) {
      setPdfBlobUrl(null)
      setPdfBytes(null)
      setPdfError(null)
      return null
    }
    setPdfLoading(true)
    setPdfError(null)
    try {
      const filename = doc.type === 'brochure' ? 'brochure' : 'dispensa'
      const response = await llmApi.compileLatex(latexContent, `${filename}_v${doc.version}`)
      const bytes = response.data as ArrayBuffer
      const blob = new Blob([bytes], { type: 'application/pdf' })
      const objectUrl = URL.createObjectURL(blob)
      setPdfBytes(bytes)
      setPdfBlobUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev)
        return objectUrl
      })
      return { bytes, objectUrl }
    } catch (error: any) {
      console.warn('PDF compilation failed', error)
      setPdfBytes(null)
      setPdfBlobUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev)
        return null
      })
      setPdfError(error?.response?.data?.detail || 'Compilazione PDF non riuscita')
      return null
    } finally {
      setPdfLoading(false)
    }
  }, [doc.type, doc.version, latexContent])

  useEffect(() => {
    setPdfBytes(null)
    setPdfBlobUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev)
      return null
    })
    setPdfError(null)
    setPdfLoading(false)
  }, [doc.type, doc.version, doc.content])

  const handleDragStart = useCallback((e: React.DragEvent) => {
    const filename = pdfBlobUrl && doc.type !== 'report'
      ? `${doc.type}_v${doc.version}.pdf`
      : doc.type === 'brochure'
        ? `brochure_v${doc.version}.html`
        : doc.type === 'report'
          ? `report_v${doc.version}.html`
          : `dispensa_v${doc.version}.html`
    e.dataTransfer.setData('application/x-chatbot-document', JSON.stringify({
      type: doc.type,
      content: pdfBlobUrl && doc.type !== 'report' ? undefined : renderedHtml,
      blobUrl: pdfBlobUrl || undefined,
      filename,
      title: doc.title,
      mimeType: pdfBlobUrl && doc.type !== 'report' ? 'application/pdf' : 'text/html',
    }))
    e.dataTransfer.effectAllowed = 'copy'
  }, [doc, renderedHtml, pdfBlobUrl])

  const downloadDoc = useCallback(() => {
    if (pdfBlobUrl && doc.type !== 'report') {
      const a = document.createElement('a')
      a.href = pdfBlobUrl
      a.download = `${doc.type}_v${doc.version}.pdf`
      a.click()
      return
    }
    const blob = new Blob([renderedHtml], { type: 'text/html;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = doc.type === 'brochure'
      ? `brochure_v${doc.version}.html`
      : doc.type === 'report'
        ? `report_v${doc.version}.html`
        : `dispensa_v${doc.version}.html`
    a.click()
    URL.revokeObjectURL(url)
  }, [doc, renderedHtml, pdfBlobUrl])

  const downloadPdf = useCallback(async () => {
    let targetUrl = pdfBlobUrl
    if (!targetUrl && doc.type !== 'report') {
      const compiled = await compilePdf()
      targetUrl = compiled?.objectUrl || null
    }
    if (!targetUrl) return
    const a = document.createElement('a')
    a.href = targetUrl
    a.download = `${doc.type}_v${doc.version}.pdf`
    a.click()
    toast({
      title: 'PDF generato',
      description: `${doc.type === 'brochure' ? 'Brochure' : 'Dispensa'} pronta in formato PDF.`,
    })
  }, [compilePdf, doc.type, doc.version, pdfBlobUrl, toast])

  const printDoc = useCallback(() => {
    if (pdfBlobUrl && doc.type !== 'report') {
      window.open(pdfBlobUrl, '_blank')
      return
    }
    const win = window.open('', '_blank')
    if (win) {
      win.document.write(renderedHtml)
      win.document.close()
      win.print()
    }
  }, [doc.type, pdfBlobUrl, renderedHtml])

  const shareToSession = useCallback(async (sessionId: string) => {
    setSharingSessionId(sessionId)
    setShowShareMenu(false)
    try {
      const targetSession = sessions.find((s) => s.id === sessionId)
      const filename = pdfBytes && doc.type !== 'report'
        ? `${doc.type}_v${doc.version}.pdf`
        : doc.type === 'brochure'
          ? `brochure_v${doc.version}.html`
          : doc.type === 'report'
            ? `report_v${doc.version}.html`
            : `dispensa_v${doc.version}.html`
      const file = pdfBytes && doc.type !== 'report'
        ? new File([pdfBytes], filename, { type: 'application/pdf' })
        : new File([renderedHtml], filename, { type: 'text/html' })

      const uploadRes = await chatApi.uploadFiles(sessionId, [file])
      const urls: string[] = uploadRes.data?.urls || []
      if (urls.length === 0) throw new Error('Upload fallito')

      const attachments = urls.map((url, i) => ({
        type: 'file',
        url,
        filename: i === 0 ? filename : url.split('/').pop() || 'file',
      }))

      const label = doc.type === 'brochure' ? '📄 Brochure' : doc.type === 'report' ? '📊 Report interattivo' : '📑 Dispensa'
      const text = `${label}: **${doc.title || 'Documento generato con AI'}** (v${doc.version})`
      await chatApi.sendSessionMessage(sessionId, text, attachments)
      setSharedSessionIds(prev => new Set([...prev, sessionId]))
      toast({
        title: 'Documento pubblicato',
        description: `Condiviso con ${targetSession?.title || 'la classe'}.`,
        className: 'border-emerald-200 bg-emerald-50 text-emerald-950 shadow-lg shadow-emerald-950/10',
      })
    } catch (e) {
      console.error('Share failed', e)
      toast({
        title: 'Pubblicazione fallita',
        description: 'Non sono riuscito a inviare il documento nella chat di classe.',
        variant: 'destructive',
        className: 'shadow-lg',
      })
    } finally {
      setSharingSessionId(null)
    }
  }, [doc, pdfBytes, renderedHtml, toast])

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
        title="Trascina nella chat di classe per condividere"
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
                {doc.title || (isReport ? 'Report interattivo' : isDispensa ? 'Dispensa' : 'Brochure')}
              </span>
              <span className="text-[10px] bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded-full font-mono shrink-0">
                v{doc.version}
              </span>
            </div>
            <div className="text-[10px] text-slate-400">
              {isReport ? 'Dashboard HTML interattiva' : (isDispensa ? 'Dispensa HTML interattiva · PDF su richiesta' : 'Brochure HTML interattiva · PDF su richiesta')}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-1 shrink-0">
          <button
            onClick={() => setShowSource(v => !v)}
            className={`px-2 py-1 rounded-full text-[10px] transition-all border ${showSource
              ? 'bg-slate-800 text-white border-slate-800'
              : 'bg-slate-100 text-slate-500 border-slate-200 hover:bg-slate-200'}`}
          >
            {showSource ? 'Anteprima' : 'Sorgente'}
          </button>

          <Button variant="ghost" size="sm" onClick={printDoc}
            className="h-7 px-2 text-xs text-slate-500 hover:bg-slate-100">
            <RotateCcw className="h-3 w-3 mr-1" />Stampa
          </Button>

          {doc.type !== 'report' && (
            <Button
              variant="ghost"
              size="sm"
              onClick={downloadPdf}
              disabled={pdfLoading}
              className="h-7 px-2 text-xs text-rose-600 hover:bg-rose-50"
              title={pdfError || 'Converti e scarica PDF'}
            >
              {pdfLoading ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <FileText className="h-3 w-3 mr-1" />}
              PDF
            </Button>
          )}

          <Button variant="ghost" size="sm" onClick={downloadDoc}
            className="h-7 px-2 text-xs text-slate-500 hover:bg-slate-100">
            <Download className="h-3 w-3 mr-1" />{pdfBlobUrl && doc.type !== 'report' ? '.pdf' : '.html'}
          </Button>

          {sessions.length > 0 && (
            <div className="relative">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowShareMenu(v => !v)}
                className={`h-7 px-2 text-xs border ${isDispensa
                  ? 'text-amber-700 hover:bg-amber-50 border-amber-200'
                  : 'text-sky-600 hover:bg-sky-50 border-sky-200'}`}
              >
                <Share2 className="h-3 w-3 mr-1" />Condividi
              </Button>
              {showShareMenu && (
                <div className="absolute right-0 top-full mt-1 w-60 bg-white rounded-xl shadow-xl border border-slate-100 py-1 z-50 animate-in fade-in zoom-in-95 duration-100">
                  <div className="px-3 py-2 text-[10px] font-bold text-slate-400 uppercase tracking-wider border-b border-slate-100">
                    Invia nella chat di classe
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
        ) : pdfLoading && doc.type !== 'report' ? (
          <div className="h-full flex items-center justify-center bg-white">
            <div className="flex items-center gap-2 text-sm text-slate-500">
              <Loader2 className="h-4 w-4 animate-spin" />
              Generazione anteprima PDF...
            </div>
          </div>
        ) : (
          <iframe
            srcDoc={renderedHtml}
            sandbox="allow-same-origin allow-scripts"
            className="w-full h-full border-0 bg-white"
            title={isReport ? 'Report Preview' : (isDispensa ? 'Dispensa HTML Preview' : 'Brochure HTML Preview')}
          />
        )}
      </div>

      <div className="px-4 py-2 bg-white border-t border-slate-100 shrink-0">
        <p className="text-[10px] text-slate-400 text-center">
          Trascina l'intestazione nella chat di classe per condividere · Continua la chat per modifiche
        </p>
        {pdfError && doc.type !== 'report' && (
          <p className="mt-1 text-[10px] text-center text-rose-500">
            PDF non disponibile: {pdfError}
          </p>
        )}
      </div>
    </div>
  )
}
