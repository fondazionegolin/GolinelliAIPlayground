export type ReportTemplateId =
  | 'dashboard_classe'
  | 'apprendimenti'
  | 'partecipazione'
  | 'classifiche'
  | 'criticita'

export interface BrochureFeature {
  icon?: string
  title: string
  description: string
}

export interface BrochureStat {
  value: string
  label: string
  description?: string
}

export interface BrochureFaq {
  question: string
  answer: string
}

export interface BrochurePayload {
  title: string
  subtitle: string
  palette?: string[]
  heroBadge?: string
  heroAccent?: string
  heroDescription: string
  ctaPrimary?: string
  ctaSecondary?: string
  overviewTitle?: string
  overviewLead?: string
  keyPoints: string[]
  features: BrochureFeature[]
  benefits: string[]
  steps: string[]
  stats: BrochureStat[]
  faq: BrochureFaq[]
  closingTitle?: string
  closingText?: string
  closingQuote?: string
  closingAuthor?: string
}

export interface DispensaTable {
  columns: string[]
  rows: string[][]
}

export interface DispensaBlock {
  kind: 'definition' | 'theorem' | 'example' | 'warning' | 'note'
  title: string
  content: string
}

export interface DispensaSection {
  id?: string
  title: string
  intro: string
  blocks?: DispensaBlock[]
  bulletPoints?: string[]
  summaryPoints?: string[]
  table?: DispensaTable
}

export interface DispensaExercise {
  title: string
  prompt: string
  solution?: string
}

export interface DispensaPayload {
  title: string
  subtitle: string
  abstract: string
  objectives?: string[]
  sections: DispensaSection[]
  exercises?: DispensaExercise[]
  references?: string[]
}

export interface ReportMetric {
  label: string
  value: string
  trend?: string
  detail?: string
}

export interface ReportChart {
  id: string
  title: string
  type: 'bar' | 'line' | 'doughnut' | 'radar'
  labels: string[]
  values: number[]
  color?: string
  description?: string
}

export interface ReportRow {
  name: string
  score?: string
  detail?: string
  badge?: string
}

export interface ReportTable {
  title: string
  columns: string[]
  rows: string[][]
}

export interface ReportPayload {
  templateId: ReportTemplateId
  title: string
  subtitle: string
  summary: string
  metrics: ReportMetric[]
  charts: ReportChart[]
  leaderboard: ReportRow[]
  strengths: string[]
  risks: string[]
  recommendations: string[]
  tables?: ReportTable[]
  assumptions?: string[]
  methodology?: string
}

const DEFAULT_COLORS = ['#d97745', '#1f3b53', '#6ba7c8', '#7dbb78', '#c9a227', '#b85d7a']

const TEMPLATE_TITLES: Record<ReportTemplateId, string> = {
  dashboard_classe: 'Dashboard Classe',
  apprendimenti: 'Apprendimenti',
  partecipazione: 'Partecipazione',
  classifiche: 'Classifiche',
  criticita: 'Criticità e Rischi',
}

function tryParseJson(raw: string): unknown | null {
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}

function parsePayloadBlock<T extends Record<string, unknown>>(raw: string, blockName: string): T | null {
  const blockMatch = raw.match(new RegExp("```" + blockName + "\\s*([\\s\\S]*?)```", 'i'))
  const candidate = blockMatch ? blockMatch[1].trim() : raw.trim()
  const parsed = tryParseJson(candidate)
  if (!parsed || typeof parsed !== 'object') return null
  return parsed as T
}

