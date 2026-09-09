import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Activity,
  Cable,
  CircleDot,
  Compass,
  Cpu,
  Loader2,
  Mic,
  Move3d,
  Send,
  Square,
  Sun,
  Terminal,
  Thermometer,
  Unplug,
  Upload,
  Zap,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  ConnectionStatus,
  createUniversalHexFlashDataSource,
  createWebUSBConnection,
  type MicrobitWebUSBConnection,
} from '@microbit/microbit-connection'
import { MicropythonFsHex, microbitBoardId } from '@microbit/microbit-fs'

interface SerialLine {
  id: string
  text: string
  kind: 'in' | 'out' | 'system'
  ts: number
}

const FIRMWARE_V1_URL = '/firmware/micropython-microbit-v1.hex'
const FIRMWARE_V2_URL = '/firmware/micropython-microbit-v2.hex'

// MicroPython per micro:bit V2: legge tutti i sensori di bordo e li invia al
// monitor seriale come righe key=value che il cruscotto aggiorna in tempo reale.
const MICROBIT_SENSOR_SCRIPT = `from microbit import *

# Cruscotto sensori micro:bit (MicroPython).
# Ogni 200 ms stampa una riga key=value: il browser la legge dal monitor seriale.
while True:
    print(
        "temp={t} light={l} compass={c} accx={x} accy={y} accz={z} sound={s} a={a} b={b}".format(
            t=temperature(),
            l=display.read_light_level(),
            c=compass.heading(),
            x=accelerometer.get_x(),
            y=accelerometer.get_y(),
            z=accelerometer.get_z(),
            s=microphone.sound_level(),
            a=1 if button_a.is_pressed() else 0,
            b=1 if button_b.is_pressed() else 0,
        )
    )
    sleep(200)
`

// Le risposte della REPL (banner, prompt) e i caratteri di controllo non devono
// sporcare il monitor: li ripuliamo prima di mostrare la riga.
function sanitizeLine(raw: string) {
  return raw.replace(/[\x00-\x08\x0b-\x1f]/g, '').trim()
}

function isReplNoise(text: string) {
  return (
    text === '' ||
    text === 'OK' ||
    text === '>' ||
    text === '>>>' ||
    text === '...' ||
    text.startsWith('raw REPL') ||
    text.startsWith('MicroPython') ||
    text === 'Type "help()" for more information.'
  )
}

// Cache dei firmware: vengono scaricati una sola volta per sessione.
let firmwareCache: { v1: string; v2: string } | null = null
async function loadFirmware() {
  if (firmwareCache) return firmwareCache
  const [v1, v2] = await Promise.all([
    fetch(FIRMWARE_V1_URL).then((r) => {
      if (!r.ok) throw new Error('Firmware micro:bit V1 non disponibile.')
      return r.text()
    }),
    fetch(FIRMWARE_V2_URL).then((r) => {
      if (!r.ok) throw new Error('Firmware micro:bit V2 non disponibile.')
      return r.text()
    }),
  ])
  firmwareCache = { v1, v2 }
  return firmwareCache
}

// Costruisce un Universal Hex MicroPython con il codice utente come main.py,
// così la scheda esegue lo script appena finito il flash.
async function buildHexWithCode(code: string) {
  const { v1, v2 } = await loadFirmware()
  const fs = new MicropythonFsHex([
    { hex: v1, boardId: microbitBoardId.V1 },
    { hex: v2, boardId: microbitBoardId.V2 },
  ])
  fs.write('main.py', code)
  return fs.getUniversalHex()
}

function parseSerialValues(lines: SerialLine[]) {
  const values: Record<string, string> = {}
  const latest = lines.filter((line) => line.kind === 'in').slice(-12)

  for (const line of latest) {
    const text = line.text.trim()
    if (!text) continue

    try {
      const parsed = JSON.parse(text) as unknown
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        Object.entries(parsed as Record<string, unknown>).forEach(([key, value]) => {
          values[key] = String(value)
        })
        continue
      }
    } catch {
      // Il formato key=value è il caso normale per le schede in aula.
    }

    text.split(/[,\s]+/).forEach((part) => {
      const match = part.match(/^([^:=]+)[:=](.+)$/)
      if (match) values[match[1]] = match[2]
    })
  }

  return values
}

