import { Home, MessageSquare, Bot, Brain } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface MobileNavProps {
  activeModule: string | null
  onNavigate: (module: string | null) => void
  unreadMessages?: number
}

export function MobileNav({ activeModule, onNavigate, unreadMessages = 0 }: MobileNavProps) {
  const navItems = [
    { key: null, icon: Home, label: 'Home' },
    { key: 'chatbot', icon: Bot, label: 'AI' },
    { key: 'chat', icon: MessageSquare, label: 'Classe' },
    { key: 'classification', icon: Brain, label: 'ML' },
  ]

  return (
    <div className="md:hidden fixed bottom-0 left-0 right-0 bg-white border-t border-slate-200 px-4 py-2 pb-[calc(0.5rem+env(safe-area-inset-bottom))] z-50 shadow-[0_-4px_6px_-1px_rgba(0,0,0,0.05)]">
      <div className="flex justify-around items-center">
        {navItems.map((item) => {
          const isActive = activeModule === item.key
          return (
            <Button
              key={item.label}
              variant="ghost"
              size="sm"
              className={`flex flex-col items-center gap-1 h-auto py-2 px-2 hover:bg-transparent ${
                isActive ? 'text-violet-600' : 'text-slate-500'
              }`}
              onClick={() => onNavigate(item.key)}
            >
              <div className="relative">
                <item.icon className={`h-6 w-6 ${isActive ? 'stroke-[2.5px]' : 'stroke-2'}`} />
                {item.key === 'chat' && unreadMessages > 0 && (
                  <span className="absolute -top-1 -right-1 flex h-3 w-3">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-3 w-3 bg-red-500"></span>
                  </span>
                )}
              </div>
              <span className="text-[10px] font-medium leading-none">{item.label}</span>
            </Button>
          )
        })}
      </div>
    </div>
  )
}
