import { useState, useRef, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Send, Loader2, Bot, Download,
  FileText, ClipboardList, BarChart3,
  ChevronDown, Paperclip, X, File, BookOpen, Upload, Edit,
  Presentation, Globe, Star, Image, MessageSquare, Settings,
  History, PlusCircle, ChevronLeft, ChevronRight, Trash2
} from 'lucide-react'
import { ArtifactPreviewModal } from '@/components/ArtifactPreviewModal'
import { TeacherNavbar } from '@/components/TeacherNavbar'
import { teacherApi } from '@/lib/api'
import { useQuery } from '@tanstack/react-query'
import { llmApi } from '@/lib/api'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'
import 'katex/dist/katex.min.css'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend } from 'recharts'

const CHART_COLORS = ['#10b981', '#3b82f6', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899']

// Component to render enhanced message with charts and publish buttons
function EnhancedMessage({
  content,
  isHistorical = false,
  onPublishQuiz,
  onPublishLesson,
  onPublishExercise,
  onPublishPresentation,
  onEditQuiz,
  onEditLesson,
  onEditExercise,
  onEditPresentation
}: {
  content: string
  isHistorical?: boolean
  onPublishQuiz?: (data: any) => void
  onPublishLesson?: (data: any) => void
  onPublishExercise?: (data: any) => void
  onPublishPresentation?: (data: any) => void
  onEditQuiz?: (data: any) => void
  onEditLesson?: (data: any) => void
  onEditExercise?: (data: any) => void
  onEditPresentation?: (data: any) => void
}) {
  // Extract quiz_data, lesson_data, exercise_data, or presentation_data blocks
  const extractPublishableContent = (text: string) => {
    // More robust regex patterns
    // Matches ```quiz_data ... ``` OR ```json ...quiz_data ... ``` variations
    const patterns = {
      quiz: /```(?:quiz_data|json\s+quiz_data)[\s\S]*?({[\s\S]*?})[\s\S]*?```/i,
      lesson: /```(?:lesson_data|json\s+lesson_data)[\s\S]*?({[\s\S]*?})[\s\S]*?```/i,
      exercise: /```(?:exercise_data|json\s+exercise_data)[\s\S]*?({[\s\S]*?})[\s\S]*?```/i,
      presentation: /```(?:presentation_data|json\s+presentation_data)[\s\S]*?({[\s\S]*?})[\s\S]*?```/i
    }

    const quizMatch = text.match(patterns.quiz)
    const lessonMatch = text.match(patterns.lesson)
    const exerciseMatch = text.match(patterns.exercise)
    const presentationMatch = text.match(patterns.presentation)

    let quizData = null
    let lessonData = null
    let exerciseData = null
    let presentationData = null

    if (quizMatch) {
      try {
        // Try to parse the captured group (the JSON part)
        quizData = JSON.parse(quizMatch[1].trim())
      } catch (e) {
        console.error('Failed to parse quiz_data:', e)
        // Fallback: try to find any JSON object in the match
        const jsonCandidate = quizMatch[0].match(/{[\s\S]*}/)
        if (jsonCandidate) {
             try { quizData = JSON.parse(jsonCandidate[0]) } catch (e2) {}
        }
      }
    }

    if (lessonMatch) {
      try {
        lessonData = JSON.parse(lessonMatch[1].trim())
      } catch (e) {
        console.error('Failed to parse lesson_data:', e)
         const jsonCandidate = lessonMatch[0].match(/{[\s\S]*}/)
        if (jsonCandidate) {
             try { lessonData = JSON.parse(jsonCandidate[0]) } catch (e2) {}
        }
      }
    }

    if (exerciseMatch) {
      try {
        exerciseData = JSON.parse(exerciseMatch[1].trim())
      } catch (e) {
        console.error('Failed to parse exercise_data:', e)
        const jsonCandidate = exerciseMatch[0].match(/{[\s\S]*}/)
        if (jsonCandidate) {
             try { exerciseData = JSON.parse(jsonCandidate[0]) } catch (e2) {}
        }
      }
    }

    if (presentationMatch) {
      try {
        presentationData = JSON.parse(presentationMatch[1].trim())
      } catch (e) {
        console.error('Failed to parse presentation_data:', e)
        const jsonCandidate = presentationMatch[0].match(/{[\s\S]*}/)
        if (jsonCandidate) {
             try { presentationData = JSON.parse(jsonCandidate[0]) } catch (e2) {}
        }
      }
    }

    return { quizData, lessonData, exerciseData, presentationData }
  }

  const { quizData, lessonData, exerciseData, presentationData } = extractPublishableContent(content)

  // Remove the JSON blocks from display content for cleaner rendering
  // Also updated regex for removal to match the extraction patterns broadly
  let displayContent = content
    .replace(/```(?:quiz_data|json\s+quiz_data)[\s\S]*?```/gi, '')
    .replace(/```(?:lesson_data|json\s+lesson_data)[\s\S]*?```/gi, '')
    .replace(/```(?:exercise_data|json\s+exercise_data)[\s\S]*?```/gi, '')
    .replace(/```(?:presentation_data|json\s+presentation_data)[\s\S]*?```/gi, '')
    .trim()
  
  // If display content is empty but we have data, show a default message
  if (!displayContent && (quizData || lessonData || exerciseData || presentationData)) {
    displayContent = "_Contenuto generato con successo. Vedi sotto per le opzioni._"
  }
  // Parse markdown tables and convert to chart data
  const parseTableData = (text: string) => {
    const tableRegex = /\|(.+)\|[\r\n]+\|[-:\s|]+\|[\r\n]+((?:\|.+\|[\r\n]*)+)/g
    const tables: { headers: string[]; rows: string[][] }[] = []
    let match
    
    while ((match = tableRegex.exec(text)) !== null) {
      const headers = match[1].split('|').map(h => h.trim()).filter(h => h)
      const rowsText = match[2].trim().split('\n')
      const rows = rowsText.map(row => 
        row.split('|').map(cell => cell.trim()).filter(cell => cell)
      )
      tables.push({ headers, rows })
    }
    return tables
  }

  // Extract statistics from content
  const extractStats = (text: string) => {
    const stats: { label: string; value: number; total?: number }[] = []
    
    // Look for patterns like "X su Y" or "X/Y"
    const ratioRegex = /(\d+)\s*(?:su|\/)\s*(\d+)/g
    let match
    while ((match = ratioRegex.exec(text)) !== null) {
      const context = text.substring(Math.max(0, match.index - 50), match.index)
      const label = context.split(/[.!?\n]/).pop()?.trim() || 'Valore'
      stats.push({ label: label.slice(-30), value: parseInt(match[1]), total: parseInt(match[2]) })
    }
    return stats
  }

  const tables = parseTableData(displayContent)
  const stats = extractStats(displayContent)

  // Convert table to chart data if it has numeric values
  const getChartData = (table: { headers: string[]; rows: string[][] }) => {
    if (table.rows.length === 0) return null
    
    // Check if there are numeric columns
    const numericColIndices = table.headers.map((_, i) => {
      const hasNumbers = table.rows.some(row => !isNaN(parseFloat(row[i])))
      return hasNumbers ? i : -1
    }).filter(i => i >= 0)

    if (numericColIndices.length === 0) return null

    return table.rows.map(row => {
      const item: Record<string, string | number> = { name: row[0] }
      numericColIndices.forEach(i => {
        if (i > 0) {
          item[table.headers[i]] = parseFloat(row[i]) || 0
        }
      })
      return item
    })
  }

  // Render stats cards
  const renderStatsCards = () => {
    if (stats.length === 0) return null
    
    return (
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 my-4">
        {stats.slice(0, 4).map((stat, i) => (
          <div key={i} className="bg-white border rounded-lg p-3 text-center shadow-sm">
            <div className="text-2xl font-bold text-blue-600">
              {stat.value}{stat.total ? `/${stat.total}` : ''}
            </div>
            <div className="text-xs text-gray-500 truncate">{stat.label}</div>
            {stat.total && (
              <div className="mt-1 h-1.5 bg-gray-200 rounded-full overflow-hidden">
                <div 
                  className="h-full bg-blue-500 rounded-full" 
                  style={{ width: `${(stat.value / stat.total) * 100}%` }}
                />
              </div>
            )}
          </div>
        ))}
      </div>
    )
  }

  // Render charts for tables
  const renderCharts = () => {
    return tables.map((table, i) => {
      const chartData = getChartData(table)
      if (!chartData || chartData.length === 0) return null

      const numericKeys = Object.keys(chartData[0]).filter(k => k !== 'name')
      
      // Use pie chart for single value, bar chart for multiple
      if (chartData.length <= 6 && numericKeys.length === 1) {
        const pieData = chartData.map((item, idx) => ({
          name: item.name as string,
          value: item[numericKeys[0]] as number,
          fill: CHART_COLORS[idx % CHART_COLORS.length]
        }))

        return (
          <div key={i} className="my-4 bg-white border rounded-lg p-4">
            <h4 className="text-sm font-semibold mb-3 text-gray-700">Distribuzione</h4>
            <div className="h-48">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={pieData}
                    cx="50%"
                    cy="50%"
                    innerRadius={40}
                    outerRadius={70}
                    dataKey="value"
                    label={({ name, percent }) => `${name} (${(percent * 100).toFixed(0)}%)`}
                  >
                    {pieData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.fill} />
                    ))}
                  </Pie>
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </div>
        )
      }

      return (
        <div key={i} className="my-4 bg-white border rounded-lg p-4">
          <h4 className="text-sm font-semibold mb-3 text-gray-700">Riepilogo Dati</h4>
          <div className="h-48">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="name" fontSize={11} />
                <YAxis fontSize={11} />
                <Tooltip />
                <Legend />
                {numericKeys.map((key, idx) => (
                  <Bar key={key} dataKey={key} fill={CHART_COLORS[idx % CHART_COLORS.length]} />
                ))}
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )
    })
  }

  // Download this message as text/markdown
  const handleDownload = () => {
    const blob = new Blob([content], { type: 'text/markdown' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `risposta-${new Date().toISOString().slice(0,10)}.md`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="space-y-4">
      {renderStatsCards()}
      {renderCharts()}
      <div className="prose prose-sm max-w-none prose-headings:mt-4 prose-headings:mb-2 prose-p:my-2 prose-ul:my-2 prose-ol:my-2 prose-li:my-1 prose-table:my-4 prose-hr:my-4">
        <ReactMarkdown
          remarkPlugins={[remarkGfm, remarkMath]}
          rehypePlugins={[rehypeKatex]}
          components={{
            h1: ({ children }) => <h1 className="text-xl font-bold text-gray-900 border-b pb-2 mb-4">{children}</h1>,
            h2: ({ children }) => <h2 className="text-lg font-semibold text-gray-800 mt-6 mb-3">{children}</h2>,
            h3: ({ children }) => <h3 className="text-base font-semibold text-gray-700 mt-4 mb-2">{children}</h3>,
            p: ({ children }) => <p className="text-gray-700 leading-relaxed my-3">{children}</p>,
            ul: ({ children }) => <ul className="list-disc pl-5 my-3 space-y-1">{children}</ul>,
            ol: ({ children }) => <ol className="list-decimal pl-5 my-3 space-y-1">{children}</ol>,
            li: ({ children }) => <li className="text-gray-700">{children}</li>,
            strong: ({ children }) => <strong className="font-semibold text-gray-900">{children}</strong>,
            table: ({ children }) => (
              <div className="overflow-x-auto my-4">
                <table className="min-w-full border-collapse border border-gray-300 rounded-lg overflow-hidden">
                  {children}
                </table>
              </div>
            ),
            thead: ({ children }) => <thead className="bg-blue-50">{children}</thead>,
            th: ({ children }) => <th className="border border-gray-300 px-4 py-2 text-left font-semibold text-gray-800">{children}</th>,
            td: ({ children }) => <td className="border border-gray-300 px-4 py-2 text-gray-700">{children}</td>,
            blockquote: ({ children }) => (
              <blockquote className="border-l-4 border-blue-500 pl-4 py-2 my-4 bg-blue-50 rounded-r-lg italic text-gray-700">
                {children}
              </blockquote>
            ),
            code: ({ children }) => (
              <code className="bg-gray-100 px-1.5 py-0.5 rounded text-sm font-mono text-gray-800">{children}</code>
            ),
            hr: () => <hr className="my-6 border-gray-200" />,
          }}
        >
          {displayContent}
        </ReactMarkdown>
      </div>
      
      {/* Publish and edit buttons for quiz, lesson, exercise, and presentation */}
      {(quizData || lessonData || exerciseData || presentationData) && (
        <div className="flex flex-wrap gap-2 p-3 bg-gradient-to-r from-emerald-50 to-blue-50 rounded-lg border border-emerald-200">
          {isHistorical && (
            <span className="text-sm text-amber-600 mr-2 self-center">
              🕒 Contenuto storico - puoi ripubblicarlo
            </span>
          )}
          {!isHistorical && (
            <span className="text-sm text-gray-600 mr-2 self-center">
              📤 Contenuto pronto per la pubblicazione:
            </span>
          )}

          {/* Quiz buttons */}
          {quizData && (
            <>
              {onEditQuiz && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => onEditQuiz(quizData)}
                >
                  <ClipboardList className="h-4 w-4 mr-1" />
                  Visualizza/Modifica
                </Button>
              )}
              {onPublishQuiz && (
                <Button
                  size="sm"
                  onClick={() => onPublishQuiz(quizData)}
                  className="bg-emerald-600 hover:bg-emerald-700"
                >
                  <ClipboardList className="h-4 w-4 mr-1" />
                  Pubblica Quiz
                </Button>
              )}
            </>
          )}

          {/* Lesson buttons */}
          {lessonData && (
            <>
              {onEditLesson && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => onEditLesson(lessonData)}
                >
                  <BookOpen className="h-4 w-4 mr-1" />
                  Visualizza/Modifica
                </Button>
              )}
              {onPublishLesson && (
                <Button
                  size="sm"
                  onClick={() => onPublishLesson(lessonData)}
                  className="bg-blue-600 hover:bg-blue-700"
                >
                  <BookOpen className="h-4 w-4 mr-1" />
                  Pubblica Lezione
                </Button>
              )}
            </>
          )}

          {/* Exercise buttons */}
          {exerciseData && (
            <>
              {onEditExercise && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => onEditExercise(exerciseData)}
                >
                  <Edit className="h-4 w-4 mr-1" />
                  Modifica Esercizio
                </Button>
              )}
              {onPublishExercise && (
                <Button
                  size="sm"
                  onClick={() => onPublishExercise(exerciseData)}
                  className="bg-purple-600 hover:bg-purple-700"
                >
                  <FileText className="h-4 w-4 mr-1" />
                  Pubblica Esercizio
                </Button>
              )}
            </>
          )}

          {/* Presentation buttons */}
          {presentationData && (
            <>
              {onEditPresentation && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => onEditPresentation(presentationData)}
                >
                  <Presentation className="h-4 w-4 mr-1" />
                  Visualizza/Modifica
                </Button>
              )}
              {onPublishPresentation && (
                <Button
                  size="sm"
                  onClick={() => onPublishPresentation(presentationData)}
                  className="bg-indigo-600 hover:bg-indigo-700"
                >
                  <Presentation className="h-4 w-4 mr-1" />
                  Pubblica Presentazione ({presentationData.slides?.length || 0} slide)
                </Button>
              )}
            </>
          )}
        </div>
      )}
      
      <div className="flex justify-end pt-2 border-t border-gray-200 mt-4">
        <button
          onClick={handleDownload}
          className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-blue-600 transition-colors"
        >
          <Download className="h-3.5 w-3.5" />
          Scarica risposta
        </button>
      </div>
    </div>
  )
}

