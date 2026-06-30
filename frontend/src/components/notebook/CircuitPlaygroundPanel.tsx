import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Activity, AlertTriangle, Cable, CheckCircle2, Download, Loader2, Play, Send, Terminal, Unplug, Zap } from 'lucide-react'
import { hardwareApi, type CircuitPlaygroundCompileResult } from '@/lib/api'

type SerialPortLike = {
  open: (options: { baudRate: number }) => Promise<void>
  close: () => Promise<void>
  getInfo?: () => { usbVendorId?: number; usbProductId?: number }
  readable?: ReadableStream<Uint8Array> | null
  writable?: WritableStream<Uint8Array> | null
}

type SerialNavigator = Navigator & {
  serial?: EventTarget & {
    requestPort: (options?: { filters?: Array<{ usbVendorId?: number; usbProductId?: number }> }) => Promise<SerialPortLike>
    getPorts?: () => Promise<SerialPortLike[]>
  }
}

type UsbDeviceLike = {
  productName?: string
  manufacturerName?: string
  serialNumber?: string
  vendorId?: number
  productId?: number
  opened?: boolean
  configuration?: UsbConfigurationLike | null
  configurations?: UsbConfigurationLike[]
  open: () => Promise<void>
  close: () => Promise<void>
  selectConfiguration: (configurationValue: number) => Promise<void>
  claimInterface: (interfaceNumber: number) => Promise<void>
  releaseInterface?: (interfaceNumber: number) => Promise<void>
  transferIn?: (endpointNumber: number, length: number) => Promise<{ status: string; data?: DataView }>
  transferOut?: (endpointNumber: number, data: Uint8Array) => Promise<{ status: string; bytesWritten?: number }>
  controlTransferIn?: (setup: UsbControlTransferLike, length: number) => Promise<{ status: string; data?: DataView }>
  controlTransferOut?: (setup: UsbControlTransferLike, data: Uint8Array) => Promise<{ status: string; bytesWritten?: number }>
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
    requestDevice: (options: { filters: UsbDeviceFilterLike[] }) => Promise<UsbDeviceLike>
    getDevices?: () => Promise<UsbDeviceLike[]>
  }
  hid?: {
    requestDevice: (options: { filters: Array<{ vendorId?: number; productId?: number }> }) => Promise<HidDeviceLike[]>
  }
}

type UsbDeviceFilterLike = {
  vendorId?: number
  productId?: number
  classCode?: number
  subclassCode?: number
  protocolCode?: number
}

type UsbControlTransferLike = {
  requestType: 'class' | 'standard' | 'vendor'
  recipient: 'device' | 'interface' | 'endpoint' | 'other'
  request: number
  value: number
  index: number
}

type UsbConfigurationLike = {
  configurationValue?: number
  interfaces: UsbInterfaceLike[]
}

type UsbInterfaceLike = {
  interfaceNumber: number
  alternates: UsbAlternateInterfaceLike[]
}

type UsbAlternateInterfaceLike = {
  alternateSetting?: number
  interfaceClass: number
  interfaceSubclass: number
  interfaceProtocol: number
  endpoints: UsbEndpointLike[]
}

type UsbEndpointLike = {
  endpointNumber: number
  direction: 'in' | 'out'
  packetSize: number
}

interface Uf2Block {
  targetAddr: number
  payloadSize: number
  data: Uint8Array
}

type ConnectionState = 'idle' | 'auto-detected' | 'connecting' | 'serial-ready' | 'bootloader' | 'detected-no-serial' | 'error'

interface SerialLine {
  id: string
  text: string
  ts: number
}

interface Props {
  source?: string
  onReplaceSource?: (source: string) => void
}

const ADAFRUIT_USB_VENDOR_ID = 0x239a
const HF2_CMD_BININFO = 0x0001
const HF2_CMD_RESET_INTO_APP = 0x0003
const HF2_CMD_RESET_INTO_BOOTLOADER = 0x0004
const HF2_CMD_START_FLASH = 0x0005
const HF2_CMD_WRITE_FLASH_PAGE = 0x0006
const HF2_MODE_BOOTLOADER = 0x01
const HF2_FLAG_CMDPKT_LAST = 0x40
const HF2_FLAG_SERIAL_OUT = 0x80
const HF2_FLAG_SERIAL_ERR = 0xc0
const HF2_FLAG_MASK = 0xc0
const HF2_STATUS_OK = 0
const USB_CONTROL_GET_REPORT = 0x01
const USB_CONTROL_SET_REPORT = 0x09
const USB_CONTROL_IN_REPORT = 0x100
const USB_CONTROL_OUT_REPORT = 0x200