export function parseReportPayload(raw: string): ReportPayload | null {
  const obj = parsePayloadBlock<Partial<ReportPayload>>(raw, 'report_data')
  if (!obj) return null
  if (!obj.title || !obj.templateId) return null

  const templateId = (obj.templateId in TEMPLATE_TITLES ? obj.templateId : 'dashboard_classe') as ReportTemplateId

  return {
    templateId,
    title: obj.title,
    subtitle: obj.subtitle || TEMPLATE_TITLES[templateId],
    summary: obj.summary || '',
    metrics: Array.isArray(obj.metrics) ? obj.metrics.slice(0, 6).map((m) => ({
      label: m.label || 'KPI',
      value: m.value || 'n.d.',
      trend: m.trend,
      detail: m.detail,
    })) : [],
    charts: Array.isArray(obj.charts) ? obj.charts.slice(0, 4).map((chart, idx) => ({
      id: chart.id || `chart_${idx + 1}`,
      title: chart.title || `Grafico ${idx + 1}`,
      type: chart.type || 'bar',
      labels: Array.isArray(chart.labels) ? chart.labels.slice(0, 12) : [],
      values: Array.isArray(chart.values) ? chart.values.slice(0, 12).map((v) => Number(v) || 0) : [],
      color: chart.color,
      description: chart.description,
    })) : [],
    leaderboard: Array.isArray(obj.leaderboard) ? obj.leaderboard.slice(0, 10).map((row) => ({
      name: row.name || 'Elemento',
      score: row.score,
      detail: row.detail,
      badge: row.badge,
    })) : [],
    strengths: Array.isArray(obj.strengths) ? obj.strengths.slice(0, 8).map(String) : [],
    risks: Array.isArray(obj.risks) ? obj.risks.slice(0, 8).map(String) : [],
    recommendations: Array.isArray(obj.recommendations) ? obj.recommendations.slice(0, 8).map(String) : [],
    tables: Array.isArray(obj.tables) ? obj.tables.slice(0, 3).map((table) => ({
      title: table.title || 'Tabella',
      columns: Array.isArray(table.columns) ? table.columns.slice(0, 6).map(String) : [],
      rows: Array.isArray(table.rows) ? table.rows.slice(0, 12).map((row) => Array.isArray(row) ? row.slice(0, 6).map(String) : []) : [],
    })) : [],
    assumptions: Array.isArray(obj.assumptions) ? obj.assumptions.slice(0, 6).map(String) : [],
    methodology: obj.methodology || '',
  }
}

export function parseBrochurePayload(raw: string): BrochurePayload | null {
  const obj = parsePayloadBlock<Partial<BrochurePayload>>(raw, 'brochure_data')
  if (!obj || !obj.title || !obj.heroDescription) return null

  return {
    title: obj.title,
    subtitle: obj.subtitle || obj.title,
    palette: Array.isArray(obj.palette) ? obj.palette.slice(0, 5).map(String) : [],
    heroBadge: obj.heroBadge || 'Brochure AI',
    heroAccent: obj.heroAccent || '',
    heroDescription: obj.heroDescription,
    ctaPrimary: obj.ctaPrimary || 'Scopri di più',
    ctaSecondary: obj.ctaSecondary || 'Approfondisci',
    overviewTitle: obj.overviewTitle || 'Panoramica',
    overviewLead: obj.overviewLead || '',
    keyPoints: Array.isArray(obj.keyPoints) ? obj.keyPoints.slice(0, 6).map(String) : [],
    features: Array.isArray(obj.features) ? obj.features.slice(0, 6).map((feature) => ({
      icon: feature.icon || '✨',
      title: feature.title || 'Elemento',
      description: feature.description || '',
    })) : [],
    benefits: Array.isArray(obj.benefits) ? obj.benefits.slice(0, 8).map(String) : [],
    steps: Array.isArray(obj.steps) ? obj.steps.slice(0, 5).map(String) : [],
    stats: Array.isArray(obj.stats) ? obj.stats.slice(0, 4).map((stat) => ({
      value: stat.value || 'n.d.',
      label: stat.label || 'Indicatore',
      description: stat.description,
    })) : [],
    faq: Array.isArray(obj.faq) ? obj.faq.slice(0, 6).map((entry) => ({
      question: entry.question || 'Domanda',
      answer: entry.answer || '',
    })) : [],
    closingTitle: obj.closingTitle || 'Prossimi passi',
    closingText: obj.closingText || '',
    closingQuote: obj.closingQuote || '',
    closingAuthor: obj.closingAuthor || '',
  }
}

