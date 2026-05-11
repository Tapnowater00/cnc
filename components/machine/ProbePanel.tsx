'use client'

import { useState } from 'react'
import { useGrblStore } from '@/lib/grbl/store'

export default function ProbePanel() {
  const { connected, probeResult, probing, probeZ, send, status } = useGrblStore()
  const [thickness, setThickness] = useState(15)
  const [feed, setFeed] = useState(100)
  const [maxDist, setMaxDist] = useState(50)

  const isIdle = status?.state === 'Idle'
  const canProbe = connected && isIdle && !probing

  return (
    <div className="bg-zinc-900 rounded-lg border border-zinc-700 p-4 space-y-3">
      <span className="text-xs font-semibold text-zinc-400 uppercase tracking-wide">Z Probe</span>

      <div className="space-y-2">
        <Row label="Plate thickness (mm)">
          <NumInput value={thickness} onChange={setThickness} step={0.1} min={0} />
        </Row>
        <Row label="Feed (mm/min)">
          <NumInput value={feed} onChange={setFeed} step={10} min={10} />
        </Row>
        <Row label="Max distance (mm)">
          <NumInput value={maxDist} onChange={setMaxDist} step={1} min={1} />
        </Row>
      </div>

      <button
        onClick={() => probeZ(thickness, feed, maxDist)}
        disabled={!canProbe}
        className="w-full py-2 text-xs font-semibold bg-orange-700 hover:bg-orange-600 disabled:opacity-30 text-white rounded transition-colors"
      >
        {probing ? 'Probing…' : 'Probe Z'}
      </button>

      {probeResult && (
        <div className={`text-xs rounded px-3 py-2 border ${
          probeResult.success
            ? 'bg-green-900/40 text-green-400 border-green-800'
            : 'bg-red-900/40 text-red-400 border-red-800'
        }`}>
          {probeResult.success
            ? `Contact at Z${probeResult.mpos.z.toFixed(3)} — Z zeroed (plate ${thickness}mm)`
            : 'No contact — check plate wiring and position'}
        </div>
      )}

      <div className="pt-2 border-t border-zinc-700 space-y-1">
        <span className="text-xs text-zinc-500">Manual Z zero</span>
        <button
          onClick={() => send('G10 L20 P0 Z0')}
          disabled={!connected || !isIdle}
          className="w-full py-1.5 text-xs bg-zinc-700 hover:bg-zinc-600 disabled:opacity-30 text-zinc-200 rounded transition-colors"
        >
          Set Z = 0 here
        </button>
      </div>
    </div>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-xs text-zinc-500">{label}</span>
      {children}
    </div>
  )
}

function NumInput({ value, onChange, step, min }: { value: number; onChange: (v: number) => void; step: number; min: number }) {
  return (
    <input
      type="number"
      value={value}
      onChange={e => onChange(Number(e.target.value))}
      step={step}
      min={min}
      className="w-16 bg-zinc-800 border border-zinc-600 rounded px-2 py-0.5 text-xs text-zinc-100 text-right"
    />
  )
}
