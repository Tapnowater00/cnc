import type { CanvasShape } from '@/lib/canvas/store'

export interface DrillParams {
  shape: CanvasShape
  depth: number       // mm total depth
  passDepth: number   // mm peck depth per retract cycle
  plungeRate: number  // mm/min
  spindleRPM: number
  safeZ: number
  dwell: number       // seconds to dwell at bottom (0 = none)
}

export function generateDrill(p: DrillParams): string[] {
  const n = (v: number) => v.toFixed(3)

  // Collect drill points
  const pts: [number, number][] = []

  if (p.shape.type === 'circle' || p.shape.type === 'rect') {
    pts.push([
      p.shape.x + p.shape.width  / 2,
      p.shape.y + p.shape.height / 2,
    ])
  } else {
    // line — drill at every vertex
    const raw = p.shape.points ?? []
    for (let i = 0; i < raw.length; i += 2) {
      pts.push([raw[i], raw[i + 1]])
    }
  }

  if (pts.length === 0) return ['; ERROR: no drill points found']

  const numPecks = Math.ceil(p.depth / p.passDepth)
  const lines: string[] = []

  lines.push(`; Drill — ${pts.length} hole${pts.length > 1 ? 's' : ''} | depth ${p.depth}mm | ${numPecks} peck${numPecks > 1 ? 's' : ''}`)
  lines.push('G21')
  lines.push('G90')
  lines.push(`G0 Z${n(p.safeZ)}`)
  lines.push(`M3 S${p.spindleRPM}`)
  lines.push('G4 P3')

  for (const [x, y] of pts) {
    lines.push(`; Hole X${n(x)} Y${n(y)}`)
    lines.push(`G0 X${n(x)} Y${n(y)}`)
    for (let peck = 1; peck <= numPecks; peck++) {
      const z = Math.min(peck * p.passDepth, p.depth)
      lines.push(`G1 Z-${n(z)} F${p.plungeRate}`)
      if (p.dwell > 0 && peck === numPecks) lines.push(`G4 P${p.dwell}`)
      lines.push(`G0 Z${n(p.safeZ)}`)   // full retract between pecks
    }
  }

  lines.push('M5')
  lines.push('G0 X0 Y0')

  return lines
}
