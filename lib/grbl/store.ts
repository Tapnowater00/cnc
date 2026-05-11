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
  // Connection
  port: SerialPort | null
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
  connect: (baudRate?: number) => Promise<void>
  disconnect: () => Promise<void>
  send: (cmd: string) => Promise<void>
  clearLog: () => void
  home: () => Promise<void>
  reset: () => Promise<void>
  unlock: () => Promise<void>

  // Job actions
  loadFile: (file: File) => Promise<void>
  startJob: () => void
  pauseJob: () => void
  resumeJob: () => void
  stopJob: () => void

  // Probe actions
  probeZ: (plateThickness: number, feedRate: number, maxDistance: number) => Promise<void>

  // Spindle + override actions
  spindleOverride: (byte: number) => void
  feedOverride: (byte: number) => void
}

let logId = 0
let writer: WritableStreamDefaultWriter<Uint8Array> | null = null
let statusInterval: ReturnType<typeof setInterval> | null = null
let readLoopActive = false

// Job streaming state (module-level for read loop access)
let jobLines: string[] = []
let jobIndex = 0
let jobActive = false
let jobPaused = false
let waitingForOk = false

// Accumulated firmware info from [VER] + [OPT]
let pendingFirmware: Partial<FirmwareInfo> = {}

// Post-probe state: set when [PRB:] success received, cleared on next ok
let pendingProbeZero = false
let pendingPlateThickness = 15

export const useGrblStore = create<GrblStore>((set, get) => ({
  port: null,
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

  connect: async (baudRate = 115200) => {
    set({ connecting: true })
    try {
      const port = await (navigator as any).serial.requestPort()
      await port.open({ baudRate })

      writer = port.writable.getWriter()
      readLoopActive = true
      pendingFirmware = {}
      startReadLoop(port, set, get)

      statusInterval = setInterval(() => {
        get().send('?')
      }, 200)

      addLog(set, 'info', 'Connected')
      set({ port, connected: true, connecting: false, firmware: null })

      // Wake up then request firmware info
      setTimeout(() => {
        get().send('\r\n\r\n')
        setTimeout(() => get().send('$I'), 500)
      }, 300)
    } catch (err: any) {
      addLog(set, 'error', `Connection failed: ${err.message}`)
      set({ connecting: false })
    }
  },

  disconnect: async () => {
    readLoopActive = false
    jobActive = false
    if (statusInterval) clearInterval(statusInterval)
    if (writer) { writer.releaseLock(); writer = null }
    const { port } = get()
    if (port) {
      try { await port.close() } catch {}
    }
    addLog(set, 'info', 'Disconnected')
    set({ port: null, connected: false, status: null, job: null, firmware: null, gcodeState: null, probeResult: null, probing: false })
  },

  send: async (cmd: string) => {
    if (!writer) return
    // Real-time commands must NOT have a newline — Grbl returns ok for the bare \n
    const realtime = cmd === '?' || cmd === '!' || cmd === '~'
    const data = realtime ? cmd : (cmd.endsWith('\n') ? cmd : cmd + '\n')
    if (cmd !== '?') addLog(set, 'tx', cmd.trim())
    try {
      await writer.write(new TextEncoder().encode(data))
    } catch (err: any) {
      addLog(set, 'error', `Send failed: ${err.message}`)
    }
  },

  clearLog: () => set({ log: [] }),

  home: async () => { await get().send('$H') },

  reset: async () => {
    if (!writer) return
    jobActive = false
    waitingForOk = false
    set({ job: null })
    await writer.write(new Uint8Array([0x18]))
    addLog(set, 'tx', '[SOFT RESET]')
  },

  unlock: async () => { await get().send('$X') },

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
    if (writer) writer.write(new Uint8Array([0x21]))
    addLog(set, 'info', 'Job paused')
  },

  resumeJob: () => {
    jobPaused = false
    set((s) => s.job ? { job: { ...s.job, paused: false } } : {})
    if (writer) writer.write(new Uint8Array([0x7e]))
    addLog(set, 'info', 'Job resumed')
    if (!waitingForOk) sendNextJobLine(set, get)
  },

  probeZ: async (plateThickness: number, feedRate: number, maxDistance: number) => {
    const { connected, send } = get()
    if (!connected) return
    pendingPlateThickness = plateThickness
    pendingProbeZero = false
    set({ probeResult: null, probing: true })
    addLog(set, 'info', `Probing Z — plate: ${plateThickness}mm, feed: ${feedRate}mm/min, max: ${maxDistance}mm`)
    await send('G91')
    await send(`G38.2 Z-${Math.abs(maxDistance)} F${feedRate}`)
  },

  spindleOverride: (byte: number) => {
    if (writer) writer.write(new Uint8Array([byte]))
  },

  feedOverride: (byte: number) => {
    if (writer) writer.write(new Uint8Array([byte]))
  },

  stopJob: () => {
    jobActive = false
    waitingForOk = false
    jobLines = []
    set((s) => s.job ? { job: { ...s.job, running: false, paused: false } } : {})
    if (writer) {
      writer.write(new Uint8Array([0x21]))
      setTimeout(() => writer?.write(new Uint8Array([0x18])), 200)
    }
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

  if (writer) {
    addLog(set, 'tx', line)
    writer.write(new TextEncoder().encode(line + '\n'))
  }
}

async function startReadLoop(port: SerialPort, set: any, get: any) {
  const decoder = new TextDecoder()
  let buffer = ''

  try {
    const reader = port.readable!.getReader()
    while (readLoopActive) {
      const { value, done } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''

      for (const raw of lines) {
        const line = raw.trim()
        if (!line) continue

        // Status report
        const status = parseStatus(line)
        if (status) {
          set({ status, alarmMessage: null })
          continue
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
            // Show other bracketed messages in terminal
            addLog(set, 'rx', line)
          }
          continue
        }

        // Alarm
        const alarm = parseAlarm(line)
        if (alarm) {
          jobActive = false
          set({ alarmMessage: alarm })
          set((s: GrblStore) => s.job ? { job: { ...s.job, running: false } } : {})
          addLog(set, 'error', `ALARM: ${alarm}`)
          continue
        }

        // ok — advance job stream, handle post-probe zero, or log
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
          continue
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
          continue
        }

        addLog(set, 'rx', line)
      }
    }
    reader.releaseLock()
  } catch (err: any) {
    addLog(set, 'error', `Read error: ${err.message}`)
    get().disconnect()
  }
}