interface Message {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  timestamp: Date
}

interface Conversation {
  id: string
  title: string
  messages: Message[]
  createdAt: Date
}

// Model icons as inline SVGs
const MODEL_ICONS: Record<string, React.ReactNode> = {
  openai: (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor">
      <path d="M22.2819 9.8211a5.9847 5.9847 0 0 0-.5157-4.9108 6.0462 6.0462 0 0 0-6.5098-2.9A6.0651 6.0651 0 0 0 4.9807 4.1818a5.9847 5.9847 0 0 0-3.9977 2.9 6.0462 6.0462 0 0 0 .7427 7.0966 5.98 5.98 0 0 0 .511 4.9107 6.051 6.051 0 0 0 6.5146 2.9001A5.9847 5.9847 0 0 0 13.2599 24a6.0557 6.0557 0 0 0 5.7718-4.2058 5.9894 5.9894 0 0 0 3.9977-2.9001 6.0557 6.0557 0 0 0-.7475-7.0729zm-9.022 12.6081a4.4755 4.4755 0 0 1-2.8764-1.0408l.1419-.0804 4.7783-2.7582a.7948.7948 0 0 0 .3927-.6813v-6.7369l2.02 1.1686a.071.071 0 0 1 .038.052v5.5826a4.504 4.504 0 0 1-4.4945 4.4944zm-9.6607-4.1254a4.4708 4.4708 0 0 1-.5346-3.0137l.142.0852 4.783 2.7582a.7712.7712 0 0 0 .7806 0l5.8428-3.3685v2.3324a.0804.0804 0 0 1-.0332.0615L9.74 19.9502a4.4992 4.4992 0 0 1-6.1408-1.6464zM2.3408 7.8956a4.485 4.485 0 0 1 2.3655-1.9728V11.6a.7664.7664 0 0 0 .3879.6765l5.8144 3.3543-2.0201 1.1685a.0757.0757 0 0 1-.071 0l-4.8303-2.7865A4.504 4.504 0 0 1 2.3408 7.872zm16.5963 3.8558L13.1038 8.364 15.1192 7.2a.0757.0757 0 0 1 .071 0l4.8303 2.7913a4.4944 4.4944 0 0 1-.6765 8.1042v-5.6772a.79.79 0 0 0-.407-.667zm2.0107-3.0231l-.142-.0852-4.7735-2.7818a.7759.7759 0 0 0-.7854 0L9.409 9.2297V6.8974a.0662.0662 0 0 1 .0284-.0615l4.8303-2.7866a4.4992 4.4992 0 0 1 6.6802 4.66zM8.3065 12.863l-2.02-1.1638a.0804.0804 0 0 1-.038-.0567V6.0742a4.4992 4.4992 0 0 1 7.3757-3.4537l-.142.0805L8.704 5.459a.7948.7948 0 0 0-.3927.6813zm1.0976-2.3654l2.602-1.4998 2.6069 1.4998v2.9994l-2.5974 1.4997-2.6067-1.4997Z"/>
    </svg>
  ),
  anthropic: (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor">
      <path d="M17.304 3.541h-3.672l6.696 16.918h3.672l-6.696-16.918zm-10.608 0L0 20.459h3.744l1.32-3.432h6.408l1.32 3.432h3.744L9.84 3.541H6.696zm-.576 10.632l2.16-5.616 2.16 5.616H6.12z"/>
    </svg>
  ),
  mistral: (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor">
      <path d="M3.428 3.4h3.429v3.428H3.428V3.4zm13.714 0h3.429v3.428h-3.429V3.4zM3.428 6.828h3.429v3.429H3.428V6.828zm6.857 0h3.429v3.429h-3.429V6.828zm6.857 0h3.429v3.429h-3.429V6.828zM3.428 10.257h3.429v3.429H3.428v-3.429zm3.429 0h3.428v3.429H6.857v-3.429zm6.857 0h3.429v3.429h-3.429v-3.429zm3.428 0h3.429v3.429h-3.429v-3.429zM3.428 13.686h3.429v3.428H3.428v-3.428zm6.857 0h3.429v3.428h-3.429v-3.428zm6.857 0h3.429v3.428h-3.429v-3.428zM3.428 17.114h3.429v3.429H3.428v-3.429zm6.857 0h3.429v3.429h-3.429v-3.429zm6.857 0h3.429v3.429h-3.429v-3.429z"/>
    </svg>
  ),
  deepseek: (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor">
      <circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" strokeWidth="2"/>
      <path d="M12 6v6l4 2" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
    </svg>
  ),
}

