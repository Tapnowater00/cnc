import { create } from 'zustand'
import type { PathSegment } from '@/lib/cam/parsePath'

export type ShapeType = 'rect' | 'circle' | 'line'
export type Tool = 'select' | 'rect' | 'circle' | 'line'
export type CutType = 'outside' | 'inside' | 'on-line'
export type CutMode = 'profile' | 'pocket' | 'drill' | 'vcarve'
export type PocketStrategy = 'lines' | 'contour'

export interface ShapeCutSettings {
  mode: CutMode
  cutType: CutType
  pocketStrat: PocketStrategy
  vAngle: number
  dwell: number
  bitDia: number
  depth: number
  passDepth: number
  feedRate: number
  plungeRate: number
  spindleRPM: number
  stepoverPct: number
  tabsOn: boolean
  tabCount: number
  tabWidth: number
  tabHeight: number
}

export const DEFAULT_CUT_SETTINGS: ShapeCutSettings = {
  mode: 'profile',
  cutType: 'outside',
  pocketStrat: 'lines',
  vAngle: 60,
  dwell: 0,
  bitDia: 6,
  depth: 10,
  passDepth: 2,
  feedRate: 1000,
  plungeRate: 200,
  spindleRPM: 18000,
  stepoverPct: 40,
  tabsOn: false,
  tabCount: 4,
  tabWidth: 8,
  tabHeight: 3,
}

export interface CanvasShape {
  id: string
  type: ShapeType
  x: number       // mm from top-left of material (bounding box origin for rect/circle; 0 for line)
  y: number
  width: number   // mm (bounding box for rect/circle; 0 for line)
  height: number
  points?: number[]  // flat [x0,y0,x1,y1,...] in mm — only for type='line'
  closed?: boolean   // close the polyline back to the first point
  cutSettings?: ShapeCutSettings
}

interface CanvasStore {
  shapes: CanvasShape[]
  selectedId: string | null
  tool: Tool
  materialW: number
  materialH: number
  materialDepth: number
  toolpath: PathSegment[] | null
  toolpathBitDia: number   // bit diameter used for last toolpath (for simulation)
  view: '2d' | '3d'

  setTool: (tool: Tool) => void
  setMaterial: (w: number, h: number, depth?: number) => void
  addShape: (shape: CanvasShape) => void
  updateShape: (id: string, updates: Partial<Omit<CanvasShape, 'id'>>) => void
  deleteSelected: () => void
  selectShape: (id: string | null) => void
  setToolpath: (segs: PathSegment[] | null, bitDia?: number) => void
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
  toolpathBitDia: 6,
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
  setToolpath: (toolpath, bitDia) =>
    set((s) => ({ toolpath, toolpathBitDia: bitDia ?? s.toolpathBitDia })),
  setView: (view) => set({ view }),
}))
