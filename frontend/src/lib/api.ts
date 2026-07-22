import axios from 'axios'
import type { EnvironmentalFootprintResponse } from '@/lib/environmentalImpact'
import { LANG_STORAGE_KEY, normalizeLanguageCode } from '@/i18n/i18n'

const api = axios.create({
  baseURL: '/api/v1',
  withCredentials: true,
})

api.interceptors.request.use((config) => {
  const studentToken = localStorage.getItem('student_token')
  const appLanguage = normalizeLanguageCode(localStorage.getItem(LANG_STORAGE_KEY))
  let hasTeacherAuth = false
  try {
    const raw = localStorage.getItem('eduai-auth')
    if (raw) {
      const parsed = JSON.parse(raw)
      const state = parsed?.state
      hasTeacherAuth = Boolean(state?.user && state?.accessToken)
    }
  } catch {
    hasTeacherAuth = false
  }

  // Important: don't send student-token when teacher auth is active,
  // otherwise mixed auth routes may resolve the request as student.
  if (studentToken && !hasTeacherAuth) {
    config.headers['student-token'] = studentToken
  }
  config.headers['Accept-Language'] = appLanguage
  config.headers['X-App-Language'] = appLanguage
  return config
})

api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      const url: string = error.config?.url ?? ''
      // Only redirect for auth-critical endpoints; never for content/chat calls
      const isContentCall = url.includes('/llm/') || url.includes('/desktop')
      const isStudentAccessFlow = url.includes('/student/join') || url.includes('/student/check-access')
      const isPublicTeacherbotLink = url.includes('/public/teacherbot-links')
      if (!url.includes('/auth/login') && !isContentCall && !isStudentAccessFlow && !isPublicTeacherbotLink) {
        localStorage.removeItem('student_token')
        window.location.href = '/login'
      }
    }
    return Promise.reject(error)
  }
)

export default api

export type ServerHealthStatus = 'green' | 'yellow' | 'red'
export interface ServerHealthResponse {
  status: ServerHealthStatus
  summary: string
  reasons: string[]
  checked_at?: string
  metrics?: {
    cpu_percent?: number | null
    memory_percent?: number | null
    gpu_available?: boolean | null
    gpu_percent?: number | null
    gpu_memory_percent?: number | null
    database_ms?: number | null
    redis_ms?: number | null
    network_ms?: number | null
  }
}

export const systemApi = {
  health: () => api.get<ServerHealthResponse>('/system/health', { timeout: 5000 }),
}

export const authApi = {
  login: (email: string, password: string) =>
    api.post('/auth/login', { email, password }),
  logout: () => api.post('/auth/logout'),
  getLegalConsents: () =>
    api.get('/auth/legal-consents/me'),
  acceptLegalConsent: (documentKey: string) =>
    api.post('/auth/legal-consents/accept', { document_key: documentKey }),
  getPublicSettings: (tenantSlug?: string) =>
    api.get('/auth/public-settings', { params: { tenant_slug: tenantSlug } }),
  requestTeacher: (data: { email: string; first_name: string; last_name: string; tenant_slug?: string; school_name?: string }) =>
    api.post('/auth/teachers/request', data),
  getResetPasswordInfo: (token: string) =>
    api.get(`/auth/reset-password/${token}`),
  setNewPassword: (token: string, data: { new_password: string; confirm_password: string }) =>
    api.post(`/auth/reset-password/${token}`, data),
  forgotPassword: (email: string) =>
    api.post('/auth/forgot-password', { email }),
}

export const studentApi = {
  checkAccess: (join_code: string, nickname: string) =>
    api.post('/student/check-access', { join_code, nickname }),
  join: (join_code: string, nickname: string, password: string) =>
    api.post('/student/join', { join_code, nickname, password }),
  getSession: () => api.get('/student/session'),
  heartbeat: () => api.post('/student/heartbeat'),
  getTasks: () => api.get('/student/tasks'),
  submitTask: (taskId: string, content?: string, content_json?: string) =>
    api.post(`/student/tasks/${taskId}/submit`, null, { params: { content, content_json } }),
  acknowledgeTaskCorrection: (taskId: string) =>
    api.post(`/student/tasks/${taskId}/correction/read`),
  acknowledgeTaskFeedback: (taskId: string) =>
    api.post(`/student/tasks/${taskId}/feedback/read`),
  submitDocument: (data: { title: string; content_type: string; content_json: string }) =>
    api.post('/student/documents/submit', data),
  acceptDocumentCorrection: (submissionId: string) =>
    api.post(`/student/documents/submissions/${submissionId}/correction/accept`),
  listDocumentDrafts: () => api.get('/student/documents/drafts'),
  createDocumentDraft: (data: { title: string; doc_type: string; content_json: string }) =>
    api.post('/student/documents/drafts', data),
  updateDocumentDraft: (draftId: string, data: { title?: string; doc_type?: string; content_json?: string }) =>
    api.patch(`/student/documents/drafts/${draftId}`, data),
  deleteDocumentDraft: (draftId: string) =>
    api.delete(`/student/documents/drafts/${draftId}`),
  getCanvas: (sessionId: string) =>
    api.get(`/student/sessions/${sessionId}/canvas`),
  updateCanvas: (sessionId: string, data: { title?: string; content_json: string; base_version?: number }) =>
    api.put(`/student/sessions/${sessionId}/canvas`, data),
  getProfile: () => api.get('/student/profile'),
  updateProfile: (data: { avatar_url?: string; ui_accent?: string }) =>
    api.patch('/student/profile', data),
  getCreditBalance: () => api.get('/student/credits/balance'),
  getCreditHistory: (limit = 20) => api.get('/student/credits/history', { params: { limit } }),
}

export const codingApi = {
  listBriefs: (sessionId?: string) =>
    api.get('/coding/briefs', { params: sessionId ? { session_id: sessionId } : undefined }),
  listProjects: (sessionId?: string) =>
    api.get('/coding/projects', { params: sessionId ? { session_id: sessionId } : undefined }),
  createProject: (data: {
    title: string
    session_id?: string
    brief_id?: string
    template_key?: string
    initial_prompt?: string
  }) => api.post('/coding/projects', data),
  getProject: (projectId: string) =>
    api.get(`/coding/projects/${projectId}`),
  addMessage: (projectId: string, data: { content: string; metadata_json?: Record<string, unknown> }) =>
    api.post(`/coding/projects/${projectId}/messages`, data),
  generateProject: (projectId: string, data: { prompt?: string; files?: { path: string; content: string; language?: string }[] }) =>
    api.post(`/coding/projects/${projectId}/generate`, data),
  generateProjectStreamUrl: (projectId: string) => `/api/v1/coding/projects/${projectId}/generate-stream`,
  interview: (data: { title?: string; prompt?: string }) =>
    api.post('/coding/ai/interview', data),
  uiReview: (projectId: string, data: { files?: { path: string; content: string; language?: string }[] }) =>
    api.post(`/coding/projects/${projectId}/ui-review`, data),
  createVersion: (projectId: string, data: { parent_version_id?: string | null; source_manifest_json: Record<string, unknown>; artifact_manifest_json?: Record<string, unknown>; build_status?: string; review_status?: string }) =>
    api.post(`/coding/projects/${projectId}/versions`, data),
  saveDraft: (projectId: string, data: { parent_version_id?: string | null; source_manifest_json: Record<string, unknown>; artifact_manifest_json?: Record<string, unknown>; build_status?: string; review_status?: string }) =>
    api.put(`/coding/projects/${projectId}/draft`, data),
  getProjectData: (projectId: string, key: string) =>
    api.get(`/coding/projects/${projectId}/data/${encodeURIComponent(key)}`),
  putProjectData: (projectId: string, key: string, value: unknown) =>
    api.put(`/coding/projects/${projectId}/data/${encodeURIComponent(key)}`, { value }),
  deleteProjectData: (projectId: string, key: string) =>
    api.delete(`/coding/projects/${projectId}/data/${encodeURIComponent(key)}`),
  shareToClass: (projectId: string) =>
    api.post(`/coding/projects/${projectId}/share-to-class`),
  forkProject: (projectId: string) =>
    api.post(`/coding/projects/${projectId}/fork`),
  commitToCreator: (projectId: string) =>
    api.post(`/coding/projects/${projectId}/commit-to-creator`),
  listCommits: (projectId: string) =>
    api.get(`/coding/projects/${projectId}/commits`),
  mergeCommit: (projectId: string, commitMessageId: string) =>
    api.post(`/coding/projects/${projectId}/commits/${commitMessageId}/merge`),
  rollbackVersion: (projectId: string, versionId: string) =>
    api.post(`/coding/projects/${projectId}/versions/${versionId}/rollback`),
  getUpstreamStatus: (projectId: string) =>
    api.get(`/coding/projects/${projectId}/upstream-status`),
  pullUpstream: (projectId: string) =>
    api.post(`/coding/projects/${projectId}/pull-upstream`),
  publishProject: (projectId: string) =>
    api.post(`/coding/projects/${projectId}/publish`),
  downloadProjectZip: (projectId: string) =>
    api.get(`/coding/projects/${projectId}/download.zip`, { responseType: 'blob' }),
  getPublicProject: (slug: string) =>
    api.get(`/coding/public/${slug}`),
  aiChat: (data: { content: string; history?: { role: string; content: string }[]; profileKey?: string; provider?: string; model?: string }) =>
    api.post('/coding/ai/chat', data),
}