export function parseDispensaPayload(raw: string): DispensaPayload | null {
  const obj = parsePayloadBlock<Partial<DispensaPayload>>(raw, 'dispensa_data')
  if (!obj || !obj.title || !obj.abstract || !Array.isArray(obj.sections) || obj.sections.length === 0) return null

  return {
    title: obj.title,
    subtitle: obj.subtitle || obj.title,
    abstract: obj.abstract,
    objectives: Array.isArray(obj.objectives) ? obj.objectives.slice(0, 8).map(String) : [],
    sections: obj.sections.slice(0, 8).map((section, index) => ({
      id: section.id || `s${index + 1}`,
      title: section.title || `Sezione ${index + 1}`,
      intro: section.intro || '',
      blocks: Array.isArray(section.blocks) ? section.blocks.slice(0, 4).map((block) => ({
        kind: ['definition', 'theorem', 'example', 'warning', 'note'].includes(block.kind || '') ? block.kind as DispensaBlock['kind'] : 'note',
        title: block.title || 'Approfondimento',
        content: block.content || '',
      })) : [],
      bulletPoints: Array.isArray(section.bulletPoints) ? section.bulletPoints.slice(0, 8).map(String) : [],
      summaryPoints: Array.isArray(section.summaryPoints) ? section.summaryPoints.slice(0, 6).map(String) : [],
      table: section.table && Array.isArray(section.table.columns) && Array.isArray(section.table.rows)
        ? {
            columns: section.table.columns.slice(0, 5).map(String),
            rows: section.table.rows.slice(0, 8).map((row) => Array.isArray(row) ? row.slice(0, 5).map(String) : []),
          }
        : undefined,
    })),
    exercises: Array.isArray(obj.exercises) ? obj.exercises.slice(0, 6).map((exercise) => ({
      title: exercise.title || 'Esercizio',
      prompt: exercise.prompt || '',
      solution: exercise.solution,
    })) : [],
    references: Array.isArray(obj.references) ? obj.references.slice(0, 10).map(String) : [],
  }
}

