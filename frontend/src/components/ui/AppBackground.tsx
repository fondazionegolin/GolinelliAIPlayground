import React from 'react'

interface AppBackgroundProps {
    className?: string
    children?: React.ReactNode
}

export function AppBackground({ className = "", children }: AppBackgroundProps) {
    return (
        <div className={`min-h-screen w-full bg-slate-100 ${className}`}>
            {children}
        </div>
    )
}