const MAKECODE_SENSOR_SCRIPT = `// Questo programma legge sensori onboard della Circuit Playground Express.
// Serve per inviare dati reali al cruscotto seriale del browser.
let temp = 0
let luce = 0

forever(function () {
  // Leggiamo temperatura e luce: sono valori fisici rilevati dalla scheda.
  temp = input.temperature(TemperatureUnit.Celsius)
  luce = input.lightLevel()

  // Scriviamo una riga key=value: il browser la trasforma in valori nel cruscotto.
  serial.writeLine("temp=" + temp + " luce=" + luce)

  // I NeoPixel danno un feedback visivo: blu se fa fresco, rosso se fa caldo.
  if (temp > 28) {
    light.setAll(0xff0040)
  } else {
    light.setAll(0x0066ff)
  }

  pause(500)
})
`

function looksLikeCircuitPythonSource(code: string) {
  return /\bfrom\s+adafruit_circuitplayground\b|\bimport\s+time\b|\bwhile\s+True\s*:/.test(code)
}

// Il tutor a volte lascia i recinti markdown (```typescript ... ```) dentro la cella:
// quei backtick fanno fallire la build con TS1128. Li rimuoviamo prima di compilare.
function stripCodeFences(code: string) {
  return code
    .replace(/^﻿/, '')
    .split(/\r?\n/)
    .filter((line) => !/^\s*```/.test(line))
    .join('\n')
    .trim()
}

function downloadUf2(firmware: CircuitPlaygroundCompileResult) {
  const bytes = Uint8Array.from(atob(firmware.uf2_base64), (char) => char.charCodeAt(0))
  const blob = new Blob([bytes], { type: firmware.mime_type || 'application/octet-stream' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = firmware.filename || 'circuit-playground-express.uf2'
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}

function base64ToBytes(value: string) {
  return Uint8Array.from(atob(value), (char) => char.charCodeAt(0))
}

function delay(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms))
}

function read32(bytes: Uint8Array, offset: number) {
  return ((bytes[offset] || 0) |
    ((bytes[offset + 1] || 0) << 8) |
    ((bytes[offset + 2] || 0) << 16) |
    ((bytes[offset + 3] || 0) << 24)) >>> 0
}

function write16(bytes: Uint8Array, offset: number, value: number) {
  bytes[offset] = value & 0xff
  bytes[offset + 1] = (value >>> 8) & 0xff
}

function write32(bytes: Uint8Array, offset: number, value: number) {
  bytes[offset] = value & 0xff
  bytes[offset + 1] = (value >>> 8) & 0xff
  bytes[offset + 2] = (value >>> 16) & 0xff
  bytes[offset + 3] = (value >>> 24) & 0xff
}

function parseUf2Blocks(firmware: CircuitPlaygroundCompileResult): Uf2Block[] {
  const bytes = base64ToBytes(firmware.uf2_base64)
  const blocks: Uf2Block[] = []
  for (let offset = 0; offset + 512 <= bytes.length; offset += 512) {
    const block = bytes.slice(offset, offset + 512)
    if (read32(block, 0) !== 0x0a324655 || read32(block, 4) !== 0x9e5d5157 || read32(block, 508) !== 0x0ab16f30) {
      continue
    }
    const payloadSize = read32(block, 16)
    if (!payloadSize || payloadSize > 476) continue
    blocks.push({
      targetAddr: read32(block, 12),
      payloadSize,
      data: block.slice(32, 32 + payloadSize),
    })
  }
  if (!blocks.length) throw new Error('Il firmware UF2 compilato non contiene blocchi flash validi.')
  return blocks
}

function usbFilters(): UsbDeviceFilterLike[] {
  return [
    { vendorId: ADAFRUIT_USB_VENDOR_ID },
    { classCode: 255, subclassCode: 42 },
  ]
}

async function requestAdafruitUsbDevice(): Promise<UsbDeviceLike> {
  const usb = (navigator as DeviceNavigator).usb
  if (!usb) throw new Error('WebUSB non e disponibile. Usa Chrome o Edge desktop su HTTPS o localhost.')
  const authorized = await usb.getDevices?.()
  const existing = authorized?.find((device) => device.vendorId === ADAFRUIT_USB_VENDOR_ID || device.productName?.toLowerCase().includes('circuit playground'))
  if (existing) return existing as unknown as UsbDeviceLike
  return (await usb.requestDevice({ filters: usbFilters() })) as unknown as UsbDeviceLike
}

async function waitForAuthorizedAdafruitUsbDevice(previousSerial?: string): Promise<UsbDeviceLike | null> {
  const usb = (navigator as DeviceNavigator).usb
  if (!usb?.getDevices) return null
  for (let attempt = 0; attempt < 24; attempt += 1) {
    const devices = await usb.getDevices()
    const match = devices.find((device) => {
      if (previousSerial && device.serialNumber === previousSerial) return true
      return device.vendorId === ADAFRUIT_USB_VENDOR_ID || device.productName?.toLowerCase().includes('circuit playground')
    })
    if (match) return match as unknown as UsbDeviceLike
    await delay(250)
  }
  return null
}

class WebUsbHf2Flasher {
  private device: UsbDeviceLike
  private iface: UsbInterfaceLike | null = null
  private epIn: UsbEndpointLike | null = null
  private epOut: UsbEndpointLike | null = null
  private seq = 1
  private bootloaderMode = false

  constructor(device: UsbDeviceLike, private readonly log: (text: string) => void) {
    this.device = device
  }

  async flash(firmware: CircuitPlaygroundCompileResult) {
    const blocks = parseUf2Blocks(firmware)
    await this.connect()
    await this.init()
    await this.switchToBootloader()
    this.log(`[flash] scrivo ${blocks.length} blocchi UF2 sulla flash`)
    await this.talk(HF2_CMD_START_FLASH).catch(() => undefined)
    for (let index = 0; index < blocks.length; index += 1) {
      const block = blocks[index]
      const payload = new Uint8Array(4 + block.payloadSize)
      write32(payload, 0, block.targetAddr)
      payload.set(block.data, 4)
      await this.talk(HF2_CMD_WRITE_FLASH_PAGE, payload)
      if (index === 0 || (index + 1) % 32 === 0 || index === blocks.length - 1) {
        this.log(`[flash] ${index + 1}/${blocks.length} pagine scritte`)
      }
    }
    await this.talk(HF2_CMD_RESET_INTO_APP).catch(() => undefined)
    this.log('[flash] reset in runtime richiesto')
    await this.close()
  }

  private async connect() {
    await this.device.open()
    if (!this.device.configuration) {
      await this.device.selectConfiguration(1)
    }
    const configuration = this.device.configuration ?? this.device.configurations?.[0]
    if (!configuration) throw new Error('La scheda non espone una configurazione WebUSB leggibile.')

    const match = configuration.interfaces
      .map((iface) => ({ iface, alternate: iface.alternates[0] }))
      .find(({ alternate }) => {
        if (!alternate) return false
        const pxtHf2 = alternate.interfaceClass === 255 && alternate.interfaceSubclass === 42
        const hasHidEndpoints = alternate.endpoints.length === 0 || (
          alternate.endpoints.length >= 2 && alternate.endpoints.every((endpoint) => endpoint.packetSize === 64)
        )
        return pxtHf2 && hasHidEndpoints
      })

    if (!match) throw new Error('Non trovo l interfaccia HF2/WebUSB della Circuit Playground.')
    this.iface = match.iface
    this.epIn = match.alternate.endpoints.find((endpoint) => endpoint.direction === 'in') ?? null
    this.epOut = match.alternate.endpoints.find((endpoint) => endpoint.direction === 'out') ?? null
    await this.device.claimInterface(match.iface.interfaceNumber)
  }

  private async close() {
    try {
      if (this.iface) await this.device.releaseInterface?.(this.iface.interfaceNumber)
    } catch {
      // Durante il reset USB la release puo fallire.
    }
    try {
      await this.device.close()
    } catch {
      // Durante il reset USB la chiusura puo fallire.
    }
  }

  private async init() {
    const info = await this.talk(HF2_CMD_BININFO)
    this.bootloaderMode = info[0] === HF2_MODE_BOOTLOADER
    const pageSize = read32(info, 4)
    const flashSize = read32(info, 8) * pageSize
    this.log(`[flash] HF2 ${this.bootloaderMode ? 'bootloader' : 'runtime'}; pagina ${pageSize} byte; flash ${Math.round(flashSize / 1024)} KB`)
  }

  private async switchToBootloader() {
    if (this.bootloaderMode) return
    this.log('[flash] passo la scheda in bootloader HF2')
    try {
      await this.talk(HF2_CMD_START_FLASH)
      await this.init()
      if (!this.bootloaderMode) throw new Error('La scheda non e entrata in bootloader HF2.')
    } catch {
      const previousSerial = this.device.serialNumber
      await this.talk(HF2_CMD_RESET_INTO_BOOTLOADER).catch(() => undefined)
      await this.close()
      const bootloader = await waitForAuthorizedAdafruitUsbDevice(previousSerial)
      if (!bootloader) {
        throw new Error('La scheda e stata riavviata in bootloader, ma il browser non la vede tra i dispositivi USB gia autorizzati. Riprova Esegui sulla scheda e seleziona CPLAYBOOT se Chrome lo chiede.')
      }
      this.device = bootloader
      this.iface = null
      this.epIn = null
      this.epOut = null
      await this.connect()
      await this.init()
      if (!this.bootloaderMode) throw new Error('La scheda non e entrata in bootloader HF2.')
    }
  }

  private async talk(command: number, data = new Uint8Array(0)) {
    const seq = this.seq
    this.seq = (this.seq + 1) & 0xffff
    const message = new Uint8Array(8 + data.length)
    write32(message, 0, command)
    write16(message, 4, seq)
    message.set(data, 8)
    await this.sendMessage(message)

    const deadline = Date.now() + 10000
    while (Date.now() < deadline) {
      const response = await this.receiveMessage(deadline)
      if (response.kind !== 'command') {
        this.log(response.text)
        continue
      }
      const responseSeq = (response.data[0] || 0) | ((response.data[1] || 0) << 8)
      const status = response.data[2]
      if (responseSeq !== seq) continue
      if (status !== HF2_STATUS_OK) throw new Error(`HF2 ha risposto con stato ${status}`)
      return response.data.slice(4)
    }
    throw new Error('Timeout nella risposta HF2 della scheda.')
  }

  private async sendMessage(message: Uint8Array) {
    for (let offset = 0; offset < message.length; offset += 63) {
      const len = Math.min(63, message.length - offset)
      const frame = new Uint8Array(64)
      frame[0] = (offset + len >= message.length ? HF2_FLAG_CMDPKT_LAST : 0) | len
      frame.set(message.slice(offset, offset + len), 1)
      await this.sendPacket(frame)
    }
  }

  private async sendPacket(packet: Uint8Array) {
    if (!this.iface) throw new Error('Interfaccia USB non pronta.')
    if (this.epOut && this.device.transferOut) {
      const result = await this.device.transferOut(this.epOut.endpointNumber, packet)
      if (result.status !== 'ok') throw new Error('Transfer USB OUT fallito.')
      return
    }
    if (!this.device.controlTransferOut) throw new Error('La scheda non supporta transfer USB OUT dal browser.')
    const result = await this.device.controlTransferOut({
      requestType: 'class',
      recipient: 'interface',
      request: USB_CONTROL_SET_REPORT,
      value: USB_CONTROL_OUT_REPORT,
      index: this.iface.interfaceNumber,
    }, packet)
    if (result.status !== 'ok') throw new Error('Control transfer USB OUT fallito.')
  }

  private async receiveMessage(deadline: number): Promise<{ kind: 'command'; data: Uint8Array } | { kind: 'serial'; text: string }> {
    const chunks: number[] = []
    while (Date.now() < deadline) {
      const packet = await this.receivePacket()
      const header = packet[0]
      const flag = header & HF2_FLAG_MASK
      const len = header & 0x3f
      if (!len) continue
      const body = packet.slice(1, 1 + len)
      if (flag === HF2_FLAG_SERIAL_OUT || flag === HF2_FLAG_SERIAL_ERR) {
        return { kind: 'serial', text: new TextDecoder().decode(body).trim() }
      }
      chunks.push(...body)
      if (flag === HF2_FLAG_CMDPKT_LAST) {
        return { kind: 'command', data: new Uint8Array(chunks) }
      }
    }
    throw new Error('Timeout nella lettura USB della scheda.')
  }

  private async receivePacket() {
    if (!this.iface) throw new Error('Interfaccia USB non pronta.')
    const result = this.epIn && this.device.transferIn
      ? await this.device.transferIn(this.epIn.endpointNumber, 64)
      : await this.device.controlTransferIn?.({
        requestType: 'class',
        recipient: 'interface',
        request: USB_CONTROL_GET_REPORT,
        value: USB_CONTROL_IN_REPORT,
        index: this.iface.interfaceNumber,
      }, 64)
    if (!result || result.status !== 'ok' || !result.data) throw new Error('Transfer USB IN fallito.')
    return new Uint8Array(result.data.buffer, result.data.byteOffset, result.data.byteLength)
  }
}

function parseSerialValues(lines: SerialLine[]) {
  const values: Record<string, string> = {}
  for (const line of lines.slice(-16)) {
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
      // Il formato key=value e il caso normale per le schede in aula.
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
  return `rgb(${Math.round(40 + t * 215)}, ${Math.round(160 - t * 110)}, ${Math.round(220 - t * 180)})`
}

function looksLikeBootloader(name?: string) {
  const normalized = (name || '').toLowerCase()
  return normalized.includes('boot') || normalized.includes('cplayboot') || normalized.includes('daplink')
}

function BoardPreview({ values, live, state }: { values: Record<string, string>; live: boolean; state: ConnectionState }) {
  const temp = numericValue(values, 'temp', 0)
  const luce = numericValue(values, 'luce', 0)
  const movimento = numericValue(values, 'movimento', 0)
  const buttonA = numericValue(values, 'a', 0) > 0
  const buttonB = numericValue(values, 'b', 0) > 0
  const pixelColor = live ? tempToColor(temp || 22) : state === 'bootloader' ? '#22c55e' : '#111827'
  const activePixels = live ? Math.max(1, Math.round(clamp((temp || 22) - 18, 0, 12) / 12 * 10)) : state === 'bootloader' ? 10 : 0

  return (
    <div className="border-b border-slate-200 bg-slate-900 p-4 text-white">
      <div className="mx-auto flex max-w-[300px] flex-col items-center">
        <div className="relative h-64 w-64 rounded-full border-[14px] border-slate-700 bg-slate-800 shadow-inner">
          {Array.from({ length: 10 }).map((_, index) => {
            const angle = (index / 10) * Math.PI * 2 - Math.PI / 2
            const x = 50 + Math.cos(angle) * 41
            const y = 50 + Math.sin(angle) * 41
            const lit = index < activePixels
            return (
              <span
                key={index}
                className="absolute h-5 w-5 -translate-x-1/2 -translate-y-1/2 rounded-full border border-slate-950"
                style={{
                  left: `${x}%`,
                  top: `${y}%`,
                  backgroundColor: lit ? pixelColor : '#111827',
                  boxShadow: lit ? `0 0 16px ${pixelColor}` : 'none',
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

        <div className="mt-3 grid w-full grid-cols-3 gap-2 text-center">
          <Metric label="Temp" value={live ? `${temp || 0}` : '--'} />
          <Metric label="Luce" value={live ? `${luce || 0}` : '--'} />
          <Metric label="Mov." value={live ? `${movimento || 0}` : '--'} />
          <div className="col-span-3 rounded-lg bg-white/10 px-2 py-2 text-xs text-slate-300">
            {live ? 'Dati seriali realtime' : state === 'bootloader' ? 'Bootloader UF2: pronto per firmware' : 'In attesa della seriale del firmware'}
          </div>
        </div>
      </div>
    </div>
  )
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-white/10 px-2 py-2">
      <p className="text-[10px] font-bold uppercase text-slate-400">{label}</p>
      <p className="font-mono text-sm">{value}</p>
    </div>
  )
}

export default function CircuitPlaygroundPanel({ source = '', onReplaceSource }: Props) {
  const [state, setState] = useState<ConnectionState>('idle')
  const [message, setMessage] = useState<string | null>(null)
  const [lines, setLines] = useState<SerialLine[]>([])
  const [command, setCommand] = useState('')
  const [baudRate, setBaudRate] = useState(115200)
  const [running, setRunning] = useState(false)
  const [compiledFirmware, setCompiledFirmware] = useState<CircuitPlaygroundCompileResult | null>(null)
  const portRef = useRef<SerialPortLike | null>(null)
  const readerRef = useRef<ReadableStreamDefaultReader<Uint8Array> | null>(null)
  const writerRef = useRef<WritableStreamDefaultWriter<Uint8Array> | null>(null)
  const keepReadingRef = useRef(false)

  const serialSupported = typeof navigator !== 'undefined' && !!(navigator as DeviceNavigator).serial
  const usbSupported = typeof navigator !== 'undefined' && !!(navigator as DeviceNavigator).usb
  const hidSupported = typeof navigator !== 'undefined' && !!(navigator as DeviceNavigator).hid
  const values = useMemo(() => parseSerialValues(lines), [lines])
  const serialReady = state === 'serial-ready'

  const appendLine = useCallback((text: string) => {
    setLines((prev) => [...prev.slice(-159), { id: `${Date.now()}-${Math.random()}`, text, ts: Date.now() }])
  }, [])

  const disconnectSerial = useCallback(async () => {
    keepReadingRef.current = false
    try {
      await readerRef.current?.cancel()
    } catch {
      // La porta puo essere gia stata scollegata.
    }
    try {
      readerRef.current?.releaseLock()
    } catch {
      // Lock gia rilasciato.
    }
    try {
      writerRef.current?.releaseLock()
    } catch {
      // Lock gia rilasciato.
    }
    try {
      await portRef.current?.close()
    } catch {
      // Dispositivo staccato o porta gia chiusa.
    }
    readerRef.current = null
    writerRef.current = null
    portRef.current = null
    setState('idle')
    setMessage(null)
  }, [])

  const openSerialPort = useCallback(async (port: SerialPortLike, reason = 'manuale') => {
    await port.open({ baudRate })
    portRef.current = port
    writerRef.current = port.writable?.getWriter() ?? null
    setState('serial-ready')
    setMessage('Seriale aperta. Quando il firmware MakeCode invia righe key=value, il cruscotto si aggiorna in realtime.')
    appendLine(`[browser] Circuit Playground collegata via Web Serial (${reason})`)

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
  }, [appendLine, baudRate])

  const inspectUsbOrHid = useCallback(async () => {
    if (hidSupported) {
      try {
        const devices = await (navigator as DeviceNavigator).hid!.requestDevice({
          filters: [{ vendorId: ADAFRUIT_USB_VENDOR_ID }],
        })
        const selected = devices[0]
        if (selected) {
          await selected.open()
          const productName = selected.productName || 'Circuit Playground Express'
          await selected.close()
          const bootloader = looksLikeBootloader(productName)
          setState(bootloader ? 'bootloader' : 'detected-no-serial')
          setMessage(
            bootloader
              ? 'Scheda rilevata in bootloader UF2. E pronta per ricevere un firmware compilato.'
              : 'Scheda rilevata via WebHID, ma non c e una porta seriale aperta. Dopo il flash del firmware, riconnetti la seriale per il cruscotto.'
          )
          appendLine(`[browser] ${productName} rilevata via WebHID${bootloader ? ' bootloader' : ''}`)
          return true
        }
      } catch {
        // Proviamo anche WebUSB prima di dichiarare errore.
      }
    }

    if (usbSupported) {
      try {
        const selected = await (navigator as DeviceNavigator).usb!.requestDevice({
          filters: [{ vendorId: ADAFRUIT_USB_VENDOR_ID }],
        })
        await selected.open()
        const productName = selected.productName || 'Circuit Playground Express'
        await selected.close()
        const bootloader = looksLikeBootloader(productName)
        setState(bootloader ? 'bootloader' : 'detected-no-serial')
        setMessage(
          bootloader
            ? 'Scheda rilevata in bootloader UF2. E pronta per ricevere un firmware compilato.'
            : 'Scheda rilevata via WebUSB, ma manca la porta seriale. Dopo il flash del firmware, riconnetti la seriale per il cruscotto.'
        )
        appendLine(`[browser] ${productName} rilevata via WebUSB${bootloader ? ' bootloader' : ''}`)
        return true
      } catch {
        // Nessun canale diagnostico disponibile o permesso negato.
      }
    }

    return false
  }, [appendLine, hidSupported, usbSupported])

  const requestSerialPort = useCallback(async () => {
    const serial = (navigator as DeviceNavigator).serial!
    try {
      return await serial.requestPort({
        filters: [{ usbVendorId: ADAFRUIT_USB_VENDOR_ID }],
      })
    } catch {
      setMessage('La porta non compare nel filtro Adafruit. Apro l elenco completo delle seriali: scegli la porta USB/ACM della Circuit Playground.')
      appendLine('[browser] filtro seriale Adafruit vuoto o annullato; provo elenco seriale completo')
      return await serial.requestPort()
    }
  }, [appendLine])

  const connect = useCallback(async () => {
    if (serialReady) {
      await disconnectSerial()
      return
    }
    if (!serialSupported) {
      setState('error')
      setMessage('Web Serial non e disponibile. Usa Chrome o Edge desktop su HTTPS o localhost.')
      return
    }

    setState('connecting')
    setMessage('Cerco la porta seriale della Circuit Playground...')
    try {
      const port = await requestSerialPort()
      await openSerialPort(port, 'selezione utente')
    } catch {
      const diagnosed = await inspectUsbOrHid()
      if (!diagnosed) {
        setState('error')
        setMessage('Non trovo una seriale della Circuit Playground. Se la lista e vuota, controlla cavo dati, permessi USB/seriali del sistema operativo e che nessun editor stia gia usando la porta.')
      }
    }
  }, [disconnectSerial, inspectUsbOrHid, openSerialPort, requestSerialPort, serialReady, serialSupported])

  useEffect(() => {
    if (!serialSupported || !(navigator as DeviceNavigator).serial?.getPorts) return

    let cancelled = false
    void (async () => {
      try {
        const ports = await (navigator as DeviceNavigator).serial!.getPorts!()
        const adafruitPort = ports.find((port) => port.getInfo?.().usbVendorId === ADAFRUIT_USB_VENDOR_ID) ?? ports[0]
        if (!cancelled && adafruitPort && !portRef.current) {
          setState('auto-detected')
          setMessage('Porta seriale gia autorizzata trovata. La apro automaticamente per il cruscotto realtime.')
          await openSerialPort(adafruitPort, 'permesso gia concesso')
        }
      } catch {
        // Il rilevamento automatico e solo un aiuto, non deve bloccare la pagina.
      }
    })()

    const handleDisconnect = () => {
      void disconnectSerial()
      appendLine('[browser] Circuit Playground scollegata')
    }
    ;(navigator as DeviceNavigator).serial?.addEventListener?.('disconnect', handleDisconnect)

    return () => {
      cancelled = true
      ;(navigator as DeviceNavigator).serial?.removeEventListener?.('disconnect', handleDisconnect)
    }
  }, [appendLine, disconnectSerial, openSerialPort, serialSupported])

  const execute = useCallback(async () => {
    setRunning(true)
    setMessage(null)
    try {
      if (!usbSupported) {
        throw new Error('WebUSB non e disponibile. Per caricare direttamente la Circuit Playground serve Chrome o Edge desktop su HTTPS o localhost.')
      }
      setState('connecting')
      setMessage('Seleziona la Circuit Playground nella finestra USB del browser. Poi compilo e carico il firmware automaticamente.')
      const usbDevice = await requestAdafruitUsbDevice()
      appendLine(`[browser] ${usbDevice.productName || 'Circuit Playground'} selezionata via WebUSB`)

      if (serialReady) {
        await disconnectSerial()
      }

      const rawCode = stripCodeFences(source)
      const code = rawCode && !looksLikeCircuitPythonSource(rawCode) ? rawCode : MAKECODE_SENSOR_SCRIPT
      if (code !== source.trim()) {
        onReplaceSource?.(code)
        appendLine('[browser] sorgente ripulita per MakeCode TypeScript')
      }

      appendLine('[compiler] invio codice al microservizio PXT')
      const response = await hardwareApi.compileCircuitPlayground(code)
      setCompiledFirmware(response.data)
      appendLine(`[compiler] UF2 pronto: ${response.data.filename} (${response.data.size_bytes} byte)`)
      setMessage(`Firmware compilato (${Math.round(response.data.size_bytes / 1024)} KB). Carico ora sulla scheda via WebUSB/HF2...`)

      const flasher = new WebUsbHf2Flasher(usbDevice, appendLine)
      await flasher.flash(response.data)
      setState('detected-no-serial')
      setMessage('Firmware caricato. Attendo la porta seriale del runtime per popolare il cruscotto realtime.')

      await delay(1400)
      const ports = await (navigator as DeviceNavigator).serial?.getPorts?.()
      const adafruitPort = ports?.find((port) => port.getInfo?.().usbVendorId === ADAFRUIT_USB_VENDOR_ID) ?? ports?.[0]
      if (adafruitPort) {
        await openSerialPort(adafruitPort, 'dopo flash')
      } else {
        appendLine('[browser] firmware caricato; nessuna seriale gia autorizzata trovata')
      }
    } catch (err) {
      setState((current) => current === 'serial-ready' ? current : 'error')
      const detail = (err as { response?: { data?: { detail?: { error?: string; logs?: string } | string } } })?.response?.data?.detail
      let message = err instanceof Error ? err.message : 'Compilazione firmware non riuscita.'
      if (detail) {
        if (typeof detail === 'string') {
          message = detail
        } else if (detail.error) {
          message = detail.error
          if (detail.logs) appendLine(`[compiler] ${detail.logs}`)
        }
      }
      setMessage(message)
    } finally {
      setRunning(false)
    }
  }, [appendLine, disconnectSerial, onReplaceSource, openSerialPort, serialReady, source, usbSupported])

  const compileAndDownload = useCallback(async () => {
    setRunning(true)
    setMessage(null)
    try {
      const rawCode = stripCodeFences(source)
      const code = rawCode && !looksLikeCircuitPythonSource(rawCode) ? rawCode : MAKECODE_SENSOR_SCRIPT
      if (code !== source.trim()) {
        onReplaceSource?.(code)
        appendLine('[browser] sorgente ripulita per MakeCode TypeScript')
      }

      appendLine('[compiler] invio codice al microservizio PXT')
      const response = await hardwareApi.compileCircuitPlayground(code)
      setCompiledFirmware(response.data)
      appendLine(`[compiler] UF2 pronto: ${response.data.filename} (${response.data.size_bytes} byte)`)
      downloadUf2(response.data)
      setState('bootloader')
      setMessage('UF2 scaricato. Premi due volte il tasto RESET sulla scheda: i LED diventano verdi e compare l unita CPLAYBOOT. Trascina il file .uf2 scaricato su quell unita: la scheda lampeggia, si riavvia e parte il programma. Poi premi "Seriale dati" per il cruscotto.')
    } catch (err) {
      setState('error')
      const detail = (err as { response?: { data?: { detail?: { error?: string; logs?: string } | string } } })?.response?.data?.detail
      let message = err instanceof Error ? err.message : 'Compilazione firmware non riuscita.'
      if (detail) {
        if (typeof detail === 'string') {
          message = detail
        } else if (detail.error) {
          message = detail.error
          if (detail.logs) appendLine(`[compiler] ${detail.logs}`)
        }
      }
      setMessage(message)
    } finally {
      setRunning(false)
    }
  }, [appendLine, onReplaceSource, source])

  const sendCommand = useCallback(async () => {
    const text = command.trim()
    if (!text || !writerRef.current) return
    await writerRef.current.write(new TextEncoder().encode(`${text}\n`))
    appendLine(`[browser -> Circuit Playground] ${text}`)
    setCommand('')
  }, [appendLine, command])

  const badge = {
    idle: ['offline', 'bg-slate-100 text-slate-600'],
    'auto-detected': ['seriale trovata', 'bg-sky-100 text-sky-700'],
    connecting: ['connessione', 'bg-amber-100 text-amber-700'],
    'serial-ready': ['live', 'bg-emerald-100 text-emerald-700'],
    bootloader: ['bootloader', 'bg-amber-100 text-amber-700'],
    'detected-no-serial': ['rilevata', 'bg-sky-100 text-sky-700'],
    error: ['errore', 'bg-red-100 text-red-700'],
  }[state]

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="flex shrink-0 items-center gap-3 border-b border-slate-200 px-4 py-3">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-sky-100 text-sky-700">
          <Zap className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-extrabold text-slate-900">Circuit Playground Express</p>
          <p className="truncate text-[11px] text-slate-500">MakeCode UF2, seriale e sensori realtime</p>
        </div>
        <span className={`rounded-full px-2 py-1 text-[10px] font-bold uppercase ${badge[1]}`}>{badge[0]}</span>
      </div>

      <BoardPreview values={values} live={serialReady} state={state} />

      <div className="shrink-0 border-b border-slate-200 bg-slate-50 px-4 py-3">
        <div className="mb-3 rounded-lg border border-slate-200 bg-white px-3 py-2">
          <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-wide text-slate-500">
            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
            Runtime supportato: MakeCode UF2
          </div>
          <p className="mt-1 text-xs leading-5 text-slate-600">
            Il codice viene compilato fuori da React con PXT/MakeCode. La seriale serve al cruscotto quando il firmware sta gia girando sulla scheda.
          </p>
          {compiledFirmware && (
          <button
            onClick={() => downloadUf2(compiledFirmware)}
            className="mt-2 inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-xs font-semibold text-slate-700 hover:bg-white"
          >
            <Download className="h-3.5 w-3.5" />
            Scarica UF2 compilato
          </button>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-sky-200 bg-sky-50 p-2">
          <label className="flex items-center gap-1.5 text-xs font-semibold text-slate-500">
            Baud
            <select
              value={baudRate}
              disabled={serialReady || state === 'connecting'}
              onChange={(event) => setBaudRate(Number(event.target.value))}
              className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs text-slate-700 outline-none"
            >
              <option value={115200}>115200</option>
              <option value={9600}>9600</option>
            </select>
          </label>
          <button
            onClick={() => void connect()}
            disabled={state === 'connecting' || running}
            className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition disabled:opacity-50 ${
              serialReady
                ? 'border border-red-200 bg-red-50 text-red-700 hover:bg-red-100'
                : 'bg-sky-600 text-white hover:bg-sky-500'
            }`}
          >
            {state === 'connecting' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : serialReady ? <Unplug className="h-3.5 w-3.5" /> : <Cable className="h-3.5 w-3.5" />}
            {serialReady ? 'Scollega seriale' : 'Seriale dati'}
          </button>
          <button
            onClick={() => void execute()}
            disabled={running || state === 'connecting'}
            className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-emerald-500 disabled:opacity-50"
          >
            {running ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
            Esegui sulla scheda
          </button>
          <button
            onClick={() => void compileAndDownload()}
            disabled={running || state === 'connecting'}
            className="inline-flex items-center gap-1.5 rounded-lg border border-sky-300 bg-white px-3 py-1.5 text-xs font-semibold text-sky-700 transition hover:bg-sky-100 disabled:opacity-50"
          >
            {running ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
            Compila e scarica UF2
          </button>
        </div>

        {!serialSupported && (
          <p className="mt-2 text-xs leading-5 text-amber-700">Web Serial non e supportato qui. Usa Chrome o Edge desktop su HTTPS o localhost.</p>
        )}
        {!usbSupported && !hidSupported && (
          <p className="mt-2 text-xs leading-5 text-amber-700">WebUSB/WebHID non sono disponibili: posso leggere solo porte seriali gia esposte dal runtime.</p>
        )}
        {message && (
          <p className={`mt-2 text-xs leading-5 ${state === 'error' || state === 'bootloader' ? 'text-amber-700' : 'text-slate-600'}`}>
            {state === 'error' || state === 'bootloader' ? <AlertTriangle className="mr-1 inline h-3.5 w-3.5" /> : null}
            {message}
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
              Il cruscotto si aggiorna quando riceve righe come <span className="font-mono">temp=22 luce=120 movimento=3</span>.
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
            disabled={!serialReady}
            placeholder="Invia comando alla console seriale"
            className="min-w-0 flex-1 rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 font-mono text-xs text-slate-100 outline-none placeholder:text-slate-600 disabled:opacity-50"
          />
          <button
            onClick={() => void sendCommand()}
            disabled={!serialReady || !command.trim()}
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
