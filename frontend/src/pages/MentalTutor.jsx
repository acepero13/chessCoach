import { useState, useEffect, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { Chessboard } from 'react-chessboard'
import { ChevronLeft, Trophy, AlertTriangle, Flame, Zap, Clock, CheckCircle, XCircle, MinusCircle } from 'lucide-react'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts'
import { getMentalScenarios, startMentalSession, playMentalMove, completeMentalSession } from '../api/client'

const MENTAL_ERROR_META = {
  rushing:         { label: 'Rushing',          color: 'text-orange-400', bg: 'bg-orange-900/30 border-orange-800', icon: Zap },
  overcomplication:{ label: 'Overcomplication',  color: 'text-purple-400', bg: 'bg-purple-900/30 border-purple-800', icon: Flame },
  relaxation:      { label: 'Loss of Focus',     color: 'text-blue-400',   bg: 'bg-blue-900/30 border-blue-800',   icon: MinusCircle },
  tilt:            { label: 'Tilt',              color: 'text-red-400',    bg: 'bg-red-900/30 border-red-800',     icon: AlertTriangle },
}

function evalLabel(cp) {
  if (cp >= 700) return 'Winning easily'
  if (cp >= 300) return 'Clearly winning'
  if (cp >= 150) return 'Winning'
  if (cp >= 50)  return 'Slightly better'
  if (cp >= -50) return 'Equal'
  return 'Worse'
}

function ResultBadge({ result }) {
  if (result === 'converted') return <span className="flex items-center gap-1 text-green-400 font-semibold"><CheckCircle size={14} /> Converted</span>
  if (result === 'failed')    return <span className="flex items-center gap-1 text-red-400 font-semibold"><XCircle size={14} /> Failed</span>
  return <span className="flex items-center gap-1 text-amber-400 font-semibold"><MinusCircle size={14} /> Partial</span>
}

export default function MentalTutor({ userId }) {
  const navigate = useNavigate()
  const [phase, setPhase] = useState('loading')  // loading | scenarios | intro | playing | review
  const [scenarios, setScenarios] = useState([])
  const [selectedScenario, setSelectedScenario] = useState(null)
  const [session, setSession] = useState(null)      // {session_id, fen, eval_cp, user_color, max_moves, context}
  const [boardFen, setBoardFen] = useState(null)
  const [moveCount, setMoveCount] = useState(0)
  const [submitting, setSubmitting] = useState(false)
  const [lastMoveInfo, setLastMoveInfo] = useState(null)  // {user_move_san, engine_move_san, cp_loss}
  const [review, setReview] = useState(null)
  const [error, setError] = useState(null)
  const moveStartRef = useRef(null)

  // Load scenarios
  useEffect(() => {
    if (!userId) return
    getMentalScenarios(userId)
      .then(r => {
        setScenarios(r.data.scenarios || [])
        setPhase('scenarios')
      })
      .catch(e => {
        setError(e.response?.data?.detail || e.message)
        setPhase('scenarios')
      })
  }, [userId])

  const handleSelectScenario = (scenario) => {
    setSelectedScenario(scenario)
    setPhase('intro')
  }

  const handleStartSession = async () => {
    if (!selectedScenario) return
    setSubmitting(true)
    try {
      const res = await startMentalSession(
        userId,
        selectedScenario.game_id,
        selectedScenario.move_index,
        6
      )
      const data = res.data
      setSession(data)
      setBoardFen(data.fen)
      setMoveCount(0)
      moveStartRef.current = Date.now()
      setPhase('playing')
    } catch (e) {
      setError(e.response?.data?.detail || e.message)
    } finally {
      setSubmitting(false)
    }
  }

  const handlePieceDrop = useCallback((sourceSquare, targetSquare, piece) => {
    if (submitting || phase !== 'playing') return false
    let moveUci = sourceSquare + targetSquare
    // Auto-promote to queen
    if (piece && piece.toLowerCase().includes('p')) {
      const destRank = parseInt(targetSquare[1])
      if (destRank === 8 || destRank === 1) moveUci += 'q'
    }
    const moveTimeMs = moveStartRef.current ? Date.now() - moveStartRef.current : 0
    handlePlayMove(moveUci, moveTimeMs)
    return true
  }, [submitting, phase, session])

  const handlePlayMove = async (moveUci, moveTimeMs) => {
    if (!session || submitting) return
    setSubmitting(true)
    try {
      const res = await playMentalMove(session.session_id, moveUci, moveTimeMs)
      const data = res.data
      setBoardFen(data.new_fen)
      setMoveCount(data.move_count)
      setLastMoveInfo({
        user_move_san: data.user_move_san,
        engine_move_san: data.engine_move_san,
        cp_loss: data.user_cp_loss,
        classification: data.user_classification,
      })
      moveStartRef.current = Date.now()

      if (data.is_complete) {
        await handleComplete()
      }
    } catch (e) {
      setError(e.response?.data?.detail || e.message)
    } finally {
      setSubmitting(false)
    }
  }

  const handleComplete = async () => {
    if (!session) return
    try {
      const res = await completeMentalSession(session.session_id)
      setReview(res.data)
      setPhase('review')
    } catch (e) {
      setError(e.response?.data?.detail || e.message)
    }
  }

  const handleFinishEarly = async () => {
    if (!session || submitting) return
    setSubmitting(true)
    try {
      await handleComplete()
    } finally {
      setSubmitting(false)
    }
  }

  const handleRestart = () => {
    setPhase('scenarios')
    setSelectedScenario(null)
    setSession(null)
    setBoardFen(null)
    setMoveCount(0)
    setLastMoveInfo(null)
    setReview(null)
    setError(null)
  }

  return (
    <div className="min-h-screen bg-chess-dark p-4">
      <div className="max-w-5xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <button onClick={() => navigate('/')} className="flex items-center gap-1 text-slate-400 hover:text-white text-sm">
            <ChevronLeft size={16} /> Dashboard
          </button>
          <h1 className="text-lg font-bold text-chess-gold">Mental Tutor</h1>
          <div className="w-24" />
        </div>

        {error && (
          <div className="mb-4 p-3 bg-red-900/40 border border-red-700 rounded-lg text-red-300 text-sm">
            {error}
          </div>
        )}

        {/* Loading */}
        {phase === 'loading' && (
          <div className="flex items-center justify-center py-20 text-slate-400 animate-pulse">
            Loading scenarios…
          </div>
        )}

        {/* Scenarios list */}
        {phase === 'scenarios' && (
          <ScenariosPanel
            scenarios={scenarios}
            onSelect={handleSelectScenario}
            userId={userId}
          />
        )}

        {/* Intro */}
        {phase === 'intro' && selectedScenario && (
          <IntroPanel
            scenario={selectedScenario}
            onStart={handleStartSession}
            submitting={submitting}
          />
        )}

        {/* Playing */}
        {phase === 'playing' && session && boardFen && (
          <PlayingPanel
            session={session}
            boardFen={boardFen}
            moveCount={moveCount}
            lastMoveInfo={lastMoveInfo}
            submitting={submitting}
            onPieceDrop={handlePieceDrop}
            onFinishEarly={handleFinishEarly}
          />
        )}

        {/* Review */}
        {phase === 'review' && review && (
          <ReviewPanel
            review={review}
            session={session}
            onRestart={handleRestart}
          />
        )}
      </div>
    </div>
  )
}

// ── Scenarios Panel ────────────────────────────────────────────────────────

function ScenariosPanel({ scenarios, onSelect }) {
  if (!scenarios.length) {
    return (
      <div className="bg-chess-panel rounded-xl p-8 text-center">
        <p className="text-slate-400 mb-2">No winning positions found yet.</p>
        <p className="text-slate-500 text-sm">Import and analyze games to find positions where you were winning but failed to convert.</p>
      </div>
    )
  }

  return (
    <div>
      <div className="mb-5">
        <h2 className="text-xl font-bold text-white">Conversion Training</h2>
        <p className="text-slate-400 text-sm mt-1">
          Pick a position from your games where you had a winning advantage. Practice converting it correctly.
        </p>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {scenarios.map((s, i) => (
          <ScenarioCard key={i} scenario={s} onSelect={onSelect} />
        ))}
      </div>
    </div>
  )
}

function ScenarioCard({ scenario, onSelect }) {
  const evalPawns = (scenario.eval_cp / 100).toFixed(1)
  const failed = scenario.failed_to_convert
  const playerName = scenario.user_color === 'white' ? scenario.white_player : scenario.black_player
  const oppName = scenario.user_color === 'white' ? scenario.black_player : scenario.white_player

  return (
    <button
      onClick={() => onSelect(scenario)}
      className="bg-chess-panel rounded-xl p-4 text-left hover:bg-chess-accent/30 transition-colors border border-slate-700 hover:border-chess-gold/40 group"
    >
      <div className="flex items-start justify-between mb-2">
        <div>
          <p className="text-sm font-semibold text-white">{playerName} vs {oppName}</p>
          <p className="text-xs text-slate-500 mt-0.5">Move {scenario.move_number} · as {scenario.user_color}</p>
        </div>
        <span className="text-chess-gold font-bold text-lg">+{evalPawns}</span>
      </div>
      <div className="flex items-center gap-2 mt-3">
        {failed ? (
          <span className="text-xs px-2 py-0.5 rounded-full bg-red-900/40 text-red-400 border border-red-800">
            Failed to convert ({scenario.game_result})
          </span>
        ) : (
          <span className="text-xs px-2 py-0.5 rounded-full bg-green-900/40 text-green-400 border border-green-800">
            {scenario.game_result}
          </span>
        )}
        <span className="text-xs text-slate-600 group-hover:text-chess-gold transition-colors ml-auto">
          Practice →
        </span>
      </div>
    </button>
  )
}

// ── Intro Panel ────────────────────────────────────────────────────────────

function IntroPanel({ scenario, onStart, submitting }) {
  const evalPawns = (scenario.eval_cp / 100).toFixed(1)

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <div>
        <div className="rounded-xl overflow-hidden">
          <Chessboard
            key={scenario.fen}
            options={{
              position: scenario.fen,
              boardOrientation: scenario.user_color,
              allowDragging: false,
              animationDurationInMs: 0,
              boardStyle: { borderRadius: '8px' },
            }}
          />
        </div>
      </div>
      <div className="flex flex-col justify-center gap-5">
        <div>
          <div className="text-chess-gold font-bold text-3xl mb-1">+{evalPawns}</div>
          <div className="text-slate-300 text-sm">{evalLabel(scenario.eval_cp)}</div>
        </div>
        <div className="bg-chess-panel rounded-xl p-4 border border-chess-gold/30">
          <p className="text-white font-semibold text-lg mb-2">You are winning. Convert it.</p>
          {scenario.failed_to_convert && (
            <p className="text-amber-400 text-sm">
              In the actual game, you {scenario.game_result === 'loss' ? 'lost' : 'drew'} from this position. This is your chance to practice conversion.
            </p>
          )}
          <p className="text-slate-400 text-sm mt-2">
            You will play 6 moves. The engine plays for the opponent. No evaluation is shown during play.
          </p>
        </div>
        <div className="space-y-2 text-sm text-slate-400">
          <div className="flex items-center gap-2"><Trophy size={14} className="text-chess-gold" /> Maintain your advantage</div>
          <div className="flex items-center gap-2"><Clock size={14} className="text-chess-gold" /> Take your time — don't rush</div>
          <div className="flex items-center gap-2"><Zap size={14} className="text-chess-gold" /> Simplify when possible</div>
        </div>
        <button
          onClick={onStart}
          disabled={submitting}
          className="bg-chess-gold text-chess-dark font-bold px-6 py-3 rounded-xl hover:opacity-90 disabled:opacity-50 text-base"
        >
          {submitting ? 'Starting…' : 'Start Training'}
        </button>
      </div>
    </div>
  )
}

