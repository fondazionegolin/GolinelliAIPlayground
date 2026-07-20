import type { SVGProps } from 'react'

/** Identità del supporto AI docente: tocco accademico + scintilla generativa. */
export function AcademicAiIcon({ className, ...props }: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
      {...props}
    >
      <path d="m3.2 9 8.3-4.1L19.8 9l-8.3 4.1L3.2 9Z" />
      <path d="M6.8 11v4.1c0 1.5 2.1 2.8 4.7 2.8s4.7-1.3 4.7-2.8V11" />
      <path d="M19.8 9v4.2" />
      <path d="M20.5 3.2c.1 1.1.8 1.8 1.9 1.9-1.1.1-1.8.8-1.9 1.9-.1-1.1-.8-1.8-1.9-1.9 1.1-.1 1.8-.8 1.9-1.9Z" />
    </svg>
  )
}
