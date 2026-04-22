import { useMemo, useRef, useState } from 'react'
import type { LucideIcon } from 'lucide-react'
import { ArrowRight, CheckCircle2, ExternalLink, Layers3, Search, Sparkles } from 'lucide-react'

export interface WikiFeature {
  title: string
  path: string
  description: string
  examples: string[]
  standardFlow: string[]
  extraOptions?: string[]
  classSharing: 'Si' | 'No' | 'Dipende'
  outputFormat: string
}

export interface WikiSection {
  id: string
  title: string
  description: string
  icon: LucideIcon
  features: WikiFeature[]
}

interface WikiGuidePageProps {
  roleLabel: string
  title: string
  intro: string
  sections: WikiSection[]
  accentColor: string
  accentSoft: string
  accentText: string
}

function sectionSlug(sectionId: string, featureTitle: string) {
  return `${sectionId}-${featureTitle.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`
}

function filterSections(sections: WikiSection[], query: string) {
  const normalized = query.trim().toLowerCase()
  if (!normalized) return sections

  return sections
    .map((section) => {
      const sectionMatches =
        section.title.toLowerCase().includes(normalized) ||
        section.description.toLowerCase().includes(normalized)

      const features = section.features.filter((feature) => {
        const haystack = [
          feature.title,
          feature.path,
          feature.description,
          feature.outputFormat,
          feature.classSharing,
          ...feature.examples,
          ...feature.standardFlow,
          ...(feature.extraOptions ?? []),
        ]
          .join(' ')
          .toLowerCase()

        return haystack.includes(normalized)
      })

      if (sectionMatches) return section
      return features.length > 0 ? { ...section, features } : null
    })
    .filter((section): section is WikiSection => section !== null)
}

