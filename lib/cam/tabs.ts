type Point = [number, number]

export interface TabSettings {
  count: number   // number of tabs
  width: number   // mm — how wide each tab is along the path
  height: number  // mm — how tall (uncut) each tab is
}

function arcLengths(path: Point[]): number[] {
  const lens: number[] = [0]
  for (let i = 1; i < path.length; i++) {
    const dx = path[i][0] - path[i - 1][0]
    const dy = path[i][1] - path[i - 1][1]
    lens.push(lens[i - 1] + Math.sqrt(dx * dx + dy * dy))
  }
  return lens
}

function pointAtArcLen(path: Point[], lens: number[], s: number): Point {
  if (s <= 0) return path[0]
  const L = lens[lens.length - 1]
  if (s >= L) return path[path.length - 1]
  let lo = 0, hi = lens.length - 1
  while (lo + 1 < hi) {
    const mid = (lo + hi) >> 1
    if (lens[mid] <= s) lo = mid; else hi = mid
  }
  const segLen = lens[hi] - lens[lo]
  if (segLen < 1e-9) return path[lo]
  const f = (s - lens[lo]) / segLen
  return [
    path[lo][0] + (path[hi][0] - path[lo][0]) * f,
    path[lo][1] + (path[hi][1] - path[lo][1]) * f,
  ]
}

/**
 * Generate G1 move lines for one depth pass, inserting tab lifts.
 * Caller is responsible for the initial G1 Z plunge before calling this.
 * passZ is negative (e.g. -4.0).  tabZ is the Z height to lift to for tabs.
 */
export function movesWithTabs(
  path: Point[],
  tabs: TabSettings,
  passZ: number,
  feedRate: number,
  plungeRate: number,
  fmt: (v: number) => string
): string[] {
  // Tab lifts only matter when the current pass is deeper than the tab height
  const tabZ = passZ + tabs.height   // e.g. -4 + 3 = -1 (still below surface)
  const needLift = tabZ < 0          // only worth lifting if we're below surface

  if (!needLift || tabs.count <= 0 || tabs.width <= 0) {
    // Simple pass — no tabs needed at this depth
    return path.slice(1).map(p => `G1 X${fmt(p[0])} Y${fmt(p[1])} F${feedRate}`)
  }

  const lens = arcLengths(path)
  const L = lens[lens.length - 1]
  if (L < 1e-6) return []

  // Build tab ranges: [startArc, endArc]
  const bands: [number, number][] = []
  for (let i = 0; i < tabs.count; i++) {
    const centre = L * (i + 0.5) / tabs.count
    bands.push([
      Math.max(0, centre - tabs.width / 2),
      Math.min(L, centre + tabs.width / 2),
    ])
  }

  // Collect enter/exit events sorted by arc length
  type Event = { s: number; pt: Point; entering: boolean }
  const events: Event[] = []
  for (const [a, b] of bands) {
    events.push({ s: a, pt: pointAtArcLen(path, lens, a), entering: true  })
    events.push({ s: b, pt: pointAtArcLen(path, lens, b), entering: false })
  }
  events.sort((a, b) => a.s - b.s)

  const lines: string[] = []
  let eIdx = 0
  let inTab = false

  for (let i = 1; i < path.length; i++) {
    const segArc = lens[i]

    // Flush events that fall before this path point
    while (eIdx < events.length && events[eIdx].s < segArc) {
      const ev = events[eIdx++]
      lines.push(`G1 X${fmt(ev.pt[0])} Y${fmt(ev.pt[1])} F${feedRate}`)
      if (ev.entering && !inTab) {
        lines.push(`G1 Z${fmt(tabZ)} F${feedRate}`)   // lift over tab
        inTab = true
      } else if (!ev.entering && inTab) {
        lines.push(`G1 Z${fmt(passZ)} F${plungeRate}`) // plunge back
        inTab = false
      }
    }

    lines.push(`G1 X${fmt(path[i][0])} Y${fmt(path[i][1])} F${feedRate}`)
  }

  // Ensure we're back at cut depth at end (shouldn't be in tab for closed paths)
  if (inTab) lines.push(`G1 Z${fmt(passZ)} F${plungeRate}`)

  return lines
}
