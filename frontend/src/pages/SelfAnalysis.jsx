import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { Chessboard } from 'react-chessboard'
import {
  ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight,
  PenLine, Eye, Trophy, Clock, Filter, Flag, MessageSquare, Send, CheckCircle, XCircle, AlertCircle, Cpu, Info,
  Bold, Italic, List,
} from 'lucide-react'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell
} from 'recharts'
import {
  startAnnotationSession, submitAnnotation, completeAnnotationSession,
  getLatestSessionForGame, getCoachReview, submitCoachReviewReply,
} from '../api/client'

// ── Helpers ───────────────────────────────────────────────────────────────────

function classificationClass(c) {
  const map = {
    best: 'text-blue-400', good: 'text-green-400',
    inaccuracy: 'text-yellow-400', mistake: 'text-orange-400', blunder: 'text-red-400',
  }
  return map[c] || 'text-slate-300'
}

function classificationBg(c) {
  const map = {
    best: 'bg-blue-900/40 border-blue-700', good: 'bg-green-900/40 border-green-700',
    inaccuracy: 'bg-yellow-900/40 border-yellow-700',
    mistake: 'bg-orange-900/40 border-orange-700', blunder: 'bg-red-900/40 border-red-700',
  }
  return map[c] || 'bg-slate-800 border-slate-600'
}

const EVAL_OPTIONS = [
  { value: 'winning', label: 'Winning' },
  { value: 'better', label: 'Slightly Better' },
  { value: 'equal', label: 'Equal' },
  { value: 'worse', label: 'Slightly Worse' },
  { value: 'losing', label: 'Losing' },
]

const TIME_BUDGETS = [15, 30, 60]

// Convert centipawns to pawn-unit string (+3.2 / -4.0), handles mate scores
function fmtEval(cp) {
  if (cp == null) return '?'
  if (Math.abs(cp) >= 9000) return cp > 0 ? '+M' : '-M'
  const pawns = cp / 100
  return `${pawns > 0 ? '+' : ''}${pawns.toFixed(1)}`
}

// ── Arrow helpers ─────────────────────────────────────────────────────────────

// Engine best-line arrow colors: rank 1 = darkest, rank 4 = lightest
const ENGINE_ARROW_COLORS = [
  'rgba(0, 140, 0, 0.92)',
  'rgba(50, 170, 50, 0.68)',
  'rgba(100, 190, 80, 0.48)',
  'rgba(150, 210, 100, 0.30)',
]

// Square highlight color cycle on right-click: orange → red → green → clear
const HIGHLIGHT_COLORS = [
  'rgba(255, 170, 0, 0.55)',
  'rgba(220, 50, 50, 0.55)',
  'rgba(20, 160, 80, 0.55)',
]

function uciToSquares(uci) {
  if (!uci || uci.length < 4) return null
  return { from: uci.slice(0, 2), to: uci.slice(2, 4) }
}

