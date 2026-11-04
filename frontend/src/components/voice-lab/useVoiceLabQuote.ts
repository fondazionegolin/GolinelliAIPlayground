import { useEffect, useState } from 'react'
import { voiceLabApi, type LabQuote } from '@/lib/voiceLab'
import { tl } from '@/i18n/tl'

export function useVoiceLabQuote({ tool, text, dialogue, model, seconds, file, previewText, enabled = true }: {
  tool: string; text: string; dialogue: { text: string }[]; model: string; seconds: number; file: File | null; previewText: string; enabled?: boolean
}) {
  const [result, setResult] = useState<{ data?: LabQuote; loading: boolean; error?: string }>({ loading: false })
  const characters = tool === 'dialogue' ? dialogue.reduce((n, row) => n + row.text.length, 0) : tool === 'design' ? 3 * (previewText.length || 1000) : text.length
  const fileTool = ['convert', 'transcribe', 'isolate', 'alignment', 'dubbing'].includes(tool)
  const signature = `${tool}:${characters}:${seconds}:${model}`
  const [completed, setCompleted] = useState('')
  const [completedFile, setCompletedFile] = useState<File | null>(null)
  useEffect(() => {
    const controller = new AbortController()
    let objectUrl = ''
    let timer: ReturnType<typeof setTimeout>
    const disabled = !enabled || ['voices', 'library', 'playlists', 'clone'].includes(tool)
      || (['tts', 'music', 'sound_effects'].includes(tool) && !text.trim())
    setResult({ loading: !disabled }); setCompleted('')
    const request = (duration: number) => {
      timer = setTimeout(() => {
        voiceLabApi.quote({ action: tool === 'design' ? 'voice_design' : tool, characters, seconds: duration, model }, controller.signal)
          .then(({ data }) => { if (!controller.signal.aborted) { setResult({ data, loading: false }); setCompleted(signature); setCompletedFile(file) } })
          .catch(() => { if (!controller.signal.aborted) setResult({ loading: false, error: tl('Impossibile calcolare i crediti. Verifica i dati e riprova.') }) })
      }, 450)
    }
    let audio: HTMLAudioElement | undefined
    if (!disabled) {
      if (fileTool) {
        if (file) {
          audio = new Audio(); audio.preload = 'metadata'; objectUrl = URL.createObjectURL(file)
          audio.onloadedmetadata = () => {
            if (controller.signal.aborted) return
            const duration = audio!.duration
            if (Number.isFinite(duration) && duration > 0 && duration <= 10800) request(duration)
            else setResult({ loading: false, error: tl('Durata del file non leggibile. Usa un audio supportato, fino a 3 ore.') })
          }
          audio.onerror = () => { if (!controller.signal.aborted) setResult({ loading: false, error: tl('Impossibile leggere questo audio. Prova un altro formato.') }) }
          audio.src = objectUrl
        } else setResult({ loading: false })
      } else if (Number.isFinite(seconds) && seconds > 0) request(seconds)
      else setResult({ loading: false })
    }
    return () => { controller.abort(); clearTimeout(timer); if (audio) { audio.onloadedmetadata = null; audio.onerror = null; audio.removeAttribute('src'); audio.load() } if (objectUrl) URL.revokeObjectURL(objectUrl) }
  }, [tool, characters, model, seconds, file, fileTool, signature, enabled, text])
  const current = completed === signature && completedFile === file
  return { ...result, data: current ? result.data : undefined, loading: result.loading || (!!result.data && !current) }
}
