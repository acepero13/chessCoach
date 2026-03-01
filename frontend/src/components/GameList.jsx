import { useState, useEffect, useRef } from 'react'
import { CheckCircle, Circle, Zap, AlertCircle, Loader2, Clock } from 'lucide-react'
import { analyzeGames, getAnalysisStatus } from '../api/client'

function resultBadge(result) {
  const map = { win: 'bg-green-700 text-green-100', loss: 'bg-red-700 text-red-100', draw: 'bg-slate-600 text-slate-100' }
  return map[result] || 'bg-slate-600 text-slate-100'
}

export default function GameList({ games, userId, onAnalyzed }) {
  const [selected, setSelected] = useState(new Set())
  const [submitting, setSubmitting] = useState(false)
  const [analysisRunning, setAnalysisRunning] = useState(false)
  const [status, setStatus] = useState(null)   // { pending, running, complete, failed, total }
  const [error, setError] = useState(null)
  const pollRef = useRef(null)

  // Poll for analysis progress whenever analysis is running
  useEffect(() => {
    if (!analysisRunning || !userId) return

    const poll = async () => {
      try {
        const res = await getAnalysisStatus(userId)
        const s = res.data
        setStatus(s)
        if (s.running === 0 && s.pending === 0) {
          // All done
          setAnalysisRunning(false)
          onAnalyzed?.()
          clearInterval(pollRef.current)
        }
      } catch {
        // ignore transient errors
      }
    }

    poll()
    pollRef.current = setInterval(poll, 3000)
    return () => clearInterval(pollRef.current)
  }, [analysisRunning, userId])

  const toggle = (id) => {
    setSelected(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  const selectAll = () => setSelected(new Set(games.map(g => g.id)))
  const clearAll = () => setSelected(new Set())

  const handleAnalyze = async () => {
    setSubmitting(true)
    setError(null)
    try {
      await analyzeGames([...selected])
      setSelected(new Set())
      setAnalysisRunning(true)
    } catch (e) {
      setError(e.response?.data?.detail || e.message)
    } finally {
      setSubmitting(false)
    }
  }

  if (!games?.length) {
    return (
      <div className="bg-chess-panel rounded-xl p-8 text-center text-slate-400">
        No games imported yet. Import games above to get started.
      </div>
    )
  }

  const analyzedCount = games.filter(g => g.has_analysis).length

  return (
    <div className="bg-chess-panel rounded-xl overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-slate-700">
        <h2 className="text-lg font-semibold text-chess-gold">
          Games ({games.length})
          <span className="ml-2 text-sm font-normal text-slate-400">
            {analyzedCount} analyzed
          </span>
        </h2>
        <div className="flex gap-2">
          <button onClick={selectAll} className="text-xs text-slate-400 hover:text-white">Select all</button>
          <span className="text-slate-600">|</span>
          <button onClick={clearAll} className="text-xs text-slate-400 hover:text-white">Clear</button>
        </div>
      </div>

      {/* Analysis progress bar */}
      {analysisRunning && status && (
        <div className="px-4 py-3 bg-chess-accent/20 border-b border-slate-700">
          <div className="flex items-center gap-2 mb-2">
            <Loader2 size={14} className="text-chess-gold animate-spin" />
            <span className="text-sm text-chess-gold font-medium">Analysis running…</span>
            <span className="text-xs text-slate-400 ml-auto">
              {status.complete}/{status.total} complete
              {status.running > 0 && ` · ${status.running} in progress`}
              {status.failed > 0 && ` · ${status.failed} failed`}
            </span>
          </div>
          <div className="w-full bg-slate-700 rounded-full h-1.5">
            <div
              className="h-1.5 rounded-full bg-chess-gold transition-all duration-500"
              style={{ width: `${status.total ? (status.complete / status.total) * 100 : 0}%` }}
            />
          </div>
        </div>
      )}

      {/* Game rows */}
      <div className="max-h-96 overflow-y-auto divide-y divide-slate-800">
        {games.map(game => (
          <div
            key={game.id}
            onClick={() => !analysisRunning && toggle(game.id)}
            className={`flex items-center gap-3 px-4 py-3 transition-colors ${
              analysisRunning ? 'cursor-default' : 'cursor-pointer'
            } ${selected.has(game.id) ? 'bg-chess-accent/30' : 'hover:bg-slate-800/50'}`}
          >
            <div className="flex-shrink-0">
              {selected.has(game.id)
                ? <CheckCircle size={18} className="text-chess-gold" />
                : <Circle size={18} className="text-slate-600" />
              }
            </div>

            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 text-sm">
                <span className="text-white font-medium truncate">
                  {game.white_player} vs {game.black_player}
                </span>
                <span className={`text-xs px-1.5 py-0.5 rounded font-medium flex-shrink-0 ${resultBadge(game.result)}`}>
                  {game.result}
                </span>
              </div>
              <div className="flex items-center gap-2 text-xs text-slate-400 mt-0.5">
                <span>{game.opening_eco || '—'}</span>
                <span>{game.time_control || '—'}</span>
                <span className="capitalize">{game.source?.replace('_', ' ')}</span>
              </div>
            </div>

            <div className="flex-shrink-0">
              {game.has_analysis
                ? <Zap size={16} className="text-green-400" title="Analyzed" />
                : analysisRunning
                  ? <Clock size={16} className="text-slate-500" title="Queued" />
                  : <AlertCircle size={16} className="text-slate-600" title="Not analyzed" />
              }
            </div>
          </div>
        ))}
      </div>

      {/* Actions */}
      <div className="flex items-center justify-between p-4 border-t border-slate-700">
        <span className="text-sm text-slate-400">
          {analysisRunning
            ? <span className="flex items-center gap-1 text-chess-gold">
                <Loader2 size={12} className="animate-spin" /> Analyzing in background…
              </span>
            : `${selected.size} selected`
          }
        </span>
        <button
          onClick={handleAnalyze}
          disabled={submitting || analysisRunning || selected.size === 0}
          className="flex items-center gap-2 bg-chess-gold text-chess-dark font-semibold px-4 py-2 rounded-lg hover:opacity-90 disabled:opacity-50 transition-opacity text-sm"
        >
          {submitting
            ? <Loader2 size={16} className="animate-spin" />
            : <Zap size={16} />
          }
          {submitting
            ? 'Starting…'
            : analysisRunning
              ? 'Running…'
              : `Analyze ${selected.size > 0 ? selected.size + ' ' : ''}Games`
          }
        </button>
      </div>

      {error && (
        <div className="mx-4 mb-4 p-3 bg-red-900/40 border border-red-700 rounded-lg text-red-300 text-sm">
          {error}
        </div>
      )}
    </div>
  )
}
