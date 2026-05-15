import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import it from './locales/it.json'
import en from './locales/en.json'

export const SUPPORTED_LANGUAGES = [
  { code: 'it', label: 'Italiano', flag: '🇮🇹' },
  { code: 'en', label: 'English', flag: '🇬🇧' },
] as const

export type LangCode = 'it' | 'en'
export const LANG_STORAGE_KEY = 'app_language'

export function normalizeLanguageCode(value?: string | null): LangCode {
  const normalized = (value || '').toLowerCase().split('-')[0]
  return normalized === 'en' ? 'en' : 'it'
}

export function getStoredLanguage(): LangCode {
  if (typeof window === 'undefined') return 'it'
  return normalizeLanguageCode(localStorage.getItem(LANG_STORAGE_KEY))
}

const savedLang = (typeof window !== 'undefined'
  ? localStorage.getItem(LANG_STORAGE_KEY)
  : null) as LangCode | null

i18n
  .use(initReactI18next)
  .init({
    resources: {
      it: { translation: it },
      en: { translation: en },
    },
    lng: normalizeLanguageCode(savedLang) || 'it',
    fallbackLng: 'it',
    interpolation: { escapeValue: false },
  })

const syncDocumentLanguage = (lang: string) => {
  if (typeof document === 'undefined') return
  document.documentElement.lang = normalizeLanguageCode(lang)
}

syncDocumentLanguage(i18n.resolvedLanguage || i18n.language)
i18n.on('languageChanged', (lang) => {
  syncDocumentLanguage(lang)
})

export default i18n
