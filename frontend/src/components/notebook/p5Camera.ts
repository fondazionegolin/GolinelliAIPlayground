import { NOTEBOOK_LIBRARIES } from './notebookLibraries'

/** Does the sketch (code, libraries or attached ML models) use the webcam / microphone? */
export function p5NeedsCamera(files: { source: string }[], activeLibraries: string[], mlModels: unknown[] = []) {
  return mlModels.length > 0
    || files.some((file) => /createCapture|getUserMedia|GolinelliML|GolinelliAI\.media|mediaDevices/.test(file.source))
    || activeLibraries.some((id) => NOTEBOOK_LIBRARIES.find((l) => l.id === id)?.requiresCamera ?? false)
}

/** Stop the camera shared by the previews (it stays open across restarts so the browser never asks again). */
export function stopP5SharedCamera() {
  const w = window as unknown as { __golinelliCamCache?: Record<string, MediaStream> }
  Object.values(w.__golinelliCamCache ?? {}).forEach((stream) => stream.getTracks().forEach((t) => t.stop()))
  delete w.__golinelliCamCache
}
