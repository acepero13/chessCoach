import { useState, useEffect, useCallback, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  startAnnotationSession, submitAnnotation, saveDraftAnnotation, completeAnnotationSession,
  getLatestSessionForGame, getCoachReview,
  submitRootCause, exportAnnotatedPgn,
} from '../api/client'
import { streamPost } from '../api/sse'
import { buildMarkdownExport, _moveDataToReveal } from './selfanalysis/exportUtils'
import { HIGHLIGHT_COLORS } from './selfanalysis/constants'
import SetupPhase from './selfanalysis/SetupPhase'
import QuestionnairePhase from './selfanalysis/QuestionnairePhase'
import CompletePhase from './selfanalysis/CompletePhase'
import CoachReviewPhase from './selfanalysis/CoachReviewPhase'
import AnnotatingPhase from './selfanalysis/AnnotatingPhase'

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
  const [signalFlags, setSignalFlags] = useState({ lpdo: false, geometry: false, kingSafety: false })
  const [mistakeReason, setMistakeReason] = useState('')
  const [submitting, setSubmitting] = useState(false)

  // Draft persistence: saves in-progress form per move_index so navigation doesn't wipe it
  const [draftAnnotations, setDraftAnnotations] = useState({})
  // Refs that let goTo read current state without stale closures
  const formRef = useRef({ annotation: '', candidates: ['', '', ''], evalLabel: '', confidence: 0, markedCritical: false, signalFlags: { lpdo: false, geometry: false, kingSafety: false }, mistakeReason: '' })
  useEffect(() => {
    formRef.current = { annotation, candidates, evalLabel, confidence, markedCritical, signalFlags, mistakeReason }
  }, [annotation, candidates, evalLabel, confidence, markedCritical, signalFlags, mistakeReason])
  const draftAnnotationsRef = useRef({})
  useEffect(() => { draftAnnotationsRef.current = draftAnnotations }, [draftAnnotations])
  const squareHighlightsRef = useRef({})
  const userArrowsRef = useRef({})
  const sessionIdRef = useRef(null)

  // localStorage emergency backup — persists annotation text across page reloads
  // Key: selfanalysis-{gameId}-{moveIndex}
  const lsKey = (moveIdx) => `selfanalysis-${gameId}-${moveIdx}`
  useEffect(() => {
    const move = allGameMoves[navIdx]
    // Only save for user moves — saving for opponent moves would pollute localStorage
    // keys that the navIdx effect reads when restoring, causing stale annotations to appear.
    if (!move?.is_user_move) return
    const moveIndex = move.move_index
    if (moveIndex === undefined || !annotation) return
    try { localStorage.setItem(lsKey(moveIndex), annotation) } catch (_) {}
  }, [annotation, navIdx, allGameMoves, gameId])

  // Arrow overlays & square highlights (shared across annotating + coach_review)
  const [showEngineArrows, setShowEngineArrows] = useState(false)
  const [squareHighlights, setSquareHighlights] = useState({})  // { moveIndex: { square: cssColor } }
  const [userArrows, setUserArrows] = useState({})              // { moveIndex: Arrow[] }
  // Keep refs in sync so goTo can read them without stale closure issues
  useEffect(() => { squareHighlightsRef.current = squareHighlights }, [squareHighlights])
  useEffect(() => { userArrowsRef.current = userArrows }, [userArrows])
  useEffect(() => { sessionIdRef.current = sessionId }, [sessionId])

  // Post-reveal root cause classifications: { [move_index]: root_cause_string }
  const [rootCauses, setRootCauses] = useState({})

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

    // Save current form to draft before leaving (uses refs — no dependency on form state)
    const currentMove = allGameMoves[navIdx]
    const currentMoveIndex = currentMove?.move_index
    if (currentMoveIndex !== undefined && currentMove?.is_user_move) {
      const form = formRef.current
      // In-memory draft (instant)
      setDraftAnnotations(prev => ({ ...prev, [currentMoveIndex]: { ...form } }))
      // Fire-and-forget DB persist (survives page reload/error)
      // Backend save-draft won't overwrite submitted moves; frontend reveal panel
      // takes priority over draftAnnotations when a move is already submitted.
      const sid = sessionIdRef.current
      if (sid) {
        saveDraftAnnotation(sid, {
          move_index: currentMoveIndex,
          user_annotation: form.annotation || '',
          user_candidates: (form.candidates || []).filter(Boolean),
          user_eval_label: form.evalLabel || '',
          user_confidence: form.confidence || 0,
          user_marked_critical: form.markedCritical || false,
          user_squares: squareHighlightsRef.current[currentMoveIndex] || {},
          user_arrows: Array.isArray(userArrowsRef.current[currentMoveIndex]) ? userArrowsRef.current[currentMoveIndex] : [],
          signal_flags: form.signalFlags || {},
          mistake_reason: form.mistakeReason || '',
        }).catch(err => {
          console.warn('[save-draft]', err.response?.status, err.response?.data, 'move_index:', currentMoveIndex)
        })
      }
    }

    // Pre-load destination move form state in the same batch as setNavIdx.
    // This eliminates the stale-annotation render frame that happens when
    // annotation state from the previous move lingers until the navIdx effect fires.
    // We ALWAYS reset state here — for user moves we restore draft/blank;
    // for opponent moves we blank everything so localStorage is never polluted
    // with the previous annotation under the opponent's move_index.
    const nextMove = allGameMoves[idx]
    if (nextMove?.is_user_move) {
      const draft = draftAnnotationsRef.current[nextMove.move_index]
      if (draft) {
        setAnnotation(draft.annotation)
        setCandidates(draft.candidates ?? ['', '', ''])
        setEvalLabel(draft.evalLabel ?? '')
        setConfidence(draft.confidence ?? 0)
        setMarkedCritical(draft.markedCritical ?? false)
        setSignalFlags(draft.signalFlags ?? { lpdo: false, geometry: false, kingSafety: false })
        setMistakeReason(draft.mistakeReason ?? '')
      } else {
        setAnnotation('')
        setCandidates(['', '', ''])
        setEvalLabel('')
        setConfidence(0)
        setMarkedCritical(false)
        setSignalFlags({ lpdo: false, geometry: false, kingSafety: false })
        setMistakeReason('')
      }
    } else {
      // Opponent's move — always blank form state.
      setAnnotation('')
      setCandidates(['', '', ''])
      setEvalLabel('')
      setConfidence(0)
      setMarkedCritical(false)
      setSignalFlags({ lpdo: false, geometry: false, kingSafety: false })
      setMistakeReason('')
    }

    setNavIdx(idx)
  }, [allGameMoves, navIdx])

  // Restore draft (or blank form) whenever navIdx changes.
  // This is a safety net for cases where navIdx is set directly (e.g. checkExisting resume).
  // When navigating via goTo, state is already pre-set above, so this is a no-op.
  useEffect(() => {
    const move = allGameMoves[navIdx]
    const moveIndex = move?.move_index
    if (moveIndex === undefined) return

    // Always blank form for opponent moves — they have no annotation form.
    // Importantly, do NOT read localStorage here for opponent moves, because the
    // localStorage save effect may have written the previous user annotation under
    // the opponent's move_index (before this guard was in place).
    if (!move.is_user_move) {
      setAnnotation('')
      setCandidates(['', '', ''])
      setEvalLabel('')
      setConfidence(0)
      setMarkedCritical(false)
      setSignalFlags({ lpdo: false, geometry: false, kingSafety: false })
      setMistakeReason('')
      return
    }

    const draft = draftAnnotations[moveIndex]
    if (draft) {
      setAnnotation(draft.annotation)
      setCandidates(draft.candidates)
      setEvalLabel(draft.evalLabel)
      setConfidence(draft.confidence)
      setMarkedCritical(draft.markedCritical)
      setSignalFlags(draft.signalFlags ?? { lpdo: false, geometry: false, kingSafety: false })
      setMistakeReason(draft.mistakeReason ?? '')
    } else {
      // Try to recover annotation text from localStorage emergency backup
      let savedAnnotation = ''
      try { savedAnnotation = localStorage.getItem(`selfanalysis-${gameId}-${moveIndex}`) || '' } catch (_) {}
      setAnnotation(savedAnnotation)
      setCandidates(['', '', ''])
      setEvalLabel('')
      setConfidence(0)
      setMarkedCritical(false)
      setSignalFlags({ lpdo: false, geometry: false, kingSafety: false })
      setMistakeReason('')
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
          loadSessionData(data)
          const preAnnotated = {}
          const restoredHighlights = {}
          const restoredArrows = {}
          const restoredRootCauses = {}
          for (const m of data.moves_data || []) {
            preAnnotated[m.move_index] = _moveDataToReveal(m)
            if (m.user_squares && Object.keys(m.user_squares).length > 0)
              restoredHighlights[m.move_index] = m.user_squares
            if (m.user_arrows?.length > 0)
              restoredArrows[m.move_index] = m.user_arrows
            if (m.root_cause)
              restoredRootCauses[m.move_index] = m.root_cause
          }
          setAnnotatedMoves(preAnnotated)
          setSquareHighlights(restoredHighlights)
          setUserArrows(restoredArrows)
          setRootCauses(restoredRootCauses)
          setNavIdx(0)
          setPhase('complete')
          return
        }

        // Incomplete session — resume it
        loadSessionData(data)

        // Pre-populate annotated moves from stored moves_data
        // Submitted moves → annotatedMoves (shows engine reveal); drafts → draftAnnotations (refills form)
        const preAnnotated = {}
        const presDrafts = {}
        const restoredHighlights = {}
        const restoredArrows = {}
        const restoredRootCauses = {}
        for (const m of data.moves_data || []) {
          if (m.user_squares && Object.keys(m.user_squares).length > 0)
            restoredHighlights[m.move_index] = m.user_squares
          if (m.user_arrows?.length > 0)
            restoredArrows[m.move_index] = m.user_arrows
          if (m.root_cause)
            restoredRootCauses[m.move_index] = m.root_cause

          if (m.draft) {
            // Restore form state only — user hasn't submitted this move yet
            presDrafts[m.move_index] = {
              annotation: m.user_annotation || '',
              candidates: m.user_candidates?.length ? m.user_candidates : ['', '', ''],
              evalLabel: m.user_eval_label || '',
              confidence: m.user_confidence || 0,
              markedCritical: m.user_marked_critical || false,
              signalFlags: m.signal_flags || { lpdo: false, geometry: false, kingSafety: false },
              mistakeReason: m.mistake_reason || '',
            }
          } else {
            preAnnotated[m.move_index] = _moveDataToReveal(m)
          }
        }
        setAnnotatedMoves(preAnnotated)
        setDraftAnnotations(presDrafts)
        setSquareHighlights(restoredHighlights)
        setUserArrows(restoredArrows)
        setRootCauses(restoredRootCauses)

        // Navigate to first unannotated user move
        // (annotated_move_indices from server only includes submitted, not draft, moves)
        const annotatedSet = new Set(data.annotated_move_indices || [])
        const firstUnannotatedIdx = data.all_game_moves.findIndex(
          m => m.is_user_move && !annotatedSet.has(m.move_index)
        )
        const targetIdx = firstUnannotatedIdx >= 0 ? firstUnannotatedIdx : 0
        const targetMove = data.all_game_moves[targetIdx]
        const targetDraft = targetMove?.is_user_move ? presDrafts[targetMove.move_index] : null
        // Pre-load form state in the same batch as setNavIdx so the RichTextEditor
        // mounts with the correct defaultValue on the first render (navIdx effect is
        // a safety net but runs after the first render, which could show a stale value).
        if (targetDraft) {
          setAnnotation(targetDraft.annotation)
          setCandidates(targetDraft.candidates ?? ['', '', ''])
          setEvalLabel(targetDraft.evalLabel ?? '')
          setConfidence(targetDraft.confidence ?? 0)
          setMarkedCritical(targetDraft.markedCritical ?? false)
          setSignalFlags(targetDraft.signalFlags ?? { lpdo: false, geometry: false, kingSafety: false })
          setMistakeReason(targetDraft.mistakeReason ?? '')
        } else {
          setAnnotation('')
          setCandidates(['', '', ''])
          setEvalLabel('')
          setConfidence(0)
          setMarkedCritical(false)
          setSignalFlags({ lpdo: false, geometry: false, kingSafety: false })
          setMistakeReason('')
        }
        setNavIdx(targetIdx)
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
    setSignalFlags({ lpdo: false, geometry: false, kingSafety: false })
    setMistakeReason('')
    setDraftAnnotations({})
  }

  const handleSubmit = async () => {
    if (!currentMove || !isUserMove) return
    const moveIndex = currentMove.move_index
    // Guard: move_index must be a valid integer (undefined would be stripped from JSON → 422)
    if (moveIndex === undefined || moveIndex === null || !Number.isInteger(moveIndex)) {
      setError(`Invalid move index (${moveIndex}) — please navigate away and back, then retry.`)
      return
    }
    setSubmitting(true)
    setError(null)
    try {
      const currentSquares = squareHighlights[moveIndex] || {}
      const currentUserArrows = Array.isArray(userArrows[moveIndex]) ? userArrows[moveIndex] : []
      const filteredCandidates = candidates.filter(c => c?.trim?.() ?? false)
      const payload = {
        move_index: moveIndex,
        user_annotation: annotation,
        user_candidates: filteredCandidates,
        user_eval_label: evalLabel,
        user_confidence: confidence,
        user_marked_critical: markedCritical,
        user_squares: currentSquares,
        user_arrows: currentUserArrows,
        signal_flags: signalFlags,
        mistake_reason: mistakeReason,
      }
      const res = await submitAnnotation(sessionId, payload)
      // Store engine data AND user's own annotation/visual data so the reveal panel can display them
      const revealBase = {
        ...res.data,
        user_annotation: annotation,
        user_candidates: filteredCandidates,
        user_eval_label: evalLabel,
        user_squares: currentSquares,
        user_arrows: currentUserArrows,
        signal_flags: signalFlags,
        mistake_reason: mistakeReason,
        explanation: '',   // starts empty; filled by streaming below
      }
      setAnnotatedMoves(prev => ({ ...prev, [moveIndex]: revealBase }))

      // Stream the LLM explanation in the background — updates explanation as chunks arrive
      streamPost(
        `/selfanalysis/session/${sessionId}/explain-stream`,
        payload,
        chunk => {
          setAnnotatedMoves(prev => {
            const entry = prev[moveIndex]
            if (!entry) return prev
            return { ...prev, [moveIndex]: { ...entry, explanation: (entry.explanation || '') + chunk } }
          })
        },
      ).catch(() => {
        // Explanation streaming failed silently — reveal still works without it
      })
      // Drop the draft for this move — it's now revealed and immutable
      setDraftAnnotations(prev => {
        const next = { ...prev }
        delete next[currentMove.move_index]
        return next
      })
      // Clear localStorage backup for this move
      try { localStorage.removeItem(lsKey(moveIndex)) } catch (_) {}
    } catch (e) {
      const detail = e.response?.data?.detail
      const msg = Array.isArray(detail)
        ? detail.map(d => `${d.loc?.slice(-1)[0] ?? 'field'}: ${d.msg}`).join(' | ')
        : (detail || e.message)
      console.error('[annotate 422]', e.response?.status, e.response?.data, 'payload move_index:', moveIndex)
      setError(`Submit failed: ${msg} — your text is preserved, try again.`)
    } finally {
      setSubmitting(false)
    }
  }

  // Save post-reveal root cause (fire-and-forget to server, instant in state)
  const handleRootCause = useCallback(async (moveIndex, rootCause) => {
    setRootCauses(prev => ({ ...prev, [moveIndex]: rootCause }))
    if (!sessionId) return
    try {
      await submitRootCause(sessionId, moveIndex, rootCause)
    } catch (e) {
      console.warn('[root-cause]', e)
    }
  }, [sessionId])

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
    setRootCauses({})
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

  const handleArrowsChange = useCallback(({ arrows: newArrows } = {}) => {
    // onArrowsChange fires on every board mount with empty arrows — ignore to avoid wiping
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

  const handleExportPgn = async () => {
    try {
      const res = await exportAnnotatedPgn(sessionId)
      const white = sessionMeta?.white_player || 'White'
      const black = sessionMeta?.black_player || 'Black'
      const filename = `self-analysis-${white}-vs-${black}-session-${sessionId}.pgn`.toLowerCase().replace(/\s+/g, '-')
      const url = URL.createObjectURL(res.data)
      const a = document.createElement('a')
      a.href = url
      a.download = filename
      a.click()
      URL.revokeObjectURL(url)
    } catch (err) {
      console.error('PGN export failed', err)
    }
  }

  const handleExport = () => {
    const md = buildMarkdownExport({
      allGameMoves,
      annotatedMoves,
      sessionMeta,
      reflection,
      reviewItems,
      reviewResponses,
    })
    const white = sessionMeta?.white_player || 'White'
    const black = sessionMeta?.black_player || 'Black'
    const date = new Date().toISOString().slice(0, 10)
    const filename = `self-analysis-${white}-vs-${black}-${date}.md`.toLowerCase().replace(/\s+/g, '-')
    const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    a.click()
    URL.revokeObjectURL(url)
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
        onExport={handleExport}
        onExportPgn={handleExportPgn}
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
    <AnnotatingPhase
      sessionMeta={sessionMeta}
      allGameMoves={allGameMoves}
      navIdx={navIdx}
      currentMove={currentMove}
      currentReveal={currentReveal}
      annotatedMoves={annotatedMoves}
      criticalOnly={criticalOnly}
      setCriticalOnly={setCriticalOnly}
      showEngineArrows={showEngineArrows}
      setShowEngineArrows={setShowEngineArrows}
      squareHighlights={squareHighlights}
      userArrows={userArrows}
      suggestedMin={suggestedMin}
      annotation={annotation}
      setAnnotation={setAnnotation}
      candidates={candidates}
      setCandidates={setCandidates}
      evalLabel={evalLabel}
      setEvalLabel={setEvalLabel}
      confidence={confidence}
      setConfidence={setConfidence}
      markedCritical={markedCritical}
      setMarkedCritical={setMarkedCritical}
      signalFlags={signalFlags}
      setSignalFlags={setSignalFlags}
      mistakeReason={mistakeReason}
      setMistakeReason={setMistakeReason}
      submitting={submitting}
      error={error}
      handleSquareRightClick={handleSquareRightClick}
      handleArrowsChange={handleArrowsChange}
      handleSubmit={handleSubmit}
      handleRootCause={handleRootCause}
      handleRequestComplete={handleRequestComplete}
      goPrev={goPrev}
      goNext={goNext}
      canGoPrev={canGoPrev}
      canGoNext={canGoNext}
      formRef={formRef}
      rootCauses={rootCauses}
      annotatedCount={annotatedCount}
      userMoveCount={userMoveCount}
      onNavigate={goTo}
      onExport={handleExport}
      onExportPgn={handleExportPgn}
      onDashboard={() => navigate('/')}
    />
  )
}