// ── Playing Panel ──────────────────────────────────────────────────────────

function PlayingPanel({ session, boardFen, moveCount, lastMoveInfo, submitting, onPieceDrop, onFinishEarly }) {
  const progress = Math.round((moveCount / session.max_moves) * 100)

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <div>
        <div className="rounded-xl overflow-hidden">
          <Chessboard
            key={boardFen}
            options={{
              position: boardFen,
              boardOrientation: session.user_color,
              allowDragging: !submitting,
              animationDurationInMs: 150,
              boardStyle: { borderRadius: '8px' },
              onPieceDrop,
            }}
          />
        </div>
        {submitting && (
          <div className="text-center text-xs text-slate-400 mt-2 animate-pulse">Engine thinking…</div>
        )}
      </div>

      <div className="flex flex-col gap-4">
        {/* Goal reminder */}
        <div className="bg-chess-panel rounded-xl p-4 border border-chess-gold/20">
          <p className="text-chess-gold font-semibold text-sm mb-1">Goal: Convert the position</p>
          <p className="text-slate-400 text-xs">No evaluation shown. Play as you would in a real game.</p>
        </div>

        {/* Progress */}
        <div className="bg-chess-panel rounded-xl p-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm text-slate-400">Move</span>
            <span className="text-chess-gold font-bold">{moveCount} / {session.max_moves}</span>
          </div>
          <div className="bg-slate-700 rounded-full h-2">
            <div className="h-2 rounded-full bg-chess-gold transition-all" style={{ width: `${progress}%` }} />
          </div>
        </div>

        {/* Last move info */}
        {lastMoveInfo && (
          <div className="bg-chess-panel rounded-xl p-4 space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span className="text-slate-400">You played</span>
              <span className={`font-mono font-bold ${
                lastMoveInfo.classification === 'blunder' ? 'text-red-400' :
                lastMoveInfo.classification === 'mistake' ? 'text-amber-400' :
                lastMoveInfo.classification === 'good' || lastMoveInfo.classification === 'best' ? 'text-green-400' :
                'text-amber-400'
              }`}>{lastMoveInfo.user_move_san}</span>
            </div>
            {lastMoveInfo.engine_move_san && (
              <div className="flex items-center justify-between text-sm">
                <span className="text-slate-400">Engine replied</span>
                <span className="font-mono text-slate-300">{lastMoveInfo.engine_move_san}</span>
              </div>
            )}
          </div>
        )}

        <button
          onClick={onFinishEarly}
          disabled={submitting || moveCount === 0}
          className="mt-auto py-2 bg-slate-700 text-slate-300 rounded-lg hover:bg-slate-600 text-sm transition-colors disabled:opacity-50"
        >
          Finish &amp; Review
        </button>
      </div>
    </div>
  )
}

