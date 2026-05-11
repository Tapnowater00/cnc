'use client'

import { useRef, useState, useCallback } from 'react'
import { useGrblStore } from '@/lib/grbl/store'

// Grbl 1.1 real-time feed/rapid override bytes
const F = { reset: 0x90, plus10: 0x91, minus10: 0x92, plus1: 0x93, minus1: 0x94 }

export default function FileSender() {
  const { connected, job, loadFile, startJob, pauseJob, resumeJob, stopJob, feedOverride, status } = useGrblStore()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)

  const handleFile = useCallback(
    (file: File) => {
      if (!file.name.match(/\.(gcode|nc|cnc|tap|ngc)$/i)) {
        alert('Please load a G-code file (.gcode, .nc, .cnc, .tap, .ngc)')
        return
      }
      loadFile(file)
    },
    [loadFile]
  )

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setDragging(false)
    const file = e.dataTransfer.files[0]
    if (file) handleFile(file)
  }

  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) handleFile(file)
    e.target.value = ''
  }

  const progress = job ? Math.round((job.sent / job.total) * 100) : 0

  const elapsed = job?.startedAt
    ? Math.floor((Date.now() - job.startedAt) / 1000)
    : 0

  const eta =
    job && job.running && job.sent > 0
      ? Math.round((elapsed / job.sent) * (job.total - job.sent))
      : null

  const fmtTime = (s: number) => {
    const m = Math.floor(s / 60)
    const sec = s % 60
    return m > 0 ? `${m}m ${sec}s` : `${sec}s`
  }

  return (
    <div className="bg-zinc-900 rounded-lg border border-zinc-700 p-4 space-y-3">
      <span className="text-xs font-semibold text-zinc-400 uppercase tracking-wide">
        G-code Sender
      </span>

      {/* Drop zone */}
      {!job && (
        <div
          onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          onClick={() => fileInputRef.current?.click()}
          className={`border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-colors ${
            dragging
              ? 'border-cyan-500 bg-cyan-950/30'
              : 'border-zinc-600 hover:border-zinc-500'
          }`}
        >
          <div className="text-2xl mb-1">📂</div>
          <p className="text-xs text-zinc-400">Drop G-code file here</p>
          <p className="text-xs text-zinc-600 mt-0.5">or click to browse</p>
          <input
            ref={fileInputRef}
            type="file"
            accept=".gcode,.nc,.cnc,.tap,.ngc"
            onChange={onFileChange}
            className="hidden"
          />
        </div>
      )}

      {/* Job loaded */}
      {job && (
        <div className="space-y-3">
          {/* Filename + clear */}
          <div className="flex items-center justify-between">
            <span className="text-xs text-zinc-300 font-mono truncate max-w-40" title={job.filename}>
              {job.filename}
            </span>
            {!job.running && (
              <button
                onClick={() => useGrblStore.setState({ job: null })}
                className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors ml-2 flex-shrink-0"
              >
                ✕
              </button>
            )}
          </div>

          {/* Stats row */}
          <div className="flex justify-between text-xs text-zinc-500 font-mono">
            <span>{job.sent} / {job.total} lines</span>
            <span>{progress}%</span>
            {eta !== null && <span>ETA {fmtTime(eta)}</span>}
          </div>

          {/* Progress bar */}
          <div className="h-2 bg-zinc-700 rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-200 ${
                job.running && !job.paused
                  ? 'bg-cyan-500'
                  : job.paused
                  ? 'bg-yellow-500'
                  : job.sent === job.total && job.total > 0
                  ? 'bg-green-500'
                  : 'bg-zinc-500'
              }`}
              style={{ width: `${progress}%` }}
            />
          </div>

          {/* Current line preview */}
          {job.running && job.sent < job.total && (
            <div className="text-xs font-mono text-zinc-500 truncate">
              {job.lines[job.sent]}
            </div>
          )}

          {/* Complete message */}
          {!job.running && job.sent === job.total && job.total > 0 && (
            <p className="text-xs text-green-400 text-center">Job complete!</p>
          )}

          {/* Controls */}
          <div className="flex gap-2">
            {!job.running && job.sent < job.total && (
              <button
                onClick={startJob}
                disabled={!connected}
                className="flex-1 py-2 bg-cyan-600 hover:bg-cyan-500 disabled:opacity-40 text-white text-xs font-medium rounded transition-colors"
              >
                {job.sent === 0 ? 'Start' : 'Resume from start'}
              </button>
            )}

            {job.running && !job.paused && (
              <>
                <button
                  onClick={pauseJob}
                  className="flex-1 py-2 bg-yellow-600 hover:bg-yellow-500 text-white text-xs font-medium rounded transition-colors"
                >
                  Pause
                </button>
                <button
                  onClick={stopJob}
                  className="flex-1 py-2 bg-red-700 hover:bg-red-600 text-white text-xs font-medium rounded transition-colors"
                >
                  Stop
                </button>
              </>
            )}

            {job.running && job.paused && (
              <>
                <button
                  onClick={resumeJob}
                  className="flex-1 py-2 bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-medium rounded transition-colors"
                >
                  Resume
                </button>
                <button
                  onClick={stopJob}
                  className="flex-1 py-2 bg-red-700 hover:bg-red-600 text-white text-xs font-medium rounded transition-colors"
                >
                  Stop
                </button>
              </>
            )}

            {/* Load different file when not running */}
            {!job.running && (
              <>
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="px-3 py-2 bg-zinc-700 hover:bg-zinc-600 text-zinc-300 text-xs rounded transition-colors"
                  title="Load different file"
                >
                  📂
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".gcode,.nc,.cnc,.tap,.ngc"
                  onChange={onFileChange}
                  className="hidden"
                />
              </>
            )}
          </div>

          {/* Feed override — shown while running */}
          {job.running && (
            <div className="space-y-1 pt-1 border-t border-zinc-700">
              <div className="flex items-center justify-between">
                <span className="text-xs text-zinc-500">Feed override</span>
                <span className="text-xs font-mono text-zinc-400">{status?.overrides.feed ?? 100}%</span>
              </div>
              <div className="flex gap-1">
                {[
                  { label: '-10%', byte: F.minus10 },
                  { label: '-1%',  byte: F.minus1  },
                  { label: '100%', byte: F.reset   },
                  { label: '+1%',  byte: F.plus1   },
                  { label: '+10%', byte: F.plus10  },
                ].map(({ label, byte }) => (
                  <button
                    key={label}
                    onClick={() => feedOverride(byte)}
                    className="flex-1 py-1 text-xs rounded bg-zinc-700 hover:bg-zinc-600 text-zinc-200 transition-colors"
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
