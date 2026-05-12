'use client'

import { useRef, useMemo } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { OrbitControls, Grid, Line, Edges } from '@react-three/drei'
import * as THREE from 'three'
import { useCanvasStore } from '@/lib/canvas/store'
import type { PathSegment } from '@/lib/cam/parsePath'

// CNC coords (mm): X right, Y forward, Z up
// Three.js coords: X right, Y up, Z toward viewer
// Mapping: cncX → threeX, cncY → -threeZ, cncZ → threeY
function cncToThree(x: number, y: number, z: number): [number, number, number] {
  return [x, z, -y]
}

function lerp(a: number, b: number, t: number) { return a + (b - a) * t }

// ── Height map simulation ──────────────────────────────────────────────────
const GRID = 150  // cells per axis → (GRID+1)² vertices

function computeHeightMap(
  toolpath: PathSegment[] | null,
  bitDia: number,
  matW: number,
  matH: number,
): Float32Array {
  const W = GRID + 1
  const map = new Float32Array(W * W)  // 0 = uncut, negative = cut depth (mm)

  if (!toolpath || bitDia <= 0) return map

  const bitR = bitDia / 2
  const cellW = matW / GRID
  const cellH = matH / GRID
  const minCell = Math.min(cellW, cellH)
  const cellR = Math.ceil(bitR / minCell) + 1
  const stepDist = minCell * 0.5

  for (const seg of toolpath) {
    if (seg.type !== 'cut') continue
    const { pts } = seg

    for (let i = 0; i + 5 < pts.length; i += 3) {
      const x0 = pts[i], y0 = pts[i + 1], z0 = pts[i + 2]
      const x1 = pts[i + 3], y1 = pts[i + 4], z1 = pts[i + 5]
      if (z0 >= 0 && z1 >= 0) continue  // above material

      const dx = x1 - x0, dy = y1 - y0, dz = z1 - z0
      const len = Math.sqrt(dx * dx + dy * dy + dz * dz)
      if (len < 0.001) continue
      const steps = Math.max(1, Math.ceil(len / stepDist))

      for (let s = 0; s <= steps; s++) {
        const t = s / steps
        const x = x0 + dx * t
        const y = y0 + dy * t
        const z = z0 + dz * t
        if (z >= 0) continue

        const gcx = (x / matW) * GRID
        const gcy = (y / matH) * GRID
        const gx0 = Math.max(0, Math.floor(gcx - cellR))
        const gx1 = Math.min(GRID, Math.ceil(gcx + cellR))
        const gy0 = Math.max(0, Math.floor(gcy - cellR))
        const gy1 = Math.min(GRID, Math.ceil(gcy + cellR))

        for (let gy = gy0; gy <= gy1; gy++) {
          const wy = gy * cellH
          for (let gx = gx0; gx <= gx1; gx++) {
            const wx = gx * cellW
            const dist = Math.sqrt((wx - x) ** 2 + (wy - y) ** 2)
            if (dist <= bitR) {
              const idx = gy * W + gx
              if (z < map[idx]) map[idx] = z  // deeper = more negative
            }
          }
        }
      }
    }
  }
  return map
}

function buildSurfaceGeometry(
  map: Float32Array,
  matW: number,
  matH: number,
  matDepth: number,
): THREE.BufferGeometry {
  const W = GRID + 1
  const positions = new Float32Array(W * W * 3)
  const colors = new Float32Array(W * W * 3)

  // Uncut: #d4c5a9  (212,197,169)
  // Cut:   #7a4f28  (122, 79, 40) — exposed wood interior

  for (let gy = 0; gy < W; gy++) {
    for (let gx = 0; gx < W; gx++) {
      const idx = gy * W + gx
      const h = map[idx]  // <=0

      positions[idx * 3]     = gx * matW / GRID      // Three.X
      positions[idx * 3 + 1] = h                      // Three.Y (0=surface, neg=cut)
      positions[idx * 3 + 2] = -(gy * matH / GRID)   // Three.Z

      const frac = Math.min(1, -h / Math.max(1, matDepth * 0.6))
      colors[idx * 3]     = lerp(0.831, 0.478, frac)
      colors[idx * 3 + 1] = lerp(0.773, 0.310, frac)
      colors[idx * 3 + 2] = lerp(0.663, 0.157, frac)
    }
  }

  const indices: number[] = []
  for (let gy = 0; gy < GRID; gy++) {
    for (let gx = 0; gx < GRID; gx++) {
      const a = gy * W + gx
      const b = gy * W + gx + 1
      const c = (gy + 1) * W + gx
      const d = (gy + 1) * W + gx + 1
      indices.push(a, b, d, a, d, c)
    }
  }

  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3))
  geo.setIndex(indices)
  geo.computeVertexNormals()
  return geo
}

// ── Components ─────────────────────────────────────────────────────────────

