'use client'

import { useRef, useMemo } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { OrbitControls, Grid } from '@react-three/drei'
import * as THREE from 'three'
import { useCanvasStore } from '@/lib/canvas/store'
import type { PathSegment } from '@/lib/cam/parsePath'

// CNC → Three.js coordinate mapping
function c2t(x: number, y: number, z: number): [number, number, number] {
  return [x, z, -y]
}

function lerp(a: number, b: number, t: number) { return a + (b - a) * t }

// ── Height-map simulation ──────────────────────────────────────────────────
const GRID = 200  // cells per axis

function computeHeightMap(
  toolpath: PathSegment[] | null,
  bitDia: number,
  matW: number,
  matH: number,
): Float32Array {
  const W = GRID + 1
  const map = new Float32Array(W * W)  // 0=uncut, negative=depth mm

  if (!toolpath || bitDia <= 0) return map

  const bitR = bitDia / 2
  const cellW = matW / GRID
  const cellH = matH / GRID
  const cellR = Math.ceil(bitR / Math.min(cellW, cellH)) + 1
  const stepDist = Math.min(cellW, cellH) * 0.4

  for (const seg of toolpath) {
    if (seg.type !== 'cut') continue
    const { pts } = seg
    for (let i = 0; i + 5 < pts.length; i += 3) {
      const x0 = pts[i], y0 = pts[i+1], z0 = pts[i+2]
      const x1 = pts[i+3], y1 = pts[i+4], z1 = pts[i+5]
      if (z0 >= 0 && z1 >= 0) continue

      const dx = x1-x0, dy = y1-y0, dz = z1-z0
      const len = Math.sqrt(dx*dx + dy*dy + dz*dz)
      if (len < 0.001) continue
      const steps = Math.max(1, Math.ceil(len / stepDist))

      for (let s = 0; s <= steps; s++) {
        const t = s / steps
        const x = x0 + dx*t, y = y0 + dy*t, z = z0 + dz*t
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
            const dist = Math.sqrt((gx*cellW-x)**2 + (wy-y)**2)
            if (dist <= bitR) {
              const idx = gy * W + gx
              if (z < map[idx]) map[idx] = z
            }
          }
        }
      }
    }
  }
  return map
}

// Procedural walnut grain vertex color
function grainColor(wx: number, wy: number, h: number, matDepth: number): [number, number, number] {
  const isCut = h < -0.5

  // Annual ring pattern (sinusoidal bands running along X/width)
  const ring = Math.sin((wx * 0.38 + Math.sin(wy * 0.055 + 1.1) * 10) * Math.PI) * 0.5 + 0.5

  // Fine figure / medullary rays
  const ray = Math.sin(wx * 2.3 + wy * 0.9) * 0.08 + 0.92

  if (!isCut) {
    // Finished walnut surface: dark reddish-brown
    const r = lerp(0.22, 0.40, ring) * ray
    const g = lerp(0.12, 0.23, ring) * ray
    const b = lerp(0.04, 0.09, ring) * ray
    return [r, g, b]
  } else {
    // Freshly cut interior: lighter raw wood cross-grain
    const depth = -h
    const fade = Math.max(0, 1 - depth / (matDepth * 1.1))
    // End grain pattern (different frequency / direction)
    const eg = Math.sin(wx * 0.6 + wy * 0.55 + 2.0) * 0.5 + 0.5
    const r = lerp(0.40, 0.60, eg) * lerp(0.72, 1.0, fade)
    const g = lerp(0.24, 0.38, eg) * lerp(0.72, 1.0, fade)
    const b = lerp(0.09, 0.17, eg) * lerp(0.72, 1.0, fade)
    return [r, g, b]
  }
}

function buildSurfaceGeo(
  map: Float32Array,
  matW: number,
  matH: number,
  matDepth: number,
): THREE.BufferGeometry {
  const W = GRID + 1
  const positions = new Float32Array(W * W * 3)
  const colors    = new Float32Array(W * W * 3)

  for (let gy = 0; gy < W; gy++) {
    for (let gx = 0; gx < W; gx++) {
      const idx = gy * W + gx
      const h   = map[idx]
      const wx  = gx * matW / GRID
      const wy  = gy * matH / GRID

      positions[idx*3]   = wx          // Three X
      positions[idx*3+1] = h           // Three Y (0=surface, neg=carved)
      positions[idx*3+2] = -wy         // Three Z

      const [r, g, b] = grainColor(wx, wy, h, matDepth)
      colors[idx*3]=r; colors[idx*3+1]=g; colors[idx*3+2]=b
    }
  }

  const indices: number[] = []
  for (let gy = 0; gy < GRID; gy++) {
    for (let gx = 0; gx < GRID; gx++) {
      const a = gy*W+gx, b = gy*W+gx+1, c = (gy+1)*W+gx, d = (gy+1)*W+gx+1
      indices.push(a,b,d, a,d,c)
    }
  }

  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geo.setAttribute('color',    new THREE.BufferAttribute(colors,    3))
  geo.setIndex(indices)
  geo.computeVertexNormals()
  return geo
}

