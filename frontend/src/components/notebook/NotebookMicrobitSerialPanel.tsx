import { useCallback, useMemo, useRef, useState } from 'react'
import { Activity, Cable, Loader2, Play, Send, Terminal, Unplug, Zap } from 'lucide-react'

type SerialPortLike = {
  open: (options: { baudRate: number }) => Promise<void>
  close: () => Promise<void>
  readable?: ReadableStream<Uint8Array> | null
  writable?: WritableStream<Uint8Array> | null
}

type SerialNavigator = Navigator & {
  serial?: {
    requestPort: (options?: { filters?: Array<{ usbVendorId?: number; usbProductId?: number }> }) => Promise<SerialPortLike>
  }
}

type UsbDeviceLike = {
  productName?: string
  manufacturerName?: string
  vendorId?: number
  productId?: number
  opened?: boolean
  open: () => Promise<void>
  close: () => Promise<void>
}

type HidDeviceLike = {
  productName?: string
  vendorId?: number
  productId?: number
  opened?: boolean
  open: () => Promise<void>
  close: () => Promise<void>
}

type DeviceNavigator = SerialNavigator & {
  usb?: {
    requestDevice: (options: { filters: Array<{ vendorId?: number; productId?: number }> }) => Promise<UsbDeviceLike>
  }
  hid?: {
    requestDevice: (options: { filters: Array<{ vendorId?: number; productId?: number }> }) => Promise<HidDeviceLike[]>
  }
}

interface SerialLine {
  id: string
  text: string
  ts: number
}

