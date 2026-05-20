'use client'

import { create } from 'zustand'
import {
  parseStatus, parseAlarm, parseError,
  parseBracketed, parseFirmwareVersion, parseFirmwareOptions, parseProbeResult,
  type GrblStatus, type FirmwareInfo, type ProbeResult,
} from './parser'

export interface LogEntry {
  id: number
  direction: 'tx' | 'rx' | 'info' | 'error' | 'msg'
  text: string
  timestamp: number
}

export interface JobState {
  filename: string
  lines: string[]
  total: number
  sent: number
  running: boolean
  paused: boolean
  startedAt: number
}

// webserial  → Chrome/Edge hosted: browser native serial, no bridge app needed
// websocket  → Pi/local server or Firefox/Safari hosted: WebSocket bridge
type ConnectionMode = 'webserial' | 'websocket' | null

interface GrblStore {
  connectionMode: ConnectionMode
  bridgeReady: boolean       // Web Serial: always true; WebSocket: true when WS is open
  availablePorts: string[]   // WebSocket mode only
  selectedPort: string       // WebSocket mode only

  connected: boolean
  connecting: boolean

  status: GrblStatus | null
  alarmMessage: string | null
  firmware: FirmwareInfo | null
  gcodeState: string | null
  probeResult: ProbeResult | null
  probing: boolean

  log: LogEntry[]
  job: JobState | null

  initBridge: () => void
  listPorts: () => void
  setSelectedPort: (port: string) => void
  connect: (baudRate?: number) => void
  disconnect: () => void
  send: (cmd: string) => void
  clearLog: () => void
  home: () => void
  reset: () => void
  unlock: () => void

  loadFile: (file: File) => Promise<void>
  startJob: () => void
  pauseJob: () => void
  resumeJob: () => void
  stopJob: () => void

  probeZ: (plateThickness: number, feedRate: number, maxDistance: number) => void
  spindleOverride: (byte: number) => void
  feedOverride: (byte: number) => void
}

// ── Module-level transport state ─────────────────────────────────────────────

let logId = 0
let ws: WebSocket | null = null
let writer: WritableStreamDefaultWriter<Uint8Array> | null = null
let serialReadActive = false
let statusInterval: ReturnType<typeof setInterval> | null = null

let jobLines: string[] = []
let jobIndex = 0
let jobActive = false
let jobPaused = false
let waitingForOk = false

let pendingFirmware: Partial<FirmwareInfo> = {}
let pendingProbeZero = false
let pendingPlateThickness = 15

// ── Transport helpers (work for both modes) ──────────────────────────────────

function rawSend(text: string) {
  if (writer) {
    writer.write(new TextEncoder().encode(text)).catch(() => {})
  } else if (ws?.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'send', text }))
  }
}

function rawBytes(data: number[]) {
  if (writer) {
    writer.write(new Uint8Array(data)).catch(() => {})
  } else if (ws?.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'bytes', data }))
  }
}

// Hosted (non-LAN) URL → ws://localhost:3001; local/Pi → same host
function resolveWsUrl(): string {
  if (typeof window === 'undefined') return 'ws://localhost:3000/ws'
  const h = window.location.hostname
  const isLocal =
    h === 'localhost' || h === '127.0.0.1' ||
    /^192\.168\./.test(h) || /^10\./.test(h) ||
    /^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(h)
  if (isLocal) {
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    return `${proto}//${window.location.host}/ws`
  }
  return 'ws://localhost:3001/ws'
}

// ── Store ────────────────────────────────────────────────────────────────────

