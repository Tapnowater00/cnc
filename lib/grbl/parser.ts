export type GrblState = 'Idle' | 'Run' | 'Hold' | 'Jog' | 'Alarm' | 'Door' | 'Check' | 'Home' | 'Sleep' | 'Unknown'

export interface GrblStatus {
  state: GrblState
  subState?: number
  mpos: { x: number; y: number; z: number }
  wpos: { x: number; y: number; z: number }
  wco: { x: number; y: number; z: number }
  feed: number
  spindle: number
  pins: { x: boolean; y: boolean; z: boolean; probe: boolean; estop: boolean }
  overrides: { feed: number; rapid: number; spindle: number }
  buffer: { blocks: number; bytes: number }
}

export interface FirmwareInfo {
  version: string
  date: string
  isGrblHAL: boolean
  options: string
  axes: number
}

export interface BracketedMessage {
  type: 'VER' | 'OPT' | 'MSG' | 'GC' | 'HLP' | 'AXS' | 'TOOL' | 'SPINDLE' | 'ALARM' | 'ERR' | 'PRB' | 'OTHER'
  raw: string
  content: string
}

export interface ProbeResult {
  mpos: { x: number; y: number; z: number }
  success: boolean
}

const defaultStatus: GrblStatus = {
  state: 'Unknown',
  mpos: { x: 0, y: 0, z: 0 },
  wpos: { x: 0, y: 0, z: 0 },
  wco: { x: 0, y: 0, z: 0 },
  feed: 0,
  spindle: 0,
  pins: { x: false, y: false, z: false, probe: false, estop: false },
  overrides: { feed: 100, rapid: 100, spindle: 100 },
  buffer: { blocks: 0, bytes: 0 },
}

// Grbl 1.1 / GRBLHAL status: <State|MPos:x,y,z|Bf:b,bytes|FS:f,s|Pn:XYZPE|WCO:x,y,z|Ov:f,r,s|A:SM>
export function parseStatus(line: string): GrblStatus | null {
  if (!line.startsWith('<') || !line.endsWith('>')) return null

  const inner = line.slice(1, -1)
  const parts = inner.split('|')
  const status: GrblStatus = {
    ...defaultStatus,
    pins: { ...defaultStatus.pins },
    overrides: { ...defaultStatus.overrides },
    buffer: { ...defaultStatus.buffer },
  }

  const stateRaw = parts[0]
  const colonIdx = stateRaw.indexOf(':')
  if (colonIdx !== -1) {
    status.state = stateRaw.slice(0, colonIdx) as GrblState
    status.subState = parseInt(stateRaw.slice(colonIdx + 1))
  } else {
    status.state = stateRaw as GrblState
  }

  let hasMPos = false
  let hasWPos = false

  for (let i = 1; i < parts.length; i++) {
    const part = parts[i]
    const sep = part.indexOf(':')
    if (sep === -1) continue
    const key = part.slice(0, sep)
    const val = part.slice(sep + 1)

    if (key === 'MPos') {
      const [x, y, z] = val.split(',').map(Number)
      status.mpos = { x, y, z }
      hasMPos = true
    } else if (key === 'WPos') {
      const [x, y, z] = val.split(',').map(Number)
      status.wpos = { x, y, z }
      hasWPos = true
    } else if (key === 'WCO') {
      const [x, y, z] = val.split(',').map(Number)
      status.wco = { x, y, z }
    } else if (key === 'FS') {
      const [f, s] = val.split(',').map(Number)
      status.feed = f
      status.spindle = s
    } else if (key === 'F') {
      status.feed = Number(val)
    } else if (key === 'Pn') {
      status.pins.x = val.includes('X')
      status.pins.y = val.includes('Y')
      status.pins.z = val.includes('Z')
      status.pins.probe = val.includes('P')
      status.pins.estop = val.includes('E')
    } else if (key === 'Ov') {
      const [f, r, s] = val.split(',').map(Number)
      status.overrides = { feed: f, rapid: r, spindle: s }
    } else if (key === 'Bf') {
      const [b, bytes] = val.split(',').map(Number)
      status.buffer = { blocks: b, bytes }
    }
  }

  if (hasMPos && !hasWPos) {
    status.wpos = {
      x: status.mpos.x - status.wco.x,
      y: status.mpos.y - status.wco.y,
      z: status.mpos.z - status.wco.z,
    }
  } else if (hasWPos && !hasMPos) {
    status.mpos = {
      x: status.wpos.x + status.wco.x,
      y: status.wpos.y + status.wco.y,
      z: status.wpos.z + status.wco.z,
    }
  }

  return status
}

// GRBLHAL wraps messages in [brackets]
export function parseBracketed(line: string): BracketedMessage | null {
  if (!line.startsWith('[') || !line.endsWith(']')) return null
  const inner = line.slice(1, -1)
  const sep = inner.indexOf(':')
  const type = sep !== -1 ? inner.slice(0, sep).toUpperCase() : inner.toUpperCase()
  const content = sep !== -1 ? inner.slice(sep + 1) : ''

  const knownTypes = ['VER', 'OPT', 'MSG', 'GC', 'HLP', 'AXS', 'TOOL', 'SPINDLE', 'ALARM', 'ERR', 'PRB']
  return {
    type: (knownTypes.includes(type) ? type : 'OTHER') as BracketedMessage['type'],
    raw: line,
    content,
  }
}

