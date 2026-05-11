'use client'

import { useState } from 'react'
import { useCanvasStore } from '@/lib/canvas/store'
import { generateProfile, type CutType } from '@/lib/cam/profile'
import { generatePocket }  from '@/lib/cam/pocket'
import { generateDrill }   from '@/lib/cam/drill'
import { generateVCarve }  from '@/lib/cam/vcarve'
import { parseToolpathXYZ } from '@/lib/cam/parsePath'
import { useGrblStore } from '@/lib/grbl/store'

type Mode = 'profile' | 'pocket' | 'drill' | 'vcarve'
type PocketStrategy = 'lines' | 'contour'

const V_ANGLES = [30, 45, 60, 90, 120] as const

export default function CamPanel() {
  const { shapes, selectedId, setToolpath } = useCanvasStore()
  const selected = shapes.find(s => s.id === selectedId)

  const isLine = selected?.type === 'line'

  // Mode
  const [mode, setMode] = useState<Mode>('profile')

  // Profile params
  const [cutType,    setCutType]    = useState<CutType>('outside')
  const [pocketStrat, setPocketStrat] = useState<PocketStrategy>('lines')

  // Tabs
  const [tabsOn,     setTabsOn]     = useState(false)
  const [tabCount,   setTabCount]   = useState(4)
  const [tabWidth,   setTabWidth]   = useState(8)
  const [tabHeight,  setTabHeight]  = useState(3)

  // V-carve
  const [vAngle,     setVAngle]     = useState(60)

  // Drill
  const [dwell,      setDwell]      = useState(0)

  // Common
  const [bitDia,     setBitDia]     = useState(6)
  const [depth,      setDepth]      = useState(10)
  const [passDepth,  setPassDepth]  = useState(2)
  const [feedRate,   setFeedRate]   = useState(1000)
  const [plungeRate, setPlungeRate] = useState(200)
  const [spindleRPM, setSpindleRPM] = useState(18000)
  const [stepoverPct, setStepoverPct] = useState(40)

  const [generated, setGenerated] = useState<string[] | null>(null)
  const dirty = () => setGenerated(null)

  if (!selected) {
    return <p className="text-xs text-zinc-600 italic">Select a shape to set up a cut.</p>
  }

  const generate = () => {
    const common = { bitDiameter: bitDia, depth, passDepth, feedRate, plungeRate, spindleRPM, safeZ: 5 }
    const tabs = tabsOn ? { count: tabCount, width: tabWidth, height: tabHeight } : undefined

    let lines: string[]
    if (isLine || mode === 'profile') {
      lines = generateProfile({
        shape: selected,
        cutType: isLine ? 'on-line' : cutType,
        ...common,
        tabs,
      })
    } else if (mode === 'pocket') {
      lines = generatePocket({ shape: selected, stepoverPct: stepoverPct / 100, strategy: pocketStrat, ...common })
    } else if (mode === 'drill') {
      lines = generateDrill({ shape: selected, depth, passDepth, plungeRate, spindleRPM, safeZ: 5, dwell })
    } else {
      lines = generateVCarve({ shape: selected, vAngle, maxDepth: depth, feedRate, plungeRate, spindleRPM, safeZ: 5 })
    }

    setGenerated(lines)
    setToolpath(parseToolpathXYZ(lines))
  }

  const loadToSender = () => {
    if (!generated) return
    const blob = new Blob([generated.join('\n')], { type: 'text/plain' })
    const suffix = isLine ? 'line' : mode === 'profile' ? cutType : mode
    useGrblStore.getState().loadFile(new File([blob], `${selected.type}-${suffix}.gcode`))
  }

  const isError   = generated?.[0]?.startsWith('; ERROR')
  const moveCount = generated?.filter(l => !l.startsWith(';')).length ?? 0
  const numPasses = mode === 'drill'
    ? Math.ceil(depth / passDepth)
    : mode === 'vcarve'
    ? 1
    : Math.ceil(depth / passDepth)

  return (
    <div className="space-y-3">

      {/* Header */}
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-zinc-400 uppercase tracking-wide">
          CAM — {selected.type}{selected.type !== 'line'
            ? ` ${Math.round(selected.width)}×${Math.round(selected.height)}mm`
            : ` (${(selected.points?.length ?? 0) / 2} pts)`}
        </span>
        {generated && !isError && (
          <button onClick={() => setToolpath(null)} className="text-xs text-zinc-600 hover:text-zinc-400">
            hide path
          </button>
        )}
      </div>

      {/* Mode tabs */}
      {isLine ? (
        <p className="text-xs text-zinc-600 italic">On-line cut · bit centre follows the path</p>
      ) : (
        <div className="grid grid-cols-4 gap-1">
          {(['profile', 'pocket', 'drill', 'vcarve'] as Mode[]).map(m => (
            <button
              key={m}
              onClick={() => { setMode(m); dirty() }}
              className={`py-1 text-xs rounded capitalize transition-colors ${
                mode === m ? 'bg-cyan-600 text-white' : 'bg-zinc-700 text-zinc-300 hover:bg-zinc-600'
              }`}
            >
              {m === 'vcarve' ? 'V-Carve' : m.charAt(0).toUpperCase() + m.slice(1)}
            </button>
          ))}
        </div>
      )}

      {/* Profile: cut type */}
      {!isLine && mode === 'profile' && (
        <div className="flex gap-1">
          {([
            { id: 'outside', label: 'Outside' },
            { id: 'on-line', label: 'On-line' },
            { id: 'inside',  label: 'Inside'  },
          ] as { id: CutType; label: string }[]).map(ct => (
            <button
              key={ct.id}
              onClick={() => { setCutType(ct.id as CutType); dirty() }}
              className={`flex-1 py-1 text-xs rounded transition-colors ${
                cutType === ct.id ? 'bg-cyan-700 text-white' : 'bg-zinc-700 text-zinc-300 hover:bg-zinc-600'
              }`}
            >
              {ct.label}
            </button>
          ))}
        </div>
      )}

      {/* Pocket: strategy */}
      {!isLine && mode === 'pocket' && (
        <div className="flex gap-1">
          {([
            { id: 'lines',   label: 'Zigzag'   },
            { id: 'contour', label: 'Contour'  },
          ] as { id: PocketStrategy; label: string }[]).map(s => (
            <button
              key={s.id}
              onClick={() => { setPocketStrat(s.id); dirty() }}
              className={`flex-1 py-1 text-xs rounded transition-colors ${
                pocketStrat === s.id ? 'bg-cyan-700 text-white' : 'bg-zinc-700 text-zinc-300 hover:bg-zinc-600'
              }`}
            >
              {s.label}
            </button>
          ))}
        </div>
      )}

      {/* V-carve: bit angle selector */}
      {!isLine && mode === 'vcarve' && (
        <div className="space-y-1.5">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs text-zinc-500">V angle (°)</span>
            <div className="flex gap-1">
              {V_ANGLES.map(a => (
                <button
                  key={a}
                  onClick={() => { setVAngle(a); dirty() }}
                  className={`px-2 py-0.5 text-xs rounded transition-colors ${
                    vAngle === a ? 'bg-cyan-700 text-white' : 'bg-zinc-700 text-zinc-400 hover:bg-zinc-600'
                  }`}
                >
                  {a}°
                </button>
              ))}
            </div>
          </div>
          <p className="text-xs text-zinc-600">
            Surface width at {depth}mm: {(2 * depth * Math.tan((vAngle / 2) * Math.PI / 180)).toFixed(2)}mm
          </p>
        </div>
      )}

      {/* Common params — hide bit dia for vcarve (V-bits are defined by angle) */}
      <div className="space-y-1.5">
        {mode !== 'vcarve' && (
          <Row label="Bit dia (mm)"    value={bitDia}     onChange={v => { setBitDia(v);     dirty() }} step={0.5}  min={0.1} />
        )}
        <Row label="Depth (mm)"        value={depth}      onChange={v => { setDepth(v);      dirty() }} step={0.5}  min={0.1} />
        {mode !== 'drill' && mode !== 'vcarve' && (
          <Row label="Pass depth (mm)" value={passDepth}  onChange={v => { setPassDepth(v);  dirty() }} step={0.5}  min={0.1} />
        )}
        {mode === 'drill' && (
          <Row label="Peck depth (mm)" value={passDepth}  onChange={v => { setPassDepth(v);  dirty() }} step={0.5}  min={0.1} />
        )}
        {mode !== 'drill' && (
          <Row label="Feed (mm/min)"   value={feedRate}   onChange={v => { setFeedRate(v);   dirty() }} step={100}  min={10}  />
        )}
        <Row label="Plunge (mm/min)"   value={plungeRate} onChange={v => { setPlungeRate(v); dirty() }} step={50}   min={10}  />
        <Row label="Spindle (RPM)"     value={spindleRPM} onChange={v => { setSpindleRPM(v); dirty() }} step={1000} min={100} />
        {mode === 'pocket' && (
          <Row label="Stepover (%)"    value={stepoverPct} onChange={v => { setStepoverPct(v); dirty() }} step={5} min={10} />
        )}
        {mode === 'drill' && (
          <Row label="Dwell (s)"       value={dwell}      onChange={v => { setDwell(v);      dirty() }} step={0.5}  min={0}   />
        )}
      </div>

      {/* Tabs — only for profile mode */}
      {(isLine || mode === 'profile') && (
        <div className="border border-zinc-700 rounded p-2 space-y-1.5">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={tabsOn}
              onChange={e => { setTabsOn(e.target.checked); dirty() }}
              className="accent-cyan-500"
            />
            <span className="text-xs text-zinc-400 font-medium">Holding Tabs</span>
          </label>
          {tabsOn && (
            <>
              <Row label="Count"      value={tabCount}  onChange={v => { setTabCount(Math.round(v));  dirty() }} step={1}   min={1} />
              <Row label="Width (mm)" value={tabWidth}  onChange={v => { setTabWidth(v);  dirty() }} step={1}   min={1} />
              <Row label="Height (mm)"value={tabHeight} onChange={v => { setTabHeight(v); dirty() }} step={0.5} min={0.5} />
              <p className="text-xs text-zinc-600">Tabs kick in once pass depth exceeds {tabHeight}mm</p>
            </>
          )}
        </div>
      )}

      {/* Pass count / info line */}
      <p className="text-xs text-zinc-600">
        {mode === 'vcarve'
          ? '1 pass · single depth'
          : `${numPasses} pass${numPasses !== 1 ? 'es' : ''} · safe Z 5mm`}
      </p>

      {/* Generate button */}
      <button
        onClick={generate}
        className="w-full py-1.5 text-xs font-semibold bg-cyan-700 hover:bg-cyan-600 text-white rounded transition-colors"
      >
        Generate G-code
      </button>

      {/* Result */}
      {generated && (
        <div className="space-y-2">
          {isError ? (
            <p className="text-xs text-red-400 bg-red-900/30 rounded p-2 border border-red-800">
              {generated[0].replace('; ERROR: ', '')}
            </p>
          ) : (
            <>
              <p className="text-xs text-zinc-400">{moveCount} lines · preview on canvas</p>
              <div className="bg-zinc-800 rounded p-2 max-h-36 overflow-y-auto font-mono text-xs space-y-px">
                {generated.slice(0, 22).map((line, i) => (
                  <div key={i} className={line.startsWith(';') ? 'text-zinc-600' : 'text-zinc-300'}>
                    {line}
                  </div>
                ))}
                {generated.length > 22 && (
                  <div className="text-zinc-600">… {generated.length - 22} more lines</div>
                )}
              </div>
              <button
                onClick={loadToSender}
                className="w-full py-1.5 text-xs font-semibold bg-green-700 hover:bg-green-600 text-white rounded transition-colors"
              >
                Load to Sender ↓
              </button>
            </>
          )}
        </div>
      )}
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
        type="number"
        value={value}
        onChange={e => { const v = parseFloat(e.target.value); if (!isNaN(v) && v >= min) onChange(v) }}
        step={step}
        min={min}
        className="w-20 bg-zinc-800 border border-zinc-600 rounded px-2 py-0.5 text-xs text-zinc-100 text-right"
      />
    </div>
  )
}
