import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { Chessboard } from 'react-chessboard'
import { Chess } from 'chess.js'
import {
  ArrowLeft, ChevronsLeft, ChevronLeft, ChevronRight, ChevronsRight,
  BookOpen, PenLine,
} from 'lucide-react'
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceLine,
} from 'recharts'
import { getGame, getGameAnalysis } from '../api/client'

// ── Constants ────────────────────────────────────────────────────────────────

const CLS_COLOR = {
  best: '#4ade80',
  good: '#86efac',
  inaccuracy: '#fbbf24',
  mistake: '#f97316',
  blunder: '#ef4444',
}

const CLS_BADGE = {
  best: 'text-green-400',
  good: 'text-green-500',
  inaccuracy: 'text-yellow-400',
  mistake: 'text-orange-400',
  blunder: 'text-red-400',
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function evalToWhite(e) {
  // eval_before/after are from the mover's perspective; convert to white's perspective
  return e.color === 'white' ? e.eval_after : -e.eval_after
}

function clampEval(v) {
  return Math.max(-700, Math.min(700, v))
}

function formatEval(cp) {
  if (cp > 9000) return '+M'
  if (cp < -9000) return '-M'
  const pawns = Math.abs(cp) / 100
  return (cp >= 0 ? '+' : '-') + pawns.toFixed(1)
}

function evalBarWhitePercent(cpFromWhite) {
  if (cpFromWhite > 9000) return 95
  if (cpFromWhite < -9000) return 5
  return 50 + (clampEval(cpFromWhite) / 700) * 45
}

// Build positions array: positions[0] = before move 0, positions[i+1] = after move i
function buildPositions(evals) {
  if (!evals.length) return []
  const result = [evals[0].fen]
  let chess
  try { chess = new Chess(evals[0].fen) } catch { return [evals[0].fen] }
  for (const e of evals) {
    try {
      chess.move(e.move_san)
      result.push(chess.fen())
    } catch {
      result.push(e.fen) // fallback
    }
  }
  return result
}

// Group evals into move-number pairs [{moveNumber, white, whiteIdx, black, blackIdx}]
function buildMovePairs(evals) {
  const pairs = []
  let i = 0
  while (i < evals.length) {
    const e = evals[i]
    if (e.color === 'white') {
      const next = evals[i + 1]
      const black = next?.color === 'black' ? next : null
      pairs.push({ moveNumber: e.move_number, white: e, whiteIdx: i, black, blackIdx: black ? i + 1 : null })
      i += black ? 2 : 1
    } else {
      pairs.push({ moveNumber: e.move_number, white: null, whiteIdx: null, black: e, blackIdx: i })
      i++
    }
  }
  return pairs
}

// ── Sub-components ───────────────────────────────────────────────────────────

function NavBtn({ onClick, children, title, disabled }) {
  return (
    <button
      onClick={onClick}
      title={title}
      disabled={disabled}
      className="p-1.5 rounded bg-slate-700 hover:bg-slate-600 disabled:opacity-30 text-slate-300 hover:text-white transition-colors"
    >
      {children}
    </button>
  )
}

function MoveChip({ e, active, onClick }) {
  if (!e) return <div className="flex-1" />
  const clsColor = CLS_COLOR[e.classification]
  const bg = active
    ? 'bg-chess-accent text-white'
    : 'hover:bg-slate-700/60 text-slate-300 hover:text-white'
  const showDot = e.classification && !['best', 'good'].includes(e.classification)
  return (
    <button
      onClick={onClick}
      className={`flex-1 flex items-center gap-1 px-2 py-0.5 rounded text-xs transition-colors ${bg}`}
    >
      {showDot && (
        <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: clsColor }} />
      )}
      <span className="font-medium truncate">{e.move_san}</span>
    </button>
  )
}

function EvalTooltip({ payload }) {
  if (!payload?.length) return null
  const d = payload[0].payload
  return (
    <div className="bg-slate-800 border border-slate-600 rounded px-2 py-1 text-xs pointer-events-none">
      <div className="text-slate-400">{d.label} <span className="text-white font-medium">{d.moveSan}</span></div>
      <div style={{ color: d.eval >= 0 ? '#e2b96f' : '#94a3b8' }}>
        {d.eval >= 0 ? '+' : ''}{d.eval.toFixed(2)}
      </div>
      {d.classification && (
        <div style={{ color: CLS_COLOR[d.classification] }}>{d.classification}</div>
      )}
    </div>
  )
}

// ── Main component ───────────────────────────────────────────────────────────

