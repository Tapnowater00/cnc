'use client'

import { useEffect } from 'react'
import { useGrblStore } from '@/lib/grbl/store'
import type { GrblState } from '@/lib/grbl/parser'

const STATE_COLORS: Record<GrblState | 'Unknown', string> = {
  Idle:    'bg-green-600',
  Run:     'bg-cyan-600',
  Jog:     'bg-cyan-500',
  Hold:    'bg-yellow-500',
  Home:    'bg-purple-600',
  Alarm:   'bg-red-600',
  Door:    'bg-orange-500',
  Check:   'bg-zinc-500',
  Sleep:   'bg-zinc-600',
  Unknown: 'bg-zinc-700',
}

export default function StatusBar() {
  const {
    connected, connecting, wsReady,
    availablePorts, selectedPort,
    status, alarmMessage, firmware,
    initWs, listPorts, setSelectedPort, connect, disconnect,
  } = useGrblStore()

  useEffect(() => { initWs() }, [])

  const state = status?.state ?? 'Unknown'
  const pos = status?.wpos ?? { x: 0, y: 0, z: 0 }
  const mpos = status?.mpos ?? { x: 0, y: 0, z: 0 }
  const pins = status?.pins
  const fs = status ? `${status.feed} mm/min  S${status.spindle}` : '—'

  const fmt = (n: number) => n.toFixed(3).padStart(8)

  return (
    <div className="bg-zinc-900 border-b border-zinc-700">
      {alarmMessage && (
        <div className="bg-red-900/60 border-b border-red-700 px-4 py-1.5 text-xs text-red-300 font-mono">
          ⚠ ALARM: {alarmMessage} — Send $X to unlock
        </div>
      )}

      <div className="flex items-center gap-4 px-4 py-2 flex-wrap">
        {/* State badge */}
        <div className={`px-3 py-1 rounded text-xs font-bold text-white min-w-16 text-center ${STATE_COLORS[state as GrblState]}`}>
          {state}
        </div>

        {/* Work position */}
        <div className="flex gap-3 font-mono text-sm">
          <Axis label="X" value={fmt(pos.x)} />
          <Axis label="Y" value={fmt(pos.y)} />
          <Axis label="Z" value={fmt(pos.z)} />
        </div>

        {/* Feed + spindle */}
        {status && (
          <div className="text-xs text-zinc-400 font-mono">{fs}</div>
        )}

        {/* Pins */}
        {pins && (
          <div className="flex gap-1">
            <Pin label="X" active={pins.x} title="X limit" />
            <Pin label="Y" active={pins.y} title="Y limit" />
            <Pin label="Z" active={pins.z} title="Z limit" />
            <Pin label="P" active={pins.probe} title="Probe" color="yellow" />
            <Pin label="E" active={pins.estop} title="E-Stop" color="red" />
          </div>
        )}

        <div className="flex-1" />

        {/* Firmware badge */}
        {firmware && (
          <div
            title={`${firmware.isGrblHAL ? 'GRBLHAL' : 'Grbl'} ${firmware.version} — ${firmware.axes} axes`}
            className={`px-2 py-0.5 rounded text-[10px] font-mono font-medium ${
              firmware.isGrblHAL
                ? 'bg-purple-900 text-purple-300 border border-purple-700'
                : 'bg-zinc-800 text-zinc-400 border border-zinc-600'
            }`}
          >
            {firmware.isGrblHAL ? 'GRBLHAL' : 'Grbl'} {firmware.version}
          </div>
        )}

        {/* Machine pos */}
        {status && (
          <div className="text-xs text-zinc-600 font-mono hidden lg:flex gap-2">
            <span>MPos</span>
            <span>{fmt(mpos.x)}</span>
            <span>{fmt(mpos.y)}</span>
            <span>{fmt(mpos.z)}</span>
          </div>
        )}

        {/* Port selector + connect — only shown when not connected */}
        {!connected && (
          <div className="flex items-center gap-2">
            <select
              value={selectedPort}
              onChange={(e) => setSelectedPort(e.target.value)}
              className="bg-zinc-800 border border-zinc-600 text-zinc-200 text-xs rounded px-2 py-1.5 min-w-36"
            >
              {availablePorts.length === 0 ? (
                <option value="">No ports found</option>
              ) : (
                availablePorts.map(p => (
                  <option key={p} value={p}>{p}</option>
                ))
              )}
            </select>
            <button
              onClick={listPorts}
              title="Rescan ports"
              className="px-2 py-1.5 text-xs rounded bg-zinc-700 hover:bg-zinc-600 text-zinc-300 transition-colors"
            >
              ↺
            </button>
          </div>
        )}

        {/* Connect / Disconnect button */}
        <button
          onClick={connected ? disconnect : () => connect()}
          disabled={connecting || (!connected && !wsReady)}
          className={`px-4 py-1.5 text-xs rounded font-medium transition-colors ${
            connected
              ? 'bg-red-700 hover:bg-red-600 text-white'
              : 'bg-cyan-700 hover:bg-cyan-600 text-white'
          } disabled:opacity-50`}
        >
          {connecting ? 'Connecting...' : connected ? 'Disconnect' : wsReady ? 'Connect' : 'Waiting…'}
        </button>
      </div>
    </div>
  )
}

function Axis({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline gap-1">
      <span className="text-xs text-zinc-500">{label}</span>
      <span className="text-zinc-100">{value}</span>
    </div>
  )
}

function Pin({ label, active, title, color = 'red' }: { label: string; active: boolean; title: string; color?: string }) {
  const activeColor = color === 'yellow' ? 'bg-yellow-500 text-black' : 'bg-red-500 text-white'
  return (
    <div
      title={title}
      className={`w-5 h-5 rounded text-[10px] font-bold flex items-center justify-center transition-colors ${active ? activeColor : 'bg-zinc-700 text-zinc-600'}`}
    >
      {label}
    </div>
  )
}
