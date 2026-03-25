import { useState, useEffect, useRef, useCallback } from 'react'
import { Chessboard } from 'react-chessboard'
import {
  ChevronLeft, ChevronRight, AlertCircle, Cpu, MessageSquare, Trophy, Send,
} from 'lucide-react'
import Md from '../../components/Md'
import { EvalVerdictBadge } from '../../components/selfanalysis/SharedUI'
import { sendCoachChat } from '../../api/client'
import { TACTIC_META, HIGHLIGHT_COLORS } from './constants'
import {
  buildEngineArrows, fmtEval, toWhitePov, findCollapseIdx,
  classificationClass, classificationBg,
} from './exportUtils'

export default function CoachReviewPhase({
  sessionId, userColor, items, reviewIdx, setReviewIdx,
  reviewResponses, setReviewResponses,
  showEngineArrows, setShowEngineArrows,
  squareHighlights, setSquareHighlights,
  userArrows,
  onBack, onDashboard,
}) {
  const [chatInput, setChatInput] = useState('')
  const [chatLoading, setChatLoading] = useState(false)
  const [chatError, setChatError] = useState(null)
  // chatHistory: { [moveKey]: [{role, content}] }
  const [chatHistory, setChatHistory] = useState({})
  const [collapseHighlight, setCollapseHighlight] = useState(false)
  const chatEndRef = useRef(null)

  const item = items[reviewIdx] || null
  const moveKey = item?.move_index
  const currentResponse = reviewResponses[moveKey] || {}
  const currentChat = chatHistory[moveKey] || []

  const handleCoachSquareRightClick = useCallback(({ square }) => {
    const mi = item?.move_index
    if (mi === undefined) return
    setSquareHighlights(prev => {
      const curr = (prev[mi] || {})[square]
      const nextIdx = HIGHLIGHT_COLORS.indexOf(curr) + 1
      const nextColor = HIGHLIGHT_COLORS[nextIdx]
      const updated = { ...(prev[mi] || {}) }
      if (nextColor) updated[square] = nextColor
      else delete updated[square]
      return { ...prev, [mi]: updated }
    })
  }, [item?.move_index, setSquareHighlights])

  // Collapse index (memoised — stable for this review session)
  const collapseIdx = items.length > 0 ? findCollapseIdx(items) : null

  const isCollapseMove = collapseIdx !== null && reviewIdx === collapseIdx

  // Reset input when navigating; clear highlight animation after a moment
  useEffect(() => {
    setChatInput('')
    setChatError(null)
  }, [reviewIdx])

  // Scroll to bottom when new messages arrive
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [currentChat])

  useEffect(() => {
    if (collapseHighlight) {
      const t = setTimeout(() => setCollapseHighlight(false), 2000)
      return () => clearTimeout(t)
    }
  }, [collapseHighlight])

  const handleJumpToCollapse = () => {
    if (collapseIdx === null) return
    setReviewIdx(collapseIdx)
    setCollapseHighlight(true)
  }

  const handleSendChat = useCallback(async () => {
    if (!chatInput.trim() || !item || chatLoading) return
    const userMessage = { role: 'user', content: chatInput.trim() }
    const updatedHistory = [...currentChat, userMessage]
    setChatHistory(prev => ({ ...prev, [moveKey]: updatedHistory }))
    setChatInput('')
    setChatLoading(true)
    setChatError(null)
    try {
      // Send only role/content pairs (no system messages)
      const msgs = updatedHistory.filter(m => m.role !== 'system')
      const res = await sendCoachChat(sessionId, item.move_index, msgs)
      const assistantMessage = { role: 'assistant', content: res.data.reply }
      setChatHistory(prev => ({
        ...prev,
        [moveKey]: [...updatedHistory, assistantMessage],
      }))
    } catch (e) {
      setChatError(e.response?.data?.detail || e.message)
      // Remove the optimistic user message on error
      setChatHistory(prev => ({ ...prev, [moveKey]: currentChat }))
    } finally {
      setChatLoading(false)
    }
  }, [chatInput, item, moveKey, currentChat, chatLoading, sessionId])

  if (!item) {
    return (
      <div className="min-h-screen bg-chess-dark flex items-center justify-center">
        <div className="text-slate-400">No annotated moves to review.</div>
      </div>
    )
  }

  const canPrev = reviewIdx > 0
  const canNext = reviewIdx < items.length - 1
  const isLast  = reviewIdx === items.length - 1

  return (
    <div className="min-h-screen bg-chess-dark p-3 sm:p-4">
      <div className="max-w-5xl mx-auto">

        {/* Top bar */}
        <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
          <button
            onClick={onBack}
            className="flex items-center gap-1 text-slate-400 hover:text-white text-sm"
          >
            <ChevronLeft size={16} /> Back to Results
          </button>

          <div className="flex items-center gap-3 flex-wrap">
            <div className="flex items-center gap-2">
              <MessageSquare size={16} className="text-chess-gold" />
              <span className="text-sm font-semibold text-chess-gold">Coach Review</span>
              <span className="text-xs text-slate-500">{reviewIdx + 1} / {items.length}</span>
            </div>

            {/* Best Lines toggle */}
            <button
              onClick={() => setShowEngineArrows(v => !v)}
              title={showEngineArrows ? 'Hide engine best lines' : 'Show engine best lines'}
              className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full border transition-colors ${
                showEngineArrows
                  ? 'bg-green-900/50 border-green-600 text-green-300'
                  : 'border-slate-600 text-slate-400 hover:border-green-600 hover:text-green-300'
              }`}
            >
              <Cpu size={12} /> Best Lines
            </button>

            {/* Collapse finder button */}
            {collapseIdx !== null && (
              <button
                onClick={handleJumpToCollapse}
                className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full border transition-colors ${
                  isCollapseMove
                    ? 'bg-red-900/50 border-red-600 text-red-300'
                    : 'border-orange-700/60 text-orange-400 hover:bg-orange-900/30 hover:border-orange-500'
                }`}
              >
                <AlertCircle size={12} />
                {isCollapseMove ? 'Collapse point' : 'Find collapse point'}
              </button>
            )}
          </div>

          <button
            onClick={onDashboard}
            className="text-xs text-slate-500 hover:text-white transition-colors"
          >
            Dashboard →
          </button>
        </div>

        {/* Collapse banner — shown when viewing the collapse move */}
        {isCollapseMove && (
          <div className={`mb-4 rounded-xl border border-red-700/60 bg-red-900/20 p-3 flex items-start gap-3 transition-opacity ${
            collapseHighlight ? 'opacity-100' : 'opacity-90'
          }`}>
            <AlertCircle size={18} className="text-red-400 flex-shrink-0 mt-0.5" />
            <div>
              <div className="text-sm font-semibold text-red-300 mb-0.5">This is where the game collapsed</div>
              <div className="text-xs text-slate-400">
                {item.engine_eval_before != null && item.engine_eval_after != null
                  ? `Eval went from ${fmtEval(toWhitePov(item.engine_eval_before, item.color))} to ${fmtEval(toWhitePov(item.engine_eval_after, item.color))} after ${item.move_san} — a swing of ${Math.round(item.centipawn_loss)} cp.`
                  : `${item.move_san} caused a ${Math.round(item.centipawn_loss)} cp loss.`
                }
                {' '}Study this position carefully — your thinking process here is the key lesson.
              </div>
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

          {/* ── Left: Board ── */}
          <div>
            <div className="relative">
              <div className="rounded-xl overflow-hidden">
                {item.fen_before && (() => {
                  const coachHighlights = squareHighlights[item.move_index] || {}
                  const sqStyles = Object.fromEntries(
                    Object.entries(coachHighlights).map(([sq, c]) => [sq, { background: c }])
                  )
                  const engineArrows = showEngineArrows ? buildEngineArrows(item, item) : []
                  const rawUserArrows = item.user_arrows ?? userArrows[item.move_index]
                  const savedUserArrows = Array.isArray(rawUserArrows) ? rawUserArrows : []
                  const allArrows = [...engineArrows, ...savedUserArrows]
                  return (
                    <Chessboard
                      key={`coach-${item.move_index}`}
                      options={{
                        position: item.fen_before,
                        boardOrientation: userColor === 'black' ? 'black' : 'white',
                        allowDragging: false,
                        animationDurationInMs: 100,
                        boardStyle: { borderRadius: '8px' },
                        allowDrawingArrows: true,
                        arrows: allArrows,
                        squareStyles: sqStyles,
                        onSquareRightClick: handleCoachSquareRightClick,
                        clearArrowsOnPositionChange: false,
                      }}
                    />
                  )
                })()}
              </div>
              {showEngineArrows && (() => {
                const tactic = item.patterns?.find(p => TACTIC_META[p.type])
                if (!tactic) return null
                const meta = TACTIC_META[tactic.type]
                const Icon = meta.icon
                return (
                  <div className={`absolute top-2 left-2 flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-xs font-semibold backdrop-blur-sm shadow-lg ${meta.color}`}>
                    <Icon size={13} />
                    {meta.label}
                  </div>
                )
              })()}
            </div>

            {/* Move label */}
            <div className="mt-2 text-center">
              <span className="text-xs text-slate-400">
                Move {item.move_number} ·{' '}
                <span className="font-mono font-semibold text-chess-gold">{item.move_san}</span>
              </span>
              <div className="mt-1 flex items-center justify-center gap-2 flex-wrap">
                <span className={`text-xs font-medium px-2 py-0.5 rounded border ${classificationBg(item.classification)} ${classificationClass(item.classification)}`}>
                  {item.classification}
                  {item.centipawn_loss > 0 && ` · ${Math.round(item.centipawn_loss)} cp`}
                </span>
                <EvalVerdictBadge verdict={item.eval_verdict} />
              </div>
              {/* Eval delta */}
              {item.engine_eval_before != null && item.engine_eval_after != null && (
                <div className="mt-1.5 flex items-center justify-center gap-1.5 text-xs font-mono">
                  <span className={toWhitePov(item.engine_eval_before, item.color) >= 0 ? 'text-green-400' : 'text-red-400'}>
                    {fmtEval(toWhitePov(item.engine_eval_before, item.color))}
                  </span>
                  <span className="text-slate-600">→</span>
                  <span className={toWhitePov(item.engine_eval_after, item.color) >= 0 ? 'text-green-400' : 'text-red-400'}>
                    {fmtEval(toWhitePov(item.engine_eval_after, item.color))}
                  </span>
                </div>
              )}
            </div>

            {/* Engine line */}
            {item.engine_pv_san?.length > 0 && (
              <div className="bg-chess-panel rounded-xl p-3 mt-3">
                <div className="text-xs text-slate-500 mb-1">Engine best line</div>
                <div className="flex items-baseline gap-1.5 flex-wrap">
                  <span className="font-mono font-bold text-green-400 text-sm">{item.engine_best_move}</span>
                  <span className="font-mono text-xs text-slate-400">{item.engine_pv_san.slice(1).join(' ')}</span>
                </div>
                {item.engine_multipv?.length > 0 && (
                  <div className="mt-2 flex flex-col gap-1">
                    {item.engine_multipv.map((line, i) => (
                      <div key={i} className="flex gap-2 text-xs font-mono text-slate-400">
                        <span className="text-slate-600 w-3">{line.rank}.</span>
                        <span className="text-chess-gold font-bold w-10">{line.move_san}</span>
                        <span className="text-slate-500 w-10">{fmtEval(toWhitePov(line.score_cp, item.color))}</span>
                        <span className="truncate">{line.pv_san?.join(' ')}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Pattern badges */}
            {item.patterns?.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-2">
                {item.patterns.map((p, i) => (
                  <span key={i} className="text-xs bg-chess-accent/40 text-slate-300 px-2 py-0.5 rounded-full">
                    {p.type?.replace(/_/g, ' ')}
                  </span>
                ))}
              </div>
            )}

            {/* Navigation */}
            <div className="flex items-center justify-between mt-4 gap-2">
              <button
                onClick={() => setReviewIdx(i => i - 1)}
                disabled={!canPrev}
                className="relative flex items-center gap-1 text-sm px-3 py-1.5 rounded-lg border border-slate-700 text-slate-400 hover:text-white hover:border-slate-500 disabled:opacity-30 transition-colors"
              >
                <ChevronLeft size={15} /> Prev
                {/* Red dot if collapse is one step back */}
                {collapseIdx !== null && reviewIdx - 1 === collapseIdx && (
                  <span className="absolute -top-1 -left-1 w-2 h-2 rounded-full bg-red-500" title="Collapse point" />
                )}
              </button>
              {isLast ? (
                <button
                  onClick={onBack}
                  className="flex items-center gap-1 text-sm px-3 py-1.5 rounded-lg bg-chess-gold text-chess-dark font-semibold hover:opacity-90"
                >
                  <Trophy size={14} /> Finish Review
                </button>
              ) : (
                <button
                  onClick={() => setReviewIdx(i => i + 1)}
                  disabled={!canNext}
                  className="relative flex items-center gap-1 text-sm px-3 py-1.5 rounded-lg border border-slate-700 text-slate-400 hover:text-white hover:border-slate-500 disabled:opacity-30 transition-colors"
                >
                  Next <ChevronRight size={15} />
                  {/* Red dot if collapse is one step forward */}
                  {collapseIdx !== null && reviewIdx + 1 === collapseIdx && (
                    <span className="absolute -top-1 -right-1 w-2 h-2 rounded-full bg-red-500" title="Collapse point" />
                  )}
                </button>
              )}
            </div>
          </div>

          {/* ── Right: Review panel ── */}
          <div className="flex flex-col gap-4 min-w-0">

            {/* Your annotation */}
            {item.user_annotation && (
              <div className="bg-chess-panel rounded-xl p-4">
                <div className="text-xs text-slate-500 mb-1.5 uppercase tracking-wide">Your annotation</div>
                <div
                  className="text-sm text-slate-300 italic leading-relaxed prose-chess"
                  dangerouslySetInnerHTML={{ __html: `"${item.user_annotation}"` }}
                />
                {item.user_candidates?.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    <span className="text-xs text-slate-500">Candidates:</span>
                    {item.user_candidates.map((c, i) => (
                      <span key={i} className={`text-xs font-mono px-2 py-0.5 rounded-full border ${
                        c === item.engine_best_move
                          ? 'bg-green-900/40 border-green-700 text-green-300'
                          : 'border-slate-600 text-slate-300'
                      }`}>
                        {c}
                        {c === item.engine_best_move && ' ✓'}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Coach comment */}
            <div className="bg-chess-panel rounded-xl p-4 border border-chess-gold/20">
              <div className="flex items-center justify-between gap-2 mb-3">
                <div className="flex items-center gap-2">
                  <MessageSquare size={15} className="text-chess-gold" />
                  <span className="text-sm font-semibold text-chess-gold">Coach</span>
                </div>
                {/* Eval before → after */}
                {item.engine_eval_before != null && item.engine_eval_after != null && (
                  <div className="flex items-center gap-1 text-xs font-mono">
                    <span className={toWhitePov(item.engine_eval_before, item.color) >= 0 ? 'text-green-400' : 'text-red-400'}>
                      {fmtEval(toWhitePov(item.engine_eval_before, item.color))}
                    </span>
                    <span className="text-slate-600">→</span>
                    <span className={toWhitePov(item.engine_eval_after, item.color) >= 0 ? 'text-green-400' : 'text-red-400'}>
                      {fmtEval(toWhitePov(item.engine_eval_after, item.color))}
                    </span>
                  </div>
                )}
              </div>
              <p className="text-sm text-slate-200 leading-relaxed whitespace-pre-wrap">
                {item.coach_comment}
              </p>
            </div>

            {/* Chat panel */}
            <div className="bg-chess-panel rounded-xl flex flex-col" style={{ minHeight: '160px', maxHeight: '420px' }}>
              <div className="flex items-center gap-2 px-4 pt-3 pb-2 border-b border-slate-700">
                <MessageSquare size={14} className="text-chess-gold" />
                <span className="text-xs font-semibold text-chess-gold uppercase tracking-wide">Ask the coach</span>
                {currentChat.length > 0 && (
                  <button
                    onClick={() => setChatHistory(prev => ({ ...prev, [moveKey]: [] }))}
                    className="ml-auto text-xs text-slate-600 hover:text-slate-400 transition-colors"
                  >
                    Clear
                  </button>
                )}
              </div>

              {/* Messages */}
              <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3 min-h-0">
                {currentChat.length === 0 && (
                  <p className="text-xs text-slate-500 italic">
                    Ask anything about this position — "What if I played Nf6?", "Show me the best alternatives", "Why is this a blunder?"
                  </p>
                )}
                {currentChat.map((msg, i) => (
                  <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                    <div className={`max-w-[85%] rounded-xl px-3 py-2 text-sm leading-relaxed whitespace-pre-wrap ${
                      msg.role === 'user'
                        ? 'bg-chess-accent text-white'
                        : 'bg-slate-700/60 text-slate-200 border border-slate-600'
                    }`}>
                      {msg.role === 'assistant' && (
                        <span className="text-xs text-chess-gold font-semibold block mb-1">Coach</span>
                      )}
                      {msg.content}
                    </div>
                  </div>
                ))}
                {chatLoading && (
                  <div className="flex justify-start">
                    <div className="bg-slate-700/60 border border-slate-600 rounded-xl px-3 py-2 text-xs text-slate-400 animate-pulse">
                      Coach is thinking…
                    </div>
                  </div>
                )}
                {chatError && (
                  <p className="text-xs text-red-400">{chatError}</p>
                )}
                <div ref={chatEndRef} />
              </div>

              {/* Input */}
              <div className="px-3 pb-3 pt-2 border-t border-slate-700 flex gap-2">
                <input
                  type="text"
                  value={chatInput}
                  onChange={e => setChatInput(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) handleSendChat() }}
                  placeholder="Ask anything… (Enter to send)"
                  disabled={chatLoading}
                  className="flex-1 bg-chess-dark border border-slate-700 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-chess-gold disabled:opacity-50"
                />
                <button
                  onClick={handleSendChat}
                  disabled={chatLoading || !chatInput.trim()}
                  className="flex items-center gap-1 px-3 py-2 rounded-lg bg-chess-gold text-chess-dark font-semibold text-sm hover:opacity-90 disabled:opacity-40 transition-opacity"
                >
                  <Send size={13} />
                </button>
              </div>
            </div>

          </div>
        </div>
      </div>
    </div>
  )
}