export default function GameReview({ userId }) {
  const { gameId } = useParams()
  const navigate = useNavigate()

  const [game, setGame] = useState(null)
  const [analysis, setAnalysis] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  // moveIdx: -1 = initial position, i = position after move i was played
  const [moveIdx, setMoveIdx] = useState(-1)
  const moveListRef = useRef(null)

  useEffect(() => {
    const load = async () => {
      try {
        const [gameRes, analysisRes] = await Promise.all([
          getGame(Number(gameId)),
          getGameAnalysis(Number(gameId)),
        ])
        setGame(gameRes.data)
        setAnalysis(analysisRes.data)
      } catch (e) {
        setError(e.response?.data?.detail || e.message)
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [gameId])

  const evals = analysis?.move_evaluations || []
  const userColor = game?.user_color || 'white'

  const positions = useMemo(() => buildPositions(evals), [evals])
  const movePairs = useMemo(() => buildMovePairs(evals), [evals])

  // Current FEN: positions[0] = before move 0, positions[i+1] = after move i
  const currentFen = positions[moveIdx + 1] || positions[0] || 'start'

  // Eval from white's perspective at the current board state
  const currentEvalWhite = useMemo(() => {
    if (moveIdx < 0) {
      if (!evals.length) return 0
      const e = evals[0]
      return e.color === 'white' ? e.eval_before : -e.eval_before
    }
    return evalToWhite(evals[moveIdx])
  }, [moveIdx, evals])

  // Arrow highlighting the last played move (react-chessboard v5 format)
  const lastMoveArrows = useMemo(() => {
    if (moveIdx < 0 || !evals[moveIdx]?.move_uci) return []
    const uci = evals[moveIdx].move_uci
    if (uci.length < 4) return []
    return [{ startSquare: uci.slice(0, 2), endSquare: uci.slice(2, 4), color: 'rgba(255,170,0,0.45)' }]
  }, [moveIdx, evals])

  // Eval graph data: one point per move, y = eval from white's perspective after the move
  const evalData = useMemo(() => evals.map((e, i) => ({
    idx: i,
    label: e.color === 'white' ? `${e.move_number}.` : `${e.move_number}…`,
    moveSan: e.move_san,
    eval: Math.round(clampEval(evalToWhite(e))) / 100,
    classification: e.classification,
    isUserMove: e.color === userColor,
  })), [evals, userColor])

  const go = useCallback((idx) => {
    setMoveIdx(Math.max(-1, Math.min(evals.length - 1, idx)))
  }, [evals.length])

  // Scroll move list to keep active move visible
  useEffect(() => {
    if (!moveListRef.current) return
    const active = moveListRef.current.querySelector('[data-active="true"]')
    if (active) active.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [moveIdx])

  // Keyboard navigation
  useEffect(() => {
    const handler = (e) => {
      if (['INPUT', 'TEXTAREA'].includes(e.target.tagName)) return
      if (e.key === 'ArrowLeft') go(moveIdx - 1)
      else if (e.key === 'ArrowRight') go(moveIdx + 1)
      else if (e.key === 'ArrowUp' || e.key === 'Home') go(-1)
      else if (e.key === 'ArrowDown' || e.key === 'End') go(evals.length - 1)
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [moveIdx, go, evals.length])

  // ── Render ─────────────────────────────────────────────────────────────────

  if (loading) return (
    <div className="min-h-screen bg-chess-dark flex items-center justify-center">
      <span className="text-slate-400">Loading game…</span>
    </div>
  )

  if (error) return (
    <div className="min-h-screen bg-chess-dark flex items-center justify-center">
      <div className="text-red-400 text-center">
        <p className="text-lg font-semibold mb-2">Failed to load</p>
        <p className="text-sm">{error}</p>
        <button onClick={() => navigate(-1)} className="mt-4 text-chess-gold hover:underline text-sm">← Go back</button>
      </div>
    </div>
  )

  const blueBarPercent = evalBarWhitePercent(currentEvalWhite)
  const evalLabel = formatEval(currentEvalWhite)
  const currentMove = moveIdx >= 0 ? evals[moveIdx] : null

  return (
    <div className="min-h-screen bg-chess-dark flex flex-col">
      {/* ── Header ── */}
      <div className="bg-chess-panel border-b border-slate-700 px-4 py-3 flex items-center gap-4 flex-wrap">
        <button
          onClick={() => navigate(-1)}
          className="flex items-center gap-1 text-slate-400 hover:text-white transition-colors text-sm flex-shrink-0"
        >
          <ArrowLeft size={16} /> Back
        </button>

        {game && (
          <div className="flex items-center gap-3 flex-1 min-w-0">
            <span className="text-white font-semibold truncate">{game.white_player}</span>
            <span className="text-slate-500 text-sm">vs</span>
            <span className="text-white font-semibold truncate">{game.black_player}</span>
            {game.result && (
              <span className={`text-xs px-2 py-0.5 rounded font-medium flex-shrink-0 ${
                game.result === 'win' ? 'bg-green-700 text-green-100' :
                game.result === 'loss' ? 'bg-red-700 text-red-100' :
                'bg-slate-600 text-slate-100'
              }`}>
                {game.result}
              </span>
            )}
            {game.opening_name && (
              <span className="text-xs text-slate-500 hidden md:inline truncate">
                {game.opening_eco} · {game.opening_name}
              </span>
            )}
          </div>
        )}

        {/* Stats */}
        {analysis && (
          <div className="flex items-center gap-4 text-xs flex-shrink-0">
            <span className="text-slate-400">Accuracy <span className="text-white font-bold">{(analysis.accuracy || 0).toFixed(1)}%</span></span>
            <span className="text-red-400 font-medium">{analysis.blunder_count || 0}B</span>
            <span className="text-orange-400 font-medium">{analysis.mistake_count || 0}M</span>
            <span className="text-yellow-400 font-medium">{analysis.inaccuracy_count || 0}I</span>
          </div>
        )}

        {/* Quick actions */}
        {game?.has_analysis && (
          <div className="flex gap-2 flex-shrink-0">
            <button
              onClick={() => navigate(`/coaching/${gameId}`, { state: { userId } })}
              className="flex items-center gap-1 text-xs bg-chess-accent px-3 py-1.5 rounded-lg text-white hover:bg-chess-accent/80 transition-colors"
            >
              <BookOpen size={13} /> Coach
            </button>
            <button
              onClick={() => navigate(`/self-analysis/${gameId}`)}
              className="flex items-center gap-1 text-xs bg-slate-700 px-3 py-1.5 rounded-lg text-slate-300 hover:bg-slate-600 transition-colors"
            >
              <PenLine size={13} /> Self-Analyze
            </button>
          </div>
        )}
      </div>

      {/* ── Main content ── */}
      <div className="flex-1 flex flex-col lg:flex-row gap-4 p-4 max-w-7xl mx-auto w-full">
        {/* Left: Eval bar + Board + Controls */}
        <div className="flex gap-2 flex-shrink-0 items-start">
          {/* Eval bar */}
          <div className="flex flex-col items-center gap-1" style={{ height: 440 }}>
            <div className="relative w-3 flex-1 rounded overflow-hidden">
              <div className="absolute inset-0 bg-slate-700" />
              <div
                className="absolute bottom-0 left-0 right-0 bg-slate-100 transition-all duration-200"
                style={{ height: `${blueBarPercent}%` }}
              />
            </div>
            <span className="text-xs font-mono text-slate-400" style={{ fontSize: 10 }}>
              {evalLabel}
            </span>
          </div>

          {/* Board */}
          <div>
            <Chessboard
              options={{
                position: currentFen,
                boardOrientation: userColor === 'black' ? 'black' : 'white',
                arePiecesDraggable: false,
                arrows: lastMoveArrows,
                boardWidth: 440,
                animationDurationInMs: 100,
              }}
            />

            {/* Move info strip */}
            <div className="flex items-center justify-between mt-1 px-1 text-xs text-slate-500 h-5">
              {currentMove ? (
                <>
                  <span>
                    Move {currentMove.move_number} · {currentMove.color}
                  </span>
                  <span className={CLS_BADGE[currentMove.classification] || 'text-slate-400'}>
                    {currentMove.classification}
                    {currentMove.centipawn_loss > 0 ? ` (−${Math.round(currentMove.centipawn_loss)}cp)` : ''}
                  </span>
                </>
              ) : (
                <span>Start position</span>
              )}
            </div>

            {/* Navigation controls */}
            <div className="flex items-center justify-center gap-2 mt-2">
              <NavBtn onClick={() => go(-1)} title="Start (↑)" disabled={moveIdx < 0}>
                <ChevronsLeft size={16} />
              </NavBtn>
              <NavBtn onClick={() => go(moveIdx - 1)} title="Previous (←)" disabled={moveIdx < 0}>
                <ChevronLeft size={16} />
              </NavBtn>
              <span className="text-xs text-slate-500 w-24 text-center">
                {moveIdx + 1} / {evals.length}
              </span>
              <NavBtn onClick={() => go(moveIdx + 1)} title="Next (→)" disabled={moveIdx >= evals.length - 1}>
                <ChevronRight size={16} />
              </NavBtn>
              <NavBtn onClick={() => go(evals.length - 1)} title="End (↓)" disabled={moveIdx >= evals.length - 1}>
                <ChevronsRight size={16} />
              </NavBtn>
            </div>
            <p className="text-center text-xs text-slate-600 mt-1">Use ← → arrow keys to navigate</p>
          </div>
        </div>

        {/* Right: Move list */}
        <div className="flex-1 min-w-0 lg:max-w-xs">
          <div className="bg-chess-panel rounded-xl p-3 h-full flex flex-col" style={{ maxHeight: 520 }}>
            <h3 className="text-sm font-semibold text-chess-gold mb-2 flex-shrink-0">Moves</h3>
            {/* Legend */}
            <div className="flex gap-3 mb-2 flex-shrink-0">
              {Object.entries(CLS_COLOR).filter(([k]) => k !== 'best' && k !== 'good').map(([k, c]) => (
                <span key={k} className="flex items-center gap-1 text-xs text-slate-500">
                  <span className="w-1.5 h-1.5 rounded-full" style={{ background: c }} />
                  {k}
                </span>
              ))}
            </div>
            <div className="flex-1 overflow-y-auto" ref={moveListRef}>
              {movePairs.map((pair) => (
                <div key={`${pair.moveNumber}-${pair.whiteIdx}`} className="flex gap-1 mb-0.5 items-center">
                  <span className="text-xs text-slate-600 w-7 flex-shrink-0 text-right font-mono">
                    {pair.moveNumber}.
                  </span>
                  <div
                    data-active={moveIdx === pair.whiteIdx ? 'true' : 'false'}
                    className="flex-1"
                  >
                    <MoveChip
                      e={pair.white}
                      active={moveIdx === pair.whiteIdx}
                      onClick={() => pair.whiteIdx !== null && go(pair.whiteIdx)}
                    />
                  </div>
                  <div
                    data-active={moveIdx === pair.blackIdx ? 'true' : 'false'}
                    className="flex-1"
                  >
                    <MoveChip
                      e={pair.black}
                      active={moveIdx === pair.blackIdx}
                      onClick={() => pair.blackIdx !== null && go(pair.blackIdx)}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* ── Eval graph ── */}
      <div className="max-w-7xl mx-auto w-full px-4 pb-6">
        <div className="bg-chess-panel rounded-xl p-4">
          <h3 className="text-sm font-semibold text-chess-gold mb-3">Evaluation Graph</h3>
          <ResponsiveContainer width="100%" height={130}>
            <AreaChart
              data={evalData}
              onClick={(d) => {
                if (d?.activePayload) go(d.activePayload[0].payload.idx)
              }}
              style={{ cursor: 'pointer' }}
            >
              <defs>
                <linearGradient id="evalUp" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#e2b96f" stopOpacity={0.35} />
                  <stop offset="95%" stopColor="#e2b96f" stopOpacity={0.0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
              <XAxis
                dataKey="label"
                tick={{ fontSize: 9, fill: '#475569' }}
                interval="preserveStartEnd"
              />
              <YAxis
                domain={[-7, 7]}
                tick={{ fontSize: 9, fill: '#475569' }}
                tickCount={5}
                tickFormatter={(v) => v > 0 ? `+${v}` : v}
              />
              <ReferenceLine y={0} stroke="#334155" strokeWidth={1.5} />
              <Tooltip content={<EvalTooltip />} />
              <Area
                type="monotone"
                dataKey="eval"
                stroke="#e2b96f"
                strokeWidth={1.5}
                fill="url(#evalUp)"
                dot={(props) => {
                  const { cx, cy, payload } = props
                  if (!['blunder', 'mistake'].includes(payload.classification)) return null
                  return (
                    <circle
                      key={`dot-${payload.idx}`}
                      cx={cx} cy={cy} r={4}
                      fill={CLS_COLOR[payload.classification]}
                      stroke="#1e293b"
                      strokeWidth={1}
                    />
                  )
                }}
                activeDot={{ r: 5, fill: '#e2b96f', stroke: '#1e293b', strokeWidth: 1 }}
              />
            </AreaChart>
          </ResponsiveContainer>
          <p className="text-xs text-slate-600 mt-1">Click on the graph to jump to that position · Blunder/mistake dots highlighted</p>
        </div>
      </div>
    </div>
  )
}
