import type { NotebookProjectType } from './types'

/** Platform colours of the three Coding Lab project types. */
export const PROJECT_COLOR: Record<'p5js' | 'python' | 'microbit', string> = { p5js: '#e85c8d', python: '#7b69c9', microbit: '#3ea9f4' }
export const colorOf = (type: NotebookProjectType) => PROJECT_COLOR[(type as keyof typeof PROJECT_COLOR)] ?? '#7b69c9'
const FILE_NAME: Record<string, string> = { p5js: 'sketch.js', python: 'notebook.py', microbit: 'main.py' }

/** What each project type typically looks like: used on the empty landing and for notebooks without code yet. */
export const SAMPLE_CODE: Record<'p5js' | 'python' | 'microbit', string> = {
  p5js: `function setup() {
  createCanvas(640, 360)
}

function draw() {
  background(248, 250, 252)
  fill(232, 92, 141)
  circle(mouseX, mouseY, 48)
}`,
  python: `import statistics

voti = [7, 8, 6, 9, 8]
media = statistics.mean(voti)
print("Media:", media)
for v in voti:
    print("█" * v, v)`,
  microbit: `from microbit import *

while True:
    luce = display.read_light_level()
    display.show(Image.HEART)
    if button_a.was_pressed():
        display.scroll(luce)
    sleep(200)`,
}

const KEYWORDS = /\b(function|const|let|var|if|else|for|while|return|import|from|def|class|in|True|False|None|print|and|or|not|await|async)\b/
const TOKEN = new RegExp(`(\\/\\/.*|#.*)|("[^"]*"|'[^']*')|(\\b\\d+(?:\\.\\d+)?\\b)|${KEYWORDS.source}`, 'g')

function Line({ text }: { text: string }) {
  const parts: React.ReactNode[] = []
  let last = 0
  for (const match of text.matchAll(TOKEN)) {
    const index = match.index ?? 0
    if (index > last) parts.push(text.slice(last, index))
    const tone = match[1] ? 'text-slate-500' : match[2] ? 'text-emerald-300' : match[3] ? 'text-amber-300' : 'text-pink-300'
    parts.push(<span key={index} className={tone}>{match[0]}</span>)
    last = index + match[0].length
  }
  if (last < text.length) parts.push(text.slice(last))
  return <>{parts}</>
}

/** Illustration of the result, drawn from the project type (static: nothing runs). */
function Artwork({ type }: { type: 'p5js' | 'python' | 'microbit' }) {
  if (type === 'p5js') {
    return (
      <svg viewBox="0 0 80 60" className="h-full w-full" aria-hidden>
        <rect width="80" height="60" rx="6" fill="#f8fafc" />
        <circle cx="22" cy="38" r="12" fill="#e85c8d" opacity="0.9" />
        <circle cx="46" cy="24" r="9" fill="#3ea9f4" opacity="0.9" />
        <circle cx="60" cy="42" r="7" fill="#7b69c9" opacity="0.9" />
        <path d="M6 52 Q26 30 44 46 T76 36" stroke="#0d9488" strokeWidth="2" fill="none" />
      </svg>
    )
  }
  if (type === 'python') {
    return (
      <svg viewBox="0 0 80 60" className="h-full w-full" aria-hidden>
        <rect width="80" height="60" rx="6" fill="#f8fafc" />
        {[34, 42, 30, 48, 40].map((h, i) => <rect key={i} x={10 + i * 13} y={54 - h} width="9" height={h} rx="2" fill={i === 3 ? '#7b69c9' : '#c4b5fd'} />)}
        <line x1="6" y1="54" x2="76" y2="54" stroke="#cbd5e1" />
      </svg>
    )
  }
  const heart = ['01010', '11111', '11111', '01110', '00100']
  return (
    <svg viewBox="0 0 80 60" className="h-full w-full" aria-hidden>
      <rect width="80" height="60" rx="6" fill="#0f172a" />
      {heart.flatMap((row, y) => row.split('').map((cell, x) => <circle key={`${x}-${y}`} cx={20 + x * 10} cy={10 + y * 10} r="3.4" fill={cell === '1' ? '#ef4444' : '#334155'} />))}
    </svg>
  )
}

/** Static preview of a project: its first lines of code next to an illustration of what that kind of project does. */
export default function ProjectPreview({ type, code, className = '' }: { type: NotebookProjectType; code?: string; className?: string }) {
  const kind: 'p5js' | 'python' | 'microbit' = type === 'p5js' || type === 'microbit' ? type : 'python'
  const lines = (code?.trim() ? code : SAMPLE_CODE[kind]).split('\n').slice(0, 8)
  return (
    <div className={`flex gap-2 overflow-hidden rounded-2xl bg-[#14161f] p-2.5 ${className}`} aria-hidden>
      <div className="relative min-w-0 flex-1 overflow-hidden">
        <div className="mb-1.5 flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-rose-400/80" /><span className="h-2 w-2 rounded-full bg-amber-300/80" /><span className="h-2 w-2 rounded-full bg-emerald-400/80" />
          <span className="ml-1 font-mono text-[9px] text-slate-500">{FILE_NAME[kind]}</span>
        </div>
        <pre className="font-mono text-[10px] leading-[1.45] text-slate-300">
          {lines.map((line, index) => <div key={index} className="truncate whitespace-pre"><Line text={line} /></div>)}
        </pre>
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-6 bg-gradient-to-t from-[#14161f] to-transparent" />
      </div>
      <div className="hidden w-[38%] shrink-0 overflow-hidden rounded-xl ring-1 ring-white/10 sm:block"><Artwork type={kind} /></div>
    </div>
  )
}
