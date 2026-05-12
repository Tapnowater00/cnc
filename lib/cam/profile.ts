import type { CanvasShape, CutType } from '@/lib/canvas/store'
import { movesWithTabs, type TabSettings } from './tabs'

export type { CutType }

export interface ProfileParams {
  shape: CanvasShape
  cutType: CutType
  bitDiameter: number
  depth: number
  passDepth: number
  feedRate: number
  plungeRate: number
  spindleRPM: number
  safeZ: number
  tabs?: TabSettings
}

type Point = [number, number]

function rectPath(x: number, y: number, w: number, h: number): Point[] {
  return [[x, y], [x + w, y], [x + w, y + h], [x, y + h], [x, y]]
}

function ellipsePath(cx: number, cy: number, rx: number, ry: number, n = 64): Point[] {
  const pts: Point[] = []
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * Math.PI * 2
    pts.push([cx + rx * Math.cos(a), cy + ry * Math.sin(a)])
  }
  return pts
}

export function generateProfile(p: ProfileParams): string[] {
  const r = p.bitDiameter / 2
  const n = (v: number) => v.toFixed(3)
  const lines: string[] = []
  let path: Point[]

  if (p.shape.type === 'line') {
    const raw = p.shape.points ?? []
    if (raw.length < 4) return ['; ERROR: line has fewer than 2 points']
    path = []
    for (let i = 0; i < raw.length; i += 2) path.push([raw[i], raw[i + 1]])
    if (p.shape.closed && path.length >= 2) path.push(path[0])
  } else if (p.shape.type === 'rect') {
    let { x, y, width, height } = p.shape
    if (p.cutType === 'outside') {
      x -= r; y -= r; width += 2 * r; height += 2 * r
    } else if (p.cutType === 'inside') {
      x += r; y += r; width -= 2 * r; height -= 2 * r
      if (width <= 0 || height <= 0) {
        return ['; ERROR: bit diameter too large for inside cut on this shape']
      }
    }
    path = rectPath(x, y, width, height)
  } else {
    const cx = p.shape.x + p.shape.width / 2
    const cy = p.shape.y + p.shape.height / 2
    let rx = p.shape.width / 2
    let ry = p.shape.height / 2
    if (p.cutType === 'outside') {
      rx += r; ry += r
    } else if (p.cutType === 'inside') {
      rx -= r; ry -= r
      if (rx <= 0 || ry <= 0) {
        return ['; ERROR: bit diameter too large for inside cut on this shape']
      }
    }
    path = ellipsePath(cx, cy, rx, ry)
  }

  const [sx, sy] = path[0]
  const numPasses = Math.ceil(p.depth / p.passDepth)
  const hasTabs = !!p.tabs && p.tabs.count > 0 && p.tabs.width > 0 && p.tabs.height > 0

  lines.push(`; Profile — ${p.shape.type} ${p.cutType} | bit ${p.bitDiameter}mm | depth ${p.depth}mm x ${numPasses} passes${hasTabs ? ` | ${p.tabs!.count} tabs` : ''}`)
  lines.push('G21')
  lines.push('G90')
  lines.push(`G0 Z${n(p.safeZ)}`)
  lines.push(`G0 X${n(sx)} Y${n(sy)}`)
  lines.push(`M3 S${p.spindleRPM}`)
  lines.push('G4 P3')

  for (let pass = 1; pass <= numPasses; pass++) {
    const z = -(Math.min(pass * p.passDepth, p.depth))
    lines.push(`; Pass ${pass}/${numPasses}`)
    lines.push(`G1 Z${n(z)} F${p.plungeRate}`)

    if (hasTabs) {
      const tabMoves = movesWithTabs(path, p.tabs!, z, p.feedRate, p.plungeRate, n)
      lines.push(...tabMoves)
    } else {
      for (let i = 1; i < path.length; i++) {
        lines.push(`G1 X${n(path[i][0])} Y${n(path[i][1])} F${p.feedRate}`)
      }
    }

    if (pass < numPasses) {
      lines.push(`G0 Z${n(p.safeZ)}`)
      lines.push(`G0 X${n(sx)} Y${n(sy)}`)
    }
  }

  lines.push(`G0 Z${n(p.safeZ)}`)
  lines.push('M5')
  lines.push('G0 X0 Y0')

  return lines
}
