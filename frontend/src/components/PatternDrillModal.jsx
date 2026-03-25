import { useState, useEffect, useCallback } from 'react'
import { Chessboard } from 'react-chessboard'
import { X, ChevronLeft, ChevronRight, Lightbulb, Loader } from 'lucide-react'
import { getPatternDrill, getPatternExplain } from '../api/client'
import { TACTIC_META } from '../pages/selfanalysis/constants'

const PATTERN_LABEL = {
  fork: 'Fork (missed)',
  pin: 'Pin (missed)',
  hanging_piece_missed: 'Hanging piece (missed)',
  missed_checkmate: 'Missed checkmate',
  missed_fork: 'Missed fork',
  missed_pin: 'Missed pin',
  pawn_structure_weakened: 'Pawn structure weakened',
  isolated_pawn_created: 'Isolated pawn',
  weak_squares_created: 'Weak squares',
  strategic_drift: 'Strategic drift',
  bishop_knight_trade_bad: 'Poor B×N trade',
}

/** Parse a UCI move string like "e2e4" into [fromSq, toSq] e.g. ["e2","e4"] */
function parseUci(uci) {
  if (!uci || uci.length < 4) return null
  return [uci.slice(0, 2), uci.slice(2, 4)]
}

function cpLabel(cp) {
  if (!cp) return null
  if (cp >= 300) return { text: `-${cp} cp (blunder)`, color: '#ef4444' }
  if (cp >= 100) return { text: `-${cp} cp (mistake)`, color: '#f97316' }
  return { text: `-${cp} cp (inaccuracy)`, color: '#facc15' }
}

function inlineMarkdown(text) {
  const parts = text.split(/(\*\*[^*]+\*\*|\*[^*]+\*)/g)
  return parts.map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**')) return <strong key={i}>{part.slice(2, -2)}</strong>
    if (part.startsWith('*') && part.endsWith('*')) return <em key={i}>{part.slice(1, -1)}</em>
    return part
  })
}

function Md({ text }) {
  if (!text) return null
  return (
    <div className="space-y-1.5">
      {text.split('\n').map((line, i) => {
        if (!line.trim()) return null
        return <p key={i} className="text-sm text-slate-300 leading-relaxed">{inlineMarkdown(line)}</p>
      })}
    </div>
  )
}