function escapeLatex(value: string): string {
  return value
    .replace(/\\/g, '\\textbackslash{}')
    .replace(/([#$%&_{}])/g, '\\$1')
    .replace(/\^/g, '\\textasciicircum{}')
    .replace(/~/g, '\\textasciitilde{}')
}

function latexParagraphs(value: string): string {
  return escapeLatex(value)
    .replace(/\n\s*\n/g, '\n\n')
    .replace(/\n/g, ' ')
}

function latexBullets(items: string[] | undefined): string {
  if (!items || items.length === 0) return ''
  return [
    '\\begin{itemize}',
    ...items.map((item) => `\\item ${latexParagraphs(item)}`),
    '\\end{itemize}',
  ].join('\n')
}

function latexTable(table: DispensaTable | undefined): string {
  if (!table || table.columns.length === 0) return ''
  const cols = table.columns.map(() => 'p{0.18\\textwidth}').join('|')
  return [
    '\\begin{center}',
    `\\begin{longtable}{|${cols}|}`,
    '\\hline',
    `${table.columns.map((column) => `\\textbf{${escapeLatex(column)}}`).join(' & ')} \\\\ \\hline`,
    ...table.rows.map((row) => `${row.map((cell) => escapeLatex(cell)).join(' & ')} \\\\ \\hline`),
    '\\end{longtable}',
    '\\end{center}',
  ].join('\n')
}

export function buildDispensaLatex(payloadOrRaw: string, fallbackTitle = 'Dispensa', authorName = 'Docente'): string | null {
  const payload = typeof payloadOrRaw === 'string' ? parseDispensaPayload(payloadOrRaw) : null
  if (!payload) return null

  const blockEnv: Record<DispensaBlock['kind'], string> = {
    definition: 'definitionbox',
    theorem: 'theorembox',
    example: 'examplebox',
    warning: 'warningbox',
    note: 'notebox',
  }

  const sections = payload.sections.map((section) => {
    const blocks = (section.blocks || []).map((block) => [
      `\\begin{${blockEnv[block.kind]}}{${escapeLatex(block.title)}}`,
      latexParagraphs(block.content),
      `\\end{${blockEnv[block.kind]}}`,
    ].join('\n')).join('\n\n')

    const summaries = section.summaryPoints?.length
      ? ['\\begin{keypoints}', ...section.summaryPoints.map((point) => `\\item ${latexParagraphs(point)}`), '\\end{keypoints}'].join('\n')
      : ''

    return [
      `\\section{${escapeLatex(section.title)}}`,
      latexParagraphs(section.intro),
      blocks,
      latexBullets(section.bulletPoints),
      latexTable(section.table),
      summaries,
    ].filter(Boolean).join('\n\n')
  }).join('\n\n')

  const exercises = payload.exercises && payload.exercises.length > 0
    ? [
        '\\section*{Esercizi}',
        ...payload.exercises.map((exercise) => [
          `\\begin{exercisebox}{${escapeLatex(exercise.title)}}`,
          latexParagraphs(exercise.prompt),
          exercise.solution ? `\\textbf{Soluzione proposta.} ${latexParagraphs(exercise.solution)}` : '',
          '\\end{exercisebox}',
        ].filter(Boolean).join('\n')),
      ].join('\n\n')
    : ''

  const references = payload.references && payload.references.length > 0
    ? [
        '\\section*{Riferimenti}',
        '\\begin{itemize}',
        ...payload.references.map((ref) => `\\item ${latexParagraphs(ref)}`),
        '\\end{itemize}',
      ].join('\n')
    : ''

  return String.raw`\documentclass[11pt,a4paper]{article}
\usepackage[italian]{babel}
\usepackage[T1]{fontenc}
\usepackage[utf8]{inputenc}
\usepackage{lmodern}
\usepackage[a4paper,margin=2.1cm]{geometry}
\usepackage{setspace}
\usepackage{microtype}
\usepackage{xcolor}
\usepackage{titlesec}
\usepackage{fancyhdr}
\usepackage{longtable}
\usepackage{booktabs}
\usepackage{array}
\usepackage{amsmath,amssymb,amsthm}
\usepackage{enumitem}
\usepackage{tcolorbox}
\usepackage{hyperref}
\usepackage{listings}
\usepackage{parskip}
\usepackage{tikz}
\setstretch{1.08}
\hypersetup{colorlinks=true,linkcolor=black,urlcolor=blue!50!black}
\definecolor{brand}{HTML}{1A1A2E}
\definecolor{accent}{HTML}{E85C8D}
\definecolor{soft}{HTML}{F7F5F8}
\definecolor{softaccent}{HTML}{F3D8E3}
\definecolor{textmuted}{HTML}{6A6377}
\titleformat{\section}{\Large\bfseries\color{brand}}{\colorbox{softaccent}{\textcolor{accent}{\thesection}}}{0.85em}{}
\titlespacing*{\section}{0pt}{2.1em}{0.85em}
\pagestyle{fancy}
\fancyhf{}
\fancyhead[L]{${escapeLatex(payload.title || fallbackTitle)}}
\fancyhead[R]{\textcolor{textmuted}{Dispensa AI}}
\fancyfoot[C]{\thepage}
\newtcolorbox{definitionbox}[1]{enhanced,colback=blue!3,colframe=blue!55!black,title=\textbf{#1},arc=2.2mm,left=2mm,right=2mm,top=1.5mm,bottom=1.5mm}
\newtcolorbox{theorembox}[1]{enhanced,colback=violet!3,colframe=violet!55!black,title=\textbf{#1},arc=2.2mm,left=2mm,right=2mm,top=1.5mm,bottom=1.5mm}
\newtcolorbox{examplebox}[1]{enhanced,colback=green!3,colframe=green!45!black,title=\textbf{#1},arc=2.2mm,left=2mm,right=2mm,top=1.5mm,bottom=1.5mm}
\newtcolorbox{warningbox}[1]{enhanced,colback=accent!4,colframe=accent!85!black,title=\textbf{#1},arc=2.2mm,left=2mm,right=2mm,top=1.5mm,bottom=1.5mm}
\newtcolorbox{notebox}[1]{enhanced,colback=gray!5,colframe=gray!60!black,title=\textbf{#1},arc=2.2mm,left=2mm,right=2mm,top=1.5mm,bottom=1.5mm}
\newtcolorbox{exercisebox}[1]{enhanced,colback=soft,colframe=brand!45,title=\textbf{#1},arc=2.2mm,left=2mm,right=2mm,top=1.5mm,bottom=1.5mm}
\newenvironment{keypoints}{\begin{tcolorbox}[enhanced,colback=soft,colframe=brand!45,title=\textbf{Punti chiave},arc=2.2mm,left=2mm,right=2mm,top=1.5mm,bottom=1.5mm]\begin{itemize}[leftmargin=*]}{\end{itemize}\end{tcolorbox}}
\begin{document}
\begin{titlepage}
\centering
\begin{tcolorbox}[enhanced,colback=soft,colframe=brand!20,arc=4mm,width=\textwidth,boxrule=0.7pt,left=7mm,right=7mm,top=6mm,bottom=6mm]
{\Large\color{accent}\textbf{Dispensa AI}}\\[0.8cm]
{\Huge\bfseries\color{brand} ${escapeLatex(payload.title || fallbackTitle)}}\\[0.35cm]
{\large\color{textmuted} ${escapeLatex(payload.subtitle || '')}}\\[1.05cm]
\textcolor{brand}{\textbf{Autore.}} ${escapeLatex(authorName)} \quad \textcolor{brand}{\textbf{Collaborazione.}} AI collaborator\\[0.7cm]
\begin{tcolorbox}[enhanced,colback=white,colframe=accent!35,arc=3mm,width=\textwidth,boxrule=0.5pt]
\textbf{Abstract.} ${latexParagraphs(payload.abstract)}
\end{tcolorbox}
${payload.objectives && payload.objectives.length > 0 ? `\\vspace{0.4cm}\n\\textbf{Obiettivi didattici}\n${latexBullets(payload.objectives)}` : ''}
\vspace{0.9cm}
{\small\color{textmuted} Generato con composizione strutturata e resa editoriale coerente con il sistema visivo del sito.}
\end{tcolorbox}
\end{titlepage}
\tableofcontents
\newpage
${sections}
${exercises}
${references}
\end{document}`
}

export function buildBrochureLatex(payloadOrRaw: string, fallbackTitle = 'Brochure', authorName = 'Docente'): string | null {
  const payload = typeof payloadOrRaw === 'string' ? parseBrochurePayload(payloadOrRaw) : null
  if (!payload) return null

  return String.raw`\documentclass[11pt,a4paper]{article}
\usepackage[italian]{babel}
\usepackage[T1]{fontenc}
\usepackage[utf8]{inputenc}
\usepackage{lmodern}
\usepackage[a4paper,margin=1.8cm]{geometry}
\usepackage{xcolor}
\usepackage{multicol}
\usepackage{parskip}
\usepackage{tcolorbox}
\usepackage{enumitem}
\definecolor{brand}{HTML}{1A1A2E}
\definecolor{accent}{HTML}{E85C8D}
\definecolor{soft}{HTML}{F7F5F8}
\definecolor{textmuted}{HTML}{6A6377}
\begin{document}
\begin{center}
{\Large\color{accent}\textbf{${escapeLatex(payload.heroBadge || 'Brochure')}}}\\[0.3cm]
{\Huge\bfseries ${escapeLatex(payload.title || fallbackTitle)}}\\[0.2cm]
{\large\color{textmuted} ${escapeLatex(payload.subtitle || '')}}\\[0.4cm]
{\normalsize ${escapeLatex(authorName)} \,·\, AI collaborator}
\end{center}
\begin{tcolorbox}[enhanced,colback=soft,colframe=brand!20,arc=3mm,boxrule=0.6pt]
${latexParagraphs(payload.heroDescription)}
\end{tcolorbox}
\begin{multicols}{2}
\section*{Panoramica}
${latexParagraphs(payload.overviewLead || '')}
${latexBullets(payload.keyPoints)}
\section*{Benefici}
${latexBullets(payload.benefits)}
\columnbreak
\section*{Caratteristiche}
\begin{itemize}[leftmargin=*]
${payload.features.map((feature) => `\\item \\textbf{${escapeLatex(feature.title)}} ${latexParagraphs(feature.description)}`).join('\n')}
\end{itemize}
\section*{Percorso}
${latexBullets(payload.steps)}
\end{multicols}
${payload.faq.length > 0 ? `\\section*{FAQ}\n${payload.faq.map((entry) => `\\paragraph{${escapeLatex(entry.question)}} ${latexParagraphs(entry.answer)}`).join('\n\n')}` : ''}
${payload.closingText ? `\\vspace{0.4cm}\n\\begin{tcolorbox}[colback=brand!4,colframe=accent,title=\\textbf{${escapeLatex(payload.closingTitle || 'Chiusura')}}]\n${latexParagraphs(payload.closingText)}\n\\end{tcolorbox}` : ''}
\end{document}`
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function buildFallbackHtml(raw: string, title: string): string {
  return `<!DOCTYPE html>
<html lang="it">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>${escapeHtml(title)}</title>
<style>
body{margin:0;font-family:Inter,system-ui,sans-serif;background:#f7f3ed;color:#1c2731;padding:32px}
.card{max-width:960px;margin:0 auto;background:#fff;border:1px solid #e7ddd1;border-radius:24px;padding:32px;box-shadow:0 20px 60px rgba(30,40,50,.08)}
pre{white-space:pre-wrap;line-height:1.6;font-family:inherit}
</style>
</head>
<body><div class="card"><h1>${escapeHtml(title)}</h1><pre>${escapeHtml(raw)}</pre></div></body>
</html>`
}

export function buildReportHtml(payloadOrRaw: string, fallbackTitle = 'Report'): string {
  const payload = parseReportPayload(payloadOrRaw)
  if (!payload) return buildFallbackHtml(payloadOrRaw, fallbackTitle)

  const charts = payload.charts.map((chart, index) => ({
    ...chart,
    color: chart.color || DEFAULT_COLORS[index % DEFAULT_COLORS.length],
  }))
  const safePayload = JSON.stringify({ ...payload, charts }).replace(/</g, '\\u003c')
  const safePalette = JSON.stringify(DEFAULT_COLORS).replace(/</g, '\\u003c')

  const metricsHtml = payload.metrics.map((metric) => `
    <article class="metric-card">
      <div class="metric-label">${escapeHtml(metric.label)}</div>
      <div class="metric-value">${escapeHtml(metric.value)}</div>
      ${metric.trend ? `<div class="metric-trend">${escapeHtml(metric.trend)}</div>` : ''}
      ${metric.detail ? `<div class="metric-detail">${escapeHtml(metric.detail)}</div>` : ''}
    </article>
  `).join('')

  const chartPanelsHtml = charts.map((chart) => `
    <article class="panel">
      <div class="panel-head">
        <h3>${escapeHtml(chart.title)}</h3>
        ${chart.description ? `<p>${escapeHtml(chart.description)}</p>` : ''}
      </div>
      <div class="chart-wrap"><canvas id="${escapeHtml(chart.id)}"></canvas></div>
    </article>
  `).join('')

  const leaderboardHtml = payload.leaderboard.map((row, index) => `
    <li class="leader-row">
      <div class="leader-rank">${index + 1}</div>
      <div class="leader-main">
        <div class="leader-name">${escapeHtml(row.name)}</div>
        ${row.detail ? `<div class="leader-detail">${escapeHtml(row.detail)}</div>` : ''}
      </div>
      <div class="leader-side">
        ${row.badge ? `<span class="leader-badge">${escapeHtml(row.badge)}</span>` : ''}
        ${row.score ? `<strong>${escapeHtml(row.score)}</strong>` : ''}
      </div>
    </li>
  `).join('')

  const listSection = (title: string, items: string[], tone: 'good' | 'risk' | 'action') => `
    <article class="panel">
      <div class="panel-head"><h3>${escapeHtml(title)}</h3></div>
      <ul class="bullet-list ${tone}">
        ${items.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}
      </ul>
    </article>
  `

  const tablesHtml = (payload.tables || []).map((table) => `
    <article class="panel full">
      <div class="panel-head"><h3>${escapeHtml(table.title)}</h3></div>
      <div class="table-wrap">
        <table>
          <thead><tr>${table.columns.map((column) => `<th>${escapeHtml(column)}</th>`).join('')}</tr></thead>
          <tbody>
            ${table.rows.map((row) => `<tr>${row.map((cell) => `<td>${escapeHtml(cell)}</td>`).join('')}</tr>`).join('')}
          </tbody>
        </table>
      </div>
    </article>
  `).join('')

  return `<!DOCTYPE html>
<html lang="it">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>${escapeHtml(payload.title)}</title>
<script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
<style>
:root{--bg:#f6efe7;--ink:#182733;--muted:#6a6258;--line:#e5d9cc;--card:#fffdf9;--accent:#d97745;--accent2:#1f3b53;--soft:#f0e3d6;--ok:#6d9f6c;--warn:#bb6b54}
*{box-sizing:border-box}html,body{margin:0;padding:0;font-family:Inter,system-ui,sans-serif;background:var(--bg);color:var(--ink)}
body{background:
radial-gradient(circle at top left,rgba(217,119,69,.18),transparent 26%),
radial-gradient(circle at 85% 10%,rgba(31,59,83,.15),transparent 22%),
linear-gradient(180deg,#f8f1e9 0%,#f1e7dc 100%)}
.shell{max-width:1440px;margin:0 auto;padding:28px}
.hero{display:grid;grid-template-columns:1.3fr .9fr;gap:18px;margin-bottom:18px}
.hero-main,.hero-side,.panel{background:rgba(255,253,249,.92);backdrop-filter:blur(10px);border:1px solid var(--line);border-radius:24px;box-shadow:0 16px 50px rgba(24,39,51,.08)}
.hero-main{padding:28px 30px}
.eyebrow{display:inline-flex;align-items:center;gap:8px;padding:8px 12px;border-radius:999px;background:var(--soft);color:var(--accent2);font-size:12px;font-weight:700;letter-spacing:.08em;text-transform:uppercase}
h1{margin:16px 0 10px;font-size:clamp(2rem,4vw,3.4rem);line-height:1.02}
.hero-sub{margin:0 0 14px;color:var(--muted);font-size:1rem;line-height:1.7}
.summary{font-size:1rem;line-height:1.8}
.hero-side{padding:22px}
.mini-note{font-size:12px;color:var(--muted);text-transform:uppercase;letter-spacing:.08em;font-weight:700;margin-bottom:10px}
.template-tag{display:inline-flex;padding:8px 10px;border-radius:999px;background:#182733;color:#fff;font-size:12px;font-weight:700}
.tabs{display:flex;gap:10px;flex-wrap:wrap;margin-top:16px}
.tab{border:none;background:#efe3d7;color:#5d5044;padding:9px 14px;border-radius:999px;font-weight:700;cursor:pointer}
.tab.active{background:#182733;color:#fff}
.metrics{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:14px;margin-bottom:18px}
.metric-card{background:var(--card);border:1px solid var(--line);border-radius:20px;padding:18px}
.metric-label{font-size:12px;text-transform:uppercase;letter-spacing:.08em;color:var(--muted);font-weight:700}
.metric-value{font-size:2rem;font-weight:800;margin:8px 0}
.metric-trend{font-size:13px;font-weight:700;color:var(--accent2)}
.metric-detail{font-size:13px;color:var(--muted);margin-top:6px}
.grid{display:grid;grid-template-columns:1.2fr .8fr;gap:18px}
.stack{display:grid;gap:18px}
.panel{padding:22px}
.panel.full{grid-column:1/-1}
.panel-head h3{margin:0;font-size:1.15rem}
.panel-head p{margin:8px 0 0;color:var(--muted);line-height:1.6}
.chart-wrap{margin-top:14px;height:300px}
.leaderboard{list-style:none;padding:0;margin:14px 0 0;display:grid;gap:10px}
.leader-row{display:grid;grid-template-columns:44px 1fr auto;gap:14px;align-items:center;padding:12px 14px;border-radius:18px;background:#fbf7f2;border:1px solid var(--line)}
.leader-rank{width:44px;height:44px;border-radius:16px;background:#182733;color:#fff;display:flex;align-items:center;justify-content:center;font-weight:800}
.leader-name{font-weight:700}
.leader-detail{font-size:13px;color:var(--muted);margin-top:4px}
.leader-side{display:flex;align-items:center;gap:10px}
.leader-badge{padding:6px 10px;border-radius:999px;background:#ead6c4;color:#6b492d;font-size:12px;font-weight:700}
.bullet-list{padding-left:18px;margin:14px 0 0;display:grid;gap:10px}
.bullet-list li{line-height:1.7}
.bullet-list.good li::marker{color:var(--ok)}
.bullet-list.risk li::marker{color:var(--warn)}
.bullet-list.action li::marker{color:var(--accent)}
.table-wrap{overflow:auto;margin-top:14px}
table{width:100%;border-collapse:collapse;background:#fff}
th,td{padding:12px 14px;border-bottom:1px solid var(--line);text-align:left;font-size:14px}
th{font-size:12px;text-transform:uppercase;letter-spacing:.08em;color:var(--muted)}
.foot{display:grid;grid-template-columns:1fr 1fr;gap:18px;margin-top:18px}
.method{font-size:14px;line-height:1.7;color:var(--muted)}
.assumptions{display:grid;gap:8px;margin-top:12px}
.assumption{padding:10px 12px;border-radius:14px;background:#f7efe5;border:1px solid var(--line);font-size:13px;color:#5b5349}
@media(max-width:1100px){.hero,.grid,.foot,.metrics{grid-template-columns:1fr}.chart-wrap{height:260px}}
@media(max-width:720px){.shell{padding:16px}.hero-main,.hero-side,.panel{border-radius:20px;padding:18px}.metric-value{font-size:1.7rem}.leader-row{grid-template-columns:36px 1fr}.leader-rank{width:36px;height:36px;border-radius:12px}}
</style>
</head>
<body>
<div class="shell">
  <section class="hero">
    <div class="hero-main">
      <div class="eyebrow">Report Interattivo Docente</div>
      <h1>${escapeHtml(payload.title)}</h1>
      <p class="hero-sub">${escapeHtml(payload.subtitle)}</p>
      <div class="summary">${escapeHtml(payload.summary)}</div>
      <div class="tabs">
        <button class="tab active" data-target="overview">Overview</button>
        <button class="tab" data-target="charts">Grafici</button>
        <button class="tab" data-target="ranking">Classifiche</button>
        <button class="tab" data-target="actions">Azioni</button>
      </div>
    </div>
    <aside class="hero-side">
      <div class="mini-note">Template</div>
      <div class="template-tag">${escapeHtml(TEMPLATE_TITLES[payload.templateId])}</div>
      <div class="mini-note" style="margin-top:18px">Compilazione</div>
      <div class="method">Layout e interazioni sono generati dal template locale. Il modello compila soltanto contenuti variabili, KPI, grafici e insight.</div>
    </aside>
  </section>

  <section id="overview" class="view">
    <div class="metrics">${metricsHtml}</div>
    <div class="grid">
      <div class="stack">
        ${chartPanelsHtml || `<article class="panel"><div class="panel-head"><h3>Grafici</h3><p>Nessun grafico disponibile.</p></div></article>`}
      </div>
      <div class="stack">
        <article class="panel">
          <div class="panel-head"><h3>Classifica / Segmentazione</h3></div>
          <ol class="leaderboard">${leaderboardHtml || '<li class="leader-row"><div class="leader-rank">-</div><div class="leader-main"><div class="leader-name">Nessun dato</div></div><div class="leader-side"></div></li>'}</ol>
        </article>
        ${listSection('Punti di forza', payload.strengths, 'good')}
        ${listSection('Criticità', payload.risks, 'risk')}
      </div>
    </div>
    ${tablesHtml}
    <div class="foot">
      ${listSection('Azioni consigliate', payload.recommendations, 'action')}
      <article class="panel">
        <div class="panel-head"><h3>Note metodologiche</h3></div>
        <div class="method">${escapeHtml(payload.methodology || 'Dati sintetizzati dal report di sessione disponibile nel chatbot docente.')}</div>
        ${(payload.assumptions || []).length ? `<div class="assumptions">${payload.assumptions!.map((item) => `<div class="assumption">${escapeHtml(item)}</div>`).join('')}</div>` : ''}
      </article>
    </div>
  </section>
</div>
<script id="report-data" type="application/json">${safePayload}</script>
<script id="report-palette" type="application/json">${safePalette}</script>
<script>
const reportData=JSON.parse(document.getElementById('report-data').textContent);
const palette=JSON.parse(document.getElementById('report-palette').textContent);
const tabs=[...document.querySelectorAll('.tab')];
tabs.forEach((tab)=>tab.addEventListener('click',()=>{
  tabs.forEach((candidate)=>candidate.classList.remove('active'));
  tab.classList.add('active');
  const target=tab.dataset.target;
  const chartsSection=document.querySelector('.grid');
  const rankingCards=[...document.querySelectorAll('.panel')];
  rankingCards.forEach((panel)=>panel.style.opacity='1');
  if(target==='charts'){
    rankingCards.forEach((panel,index)=>{ if(index>2) panel.style.opacity='.35'; });
    chartsSection.scrollIntoView({behavior:'smooth', block:'start'});
  } else if(target==='ranking'){
    const leaderboard=document.querySelector('.leaderboard');
    if(leaderboard) leaderboard.scrollIntoView({behavior:'smooth', block:'start'});
  } else if(target==='actions'){
    const foot=document.querySelector('.foot');
    if(foot) foot.scrollIntoView({behavior:'smooth', block:'start'});
  } else {
    window.scrollTo({top:0,behavior:'smooth'});
  }
}));
const chartDefaults={borderRadius:10,borderSkipped:false};
reportData.charts.forEach((chart, index)=>{
  const canvas=document.getElementById(chart.id);
  if(!canvas || !window.Chart) return;
  const color=chart.color||'${DEFAULT_COLORS[0]}';
  new Chart(canvas,{
    type:chart.type,
    data:{
      labels:chart.labels,
      datasets:[{
        label:chart.title,
        data:chart.values,
        backgroundColor:chart.type==='doughnut'?chart.values.map((_,i)=>palette[i%palette.length] || color):color+'CC',
        borderColor:chart.type==='line'?color:color,
        borderWidth:2,
        fill:chart.type==='line',
        tension:.35,
        ...chartDefaults
      }]
    },
    options:{
      responsive:true,
      maintainAspectRatio:false,
      plugins:{legend:{display:chart.type==='doughnut'||chart.type==='radar'},tooltip:{enabled:true}},
      scales:chart.type==='doughnut'||chart.type==='radar'?{}:{y:{beginAtZero:true,grid:{color:'rgba(24,39,51,.08)'}},x:{grid:{display:false}}}
    }
  });
});
</script>
</body>
</html>`
}
