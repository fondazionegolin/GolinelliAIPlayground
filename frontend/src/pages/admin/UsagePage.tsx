import { useQuery } from '@tanstack/react-query'
import { adminApi } from '@/lib/api'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Users, MessageSquare, Layers } from 'lucide-react'

interface UsageStats {
  total_sessions: number
  total_students: number
  total_llm_messages: number
}

export default function UsagePage() {
  const { data: stats, isLoading } = useQuery<UsageStats>({
    queryKey: ['usage'],
    queryFn: async () => {
      const res = await adminApi.getUsage()
      return res.data
    },
  })

  if (isLoading) {
    return <p>Caricamento...</p>
  }

  return (
    <div>
      <h2 className="text-2xl font-bold mb-6">Statistiche di Utilizzo</h2>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Sessioni Totali</CardTitle>
            <Layers className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{stats?.total_sessions || 0}</div>
            <p className="text-xs text-muted-foreground">
              Sessioni create su tutte le scuole
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Studenti Totali</CardTitle>
            <Users className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{stats?.total_students || 0}</div>
            <p className="text-xs text-muted-foreground">
              Studenti che hanno partecipato
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Messaggi LLM</CardTitle>
            <MessageSquare className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{stats?.total_llm_messages || 0}</div>
            <p className="text-xs text-muted-foreground">
              Interazioni con il chatbot AI
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
