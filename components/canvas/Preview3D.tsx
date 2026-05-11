'use client'

import { useRef, useMemo } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { OrbitControls, Grid, Line, Edges } from '@react-three/drei'
import * as THREE from 'three'
import { useCanvasStore } from '@/lib/canvas/store'

// CNC coords (mm): X right, Y forward, Z up
// Three.js coords: X right, Y up, Z toward viewer
// Mapping: cncX → threeX, cncY → -threeZ, cncZ → threeY
function cncToThree(x: number, y: number, z: number): [number, number, number] {
  return [x, z, -y]
}

function MaterialBlock({ w, h, depth }: { w: number; h: number; depth: number }) {
  return (
    <mesh position={[w / 2, -depth / 2, -h / 2]}>
      <boxGeometry args={[w, depth, h]} />
      <meshStandardMaterial color="#d4c5a9" roughness={0.9} metalness={0.05} />
      <Edges color="#a89880" lineWidth={1} />
    </mesh>
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

        // line / polyline
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
            opacity={seg.type === 'cut' ? 0.9 : 0.5}
            transparent
          />
        )
      })}
    </>
  )
}

function Scene() {
  const { materialW, materialH, materialDepth } = useCanvasStore()

  return (
    <>
      <ambientLight intensity={0.6} />
      <directionalLight position={[200, 400, 200]} intensity={1.2} castShadow />
      <directionalLight position={[-100, 100, -100]} intensity={0.3} />

      <MaterialBlock w={materialW} h={materialH} depth={materialDepth} />
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

// Camera auto-fit on mount
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
