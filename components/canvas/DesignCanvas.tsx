'use client'

import { useEffect, useRef, useState } from 'react'
import { Stage, Layer, Rect, Ellipse, Transformer, Line } from 'react-konva'
import type Konva from 'konva'
import type { KonvaEventObject } from 'konva/lib/Node'
import { useCanvasStore, type CanvasShape } from '@/lib/canvas/store'

const PADDING = 48

export default function DesignCanvas() {
  const containerRef = useRef<HTMLDivElement>(null)
  const stageRef     = useRef<Konva.Stage>(null)
  const trRef        = useRef<Konva.Transformer>(null)

  const { shapes, selectedId, tool, materialW, materialH, toolpath,
          addShape, updateShape, selectShape, setTool } = useCanvasStore()

  const [stageSize, setStageSize] = useState({ width: 800, height: 600 })

  // State for rect/circle draw-drag
  const [drawing, setDrawing] = useState<{ id: string; startX: number; startY: number } | null>(null)

  // State for polyline click-to-add-point
  const [pendingLine, setPendingLine] = useState<{ id: string; pts: number[] } | null>(null)
  // Live cursor position for polyline preview
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null)

  useEffect(() => {
    if (!containerRef.current) return
    const obs = new ResizeObserver(entries => {
      const r = entries[0].contentRect
      setStageSize({ width: r.width, height: r.height })
    })
    obs.observe(containerRef.current)
    return () => obs.disconnect()
  }, [])

  const scale = Math.min(
    (stageSize.width  - PADDING * 2) / materialW,
    (stageSize.height - PADDING * 2) / materialH,
  )
  const offsetX = (stageSize.width  - materialW * scale) / 2
  const offsetY = (stageSize.height - materialH * scale) / 2

  useEffect(() => {
    if (!trRef.current || !stageRef.current) return
    // Don't attach transformer to line shapes
    const sel = selectedId ? shapes.find(s => s.id === selectedId) : null
    const node = (sel && sel.type !== 'line')
      ? stageRef.current.findOne('#' + selectedId)
      : null
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

  // Escape key cancels a pending polyline
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && pendingLine) {
        // Remove the in-progress shape from store and cancel
        useCanvasStore.setState(s => ({ shapes: s.shapes.filter(sh => sh.id !== pendingLine.id) }))
        setPendingLine(null)
        setCursor(null)
        setTool('select')
      }
      if (e.key === 'Enter' && pendingLine && pendingLine.pts.length >= 4) {
        setPendingLine(null)
        setCursor(null)
        setTool('select')
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [pendingLine, setTool])

  const handleMouseDown = (e: KonvaEventObject<MouseEvent>) => {
    if (tool === 'select') {
      const clickedEmpty =
        e.target === stageRef.current || (e.target as Konva.Node).name() === 'material'
      if (clickedEmpty) selectShape(null)
      return
    }
    if (tool === 'line') return  // handled in onClick for polyline
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
    const clickedEmpty =
      e.target === stageRef.current || (e.target as Konva.Node).name() === 'material'
    if (!clickedEmpty && !pendingLine) return  // clicked a shape while not drawing

    const pos = getPointerMm()
    if (!pos) return

    if (!pendingLine) {
      const id = crypto.randomUUID()
      addShape({ id, type: 'line', x: 0, y: 0, width: 0, height: 0, points: [pos.x, pos.y, pos.x, pos.y], closed: false })
      selectShape(id)
      setPendingLine({ id, pts: [pos.x, pos.y, pos.x, pos.y] })
    } else {
      // Append a new point (the last entry was the live preview; make it permanent and add another preview)
      const newPts = [...pendingLine.pts.slice(0, -2), pos.x, pos.y, pos.x, pos.y]
      updateShape(pendingLine.id, { points: newPts })
      setPendingLine({ ...pendingLine, pts: newPts })
    }
  }

  const handleDblClick = (e: KonvaEventObject<MouseEvent>) => {
    if (tool !== 'line' || !pendingLine) return
    // Remove the duplicate preview point added by the second click of the double-click
    const finalPts = pendingLine.pts.slice(0, -2)
    if (finalPts.length < 4) {
      // Too short — discard
      useCanvasStore.setState(s => ({ shapes: s.shapes.filter(sh => sh.id !== pendingLine.id) }))
    } else {
      updateShape(pendingLine.id, { points: finalPts })
    }
    setPendingLine(null)
    setCursor(null)
    setTool('select')
  }

  const handleMouseMove = () => {
    const pos = getPointerMm()
    if (!pos) return

    if (drawing) {
      const dx = pos.x - drawing.startX
      const dy = pos.y - drawing.startY
      updateShape(drawing.id, {
        x: dx >= 0 ? drawing.startX : pos.x,
        y: dy >= 0 ? drawing.startY : pos.y,
        width: Math.abs(dx),
        height: Math.abs(dy),
      })
    }

    if (pendingLine) {
      // Update the live preview point (last pair in pts)
      const newPts = [...pendingLine.pts.slice(0, -2), pos.x, pos.y]
      updateShape(pendingLine.id, { points: newPts })
      setCursor(pos)
    }
  }

  const handleMouseUp = () => {
    if (!drawing) return
    const shape = useCanvasStore.getState().shapes.find(s => s.id === drawing.id)
    if (shape && (shape.width < 2 || shape.height < 2)) {
      updateShape(drawing.id, { width: 20, height: 20 })
    }
    setDrawing(null)
    setTool('select')
  }

  const handleTransformEnd = (shape: CanvasShape, e: KonvaEventObject<Event>) => {
    const node = e.target as Konva.Node & {
      width?: () => number; height?: () => number
      radiusX?: () => number; radiusY?: () => number
      scaleX: () => number; scaleY: () => number
    }
    const sx = node.scaleX()
    const sy = node.scaleY()
    node.scaleX(1); node.scaleY(1)

    if (shape.type === 'rect') {
      const w = (node.width?.() ?? 0) * sx
      const h = (node.height?.() ?? 0) * sy
      ;(node as Konva.Rect).width(w);
      ;(node as Konva.Rect).height(h)
      updateShape(shape.id, {
        x: (node.x() - offsetX) / scale,
        y: (node.y() - offsetY) / scale,
        width: w / scale,
        height: h / scale,
      })
    } else {
      const rx = (node.radiusX?.() ?? 0) * sx
      const ry = (node.radiusY?.() ?? 0) * sy
      ;(node as Konva.Ellipse).radiusX(rx);
      ;(node as Konva.Ellipse).radiusY(ry)
      updateShape(shape.id, {
        x: (node.x() - rx - offsetX) / scale,
        y: (node.y() - ry - offsetY) / scale,
        width: (rx * 2) / scale,
        height: (ry * 2) / scale,
      })
    }
  }

  const handleDragEnd = (shape: CanvasShape, e: KonvaEventObject<DragEvent>) => {
    const node = e.target
    if (shape.type === 'line') {
      // Drag offsets the entire point set
      const dx = (node.x()) / scale
      const dy = (node.y()) / scale
      const pts = shape.points ?? []
      const newPts = pts.map((v, i) => i % 2 === 0 ? v + dx : v + dy)
      updateShape(shape.id, { points: newPts })
      node.x(0); node.y(0)
      return
    }
    if (shape.type === 'rect') {
      updateShape(shape.id, {
        x: (node.x() - offsetX) / scale,
        y: (node.y() - offsetY) / scale,
      })
    } else {
      const rx = (node as Konva.Ellipse).radiusX()
      const ry = (node as Konva.Ellipse).radiusY()
      updateShape(shape.id, {
        x: (node.x() - rx - offsetX) / scale,
        y: (node.y() - ry - offsetY) / scale,
      })
    }
  }

  // Convert toolpath mm coords (XYZ, step-3) → canvas px flat array (XY only)
  const toPx = (pts: number[]) => {
    const out: number[] = []
    for (let i = 0; i < pts.length; i += 3) {
      out.push(offsetX + pts[i] * scale, offsetY + pts[i + 1] * scale)
    }
    return out
  }

  // Convert line shape mm points → canvas px
  const lineToPx = (pts: number[]) => {
    const out: number[] = []
    for (let i = 0; i < pts.length; i += 2) {
      out.push(offsetX + pts[i] * scale, offsetY + pts[i + 1] * scale)
    }
    return out
  }

  const cursorStyle =
    tool === 'select' ? 'default' :
    tool === 'line'   ? 'crosshair' : 'crosshair'

  return (
    <div
      ref={containerRef}
      className="flex-1 overflow-hidden bg-zinc-900"
      style={{ cursor: cursorStyle }}
    >
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
            {/* Material */}
            <Rect
              name="material"
              x={offsetX} y={offsetY}
              width={materialW * scale} height={materialH * scale}
              fill="#e5e7eb"
              shadowColor="black" shadowBlur={16} shadowOpacity={0.4}
            />

            {/* Toolpath overlay */}
            {toolpath?.map((seg, i) => (
              <Line
                key={i}
                points={toPx(seg.pts)}
                stroke={seg.type === 'cut' ? '#06b6d4' : '#3f3f46'}
                strokeWidth={seg.type === 'cut' ? 1.5 : 1}
                listening={false}
                opacity={0.85}
              />
            ))}

            {/* Shapes */}
            {shapes.map(shape => {
              const isSelected = shape.id === selectedId
              const commonLine = {
                stroke: isSelected ? '#f59e0b' : '#3b82f6',
                strokeWidth: isSelected ? 2 : 1.5,
              }

              if (shape.type === 'line') {
                const pts = shape.points ?? []
                if (pts.length < 4) return null
                const pxPts = lineToPx(pts)
                // For closed polylines, append the first point
                const closedPxPts = shape.closed
                  ? [...pxPts, pxPts[0], pxPts[1]]
                  : pxPts
                return (
                  <Line
                    key={shape.id}
                    id={shape.id}
                    points={closedPxPts}
                    {...commonLine}
                    fill="rgba(59,130,246,0.12)"
                    closed={false}
                    draggable={tool === 'select' && !pendingLine}
                    onClick={tool === 'select' ? () => selectShape(shape.id) : undefined}
                    onDragEnd={(e: KonvaEventObject<DragEvent>) => handleDragEnd(shape, e)}
                  />
                )
              }

              const common = {
                id: shape.id,
                fill: 'rgba(59,130,246,0.25)',
                stroke: isSelected ? '#f59e0b' : '#3b82f6',
                strokeWidth: isSelected ? 2 : 1.5,
                draggable: tool === 'select',
                onClick: tool === 'select' ? () => selectShape(shape.id) : undefined,
                onDragEnd: (e: KonvaEventObject<DragEvent>) => handleDragEnd(shape, e),
                onTransformEnd: (e: KonvaEventObject<Event>) => handleTransformEnd(shape, e),
              }

              if (shape.type === 'rect') {
                return (
                  <Rect key={shape.id} {...common}
                    x={offsetX + shape.x * scale}
                    y={offsetY + shape.y * scale}
                    width={shape.width * scale}
                    height={shape.height * scale}
                  />
                )
              }
              return (
                <Ellipse key={shape.id} {...common}
                  x={offsetX + (shape.x + shape.width / 2) * scale}
                  y={offsetY + (shape.y + shape.height / 2) * scale}
                  radiusX={(shape.width / 2) * scale}
                  radiusY={(shape.height / 2) * scale}
                />
              )
            })}

            <Transformer
              ref={trRef}
              boundBoxFunc={(oldBox, newBox) =>
                newBox.width < 5 || newBox.height < 5 ? oldBox : newBox
              }
            />
          </Layer>
        </Stage>
      )}

      {/* Line tool hint */}
      {tool === 'line' && (
        <div className="absolute bottom-2 left-1/2 -translate-x-1/2 px-3 py-1 bg-zinc-800/80 rounded text-xs text-zinc-400 pointer-events-none">
          {pendingLine ? 'Click to add point · Double-click or Enter to finish · Esc to cancel' : 'Click to start a line'}
        </div>
      )}
    </div>
  )
}
