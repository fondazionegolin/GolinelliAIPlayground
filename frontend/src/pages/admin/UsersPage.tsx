import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { adminApi } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { useToast } from '@/components/ui/use-toast'
import { User, Key, Copy, X, Shield, GraduationCap, Trash2 } from 'lucide-react'

interface UserData {
  id: string
  email: string
  first_name: string | null
  last_name: string | null
  role: string
  tenant_id: string | null
  is_verified: boolean
  created_at: string | null
}

interface ResetResult {
  email: string
  temporary_password: string
}

export default function UsersPage() {
  const queryClient = useQueryClient()
  const { toast } = useToast()
  const [resetResult, setResetResult] = useState<ResetResult | null>(null)
  const [roleFilter, setRoleFilter] = useState<string>('')

  const { data: users, isLoading } = useQuery<UserData[]>({
    queryKey: ['users', roleFilter],
    queryFn: async () => {
      const res = await adminApi.getUsers(roleFilter || undefined)
      return res.data
    },
  })

  const resetMutation = useMutation({
    mutationFn: (userId: string) => adminApi.resetPassword(userId),
    onSuccess: (response) => {
      queryClient.invalidateQueries({ queryKey: ['users'] })
      setResetResult({
        email: response.data.email,
        temporary_password: response.data.temporary_password,
      })
    },
    onError: () => {
      toast({ variant: 'destructive', title: 'Errore nel reset password' })
    },
  })

  const deleteMutation = useMutation({
    mutationFn: (userId: string) => adminApi.deleteUser(userId),
    onSuccess: (response) => {
      queryClient.invalidateQueries({ queryKey: ['users'] })
      toast({ title: 'Utente eliminato', description: response.data.message })
    },
    onError: (error: Error & { response?: { data?: { detail?: string } } }) => {
      toast({ 
        variant: 'destructive', 
        title: 'Errore', 
        description: error.response?.data?.detail || 'Impossibile eliminare l\'utente' 
      })
    },
  })

  const handleDelete = (user: UserData) => {
    if (confirm(`Sei sicuro di voler eliminare l'utente ${user.first_name} ${user.last_name} (${user.email})?`)) {
      deleteMutation.mutate(user.id)
    }
  }

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text)
    toast({ title: 'Copiato negli appunti!' })
  }

  const getRoleIcon = (role: string) => {
    switch (role) {
      case 'ADMIN':
        return <Shield className="h-4 w-4 text-red-500" />
      case 'TEACHER':
        return <GraduationCap className="h-4 w-4 text-blue-500" />
      default:
        return <User className="h-4 w-4 text-gray-500" />
    }
  }

  const getRoleBadge = (role: string) => {
    const colors: Record<string, string> = {
      ADMIN: 'bg-red-100 text-red-800',
      TEACHER: 'bg-blue-100 text-blue-800',
    }
    return colors[role] || 'bg-gray-100 text-gray-800'
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold">Gestione Utenti</h2>
        <div className="flex gap-2">
          <Button
            variant={roleFilter === '' ? 'default' : 'outline'}
            size="sm"
            onClick={() => setRoleFilter('')}
          >
            Tutti
          </Button>
          <Button
            variant={roleFilter === 'ADMIN' ? 'default' : 'outline'}
            size="sm"
            onClick={() => setRoleFilter('ADMIN')}
          >
            Admin
          </Button>
          <Button
            variant={roleFilter === 'TEACHER' ? 'default' : 'outline'}
            size="sm"
            onClick={() => setRoleFilter('TEACHER')}
          >
            Docenti
          </Button>
        </div>
      </div>

      {resetResult && (
        <Card className="mb-6 border-green-200 bg-green-50">
          <CardContent className="p-4">
            <div className="flex items-start gap-3">
              <Key className="h-6 w-6 text-green-600 mt-1" />
              <div className="flex-1">
                <h4 className="font-semibold text-green-800">Password Resettata!</h4>
                <p className="text-sm text-green-700 mb-3">
                  Nuove credenziali per l'utente:
                </p>
                <div className="bg-white rounded p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-gray-600">Email:</span>
                    <div className="flex items-center gap-2">
                      <code className="bg-gray-100 px-2 py-1 rounded text-sm">{resetResult.email}</code>
                      <Button size="sm" variant="ghost" onClick={() => copyToClipboard(resetResult.email)}>
                        <Copy className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-gray-600">Nuova Password:</span>
                    <div className="flex items-center gap-2">
                      <code className="bg-gray-100 px-2 py-1 rounded text-sm font-mono">{resetResult.temporary_password}</code>
                      <Button size="sm" variant="ghost" onClick={() => copyToClipboard(resetResult.temporary_password)}>
                        <Copy className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                </div>
              </div>
              <Button size="sm" variant="ghost" onClick={() => setResetResult(null)}>
                <X className="h-4 w-4" />
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {isLoading ? (
        <p>Caricamento...</p>
      ) : !users?.length ? (
        <p className="text-muted-foreground">Nessun utente trovato</p>
      ) : (
        <div className="grid gap-3">
          {users.map((user) => (
            <Card key={user.id}>
              <CardContent className="flex items-center justify-between p-4">
                <div className="flex items-center gap-4">
                  <div className="bg-gray-100 rounded-full p-2">
                    {getRoleIcon(user.role)}
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <h4 className="font-semibold">
                        {user.first_name && user.last_name
                          ? `${user.first_name} ${user.last_name}`
                          : user.email}
                      </h4>
                      <span className={`px-2 py-0.5 rounded text-xs ${getRoleBadge(user.role)}`}>
                        {user.role}
                      </span>
                    </div>
                    <p className="text-sm text-muted-foreground">{user.email}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {user.created_at && (
                    <span className="text-sm text-muted-foreground mr-4">
                      {new Date(user.created_at).toLocaleDateString('it-IT')}
                    </span>
                  )}
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => resetMutation.mutate(user.id)}
                    disabled={resetMutation.isPending}
                  >
                    <Key className="h-4 w-4 mr-1" />
                    Reset Password
                  </Button>
                  {user.role !== 'ADMIN' && (
                    <Button
                      size="sm"
                      variant="destructive"
                      onClick={() => handleDelete(user)}
                      disabled={deleteMutation.isPending}
                    >
                      <Trash2 className="h-4 w-4 mr-1" />
                      Elimina
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
