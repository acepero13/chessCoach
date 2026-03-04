import { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, PenLine, CheckCircle, Clock, Trophy, ChevronRight, BarChart2, ArrowUpDown } from 'lucide-react'
import { listUserSessions } from '../api/client'

// ── Helpers ────────────────────────────────────────────────────────────────

function fmtDate(iso) {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

function ScorePill({ label, value }) {
  if (value == null) return null
  const color =
    value >= 75 ? 'bg-green-900/50 text-green-300 border-green-700' :
    value >= 50 ? 'bg-yellow-900/50 text-yellow-300 border-yellow-700' :
                  'bg-red-900/50 text-red-300 border-red-700'
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded border text-xs font-mono ${color}`}>
      {label} <span className="font-bold">{value}</span>
    </span>
  )
}

const PATTERN_LABELS = {
  pawn_structure_weakened: 'Pawn structure',
  isolated_pawn_created: 'Isolated pawn',
  weak_squares_created: 'Weak squares',
  strategic_drift: 'Strategic drift',
  bishop_knight_trade_bad: 'Poor B×N trade',
  bishop_knight_trade_ok: 'Good B×N trade',
  fork: 'Fork',
  pin: 'Pin',
  hanging_piece: 'Hanging piece',
  checkmate_threat: 'Mate threat',
}

// Average of all non-null scores for a session, used for sort-by-score.
function avgScore(s) {
  const vals = [s.eval_accuracy_score, s.candidate_quality_score, s.tactical_awareness_score, s.confidence_calibration_score].filter(v => v != null)
  return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : -1
}

// A single filter pill button.
function FilterPill({ label, active, onClick }) {
  return (
    <button
      onClick={onClick}
      className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${
        active
          ? 'bg-chess-gold text-chess-dark border-chess-gold'
          : 'bg-transparent text-slate-400 border-slate-600 hover:border-slate-400 hover:text-slate-200'
      }`}
    >
      {label}
    </button>
  )
}

// ── Main component ─────────────────────────────────────────────────────────

