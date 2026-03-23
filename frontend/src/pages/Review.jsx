import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { Chessboard } from 'react-chessboard'
import { ArrowLeft, RotateCcw, CheckCircle, XCircle, RefreshCw, BookOpen, Zap, Dumbbell } from 'lucide-react'
import { seedReviewCards, getDueCards, getReviewStats, answerCard } from '../api/client'

const SOURCE_LABEL = { coaching: 'Coaching', selfanalysis: 'Self-Analysis', drill: 'Drill' }
const SOURCE_COLOR = { coaching: 'text-blue-400', selfanalysis: 'text-purple-400', drill: 'text-yellow-400' }
const SOURCE_ICON = { coaching: BookOpen, selfanalysis: BookOpen, drill: Dumbbell }

function Badge({ source }) {
  const Icon = SOURCE_ICON[source] || Zap
  return (
    <span className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full bg-white/10 ${SOURCE_COLOR[source] || 'text-slate-400'}`}>
      <Icon size={11} />
      {SOURCE_LABEL[source] || source}
    </span>
  )
}

export default function Review({ userId }) {
  const navigate = useNavigate()
  const [phase, setPhase] = useState('loading') // loading | empty | reviewing | revealed | done
  const [cards, setCards] = useState([])
  const [cardIdx, setCardIdx] = useState(0)
  const [stats, setStats] = useState(null)
  const [seeding, setSeeding] = useState(false)
  const [seedResult, setSeedResult] = useState(null)

  // Per-card puzzle state
  const [selectedSquare, setSelectedSquare] = useState(null)
  const [wrongMove, setWrongMove] = useState(false)
  const [correct, setCorrect] = useState(null) // null | true | false

  const currentCard = cards[cardIdx] || null

  // ── Load ───────────────────────────────────────────────────────────────────

  const loadData = useCallback(async () => {
    if (!userId) return
    setPhase('loading')
    try {
      const [dueRes, statsRes] = await Promise.all([
        getDueCards(userId, 30),
        getReviewStats(userId),
      ])
      setStats(statsRes.data)
      const due = dueRes.data.due || []
      setCards(due)
      setCardIdx(0)
      setPhase(due.length === 0 ? 'empty' : 'reviewing')
    } catch (err) {
      console.error(err)
      setPhase('empty')
    }
  }, [userId])

  useEffect(() => { loadData() }, [loadData])

  // ── Seeding ────────────────────────────────────────────────────────────────

  const handleSeed = async () => {
    setSeeding(true)
    try {
      const res = await seedReviewCards(userId)
      setSeedResult(res.data)
      await loadData()
    } catch (err) {
      console.error(err)
    } finally {
      setSeeding(false)
    }
  }

  // ── Move handling ──────────────────────────────────────────────────────────

  const tryMove = useCallback((from, to) => {
    if (!currentCard || correct !== null) return
    const moved = `${from}${to}`
    const isCorrect = moved === currentCard.correct_move_uci
    setCorrect(isCorrect)
    if (!isCorrect) {
      setWrongMove(true)
      setTimeout(() => setWrongMove(false), 600)
    }
  }, [currentCard, correct])

  const onSquareClick = useCallback(({ square }) => {
    if (!currentCard || correct !== null) return
    if (!selectedSquare) {
      setSelectedSquare(square)
      return
    }
    if (selectedSquare === square) {
      setSelectedSquare(null)
      return
    }
    tryMove(selectedSquare, square)
    setSelectedSquare(null)
  }, [selectedSquare, currentCard, correct, tryMove])

  const onPieceDrop = useCallback(({ sourceSquare, targetSquare }) => {
    tryMove(sourceSquare, targetSquare)
    return true
  }, [tryMove])

  // ── Answer submission ──────────────────────────────────────────────────────

  const submitAnswer = async (isCorrect) => {
    if (!currentCard) return
    try {
      await answerCard(currentCard.id, isCorrect)
    } catch (err) {
      console.error(err)
    }
  }

  const handleNext = async () => {
    if (correct !== null) await submitAnswer(correct)
    const nextIdx = cardIdx + 1
    if (nextIdx >= cards.length) {
      setPhase('done')
    } else {
      setCardIdx(nextIdx)
      setCorrect(null)
      setSelectedSquare(null)
      setWrongMove(false)
    }
  }

  const handleSkip = async () => {
    await submitAnswer(false)
    handleNext()
  }

  // ── Square styles ──────────────────────────────────────────────────────────

  const customSquareStyles = {}
  if (selectedSquare) {
    customSquareStyles[selectedSquare] = { background: 'rgba(255, 255, 100, 0.5)' }
  }
  if (correct === true && currentCard) {
    const [from, to] = [currentCard.correct_move_uci.slice(0, 2), currentCard.correct_move_uci.slice(2, 4)]
    customSquareStyles[from] = { background: 'rgba(74, 222, 128, 0.6)' }
    customSquareStyles[to] = { background: 'rgba(74, 222, 128, 0.6)' }
  }
  if (wrongMove) {
    customSquareStyles['a0'] = {} // harmless; the flash effect is in the board wrapper class
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-chess-dark text-slate-100 p-4">
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <button onClick={() => navigate('/')} className="flex items-center gap-2 text-slate-400 hover:text-slate-100 transition-colors">
            <ArrowLeft size={18} /> Dashboard
          </button>
          <h1 className="text-xl font-bold text-slate-100 flex items-center gap-2">
            <RotateCcw size={20} className="text-emerald-400" /> Spaced Review
          </h1>
          <button
            onClick={handleSeed}
            disabled={seeding}
            className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-chess-panel hover:bg-white/10 text-slate-300 transition-colors disabled:opacity-50"
          >
            <RefreshCw size={13} className={seeding ? 'animate-spin' : ''} />
            {seeding ? 'Scanning…' : 'Sync positions'}
          </button>
        </div>

        {seedResult && (
          <div className="mb-4 p-3 rounded-lg bg-emerald-900/30 border border-emerald-700/40 text-sm text-emerald-300">
            Added {seedResult.added} new cards — {seedResult.from_coaching} from coaching, {seedResult.from_selfanalysis} from self-analysis, {seedResult.from_drills} from game analysis.
          </div>
        )}

        {/* Stats bar */}
        {stats?.has_data && (
          <div className="grid grid-cols-3 gap-3 mb-6">
            <StatBox label="In bank" value={stats.total} />
            <StatBox label="Due today" value={stats.due_now} accent="text-yellow-400" />
            <StatBox label="Mastered" value={stats.mastered} accent="text-emerald-400" />
          </div>
        )}

        {/* Loading */}
        {phase === 'loading' && (
          <div className="text-center text-slate-400 py-20">Loading your review queue…</div>
        )}

        {/* Empty */}
        {phase === 'empty' && (
          <div className="text-center py-20">
            <RotateCcw size={48} className="mx-auto mb-4 text-slate-600" />
            <p className="text-slate-300 text-lg mb-2">
              {stats?.total === 0 ? 'Your review bank is empty.' : 'No cards due right now.'}
            </p>
            <p className="text-slate-500 text-sm mb-6">
              {stats?.total === 0
                ? 'Sync positions to pull mistakes from your coaching and self-analysis sessions.'
                : `Next cards due after your next study session. ${stats?.total ?? 0} total in bank.`}
            </p>
            <button
              onClick={handleSeed}
              disabled={seeding}
              className="px-5 py-2.5 rounded-lg bg-emerald-700 hover:bg-emerald-600 text-white font-medium transition-colors disabled:opacity-50"
            >
              {seeding ? 'Scanning…' : 'Sync positions'}
            </button>
          </div>
        )}

        {/* Done */}
        {phase === 'done' && (
          <div className="text-center py-20">
            <CheckCircle size={48} className="mx-auto mb-4 text-emerald-400" />
            <p className="text-slate-100 text-xl font-semibold mb-2">Session complete!</p>
            <p className="text-slate-400 text-sm mb-6">All {cards.length} cards reviewed. Come back tomorrow for the next batch.</p>
            <button onClick={() => navigate('/')} className="px-5 py-2.5 rounded-lg bg-chess-panel hover:bg-white/10 text-slate-200 transition-colors">
              Back to dashboard
            </button>
          </div>
        )}

        {/* Reviewing */}
        {phase === 'reviewing' && currentCard && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Board column */}
            <div>
              <div className={`rounded-xl overflow-hidden transition-all ${wrongMove ? 'ring-2 ring-red-500' : ''}`}>
                <Chessboard
                  options={{
                    position: currentCard.fen,
                    boardOrientation: currentCard.user_color === 'black' ? 'black' : 'white',
                    arePiecesDraggable: correct === null,
                    onPieceDrop,
                    onSquareClick,
                    customSquareStyles,
                    animationDurationInMs: 150,
                  }}
                />
              </div>
              <p className="mt-2 text-xs text-slate-500 text-center">
                Card {cardIdx + 1} / {cards.length}
              </p>
            </div>

            {/* Info column */}
            <div className="flex flex-col gap-4">
              {/* Card header */}
              <div className="bg-chess-panel rounded-xl p-4">
                <div className="flex items-center justify-between mb-3">
                  <Badge source={currentCard.source} />
                  <span className="text-xs text-slate-500">
                    {currentCard.repetition_count > 0
                      ? `Seen ${currentCard.repetition_count}× correctly`
                      : 'First time'}
                  </span>
                </div>
                <p className="text-slate-300 text-sm leading-relaxed">
                  {currentCard.user_color === 'white' ? 'White' : 'Black'} to move.{' '}
                  {currentCard.error_type === 'blunder'
                    ? 'You previously played a blunder here.'
                    : 'You made a mistake here.'}{' '}
                  Find the best move.
                </p>
                {currentCard.centipawn_loss != null && currentCard.centipawn_loss > 0 && (
                  <p className="text-xs text-red-400 mt-1">
                    Original error: {Math.round(currentCard.centipawn_loss)} cp loss
                  </p>
                )}
              </div>

              {/* Result feedback */}
              {correct === true && (
                <div className="bg-emerald-900/30 border border-emerald-700/40 rounded-xl p-4">
                  <div className="flex items-center gap-2 text-emerald-400 font-semibold mb-2">
                    <CheckCircle size={18} /> Correct!
                  </div>
                  <p className="text-slate-300 text-sm">
                    Best move: <span className="font-mono font-bold text-emerald-300">{currentCard.correct_move_san || currentCard.correct_move_uci}</span>
                  </p>
                  {currentCard.engine_pv_san?.length > 0 && (
                    <p className="text-slate-500 text-xs mt-1 font-mono">
                      Engine line: {currentCard.engine_pv_san.slice(0, 5).join(' ')}
                    </p>
                  )}
                  <p className="text-xs text-slate-500 mt-2">
                    Next review in {_nextInterval(currentCard.repetition_count + 1)} day(s).
                  </p>
                </div>
              )}

              {correct === false && (
                <div className="bg-red-900/30 border border-red-700/40 rounded-xl p-4">
                  <div className="flex items-center gap-2 text-red-400 font-semibold mb-2">
                    <XCircle size={18} /> Not quite
                  </div>
                  <p className="text-slate-300 text-sm">
                    Best move: <span className="font-mono font-bold text-red-300">{currentCard.correct_move_san || currentCard.correct_move_uci}</span>
                  </p>
                  {currentCard.engine_pv_san?.length > 0 && (
                    <p className="text-slate-500 text-xs mt-1 font-mono">
                      Engine line: {currentCard.engine_pv_san.slice(0, 5).join(' ')}
                    </p>
                  )}
                  <p className="text-xs text-slate-500 mt-2">Interval reset — you'll see this again tomorrow.</p>
                </div>
              )}

              {/* Actions */}
              <div className="flex gap-3 mt-auto">
                {correct === null ? (
                  <button
                    onClick={handleSkip}
                    className="flex-1 py-2.5 rounded-lg bg-chess-panel hover:bg-white/10 text-slate-400 text-sm transition-colors"
                  >
                    Can't remember
                  </button>
                ) : (
                  <button
                    onClick={handleNext}
                    className="flex-1 py-2.5 rounded-lg bg-emerald-700 hover:bg-emerald-600 text-white font-medium text-sm transition-colors"
                  >
                    {cardIdx + 1 >= cards.length ? 'Finish' : 'Next card'}
                  </button>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function StatBox({ label, value, accent = 'text-slate-100' }) {
  return (
    <div className="bg-chess-panel rounded-xl p-4 text-center">
      <p className={`text-2xl font-bold ${accent}`}>{value}</p>
      <p className="text-xs text-slate-500 mt-0.5">{label}</p>
    </div>
  )
}

// Mirror of backend _INTERVALS ladder
const _INTERVALS = [1, 3, 7, 14, 30, 60]
function _nextInterval(repetitionCountAfter) {
  const idx = Math.min(repetitionCountAfter, _INTERVALS.length - 1)
  return _INTERVALS[idx]
}
