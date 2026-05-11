import { create } from 'zustand'
import type { PathSegment } from '@/lib/cam/parsePath'

export type ShapeType = 'rect' | 'circle' | 'line'
export type Tool = 'select' | 'rect' | 'circle' | 'line'

export interface CanvasShape {
  id: string
  type: ShapeType
  x: number       // mm from top-left of material (bounding box origin for rect/circle; 0 for line)
  y: number
  width: number   // mm (bounding box for rect/circle; 0 for line)
  height: number
  points?: number[]  // flat [x0,y0,x1,y1,...] in mm — only for type='line'
  closed?: boolean   // close the polyline back to the first point
}

interface CanvasStore {
  shapes: CanvasShape[]
  selectedId: string | null
  tool: Tool
  materialW: number
  materialH: number
  materialDepth: number
  toolpath: PathSegment[] | null
  view: '2d' | '3d'

  setTool: (tool: Tool) => void
  setMaterial: (w: number, h: number, depth?: number) => void
  addShape: (shape: CanvasShape) => void
  updateShape: (id: string, updates: Partial<Omit<CanvasShape, 'id'>>) => void
  deleteSelected: () => void
  selectShape: (id: string | null) => void
  setToolpath: (segs: PathSegment[] | null) => void
  setView: (v: '2d' | '3d') => void
}

export const useCanvasStore = create<CanvasStore>((set, get) => ({
  shapes: [],
  selectedId: null,
  tool: 'select',
  materialW: 300,
  materialH: 200,
  materialDepth: 18,
  toolpath: null,
  view: '2d',

  setTool: (tool) => set({ tool }),
  setMaterial: (materialW, materialH, materialDepth) =>
    set((s) => ({ materialW, materialH, materialDepth: materialDepth ?? s.materialDepth })),
  addShape: (shape) => set((s) => ({ shapes: [...s.shapes, shape] })),
  updateShape: (id, updates) =>
    set((s) => ({ shapes: s.shapes.map((sh) => sh.id === id ? { ...sh, ...updates } : sh) })),
  deleteSelected: () => {
    const { selectedId } = get()
    if (!selectedId) return
    set((s) => ({ shapes: s.shapes.filter((sh) => sh.id !== selectedId), selectedId: null }))
  },
  selectShape: (selectedId) => set({ selectedId }),
  setToolpath: (toolpath) => set({ toolpath }),
  setView: (view) => set({ view }),
}))
