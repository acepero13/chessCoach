import { Chessboard } from 'react-chessboard'
import {
  ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight,
  PenLine, Eye, Clock, Filter, Flag, Cpu, Info,
} from 'lucide-react'
import Md from '../../components/Md'
import {
  FoldableSection, RichTextEditor, ExportDropdown, BoardLegend,
  PlayerLabel, InfoBox, NavBtn, RootCausePicker,
} from '../../components/selfanalysis/SharedUI'
import MoveList from '../../components/selfanalysis/MoveList'
import { EVAL_OPTIONS, SIGNAL_CHECKS, TACTIC_META, MISTAKE_REASONS } from './constants'
import {
  buildEngineArrows, fmtEval, toWhitePov,
  classificationClass, classificationBg,
} from './exportUtils'

export default function AnnotatingPhase({
  sessionMeta,
  allGameMoves,
  navIdx,
  currentMove,
  currentReveal,
  annotatedMoves,
  criticalOnly,
  setCriticalOnly,
  showEngineArrows,
  setShowEngineArrows,
  squareHighlights,
  userArrows,
  suggestedMin,
  annotation,
  setAnnotation,
  candidates,
  setCandidates,
  evalLabel,
  setEvalLabel,
  confidence,
  setConfidence,
  markedCritical,
  setMarkedCritical,
  signalFlags,
  setSignalFlags,
  mistakeReason,
  setMistakeReason,
  submitting,
  error,
  handleSquareRightClick,
  handleArrowsChange,
  handleSubmit,
  handleRootCause,
  handleRequestComplete,
  goPrev,
  goNext,
  canGoPrev,
  canGoNext,
  formRef,
  rootCauses,
  annotatedCount,
  userMoveCount,
  onNavigate,
  onExport,
  onExportPgn,
  onDashboard,
}) {
  const isUserMove = currentMove?.is_user_move ?? false

  return (
    <div className="min-h-screen bg-chess-dark p-3 sm:p-4">
      <div className="max-w-5xl mx-auto">

        {/* Top bar */}
        <div className="flex items-center justify-between mb-4 gap-2 flex-wrap">
          <button
            onClick={onDashboard}
            className="flex items-center gap-1 text-slate-400 hover:text-white text-sm"
          >
            <ChevronLeft size={16} /> Dashboard
          </button>

          <div className="flex items-center gap-3 flex-wrap">
            {/* Critical-only toggle */}
            <button
              onClick={() => setCriticalOnly(v => !v)}
              className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full border transition-colors ${
                criticalOnly
                  ? 'bg-orange-900/50 border-orange-600 text-orange-300'
                  : 'border-slate-600 text-slate-400 hover:border-slate-400 hover:text-white'
              }`}
            >
              <Filter size={12} />
              {criticalOnly ? 'Critical only' : 'All moves'}
            </button>

            {suggestedMin && (
              <span className="flex items-center gap-1 text-xs text-slate-500">
                <Clock size={12} /> ~{suggestedMin} min/move
              </span>
            )}

            <span className="text-xs text-slate-400">
              <span className="text-chess-gold font-semibold">{annotatedCount}</span>
              /{userMoveCount} annotated
            </span>

            {/* Best Lines toggle + legend */}
            <div className="flex items-center gap-1.5">
              <button
                onClick={() => setShowEngineArrows(v => !v)}
                title={showEngineArrows ? 'Hide engine best lines' : 'Show engine best lines (after reveal)'}
                className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full border transition-colors ${
                  showEngineArrows
                    ? 'bg-green-900/50 border-green-600 text-green-300'
                    : 'border-slate-600 text-slate-400 hover:border-green-600 hover:text-green-300'
                }`}
              >
                <Cpu size={12} /> Best Lines
              </button>
              <BoardLegend />
            </div>

            {/* Export dropdown */}
            <ExportDropdown onExportPgn={onExportPgn} onExportMd={onExport} />

            {/* Finish session */}
            <button
              onClick={handleRequestComplete}
              className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full border border-chess-gold/50 text-chess-gold hover:bg-chess-gold/10 transition-colors"
            >
              <Flag size={12} /> Finish Session
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* ── Left: Board + Navigation ── */}
          <div>
            {sessionMeta && (
              <PlayerLabel
                name={sessionMeta.user_color === 'black' ? sessionMeta.white_player : sessionMeta.black_player}
                isUser={false}
              />
            )}

            <div className="relative my-1">
              <div className="rounded-xl overflow-hidden">
                {currentMove && (() => {
                  // When Best Lines is on, show fen_before so arrows align with pre-move pieces
                  const boardPos = showEngineArrows ? currentMove.fen_before : currentMove.fen_after
                  const moveIndex = currentMove.move_index
                  const moveHighlights = squareHighlights[moveIndex] || {}
                  const sqStyles = Object.fromEntries(
                    Object.entries(moveHighlights).map(([sq, c]) => [sq, { background: c }])
                  )
                  const engineArrows = showEngineArrows ? buildEngineArrows(currentReveal, currentMove) : []
                  const rawUserArrows = currentReveal?.user_arrows ?? userArrows[moveIndex]
                  const savedUserArrows = Array.isArray(rawUserArrows) ? rawUserArrows : []
                  const allArrows = [...engineArrows, ...savedUserArrows]
                  return (
                    <Chessboard
                      key={`${moveIndex}-${showEngineArrows ? 'before' : 'after'}`}
                      options={{
                        position: boardPos,
                        boardOrientation: sessionMeta?.user_color === 'black' ? 'black' : 'white',
                        allowDragging: false,
                        animationDurationInMs: 100,
                        boardStyle: { borderRadius: '8px' },
                        allowDrawingArrows: true,
                        arrows: allArrows,
                        squareStyles: sqStyles,
                        onSquareRightClick: handleSquareRightClick,
                        onArrowsChange: handleArrowsChange,
                        clearArrowsOnPositionChange: false,
                      }}
                    />
                  )
                })()}
              </div>
              {/* Tactic badge — only when Best Lines is active and a tactic was detected */}
              {showEngineArrows && (() => {
                const tactic = currentReveal?.patterns?.find(p => TACTIC_META[p.type])
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

            {sessionMeta && (
              <PlayerLabel
                name={sessionMeta.user_color === 'black' ? sessionMeta.black_player : sessionMeta.white_player}
                isUser={true}
              />
            )}

            {/* Eval + move info + classification — always reserve space to prevent layout shift */}
            <div className="mt-1 h-14 flex flex-col items-center justify-center gap-0.5">
              {/* Eval row */}
              <div className={`flex items-center gap-1.5 text-xs font-mono transition-opacity ${showEngineArrows && currentMove ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}>
                <span className="text-slate-500">Eval:</span>
                {currentMove && (
                  <>
                    <span className={toWhitePov(currentReveal?.engine_eval_before ?? currentMove.eval_before, currentMove.color) >= 0 ? 'text-green-400' : 'text-red-400'}>
                      {fmtEval(toWhitePov(currentReveal?.engine_eval_before ?? currentMove.eval_before, currentMove.color))}
                    </span>
                    <span className="text-slate-600">→</span>
                    <span className={toWhitePov(currentReveal?.engine_eval_after ?? currentMove.eval_after, currentMove.color) >= 0 ? 'text-green-400' : 'text-red-400'}>
                      {fmtEval(toWhitePov(currentReveal?.engine_eval_after ?? currentMove.eval_after, currentMove.color))}
                    </span>
                  </>
                )}
              </div>
              {/* Move info */}
              {currentMove && (
                <div className="text-center text-xs text-slate-400">
                  Move {currentMove.move_number} ·{' '}
                  <span className={`font-mono font-semibold ${isUserMove ? 'text-chess-gold' : 'text-slate-300'}`}>
                    {currentMove.move_san}
                  </span>
                  {' '}· <span className="capitalize">{currentMove.color}</span>
                </div>
              )}
              {/* Classification badge — invisible when no reveal */}
              <div className={`transition-opacity ${currentReveal ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}>
                {currentReveal && (
                  <span className={`text-xs font-medium px-2 py-0.5 rounded border ${classificationBg(currentReveal.classification)} ${classificationClass(currentReveal.classification)}`}>
                    {currentReveal.classification}
                    {currentReveal.centipawn_loss > 0 && ` · ${Math.round(currentReveal.centipawn_loss)} cp`}
                  </span>
                )}
              </div>
            </div>

            {/* Navigation controls */}
            <div className="flex items-center justify-center gap-2 mt-3">
              <NavBtn onClick={() => onNavigate(0)} disabled={navIdx === 0} title="First move">
                <ChevronsLeft size={15} />
              </NavBtn>
              <NavBtn onClick={goPrev} disabled={!canGoPrev} title="Previous (←)">
                <ChevronLeft size={15} />
              </NavBtn>

              <span className="text-xs text-slate-500 w-20 text-center">
                {navIdx + 1} / {allGameMoves.length}
              </span>

              <NavBtn onClick={goNext} disabled={!canGoNext} title="Next (→)">
                <ChevronRight size={15} />
              </NavBtn>
              <NavBtn onClick={() => onNavigate(allGameMoves.length - 1)} disabled={navIdx === allGameMoves.length - 1} title="Last move">
                <ChevronsRight size={15} />
              </NavBtn>
            </div>

            {/* Move list */}
            <MoveList
              allGameMoves={allGameMoves}
              navIdx={navIdx}
              annotatedMoves={annotatedMoves}
              onSelect={onNavigate}
            />
          </div>

          {/* ── Right: Annotation / Reveal / Opponent panel ── */}
          <div className="flex flex-col gap-4 min-w-0 min-h-[120px]">
            {/* Opponent move panel */}
            {currentMove && !isUserMove && (
              <div className="bg-chess-panel rounded-xl p-4 text-center">
                <p className="text-slate-400 text-sm">
                  <span className="capitalize font-medium text-slate-300">{currentMove.color}</span>
                  {' '}played{' '}
                  <span className="font-mono font-semibold text-white">{currentMove.move_san}</span>
                </p>
                <p className="text-xs text-slate-600 mt-1">Use the arrows to navigate</p>
              </div>
            )}

            {/* User move: annotation form */}
            {isUserMove && !currentReveal && (
              <div className="bg-chess-panel rounded-xl p-4 flex flex-col gap-3">
                <h3 className="text-chess-gold font-semibold flex items-center gap-2">
                  <PenLine size={16} /> Your Analysis
                </h3>

                {/* Signal Scan checklist — force pre-move tactical scan */}
                <FoldableSection title="⚡ Signal Scan — check before you write" defaultOpen={true}>
                  <p className="text-xs text-slate-500">Tick what you actually found before writing your reasoning:</p>
                  {SIGNAL_CHECKS.map(({ key, label, desc }) => (
                    <label key={key} className="flex items-start gap-2 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={signalFlags[key] ?? false}
                        onChange={e => setSignalFlags(prev => ({ ...prev, [key]: e.target.checked }))}
                        className="accent-chess-gold w-4 h-4 mt-0.5 shrink-0"
                      />
                      <span className="text-sm leading-snug">
                        <span className="text-chess-gold font-semibold">{label}</span>
                        <span className="text-slate-400"> — {desc}</span>
                      </span>
                    </label>
                  ))}
                </FoldableSection>

                <div>
                  <label className="text-xs text-slate-400 block mb-1">
                    What were you thinking? Why this move?
                  </label>
                  <RichTextEditor
                    key={`editor-${currentMove?.move_index}`}
                    defaultValue={annotation}
                    onChange={setAnnotation}
                    placeholder="Describe your reasoning…"
                  />
                </div>

                <div>
                  <label className="text-xs text-slate-400 block mb-1">
                    Alternative moves you considered
                  </label>
                  <div className="flex gap-2">
                    {candidates.map((c, i) => (
                      <input
                        key={i}
                        value={c}
                        onChange={e => {
                          const next = [...candidates]
                          next[i] = e.target.value
                          setCandidates(next)
                        }}
                        placeholder={`Alt ${i + 1}`}
                        className="flex-1 min-w-0 bg-chess-dark border border-slate-700 rounded-lg px-2 py-1.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-chess-gold font-mono"
                      />
                    ))}
                  </div>
                </div>

                <div>
                  <label className="text-xs text-slate-400 block mb-1">
                    Position evaluation BEFORE this move
                  </label>
                  <div className="flex flex-wrap gap-1.5">
                    {EVAL_OPTIONS.map(opt => (
                      <button
                        key={opt.value}
                        onClick={() => setEvalLabel(evalLabel === opt.value ? '' : opt.value)}
                        className={`text-xs px-3 py-1 rounded-full border transition-colors ${
                          evalLabel === opt.value
                            ? 'bg-chess-gold text-chess-dark border-chess-gold font-semibold'
                            : 'border-slate-600 text-slate-400 hover:border-chess-gold hover:text-white'
                        }`}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="text-xs text-slate-400 flex items-center gap-1.5 mb-1">
                    Confidence:{' '}
                    {confidence === 0 ? 'not set'
                      : confidence === 1 ? '1 – guessing'
                      : confidence === 5 ? '5 – certain'
                      : confidence}
                    <span className="relative group">
                      <Info size={12} className="text-slate-500 cursor-help hover:text-slate-300 transition-colors" />
                      <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-64 bg-slate-700 border border-slate-600 rounded-lg px-3 py-2.5 text-xs text-slate-200 shadow-xl z-50 hidden group-hover:block leading-relaxed pointer-events-none">
                        <p className="font-semibold text-white mb-1">How confident were you in this position?</p>
                        <p className="mb-1.5">Rate how sure you felt about your move <em>before</em> seeing the engine — not whether it was right or wrong.</p>
                        <ul className="space-y-0.5 text-slate-300">
                          <li><span className="text-chess-gold font-medium">1</span> – Pure guess, no real idea</li>
                          <li><span className="text-chess-gold font-medium">2–3</span> – Had a reason but uncertain</li>
                          <li><span className="text-chess-gold font-medium">4</span> – Felt pretty sure</li>
                          <li><span className="text-chess-gold font-medium">5</span> – Completely certain</li>
                        </ul>
                        <p className="mt-1.5 text-slate-400">This helps detect overconfidence — blundering on moves you were sure about is the most dangerous pattern.</p>
                      </div>
                    </span>
                  </label>
                  <input
                    type="range" min={0} max={5} value={confidence}
                    onChange={e => setConfidence(Number(e.target.value))}
                    className="w-full accent-chess-gold"
                  />
                  <div className="flex justify-between text-xs text-slate-600 mt-0.5">
                    <span>Not set</span><span>Guessing</span><span>Certain</span>
                  </div>
                </div>

                <label className="flex items-center gap-2 text-sm text-slate-300 cursor-pointer select-none">
                  <input
                    type="checkbox" checked={markedCritical}
                    onChange={e => setMarkedCritical(e.target.checked)}
                    className="accent-chess-gold w-4 h-4"
                  />
                  Mark as Critical (deeper analysis — 4 top lines)
                </label>

                <div className="flex gap-2 pt-1">
                  <button
                    onClick={goNext}
                    disabled={!canGoNext}
                    className="flex-1 border border-slate-600 text-slate-400 hover:text-white hover:border-slate-400 py-2 rounded-lg text-sm transition-colors disabled:opacity-40"
                  >
                    Skip →
                  </button>
                  <button
                    onClick={handleSubmit}
                    disabled={submitting}
                    className="flex-1 bg-chess-gold text-chess-dark font-semibold py-2 rounded-lg hover:opacity-90 disabled:opacity-50 text-sm"
                  >
                    {submitting ? 'Analysing…' : 'Submit & Reveal'}
                  </button>
                </div>
              </div>
            )}

            {/* User move: reveal panel */}
            {isUserMove && currentReveal && (
              <div className="bg-chess-panel rounded-xl p-4 flex flex-col gap-3">
                <div className="flex items-center gap-2">
                  <Eye size={16} className="text-chess-gold" />
                  <span className="font-semibold text-chess-gold">Engine Reveal</span>
                </div>

                {/* User's own annotation — persisted so it survives navigation */}
                {(currentReveal.user_annotation || currentReveal.user_candidates?.length > 0 ||
                  Object.values(currentReveal.signal_flags || {}).some(Boolean) ||
                  currentReveal.mistake_reason) && (
                  <div className="bg-chess-dark rounded-lg p-3 flex flex-col gap-2 border border-slate-700">
                    {/* Signal scan summary */}
                    {Object.values(currentReveal.signal_flags || {}).some(Boolean) && (
                      <div>
                        <div className="text-xs text-slate-500 mb-1">Signals found</div>
                        <div className="flex flex-wrap gap-1">
                          {SIGNAL_CHECKS.filter(s => currentReveal.signal_flags?.[s.key]).map(s => (
                            <span key={s.key} className="text-xs px-2 py-0.5 rounded-full bg-chess-gold/20 text-chess-gold border border-chess-gold/40">
                              {s.label}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                    {currentReveal.user_annotation && (
                      <div>
                        <div className="text-xs text-slate-500 mb-1">Your thinking</div>
                        <div
                          className="text-sm text-slate-300 leading-relaxed prose-chess"
                          dangerouslySetInnerHTML={{ __html: currentReveal.user_annotation }}
                        />
                      </div>
                    )}
                    {currentReveal.user_candidates?.length > 0 && (
                      <div>
                        <div className="text-xs text-slate-500 mb-1">Your candidates</div>
                        <div className="flex gap-1.5 flex-wrap">
                          {currentReveal.user_candidates.map((c, i) => {
                            const isEngineBest = c === currentReveal.engine_best_move
                            const isTopPv = !isEngineBest && currentReveal.engine_multipv?.slice(1, 3)?.some(l => l.move_san === c)
                            return (
                              <span key={i} className={`text-xs font-mono px-2 py-0.5 rounded border ${
                                isEngineBest ? 'bg-green-900/40 border-green-700 text-green-300'
                                : isTopPv    ? 'bg-blue-900/40 border-blue-700 text-blue-300'
                                :              'border-slate-600 text-slate-300 bg-chess-panel'
                              }`}>
                                {c}{isEngineBest && ' ✓'}
                              </span>
                            )
                          })}
                        </div>
                      </div>
                    )}
                    {/* Root cause badge */}
                    {currentReveal.mistake_reason && (
                      <div>
                        <div className="text-xs text-slate-500 mb-1">Root cause</div>
                        <span className="text-xs px-2.5 py-1 rounded-full bg-orange-900/40 text-orange-300 border border-orange-700">
                          {MISTAKE_REASONS.find(r => r.value === currentReveal.mistake_reason)?.label ?? currentReveal.mistake_reason}
                        </span>
                      </div>
                    )}
                  </div>
                )}

                {currentReveal.eval_verdict && (
                  <div className="text-sm">
                    <span className="text-slate-400">Your assessment: </span>
                    <span className={
                      currentReveal.eval_verdict === 'correct' ? 'text-green-400'
                      : currentReveal.eval_verdict === 'slightly off' ? 'text-yellow-400'
                      : 'text-red-400'
                    }>
                      {currentReveal.eval_verdict}
                    </span>
                  </div>
                )}

                <div className="grid grid-cols-2 gap-2 text-sm">
                  <InfoBox
                    label="Engine best move"
                    value={currentReveal.engine_best_move}
                    valueClass="text-green-400 font-mono font-bold text-base"
                  />
                  <InfoBox
                    label="Centipawn loss"
                    value={`${Math.round(currentReveal.centipawn_loss)} cp`}
                    valueClass={classificationClass(currentReveal.classification)}
                  />
                </div>

                {/* Eval before → after in pawn units */}
                {currentReveal.engine_eval_before != null && currentReveal.engine_eval_after != null && (
                  <div className="flex items-center gap-1.5 text-xs font-mono text-slate-500">
                    <span>Eval:</span>
                    <span className={toWhitePov(currentReveal.engine_eval_before, currentMove.color) >= 0 ? 'text-green-400' : 'text-red-400'}>
                      {fmtEval(toWhitePov(currentReveal.engine_eval_before, currentMove.color))}
                    </span>
                    <span className="text-slate-600">→</span>
                    <span className={toWhitePov(currentReveal.engine_eval_after, currentMove.color) >= 0 ? 'text-green-400' : 'text-red-400'}>
                      {fmtEval(toWhitePov(currentReveal.engine_eval_after, currentMove.color))}
                    </span>
                  </div>
                )}

                {currentReveal.engine_multipv?.length > 0 && (
                  <div className="flex flex-col gap-1">
                    {currentReveal.engine_multipv.map((line, i) => (
                      <div key={i} className="bg-chess-dark rounded-lg px-3 py-1.5 text-xs font-mono text-slate-300 flex gap-2 items-baseline">
                        <span className="text-slate-500 w-3">{line.rank}.</span>
                        <span className="text-chess-gold font-bold w-10">{line.move_san}</span>
                        <span className="text-slate-500 w-10">{fmtEval(toWhitePov(line.score_cp, currentMove.color))}</span>
                        <span className="text-slate-400 truncate">{line.pv_san?.join(' ')}</span>
                      </div>
                    ))}
                  </div>
                )}

                {currentReveal.patterns?.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {currentReveal.patterns.map((p, i) => (
                      <span key={i} className="text-xs bg-chess-accent/40 text-slate-300 px-2 py-0.5 rounded-full">
                        {p.type.replace(/_/g, ' ')}
                      </span>
                    ))}
                  </div>
                )}

                {/* Explanation: show streaming placeholder, then text as it arrives */}
                <div className="border-t border-slate-700 pt-3">
                  {currentReveal.explanation ? (
                    <Md text={currentReveal.explanation} className="text-sm text-slate-300 leading-relaxed" />
                  ) : (
                    <div className="flex items-center gap-2 text-xs text-slate-500">
                      <span className="inline-block w-1.5 h-3.5 bg-slate-500 animate-pulse rounded-sm" />
                      Coach is analysing…
                    </div>
                  )}
                </div>

                {/* Post-reveal root cause — only for mistakes and blunders */}
                {['mistake', 'blunder'].includes(currentReveal.classification) && (
                  <RootCausePicker
                    moveIndex={currentMove.move_index}
                    bestMove={currentReveal.engine_best_move}
                    selected={rootCauses[currentMove.move_index] || currentReveal.root_cause}
                    onSelect={handleRootCause}
                  />
                )}
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
