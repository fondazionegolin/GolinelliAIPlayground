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
        <div className={`min-h-screen w-full ${className} relative overflow-hidden`}>
            <style>
                {`
                @keyframes mesh-shift {
                    0%   { transform: translate(0%, 0%); }
                    33%  { transform: translate(-12%, -8%); }
                    66%  { transform: translate(-8%, -15%); }
                    100% { transform: translate(0%, 0%); }
                }
                .animate-mesh {
                    animation: mesh-shift 60s ease-in-out infinite;
                    will-change: transform;
                }
                `}
            </style>
            {gradient && (
                <>
                    {/* Oversized so translate() never exposes edges */}
                    <div
                        aria-hidden="true"
                        className="animate-mesh"
                        style={{
                            position: 'fixed',
                            top: '-20%',
                            left: '-20%',
                            width: '140%',
                            height: '140%',
                            zIndex: -1,
                            background: gradient,
                            opacity: 0.9,
                        }}
                    />
                </>
            )}
            <div className="relative z-0 h-full flex flex-col">
                {children}
            </div>
        </div>
    )
}
