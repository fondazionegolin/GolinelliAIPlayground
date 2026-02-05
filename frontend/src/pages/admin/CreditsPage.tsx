import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { creditsApi } from '@/lib/api'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { DollarSign, Mail, Upload, Check, X } from 'lucide-react'

export default function CreditsPage() {
    const queryClient = useQueryClient()
    const [activeTab, setActiveTab] = useState('dashboard')

    // Stats Query
    const { data: stats } = useQuery({
        queryKey: ['credits-stats'],
        queryFn: async () => (await creditsApi.getStats()).data
    })

    // Limits Query
    const { data: limits } = useQuery({
        queryKey: ['credits-limits'],
        queryFn: async () => (await creditsApi.getLimits()).data
    })

    // Requests Query
    const { data: requests } = useQuery({
        queryKey: ['credits-requests'],
        queryFn: async () => (await creditsApi.getRequests()).data
    })

    // Invitations Query
    const { data: invitations } = useQuery({
        queryKey: ['credits-invitations'],
        queryFn: async () => (await creditsApi.getInvitations()).data
    })

    // Mutations
    const updateLimitMutation = useMutation({
        mutationFn: async ({ id, cap }: { id: string; cap: number }) =>
            await creditsApi.updateLimit(id, { amount_cap: cap }),
        onSuccess: () => queryClient.invalidateQueries({ queryKey: ['credits-limits'] })
    })

    const reviewRequestMutation = useMutation({
        mutationFn: async ({ id, status }: { id: string; status: string }) =>
            await creditsApi.reviewRequest(id, status),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['credits-requests'] })
            queryClient.invalidateQueries({ queryKey: ['credits-limits'] })
        }
    })

    const inviteMutation = useMutation({
        mutationFn: async (data: { email: string; first?: string }) =>
            await creditsApi.inviteTeacher(data.email, data.first),
        onSuccess: () => queryClient.invalidateQueries({ queryKey: ['credits-invitations'] })
    })

    // -- UI States --
    const [inviteEmail, setInviteEmail] = useState('')
    const [inviteName, setInviteName] = useState('')

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <h2 className="text-3xl font-bold tracking-tight">Gestione Crediti e Monitoraggio</h2>
            </div>

            <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
                <TabsList>
                    <TabsTrigger value="dashboard">Dashboard</TabsTrigger>
                    <TabsTrigger value="limits">Limiti</TabsTrigger>
                    <TabsTrigger value="requests">Richieste Crediti</TabsTrigger>
                    <TabsTrigger value="invitations">Inviti Docenti</TabsTrigger>
                </TabsList>

                {/* DASHBOARD */}
                <TabsContent value="dashboard" className="space-y-4">
                    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                        <Card>
                            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                                <CardTitle className="text-sm font-medium">Costo Totale (Mese)</CardTitle>
                                <DollarSign className="h-4 w-4 text-muted-foreground" />
                            </CardHeader>
                            <CardContent>
                                <div className="text-2xl font-bold">${stats?.total_cost?.toFixed(2) || '0.00'}</div>
                            </CardContent>
                        </Card>
                        {/* Add more stats cards here if needed */}
                    </div>

                    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-7">
                        <Card className="col-span-4">
                            <CardHeader>
                                <CardTitle>Spesa per Provider</CardTitle>
                            </CardHeader>
                            <CardContent className="pl-2">
                                <div className="space-y-2">
                                    {stats?.provider_breakdown && Object.entries(stats.provider_breakdown).map(([k, v]) => (
                                        <div key={k} className="flex justify-between items-center border-b py-2">
                                            <span className="capitalize font-medium">{k}</span>
                                            <span>${Number(v).toFixed(3)}</span>
                                        </div>
                                    ))}
                                </div>
                            </CardContent>
                        </Card>
                        <Card className="col-span-3">
                            <CardHeader>
                                <CardTitle>Spesa per Modello</CardTitle>
                            </CardHeader>
                            <CardContent>
                                <div className="space-y-2">
                                    {stats?.model_breakdown && Object.entries(stats.model_breakdown).map(([k, v]) => (
                                        <div key={k} className="flex justify-between items-center border-b py-2">
                                            <span className="font-mono text-sm">{k}</span>
                                            <span>${Number(v).toFixed(3)}</span>
                                        </div>
                                    ))}
                                </div>
                            </CardContent>
                        </Card>
                    </div>
                </TabsContent>

                {/* LIMITS */}
                <TabsContent value="limits">
                    <Card>
                        <CardHeader><CardTitle>Limiti di Spesa</CardTitle><CardDescription>Gestisci i limiti globali e per utente.</CardDescription></CardHeader>
                        <CardContent>
                            <div className="overflow-x-auto">
                                <table className="w-full text-sm text-left">
                                    <thead className="bg-muted/50 text-muted-foreground uppercase text-xs">
                                        <tr>
                                            <th className="px-4 py-2">Livello</th>
                                            <th className="px-4 py-2">Entità ID</th>
                                            <th className="px-4 py-2">Budget (Cap)</th>
                                            <th className="px-4 py-2">Usati</th>
                                            <th className="px-4 py-2">Reset</th>
                                            <th className="px-4 py-2">Azioni</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {limits?.map((limit: any) => (
                                            <tr key={limit.id} className="border-b">
                                                <td className="px-4 py-2"><Badge variant="outline">{limit.level}</Badge></td>
                                                <td className="px-4 py-2 font-mono text-xs">{limit.teacher_id || limit.class_id || "GLOBAL"}</td>
                                                <td className="px-4 py-2">${limit.amount_cap}</td>
                                                <td className={`px-4 py-2 ${limit.current_usage > limit.amount_cap ? "text-red-500 font-bold" : ""}`}>
                                                    ${limit.current_usage?.toFixed(3)}
                                                </td>
                                                <td className="px-4 py-2">{limit.reset_frequency}</td>
                                                <td className="px-4 py-2">
                                                    <Button
                                                        variant="ghost" size="sm"
                                                        onClick={() => {
                                                            const newCap = prompt("Nuovo limite:", limit.amount_cap)
                                                            if (newCap) updateLimitMutation.mutate({ id: limit.id, cap: parseFloat(newCap) })
                                                        }}
                                                    >
                                                        Modifica
                                                    </Button>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </CardContent>
                    </Card>
                </TabsContent>

                {/* REQUESTS */}
                <TabsContent value="requests">
                    <Card>
                        <CardHeader><CardTitle>Richieste di Credito</CardTitle></CardHeader>
                        <CardContent>
                            <div className="overflow-x-auto">
                                <table className="w-full text-sm text-left">
                                    <thead className="bg-muted/50 text-muted-foreground uppercase text-xs">
                                        <tr>
                                            <th className="px-4 py-2">Data</th>
                                            <th className="px-4 py-2">Docente</th>
                                            <th className="px-4 py-2">Richiesta</th>
                                            <th className="px-4 py-2">Motivo</th>
                                            <th className="px-4 py-2">Stato</th>
                                            <th className="px-4 py-2">Azioni</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {requests?.map((req: any) => (
                                            <tr key={req.id} className="border-b">
                                                <td className="px-4 py-2">{new Date(req.created_at).toLocaleDateString()}</td>
                                                <td className="px-4 py-2">{req.requester_name || req.requester_id}</td>
                                                <td className="px-4 py-2">${req.amount_requested}</td>
                                                <td className="px-4 py-2">{req.reason}</td>
                                                <td className="px-4 py-2">
                                                    <Badge variant={req.status === 'approved' ? 'default' : req.status === 'rejected' ? 'destructive' : 'secondary'}>
                                                        {req.status}
                                                    </Badge>
                                                </td>
                                                <td className="px-4 py-2">
                                                    {req.status === 'pending' && (
                                                        <div className="flex gap-2">
                                                            <Button size="icon" variant="outline" onClick={() => reviewRequestMutation.mutate({ id: req.id, status: 'approved' })}>
                                                                <Check className="h-4 w-4 text-green-500" />
                                                            </Button>
                                                            <Button size="icon" variant="outline" onClick={() => reviewRequestMutation.mutate({ id: req.id, status: 'rejected' })}>
                                                                <X className="h-4 w-4 text-red-500" />
                                                            </Button>
                                                        </div>
                                                    )}
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </CardContent>
                    </Card>
                </TabsContent>

                {/* INVITATIONS */}
                <TabsContent value="invitations">
                    <div className="grid gap-4 md:grid-cols-3">
                        <Card className="md:col-span-1">
                            <CardHeader><CardTitle>Invita Docente</CardTitle></CardHeader>
                            <CardContent className="space-y-4">
                                <div className="space-y-2">
                                    <Label>Email</Label>
                                    <Input value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)} placeholder="docente@scuola.it" />
                                </div>
                                <div className="space-y-2">
                                    <Label>Nome (Opzionale)</Label>
                                    <Input value={inviteName} onChange={(e) => setInviteName(e.target.value)} placeholder="Mario Rossi" />
                                </div>
                                <Button
                                    className="w-full"
                                    onClick={() => {
                                        inviteMutation.mutate({ email: inviteEmail, first: inviteName })
                                        setInviteEmail('')
                                        setInviteName('')
                                    }}
                                    disabled={!inviteEmail}
                                >
                                    <Mail className="mr-2 h-4 w-4" /> Invia Invito
                                </Button>

                                <div className="relative">
                                    <div className="absolute inset-0 flex items-center"><span className="w-full border-t" /></div>
                                    <div className="relative flex justify-center text-xs uppercase"><span className="bg-background px-2 text-muted-foreground">Oppure CSV</span></div>
                                </div>

                                <div className="flex items-center justify-center w-full">
                                    <label className="flex flex-col items-center justify-center w-full h-32 border-2 border-dashed rounded-lg cursor-pointer hover:bg-muted/50">
                                        <div className="flex flex-col items-center justify-center pt-5 pb-6">
                                            <Upload className="w-8 h-8 mb-2 text-muted-foreground" />
                                            <p className="text-sm text-muted-foreground">Carica CSV (email, name...)</p>
                                        </div>
                                        <input type="file" className="hidden" accept=".csv" onChange={async (e) => {
                                            if (e.target.files?.[0]) {
                                                await creditsApi.bulkInvite(e.target.files[0])
                                                queryClient.invalidateQueries({ queryKey: ['credits-invitations'] })
                                                alert("Caricamento completato")
                                            }
                                        }} />
                                    </label>
                                </div>
                            </CardContent>
                        </Card>

                        <Card className="md:col-span-2">
                            <CardHeader><CardTitle>Inviti Inviati</CardTitle></CardHeader>
                            <CardContent>
                                <div className="overflow-x-auto">
                                    <table className="w-full text-sm text-left">
                                        <thead className="bg-muted/50 text-muted-foreground uppercase text-xs">
                                            <tr>
                                                <th className="px-4 py-2">Email</th>
                                                <th className="px-4 py-2">Stato</th>
                                                <th className="px-4 py-2">Inviato il</th>
                                                <th className="px-4 py-2">Token</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {invitations?.map((inv: any) => (
                                                <tr key={inv.id} className="border-b">
                                                    <td className="px-4 py-2">{inv.email}</td>
                                                    <td className="px-4 py-2"><Badge variant="outline">{inv.status}</Badge></td>
                                                    <td className="px-4 py-2">{new Date(inv.created_at).toLocaleDateString()}</td>
                                                    <td className="px-4 py-2 font-mono text-xs truncate max-w-[100px]">{inv.token}</td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            </CardContent>
                        </Card>
                    </div>
                </TabsContent>
            </Tabs>
        </div>
    )
}
