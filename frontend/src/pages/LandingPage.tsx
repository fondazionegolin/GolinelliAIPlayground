import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { 
  ShieldCheck, 
  Sparkles, 
  Workflow, 
  FlaskConical, 
  Eye, 
  GraduationCap, 
  School, 
  ArrowRight,
  Menu,
  X
} from 'lucide-react'
import { useAuthStore } from '@/stores/auth'
import { authApi } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useToast } from '@/components/ui/use-toast'

// --- Animated Background Component ---
const AnimatedBackground = () => (
  <div className="absolute inset-0 overflow-hidden -z-10 bg-slate-50">
    <div className="absolute top-0 left-0 w-full h-full bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-sky-100 via-slate-50 to-white opacity-80" />
    <motion.div 
      animate={{ 
        scale: [1, 1.2, 1],
        rotate: [0, 90, 0],
        x: [0, 100, 0],
        y: [0, -50, 0]
      }}
      transition={{ duration: 20, repeat: Infinity, ease: "linear" }}
      className="absolute -top-20 -right-20 w-96 h-96 bg-purple-200 rounded-full mix-blend-multiply filter blur-3xl opacity-30"
    />
    <motion.div 
      animate={{ 
        scale: [1, 1.1, 1],
        rotate: [0, -60, 0],
        x: [0, -50, 0],
        y: [0, 100, 0]
      }}
      transition={{ duration: 15, repeat: Infinity, ease: "linear" }}
      className="absolute top-40 -left-20 w-72 h-72 bg-sky-200 rounded-full mix-blend-multiply filter blur-3xl opacity-30"
    />
    <motion.div 
      animate={{ 
        scale: [1, 1.3, 1],
        x: [0, 50, 0],
        y: [0, 50, 0]
      }}
      transition={{ duration: 18, repeat: Infinity, ease: "linear" }}
      className="absolute bottom-20 right-20 w-80 h-80 bg-teal-200 rounded-full mix-blend-multiply filter blur-3xl opacity-30"
    />
  </div>
)

// --- Features Data ---
const FEATURES = [
  {
    title: 'Teacher in the Loop',
    body: 'Il docente mantiene il pieno controllo su prompt, pubblicazioni e workflow didattici, garantendo sempre la supervisione umana.',
    icon: Workflow,
    color: 'text-indigo-700',
    bg: 'bg-indigo-100'
  },
  {
    title: 'Privacy by Design',
    body: 'Dati sicuri e segregati per tenant. Nessun utilizzo dei dati degli studenti per addestrare modelli esterni.',
    icon: ShieldCheck,
    color: 'text-emerald-700',
    bg: 'bg-emerald-100'
  },
  {
    title: 'AI Education',
    body: 'Piattaforma progettata per l\'educazione, senza scoring automatico o valutazioni invasive.',
    icon: Eye,
    color: 'text-rose-700',
    bg: 'bg-rose-100'
  },
  {
    title: 'Multimodale',
    body: 'Chat, documenti, immagini e quiz integrati in un unico ambiente di lezione collaborativo.',
    icon: Sparkles,
    color: 'text-amber-700',
    bg: 'bg-amber-100'
  },
]

