import type { ReactNode } from 'react'

// Brand palette taken from the logo: coral pink, violet, sky blue. White carries the detail.
// Flat logo colours. Like the logo, shapes are solid but slightly translucent so overlaps show through: no gradients.
const P = '#ef4d78'
const V = '#7b69c9'
const B = '#3ea9f4'
const W = '#ffffff'
const ALPHA: Record<string, number> = { [P]: 0.94, [V]: 0.72, [B]: 0.8 }
const alpha = (c: string, o?: number) => (o ?? 1) * (ALPHA[c] ?? 1)

type RectProps = { x: number; y: number; w: number; h: number; r?: number; c: string; o?: number; rotate?: number }
const R = ({ x, y, w, h, r = 5, c, o = 1, rotate }: RectProps) => (
  <rect x={x} y={y} width={w} height={h} rx={r} fill={c} opacity={alpha(c, o)} transform={rotate ? `rotate(${rotate} ${x + w / 2} ${y + h / 2})` : undefined} />
)
const C = ({ x, y, r, c, o = 1 }: { x: number; y: number; r: number; c: string; o?: number }) => <circle cx={x} cy={y} r={r} fill={c} opacity={alpha(c, o)} />
const Line = ({ x, y, w, o = 0.9, c = W }: { x: number; y: number; w: number; o?: number; c?: string }) => <rect x={x} y={y} width={w} height={2.6} rx={1.3} fill={c} opacity={o} />
const Person = ({ x, y, c = W }: { x: number; y: number; c?: string }) => (
  <>
    <C x={x} y={y} r={3.4} c={c} />
    <path d={`M${x - 6} ${y + 11}a6 6 0 0112 0z`} fill={c} />
  </>
)
const Play = ({ x, y, s = 1, c = W }: { x: number; y: number; s?: number; c?: string }) => <path d={`M${x} ${y}l${9 * s} ${5.5 * s}l${-9 * s} ${5.5 * s}z`} fill={c} />
// Flat isometric cube: three faces, three brand colours.
const Cube = ({ x, y, s, top = B, left = V, right = P }: { x: number; y: number; s: number; top?: string; left?: string; right?: string }) => (
  <>
    <path d={`M${x} ${y - s}l${s * 0.87} ${s * 0.5}l${-s * 0.87} ${s * 0.5}l${-s * 0.87} ${-s * 0.5}z`} fill={top} opacity={alpha(top)} />
    <path d={`M${x - s * 0.87} ${y - s * 0.5}l${s * 0.87} ${s * 0.5}v${s}l${-s * 0.87} ${-s * 0.5}z`} fill={left} opacity={alpha(left)} />
    <path d={`M${x + s * 0.87} ${y - s * 0.5}l${-s * 0.87} ${s * 0.5}v${s}l${s * 0.87} ${-s * 0.5}z`} fill={right} opacity={alpha(right)} />
  </>
)

