import { useState, useCallback, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { Chessboard } from 'react-chessboard'
import {
  Target, RotateCcw, CheckCircle, XCircle, ArrowLeft,
  ChevronRight, Trophy, AlertCircle, Info, Undo2,
  TrendingUp, TrendingDown, Minus, BarChart2, Eye, EyeOff,
} from 'lucide-react'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Cell, BarChart, Bar,
} from 'recharts'
import { Chess } from 'chess.js'
import { getDrillPositions, applyDrillMove, evaluateDrillLine, getDrillStats } from '../api/client'

// ── Constants ─────────────────────────────────────────────────────────────────

const EMPTY_FEN = '8/8/8/8/8/8/8/8 w - - 0 1'

const ERROR_META = {
  good_calculation:    { label: 'Perfect calculation',    color: 'text-green-400',  bg: 'bg-green-900/20 border-green-700' },
  partial_calculation: { label: 'Partial — missed best line', color: 'text-yellow-400', bg: 'bg-yellow-900/20 border-yellow-700' },
  missed_forcing_move: { label: 'Missed forcing move',   color: 'text-orange-400', bg: 'bg-orange-900/20 border-orange-700' },
  incorrect_evaluation:{ label: 'Line diverged',         color: 'text-red-400',    bg: 'bg-red-900/20 border-red-700' },
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function AccBadge({ pct }) {
  const cls = pct === 100 ? 'text-green-400 border-green-700 bg-green-900/20'
    : pct >= 50 ? 'text-yellow-400 border-yellow-700 bg-yellow-900/20'
    : 'text-red-400 border-red-700 bg-red-900/20'
  return (
    <span className={`text-xs font-bold px-2 py-0.5 rounded border ${cls}`}>{pct}%</span>
  )
}

function PlyLabel({ ply, isOpponent, opponentColor }) {
  const whose = ply % 2 === 1   // ply 1,3,5 = opponent; 2,4,6 = user
    ? `${opponentColor} (opp)`
    : 'your move'
  return <span className="text-slate-500 text-xs w-24 shrink-0">{whose}</span>
}

// ── Stats Panel ───────────────────────────────────────────────────────────────

const ERROR_LABELS_SHORT = {
  good_calculation:    'Perfect',
  partial_calculation: 'Partial',
  missed_forcing_move: 'Missed forcing',
  incorrect_evaluation:'Line diverged',
}
const ERROR_COLORS = {
  good_calculation:    '#4ade80',
  partial_calculation: '#facc15',
  missed_forcing_move: '#fb923c',
  incorrect_evaluation:'#f87171',
}

function StatsPanel({ stats }) {
  if (!stats?.has_data) {
    return (
      <div className="bg-chess-panel border border-slate-700 rounded-xl p-4 text-center text-slate-500 text-sm">
        No drill history yet — complete your first session to see stats.
      </div>
    )
  }

  const ImprovementIcon = stats.improvement > 0 ? TrendingUp : stats.improvement < 0 ? TrendingDown : Minus
  const improvementColor = stats.improvement > 0 ? 'text-green-400' : stats.improvement < 0 ? 'text-red-400' : 'text-slate-400'

  const errorChartData = Object.entries(stats.error_counts).map(([cls, count]) => ({
    name: ERROR_LABELS_SHORT[cls] || cls,
    count,
    fill: ERROR_COLORS[cls] || '#94a3b8',
  }))

  return (
    <div className="space-y-3">
      {/* Key numbers */}
      <div className="grid grid-cols-3 gap-2">
        <div className="bg-chess-panel border border-slate-700 rounded-xl p-3 text-center">
          <div className="text-2xl font-bold text-chess-gold">{stats.avg_accuracy}%</div>
          <div className="text-xs text-slate-400 mt-0.5">Avg accuracy</div>
        </div>
        <div className="bg-chess-panel border border-slate-700 rounded-xl p-3 text-center">
          <div className="text-2xl font-bold text-white">{stats.total}</div>
          <div className="text-xs text-slate-400 mt-0.5">Drills done</div>
        </div>
        <div className="bg-chess-panel border border-slate-700 rounded-xl p-3 text-center">
          <div className={`text-2xl font-bold flex items-center justify-center gap-1 ${improvementColor}`}>
            <ImprovementIcon size={18} />
            {stats.improvement != null ? `${stats.improvement > 0 ? '+' : ''}${stats.improvement}%` : '—'}
          </div>
          <div className="text-xs text-slate-400 mt-0.5">Improvement</div>
        </div>
      </div>

      {/* Secondary stats */}
      <div className="grid grid-cols-3 gap-2 text-center">
        <div className="bg-chess-panel border border-slate-700 rounded-xl p-2">
          <div className="text-sm font-semibold text-green-400">{stats.best}%</div>
          <div className="text-xs text-slate-500">Best</div>
        </div>
        <div className="bg-chess-panel border border-slate-700 rounded-xl p-2">
          <div className="text-sm font-semibold text-white">{stats.avg_depth}</div>
          <div className="text-xs text-slate-500">Avg depth</div>
        </div>
        <div className="bg-chess-panel border border-slate-700 rounded-xl p-2">
          <div className="text-sm font-semibold text-orange-400">{stats.missed_forcing_pct}%</div>
          <div className="text-xs text-slate-500">Missed forcing</div>
        </div>
      </div>

      {/* Accuracy trend */}
      {stats.trend.length >= 3 && (
        <div className="bg-chess-panel border border-slate-700 rounded-xl p-3">
          <div className="text-xs text-slate-500 mb-2 uppercase tracking-wide">Accuracy trend (last {stats.trend.length})</div>
          <ResponsiveContainer width="100%" height={80}>
            <LineChart data={stats.trend} margin={{ top: 2, right: 4, left: -28, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
              <XAxis dataKey="index" tick={{ fontSize: 10, fill: '#64748b' }} />
              <YAxis domain={[0, 100]} tick={{ fontSize: 10, fill: '#64748b' }} />
              <Tooltip
                contentStyle={{ background: '#1e293b', border: '1px solid #475569', fontSize: 11 }}
                formatter={v => [`${v}%`, 'Accuracy']}
              />
              <Line type="monotone" dataKey="accuracy" stroke="#d4a017" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Error breakdown */}
      {errorChartData.length > 0 && (
        <div className="bg-chess-panel border border-slate-700 rounded-xl p-3">
          <div className="text-xs text-slate-500 mb-2 uppercase tracking-wide">Error breakdown</div>
          <div className="space-y-1.5">
            {errorChartData.sort((a, b) => b.count - a.count).map(({ name, count, fill }) => {
              const pct = Math.round(count / stats.total * 100)
              return (
                <div key={name} className="flex items-center gap-2">
                  <span className="text-xs w-28 shrink-0" style={{ color: fill }}>{name}</span>
                  <div className="flex-1 bg-slate-700 rounded-full h-1.5">
                    <div className="h-1.5 rounded-full" style={{ width: `${pct}%`, background: fill }} />
                  </div>
                  <span className="text-xs text-slate-400 w-8 text-right">{count}×</span>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Perfect streak */}
      {stats.perfect_streak > 0 && (
        <div className="bg-green-900/20 border border-green-700 rounded-xl p-2 text-center text-sm text-green-300">
          {stats.perfect_streak === 1
            ? 'Last drill was perfect!'
            : `${stats.perfect_streak} perfect drills in a row!`}
        </div>
      )}

      {/* Key insight */}
      {stats.missed_forcing_pct >= 40 && (
        <div className="bg-orange-900/20 border border-orange-700 rounded-xl p-2.5 text-xs text-orange-200">
          <strong>Focus area:</strong> You miss forcing moves in {stats.missed_forcing_pct}% of drills.
          Always scan for checks and captures before other moves.
        </div>
      )}
    </div>
  )
}

// ── Setup Phase ───────────────────────────────────────────────────────────────

function SetupPhase({ onStart, loading, error, userId, stats }) {
  const [includeMistakes, setIncludeMistakes] = useState(false)
  const [maxPlies, setMaxPlies] = useState(4)
  const [showStats, setShowStats] = useState(false)
  const [blindMode, setBlindMode] = useState(false)

  return (
    <div className="min-h-screen bg-chess-dark p-4">
      <div className="max-w-md mx-auto pt-8">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <Target size={24} className="text-chess-gold" />
            <div>
              <h1 className="text-xl font-bold text-white">Calculation Drills</h1>
              <p className="text-slate-400 text-xs">Train opponent response anticipation from your own mistakes</p>
            </div>
          </div>
          {stats?.has_data && (
            <button
              onClick={() => setShowStats(v => !v)}
              className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full border transition-colors ${showStats ? 'border-chess-gold text-chess-gold bg-chess-gold/10' : 'border-slate-600 text-slate-400 hover:border-slate-400 hover:text-white'}`}
            >
              <BarChart2 size={12} /> Stats
            </button>
          )}
        </div>

        {/* Stats section */}
        {showStats && (
          <div className="mb-4">
            <StatsPanel stats={stats} />
          </div>
        )}

        <div className="bg-chess-panel rounded-xl p-5 border border-slate-700 space-y-5 mb-4">

          {/* Explanation */}
          <div className="bg-slate-800/60 rounded-lg p-3 flex gap-2 text-xs text-slate-300">
            <Info size={14} className="text-chess-gold shrink-0 mt-0.5" />
            <span>
              Each drill shows the board <strong>after your blunder</strong> — it's now your
              opponent's turn. Predict their best move, then your reply, and so on.
              After submitting your line the engine reveals what should have happened.
            </span>
          </div>

          {/* Include mistakes toggle */}
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm text-white font-medium">Include mistakes</div>
              <div className="text-xs text-slate-400">Also drill positions from inaccuracies (&gt;60cp)</div>
            </div>
            <button
              onClick={() => setIncludeMistakes(v => !v)}
              className={`w-11 h-6 rounded-full transition-colors relative ${includeMistakes ? 'bg-chess-gold' : 'bg-slate-600'}`}
            >
              <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-all ${includeMistakes ? 'left-5' : 'left-0.5'}`} />
            </button>
          </div>

          {/* Depth slider */}
          <div>
            <div className="flex justify-between mb-1">
              <span className="text-sm text-white font-medium">Calculation depth</span>
              <span className="text-chess-gold font-bold text-sm">{maxPlies} plies</span>
            </div>
            <input
              type="range" min={2} max={6} value={maxPlies}
              onChange={e => setMaxPlies(Number(e.target.value))}
              className="w-full accent-chess-gold"
            />
            <div className="flex justify-between text-xs text-slate-500 mt-0.5">
              <span>2 — beginner</span><span>4 — standard</span><span>6 — advanced</span>
            </div>
          </div>

          {/* Blind mode toggle */}
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm text-white font-medium flex items-center gap-1.5">
                <EyeOff size={14} className="text-slate-400" /> Blind mode
              </div>
              <div className="text-xs text-slate-400">Board hides after the first move — train visualization</div>
            </div>
            <button
              onClick={() => setBlindMode(v => !v)}
              className={`w-11 h-6 rounded-full transition-colors relative ${blindMode ? 'bg-chess-gold' : 'bg-slate-600'}`}
            >
              <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-all ${blindMode ? 'left-5' : 'left-0.5'}`} />
            </button>
          </div>
        </div>

        {error && (
          <div className="bg-red-900/20 border border-red-700 rounded-lg p-3 text-red-300 text-sm mb-4">
            {error}
          </div>
        )}

        {!userId && (
          <div className="bg-yellow-900/20 border border-yellow-700 rounded-lg p-3 text-yellow-300 text-sm mb-4">
            Sign in on the dashboard first to load your positions.
          </div>
        )}

        <button
          onClick={() => onStart(includeMistakes, maxPlies, blindMode)}
          disabled={loading || !userId}
          className="w-full bg-chess-gold text-chess-dark font-bold py-3 rounded-xl hover:bg-chess-gold/90 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
        >
          {loading ? 'Loading positions…' : 'Start Drilling'}
          {!loading && <ChevronRight size={18} />}
        </button>
      </div>
    </div>
  )
}

// ── Drill Phase ────────────────────────────────────────────────────────────────

function DrillPhase({ pos, posIdx, total, maxPlies, blindMode, userLine, currentFen, selectedSquare, applying, onSquareClick, onPieceDrop, onUndo, onReveal, onBlindMove }) {
  const opponentColor = pos.opponent_color
  const currentPly = userLine.length          // 0-based: 0 = first move (opp), 1 = user, …
  const drillComplete = currentPly >= maxPlies

  // Which side is to move right now in the drill sequence
  const isOpponentTurn = currentPly % 2 === 0
  const activeColor   = isOpponentTurn ? opponentColor : pos.user_color

  const prompt = isOpponentTurn
    ? `What is ${opponentColor}'s best response?`
    : 'What do you play?'

  // Blind mode: hide pieces after the first move has been entered
  const isBlind = blindMode && userLine.length >= 1
  const boardFen = isBlind ? EMPTY_FEN : currentFen

  // Text input state for blind mode
  const [moveInput, setMoveInput] = useState('')
  const [moveError, setMoveError] = useState('')
  const inputRef = useRef(null)

  // Auto-focus input when blind mode activates
  useEffect(() => {
    if (isBlind && !drillComplete) inputRef.current?.focus()
  }, [isBlind, currentPly, drillComplete])

  const handleBlindSubmit = (e) => {
    e.preventDefault()
    const raw = moveInput.trim()
    if (!raw) return
    setMoveError('')
    try {
      const chess = new Chess(currentFen)
      const result = chess.move(raw)   // accepts SAN, LAN, and partial notation
      if (!result) { setMoveError('Illegal move — try again.'); return }
      const uci = result.from + result.to + (result.promotion || '')
      onBlindMove(uci)
      setMoveInput('')
    } catch {
      setMoveError('Invalid move — use algebraic notation, e.g. Nf3, Qxe1, O-O')
    }
  }

  return (
    <div className="min-h-screen bg-chess-dark p-4">
      <div className="max-w-5xl mx-auto">

        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Target size={18} className="text-chess-gold" />
            <span className="text-white font-semibold">Calculation Drill</span>
            {blindMode && (
              <span className="flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-slate-700 text-slate-300">
                <EyeOff size={11} /> Blind
              </span>
            )}
          </div>
          <div className="text-slate-400 text-sm">
            <span className="text-chess-gold font-bold">{posIdx + 1}</span> / {total}
          </div>
        </div>

        {/* Context banner */}
        <div className="bg-chess-panel border border-slate-700 rounded-xl p-3 mb-4 flex items-start gap-2">
          <AlertCircle size={16} className="text-red-400 shrink-0 mt-0.5" />
          <p className="text-sm text-slate-300">
            In the game vs <strong className="text-white">{pos.user_color === 'white' ? pos.black_player : pos.white_player}</strong>,
            you played <strong className="text-red-300">{pos.move_san}</strong> on
            move {pos.move_number} — a <span className="text-red-400 font-medium">{pos.classification}</span> ({pos.centipawn_loss} cp loss).
            The board is now set <strong className="text-white">after your move</strong>. It is {opponentColor}'s turn.
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

          {/* Board */}
          <div>
            <div className="relative rounded-xl overflow-hidden">
              <Chessboard
                key={pos.fen_after}
                options={{
                  position: boardFen,
                  boardOrientation: pos.user_color === 'black' ? 'black' : 'white',
                  allowDragging: !drillComplete && !isBlind,
                  onPieceDrop: ({ sourceSquare, targetSquare }) => {
                    onPieceDrop(sourceSquare, targetSquare)
                    return true
                  },
                  onSquareClick: ({ square }) => onSquareClick(square),
                  animationDurationInMs: isBlind ? 0 : 150,
                  boardStyle: { borderRadius: '8px' },
                  customSquareStyles: selectedSquare
                    ? { [selectedSquare]: { background: 'rgba(255, 210, 0, 0.4)' } }
                    : {},
                }}
              />
              {isBlind && (
                <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                  <EyeOff size={32} className="text-slate-500 mb-2" />
                  <p className="text-slate-400 text-sm font-medium">Visualize the position</p>
                </div>
              )}
            </div>

            {/* Blind mode text input */}
            {isBlind && !drillComplete && (
              <form onSubmit={handleBlindSubmit} className="mt-3">
                <div className="flex gap-2">
                  <input
                    ref={inputRef}
                    type="text"
                    value={moveInput}
                    onChange={e => { setMoveInput(e.target.value); setMoveError('') }}
                    placeholder={isOpponentTurn ? `${opponentColor}'s move…` : 'Your move…'}
                    className="flex-1 bg-chess-panel border border-slate-600 focus:border-chess-gold rounded-lg px-3 py-2 text-white text-sm font-mono placeholder-slate-500 outline-none transition-colors"
                    autoComplete="off"
                    spellCheck={false}
                    disabled={applying}
                  />
                  <button
                    type="submit"
                    disabled={applying || !moveInput.trim()}
                    className="px-3 py-2 rounded-lg bg-chess-gold text-chess-dark font-bold text-sm disabled:opacity-40 transition-colors hover:bg-chess-gold/90"
                  >
                    {applying ? '…' : 'Enter'}
                  </button>
                </div>
                {moveError && (
                  <p className="text-red-400 text-xs mt-1.5">{moveError}</p>
                )}
                <p className="text-slate-600 text-xs mt-1">e.g. Nf3, Qxe1, O-O, e4</p>
              </form>
            )}

            <div className="mt-2 flex items-center justify-between">
              <span className="text-xs text-slate-500">
                {drillComplete ? 'Line complete — ready to reveal' : (
                  <>
                    <span className={activeColor === 'white' ? 'text-white' : 'text-slate-300'}>
                      {activeColor} to move
                    </span>
                    {applying && <span className="text-slate-500 ml-2">…</span>}
                  </>
                )}
              </span>
              <button
                onClick={onUndo}
                disabled={userLine.length === 0}
                className="flex items-center gap-1 text-xs text-slate-400 hover:text-white disabled:opacity-30 transition-colors"
              >
                <Undo2 size={12} /> Undo
              </button>
            </div>
          </div>

          {/* Right panel */}
          <div className="flex flex-col gap-4">

            {/* Prompt */}
            <div className="bg-chess-panel border border-slate-700 rounded-xl p-4">
              <div className="text-xs text-slate-500 mb-1">
                Ply {currentPly + 1} of {maxPlies}
              </div>
              <p className="text-white font-medium">{drillComplete ? 'Your line is complete.' : prompt}</p>
              {!drillComplete && (
                <p className="text-slate-400 text-xs mt-1">
                  {isOpponentTurn
                    ? 'Click or drag a piece on the board to enter the opponent\'s move.'
                    : 'Now enter your best reply.'}
                </p>
              )}
            </div>

            {/* Move list */}
            <div className="bg-chess-panel border border-slate-700 rounded-xl p-4">
              <div className="text-xs text-slate-500 mb-3 uppercase tracking-wide">Your predicted line</div>
              {userLine.length === 0 ? (
                <p className="text-slate-600 text-sm italic">No moves entered yet.</p>
              ) : (
                <div className="space-y-1.5">
                  {userLine.map((m, i) => {
                    const isOpp = i % 2 === 0
                    return (
                      <div key={i} className="flex items-center gap-2">
                        <span className="text-slate-600 text-xs w-5 text-right">{i + 1}.</span>
                        <span className={`text-xs w-20 shrink-0 ${isOpp ? 'text-slate-400' : 'text-chess-gold'}`}>
                          {isOpp ? `${opponentColor}` : 'you'}
                        </span>
                        <span className="font-mono text-sm text-white">{m.san}</span>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>

            {/* Reveal button */}
            {drillComplete && (
              <button
                onClick={onReveal}
                className="w-full bg-chess-gold text-chess-dark font-bold py-3 rounded-xl hover:bg-chess-gold/90 transition-colors flex items-center justify-center gap-2"
              >
                Reveal Engine Line <ChevronRight size={18} />
              </button>
            )}

            {/* Skip without answering */}
            {!drillComplete && userLine.length > 0 && (
              <button
                onClick={onReveal}
                className="w-full border border-slate-600 text-slate-400 hover:text-white hover:border-slate-400 font-medium py-2 rounded-xl transition-colors text-sm"
              >
                Reveal now ({userLine.length} move{userLine.length !== 1 ? 's' : ''} entered)
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Revealed Phase ─────────────────────────────────────────────────────────────

function RevealedPhase({ pos, result, posIdx, total, onNext, onSummary }) {
  const meta = ERROR_META[result.error_classification] || ERROR_META.incorrect_evaluation
  const opponentColor = pos.opponent_color

  return (
    <div className="min-h-screen bg-chess-dark p-4">
      <div className="max-w-3xl mx-auto">

        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-2">
            <Target size={18} className="text-chess-gold" />
            <span className="text-white font-semibold">Calculation Drill — Result</span>
          </div>
          <div className="text-slate-400 text-sm">
            <span className="text-chess-gold font-bold">{posIdx + 1}</span> / {total}
          </div>
        </div>

        {/* Score card */}
        <div className={`border rounded-xl p-4 mb-4 ${meta.bg}`}>
          <div className="flex items-center justify-between">
            <div>
              <div className={`font-bold text-base ${meta.color}`}>{meta.label}</div>
              <div className="text-slate-300 text-sm mt-0.5">{result.feedback}</div>
            </div>
            <AccBadge pct={result.accuracy} />
          </div>
        </div>

        {/* Move-by-move comparison */}
        <div className="bg-chess-panel border border-slate-700 rounded-xl p-4 mb-4">
          <div className="text-xs text-slate-500 uppercase tracking-wide mb-3">Line comparison</div>

          {/* Column headers */}
          <div className="grid grid-cols-[1.5rem_1fr_1.5rem_1fr] gap-2 text-xs text-slate-500 mb-2 px-1">
            <span />
            <span>Your move</span>
            <span />
            <span>Engine</span>
          </div>

          <div className="space-y-2">
            {result.move_results.map((r, i) => {
              const isOpp = i % 2 === 0
              return (
                <div key={i} className={`grid grid-cols-[1.5rem_1fr_1.5rem_1fr] gap-2 items-center rounded-lg px-2 py-1.5 ${r.matched ? 'bg-green-900/10' : 'bg-red-900/10'}`}>
                  {/* Ply number + color label */}
                  <span className="text-slate-600 text-xs">{i + 1}.</span>

                  {/* User move */}
                  <div className="flex items-center gap-1.5">
                    <span className={`text-xs ${isOpp ? 'text-slate-400' : 'text-chess-gold'}`}>
                      {isOpp ? opponentColor : 'you'}
                    </span>
                    <span className="font-mono text-sm text-white">{r.user_move}</span>
                  </div>

                  {/* Match indicator */}
                  {r.matched
                    ? <CheckCircle size={14} className="text-green-400" />
                    : <XCircle size={14} className="text-red-400" />
                  }

                  {/* Engine move */}
                  <div className="flex items-center gap-1.5">
                    <span className="font-mono text-sm text-slate-300">{r.engine_move || '—'}</span>
                    {!r.matched && r.error_type && (
                      <span className="text-xs text-orange-400">
                        {r.error_type === 'missed_check' ? '(check!)' : r.error_type === 'missed_capture' ? '(capture!)' : ''}
                      </span>
                    )}
                  </div>
                </div>
              )
            })}

            {/* Engine continuation beyond user's line */}
            {result.engine_line.slice(result.move_results.length).map((san, i) => (
              <div key={`eng-${i}`} className="grid grid-cols-[1.5rem_1fr_1.5rem_1fr] gap-2 items-center rounded-lg px-2 py-1.5 bg-slate-800/40">
                <span className="text-slate-700 text-xs">{result.move_results.length + i + 1}.</span>
                <span className="text-slate-600 text-xs italic">—</span>
                <span />
                <span className="font-mono text-sm text-slate-400">{san}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Navigation */}
        <div className="flex gap-3">
          {posIdx + 1 < total ? (
            <button
              onClick={onNext}
              className="flex-1 bg-chess-gold text-chess-dark font-bold py-3 rounded-xl hover:bg-chess-gold/90 transition-colors flex items-center justify-center gap-2"
            >
              Next Drill <ChevronRight size={18} />
            </button>
          ) : (
            <button
              onClick={onSummary}
              className="flex-1 bg-chess-gold text-chess-dark font-bold py-3 rounded-xl hover:bg-chess-gold/90 transition-colors flex items-center justify-center gap-2"
            >
              <Trophy size={18} /> View Summary
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Summary Phase ──────────────────────────────────────────────────────────────

function SummaryPhase({ drillResults, onRestart, onDashboard }) {
  const avgAccuracy = drillResults.length
    ? Math.round(drillResults.reduce((s, r) => s + r.accuracy, 0) / drillResults.length)
    : 0

  const errorCounts = drillResults.reduce((acc, r) => {
    acc[r.error_classification] = (acc[r.error_classification] || 0) + 1
    return acc
  }, {})

  return (
    <div className="min-h-screen bg-chess-dark flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-6">
          <Trophy size={40} className="text-chess-gold mx-auto mb-2" />
          <h2 className="text-2xl font-bold text-white">Session Complete</h2>
          <p className="text-slate-400 text-sm">{drillResults.length} drills completed</p>
        </div>

        {/* Overall accuracy */}
        <div className="bg-chess-panel border border-slate-700 rounded-xl p-5 mb-4 text-center">
          <div className="text-5xl font-bold text-chess-gold mb-1">{avgAccuracy}%</div>
          <div className="text-slate-400 text-sm">Average accuracy</div>
        </div>

        {/* Error breakdown */}
        <div className="bg-chess-panel border border-slate-700 rounded-xl p-4 mb-4 space-y-2">
          <div className="text-xs text-slate-500 uppercase tracking-wide mb-3">Error breakdown</div>
          {Object.entries(errorCounts).map(([cls, count]) => {
            const m = ERROR_META[cls] || ERROR_META.incorrect_evaluation
            return (
              <div key={cls} className="flex items-center justify-between">
                <span className={`text-sm ${m.color}`}>{m.label}</span>
                <span className="text-white font-bold text-sm">{count}×</span>
              </div>
            )
          })}
          {Object.keys(errorCounts).length === 0 && (
            <p className="text-slate-500 text-sm italic">No errors recorded.</p>
          )}
        </div>

        {/* Coaching insight */}
        {errorCounts.missed_forcing_move > 0 && (
          <div className="bg-orange-900/20 border border-orange-700 rounded-xl p-3 mb-4 text-sm text-orange-200">
            You missed forcing moves in {errorCounts.missed_forcing_move} drill{errorCounts.missed_forcing_move > 1 ? 's' : ''}.
            Before calculating, always ask: are there checks, captures, or threats available?
          </div>
        )}

        <div className="flex gap-3">
          <button
            onClick={onRestart}
            className="flex-1 flex items-center justify-center gap-2 border border-slate-600 text-slate-300 hover:text-white hover:border-slate-400 font-semibold py-3 rounded-xl transition-colors"
          >
            <RotateCcw size={16} /> Drill Again
          </button>
          <button
            onClick={onDashboard}
            className="flex-1 flex items-center justify-center gap-2 border border-slate-600 text-slate-300 hover:text-white hover:border-slate-400 font-semibold py-3 rounded-xl transition-colors"
          >
            <ArrowLeft size={16} /> Dashboard
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Main Component ─────────────────────────────────────────────────────────────

export default function Drills({ userId }) {
  const navigate = useNavigate()

  // Session
  const [positions, setPositions]     = useState([])
  const [posIdx, setPosIdx]           = useState(0)
  const [maxPlies, setMaxPlies]       = useState(4)
  const [blindMode, setBlindMode]     = useState(false)
  const [phase, setPhase]             = useState('setup')  // setup|drilling|revealed|summary
  const [drillResults, setDrillResults] = useState([])

  // Drill state
  const [currentFen, setCurrentFen]   = useState('')
  const [fenHistory, setFenHistory]   = useState([])
  const [userLine, setUserLine]       = useState([])       // [{uci, san}]
  const [selectedSquare, setSelectedSquare] = useState(null)
  const [result, setResult]           = useState(null)

  // UI
  const [loading, setLoading]   = useState(false)
  const [applying, setApplying] = useState(false)
  const [error, setError]       = useState(null)
  const [stats, setStats]       = useState(null)

  // Fetch stats on mount and after each session
  const fetchStats = useCallback(async () => {
    if (!userId) return
    try {
      const res = await getDrillStats(userId)
      setStats(res.data)
    } catch { /* stats are optional */ }
  }, [userId])

  useEffect(() => { fetchStats() }, [fetchStats])

  const pos = positions[posIdx] || null

  // ── Start a drill session ────────────────────────────────────────────────────

  const handleStart = useCallback(async (includeMistakes, plies, blind) => {
    if (!userId) return
    setMaxPlies(plies)
    setBlindMode(blind)
    setLoading(true)
    setError(null)
    try {
      const res = await getDrillPositions(userId, includeMistakes, 10)
      const loaded = res.data.positions || []
      if (loaded.length === 0) {
        setError('No drill positions found. Analyze some games first (blunders required).')
        return
      }
      setPositions(loaded)
      setPosIdx(0)
      setDrillResults([])
      beginDrill(loaded[0], loaded[0].fen_after)
      setPhase('drilling')
    } catch {
      setError('Failed to load positions. Check your connection and try again.')
    } finally {
      setLoading(false)
    }
  }, [userId])

  function beginDrill(position, startFen) {
    setCurrentFen(startFen)
    setFenHistory([startFen])
    setUserLine([])
    setSelectedSquare(null)
    setResult(null)
  }

  // ── Board interaction ────────────────────────────────────────────────────────

  const applyMove = useCallback(async (from, to) => {
    if (applying || !currentFen || userLine.length >= maxPlies) return false
    const uci = from + to
    setApplying(true)
    try {
      const res = await applyDrillMove(currentFen, uci)
      const data = res.data
      if (!data.legal) return false
      setCurrentFen(data.fen_after)
      setFenHistory(prev => [...prev, data.fen_after])
      setUserLine(prev => [...prev, { uci, san: data.move_san }])
      setSelectedSquare(null)
      return true
    } catch {
      return false
    } finally {
      setApplying(false)
    }
  }, [applying, currentFen, userLine.length, maxPlies])

  const handleSquareClick = useCallback(async (square) => {
    if (userLine.length >= maxPlies) return
    if (!selectedSquare) {
      setSelectedSquare(square)
    } else {
      if (selectedSquare === square) { setSelectedSquare(null); return }
      const ok = await applyMove(selectedSquare, square)
      if (!ok) setSelectedSquare(square)  // reselect if move illegal
    }
  }, [selectedSquare, applyMove, userLine.length, maxPlies])

  const handlePieceDrop = useCallback(async (from, to) => {
    return await applyMove(from, to)
  }, [applyMove])

  // Blind mode: move is a full UCI string (e.g. "e2e4", "e7e8q") from chess.js
  const handleBlindMove = useCallback(async (uci) => {
    if (applying || !currentFen || userLine.length >= maxPlies) return
    setApplying(true)
    try {
      const res = await applyDrillMove(currentFen, uci)
      const data = res.data
      if (!data.legal) return
      setCurrentFen(data.fen_after)
      setFenHistory(prev => [...prev, data.fen_after])
      setUserLine(prev => [...prev, { uci, san: data.move_san }])
      setSelectedSquare(null)
    } catch { /* ignore */ } finally {
      setApplying(false)
    }
  }, [applying, currentFen, userLine.length, maxPlies])

  const handleUndo = useCallback(() => {
    if (userLine.length === 0) return
    const newHistory = fenHistory.slice(0, -1)
    setFenHistory(newHistory)
    setCurrentFen(newHistory[newHistory.length - 1])
    setUserLine(prev => prev.slice(0, -1))
    setSelectedSquare(null)
  }, [userLine.length, fenHistory])

  // ── Reveal ───────────────────────────────────────────────────────────────────

  const handleReveal = useCallback(async () => {
    if (!pos || userLine.length === 0) return
    setLoading(true)
    try {
      const res = await evaluateDrillLine(
        pos.fen_after, userLine.map(m => m.uci),
        userId, pos.game_id, pos.classification, pos.centipawn_loss,
      )
      const data = res.data
      setResult(data)
      setDrillResults(prev => [...prev, { accuracy: data.accuracy, error_classification: data.error_classification }])
      setPhase('revealed')
      fetchStats()   // refresh stats after drill completes
    } catch {
      setError('Evaluation failed. Try again.')
    } finally {
      setLoading(false)
    }
  }, [pos, userLine])

  // ── Navigation ───────────────────────────────────────────────────────────────

  const handleNext = useCallback(() => {
    const next = posIdx + 1
    if (next >= positions.length) { setPhase('summary'); return }
    setPosIdx(next)
    beginDrill(positions[next], positions[next].fen_after)
    setPhase('drilling')
  }, [posIdx, positions])

  const handleRestart = () => {
    setPhase('setup')
    setPositions([])
    setPosIdx(0)
    setDrillResults([])
    setBlindMode(false)
    setError(null)
  }

  // ── Render ───────────────────────────────────────────────────────────────────

  if (phase === 'setup') {
    return <SetupPhase onStart={handleStart} loading={loading} error={error} userId={userId} stats={stats} />
  }

  if (phase === 'drilling' && pos) {
    return (
      <DrillPhase
        pos={pos}
        posIdx={posIdx}
        total={positions.length}
        maxPlies={maxPlies}
        blindMode={blindMode}
        userLine={userLine}
        currentFen={currentFen}
        selectedSquare={selectedSquare}
        applying={applying}
        onSquareClick={handleSquareClick}
        onPieceDrop={handlePieceDrop}
        onUndo={handleUndo}
        onReveal={handleReveal}
        onBlindMove={handleBlindMove}
      />
    )
  }

  if (phase === 'revealed' && pos && result) {
    return (
      <RevealedPhase
        pos={pos}
        result={result}
        posIdx={posIdx}
        total={positions.length}
        onNext={handleNext}
        onSummary={() => setPhase('summary')}
      />
    )
  }

  if (phase === 'summary') {
    return (
      <SummaryPhase
        drillResults={drillResults}
        onRestart={handleRestart}
        onDashboard={() => navigate('/')}
      />
    )
  }

  return null
}