export const useGrblStore = create<GrblStore>((set, get) => ({
  connectionMode: null,
  bridgeReady: false,
  availablePorts: [],
  selectedPort: '',
  connected: false,
  connecting: false,
  status: null,
  alarmMessage: null,
  firmware: null,
  gcodeState: null,
  probeResult: null,
  probing: false,
  log: [],
  job: null,

  initBridge: () => {
    if (typeof window === 'undefined') return

    // Hosted URL + Web Serial available → no bridge app needed
    const h = window.location.hostname
    const isLocal =
      h === 'localhost' || h === '127.0.0.1' ||
      /^192\.168\./.test(h) || /^10\./.test(h) ||
      /^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(h)

    if (!isLocal && 'serial' in navigator) {
      set({ connectionMode: 'webserial', bridgeReady: true })
      return
    }

    // Pi / local server / Firefox / Safari → WebSocket bridge
    if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return
    ws = new WebSocket(resolveWsUrl())

    ws.onopen = () => {
      set({ connectionMode: 'websocket', bridgeReady: true })
      get().listPorts()
    }
    ws.onclose = () => {
      set({ bridgeReady: false })
      if (get().connected) {
        addLog(set, 'error', 'Bridge connection lost')
        if (statusInterval) clearInterval(statusInterval)
        set({ connected: false, status: null, job: null })
      }
    }
    ws.onerror = () => {
      addLog(set, 'error', 'WebSocket error — is the bridge running?')
      set({ connectionMode: 'websocket' })
    }
    ws.onmessage = (event: MessageEvent) => {
      let msg: any
      try { msg = JSON.parse(event.data) } catch { return }
      handleWsMessage(msg, set, get)
    }
  },

  listPorts: () => {
    if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'ports' }))
  },

  setSelectedPort: (port) => set({ selectedPort: port }),

  connect: (baudRate = 115200) => {
    const { connectionMode, selectedPort, bridgeReady, initBridge } = get()

    if (!bridgeReady) { initBridge(); return }

    if (connectionMode === 'webserial') {
      set({ connecting: true })
      ;(async () => {
        try {
          const port = await (navigator as any).serial.requestPort()
          await port.open({ baudRate })
          writer = port.writable.getWriter()
          serialReadActive = true
          pendingFirmware = {}
          startSerialReadLoop(port, set, get)
          statusInterval = setInterval(() => get().send('?'), 200)
          addLog(set, 'info', 'Connected')
          set({ connected: true, connecting: false, firmware: null })
          setTimeout(() => {
            get().send('\r\n\r\n')
            setTimeout(() => get().send('$I'), 500)
          }, 300)
        } catch (err: any) {
          addLog(set, 'error', `Connection failed: ${err.message}`)
          set({ connecting: false })
        }
      })()
      return
    }

    // WebSocket path
    if (!selectedPort) { addLog(set, 'error', 'No port selected'); return }
    set({ connecting: true })
    ws?.send(JSON.stringify({ type: 'connect', port: selectedPort, baudRate }))
  },

  disconnect: () => {
    jobActive = false
    if (statusInterval) clearInterval(statusInterval)

    if (writer) {
      serialReadActive = false
      writer.releaseLock()
      writer = null
    } else {
      ws?.send(JSON.stringify({ type: 'disconnect' }))
    }

    addLog(set, 'info', 'Disconnected')
    set({ connected: false, status: null, job: null, firmware: null, gcodeState: null, probeResult: null, probing: false })
  },

  send: (cmd: string) => {
    const realtime = cmd === '?' || cmd === '!' || cmd === '~'
    const text = realtime ? cmd : (cmd.endsWith('\n') ? cmd : cmd + '\n')
    if (cmd !== '?') addLog(set, 'tx', cmd.trim())
    rawSend(text)
  },

  clearLog: () => set({ log: [] }),
  home: () => { get().send('$H') },

  reset: () => {
    jobActive = false
    waitingForOk = false
    set({ job: null })
    rawBytes([0x18])
    addLog(set, 'tx', '[SOFT RESET]')
  },

  unlock: () => { get().send('$X') },

  loadFile: async (file: File) => {
    const text = await file.text()
    const lines = text
      .split('\n')
      .map(l => l.replace(/\(.*?\)/g, '').replace(/;.*$/, '').trim().toUpperCase())
      .filter(l => l.length > 0 && l !== '%')
    set({ job: { filename: file.name, lines, total: lines.length, sent: 0, running: false, paused: false, startedAt: 0 } })
    addLog(set, 'info', `Loaded: ${file.name} (${lines.length} lines)`)
  },

  startJob: () => {
    const { job, connected } = get()
    if (!job || !connected) return
    jobLines = job.lines
    jobIndex = 0
    jobActive = true
    jobPaused = false
    waitingForOk = false
    set({ job: { ...job, running: true, paused: false, sent: 0, startedAt: Date.now() } })
    addLog(set, 'info', `Job started: ${job.filename}`)
    sendNextJobLine(set, get)
  },

  pauseJob: () => {
    jobPaused = true
    set((s) => s.job ? { job: { ...s.job, paused: true } } : {})
    rawBytes([0x21])
    addLog(set, 'info', 'Job paused')
  },

  resumeJob: () => {
    jobPaused = false
    set((s) => s.job ? { job: { ...s.job, paused: false } } : {})
    rawBytes([0x7e])
    addLog(set, 'info', 'Job resumed')
    if (!waitingForOk) sendNextJobLine(set, get)
  },

  probeZ: (plateThickness, feedRate, maxDistance) => {
    if (!get().connected) return
    pendingPlateThickness = plateThickness
    pendingProbeZero = false
    set({ probeResult: null, probing: true })
    addLog(set, 'info', `Probing Z — plate: ${plateThickness}mm, feed: ${feedRate}mm/min, max: ${maxDistance}mm`)
    get().send('G91')
    get().send(`G38.2 Z-${Math.abs(maxDistance)} F${feedRate}`)
  },

  spindleOverride: (byte) => rawBytes([byte]),
  feedOverride: (byte) => rawBytes([byte]),

  stopJob: () => {
    jobActive = false
    waitingForOk = false
    jobLines = []
    set((s) => s.job ? { job: { ...s.job, running: false, paused: false } } : {})
    rawBytes([0x21])
    setTimeout(() => rawBytes([0x18]), 200)
    addLog(set, 'info', 'Job stopped')
  },
}))

