import { useState } from 'react'
import { createPortal } from 'react-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { X, Plus, Copy, Trash2, ArrowLeft, Loader2, Link2, Bot, User } from 'lucide-react'
import { useToast } from '@/components/ui/use-toast'
import { teacherbotsApi } from '@/lib/api'

interface TeacherbotShareLinksModalProps {
  teacherbotId: string
  teacherbotName: string
  onClose: () => void
}

interface ShareLink {
  id: string
  token: string
  access_code: string
  label: string | null
  expires_at: string
  is_active: boolean
  created_at: string
}

interface ShareConversation {
  id: string
  visitor_label: string | null
  created_at: string
  updated_at: string
}

interface ShareMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  created_at: string
}

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
function generateAccessCode(length = 6): string {
  let code = ''
  for (let i = 0; i < length; i++) code += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]
  return code
}

function defaultExpiryLocal(): string {
  const d = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) // +7 days
  d.setSeconds(0, 0)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function isExpired(link: ShareLink): boolean {
  return new Date(link.expires_at).getTime() <= Date.now()
}

type View = 'list' | 'create' | 'conversations' | 'messages'

export default function TeacherbotShareLinksModal({ teacherbotId, teacherbotName, onClose }: TeacherbotShareLinksModalProps) {
  const { toast } = useToast()
  const queryClient = useQueryClient()
  const [view, setView] = useState<View>('list')
  const [label, setLabel] = useState('')
  const [expiresAt, setExpiresAt] = useState(defaultExpiryLocal())
  const [accessCode, setAccessCode] = useState(() => generateAccessCode())
  const [selectedLink, setSelectedLink] = useState<ShareLink | null>(null)
  const [selectedConversation, setSelectedConversation] = useState<ShareConversation | null>(null)

  const linksQuery = useQuery({
    queryKey: ['teacherbot-share-links', teacherbotId],
    queryFn: async () => (await teacherbotsApi.listShareLinks(teacherbotId)).data as ShareLink[],
  })

  const conversationsQuery = useQuery({
    queryKey: ['teacherbot-share-conversations', teacherbotId, selectedLink?.id],
    queryFn: async () => (await teacherbotsApi.listShareLinkConversations(teacherbotId, selectedLink!.id)).data as ShareConversation[],
    enabled: view === 'conversations' && Boolean(selectedLink),
  })

  const messagesQuery = useQuery({
    queryKey: ['teacherbot-share-messages', teacherbotId, selectedConversation?.id],
    queryFn: async () => (await teacherbotsApi.getShareConversationMessages(teacherbotId, selectedConversation!.id)).data as ShareMessage[],
    enabled: view === 'messages' && Boolean(selectedConversation),
  })

  const createMutation = useMutation({
    mutationFn: () => teacherbotsApi.createShareLink(teacherbotId, {
      expires_at: new Date(expiresAt).toISOString(),
      label: label.trim() || undefined,
      access_code: accessCode.trim() || undefined,
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['teacherbot-share-links', teacherbotId] })
      toast({ title: 'Link creato' })
      setLabel('')
      setAccessCode(generateAccessCode())
      setExpiresAt(defaultExpiryLocal())
      setView('list')
    },
    onError: () => {
      toast({ title: 'Errore', description: 'Impossibile creare il link', variant: 'destructive' })
    },
  })

  const revokeMutation = useMutation({
    mutationFn: (linkId: string) => teacherbotsApi.revokeShareLink(teacherbotId, linkId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['teacherbot-share-links', teacherbotId] })
      toast({ title: 'Link revocato' })
    },
  })

  const linkUrl = (token: string) => `${window.location.origin}/bot/${token}`

  const copyLink = async (token: string) => {
    try {
      await navigator.clipboard.writeText(linkUrl(token))
      toast({ title: 'Link copiato' })
    } catch {
      toast({ title: 'Errore', description: 'Impossibile copiare il link', variant: 'destructive' })
    }
  }

  return createPortal(
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl p-8 w-full max-w-lg shadow-2xl max-h-[85vh] flex flex-col">
        <div className="flex justify-between items-center mb-4 flex-shrink-0">
          <div className="flex items-center gap-2">
            {view !== 'list' && (
              <button
                onClick={() => {
                  if (view === 'messages') setView('conversations')
                  else setView('list')
                }}
                className="text-slate-400 hover:text-slate-700"
              >
                <ArrowLeft className="h-4 w-4" />
              </button>
            )}
            <h3 className="text-lg font-bold text-slate-800 flex items-center gap-2">
              <Link2 className="h-4 w-4" />
              {view === 'list' && `Link pubblici — ${teacherbotName}`}
              {view === 'create' && 'Nuovo link'}
              {view === 'conversations' && `Conversazioni — ${selectedLink?.label || linkUrl(selectedLink?.token || '')}`}
              {view === 'messages' && 'Conversazione'}
            </h3>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose}>
            <X className="h-5 w-5" />
          </Button>
        </div>

        <div className="flex-1 overflow-y-auto">
          {view === 'list' && (
            <>
              <p className="text-sm text-slate-600 mb-4">
                Chi apre il link deve inserire il codice di accesso. Il link smette di funzionare dopo la scadenza.
              </p>
              {linksQuery.isLoading ? (
                <div className="flex items-center justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-slate-400" /></div>
              ) : linksQuery.data && linksQuery.data.length > 0 ? (
                <div className="space-y-2 mb-4">
                  {linksQuery.data.map((link) => {
                    const expired = isExpired(link)
                    const active = link.is_active && !expired
                    return (
                      <div key={link.id} className="p-3 rounded-xl border border-slate-200">
                        <div className="flex items-center justify-between gap-2 mb-1">
                          <span className="font-medium text-slate-800 truncate">{link.label || 'Link senza nome'}</span>
                          <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${active ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-500'}`}>
                            {!link.is_active ? 'Revocato' : expired ? 'Scaduto' : 'Attivo'}
                          </span>
                        </div>
                        <div className="text-xs text-slate-500 mb-2">
                          Codice: <span className="font-mono font-semibold text-slate-700">{link.access_code}</span>
                          {' · '}Scade il {new Date(link.expires_at).toLocaleString()}
                        </div>
                        <div className="flex items-center gap-2 flex-wrap">
                          <button
                            onClick={() => copyLink(link.token)}
                            className="text-xs flex items-center gap-1 text-slate-600 hover:text-slate-900"
                          >
                            <Copy className="h-3 w-3" /> Copia link
                          </button>
                          <button
                            onClick={() => { setSelectedLink(link); setView('conversations') }}
                            className="text-xs flex items-center gap-1 text-slate-600 hover:text-slate-900"
                          >
                            <User className="h-3 w-3" /> Conversazioni
                          </button>
                          {link.is_active && (
                            <button
                              onClick={() => revokeMutation.mutate(link.id)}
                              className="text-xs flex items-center gap-1 text-red-600 hover:text-red-800 ml-auto"
                            >
                              <Trash2 className="h-3 w-3" /> Revoca
                            </button>
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>
              ) : (
                <p className="text-center text-sm text-slate-400 py-6">Nessun link creato per questo teacherbot.</p>
              )}
              <Button onClick={() => setView('create')} className="w-full bg-[#181b1e] hover:bg-[#0f1113]">
                <Plus className="h-4 w-4 mr-2" /> Crea link
              </Button>
            </>
          )}

          {view === 'create' && (
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Nome (opzionale)</label>
                <input
                  type="text"
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                  placeholder="Es. Classe 3B — verifica"
                  className="w-full px-3 py-2 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-[#181b1e] focus:border-transparent"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Scadenza</label>
                <input
                  type="datetime-local"
                  value={expiresAt}
                  onChange={(e) => setExpiresAt(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-[#181b1e] focus:border-transparent"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Codice di accesso</label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={accessCode}
                    onChange={(e) => setAccessCode(e.target.value.toUpperCase())}
                    maxLength={12}
                    className="flex-1 px-3 py-2 border border-slate-200 rounded-xl text-sm font-mono tracking-wider focus:ring-2 focus:ring-[#181b1e] focus:border-transparent"
                  />
                  <Button type="button" variant="outline" onClick={() => setAccessCode(generateAccessCode())}>
                    Rigenera
                  </Button>
                </div>
                <p className="text-xs text-slate-400 mt-1">Generato automaticamente, puoi modificarlo.</p>
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <Button variant="ghost" onClick={() => setView('list')}>Annulla</Button>
                <Button
                  onClick={() => createMutation.mutate()}
                  disabled={!expiresAt || !accessCode.trim() || createMutation.isPending}
                  className="bg-[#181b1e] hover:bg-[#0f1113]"
                >
                  {createMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Crea link'}
                </Button>
              </div>
            </div>
          )}

          {view === 'conversations' && (
            conversationsQuery.isLoading ? (
              <div className="flex items-center justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-slate-400" /></div>
            ) : conversationsQuery.data && conversationsQuery.data.length > 0 ? (
              <div className="space-y-2">
                {conversationsQuery.data.map((conv) => (
                  <button
                    key={conv.id}
                    onClick={() => { setSelectedConversation(conv); setView('messages') }}
                    className="w-full text-left p-3 rounded-xl border border-slate-200 hover:border-[#181b1e]/20 hover:bg-slate-50"
                  >
                    <div className="text-sm text-slate-700">{conv.visitor_label || 'Visitatore anonimo'}</div>
                    <div className="text-xs text-slate-400">{new Date(conv.created_at).toLocaleString()}</div>
                  </button>
                ))}
              </div>
            ) : (
              <p className="text-center text-sm text-slate-400 py-6">Nessuna conversazione ancora.</p>
            )
          )}

          {view === 'messages' && (
            messagesQuery.isLoading ? (
              <div className="flex items-center justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-slate-400" /></div>
            ) : (
              <div className="space-y-3">
                {(messagesQuery.data || []).map((msg) => (
                  <div key={msg.id} className={`flex gap-2 ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                    {msg.role === 'assistant' && (
                      <div className="w-6 h-6 rounded-lg bg-[#181b1e] flex items-center justify-center flex-shrink-0">
                        <Bot className="h-3.5 w-3.5 text-white" />
                      </div>
                    )}
                    <div className={`max-w-[75%] px-3 py-2 rounded-2xl text-sm ${msg.role === 'user' ? 'bg-[#181b1e] text-white rounded-tr-sm' : 'bg-slate-100 text-slate-800 rounded-tl-sm'}`}>
                      {msg.content}
                    </div>
                  </div>
                ))}
              </div>
            )
          )}
        </div>
      </div>
    </div>,
    document.body
  )
}
