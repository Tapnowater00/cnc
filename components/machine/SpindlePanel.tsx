'use client'

import { useState } from 'react'
import { useGrblStore } from '@/lib/grbl/store'

// Grbl 1.1 real-time spindle override bytes
const S = { reset: 0x99, plus10: 0x9a, minus10: 0x9b, plus1: 0x9c, minus1: 0x9d }

export default function SpindlePanel() {
  const { connected, send, status, spindleOverride } = useGrblStore()
  const [rpm, setRpm] = useState(18000)

  const isIdle = status?.state === 'Idle' || status?.state === 'Unknown'
  const currentRPM = status?.spindle ?? 0
  const ovr = status?.overrides.spindle ?? 100
  const isOn = currentRPM > 0

  return (
    <div className="bg-zinc-900 rounded-lg border border-zinc-700 p-4 space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-zinc-400 uppercase tracking-wide">Spindle</span>
        {isOn && (
          <span className="text-xs font-mono text-green-400">{currentRPM} RPM</span>
        )}
      </div>

      <div className="flex items-center gap-2">
        <span className="text-xs text-zinc-500 shrink-0">RPM</span>
        <input
          type="number"
          value={rpm}
          onChange={e => setRpm(Number(e.target.value))}
          step={1000}
          min={100}
          className="flex-1 bg-zinc-800 border border-zinc-600 rounded px-2 py-1 text-xs text-zinc-100 text-right"
        />
      </div>

      <div className="flex gap-2">
        <button
          onClick={() => send(`M3 S${rpm}`)}
          disabled={!connected || !isIdle}
          className="flex-1 py-1.5 text-xs font-semibold bg-green-700 hover:bg-green-600 disabled:opacity-30 text-white rounded transition-colors"
        >
          M3 On
        </button>
        <button
          onClick={() => send('M5')}
          disabled={!connected}
          className="flex-1 py-1.5 text-xs font-semibold bg-red-700 hover:bg-red-600 disabled:opacity-30 text-white rounded transition-colors"
        >
          M5 Off
        </button>
      </div>

      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <span className="text-xs text-zinc-500">Speed override</span>
          <span className="text-xs font-mono text-zinc-400">{ovr}%</span>
        </div>
        <div className="flex gap-1">
          {[
            { label: '-10%', byte: S.minus10 },
            { label: '-1%',  byte: S.minus1  },
            { label: '100%', byte: S.reset   },
            { label: '+1%',  byte: S.plus1   },
            { label: '+10%', byte: S.plus10  },
          ].map(({ label, byte }) => (
            <button
              key={label}
              onClick={() => spindleOverride(byte)}
              disabled={!connected}
              className="flex-1 py-1 text-xs rounded bg-zinc-700 hover:bg-zinc-600 disabled:opacity-30 text-zinc-200 transition-colors"
            >
              {label}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
