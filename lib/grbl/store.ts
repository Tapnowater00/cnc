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

interface GrblStore {
  // WebSocket to the Pi bridge
  wsReady: boolean
  availablePorts: string[]
  selectedPort: string

  // Serial connection
  connected: boolean
  connecting: boolean

  // Machine state
  status: GrblStatus | null
  alarmMessage: string | null
  firmware: FirmwareInfo | null
  gcodeState: string | null
  probeResult: ProbeResult | null
  probing: boolean

  // Terminal log
  log: LogEntry[]

  // Job streaming
  job: JobState | null

  // Actions
  initWs: () => void
  listPorts: () => void
  setSelectedPort: (port: string) => void
  connect: (baudRate?: number) => void
  disconnect: () => void
  send: (cmd: string) => void
  clearLog: () => void
  home: () => void
  reset: () => void
  unlock: () => void

  // Job actions
  loadFile: (file: File) => Promise<void>
  startJob: () => void
  pauseJob: () => void
  resumeJob: () => void
  stopJob: () => void

  // Probe actions
  probeZ: (plateThickness: number, feedRate: number, maxDistance: number) => void

  // Spindle + override actions
  spindleOverride: (byte: number) => void
  feedOverride: (byte: number) => void
}

let logId = 0
let ws: WebSocket | null = null
let statusInterval: ReturnType<typeof setInterval> | null = null

// Job streaming state
let jobLines: string[] = []
let jobIndex = 0
let jobActive = false
let jobPaused = false
let waitingForOk = false

// Accumulated firmware info from [VER] + [OPT]
let pendingFirmware: Partial<FirmwareInfo> = {}

// Post-probe state
let pendingProbeZero = false
let pendingPlateThickness = 15

function rawSend(text: string) {
  if (ws?.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'send', text }))
  }
}

function rawBytes(data: number[]) {
  if (ws?.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'bytes', data }))
  }
}

export const useGrblStore = create<GrblStore>((set, get) => ({
  wsReady: false,
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

  initWs: () => {
    if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return
    const proto = typeof window !== 'undefined' && window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const host = typeof window !== 'undefined' ? window.location.host : 'localhost:3000'
    ws = new WebSocket(`${proto}//${host}/ws`)

    ws.onopen = () => {
      set({ wsReady: true })
      get().listPorts()
    }

    ws.onclose = () => {
      set({ wsReady: false })
      if (get().connected) {
        addLog(set, 'error', 'Bridge connection lost')
        if (statusInterval) clearInterval(statusInterval)
        set({ connected: false, status: null, job: null })
      }
    }

    ws.onerror = () => {
      addLog(set, 'error', 'WebSocket error — is the server running?')
    }

    ws.onmessage = (event: MessageEvent) => {
      let msg: { type: string; ports?: string[]; text?: string; message?: string }
      try {
        msg = JSON.parse(event.data)
      } catch {
        return
      }
      handleMessage(msg, set, get)
    }
  },

  listPorts: () => {
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'ports' }))
    }
  },

  setSelectedPort: (port: string) => set({ selectedPort: port }),

  connect: (baudRate = 115200) => {
    const { selectedPort, wsReady, initWs } = get()
    if (!wsReady) {
      initWs()
      return
    }
    if (!selectedPort) {
      addLog(set, 'error', 'No port selected')
      return
    }
    set({ connecting: true })
    ws?.send(JSON.stringify({ type: 'connect', port: selectedPort, baudRate }))
  },

  disconnect: () => {
    jobActive = false
    if (statusInterval) clearInterval(statusInterval)
    ws?.send(JSON.stringify({ type: 'disconnect' }))
    addLog(set, 'info', 'Disconnected')
    set({ connected: false, status: null, job: null, firmware: null, gcodeState: null, probeResult: null, probing: false })
  },

  send: (cmd: string) => {
    if (!ws || ws.readyState !== WebSocket.OPEN) return
    const realtime = cmd === '?' || cmd === '!' || cmd === '~'
    const text = realtime ? cmd : (cmd.endsWith('\n') ? cmd : cmd + '\n')
    if (cmd !== '?') addLog(set, 'tx', cmd.trim())
    ws.send(JSON.stringify({ type: 'send', text }))
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
      .map(l => {
        const stripped = l.replace(/\(.*?\)/g, '').replace(/;.*$/, '').trim()
        return stripped.toUpperCase()
      })
      .filter(l => l.length > 0 && l !== '%')

    set({
      job: {
        filename: file.name,
        lines,
        total: lines.length,
        sent: 0,
        running: false,
        paused: false,
        startedAt: 0,
      },
    })
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

  probeZ: (plateThickness: number, feedRate: number, maxDistance: number) => {
    const { connected, send } = get()
    if (!connected) return
    pendingPlateThickness = plateThickness
    pendingProbeZero = false
    set({ probeResult: null, probing: true })
    addLog(set, 'info', `Probing Z — plate: ${plateThickness}mm, feed: ${feedRate}mm/min, max: ${maxDistance}mm`)
    send('G91')
    send(`G38.2 Z-${Math.abs(maxDistance)} F${feedRate}`)
  },

  spindleOverride: (byte: number) => rawBytes([byte]),

  feedOverride: (byte: number) => rawBytes([byte]),

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

function handleMessage(msg: any, set: any, get: any) {
  switch (msg.type) {
    case 'ports': {
      const ports: string[] = msg.ports ?? []
      set({ availablePorts: ports })
      if (ports.length > 0 && !get().selectedPort) {
        set({ selectedPort: ports[0] })
      }
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
      if (!line) break
      processLine(line, set, get)
      break
    }
  }
}

function processLine(line: string, set: any, get: any) {
  // Status report
  const status = parseStatus(line)
  if (status) {
    set({ status, alarmMessage: null })
    return
  }

  // GRBLHAL bracketed messages [TAG:content]
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

  // Alarm
  const alarm = parseAlarm(line)
  if (alarm) {
    jobActive = false
    set({ alarmMessage: alarm })
    set((s: GrblStore) => s.job ? { job: { ...s.job, running: false } } : {})
    addLog(set, 'error', `ALARM: ${alarm}`)
    return
  }

  // ok
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
      const sent = jobIndex
      set((s: GrblStore) => s.job ? { job: { ...s.job, sent } } : {})
      waitingForOk = false
      sendNextJobLine(set, get)
    } else {
      waitingForOk = false
      addLog(set, 'rx', 'ok')
    }
    return
  }

  // error
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