/** Minimal flat scenes, one per section: overlapping soft shapes in the three logo colours with white detail. */
const ART: Record<string, ReactNode> = {
  '/teacher/classes': (
    <>
      <R x={8} y={7} w={40} h={30} r={9} c={V} o={0.85} />
      <R x={30} y={20} w={40} h={32} r={9} c={P} o={0.92} />
      <Person x={42} y={29} /><Person x={58} y={29} />
      <C x={63} y={13} r={5} c={B} />
    </>
  ),
  '/teacher/live-interaction': (
    <>
      <R x={7} y={9} w={60} h={40} r={9} c={B} />
      <R x={16} y={31} w={8} h={11} r={2.5} c={W} o={0.95} /><R x={29} y={23} w={8} h={19} r={2.5} c={W} /><R x={42} y={27} w={8} h={15} r={2.5} c={W} o={0.7} />
      <C x={62} y={14} r={10} c={P} />
      <path d="M63.5 7.5l-6 8h4.5l-2 7 6.500-9h-4.500z" fill={W} />
    </>
  ),
  '/teacher/boards': (
    <>
      <R x={7} y={8} w={19} h={44} r={7} c={V} /><R x={29.500} y={8} w={19} h={44} r={7} c={B} /><R x={52} y={8} w={19} h={44} r={7} c={P} />
      <R x={10.500} y={13} w={12} h={9} r={3} c={W} o={0.95} /><R x={10.500} y={25} w={12} h={9} r={3} c={W} o={0.7} />
      <R x={33} y={13} w={12} h={9} r={3} c={W} o={0.95} />
      <R x={55.500} y={13} w={12} h={9} r={3} c={W} o={0.95} /><R x={55.500} y={25} w={12} h={9} r={3} c={W} o={0.7} /><R x={55.500} y={37} w={12} h={9} r={3} c={W} o={0.45} />
    </>
  ),
  '/teacher/documents': (
    <>
      <R x={16} y={9} w={36} h={44} r={7} c={V} o={0.8} rotate={-9} />
      <R x={24} y={6} w={38} h={46} r={7} c={W} />
      <R x={30} y={13} w={18} h={5} r={2.500} c={P} />
      <Line x={30} y={24} w={26} c={V} o={0.55} /><Line x={30} y={30} w={26} c={V} o={0.55} /><Line x={30} y={36} w={17} c={V} o={0.55} />
      <R x={30} y={42} w={11} h={6} r={2.500} c={B} />
    </>
  ),
  '/teacher/teacherbots': (
    <>
      <rect x={37} y={6} width={4} height={9} rx={2} fill={P} /><C x={39} y={6} r={4} c={P} />
      <R x={14} y={15} w={50} h={36} r={14} c={V} />
      <C x={12} y={33} r={5} c={B} /><C x={66} y={33} r={5} c={B} />
      <C x={28} y={31} r={6} c={W} /><C x={50} y={31} r={6} c={W} /><C x={29.500} y={32} r={2.800} c={V} /><C x={51.500} y={32} r={2.800} c={V} />
      <R x={30} y={42} w={18} h={3.500} r={1.800} c={W} o={0.85} />
    </>
  ),
  '/teacher/ai-3d': (
    <>
      <Cube x={36} y={32} s={20} />
      <path d="M62 7l2.200 5.800 5.800 2.200-5.800 2.200L62 23l-2.200-5.800-5.800-2.200 5.800-2.200z" fill={P} opacity={alpha(P)} />
      <C x={12} y={13} r={3} c={B} />
    </>
  ),
  '/teacher/3d-lab': (
    <>
      <Cube x={30} y={34} s={19} top={V} left={B} right={P} />
      <Cube x={56} y={42} s={11} top={P} left={V} right={B} />
    </>
  ),
  '/teacher/coding': (
    <>
      <R x={6} y={8} w={66} h={42} r={9} c={V} />
      <C x={14} y={16} r={2.200} c={W} o={0.95} /><C x={21} y={16} r={2.200} c={W} o={0.65} /><C x={28} y={16} r={2.200} c={W} o={0.4} />
      <Line x={14} y={25} w={16} /><Line x={34} y={25} w={20} o={0.55} /><Line x={20} y={32} w={26} o={0.75} /><Line x={14} y={39} w={12} o={0.55} />
      <C x={62} y={44} r={10} c={P} />
      <path d="M59 40l-4 4 4 4M65 40l4 4-4 4" fill="none" stroke={W} strokeWidth={2.200} strokeLinecap="round" strokeLinejoin="round" />
    </>
  ),
  '/teacher/notebooks': (
    <>
      <R x={6} y={6} w={7} h={46} r={3.500} c={V} />
      <R x={17} y={6} w={54} h={20} r={8} c={B} />
      <Line x={24} y={13} w={28} /><Line x={24} y={19} w={18} o={0.6} />
      <R x={17} y={31} w={54} h={21} r={8} c={V} o={0.85} />
      <C x={29} y={41.500} r={6.500} c={P} /><Play x={26.500} y={37.500} s={0.75} />
      <Line x={40} y={39} w={22} o={0.8} /><Line x={40} y={45} w={13} o={0.5} />
    </>
  ),
  '/teacher/ml-lab': (
    <>
      <path d="M16 14L39 24M16 14L39 44M16 30L39 24M16 30L39 44M16 46L39 24M16 46L39 44M39 24L62 30M39 44L62 30" stroke={V} strokeOpacity={0.45} strokeWidth={1.600} fill="none" />
      <C x={16} y={14} r={6} c={V} /><C x={16} y={30} r={6} c={V} /><C x={16} y={46} r={6} c={V} />
      <C x={39} y={24} r={7} c={B} /><C x={39} y={44} r={7} c={B} />
      <C x={62} y={30} r={8.500} c={P} /><C x={62} y={30} r={3} c={W} />
    </>
  ),
  '/teacher/toy-lm': (
    <>
      <R x={7} y={10} w={20} h={10} r={5} c={V} /><R x={30} y={10} w={14} h={10} r={5} c={B} /><R x={47} y={10} w={24} h={10} r={5} c={P} />
      <R x={7} y={24} w={14} h={10} r={5} c={B} /><R x={24} y={24} w={26} h={10} r={5} c={P} /><R x={53} y={24} w={18} h={10} r={5} c={V} />
      <R x={7} y={38} w={22} h={10} r={5} c={P} o={0.85} /><R x={32} y={38} w={12} h={10} r={5} c={V} o={0.85} /><R x={49} y={38} w={4} h={10} r={2} c={B} />
    </>
  ),
  '/teacher/files': (
    <>
      <path d="M7 15a6 6 0 016-6h13l6 7h30a6 6 0 016 6v26a6 6 0 01-6 6H13a6 6 0 01-6-6z" fill={V} opacity={alpha(V)} />
      <R x={22} y={18} w={34} h={22} r={5} c={W} o={0.95} rotate={-6} />
      <path d="M7 27a6 6 0 016-6h52a6 6 0 016 6v19a6 6 0 01-6 6H13a6 6 0 01-6-6z" fill={P} opacity={alpha(P)} />
      <C x={60} y={36} r={4} c={B} />
    </>
  ),
  '/teacher/school': (
    <>
      <path d="M39 6l30 16H9z" fill={V} opacity={alpha(V)} />
      <R x={14} y={26} w={7} h={20} r={2.500} c={P} /><R x={27} y={26} w={7} h={20} r={2.500} c={P} /><R x={44} y={26} w={7} h={20} r={2.500} c={P} /><R x={57} y={26} w={7} h={20} r={2.500} c={P} />
      <R x={8} y={48} w={62} h={6} r={3} c={B} />
    </>
  ),
  '/teacher/agentic': (
    <>
      <path d="M22 18h12c8 0 6 24 14 24" stroke={V} strokeOpacity={0.5} strokeWidth={2} fill="none" strokeLinecap="round" /><path d="M22 42h8" stroke={V} strokeOpacity={0.5} strokeWidth={2} strokeLinecap="round" />
      <R x={6} y={8} w={18} h={18} r={7} c={P} /><R x={6} y={34} w={18} h={18} r={7} c={B} /><R x={52} y={34} w={20} h={18} r={7} c={V} />
      <C x={15} y={17} r={3.500} c={W} /><C x={15} y={43} r={3.500} c={W} /><C x={62} y={43} r={3.500} c={W} />
    </>
  ),
  '/teacher/video-studio': (
    <>
      <R x={7} y={8} w={64} h={34} r={9} c={B} />
      <C x={39} y={25} r={10} c={P} /><Play x={36} y={20} s={0.9} />
      <R x={7} y={46} w={17} h={7} r={3.500} c={V} /><R x={27} y={46} w={24} h={7} r={3.500} c={P} o={0.85} /><R x={54} y={46} w={17} h={7} r={3.500} c={V} o={0.7} />
    </>
  ),
  '/teacher/feedback-board': (
    <>
      <R x={8} y={8} w={62} h={13} r={6} c={V} /><R x={8} y={24} w={62} h={13} r={6} c={B} /><R x={8} y={40} w={40} h={13} r={6} c={P} />
    </>
  ),
}

export function hasSectionArt(path: string) {
  return path in ART
}

export function NavSectionArt({ path, className = '' }: { path: string; className?: string }) {
  const art = ART[path]
  if (!art) return null
  return (
    <span
      className={`flex shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-slate-100/80 ${className}`}
      aria-hidden="true"
    >
      <svg viewBox="0 0 78 60" className="h-full w-full">
        {art}
      </svg>
    </span>
  )
}