export type DesignTokens = {
  mood?: string
  palette: {
    primary: string; primaryText: string
    accent: string; accentText: string
    background: string; surface: string
    text: string; textMuted: string; border: string
    success: string; danger: string
  }
  typography: {
    fontHeading: string; fontBody: string
    baseSize: number; scaleRatio: number; headingWeight: number; bodyWeight: number
  }
  shape: {
    radius: number
    buttonShape: 'squared' | 'soft' | 'pill'
    buttonStyle: 'solid' | 'outline' | 'soft' | 'gradient' | 'glass' | 'glossy'
    surfaceStyle: 'flat' | 'transparent' | 'frosted' | 'glossy'
    shadowLevel: 'none' | 'soft' | 'strong'
    borderWidth: number
  }
  spacing: { base: number; density: 'compact' | 'comfortable' | 'spacious' }
  priorities: string[]
}

export type DesignSystem = {
  id: string
  tenant_id: string
  session_id: string | null
  owner_student_id: string | null
  owner_user_id: string | null
  name: string
  description: string | null
  tokens_json: DesignTokens
  created_at: string
  updated_at: string
}

export type DesignContrastCheck = { label: string; foreground: string; background: string; ratio: number; passes_aa: boolean }
export type DesignCompileResult = {
  tokens: DesignTokens
  markdown: string
  path: string
  contrast_checks: DesignContrastCheck[]
  coherence_score: number
  warnings: string[]
}

export const designSystemApi = {
  list: () => api.get<DesignSystem[]>('/coding/design-systems'),
  get: (id: string) => api.get<DesignSystem>(`/coding/design-systems/${id}`),
  create: (data: { name: string; description?: string; session_id?: string; tokens: DesignTokens }) =>
    api.post<DesignSystem>('/coding/design-systems', data),
  update: (id: string, data: { name?: string; description?: string; tokens?: DesignTokens }) =>
    api.put<DesignSystem>(`/coding/design-systems/${id}`, data),
  remove: (id: string) => api.delete(`/coding/design-systems/${id}`),
  suggest: (data: { mood?: string; audience?: string; idea?: string; title?: string }) =>
    api.post<{ tokens: DesignTokens; rationale: Record<string, string> }>('/coding/design-systems/suggest', data),
  compile: (tokens: DesignTokens & { name?: string; description?: string }) =>
    api.post<DesignCompileResult>('/coding/design-systems/compile', { tokens }),
}

export const adminApi = {
  getTenants: () => api.get('/admin/tenants'),
  createTenant: (data: { name: string; slug: string }) =>
    api.post('/admin/tenants', data),
  updateTenant: (id: string, data: { name?: string; status?: string }) =>
    api.patch(`/admin/tenants/${id}`, data),
  getTeacherRequests: (status?: string) =>
    api.get('/admin/teacher-requests', { params: { status } }),
  approveTeacher: (id: string) =>
    api.post(`/admin/teacher-requests/${id}/approve`),
  rejectTeacher: (id: string) =>
    api.post(`/admin/teacher-requests/${id}/reject`),
  getUsers: (role?: string, includeInactive?: boolean) =>
    api.get('/admin/users', { params: { role, include_inactive: includeInactive } }),
  resetPassword: (userId: string) =>
    api.post(`/admin/users/${userId}/reset-password`),
  deleteUser: (userId: string) =>
    api.delete(`/admin/users/${userId}`),
  reactivateUser: (userId: string) =>
    api.post(`/admin/users/${userId}/reactivate`),
  getUsage: () => api.get('/admin/usage'),
  getAnalyticsReport: (params?: {
    start_date?: string
    end_date?: string
    granularity?: 'day' | 'week' | 'month'
    teacher_id?: string
    class_id?: string
    session_id?: string
    provider?: string
    model?: string
    include_empty?: boolean
  }) => api.get('/admin/analytics/report', { params }),
  getUsageTransactions: (params?: {
    start_date?: string
    end_date?: string
    teacher_id?: string
    class_id?: string
    session_id?: string
    provider?: string
    model?: string
    actor_role?: string
    q?: string
    limit?: number
    offset?: number
  }) => api.get('/admin/usage/transactions', { params }),
  downloadUsageTransactions: (params?: {
    start_date?: string
    end_date?: string
    teacher_id?: string
    class_id?: string
    session_id?: string
    provider?: string
    model?: string
    actor_role?: string
    q?: string
  }) => api.get('/admin/usage/transactions.csv', { params, responseType: 'blob' }),
  downloadTeacherUsageReport: (params?: {
    start_date?: string
    end_date?: string
    include_inactive?: boolean
  }) => api.get('/admin/usage/teacher-report.csv', { params, responseType: 'blob' }),
  getDashboardOverview: (days = 30) =>
    api.get('/admin/dashboard/overview', { params: { days } }),
  getTopConsumers: (days = 30, limit = 25) =>
    api.get('/admin/dashboard/top-consumers', { params: { days, limit } }),
  getTeachersStatus: (days = 30) =>
    api.get('/admin/teachers/status', { params: { days } }),
  getRealtimeStatus: () =>
    api.get('/admin/realtime/status'),
  getLegalConsents: () =>
    api.get('/admin/legal-consents'),
  getEmailTemplates: () =>
    api.get('/admin/email-templates'),
  updateEmailTemplates: (data: Record<string, { subject: string; html: string; text: string }>) =>
    api.put('/admin/email-templates', data),
  resetEmailTemplate: (templateKey: string) =>
    api.post(`/admin/email-templates/${templateKey}/reset-default`),
  getEmailTemplateHistory: (templateKey: string, limit = 20) =>
    api.get('/admin/email-templates/history', { params: { template_key: templateKey, limit } }),
  setTeacherCreditLimit: (teacherId: string, amountCap: number) =>
    api.put(`/admin/teachers/${teacherId}/credit-limit`, { amount_cap: amountCap }),
  updateTeacherSchoolsBulk: (teacherIds: string[], schoolTenantId: string, action: 'add' | 'remove') =>
    api.put('/admin/teachers/schools/bulk', {
      teacher_ids: teacherIds,
      school_tenant_id: schoolTenantId,
      action,
    }),
  setTeacherCreditLimitsBulk: (teacherIds: string[], amountCap: number) =>
    api.put('/admin/teachers/credit-limits/bulk', {
      teacher_ids: teacherIds,
      amount_cap: amountCap,
    }),
  getAdminClasses: () => api.get('/admin/classes'),
  changePassword: (currentPassword: string, newPassword: string) =>
    api.post('/admin/change-password', { current_password: currentPassword, new_password: newPassword }),
  promoteToAdmin: (userId: string) =>
    api.post(`/admin/users/${userId}/promote-admin`),
  hardDeleteUser: (userId: string, confirmEmail: string) =>
    api.delete(`/admin/users/${userId}/permanent`, { data: { confirm_email: confirmEmail } }),
  listBackendWidgetTemplates: () =>
    api.get('/admin/backend/widget-templates'),
  createBackendWidgetTemplate: (data: {
    title: string
    audience: 'all' | 'teacher' | 'student'
    widget_type: string
    target_desktop_index?: number
    grid_x?: number
    grid_y?: number
    grid_w?: number
    grid_h?: number
    config_json?: Record<string, unknown>
    is_active?: boolean
  }) => api.post('/admin/backend/widget-templates', data),
  updateBackendWidgetTemplate: (templateId: string, data: {
    title: string
    audience: 'all' | 'teacher' | 'student'
    widget_type: string
    target_desktop_index?: number
    grid_x?: number
    grid_y?: number
    grid_w?: number
    grid_h?: number
    config_json?: Record<string, unknown>
    is_active?: boolean
  }) => api.patch(`/admin/backend/widget-templates/${templateId}`, data),
  deleteBackendWidgetTemplate: (templateId: string) =>
    api.delete(`/admin/backend/widget-templates/${templateId}`),
  listBackendChangelog: () =>
    api.get('/admin/backend/changelog'),
  createBackendChangelog: (data: {
    version_label: string
    title: string
    summary?: string
    git_ref?: string
    is_published?: boolean
    items: Array<{ category: 'new' | 'improved' | 'fixed'; title: string; description: string }>
  }) => api.post('/admin/backend/changelog', data),
  updateBackendChangelog: (releaseId: string, data: {
    version_label: string
    title: string
    summary?: string
    git_ref?: string
    is_published?: boolean
    items: Array<{ category: 'new' | 'improved' | 'fixed'; title: string; description: string }>
  }) => api.patch(`/admin/backend/changelog/${releaseId}`, data),
  deleteBackendChangelog: (releaseId: string) =>
    api.delete(`/admin/backend/changelog/${releaseId}`),

  // ── School tenants ──────────────────────────────────────────────────────
  createSchoolTenant: (data: {
    school_name: string; slug: string
    owner_first_name: string; owner_last_name: string; owner_email: string
    max_teachers?: number; max_students_per_teacher?: number; max_students_per_class?: number
    monthly_credit_pool?: number
  }) => api.post('/admin/tenants/school', data),
  updateTenantLimits: (tenantId: string, data: {
    max_teachers?: number; max_students_per_teacher?: number; max_students_per_class?: number
    monthly_credit_pool?: number; teacher_monthly_cap?: number
  }) => api.patch(`/admin/tenants/${tenantId}/limits`, data),
}

