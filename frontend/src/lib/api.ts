import axios from 'axios'

const api = axios.create({
  baseURL: '/api/v1',
  withCredentials: true,
})

api.interceptors.request.use((config) => {
  const studentToken = localStorage.getItem('student_token')
  if (studentToken) {
    config.headers['student-token'] = studentToken
  }
  return config
})

api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      localStorage.removeItem('student_token')
      window.location.href = '/login'
    }
    return Promise.reject(error)
  }
)

export default api

export const authApi = {
  login: (email: string, password: string) =>
    api.post('/auth/login', { email, password }),
  logout: () => api.post('/auth/logout'),
  requestTeacher: (data: { email: string; first_name: string; last_name: string; tenant_slug?: string }) =>
    api.post('/auth/teachers/request', data),
}

export const studentApi = {
  join: (join_code: string, nickname: string) =>
    api.post('/student/join', { join_code, nickname }),
  getSession: () => api.get('/student/session'),
  heartbeat: () => api.post('/student/heartbeat'),
  getTasks: () => api.get('/student/tasks'),
  submitTask: (taskId: string, content?: string, content_json?: string) =>
    api.post(`/student/tasks/${taskId}/submit`, null, { params: { content, content_json } }),
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
  getUsers: (role?: string) =>
    api.get('/admin/users', { params: { role } }),
  resetPassword: (userId: string) =>
    api.post(`/admin/users/${userId}/reset-password`),
  deleteUser: (userId: string) =>
    api.delete(`/admin/users/${userId}`),
  getUsage: () => api.get('/admin/usage'),
}

export const teacherApi = {
  getClasses: () => api.get('/teacher/classes'),
  createClass: (name: string) => api.post('/teacher/classes', { name }),
  updateClass: (id: string, name: string) =>
    api.patch(`/teacher/classes/${id}`, { name }),
  getSessions: (classId: string) =>
    api.get(`/teacher/classes/${classId}/sessions`),
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
  deleteSession: (sessionId: string) =>
    api.delete(`/teacher/sessions/${sessionId}`, { params: { confirm: true } }),
  exportSession: (sessionId: string) =>
    api.post(`/teacher/sessions/${sessionId}/export`),
  getAudit: (sessionId: string, cursor?: string) =>
    api.get(`/teacher/sessions/${sessionId}/audit`, { params: { cursor } }),
  getTasks: (sessionId: string) =>
    api.get(`/teacher/sessions/${sessionId}/tasks`),
  createTask: (sessionId: string, data: { title: string; description?: string; task_type?: string; points?: string; content_json?: string }) =>
    api.post(`/teacher/sessions/${sessionId}/tasks`, data),
  updateTask: (sessionId: string, taskId: string, data: { title?: string; description?: string; new_status?: string; points?: string }) =>
    api.patch(`/teacher/sessions/${sessionId}/tasks/${taskId}`, null, { params: data }),
  deleteTask: (sessionId: string, taskId: string) =>
    api.delete(`/teacher/sessions/${sessionId}/tasks/${taskId}`),
  getTaskSubmissions: (sessionId: string, taskId: string) =>
    api.get(`/teacher/sessions/${sessionId}/tasks/${taskId}/submissions`),
  gradeSubmission: (sessionId: string, taskId: string, submissionId: string, data: { score?: string; feedback?: string }) =>
    api.patch(`/teacher/sessions/${sessionId}/tasks/${taskId}/submissions/${submissionId}`, null, { params: data }),
  // Profile
  getProfile: () => api.get('/teacher/profile'),
  updateProfile: (data: { first_name?: string; last_name?: string; institution?: string; avatar_url?: string }) =>
    api.put('/teacher/profile', data),
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
  getSessionMessages: (sessionId: string) =>
    api.get(`/chat/session/${sessionId}/messages`),
  sendSessionMessage: (sessionId: string, text: string) =>
    api.post(`/chat/session/${sessionId}/messages`, { text }),
}

export const llmApi = {
  getProfiles: () => api.get('/llm/profiles'),
  getChatbotProfiles: () => api.get('/llm/chatbot-profiles'),
  getAvailableModels: () => api.get('/llm/available-models'),
  getSessionConversations: (sessionId: string) => api.get(`/llm/sessions/${sessionId}/conversations`),
  getConversationMessages: (conversationId: string) => api.get(`/llm/conversations/${conversationId}/messages`),
  createConversation: (sessionId: string, profileKey: string, title?: string, provider?: string, model?: string) =>
    api.post('/llm/conversations', { session_id: sessionId, profile_key: profileKey, title, provider, model }),
  getConversations: (sessionId?: string, studentId?: string) =>
    api.get('/llm/conversations', { params: { session_id: sessionId, student_id: studentId } }),
  getMessages: (conversationId: string) =>
    api.get(`/llm/conversations/${conversationId}/messages`),
  sendMessage: (conversationId: string, content: string, imageProvider?: string, imageSize?: string, verboseMode?: boolean) =>
    api.post(`/llm/conversations/${conversationId}/message`, { content, image_provider: imageProvider, image_size: imageSize, verbose_mode: verboseMode }),
  deleteConversation: (conversationId: string) =>
    api.delete(`/llm/conversations/${conversationId}`),
  deleteAllConversations: (sessionId: string) =>
    api.delete(`/llm/sessions/${sessionId}/conversations`),
  teacherChat: (content: string, history: { role: string; content: string }[], profileKey?: string, provider?: string, model?: string) =>
    api.post('/llm/teacher/chat', { content, history, profile_key: profileKey, provider, model }),
  teacherChatWithFiles: (content: string, history: { role: string; content: string }[], profileKey: string, provider: string, model: string, files: File[]) => {
    const formData = new FormData()
    formData.append('content', content)
    formData.append('history', JSON.stringify(history))
    formData.append('profile_key', profileKey)
    formData.append('provider', provider)
    formData.append('model', model)
    files.forEach(file => formData.append('files', file))
    return api.post('/llm/teacher/chat-with-files', formData, {
      headers: { 'Content-Type': 'multipart/form-data' }
    })
  },
  sendMessageWithFiles: (conversationId: string, content: string, files: File[]) => {
    const formData = new FormData()
    formData.append('content', content)
    files.forEach(file => formData.append('files', file))
    return api.post(`/llm/conversations/${conversationId}/message-with-files`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' }
    })
  },
  generateImage: (prompt: string, provider: 'dall-e' | 'flux-schnell' = 'dall-e') =>
    api.post('/llm/generate-image', { prompt, provider }),
  explain: (messageId: string) =>
    api.post('/llm/explain', { message_id: messageId }),
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
  getUploadUrl: (data: { filename: string; mime_type: string; size_bytes: number; scope: string; session_id?: string }) =>
    api.post('/files/upload-url', data),
  completeUpload: (fileId: string, checksum: string) =>
    api.post('/files/complete', { file_id: fileId, checksum_sha256: checksum }),
  getDownloadUrl: (fileId: string) =>
    api.get(`/files/${fileId}/download-url`),
}