export default function LandingPage() {
  const [activeTab, setActiveTab] = useState<'home' | 'teachers' | 'students'>('home')
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false)
  
  // Navigation Handler
  const switchTab = (tab: 'home' | 'teachers' | 'students') => {
    setActiveTab(tab)
    setIsMobileMenuOpen(false)
  }

  return (
    <div className="relative min-h-screen w-full flex flex-col font-sans text-slate-900">
      <AnimatedBackground />

      {/* --- Navbar --- */}
      <nav className="sticky top-0 z-50 w-full backdrop-blur-md bg-white/70 border-b border-white/50 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3 cursor-pointer" onClick={() => switchTab('home')}>
          <img src="/logo_new.png" alt="Golinelli AI" className="h-10 w-auto shadow-sm rounded-md" />
          <span className="font-bold text-2xl tracking-tight">
            <span 
              className="text-slate-200/90" 
              style={{ WebkitTextStroke: '0.5px #475569' }}
            >
              Golinelli
            </span>
            <span className="bg-clip-text text-transparent bg-gradient-to-r from-rose-500 to-red-600">.ai</span>
          </span>
        </div>

        {/* Desktop Menu */}
        <div className="hidden md:flex items-center gap-1 bg-slate-100/50 p-1 rounded-full border border-slate-200/50">
          <TabButton active={activeTab === 'home'} onClick={() => switchTab('home')}>Esplora</TabButton>
          <TabButton active={activeTab === 'teachers'} onClick={() => switchTab('teachers')}>Docenti</TabButton>
          <TabButton active={activeTab === 'students'} onClick={() => switchTab('students')}>Studenti</TabButton>
        </div>

        <div className="hidden md:block w-24">
           {/* Spacer for balance */}
        </div>

        {/* Mobile Menu Toggle */}
        <button className="md:hidden p-2 text-slate-700" onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}>
          {isMobileMenuOpen ? <X /> : <Menu />}
        </button>
      </nav>

      {/* --- Mobile Menu Overlay --- */}
      <AnimatePresence>
        {isMobileMenuOpen && (
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="absolute top-20 left-0 right-0 z-40 bg-white border-b shadow-xl p-4 md:hidden flex flex-col gap-2"
          >
            <Button variant={activeTab === 'home' ? 'default' : 'ghost'} onClick={() => switchTab('home')} className="w-full justify-start">Esplora</Button>
            <Button variant={activeTab === 'teachers' ? 'default' : 'ghost'} onClick={() => switchTab('teachers')} className="w-full justify-start">Area Docenti</Button>
            <Button variant={activeTab === 'students' ? 'default' : 'ghost'} onClick={() => switchTab('students')} className="w-full justify-start">Area Studenti</Button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* --- Main Content Area --- */}
      <main className="flex-grow flex items-center justify-center p-4 md:p-8 relative overflow-hidden">
        <AnimatePresence mode="wait">
          {activeTab === 'home' && <HomeSection key="home" onCta={() => switchTab('teachers')} />}
          {activeTab === 'teachers' && <TeachersSection key="teachers" />}
          {activeTab === 'students' && <StudentsSection key="students" />}
        </AnimatePresence>
      </main>

      {/* --- Footer --- */}
      <footer className="py-6 text-center text-sm text-slate-500 bg-white/40 backdrop-blur-sm border-t border-white/50">
        <p>© 2024 Fondazione Golinelli. Tutti i diritti riservati.</p>
      </footer>
    </div>
  )
}

// --- Components ---

function TabButton({ active, children, onClick }: { active: boolean, children: React.ReactNode, onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`relative px-6 py-2 rounded-full text-sm font-medium transition-all duration-300 ${
        active ? 'text-white shadow-md' : 'text-slate-600 hover:bg-white/50'
      }`}
    >
      {active && (
        <motion.div
          layoutId="activeTab"
          className="absolute inset-0 bg-slate-900 rounded-full"
          transition={{ type: "spring", bounce: 0.2, duration: 0.6 }}
        />
      )}
      <span className="relative z-10">{children}</span>
    </button>
  )
}

function HomeSection({ onCta }: { onCta: () => void }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -20 }}
      transition={{ duration: 0.5 }}
      className="max-w-5xl w-full grid md:grid-cols-2 gap-12 items-center"
    >
      <div className="space-y-6 text-center md:text-left">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-blue-50 border border-blue-100 text-blue-700 text-xs font-semibold uppercase tracking-wider">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-2 w-2 bg-blue-500"></span>
          </span>
          Nuova Piattaforma Didattica
        </div>
        
        <h1 className="text-4xl md:text-6xl font-black text-slate-900 leading-tight">
          L'Intelligenza Artificiale <br />
          <span className="bg-clip-text text-transparent bg-gradient-to-r from-blue-600 via-indigo-600 to-purple-600">
            entra in classe.
          </span>
        </h1>
        
        <p className="text-lg text-slate-600 leading-relaxed max-w-lg mx-auto md:mx-0">
          Un ambiente sicuro, controllato e creativo dove docenti e studenti esplorano le potenzialità dell'AI Generativa.
        </p>
        
        <div className="flex flex-col sm:flex-row gap-4 justify-center md:justify-start">
          <Button size="lg" onClick={onCta} className="bg-slate-900 hover:bg-slate-800 text-white rounded-full px-8 shadow-lg hover:shadow-xl transition-all">
            Inizia Ora
          </Button>
          <a href="https://www.fondazionegolinelli.it" target="_blank" rel="noreferrer">
             <Button variant="outline" size="lg" className="rounded-full px-8 border-slate-300">
                Scopri di più
             </Button>
          </a>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {FEATURES.map((f, i) => (
          <motion.div
            key={f.title}
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: 0.1 * i }}
            className="p-5 bg-white/80 backdrop-blur-xl border border-white/80 rounded-2xl shadow-sm hover:shadow-md transition-all hover:-translate-y-1"
          >
            <div className={`w-10 h-10 rounded-xl ${f.bg} ${f.color} flex items-center justify-center mb-3`}>
              <f.icon size={20} />
            </div>
            <h3 className="font-bold text-slate-900 mb-1">{f.title}</h3>
            <p className="text-sm text-slate-700 leading-relaxed">{f.body}</p>
          </motion.div>
        ))}
      </div>
    </motion.div>
  )
}

