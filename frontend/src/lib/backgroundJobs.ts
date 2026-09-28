import { useEffect, useState } from 'react'
import { getApiAuthHeaders, jobsApi, type BackgroundJob } from '@/lib/api'

/**
 * Long AI generations run as server-side background jobs: they keep going when the user changes
 * page or reloads. A page that starts one reads the same event stream as before; a page that
 * comes back later finds the running job and replays its stream from the start
 * (`/jobs/{id}/stream`), so its usual parser rebuilds the live state.
 */

export const JOBS_CHANGED_EVENT = 'background-jobs:changed'

/** Ask the navbar indicator to refresh right away (a job was started or finished). */
export function notifyJobsChanged() {
  window.dispatchEvent(new Event(JOBS_CHANGED_EVENT))
}

export type StreamFormat = 'sse' | 'ndjson'

/** Read an SSE (`data: {json}` frames) or NDJSON response, calling `onEvent` for each JSON object.
 *  Return `true` from `onEvent` to stop reading early. */
export async function readEventStream(
  response: Response,
  format: StreamFormat,
  onEvent: (event: any) => boolean | void,
): Promise<void> {
  if (!response.body) return
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  const separator = format === 'sse' ? '\n\n' : '\n'
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    let index: number
    while ((index = buffer.indexOf(separator)) >= 0) {
      const frame = buffer.slice(0, index)
      buffer = buffer.slice(index + separator.length)
      const text = format === 'sse'
        ? frame.split('\n').find((line) => line.startsWith('data: '))?.slice(6)
        : frame.trim()
      if (!text) continue
      let event: any
      try {
        event = JSON.parse(text)
      } catch {
        continue
      }
      if (onEvent(event) === true) {
        await reader.cancel().catch(() => undefined)
        return
      }
    }
  }
}

/** Open the replay stream of a running job (same format as the endpoint that started it). */
export function followJobStream(jobId: string, signal?: AbortSignal): Promise<Response> {
  return fetch(jobsApi.streamUrl(jobId), {
    credentials: 'include',
    headers: getApiAuthHeaders(),
    signal,
  })
}

/** The running job of `kind` for `resourceId`, if any. */
export async function findActiveJob(kind: string, resourceId?: string | null): Promise<BackgroundJob | null> {
  try {
    const res = await jobsApi.list({ kind, resource_id: resourceId || undefined, active: true })
    return res.data.find((job) => job.live) || null
  } catch {
    return null
  }
}

/** Poll a job until it ends (for jobs that don't stream, e.g. board backlog, Meshy). */
export async function waitForJob(
  jobId: string,
  onUpdate?: (job: BackgroundJob) => void,
  opts: { intervalMs?: number; signal?: AbortSignal } = {},
): Promise<BackgroundJob> {
  const interval = opts.intervalMs ?? 2000
  for (;;) {
    if (opts.signal?.aborted) throw new DOMException('Aborted', 'AbortError')
    const job = (await jobsApi.get(jobId)).data
    onUpdate?.(job)
    if (job.status !== 'running') return job
    await new Promise((resolve) => window.setTimeout(resolve, interval))
  }
}

/** Cancel a job (explicit "Stop" by the user; leaving the page never cancels). */
export async function cancelJob(jobId: string | null | undefined) {
  if (!jobId) return
  try {
    await jobsApi.cancel(jobId)
  } finally {
    notifyJobsChanged()
  }
}

/** Re-render every `ms` while `active` (for elapsed-time / estimated progress displays). */
export function useTicker(active: boolean, ms = 1000) {
  const [, setTick] = useState(0)
  useEffect(() => {
    if (!active) return
    const id = window.setInterval(() => setTick((value) => value + 1), ms)
    return () => window.clearInterval(id)
  }, [active, ms])
}