// ── RichTextEditor ────────────────────────────────────────────────────────────
// Contenteditable div with a Bold / Italic / List toolbar.
// `defaultValue` is HTML; `onChange` fires with the current innerHTML string.
function RichTextEditor({ defaultValue, onChange, placeholder }) {
  const editorRef = useRef(null)

  // Set initial HTML once on mount (defaultValue changes when navigating)
  useEffect(() => {
    if (editorRef.current) {
      editorRef.current.innerHTML = defaultValue || ''
    }
    // intentionally runs only when the editor key changes (parent uses key=)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const exec = (cmd) => {
    document.execCommand(cmd, false, null)
    editorRef.current?.focus()
    onChange?.(editorRef.current?.innerHTML || '')
  }

  const handleInput = () => {
    onChange?.(editorRef.current?.innerHTML || '')
  }

  return (
    <div className="flex flex-col gap-1">
      {/* Toolbar */}
      <div className="flex gap-1">
        {[
          { icon: <Bold size={12} />, cmd: 'bold', title: 'Bold (Ctrl+B)' },
          { icon: <Italic size={12} />, cmd: 'italic', title: 'Italic (Ctrl+I)' },
          { icon: <List size={12} />, cmd: 'insertUnorderedList', title: 'Bullet list' },
        ].map(({ icon, cmd, title }) => (
          <button
            key={cmd}
            type="button"
            title={title}
            onMouseDown={e => { e.preventDefault(); exec(cmd) }}
            className="p-1.5 rounded border border-slate-700 text-slate-400 hover:text-white hover:border-slate-500 transition-colors"
          >
            {icon}
          </button>
        ))}
      </div>
      {/* Editor */}
      <div
        ref={editorRef}
        contentEditable
        suppressContentEditableWarning
        onInput={handleInput}
        data-placeholder={placeholder}
        className="w-full min-h-[72px] bg-chess-dark border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-chess-gold prose-chess empty:before:content-[attr(data-placeholder)] empty:before:text-slate-500"
        style={{ lineHeight: '1.5' }}
      />
    </div>
  )
}

// ── BoardLegend ───────────────────────────────────────────────────────────────
// Small info icon that shows a hover tooltip explaining board drawing controls.
function BoardLegend() {
  const [open, setOpen] = useState(false)
  return (
    <div className="relative inline-flex">
      <button
        type="button"
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        className="text-slate-500 hover:text-slate-300 transition-colors"
        aria-label="Board controls help"
      >
        <Info size={13} />
      </button>
      {open && (
        <div className="absolute top-full right-0 mt-2 w-56 z-50 bg-slate-800 border border-slate-600 rounded-lg p-3 text-xs text-slate-300 shadow-xl pointer-events-none">
          {/* Arrow pointing up */}
          <div className="absolute bottom-full right-2 border-4 border-transparent border-b-slate-600" />
          <div className="font-semibold text-white mb-2">Board controls</div>
          <ul className="flex flex-col gap-1.5">
            <li><span className="text-chess-gold font-mono">Right-drag</span> — draw an arrow</li>
            <li><span className="text-chess-gold font-mono">Right-click square</span> — cycle highlight color</li>
            <li><span className="text-chess-gold font-mono">Left-click</span> — clear drawn arrows</li>
            <li><span className="text-chess-gold font-mono">Arrows + highlights</span> are saved when you submit</li>
          </ul>
        </div>
      )}
    </div>
  )
}

// revealData = annotatedMoves entry (has multipv); moveData = allGameMoves entry (has best_move_uci)
function buildEngineArrows(revealData, moveData) {
  // Prefer multipv from reveal (richer, fresher analysis)
  if (revealData?.engine_multipv?.length > 0) {
    return revealData.engine_multipv
      .map((line, i) => {
        const sq = uciToSquares(line.move_uci)
        if (!sq) return null
        return {
          startSquare: sq.from,
          endSquare: sq.to,
          color: ENGINE_ARROW_COLORS[i] ?? ENGINE_ARROW_COLORS.at(-1),
        }
      })
      .filter(Boolean)
  }
  // Fall back to single best move (from reveal or batch analysis)
  const uci = revealData?.engine_best_move_uci || moveData?.best_move_uci
  const sq = uciToSquares(uci)
  if (!sq) return []
  return [{ startSquare: sq.from, endSquare: sq.to, color: ENGINE_ARROW_COLORS[0] }]
}

// ── Main component ────────────────────────────────────────────────────────────

export default function SelfAnalysis({ userId }) {
  const { gameId } = useParams()
  const navigate = useNavigate()

  // Phase: 'loading' | 'setup' | 'annotating' | 'complete' | 'coach_review'
  const [phase, setPhase] = useState('loading')
  const [timeBudget, setTimeBudget] = useState(30)
  const [customBudget, setCustomBudget] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  // Session data
  const [sessionId, setSessionId] = useState(null)
  const [sessionMeta, setSessionMeta] = useState(null)
  const [allGameMoves, setAllGameMoves] = useState([])   // ALL moves, both colors
  const [suggestedMin, setSuggestedMin] = useState(null)

  // Navigation: index into allGameMoves
  const [navIdx, setNavIdx] = useState(0)

  // Annotated moves: { [move_index]: revealData }
  const [annotatedMoves, setAnnotatedMoves] = useState({})

  // Critical-only filter
  const [criticalOnly, setCriticalOnly] = useState(false)

  // Per-move annotation form state
  const [annotation, setAnnotation] = useState('')
  const [candidates, setCandidates] = useState(['', '', ''])
  const [evalLabel, setEvalLabel] = useState('')
  const [confidence, setConfidence] = useState(0)
  const [markedCritical, setMarkedCritical] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  // Draft persistence: saves in-progress form per move_index so navigation doesn't wipe it
  const [draftAnnotations, setDraftAnnotations] = useState({})
  // Ref always holds current form values — lets goTo read them without being a dependency
  const formRef = useRef({ annotation: '', candidates: ['', '', ''], evalLabel: '', confidence: 0, markedCritical: false })
  useEffect(() => {
    formRef.current = { annotation, candidates, evalLabel, confidence, markedCritical }
  }, [annotation, candidates, evalLabel, confidence, markedCritical])

  // Arrow overlays & square highlights (shared across annotating + coach_review)
  const [showEngineArrows, setShowEngineArrows] = useState(false)
  const [squareHighlights, setSquareHighlights] = useState({})  // { moveIndex: { square: cssColor } }
  const [userArrows, setUserArrows] = useState({})              // { moveIndex: Arrow[] }

  // Reflection
  const [reflection, setReflection] = useState(null)
  const [gameResult, setGameResult] = useState(null)  // "win" | "loss" | "draw" | null
  const [feelings, setFeelings] = useState({
    feelings: [],
    result_reason: '',
    key_moment: '',
    takeaway: '',
    would_do_differently: '',
    plan_adherence: '',
    time_pressure: '',
    opening_prep: '',
    extra_note: '',
  })

  // Coach review
  const [userColor, setUserColor] = useState(null)
  const [reviewItems, setReviewItems] = useState([])
  const [reviewIdx, setReviewIdx] = useState(0)
  const [reviewResponses, setReviewResponses] = useState({})  // move_index → {response, reply}
  const [reviewLoading, setReviewLoading] = useState(false)

  // Derived state
  const currentMove = allGameMoves[navIdx] || null
  const isUserMove = currentMove?.is_user_move ?? false
  const currentReveal = currentMove ? annotatedMoves[currentMove.move_index] : null

  // Indices of all critical user moves in allGameMoves order
  const criticalIndices = allGameMoves.reduce((acc, m, i) => {
    if (m.is_user_move && m.priority === 'high') acc.push(i)
    return acc
  }, [])

  const annotatedCount = Object.keys(annotatedMoves).length
  const userMoveCount = allGameMoves.filter(m => m.is_user_move).length

  // ── Navigation ────────────────────────────────────────────────────────────

  const goTo = useCallback((idx) => {
    if (idx < 0 || idx >= allGameMoves.length) return

    // Save current form to draft before leaving (uses ref — no dependency on form state)
    const currentMoveIndex = allGameMoves[navIdx]?.move_index
    if (currentMoveIndex !== undefined) {
      setDraftAnnotations(prev => ({ ...prev, [currentMoveIndex]: { ...formRef.current } }))
    }

    setNavIdx(idx)
  }, [allGameMoves, navIdx])

  // Restore draft (or blank form) whenever navIdx changes
  useEffect(() => {
    const moveIndex = allGameMoves[navIdx]?.move_index
    if (moveIndex === undefined) return
    const draft = draftAnnotations[moveIndex]
    if (draft) {
      setAnnotation(draft.annotation)
      setCandidates(draft.candidates)
      setEvalLabel(draft.evalLabel)
      setConfidence(draft.confidence)
      setMarkedCritical(draft.markedCritical)
    } else {
      setAnnotation('')
      setCandidates(['', '', ''])
      setEvalLabel('')
      setConfidence(0)
      setMarkedCritical(false)
    }
  // draftAnnotations intentionally excluded — we only want to run on navigation
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navIdx, allGameMoves])

  const goPrev = useCallback(() => {
    if (criticalOnly) {
      const prev = [...criticalIndices].reverse().find(i => i < navIdx)
      if (prev !== undefined) goTo(prev)
    } else {
      goTo(navIdx - 1)
    }
  }, [criticalOnly, criticalIndices, navIdx, goTo])

  const goNext = useCallback(() => {
    if (criticalOnly) {
      const next = criticalIndices.find(i => i > navIdx)
      if (next !== undefined) goTo(next)
    } else {
      goTo(navIdx + 1)
    }
  }, [criticalOnly, criticalIndices, navIdx, goTo])

  // Keyboard nav
  useEffect(() => {
    const handler = (e) => {
      if (e.target.tagName === 'TEXTAREA' || e.target.tagName === 'INPUT') return
      if (e.target.contentEditable === 'true') return
      if (e.key === 'ArrowLeft') goPrev()
      if (e.key === 'ArrowRight') goNext()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [goPrev, goNext])

  // ── On mount: check for existing session ─────────────────────────────────

  useEffect(() => {
    const checkExisting = async () => {
      try {
        const res = await getLatestSessionForGame(Number(gameId))
        const data = res.data

        if (data.completed) {
          setReflection({ ...data.reflection, game_feelings: data.game_feelings, questionnaire_coaching: data.questionnaire_coaching })
          setSessionId(data.session_id)
          setUserColor(data.user_color)
          setGameResult(data.game_result || null)
          // Load game data so the user can review their annotations
          loadSessionData(data)
          const preAnnotated = {}
          const restoredHighlights = {}
          const restoredArrows = {}
          for (const m of data.moves_data || []) {
            preAnnotated[m.move_index] = {
              engine_eval_before: m.engine_eval_before,
              engine_eval_after: m.engine_eval_after,
              centipawn_loss: m.centipawn_loss,
              classification: m.classification,
              engine_best_move: m.engine_best_move,
              engine_best_move_uci: m.engine_best_move_uci,
              engine_pv_san: m.engine_pv_san,
              engine_multipv: m.engine_multipv,
              patterns: m.patterns,
              explanation: m.explanation,
              eval_verdict: null,
              user_annotation: m.user_annotation || '',
              user_candidates: m.user_candidates || [],
              user_eval_label: m.user_eval_label || '',
            }
            if (m.user_squares && Object.keys(m.user_squares).length > 0)
              restoredHighlights[m.move_index] = m.user_squares
            if (m.user_arrows?.length > 0)
              restoredArrows[m.move_index] = m.user_arrows
          }
          setAnnotatedMoves(preAnnotated)
          setSquareHighlights(restoredHighlights)
          setUserArrows(restoredArrows)
          setNavIdx(0)
          setPhase('complete')
          return
        }

        // Incomplete session — resume it
        loadSessionData(data)

        // Pre-populate annotated moves from stored moves_data
        const preAnnotated = {}
        const restoredHighlights = {}
        const restoredArrows = {}
        for (const m of data.moves_data || []) {
          preAnnotated[m.move_index] = {
            engine_eval_before: m.engine_eval_before,
            engine_eval_after: m.engine_eval_after,
            centipawn_loss: m.centipawn_loss,
            classification: m.classification,
            engine_best_move: m.engine_best_move,
            engine_best_move_uci: m.engine_best_move_uci,
            engine_pv_san: m.engine_pv_san,
            engine_multipv: m.engine_multipv,
            patterns: m.patterns,
            explanation: m.explanation,
            eval_verdict: null,
            user_annotation: m.user_annotation || '',
            user_candidates: m.user_candidates || [],
            user_eval_label: m.user_eval_label || '',
          }
          if (m.user_squares && Object.keys(m.user_squares).length > 0)
            restoredHighlights[m.move_index] = m.user_squares
          if (m.user_arrows?.length > 0)
            restoredArrows[m.move_index] = m.user_arrows
        }
        setAnnotatedMoves(preAnnotated)
        setSquareHighlights(restoredHighlights)
        setUserArrows(restoredArrows)

        // Navigate to first unannotated user move
        const annotatedSet = new Set(data.annotated_move_indices || [])
        const firstUnannotated = data.all_game_moves.findIndex(
          m => m.is_user_move && !annotatedSet.has(m.move_index)
        )
        setNavIdx(firstUnannotated >= 0 ? firstUnannotated : 0)
        resetFormOnly()
        setPhase('annotating')
      } catch (e) {
        if (e.response?.status === 404) {
          setPhase('setup')
        } else {
          setError(e.response?.data?.detail || e.message)
          setPhase('setup')
        }
      }
    }
    checkExisting()
  }, [gameId])

  const loadSessionData = (data) => {
    setSessionId(data.session_id)
    setUserColor(data.user_color)
    setGameResult(data.game_result || null)
    setSessionMeta({
      white_player: data.white_player,
      black_player: data.black_player,
      user_color: data.user_color,
      time_budget_minutes: data.time_budget_minutes,
    })
    setAllGameMoves(data.all_game_moves)
    setSuggestedMin(data.suggested_minutes_per_move)
  }

  // ── Setup ─────────────────────────────────────────────────────────────────

  const handleStart = async () => {
    const budget = customBudget ? Number(customBudget) : timeBudget
    if (!budget || budget < 1) return
    setLoading(true)
    setError(null)
    try {
      const res = await startAnnotationSession(userId, Number(gameId), budget)
      loadSessionData(res.data)
      setGameResult(res.data.game_result || null)
      setAnnotatedMoves({})
      setNavIdx(0)
      resetFormOnly()
      setPhase('annotating')
    } catch (e) {
      setError(e.response?.data?.detail || e.message)
    } finally {
      setLoading(false)
    }
  }

  // ── Annotation ────────────────────────────────────────────────────────────

  const resetFormOnly = () => {
    setAnnotation('')
    setCandidates(['', '', ''])
    setEvalLabel('')
    setConfidence(0)
    setMarkedCritical(false)
    setDraftAnnotations({})
  }

  const handleSubmit = async () => {
    if (!currentMove || !isUserMove) return
    setSubmitting(true)
    setError(null)
    try {
      const moveIndex = currentMove.move_index
      const currentSquares = squareHighlights[moveIndex] || {}
      const currentUserArrows = userArrows[moveIndex] || []
      const payload = {
        move_index: moveIndex,
        user_annotation: annotation,
        user_candidates: candidates.filter(c => c.trim()),
        user_eval_label: evalLabel,
        user_confidence: confidence,
        user_marked_critical: markedCritical,
        user_squares: currentSquares,
        user_arrows: currentUserArrows,
      }
      const res = await submitAnnotation(sessionId, payload)
      // Store engine data AND user's own annotation/visual data so the reveal panel can display them
      setAnnotatedMoves(prev => ({
        ...prev,
        [moveIndex]: {
          ...res.data,
          user_annotation: annotation,
          user_candidates: candidates.filter(c => c.trim()),
          user_eval_label: evalLabel,
          user_squares: currentSquares,
          user_arrows: currentUserArrows,
        },
      }))
      // Drop the draft for this move — it's now revealed and immutable
      setDraftAnnotations(prev => {
        const next = { ...prev }
        delete next[currentMove.move_index]
        return next
      })
    } catch (e) {
      setError(e.response?.data?.detail || e.message)
    } finally {
      setSubmitting(false)
    }
  }

  // Go to questionnaire phase before completing
  const handleRequestComplete = () => {
    setFeelings({
      feelings: [],
      result_reason: '',
      key_moment: '',
      takeaway: '',
      would_do_differently: '',
      plan_adherence: '',
      time_pressure: '',
      opening_prep: '',
      extra_note: '',
    })
    setPhase('questionnaire')
  }

  const handleComplete = async (feelingsData) => {
    setLoading(true)
    try {
      const res = await completeAnnotationSession(sessionId, feelingsData)
      // Merge questionnaire_coaching into reflection so CompletePhase can access it
      setReflection(res.data)
      setPhase('complete')
    } catch (e) {
      setError(e.response?.data?.detail || e.message)
    } finally {
      setLoading(false)
    }
  }

  const handleStartNew = () => {
    setSessionId(null)
    setSessionMeta(null)
    setAllGameMoves([])
    setAnnotatedMoves({})
    setReflection(null)
    setGameResult(null)
    setFeelings({
      feelings: [],
      result_reason: '',
      key_moment: '',
      takeaway: '',
      would_do_differently: '',
      plan_adherence: '',
      time_pressure: '',
      opening_prep: '',
      extra_note: '',
    })
    setCriticalOnly(false)
    setSquareHighlights({})
    setUserArrows({})
    resetFormOnly()
    setPhase('setup')
  }

  const handleSquareRightClick = useCallback(({ square }) => {
    const moveIndex = allGameMoves[navIdx]?.move_index
    if (moveIndex === undefined) return
    setSquareHighlights(prev => {
      const curr = (prev[moveIndex] || {})[square]
      const nextIdx = HIGHLIGHT_COLORS.indexOf(curr) + 1
      const nextColor = HIGHLIGHT_COLORS[nextIdx]  // undefined → clear
      const updated = { ...(prev[moveIndex] || {}) }
      if (nextColor) updated[square] = nextColor
      else delete updated[square]
      return { ...prev, [moveIndex]: updated }
    })
  }, [allGameMoves, navIdx])

  const handleArrowsChange = useCallback((newArrows) => {
    // onArrowsChange fires with [] on mount — ignore that to avoid wiping restored arrows
    if (!newArrows || newArrows.length === 0) return
    const moveIndex = allGameMoves[navIdx]?.move_index
    if (moveIndex === undefined) return
    setUserArrows(prev => ({ ...prev, [moveIndex]: newArrows }))
  }, [allGameMoves, navIdx])

  const handleCoachReview = async () => {
    if (!sessionId) return
    setReviewLoading(true)
    setError(null)
    try {
      const res = await getCoachReview(sessionId)
      setReviewItems(res.data.review_items || [])
      setReviewIdx(0)
      setReviewResponses({})
      setPhase('coach_review')
    } catch (e) {
      setError(e.response?.data?.detail || e.message)
    } finally {
      setReviewLoading(false)
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────

  if (phase === 'loading') {
    return (
      <div className="min-h-screen bg-chess-dark flex items-center justify-center">
        <div className="text-chess-gold text-lg animate-pulse">Loading…</div>
      </div>
    )
  }

  if (phase === 'setup') {
    return (
      <SetupPhase
        timeBudget={timeBudget} setTimeBudget={setTimeBudget}
        customBudget={customBudget} setCustomBudget={setCustomBudget}
        onStart={handleStart} loading={loading} error={error}
        onBack={() => navigate('/')}
      />
    )
  }

  if (phase === 'questionnaire') {
    return (
      <QuestionnairePhase
        feelings={feelings}
        setFeelings={setFeelings}
        gameResult={gameResult}
        onComplete={handleComplete}
        loading={loading}
        error={error}
      />
    )
  }

  if (phase === 'complete') {
    return (
      <CompletePhase
        reflection={reflection}
        gameResult={gameResult}
        onDashboard={() => navigate('/')}
        onNewSession={handleStartNew}
        onCoachReview={handleCoachReview}
        onReviewAnnotations={() => setPhase('annotating')}
        reviewLoading={reviewLoading}
        error={error}
      />
    )
  }

  if (phase === 'coach_review') {
    return (
      <CoachReviewPhase
        sessionId={sessionId}
        userColor={userColor}
        items={reviewItems}
        reviewIdx={reviewIdx}
        setReviewIdx={setReviewIdx}
        reviewResponses={reviewResponses}
        setReviewResponses={setReviewResponses}
        showEngineArrows={showEngineArrows}
        setShowEngineArrows={setShowEngineArrows}
        squareHighlights={squareHighlights}
        setSquareHighlights={setSquareHighlights}
        userArrows={userArrows}
        onBack={() => setPhase('complete')}
        onDashboard={() => navigate('/')}
      />
    )
  }

  const canGoPrev = criticalOnly
    ? criticalIndices.some(i => i < navIdx)
    : navIdx > 0
  const canGoNext = criticalOnly
    ? criticalIndices.some(i => i > navIdx)
    : navIdx < allGameMoves.length - 1

  // ── Annotating phase ──────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-chess-dark p-4">
      <div className="max-w-5xl mx-auto">

        {/* Top bar */}
        <div className="flex items-center justify-between mb-4 gap-2 flex-wrap">
          <button
            onClick={() => navigate('/')}
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

            {/* Finish session */}
            <button
              onClick={handleRequestComplete}
              disabled={loading}
              className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full border border-chess-gold/50 text-chess-gold hover:bg-chess-gold/10 transition-colors disabled:opacity-50"
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

            <div className="rounded-xl overflow-hidden my-1">
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

            {sessionMeta && (
              <PlayerLabel
                name={sessionMeta.user_color === 'black' ? sessionMeta.black_player : sessionMeta.white_player}
                isUser={true}
              />
            )}

            {/* Eval display — shown for every move when Best Lines is active */}
            {showEngineArrows && currentMove && (
              <div className="mt-1 flex items-center justify-center gap-1.5 text-xs font-mono">
                <span className="text-slate-500">Eval:</span>
                <span className={(currentReveal?.engine_eval_before ?? currentMove.eval_before) >= 0 ? 'text-green-400' : 'text-red-400'}>
                  {fmtEval(currentReveal?.engine_eval_before ?? currentMove.eval_before)}
                </span>
                <span className="text-slate-600">→</span>
                <span className={(currentReveal?.engine_eval_after ?? currentMove.eval_after) >= 0 ? 'text-green-400' : 'text-red-400'}>
                  {fmtEval(currentReveal?.engine_eval_after ?? currentMove.eval_after)}
                </span>
              </div>
            )}

            {/* Move info */}
            {currentMove && (
              <div className="mt-1.5 text-center text-xs text-slate-400">
                Move {currentMove.move_number} ·{' '}
                <span className={`font-mono font-semibold ${
                  isUserMove ? 'text-chess-gold' : 'text-slate-300'
                }`}>
                  {currentMove.move_san}
                </span>
                {' '}·{' '}
                <span className="capitalize">{currentMove.color}</span>
              </div>
            )}

            {/* Classification badge — only after reveal */}
            {currentReveal && (
              <div className="mt-1 text-center">
                <span className={`text-xs font-medium px-2 py-0.5 rounded border ${classificationBg(currentReveal.classification)} ${classificationClass(currentReveal.classification)}`}>
                  {currentReveal.classification}
                  {currentReveal.centipawn_loss > 0 && ` · ${Math.round(currentReveal.centipawn_loss)} cp`}
                </span>
              </div>
            )}

            {/* Navigation controls */}
            <div className="flex items-center justify-center gap-2 mt-3">
              <NavBtn onClick={() => goTo(0)} disabled={navIdx === 0} title="First move">
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
              <NavBtn onClick={() => goTo(allGameMoves.length - 1)} disabled={navIdx === allGameMoves.length - 1} title="Last move">
                <ChevronsRight size={15} />
              </NavBtn>
            </div>

            {/* Move list */}
            <MoveList
              allGameMoves={allGameMoves}
              navIdx={navIdx}
              annotatedMoves={annotatedMoves}
              onSelect={goTo}
            />
          </div>

          {/* ── Right: Annotation / Reveal / Opponent panel ── */}
          <div className="flex flex-col gap-4 min-w-0">
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

                <div>
                  <label className="text-xs text-slate-400 block mb-1">
                    What were you thinking? Why this move?
                  </label>
                  <RichTextEditor
                    key={`editor-${currentMove?.move_index}`}
                    defaultValue={draftAnnotations[currentMove?.move_index]?.annotation ?? annotation}
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
                  <label className="text-xs text-slate-400 block mb-1">
                    Confidence:{' '}
                    {confidence === 0 ? 'not set'
                      : confidence === 1 ? '1 – guessing'
                      : confidence === 5 ? '5 – certain'
                      : confidence}
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
                {(currentReveal.user_annotation || currentReveal.user_candidates?.length > 0) && (
                  <div className="bg-chess-dark rounded-lg p-3 flex flex-col gap-2 border border-slate-700">
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
                          {currentReveal.user_candidates.map((c, i) => (
                            <span key={i} className="text-xs font-mono px-2 py-0.5 rounded border border-slate-600 text-slate-300 bg-chess-panel">
                              {c}
                            </span>
                          ))}
                        </div>
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
                    <span className={currentReveal.engine_eval_before >= 0 ? 'text-green-400' : 'text-red-400'}>
                      {fmtEval(currentReveal.engine_eval_before)}
                    </span>
                    <span className="text-slate-600">→</span>
                    <span className={currentReveal.engine_eval_after >= 0 ? 'text-green-400' : 'text-red-400'}>
                      {fmtEval(currentReveal.engine_eval_after)}
                    </span>
                  </div>
                )}

                {currentReveal.engine_multipv?.length > 0 && (
                  <div className="flex flex-col gap-1">
                    {currentReveal.engine_multipv.map((line, i) => (
                      <div key={i} className="bg-chess-dark rounded-lg px-3 py-1.5 text-xs font-mono text-slate-300 flex gap-2 items-baseline">
                        <span className="text-slate-500 w-3">{line.rank}.</span>
                        <span className="text-chess-gold font-bold w-10">{line.move_san}</span>
                        <span className="text-slate-500 w-10">{fmtEval(line.score_cp)}</span>
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

                {currentReveal.explanation && (
                  <div className="text-sm text-slate-300 leading-relaxed border-t border-slate-700 pt-3 whitespace-pre-wrap">
                    {currentReveal.explanation}
                  </div>
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

// ── Questionnaire Phase ────────────────────────────────────────────────────────

const FEELING_TAGS = [
  'Focused', 'Confident', 'Prepared',
  'Nervous', 'Tired', 'Rushed',
  'Tilted', 'Unprepared', 'Pressured',
  'Lucky', 'Unlucky',
]

const PLAN_OPTIONS = [
  { value: 'always', label: 'Always' },
  { value: 'mostly', label: 'Mostly' },
  { value: 'reacting', label: 'Mostly reacting' },
  { value: 'no_plan', label: 'No plan' },
]

const TIME_PRESSURE_OPTIONS = [
  { value: 'not_at_all', label: 'Not at all' },
  { value: 'slightly', label: 'Slightly' },
  { value: 'significantly', label: 'Significantly' },
]

const OPENING_PREP_OPTIONS = [
  { value: 'solid', label: 'Solid' },
  { value: 'ok', label: 'Acceptable' },
  { value: 'poor', label: 'Poor' },
  { value: 'winging_it', label: 'Winging it' },
]

function RadioPills({ options, value, onChange }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map(opt => (
        <button
          key={opt.value}
          type="button"
          onClick={() => onChange(value === opt.value ? '' : opt.value)}
          className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${
            value === opt.value
              ? 'bg-chess-gold text-chess-dark border-chess-gold font-semibold'
              : 'border-slate-600 text-slate-400 hover:border-chess-gold hover:text-white'
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  )
}

function QSection({ title, children }) {
  return (
    <div>
      <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3 pb-1 border-b border-slate-700">
        {title}
      </div>
      <div className="flex flex-col gap-4">
        {children}
      </div>
    </div>
  )
}

function QField({ label, required, children }) {
  return (
    <div>
      <label className="text-sm text-slate-300 block mb-1.5">
        {label}
        {!required && <span className="text-slate-600 text-xs ml-1">(optional)</span>}
      </label>
      {children}
    </div>
  )
}

function QuestionnairePhase({ feelings, setFeelings, gameResult, onComplete, loading, error }) {
  const resultWord = gameResult === 'win' ? 'won' : gameResult === 'loss' ? 'lost' : gameResult === 'draw' ? 'drew' : null
  const resultPhrase = resultWord ? `you ${resultWord}` : 'this result'

  const toggleTag = (tag) => {
    setFeelings(prev => ({
      ...prev,
      feelings: prev.feelings.includes(tag)
        ? prev.feelings.filter(t => t !== tag)
        : [...prev.feelings, tag],
    }))
  }

  const set = (field) => (e) => setFeelings(prev => ({ ...prev, [field]: e.target.value }))
  const setRadio = (field) => (val) => setFeelings(prev => ({ ...prev, [field]: val }))

  const hasRequired = feelings.result_reason.trim() && feelings.takeaway.trim() && feelings.plan_adherence && feelings.time_pressure && feelings.opening_prep

  const buildPayload = () => {
    const out = {}
    if (feelings.feelings.length > 0) out.feelings = feelings.feelings
    if (feelings.result_reason.trim()) out.result_reason = feelings.result_reason.trim()
    if (feelings.key_moment.trim()) out.key_moment = feelings.key_moment.trim()
    if (feelings.takeaway.trim()) out.takeaway = feelings.takeaway.trim()
    if (feelings.would_do_differently.trim()) out.would_do_differently = feelings.would_do_differently.trim()
    if (feelings.plan_adherence) out.plan_adherence = feelings.plan_adherence
    if (feelings.time_pressure) out.time_pressure = feelings.time_pressure
    if (feelings.opening_prep) out.opening_prep = feelings.opening_prep
    if (feelings.extra_note.trim()) out.extra_note = feelings.extra_note.trim()
    return Object.keys(out).length > 0 ? out : null
  }

  const textareaClass = "w-full bg-chess-dark border border-slate-700 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-chess-gold resize-none"

  return (
    <div className="min-h-screen bg-chess-dark p-6">
      <div className="max-w-xl mx-auto">
        <div className="bg-chess-panel rounded-xl p-6">
          <h2 className="text-xl font-bold text-chess-gold mb-1">Reflect on This Game</h2>
          <p className="text-slate-400 text-sm mb-6">
            Answer a few questions — the coach will compare your self-assessment to the engine data.
          </p>

          <div className="flex flex-col gap-6">

            {/* Section 1: Outcome */}
            <QSection title="Outcome">
              <QField label={`What was the main reason ${resultPhrase}?`} required>
                <textarea
                  value={feelings.result_reason}
                  onChange={set('result_reason')}
                  rows={3}
                  placeholder="Describe what you think decided the game…"
                  className={textareaClass}
                />
              </QField>
              <QField label="Was there a specific moment where the game turned?">
                <textarea
                  value={feelings.key_moment}
                  onChange={set('key_moment')}
                  rows={2}
                  placeholder="e.g. After Bxh7+ I panicked and spent 8 minutes…"
                  className={textareaClass}
                />
              </QField>
            </QSection>

            {/* Section 2: Your Process */}
            <QSection title="Your Process">
              <QField label="Were you following a clear plan?" required>
                <RadioPills options={PLAN_OPTIONS} value={feelings.plan_adherence} onChange={setRadio('plan_adherence')} />
              </QField>
              <QField label="Did time pressure affect your decisions?" required>
                <RadioPills options={TIME_PRESSURE_OPTIONS} value={feelings.time_pressure} onChange={setRadio('time_pressure')} />
              </QField>
              <QField label="How was your opening preparation?" required>
                <RadioPills options={OPENING_PREP_OPTIONS} value={feelings.opening_prep} onChange={setRadio('opening_prep')} />
              </QField>
            </QSection>

            {/* Section 3: Learning */}
            <QSection title="Learning">
              <QField label="What's your #1 takeaway from this game?" required>
                <textarea
                  value={feelings.takeaway}
                  onChange={set('takeaway')}
                  rows={2}
                  placeholder="The most important thing you learned…"
                  className={textareaClass}
                />
              </QField>
              <QField label="If you could replay this game, what would you change?">
                <textarea
                  value={feelings.would_do_differently}
                  onChange={set('would_do_differently')}
                  rows={2}
                  placeholder="A specific decision or approach you'd do differently…"
                  className={textareaClass}
                />
              </QField>
            </QSection>

            {/* Section 4: Feelings */}
            <QSection title="Feelings">
              <QField label="How did you feel?">
                <div className="flex flex-wrap gap-2">
                  {FEELING_TAGS.map(tag => (
                    <button
                      key={tag}
                      type="button"
                      onClick={() => toggleTag(tag)}
                      className={`text-sm px-3 py-1.5 rounded-full border transition-colors ${
                        feelings.feelings.includes(tag)
                          ? 'bg-chess-gold text-chess-dark border-chess-gold font-semibold'
                          : 'border-slate-600 text-slate-400 hover:border-chess-gold hover:text-white'
                      }`}
                    >
                      {tag}
                    </button>
                  ))}
                </div>
              </QField>
              <QField label="Extra note">
                <textarea
                  value={feelings.extra_note}
                  onChange={set('extra_note')}
                  rows={2}
                  placeholder="Anything else about how you played today…"
                  className={textareaClass}
                />
              </QField>
            </QSection>

          </div>

          {error && (
            <div className="p-2 bg-red-900/40 border border-red-700 rounded-lg text-red-300 text-xs mt-4">{error}</div>
          )}

          <div className="flex items-center gap-3 mt-6">
            <button
              onClick={() => onComplete(buildPayload())}
              disabled={loading || !hasRequired}
              className="flex-1 bg-chess-gold text-chess-dark font-bold py-2.5 rounded-xl hover:opacity-90 disabled:opacity-50"
            >
              {loading ? 'Saving…' : 'Finish Session'}
            </button>
            <button
              onClick={() => onComplete(null)}
              disabled={loading}
              className="text-slate-500 text-sm hover:text-white px-3 transition-colors disabled:opacity-50"
            >
              Skip
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Setup Phase ───────────────────────────────────────────────────────────────

function SetupPhase({ timeBudget, setTimeBudget, customBudget, setCustomBudget, onStart, loading, error, onBack }) {
  return (
    <div className="min-h-screen bg-chess-dark p-6">
      <div className="max-w-lg mx-auto">
        <button onClick={onBack} className="flex items-center gap-1 text-slate-400 hover:text-white text-sm mb-6">
          <ChevronLeft size={16} /> Dashboard
        </button>
        <div className="bg-chess-panel rounded-xl p-6">
          <h1 className="text-2xl font-bold text-chess-gold mb-1 flex items-center gap-2">
            <PenLine size={22} /> Self-Analysis
          </h1>
          <p className="text-slate-400 text-sm mb-6">
            Review your own moves and write your reasoning <strong>before</strong> the engine reveals the truth.
            Navigate the full game with ← → arrows; annotate your own moves at any pace.
          </p>

          <div className="mb-6">
            <label className="text-sm text-slate-300 font-medium block mb-3">Time budget</label>
            <div className="flex gap-2 flex-wrap">
              {TIME_BUDGETS.map(b => (
                <button key={b}
                  onClick={() => { setTimeBudget(b); setCustomBudget('') }}
                  className={`px-5 py-2 rounded-lg border text-sm font-medium transition-colors ${
                    timeBudget === b && !customBudget
                      ? 'bg-chess-gold text-chess-dark border-chess-gold'
                      : 'border-slate-600 text-slate-400 hover:border-chess-gold hover:text-white'
                  }`}
                >
                  {b} min
                </button>
              ))}
              <div className="flex items-center gap-2">
                <input
                  type="number" min={1} max={180} value={customBudget}
                  onChange={e => { setCustomBudget(e.target.value); setTimeBudget(0) }}
                  placeholder="Custom"
                  className="w-24 bg-chess-dark border border-slate-600 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-chess-gold"
                />
                <span className="text-slate-500 text-sm">min</span>
              </div>
            </div>
          </div>

          {error && (
            <div className="p-3 bg-red-900/40 border border-red-700 rounded-lg text-red-300 text-sm mb-4">
              {error}
            </div>
          )}

          <button
            onClick={onStart}
            disabled={loading || (timeBudget === 0 && !customBudget)}
            className="w-full bg-chess-gold text-chess-dark font-bold py-3 rounded-xl hover:opacity-90 disabled:opacity-50 text-base"
          >
            {loading ? 'Starting…' : 'Start Session'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Complete Phase ────────────────────────────────────────────────────────────

function CompletePhase({ reflection, gameResult, onDashboard, onNewSession, onCoachReview, onReviewAnnotations, reviewLoading, error }) {
  const [reflectionsOpen, setReflectionsOpen] = useState(false)

  if (!reflection) {
    return (
      <div className="min-h-screen bg-chess-dark flex items-center justify-center">
        <div className="text-chess-gold animate-pulse">Loading results…</div>
      </div>
    )
  }

  const scores = [
    { name: 'Eval Accuracy', value: reflection.eval_accuracy_score, color: '#facc15' },
    { name: 'Candidate Quality', value: reflection.candidate_quality_score, color: '#4ade80' },
    { name: 'Tactical Awareness', value: reflection.tactical_awareness_score, color: '#60a5fa' },
    { name: 'Confidence Cal.', value: reflection.confidence_calibration_score, color: '#f472b6' },
  ]

  const q = reflection.game_feelings || {}
  const resultWord = gameResult === 'win' ? 'won' : gameResult === 'loss' ? 'lost' : gameResult === 'draw' ? 'drew' : null

  // Build label→value pairs for filled questionnaire fields
  const reflectionRows = [
    { label: `Why you ${resultWord || 'played'}`, value: q.result_reason },
    { label: 'Key turning point', value: q.key_moment },
    { label: 'Takeaway', value: q.takeaway },
    { label: 'Would do differently', value: q.would_do_differently },
    { label: 'Plan adherence', value: q.plan_adherence?.replace('_', ' ') },
    { label: 'Time pressure', value: q.time_pressure?.replace('_', ' ') },
    { label: 'Opening prep', value: q.opening_prep?.replace('_', ' ') },
    { label: 'Extra note', value: q.extra_note },
  ].filter(r => r.value && String(r.value).trim())

  const feelingTags = q.feelings || []

  return (
    <div className="min-h-screen bg-chess-dark p-6">
      <div className="max-w-2xl mx-auto">
        <div className="flex items-center gap-3 mb-6">
          <Trophy size={32} className="text-chess-gold" />
          <div>
            <h1 className="text-2xl font-bold text-white">Session Complete</h1>
            <p className="text-slate-400 text-sm">
              {reflection.moves_reviewed} of {reflection.total_moves} moves annotated
            </p>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 mb-6">
          {scores.map(s => <ScoreCard key={s.name} label={s.name} score={s.value} color={s.color} />)}
        </div>

        <div className="bg-chess-panel rounded-xl p-4 mb-6">
          <h3 className="text-sm font-semibold text-slate-300 mb-3">Score Breakdown</h3>
          <ResponsiveContainer width="100%" height={180}>
            <BarChart data={scores} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
              <XAxis dataKey="name" tick={{ fill: '#94a3b8', fontSize: 11 }} />
              <YAxis domain={[0, 100]} tick={{ fill: '#94a3b8', fontSize: 11 }} />
              <Tooltip contentStyle={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 8 }} labelStyle={{ color: '#f1f5f9' }} />
              <Bar dataKey="value" radius={[4, 4, 0, 0]}>
                {scores.map((s, i) => <Cell key={i} fill={s.color} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        {reflection.thinking_notes?.length > 0 && (
          <div className="bg-chess-panel rounded-xl p-4 mb-6">
            <h3 className="text-sm font-semibold text-chess-gold mb-2">Coaching Notes</h3>
            <ul className="space-y-1.5">
              {reflection.thinking_notes.map((note, i) => (
                <li key={i} className="text-sm text-slate-300 flex gap-2">
                  <span className="text-chess-gold mt-0.5">·</span>{note}
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Coach on Your Reflection — LLM questionnaire analysis */}
        {reflection.questionnaire_coaching && (
          <div className="bg-chess-panel rounded-xl p-4 mb-6 border border-chess-gold/20">
            <div className="flex items-center gap-2 mb-3">
              <MessageSquare size={16} className="text-chess-gold" />
              <h3 className="text-sm font-semibold text-chess-gold">Coach on Your Reflection</h3>
            </div>
            <p className="text-sm text-slate-300 leading-relaxed whitespace-pre-wrap">
              {reflection.questionnaire_coaching}
            </p>
          </div>
        )}

        {/* Your Reflections — collapsible */}
        {(reflectionRows.length > 0 || feelingTags.length > 0) && (
          <div className="bg-chess-panel rounded-xl p-4 mb-6">
            <button
              onClick={() => setReflectionsOpen(v => !v)}
              className="w-full flex items-center justify-between text-sm font-semibold text-slate-300 hover:text-white transition-colors"
            >
              <span>Your Reflections</span>
              <span className="text-slate-500 text-xs">{reflectionsOpen ? '▴' : '▾'}</span>
            </button>

            {reflectionsOpen && (
              <div className="mt-3 flex flex-col gap-2.5">
                {feelingTags.length > 0 && (
                  <div>
                    <div className="text-xs text-slate-500 mb-1">Feelings</div>
                    <div className="flex flex-wrap gap-1.5">
                      {feelingTags.map((tag, i) => (
                        <span key={i} className="text-xs px-2.5 py-1 rounded-full bg-slate-700 text-slate-200">{tag}</span>
                      ))}
                    </div>
                  </div>
                )}
                {reflectionRows.map((row, i) => (
                  <div key={i}>
                    <div className="text-xs text-slate-500 mb-0.5">{row.label}</div>
                    <p className="text-sm text-slate-300 italic">"{row.value}"</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Coach Review CTA */}
        <div className="bg-chess-panel rounded-xl p-4 mb-6 border border-slate-700">
          <div className="flex items-start gap-3">
            <MessageSquare size={20} className="text-chess-gold mt-0.5 flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <h3 className="text-sm font-semibold text-white mb-1">Coach Review</h3>
              <p className="text-xs text-slate-400 mb-3">
                The coach will review your annotations move-by-move, identify gaps in reasoning, ask Socratic
                questions, and reinforce chess principles — all backed by the engine.
              </p>
              {error && (
                <div className="p-2 bg-red-900/40 border border-red-700 rounded-lg text-red-300 text-xs mb-3">
                  {error}
                </div>
              )}
              <button
                onClick={onCoachReview}
                disabled={reviewLoading}
                className="flex items-center gap-2 bg-chess-gold text-chess-dark font-semibold px-4 py-2 rounded-lg hover:opacity-90 disabled:opacity-50 text-sm"
              >
                <MessageSquare size={14} />
                {reviewLoading ? 'Preparing review…' : 'Start Coach Review'}
              </button>
            </div>
          </div>
        </div>

        <div className="flex gap-3 flex-wrap">
          <button onClick={onDashboard} className="flex-1 bg-slate-700 text-white font-semibold py-3 rounded-xl hover:bg-slate-600 transition-colors">
            Back to Dashboard
          </button>
          <button onClick={onReviewAnnotations} className="flex-1 border border-chess-gold/50 text-chess-gold hover:bg-chess-gold/10 font-semibold py-3 rounded-xl transition-colors flex items-center justify-center gap-2">
            <PenLine size={15} /> Review Annotations
          </button>
          <button onClick={onNewSession} className="flex-1 border border-slate-600 text-slate-300 hover:text-white hover:border-slate-400 font-semibold py-3 rounded-xl transition-colors">
            New Session
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Coach Review Phase ─────────────────────────────────────────────────────────

function EvalVerdictBadge({ verdict }) {
  if (!verdict) return null
  const cfg = {
    correct:            { icon: CheckCircle,   cls: 'text-green-400',  label: 'Eval correct' },
    'slightly off':     { icon: AlertCircle,   cls: 'text-yellow-400', label: 'Slightly off' },
    'significantly off':{ icon: XCircle,       cls: 'text-red-400',    label: 'Eval wrong' },
  }
  const c = cfg[verdict]
  if (!c) return null
  const Icon = c.icon
  return (
    <span className={`flex items-center gap-1 text-xs font-medium ${c.cls}`}>
      <Icon size={13} /> {c.label}
    </span>
  )
}

// Find the index into `items` where the game evaluation collapsed.
// 1. Tipping point: position was not losing (eval_before >= -100) but the move
//    caused a large drop (centipawn_loss >= 150), making it losing (eval_after <= -200).
// 2. If no tipping point, fall back to the first blunder.
// 3. Last resort: the single worst centipawn loss.
function findCollapseIdx(items) {
  // Tipping-point pass
  let best = null
  for (let i = 0; i < items.length; i++) {
    const it = items[i]
    const evBefore = it.engine_eval_before ?? 0
    const evAfter  = it.engine_eval_after  ?? 0
    const cpLoss   = it.centipawn_loss      ?? 0
    if (evBefore >= -100 && cpLoss >= 150 && evAfter <= -200) {
      if (!best || cpLoss > (items[best].centipawn_loss ?? 0)) best = i
    }
  }
  if (best !== null) return best

  // First blunder
  const blunderIdx = items.findIndex(it => it.classification === 'blunder')
  if (blunderIdx !== -1) return blunderIdx

  // Worst centipawn loss
  let worstIdx = 0
  for (let i = 1; i < items.length; i++) {
    if ((items[i].centipawn_loss ?? 0) > (items[worstIdx].centipawn_loss ?? 0)) worstIdx = i
  }
  return worstIdx
}

function CoachReviewPhase({
  sessionId, userColor, items, reviewIdx, setReviewIdx,
  reviewResponses, setReviewResponses,
  showEngineArrows, setShowEngineArrows,
  squareHighlights, setSquareHighlights,
  userArrows,
  onBack, onDashboard,
}) {
  const [responseText, setResponseText] = useState('')
  const [replying, setReplying] = useState(false)
  const [replyError, setReplyError] = useState(null)
  const [collapseHighlight, setCollapseHighlight] = useState(false)

  const item = items[reviewIdx] || null
  const moveKey = item?.move_index
  const currentResponse = reviewResponses[moveKey] || {}

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
    setResponseText(currentResponse.response || '')
    setReplyError(null)
  }, [reviewIdx])

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

  const handleSendResponse = async () => {
    if (!responseText.trim() || !item) return
    setReplying(true)
    setReplyError(null)
    try {
      const payload = {
        move_index: item.move_index,
        move_san: item.move_san,
        engine_best_move: item.engine_best_move,
        engine_pv_san: item.engine_pv_san,
        coach_comment: item.coach_comment,
        user_response: responseText.trim(),
      }
      const res = await submitCoachReviewReply(sessionId, payload)
      setReviewResponses(prev => ({
        ...prev,
        [moveKey]: { response: responseText.trim(), reply: res.data.coach_reply },
      }))
    } catch (e) {
      setReplyError(e.response?.data?.detail || e.message)
    } finally {
      setReplying(false)
    }
  }

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
    <div className="min-h-screen bg-chess-dark p-4">
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
                  ? `Eval went from ${item.engine_eval_before > 0 ? '+' : ''}${Math.round(item.engine_eval_before)} to ${
                      item.engine_eval_after > 0 ? '+' : ''
                    }${Math.round(item.engine_eval_after)} cp after ${item.move_san} — a swing of ${Math.round(item.centipawn_loss)} cp.`
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
                  <span className={item.engine_eval_before >= 0 ? 'text-green-400' : 'text-red-400'}>
                    {fmtEval(item.engine_eval_before)}
                  </span>
                  <span className="text-slate-600">→</span>
                  <span className={item.engine_eval_after >= 0 ? 'text-green-400' : 'text-red-400'}>
                    {fmtEval(item.engine_eval_after)}
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
                        <span className="text-slate-500 w-10">{fmtEval(line.score_cp)}</span>
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
                    <span className={item.engine_eval_before >= 0 ? 'text-green-400' : 'text-red-400'}>
                      {fmtEval(item.engine_eval_before)}
                    </span>
                    <span className="text-slate-600">→</span>
                    <span className={item.engine_eval_after >= 0 ? 'text-green-400' : 'text-red-400'}>
                      {fmtEval(item.engine_eval_after)}
                    </span>
                  </div>
                )}
              </div>
              <p className="text-sm text-slate-200 leading-relaxed whitespace-pre-wrap">
                {item.coach_comment}
              </p>
            </div>

            {/* Response area */}
            {!currentResponse.reply && (
              <div className="bg-chess-panel rounded-xl p-4">
                <div className="text-xs text-slate-500 mb-1.5">Your response (optional)</div>
                <textarea
                  value={responseText}
                  onChange={e => setResponseText(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter' && e.ctrlKey) handleSendResponse()
                  }}
                  rows={3}
                  placeholder="Reply to the coach's question… (Ctrl+Enter to send)"
                  className="w-full bg-chess-dark border border-slate-700 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-chess-gold resize-none"
                />
                {replyError && (
                  <p className="text-red-400 text-xs mt-1">{replyError}</p>
                )}
                <button
                  onClick={handleSendResponse}
                  disabled={replying || !responseText.trim()}
                  className="mt-2 flex items-center gap-1.5 text-sm px-4 py-1.5 rounded-lg bg-chess-gold text-chess-dark font-semibold hover:opacity-90 disabled:opacity-50"
                >
                  <Send size={13} />
                  {replying ? 'Sending…' : 'Send'}
                </button>
              </div>
            )}

            {/* Coach reply */}
            {currentResponse.reply && (
              <div className="flex flex-col gap-3">
                <div className="bg-chess-dark rounded-xl p-3 border-l-2 border-slate-600">
                  <div className="text-xs text-slate-500 mb-1">Your response</div>
                  <p className="text-sm text-slate-300 italic">"{currentResponse.response}"</p>
                </div>
                <div className="bg-chess-panel rounded-xl p-4 border border-chess-gold/20">
                  <div className="flex items-center gap-2 mb-2">
                    <MessageSquare size={15} className="text-chess-gold" />
                    <span className="text-sm font-semibold text-chess-gold">Coach</span>
                  </div>
                  <p className="text-sm text-slate-200 leading-relaxed whitespace-pre-wrap">
                    {currentResponse.reply}
                  </p>
                </div>
                <button
                  onClick={() => {
                    setReviewResponses(prev => {
                      const next = { ...prev }
                      delete next[moveKey]
                      return next
                    })
                    setResponseText('')
                  }}
                  className="text-xs text-slate-500 hover:text-white self-start transition-colors"
                >
                  ↩ Edit response
                </button>
              </div>
            )}

          </div>
        </div>
      </div>
    </div>
  )
}

// ── Sub-components ────────────────────────────────────────────────────────────

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

function InfoBox({ label, value, valueClass = 'text-white' }) {
  return (
    <div className="bg-chess-dark rounded-lg p-2">
      <div className="text-xs text-slate-500 mb-0.5">{label}</div>
      <div className={`font-medium ${valueClass}`}>{value || '—'}</div>
    </div>
  )
}

function ScoreCard({ label, score, color }) {
  return (
    <div className="bg-chess-panel rounded-xl p-4 flex flex-col items-center">
      <div className="text-3xl font-bold mb-1" style={{ color }}>{score}</div>
      <div className="text-xs text-slate-400 text-center">{label}</div>
      <div className="w-full bg-slate-700 rounded-full h-1.5 mt-2">
        <div className="h-1.5 rounded-full" style={{ width: `${score}%`, backgroundColor: color }} />
      </div>
    </div>
  )
}

function NavBtn({ onClick, disabled, children, title }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      className="p-1.5 rounded-lg border border-slate-700 text-slate-400 hover:text-white hover:border-slate-500 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
    >
      {children}
    </button>
  )
}

// Dot color based on classification (only shown after annotation)
const DOT_COLOR = {
  blunder:    '#ef4444',
  mistake:    '#f97316',
  inaccuracy: '#facc15',
  good:       '#4ade80',
  best:       '#60a5fa',
}

function MoveCell({ move, isCurrent, annotatedMoves, onSelect, currentRef }) {
  if (!move) return <span className="flex-1 min-w-0" />

  const reveal = annotatedMoves?.[move.move_index]
  const dotColor = move.is_user_move && reveal
    ? (DOT_COLOR[reveal.classification] ?? '#94a3b8')
    : null

  return (
    <button
      ref={currentRef}
      onClick={() => onSelect(move.globalIdx)}
      className={`flex-1 min-w-0 flex items-center gap-1 px-1.5 py-0.5 rounded text-left text-xs font-mono transition-colors ${
        isCurrent
          ? 'bg-chess-gold text-chess-dark font-bold'
          : move.is_user_move
            ? 'text-white hover:bg-slate-700'
            : 'text-slate-400 hover:bg-slate-800'
      }`}
    >
      {dotColor && (
        <span
          className="w-1.5 h-1.5 rounded-full flex-shrink-0"
          style={{ backgroundColor: dotColor }}
        />
      )}
      {move.is_user_move && !dotColor && (
        <span className="w-1.5 h-1.5 rounded-full flex-shrink-0 border border-slate-600" />
      )}
      <span className="truncate">{move.move_san}</span>
    </button>
  )
}

function MoveList({ allGameMoves, navIdx, annotatedMoves, onSelect }) {
  const currentRef = useRef(null)

  // Group moves into rows: { moveNumber, white, black }
  const rows = useMemo(() => {
    const result = []
    let i = 0
    while (i < allGameMoves.length) {
      const m = allGameMoves[i]
      const row = { moveNumber: m.move_number, white: null, black: null }

      if (m.color === 'white') {
        row.white = { ...m, globalIdx: i }
        i++
        if (i < allGameMoves.length && allGameMoves[i].color === 'black') {
          row.black = { ...allGameMoves[i], globalIdx: i }
          i++
        }
      } else {
        // Black opens (e.g. game resumed mid-game) — show with ellipsis for white
        row.black = { ...m, globalIdx: i }
        i++
      }
      result.push(row)
    }
    return result
  }, [allGameMoves])

  // Auto-scroll active move into view
  useEffect(() => {
    currentRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [navIdx])

  return (
    <div className="bg-chess-panel rounded-xl mt-3 overflow-hidden">
      <div className="max-h-40 overflow-y-auto p-1.5 select-none">
        {rows.map((row, ri) => (
          <div key={ri} className="flex items-center gap-0.5">
            {/* Move number */}
            <span className="text-slate-600 text-xs w-6 text-right flex-shrink-0 pr-1">
              {row.moveNumber}.
            </span>

            <MoveCell
              move={row.white}
              isCurrent={row.white?.globalIdx === navIdx}
              annotatedMoves={annotatedMoves}
              onSelect={onSelect}
              currentRef={row.white?.globalIdx === navIdx ? currentRef : null}
            />
            <MoveCell
              move={row.black}
              isCurrent={row.black?.globalIdx === navIdx}
              annotatedMoves={annotatedMoves}
              onSelect={onSelect}
              currentRef={row.black?.globalIdx === navIdx ? currentRef : null}
            />
          </div>
        ))}
      </div>
    </div>
  )
}
