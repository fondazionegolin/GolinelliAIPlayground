import { useEffect, useMemo, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { Loader2 } from 'lucide-react'
import { codingApi } from '@/lib/api'
import CodingSandpackPreview from '@/components/coding/CodingSandpackPreview'

// New projects are real React apps (rendered by Sandpack); legacy ones are static HTML/CSS/JS.
function isReactProject(files: PublishedFile[]): boolean {
  if (files.some((f) => /\.(tsx|jsx)$/i.test(f.path))) return true
  const pkg = files.find((f) => f.path.replace(/^\.?\//, '') === 'package.json')
  return Boolean(pkg && /"react"\s*:/.test(pkg.content))
}

type PublishedFile = {
  path: string
  content: string
  language?: string
}

type PublishedSite = {
  title: string
  slug: string
  files: PublishedFile[]
}

export default function PublicCodingSitePage() {
  const { slug = '' } = useParams()
  const [site, setSite] = useState<PublishedSite | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [frameNonce, setFrameNonce] = useState(0)
  const frameLoads = useRef(0)
  const frameResets = useRef(0)

  useEffect(() => {
    let active = true
    setLoading(true)
    setError(null)
    codingApi.getPublicProject(slug)
      .then((response) => {
        if (active) setSite(response.data as PublishedSite)
      })
      .catch((err) => {
        if (active) setError(err?.response?.data?.detail || 'Sito non trovato.')
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [slug])

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      const data = (event.data || {}) as { source?: string; action?: string; url?: string }
      if (data.source !== 'golinelli-coding-preview' || data.action !== 'openExternalLink') return
      const url = String(data.url || '')
      if (/^https?:\/\//i.test(url)) window.open(url, '_blank', 'noopener,noreferrer')
    }
    window.addEventListener('message', handleMessage)
    return () => window.removeEventListener('message', handleMessage)
  }, [])

  const isReact = useMemo(() => (site ? isReactProject(site.files) : false), [site])
  const html = useMemo(() => (site && !isReact ? buildPublicHtml(site.files, site.title) : ''), [site, isReact])

  // Safety net: if the sandboxed iframe navigates away from its srcDoc (e.g. generated
  // JS does location.href = '...'), remount it instead of letting it load the platform SPA.
  useEffect(() => { frameLoads.current = 0 }, [frameNonce])
  useEffect(() => { frameLoads.current = 0; frameResets.current = 0 }, [html])
  const handleFrameLoad = () => {
    frameLoads.current += 1
    if (frameLoads.current > 1 && frameResets.current < 5) {
      frameResets.current += 1
      setFrameNonce((value) => value + 1)
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 text-slate-500">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" />
        Caricamento sito...
      </div>
    )
  }

  if (error || !site) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 p-6">
        <div className="max-w-md rounded-xl border border-slate-200 bg-white p-6 text-center shadow-sm">
          <h1 className="text-base font-bold text-slate-900">Sito non disponibile</h1>
          <p className="mt-2 text-sm text-slate-500">{error || 'La pubblicazione richiesta non esiste.'}</p>
        </div>
      </div>
    )
  }

  if (isReact) {
    return <CodingSandpackPreview files={site.files} enableInspector={false} className="h-screen w-screen" />
  }

  return (
    <iframe
      key={frameNonce}
      title={site.title}
      srcDoc={html}
      sandbox="allow-scripts allow-forms"
      referrerPolicy="no-referrer"
      onLoad={handleFrameLoad}
      className="h-screen w-screen border-0 bg-white"
    />
  )
}

function buildPublicHtml(files: PublishedFile[], title: string, entryPath = 'index.html') {
  const byPath = new Map(files.map((file) => [file.path, file.content]))
  const html = byPath.get(entryPath) || byPath.get('index.html') || `<!doctype html><html lang="it"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>${escapeHtml(title)}</title><link rel="stylesheet" href="styles.css"></head><body><main id="app"></main><script src="script.js"></script></body></html>`
  const css = byPath.get('styles.css') || ''
  const js = byPath.get('script.js') || ''
  const wrappedJs = js ? `(() => {\n${js}\n})();` : ''

  let output = html
    .replace(/<link[^>]+href=["']styles\.css["'][^>]*>/i, `<style>${css}</style>`)
    .replace(/<script[^>]+src=["']script\.js["'][^>]*>\s*<\/script>/i, `<script>${wrappedJs}<\/script>`)

  if (!/<style[\s>]/i.test(output) && css) {
    output = output.replace(/<\/head>/i, `<style>${css}</style></head>`)
  }
  if (!/<script[\s>]/i.test(output) && wrappedJs) {
    output = output.replace(/<\/body>/i, `<script>${wrappedJs}<\/script></body>`)
  }
  return injectPublicRouter(output, files, title)
}

function injectPublicRouter(html: string, files: PublishedFile[], title: string) {
  const htmlFiles = Object.fromEntries(
    files
      .filter((file) => file.path.endsWith('.html'))
      .map((file) => [file.path, file.content]),
  )
  const css = files.find((file) => file.path === 'styles.css')?.content || ''
  const js = files.find((file) => file.path === 'script.js')?.content || ''
  const payload = JSON.stringify({ htmlFiles, css, js, title }).replace(/</g, '\\u003c')
  const runtime = `<script>
(() => {
  const site = ${payload};
  function pageCandidate(value) {
    const clean = String(value || '').replace(/^#/, '').replace(/^\\.\\//, '').split('#')[0].split('?')[0].replace(/^\\//, '');
    if (!clean || clean === '/') return '';
    return clean.endsWith('.html') ? clean : clean + '.html';
  }
  function normalizePath(raw) {
    let hashCandidate = '';
    let pathCandidate = '';
    try {
      const url = new URL(raw, window.location.href);
      hashCandidate = pageCandidate(url.hash.slice(1));
      pathCandidate = pageCandidate(url.pathname.split('/').pop() || '');
    } catch {}
    const rawHash = String(raw || '').split('#')[1] || '';
    hashCandidate = hashCandidate || pageCandidate(rawHash);
    pathCandidate = pathCandidate || pageCandidate(String(raw || '').split('#')[0]);
    if (hashCandidate && site.htmlFiles[hashCandidate]) return hashCandidate;
    if (pathCandidate && site.htmlFiles[pathCandidate]) return pathCandidate;
    return pathCandidate || '';
  }
  function renderPage(path, push = true) {
    const nextPath = normalizePath(path);
    const nextHtml = site.htmlFiles[nextPath];
    if (!nextHtml) return false;
    const parser = new DOMParser();
    const doc = parser.parseFromString(nextHtml, 'text/html');
    document.title = doc.querySelector('title')?.textContent || site.title || document.title;
    document.querySelectorAll('[data-published-page-head]').forEach((node) => node.remove());
    doc.head.querySelectorAll('style').forEach((node) => {
      const style = document.createElement('style');
      style.setAttribute('data-published-page-head', 'true');
      style.textContent = node.textContent || '';
      document.head.appendChild(style);
    });
    if (site.css) {
      document.getElementById('published-shared-css')?.remove();
      const style = document.createElement('style');
      style.id = 'published-shared-css';
      style.textContent = site.css;
      document.head.appendChild(style);
    }
    const inlineScripts = [];
    doc.querySelectorAll('script').forEach((node) => {
      const src = node.getAttribute('src') || '';
      if (/script\\.js$/i.test(src)) return;
      if (node.textContent) inlineScripts.push(node.textContent);
      node.remove();
    });
    document.body.innerHTML = doc.body.innerHTML;
    if (site.js) {
      const script = document.createElement('script');
      script.textContent = '(() => {\\n' + site.js + '\\n})();';
      document.body.appendChild(script);
    }
    inlineScripts.forEach((source) => {
      const script = document.createElement('script');
      script.textContent = source;
      document.body.appendChild(script);
    });
    if (push) { try { history.pushState({ path: nextPath }, '', '#' + nextPath); } catch (_) {} }
    return true;
  }
  function openExternal(url) {
    window.parent.postMessage({ source: 'golinelli-coding-preview', action: 'openExternalLink', url: url }, '*');
  }
  document.addEventListener('click', (event) => {
    const link = event.target?.closest?.('a[href]');
    if (!link) return;
    const href = link.getAttribute('href') || '';
    if (href.startsWith('mailto:') || href.startsWith('tel:')) return;
    if (href.startsWith('http://') || href.startsWith('https://')) {
      event.preventDefault();
      openExternal(href);
      return;
    }
    if (href.startsWith('#')) return;
    event.preventDefault();
    const nextPath = normalizePath(href);
    if (nextPath && site.htmlFiles[nextPath]) renderPage(nextPath);
  }, true);
  document.addEventListener('submit', (event) => { event.preventDefault(); }, true);
  window.open = function (url) {
    const target = typeof url === 'string' ? url : '';
    if (target.startsWith('http://') || target.startsWith('https://')) openExternal(target);
    return null;
  };
  window.addEventListener('popstate', (event) => renderPage(event.state?.path || location.hash.slice(1) || 'index.html', false));
})();
<\/script>`

  if (/<\/body>/i.test(html)) {
    return html.replace(/<\/body>/i, `${runtime}</body>`)
  }
  return `${html}${runtime}`
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[char] || char))
}