export const platformApi = {
  listChangelog: (limit = 20) => api.get('/changelog', { params: { limit } }),
}

export const voiceApi = {
  createLiveKitToken: (sessionId: string) =>
    api.post('/voice/livekit-token', { session_id: sessionId }),
}

export const teacherApi = {
  getSchools: () => api.get('/teacher/schools'),
  changePassword: (data: { current_password: string; new_password: string; confirm_password: string }) =>
    api.post('/teacher/profile/change-password', data),
  getClasses: (params?: { include_archived?: boolean }) => api.get('/teacher/classes', { params }),
  createClass: (data: { name: string; school_grade?: string; school_tenant_id?: string | null }) => api.post('/teacher/classes', data),
  updateClass: (id: string, data: { name: string; school_grade?: string; school_tenant_id?: string | null }) =>
    api.patch(`/teacher/classes/${id}`, data),
  archiveClass: (id: string) => api.post(`/teacher/classes/${id}/archive`),
  restoreClass: (id: string) => api.post(`/teacher/classes/${id}/restore`),
  permanentlyDeleteClass: (id: string) => api.delete(`/teacher/classes/${id}/permanent`, { params: { confirm: true } }),
  getSessions: (classId: string, params?: { include_deleted?: boolean }) =>
    api.get(`/teacher/classes/${classId}/sessions`, { params }),
  createSession: (classId: string, data: { title: string; is_persistent?: boolean }) =>
    api.post(`/teacher/classes/${classId}/sessions`, data),
  updateSession: (id: string, data: { title?: string; status?: string; default_llm_provider?: string; default_llm_model?: string }) =>
    api.patch(`/teacher/sessions/${id}`, data),
  updateModules: (sessionId: string, modules: { module_key: string; is_enabled: boolean }[]) =>
    api.post(`/teacher/sessions/${sessionId}/modules`, { modules }),
  toggleModule: (sessionId: string, moduleKey: string, isEnabled: boolean) =>
    api.patch(`/teacher/sessions/${sessionId}/modules/${moduleKey}`, null, { params: { is_enabled: isEnabled } }),
  sendClassMessage: (sessionId: string, content: string) =>
    api.post(`/teacher/sessions/${sessionId}/broadcast`, { content }),
  sendPrivateMessage: (sessionId: string, studentId: string, content: string) =>
    api.post(`/teacher/sessions/${sessionId}/message/${studentId}`, { content }),
  getSessionLive: (sessionId: string) =>
    api.get(`/teacher/sessions/${sessionId}/live`),
  freezeStudent: (sessionId: string, studentId: string, reason?: string) =>
    api.post(`/teacher/sessions/${sessionId}/freeze/${studentId}`, null, { params: { reason } }),
  unfreezeStudent: (sessionId: string, studentId: string) =>
    api.post(`/teacher/sessions/${sessionId}/unfreeze/${studentId}`),
  pushTeacherbotToStudent: (sessionId: string, studentId: string, teacherbotId: string) =>
    api.post(`/teacher/sessions/${sessionId}/students/${studentId}/push-teacherbot`, null, { params: { teacherbot_id: teacherbotId } }),
  removeStudent: (sessionId: string, studentId: string) =>
    api.delete(`/teacher/sessions/${sessionId}/students/${studentId}`),
  deleteSession: (sessionId: string) =>
    api.delete(`/teacher/sessions/${sessionId}`, { params: { confirm: true } }),
  restoreSession: (sessionId: string) =>
    api.post(`/teacher/sessions/${sessionId}/restore`),
  permanentlyDeleteSession: (sessionId: string) =>
    api.delete(`/teacher/sessions/${sessionId}/permanent`, { params: { confirm: true } }),
  exportSession: (sessionId: string) =>
    api.post(`/teacher/sessions/${sessionId}/export`),
  getAudit: (sessionId: string, cursor?: string) =>
    api.get(`/teacher/sessions/${sessionId}/audit`, { params: { cursor } }),
  getTasks: (sessionId: string) =>
    api.get(`/teacher/sessions/${sessionId}/tasks`),
  createTask: (sessionId: string, data: { title: string; description?: string; task_type?: string; points?: string; content_json?: string; due_at?: string | null }) =>
    api.post(`/teacher/sessions/${sessionId}/tasks`, data),
  updateTask: (sessionId: string, taskId: string, data: { title?: string; description?: string; new_status?: string; points?: string; content_json?: string; due_at?: string | null }) => {
    const hasDueAt = Object.prototype.hasOwnProperty.call(data, 'due_at')
    return api.patch(`/teacher/sessions/${sessionId}/tasks/${taskId}`, null, {
      params: {
        ...data,
        due_at: data.due_at ?? undefined,
        clear_due_at: hasDueAt && data.due_at === null ? true : undefined,
      },
    })
  },
  deleteTask: (sessionId: string, taskId: string) =>
    api.delete(`/teacher/sessions/${sessionId}/tasks/${taskId}`),
  getTaskSubmissions: (sessionId: string, taskId: string) =>
    api.get(`/teacher/sessions/${sessionId}/tasks/${taskId}/submissions`),
  correctExerciseSubmission: (sessionId: string, taskId: string, submissionId: string, content: string) =>
    api.put(`/teacher/sessions/${sessionId}/tasks/${taskId}/submissions/${submissionId}/correction`, { content }),
  gradeSubmission: (sessionId: string, taskId: string, submissionId: string, data: { score?: string; feedback?: string }) =>
    api.patch(`/teacher/sessions/${sessionId}/tasks/${taskId}/submissions/${submissionId}`, null, { params: data }),
  updateSubmissionFeedback: (sessionId: string, taskId: string, submissionId: string, data: { overall_feedback: string; answer_feedback: Record<string, string>; score?: string; publish: boolean }) =>
    api.put(`/teacher/sessions/${sessionId}/tasks/${taskId}/submissions/${submissionId}/feedback`, data),
  analyzeTask: (sessionId: string, taskId: string, question?: string, signal?: AbortSignal) =>
    api.post(`/teacher/sessions/${sessionId}/tasks/${taskId}/analyze`, { question: question || '' }, { signal }),
  // Profile
  getProfile: () => api.get('/teacher/profile'),
  updateProfile: (data: { first_name?: string; last_name?: string; institution?: string; avatar_url?: string; ui_accent?: string }) =>
    api.put('/teacher/profile', data),
  uploadAvatar: (file: File) => {
    const formData = new FormData()
    formData.append('file', file)
    return api.post('/teacher/avatar', formData, { headers: { 'Content-Type': 'multipart/form-data' } })
  },
  transcribeOcr: (file: File) => {
    const formData = new FormData()
    formData.append('file', file)
    return api.post<{ text: string; engine: string; confidence?: number | null; lines?: Array<Record<string, unknown>> | null }>(
      '/teacher/ocr/transcribe',
      formData,
      { headers: { 'Content-Type': 'multipart/form-data' } }
    )
  },
  // Invitations
  getInvitations: () => api.get('/teacher/invitations'),
  respondToSchoolInvitation: (invitationId: string, accept: boolean) =>
    api.post(`/teacher/invitations/school/${invitationId}/respond`, { accept }),
  respondToClassInvitation: (invitationId: string, accept: boolean) =>
    api.post(`/teacher/invitations/class/${invitationId}/respond`, { accept }),
  respondToSessionInvitation: (invitationId: string, accept: boolean) =>
    api.post(`/teacher/invitations/session/${invitationId}/respond`, { accept }),
  // Class teachers management
  getClassTeachers: (classId: string) =>
    api.get(`/teacher/classes/${classId}/teachers`),
  inviteTeacherToClass: (classId: string, email: string) =>
    api.post(`/teacher/classes/${classId}/teachers/invite`, { email }),
  resendClassTeacherInvitation: (classId: string, invitationId: string) =>
    api.post(`/teacher/classes/${classId}/teachers/invitations/${invitationId}/resend`),
  removeTeacherFromClass: (classId: string, teacherId: string) =>
    api.delete(`/teacher/classes/${classId}/teachers/${teacherId}`),
  // Student preview
  createStudentPreview: (sessionId: string) =>
    api.post(`/teacher/sessions/${sessionId}/student-preview`),
  // Session teachers management
  getSessionTeachers: (sessionId: string) =>
    api.get(`/teacher/sessions/${sessionId}/teachers`),
  inviteTeacherToSession: (sessionId: string, email: string) =>
    api.post(`/teacher/sessions/${sessionId}/teachers/invite`, { email }),
  resendSessionTeacherInvitation: (sessionId: string, invitationId: string) =>
    api.post(`/teacher/sessions/${sessionId}/teachers/invitations/${invitationId}/resend`),
  removeTeacherFromSession: (sessionId: string, teacherId: string) =>
    api.delete(`/teacher/sessions/${sessionId}/teachers/${teacherId}`),
  // Teacher AI Conversations (server-side persistence)
  getConversations: () => api.get('/teacher/conversations'),
  createConversation: (data: { title?: string; agent_mode?: string }) =>
    api.post('/teacher/conversations', data),
  getConversation: (conversationId: string, beforeId?: string) =>
    api.get(`/teacher/conversations/${conversationId}`, { params: beforeId ? { before_id: beforeId, limit: 30 } : { limit: 30 } }),
  deleteConversation: (conversationId: string) =>
    api.delete(`/teacher/conversations/${conversationId}`),
  deleteAllConversations: () =>
    api.delete('/teacher/conversations'),
  updateConversation: (conversationId: string, data: { title?: string; agent_mode?: string }) =>
    api.patch(`/teacher/conversations/${conversationId}`, data),
  addMessage: (conversationId: string, data: { role: string; content: string; provider?: string; model?: string; token_usage_json?: Record<string, unknown> }) =>
    api.post(`/teacher/conversations/${conversationId}/messages`, data),
  saveConversationDocument: (conversationId: string, doc: { type: string; content: string; version: number; title: string }) =>
    api.put(`/teacher/conversations/${conversationId}/document`, doc),
  deleteConversationDocument: (conversationId: string) =>
    api.delete(`/teacher/conversations/${conversationId}/document`),
  listDocumentDrafts: (sessionId?: string) => api.get('/teacher/documents/drafts', { params: { session_id: sessionId } }),
  listSharedDocuments: (params?: { class_id?: string; session_id?: string }) =>
    api.get('/teacher/documents/shared', { params }),
  updateDocumentCorrection: (submissionId: string, contentJson: string) =>
    api.put(`/teacher/documents/submissions/${submissionId}/correction`, { content_json: contentJson }),
  createDocumentDraft: (data: { title: string; doc_type: string; content_json: string; session_id?: string }) =>
    api.post('/teacher/documents/drafts', data),
  updateDocumentDraft: (draftId: string, data: { title?: string; doc_type?: string; content_json?: string; session_id?: string }) =>
    api.patch(`/teacher/documents/drafts/${draftId}`, data),
  deleteDocumentDraft: (draftId: string) =>
    api.delete(`/teacher/documents/drafts/${draftId}`),
  listDocumentDraftVersions: (draftId: string) =>
    api.get(`/teacher/documents/drafts/${draftId}/versions`),
  createDocumentDraftVersion: (draftId: string, label?: string) =>
    api.post(`/teacher/documents/drafts/${draftId}/versions`, { label }),
  restoreDocumentDraftVersion: (draftId: string, versionId: string) =>
    api.post(`/teacher/documents/drafts/${draftId}/versions/${versionId}/restore`),
  getCanvas: (sessionId: string) =>
    api.get(`/teacher/sessions/${sessionId}/canvas`),
  updateCanvas: (sessionId: string, data: { title?: string; content_json: string; base_version?: number; students_can_write?: boolean }) =>
    api.put(`/teacher/sessions/${sessionId}/canvas`, data),
  // Prompt customization
  getSupportChatPrompt: () => api.get('/teacher/support-chat/prompt'),
  updateSupportChatPrompt: (prompt: string | null) =>
    api.put('/teacher/support-chat/prompt', { prompt }),
  getSessionChatbotProfiles: (sessionId: string) =>
    api.get(`/teacher/sessions/${sessionId}/chatbot-profiles`),
  upsertSessionChatbotProfile: (sessionId: string, profileKey: string, systemPrompt: string | null) =>
    api.put(`/teacher/sessions/${sessionId}/chatbot-profiles/${profileKey}`, { system_prompt: systemPrompt }),
  deleteSessionChatbotProfileOverride: (sessionId: string, profileKey: string) =>
    api.delete(`/teacher/sessions/${sessionId}/chatbot-profiles/${profileKey}`),
}

