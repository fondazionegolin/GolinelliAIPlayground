import type { SVGProps } from 'react'
import { GraduationCap } from 'lucide-react'

/** Identità AI condivisa: un segno accademico semplice, leggibile anche nella navbar. */
export function AcademicAiIcon({ className, strokeWidth = 2.2, ...props }: SVGProps<SVGSVGElement>) {
  return (
    <GraduationCap
      className={className}
      strokeWidth={strokeWidth}
      aria-hidden="true"
      {...props}
    />
  )
}
