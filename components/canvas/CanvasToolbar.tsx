'use client'

import { useRef } from 'react'
import { useCanvasStore, type Tool, type CanvasShape } from '@/lib/canvas/store'

const TOOLS: { id: Tool; label: string }[] = [
  { id: 'select',  label: '↖ Select'    },
  { id: 'rect',    label: '▭ Rectangle' },
  { id: 'circle',  label: '○ Circle'    },
  { id: 'line',    label: '╱ Line'      },
]

function parseLen(s: string): number {
  if (!s) return 0
  const v = parseFloat(s)
  if (isNaN(v)) return 0
  if (s.endsWith('mm')) return v
  if (s.endsWith('cm')) return v * 10
  if (s.endsWith('in')) return v * 25.4
  return v * 25.4 / 96   // assume px at 96 dpi
}

export default function CanvasToolbar() {
  const { tool, setTool, selectedId, shapes, updateShape, deleteSelected,
          materialW, materialH, materialDepth, setMaterial, addShape, setToolpath,
          view, setView } = useCanvasStore()

  const svgInputRef = useRef<HTMLInputElement>(null)
  const projInputRef = useRef<HTMLInputElement>(null)
  const selected = shapes.find(s => s.id === selectedId)

  // ── SVG import ────────────────────────────────────────────────
  const importSVG = async (file: File) => {
    const text = await file.text()
    const doc  = new DOMParser().parseFromString(text, 'image/svg+xml')
    const svg  = doc.querySelector('svg')
    if (!svg) return

    // Compute scale: viewBox units → mm
    const vb = svg.getAttribute('viewBox')?.split(/[\s,]+/).map(Number)
    const svgW = parseLen(svg.getAttribute('width')  ?? '0')
    const svgH = parseLen(svg.getAttribute('height') ?? '0')
    const vbW  = vb?.[2] ?? (svgW || 100)
    const vbH  = vb?.[3] ?? (svgH || 100)
    const sx   = svgW > 0 ? svgW / vbW : 25.4 / 96
    const sy   = svgH > 0 ? svgH / vbH : 25.4 / 96

    const newShapes: CanvasShape[] = []

    svg.querySelectorAll('rect').forEach(el => {
      const x = parseFloat(el.getAttribute('x') ?? '0') * sx
      const y = parseFloat(el.getAttribute('y') ?? '0') * sy
      const w = parseFloat(el.getAttribute('width')  ?? '0') * sx
      const h = parseFloat(el.getAttribute('height') ?? '0') * sy
      if (w > 0 && h > 0) newShapes.push({ id: crypto.randomUUID(), type: 'rect', x, y, width: w, height: h })
    })

    svg.querySelectorAll('circle').forEach(el => {
      const r  = parseFloat(el.getAttribute('r')  ?? '0') * sx
      const cx = parseFloat(el.getAttribute('cx') ?? '0') * sx
      const cy = parseFloat(el.getAttribute('cy') ?? '0') * sy
      if (r > 0) newShapes.push({ id: crypto.randomUUID(), type: 'circle', x: cx - r, y: cy - r, width: r * 2, height: r * 2 })
    })

    svg.querySelectorAll('ellipse').forEach(el => {
      const rx = parseFloat(el.getAttribute('rx') ?? '0') * sx
      const ry = parseFloat(el.getAttribute('ry') ?? '0') * sy
      const cx = parseFloat(el.getAttribute('cx') ?? '0') * sx
      const cy = parseFloat(el.getAttribute('cy') ?? '0') * sy
      if (rx > 0 && ry > 0) newShapes.push({ id: crypto.randomUUID(), type: 'circle', x: cx - rx, y: cy - ry, width: rx * 2, height: ry * 2 })
    })

    newShapes.forEach(s => addShape(s))
  }

  // ── Project save ──────────────────────────────────────────────
  const saveProject = () => {
    const data = JSON.stringify({ shapes, materialW, materialH }, null, 2)
    const blob = new Blob([data], { type: 'application/json' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = 'project.tapjson'
    a.click()
    URL.revokeObjectURL(a.href)
  }

  // ── Project load ──────────────────────────────────────────────
  const loadProject = async (file: File) => {
    try {
      const data = JSON.parse(await file.text())
      if (data.materialW) setMaterial(data.materialW, data.materialH)
      if (Array.isArray(data.shapes)) {
        // replace all shapes
        useCanvasStore.setState({ shapes: data.shapes, selectedId: null })
        setToolpath(null)
      }
    } catch {
      alert('Could not read project file')
    }
  }

  return (
    <div className="flex items-center gap-2 px-3 py-2 bg-zinc-900 border-b border-zinc-800 flex-shrink-0 flex-wrap">
      {/* Tools */}
      <div className="flex gap-1">
        {TOOLS.map(t => (
          <button
            key={t.id}
            onClick={() => setTool(t.id)}
            className={`px-2.5 py-1 text-xs rounded transition-colors ${
              tool === t.id
                ? 'bg-cyan-600 text-white'
                : 'bg-zinc-700 text-zinc-300 hover:bg-zinc-600'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <Divider />

      {/* Material size */}
      <div className="flex items-center gap-1.5 text-xs text-zinc-400">
        <span className="text-zinc-500">Material</span>
        <NumInput value={materialW} onChange={v => setMaterial(v, materialH, materialDepth)} min={1} />
        <span className="text-zinc-600">×</span>
        <NumInput value={materialH} onChange={v => setMaterial(materialW, v, materialDepth)} min={1} />
        <span className="text-zinc-600">×</span>
        <NumInput value={materialDepth} onChange={v => setMaterial(materialW, materialH, v)} min={1} />
        <span className="text-zinc-600">mm</span>
      </div>

      {/* Selected shape props */}
      {selected && (
        <>
          <Divider />
          {selected.type === 'line' ? (
            <div className="flex items-center gap-1.5 text-xs text-zinc-400">
              <span className="text-zinc-500">
                {(selected.points?.length ?? 0) / 2} pts
              </span>
              <label className="flex items-center gap-1 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={!!selected.closed}
                  onChange={e => updateShape(selected.id, { closed: e.target.checked })}
                  className="accent-cyan-500"
                />
                <span className="text-zinc-400">Close</span>
              </label>
            </div>
          ) : (
            <div className="flex items-center gap-1.5 text-xs">
              <Prop label="X" value={selected.x}      onChange={v => updateShape(selected.id, { x: v })} />
              <Prop label="Y" value={selected.y}      onChange={v => updateShape(selected.id, { y: v })} />
              <Prop label="W" value={selected.width}  onChange={v => updateShape(selected.id, { width: v })}  min={1} />
              <Prop label="H" value={selected.height} onChange={v => updateShape(selected.id, { height: v })} min={1} />
              <span className="text-zinc-600">mm</span>
            </div>
          )}
          <button
            onClick={deleteSelected}
            className="ml-1 px-2.5 py-1 text-xs bg-red-700 hover:bg-red-600 text-white rounded transition-colors"
          >
            Delete
          </button>
        </>
      )}

      {/* Spacer */}
      <div className="flex-1" />

      {/* 2D / 3D toggle */}
      <div className="flex gap-1">
        {(['2d', '3d'] as const).map(v => (
          <button
            key={v}
            onClick={() => setView(v)}
            className={`px-2.5 py-1 text-xs rounded transition-colors uppercase font-mono ${
              view === v
                ? 'bg-violet-600 text-white'
                : 'bg-zinc-700 text-zinc-300 hover:bg-zinc-600'
            }`}
          >
            {v}
          </button>
        ))}
      </div>

      {/* SVG import */}
      <button
        onClick={() => svgInputRef.current?.click()}
        className="px-2.5 py-1 text-xs bg-zinc-700 hover:bg-zinc-600 text-zinc-300 rounded transition-colors"
        title="Import SVG (rect, circle, ellipse elements)"
      >
        Import SVG
      </button>
      <input
        ref={svgInputRef}
        type="file"
        accept=".svg"
        className="hidden"
        onChange={e => { const f = e.target.files?.[0]; if (f) importSVG(f); e.target.value = '' }}
      />

      {/* Project save/load */}
      <button
        onClick={saveProject}
        className="px-2.5 py-1 text-xs bg-zinc-700 hover:bg-zinc-600 text-zinc-300 rounded transition-colors"
      >
        Save
      </button>
      <button
        onClick={() => projInputRef.current?.click()}
        className="px-2.5 py-1 text-xs bg-zinc-700 hover:bg-zinc-600 text-zinc-300 rounded transition-colors"
      >
        Load
      </button>
      <input
        ref={projInputRef}
        type="file"
        accept=".tapjson,.json"
        className="hidden"
        onChange={e => { const f = e.target.files?.[0]; if (f) loadProject(f); e.target.value = '' }}
      />
    </div>
  )
}

function Prop({ label, value, onChange, min = 0 }: {
  label: string; value: number; onChange: (v: number) => void; min?: number
}) {
  return (
    <label className="flex items-center gap-1">
      <span className="text-zinc-500">{label}</span>
      <NumInput value={Math.round(value * 10) / 10} onChange={onChange} min={min} />
    </label>
  )
}

function NumInput({ value, onChange, min = 0 }: { value: number; onChange: (v: number) => void; min?: number }) {
  return (
    <input
      type="number"
      value={value}
      onChange={e => { const v = parseFloat(e.target.value); if (!isNaN(v) && v >= min) onChange(v) }}
      step={0.1}
      min={min}
      className="w-16 bg-zinc-800 border border-zinc-600 rounded px-1.5 py-0.5 text-xs text-zinc-100 text-right"
    />
  )
}

function Divider() {
  return <div className="w-px h-5 bg-zinc-700 flex-shrink-0" />
}