export const udaApi = {
  // Teacher
  listUdas: (classId: string) =>
    api.get(`/teacher/classes/${classId}/udas`),
  createUda: (classId: string, title: string) => {
    const fd = new FormData()
    fd.append('title', title)
    return api.post(`/teacher/classes/${classId}/udas`, fd)
  },
  generateKb: (classId: string, udaId: string, prompt: string, files: File[] = [], language?: string, schoolLevel?: string) => {
    const fd = new FormData()
    fd.append('prompt', prompt)
    files.forEach(f => fd.append('files', f))
    if (language) fd.append('language', language)
    if (schoolLevel) fd.append('school_level', schoolLevel)
    return api.post(`/teacher/classes/${classId}/udas/${udaId}/generate-kb`, fd)
  },
  generatePlan: (classId: string, udaId: string) =>
    api.post(`/teacher/classes/${classId}/udas/${udaId}/generate-plan`),
  updateKb: (classId: string, udaId: string, kb: object) =>
    api.put(`/teacher/classes/${classId}/udas/${udaId}/kb`, kb),
  updatePlan: (classId: string, udaId: string, plan: object) =>
    api.put(`/teacher/classes/${classId}/udas/${udaId}/plan`, plan),
  generateContent: (classId: string, udaId: string) =>
    `/api/v1/teacher/classes/${classId}/udas/${udaId}/generate-content`, // returns SSE URL
  chat: (classId: string, udaId: string, message: string) =>
    api.post(`/teacher/classes/${classId}/udas/${udaId}/chat`, { message }),
  updateChild: (classId: string, udaId: string, childId: string, data: object) =>
    api.patch(`/teacher/classes/${classId}/udas/${udaId}/children/${childId}`, data),
  deleteChild: (classId: string, udaId: string, childId: string) =>
    api.delete(`/teacher/classes/${classId}/udas/${udaId}/children/${childId}`),
  publishUda: (classId: string, udaId: string) =>
    api.post(`/teacher/classes/${classId}/udas/${udaId}/publish`),
  deleteUda: (classId: string, udaId: string) =>
    api.delete(`/teacher/classes/${classId}/udas/${udaId}`),
  // Student
  getStudentUdas: () => api.get('/student/udas'),
}

export const chatApi = {
  getRooms: (sessionId: string) =>
    api.get('/chat/rooms', { params: { session_id: sessionId } }),
  createDM: (sessionId: string, studentId: string) =>
    api.post('/chat/rooms/dm', { session_id: sessionId, student_id: studentId }),
  getMessages: (roomId: string, cursor?: string) =>
    api.get(`/chat/rooms/${roomId}/messages`, { params: { cursor } }),
  sendMessage: (roomId: string, message_text: string, attachments: unknown[] = []) =>
    api.post(`/chat/rooms/${roomId}/messages`, { message_text, attachments }),
  getSessionMessages: (sessionId: string, params?: { limit?: number; before_created_at?: string }) =>
    api.get(`/chat/session/${sessionId}/messages`, { params }),
  sendSessionMessage: (sessionId: string, text: string, attachments: unknown[] = [], reply_to_id?: string) =>
    api.post(`/chat/session/${sessionId}/messages`, { text, attachments, reply_to_id }),
  clearSessionMessages: (sessionId: string) =>
    api.delete(`/chat/session/${sessionId}/messages`),
  uploadFiles: (sessionId: string, files: File[]) => {
    const formData = new FormData()
    files.forEach(file => formData.append('files', file))
    // session_id must be a URL query param (FastAPI Query(...))
    return api.post(`/chat/upload?session_id=${encodeURIComponent(sessionId)}`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' }
    })
  },
}