const AVAILABLE_MODELS = [
  { id: 'gpt-5-mini', name: 'GPT-5 Mini', description: 'Veloce e intelligente', icon: 'openai', provider: 'openai' },
  { id: 'gpt-5-nano', name: 'GPT-5 Nano', description: 'Ultra veloce', icon: 'openai', provider: 'openai' },
  { id: 'claude-haiku-4-5-20251001', name: 'Claude Haiku 4.5', description: 'Veloce e leggero', icon: 'anthropic', provider: 'anthropic' },
  { id: 'mistral-nemo', name: 'Mistral Nemo', description: '12B locale', icon: 'mistral', provider: 'ollama' },
  { id: 'deepseek-r1:8b', name: 'DeepSeek R1', description: 'Ragionamento', icon: 'deepseek', provider: 'ollama' },
  { id: 'mistral', name: 'Mistral 7B', description: 'Locale efficiente', icon: 'mistral', provider: 'ollama' },
]

// System prompt is configured in backend for teacher_support profile


interface AttachedFile {
  file: globalThis.File
  preview?: string
  type: 'image' | 'document'
}

type AgentMode = 'default' | 'web_search' | 'presentation' | 'quiz' | 'lesson' | 'report' | 'image'

const AGENT_MODES = [
  { id: 'default' as const, icon: MessageSquare, label: 'Chat', color: 'text-slate-600', activeColor: 'text-violet-600 bg-violet-100' },
  { id: 'web_search' as const, icon: Globe, label: 'Web Search', color: 'text-slate-600', activeColor: 'text-emerald-600 bg-emerald-100' },
  { id: 'report' as const, icon: BarChart3, label: 'Report', color: 'text-slate-600', activeColor: 'text-orange-600 bg-orange-100' },
  { id: 'image' as const, icon: Image, label: 'Immagine', color: 'text-slate-600', activeColor: 'text-pink-600 bg-pink-100' },
]

