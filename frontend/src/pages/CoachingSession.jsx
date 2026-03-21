import { useState, useEffect, useRef } from 'react'
import { useParams, useLocation, useNavigate } from 'react-router-dom'
import { Chessboard } from 'react-chessboard'
import {
  Send, ChevronLeft, Lightbulb, Eye, Trophy,
  ChevronDown, ChevronUp, Brain, MessageSquare, ArrowRight,
} from 'lucide-react'
import { startSession, submitAnswer, closeCoachingSession } from '../api/client'

// ── Markdown renderer ─────────────────────────────────────────────────────────

function inlineMarkdown(text) {
  const parts = text.split(/(\*\*[^*]+\*\*|\*[^*]+\*)/g)
  return parts.map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**')) return <strong key={i}>{part.slice(2, -2)}</strong>
    if (part.startsWith('*') && part.endsWith('*'))   return <em key={i}>{part.slice(1, -1)}</em>
    return part
  })
}

function Md({ text, className = '' }) {
  if (!text) return null
  const lines = text.split('\n')
  const elements = []
  let listItems = [], listType = null
  const flushList = () => {
    if (!listItems.length) return
    const Tag = listType === 'ol' ? 'ol' : 'ul'
    const cls = listType === 'ol' ? 'list-decimal list-inside space-y-0.5' : 'list-disc list-inside space-y-0.5'
    elements.push(<Tag key={elements.length} className={cls}>{listItems.map((it, i) => <li key={i}>{inlineMarkdown(it)}</li>)}</Tag>)
    listItems = []; listType = null
  }
  lines.forEach((line, idx) => {
    const ul = line.match(/^[-*]\s+(.+)/), ol = line.match(/^\d+\.\s+(.+)/)
    if (ul) { if (listType === 'ol') flushList(); listType = 'ul'; listItems.push(ul[1]) }
    else if (ol) { if (listType === 'ul') flushList(); listType = 'ol'; listItems.push(ol[1]) }
    else { flushList(); if (line.trim() === '') { if (idx > 0) elements.push(<br key={elements.length} />) } else elements.push(<span key={elements.length} className="block">{inlineMarkdown(line)}</span>) }
  })
  flushList()
  return <div className={className}>{elements}</div>
}

function classificationClass(c) {
  const map = {
    best: 'move-best', good: 'move-good',
    inaccuracy: 'move-inaccuracy', mistake: 'move-mistake', blunder: 'move-blunder',
  }
  return map[c] || ''
}

// ── Thinking capture panel ────────────────────────────────────────────────────

function ThinkingCapturePanel({ candidateMoves, onSubmit, onSkip, submitting }) {
  const [selected, setSelected] = useState([])
  const [reasoning, setReasoning] = useState('')
  const [showReasoning, setShowReasoning] = useState(false)

  const toggleMove = (san) => {
    setSelected(prev =>
      prev.includes(san)
        ? prev.filter(m => m !== san)
        : prev.length < 3 ? [...prev, san] : prev
    )
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-slate-400">Which moves were you considering? (tap to select, up to 3)</p>
      <div className="grid grid-cols-3 gap-2">
        {candidateMoves.map(m => (
          <button
            key={m.san}
            onClick={() => toggleMove(m.san)}
            className={`px-2 py-2 rounded-lg text-sm font-mono font-semibold border transition-all ${
              selected.includes(m.san)
                ? 'bg-chess-gold text-chess-dark border-chess-gold'
                : 'bg-chess-dark text-slate-300 border-slate-600 hover:border-slate-400'
            }`}
          >
            {m.san}
          </button>
        ))}
      </div>

      <button
        onClick={() => setShowReasoning(v => !v)}
        className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-300 transition-colors w-fit"
      >
        <ChevronDown size={12} className={`transition-transform ${showReasoning ? 'rotate-180' : ''}`} />
        Add reasoning (optional)
      </button>

      {showReasoning && (
        <textarea
          value={reasoning}
          onChange={e => setReasoning(e.target.value)}
          placeholder="What were you thinking? Why did you consider these moves?"
          rows={2}
          className="w-full bg-chess-dark border border-slate-700 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-chess-gold resize-none"
        />
      )}

      <div className="flex gap-2">
        <button
          onClick={() => onSubmit(selected, reasoning)}
          disabled={submitting || selected.length === 0}
          className="flex-1 flex items-center justify-center gap-2 bg-chess-gold text-chess-dark font-semibold px-4 py-2 rounded-lg hover:opacity-90 disabled:opacity-50 text-sm"
        >
          {submitting ? 'Analyzing…' : 'Submit'}
        </button>
        <button
          onClick={onSkip}
          disabled={submitting}
          className="px-4 py-2 bg-slate-700 text-slate-300 rounded-lg hover:bg-slate-600 text-sm transition-colors disabled:opacity-50"
        >
          Skip
        </button>
      </div>
    </div>
  )
}

