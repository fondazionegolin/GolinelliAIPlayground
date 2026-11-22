/** Markdown + image helpers for generated documents (dispense, interactive pages).
 *
 * Images live in `doc.images` and are referenced from content with a short id (`img:ID`), so the LLM
 * never has to carry base64 payloads. They are resolved to data URLs only when the HTML is rendered/shared. */

export interface DocImage {
  id: string
  /** data: URL (self-contained so shared copies keep the picture). */
  src: string
  caption?: string
  source?: 'ai' | 'upload' | 'pdf'
}

const HTML_TAG = /<\/?[a-z][a-z0-9-]*(\s[^<>]*)?>/i

function escapeHtml(value: string): string {
  return value.replace(/&(?!#?\w+;)/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function escapeAttr(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')
}

/** Inline markdown → HTML. Existing HTML tags in the text are preserved (the model sometimes mixes them). */
export function mdInline(text: string): string {
  const source = String(text ?? '')
  let out = HTML_TAG.test(source) ? source : escapeHtml(source)
  const stash: string[] = []
  out = out.replace(/`([^`\n]+)`/g, (_m, code) => { stash.push(`<code>${code}</code>`); return `\u0000${stash.length - 1}\u0000` })
  out = out.replace(/!\[([^\]]*)\]\((img:[\w-]+)\)/g, (_m, caption, ref) => `<figure class="doc-figure"><img src="${ref}" alt="${escapeAttr(caption)}">${caption ? `<figcaption>${caption}</figcaption>` : ''}</figure>`)
  out = out.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>')
  out = out.replace(/\*\*\*([^*\n]+)\*\*\*/g, '<strong><em>$1</em></strong>')
  out = out.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
  out = out.replace(/__([^_\n]+)__/g, '<strong>$1</strong>')
  out = out.replace(/(^|[^*\w])\*([^*\s][^*\n]*?)\*(?!\*)/g, '$1<em>$2</em>')
  out = out.replace(/(^|[^_\w])_([^_\s][^_\n]*?)_(?![_\w])/g, '$1<em>$2</em>')
  out = out.replace(/~~([^~\n]+)~~/g, '<del>$1</del>')
  return out.replace(/\u0000(\d+)\u0000/g, (_m, i) => stash[Number(i)])
}

/** Block markdown → HTML (paragraphs, headings, lists, quotes, figures). Used for multi-line payload fields. */
export function mdBlock(text: string): string {
  const lines = String(text ?? '').replace(/\r\n?/g, '\n').split('\n')
  const html: string[] = []
  let paragraph: string[] = []
  let list: { tag: 'ul' | 'ol'; items: string[] } | null = null

  const flushParagraph = () => {
    if (paragraph.length) html.push(`<p>${mdInline(paragraph.join(' '))}</p>`)
    paragraph = []
  }
  const flushList = () => {
    if (list) html.push(`<${list.tag}>${list.items.map(item => `<li>${mdInline(item)}</li>`).join('')}</${list.tag}>`)
    list = null
  }

  for (const raw of lines) {
    const line = raw.trimEnd()
    if (!line.trim()) { flushParagraph(); flushList(); continue }
    const heading = line.match(/^(#{1,4})\s+(.+)$/)
    if (heading) {
      flushParagraph(); flushList()
      const level = Math.min(heading[1].length + 2, 6)
      html.push(`<h${level}>${mdInline(heading[2])}</h${level}>`)
      continue
    }
    const bullet = line.match(/^\s*[-*•]\s+(.+)$/)
    const numbered = line.match(/^\s*\d+[.)]\s+(.+)$/)
    if (bullet || numbered) {
      flushParagraph()
      const tag = bullet ? 'ul' : 'ol'
      if (list && list.tag !== tag) flushList()
      if (!list) list = { tag, items: [] }
      list.items.push((bullet || numbered)![1])
      continue
    }
    const quote = line.match(/^>\s?(.*)$/)
    if (quote) { flushParagraph(); flushList(); html.push(`<blockquote>${mdInline(quote[1])}</blockquote>`); continue }
    if (/^!\[[^\]]*\]\(img:[\w-]+\)\s*$/.test(line.trim())) { flushParagraph(); flushList(); html.push(mdInline(line.trim())); continue }
    flushList()
    paragraph.push(line.trim())
  }
  flushParagraph(); flushList()
  return html.join('\n')
}

/** Replace `img:ID` references (src attributes, CSS url(), markdown) with the stored data URLs. */
export function resolveDocImages(html: string, images?: DocImage[]): string {
  if (!images?.length) return html
  const byId = new Map(images.map(image => [image.id, image.src]))
  return html.replace(/img:([A-Za-z0-9_-]+)/g, (match, id) => byId.get(id) ?? match)
}

/** Short prompt hint so the model can reference the teacher's images by id without seeing the pixels. */
export function imagesPromptHint(images?: DocImage[]): string {
  if (!images?.length) return ''
  const list = images.map(image => `- img:${image.id}${image.caption ? ` — ${image.caption}` : ''}`).join('\n')
  return [
    '\nIMMAGINI DISPONIBILI (inserite dal docente; usale dove pertinenti, NON inventare altri id e NON incollare base64):',
    list,
    'Nelle pagine HTML usa <img src="img:ID" alt="..."> (con width:100%; max-width; height:auto; border-radius). Nelle dispense usa ![didascalia](img:ID) dentro i testi.',
    'Se la pagina/dispensa attuale contiene già una di queste immagini, mantienila.',
  ].join('\n')
}

export const DOC_MARKDOWN_CSS = `
.doc-figure{margin:22px 0;text-align:center}
.doc-figure img,.content img{max-width:100%;height:auto;border-radius:14px;box-shadow:0 8px 24px rgba(26,26,46,.12)}
.doc-figure figcaption{margin-top:8px;font-size:12.5px;color:#6b6878;font-style:italic}
.content code,.md-fixed code{font-family:'JetBrains Mono',monospace;font-size:.9em;background:rgba(120,120,160,.14);padding:1px 6px;border-radius:5px}
.content blockquote{border-left:3px solid #fe004d;padding:4px 14px;margin:14px 0;color:#5c5968}
`

/** Runs inside interactive pages: renders stray markdown (`**bold**`, `# Title`, `- item`) the model left in plain text. */
export const MARKDOWN_FIXUP_SCRIPT = `
(function(){
  var SKIP={SCRIPT:1,STYLE:1,PRE:1,CODE:1,TEXTAREA:1,INPUT:1,CANVAS:1,SVG:1,NOSCRIPT:1,OPTION:1,SELECT:1};
  function esc(s){return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}
  function inline(s){
    s=esc(s);
    s=s.replace(/\`([^\`\\n]+)\`/g,'<code>$1</code>');
    s=s.replace(/\\*\\*\\*([^*\\n]+)\\*\\*\\*/g,'<strong><em>$1</em></strong>');
    s=s.replace(/\\*\\*([^*\\n]+)\\*\\*/g,'<strong>$1</strong>');
    s=s.replace(/(^|[^*\\w])\\*([^*\\s][^*\\n]*?)\\*(?!\\*)/g,'$1<em>$2</em>');
    return s;
  }
  function visit(root){
    var walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT,{acceptNode:function(n){
      for(var p=n.parentNode;p&&p!==document.body;p=p.parentNode){if(SKIP[(p.nodeName||'').toUpperCase()])return NodeFilter.FILTER_REJECT}
      return /(\\*\\*[^*\\n]+\\*\\*|\\*[^*\\s][^*\\n]*\\*|\`[^\`\\n]+\`|^\\s*#{1,4}\\s+\\S)/.test(n.nodeValue||'')?NodeFilter.FILTER_ACCEPT:NodeFilter.FILTER_REJECT;
    }});
    var nodes=[];while(walker.nextNode())nodes.push(walker.currentNode);
    nodes.forEach(function(n){
      var text=n.nodeValue,h=text.match(/^\\s*(#{1,4})\\s+(.+)$/),html;
      if(h&&n.parentNode&&!/^H[1-6]$/.test(n.parentNode.nodeName)){html='<strong class="md-fixed">'+inline(h[2])+'</strong>'}
      else{html=inline(text)}
      if(html===esc(text))return;
      var span=document.createElement('span');span.className='md-fixed';span.innerHTML=html;
      n.parentNode.replaceChild(span,n);
    });
  }
  function run(){try{visit(document.body)}catch(e){}}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',run);else run();
})();
`

/** Inject the markdown fix-up script and figure styles into a full HTML document. */
export function withMarkdownFixup(html: string): string {
  const injection = `<style>${DOC_MARKDOWN_CSS}</style><script>${MARKDOWN_FIXUP_SCRIPT}</script>`
  if (/<\/body>/i.test(html)) return html.replace(/<\/body>/i, `${injection}</body>`)
  return html + injection
}
