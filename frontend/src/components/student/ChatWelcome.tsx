import type { ReactNode } from 'react'
import { ArrowRight, MessageSquare } from '@/components/icons'
import { Button, Card, SectionHeading } from '@/design'
import { tl } from '@/i18n/tl'

interface ChatWelcomeProps {
  name: string
  description?: string
  suggestedPrompts?: string[]
  onSelectPrompt: (prompt: string) => void
  children?: ReactNode
}

/** Shared first-conversation welcome for the student workspace and mobile chat. */
export function ChatWelcome({ name, description, suggestedPrompts = [], onSelectPrompt, children }: ChatWelcomeProps) {
  return (
    <Card className="mx-auto w-full max-w-2xl p-5 sm:p-8" data-chat-welcome>
      <SectionHeading
        section="/teacher/teacherbots"
        as="h2"
        className="text-xl font-bold tracking-tight text-[var(--text-primary)] sm:text-2xl"
        subtitle={description || tl("Come posso aiutarti oggi?")}
        subtitleClassName="mt-2 text-sm leading-relaxed text-[var(--text-secondary)]"
      >
        {tl("Ciao! Sono")} {name}
      </SectionHeading>

      {suggestedPrompts.length > 0 && (
        <div className="mt-7">
          <p className="mb-3 text-xs font-semibold text-[var(--text-secondary)]">{tl("Da cosa vuoi iniziare?")}</p>
          <div className="flex flex-col items-start gap-3">
            {suggestedPrompts.map((prompt) => (
              <Button
                key={prompt}
                type="button"
                tone="neutral"
                surface="solid"
                density="roomy"
                className="h-auto min-h-12 max-w-full gap-3 whitespace-normal py-3 text-left"
                onClick={() => onSelectPrompt(prompt)}
              >
                <MessageSquare className="text-[var(--text-secondary)]" aria-hidden="true" />
                <span className="min-w-0 flex-1">{prompt}</span>
                <ArrowRight className="text-[var(--text-secondary)]" aria-hidden="true" />
              </Button>
            ))}
          </div>
        </div>
      )}
      {children && <div className="mt-6">{children}</div>}
    </Card>
  )
}