// Parse [VER:3.x.x:date] into FirmwareInfo
export function parseFirmwareVersion(content: string): Partial<FirmwareInfo> {
  // GRBLHAL: "3.0.2:2024-11-01" or Grbl: "1.1f:Build date"
  const parts = content.split(':')
  const version = parts[0] ?? ''
  const date = parts[1] ?? ''
  const isGrblHAL = version.startsWith('3.') || version.startsWith('2.')
  return { version, date, isGrblHAL }
}

// Parse [OPT:option_string,axes,blocks,bufsize,...]
export function parseFirmwareOptions(content: string): Partial<FirmwareInfo> {
  const parts = content.split(',')
  return {
    options: parts[0] ?? '',
    axes: parseInt(parts[1] ?? '3') || 3,
  }
}

// [PRB:x,y,z:1] — probe result, last field is 1=success 0=fail
export function parseProbeResult(content: string): ProbeResult | null {
  const parts = content.split(':')
  const coords = parts[0]?.split(',').map(Number)
  const success = parts[1] === '1'
  if (!coords || coords.length < 3) return null
  return {
    mpos: { x: coords[0], y: coords[1], z: coords[2] },
    success,
  }
}

const ALARM_CODES: Record<string, string> = {
  '1': 'Hard limit triggered',
  '2': 'Soft limit triggered',
  '3': 'Reset while in motion',
  '4': 'Probe fail — not in expected state',
  '5': 'Probe fail — no contact',
  '6': 'Homing fail — reset',
  '7': 'Homing fail — door open',
  '8': 'Homing fail — pull-off failed',
  '9': 'Homing fail — limit not found',
  '10': 'Homing fail — second limit not cleared',
  '11': 'Safety door opened',
  '12': 'Homing fail — limit switch pulloff failed',
  '13': 'Homing fail — limit switch not found after pulloff',
  '14': 'Spindle control — at speed timeout',
  '15': 'Homing fail — approach too slow',
  '16': 'Homing fail — both limits tripped',
  '17': 'G-code — tool change pending',
  '18': 'Estop active',
  '19': 'Motor fault',
  '20': 'Homing fail — no axes configured',
}

const ERROR_CODES: Record<string, string> = {
  '1': 'Expected command letter',
  '2': 'Bad number format',
  '3': 'Invalid $ statement',
  '4': 'Negative value',
  '5': 'Setting disabled',
  '6': 'Step pulse too short',
  '7': 'Failed — parameters exceed machine travel',
  '8': 'Command invalid in motion mode',
  '9': 'G-code lock during alarm or jog',
  '10': 'Soft limits require homing',
  '11': 'Max chars per line exceeded',
  '12': 'Jog target too large',
  '13': 'Jog command missing feed rate',
  '14': 'Laser mode requires PWM output',
  '15': 'Unused',
  '16': 'Unused',
  '17': 'Unused',
  '18': 'Unused',
  '19': 'Unused',
  '20': 'Unsupported command',
  '21': 'Modal group violation',
  '22': 'Undefined feed rate',
  '23': 'G-code command not allowed with G53',
  '24': 'Unused',
  '25': 'Unused',
  '26': 'Axis words found in block when none expected',
  '27': 'Line number value invalid',
  '28': 'G-code command missing required value',
  '29': 'G59.x WCS are not supported',
  '30': 'G53 only allowed with G0/G1',
  '31': 'Undefined axis in block',
  '32': 'G2/G3 arc missing plane axis words',
  '33': 'Motion command target invalid',
  '34': 'Arc radius too small',
  '35': 'G2/G3 arc missing I/J/K or R',
  '36': 'Unused',
  '37': 'P word missing for G10/G4',
  '38': 'Invalid tool number',
  '39': 'Value out of range',
  '40': 'G-code not allowed in motion mode',
  '41': 'Invalid retract plane in G98',
  '42': 'Spindle not running when required',
  '43': 'Plane and axis mismatch',
  '44': 'MDI not supported',
  '45': 'Rotation not supported',
  '46': 'Non-default spindle not assigned',
  '47': 'Safety door ajar',
  '48': 'Not allowed — program is running',
  '49': 'Value out of range for setting',
  '50': 'Setting disabled — plugin required',
}

export function parseAlarm(line: string): string | null {
  if (!line.startsWith('ALARM:')) return null
  const code = line.split(':')[1]?.trim()
  return ALARM_CODES[code] ?? `Alarm ${code}`
}

export function parseError(line: string): string | null {
  if (!line.startsWith('error:')) return null
  const code = line.split(':')[1]?.trim()
  return ERROR_CODES[code] ?? `Error ${code}`
}