function parseSerialValues(lines: SerialLine[]) {
  const values: Record<string, string> = {}
  const latest = lines.slice(-12)

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
      // Plain serial output is expected; fall through to key=value parsing.
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

function tempToColor(temp: number) {
  const t = clamp((temp - 18) / 18, 0, 1)
  const r = Math.round(40 + t * 215)
  const g = Math.round(160 - t * 110)
  const b = Math.round(220 - t * 180)
  return `rgb(${r}, ${g}, ${b})`
}

function looksLikeBootloader(name?: string) {
  const normalized = (name || '').toLowerCase()
  return normalized.includes('boot') || normalized.includes('cplayboot') || normalized.includes('daplink')
}

function DevicePreview({
  device,
  values,
  live,
  detected,
}: {
  device: 'microbit' | 'circuitplayground'
  values: Record<string, string>
  live: boolean
  detected: boolean
}) {
  const temp = numericValue(values, 'temp', 0)
  const luce = numericValue(values, 'luce', numericValue(values, 'light', 0))
  const movimento = numericValue(values, 'movimento', 0)
  const buttonA = numericValue(values, 'a', 0) > 0
  const buttonB = numericValue(values, 'b', 0) > 0
  const pixelColor = live ? tempToColor(temp || 22) : '#1f2937'
  const activePixels = live ? Math.max(1, Math.round(clamp((temp || 22) - 18, 0, 12) / 12 * 10)) : 0

  if (device === 'microbit') {
    const ledCount = live ? Math.max(3, Math.round(clamp(luce, 0, 255) / 255 * 25)) : 0
    return (
      <div className="border-b border-slate-200 bg-slate-900 p-4 text-white">
        <div className="mx-auto flex max-w-[280px] flex-col items-center">
          <div className="relative h-56 w-56 rounded-[28px] border border-slate-700 bg-slate-800 shadow-inner">
            <div className="absolute left-4 top-4 h-8 w-12 rounded-md bg-slate-950 ring-1 ring-slate-600" />
            <div className="absolute right-4 top-4 h-8 w-12 rounded-md bg-slate-950 ring-1 ring-slate-600" />
            <div className="absolute left-1/2 top-14 grid -translate-x-1/2 grid-cols-5 gap-2">
              {Array.from({ length: 25 }).map((_, index) => (
                <span
                  key={index}
                  className="h-3.5 w-3.5 rounded-full"
                  style={{ backgroundColor: index < ledCount ? '#facc15' : '#111827' }}
                />
              ))}
            </div>
            <div className={`absolute bottom-8 left-8 h-12 w-12 rounded-full border-4 ${buttonA ? 'border-sky-300 bg-sky-500' : 'border-slate-500 bg-slate-700'}`} />
            <div className={`absolute bottom-8 right-8 h-12 w-12 rounded-full border-4 ${buttonB ? 'border-sky-300 bg-sky-500' : 'border-slate-500 bg-slate-700'}`} />
          </div>
          <DeviceMetrics live={live} detected={detected} temp={temp} luce={luce} movimento={movimento} />
        </div>
      </div>
    )
  }

  return (
    <div className="border-b border-slate-200 bg-slate-900 p-4 text-white">
      <div className="mx-auto flex max-w-[300px] flex-col items-center">
        <div className="relative h-64 w-64 rounded-full border-[14px] border-slate-700 bg-slate-800 shadow-inner">
          {Array.from({ length: 10 }).map((_, index) => {
            const angle = (index / 10) * Math.PI * 2 - Math.PI / 2
            const x = 50 + Math.cos(angle) * 41
            const y = 50 + Math.sin(angle) * 41
            return (
              <span
                key={index}
                className="absolute h-5 w-5 -translate-x-1/2 -translate-y-1/2 rounded-full border border-slate-900"
                style={{
                  left: `${x}%`,
                  top: `${y}%`,
                  backgroundColor: index < activePixels ? pixelColor : '#111827',
                  boxShadow: index < activePixels ? `0 0 16px ${pixelColor}` : 'none',
                }}
              />
            )
          })}
          <div className="absolute left-1/2 top-8 h-10 w-16 -translate-x-1/2 rounded-b-lg bg-slate-950 ring-1 ring-slate-600" />
          <div className={`absolute left-14 top-1/2 h-12 w-12 -translate-y-1/2 rounded-full border-4 ${buttonA ? 'border-pink-300 bg-pink-500' : 'border-slate-500 bg-slate-700'}`} />
          <div className={`absolute right-14 top-1/2 h-12 w-12 -translate-y-1/2 rounded-full border-4 ${buttonB ? 'border-pink-300 bg-pink-500' : 'border-slate-500 bg-slate-700'}`} />
          <div className="absolute left-1/2 top-1/2 h-16 w-16 -translate-x-1/2 -translate-y-1/2 rounded-lg bg-slate-950 ring-1 ring-slate-600" />
          <div className="absolute bottom-10 left-1/2 h-8 w-12 -translate-x-1/2 rounded-t-lg bg-slate-950 ring-1 ring-slate-600" />
        </div>
        <DeviceMetrics live={live} detected={detected} temp={temp} luce={luce} movimento={movimento} />
      </div>
    </div>
  )
}

function DeviceMetrics({
  live,
  detected,
  temp,
  luce,
  movimento,
}: {
  live: boolean
  detected: boolean
  temp: number
  luce: number
  movimento: number
}) {
  return (
    <div className="mt-3 grid w-full grid-cols-3 gap-2 text-center">
      <div className="rounded-lg bg-white/10 px-2 py-2">
        <p className="text-[10px] font-bold uppercase text-slate-400">Temp</p>
        <p className="font-mono text-sm">{live ? `${temp || 0}` : '--'}</p>
      </div>
      <div className="rounded-lg bg-white/10 px-2 py-2">
        <p className="text-[10px] font-bold uppercase text-slate-400">Luce</p>
        <p className="font-mono text-sm">{live ? `${luce || 0}` : '--'}</p>
      </div>
      <div className="rounded-lg bg-white/10 px-2 py-2">
        <p className="text-[10px] font-bold uppercase text-slate-400">Mov.</p>
        <p className="font-mono text-sm">{live ? `${movimento || 0}` : '--'}</p>
      </div>
      <div className="col-span-3 rounded-lg bg-white/10 px-2 py-2 text-xs text-slate-300">
        {live ? 'Dati realtime attivi' : detected ? 'Scheda rilevata, dati in attesa' : 'Scheda non connessa'}
      </div>
    </div>
  )
}

interface Props {
  device?: 'microbit' | 'circuitplayground'
  source?: string
  onReplaceSource?: (source: string) => void
}

const MICROBIT_SENSOR_SCRIPT = `from microbit import *

# Questo programma legge temperatura, luce, accelerazione e pulsanti della micro:bit.
# Ogni mezzo secondo invia al browser una riga key=value facile da leggere nel cruscotto.
while True:
    temp = temperature()
    luce = display.read_light_level()
    x = accelerometer.get_x()
    y = accelerometer.get_y()
    z = accelerometer.get_z()
    a = 1 if button_a.is_pressed() else 0
    b = 1 if button_b.is_pressed() else 0

    print('temp=' + str(temp) + ' luce=' + str(luce) + ' x=' + str(x) + ' y=' + str(y) + ' z=' + str(z) + ' a=' + str(a) + ' b=' + str(b))

    if a:
        display.show('A')
    elif b:
        display.show('B')
    else:
        display.show(Image.HAPPY)

    sleep(500)
`

const CIRCUIT_PLAYGROUND_SENSOR_SCRIPT = `import time
from adafruit_circuitplayground import cp

# Questo programma legge i sensori onboard della Circuit Playground Express.
# Ogni mezzo secondo stampa una riga key=value: il cruscotto del browser la aggiorna in realtime.
cp.pixels.brightness = 0.2

while True:
    temp = cp.temperature
    luce = cp.light
    x, y, z = cp.acceleration
    movimento = abs(x) + abs(y) + abs(z)
    a = 1 if cp.button_a else 0
    b = 1 if cp.button_b else 0

    print(
        'temp=' + str(round(temp, 1)) +
        ' luce=' + str(luce) +
        ' x=' + str(round(x, 1)) +
        ' y=' + str(round(y, 1)) +
        ' z=' + str(round(z, 1)) +
        ' movimento=' + str(round(movimento, 1)) +
        ' a=' + str(a) +
        ' b=' + str(b)
    )

    # I NeoPixel danno un feedback immediato: rosa se la scheda si muove, verde se e stabile.
    if movimento > 15:
        cp.pixels.fill((255, 0, 80))
    else:
        cp.pixels.fill((0, 80, 40))

    time.sleep(0.5)
`

const DEVICE_COPY = {
  microbit: {
    label: 'micro:bit',
    connected: '[browser] micro:bit collegata',
    commandPlaceholder: 'Invia comando alla micro:bit',
    example: 'temp=22 light=120',
    usbVendorId: 0x0d28,
    sensorScript: MICROBIT_SENSOR_SCRIPT,
  },
  circuitplayground: {
    label: 'Circuit Playground Express',
    connected: '[browser] Circuit Playground Express collegata',
    commandPlaceholder: 'Invia comando alla Circuit Playground',
    example: 'temp=22 luce=120 movimento=3',
    usbVendorId: 0x239a,
    sensorScript: CIRCUIT_PLAYGROUND_SENSOR_SCRIPT,
  },
} as const

export default function NotebookMicrobitSerialPanel({ device = 'microbit', source = '', onReplaceSource }: Props) {
  const copy = DEVICE_COPY[device]
  const [status, setStatus] = useState<'idle' | 'connecting' | 'connected' | 'error'>('idle')
  const [bridgeStatus, setBridgeStatus] = useState<'idle' | 'connecting-usb' | 'connecting-hid' | 'connected-usb' | 'connected-hid' | 'error'>('idle')
  const [runStatus, setRunStatus] = useState<'idle' | 'running' | 'sent' | 'error'>('idle')
  const [error, setError] = useState<string | null>(null)
  const [bridgeMessage, setBridgeMessage] = useState<string | null>(null)
  const [runMessage, setRunMessage] = useState<string | null>(null)
  const [bootloaderDetected, setBootloaderDetected] = useState(false)
  const [lines, setLines] = useState<SerialLine[]>([])
  const [command, setCommand] = useState('')
  const [baudRate, setBaudRate] = useState(115200)
  const portRef = useRef<SerialPortLike | null>(null)
  const usbDeviceRef = useRef<UsbDeviceLike | null>(null)
  const hidDeviceRef = useRef<HidDeviceLike | null>(null)
  const readerRef = useRef<ReadableStreamDefaultReader<Uint8Array> | null>(null)
  const writerRef = useRef<WritableStreamDefaultWriter<Uint8Array> | null>(null)
  const keepReadingRef = useRef(false)

  const serialSupported = typeof navigator !== 'undefined' && !!(navigator as DeviceNavigator).serial
  const usbSupported = typeof navigator !== 'undefined' && !!(navigator as DeviceNavigator).usb
  const hidSupported = typeof navigator !== 'undefined' && !!(navigator as DeviceNavigator).hid
  const values = useMemo(() => parseSerialValues(lines), [lines])
  const dataLive = status === 'connected'
  const boardDetected = dataLive || bridgeStatus === 'connected-hid' || bridgeStatus === 'connected-usb'

  const appendLine = useCallback((text: string) => {
    setLines((prev) => [...prev.slice(-119), { id: `${Date.now()}-${Math.random()}`, text, ts: Date.now() }])
  }, [])

  const disconnect = useCallback(async () => {
    keepReadingRef.current = false
    try {
      await readerRef.current?.cancel()
    } catch {
      // Ignore cancellation failures while the port is already closing.
    }
    try {
      readerRef.current?.releaseLock()
    } catch {
      // Ignore release failures from already released locks.
    }
    try {
      writerRef.current?.releaseLock()
    } catch {
      // Ignore release failures from already released locks.
    }
    try {
      await portRef.current?.close()
    } catch {
      // The browser can throw if the device was unplugged first.
    }
    readerRef.current = null
    writerRef.current = null
    portRef.current = null
    setStatus('idle')
  }, [])

  const openSerialPort = useCallback(async (port: SerialPortLike) => {
    await port.open({ baudRate })
    portRef.current = port
    writerRef.current = port.writable?.getWriter() ?? null
    setStatus('connected')
    setBootloaderDetected(false)
    appendLine(copy.connected)

    if (!port.readable) return
    const reader = port.readable.getReader()
    readerRef.current = reader
    keepReadingRef.current = true
    const decoder = new TextDecoder()
    let buffer = ''

    void (async () => {
      try {
        while (keepReadingRef.current) {
          const { value, done } = await reader.read()
          if (done) break
          buffer += decoder.decode(value, { stream: true })
          const parts = buffer.split(/\r?\n/)
          buffer = parts.pop() ?? ''
          parts.map((part) => part.trim()).filter(Boolean).forEach(appendLine)
        }
      } catch (err) {
        if (keepReadingRef.current) {
          appendLine(`[browser] lettura seriale interrotta: ${err instanceof Error ? err.message : 'errore sconosciuto'}`)
        }
      }
    })()
  }, [appendLine, baudRate, copy.connected])

  const connectSerial = useCallback(async () => {
    if (!serialSupported) {
      setError('Web Serial non è disponibile in questo browser. Usa Chrome o Edge in HTTPS o localhost.')
      setStatus('error')
      return false
    }

    setStatus('connecting')
    setError(null)
    try {
      const port = await (navigator as DeviceNavigator).serial!.requestPort({
        filters: [{ usbVendorId: copy.usbVendorId }],
      })
      await openSerialPort(port)
      return true
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Connessione seriale non riuscita.')
      setStatus('error')
      await disconnect()
      return false
    }
  }, [copy.usbVendorId, disconnect, openSerialPort, serialSupported])

  const connectUsb = useCallback(async () => {
    if (!usbSupported) {
      setBridgeStatus('error')
      setBridgeMessage('WebUSB non è disponibile in questo browser. Usa Chrome o Edge desktop in HTTPS o localhost.')
      return false
    }

    setBridgeStatus('connecting-usb')
    setBridgeMessage(null)
    try {
      const selected = await (navigator as DeviceNavigator).usb!.requestDevice({
        filters: [{ vendorId: copy.usbVendorId }],
      })
      await selected.open()
      const productName = selected.productName || copy.label
      const bootloader = looksLikeBootloader(productName)
      usbDeviceRef.current = selected
      setBootloaderDetected(bootloader)
      setBridgeStatus('connected-usb')
      setBridgeMessage(
        bootloader
          ? `${productName} rilevata in bootloader. Il browser vede la scheda, ma non c'è ancora una REPL Python/JavaScript attiva: premi RESET una volta o ricollega la scheda per tornare al runtime.`
          : `${productName} rilevata via WebUSB. Per eseguire lo script serve anche la porta seriale dati del runtime.`
      )
      appendLine(`[browser] ${productName} rilevata via WebUSB${bootloader ? ' bootloader' : ''}`)
      return true
    } catch (err) {
      setBridgeStatus('error')
      setBridgeMessage(err instanceof Error ? err.message : 'Connessione WebUSB non riuscita.')
      return false
    }
  }, [appendLine, copy.label, copy.usbVendorId, usbSupported])

  const connectHid = useCallback(async () => {
    if (!hidSupported) {
      setBridgeStatus('error')
      setBridgeMessage('WebHID non è disponibile in questo browser. Usa Chrome o Edge desktop in HTTPS o localhost.')
      return false
    }

    setBridgeStatus('connecting-hid')
    setBridgeMessage(null)
    try {
      const devices = await (navigator as DeviceNavigator).hid!.requestDevice({
        filters: [{ vendorId: copy.usbVendorId }],
      })
      const selected = devices[0]
      if (!selected) {
        setBridgeStatus('idle')
        setBridgeMessage('Nessuna scheda selezionata.')
        return false
      }
      await selected.open()
      const productName = selected.productName || copy.label
      const bootloader = looksLikeBootloader(productName)
      hidDeviceRef.current = selected
      setBootloaderDetected(bootloader)
      setBridgeStatus('connected-hid')
      setBridgeMessage(
        bootloader
          ? `${productName} rilevata in bootloader. Il browser vede la scheda, ma non c'è ancora una REPL Python/JavaScript attiva: premi RESET una volta o ricollega la scheda per tornare al runtime.`
          : `${productName} rilevata via WebHID. Per eseguire lo script serve anche la porta seriale dati del runtime.`
      )
      appendLine(`[browser] ${productName} rilevata via WebHID${bootloader ? ' bootloader' : ''}`)
      return true
    } catch (err) {
      setBridgeStatus('error')
      setBridgeMessage(err instanceof Error ? err.message : 'Connessione WebHID non riuscita.')
      return false
    }
  }, [appendLine, copy.label, copy.usbVendorId, hidSupported])

  const disconnectBridge = useCallback(async () => {
    try {
      if (usbDeviceRef.current?.opened) await usbDeviceRef.current.close()
    } catch {
      // Ignore devices already closed or unplugged.
    }
    try {
      if (hidDeviceRef.current?.opened) await hidDeviceRef.current.close()
    } catch {
      // Ignore devices already closed or unplugged.
    }
    usbDeviceRef.current = null
    hidDeviceRef.current = null
    setBridgeStatus('idle')
    setBridgeMessage(null)
    setBootloaderDetected(false)
  }, [])

  const connectBoard = useCallback(async () => {
    setError(null)
    setBridgeMessage(null)
    setRunMessage(null)
    if (status === 'connected' || bridgeStatus === 'connected-hid' || bridgeStatus === 'connected-usb') {
      await disconnect()
      await disconnectBridge()
      return
    }

    const serialOk = await connectSerial()
    if (serialOk) return

    const hidOk = await connectHid()
    if (hidOk) return

    const usbOk = await connectUsb()
    if (usbOk) return

    setBridgeStatus('error')
    setBridgeMessage('Non riesco a riconoscere automaticamente la scheda. Controlla che sia collegata via USB dati e che nessun altro programma stia usando la porta.')
  }, [bridgeStatus, connectHid, connectSerial, connectUsb, disconnect, disconnectBridge, status])

  const sendCommand = useCallback(async () => {
    const text = command.trim()
    if (!text || !writerRef.current) return
    const encoded = new TextEncoder().encode(`${text}\n`)
    await writerRef.current.write(encoded)
    appendLine(`[browser -> ${copy.label}] ${text}`)
    setCommand('')
  }, [appendLine, command])

  const executeScript = useCallback(async () => {
    setRunStatus('running')
    setRunMessage(null)
    try {
      if (status !== 'connected' && (bridgeStatus === 'connected-hid' || bridgeStatus === 'connected-usb')) {
        throw new Error(
          bootloaderDetected
            ? 'La scheda è in bootloader: il browser la riconosce, ma non può eseguire il codice finché non torna al runtime Python/JavaScript. Premi RESET una volta o ricollega la scheda, poi usa Connetti scheda.'
            : 'La scheda è rilevata, ma manca la porta seriale del runtime. Ricollegala in modalità esecuzione e usa Connetti scheda.'
        )
      }

      let writer = writerRef.current
      if (!writer) {
        const serialOk = await connectSerial()
        if (!serialOk || !writerRef.current) {
          throw new Error('Apri la connessione seriale della scheda per eseguire direttamente lo script.')
        }
        writer = writerRef.current
      }

      const code = source?.trim() ? source : copy.sensorScript
      onReplaceSource?.(code)
      const payload = `\x03\x03\r\nexec(${JSON.stringify(code)})\r\n`
      await writer.write(new TextEncoder().encode(payload))
      setRunStatus('sent')
      setRunMessage("Script inviato alla scheda via REPL seriale. I valori dovrebbero comparire in realtime nel log e nell'anteprima.")
      appendLine('[browser] script inviato via seriale REPL')
    } catch (err) {
      setRunStatus('error')
      setRunMessage(err instanceof Error ? err.message : 'Esecuzione script non riuscita.')
    }
  }, [appendLine, bootloaderDetected, bridgeStatus, connectSerial, copy.sensorScript, onReplaceSource, source, status])

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="flex shrink-0 items-center gap-3 border-b border-slate-200 px-4 py-3">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-sky-100 text-sky-700">
          <Zap className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-extrabold text-slate-900">Cruscotto {copy.label}</p>
          <p className="truncate text-[11px] text-slate-500">Seriale dal dispositivo verso il browser</p>
        </div>
        <span className={`rounded-full px-2 py-1 text-[10px] font-bold uppercase ${
          dataLive ? 'bg-emerald-100 text-emerald-700' :
          boardDetected ? 'bg-sky-100 text-sky-700' :
          status === 'connecting' ? 'bg-amber-100 text-amber-700' :
          status === 'error' ? 'bg-red-100 text-red-700' :
          'bg-slate-100 text-slate-600'
        }`}>
          {dataLive ? 'live' : bootloaderDetected ? 'bootloader' : boardDetected ? 'rilevata' : status === 'connecting' || bridgeStatus.startsWith('connecting') ? 'connessione' : status === 'error' || bridgeStatus === 'error' ? 'errore' : 'offline'}
        </span>
      </div>

      <DevicePreview
        device={device}
        values={values}
        live={dataLive}
        detected={boardDetected}
      />

      <div className="shrink-0 border-b border-slate-200 bg-slate-50 px-4 py-3">
        <div className="mb-3 rounded-lg border border-slate-200 bg-white px-3 py-2">
          <p className="text-[11px] font-bold uppercase tracking-wide text-slate-500">Workflow scheda</p>
          <p className="mt-1 text-xs leading-5 text-slate-600">
            Connetti la scheda, poi esegui lo script: il codice dell'editor viene inviato direttamente alla REPL seriale. L'anteprima si aggiorna quando arrivano righe <span className="font-mono">key=value</span>.
          </p>
          {bootloaderDetected && (
            <p className="mt-2 rounded-md border border-amber-200 bg-amber-50 px-2 py-1.5 text-xs leading-5 text-amber-800">
              Modalità bootloader rilevata: la scheda è visibile al browser, ma non sta eseguendo codice. Premi RESET una volta o ricollegala per tornare al runtime, poi riconnettila.
            </p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-sky-200 bg-sky-50 p-2">
          <label className="flex items-center gap-1.5 text-xs font-semibold text-slate-500">
            Baud
            <select
              value={baudRate}
              disabled={status === 'connected' || status === 'connecting'}
              onChange={(event) => setBaudRate(Number(event.target.value))}
              className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs text-slate-700 outline-none"
            >
              <option value={115200}>115200</option>
              <option value={9600}>9600</option>
            </select>
          </label>
          <button
            onClick={() => void connectBoard()}
            disabled={status === 'connecting' || bridgeStatus === 'connecting-usb' || bridgeStatus === 'connecting-hid'}
            className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition disabled:opacity-50 ${
              status === 'connected' || bridgeStatus === 'connected-usb' || bridgeStatus === 'connected-hid'
                ? 'border border-red-200 bg-red-50 text-red-700 hover:bg-red-100'
                : 'bg-sky-600 text-white hover:bg-sky-500'
            }`}
          >
            {status === 'connecting' || bridgeStatus.startsWith('connecting')
              ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
              : status === 'connected' || bridgeStatus === 'connected-usb' || bridgeStatus === 'connected-hid'
                ? <Unplug className="h-3.5 w-3.5" />
                : <Cable className="h-3.5 w-3.5" />}
            {status === 'connected' || bridgeStatus === 'connected-usb' || bridgeStatus === 'connected-hid' ? 'Scollega' : 'Connetti scheda'}
          </button>
          <button
            onClick={() => void executeScript()}
            disabled={runStatus === 'running'}
            className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-emerald-500 disabled:opacity-50"
          >
            {runStatus === 'running' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
            Esegui script
          </button>
        </div>
        {!serialSupported && (
          <p className="mt-2 text-xs leading-5 text-amber-700">
            Web Serial non è supportato qui. Il cruscotto funziona in Chrome/Edge su HTTPS o localhost.
          </p>
        )}
        {!usbSupported && !hidSupported && (
          <p className="mt-2 text-xs leading-5 text-amber-700">
            WebUSB/WebHID non sono disponibili qui. Usa Chrome o Edge desktop; MakeCode usa questi canali per vedere molte schede anche quando non compare una porta seriale.
          </p>
        )}
        {error && <p className="mt-2 text-xs leading-5 text-red-600">{error}</p>}
        {runMessage && (
          <p className={`mt-2 text-xs leading-5 ${runStatus === 'error' ? 'text-red-600' : 'text-slate-600'}`}>
            {runMessage}
          </p>
        )}
        {bridgeMessage && (
          <p className={`mt-2 text-xs leading-5 ${bridgeStatus === 'error' ? 'text-red-600' : 'text-slate-600'}`}>
            {bridgeMessage}
          </p>
        )}
      </div>

      <div className="grid shrink-0 grid-cols-2 gap-2 border-b border-slate-200 p-3">
        {Object.keys(values).length > 0 ? (
          Object.entries(values).slice(0, 8).map(([key, value]) => (
            <div key={key} className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
              <p className="truncate text-[10px] font-bold uppercase tracking-wide text-slate-400">{key}</p>
              <p className="mt-1 truncate font-mono text-sm font-semibold text-slate-900">{value}</p>
            </div>
          ))
        ) : (
          <div className="col-span-2 rounded-lg border border-dashed border-slate-300 bg-slate-50 px-3 py-6 text-center">
            <Activity className="mx-auto h-5 w-5 text-slate-300" />
            <p className="mt-2 text-xs text-slate-500">
              Invia dalla scheda righe come <span className="font-mono">{copy.example}</span> o JSON.
            </p>
          </div>
        )}
      </div>

      <div className="flex min-h-0 flex-1 flex-col bg-slate-950">
        <div className="flex items-center gap-2 border-b border-slate-800 px-3 py-2">
          <Terminal className="h-3.5 w-3.5 text-slate-400" />
          <span className="text-xs font-semibold text-slate-400">Log seriale</span>
          <div className="flex-1" />
          {lines.length > 0 && (
            <button onClick={() => setLines([])} className="text-[10px] font-semibold text-slate-500 hover:text-slate-300">
              Pulisci
            </button>
          )}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2 font-mono text-xs">
          {lines.length === 0 ? (
            <p className="text-slate-600">Nessun dato ricevuto.</p>
          ) : (
            lines.map((line) => (
              <div key={line.id} className="flex gap-2 py-0.5 text-slate-300">
                <span className="shrink-0 text-slate-600">{new Date(line.ts).toLocaleTimeString()}</span>
                <span className="break-all">{line.text}</span>
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
            disabled={status !== 'connected'}
            placeholder={copy.commandPlaceholder}
            className="min-w-0 flex-1 rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 font-mono text-xs text-slate-100 outline-none placeholder:text-slate-600 disabled:opacity-50"
          />
          <button
            onClick={() => void sendCommand()}
            disabled={status !== 'connected' || !command.trim()}
            className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-sky-600 text-white transition hover:bg-sky-500 disabled:opacity-40"
            title="Invia comando"
          >
            <Send className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </div>
  )
}