export const toyLmApi = {
  generateShared: (jobId: string, sessionId: string, payload: { seed: string; max_tokens: number; temperature: number }) =>
    api.post(`/toy-lm/shared/jobs/${jobId}/generate`, { ...payload, session_id: sessionId }),
}

export const llmApi = {
  getProfiles: () => api.get('/llm/profiles'),
  getChatbotProfiles: () => api.get('/llm/chatbot-profiles'),
  createRealtimeInterrogationSession: (
    topic: string,
    language: string,
    opts?: { voice?: string; style?: string; pace?: string }
  ) =>
    api.post<{ value: string; model: string; expires_at?: number | string | null }>(
      '/llm/realtime/interrogation-session',
      { topic, language, ...opts }
    ),
  createRealtimeTeacherbotSession: (
    teacherbotId: string,
    language: string,
    opts?: { voice?: string; style?: string; pace?: string }
  ) =>
    api.post<{ value: string; model: string; expires_at?: number | string | null }>(
      '/llm/realtime/teacherbot-session',
      { teacherbot_id: teacherbotId, language, ...opts }
    ),
  getChatbotProfilesFull: () => api.get('/teacher/chatbot-profiles-full'),
  getAvailableModels: () => api.get('/llm/available-models'),
  getSessionConversations: (sessionId: string) => api.get(`/llm/sessions/${sessionId}/conversations`),
  getConversationMessages: (conversationId: string) => api.get(`/llm/conversations/${conversationId}/messages`),
  createConversation: (sessionId: string, profileKey: string, title?: string, provider?: string, model?: string, signal?: AbortSignal) =>
    api.post('/llm/conversations', { session_id: sessionId, profile_key: profileKey, title, provider, model }, { signal }),
  getConversations: (sessionId?: string, studentId?: string) =>
    api.get('/llm/conversations', { params: { session_id: sessionId, student_id: studentId } }),
  getMessages: (conversationId: string) =>
    api.get(`/llm/conversations/${conversationId}/messages`),
  sendMessage: (conversationId: string, content: string, imageProvider?: string, imageSize?: string, verboseMode?: boolean, signal?: AbortSignal) =>
    api.post(`/llm/conversations/${conversationId}/message`, { content, image_provider: imageProvider, image_size: imageSize, verbose_mode: verboseMode }, { signal }),
  sendMessageStreamUrl: (conversationId: string) => `/api/v1/llm/conversations/${conversationId}/message-stream`,
  deleteConversation: (conversationId: string) =>
    api.delete(`/llm/conversations/${conversationId}`),
  deleteAllConversations: (sessionId: string) =>
    api.delete(`/llm/sessions/${sessionId}/conversations`),
  studentChat: (content: string, history: { role: string; content: string }[], profileKey?: string, provider?: string, model?: string, signal?: AbortSignal) =>
    api.post('/llm/student/chat', { content, history, profile_key: profileKey, provider, model }, { signal }),
  presentationAgent: (data: {
    prompt: string
    mode?: 'create' | 'edit'
    format: string
    dims: { width: number; height: number }
    current_presentation?: Record<string, unknown>
    provider?: string
    model?: string
  }, signal?: AbortSignal) =>
    api.post('/llm/presentations/agent', data, { signal }),
  documentAssist: (data: {
    prompt: string
    target: Record<string, unknown>
    document_context?: Record<string, unknown>
    dims?: { width: number; height: number }
    provider?: string
    model?: string
  }, signal?: AbortSignal) =>
    api.post('/llm/documents/assist', data, { signal }),
  teacherChat: (content: string, history: { role: string; content: string }[], profileKey?: string, provider?: string, model?: string, imageProvider?: string, imageSize?: string, signal?: AbortSignal) =>
    api.post('/llm/teacher/chat', { content, history, profile_key: profileKey, provider, model, image_provider: imageProvider, image_size: imageSize }, { signal }),
  teacherChatWithFiles: (content: string, history: { role: string; content: string }[], profileKey: string, provider: string, model: string, files: File[], imageProvider?: string, imageSize?: string, signal?: AbortSignal) => {
    const formData = new FormData()
    formData.append('content', content)
    formData.append('history', JSON.stringify(history))
    formData.append('profile_key', profileKey)
    formData.append('provider', provider)
    formData.append('model', model)
    if (imageProvider) formData.append('image_provider', imageProvider)
    if (imageSize) formData.append('image_size', imageSize)
    files.forEach(file => formData.append('files', file))
    return api.post('/llm/teacher/chat-with-files', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
      signal,
    })
  },
  sendMessageWithFiles: (conversationId: string, content: string, files: File[], signal?: AbortSignal) => {
    const formData = new FormData()
    formData.append('content', content)
    files.forEach(file => formData.append('files', file))
    return api.post(`/llm/conversations/${conversationId}/message-with-files`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
      signal,
    })
  },
  generateImage: (prompt: string, provider: string = 'flux-schnell', signal?: AbortSignal) =>
    api.post('/llm/generate-image', { prompt, provider }, { signal }),
  explain: (messageId: string) =>
    api.post('/llm/explain', { message_id: messageId }),
  filePreview: (file: File) => {
    const formData = new FormData()
    formData.append('file', file)
    return api.post('/llm/files/preview', formData, {
      headers: { 'Content-Type': 'multipart/form-data' }
    })
  },
  getEnvironmentalFootprint: () =>
    api.get<EnvironmentalFootprintResponse>('/llm/environmental-footprint'),
  compileLatex: (content: string, filename: string) =>
    api.post('/llm/compile-latex', { content, filename }, { responseType: 'arraybuffer' }),
  getYoutubeTranscript: (url: string) =>
    api.post<{ video_id: string; title: string | null; transcript: string; duration_seconds: number }>('/llm/youtube/transcript', { url }),
  editHtmlPage: (html: string, modification: string, signal?: AbortSignal) =>
    api.post<{ html: string }>('/llm/html-page/edit', { html, modification }, { signal }),
  editBrochure: (payload: object, modification: string, signal?: AbortSignal) =>
    api.post<{ payload: object }>('/llm/brochure/edit', { payload, modification }, { signal }),
}

export const ragApi = {
  createDocument: (data: { scope: string; session_id?: string; class_id?: string; file_id: string; title: string; doc_type: string }) =>
    api.post('/rag/documents', data),
  getDocuments: (scope?: string, sessionId?: string) =>
    api.get('/rag/documents', { params: { scope, session_id: sessionId } }),
  ingestDocument: (docId: string) =>
    api.post(`/rag/documents/${docId}/ingest`),
  getDocumentStatus: (docId: string) =>
    api.get(`/rag/documents/${docId}/status`),
  search: (query: string, sessionId: string, topK?: number) =>
    api.post('/rag/search', { query, session_id: sessionId, top_k: topK }),
}

export const studentRagApi = {
  uploadDocument: (file: File, projectId?: string) => {
    const form = new FormData()
    form.append('file', file)
    if (projectId) form.append('project_id', projectId)
    return api.post('/rag/student/upload', form, { headers: { 'Content-Type': 'multipart/form-data' } })
  },
  ingestYoutube: (url: string, projectId?: string) =>
    api.post('/rag/student/youtube', { url, project_id: projectId }),
  generateArtifact: (prompt: string, artifactType: 'html' | 'brochure', projectId?: string) =>
    api.post('/rag/student/artifact', { prompt, artifact_type: artifactType, project_id: projectId }),
  listDocuments: (projectId?: string) => api.get('/rag/student/documents', { params: { project_id: projectId } }),
  deleteDocument: (docId: string) => api.delete(`/rag/student/documents/${docId}`),
  getChunks: (docId: string) => api.get(`/rag/student/documents/${docId}/chunks`),
  getGraph: (projectId?: string) => api.get('/rag/student/graph', { params: { project_id: projectId } }),
  search: (query: string, docIds?: string[], topK?: number, projectId?: string) =>
    api.post('/rag/student/search', { query, doc_ids: docIds, top_k: topK, project_id: projectId }),
  chat: (message: string, history: { role: string; content: string }[], docIds?: string[], topK?: number, projectId?: string) =>
    api.post('/rag/student/chat', { message, history, doc_ids: docIds, top_k: topK, project_id: projectId }),
}

