import type { CanvasShape } from '@/lib/canvas/store'

export interface VCarveParams {
  shape: CanvasShape
  vAngle: number      // full included angle of V-bit in degrees (e.g. 60, 90)
  maxDepth: number    // mm — maximum plunge depth
  feedRate: number
  plungeRate: number
  spindleRPM: number
  safeZ: number
}

type Point = [number, number]

function rectOutline(x: number, y: number, w: number, h: number): Point[] {
  return [[x, y], [x + w, y], [x + w, y + h], [x, y + h], [x, y]]
}

function ellipseOutline(cx: number, cy: number, rx: number, ry: number, segs = 64): Point[] {
  const pts: Point[] = []
  for (let i = 0; i <= segs; i++) {
    const a = (i / segs) * Math.PI * 2
    pts.push([cx + rx * Math.cos(a), cy + ry * Math.sin(a)])
  }
  return pts
}

/**
 * Simplified V-carve: follows shape outline in a single pass at maxDepth.
 *
 * True V-carve (medial-axis-based varying depth) is a complex algorithm.
 * This implementation cuts the outline on-line at full depth, which is the
 * correct behaviour for text outlines and decorative shapes where width
 * control comes from the V-bit angle.
 *
 * Surface cut width at maxDepth: 2 * maxDepth * tan(vAngle / 2)
 */
export function generateVCarve(p: VCarveParams): string[] {
  const n = (v: number) => v.toFixed(3)

  let path: Point[]

  if (p.shape.type === 'line') {
    const raw = p.shape.points ?? []
    if (raw.length < 4) return ['; ERROR: line has fewer than 2 points']
    path = []
    for (let i = 0; i < raw.length; i += 2) path.push([raw[i], raw[i + 1]])
    if (p.shape.closed && path.length >= 2) path.push(path[0])
  } else if (p.shape.type === 'rect') {
    path = rectOutline(p.shape.x, p.shape.y, p.shape.width, p.shape.height)
  } else {
    const cx = p.shape.x + p.shape.width  / 2
    const cy = p.shape.y + p.shape.height / 2
    path = ellipseOutline(cx, cy, p.shape.width / 2, p.shape.height / 2)
  }

  const halfAngle = (p.vAngle / 2) * (Math.PI / 180)
  const surfaceWidth = (2 * p.maxDepth * Math.tan(halfAngle)).toFixed(2)

  const [sx, sy] = path[0]
  const lines: string[] = []

  lines.push(`; V-Carve — ${p.vAngle}° bit | depth ${p.maxDepth}mm | surface width ${surfaceWidth}mm`)
  lines.push('G21')
  lines.push('G90')
  lines.push(`G0 Z${n(p.safeZ)}`)
  lines.push(`G0 X${n(sx)} Y${n(sy)}`)
  lines.push(`M3 S${p.spindleRPM}`)
  lines.push('G4 P3')
  lines.push(`G1 Z-${n(p.maxDepth)} F${p.plungeRate}`)

  for (let i = 1; i < path.length; i++) {
    lines.push(`G1 X${n(path[i][0])} Y${n(path[i][1])} F${p.feedRate}`)
  }

  lines.push(`G0 Z${n(p.safeZ)}`)
  lines.push('M5')
  lines.push('G0 X0 Y0')

  return lines
}
