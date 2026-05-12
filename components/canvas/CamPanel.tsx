'use client'

import { useState } from 'react'
import { useCanvasStore, DEFAULT_CUT_SETTINGS } from '@/lib/canvas/store'
import type { ShapeCutSettings, CutType, CutMode, PocketStrategy } from '@/lib/canvas/store'
import { generateProfile } from '@/lib/cam/profile'
import { generatePocket }  from '@/lib/cam/pocket'
import { generateDrill }   from '@/lib/cam/drill'
import { generateVCarve }  from '@/lib/cam/vcarve'
import { parseToolpathXYZ } from '@/lib/cam/parsePath'
import { useGrblStore } from '@/lib/grbl/store'

const V_ANGLES = [30, 45, 60, 90, 120] as const

export default function CamPanel() {
  const { shapes, selectedId, updateShape, setToolpath } = useCanvasStore()
  const selected = shapes.find(s => s.id === selectedId)
  const isLine = selected?.type === 'line'

  // Per-shape gcode preview state (not persisted — regenerate to refresh)
  const [generated, setGenerated] = useState<string[] | null>(null)
  const [lastShapeId, setLastShapeId] = useState<string | null>(null)

  // Clear preview when selection changes
  if (selected?.id !== lastShapeId) {
    setLastShapeId(selected?.id ?? null)
    if (generated !== null) setGenerated(null)
  }

  // ── No shape selected ─────────────────────────────────────────
  if (!selected) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3 px-4 text-center">
        <div className="text-3xl">✦</div>
        <p className="text-sm font-medium text-zinc-300">Select a shape to set up a cut</p>
        <p className="text-xs text-zinc-600">
          Draw a shape on the canvas, then click it to select it — the CAM controls will appear here.
        </p>
      </div>
    )
  }

  // Per-shape settings, falling back to defaults
  const cs: ShapeCutSettings = selected.cutSettings ?? DEFAULT_CUT_SETTINGS

  const update = (patch: Partial<ShapeCutSettings>) => {
    updateShape(selected.id, { cutSettings: { ...cs, ...patch } })
    setGenerated(null)
  }

  // ── Generate ──────────────────────────────────────────────────
  const generate = () => {
    const common = {
      bitDiameter: cs.bitDia,
      depth: cs.depth,
      passDepth: cs.passDepth,
      feedRate: cs.feedRate,
      plungeRate: cs.plungeRate,
      spindleRPM: cs.spindleRPM,
      safeZ: 5,
    }
    const tabs = cs.tabsOn ? { count: cs.tabCount, width: cs.tabWidth, height: cs.tabHeight } : undefined
    let lines: string[]

    if (isLine || cs.mode === 'profile') {
      lines = generateProfile({ shape: selected, cutType: isLine ? 'on-line' : cs.cutType, ...common, tabs })
    } else if (cs.mode === 'pocket') {
      lines = generatePocket({ shape: selected, stepoverPct: cs.stepoverPct / 100, strategy: cs.pocketStrat, ...common })
    } else if (cs.mode === 'drill') {
      lines = generateDrill({ shape: selected, depth: cs.depth, passDepth: cs.passDepth, plungeRate: cs.plungeRate, spindleRPM: cs.spindleRPM, safeZ: 5, dwell: cs.dwell })
    } else {
      lines = generateVCarve({ shape: selected, vAngle: cs.vAngle, maxDepth: cs.depth, feedRate: cs.feedRate, plungeRate: cs.plungeRate, spindleRPM: cs.spindleRPM, safeZ: 5 })
    }

    setGenerated(lines)
    const simBitDia = cs.mode === 'vcarve' ? 0.5 : cs.bitDia
    setToolpath(parseToolpathXYZ(lines), simBitDia)
  }

  const loadToSender = () => {
    if (!generated) return
    const suffix = isLine ? 'line' : cs.mode === 'profile' ? cs.cutType : cs.mode
    const blob = new Blob([generated.join('\n')], { type: 'text/plain' })
    useGrblStore.getState().loadFile(new File([blob], `${selected.type}-${suffix}.gcode`))
  }

  const isError   = generated?.[0]?.startsWith('; ERROR')
  const moveCount = generated?.filter(l => !l.startsWith(';')).length ?? 0
  const numPasses = cs.mode === 'vcarve' ? 1 : Math.ceil(cs.depth / cs.passDepth)

  // ── Shape selected ────────────────────────────────────────────
  return (
    <div className="flex flex-col h-full overflow-hidden">

      {/* ── Scrollable params ─────────────────────────────── */}
      <div className="flex-1 overflow-y-auto p-3 space-y-3">

        {/* Header */}
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold text-zinc-400 uppercase tracking-wide">
            CAM — {selected.type}
            {selected.type !== 'line'
              ? ` ${Math.round(selected.width)}×${Math.round(selected.height)}mm`
              : ` (${(selected.points?.length ?? 0) / 2} pts)`}
          </span>
          {generated && !isError && (
            <button onClick={() => { setToolpath(null); setGenerated(null) }} className="text-xs text-zinc-600 hover:text-zinc-400">
              clear
            </button>
          )}
        </div>

        {/* Mode tabs */}
        {isLine ? (
          <p className="text-xs text-zinc-500 italic">On-line cut · bit follows the path</p>
        ) : (
          <div className="grid grid-cols-4 gap-1">
            {(['profile', 'pocket', 'drill', 'vcarve'] as CutMode[]).map(m => (
              <button key={m} onClick={() => update({ mode: m })}
                className={`py-1.5 text-xs rounded transition-colors ${cs.mode === m ? 'bg-cyan-600 text-white' : 'bg-zinc-700 text-zinc-300 hover:bg-zinc-600'}`}>
                {m === 'vcarve' ? 'V-Carve' : m[0].toUpperCase() + m.slice(1)}
              </button>
            ))}
          </div>
        )}

        {/* Profile cut type */}
        {!isLine && cs.mode === 'profile' && (
          <div className="flex gap-1">
            {([['outside','Outside'],['on-line','On-line'],['inside','Inside']] as [CutType,string][]).map(([id,label]) => (
              <button key={id} onClick={() => update({ cutType: id })}
                className={`flex-1 py-1 text-xs rounded transition-colors ${cs.cutType === id ? 'bg-cyan-700 text-white' : 'bg-zinc-700 text-zinc-300 hover:bg-zinc-600'}`}>
                {label}
              </button>
            ))}
          </div>
        )}

        {/* Pocket strategy */}
        {!isLine && cs.mode === 'pocket' && (
          <div className="flex gap-1">
            {([['lines','Zigzag'],['contour','Contour']] as [PocketStrategy,string][]).map(([id,label]) => (
              <button key={id} onClick={() => update({ pocketStrat: id })}
                className={`flex-1 py-1 text-xs rounded transition-colors ${cs.pocketStrat === id ? 'bg-cyan-700 text-white' : 'bg-zinc-700 text-zinc-300 hover:bg-zinc-600'}`}>
                {label}
              </button>
            ))}
          </div>
        )}

        {/* V-carve angle */}
        {!isLine && cs.mode === 'vcarve' && (
          <div className="space-y-1">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs text-zinc-500">V angle</span>
              <div className="flex gap-1">
                {V_ANGLES.map(a => (
                  <button key={a} onClick={() => update({ vAngle: a })}
                    className={`px-1.5 py-0.5 text-xs rounded transition-colors ${cs.vAngle === a ? 'bg-cyan-700 text-white' : 'bg-zinc-700 text-zinc-400 hover:bg-zinc-600'}`}>
                    {a}°
                  </button>
                ))}
              </div>
            </div>
            <p className="text-xs text-zinc-600">
              Width at {cs.depth}mm: {(2 * cs.depth * Math.tan((cs.vAngle / 2) * Math.PI / 180)).toFixed(2)}mm
            </p>
          </div>
        )}

        {/* Params */}
        <div className="space-y-1.5">
          {cs.mode !== 'vcarve' && (
            <Row label="Bit dia (mm)"    value={cs.bitDia}      onChange={v => update({ bitDia: v })}      step={0.5}  min={0.1} />
          )}
          <Row label="Depth (mm)"        value={cs.depth}       onChange={v => update({ depth: v })}       step={0.5}  min={0.1} />
          {cs.mode !== 'vcarve' && (
            <Row label={cs.mode === 'drill' ? 'Peck depth (mm)' : 'Pass depth (mm)'} value={cs.passDepth} onChange={v => update({ passDepth: v })} step={0.5} min={0.1} />
          )}
          {cs.mode !== 'drill' && (
            <Row label="Feed (mm/min)"   value={cs.feedRate}    onChange={v => update({ feedRate: v })}    step={100}  min={10}  />
          )}
          <Row label="Plunge (mm/min)"   value={cs.plungeRate}  onChange={v => update({ plungeRate: v })}  step={50}   min={10}  />
          <Row label="Spindle (RPM)"     value={cs.spindleRPM}  onChange={v => update({ spindleRPM: v })}  step={1000} min={100} />
          {cs.mode === 'pocket' && (
            <Row label="Stepover (%)"    value={cs.stepoverPct} onChange={v => update({ stepoverPct: v })} step={5}    min={10}  />
          )}
          {cs.mode === 'drill' && (
            <Row label="Dwell (s)"       value={cs.dwell}       onChange={v => update({ dwell: v })}       step={0.5}  min={0}   />
          )}
        </div>

        {/* Holding tabs */}
        {(isLine || cs.mode === 'profile') && (
          <div className="border border-zinc-700 rounded p-2 space-y-1.5">
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={cs.tabsOn} onChange={e => update({ tabsOn: e.target.checked })} className="accent-cyan-500" />
              <span className="text-xs text-zinc-400 font-medium">Holding Tabs</span>
            </label>
            {cs.tabsOn && (
              <>
                <Row label="Count"      value={cs.tabCount}  onChange={v => update({ tabCount: Math.round(v) })} step={1}   min={1}   />
                <Row label="Width (mm)" value={cs.tabWidth}  onChange={v => update({ tabWidth: v })}              step={1}   min={1}   />
                <Row label="Height(mm)" value={cs.tabHeight} onChange={v => update({ tabHeight: v })}             step={0.5} min={0.5} />
              </>
            )}
          </div>
        )}

        <p className="text-xs text-zinc-600">
          {cs.mode === 'vcarve' ? '1 pass · single depth' : `${numPasses} pass${numPasses !== 1 ? 'es' : ''} · safe Z 5mm`}
        </p>

      </div>

      {/* ── Sticky footer: generate + result ──────────────── */}
      <div className="flex-shrink-0 border-t border-zinc-700 p-3 space-y-2">
        <button
          onClick={generate}
          className="w-full py-2 text-sm font-bold bg-cyan-600 hover:bg-cyan-500 text-white rounded transition-colors"
        >
          ▶ Generate G-code
        </button>

        {generated && (
          isError ? (
            <p className="text-xs text-red-400 bg-red-900/30 rounded p-2 border border-red-800">
              {generated[0].replace('; ERROR: ', '')}
            </p>
          ) : (
            <div className="space-y-2">
              <p className="text-xs text-cyan-400 font-medium">✓ {moveCount} lines — preview shown on canvas</p>
              <div className="bg-zinc-800 rounded p-2 max-h-28 overflow-y-auto font-mono text-xs space-y-px">
                {generated.slice(0, 18).map((line, i) => (
                  <div key={i} className={line.startsWith(';') ? 'text-zinc-600' : 'text-zinc-300'}>{line}</div>
                ))}
                {generated.length > 18 && (
                  <div className="text-zinc-600">… {generated.length - 18} more lines</div>
                )}
              </div>
              <button
                onClick={loadToSender}
                className="w-full py-1.5 text-xs font-semibold bg-green-700 hover:bg-green-600 text-white rounded transition-colors"
              >
                Load to G-code Sender ↓
              </button>
            </div>
          )
        )}
      </div>

    </div>
  )
}

function Row({ label, value, onChange, step, min }: {
  label: string; value: number; onChange: (v: number) => void; step: number; min: number
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-xs text-zinc-500">{label}</span>
      <input
        type="number" value={value} step={step} min={min}
        onChange={e => { const v = parseFloat(e.target.value); if (!isNaN(v) && v >= min) onChange(v) }}
        className="w-20 bg-zinc-800 border border-zinc-600 rounded px-2 py-0.5 text-xs text-zinc-100 text-right"
      />
    </div>
  )
}