function TeachersSection() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const navigate = useNavigate()
  const { setUser } = useAuthStore()
  const { toast } = useToast()

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    try {
      const response = await authApi.login(email, password)
      const { access_token, user_id, role, tenant_id } = response.data
      setUser({ id: user_id, email, role, tenant_id }, access_token)
      navigate(role === 'ADMIN' ? '/admin' : '/teacher')
    } catch (error: any) {
      const detail = error.response?.data?.detail
      toast({
        variant: 'destructive',
        title: 'Accesso Fallito',
        description: typeof detail === 'string' ? detail : 'Controlla le credenziali.',
      })
    } finally {
      setLoading(false)
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -20 }}
      className="max-w-md w-full"
    >
      <div className="bg-white/80 backdrop-blur-xl rounded-3xl shadow-2xl border border-white/50 overflow-hidden">
        <div className="bg-slate-900 p-6 text-white text-center relative overflow-hidden">
          <div className="absolute top-0 left-0 w-full h-full bg-gradient-to-br from-indigo-600 to-slate-900 opacity-90"></div>
          <div className="relative z-10">
            <School className="w-12 h-12 mx-auto mb-3 opacity-80" />
            <h2 className="text-2xl font-bold">Area Docenti</h2>
            <p className="text-indigo-200 text-sm">Accedi per gestire le tue classi</p>
          </div>
        </div>
        
        <div className="p-8">
          <form onSubmit={handleLogin} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">Email Istituzionale</Label>
              <Input 
                id="email" 
                type="email" 
                placeholder="nome.cognome@scuola.it"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="bg-slate-50 border-slate-200 focus:ring-indigo-500"
                required
              />
            </div>
            <div className="space-y-2">
              <div className="flex justify-between">
                 <Label htmlFor="password">Password</Label>
                 <a href="#" className="text-xs text-indigo-600 hover:underline">Recupera?</a>
              </div>
              <Input 
                id="password" 
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="bg-slate-50 border-slate-200 focus:ring-indigo-500"
                required
              />
            </div>
            
            <Button type="submit" className="w-full bg-indigo-600 hover:bg-indigo-700 h-11 text-base shadow-lg shadow-indigo-200" disabled={loading}>
              {loading ? 'Verifica in corso...' : 'Accedi al Portale'}
            </Button>
          </form>

          <div className="mt-8 pt-6 border-t border-slate-100 text-center">
            <p className="text-sm text-slate-500 mb-3">Non hai ancora un account?</p>
            <Link to="/teacher-request">
              <Button variant="outline" className="w-full border-indigo-200 text-indigo-700 hover:bg-indigo-50 hover:text-indigo-800">
                Richiedi Accesso Docente
              </Button>
            </Link>
          </div>
        </div>
      </div>
      
      {/* Beta disclaimer mini */}
      <div className="mt-4 text-center">
        <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-amber-100 text-amber-800 text-xs font-medium border border-amber-200">
          <FlaskConical size={12} /> Piattaforma in Beta Privata
        </span>
      </div>
    </motion.div>
  )
}

function StudentsSection() {
  
  return (
    <motion.div
      initial={{ opacity: 0, x: -20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 20 }}
      className="max-w-md w-full"
    >
      <div className="bg-white/80 backdrop-blur-xl rounded-3xl shadow-2xl border border-white/50 overflow-hidden">
        <div className="bg-gradient-to-r from-teal-500 to-emerald-600 p-6 text-white text-center">
          <GraduationCap className="w-12 h-12 mx-auto mb-3 text-emerald-100" />
          <h2 className="text-2xl font-bold">Area Studenti</h2>
          <p className="text-emerald-50 text-sm">Entra nella tua classe virtuale</p>
        </div>
        
        <div className="p-8 text-center">
          <p className="text-slate-600 mb-6">
            Hai un codice sessione fornito dal tuo insegnante? Inseriscilo qui sotto per iniziare.
          </p>
          
          <Link to="/join">
            <Button size="lg" className="w-full h-14 text-lg bg-teal-600 hover:bg-teal-700 shadow-lg shadow-teal-200 group">
              Entra con Codice
              <ArrowRight className="ml-2 w-5 h-5 group-hover:translate-x-1 transition-transform" />
            </Button>
          </Link>
          
          <div className="mt-8 bg-teal-50 rounded-xl p-4 border border-teal-100">
            <h4 className="font-semibold text-teal-800 text-sm mb-1">Come funziona?</h4>
            <p className="text-xs text-teal-700">
              L'insegnante proietterà un codice QR o un codice numerico. Usalo per unirti alla lezione in tempo reale.
            </p>
          </div>
        </div>
      </div>
    </motion.div>
  )
}
