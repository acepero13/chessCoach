import { useState, useEffect } from 'react'
import { useParams, useLocation, useNavigate } from 'react-router-dom'
import { Chessboard } from 'react-chessboard'
import { Send, ChevronLeft, Lightbulb, Eye, Trophy } from 'lucide-react'
import { startSession, submitAnswer } from '../api/client'

function classificationClass(c) {
  const map = {
    best: 'move-best', good: 'move-good',
    inaccuracy: 'move-inaccuracy', mistake: 'move-mistake', blunder: 'move-blunder'
  }
  return map[c] || ''
}

export default function CoachingSession() {
  const { gameId } = useParams()
  const { state } = useLocation()
  const navigate = useNavigate()

  const userId = state?.userId || 1
  const [sessionId, setSessionId] = useState(null)
  const [phase, setPhase] = useState('question') // 'question' | 'revealed' | 'complete'
  const [position, setPosition] = useState(null)
  const [question, setQuestion] = useState(null)
  const [hint, setHint] = useState(null)
  const [showHint, setShowHint] = useState(false)
  const [answer, setAnswer] = useState('')
  const [revealed, setRevealed] = useState(null)
  const [progress, setProgress] = useState(null)
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    const init = async () => {
      try {
        const res = await startSession(userId, Number(gameId))
        const data = res.data
        if (!data.session_id) {
          setError(data.message || 'No critical moves found')
          setPhase('complete')
          return
        }
        setSessionId(data.session_id)
        setPosition(data.current_position)
        setQuestion(data.question)
        setHint(data.hint)
        setProgress({ reviewed: 0, total: data.total_critical_moves })
      } catch (e) {
        setError(e.response?.data?.detail || e.message)
      } finally {
        setLoading(false)
      }
    }
    init()
  }, [gameId, userId])

  const handleSubmitAnswer = async () => {
    if (!answer.trim() || !sessionId) return
    setSubmitting(true)
    try {
      const res = await submitAnswer(sessionId, answer)
      const data = res.data
      setRevealed(data)
      setProgress(data.progress)
      setPhase(data.completed ? 'complete' : 'revealed')
    } catch (e) {
      setError(e.response?.data?.detail || e.message)
    } finally {
      setSubmitting(false)
    }
  }

  const handleNext = () => {
    if (!revealed) return
    if (revealed.completed) {
      setPhase('complete')
      return
    }
    setPosition(revealed.next_position)
    setQuestion(revealed.next_question?.question)
    setHint(revealed.next_question?.hint)
    setShowHint(false)
    setAnswer('')
    setRevealed(null)
    setPhase('question')
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-chess-dark flex items-center justify-center">
        <div className="text-chess-gold text-lg animate-pulse">Loading coaching session…</div>
      </div>
    )
  }

  if (phase === 'complete') {
    return (
      <div className="min-h-screen bg-chess-dark flex flex-col items-center justify-center gap-6 p-6">
        <Trophy size={48} className="text-chess-gold" />
        <h2 className="text-2xl font-bold text-white">Session Complete!</h2>
        {progress && (
          <p className="text-slate-400">
            Reviewed {progress.reviewed} critical positions.
          </p>
        )}
        {error && <p className="text-red-400 text-sm">{error}</p>}
        <button
          onClick={() => navigate('/')}
          className="bg-chess-gold text-chess-dark font-semibold px-8 py-3 rounded-xl hover:opacity-90"
        >
          Back to Dashboard
        </button>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-chess-dark p-4">
      <div className="max-w-5xl mx-auto">
        {/* Top bar */}
        <div className="flex items-center justify-between mb-4">
          <button
            onClick={() => navigate('/')}
            className="flex items-center gap-1 text-slate-400 hover:text-white text-sm"
          >
            <ChevronLeft size={16} /> Dashboard
          </button>
          {progress && (
            <div className="text-sm text-slate-400">
              Position <span className="text-chess-gold font-bold">{progress.reviewed + 1}</span> of {progress.total}
            </div>
          )}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Board */}
          <div>
            {position && (
              <PlayerLabel
                name={position.user_color === 'black' ? position.white_player : position.black_player}
                isUser={false}
              />
            )}
            <div className="rounded-xl overflow-hidden my-1">
              {position?.fen && (
                <Chessboard
                  key={position.fen}
                  options={{
                    position: position.fen,
                    boardOrientation: position.user_color === 'black' ? 'black' : 'white',
                    allowDragging: false,
                    animationDurationInMs: 0,
                    boardStyle: { borderRadius: '8px' },
                  }}
                />
              )}
            </div>
            {position && (
              <PlayerLabel
                name={position.user_color === 'black' ? position.black_player : position.white_player}
                isUser={true}
              />
            )}
            {position && (
              <div className="mt-1 text-center text-xs text-slate-500">
                Move {position.move_number} · <span className="text-chess-gold">{position.color}</span> to move
              </div>
            )}
          </div>

          {/* Right panel */}
          <div className="flex flex-col gap-4">
            {/* Question */}
            <div className="bg-chess-panel rounded-xl p-4">
              <p className="text-white font-medium mb-3">{question}</p>

              {/* Hint */}
              {hint && (
                <div className="mb-3">
                  {showHint ? (
                    <div className="p-3 bg-chess-accent/30 rounded-lg text-slate-300 text-sm">
                      <span className="text-chess-gold font-medium">Hint: </span>{hint}
                    </div>
                  ) : (
                    <button
                      onClick={() => setShowHint(true)}
                      className="flex items-center gap-1 text-xs text-slate-500 hover:text-chess-gold transition-colors"
                    >
                      <Lightbulb size={14} /> Show hint
                    </button>
                  )}
                </div>
              )}

              {/* Answer input */}
              {phase === 'question' && (
                <div className="flex gap-2">
                  <input
                    value={answer}
                    onChange={e => setAnswer(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && handleSubmitAnswer()}
                    placeholder="Your answer…"
                    className="flex-1 bg-chess-dark border border-slate-700 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-chess-gold"
                  />
                  <button
                    onClick={handleSubmitAnswer}
                    disabled={submitting || !answer.trim()}
                    className="bg-chess-gold text-chess-dark p-2 rounded-lg hover:opacity-90 disabled:opacity-50"
                  >
                    <Send size={16} />
                  </button>
                </div>
              )}
            </div>

            {/* Revealed explanation */}
            {revealed && phase === 'revealed' && (
              <div className="bg-chess-panel rounded-xl p-4 flex flex-col gap-3">
                <div className="flex items-center gap-3">
                  <Eye size={16} className="text-chess-gold" />
                  <span className="font-semibold text-chess-gold">Engine Reveals</span>
                </div>

                <div className="grid grid-cols-2 gap-3 text-sm">
                  {/* Student's suggestion (if they typed a legal move) */}
                  {revealed.student_move ? (
                    <InfoBox
                      label="Your suggestion"
                      value={`${revealed.student_move} (${revealed.student_cp_loss?.toFixed(0) ?? '?'} cp)`}
                      className={classificationClass(revealed.student_classification)}
                    />
                  ) : (
                    <InfoBox label="Your suggestion" value="—" />
                  )}
                  <InfoBox
                    label="Best move"
                    value={revealed.engine_best_move}
                    className="text-green-400 font-mono font-bold"
                  />
                  <InfoBox
                    label={`In game (${revealed.game_move ?? '?'})`}
                    value={`${revealed.eval_swing?.toFixed(0)} cp loss`}
                    className={classificationClass(revealed.classification)}
                  />
                  <InfoBox
                    label="Classification"
                    value={revealed.classification}
                    className={classificationClass(revealed.classification)}
                  />
                </div>

                {revealed.engine_line?.length > 0 && (
                  <div className="bg-chess-dark rounded-lg p-2 text-xs font-mono text-slate-300">
                    <span className="text-slate-500">Engine: </span>
                    {revealed.engine_line.join(' ')}
                  </div>
                )}

                {revealed.explanation && (
                  <div className="text-sm text-slate-300 leading-relaxed border-t border-slate-700 pt-3 whitespace-pre-wrap">
                    {revealed.explanation}
                  </div>
                )}

                {revealed.patterns_detected?.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {revealed.patterns_detected.map((p, i) => (
                      <span key={i} className="text-xs bg-chess-accent/40 text-slate-300 px-2 py-0.5 rounded-full">
                        {p.type.replace(/_/g, ' ')}
                      </span>
                    ))}
                  </div>
                )}

                <button
                  onClick={handleNext}
                  className="w-full bg-chess-gold text-chess-dark font-semibold py-2 rounded-lg hover:opacity-90"
                >
                  {revealed.completed ? 'Finish Session' : 'Next Position →'}
                </button>
              </div>
            )}

            {error && (
              <div className="p-3 bg-red-900/40 border border-red-700 rounded-lg text-red-300 text-sm">
                {error}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function InfoBox({ label, value, className = 'text-white' }) {
  return (
    <div className="bg-chess-dark rounded-lg p-2">
      <div className="text-xs text-slate-500 mb-0.5">{label}</div>
      <div className={`font-medium ${className}`}>{value || '—'}</div>
    </div>
  )
}

function PlayerLabel({ name, isUser }) {
  return (
    <div className="flex items-center gap-2 px-1 py-0.5">
      <div className={`w-2 h-2 rounded-full ${isUser ? 'bg-chess-gold' : 'bg-slate-500'}`} />
      <span className={`text-sm font-medium ${isUser ? 'text-chess-gold' : 'text-slate-400'}`}>
        {name || '—'}
      </span>
      {isUser && <span className="text-xs text-slate-500">(you)</span>}
    </div>
  )
}
