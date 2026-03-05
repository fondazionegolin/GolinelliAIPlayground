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
                    0% { background-position: 0% 0%; }
                    33% { background-position: 100% 50%; }
                    66% { background-position: 50% 100%; }
                    100% { background-position: 0% 0%; }
                }
                .animate-mesh {
                    animation: mesh-shift 60s ease-in-out infinite;
                }
                @media (max-width: 768px) {
                    .animate-mesh { animation: none; }
                }
                @media (prefers-reduced-motion: reduce) {
                    .animate-mesh { animation: none; }
                }
                `}
            </style>
            {gradient && (
                <>
                    <div
                        aria-hidden="true"
                        className="animate-mesh"
                        style={{
                            position: 'fixed',
                            inset: -100,
                            zIndex: -1,
                            background: gradient,
                            backgroundSize: '200% 200%',
                            opacity: 0.9,
                        }}
                    />
                    {/* Vignetta molto sottile per guidare l'occhio senza appesantire */}
                    <div
                        aria-hidden="true"
                        style={{
                            position: 'fixed',
                            inset: 0,
                            zIndex: -1,
                            background: 'radial-gradient(circle at center, transparent 40%, rgba(0,0,0,0.015) 100%)',
                            pointerEvents: 'none',
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