// Procedural walnut texture for box sides
function makeWoodTex(matW: number, matH: number): THREE.CanvasTexture {
  const W = 1024, H = 512
  const cv = document.createElement('canvas')
  cv.width = W; cv.height = H
  const ctx = cv.getContext('2d')!

  ctx.fillStyle = '#3b1f09'
  ctx.fillRect(0, 0, W, H)

  for (let i = 0; i < 140; i++) {
    const y0 = (i / 140) * H * 1.4 - H * 0.2
    const amp = 5 + Math.sin(i * 1.4) * 4
    const f1 = 0.0035 + Math.cos(i * 0.6) * 0.001
    const f2 = f1 * 2.5

    ctx.beginPath()
    ctx.moveTo(0, y0)
    for (let x = 0; x <= W; x += 4) {
      ctx.lineTo(x, y0 + Math.sin(x*f1 + i) * amp + Math.cos(x*f2 + i*0.7) * amp*0.45)
    }
    const bright = Math.random() > 0.5
    const a = 0.12 + Math.random() * 0.22
    ctx.strokeStyle = bright ? `rgba(160,90,35,${a})` : `rgba(15,7,2,${a})`
    ctx.lineWidth = 0.6 + Math.random() * 2.2
    ctx.stroke()
  }

  for (let k = 0; k < 4; k++) {
    const kx = (0.15 + Math.random() * 0.7) * W
    const ky = (0.15 + Math.random() * 0.7) * H
    const gr = ctx.createRadialGradient(kx, ky, 4, kx, ky, 50 + Math.random() * 50)
    gr.addColorStop(0, 'rgba(10,4,1,0.28)')
    gr.addColorStop(0.5, 'rgba(90,45,15,0.12)')
    gr.addColorStop(1, 'rgba(0,0,0,0)')
    ctx.fillStyle = gr
    ctx.fillRect(0, 0, W, H)
  }

  const tex = new THREE.CanvasTexture(cv)
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping
  tex.repeat.set(matW / 180, matH / 120)
  return tex
}

// ── Components ─────────────────────────────────────────────────────────────

function SimulatedMaterial({ w, h, depth }: { w: number; h: number; depth: number }) {
  const { toolpath, toolpathBitDia } = useCanvasStore()

  const geo = useMemo(
    () => {
      const map = computeHeightMap(toolpath, toolpathBitDia, w, h)
      return buildSurfaceGeo(map, w, h, depth)
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [toolpath, toolpathBitDia, w, h, depth],
  )

  const sideTex = useMemo(() => makeWoodTex(w, h), [w, h])

  return (
    <>
      {/* Carved top surface with procedural grain */}
      <mesh geometry={geo}>
        <meshStandardMaterial
          vertexColors
          roughness={0.80}
          metalness={0.0}
          polygonOffset
          polygonOffsetFactor={-1}
          polygonOffsetUnits={-1}
        />
      </mesh>

      {/* Sides + bottom */}
      <mesh position={[w/2, -depth/2, -h/2]}>
        <boxGeometry args={[w, depth, h]} />
        <meshStandardMaterial map={sideTex} roughness={0.85} metalness={0.0} color="#c8a878" />
      </mesh>
    </>
  )
}

function ToolpathLines() {
  const { toolpath } = useCanvasStore()
  if (!toolpath) return null
  return (
    <>
      {toolpath.map((seg, i) => {
        const pts: number[] = []
        for (let j = 0; j < seg.pts.length; j += 3) {
          const [x, y, z] = c2t(seg.pts[j], seg.pts[j+1], seg.pts[j+2])
          pts.push(x, y, z)
        }
        if (pts.length < 6) return null
        const geo = new THREE.BufferGeometry()
        geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pts), 3))
        return (
          <line key={i}>
            <primitive object={geo} attach="geometry" />
            <lineBasicMaterial
              color={seg.type === 'cut' ? '#22d3ee' : '#52525b'}
              opacity={seg.type === 'cut' ? 0.7 : 0.35}
              transparent
            />
          </line>
        )
      })}
    </>
  )
}

function CameraSetup({ w, h }: { w: number; h: number }) {
  const done = useRef(false)
  useFrame(({ camera }) => {
    if (done.current) return
    done.current = true
    const dist = Math.max(w, h) * 1.5
    camera.position.set(w/2, dist*0.65, h*0.9)
    camera.lookAt(w/2, 0, -h/2)
  })
  return null
}

function Scene() {
  const { materialW: w, materialH: h, materialDepth: d } = useCanvasStore()
  return (
    <>
      <ambientLight intensity={0.45} />
      {/* Key light — upper front right */}
      <directionalLight position={[w*0.8, d*8, h*0.4]} intensity={1.4} castShadow />
      {/* Fill light — left */}
      <directionalLight position={[-w*0.5, d*3, -h*0.3]} intensity={0.35} color="#ffe8c8" />
      {/* Rim light — behind/under */}
      <directionalLight position={[w*0.3, -d*2, -h]} intensity={0.15} color="#c8e0ff" />

      <SimulatedMaterial w={w} h={h} depth={d} />
      <ToolpathLines />

      <Grid
        position={[w/2, 0.2, -h/2]}
        args={[w + 120, h + 120]}
        cellSize={10}
        cellThickness={0.4}
        cellColor="#44403c"
        sectionSize={50}
        sectionThickness={0.8}
        sectionColor="#57534e"
        fadeDistance={900}
        fadeStrength={1.2}
        infiniteGrid={false}
      />

      <OrbitControls makeDefault minDistance={20} maxDistance={1500} target={[w/2, 0, -h/2]} />
    </>
  )
}

export default function Preview3D() {
  const { materialW: w, materialH: h } = useCanvasStore()
  return (
    <div className="flex-1 overflow-hidden bg-zinc-950">
      <Canvas
        camera={{ fov: 42, near: 0.1, far: 6000, position: [w/2, h, h*0.9] }}
        shadows
        gl={{ antialias: true }}
      >
        <CameraSetup w={w} h={h} />
        <Scene />
      </Canvas>
    </div>
  )
}
