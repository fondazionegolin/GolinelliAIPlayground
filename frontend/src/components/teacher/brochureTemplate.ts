import { parseBrochurePayload } from './reportTemplates'
import { brochureLabels } from './brochureLabels'

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

/* Print — preserve colors and layout */
@media print{
  *{-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important}
  body{margin:0!important}
  section{break-inside:avoid;page-break-inside:avoid}
  .hero{min-height:auto;page-break-after:avoid}
  footer{break-inside:avoid}
  details{open:true}
  details p{display:block!important}
}
`

const BROCHURE_FONTS = `https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&family=Playfair+Display:ital,wght@0,700;0,900;1,700&display=swap`

export function buildBrochureHtml(sections: string, docTitle: string, language = 'it', footer = brochureLabels(language).footer): string {
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
  const linkGuardScript = `
<script>
document.addEventListener('click', function(event) {
  var link = event.target && event.target.closest ? event.target.closest('a[href]') : null;
  if (!link) return;
  var href = link.getAttribute('href') || '';
  if (href.charAt(0) === '#') {
    event.preventDefault();
    var target = document.getElementById(href.slice(1));
    if (target && target.scrollIntoView) target.scrollIntoView({ behavior: 'smooth' });
    try { history.replaceState(null, '', href); } catch (e) {}
    return;
  }
  if (!/^(https?:|mailto:|tel:)/i.test(href)) {
    event.preventDefault();
  }
}, true);
</script>`

  return `<!DOCTYPE html>
<html lang="${language.replace(/[^a-zA-Z-]/g, '') || 'it'}">
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
  <div class="container">${footer}</div>
</footer>
${linkGuardScript}
</body>
</html>`
}

export function buildBrochureHtmlFromPayload(raw: string, docTitle: string): string | null {
  const payload = parseBrochurePayload(raw)
  if (!payload) return null
  const labels = brochureLabels(payload.language, payload.labels)

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
        <div class="section-label">${labels.overview}</div>
        <h2 class="section-title">${payload.overviewTitle || payload.title}</h2>
        <p class="section-lead">${payload.overviewLead || payload.subtitle}</p>
        ${payload.keyPoints.length > 0 ? `<ul class="key-list">
          ${payload.keyPoints.map((point) => `<li><span class="icon">✦</span><span>${point}</span></li>`).join('')}
        </ul>` : ''}
      </div>
    </section>
    ${payload.features.length > 0 ? `
    <section id="features" style="background:#fff;color:#1a1a2e">
      <div class="container">
        <div class="section-label">${labels.features}</div>
        <h2 class="section-title">${labels.featuresTitle}</h2>
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
    </section>` : ''}
    ${payload.benefits.length > 0 ? `
    <section id="benefits" style="background:${payload.palette?.[2] || '#2c6b8a'};color:#fff">
      <div class="container">
        <div class="section-label">${labels.benefits}</div>
        <h2 class="section-title">${labels.benefitsTitle}</h2>
        <ul class="benefit-list">
          ${payload.benefits.map((benefit, index) => `
            <li>
              <div class="benefit-num">${String(index + 1).padStart(2, '0')}</div>
              <div><div class="benefit-title">${labels.benefit} ${index + 1}</div><div class="benefit-desc">${benefit}</div></div>
            </li>
          `).join('')}
        </ul>
      </div>
    </section>` : ''}
    ${payload.steps.length > 0 ? `
    <section id="method" style="background:${payload.palette?.[0] || '#1a1a2e'};color:#fff">
      <div class="container">
        <div class="section-label">${labels.method}</div>
        <h2 class="section-title">${labels.methodTitle}</h2>
        <ul class="steps-list">
          ${payload.steps.map((step, index) => `
            <li>
              <div class="step-num">${index + 1}</div>
              <div><div class="step-title">${labels.step} ${index + 1}</div><div class="step-desc">${step}</div></div>
            </li>
          `).join('')}
        </ul>
      </div>
    </section>` : ''}
    ${payload.stats.length > 0 ? `
    <section id="stats" style="background:${payload.palette?.[3] || '#7aa65a'};color:#fff">
      <div class="container">
        <div class="section-label">${labels.stats}</div>
        <h2 class="section-title">${labels.statsTitle}</h2>
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
    </section>` : ''}
    ${payload.faq.length > 0 ? `
    <section id="faq" style="background:#fff;color:#1a1a2e">
      <div class="container">
        <div class="section-label">${labels.faq}</div>
        <h2 class="section-title">${labels.faqTitle}</h2>
        <div class="faq-list">
          ${payload.faq.map((item) => `<details><summary>❓ ${item.question}</summary><p>${item.answer}</p></details>`).join('')}
        </div>
      </div>
    </section>` : ''}
    <section id="cta" style="background:${payload.palette?.[1] || '#d97745'};color:#fff">
      <div class="container">
        <div class="section-label">${labels.closing}</div>
        <h2 class="section-title">${payload.closingTitle || labels.closing}</h2>
        <p class="section-lead">${payload.closingText || payload.subtitle}</p>
        ${payload.closingQuote ? `<div class="quote-block"><div class="quote-text">${payload.closingQuote}</div>${payload.closingAuthor ? `<div class="quote-author">${payload.closingAuthor}</div>` : ''}</div>` : ''}
        <div class="hero-cta">
          <a class="btn-primary" href="#hero">${payload.ctaPrimary || 'Inizia'}</a>
          <a class="btn-outline" href="#overview">${payload.ctaSecondary || 'Rivedi overview'}</a>
        </div>
      </div>
    </section>
  `

  return buildBrochureHtml(`<!-- TITLE: ${payload.title} | PALETTE: ${palette} -->${sections}`, docTitle, payload.language, labels.footer)
}