export const mlApi = {
  createDataset: (data: { scope: string; session_id?: string; source_type: string; file_id?: string }) =>
    api.post('/ml/datasets', data),
  createSyntheticDataset: (prompt: string, sessionId: string, numRows?: number) =>
    api.post('/ml/datasets/synthetic', { prompt, session_id: sessionId, num_rows: numRows }),
  getDatasets: (sessionId?: string) =>
    api.get('/ml/datasets', { params: { session_id: sessionId } }),
  getDataset: (id: string) => api.get(`/ml/datasets/${id}`),
  createExperiment: (data: { session_id: string; dataset_id: string; task_type: string; config_json?: Record<string, unknown> }) =>
    api.post('/ml/experiments', data),
  getExperiments: (sessionId?: string) =>
    api.get('/ml/experiments', { params: { session_id: sessionId } }),
  getExperiment: (id: string) => api.get(`/ml/experiments/${id}`),
  getResults: (id: string) => api.get(`/ml/experiments/${id}/results`),
  explainExperiment: (id: string) =>
    api.post(`/ml/experiments/${id}/explain`),
}

export const assessmentApi = {
  generateLesson: (topic: string, level: string) =>
    api.post('/self/lessons/generate', { topic, level }),
  getLessons: (level?: string) =>
    api.get('/self/lessons', { params: { level } }),
  getLesson: (id: string) => api.get(`/self/lessons/${id}`),
  generateQuiz: (lessonId: string) =>
    api.post('/self/quizzes/generate', { lesson_id: lessonId }),
  submitQuizAttempt: (quizId: string, answers: Record<string, unknown>) =>
    api.post(`/self/quizzes/${quizId}/attempt`, { answers_json: answers }),
  getBadges: () => api.get('/self/badges'),
  getBadgeAwards: (sessionId?: string) =>
    api.get('/self/badges/awards', { params: { session_id: sessionId } }),
}

export const filesApi = {
  importDocument: (file: File, sessionId?: string) => {
    const formData = new FormData()
    formData.append('file', file)
    if (sessionId) formData.append('session_id', sessionId)
    return api.post('/files/documents/import', formData, { headers: { 'Content-Type': 'multipart/form-data' } })
  },
  exportDocument: (data: { title: string; content_json: string; target_format: 'pdf' | 'ppt' | 'pptx' | 'doc' | 'docx' | 'xlsx' }) =>
    api.post('/files/documents/export', data, { responseType: 'blob' }),
  getUploadUrl: (data: { filename: string; mime_type: string; size_bytes: number; scope: string; session_id?: string }) =>
    api.post('/files/upload-url', data),
  completeUpload: (fileId: string, checksum: string) =>
    api.post('/files/complete', { file_id: fileId, checksum_sha256: checksum }),
  getDownloadUrl: (fileId: string) =>
    api.get(`/files/${fileId}/download-url`),
  listSessionFiles: (sessionId: string) =>
    api.get(`/files/session/${sessionId}`),
}

export const collaborationApi = {
  listParticipants: () => api.get('/collaboration/participants'),
  createRoom: (data: {
    kind: 'teacherbot' | 'assistant'
    teacherbot_id?: string
    profile_key?: string
    participant_ids: string[]
    title?: string
    seed_messages?: { role: string; content: string; sender_nickname?: string }[]
  }) => api.post('/collaboration/rooms', data),
  listRooms: () => api.get('/collaboration/rooms'),
  getRoom: (roomId: string) => api.get(`/collaboration/rooms/${roomId}`),
  sendMessage: (roomId: string, content: string) =>
    api.post(`/collaboration/rooms/${roomId}/messages`, { content }),
  closeRoom: (roomId: string) => api.post(`/collaboration/rooms/${roomId}/close`),
}

export const teacherbotsApi = {
  // Teacher endpoints
  list: () => api.get('/teacherbots'),
  listForSession: (sessionId: string) => api.get(`/teacher/sessions/${sessionId}/teacherbots`),
  create: (data: {
    name: string
    synopsis?: string
    description?: string
    icon?: string
    color?: string
    system_prompt: string
    is_proactive?: boolean
    proactive_message?: string
    enable_reporting?: boolean
    report_prompt?: string
    llm_provider?: string
    llm_model?: string
    temperature?: number
  }) => api.post('/teacherbots', data),
  get: (id: string) => api.get(`/teacherbots/${id}`),
  update: (id: string, data: {
    name?: string
    synopsis?: string
    description?: string
    icon?: string
    color?: string
    system_prompt?: string
    is_proactive?: boolean
    proactive_message?: string
    enable_reporting?: boolean
    report_prompt?: string
    llm_provider?: string
    llm_model?: string
    temperature?: number
    status?: string
  }) => api.patch(`/teacherbots/${id}`, data),
  delete: (id: string) => api.delete(`/teacherbots/${id}`),
  test: (
    id: string,
    content: string,
    history?: { role: string; content: string }[],
    signal?: AbortSignal,
    overrides?: { system_prompt?: string; temperature?: number; llm_provider?: string; llm_model?: string },
  ) =>
    api.post(`/teacherbots/${id}/test`, { content, history, ...overrides }, { signal }),
  publish: (id: string, classId: string) =>
    api.post(`/teacherbots/${id}/publish`, { class_id: classId }),
  publishToStudent: (id: string, studentId: string) =>
    api.post(`/teacherbots/${id}/publish`, { student_id: studentId }),
  getPublications: (id: string) =>
    api.get(`/teacherbots/${id}/publications`),
  unpublish: (id: string, publicationId: string) =>
    api.delete(`/teacherbots/${id}/publications/${publicationId}`),
  getReports: (id: string) =>
    api.get(`/teacherbots/${id}/reports`),
  getTeacherConversationMessages: (teacherbotId: string, conversationId: string) =>
    api.get(`/teacherbots/${teacherbotId}/conversations/${conversationId}/messages`),

  // Knowledge base
  uploadKbDocument: (teacherbotId: string, file: File) => {
    const formData = new FormData()
    formData.append('file', file)
    return api.post(`/teacherbots/${teacherbotId}/kb`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' }
    })
  },
  listKbDocuments: (teacherbotId: string) =>
    api.get(`/teacherbots/${teacherbotId}/kb`),
  deleteKbDocument: (teacherbotId: string, docId: string) =>
    api.delete(`/teacherbots/${teacherbotId}/kb/${docId}`),

  // Student endpoints
  listAvailable: () => api.get('/student/teacherbots'),
  startConversation: (teacherbotId: string, sessionId: string, signal?: AbortSignal) =>
    api.post(`/student/teacherbots/${teacherbotId}/conversations`, { session_id: sessionId }, { signal }),
  getConversations: () => api.get('/student/teacherbots/conversations'),
  getConversationMessages: (conversationId: string) =>
    api.get(`/student/teacherbots/conversations/${conversationId}/messages`),
  sendMessage: (conversationId: string, content: string, signal?: AbortSignal) =>
    api.post(`/student/teacherbots/conversations/${conversationId}/message`, { content }, { signal }),
  sendMessageWithFiles: (conversationId: string, content: string, files: File[], signal?: AbortSignal) => {
    const formData = new FormData()
    formData.append('content', content)
    files.forEach(file => formData.append('files', file))
    return api.post(`/student/teacherbots/conversations/${conversationId}/message-with-files`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
      signal,
    })
  },
  endConversation: (conversationId: string) =>
    api.post(`/student/teacherbots/conversations/${conversationId}/end`),
  getSessionConversations: (sessionId: string) =>
    api.get(`/teacher/sessions/${sessionId}/teacherbot-conversations`),
  getTeacherConvMessages: (teacherbotId: string, conversationId: string) =>
    api.get(`/teacherbots/${teacherbotId}/conversations/${conversationId}/messages`),

  // Share links (public link + access code + expiry)
  createShareLink: (teacherbotId: string, data: { expires_at: string; label?: string; access_code?: string }) =>
    api.post(`/teacherbots/${teacherbotId}/share-links`, data),
  listShareLinks: (teacherbotId: string) =>
    api.get(`/teacherbots/${teacherbotId}/share-links`),
  revokeShareLink: (teacherbotId: string, linkId: string) =>
    api.delete(`/teacherbots/${teacherbotId}/share-links/${linkId}`),
  listShareLinkConversations: (teacherbotId: string, linkId: string) =>
    api.get(`/teacherbots/${teacherbotId}/share-links/${linkId}/conversations`),
  getShareConversationMessages: (teacherbotId: string, conversationId: string) =>
    api.get(`/teacherbots/${teacherbotId}/share-conversations/${conversationId}/messages`),
}