export default function PatternDrillModal({ userId, patternType, totalGames, onClose }) {
  const [positions, setPositions] = useState([])
  const [index, setIndex] = useState(0)
  const [loading, setLoading] = useState(true)
  const [tip, setTip] = useState(null)
  const [loadingTip, setLoadingTip] = useState(false)
  const [showBestMove, setShowBestMove] = useState(false)

  const label = PATTERN_LABEL[patternType] || patternType.replace(/_/g, ' ')

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      setLoading(true)
      try {
        const res = await getPatternDrill(userId, patternType)
        if (!cancelled) {
          setPositions(res.data.positions || [])
          setIndex(0)
        }
      } catch (e) {
        console.error(e)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [userId, patternType])

  // Reset "show best move" and tip when navigating
  useEffect(() => { setShowBestMove(false); setTip(null) }, [index])

  // Keyboard navigation
  useEffect(() => {
    const handler = (e) => {
      if (e.key === 'ArrowRight') setIndex(i => Math.min(i + 1, positions.length - 1))
      if (e.key === 'ArrowLeft') setIndex(i => Math.max(i - 1, 0))
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [positions.length, onClose])

  const pos = positions[index]

  const handleAskCoach = useCallback(async () => {
    if (loadingTip || tip || !pos) return
    setLoadingTip(true)
    try {
      const res = await getPatternExplain(userId, patternType, pos)
      setTip(res.data.explanation)
    } catch (e) {
      setTip('Could not reach the coach — try again later.')
    } finally {
      setLoadingTip(false)
    }
  }, [userId, patternType, pos, tip, loadingTip])
  const arrow = pos?.best_move_uci ? parseUci(pos.best_move_uci) : null
  const cpInfo = pos ? cpLabel(pos.centipawn_loss) : null

  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div
        className="bg-chess-panel border border-slate-700 rounded-2xl w-full max-w-4xl max-h-[92vh] overflow-y-auto shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-slate-700">
          <div>
            <h2 className="text-lg font-bold text-chess-gold">{label}</h2>
            <p className="text-xs text-slate-500 mt-0.5">
              {positions.length} positions from your games
              {totalGames ? ` · across ${totalGames} analyzed games` : ''}
            </p>
          </div>
          <button onClick={onClose} className="text-slate-500 hover:text-white transition-colors p-1">
            <X size={20} />
          </button>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-20 text-slate-400">
            <Loader size={20} className="animate-spin mr-2" /> Loading positions…
          </div>
        ) : positions.length === 0 ? (
          <div className="text-center py-16 text-slate-500">
            No positions found for this pattern in your analyzed games.
          </div>
        ) : (
          <div className="p-5 grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Left — board */}
            <div className="space-y-3">
              {/* Nav */}
              <div className="flex items-center justify-between">
                <button
                  onClick={() => setIndex(i => Math.max(i - 1, 0))}
                  disabled={index === 0}
                  className="p-1.5 rounded-lg bg-slate-700 hover:bg-slate-600 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                >
                  <ChevronLeft size={16} />
                </button>
                <span className="text-sm text-slate-400">
                  Position <span className="text-white font-semibold">{index + 1}</span> of {positions.length}
                </span>
                <button
                  onClick={() => setIndex(i => Math.min(i + 1, positions.length - 1))}
                  disabled={index === positions.length - 1}
                  className="p-1.5 rounded-lg bg-slate-700 hover:bg-slate-600 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                >
                  <ChevronRight size={16} />
                </button>
              </div>

              {/* Board */}
              <div className="relative rounded-xl overflow-hidden">
                {pos?.fen && (
                  <Chessboard
                    key={`${pos.fen}-${showBestMove}`}
                    options={{
                      position: pos.fen,
                      boardOrientation: pos.user_color === 'black' ? 'black' : 'white',
                      allowDragging: false,
                      animationDurationInMs: 150,
                      arrows: showBestMove && arrow
                        ? [{ startSquare: arrow[0], endSquare: arrow[1], color: 'rgb(0, 200, 80)' }]
                        : [],
                      squareStyles: showBestMove
                        ? Object.fromEntries(
                            (pos.reveal_squares || []).map(sq => [
                              sq,
                              {
                                // Ring outline — keeps the piece visible underneath
                                background: 'radial-gradient(circle, transparent 52%, rgba(250,200,0,1) 52%, rgba(250,200,0,1) 68%, transparent 68%)',
                              },
                            ])
                          )
                        : {},
                      boardStyle: { borderRadius: '8px' },
                    }}
                  />
                )}
                {showBestMove && (() => {
                  const meta = TACTIC_META[patternType]
                  if (!meta) return null
                  const Icon = meta.icon
                  return (
                    <div className={`absolute top-2 left-2 flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-xs font-semibold backdrop-blur-sm shadow-lg ${meta.color}`}>
                      <Icon size={13} />
                      {meta.label}
                    </div>
                  )
                })()}
              </div>

              {/* Reveal toggle */}
              <button
                onClick={() => setShowBestMove(v => !v)}
                className={`w-full py-2 rounded-lg text-sm font-semibold transition-colors ${
                  showBestMove
                    ? 'bg-amber-700/60 text-amber-300 hover:bg-amber-700/80'
                    : 'bg-chess-accent text-white hover:bg-chess-accent/80'
                }`}
              >
                {showBestMove ? 'Hide solution' : 'Reveal →'}
              </button>
            </div>

            {/* Right — details + coach */}
            <div className="space-y-4 flex flex-col">
              {/* Move comparison */}
              <div className="bg-slate-800 rounded-xl p-4 space-y-3">
                {!showBestMove ? (
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-xs text-slate-500 uppercase tracking-wide mb-0.5">You played</p>
                      <p className="text-xl font-bold text-red-400">{pos?.user_move_san || '?'}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-xs text-slate-500 uppercase tracking-wide mb-0.5">Best move</p>
                      <p className="text-xl font-bold text-slate-600 select-none tracking-widest">• • •</p>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-xs text-slate-500 uppercase tracking-wide mb-0.5">You played</p>
                      <p className="text-xl font-bold text-red-400">{pos?.user_move_san || '?'}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-xs text-slate-500 uppercase tracking-wide mb-0.5">Best move</p>
                      <p className="text-xl font-bold text-green-400">{pos?.best_move_san || '?'}</p>
                    </div>
                  </div>
                )}

                {showBestMove && cpInfo && (
                  <div
                    className="text-xs font-semibold px-2 py-1 rounded-md w-fit"
                    style={{ color: cpInfo.color, backgroundColor: cpInfo.color + '22' }}
                  >
                    {cpInfo.text}
                  </div>
                )}

                {showBestMove && pos?.tactic_explanation && (
                  <div className="border-t border-slate-700 pt-2 space-y-1">
                    <p className="text-xs font-semibold text-chess-gold uppercase tracking-wide">The tactic</p>
                    <p className="text-sm text-slate-200 leading-relaxed">{pos.tactic_explanation}</p>
                  </div>
                )}
                {showBestMove && pos?.description && !pos?.tactic_explanation && (
                  <p className="text-xs text-slate-400 leading-relaxed border-t border-slate-700 pt-2">
                    {pos.description}
                  </p>
                )}

                <p className="text-xs text-slate-600">
                  Move {pos?.move_number} · Game #{pos?.game_id}
                  {pos?.user_color && ` · playing as ${pos.user_color}`}
                </p>
              </div>

              {/* LLM tips — only shown after reveal */}
              <div className="bg-slate-800 rounded-xl p-4 flex-1">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-semibold text-chess-gold flex items-center gap-2">
                    <Lightbulb size={15} /> Coach Tips
                  </h3>
                  {showBestMove && !tip && (
                    <button
                      onClick={handleAskCoach}
                      disabled={loadingTip}
                      className="text-xs px-3 py-1.5 rounded-lg bg-chess-accent hover:bg-chess-accent/80 text-white font-medium disabled:opacity-50 transition-colors flex items-center gap-1.5"
                    >
                      {loadingTip && <Loader size={11} className="animate-spin" />}
                      {loadingTip ? 'Asking coach…' : 'Ask coach'}
                    </button>
                  )}
                </div>

                {!showBestMove && (
                  <p className="text-xs text-slate-500">
                    Reveal the solution first, then ask the coach for tips.
                  </p>
                )}
                {showBestMove && !tip && !loadingTip && (
                  <p className="text-xs text-slate-500">
                    Click "Ask coach" to get practical tips on how to spot this pattern based on your own games.
                  </p>
                )}

                {loadingTip && (
                  <p className="text-xs text-slate-500 animate-pulse">Coach is analyzing your positions…</p>
                )}

                {tip && (
                  <div className="space-y-2">
                    <Md text={tip} />
                    <button
                      onClick={() => setTip(null)}
                      className="text-xs text-slate-600 hover:text-slate-400 transition-colors mt-1"
                    >
                      Reset
                    </button>
                  </div>
                )}
              </div>

              {/* Keyboard hint */}
              <p className="text-xs text-slate-600 text-center">
                ← → arrow keys to navigate · Esc to close
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
