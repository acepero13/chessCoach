import { useState, useEffect, useRef, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { CheckCircle, Circle, Zap, AlertCircle, Loader2, Clock, BookOpen, PenLine, Eye, ChevronUp, ChevronDown } from 'lucide-react'
import { analyzeGames, getAnalysisStatus } from '../api/client'

function resultBadge(result) {
  const map = { win: 'bg-green-700 text-green-100', loss: 'bg-red-700 text-red-100', draw: 'bg-slate-600 text-slate-100' }
  return map[result] || 'bg-slate-600 text-slate-100'
}

const RESULT_FILTERS = ['all', 'win', 'loss', 'draw']
const STATUS_FILTERS = ['all', 'analyzed', 'not analyzed']

export default function GameList({ games, userId, onAnalyzed }) {
  const navigate = useNavigate()
  const [selected, setSelected] = useState(new Set())
  const [submitting, setSubmitting] = useState(false)
  const [analysisRunning, setAnalysisRunning] = useState(false)
  const [status, setStatus] = useState(null)
  const [error, setError] = useState(null)
  const [openDropdown, setOpenDropdown] = useState(null)

  // Filter & sort state
  const [resultFilter, setResultFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState('all')
  const [sortBy, setSortBy] = useState('newest')
  const [sortAsc, setSortAsc] = useState(false)

  const pollRef = useRef(null)

  // Poll for analysis progress
  useEffect(() => {
    if (!analysisRunning || !userId) return
    const poll = async () => {
      try {
        const res = await getAnalysisStatus(userId)
        const s = res.data
        setStatus(s)
        if (s.running === 0 && s.pending === 0) {
          setAnalysisRunning(false)
          onAnalyzed?.()
          clearInterval(pollRef.current)
        }
      } catch { /* ignore transient errors */ }
    }
    poll()
    pollRef.current = setInterval(poll, 3000)
    return () => clearInterval(pollRef.current)
  }, [analysisRunning, userId])

  const toggle = (id) => setSelected(prev => {
    const next = new Set(prev)
    next.has(id) ? next.delete(id) : next.add(id)
    return next
  })

  // Apply filters and sort
  const displayedGames = useMemo(() => {
    let filtered = [...games]
    if (resultFilter !== 'all') filtered = filtered.filter(g => g.result === resultFilter)
    if (statusFilter === 'analyzed') filtered = filtered.filter(g => g.has_analysis)
    if (statusFilter === 'not analyzed') filtered = filtered.filter(g => !g.has_analysis)

    filtered.sort((a, b) => {
      let diff = 0
      if (sortBy === 'newest' || sortBy === 'oldest') {
        const aTime = a.played_at ? new Date(a.played_at).getTime() : a.id
        const bTime = b.played_at ? new Date(b.played_at).getTime() : b.id
        diff = aTime - bTime
      } else if (sortBy === 'result') {
        const order = { win: 0, draw: 1, loss: 2 }
        diff = (order[a.result] ?? 3) - (order[b.result] ?? 3)
      } else if (sortBy === 'opening') {
        diff = (a.opening_eco || '').localeCompare(b.opening_eco || '')
      }
      return sortAsc ? diff : -diff
    })
    return filtered
  }, [games, resultFilter, statusFilter, sortBy, sortAsc])

  const selectAll = () => setSelected(new Set(displayedGames.map(g => g.id)))
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

  const cycleSortBy = (field) => {
    if (sortBy === field) {
      setSortAsc(a => !a)
    } else {
      setSortBy(field)
      setSortAsc(false)
    }
  }

  const SortBtn = ({ field, label }) => (
    <button
      onClick={() => cycleSortBy(field)}
      className={`text-xs px-2 py-1 rounded flex items-center gap-0.5 transition-colors ${
        sortBy === field ? 'text-chess-gold bg-chess-accent/30' : 'text-slate-400 hover:text-white'
      }`}
    >
      {label}
      {sortBy === field
        ? (sortAsc ? <ChevronUp size={11} /> : <ChevronDown size={11} />)
        : null}
    </button>
  )

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
          Games ({displayedGames.length}{displayedGames.length !== games.length ? `/${games.length}` : ''})
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

      {/* Filter & Sort bar */}
      <div className="px-4 py-2 border-b border-slate-800 flex flex-wrap gap-3 items-center">
        {/* Result filter pills */}
        <div className="flex gap-1">
          {RESULT_FILTERS.map(f => (
            <button
              key={f}
              onClick={() => setResultFilter(f)}
              className={`text-xs px-2.5 py-1 rounded-full border transition-colors capitalize ${
                resultFilter === f
                  ? 'bg-chess-gold text-chess-dark border-chess-gold font-medium'
                  : 'border-slate-600 text-slate-400 hover:border-slate-400 hover:text-slate-200'
              }`}
            >
              {f}
            </button>
          ))}
        </div>

        <span className="text-slate-700 text-xs">|</span>

        {/* Status filter */}
        <div className="flex gap-1">
          {STATUS_FILTERS.map(f => (
            <button
              key={f}
              onClick={() => setStatusFilter(f)}
              className={`text-xs px-2.5 py-1 rounded-full border transition-colors capitalize ${
                statusFilter === f
                  ? 'bg-chess-accent text-white border-chess-accent font-medium'
                  : 'border-slate-600 text-slate-400 hover:border-slate-400 hover:text-slate-200'
              }`}
            >
              {f}
            </button>
          ))}
        </div>

        <span className="text-slate-700 text-xs ml-auto">Sort:</span>
        <div className="flex gap-0.5">
          <SortBtn field="newest" label="Date" />
          <SortBtn field="result" label="Result" />
          <SortBtn field="opening" label="Opening" />
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
        {displayedGames.length === 0 ? (
          <div className="p-6 text-center text-slate-500 text-sm">No games match the current filters.</div>
        ) : displayedGames.map(game => (
          <div
            key={game.id}
            onClick={() => {
              if (analysisRunning) return
              if (openDropdown === game.id) { setOpenDropdown(null); return }
              toggle(game.id)
            }}
            className={`flex items-center gap-3 px-4 py-3 transition-colors ${
              analysisRunning ? 'cursor-default' : 'cursor-pointer'
            } ${selected.has(game.id) ? 'bg-chess-accent/30' : 'hover:bg-slate-800/50'}`}
          >
            <div className="flex-shrink-0">
              {selected.has(game.id)
                ? <CheckCircle size={18} className="text-chess-gold" />
                : <Circle size={18} className="text-slate-600" />}
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
                {game.opening_eco && <span>{game.opening_eco}</span>}
                {game.opening_name && <span className="truncate max-w-32">{game.opening_name}</span>}
                {game.time_control && <span>{game.time_control}</span>}
                {game.played_at && (
                  <span>{new Date(game.played_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}</span>
                )}
              </div>
            </div>

            {/* Action dropdown for analyzed games */}
            <div className="flex-shrink-0 relative" onClick={e => e.stopPropagation()}>
              {game.has_analysis ? (
                <>
                  <button
                    onClick={() => setOpenDropdown(openDropdown === game.id ? null : game.id)}
                    className="p-1 rounded hover:bg-slate-700 transition-colors"
                    title="Review options"
                  >
                    <Zap size={16} className="text-green-400" />
                  </button>

                  {openDropdown === game.id && (
                    <>
                      <div className="fixed inset-0 z-40" onClick={() => setOpenDropdown(null)} />
                      <div className="absolute right-0 top-8 z-50 bg-slate-800 border border-slate-600 rounded-lg shadow-xl w-48 overflow-hidden">
                        <button
                          onClick={() => { setOpenDropdown(null); navigate(`/game/${game.id}`) }}
                          className="w-full flex items-center gap-2 px-3 py-2.5 text-sm text-slate-300 hover:bg-slate-700 hover:text-white transition-colors text-left"
                        >
                          <Eye size={14} className="text-chess-gold flex-shrink-0" />
                          Review Game
                        </button>
                        <button
                          onClick={() => { setOpenDropdown(null); navigate(`/coaching/${game.id}`, { state: { userId } }) }}
                          className="w-full flex items-center gap-2 px-3 py-2.5 text-sm text-slate-300 hover:bg-slate-700 hover:text-white transition-colors text-left"
                        >
                          <BookOpen size={14} className="text-chess-gold flex-shrink-0" />
                          Analyse with Coach
                        </button>
                        <button
                          onClick={() => { setOpenDropdown(null); navigate(`/self-analysis/${game.id}`) }}
                          className="w-full flex items-center gap-2 px-3 py-2.5 text-sm text-slate-300 hover:bg-slate-700 hover:text-white transition-colors text-left"
                        >
                          <PenLine size={14} className="text-chess-gold flex-shrink-0" />
                          Self-Analysis
                        </button>
                      </div>
                    </>
                  )}
                </>
              ) : analysisRunning ? (
                <Clock size={16} className="text-slate-500" title="Queued" />
              ) : (
                <AlertCircle size={16} className="text-slate-600" title="Not analyzed" />
              )}
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
            : `${selected.size} selected`}
        </span>
        <button
          onClick={handleAnalyze}
          disabled={submitting || analysisRunning || selected.size === 0}
          className="flex items-center gap-2 bg-chess-gold text-chess-dark font-semibold px-4 py-2 rounded-lg hover:opacity-90 disabled:opacity-50 transition-opacity text-sm"
        >
          {submitting ? <Loader2 size={16} className="animate-spin" /> : <Zap size={16} />}
          {submitting ? 'Starting…' : analysisRunning ? 'Running…' : `Analyze ${selected.size > 0 ? selected.size + ' ' : ''}Games`}
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