export default function ReviewedGames({ userId }) {
  const navigate = useNavigate()
  const [sessions, setSessions] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  // Filter state
  const [statusFilter, setStatusFilter] = useState('all')   // 'all' | 'completed' | 'in_progress'
  const [resultFilter, setResultFilter] = useState('all')   // 'all' | 'win' | 'loss' | 'draw'
  const [sortBy, setSortBy] = useState('newest')            // 'newest' | 'oldest' | 'score'

  useEffect(() => {
    if (!userId) return
    listUserSessions(userId)
      .then(res => setSessions(res.data.sessions || []))
      .catch(e => setError(e.response?.data?.detail || e.message))
      .finally(() => setLoading(false))
  }, [userId])

  // Derived: filtered + sorted list
  const filtered = useMemo(() => {
    let list = [...sessions]

    if (statusFilter === 'completed')   list = list.filter(s => s.completed)
    if (statusFilter === 'in_progress') list = list.filter(s => !s.completed)
    if (resultFilter !== 'all')         list = list.filter(s => s.game_result === resultFilter)

    if (sortBy === 'newest') list.sort((a, b) => new Date(b.started_at) - new Date(a.started_at))
    if (sortBy === 'oldest') list.sort((a, b) => new Date(a.started_at) - new Date(b.started_at))
    if (sortBy === 'score')  list.sort((a, b) => avgScore(b) - avgScore(a))

    return list
  }, [sessions, statusFilter, resultFilter, sortBy])

  // ── Layout ───────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-chess-dark text-white">
      {/* Header */}
      <div className="border-b border-slate-800 bg-chess-panel">
        <div className="max-w-4xl mx-auto px-4 py-4 flex items-center gap-3">
          <button
            onClick={() => navigate('/')}
            className="text-slate-400 hover:text-white transition-colors"
            title="Back to Dashboard"
          >
            <ArrowLeft size={20} />
          </button>
          <PenLine size={20} className="text-chess-gold" />
          <h1 className="text-lg font-bold text-white">Reviewed Games</h1>
          {!loading && sessions.length > 0 && (
            <span className="ml-auto text-xs text-slate-500">{filtered.length} / {sessions.length}</span>
          )}
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-4 py-6">

        {/* ── Filter bar ── */}
        {!loading && sessions.length > 0 && (
          <div className="flex flex-wrap gap-4 mb-5">
            {/* Status */}
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-slate-500 mr-0.5">Status</span>
              {[['all', 'All'], ['completed', 'Completed'], ['in_progress', 'In Progress']].map(([val, label]) => (
                <FilterPill key={val} label={label} active={statusFilter === val} onClick={() => setStatusFilter(val)} />
              ))}
            </div>

            {/* Result */}
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-slate-500 mr-0.5">Result</span>
              {[['all', 'All'], ['win', 'Win'], ['loss', 'Loss'], ['draw', 'Draw']].map(([val, label]) => (
                <FilterPill key={val} label={label} active={resultFilter === val} onClick={() => setResultFilter(val)} />
              ))}
            </div>

            {/* Sort */}
            <div className="flex items-center gap-1.5 ml-auto">
              <ArrowUpDown size={12} className="text-slate-500" />
              {[['newest', 'Newest'], ['oldest', 'Oldest'], ['score', 'Best score']].map(([val, label]) => (
                <FilterPill key={val} label={label} active={sortBy === val} onClick={() => setSortBy(val)} />
              ))}
            </div>
          </div>
        )}

        {loading && (
          <div className="text-chess-gold animate-pulse text-center py-12">Loading sessions…</div>
        )}

        {error && (
          <div className="bg-red-900/40 border border-red-700 rounded-xl p-4 text-red-300 text-sm">
            {error}
          </div>
        )}

        {!loading && !error && sessions.length === 0 && (
          <div className="text-center py-16 text-slate-500">
            <PenLine size={40} className="mx-auto mb-3 opacity-30" />
            <p className="text-lg">No reviewed games yet.</p>
            <p className="text-sm mt-1">Start a Self-Analysis session from the Dashboard.</p>
          </div>
        )}

        {!loading && sessions.length > 0 && filtered.length === 0 && (
          <div className="text-center py-12 text-slate-500">
            <p>No sessions match the current filters.</p>
            <button
              onClick={() => { setStatusFilter('all'); setResultFilter('all') }}
              className="mt-3 text-xs text-chess-gold hover:underline"
            >
              Clear filters
            </button>
          </div>
        )}

        {!loading && filtered.length > 0 && (
          <div className="flex flex-col gap-3">
            {filtered.map(s => {
              const opponent = s.user_color === 'white' ? s.black_player : s.white_player
              const resultIcon =
                s.game_result === 'win'  ? <Trophy size={14} className="text-yellow-400" /> :
                s.game_result === 'loss' ? <span className="text-red-400 text-xs font-bold">L</span> :
                s.game_result === 'draw' ? <span className="text-slate-400 text-xs font-bold">D</span> : null
              const resultText =
                s.game_result === 'win'  ? 'text-yellow-400' :
                s.game_result === 'loss' ? 'text-red-400' :
                                           'text-slate-400'

              return (
                <button
                  key={s.session_id}
                  onClick={() => navigate(`/self-analysis/${s.game_id}`)}
                  className="w-full text-left bg-chess-panel border border-slate-700 hover:border-chess-gold/50 rounded-xl p-4 transition-colors group"
                >
                  <div className="flex items-start gap-3">
                    {/* Status icon */}
                    <div className="mt-1 flex-shrink-0">
                      {s.completed
                        ? <CheckCircle size={16} className="text-green-400" />
                        : <Clock size={16} className="text-yellow-400" />}
                    </div>

                    {/* Main content */}
                    <div className="flex-1 min-w-0">
                      {/* Top row: opponent + result + date */}
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold text-white truncate">
                          vs <span className="text-chess-gold">{opponent || '?'}</span>
                        </span>
                        {resultIcon && (
                          <span className={`flex items-center gap-1 text-xs font-semibold capitalize ${resultText}`}>
                            {resultIcon} {s.game_result}
                          </span>
                        )}
                        <span className="text-xs text-slate-500 ml-auto flex-shrink-0">
                          {fmtDate(s.completed_at || s.started_at)}
                        </span>
                      </div>

                      {/* Moves reviewed */}
                      <div className="mt-1 text-xs text-slate-400">
                        {s.completed
                          ? `${s.moves_reviewed} of ${s.total_user_moves} moves reviewed`
                          : `In progress · ${s.moves_reviewed} of ${s.total_user_moves} submitted`}
                      </div>

                      {/* Score pills */}
                      {s.completed && (s.eval_accuracy_score != null || s.candidate_quality_score != null) && (
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          <ScorePill label="Eval" value={s.eval_accuracy_score} />
                          <ScorePill label="Candidates" value={s.candidate_quality_score} />
                          <ScorePill label="Tactics" value={s.tactical_awareness_score} />
                          <ScorePill label="Confidence" value={s.confidence_calibration_score} />
                        </div>
                      )}

                      {/* Top patterns */}
                      {s.top_patterns?.length > 0 && (
                        <div className="mt-1.5 flex flex-wrap gap-1">
                          {s.top_patterns.map(([ptype, count]) => (
                            <span key={ptype} className="text-xs bg-slate-800 text-slate-400 border border-slate-700 rounded px-1.5 py-0.5">
                              {PATTERN_LABELS[ptype] || ptype}
                              {count > 1 && <span className="ml-1 text-slate-500">×{count}</span>}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* Arrow */}
                    <ChevronRight size={16} className="text-slate-600 group-hover:text-chess-gold transition-colors flex-shrink-0 mt-1" />
                  </div>
                </button>
              )
            })}
          </div>
        )}

        {/* Summary bar — always based on full session list, not filtered */}
        {!loading && sessions.length > 0 && (
          <div className="mt-6 bg-chess-panel border border-slate-700 rounded-xl p-4 flex items-center gap-3">
            <BarChart2 size={16} className="text-chess-gold flex-shrink-0" />
            <span className="text-sm text-slate-300">
              <span className="font-bold text-white">{sessions.filter(s => s.completed).length}</span> completed
              {' · '}
              <span className="font-bold text-white">{sessions.filter(s => !s.completed).length}</span> in progress
              {' · '}
              <span className="font-bold text-white">
                {sessions.filter(s => s.completed).reduce((sum, s) => sum + (s.moves_reviewed || 0), 0)}
              </span> total moves reviewed
            </span>
          </div>
        )}
      </div>
    </div>
  )
}