export default function TeacherSupportChat() {
  const [messages, setMessages] = useState<Message[]>([])
  const [inputText, setInputText] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [defaultModel, setDefaultModel] = useState<string>(() => {
    return localStorage.getItem('teacher_default_model') || 'gpt-4o-mini'
  })
  const [selectedModel, setSelectedModel] = useState(defaultModel)
  const [showModelSelector, setShowModelSelector] = useState(false)
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [currentConversationId, setCurrentConversationId] = useState<string | null>(null)
  const [attachedFiles, setAttachedFiles] = useState<AttachedFile[]>([])
  const [showPublishModal, setShowPublishModal] = useState(false)
  const [publishData, setPublishData] = useState<{ type: 'quiz' | 'lesson' | 'exercise' | 'presentation', data: any } | null>(null)
  const [selectedSessionId, setSelectedSessionId] = useState<string>('')
  const [editingContent, setEditingContent] = useState<{ type: 'quiz' | 'lesson' | 'exercise' | 'presentation', data: any } | null>(null)
  const [agentMode, setAgentMode] = useState<AgentMode>('default')
  const [showHistory, setShowHistory] = useState(true) // Cronologia visibile per default
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  
  const handleModeChange = (modeId: AgentMode) => {
    setAgentMode(modeId)
  }

  // Fetch teacher's classes and sessions for publishing
  const { data: classesData } = useQuery({
    queryKey: ['teacher-classes'],
    queryFn: async () => {
      const classesRes = await teacherApi.getClasses()
      const classes = classesRes.data || []
      // Fetch sessions for each class
      const allSessions: { id: string; name: string; class_name: string }[] = []
      for (const cls of classes) {
        try {
          const sessionsRes = await teacherApi.getSessions(cls.id)
          const sessions = sessionsRes.data || []
          sessions.forEach((s: any) => {
            allSessions.push({
              id: s.id,
              name: s.title || s.name,
              class_name: cls.name
            })
          })
        } catch (e) {
          console.error('Error fetching sessions for class', cls.id, e)
        }
      }
      return allSessions
    },
  })

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // Load conversations from localStorage
  useEffect(() => {
    const saved = localStorage.getItem('teacher_support_conversations')
    if (saved) {
      try {
        const parsed = JSON.parse(saved)
        setConversations(parsed.map((c: Conversation) => ({
          ...c,
          createdAt: new Date(c.createdAt),
          messages: c.messages.map(m => ({ ...m, timestamp: new Date(m.timestamp) }))
        })))
      } catch (e) {
        console.error('Failed to parse conversations:', e)
      }
    }
  }, [])

  // Save conversations to localStorage
  useEffect(() => {
    if (conversations.length > 0) {
      localStorage.setItem('teacher_support_conversations', JSON.stringify(conversations))
    }
  }, [conversations])

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (!files) return

    const newFiles: AttachedFile[] = []
    Array.from(files).forEach(file => {
      const isImage = file.type.startsWith('image/')
      const attachedFile: AttachedFile = {
        file,
        type: isImage ? 'image' : 'document',
      }
      if (isImage) {
        attachedFile.preview = URL.createObjectURL(file)
      }
      newFiles.push(attachedFile)
    })
    setAttachedFiles(prev => [...prev, ...newFiles])
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
  }

  const removeFile = (index: number) => {
    setAttachedFiles(prev => {
      const newFiles = [...prev]
      if (newFiles[index].preview) {
        URL.revokeObjectURL(newFiles[index].preview!)
      }
      newFiles.splice(index, 1)
      return newFiles
    })
  }

  const handleSend = async () => {
    if ((!inputText.trim() && attachedFiles.length === 0) || isLoading) return

    const filesInfo = attachedFiles.length > 0
      ? ` [📎 ${attachedFiles.map(f => f.file.name).join(', ')}]`
      : ''

    // Add mode-specific prefix
    let messageContent = inputText.trim() || 'Analizza questi documenti'
    if (inputText.trim() && agentMode !== 'default') {
      const prefixes = {
        web_search: '🌐 RICERCA WEB:',
        presentation: '📊 CREA PRESENTAZIONE:',
        quiz: '❓ CREA QUIZ:',
        lesson: '📚 CREA LEZIONE:',
        report: '📈 GENERA REPORT:',
        image: '🎨 GENERA IMMAGINE:',
      }
      messageContent = `${prefixes[agentMode]} ${messageContent}`
    }

    const userMessage: Message = {
      id: `msg-${Date.now()}`,
      role: 'user',
      content: messageContent + filesInfo,
      timestamp: new Date()
    }

    setMessages(prev => [...prev, userMessage])
    setInputText('')
    setAgentMode('default') // Reset to default after sending
    setIsLoading(true)

    try {
      // Build history from previous messages
      const history = messages.map(m => ({
        role: m.role,
        content: m.content
      }))
      
      // Get provider from model list
      const modelInfo = AVAILABLE_MODELS.find(m => m.id === selectedModel)
      const provider = modelInfo?.provider || 'openai'
      
      // Call teacher chat endpoint with files if present
      const response = attachedFiles.length > 0
        ? await llmApi.teacherChatWithFiles(
            inputText.trim() || 'Analizza questi documenti',
            history,
            'teacher_support',
            provider,
            selectedModel,
            attachedFiles.map(f => f.file)
          )
        : await llmApi.teacherChat(
            userMessage.content,
            history,
            'teacher_support',
            provider,
            selectedModel
          )
      
      setAttachedFiles([])

      const assistantMessage: Message = {
        id: `msg-${Date.now()}`,
        role: 'assistant',
        content: response.data?.response || 'Mi dispiace, si è verificato un errore.',
        timestamp: new Date()
      }

      setMessages(prev => [...prev, assistantMessage])

      // Update or create local conversation for history
      if (currentConversationId) {
        setConversations(prev => prev.map(c => 
          c.id === currentConversationId 
            ? { ...c, messages: [...c.messages, userMessage, assistantMessage] }
            : c
        ))
      } else {
        const newConv: Conversation = {
          id: `conv-${Date.now()}`,
          title: userMessage.content.slice(0, 50) + (userMessage.content.length > 50 ? '...' : ''),
          messages: [userMessage, assistantMessage],
          createdAt: new Date()
        }
        setConversations(prev => [newConv, ...prev])
        setCurrentConversationId(newConv.id)
      }
    } catch (err) {
      console.error('Chat error:', err)
      const errorMessage: Message = {
        id: `msg-${Date.now()}`,
        role: 'assistant',
        content: 'Mi dispiace, si è verificato un errore nella comunicazione. Riprova.',
        timestamp: new Date()
      }
      setMessages(prev => [...prev, errorMessage])
    } finally {
      setIsLoading(false)
    }
  }

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  const exportChat = () => {
    const content = messages.map(m => 
      `[${m.role === 'user' ? 'Tu' : 'Assistente'}] ${m.content}`
    ).join('\n\n')
    
    const blob = new Blob([content], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `chat-supporto-${new Date().toISOString().split('T')[0]}.txt`
    a.click()
    URL.revokeObjectURL(url)
  }

  // Handle publish quiz - opens modal to select session
  // Publish handlers - open modal to select session
  const handlePublishQuiz = (quizData: any) => {
    setPublishData({ type: 'quiz', data: quizData })
    setShowPublishModal(true)
  }

  const handlePublishLesson = (lessonData: any) => {
    setPublishData({ type: 'lesson', data: lessonData })
    setShowPublishModal(true)
  }

  const handlePublishExercise = (exerciseData: any) => {
    setPublishData({ type: 'exercise', data: exerciseData })
    setShowPublishModal(true)
  }

  const handlePublishPresentation = (presentationData: any) => {
    setPublishData({ type: 'presentation', data: presentationData })
    setShowPublishModal(true)
  }

  // Set default model
  const handleSetDefaultModel = (modelId: string) => {
    setDefaultModel(modelId)
    localStorage.setItem('teacher_default_model', modelId)
  }

  // Edit handlers - open editor modal
  const handleEditQuiz = (quizData: any) => {
    setEditingContent({ type: 'quiz', data: quizData })
  }

  const handleEditLesson = (lessonData: any) => {
    setEditingContent({ type: 'lesson', data: lessonData })
  }

  const handleEditExercise = (exerciseData: any) => {
    setEditingContent({ type: 'exercise', data: exerciseData })
  }

  const handleEditPresentation = (presentationData: any) => {
    setEditingContent({ type: 'presentation', data: presentationData })
  }

  // Handle save from editor - goes to publish modal
  const handleSaveEdited = (edited: any) => {
    if (!editingContent) return
    setPublishData({ type: editingContent.type, data: edited })
    setEditingContent(null)
    setShowPublishModal(true)
  }

  // Confirm publish to selected session
  const confirmPublish = async () => {
    if (!publishData || !selectedSessionId) return

    try {
      const { type, data } = publishData
      const content_json = JSON.stringify({
        type,
        ...data
      })

      const taskTypeMap: Record<string, string> = {
        quiz: 'quiz',
        lesson: 'lesson',
        exercise: 'exercise',
        presentation: 'presentation'
      }

      const titleMap: Record<string, string> = {
        quiz: 'Quiz',
        lesson: 'Lezione',
        exercise: 'Esercizio',
        presentation: 'Presentazione'
      }

      await teacherApi.createTask(selectedSessionId, {
        title: data.title || titleMap[type],
        description: data.description || '',
        task_type: taskTypeMap[type],
        content_json,
      })

      setShowPublishModal(false)
      setPublishData(null)
      setSelectedSessionId('')
      alert(`${titleMap[type]} salvato come bozza! Vai nella sezione Compiti della sessione per pubblicarlo.`)
    } catch (err) {
      console.error('Publish error:', err)
      alert('Errore durante la pubblicazione. Riprova.')
    }
  }

  // Start a new conversation
  const handleNewConversation = () => {
    setMessages([])
    setCurrentConversationId(null)
  }

  // Load a conversation from history
  const handleLoadConversation = (conv: Conversation) => {
    setMessages(conv.messages)
    setCurrentConversationId(conv.id)
  }

  // Delete a conversation
  const handleDeleteConversation = (convId: string, e: React.MouseEvent) => {
    e.stopPropagation()
    setConversations(prev => prev.filter(c => c.id !== convId))
    if (currentConversationId === convId) {
      setMessages([])
      setCurrentConversationId(null)
    }
  }

  return (
    <>
      <TeacherNavbar />
      <div className="pt-16 h-screen flex bg-slate-50">
        {/* Sidebar Cronologia */}
        <aside className={`${showHistory ? 'w-72' : 'w-0'} transition-all duration-300 bg-white border-r flex flex-col overflow-hidden`}>
          <div className="p-4 border-b flex items-center justify-between">
            <div className="flex items-center gap-2">
              <History className="h-5 w-5 text-violet-600" />
              <span className="font-semibold text-slate-800">Cronologia</span>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleNewConversation}
              className="h-8 w-8 p-0"
              title="Nuova conversazione"
            >
              <PlusCircle className="h-4 w-4 text-violet-600" />
            </Button>
          </div>
          <div className="flex-1 overflow-y-auto p-2">
            {conversations.length === 0 ? (
              <p className="text-sm text-gray-400 text-center py-8">Nessuna conversazione</p>
            ) : (
              conversations.map((conv) => (
                <div
                  key={conv.id}
                  onClick={() => handleLoadConversation(conv)}
                  className={`p-3 rounded-lg cursor-pointer mb-2 group transition-colors ${
                    currentConversationId === conv.id
                      ? 'bg-violet-100 border border-violet-300'
                      : 'hover:bg-gray-100 border border-transparent'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-sm font-medium text-gray-800 truncate flex-1">
                      {conv.title}
                    </p>
                    <button
                      onClick={(e) => handleDeleteConversation(conv.id, e)}
                      className="opacity-0 group-hover:opacity-100 text-gray-400 hover:text-red-500 transition-opacity"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                  <p className="text-xs text-gray-500 mt-1">
                    {conv.createdAt.toLocaleDateString('it-IT')} - {conv.messages.length} messaggi
                  </p>
                </div>
              ))
            )}
          </div>
        </aside>

        {/* Toggle Sidebar Button */}
        <button
          onClick={() => setShowHistory(!showHistory)}
          className="absolute left-0 top-1/2 -translate-y-1/2 z-10 bg-white border rounded-r-lg p-1 shadow-sm hover:bg-gray-50"
          style={{ left: showHistory ? '18rem' : '0' }}
        >
          {showHistory ? <ChevronLeft className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </button>

        {/* Main Chat Area */}
        <div className="flex-1 flex flex-col p-4 max-w-4xl mx-auto">
          <Card className="h-full max-h-[calc(100vh-8rem)] flex flex-col">
            <CardHeader className="border-b py-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-lg flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center shadow-md">
                    <Bot className="h-5 w-5 text-white" />
                  </div>
                  <span className="bg-gradient-to-r from-violet-600 to-purple-600 bg-clip-text text-transparent font-bold">
                    Supporto Docente
                  </span>
                </CardTitle>
                <div className="flex items-center gap-2">
                  <div className="relative">
                <Button 
                  variant="outline" 
                  size="sm"
                  onClick={() => setShowModelSelector(!showModelSelector)}
                  className="flex items-center gap-1"
                >
                  <Settings className="h-4 w-4" />
                  {AVAILABLE_MODELS.find(m => m.id === selectedModel)?.name}
                  <ChevronDown className="h-3 w-3" />
                </Button>
                {showModelSelector && (
                  <div className="absolute right-0 top-full mt-1 bg-white border rounded-lg shadow-lg z-10 w-72">
                    {AVAILABLE_MODELS.map(model => (
                      <div
                        key={model.id}
                        className={`p-3 hover:bg-gray-50 flex items-center gap-3 ${
                          selectedModel === model.id ? 'bg-blue-50' : ''
                        }`}
                      >
                        <div
                          className="cursor-pointer"
                          onClick={() => { setSelectedModel(model.id); setShowModelSelector(false); }}
                        >
                          <div className={`flex-shrink-0 p-1.5 rounded ${
                            model.icon === 'openai' ? 'bg-emerald-100 text-emerald-700' :
                            model.icon === 'anthropic' ? 'bg-orange-100 text-orange-700' :
                            model.icon === 'mistral' ? 'bg-blue-100 text-blue-700' :
                            'bg-purple-100 text-purple-700'
                          }`}>
                            {MODEL_ICONS[model.icon]}
                          </div>
                        </div>
                        <div
                          className="flex-1 min-w-0 cursor-pointer"
                          onClick={() => { setSelectedModel(model.id); setShowModelSelector(false); }}
                        >
                          <p className="font-medium text-sm">{model.name}</p>
                          <p className="text-xs text-gray-500">{model.description}</p>
                        </div>
                        <div className="flex items-center gap-2">
                          {model.provider === 'ollama' && (
                            <span className="text-xs px-1.5 py-0.5 bg-gray-100 text-gray-600 rounded">locale</span>
                          )}
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleSetDefaultModel(model.id);
                            }}
                            title={defaultModel === model.id ? "Modello predefinito" : "Imposta come predefinito"}
                            className="p-1 hover:bg-gray-200 rounded"
                          >
                            <Star
                              className={`h-4 w-4 ${
                                defaultModel === model.id
                                  ? 'fill-yellow-400 text-yellow-400'
                                  : 'text-gray-400'
                              }`}
                            />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {messages.length > 0 && (
                <Button variant="ghost" size="sm" onClick={exportChat}>
                  <Download className="h-4 w-4" />
                </Button>
              )}
            </div>
          </div>
        </CardHeader>

        <CardContent className="flex-1 overflow-y-auto p-4">
          {messages.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center">
              <div className="text-center">
                <h2 className="text-2xl font-bold bg-gradient-to-r from-[#F43F7A] via-[#B87FC7] to-[#4AA3DF] bg-clip-text text-transparent animate-gradient bg-[length:200%_auto]">
                  Benvenuti in Golinelli AI Playground
                </h2>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              {messages.map(msg => (
                <div
                  key={msg.id}
                  className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'} gap-3`}
                >
                  {/* Assistant icon */}
                  {msg.role === 'assistant' && (
                    <div className="flex-shrink-0 w-8 h-8 rounded-lg bg-gradient-to-br from-violet-100 to-purple-100 flex items-center justify-center border border-violet-200">
                      <Bot className="h-4 w-4 text-violet-600" />
                    </div>
                  )}
                  <div
                    className={`max-w-[80%] px-4 py-3 ${
                      msg.role === 'user'
                        ? 'bg-gradient-to-br from-violet-500 to-purple-600 text-white rounded-2xl rounded-br-md shadow-md'
                        : 'bg-gradient-to-br from-violet-50 to-purple-50 text-gray-800 rounded-2xl rounded-bl-md border border-violet-100 shadow-sm'
                    }`}
                  >
                    {msg.role === 'assistant' ? (
                      <EnhancedMessage
                        content={msg.content}
                        isHistorical={false}
                        onPublishQuiz={handlePublishQuiz}
                        onPublishLesson={handlePublishLesson}
                        onPublishExercise={handlePublishExercise}
                        onPublishPresentation={handlePublishPresentation}
                        onEditQuiz={handleEditQuiz}
                        onEditLesson={handleEditLesson}
                        onEditExercise={handleEditExercise}
                        onEditPresentation={handleEditPresentation}
                      />
                    ) : (
                      <p className="whitespace-pre-wrap">{msg.content}</p>
                    )}
                    <p className={`text-xs mt-2 ${msg.role === 'user' ? 'text-violet-200' : 'text-violet-400'}`}>
                      {msg.timestamp.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })}
                    </p>
                  </div>
                </div>
              ))}
              {isLoading && (
                <div className="flex justify-start gap-3">
                  <div className="flex-shrink-0 w-8 h-8 rounded-lg bg-gradient-to-br from-violet-100 to-purple-100 flex items-center justify-center border border-violet-200">
                    <Bot className="h-4 w-4 text-violet-600" />
                  </div>
                  <div className="bg-gradient-to-br from-violet-50 to-purple-50 px-4 py-3 rounded-2xl rounded-bl-md border border-violet-100 shadow-sm">
                    <div className="flex gap-1">
                      <span className="w-2 h-2 bg-violet-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }}></span>
                      <span className="w-2 h-2 bg-violet-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }}></span>
                      <span className="w-2 h-2 bg-violet-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }}></span>
                    </div>
                  </div>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>
          )}
        </CardContent>

        <div className="p-4 border-t bg-white">
          {/* Agent Mode Selector */}
          <div className="flex items-center gap-2 mb-3 pb-3 border-b border-slate-100">
            <span className="text-xs text-slate-500 font-medium">Modalità:</span>
            <div className="flex gap-1">
              {AGENT_MODES.map((mode) => {
                const Icon = mode.icon
                const isActive = agentMode === mode.id
                return (
                  <button
                    key={mode.id}
                    onClick={() => handleModeChange(mode.id)}
                    disabled={isLoading}
                    className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all ${
                      isActive
                        ? `${mode.activeColor} shadow-sm`
                        : 'text-slate-500 hover:bg-slate-100'
                    }`}
                    title={mode.label}
                  >
                    <Icon className="h-3.5 w-3.5" />
                    <span className="hidden sm:inline">{mode.label}</span>
                  </button>
                )
              })}
            </div>
          </div>

          {/* Attached files preview */}
          {attachedFiles.length > 0 && (
            <div className="flex flex-wrap gap-2 mb-3">
              {attachedFiles.map((af, index) => (
                <div key={index} className="flex items-center gap-2 bg-violet-50 border border-violet-200 rounded-lg px-3 py-2">
                  {af.type === 'image' && af.preview ? (
                    <img src={af.preview} alt={af.file.name} className="h-8 w-8 object-cover rounded" />
                  ) : (
                    <File className="h-4 w-4 text-violet-500" />
                  )}
                  <span className="text-sm text-violet-700 max-w-[150px] truncate">{af.file.name}</span>
                  <button
                    onClick={() => removeFile(index)}
                    className="text-violet-400 hover:text-red-500"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              ))}
            </div>
          )}

          <div className="flex gap-3 items-end">
            <input
              type="file"
              ref={fileInputRef}
              onChange={handleFileSelect}
              multiple
              accept=".pdf,.doc,.docx,.txt,.md,.csv,.json,.png,.jpg,.jpeg,.gif"
              className="hidden"
            />
            <Button
              variant="ghost"
              size="icon"
              onClick={() => fileInputRef.current?.click()}
              disabled={isLoading}
              title="Allega documenti"
              className="h-12 w-12 rounded-xl hover:bg-violet-50"
            >
              <Paperclip className="h-5 w-5 text-violet-500" />
            </Button>
            <textarea
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              onKeyPress={handleKeyPress}
              placeholder={
                agentMode === 'web_search' ? "🌐 Cerca informazioni aggiornate online..." :
                agentMode === 'presentation' ? "📊 Descrivi l'argomento della presentazione..." :
                agentMode === 'quiz' ? "❓ Descrivi l'argomento del quiz..." :
                agentMode === 'lesson' ? "📚 Descrivi l'argomento della lezione..." :
                agentMode === 'report' ? "📈 Cosa vuoi analizzare?" :
                agentMode === 'image' ? "🎨 Descrivi l'immagine da generare..." :
                "Scrivi un messaggio o seleziona una modalità sopra..."
              }
              className="flex-1 px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm resize-none focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent"
              rows={1}
              disabled={isLoading}
              style={{ minHeight: '48px', maxHeight: '120px' }}
            />
            <Button
              onClick={handleSend}
              disabled={(!inputText.trim() && attachedFiles.length === 0) || isLoading}
              className="h-12 w-12 rounded-xl bg-gradient-to-br from-violet-500 to-purple-600 hover:from-violet-600 hover:to-purple-700 shadow-md"
            >
              {isLoading ? <Loader2 className="h-5 w-5 animate-spin" /> : <Send className="h-5 w-5" />}
            </Button>
          </div>
        </div>
      </Card>
        </div>
      </div>

      {/* Artifact Preview/Edit Modal */}
      {editingContent && (
        <ArtifactPreviewModal
          isOpen={!!editingContent}
          initialData={editingContent.data}
          artifactType={editingContent.type}
          onSave={handleSaveEdited}
          onClose={() => setEditingContent(null)}
        />
      )}

      {/* Publish Modal */}
      {showPublishModal && publishData && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-full max-w-md mx-4 shadow-xl">
            <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
              {publishData.type === 'quiz' ? (
                <>
                  <ClipboardList className="h-5 w-5 text-emerald-600" />
                  Pubblica Quiz
                </>
              ) : publishData.type === 'lesson' ? (
                <>
                  <BookOpen className="h-5 w-5 text-blue-600" />
                  Pubblica Lezione
                </>
              ) : publishData.type === 'presentation' ? (
                <>
                  <Presentation className="h-5 w-5 text-indigo-600" />
                  Pubblica Presentazione
                </>
              ) : (
                <>
                  <FileText className="h-5 w-5 text-purple-600" />
                  Pubblica Esercizio
                </>
              )}
            </h3>

            <div className="mb-4">
              <p className="text-sm text-gray-600 mb-2">
                <strong>Titolo:</strong> {publishData.data.title || 'Senza titolo'}
              </p>
              {publishData.data.description && (
                <p className="text-sm text-gray-600 mb-2">
                  <strong>Descrizione:</strong> {publishData.data.description}
                </p>
              )}
              {publishData.type === 'quiz' && publishData.data.questions && (
                <p className="text-sm text-gray-600">
                  <strong>Domande:</strong> {publishData.data.questions.length}
                </p>
              )}
              {publishData.type === 'presentation' && publishData.data.slides && (
                <p className="text-sm text-gray-600">
                  <strong>Slide:</strong> {publishData.data.slides.length}
                </p>
              )}
            </div>

            <div className="mb-4">
              <label className="block text-sm font-medium mb-2">
                Seleziona la sessione di destinazione:
              </label>
              <select
                value={selectedSessionId}
                onChange={(e) => setSelectedSessionId(e.target.value)}
                className="w-full p-2 border rounded-md text-sm"
              >
                <option value="">-- Seleziona sessione --</option>
                {classesData?.map((session: any) => (
                  <option key={session.id} value={session.id}>
                    {session.name} - {session.class_name}
                  </option>
                ))}
              </select>
            </div>

            <p className="text-xs text-gray-500 mb-4">
              💡 Il contenuto verrà salvato come bozza nella sezione Compiti della sessione selezionata.
              Potrai modificarlo e pubblicarlo quando vuoi.
            </p>

            <div className="flex gap-2 justify-end">
              <Button
                variant="outline"
                onClick={() => {
                  setShowPublishModal(false)
                  setPublishData(null)
                  setSelectedSessionId('')
                }}
              >
                Annulla
              </Button>
              <Button
                onClick={confirmPublish}
                disabled={!selectedSessionId}
                className={
                  publishData.type === 'quiz'
                    ? 'bg-emerald-600 hover:bg-emerald-700'
                    : publishData.type === 'lesson'
                    ? 'bg-blue-600 hover:bg-blue-700'
                    : publishData.type === 'presentation'
                    ? 'bg-indigo-600 hover:bg-indigo-700'
                    : 'bg-purple-600 hover:bg-purple-700'
                }
              >
                <Upload className="h-4 w-4 mr-1" />
                Salva come bozza
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
