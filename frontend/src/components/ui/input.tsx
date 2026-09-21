import * as React from "react"
import { cn } from "@/lib/utils"

export interface InputProps
  extends React.InputHTMLAttributes<HTMLInputElement> {}

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, ...props }, ref) => {
    return (
      <input
        type={type}
        className={cn(
          "flex h-10 w-full rounded-[var(--control-radius)] border-0 bg-[rgba(255,255,255,0.66)] px-3 py-2 text-sm shadow-[var(--control-shadow)] backdrop-blur-md file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground transition-[background-color,box-shadow] focus-visible:outline-none focus-visible:ring-0 focus-visible:shadow-[var(--focus-shadow)] disabled:cursor-not-allowed disabled:opacity-50",
          className
        )}
        ref={ref}
        {...props}
      />
    )
  }
)
Input.displayName = "Input"

export { Input }
