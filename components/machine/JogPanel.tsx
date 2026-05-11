'use client'

import { useState } from 'react'
import { useGrblStore } from '@/lib/grbl/store'

const STEPS = [0.1, 1, 10, 50]
const FEEDS = [100, 500, 1000, 3000]

export default function JogPanel() {
  const { connected, send, home, unlock, reset, status } = useGrblStore()
  const [step, setStep] = useState(1)
  const [feed, setFeed] = useState(1000)

  const jog = (axis: string, dir: 1 | -1) => {
    send(`$J=G91 G21 ${axis}${dir * step} F${feed}`)
  }

  const cancelJog = () => send('\x85')

  const isAlarm = status?.state === 'Alarm'
  const isIdle = status?.state === 'Idle' || status?.state === 'Unknown'

  return (
    <div className="bg-zinc-900 rounded-lg border border-zinc-700 p-4 space-y-4">
      <span className="text-xs font-semibold text-zinc-400 uppercase tracking-wide">Jog</span>

      {/* XY grid */}
      <div className="grid grid-cols-3 gap-1 w-fit mx-auto">
        <div />
        <JogBtn label="Y+" onClick={() => jog('Y', 1)} disabled={!connected || isAlarm} />
        <div />
        <JogBtn label="X-" onClick={() => jog('X', -1)} disabled={!connected || isAlarm} />
        <button
          onMouseDown={cancelJog}
          className="w-10 h-10 bg-zinc-700 hover:bg-zinc-600 text-zinc-400 text-xs rounded transition-colors"
        >
          ■
        </button>
        <JogBtn label="X+" onClick={() => jog('X', 1)} disabled={!connected || isAlarm} />
        <div />
        <JogBtn label="Y-" onClick={() => jog('Y', -1)} disabled={!connected || isAlarm} />
        <div />
      </div>

      {/* Z axis */}
      <div className="flex gap-1 justify-center">
        <JogBtn label="Z+" onClick={() => jog('Z', 1)} disabled={!connected || isAlarm} />
        <JogBtn label="Z-" onClick={() => jog('Z', -1)} disabled={!connected || isAlarm} />
      </div>

      {/* Step size */}
      <div className="space-y-1">
        <span className="text-xs text-zinc-500">Step (mm)</span>
        <div className="flex gap-1">
          {STEPS.map(s => (
            <button
              key={s}
              onClick={() => setStep(s)}
              className={`flex-1 py-1 text-xs rounded transition-colors ${step === s ? 'bg-cyan-600 text-white' : 'bg-zinc-700 text-zinc-300 hover:bg-zinc-600'}`}
            >
              {s}
            </button>
          ))}
        </div>
      </div>

      {/* Feed rate */}
      <div className="space-y-1">
        <span className="text-xs text-zinc-500">Feed (mm/min)</span>
        <div className="flex gap-1">
          {FEEDS.map(f => (
            <button
              key={f}
              onClick={() => setFeed(f)}
              className={`flex-1 py-1 text-xs rounded transition-colors ${feed === f ? 'bg-cyan-600 text-white' : 'bg-zinc-700 text-zinc-300 hover:bg-zinc-600'}`}
            >
              {f}
            </button>
          ))}
        </div>
      </div>

      {/* Machine actions */}
      <div className="grid grid-cols-2 gap-2 pt-2 border-t border-zinc-700">
        <ActionBtn label="Home ($H)" onClick={home} disabled={!connected || isAlarm} color="blue" />
        <ActionBtn label="Unlock ($X)" onClick={unlock} disabled={!connected || !isAlarm} color="yellow" />
        <ActionBtn label="Zero WPos" onClick={() => send('G10 L20 P0 X0 Y0 Z0')} disabled={!connected || !isIdle} color="green" />
        <ActionBtn label="Soft Reset" onClick={reset} disabled={!connected} color="red" />
      </div>
    </div>
  )
}

function JogBtn({ label, onClick, disabled }: { label: string; onClick: () => void; disabled: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="w-10 h-10 bg-zinc-700 hover:bg-cyan-700 disabled:opacity-30 text-zinc-100 text-xs font-mono rounded transition-colors"
    >
      {label}
    </button>
  )
}

function ActionBtn({ label, onClick, disabled, color }: { label: string; onClick: () => void; disabled: boolean; color: string }) {
  const colors: Record<string, string> = {
    blue: 'bg-blue-700 hover:bg-blue-600',
    yellow: 'bg-yellow-600 hover:bg-yellow-500',
    green: 'bg-green-700 hover:bg-green-600',
    red: 'bg-red-700 hover:bg-red-600',
  }
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`py-1.5 text-xs text-white rounded disabled:opacity-30 transition-colors ${colors[color]}`}
    >
      {label}
    </button>
  )
}
