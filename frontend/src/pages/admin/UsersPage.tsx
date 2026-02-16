import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { adminApi, creditsApi } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useToast } from '@/components/ui/use-toast'
import { User, Key, Copy, X, Shield, GraduationCap, Trash2, Mail, UserPlus } from 'lucide-react'

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
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteFirstName, setInviteFirstName] = useState('')
  const [inviteLastName, setInviteLastName] = useState('')
  const [inviteSchool, setInviteSchool] = useState('')
  const [bulkInviteText, setBulkInviteText] = useState('')

  const { data: users, isLoading } = useQuery<UserData[]>({
    queryKey: ['users', roleFilter],
    queryFn: async () => {
      const res = await adminApi.getUsers(roleFilter || undefined)
      return res.data
    },
  })

  const { data: invitations } = useQuery<any[]>({
    queryKey: ['admin-platform-invitations-users-page'],
    queryFn: async () => (await creditsApi.getInvitations()).data,
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

  const inviteMutation = useMutation({
    mutationFn: (payload: { email: string; firstName?: string; lastName?: string; school?: string }) =>
      creditsApi.inviteTeacher(payload.email, payload.firstName, payload.lastName, payload.school),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-platform-invitations-users-page'] })
      queryClient.invalidateQueries({ queryKey: ['users'] })
      toast({ title: 'Invito inviato', description: 'Il docente ricevera una email per completare la registrazione.' })
    },
    onError: (error: Error & { response?: { data?: { detail?: string } } }) => {
      toast({
        variant: 'destructive',
        title: 'Invito fallito',
        description: error.response?.data?.detail || 'Impossibile inviare l\'invito',
      })
    },
  })

  const bulkInviteMutation = useMutation({
    mutationFn: async (rows: Array<{ email: string; firstName?: string; lastName?: string; school?: string }>) => {
      const results = await Promise.allSettled(
        rows.map((row) => creditsApi.inviteTeacher(row.email, row.firstName, row.lastName, row.school))
      )
      const failed = results.filter((r) => r.status === 'rejected').length
      return { total: rows.length, failed, success: rows.length - failed }
    },
    onSuccess: ({ total, success, failed }) => {
      queryClient.invalidateQueries({ queryKey: ['admin-platform-invitations-users-page'] })
      queryClient.invalidateQueries({ queryKey: ['users'] })
      toast({
        title: 'Inviti multipli completati',
        description: `Totale ${total}, inviati ${success}, falliti ${failed}`,
      })
    },
    onError: () => {
      toast({ variant: 'destructive', title: 'Inviti multipli falliti' })
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

  const parsedBulkRows = bulkInviteText
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const parts = line.split(/[;,]/).map((part) => part.trim())
      return {
        email: parts[0] || '',
        firstName: parts[1] || undefined,
        lastName: parts[2] || undefined,
        school: parts[3] || undefined,
      }
    })
    .filter((row) => row.email.includes('@'))

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

      <div className="grid gap-4 mb-6 md:grid-cols-3">
        <Card className="md:col-span-1 border-sky-200 bg-sky-50/70">
          <CardContent className="p-4 space-y-3">
            <div className="flex items-center gap-2 text-sky-900 font-semibold">
              <Mail className="h-4 w-4" />
              Invita docente
            </div>
            <div className="space-y-1">
              <Label>Email</Label>
              <Input value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)} placeholder="docente@scuola.it" />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <Label>Nome</Label>
                <Input value={inviteFirstName} onChange={(e) => setInviteFirstName(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label>Cognome</Label>
                <Input value={inviteLastName} onChange={(e) => setInviteLastName(e.target.value)} />
              </div>
            </div>
            <div className="space-y-1">
              <Label>Scuola</Label>
              <Input value={inviteSchool} onChange={(e) => setInviteSchool(e.target.value)} placeholder="Istituto..." />
            </div>
            <Button
              className="w-full"
              disabled={!inviteEmail || inviteMutation.isPending}
              onClick={() => {
                inviteMutation.mutate({
                  email: inviteEmail.trim(),
                  firstName: inviteFirstName.trim() || undefined,
                  lastName: inviteLastName.trim() || undefined,
                  school: inviteSchool.trim() || undefined,
                })
                setInviteEmail('')
                setInviteFirstName('')
                setInviteLastName('')
                setInviteSchool('')
              }}
            >
              <UserPlus className="h-4 w-4 mr-2" />
              Invia invito
            </Button>
          </CardContent>
        </Card>

        <Card className="md:col-span-2 border-violet-200 bg-violet-50/70">
          <CardContent className="p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-violet-900">Invito multiplo rapido</h3>
              <span className="text-xs text-violet-700">{parsedBulkRows.length} validi</span>
            </div>
            <textarea
              value={bulkInviteText}
              onChange={(e) => setBulkInviteText(e.target.value)}
              className="w-full min-h-32 rounded-md border border-violet-200 p-3 text-sm bg-white"
              placeholder={'email;nome;cognome;scuola\nmaria@scuola.it;Maria;Rossi;Liceo Galilei'}
            />
            <div className="flex justify-end">
              <Button
                disabled={parsedBulkRows.length === 0 || bulkInviteMutation.isPending}
                onClick={() => {
                  bulkInviteMutation.mutate(parsedBulkRows)
                  setBulkInviteText('')
                }}
              >
                Invia inviti multipli
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card className="mb-6">
        <CardContent className="p-4">
          <h3 className="font-semibold mb-3">Storico inviti docenti</h3>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-sm">
              <thead className="text-left text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="pb-2">Email</th>
                  <th className="pb-2">Stato</th>
                  <th className="pb-2">Creato</th>
                  <th className="pb-2">Scadenza</th>
                </tr>
              </thead>
              <tbody>
                {(invitations || []).map((inv: any) => (
                  <tr key={inv.id} className="border-t">
                    <td className="py-2">{inv.email}</td>
                    <td className="py-2">{inv.status}</td>
                    <td className="py-2">{inv.created_at ? new Date(inv.created_at).toLocaleString('it-IT') : 'N/D'}</td>
                    <td className="py-2">{inv.expires_at ? new Date(inv.expires_at).toLocaleString('it-IT') : 'N/D'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

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
