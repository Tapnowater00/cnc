'use client'

import { useEffect, useRef, useState } from 'react'
import { Stage, Layer, Rect, Ellipse, Transformer, Line } from 'react-konva'
import type Konva from 'konva'
import type { KonvaEventObject } from 'konva/lib/Node'
import { useCanvasStore, type CanvasShape } from '@/lib/canvas/store'

const RULER = 24   // ruler strip width in px
const PAD   = 52   // padding around material (outside ruler area)

// Pick a nice mm tick interval so ticks are at least MIN_PX apart
const MIN_PX = 30
const INTERVALS = [1, 2, 5, 10, 20, 50, 100]
function tickInterval(scale: number) {
  return INTERVALS.find(i => i * scale >= MIN_PX) ?? 100
}

function Rulers({
  offsetX, offsetY, scale, matW, matH, stageW, stageH,
}: {
  offsetX: number; offsetY: number; scale: number
  matW: number; matH: number; stageW: number; stageH: number
}) {
  const iv = tickInterval(scale)
  const xTicks: number[] = [], yTicks: number[] = []
  for (let mm = 0; mm <= matW; mm += iv) xTicks.push(mm)
  for (let mm = 0; mm <= matH; mm += iv) yTicks.push(mm)

  return (
    <div className="absolute inset-0 pointer-events-none select-none" style={{ fontFamily: 'sans-serif' }}>
      {/* Corner */}
      <div style={{ position: 'absolute', left: 0, top: 0, width: RULER, height: RULER, background: '#1c1917' }} />

      {/* Top ruler */}
      <svg
        style={{ position: 'absolute', left: RULER, top: 0, width: stageW - RULER, height: RULER, overflow: 'hidden' }}
      >
        <rect width="100%" height="100%" fill="#1c1917" />
        {xTicks.map(mm => {
          const px = offsetX - RULER + mm * scale
          const major = mm % (iv * 5) === 0
          return (
            <g key={mm} transform={`translate(${px},0)`}>
              <line x1="0" y1={RULER} x2="0" y2={major ? RULER - 10 : RULER - 6} stroke="#78716c" strokeWidth="1" />
              {major && (
                <text x="2" y={RULER - 11} fill="#a8a29e" fontSize="9" dominantBaseline="auto">{mm}</text>
              )}
            </g>
          )
        })}
      </svg>

      {/* Left ruler */}
      <svg
        style={{ position: 'absolute', left: 0, top: RULER, width: RULER, height: stageH - RULER, overflow: 'hidden' }}
      >
        <rect width="100%" height="100%" fill="#1c1917" />
        {yTicks.map(mm => {
          const py = offsetY - RULER + mm * scale
          const major = mm % (iv * 5) === 0
          return (
            <g key={mm} transform={`translate(0,${py})`}>
              <line x1={RULER} y1="0" x2={major ? RULER - 10 : RULER - 6} y2="0" stroke="#78716c" strokeWidth="1" />
              {major && (
                <text
                  x={RULER - 11} y="2"
                  fill="#a8a29e" fontSize="9" textAnchor="middle" dominantBaseline="central"
                  transform={`rotate(-90,${RULER - 11},2)`}
                >{mm}</text>
              )}
            </g>
          )
        })}
      </svg>
    </div>
  )
}