// ── Coach opening screen ──────────────────────────────────────────────────────

function CoachOpeningScreen({ coachOpening, gameArc, totalCritical, onStart }) {
  return (
    <div className="min-h-screen bg-chess-dark flex flex-col items-center justify-center p-6">
      <div className="max-w-lg w-full flex flex-col gap-5">

        {/* Coach message */}
        <div className="bg-chess-panel rounded-2xl p-6 border border-slate-700">
          <div className="flex items-center gap-2 mb-4">
            <div className="w-8 h-8 rounded-full bg-chess-gold/20 border border-chess-gold/40 flex items-center justify-center">
              <Brain size={16} className="text-chess-gold" />
            </div>
            <span className="text-chess-gold font-semibold text-sm">Your Coach</span>
          </div>
          <p className="text-white leading-relaxed text-[15px]">{coachOpening}</p>
        </div>

        {/* Game arc */}
        {gameArc && (
          <div className="bg-chess-dark rounded-xl p-4 border border-slate-700/60">
            <div className="flex items-center gap-2 mb-2">
              <MessageSquare size={13} className="text-slate-400" />
              <span className="text-xs text-slate-400 font-medium uppercase tracking-wide">How this game went</span>
            </div>
            <p className="text-slate-300 text-sm leading-relaxed">{gameArc}</p>
          </div>
        )}

        {/* Start button */}
        <button
          onClick={onStart}
          className="flex items-center justify-center gap-2 bg-chess-gold text-chess-dark font-bold px-6 py-3.5 rounded-xl hover:opacity-90 transition-opacity text-base"
        >
          Review {totalCritical} critical position{totalCritical !== 1 ? 's' : ''}
          <ArrowRight size={18} />
        </button>
      </div>
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export default function CoachingSession() {
  const { gameId } = useParams()
  const { state } = useLocation()
  const navigate = useNavigate()

  const userId = state?.userId || 1

  // phases: 'loading' | 'opening' | 'question' | 'revealed' | 'complete'
  const [phase, setPhase] = useState('loading')

  const [sessionId, setSessionId] = useState(null)
  const [coachOpening, setCoachOpening] = useState(null)
  const [gameArc, setGameArc] = useState(null)
  const [position, setPosition] = useState(null)
  const [question, setQuestion] = useState(null)
  const [hint, setHint] = useState(null)
  const [showHint, setShowHint] = useState(false)
  const [candidateMoves, setCandidateMoves] = useState([])
  const [revealed, setRevealed] = useState(null)
  const [progress, setProgress] = useState(null)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState(null)
  const [sessionSummary, setSessionSummary] = useState(null)
  const [summaryExpanded, setSummaryExpanded] = useState(false)
  const closedRef = useRef(false)

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
        setCoachOpening(data.coach_opening || null)
        setGameArc(data.game_arc || null)
        setSessionSummary(data.session_summary || null)
        setPosition(data.current_position)
        setQuestion(data.question)
        setHint(data.hint)
        setCandidateMoves(data.candidate_moves || [])
        setProgress({ reviewed: 0, total: data.total_critical_moves })
        // If we have a coach opening, show it first; else go straight to questions
        setPhase(data.coach_opening ? 'opening' : 'question')
      } catch (e) {
        setError(e.response?.data?.detail || e.message)
        setPhase('complete')
      }
    }
    init()
  }, [gameId, userId])

  // Update coach memory when session is complete or user navigates away
  const closeSession = async (sid) => {
    if (!sid || closedRef.current) return
    closedRef.current = true
    try { await closeCoachingSession(sid) } catch (_) {}
  }

  const handleSubmitAnswer = async (selectedMoves, reasoning, skipped = false) => {
    if (!sessionId) return
    if (!skipped && selectedMoves.length === 0) return
    setSubmitting(true)
    try {
      const res = await submitAnswer(sessionId, skipped ? [] : selectedMoves, reasoning || '', skipped)
      const data = res.data
      setRevealed(data)
      setProgress(data.progress)
      if (data.completed) {
        await closeSession(sessionId)
        setPhase('complete')
      } else {
        setPhase('revealed')
        setSummaryExpanded(false)
      }
    } catch (e) {
      setError(e.response?.data?.detail || e.message)
    } finally {
      setSubmitting(false)
    }
  }

  const handleNext = () => {
    if (!revealed) return
    setPosition(revealed.next_position)
    setQuestion(revealed.next_question?.question)
    setHint(revealed.next_question?.hint)
    setCandidateMoves(revealed.next_question?.candidate_moves || [])
    setShowHint(false)
    setRevealed(null)
    setPhase('question')
  }

  // ── Loading ────────────────────────────────────────────────────────────────
  if (phase === 'loading') {
    return (
      <div className="min-h-screen bg-chess-dark flex items-center justify-center">
        <div className="text-chess-gold text-lg animate-pulse">Preparing your session…</div>
      </div>
    )
  }

  // ── Coach opening ──────────────────────────────────────────────────────────
  if (phase === 'opening') {
    return (
      <CoachOpeningScreen
        coachOpening={coachOpening}
        gameArc={gameArc}
        totalCritical={progress?.total || 0}
        onStart={() => setPhase('question')}
      />
    )
  }

  // ── Complete ───────────────────────────────────────────────────────────────
  if (phase === 'complete') {
    return (
      <div className="min-h-screen bg-chess-dark flex flex-col items-center justify-center gap-6 p-6">
        <Trophy size={48} className="text-chess-gold" />
        <h2 className="text-2xl font-bold text-white">Session Complete</h2>
        {progress && (
          <p className="text-slate-400 text-center max-w-xs">
            You reviewed {progress.reviewed} critical position{progress.reviewed !== 1 ? 's' : ''}.
            Your coach has noted the patterns for next time.
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

  // ── Review ─────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-chess-dark p-4">
      <div className="max-w-5xl mx-auto">

        {/* Top bar */}
        <div className="flex items-center justify-between mb-4">
          <button
            onClick={() => { closeSession(sessionId); navigate('/') }}
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

        {/* Collapsible coach summary */}
        {sessionSummary && (
          <div className="mb-4 bg-chess-panel rounded-xl overflow-hidden border border-slate-700">
            <button
              onClick={() => setSummaryExpanded(v => !v)}
              className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-slate-800/40 transition-colors"
            >
              <span className="text-sm font-semibold text-chess-gold">Game Overview</span>
              {summaryExpanded
                ? <ChevronUp size={14} className="text-slate-400" />
                : <ChevronDown size={14} className="text-slate-400" />
              }
            </button>
            {summaryExpanded && (
              <div className="px-4 pb-4 text-sm text-slate-300 leading-relaxed">
                {sessionSummary}
              </div>
            )}
          </div>
        )}

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
            {phase === 'question' && (
              <div className="bg-chess-panel rounded-xl p-4">
                <p className="text-white font-medium mb-3">{question}</p>

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

                {candidateMoves.length > 0 ? (
                  <ThinkingCapturePanel
                    candidateMoves={candidateMoves}
                    onSubmit={(moves, text) => handleSubmitAnswer(moves, text)}
                    onSkip={() => handleSubmitAnswer([], '', true)}
                    submitting={submitting}
                  />
                ) : (
                  <div className="flex flex-col gap-2">
                    <textarea
                      placeholder="What would you play and why? Explain your thinking — the coach will assess your reasoning."
                      rows={3}
                      className="w-full bg-chess-dark border border-slate-700 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-chess-gold resize-none"
                      onKeyDown={e => {
                        if (e.key === 'Enter' && e.ctrlKey) handleSubmitAnswer([], e.target.value)
                      }}
                    />
                    <button
                      onClick={e => {
                        const ta = e.target.closest('.flex').querySelector('textarea')
                        handleSubmitAnswer([], ta?.value || '')
                      }}
                      disabled={submitting}
                      className="flex items-center justify-center gap-2 bg-chess-gold text-chess-dark font-semibold px-4 py-2 rounded-lg hover:opacity-90 disabled:opacity-50 text-sm"
                    >
                      {submitting ? 'Analyzing…' : <><Send size={14} /> Submit Answer</>}
                    </button>
                    <p className="text-xs text-slate-600">Ctrl+Enter to submit</p>
                  </div>
                )}
              </div>
            )}

            {/* Revealed explanation */}
            {revealed && phase === 'revealed' && (
              <div className="bg-chess-panel rounded-xl p-4 flex flex-col gap-3">
                <div className="flex items-center gap-3">
                  <Eye size={16} className="text-chess-gold" />
                  <span className="font-semibold text-chess-gold">Engine Reveals</span>
                </div>

                {/* Candidate moves selected */}
                {revealed.candidate_moves_selected?.length > 0 && (
                  <div className="bg-chess-dark rounded-lg p-3 border-l-2 border-slate-600">
                    <div className="text-xs text-slate-500 mb-1">Your candidates</div>
                    <div className="flex flex-wrap gap-1.5">
                      {revealed.candidate_moves_selected.map((m, i) => (
                        <span
                          key={i}
                          className={`px-2 py-0.5 rounded text-xs font-mono font-semibold ${
                            m === revealed.engine_best_move
                              ? 'bg-green-900/50 text-green-400'
                              : 'bg-slate-700 text-slate-300'
                          }`}
                        >
                          {m} {m === revealed.engine_best_move && '✓'}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {revealed.user_answer_text && (
                  <div className="bg-chess-dark rounded-lg p-3 border-l-2 border-slate-600">
                    <div className="text-xs text-slate-500 mb-1">Your reasoning</div>
                    <p className="text-sm text-slate-300 italic">"{revealed.user_answer_text}"</p>
                  </div>
                )}

                <div className="grid grid-cols-2 gap-3 text-sm">
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
                  <div className="border-t border-slate-700 pt-3">
                    <Md text={revealed.explanation} className="text-sm text-slate-300 leading-relaxed" />
                  </div>
                )}

                {/* Mental coaching note — only when blundered from winning position */}
                {revealed.mental_note && (
                  <div className="flex gap-2.5 bg-amber-950/40 border border-amber-700/40 rounded-lg p-3">
                    <Brain size={15} className="text-amber-400 mt-0.5 shrink-0" />
                    <p className="text-amber-200 text-sm leading-relaxed">{revealed.mental_note}</p>
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

                {revealed.thinking_errors?.length > 0 && (
                  <div className="bg-chess-dark/60 rounded-lg p-3 border border-slate-700">
                    <div className="text-xs text-slate-500 mb-1.5">Thinking pattern</div>
                    <div className="space-y-1">
                      {revealed.thinking_errors.map((e, i) => (
                        <p key={i} className="text-xs text-amber-400">
                          {e.type.replace(/_/g, ' ')} — {e.description}
                        </p>
                      ))}
                    </div>
                  </div>
                )}

                <button
                  onClick={handleNext}
                  className="w-full bg-chess-gold text-chess-dark font-semibold py-2 rounded-lg hover:opacity-90"
                >
                  Next Position →
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