function SimulatedMaterial({ w, h, depth }: { w: number; h: number; depth: number }) {
  const { toolpath, toolpathBitDia } = useCanvasStore()

  const geo = useMemo(
    () => {
      const map = computeHeightMap(toolpath, toolpathBitDia, w, h)
      return buildSurfaceGeometry(map, w, h, depth)
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [toolpath, toolpathBitDia, w, h, depth],
  )

  return (
    <>
      {/* Carved top surface — vertex-colored height map */}
      <mesh geometry={geo}>
        <meshStandardMaterial
          vertexColors
          roughness={0.85}
          metalness={0.02}
          polygonOffset
          polygonOffsetFactor={-1}
          polygonOffsetUnits={-1}
        />
      </mesh>

      {/* Sides + bottom block */}
      <mesh position={[w / 2, -depth / 2, -h / 2]}>
        <boxGeometry args={[w, depth, h]} />
        <meshStandardMaterial color="#c4b59a" roughness={0.9} metalness={0.03} />
        <Edges color="#a89880" lineWidth={1} />
      </mesh>
    </>
  )
}

function ShapeOutlines() {
  const { shapes } = useCanvasStore()
  return (
    <>
      {shapes.map(shape => {
        if (shape.type === 'rect') {
          const x1 = shape.x, y1 = shape.y
          const x2 = shape.x + shape.width, y2 = shape.y + shape.height
          const pts: [number, number, number][] = [
            cncToThree(x1, y1, 0.2),
            cncToThree(x2, y1, 0.2),
            cncToThree(x2, y2, 0.2),
            cncToThree(x1, y2, 0.2),
            cncToThree(x1, y1, 0.2),
          ]
          return <Line key={shape.id} points={pts} color="#3b82f6" lineWidth={2} />
        }

        if (shape.type === 'circle') {
          const cx = shape.x + shape.width / 2
          const cy = shape.y + shape.height / 2
          const rx = shape.width / 2
          const ry = shape.height / 2
          const pts: [number, number, number][] = []
          for (let i = 0; i <= 64; i++) {
            const a = (i / 64) * Math.PI * 2
            pts.push(cncToThree(cx + Math.cos(a) * rx, cy + Math.sin(a) * ry, 0.2))
          }
          return <Line key={shape.id} points={pts} color="#3b82f6" lineWidth={2} />
        }

        const raw = shape.points ?? []
        if (raw.length < 4) return null
        const pts: [number, number, number][] = []
        for (let i = 0; i < raw.length; i += 2) {
          pts.push(cncToThree(raw[i], raw[i + 1], 0.2))
        }
        if (shape.closed && pts.length >= 2) pts.push(pts[0])
        return <Line key={shape.id} points={pts} color="#22d3ee" lineWidth={2} />
      })}
    </>
  )
}

function ToolpathLines() {
  const { toolpath } = useCanvasStore()
  if (!toolpath) return null

  return (
    <>
      {toolpath.map((seg, i) => {
        const pts: [number, number, number][] = []
        for (let j = 0; j < seg.pts.length; j += 3) {
          pts.push(cncToThree(seg.pts[j], seg.pts[j + 1], seg.pts[j + 2]))
        }
        if (pts.length < 2) return null
        return (
          <Line
            key={i}
            points={pts}
            color={seg.type === 'cut' ? '#06b6d4' : '#52525b'}
            lineWidth={seg.type === 'cut' ? 1.5 : 1}
            opacity={seg.type === 'cut' ? 0.8 : 0.4}
            transparent
          />
        )
      })}
    </>
  )
}

function CameraSetup({ materialW, materialH }: { materialW: number; materialH: number }) {
  const done = useRef(false)
  useFrame(({ camera }) => {
    if (done.current) return
    done.current = true
    const dist = Math.max(materialW, materialH) * 1.4
    camera.position.set(materialW / 2, dist * 0.7, materialH * 0.8)
    camera.lookAt(materialW / 2, 0, -materialH / 2)
  })
  return null
}

function Scene() {
  const { materialW, materialH, materialDepth } = useCanvasStore()

  return (
    <>
      <ambientLight intensity={0.6} />
      <directionalLight position={[200, 400, 200]} intensity={1.2} castShadow />
      <directionalLight position={[-100, 100, -100]} intensity={0.3} />

      <SimulatedMaterial w={materialW} h={materialH} depth={materialDepth} />
      <ShapeOutlines />
      <ToolpathLines />

      <Grid
        position={[materialW / 2, 0, -materialH / 2]}
        args={[materialW + 80, materialH + 80]}
        cellSize={10}
        cellThickness={0.5}
        cellColor="#3f3f46"
        sectionSize={50}
        sectionThickness={1}
        sectionColor="#52525b"
        fadeDistance={800}
        fadeStrength={1}
        infiniteGrid={false}
      />

      <OrbitControls
        makeDefault
        minDistance={20}
        maxDistance={1200}
        target={[materialW / 2, 0, -materialH / 2]}
      />
    </>
  )
}

export default function Preview3D() {
  const { materialW, materialH } = useCanvasStore()

  return (
    <div className="flex-1 overflow-hidden bg-zinc-950">
      <Canvas
        camera={{ fov: 45, near: 0.1, far: 5000, position: [materialW / 2, materialH, materialH * 0.8] }}
        shadows
        gl={{ antialias: true }}
      >
        <CameraSetup materialW={materialW} materialH={materialH} />
        <Scene />
      </Canvas>
    </div>
  )
}
