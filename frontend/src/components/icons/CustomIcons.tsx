import type { SVGProps } from 'react'

type IconProps = SVGProps<SVGSVGElement> & { strokeWidth?: number | string }

/** Stylised mushroom (Meshy-like) for the generative "AI 3D" lab. Drop-in for a lucide icon. */
export function MushroomIcon({ strokeWidth = 2, ...props }: IconProps) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width={24} height={24} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" aria-hidden {...props}>
      <path d="M3 12.5C3 7.25 7 3.5 12 3.5s9 3.75 9 9Z" />
      <path d="M9 12.5v5a3 3 0 0 0 6 0v-5" />
      <circle cx="8.5" cy="8.3" r="1" fill="currentColor" stroke="none" />
      <circle cx="14.2" cy="7.2" r="1.25" fill="currentColor" stroke="none" />
      <circle cx="16.8" cy="10.2" r="0.8" fill="currentColor" stroke="none" />
    </svg>
  )
}

/** Turing test: a human face, a dividing line, a robot. Wider than tall (36×20). */
export function TuringFaceRobotIcon({ strokeWidth = 1.8, ...props }: IconProps) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width={36} height={20} viewBox="0 0 36 20" fill="none" stroke="currentColor"
      strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" aria-hidden {...props}>
      {/* face */}
      <circle cx="7" cy="10" r="5.6" />
      <circle cx="5.1" cy="8.9" r="0.75" fill="currentColor" stroke="none" />
      <circle cx="8.9" cy="8.9" r="0.75" fill="currentColor" stroke="none" />
      <path d="M4.9 11.7c1.2 1.3 3 1.3 4.2 0" />
      {/* divider */}
      <path d="M18 3.5v13" strokeDasharray="1.6 2.2" />
      {/* robot */}
      <rect x="23.2" y="5.6" width="10.6" height="9.6" rx="2.4" />
      <path d="M28.5 5.6V3.2" />
      <circle cx="28.5" cy="2.4" r="0.9" fill="currentColor" stroke="none" />
      <rect x="25.3" y="8.4" width="1.9" height="1.9" rx="0.4" fill="currentColor" stroke="none" />
      <rect x="29.8" y="8.4" width="1.9" height="1.9" rx="0.4" fill="currentColor" stroke="none" />
      <path d="M26.2 12.6h4.6" />
    </svg>
  )
}