function numericValue(values: Record<string, string>, key: string, fallback = 0) {
  const raw = values[key]
  if (raw === undefined) return fallback
  const parsed = Number(String(raw).replace(',', '.'))
  return Number.isFinite(parsed) ? parsed : fallback
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

function has(values: Record<string, string>, ...keys: string[]) {
  return keys.some((key) => values[key] !== undefined)
}

function SensorBar({ ratio, color }: { ratio: number; color: string }) {
  return (
    <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
      <div className="h-full rounded-full transition-all duration-300" style={{ width: `${clamp(ratio, 0, 1) * 100}%`, backgroundColor: color }} />
    </div>
  )
}

function SensorCard({
  icon,
  label,
  children,
}: {
  icon: React.ReactNode
  label: string
  children: React.ReactNode
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
      <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-slate-400">
        {icon}
        <span className="truncate">{label}</span>
      </div>
      {children}
    </div>
  )
}

function SensorDashboard({ values, live }: { values: Record<string, string>; live: boolean }) {
  const hasAny = Object.keys(values).length > 0

  const temp = numericValue(values, 'temp')
  const light = numericValue(values, 'light', numericValue(values, 'luce'))
  const compass = numericValue(values, 'compass')
  const sound = numericValue(values, 'sound')
  const accx = numericValue(values, 'accx', numericValue(values, 'x'))
  const accy = numericValue(values, 'accy', numericValue(values, 'y'))
  const accz = numericValue(values, 'accz', numericValue(values, 'z'))
  const buttonA = numericValue(values, 'a') > 0
  const buttonB = numericValue(values, 'b') > 0

  return (
    <div className="flex min-h-0 flex-[1.4] flex-col overflow-hidden bg-white">
      <div className="flex shrink-0 items-center gap-2 border-b border-slate-100 px-4 py-2">
        <Activity className={`h-3.5 w-3.5 ${live ? 'text-emerald-500' : 'text-slate-300'}`} />
        <span className="text-xs font-bold text-slate-700">Sensori di bordo</span>
        <span className={`ml-1 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${live ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
          {live ? 'realtime' : 'in attesa'}
        </span>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {!hasAny ? (
          <div className="flex h-full flex-col items-center justify-center rounded-xl border border-dashed border-slate-200 bg-slate-50 px-4 py-8 text-center">
            <Zap className="h-6 w-6 text-slate-300" />
            <p className="mt-3 max-w-xs text-xs leading-5 text-slate-500">
              Connetti la micro:bit e carica lo script dei sensori sulla scheda. Le righe <span className="font-mono">temp=…</span> stampate dalla micro:bit
              appariranno qui come valori in tempo reale.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-2.5">
            {has(values, 'temp') && (
              <SensorCard icon={<Thermometer className="h-3.5 w-3.5 text-orange-500" />} label="Temperatura">
                <p className="mt-1 font-mono text-2xl font-bold text-slate-900">{temp}<span className="ml-0.5 text-sm font-semibold text-slate-400">°C</span></p>
                <SensorBar ratio={(temp - 0) / 40} color="#f97316" />
              </SensorCard>
            )}

            {has(values, 'light', 'luce') && (
              <SensorCard icon={<Sun className="h-3.5 w-3.5 text-amber-500" />} label="Luce">
                <p className="mt-1 font-mono text-2xl font-bold text-slate-900">{light}<span className="ml-0.5 text-sm font-semibold text-slate-400">/255</span></p>
                <SensorBar ratio={light / 255} color="#f59e0b" />
              </SensorCard>
            )}

            {has(values, 'compass') && (
              <SensorCard icon={<Compass className="h-3.5 w-3.5 text-sky-500" />} label="Bussola">
                <p className="mt-1 font-mono text-2xl font-bold text-slate-900">{compass}<span className="ml-0.5 text-sm font-semibold text-slate-400">°</span></p>
                <SensorBar ratio={compass / 360} color="#0ea5e9" />
              </SensorCard>
            )}

            {has(values, 'sound') && (
              <SensorCard icon={<Mic className="h-3.5 w-3.5 text-rose-500" />} label="Microfono">
                <p className="mt-1 font-mono text-2xl font-bold text-slate-900">{sound}<span className="ml-0.5 text-sm font-semibold text-slate-400">/255</span></p>
                <SensorBar ratio={sound / 255} color="#f43f5e" />
              </SensorCard>
            )}

            {has(values, 'accx', 'accy', 'accz', 'x', 'y', 'z') && (
              <SensorCard icon={<Move3d className="h-3.5 w-3.5 text-violet-500" />} label="Accelerometro">
                <div className="mt-1.5 grid grid-cols-3 gap-1.5 text-center">
                  {([['X', accx], ['Y', accy], ['Z', accz]] as const).map(([axis, value]) => (
                    <div key={axis} className="rounded-lg bg-slate-50 px-1 py-1.5">
                      <p className="text-[9px] font-bold uppercase text-slate-400">{axis}</p>
                      <p className="font-mono text-sm font-semibold text-slate-900">{value}</p>
                    </div>
                  ))}
                </div>
              </SensorCard>
            )}

            {has(values, 'a', 'b') && (
              <SensorCard icon={<CircleDot className="h-3.5 w-3.5 text-emerald-500" />} label="Pulsanti">
                <div className="mt-1.5 grid grid-cols-2 gap-1.5 text-center">
                  {([['A', buttonA], ['B', buttonB]] as const).map(([name, pressed]) => (
                    <div key={name} className={`rounded-lg px-1 py-1.5 text-sm font-bold transition ${pressed ? 'bg-emerald-500 text-white' : 'bg-slate-50 text-slate-400'}`}>
                      {name}
                    </div>
                  ))}
                </div>
              </SensorCard>
            )}

            {/* Sensori non riconosciuti: li mostriamo comunque come valori grezzi. */}
            {Object.entries(values)
              .filter(([key]) => !['temp', 'light', 'luce', 'compass', 'sound', 'accx', 'accy', 'accz', 'x', 'y', 'z', 'a', 'b'].includes(key))
              .slice(0, 6)
              .map(([key, value]) => (
                <SensorCard key={key} icon={<Activity className="h-3.5 w-3.5 text-slate-400" />} label={key}>
                  <p className="mt-1 truncate font-mono text-lg font-bold text-slate-900">{value}</p>
                </SensorCard>
              ))}
          </div>
        )}
      </div>
    </div>
  )
}

interface Props {
  device?: 'microbit' | 'circuitplayground'
  source?: string
  onReplaceSource?: (source: string) => void
}

export default function NotebookMicrobitSerialPanel({ source = '', onReplaceSource }: Props) {
  const [status, setStatus] = useState<ConnectionStatus>(ConnectionStatus.SUPPORT_NOT_KNOWN)
  const [flashing, setFlashing] = useState(false)
  const [flashProgress, setFlashProgress] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [lines, setLines] = useState<SerialLine[]>([])
  const [command, setCommand] = useState('')
  const connectionRef = useRef<MicrobitWebUSBConnection | null>(null)
  const serialBufferRef = useRef('')
  const logRef = useRef<HTMLDivElement | null>(null)

  const usbSupported = typeof navigator !== 'undefined' && !!(navigator as Navigator & { usb?: unknown }).usb
  const values = useMemo(() => parseSerialValues(lines), [lines])
  const connected = status === ConnectionStatus.CONNECTED
  const connecting = status === ConnectionStatus.CONNECTING
  const dataLive = connected && lines.some((line) => line.kind === 'in')

  const appendLine = useCallback((text: string, kind: SerialLine['kind'] = 'in') => {
    setLines((prev) => [...prev.slice(-199), { id: `${Date.now()}-${Math.random()}`, text, kind, ts: Date.now() }])
  }, [])

  useEffect(() => {
    const el = logRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [lines])

  // Crea la connessione WebUSB una sola volta e collega gli eventi seriali/stato.
  useEffect(() => {
    if (!usbSupported) {
      setStatus(ConnectionStatus.NOT_SUPPORTED)
      return
    }

    const connection = createWebUSBConnection()
    connectionRef.current = connection

    const handleSerial = (event: Event) => {
      const data = (event as Event & { data?: string }).data ?? ''
      serialBufferRef.current += data
      const parts = serialBufferRef.current.split(/\r?\n/)
      serialBufferRef.current = parts.pop() ?? ''
      for (const part of parts) {
        const clean = sanitizeLine(part)
        if (!isReplNoise(clean)) appendLine(clean, 'in')
      }
    }
    const handleStatus = (event: Event) => {
      setStatus((event as Event & { status: ConnectionStatus }).status)
    }

    connection.addEventListener('serialdata', handleSerial)
    connection.addEventListener('status', handleStatus)

    void connection.initialize().then(() => {
      setStatus(connection.status)
    })

    return () => {
      connection.removeEventListener('serialdata', handleSerial)
      connection.removeEventListener('status', handleStatus)
      connection.dispose()
      connectionRef.current = null
    }
  }, [appendLine, usbSupported])

  const connect = useCallback(async () => {
    const connection = connectionRef.current
    if (!connection) return
    if (connected) {
      await connection.disconnect()
      appendLine('micro:bit scollegata', 'system')
      return
    }
    setError(null)
    setMessage(null)
    try {
      await connection.connect()
      const version = connection.getBoardVersion()
      appendLine(`micro:bit collegata via WebUSB${version ? ` (${version})` : ''}`, 'system')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Connessione WebUSB non riuscita. Controlla il cavo dati USB.')
    }
  }, [appendLine, connected])

  // Compila il codice nel firmware MicroPython e lo flasha sulla scheda via
  // WebUSB/DAPLink. È il modo affidabile per far girare lo script sulla micro:bit.
  const flashScript = useCallback(async () => {
    const connection = connectionRef.current
    if (!connection) return
    if (!usbSupported) {
      setError('WebUSB non è disponibile in questo browser. Usa Chrome o Edge desktop su HTTPS o localhost.')
      return
    }

    setFlashing(true)
    setFlashProgress(0)
    setError(null)
    setMessage('Preparo il firmware MicroPython con il tuo codice…')
    try {
      const code = source.trim() ? source : MICROBIT_SENSOR_SCRIPT
      if (!source.trim()) onReplaceSource?.(code)

      const universalHex = await buildHexWithCode(code)
      setMessage('Carico il firmware sulla micro:bit via WebUSB…')

      await connection.flash(createUniversalHexFlashDataSource(universalHex), {
        partial: true,
        progress: (percentage: number | undefined) => {
          setFlashProgress(percentage == null ? null : Math.round(percentage * 100))
        },
      })

      setFlashProgress(null)
      setMessage('Firmware caricato. La micro:bit esegue il codice: i sensori compaiono nel cruscotto e nel monitor seriale.')
      appendLine('firmware MicroPython caricato sulla scheda', 'system')
    } catch (err) {
      setFlashProgress(null)
      setError(err instanceof Error ? err.message : 'Caricamento del firmware non riuscito.')
    } finally {
      setFlashing(false)
    }
  }, [appendLine, onReplaceSource, source, usbSupported])

  const stopScript = useCallback(async () => {
    const connection = connectionRef.current
    if (!connection || !connected) return
    try {
      await connection.serialWrite('\r\x03') // Ctrl-C: interrompe il programma ed entra nella REPL
      appendLine('programma interrotto (Ctrl-C)', 'system')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Impossibile interrompere il programma.')
    }
  }, [appendLine, connected])

  const loadSensorScript = useCallback(() => {
    onReplaceSource?.(MICROBIT_SENSOR_SCRIPT)
    setMessage('Script dei sensori caricato nell\'editor. Premi "Carica sulla scheda" per flashare la micro:bit.')
  }, [onReplaceSource])

  const sendCommand = useCallback(async () => {
    const connection = connectionRef.current
    const text = command.trim()
    if (!text || !connection || !connected) return
    await connection.serialWrite(`${text}\r\n`)
    appendLine(text, 'out')
    setCommand('')
  }, [appendLine, command, connected])

  const statusDot =
    dataLive ? 'bg-emerald-500' :
    connected ? 'bg-[var(--logo-blue)]' :
    connecting ? 'bg-amber-400' :
    error ? 'bg-[var(--logo-pink)]' :
    'bg-slate-300'
  const statusLabel =
    dataLive ? 'live' : connected ? 'connessa' : connecting ? 'connessione' : flashing ? 'flashing' : error ? 'errore' : 'offline'

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden border-0 bg-white shadow-none">
      {/* Toolbar unica: identità scheda, stato e azioni */}
      <div className="flex shrink-0 flex-wrap items-center gap-x-2 gap-y-1.5 border-b border-[var(--border-subtle)] bg-white px-3 py-2">
        <Cpu className="h-4 w-4 text-[var(--logo-blue-strong)]" />
        <span className="text-xs font-bold text-[var(--text-primary)]">micro:bit</span>
        <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide text-[var(--text-secondary)]">
          <span className={`h-1.5 w-1.5 rounded-full ${statusDot}`} />
          {statusLabel}
        </span>

        <div className="flex flex-wrap items-center gap-1.5">
          <Button
            density="compact"
            tone={connected ? 'danger' : 'neutral'}
            surface={connected ? 'soft' : 'solid'}
            className="h-8 px-2 text-[11px]"
            onClick={() => void connect()}
            disabled={connecting || flashing || status === ConnectionStatus.NOT_SUPPORTED}
          >
            {connecting ? <Loader2 className="animate-spin" /> : connected ? <Unplug /> : <Cable />}
            {connected ? 'Scollega' : 'Connetti'}
          </Button>
          <Button
            density="compact"
            tone="accent"
            surface="solid"
            className="h-8 px-2 text-[11px]"
            onClick={() => void flashScript()}
            disabled={flashing || connecting}
          >
            {flashing ? <Loader2 className="animate-spin" /> : <Upload />}
            {flashing ? (flashProgress == null ? 'Carico…' : `${flashProgress}%`) : 'Carica'}
          </Button>
          <Button
            density="compact"
            tone="neutral"
            surface="soft"
            className="h-8 px-2 text-[11px]"
            onClick={() => void stopScript()}
            disabled={!connected || flashing}
          >
            <Square />
            Stop
          </Button>
          <Button density="compact" tone="neutral" surface="ghost" className="h-8 px-2 text-[11px]" onClick={loadSensorScript}>
            Sensori
          </Button>
        </div>
      </div>

      {flashing && flashProgress != null && (
        <div className="h-0.5 shrink-0 w-full bg-[var(--surface-base)]">
          <div className="h-full bg-[var(--logo-blue-strong)] transition-all duration-200" style={{ width: `${flashProgress}%` }} />
        </div>
      )}

      {status === ConnectionStatus.NOT_SUPPORTED && (
        <p className="shrink-0 border-b border-[var(--border-subtle)] bg-white px-3 py-1.5 text-[11px] leading-4 text-amber-600">
          WebUSB non è supportato qui. Il flash della micro:bit funziona in Chrome/Edge desktop su HTTPS o localhost.
        </p>
      )}
      {error && <p className="shrink-0 border-b border-[var(--border-subtle)] bg-white px-3 py-1.5 text-[11px] leading-4 text-[var(--logo-pink)]">{error}</p>}
      {message && !error && <p className="shrink-0 border-b border-[var(--border-subtle)] bg-white px-3 py-1.5 text-[11px] leading-4 text-[var(--text-secondary)]">{message}</p>}

      {/* In alto: cruscotto sensori (pagina bianca) */}
      <SensorDashboard values={values} live={dataLive} />

      {/* In basso: monitor seriale */}
      <div className="flex min-h-0 flex-1 flex-col border-t border-slate-200 bg-slate-950">
        <div className="flex shrink-0 items-center gap-2 border-b border-slate-800 px-3 py-2">
          <Terminal className="h-3.5 w-3.5 text-slate-400" />
          <span className="text-xs font-semibold text-slate-400">Monitor seriale</span>
          <div className="flex-1" />
          {lines.length > 0 && (
            <button onClick={() => setLines([])} className="text-[10px] font-semibold text-slate-500 hover:text-slate-300">
              Pulisci
            </button>
          )}
        </div>
        <div ref={logRef} className="min-h-0 flex-1 overflow-y-auto px-3 py-2 font-mono text-xs">
          {lines.length === 0 ? (
            <p className="text-slate-600">Nessun dato ricevuto.</p>
          ) : (
            lines.map((line) => (
              <div key={line.id} className="flex gap-2 py-0.5">
                <span className="shrink-0 text-slate-600">{new Date(line.ts).toLocaleTimeString()}</span>
                <span className={`break-all ${
                  line.kind === 'out' ? 'text-sky-300' : line.kind === 'system' ? 'text-slate-500' : 'text-slate-200'
                }`}>
                  {line.kind === 'out' ? '» ' : ''}{line.text}
                </span>
              </div>
            ))
          )}
        </div>
        <div className="flex shrink-0 gap-2 border-t border-slate-800 p-2">
          <input
            value={command}
            onChange={(event) => setCommand(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') void sendCommand()
            }}
            disabled={!connected}
            placeholder="Invia un comando alla micro:bit (REPL)"
            className="min-w-0 flex-1 rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 font-mono text-xs text-slate-100 outline-none placeholder:text-slate-600 disabled:opacity-50"
          />
          <button
            onClick={() => void sendCommand()}
            disabled={!connected || !command.trim()}
            className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-white/10 text-white transition hover:bg-white/20 disabled:opacity-40"
            title="Invia comando"
          >
            <Send className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </div>
  )
}