// ── Helpers ──────────────────────────────────────────────────────────────────

function addLog(set: any, direction: LogEntry['direction'], text: string) {
  set((s: GrblStore) => ({
    log: [...s.log.slice(-499), { id: logId++, direction, text, timestamp: Date.now() }],
  }))
}

function sendNextJobLine(set: any, get: any) {
  if (!jobActive || jobPaused || waitingForOk) return
  if (jobIndex >= jobLines.length) {
    jobActive = false
    set((s: GrblStore) => s.job ? { job: { ...s.job, running: false } } : {})
    addLog(set, 'info', 'Job complete!')
    return
  }
  const line = jobLines[jobIndex]
  waitingForOk = true
  addLog(set, 'tx', line)
  rawSend(line + '\n')
}

function processLine(line: string, set: any, get: any) {
  const status = parseStatus(line)
  if (status) { set({ status, alarmMessage: null }); return }

  const bracketed = parseBracketed(line)
  if (bracketed) {
    if (bracketed.type === 'VER') {
      const info = parseFirmwareVersion(bracketed.content)
      pendingFirmware = { ...pendingFirmware, ...info }
      set({ firmware: { version: '', date: '', isGrblHAL: false, options: '', axes: 3, ...pendingFirmware } })
      addLog(set, 'info', `Firmware: ${bracketed.content}`)
    } else if (bracketed.type === 'OPT') {
      const opts = parseFirmwareOptions(bracketed.content)
      pendingFirmware = { ...pendingFirmware, ...opts }
      set({ firmware: { version: '', date: '', isGrblHAL: false, options: '', axes: 3, ...pendingFirmware } })
    } else if (bracketed.type === 'PRB') {
      const result = parseProbeResult(bracketed.content)
      if (result) {
        set({ probeResult: result, probing: false })
        if (result.success) {
          addLog(set, 'info', `Probe contact — Z machine pos: ${result.mpos.z.toFixed(3)}`)
          pendingProbeZero = true
        } else {
          addLog(set, 'error', 'Probe failed — no contact within max distance')
          get().send('G90')
        }
      }
    } else if (bracketed.type === 'GC') {
      set({ gcodeState: bracketed.content })
    } else if (bracketed.type === 'MSG') {
      addLog(set, 'msg', bracketed.content)
    } else {
      addLog(set, 'rx', line)
    }
    return
  }

  const alarm = parseAlarm(line)
  if (alarm) {
    jobActive = false
    set({ alarmMessage: alarm })
    set((s: GrblStore) => s.job ? { job: { ...s.job, running: false } } : {})
    addLog(set, 'error', `ALARM: ${alarm}`)
    return
  }

  if (line === 'ok') {
    if (pendingProbeZero) {
      pendingProbeZero = false
      const t = pendingPlateThickness
      addLog(set, 'info', `Z zeroed — plate ${t}mm, retracting 5mm`)
      get().send(`G10 L20 P0 Z${t}`)
      get().send('G0 Z5')
      get().send('G90')
    } else if (jobActive && !jobPaused) {
      jobIndex++
      set((s: GrblStore) => s.job ? { job: { ...s.job, sent: jobIndex } } : {})
      waitingForOk = false
      sendNextJobLine(set, get)
    } else {
      waitingForOk = false
      addLog(set, 'rx', 'ok')
    }
    return
  }

  const error = parseError(line)
  if (error) {
    if (jobActive) {
      jobActive = false
      waitingForOk = false
      set((s: GrblStore) => s.job ? { job: { ...s.job, running: false } } : {})
      addLog(set, 'error', `Job stopped — ${error}`)
    } else {
      addLog(set, 'error', error)
    }
    return
  }

  addLog(set, 'rx', line)
}

