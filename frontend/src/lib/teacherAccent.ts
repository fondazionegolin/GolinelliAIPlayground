import {
  ACCENT_THEMES,
  DEFAULT_ACCENT,
  getAccentTheme,
  type AccentId,
  type AccentTheme,
} from '@/design/themes/roleThemes'

export type TeacherAccentId = AccentId
export type TeacherAccentTheme = AccentTheme

export const DEFAULT_TEACHER_ACCENT: TeacherAccentId = DEFAULT_ACCENT
export const TEACHER_ACCENTS: Record<TeacherAccentId, TeacherAccentTheme> = ACCENT_THEMES

export const getTeacherAccentTheme = (accent?: string): TeacherAccentTheme =>
  getAccentTheme(accent)
