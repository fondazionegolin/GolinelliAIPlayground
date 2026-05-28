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
                            'linear-gradient(180deg, #fff 0%, var(--app-body-bg) 46%, #fff 100%), linear-gradient(90deg, var(--logo-pink-06), var(--logo-blue-06) 48%, var(--logo-violet-06))',
                    }}
                />
            )}
            <div className="relative z-0 h-full flex flex-col">
                {children}
            </div>
        </div>
    )
}
