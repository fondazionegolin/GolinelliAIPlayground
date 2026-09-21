import * as React from "react"

import { cn } from "@/lib/utils"

export interface TextareaProps
  extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {}

const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, ...props }, ref) => {
    return (
      <textarea
        className={cn(
          "flex min-h-[80px] w-full rounded-[var(--control-radius)] border-0 bg-[rgba(255,255,255,0.66)] px-3 py-2 text-sm shadow-[var(--control-shadow)] backdrop-blur-md placeholder:text-muted-foreground transition-[background-color,box-shadow] focus-visible:outline-none focus-visible:ring-0 focus-visible:shadow-[var(--focus-shadow)] disabled:cursor-not-allowed disabled:opacity-50",
          className
        )}
        ref={ref}
        {...props}
      />
    )
  }
)
Textarea.displayName = "Textarea"

export { Textarea }