export const studentbotsApi = {
  list: () => api.get('/student/studentbots'),
  create: (data: {
    name: string
    synopsis?: string
    description?: string
    icon?: string
    color?: string
    system_prompt: string
    is_proactive?: boolean
    proactive_message?: string
    enable_live_voice?: boolean
    llm_provider?: string
    llm_model?: string
    temperature?: number
  }) => api.post('/student/studentbots', data),
  get: (id: string) => api.get(`/student/studentbots/${id}`),
  update: (id: string, data: Record<string, unknown>) => api.patch(`/student/studentbots/${id}`, data),
  delete: (id: string) => api.delete(`/student/studentbots/${id}`),
  test: (
    id: string,
    content: string,
    history?: { role: string; content: string }[],
    signal?: AbortSignal,
    overrides?: { system_prompt?: string; temperature?: number; llm_provider?: string; llm_model?: string },
  ) => api.post(`/student/studentbots/${id}/test`, { content, history, ...overrides }, { signal }),
  uploadKbDocument: (id: string, file: File) => {
    const formData = new FormData()
    formData.append('file', file)
    return api.post(`/student/studentbots/${id}/kb`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    })
  },
  listKbDocuments: (id: string) => api.get(`/student/studentbots/${id}/kb`),
  deleteKbDocument: (id: string, docId: string) => api.delete(`/student/studentbots/${id}/kb/${docId}`),
}

export const publicTeacherbotApi = {
  getLinkInfo: (token: string) => api.get(`/public/teacherbot-links/${token}`),
  verifyCode: (token: string, accessCode: string) =>
    api.post(`/public/teacherbot-links/${token}/verify`, { access_code: accessCode }),
  getMessages: (conversationId: string) =>
    api.get(`/public/teacherbot-links/conversations/${conversationId}/messages`),
  sendMessage: (conversationId: string, content: string, signal?: AbortSignal) =>
    api.post(`/public/teacherbot-links/conversations/${conversationId}/message`, { content }, { signal }),
  sendMessageWithFiles: (conversationId: string, content: string, files: File[], signal?: AbortSignal) => {
    const formData = new FormData()
    formData.append('content', content)
    files.forEach((file) => formData.append('files', file))
    return api.post(`/public/teacherbot-links/conversations/${conversationId}/message-with-files`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
      signal,
    })
  },
}

export const creditsApi = {
  getBalance: () => api.get('/credits/balance'),
  getHistory: (limit = 20) => api.get('/credits/history', { params: { limit } }),
  getStudentPoolBalance: () => api.get('/credits/student-pool/balance'),
  getStudentPoolHistory: (limit = 50) => api.get('/credits/student-pool/history', { params: { limit } }),
  getStats: (startDate?: string, endDate?: string) =>
    api.get('/credits/stats', { params: { start_date: startDate, end_date: endDate } }),
  getLimits: (level?: string) =>
    api.get('/credits/limits', { params: { level } }),
  updateLimit: (id: string, data: { amount_cap: number; reset_frequency?: string }) =>
    api.put(`/credits/limits/${id}`, data),
  createGlobalLimit: (amount_cap: number) =>
    api.post('/credits/limits', null, { params: { amount_cap } }),
  getRequests: (status?: string) =>
    api.get('/credits/requests', { params: { status } }),
  reviewRequest: (id: string, status: string, notes?: string) =>
    api.post(`/credits/requests/${id}/review`, { status, admin_notes: notes }),
  inviteTeacher: (email: string, firstName?: string, lastName?: string, school?: string, groupTag?: string, customMessage?: string) =>
    api.post('/credits/invitations', { email, first_name: firstName, last_name: lastName, school, group_tag: groupTag, custom_message: customMessage }),
  bulkInvite: (file: File) => {
    const formData = new FormData()
    formData.append('file', file)
    return api.post('/credits/invitations/bulk', formData, {
      headers: { 'Content-Type': 'multipart/form-data' }
    })
  },
  bulkInviteJson: (teachers: Array<{ email: string; first_name?: string; last_name?: string; school?: string }>, groupTag?: string, customMessage?: string) =>
    api.post('/credits/invitations/bulk-json', { teachers, group_tag: groupTag, custom_message: customMessage }),
  getInvitations: () => api.get('/credits/invitations'),
  resendInvitation: (invitationId: string) =>
    api.post(`/credits/invitations/${invitationId}/resend`),
  deleteInvitation: (invitationId: string) =>
    api.delete(`/credits/invitations/${invitationId}`),
}

export const feedbackApi = {
  submit: (data: {
    message: string
    page_url?: string
    browser_info?: {
      user_agent?: string
      screen_width?: number
      screen_height?: number
      language?: string
      platform?: string
      viewport_width?: number
      viewport_height?: number
    }
    console_errors?: string[]
    screenshot_base64?: string
  }) => api.post('/feedback/', data),
  list: (params?: { limit?: number; offset?: number; status_filter?: string }) =>
    api.get('/feedback/admin', { params }),
  updateStatus: (id: string, status: string) =>
    api.patch(`/feedback/admin/${id}/status`, { status }),
  reply: (id: string, reply_type: 'in_progress' | 'resolved') =>
    api.post(`/feedback/admin/${id}/reply`, { reply_type }),

  // ── Project-management board ──
  boardAccess: () => api.get('/feedback/board/access'),
  board: () => api.get('/feedback/board'),
  boardConfig: () => api.get('/feedback/board/config'),
  updateBoardConfig: (data: {
    title?: string
    columns?: { id: string; label: string; hint?: string; color?: string }[]
    template_id?: string
    is_shared_with_class?: boolean
    students_can_contribute?: boolean
  }) => api.put('/feedback/board/config', data),
  createBoardCard: (data: {
    message: string
    board_status?: string
    category?: string
    urgency?: string
    internal_note?: string
  }) => api.post('/feedback/board/cards', data),
  updateBoardCard: (
    id: string,
    patch: { board_status?: string; category?: string; urgency?: string; internal_note?: string },
  ) => api.patch(`/feedback/board/${id}`, patch),
  classifyCard: (id: string) => api.post(`/feedback/board/${id}/classify`),
  classifyAll: () => api.post('/feedback/board/classify-all'),
  replyBoardCard: (id: string, reply_type: 'in_progress' | 'resolved') =>
    api.post(`/feedback/board/${id}/reply`, { reply_type }),
  listCollaborators: () => api.get('/feedback/board/collaborators'),
  listEligibleCollaborators: () => api.get('/feedback/board/eligible-collaborators'),
  addCollaborator: (email: string) => api.post('/feedback/board/collaborators', { email }),
  removeCollaborator: (teacherId: string) => api.delete(`/feedback/board/collaborators/${teacherId}`),
}

export const boardsApi = {
  templates: () => api.get('/boards/templates'),
  list: (sessionId?: string) => api.get('/boards', { params: { session_id: sessionId } }),
  create: (data: {
    title: string
    description?: string
    session_id?: string
    template_key?: string
    columns?: { id: string; label: string; hint?: string; color?: string }[]
    visibility?: 'private' | 'session_shared'
    students_can_edit?: boolean
  }) => api.post('/boards', data),
  get: (id: string) => api.get(`/boards/${id}`),
  delete: (id: string) => api.delete(`/boards/${id}`),
  update: (id: string, data: {
    title?: string
    description?: string
    columns?: { id: string; label: string; hint?: string; color?: string }[]
    visibility?: 'private' | 'session_shared'
    students_can_edit?: boolean
    coding_project_id?: string | null
    move_cards_from_column_id?: string
    move_cards_to_column_id?: string
  }) => api.patch(`/boards/${id}`, data),
  createCard: (boardId: string, data: { title: string; description?: string; column_id?: string; color?: string }) =>
    api.post(`/boards/${boardId}/cards`, data),
  createCardsBulk: (boardId: string, data: { cards: { title: string; description?: string; column_id?: string; color?: string }[] }) =>
    api.post(`/boards/${boardId}/cards/bulk`, data),
  updateCard: (boardId: string, cardId: string, data: { title?: string; description?: string; column_id?: string; color?: string; coding_project_id?: string | null; coding_status?: string | null; sort_order?: string }) =>
    api.patch(`/boards/${boardId}/cards/${cardId}`, data),
  deleteCard: (boardId: string, cardId: string) =>
    api.delete(`/boards/${boardId}/cards/${cardId}`),
  aiChat: (boardId: string, data: { message: string; history?: { role: string; content: string }[]; generate_tasks?: boolean }) =>
    api.post(`/boards/${boardId}/ai/chat`, data),
}


