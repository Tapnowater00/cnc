'use client'

import { useRef, useState, useEffect } from 'react'
import { useGrblStore } from '@/lib/grbl/store'

export default function Terminal() {
  const { log, connected, send, clearLog } = useGrblStore()
  const [input, setInput] = useState('')
  const [history, setHistory] = useState<string[]>([])
  const [historyIdx, setHistoryIdx] = useState(-1)
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [log])

  const submit = () => {
    const cmd = input.trim()
    if (!cmd) return
    send(cmd)
    setHistory(h => [cmd, ...h.slice(0, 49)])
    setHistoryIdx(-1)
    setInput('')
  }

  const onKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') { submit(); return }
    if (e.key === 'ArrowUp') {
      const idx = Math.min(historyIdx + 1, history.length - 1)
      setHistoryIdx(idx)
      setInput(history[idx] ?? '')
    }
    if (e.key === 'ArrowDown') {
      const idx = Math.max(historyIdx - 1, -1)
      setHistoryIdx(idx)
      setInput(idx === -1 ? '' : history[idx])
    }
  }

  const dirColor = (dir: string) => {
    if (dir === 'tx') return 'text-cyan-400'
    if (dir === 'rx') return 'text-green-400'
    if (dir === 'error') return 'text-red-400'
    if (dir === 'msg') return 'text-yellow-400'
    return 'text-zinc-400'
  }

  const dirPrefix = (dir: string) => {
    if (dir === 'tx') return '> '
    if (dir === 'rx') return '< '
    if (dir === 'error') return '! '
    if (dir === 'msg') return '# '
    return '  '
  }

  return (
    <div className="flex flex-col h-full bg-zinc-900 rounded-lg border border-zinc-700">
      <div className="flex items-center justify-between px-3 py-2 border-b border-zinc-700">
        <span className="text-xs font-semibold text-zinc-400 uppercase tracking-wide">Terminal</span>
        <button
          onClick={clearLog}
          className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors"
        >
          Clear
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-3 font-mono text-xs space-y-0.5">
        {log.map(entry => (
          <div key={entry.id} className={`${dirColor(entry.direction)} leading-5`}>
            <span className="opacity-50">{dirPrefix(entry.direction)}</span>
            {entry.text}
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      <div className="flex gap-2 p-2 border-t border-zinc-700">
        <input
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={onKey}
          disabled={!connected}
          placeholder={connected ? 'Send command...' : 'Not connected'}
          className="flex-1 bg-zinc-800 text-zinc-100 text-xs font-mono px-3 py-2 rounded border border-zinc-600 focus:outline-none focus:border-cyan-500 disabled:opacity-40 placeholder:text-zinc-600"
        />
        <button
          onClick={submit}
          disabled={!connected || !input.trim()}
          className="px-3 py-2 bg-cyan-600 hover:bg-cyan-500 disabled:opacity-40 text-white text-xs rounded transition-colors"
        >
          Send
        </button>
      </div>
    </div>
  )
}
