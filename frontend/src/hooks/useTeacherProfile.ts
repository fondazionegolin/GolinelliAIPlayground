import { useQuery, useQueryClient } from '@tanstack/react-query'
import { teacherApi } from '@/lib/api'
import { DEFAULT_TEACHER_ACCENT, type TeacherAccentId } from '@/lib/teacherAccent'

export const TEACHER_PROFILE_KEY = ['teacher-profile'] as const

export interface TeacherProfileData {
  firstName: string
  lastName: string
  email: string
  avatarUrl: string
  uiAccent: TeacherAccentId
  institution: string
}

export function useTeacherProfile() {
  return useQuery<TeacherProfileData>({
    queryKey: TEACHER_PROFILE_KEY,
    queryFn: async () => {
      const res = await teacherApi.getProfile()
      return {
        firstName: res.data.first_name || '',
        lastName: res.data.last_name || '',
        email: res.data.email || '',
        avatarUrl: res.data.avatar_url || '',
        uiAccent: (res.data.ui_accent as TeacherAccentId) || DEFAULT_TEACHER_ACCENT,
        institution: res.data.institution || '',
      }
    },
    staleTime: 5 * 60 * 1000,
  })
}

export function useInvalidateTeacherProfile() {
  const queryClient = useQueryClient()
  return () => queryClient.invalidateQueries({ queryKey: TEACHER_PROFILE_KEY })
}
