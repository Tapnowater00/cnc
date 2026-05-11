import type { CanvasShape } from '@/lib/canvas/store'

export interface PocketParams {
  shape: CanvasShape
  bitDiameter: number
  depth: number
  passDepth: number
  stepoverPct: number   // fraction of bit diameter, e.g. 0.4 = 40%
  feedRate: number
  plungeRate: number
  spindleRPM: number
  safeZ: number
  strategy: 'lines' | 'contour'  // zigzag rows or concentric offsets
}

type Row = [number, number, number]  // [x1, x2, y]
type Point = [number, number]

// ── Zigzag (lines) strategy ────────────────────────────────────────────────

function zigzagRows(shape: CanvasShape, r: number, stepover: number): Row[] | string {
  const rows: Row[] = []
  if (shape.type === 'rect') {
    const px = shape.x + r, py = shape.y + r
    const pw = shape.width - 2 * r, ph = shape.height - 2 * r
    if (pw <= 0 || ph <= 0) return '; ERROR: bit too large for pocket on this shape'
    let y = py, goLeft = false
    while (y <= py + ph + 0.001) {
      rows.push(goLeft ? [px + pw, px, y] : [px, px + pw, y])
      y += stepover; goLeft = !goLeft
    }
  } else {
    const cx = shape.x + shape.width / 2, cy = shape.y + shape.height / 2
    const rx = shape.width / 2 - r,       ry = shape.height / 2 - r
    if (rx <= 0 || ry <= 0) return '; ERROR: bit too large for pocket on this shape'
    let y = cy - ry, goLeft = false
    while (y <= cy + ry + 0.001) {
      const t  = (y - cy) / ry
      const dx = rx * Math.sqrt(Math.max(0, 1 - t * t))
      if (dx > 0.01) rows.push(goLeft ? [cx + dx, cx - dx, y] : [cx - dx, cx + dx, y])
      y += stepover; goLeft = !goLeft
    }
  }
  return rows
}

// ── Contour (concentric offset) strategy ───────────────────────────────────

function rectRing(x: number, y: number, w: number, h: number): Point[] {
  return [[x, y], [x + w, y], [x + w, y + h], [x, y + h], [x, y]]
}

function ellipseRing(cx: number, cy: number, rx: number, ry: number, segs = 72): Point[] {
  const pts: Point[] = []
  for (let i = 0; i <= segs; i++) {
    const a = (i / segs) * Math.PI * 2
    pts.push([cx + rx * Math.cos(a), cy + ry * Math.sin(a)])
  }
  return pts
}

function contourRings(shape: CanvasShape, r: number, stepover: number): Point[][] | string {
  const rings: Point[][] = []
  if (shape.type === 'rect') {
    let inset = r
    while (true) {
      const x = shape.x + inset, y = shape.y + inset
      const w = shape.width - 2 * inset, h = shape.height - 2 * inset
      if (w <= 0 || h <= 0) break
      rings.push(rectRing(x, y, w, h))
      inset += stepover
    }
  } else {
    const cx = shape.x + shape.width / 2, cy = shape.y + shape.height / 2
    let rx = shape.width / 2 - r, ry = shape.height / 2 - r
    while (rx > 0 && ry > 0) {
      rings.push(ellipseRing(cx, cy, rx, ry))
      rx -= stepover; ry -= stepover
    }
  }
  if (rings.length === 0) return '; ERROR: bit too large for pocket on this shape'
  // Easel cuts from outside in — reverse so we start at inner ring and spiral out
  // Actually outer-to-inner is more common and safer; keep as-is (outermost first)
  return rings.reverse()  // innermost first → better chip clearing
}

// ── Main generator ─────────────────────────────────────────────────────────

export function generatePocket(p: PocketParams): string[] {
  const r = p.bitDiameter / 2
  const stepover = p.bitDiameter * p.stepoverPct
  const n = (v: number) => v.toFixed(3)
  const numPasses = Math.ceil(p.depth / p.passDepth)

  if (p.shape.type === 'line') {
    return ['; ERROR: pocket operation not supported on line shapes']
  }

  const lines: string[] = []

  if (p.strategy === 'lines') {
    const rows = zigzagRows(p.shape, r, stepover)
    if (typeof rows === 'string') return [rows]

    lines.push(`; Pocket (zigzag) — ${p.shape.type} | bit ${p.bitDiameter}mm | depth ${p.depth}mm x ${numPasses} passes | stepover ${Math.round(p.stepoverPct * 100)}%`)
    lines.push('G21'); lines.push('G90')
    lines.push(`G0 Z${n(p.safeZ)}`)
    lines.push(`G0 X${n(rows[0][0])} Y${n(rows[0][2])}`)
    lines.push(`M3 S${p.spindleRPM}`)
    lines.push('G4 P3')

    for (let pass = 1; pass <= numPasses; pass++) {
      const z = Math.min(pass * p.passDepth, p.depth)
      lines.push(`; Pass ${pass}/${numPasses}`)
      lines.push(`G1 Z-${n(z)} F${p.plungeRate}`)
      for (const [x1, x2, y] of rows) {
        lines.push(`G1 X${n(x1)} Y${n(y)} F${p.feedRate}`)
        lines.push(`G1 X${n(x2)} Y${n(y)} F${p.feedRate}`)
      }
      if (pass < numPasses) {
        lines.push(`G0 Z${n(p.safeZ)}`)
        lines.push(`G0 X${n(rows[0][0])} Y${n(rows[0][2])}`)
      }
    }

  } else {
    // Contour
    const rings = contourRings(p.shape, r, stepover)
    if (typeof rings === 'string') return [rings]

    const start = rings[0][0]
    lines.push(`; Pocket (contour) — ${p.shape.type} | bit ${p.bitDiameter}mm | depth ${p.depth}mm x ${numPasses} passes | stepover ${Math.round(p.stepoverPct * 100)}%`)
    lines.push('G21'); lines.push('G90')
    lines.push(`G0 Z${n(p.safeZ)}`)
    lines.push(`G0 X${n(start[0])} Y${n(start[1])}`)
    lines.push(`M3 S${p.spindleRPM}`)
    lines.push('G4 P3')

    for (let pass = 1; pass <= numPasses; pass++) {
      const z = Math.min(pass * p.passDepth, p.depth)
      lines.push(`; Pass ${pass}/${numPasses}`)
      lines.push(`G1 Z-${n(z)} F${p.plungeRate}`)
      for (const ring of rings) {
        lines.push(`G0 X${n(ring[0][0])} Y${n(ring[0][1])}`)
        for (let i = 1; i < ring.length; i++) {
          lines.push(`G1 X${n(ring[i][0])} Y${n(ring[i][1])} F${p.feedRate}`)
        }
      }
      if (pass < numPasses) {
        lines.push(`G0 Z${n(p.safeZ)}`)
        lines.push(`G0 X${n(start[0])} Y${n(start[1])}`)
      }
    }
  }

  lines.push(`G0 Z${n(p.safeZ)}`)
  lines.push('M5')
  lines.push('G0 X0 Y0')

  return lines
}
