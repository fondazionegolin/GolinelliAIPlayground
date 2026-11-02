import { authApi } from '@/lib/api'
import { queryClient } from '@/lib/queryClient'
import { useAuthStore } from '@/stores/auth'

const USER_SCOPED_KEYS = [
  'student_token', 'student_nickname', 'teacher_token', 'teacher_selected_session', 'teacher_last_chat_session',
  'teacher_canvas_docs', 'pending_shared_chat', '_preview_mode', '_subjective_mode',
  '_teacher_token_backup', '_teacher_user_backup', 'default_model', 'default_model_pinned',
]

/** Drops everything that belongs to the previous user: react-query data, per-user local state, the auth store. */
export function clearClientSession() {
  queryClient.clear()
  try {
    USER_SCOPED_KEYS.forEach((key) => localStorage.removeItem(key))
    Object.keys(localStorage).filter((key) => key.startsWith('teacher_support_')).forEach((key) => localStorage.removeItem(key))
    sessionStorage.removeItem('student_active_module')
  } catch { /* storage unavailable */ }
  useAuthStore.getState().logout()
}

/** Full sign-out: also asks the server to delete the HTTP-only access_token cookie, which is the real identity. */
export async function endSession() {
  try { await authApi.logout() } catch { /* the cookie may already be gone */ }
  clearClientSession()
}
