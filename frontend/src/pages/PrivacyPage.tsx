import { Link } from 'react-router-dom'
import { ChevronLeft, ExternalLink, FileText } from '@/components/icons'
import { PRIVACY_DOCUMENT_URL, PRIVACY_DOCUMENT_VIEWER_URL } from '@/lib/legalDocuments'
import { tl } from '@/i18n/tl'

export default function PrivacyPage() {
  return (
    <div className="min-h-screen bg-slate-50 font-sans text-slate-900">
      <nav aria-label={tl("Navigazione")} className="border-b border-slate-200 bg-white px-4 py-4 sm:px-6">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4">
          <Link to="/" className="flex items-center gap-3">
            <img src="/logo_new.png" alt={tl("Golinelli AI")} className="h-9 w-auto rounded-md" />
            <span className="text-xl tracking-tight" style={{ fontFamily: 'var(--font-family-brand)' }}>
              <span className="font-bold text-[var(--logo-ink)]">Golinelli</span>
              <span className="font-black text-[var(--logo-pink)]">.ai</span>
            </span>
          </Link>
          <Link to="/" className="flex items-center gap-1.5 rounded-full border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50">
            <ChevronLeft size={14} /> {tl("Torna alla home")}
          </Link>
        </div>
      </nav>
      <main className="mx-auto max-w-6xl space-y-5 px-4 py-8 sm:px-6">
        <header className="space-y-3">
          <h1 className="flex items-center gap-3 text-2xl font-bold sm:text-3xl">
            <FileText className="h-7 w-7 shrink-0 text-[var(--logo-pink)]" />
            {tl("Informativa sul trattamento dei dati personali")}
          </h1>
          <p className="text-sm text-slate-600">{tl("Golinelli.ai – AI Playground · Versione 2.0 · Data di emissione: 26 ottobre 2026")}</p>
          <a href={PRIVACY_DOCUMENT_URL} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 text-sm font-medium text-indigo-700 hover:underline">
            {tl("Apri il PDF in una nuova scheda")} <ExternalLink size={15} />
          </a>
        </header>
        <iframe
          src={PRIVACY_DOCUMENT_VIEWER_URL}
          title={tl("Informativa privacy Golinelli.ai – versione 2.0")}
          className="h-[80vh] min-h-[480px] w-full rounded-xl border border-slate-200 bg-white"
        />
      </main>
    </div>
  )
}
