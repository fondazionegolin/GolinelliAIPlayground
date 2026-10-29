import { tl } from '@/i18n/tl'
type LogoMarkProps = {
  className?: string
  bubbleColor?: string // Kept for compatibility but unused
}

export function LogoMark({ className }: LogoMarkProps) {
  return (
    <img 
      src="/logo_new.png" 
      alt={tl("Golinelli AI")} 
      className={`${className} object-contain`} 
    />
  )
}