export default function WikiGuidePage({
  roleLabel,
  title,
  intro,
  sections,
  accentColor,
  accentSoft,
  accentText,
}: WikiGuidePageProps) {
  const [query, setQuery] = useState('')
  const searchRef = useRef<HTMLInputElement>(null)
  const filteredSections = useMemo(() => filterSections(sections, query), [sections, query])
  const totalFeatures = sections.reduce((sum, section) => sum + section.features.length, 0)
  const filteredFeatures = filteredSections.reduce((sum, section) => sum + section.features.length, 0)

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-[1520px] px-4 py-6 md:px-6 md:py-8">
        <div
          className="overflow-hidden rounded-[30px] border shadow-[0_20px_60px_rgba(15,23,42,0.10)]"
          style={{
            borderColor: `${accentColor}26`,
            background: `linear-gradient(135deg, ${accentSoft}f2 0%, #ffffff 45%, #f8fafc 100%)`,
          }}
        >
          <div className="border-b border-slate-200/70 px-6 py-6 md:px-8 md:py-8">
            <div className="flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">
              <div className="max-w-4xl">
                <div
                  className="inline-flex items-center gap-2 rounded-full px-3 py-1 text-[11px] font-bold uppercase tracking-[0.18em]"
                  style={{ backgroundColor: `${accentColor}18`, color: accentText }}
                >
                  <Layers3 className="h-3.5 w-3.5" />
                  {roleLabel}
                </div>
                <h1 className="mt-4 text-3xl font-black tracking-tight text-slate-950 md:text-4xl">{title}</h1>
                <p className="mt-3 text-sm leading-7 text-slate-600 md:text-[15px]">{intro}</p>
              </div>

              <div className="xl:w-[380px]">
                <div
                  className="rounded-[24px] border p-4 shadow-sm"
                  style={{
                    borderColor: `${accentColor}2a`,
                    background: `linear-gradient(180deg, ${accentColor}12 0%, rgba(255,255,255,0.94) 100%)`,
                  }}
                >
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-[11px] font-bold uppercase tracking-[0.16em]" style={{ color: accentText }}>
                        Ricerca rapida
                      </p>
                      <p className="mt-1 text-xs text-slate-500">
                        Cerca sezioni, funzioni, output o esempi pratici.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => searchRef.current?.focus()}
                      className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-50"
                    >
                      <Search className="h-3.5 w-3.5" />
                      Cerca
                    </button>
                  </div>
                  <div className="mt-3 flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-3 py-2 shadow-sm">
                    <Search className="h-4 w-4 shrink-0 text-slate-400" />
                    <input
                      ref={searchRef}
                      value={query}
                      onChange={(event) => setQuery(event.target.value)}
                      placeholder="Es. RAG, dataset, notebook, classe..."
                      className="w-full bg-transparent text-sm text-slate-800 outline-none placeholder:text-slate-400"
                    />
                  </div>
                </div>
              </div>
            </div>

            <div className="mt-5 flex flex-wrap gap-2">
              {sections.map((section) => (
                <a
                  key={section.id}
                  href={`#${section.id}`}
                  className="rounded-full border border-slate-200 bg-white/90 px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:border-slate-300 hover:bg-white"
                >
                  {section.title}
                </a>
              ))}
            </div>
          </div>

          <div className="grid gap-6 px-4 py-5 md:grid-cols-[320px_minmax(0,1fr)] md:px-6 md:py-6">
            <aside className="md:sticky md:top-5 md:self-start">
              <div
                className="overflow-hidden rounded-[28px] border shadow-[0_14px_40px_rgba(15,23,42,0.08)]"
                style={{
                  borderColor: `${accentColor}26`,
                  background: `linear-gradient(180deg, ${accentColor}15 0%, rgba(255,255,255,0.98) 20%, rgba(255,255,255,0.96) 100%)`,
                }}
              >
                <div className="border-b border-slate-200/70 px-4 py-4">
                  <div className="flex items-center gap-3">
                    <div
                      className="flex h-10 w-10 items-center justify-center rounded-2xl"
                      style={{ backgroundColor: `${accentColor}18`, color: accentText }}
                    >
                      <Sparkles className="h-4.5 w-4.5" />
                    </div>
                    <div>
                      <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-slate-500">Indice wiki</p>
                      <p className="text-sm font-semibold text-slate-900">
                        {filteredSections.length} sezioni · {filteredFeatures}/{totalFeatures} funzioni
                      </p>
                    </div>
                  </div>
                </div>

                <div className="border-b border-slate-200/70 px-4 py-4">
                  <div className="flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-3 py-2 shadow-sm">
                    <Search className="h-4 w-4 shrink-0 text-slate-400" />
                    <input
                      value={query}
                      onChange={(event) => setQuery(event.target.value)}
                      placeholder="Filtra la wiki..."
                      className="w-full bg-transparent text-sm text-slate-800 outline-none placeholder:text-slate-400"
                    />
                  </div>
                </div>

                <div className="max-h-[calc(100vh-14rem)] overflow-y-auto p-3">
                  <div className="space-y-2">
                    {filteredSections.map((section) => {
                      const Icon = section.icon
                      return (
                        <div
                          key={section.id}
                          className="rounded-[22px] border border-slate-200/80 bg-white/92 p-2 shadow-sm"
                        >
                          <a
                            href={`#${section.id}`}
                            className="flex items-center gap-3 rounded-[18px] px-2 py-2 transition hover:bg-slate-50"
                          >
                            <div
                              className="flex h-10 w-10 items-center justify-center rounded-2xl"
                              style={{ backgroundColor: `${accentColor}14`, color: accentText }}
                            >
                              <Icon className="h-4 w-4" />
                            </div>
                            <div className="min-w-0">
                              <p className="truncate text-sm font-semibold text-slate-800">{section.title}</p>
                              <p className="text-[11px] text-slate-500">{section.features.length} funzionalita</p>
                            </div>
                          </a>

                          <div className="mt-1 space-y-1 px-2 pb-2">
                            {section.features.map((feature) => (
                              <a
                                key={feature.title}
                                href={`#${sectionSlug(section.id, feature.title)}`}
                                className="block rounded-xl border border-transparent px-3 py-2 text-sm text-slate-600 transition hover:border-slate-200 hover:bg-slate-50 hover:text-slate-900"
                              >
                                {feature.title}
                              </a>
                            ))}
                          </div>
                        </div>
                      )
                    })}

                    {filteredSections.length === 0 && (
                      <div className="rounded-[22px] border border-dashed border-slate-300 bg-white/92 px-4 py-6 text-center">
                        <p className="text-sm font-semibold text-slate-700">Nessun risultato</p>
                        <p className="mt-1 text-xs text-slate-500">Prova con un termine diverso o piu generico.</p>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </aside>

            <div className="space-y-5">
              <div className="grid gap-3 lg:grid-cols-3">
                <div
                  className="rounded-[24px] border p-4 shadow-sm"
                  style={{ borderColor: `${accentColor}26`, backgroundColor: `${accentColor}10` }}
                >
                  <p className="text-[11px] font-bold uppercase tracking-[0.16em]" style={{ color: accentText }}>
                    Sezioni
                  </p>
                  <p className="mt-2 text-3xl font-black text-slate-950">{filteredSections.length}</p>
                  <p className="mt-1 text-sm text-slate-600">Aree operative ordinate per ruolo e funzione.</p>
                </div>
                <div className="rounded-[24px] border border-slate-200 bg-white/92 p-4 shadow-sm">
                  <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-slate-500">Funzioni</p>
                  <p className="mt-2 text-3xl font-black text-slate-950">{filteredFeatures}</p>
                  <p className="mt-1 text-sm text-slate-600">Schede pratiche con flusso standard ed esempi.</p>
                </div>
                <div className="rounded-[24px] border border-slate-200 bg-slate-950 p-4 shadow-sm">
                  <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-slate-400">Navigazione</p>
                  <p className="mt-2 text-xl font-black text-white">Sidebar fissa + ricerca</p>
                  <p className="mt-1 text-sm text-slate-300">Indice laterale sempre disponibile mentre scorri la guida.</p>
                </div>
              </div>

              {filteredSections.map((section) => {
                const Icon = section.icon
                return (
                  <section
                    key={section.id}
                    id={section.id}
                    className="rounded-[28px] border border-slate-200 bg-white/92 p-4 shadow-sm md:p-5"
                  >
                    <div className="flex items-start gap-4">
                      <div
                        className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl"
                        style={{ backgroundColor: `${accentColor}14`, color: accentText }}
                      >
                        <Icon className="h-5 w-5" />
                      </div>
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <h2 className="text-xl font-bold tracking-tight text-slate-900">{section.title}</h2>
                          <span
                            className="rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.14em]"
                            style={{ backgroundColor: `${accentColor}14`, color: accentText }}
                          >
                            {section.features.length} funzioni
                          </span>
                        </div>
                        <p className="mt-1 text-sm leading-6 text-slate-600">{section.description}</p>
                      </div>
                    </div>

                    <div className="mt-5 space-y-4">
                      {section.features.map((feature) => (
                        <article
                          key={feature.title}
                          id={sectionSlug(section.id, feature.title)}
                          className="rounded-[24px] border border-slate-200 bg-slate-50/70 p-4 md:p-5"
                        >
                          <div className="flex flex-wrap items-start justify-between gap-3">
                            <div className="max-w-3xl">
                              <p
                                className="inline-flex rounded-full px-2.5 py-1 text-[11px] font-bold uppercase tracking-[0.16em]"
                                style={{ backgroundColor: `${accentColor}14`, color: accentText }}
                              >
                                {feature.path}
                              </p>
                              <h3 className="mt-3 text-lg font-bold text-slate-900">{feature.title}</h3>
                              <p className="mt-2 text-sm leading-6 text-slate-600">{feature.description}</p>
                            </div>
                            <div
                              className="rounded-2xl border px-3 py-2 text-right"
                              style={{ borderColor: `${accentColor}2a`, backgroundColor: `${accentColor}0d` }}
                            >
                              <p className="text-[10px] font-bold uppercase tracking-[0.14em]" style={{ color: accentText }}>
                                Condivisione classe
                              </p>
                              <p className="mt-1 text-sm font-semibold text-slate-900">{feature.classSharing}</p>
                            </div>
                          </div>

                          <div className="mt-4 grid gap-3 md:grid-cols-3">
                            <div className="rounded-2xl border border-slate-200 bg-white p-3">
                              <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-slate-500">
                                Flusso standard
                              </p>
                              <div className="mt-3 space-y-2">
                                {feature.standardFlow.map((step, index) => (
                                  <div key={step} className="flex items-start gap-2.5">
                                    <div
                                      className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-white"
                                      style={{ backgroundColor: accentColor }}
                                    >
                                      {index + 1}
                                    </div>
                                    <p className="text-sm leading-5 text-slate-700">{step}</p>
                                  </div>
                                ))}
                              </div>
                            </div>

                            <div className="rounded-2xl border border-slate-200 bg-white p-3">
                              <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-slate-500">
                                Esempi concreti
                              </p>
                              <div className="mt-3 space-y-2">
                                {feature.examples.map((example) => (
                                  <div key={example} className="flex items-start gap-2.5">
                                    <ArrowRight className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
                                    <p className="text-sm leading-5 text-slate-700">{example}</p>
                                  </div>
                                ))}
                              </div>
                            </div>

                            <div className="rounded-2xl border border-slate-200 bg-white p-3">
                              <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-slate-500">
                                Dati utili
                              </p>
                              <div className="mt-3 space-y-3">
                                <div>
                                  <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-400">
                                    Formato output
                                  </p>
                                  <p className="mt-1 text-sm font-medium text-slate-800">{feature.outputFormat}</p>
                                </div>
                                {feature.extraOptions && feature.extraOptions.length > 0 && (
                                  <div>
                                    <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-400">
                                      Possibilita aggiuntive
                                    </p>
                                    <div className="mt-2 space-y-2">
                                      {feature.extraOptions.map((option) => (
                                        <div key={option} className="flex items-start gap-2">
                                          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" style={{ color: accentColor }} />
                                          <p className="text-sm leading-5 text-slate-700">{option}</p>
                                        </div>
                                      ))}
                                    </div>
                                  </div>
                                )}
                              </div>
                            </div>
                          </div>
                        </article>
                      ))}
                    </div>
                  </section>
                )
              })}
            </div>
          </div>
        </div>

        <div className="mt-5 rounded-[24px] border border-slate-200 bg-white/82 px-5 py-4 text-sm text-slate-500 shadow-sm">
          <div className="flex items-start gap-3">
            <ExternalLink className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
            <p>
              Questa wiki descrive il flusso standard della piattaforma. Se una sessione o un modulo ha impostazioni
              personalizzate, il docente puo limitare o estendere alcune funzionalita.
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