export default function DesignCanvas() {
  const containerRef = useRef<HTMLDivElement>(null)
  const stageRef     = useRef<Konva.Stage>(null)
  const trRef        = useRef<Konva.Transformer>(null)

  const { shapes, selectedId, tool, materialW, materialH, toolpath,
          addShape, updateShape, selectShape, setTool } = useCanvasStore()

  const [stageSize, setStageSize] = useState({ width: 800, height: 600 })
  const [drawing, setDrawing]     = useState<{ id: string; startX: number; startY: number } | null>(null)
  const [pendingLine, setPendingLine] = useState<{ id: string; pts: number[] } | null>(null)
  const [cursor, setCursor]       = useState<{ x: number; y: number } | null>(null)

  useEffect(() => {
    if (!containerRef.current) return
    const obs = new ResizeObserver(entries => {
      const r = entries[0].contentRect
      setStageSize({ width: r.width, height: r.height })
    })
    obs.observe(containerRef.current)
    return () => obs.disconnect()
  }, [])

  // Scale so material fits in the available area (inside ruler + padding)
  const availW = stageSize.width  - RULER - PAD * 2
  const availH = stageSize.height - RULER - PAD * 2
  const scale  = Math.min(availW / materialW, availH / materialH)

  // Top-left corner of material in stage coords
  const offsetX = RULER + PAD + (availW - materialW * scale) / 2
  const offsetY = RULER + PAD + (availH - materialH * scale) / 2

  useEffect(() => {
    if (!trRef.current || !stageRef.current) return
    const sel  = selectedId ? shapes.find(s => s.id === selectedId) : null
    const node = (sel && sel.type !== 'line') ? stageRef.current.findOne('#' + selectedId) : null
    trRef.current.nodes(node ? [node] : [])
    trRef.current.getLayer()?.batchDraw()
  }, [selectedId, shapes])

  const getPointerMm = () => {
    const pos = stageRef.current?.getPointerPosition()
    if (!pos) return null
    return {
      x: Math.max(0, Math.min(materialW, (pos.x - offsetX) / scale)),
      y: Math.max(0, Math.min(materialH, (pos.y - offsetY) / scale)),
    }
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && pendingLine) {
        useCanvasStore.setState(s => ({ shapes: s.shapes.filter(sh => sh.id !== pendingLine.id) }))
        setPendingLine(null); setCursor(null); setTool('select')
      }
      if (e.key === 'Enter' && pendingLine && pendingLine.pts.length >= 4) {
        setPendingLine(null); setCursor(null); setTool('select')
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [pendingLine, setTool])

  const handleMouseDown = (e: KonvaEventObject<MouseEvent>) => {
    if (tool === 'select') {
      const empty = e.target === stageRef.current || (e.target as Konva.Node).name() === 'bg' || (e.target as Konva.Node).name() === 'mat'
      if (empty) selectShape(null)
      return
    }
    if (tool === 'line') return
    if (drawing) return
    const pos = getPointerMm()
    if (!pos) return
    const id = crypto.randomUUID()
    addShape({ id, type: tool, x: pos.x, y: pos.y, width: 0, height: 0 })
    selectShape(id)
    setDrawing({ id, startX: pos.x, startY: pos.y })
  }

  const handleClick = (e: KonvaEventObject<MouseEvent>) => {
    if (tool !== 'line') return
    const empty = e.target === stageRef.current || (e.target as Konva.Node).name() === 'bg' || (e.target as Konva.Node).name() === 'mat'
    if (!empty && !pendingLine) return
    const pos = getPointerMm()
    if (!pos) return

    if (!pendingLine) {
      const id = crypto.randomUUID()
      addShape({ id, type: 'line', x: 0, y: 0, width: 0, height: 0, points: [pos.x, pos.y, pos.x, pos.y], closed: false })
      selectShape(id)
      setPendingLine({ id, pts: [pos.x, pos.y, pos.x, pos.y] })
    } else {
      const newPts = [...pendingLine.pts.slice(0, -2), pos.x, pos.y, pos.x, pos.y]
      updateShape(pendingLine.id, { points: newPts })
      setPendingLine({ ...pendingLine, pts: newPts })
    }
  }

  const handleDblClick = (e: KonvaEventObject<MouseEvent>) => {
    if (tool !== 'line' || !pendingLine) return
    const finalPts = pendingLine.pts.slice(0, -2)
    if (finalPts.length < 4) {
      useCanvasStore.setState(s => ({ shapes: s.shapes.filter(sh => sh.id !== pendingLine.id) }))
    } else {
      updateShape(pendingLine.id, { points: finalPts })
    }
    setPendingLine(null); setCursor(null); setTool('select')
  }

  const handleMouseMove = () => {
    const pos = getPointerMm()
    if (!pos) return
    if (drawing) {
      const dx = pos.x - drawing.startX, dy = pos.y - drawing.startY
      updateShape(drawing.id, {
        x: dx >= 0 ? drawing.startX : pos.x,
        y: dy >= 0 ? drawing.startY : pos.y,
        width: Math.abs(dx), height: Math.abs(dy),
      })
    }
    if (pendingLine) {
      const newPts = [...pendingLine.pts.slice(0, -2), pos.x, pos.y]
      updateShape(pendingLine.id, { points: newPts })
      setCursor(pos)
    }
  }

  const handleMouseUp = () => {
    if (!drawing) return
    const shape = useCanvasStore.getState().shapes.find(s => s.id === drawing.id)
    if (shape && (shape.width < 2 || shape.height < 2)) updateShape(drawing.id, { width: 20, height: 20 })
    setDrawing(null); setTool('select')
  }

  const handleTransformEnd = (shape: CanvasShape, e: KonvaEventObject<Event>) => {
    const node = e.target as Konva.Node & {
      width?: () => number; height?: () => number
      radiusX?: () => number; radiusY?: () => number
      scaleX: () => number; scaleY: () => number
    }
    const sx = node.scaleX(), sy = node.scaleY()
    node.scaleX(1); node.scaleY(1)
    if (shape.type === 'rect') {
      const w = (node.width?.() ?? 0) * sx, h = (node.height?.() ?? 0) * sy
      ;(node as Konva.Rect).width(w); (node as Konva.Rect).height(h)
      updateShape(shape.id, { x: (node.x()-offsetX)/scale, y: (node.y()-offsetY)/scale, width: w/scale, height: h/scale })
    } else {
      const rx = (node.radiusX?.() ?? 0) * sx, ry = (node.radiusY?.() ?? 0) * sy
      ;(node as Konva.Ellipse).radiusX(rx); (node as Konva.Ellipse).radiusY(ry)
      updateShape(shape.id, { x: (node.x()-rx-offsetX)/scale, y: (node.y()-ry-offsetY)/scale, width: (rx*2)/scale, height: (ry*2)/scale })
    }
  }

  const handleDragEnd = (shape: CanvasShape, e: KonvaEventObject<DragEvent>) => {
    const node = e.target
    if (shape.type === 'line') {
      const dx = node.x()/scale, dy = node.y()/scale
      updateShape(shape.id, { points: (shape.points ?? []).map((v, i) => i%2===0 ? v+dx : v+dy) })
      node.x(0); node.y(0); return
    }
    if (shape.type === 'rect') {
      updateShape(shape.id, { x: (node.x()-offsetX)/scale, y: (node.y()-offsetY)/scale })
    } else {
      const rx = (node as Konva.Ellipse).radiusX(), ry = (node as Konva.Ellipse).radiusY()
      updateShape(shape.id, { x: (node.x()-rx-offsetX)/scale, y: (node.y()-ry-offsetY)/scale })
    }
  }

  // mm XYZ (step-3) → canvas px flat
  const toPx = (pts: number[]) => {
    const out: number[] = []
    for (let i = 0; i < pts.length; i += 3) out.push(offsetX + pts[i]*scale, offsetY + pts[i+1]*scale)
    return out
  }

  // mm XY (step-2) → canvas px flat
  const linePx = (pts: number[]) => {
    const out: number[] = []
    for (let i = 0; i < pts.length; i += 2) out.push(offsetX + pts[i]*scale, offsetY + pts[i+1]*scale)
    return out
  }

  // Material grid lines (every 10 mm)
  const gridLines: { x1: number; y1: number; x2: number; y2: number; major: boolean }[] = []
  for (let mm = 0; mm <= materialW; mm += 10) {
    const x = offsetX + mm * scale
    const major = mm % 50 === 0
    gridLines.push({ x1: x, y1: offsetY, x2: x, y2: offsetY + materialH * scale, major })
  }
  for (let mm = 0; mm <= materialH; mm += 10) {
    const y = offsetY + mm * scale
    const major = mm % 50 === 0
    gridLines.push({ x1: offsetX, y1: y, x2: offsetX + materialW * scale, y2: y, major })
  }

  const cursorStyle = tool === 'select' ? 'default' : 'crosshair'

  return (
    <div ref={containerRef} className="relative flex-1 overflow-hidden" style={{ cursor: cursorStyle, background: '#6b93a8' }}>
      {stageSize.width > 0 && (
        <Stage
          ref={stageRef}
          width={stageSize.width}
          height={stageSize.height}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onClick={handleClick}
          onDblClick={handleDblClick}
        >
          <Layer>
            {/* Background fill (behind ruler area too) */}
            <Rect name="bg" x={0} y={0} width={stageSize.width} height={stageSize.height} fill="#6b93a8" />

            {/* Material surface */}
            <Rect
              name="mat"
              x={offsetX} y={offsetY}
              width={materialW * scale} height={materialH * scale}
              fill="#e8ddd0"
              shadowColor="rgba(0,0,0,0.5)" shadowBlur={20} shadowOffsetY={6} shadowOpacity={0.6}
            />

            {/* Grid lines on material */}
            {scale > 0.5 && gridLines.map((l, i) => (
              <Line
                key={i}
                points={[l.x1, l.y1, l.x2, l.y2]}
                stroke={l.major ? '#b8a898' : '#cfc5b8'}
                strokeWidth={l.major ? 0.6 : 0.4}
                listening={false}
              />
            ))}

            {/* Toolpath overlay */}
            {toolpath?.map((seg, i) => (
              <Line
                key={i}
                points={toPx(seg.pts)}
                stroke={seg.type === 'cut' ? '#0e7490' : '#94a3b8'}
                strokeWidth={seg.type === 'cut' ? 1.5 : 0.8}
                listening={false}
                opacity={0.9}
              />
            ))}

            {/* Shapes */}
            {shapes.map(shape => {
              const sel = shape.id === selectedId
              const mode = shape.cutSettings?.mode ?? 'profile'

              // Fill varies by cut mode to give Easel-like visual hints
              const fillMap: Record<string, string> = {
                profile: sel ? 'rgba(30,30,30,0.75)' : 'rgba(60,60,60,0.65)',
                pocket:  sel ? 'rgba(20,20,20,0.85)' : 'rgba(50,50,50,0.78)',
                drill:   sel ? 'rgba(30,20,20,0.80)' : 'rgba(70,55,55,0.70)',
                vcarve:  sel ? 'rgba(25,25,35,0.80)' : 'rgba(55,55,75,0.70)',
              }
              const fill   = fillMap[mode] ?? fillMap.profile
              const stroke = sel ? '#f59e0b' : 'rgba(255,255,255,0.15)'
              const strokeW = sel ? 1.5 : 0.8

              if (shape.type === 'line') {
                const pts = shape.points ?? []
                if (pts.length < 4) return null
                const px = linePx(pts)
                const closedPx = shape.closed ? [...px, px[0], px[1]] : px
                return (
                  <Line
                    key={shape.id} id={shape.id}
                    points={closedPx}
                    stroke={sel ? '#f59e0b' : '#6b7280'}
                    strokeWidth={sel ? 2 : 1.5}
                    closed={false}
                    draggable={tool === 'select' && !pendingLine}
                    onClick={tool === 'select' ? () => selectShape(shape.id) : undefined}
                    onDragEnd={(e: KonvaEventObject<DragEvent>) => handleDragEnd(shape, e)}
                  />
                )
              }

              const common = {
                id: shape.id, fill, stroke, strokeWidth: strokeW,
                draggable: tool === 'select',
                onClick: tool === 'select' ? () => selectShape(shape.id) : undefined,
                onDragEnd: (e: KonvaEventObject<DragEvent>) => handleDragEnd(shape, e),
                onTransformEnd: (e: KonvaEventObject<Event>) => handleTransformEnd(shape, e),
              }

              if (shape.type === 'rect') {
                return (
                  <Rect key={shape.id} {...common}
                    x={offsetX + shape.x * scale} y={offsetY + shape.y * scale}
                    width={shape.width * scale} height={shape.height * scale}
                  />
                )
              }
              return (
                <Ellipse key={shape.id} {...common}
                  x={offsetX + (shape.x + shape.width/2) * scale}
                  y={offsetY + (shape.y + shape.height/2) * scale}
                  radiusX={(shape.width/2) * scale}
                  radiusY={(shape.height/2) * scale}
                />
              )
            })}

            <Transformer
              ref={trRef}
              anchorStroke="#f59e0b" borderStroke="#f59e0b"
              anchorFill="#fff" anchorSize={8}
              boundBoxFunc={(oldBox, newBox) => newBox.width < 5 || newBox.height < 5 ? oldBox : newBox}
            />
          </Layer>
        </Stage>
      )}

      {/* Rulers overlay */}
      {stageSize.width > 0 && (
        <Rulers
          offsetX={offsetX} offsetY={offsetY}
          scale={scale}
          matW={materialW} matH={materialH}
          stageW={stageSize.width} stageH={stageSize.height}
        />
      )}

      {/* Line tool hint */}
      {tool === 'line' && (
        <div className="absolute bottom-3 left-1/2 -translate-x-1/2 px-3 py-1 bg-zinc-900/80 rounded text-xs text-zinc-300 pointer-events-none">
          {pendingLine
            ? 'Click to add point · Double-click or Enter to finish · Esc to cancel'
            : 'Click to start a line'}
        </div>
      )}

      {/* Cursor readout */}
      {cursor && (
        <div className="absolute bottom-3 right-3 px-2 py-0.5 bg-zinc-900/70 rounded text-xs text-zinc-400 pointer-events-none font-mono">
          {cursor.x.toFixed(1)}, {cursor.y.toFixed(1)} mm
        </div>
      )}
    </div>
  )
}
