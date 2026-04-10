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
                <>
                    <div
                        aria-hidden="true"
                        className="fixed inset-0"
                        style={{
                            zIndex: -1,
                            backgroundColor: gradient,
                        }}
                    />
                    <div
                        aria-hidden="true"
                        className="pointer-events-none fixed left-[-8rem] top-[5rem] h-[18rem] w-[18rem] rounded-full blur-3xl"
                        style={{ zIndex: -1, backgroundColor: 'rgba(255,255,255,0.72)' }}
                    />
                    <div
                        aria-hidden="true"
                        className="pointer-events-none fixed bottom-[-8rem] right-[-6rem] h-[20rem] w-[20rem] rounded-full blur-3xl"
                        style={{ zIndex: -1, backgroundColor: 'rgba(255,255,255,0.56)' }}
                    />
                </>
            )}
            <div className="relative z-0 h-full flex flex-col">
                {children}
            </div>
        </div>
    )
}