export const notebooksApi = {
  list: () => api.get('/notebooks'),
  create: (title: string, projectType: 'python' | 'p5js' | 'strudel' | 'game2d' | 'microbit' | 'circuitplayground', templateKey?: string) =>
    api.post('/notebooks', { title, project_type: projectType, template_key: templateKey }),
  get: (id: string) => api.get(`/notebooks/${id}`),
  update: (id: string, data: { title?: string; cells?: unknown[]; project_type?: 'python' | 'p5js' | 'strudel' | 'game2d' | 'microbit' | 'circuitplayground'; editor_settings?: Record<string, unknown> }) => api.put(`/notebooks/${id}`, data),
  delete: (id: string) => api.delete(`/notebooks/${id}`),
  tutorChat: (id: string, data: {
    message: string
    history?: { role: string; content: string }[]
    current_cell_source?: string
    last_output?: string
    pending_proposals?: unknown[]
  }) => api.post(`/notebooks/${id}/tutor`, data),
  assist: (id: string, data: {
    message?: string
    current_cell_source?: string
    last_output?: string
  }) => api.post(`/notebooks/${id}/assist`, data),
  assistStreamUrl: (id: string) => `/api/v1/notebooks/${id}/assist-stream`,
  listVersions: (id: string) => api.get<NotebookVersionSummary[]>(`/notebooks/${id}/versions`),
  createVersion: (id: string, data: { label?: string; source?: NotebookVersionSource }) =>
    api.post<NotebookVersionSummary>(`/notebooks/${id}/versions`, data),
  getVersion: (id: string, versionId: string) =>
    api.get<NotebookVersionDetail>(`/notebooks/${id}/versions/${versionId}`),
  restoreVersion: (id: string, versionId: string) =>
    api.post(`/notebooks/${id}/versions/${versionId}/restore`, {}),
  deleteVersion: (id: string, versionId: string) =>
    api.delete(`/notebooks/${id}/versions/${versionId}`),
  listAssignments: () => api.get<NotebookAssignment[]>('/notebooks/assignments'),
  assign: (id: string, sessionId: string, description?: string) =>
    api.post<NotebookAssignment>(`/notebooks/${id}/assign`, { session_id: sessionId, description }),
  forkAssignment: (assignmentId: string) =>
    api.post<{ notebook_id: string; created: boolean }>(`/notebooks/assignments/${assignmentId}/fork`, {}),
  submit: (id: string) =>
    api.post<{ id: string; version_id: string; submitted_at: string }>(`/notebooks/${id}/submit`, {}),
}

export interface NotebookAssignment {
  id: string
  task_id: string
  session_id: string
  session_title?: string
  source_notebook_id: string
  source_version_id: string
  title: string
  project_type: string
  is_active: boolean
  created_at: string
  fork_notebook_id?: string | null
  submitted_at?: string | null
  submission_count?: number
}

export type NotebookVersionSource = 'manual' | 'ai' | 'auto' | 'rollback'

export interface NotebookVersionSummary {
  id: string
  label: string
  source: NotebookVersionSource
  title: string
  project_type: string
  cell_count: number
  created_at: string
}

export interface NotebookVersionDetail extends NotebookVersionSummary {
  cells: unknown[]
  editor_settings: Record<string, unknown>
}

export interface CircuitPlaygroundCompileResult {
  ok: boolean
  board: 'circuitplayground' | string
  filename: string
  mime_type: string
  size_bytes: number
  uf2_base64: string
  logs?: string
}

export const hardwareApi = {
  compileCircuitPlayground: (code: string) =>
    api.post<CircuitPlaygroundCompileResult>('/hardware/circuit-playground/compile', { code }),
}

export const desktopApi = {
  listDesktops: () => api.get('/desktop'),
  createDesktop: (data: { title?: string; wallpaper_key?: string }) =>
    api.post('/desktop', data),
  updateDesktop: (id: string, data: { title?: string; wallpaper_key?: string }) =>
    api.patch(`/desktop/${id}`, data),
  deleteDesktop: (id: string) => api.delete(`/desktop/${id}`),
  reorderDesktops: (ids: string[]) => api.patch('/desktop/reorder', { ids }),
  addWidget: (desktopId: string, data: {
    widget_type: string
    grid_x?: number
    grid_y?: number
    grid_w?: number
    grid_h?: number
    config_json?: Record<string, unknown>
  }) => api.post(`/desktop/${desktopId}/widgets`, data),
  updateWidget: (desktopId: string, widgetId: string, data: {
    grid_x?: number
    grid_y?: number
    grid_w?: number
    grid_h?: number
    config_json?: Record<string, unknown>
  }) => api.patch(`/desktop/${desktopId}/widgets/${widgetId}`, data),
  deleteWidget: (desktopId: string, widgetId: string) =>
    api.delete(`/desktop/${desktopId}/widgets/${widgetId}`),
}

export const calendarApi = {
  listEvents: (sessionId: string, fromDate?: string, toDate?: string) =>
    api.get(`/calendar/session/${sessionId}/events`, { params: { from_date: fromDate, to_date: toDate } }),
  createEvent: (sessionId: string, data: { title: string; description?: string; event_date: string; event_time?: string; color?: string }) =>
    api.post(`/calendar/session/${sessionId}/events`, data),
  updateEvent: (sessionId: string, eventId: string, data: { title?: string; description?: string; event_date?: string; event_time?: string | null; color?: string }) =>
    api.patch(`/calendar/session/${sessionId}/events/${eventId}`, data),
  deleteEvent: (sessionId: string, eventId: string) =>
    api.delete(`/calendar/session/${sessionId}/events/${eventId}`),
}

export const liveInteractionApi = {
  // Teacher
  list: (sessionId: string) =>
    api.get('/teacher/live-interactions', { params: { session_id: sessionId } }),
  create: (data: { session_id: string; title: string; slides_json: object[] }) =>
    api.post('/teacher/live-interactions', data),
  get: (id: string) =>
    api.get(`/teacher/live-interactions/${id}`),
  update: (id: string, data: { title?: string; slides_json?: object[] }) =>
    api.put(`/teacher/live-interactions/${id}`, data),
  delete: (id: string) =>
    api.delete(`/teacher/live-interactions/${id}`),
  start: (id: string) =>
    api.post(`/teacher/live-interactions/${id}/start`),
  next: (id: string) =>
    api.post(`/teacher/live-interactions/${id}/next`),
  end: (id: string) =>
    api.post(`/teacher/live-interactions/${id}/end`),
  results: (id: string) =>
    api.get(`/teacher/live-interactions/${id}/results`),
  // Student
  currentStudent: () =>
    api.get('/student/live-interaction/current'),
  submitAnswer: (data: { live_interaction_id: string; slide_index: number; response: object }) =>
    api.post('/student/live-interaction/answer', data),
}

export const desktopAgentApi = {
  chat: (body: {
    message: string
    context: {
      desktop_id: string
      wallpaper_key: string
      widgets: Array<{
        id: string; widget_type: string; config_json: Record<string, unknown>
        grid_x: number; grid_y: number; grid_w: number; grid_h: number
      }>
      calendar_events?: Array<{
        id: string; title: string; event_date: string; event_time?: string
        description?: string; color: string
      }>
      session?: { id?: string; name?: string; class_name?: string } | null
      user_name: string
      user_role: 'teacher' | 'student'
    }
  }) => api.post('/desktop/agent', body),
}

type MeshyTaskResult = {
  id: string
  status: 'PENDING' | 'IN_PROGRESS' | 'SUCCEEDED' | 'FAILED' | 'EXPIRED'
  progress: number
  model_urls?: { glb?: string; fbx?: string; obj?: string; usdz?: string }
  thumbnail_url?: string
  error?: { message?: string }
}

export const meshyApi = {
  startTextTo3D: (prompt: string, negative_prompt?: string) =>
    api.post<{ task_id: string }>('/meshy/text-to-3d', { prompt, negative_prompt }),
  getTextTo3DStatus: (taskId: string) =>
    api.get<MeshyTaskResult>(`/meshy/text-to-3d/${taskId}`),
  startImageTo3D: (
    image_data: string,
    image_mime: string = 'image/jpeg',
    enable_pbr: boolean = true,
    topology: string = 'quad',
    target_polycount: number = 30000,
  ) =>
    api.post<{ task_id: string }>('/meshy/image-to-3d', { image_data, image_mime, enable_pbr, topology, target_polycount }),
  getImageTo3DStatus: (taskId: string) =>
    api.get<MeshyTaskResult>(`/meshy/image-to-3d/${taskId}`),
  generateImage: (prompt: string, size?: string, quality?: string, style?: string) =>
    api.post<{ image_data: string; image_mime: string; revised_prompt: string }>('/meshy/text-to-image', { prompt, size, quality, style }),
  proxyAssetUrl: (url: string) =>
    `/api/v1/meshy/proxy-asset?url=${encodeURIComponent(url)}`,
}
