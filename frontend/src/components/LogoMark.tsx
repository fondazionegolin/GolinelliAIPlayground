type LogoMarkProps = {
  className?: string
  bubbleColor?: string // Kept for compatibility but unused
}

export function LogoMark({ className }: LogoMarkProps) {
  return (
    <img 
      src="/logo_new.png" 
      alt="Golinelli AI" 
      className={`${className} object-contain`} 
    />
  )
}
