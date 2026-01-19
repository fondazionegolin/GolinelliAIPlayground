import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { adminApi } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { useToast } from '@/components/ui/use-toast'
import { Check, X, Clock, User, Copy, Key } from 'lucide-react'

interface TeacherRequest {
  id: string
  email: string
  first_name: string
  last_name: string
  status: string
  tenant_id: string
  created_at: string
}

interface ApprovalResult {
  email: string
  message: string
  email_sent: boolean
}

export default function TeacherRequestsPage() {
  const queryClient = useQueryClient()
  const { toast } = useToast()
  const [approvalResult, setApprovalResult] = useState<ApprovalResult | null>(null)

  const { data: requests, isLoading } = useQuery<TeacherRequest[]>({
    queryKey: ['teacher-requests'],
    queryFn: async () => {
      const res = await adminApi.getTeacherRequests()
      return res.data
    },
  })

  const approveMutation = useMutation({
    mutationFn: (id: string) => adminApi.approveTeacher(id),
    onSuccess: (response) => {
      queryClient.invalidateQueries({ queryKey: ['teacher-requests'] })
      setApprovalResult({
        email: response.data.email,
        message: response.data.message,
        email_sent: response.data.email_sent,
      })
    },
    onError: (error: Error) => {
      toast({ 
        title: 'Errore', 
        description: error.message || 'Impossibile approvare la richiesta',
        variant: 'destructive'
      })
    },
  })

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text)
    toast({ title: 'Copiato negli appunti!' })
  }

  const rejectMutation = useMutation({
    mutationFn: (id: string) => adminApi.rejectTeacher(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['teacher-requests'] })
      toast({ title: 'Richiesta rifiutata' })
    },
  })

  const pendingRequests = requests?.filter(r => r.status === 'pending') || []
  const processedRequests = requests?.filter(r => r.status !== 'pending') || []

  return (
    <div>
      <h2 className="text-2xl font-bold mb-6">Richieste Docenti</h2>

      {approvalResult && (
        <Card className={`mb-6 ${approvalResult.email_sent ? 'border-green-200 bg-green-50' : 'border-yellow-200 bg-yellow-50'}`}>
          <CardContent className="p-4">
            <div className="flex items-start gap-3">
              <Key className={`h-6 w-6 mt-1 ${approvalResult.email_sent ? 'text-green-600' : 'text-yellow-600'}`} />
              <div className="flex-1">
                <h4 className={`font-semibold ${approvalResult.email_sent ? 'text-green-800' : 'text-yellow-800'}`}>
                  Docente Approvato!
                </h4>
                <p className={`text-sm mb-3 ${approvalResult.email_sent ? 'text-green-700' : 'text-yellow-700'}`}>
                  {approvalResult.email_sent 
                    ? `Email di attivazione inviata a ${approvalResult.email}`
                    : `Attenzione: email non inviata. Verifica la configurazione SMTP.`
                  }
                </p>
                <div className="bg-white rounded p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-gray-600">Email:</span>
                    <div className="flex items-center gap-2">
                      <code className="bg-gray-100 px-2 py-1 rounded text-sm">{approvalResult.email}</code>
                      <Button size="sm" variant="ghost" onClick={() => copyToClipboard(approvalResult.email)}>
                        <Copy className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                </div>
                <p className={`text-xs mt-2 ${approvalResult.email_sent ? 'text-green-600' : 'text-yellow-600'}`}>
                  {approvalResult.email_sent 
                    ? 'Il docente riceverà un link per attivare il proprio account e impostare la password.'
                    : 'Configura SMTP_PASSWORD nel file .env per abilitare l\'invio email.'
                  }
                </p>
              </div>
              <Button size="sm" variant="ghost" onClick={() => setApprovalResult(null)}>
                <X className="h-4 w-4" />
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="mb-8">
        <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
          <Clock className="h-5 w-5" />
          In attesa ({pendingRequests.length})
        </h3>
        
        {isLoading ? (
          <p>Caricamento...</p>
        ) : pendingRequests.length === 0 ? (
          <p className="text-muted-foreground">Nessuna richiesta in attesa</p>
        ) : (
          <div className="grid gap-4">
            {pendingRequests.map((request) => (
              <Card key={request.id}>
                <CardContent className="flex items-center justify-between p-4">
                  <div className="flex items-center gap-4">
                    <div className="bg-primary/10 rounded-full p-2">
                      <User className="h-5 w-5 text-primary" />
                    </div>
                    <div>
                      <h4 className="font-semibold">
                        {request.first_name} {request.last_name}
                      </h4>
                      <p className="text-sm text-muted-foreground">{request.email}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-muted-foreground mr-4">
                      {new Date(request.created_at).toLocaleDateString('it-IT')}
                    </span>
                    <Button
                      size="sm"
                      onClick={() => approveMutation.mutate(request.id)}
                      disabled={approveMutation.isPending}
                    >
                      <Check className="h-4 w-4 mr-1" />
                      Approva
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => rejectMutation.mutate(request.id)}
                      disabled={rejectMutation.isPending}
                    >
                      <X className="h-4 w-4 mr-1" />
                      Rifiuta
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>

      <div>
        <h3 className="text-lg font-semibold mb-4">Storico</h3>
        <div className="grid gap-2">
          {processedRequests.map((request) => (
            <Card key={request.id} className="bg-gray-50">
              <CardContent className="flex items-center justify-between p-3">
                <div className="flex items-center gap-3">
                  <User className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm">
                    {request.first_name} {request.last_name} - {request.email}
                  </span>
                </div>
                <span className={`px-2 py-1 rounded text-xs ${
                  request.status === 'approved' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
                }`}>
                  {request.status === 'approved' ? 'Approvato' : 'Rifiutato'}
                </span>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </div>
  )
}