// Web Serial read loop — feeds the same processLine used by WebSocket path
async function startSerialReadLoop(port: any, set: any, get: any) {
  const decoder = new TextDecoder()
  let buffer = ''
  try {
    const reader = port.readable!.getReader()
    while (serialReadActive) {
      const { value, done } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''
      for (const raw of lines) {
        const line = raw.trim()
        if (line) processLine(line, set, get)
      }
    }
    reader.releaseLock()
    try { await port.close() } catch {}
  } catch (err: any) {
    addLog(set, 'error', `Read error: ${err.message}`)
    get().disconnect()
  }
}

// WebSocket message handler
function handleWsMessage(msg: any, set: any, get: any) {
  switch (msg.type) {
    case 'ports': {
      const ports: string[] = msg.ports ?? []
      set({ availablePorts: ports })
      if (ports.length > 0 && !get().selectedPort) set({ selectedPort: ports[0] })
      break
    }
    case 'connected': {
      pendingFirmware = {}
      statusInterval = setInterval(() => get().send('?'), 200)
      addLog(set, 'info', 'Connected')
      set({ connected: true, connecting: false, firmware: null })
      setTimeout(() => {
        get().send('\r\n\r\n')
        setTimeout(() => get().send('$I'), 500)
      }, 300)
      break
    }
    case 'disconnected': {
      if (statusInterval) clearInterval(statusInterval)
      addLog(set, 'info', 'Disconnected')
      set({ connected: false, status: null, job: null, firmware: null, gcodeState: null, probeResult: null, probing: false })
      break
    }
    case 'error': {
      addLog(set, 'error', msg.message ?? 'Unknown error')
      set({ connecting: false })
      break
    }
    case 'data': {
      const line = (msg.text ?? '').trim()
      if (line) processLine(line, set, get)
      break
    }
  }
}