// ── Review Panel ───────────────────────────────────────────────────────────

function ReviewPanel({ review, session, onRestart }) {
  const chartData = (review.eval_progression || []).map((ev, i) => ({
    move: i,
    eval: Math.round(ev / 100 * 10) / 10,
  }))

  const hasErrors = review.mental_errors?.length > 0

  return (
    <div className="space-y-6">
      {/* Result header */}
      <div className="bg-chess-panel rounded-xl p-5 flex items-center justify-between">
        <div>
          <div className="flex items-center gap-3 mb-1">
            <ResultBadge result={review.result} />
          </div>
          <p className="text-slate-400 text-sm">
            Started at +{(review.starting_eval / 100).toFixed(1)} → ended at +{(review.final_eval / 100).toFixed(1)} pawns
          </p>
        </div>
        {!hasErrors && (
          <div className="text-green-400 text-2xl">✓</div>
        )}
      </div>

      {/* Eval progression chart */}
      {chartData.length > 1 && (
        <div className="bg-chess-panel rounded-xl p-4">
          <h3 className="text-chess-gold font-semibold mb-3 text-sm">Evaluation Progression</h3>
          <ResponsiveContainer width="100%" height={160}>
            <LineChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
              <XAxis dataKey="move" tick={{ fontSize: 10, fill: '#64748b' }} label={{ value: 'Move', position: 'insideBottom', fill: '#64748b', fontSize: 10 }} />
              <YAxis tick={{ fontSize: 10, fill: '#64748b' }} tickFormatter={v => `+${v}`} />
              <Tooltip
                contentStyle={{ backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: 8 }}
                formatter={(v) => [`+${v}`, 'Eval']}
                labelFormatter={(l) => `After move ${l}`}
              />
              <ReferenceLine y={0} stroke="#64748b" strokeDasharray="3 3" />
              <ReferenceLine y={2} stroke="#4ade80" strokeDasharray="4 2" opacity={0.4} />
              <Line type="monotone" dataKey="eval" stroke="#e2b96f" strokeWidth={2} dot={{ r: 3, fill: '#e2b96f' }} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Mental errors */}
      {hasErrors ? (
        <div className="space-y-3">
          <h3 className="text-white font-semibold">Mental Patterns Detected</h3>
          {review.mental_errors.map((err, i) => {
            const meta = MENTAL_ERROR_META[err.type] || { label: err.type, color: 'text-slate-400', bg: 'bg-slate-800 border-slate-700', icon: AlertTriangle }
            const Icon = meta.icon
            return (
              <div key={i} className={`rounded-xl p-4 border ${meta.bg}`}>
                <div className={`flex items-center gap-2 font-semibold text-sm mb-1 ${meta.color}`}>
                  <Icon size={14} />
                  {meta.label}
                </div>
                <p className="text-slate-300 text-sm">{err.description}</p>
              </div>
            )
          })}
        </div>
      ) : (
        <div className="bg-green-900/20 border border-green-800 rounded-xl p-4">
          <p className="text-green-400 font-semibold text-sm mb-1">No mental errors detected</p>
          <p className="text-slate-400 text-sm">You played the conversion phase with good discipline.</p>
        </div>
      )}

      {/* Coaching */}
      {review.coaching && (
        <div className="bg-chess-panel rounded-xl p-4 border border-chess-gold/20">
          <h3 className="text-chess-gold font-semibold text-sm mb-2">Coach Feedback</h3>
          <p className="text-slate-300 text-sm leading-relaxed">{review.coaching}</p>
        </div>
      )}

      {/* Moves played */}
      {review.moves_played?.length > 0 && (
        <div className="bg-chess-panel rounded-xl p-4">
          <h3 className="text-slate-400 text-sm mb-2">Moves played</h3>
          <div className="flex flex-wrap gap-1.5">
            {review.moves_played.map((m, i) => (
              <span key={i} className="px-2 py-0.5 bg-chess-dark rounded text-xs font-mono text-slate-300">
                {i + 1}. {m}
              </span>
            ))}
          </div>
        </div>
      )}

      <button
        onClick={onRestart}
        className="w-full bg-chess-gold text-chess-dark font-bold py-3 rounded-xl hover:opacity-90"
      >
        Try Another Position
      </button>
    </div>
  )
}
