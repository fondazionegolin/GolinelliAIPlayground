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
    lng: savedLang || 'it',
    fallbackLng: 'it',
    interpolation: { escapeValue: false },
  })

export default i18n
