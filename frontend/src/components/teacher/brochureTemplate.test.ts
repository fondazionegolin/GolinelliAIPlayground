import { describe, expect, it } from 'vitest'
import { buildBrochureHtmlFromPayload } from './brochureTemplate'
import { parseBrochurePayload } from './reportTemplates'

const payload = {
  language: 'en', title: 'XR project', subtitle: 'Learn together', heroDescription: 'Plan and deliver immersive projects.',
  keyPoints: ['Teamwork'], features: [{ title: 'Focus', description: 'A clear result' }],
  benefits: ['Save time'], steps: ['Make a plan'], stats: [{ value: '3', label: 'Meetings' }],
  faq: [{ question: 'When?', answer: 'Today.' }],
}

describe('Authored brochure template text', () => {
  it('translates every template heading, prefix, action and footer independently of UI language', () => {
    const html = buildBrochureHtmlFromPayload(JSON.stringify(payload), 'XR')!
    for (const text of ['Overview', 'Key features', 'Why it matters', 'Benefit 1', 'How it works', 'Step 1', 'Facts and figures', 'Frequently asked questions', 'Next steps', 'Generated with AI', 'Discover more', 'Learn more']) expect(html).toContain(text)
    for (const text of ['Panoramica', 'Elementi distintivi', 'Perché conta', 'Passaggio', 'Domande frequenti', 'Generato con Claude']) expect(html).not.toContain(text)
    expect(html).toContain('<html lang="en">')
  })
  it('keeps custom chatbot-edited headings through parse, save and render', () => {
    const parsed = parseBrochurePayload(JSON.stringify({ ...payload, labels: { featuresTitle: 'What makes XR special', footer: 'Prepared by our class' } }))!
    const html = buildBrochureHtmlFromPayload(JSON.stringify(parsed), 'XR')!
    expect(html).toContain('What makes XR special')
    expect(html).toContain('Prepared by our class')
    expect(html).toContain('Frequently asked questions')
  })
  it('continues to render old Italian brochures without template metadata', () => {
    const { language, ...legacy } = payload
    const html = buildBrochureHtmlFromPayload(JSON.stringify(legacy), 'XR')!
    expect(html).toContain('Elementi distintivi')
    expect(html).toContain('Domande frequenti')
  })
})
