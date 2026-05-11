export interface PathSegment {
  type: 'cut' | 'rapid'
  pts: number[]   // flat [x0,y0,z0, x1,y1,z1, ...]
}

export function parseToolpathXY(gcode: string[]): PathSegment[] {
  return parseToolpathXYZ(gcode)
}

export function parseToolpathXYZ(gcode: string[]): PathSegment[] {
  const segments: PathSegment[] = []
  let x = 0, y = 0, z = 0
  let mode: 'cut' | 'rapid' = 'rapid'
  let current: number[] = [x, y, z]

  const flush = (nextMode: 'cut' | 'rapid') => {
    if (current.length >= 6) segments.push({ type: mode, pts: [...current] })
    mode = nextMode
    current = [x, y, z]
  }

  for (const raw of gcode) {
    const line = raw.trim().toUpperCase()
    if (!line || line.startsWith(';')) continue

    const isG0 = /^G0\b/.test(line)
    const isG1 = /^G1\b/.test(line)
    if (!isG0 && !isG1) continue

    const xm = line.match(/X([-\d.]+)/)
    const ym = line.match(/Y([-\d.]+)/)
    const zm = line.match(/Z([-\d.]+)/)
    if (!xm && !ym && !zm) continue

    if (xm) x = parseFloat(xm[1])
    if (ym) y = parseFloat(ym[1])
    if (zm) z = parseFloat(zm[1])

    const newMode: 'cut' | 'rapid' = isG0 ? 'rapid' : 'cut'
    if (newMode !== mode) flush(newMode)
    current.push(x, y, z)
  }

  if (current.length >= 6) segments.push({ type: mode, pts: current })
  return segments
}
