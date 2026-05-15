import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'
import { ArrowRight, CheckCircle2, Layers3, Search, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'

export interface WikiFeature {
  title: string
  path: string
  description: string
  examples: string[]
  standardFlow: string[]
  extraOptions?: string[]
  classSharing: string
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

function featureMatches(feature: WikiFeature, normalizedQuery: string) {
  const haystack = [
    feature.title,
    feature.path,
    feature.description,
    feature.outputFormat,
    feature.classSharing,
    ...feature.examples,
    ...feature.standardFlow,
    ...(feature.extraOptions ?? []),
  ].join(' ').toLowerCase()

  return haystack.includes(normalizedQuery)
}

function sectionMatches(section: WikiSection, normalizedQuery: string) {
  return (
    section.title.toLowerCase().includes(normalizedQuery) ||
    section.description.toLowerCase().includes(normalizedQuery)
  )
}

function filterSections(sections: WikiSection[], query: string) {
  const normalized = query.trim().toLowerCase()
  if (!normalized) return sections

  return sections
    .map((section) => {
      if (sectionMatches(section, normalized)) return section

      const features = section.features.filter((feature) => featureMatches(feature, normalized))
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
  accentSoft: _accentSoft,
  accentText,
}: WikiGuidePageProps) {
  const { t } = useTranslation()
  void _accentSoft
  const [query, setQuery] = useState('')
  const [activeSectionId, setActiveSectionId] = useState(sections[0]?.id ?? '')
  const [activeFeatureTitle, setActiveFeatureTitle] = useState<string | null>(null)
  const contentRef = useRef<HTMLDivElement>(null)

  const filteredSections = useMemo(() => filterSections(sections, query), [sections, query])
  const activeSection = filteredSections.find((section) => section.id === activeSectionId) ?? filteredSections[0] ?? null
  const ActiveSectionIcon = activeSection?.icon
  const totalFeatures = sections.reduce((sum, section) => sum + section.features.length, 0)
  const visibleFeatures = filteredSections.reduce((sum, section) => sum + section.features.length, 0)

  useEffect(() => {
    if (!filteredSections.length) return
    if (!filteredSections.some((section) => section.id === activeSectionId)) {
      setActiveSectionId(filteredSections[0].id)
      setActiveFeatureTitle(null)
    }
  }, [activeSectionId, filteredSections])

  useEffect(() => {
    contentRef.current?.scrollTo({ top: 0 })
  }, [activeSectionId, query])

  const handleSelectSection = (sectionId: string) => {
    setActiveSectionId(sectionId)
    setActiveFeatureTitle(null)
  }

  const handleSelectFeature = (sectionId: string, featureTitle: string) => {
    setActiveSectionId(sectionId)
    setActiveFeatureTitle(featureTitle)
    requestAnimationFrame(() => {
      document.getElementById(`wiki-feature-${sectionId}-${featureTitle}`)?.scrollIntoView({
        block: 'start',
        behavior: 'smooth',
      })
    })
  }

  return (
    <div className="flex h-full min-h-0 bg-white">
      <aside className="hidden w-80 shrink-0 border-r border-slate-200 bg-white/94 backdrop-blur-xl md:flex md:flex-col">
        <div className="border-b border-slate-200 px-4 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-slate-100" style={{ color: accentText }}>
              <Layers3 className="h-4 w-4" />
            </div>
            <div className="min-w-0">
              <p className="text-[10px] font-bold uppercase tracking-[0.18em]" style={{ color: accentText }}>
                {roleLabel}
              </p>
              <h1 className="truncate text-sm font-bold text-slate-950">{title}</h1>
            </div>
          </div>
          <p className="mt-3 text-xs leading-5 text-slate-500">{intro}</p>
        </div>

        <div className="border-b border-slate-200 px-3 py-3">
          <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
            <Search className="h-4 w-4 shrink-0 text-slate-400" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t('wiki.search_placeholder')}
              className="min-w-0 flex-1 bg-transparent text-sm text-slate-800 outline-none placeholder:text-slate-400"
            />
            {query && (
              <button onClick={() => setQuery('')} className="text-slate-400 transition hover:text-slate-700">
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
          <div className="mt-2 flex items-center justify-between text-[10px] font-medium text-slate-400">
            <span>{t('wiki.sections_count', { count: filteredSections.length })}</span>
            <span>{t('wiki.features_count', { visible: visibleFeatures, total: totalFeatures })}</span>
          </div>
        </div>

        <nav className="flex-1 overflow-y-auto px-2 py-3">
          {filteredSections.length === 0 ? (
            <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 px-3 py-5 text-center">
              <p className="text-sm font-semibold text-slate-700">{t('wiki.no_results_title')}</p>
              <p className="mt-1 text-xs text-slate-500">{t('wiki.no_results_body')}</p>
            </div>
          ) : (
            <div className="space-y-1">
              {filteredSections.map((section) => {
                const Icon = section.icon
                const isActive = activeSection?.id === section.id

                return (
                  <div key={section.id} className="rounded-lg">
                    <button
                      onClick={() => handleSelectSection(section.id)}
                      className={`flex w-full items-center gap-2 rounded-lg border px-2.5 py-2 text-left transition ${
                        isActive
                          ? 'border-slate-300 bg-slate-100 text-slate-950'
                          : 'border-transparent text-slate-600 hover:bg-slate-50 hover:text-slate-900'
                      }`}
                    >
                      <Icon className="h-4 w-4 shrink-0" style={isActive ? { color: accentColor } : undefined} />
                      <span className="min-w-0 flex-1 truncate text-sm font-semibold">{section.title}</span>
                      <span className="rounded-full bg-white px-1.5 py-0.5 text-[10px] font-bold text-slate-500">
                        {section.features.length}
                      </span>
                    </button>

                    {isActive && (
                      <div className="ml-4 mt-1 border-l border-slate-200 pl-2">
                        {section.features.map((feature) => (
                          <button
                            key={feature.title}
                            onClick={() => handleSelectFeature(section.id, feature.title)}
                            className={`block w-full rounded-md px-2 py-1.5 text-left text-xs transition ${
                              activeFeatureTitle === feature.title
                                ? 'bg-white font-semibold text-slate-950 shadow-sm'
                                : 'text-slate-500 hover:bg-slate-50 hover:text-slate-800'
                            }`}
                          >
                            <span className="line-clamp-2">{feature.title}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </nav>
      </aside>

      <main ref={contentRef} className="flex-1 overflow-y-auto">
        <div className="w-full px-4 py-0 md:px-6 md:py-0">
          <div className="sticky top-0 z-10 -mx-4 border-b border-slate-200 bg-white/96 px-4 py-3 backdrop-blur md:hidden">
            <div className="mb-3 flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
              <Search className="h-4 w-4 text-slate-400" />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={t('wiki.search_placeholder')}
                className="min-w-0 flex-1 bg-transparent text-sm outline-none"
              />
            </div>
            <div className="flex gap-2 overflow-x-auto pb-1">
              {filteredSections.map((section) => (
                <button
                  key={section.id}
                  onClick={() => handleSelectSection(section.id)}
                  className={`shrink-0 rounded-full border px-3 py-1.5 text-xs font-semibold ${
                    activeSection?.id === section.id
                      ? 'border-slate-950 bg-slate-950 text-white'
                      : 'border-slate-200 bg-white text-slate-600'
                  }`}
                >
                  {section.title}
                </button>
              ))}
            </div>
          </div>

          {activeSection ? (
            <section className="space-y-4">
              <div className="border-b border-slate-200 py-5">
                <div className="flex items-start gap-4">
                  <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-slate-100" style={{ color: accentText }}>
                    {ActiveSectionIcon && <ActiveSectionIcon className="h-5 w-5" />}
                  </div>
                  <div className="min-w-0">
                    <p className="text-[10px] font-bold uppercase tracking-[0.18em]" style={{ color: accentText }}>
                      {t('wiki.active_section')}
                    </p>
                    <h2 className="mt-1 text-2xl font-black tracking-tight text-slate-950">{activeSection.title}</h2>
                    <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">{activeSection.description}</p>
                  </div>
                </div>
              </div>

              <div className="grid gap-4">
                {activeSection.features.map((feature) => (
                  <article
                    key={feature.title}
                    id={`wiki-feature-${activeSection.id}-${feature.title}`}
                    className={`scroll-mt-6 rounded-lg border bg-white p-5 transition ${
                      activeFeatureTitle === feature.title ? 'border-slate-400 ring-2 ring-slate-200' : 'border-slate-200'
                    }`}
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="max-w-3xl">
                        <p className="inline-flex rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] font-bold uppercase tracking-[0.14em]" style={{ color: accentText }}>
                          {feature.path}
                        </p>
                        <h3 className="mt-3 text-lg font-bold text-slate-950">{feature.title}</h3>
                        <p className="mt-2 text-sm leading-6 text-slate-600">{feature.description}</p>
                      </div>
                      <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-right">
                        <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">{t('wiki.class_sharing')}</p>
                        <p className="mt-1 text-sm font-semibold text-slate-900">{feature.classSharing}</p>
                      </div>
                    </div>

                    <div className="mt-4 grid gap-3 lg:grid-cols-3">
                      <InfoBlock title={t('wiki.standard_flow')}>
                        {feature.standardFlow.map((step, index) => (
                          <div key={step} className="flex gap-2.5">
                            <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-slate-900 text-[10px] font-bold text-white">
                              {index + 1}
                            </span>
                            <p className="text-sm leading-5 text-slate-700">{step}</p>
                          </div>
                        ))}
                      </InfoBlock>

                      <InfoBlock title={t('wiki.usage_examples')}>
                        {feature.examples.map((example) => (
                          <div key={example} className="flex gap-2.5">
                            <ArrowRight className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
                            <p className="text-sm leading-5 text-slate-700">{example}</p>
                          </div>
                        ))}
                      </InfoBlock>

                      <InfoBlock title={t('wiki.output_and_options')}>
                        <div>
                          <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">{t('wiki.format')}</p>
                          <p className="mt-1 text-sm font-medium text-slate-800">{feature.outputFormat}</p>
                        </div>
                        {(feature.extraOptions ?? []).map((option) => (
                          <div key={option} className="flex gap-2">
                            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-slate-500" />
                            <p className="text-sm leading-5 text-slate-700">{option}</p>
                          </div>
                        ))}
                      </InfoBlock>
                    </div>
                  </article>
                ))}
              </div>
            </section>
          ) : (
            <div className="rounded-xl border border-dashed border-slate-300 bg-white px-5 py-10 text-center">
              <p className="text-sm font-semibold text-slate-700">{t('wiki.no_results_title')}</p>
              <p className="mt-1 text-xs text-slate-500">{t('wiki.no_results_body')}</p>
            </div>
          )}
        </div>
      </main>
    </div>
  )
}

function InfoBlock({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50/70 p-3">
      <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-slate-500">{title}</p>
      <div className="mt-3 space-y-2">{children}</div>
    </div>
  )
}
