'use client'

import dynamic from 'next/dynamic'
import StatusBar    from '@/components/machine/StatusBar'
import JogPanel     from '@/components/machine/JogPanel'
import SpindlePanel from '@/components/machine/SpindlePanel'
import ProbePanel   from '@/components/machine/ProbePanel'
import FileSender   from '@/components/machine/FileSender'
import Terminal     from '@/components/machine/Terminal'
import CanvasToolbar from '@/components/canvas/CanvasToolbar'
import CamPanel     from '@/components/canvas/CamPanel'
import { useCanvasStore } from '@/lib/canvas/store'

const DesignCanvas = dynamic(() => import('@/components/canvas/DesignCanvas'), { ssr: false })
const Preview3D    = dynamic(() => import('@/components/canvas/Preview3D'),    { ssr: false })

export default function Home() {
  const view = useCanvasStore(s => s.view)

  return (
    <div className="flex flex-col h-screen bg-zinc-950 text-zinc-100">
      <header className="flex items-center gap-3 px-4 py-2 bg-zinc-900 border-b border-zinc-800">
        <span className="text-sm font-bold text-cyan-400 tracking-tight">Tap&apos;s Controller</span>
        <span className="text-xs text-zinc-600">X-Carve</span>
      </header>

      <StatusBar />

      <div className="flex flex-1 overflow-hidden">

        {/* Left — machine controls */}
        <aside className="w-64 flex-shrink-0 overflow-y-auto p-3 border-r border-zinc-800 space-y-3">
          <JogPanel />
          <SpindlePanel />
          <ProbePanel />
          <FileSender />
        </aside>

        {/* Centre — design canvas */}
        <main className="flex-1 flex flex-col overflow-hidden">
          <CanvasToolbar />
          {view === '2d' ? <DesignCanvas /> : <Preview3D />}
        </main>

        {/* Right — terminal + CAM */}
        <aside className="w-80 flex-shrink-0 flex flex-col border-l border-zinc-800 overflow-hidden">
          <div className="flex-1 min-h-0 p-3">
            <Terminal />
          </div>
          <div className="border-t border-zinc-800 p-3 overflow-y-auto max-h-[55%]">
            <CamPanel />
          </div>
        </aside>

      </div>
    </div>
  )
}
