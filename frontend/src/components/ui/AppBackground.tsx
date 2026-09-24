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
                        backgroundColor: 'var(--ds-canvas-base)',
                        backgroundImage: 'var(--ds-canvas-mesh)',
                    }}
                />
            )}
            <div className="relative z-0 h-full flex flex-col">
                {children}
            </div>
        </div>
    )
}
