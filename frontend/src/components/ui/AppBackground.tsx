import React from 'react'
import { DEFAULT_GRADIENT } from '@/lib/theme'

interface AppBackgroundProps {
    className?: string
    /** CSS gradient string rendered as a fixed full-screen backdrop behind all content. */
    gradient?: string
    children?: React.ReactNode
}

export function AppBackground({ className = "", gradient = DEFAULT_GRADIENT, children }: AppBackgroundProps) {
    return (
        <div className={`w-full ${className} relative overflow-hidden`}>
            {gradient && (
                <div
                    aria-hidden="true"
                    className="fixed inset-0"
                    style={{
                        zIndex: -1,
                        background:
                            'radial-gradient(ellipse at 12% 4%, rgba(255,255,255,0.98) 0%, transparent 38%), radial-gradient(ellipse at 88% 10%, rgba(227,241,255,0.42) 0%, transparent 34%), linear-gradient(155deg, #ffffff 0%, var(--app-body-bg) 52%, #f5f9ff 100%)',
                    }}
                />
            )}
            <div className="relative z-0 h-full flex flex-col">
                {children}
            </div>
        </div>
    )
}
