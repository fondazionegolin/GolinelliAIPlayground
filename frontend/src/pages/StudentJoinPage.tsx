import { useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { useAuthStore } from '@/stores/auth'
import { studentApi } from '@/lib/api'
import { connectSocket } from '@/lib/socket'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { useToast } from '@/components/ui/use-toast'
import { ArrowLeft } from 'lucide-react'

export default function StudentJoinPage() {
  const [joinCode, setJoinCode] = useState('')
  const [nickname, setNickname] = useState('')
  const [loading, setLoading] = useState(false)
  const navigate = useNavigate()
  const { setStudentSession } = useAuthStore()
  const { toast } = useToast()

  const handleJoin = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)

    try {
      const response = await studentApi.join(joinCode.toUpperCase(), nickname)
      const { join_token, student_id, session_id, session_title } = response.data
      
      setStudentSession(
        { student_id, session_id, session_title, nickname },
        join_token
      )

      connectSocket(join_token)
      navigate('/student')
    } catch (error: unknown) {
      const err = error as { response?: { data?: { detail?: string } } }
      toast({
        variant: 'destructive',
        title: 'Errore',
        description: err.response?.data?.detail || 'Impossibile partecipare alla sessione',
      })
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-green-50 to-emerald-100 flex items-center justify-center p-4">
      <div className="w-full max-w-md space-y-6">
        <div className="text-center">
          <div className="flex justify-center mb-4">
            <img src="/golinelli-logo.svg" alt="Golinelli" className="h-16 w-16" />
          </div>
          <h1 className="text-3xl font-bold text-gray-900">Golinelli AI Playground</h1>
          <p className="text-gray-600 mt-2">Inserisci il codice fornito dal docente</p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Accesso Studente</CardTitle>
            <CardDescription>
              Non serve registrazione, solo il codice e un nickname
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleJoin} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="joinCode">Codice Sessione</Label>
                <Input
                  id="joinCode"
                  type="text"
                  placeholder="ABC12"
                  value={joinCode}
                  onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
                  maxLength={5}
                  className="text-center text-2xl tracking-widest font-mono"
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="nickname">Il tuo nickname</Label>
                <Input
                  id="nickname"
                  type="text"
                  placeholder="Mario"
                  value={nickname}
                  onChange={(e) => setNickname(e.target.value)}
                  maxLength={20}
                  required
                />
              </div>
              <Button type="submit" className="w-full bg-emerald-600 hover:bg-emerald-700" disabled={loading}>
                {loading ? 'Connessione...' : 'Partecipa'}
              </Button>
            </form>
          </CardContent>
        </Card>

        <div className="text-center">
          <Link to="/login" className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground">
            <ArrowLeft className="h-4 w-4 mr-1" />
            Torna al login docenti
          </Link>
        </div>
      </div>
    </div>
  )
}
