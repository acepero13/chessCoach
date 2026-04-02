import { useState, useEffect, useCallback, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { Chessboard } from 'react-chessboard'
import { Chess } from 'chess.js'
import {
  ArrowLeft, RefreshCw, CheckCircle, XCircle, Clock, Target,
  Zap, BarChart2, AlertTriangle, ChevronRight, ChevronLeft, Keyboard,
  Play, StopCircle, Shield, Swords, Eye, EyeOff, MessageSquare, Brain,
} from 'lucide-react'
import {
  getPuzzleImportStatus, startPuzzleImport, getPuzzleBooks, getPuzzleSession,
  recordPuzzleAttempt, getPuzzleStats, getPuzzleRecommendation, analyzePosition,
  analyzePositionMulti, getGauntletCoach, getPersonalPuzzles, getTrainingModeRecommendation,
} from '../api/client'


// ---------------------------------------------------------------------------
// Motif metadata
// ---------------------------------------------------------------------------

const MOTIF_META = {
  fork:             { label: 'Fork',             color: 'bg-orange-900/80 border-orange-500 text-orange-300'   },
  pin:              { label: 'Pin',               color: 'bg-purple-900/80 border-purple-500 text-purple-300'   },
  checkmate:        { label: 'Checkmate',         color: 'bg-red-900/80 border-red-500 text-red-300'            },
  discovered_attack:{ label: 'Discovered Attack', color: 'bg-blue-900/80 border-blue-500 text-blue-300'         },
  hanging_piece:    { label: 'Hanging Piece',     color: 'bg-yellow-900/80 border-yellow-500 text-yellow-300'   },
  sacrifice:        { label: 'Sacrifice',         color: 'bg-pink-900/80 border-pink-500 text-pink-300'         },
  skewer:           { label: 'Skewer',            color: 'bg-violet-900/80 border-violet-500 text-violet-300'   },
  deflection:       { label: 'Deflection',        color: 'bg-teal-900/80 border-teal-500 text-teal-300'         },
  overloading:      { label: 'Overloading',       color: 'bg-amber-900/80 border-amber-500 text-amber-300'      },
  clearance:        { label: 'Clearance',         color: 'bg-lime-900/80 border-lime-500 text-lime-300'         },
  interference:     { label: 'Interference',      color: 'bg-rose-900/80 border-rose-500 text-rose-300'         },
  zwischenzug:      { label: 'Zwischenzug',       color: 'bg-indigo-900/80 border-indigo-500 text-indigo-300'   },
  x_ray:            { label: 'X-Ray',             color: 'bg-sky-900/80 border-sky-500 text-sky-300'            },
  promotion:        { label: 'Promotion',         color: 'bg-emerald-900/80 border-emerald-500 text-emerald-300'},
  combination:      { label: 'Combination',       color: 'bg-slate-700/80 border-slate-500 text-slate-300'      },
  check:            { label: 'Check',             color: 'bg-cyan-900/80 border-cyan-500 text-cyan-300'         },
}

const MOTIF_KEYS = Object.keys(MOTIF_META)

// ---------------------------------------------------------------------------
// Helper: board orientation from FEN
// ---------------------------------------------------------------------------

function boardOrientation(fen) {
  return fen.split(' ')[1] === 'b' ? 'black' : 'white'
}

// chess.js requires fullmove_number >= 1; some puzzle PGNs use 0
function normalizeFen(fen) {
  if (!fen) return fen
  const parts = fen.split(' ')
  if (parts.length === 6 && parts[5] === '0') parts[5] = '1'
  return parts.join(' ')
}

// ---------------------------------------------------------------------------
// Stoyko Mode helpers
// ---------------------------------------------------------------------------

// Compute all CCT + LPDO squares the user must identify before solving.
// Returns { required: string[], categories: { [sq]: 'check'|'capture'|'lpdo' } }
// - check:   destination squares of moves that give check (current player)
// - capture: squares of opponent pieces that can be legally captured (current player)
// - lpdo:    squares of pieces (either side) attacked but undefended by their own color
function computeGate1Squares(fen) {
  const required = []
  const categories = {}
  try {
    const c = new Chess(normalizeFen(fen))

    // CCT from current player's perspective
    const moves = c.moves({ verbose: true })
    for (const m of moves) {
      const isCheck   = m.san.endsWith('+') || m.san.endsWith('#')
      const isCapture = m.flags.includes('c') || m.flags.includes('e')
      if ((isCheck || isCapture) && !categories[m.to]) {
        required.push(m.to)
        categories[m.to] = isCheck ? 'check' : 'capture'
      }
    }

    // LPDO: any piece attacked but not defended by own side
    const files = ['a','b','c','d','e','f','g','h']
    for (let rank = 1; rank <= 8; rank++) {
      for (const file of files) {
        const sq = file + rank
        const piece = c.get(sq)
        if (!piece || categories[sq]) continue  // skip already-listed squares
        const opp = piece.color === 'w' ? 'b' : 'w'
        if (c.isAttacked(sq, opp) && !c.isAttacked(sq, piece.color)) {
          required.push(sq)
          categories[sq] = 'lpdo'
        }
      }
    }
  } catch {}
  return { required, categories }
}

// ---------------------------------------------------------------------------
// Ghost Square: compute squares the moved piece attacks from its destination
// ---------------------------------------------------------------------------

function computeTargetedPieces(fen, fromSq, toSq) {
  try {
    const before = new Chess(normalizeFen(fen))
    const movingSide = before.turn()
    const opponentColor = movingSide === 'w' ? 'b' : 'w'
    const after = new Chess(normalizeFen(fen))
    after.move({ from: fromSq, to: toSq, promotion: 'q' })
    const targets = []
    const files = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']
    for (let rank = 1; rank <= 8; rank++) {
      for (const file of files) {
        const sq = file + rank
        if (sq === toSq) continue
        const piece = after.get(sq)
        if (piece && piece.color === opponentColor && after.isAttacked(sq, movingSide)) {
          targets.push(sq)
        }
      }
    }
    return targets
  } catch { return [] }
}

// ---------------------------------------------------------------------------
// PuzzleBoard sub-component
// ---------------------------------------------------------------------------

function PuzzleBoard({
  puzzle, boardFen, onMove, solved, wrongFlash,
  selectedSquare, legalTargets, lastMoveUci, enginePlaying,
  // analyze mode
  analyzeMode, analyzeInteractive, analyzeSelectedSq, analyzeLegalTargets,
  analyzeLastUci, analyzeIsUserMove, analyzeOnMove,
  // gate 1 (Stoyko CCT)
  gate1Mode, gate1Required, gate1Found, gate1Categories, gate1OnClick,
  // gauntlet mode
  gauntletPhase, gauntletSelectedSq, gauntletLegalTargets, orientationOverride,
  // ghost square
  ghostState, ghostTo, ghostTargets, ghostFound,
  // blind mode
  blindPhase,
}) {
  const position = normalizeFen(boardFen || puzzle.fen)
  const orientation = orientationOverride || boardOrientation(puzzle.fen)
  const customSquareStyles = {}

  if (gate1Mode) {
    // Reveal found squares with category colour; unfound squares stay neutral (user must find them)
    const cats = gate1Categories || {}
    for (const sq of (gate1Found || [])) {
      const cat = cats[sq]
      customSquareStyles[sq] = {
        background: cat === 'check'   ? 'rgba(96, 165, 250, 0.65)'   // blue
          : cat === 'capture' ? 'rgba(248, 113, 113, 0.65)' // red
          : 'rgba(251, 191, 36, 0.65)',                      // amber (lpdo)
      }
    }
  } else if (analyzeMode) {
    // Analyze mode highlights
    if (analyzeSelectedSq) {
      customSquareStyles[analyzeSelectedSq] = { background: 'rgba(255, 215, 0, 0.55)' }
    }
    for (const sq of (analyzeLegalTargets || [])) {
      customSquareStyles[sq] = { background: 'rgba(100, 220, 100, 0.40)' }
    }
    if (analyzeLastUci && analyzeLastUci.length >= 4) {
      const bg = analyzeIsUserMove ? 'rgba(255, 215, 0, 0.45)' : 'rgba(59, 130, 246, 0.45)'
      customSquareStyles[analyzeLastUci.slice(0, 2)] = { background: bg }
      customSquareStyles[analyzeLastUci.slice(2, 4)] = { background: bg }
    }
  } else {
    // Normal puzzle mode highlights
    if (selectedSquare) {
      customSquareStyles[selectedSquare] = { background: 'rgba(255, 215, 0, 0.55)' }
    }
    for (const sq of legalTargets) {
      customSquareStyles[sq] = { background: 'rgba(100, 220, 100, 0.45)' }
    }
    if (lastMoveUci && lastMoveUci.length >= 4) {
      const bg = solved === false ? 'rgba(239, 68, 68, 0.55)' : 'rgba(74, 222, 128, 0.55)'
      customSquareStyles[lastMoveUci.slice(0, 2)] = { background: bg }
      customSquareStyles[lastMoveUci.slice(2, 4)] = { background: bg }
    }
  }

  // Gauntlet: highlight selected piece and legal targets in purple
  if (gauntletPhase === 'active') {
    if (gauntletSelectedSq) {
      customSquareStyles[gauntletSelectedSq] = { background: 'rgba(139, 92, 246, 0.55)' }
    }
    for (const sq of (gauntletLegalTargets || [])) {
      customSquareStyles[sq] = { background: 'rgba(167, 139, 250, 0.35)' }
    }
  }

  // Ghost Square: destination ghost + targets to click
  if (ghostState === 'declaring') {
    if (ghostTo) {
      customSquareStyles[ghostTo] = {
        background: 'rgba(255, 215, 0, 0.22)',
        outline: '2px dashed rgba(255, 215, 0, 0.75)',
        outlineOffset: '-2px',
      }
    }
    for (const sq of (ghostTargets || [])) {
      if (!(ghostFound || []).includes(sq)) {
        customSquareStyles[sq] = { background: 'rgba(251, 146, 60, 0.55)' }
      }
    }
    for (const sq of (ghostFound || [])) {
      customSquareStyles[sq] = { background: 'rgba(74, 222, 128, 0.55)' }
    }
  }

  const customArrows = []
  if (!analyzeMode && !gate1Mode && solved === false && lastMoveUci?.length >= 4) {
    customArrows.push([lastMoveUci.slice(0, 2), lastMoveUci.slice(2, 4), 'rgb(239, 68, 68)'])
  }
  if (analyzeMode && analyzeLastUci?.length >= 4) {
    const arrowColor = analyzeIsUserMove ? 'rgb(234, 179, 8)' : 'rgb(59, 130, 246)'
    customArrows.push([analyzeLastUci.slice(0, 2), analyzeLastUci.slice(2, 4), arrowColor])
  }
  // Gauntlet: arrow showing best defensive move when solved
  if (gauntletPhase === 'solved' && lastMoveUci?.length >= 4) {
    customArrows.push([lastMoveUci.slice(0, 2), lastMoveUci.slice(2, 4), 'rgb(139, 92, 246)'])
  }

  const interactive = gate1Mode ? false
    : analyzeMode ? analyzeInteractive
    : blindPhase === 'scanning' || blindPhase === 'selecting' ? false
    : gauntletPhase === 'active' ? true
    : gauntletPhase === 'fetching' || gauntletPhase === 'solved' ? false
    : (solved === null && !enginePlaying && ghostState !== 'declaring')

  return (
    <div className={`rounded-xl overflow-hidden transition-all ${
      wrongFlash ? 'ring-2 ring-red-500'
      : gate1Mode ? 'ring-2 ring-amber-700/50'
      : gauntletPhase === 'active' ? 'ring-2 ring-violet-600/60'
      : gauntletPhase === 'failed' ? 'ring-2 ring-red-600/50'
      : gauntletPhase === 'solved' ? 'ring-2 ring-emerald-600/50'
      : analyzeMode ? 'ring-2 ring-blue-700/40'
      : ''
    }`}>
      <Chessboard
        options={{
          position,
          boardOrientation: orientation,
          arePiecesDraggable: interactive,
          onPieceDrop: ({ sourceSquare, targetSquare }) => {
            if (analyzeMode) analyzeOnMove(sourceSquare, targetSquare)
            else onMove(sourceSquare, targetSquare)
            return true
          },
          onSquareClick: ({ square }) => {
            if (gate1Mode) { gate1OnClick?.(square); return }
            if (analyzeMode) analyzeOnMove(square, null, true)
            else onMove(square, null, true)
          },
          customSquareStyles,
          customArrows,
          animationDurationInMs: analyzeMode ? 250 : enginePlaying ? 300 : 150,
        }}
      />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function PuzzleTrainer({ userId }) {
  const navigate = useNavigate()

  // Import state
  const [importStatus, setImportStatus] = useState(null)
  const [importing, setImporting] = useState(false)  // false | 'winning' | 'beginners'
  const importPollRef = useRef(null)
  const [books, setBooks] = useState([])

  // Mode / pool selection
  const [mode, setMode] = useState('review')   // 'review' | 'woodpecker'
  const [tier, setTier] = useState(null)        // null | 1 | 2 | 3
  const [pool, setPool] = useState(null)         // null = all, or a source string (filename)
  const [motifFocus, setMotifFocus] = useState(null) // null = all, or a motif string
  const [recommendation, setRecommendation] = useState(null)
  const [trainingRec, setTrainingRec] = useState(null) // training mode recommendation

  // Session state
  const [phase, setPhase] = useState('loading') // loading | import_needed | import_running | ready | session | done
  const [puzzles, setPuzzles] = useState([])
  const [puzzleIdx, setPuzzleIdx] = useState(0)
  const [dueCount, setDueCount] = useState(0)
  const [sessionStats, setSessionStats] = useState({ correct: 0, wrong: 0 })
  const [stats, setStats] = useState(null)

  // Per-puzzle state
  const [solved, setSolved] = useState(null)        // null | true | false
  const [wrongFlash, setWrongFlash] = useState(false)
  const [selectedSquare, setSelectedSquare] = useState(null)
  const [legalTargets, setLegalTargets] = useState([])
  const [motifGuess, setMotifGuess] = useState(null) // null | string
  const [motifResult, setMotifResult] = useState(null) // null | true | false
  const [attempted, setAttempted] = useState(false)
  // Multi-move state
  const [boardFen, setBoardFen] = useState(null)     // live position as moves are played
  const [moveStep, setMoveStep] = useState(0)        // current index in solution_path
  const [enginePlaying, setEnginePlaying] = useState(false)
  const [lastMoveUci, setLastMoveUci] = useState(null)

  // Text input state
  const [moveInput, setMoveInput] = useState('')
  const [moveInputError, setMoveInputError] = useState(false)
  const moveInputRef = useRef(null)

  // Analyze mode — interactive free-play with engine reply
  const [analyzing, setAnalyzing] = useState(false)
  const [analyzeHistory, setAnalyzeHistory] = useState([])
  // { fen_before, fen_after, move_uci, move_san, eval_cp, is_user }
  const [analyzeIdx, setAnalyzeIdx] = useState(-1)       // -1 = initial position
  const [analyzeInitialFen, setAnalyzeInitialFen] = useState(null)
  const [analyzeEngineThinking, setAnalyzeEngineThinking] = useState(false)
  const [analyzeEval, setAnalyzeEval] = useState(null)   // white's POV centipawns
  const [analyzeSelectedSq, setAnalyzeSelectedSq] = useState(null)
  const [analyzeLegalTargets, setAnalyzeLegalTargets] = useState([])

  // Stoyko Mode
  const [stoykoMode, setStoykoMode] = useState(false)
  // 'disabled' | 'gate1' | 'unlocked'
  const [stoykoState, setStoykoState] = useState('disabled')
  const [gate1Required, setGate1Required] = useState([])    // squares user must click
  const [gate1Categories, setGate1Categories] = useState({}) // sq → 'check'|'capture'|'lpdo'
  const [gate1Found, setGate1Found] = useState([])           // correctly clicked squares

  // Timer
  const [timer, setTimer] = useState(0)
  const timerRef = useRef(null)
  const startTimeRef = useRef(null)

  // Defensive Gauntlet Mode
  const [gauntletMode, setGauntletMode] = useState(false)
  const [gauntletPhase, setGauntletPhase] = useState('idle') // 'idle'|'fetching'|'active'|'solved'|'failed'
  const [gauntletDefMove, setGauntletDefMove] = useState(null) // {uci,san,top_lines,fen}
  const [gauntletPendingStep, setGauntletPendingStep] = useState(null) // {nextStep,newFen}
  const [gauntletSelectedSq, setGauntletSelectedSq] = useState(null)
  const [gauntletLegalTargets, setGauntletLegalTargets] = useState([])
  const [gauntletCoachOpen, setGauntletCoachOpen] = useState(false)
  const [gauntletUserNote, setGauntletUserNote] = useState('')
  const [gauntletCoachReply, setGauntletCoachReply] = useState(null)
  const [gauntletCoachLoading, setGauntletCoachLoading] = useState(false)

  // Ghost Square Mode
  const [ghostMode, setGhostMode] = useState(false)
  const [ghostState, setGhostState] = useState('idle') // 'idle'|'declaring'
  const [ghostFrom, setGhostFrom] = useState(null)
  const [ghostTo, setGhostTo] = useState(null)
  const [ghostTargets, setGhostTargets] = useState([])
  const [ghostFound, setGhostFound] = useState([])

  // Timer visibility
  const [hideTimer, setHideTimer] = useState(false)

  // Blind Recognition Mode
  const [blindMode, setBlindMode] = useState(false)
  const [blindPhase, setBlindPhase] = useState('idle') // 'idle'|'scanning'|'selecting'
  const [blindCountdown, setBlindCountdown] = useState(5)
  const [blindOptions, setBlindOptions] = useState([])   // 4 motif keys incl. correct
  const [blindUserMotif, setBlindUserMotif] = useState(null)
  const [blindCorrect, setBlindCorrect] = useState(null)

  const currentPuzzle = puzzles[puzzleIdx] || null

  // ---------------------------------------------------------------------------
  // Import polling
  // ---------------------------------------------------------------------------

  const checkImportStatus = useCallback(async () => {
    try {
      const [statusRes, booksRes] = await Promise.all([
        getPuzzleImportStatus(),
        getPuzzleBooks().catch(() => ({ data: [] })),
      ])
      setImportStatus(statusRes.data)
      setBooks(booksRes.data || [])
      if (statusRes.data.ready) {
        clearInterval(importPollRef.current)
        setPhase('ready')
      } else if (statusRes.data.running) {
        setPhase('import_running')
      } else if (statusRes.data.total_in_db === 0) {
        setPhase('import_needed')
      } else {
        // Puzzles exist but not all analyzed yet
        setPhase('import_running')
      }
    } catch (err) {
      console.error(err)
      setPhase('import_needed')
    }
  }, [])

  useEffect(() => {
    checkImportStatus()
  }, [checkImportStatus])

  // Poll while importing
  useEffect(() => {
    if (phase === 'import_running') {
      importPollRef.current = setInterval(checkImportStatus, 2000)
    }
    return () => clearInterval(importPollRef.current)
  }, [phase, checkImportStatus])

  // ---------------------------------------------------------------------------
  // Session loading
  // ---------------------------------------------------------------------------

  const loadSession = useCallback(async () => {
    if (!userId) return
    setPhase('loading')
    try {
      let res
      if (pool === '__personal__') {
        res = await getPersonalPuzzles(userId, 30)
      } else {
        res = await getPuzzleSession(userId, { n: 20, mode, tier, source: pool, motif: motifFocus })
      }
      const list = res.data.puzzles || []
      setPuzzles(list)
      setPuzzleIdx(0)
      setDueCount(res.data.due || 0)
      setSessionStats({ correct: 0, wrong: 0 })
      setSolved(null)
      setSelectedSquare(null)
      setLegalTargets([])
      setMotifGuess(null)
      setMotifResult(null)
      setAttempted(false)
      setTimer(0)
      setBoardFen(list[0]?.fen ?? null)
      setMoveStep(0)
      setEnginePlaying(false)
      setLastMoveUci(null)
      startTimeRef.current = Date.now()
      setPhase(list.length === 0 ? 'ready' : 'session')
    } catch (err) {
      console.error(err)
      setPhase('ready')
    }
  }, [userId, mode, tier, pool, motifFocus])

  const loadStats = useCallback(async () => {
    if (!userId) return
    try {
      const [statsRes, recRes, modeRecRes] = await Promise.all([
        getPuzzleStats(userId),
        getPuzzleRecommendation(userId).catch(() => null),
        getTrainingModeRecommendation(userId).catch(() => null),
      ])
      setStats(statsRes.data)
      if (recRes) setRecommendation(recRes.data)
      if (modeRecRes) setTrainingRec(modeRecRes.data)
    } catch {}
  }, [userId])

  // Reset board state when puzzle changes
  useEffect(() => {
    if (currentPuzzle) {
      setBoardFen(currentPuzzle.fen)
      setMoveStep(0)
      setEnginePlaying(false)
      setLastMoveUci(null)
      setMoveInput('')
      setMoveInputError(false)
      setAnalyzing(false)
      setAnalyzeHistory([])
      setAnalyzeIdx(-1)
      setAnalyzeInitialFen(null)
      setAnalyzeEngineThinking(false)
      setAnalyzeEval(null)
      setAnalyzeSelectedSq(null)
      setAnalyzeLegalTargets([])
      // Stoyko init
      if (stoykoMode) {
        const { required, categories } = computeGate1Squares(currentPuzzle.fen)
        setGate1Required(required)
        setGate1Categories(categories)
        setGate1Found([])
        setStoykoState(required.length > 0 ? 'gate1' : 'unlocked')
      } else {
        setGate1Required([])
        setGate1Categories({})
        setGate1Found([])
        setStoykoState('disabled')
      }
      // Blind Recognition init
      if (blindMode) {
        const correct = currentPuzzle.motif || 'combination'
        const others = MOTIF_KEYS.filter(m => m !== correct)
        const distractors = [...others].sort(() => Math.random() - 0.5).slice(0, 3)
        const opts = [correct, ...distractors].sort(() => Math.random() - 0.5)
        setBlindOptions(opts)
        setBlindUserMotif(null)
        setBlindCorrect(null)
        setBlindCountdown(5)
        setBlindPhase('scanning')
      } else {
        setBlindPhase('idle')
        setBlindOptions([])
        setBlindUserMotif(null)
        setBlindCorrect(null)
      }
      // Reset gauntlet + ghost state
      setGauntletPhase('idle')
      setGauntletDefMove(null)
      setGauntletPendingStep(null)
      setGauntletSelectedSq(null)
      setGauntletLegalTargets([])
      setGauntletCoachOpen(false)
      setGauntletUserNote('')
      setGauntletCoachReply(null)
      setGhostState('idle')
      setGhostFrom(null); setGhostTo(null); setGhostTargets([]); setGhostFound([])
    }
  }, [currentPuzzle?.id, stoykoMode])  // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-focus text input when it becomes interactive
  useEffect(() => {
    if (!enginePlaying && solved === null) {
      moveInputRef.current?.focus()
    }
  }, [enginePlaying, solved, puzzleIdx])

  // ---------------------------------------------------------------------------
  // Timer effect
  // ---------------------------------------------------------------------------

  useEffect(() => {
    if (phase !== 'session' || solved !== null) {
      clearInterval(timerRef.current)
      return
    }
    startTimeRef.current = Date.now()
    setTimer(0)
    timerRef.current = setInterval(() => {
      setTimer(Math.floor((Date.now() - startTimeRef.current) / 1000))
    }, 1000)
    return () => clearInterval(timerRef.current)
  }, [phase, puzzleIdx, solved])

  // ---------------------------------------------------------------------------
  // Blind Recognition countdown
  // ---------------------------------------------------------------------------

  useEffect(() => {
    if (blindPhase !== 'scanning') return
    if (blindCountdown <= 0) { setBlindPhase('selecting'); return }
    const t = setTimeout(() => setBlindCountdown(c => c - 1), 1000)
    return () => clearTimeout(t)
  }, [blindPhase, blindCountdown])

  const handleBlindMotifSelect = useCallback((motif) => {
    if (blindUserMotif !== null || !currentPuzzle) return
    const correct = currentPuzzle.motif || 'combination'
    setBlindUserMotif(motif)
    setBlindCorrect(motif === correct)
    setTimeout(() => setBlindPhase('idle'), 1600)
  }, [blindUserMotif, currentPuzzle])

  // ---------------------------------------------------------------------------
  // Move handling (multi-move combinations)
  // ---------------------------------------------------------------------------

  // Returns number of moves the USER must play in this puzzle
  const getUserMoveCount = useCallback((puzzle) => {
    const path = puzzle?.solution_path || (puzzle?.best_move_uci ? [puzzle.best_move_uci] : [])
    // User plays every other move starting at index 0; engine replies fill the gaps
    return Math.ceil(path.length / 2)
  }, [])

  // Convert a list of UCI moves to SAN starting from a given FEN
  const uciListToSan = useCallback((fen, ucis) => {
    try {
      const c = new Chess(normalizeFen(fen))
      return ucis.map(uci => {
        const m = c.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] ?? 'q' })
        return m?.san ?? uci
      })
    } catch { return ucis }
  }, [])

  // Apply a UCI move to a FEN and return the new FEN
  const applyMove = useCallback((fen, uci) => {
    try {
      const c = new Chess(normalizeFen(fen))
      c.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] ?? 'q' })
      return c.fen()
    } catch { return fen }
  }, [])

  // ---------------------------------------------------------------------------
  // Gauntlet Mode — defined before submitUserMove (which references resumeAfterGauntlet)
  // ---------------------------------------------------------------------------

  // Resume normal puzzle flow after gauntlet finishes (right or skipped).
  // `pending` = { nextStep, newFen } captured at gauntlet entry.
  const resumeAfterGauntlet = useCallback((pending) => {
    setGauntletPhase('idle')
    setGauntletDefMove(null)
    setGauntletPendingStep(null)
    setGauntletSelectedSq(null)
    setGauntletLegalTargets([])
    setGauntletCoachOpen(false)
    setGauntletUserNote('')
    setGauntletCoachReply(null)

    if (!pending || !currentPuzzle) return
    const solutionPath = currentPuzzle.solution_path || (currentPuzzle.best_move_uci ? [currentPuzzle.best_move_uci] : [])
    if (pending.nextStep < solutionPath.length) {
      setBoardFen(pending.newFen)     // restore to PGN track
      setLastMoveUci(null)
      setEnginePlaying(true)
      setTimeout(() => {
        const engineMove = solutionPath[pending.nextStep]
        const fenAfterEngine = applyMove(pending.newFen, engineMove)
        setBoardFen(fenAfterEngine)
        setLastMoveUci(engineMove)
        setMoveStep(pending.nextStep + 1)
        setEnginePlaying(false)
      }, 600)
    }
  }, [currentPuzzle, applyMove])

  const handleGauntletMove = useCallback((from, to) => {
    if (gauntletPhase !== 'active' || !gauntletDefMove) return
    const fen = boardFen || currentPuzzle?.fen
    if (!fen) return
    const c = new Chess(normalizeFen(fen))
    const lm = c.moves({ square: from, verbose: true }).find(m => m.to === to)
    if (!lm) return

    const playedUci = from + to
    if (playedUci.slice(0, 4) === gauntletDefMove.uci.slice(0, 4)) {
      // Correct defense!
      const fenAfterDef = applyMove(fen, gauntletDefMove.uci)
      setBoardFen(fenAfterDef)
      setLastMoveUci(gauntletDefMove.uci)
      setGauntletSelectedSq(null); setGauntletLegalTargets([])
      setGauntletPhase('solved')
      const pending = gauntletPendingStep
      setTimeout(() => resumeAfterGauntlet(pending), 1100)
    } else {
      // Wrong defensive move
      setGauntletSelectedSq(null); setGauntletLegalTargets([])
      setGauntletPhase('failed')
    }
  }, [gauntletPhase, gauntletDefMove, gauntletPendingStep, boardFen, currentPuzzle, applyMove, resumeAfterGauntlet])

  const handleAskGauntletCoach = useCallback(async () => {
    if (!gauntletDefMove || gauntletCoachLoading) return
    setGauntletCoachLoading(true)
    try {
      const res = await getGauntletCoach(
        gauntletDefMove.fen,
        '?',
        gauntletDefMove.san,
        gauntletDefMove.top_lines || [],
        gauntletUserNote,
      )
      setGauntletCoachReply(res.data.explanation || null)
    } catch {
      setGauntletCoachReply('Coach is unavailable right now. Study the engine lines above.')
    } finally {
      setGauntletCoachLoading(false)
    }
  }, [gauntletDefMove, gauntletUserNote, gauntletCoachLoading])

  const submitUserMove = useCallback((from, to) => {
    if (!currentPuzzle || solved !== null || enginePlaying) return
    if (stoykoMode && stoykoState !== 'unlocked' && stoykoState !== 'disabled') return
    if (gauntletPhase === 'fetching') return   // gauntlet loading — block input

    const fen = boardFen || currentPuzzle.fen
    const c = new Chess(normalizeFen(fen))
    const lm = c.moves({ square: from, verbose: true }).find(m => m.to === to)
    if (!lm) return

    const solutionPath = currentPuzzle.solution_path || [currentPuzzle.best_move_uci]
    const expectedUci = solutionPath[moveStep] || ''
    const playedUci = from + to  // compare first 4 chars (ignore promotion letter)

    if (playedUci.slice(0, 4) !== expectedUci.slice(0, 4)) {
      // Wrong move
      setWrongFlash(true)
      setTimeout(() => setWrongFlash(false), 600)
      setLastMoveUci(expectedUci) // highlight the correct move
      setSolved(false)
      if (!attempted) {
        setAttempted(true)
        const solveTime = (Date.now() - startTimeRef.current) / 1000
        clearInterval(timerRef.current)
        recordPuzzleAttempt(userId, currentPuzzle.id, { solved: false, solve_time: solveTime }).catch(console.error)
        setSessionStats(s => ({ ...s, wrong: s.wrong + 1 }))
      }
      return
    }

    // Correct user move — apply it
    const newFen = applyMove(fen, expectedUci)
    setBoardFen(newFen)
    setLastMoveUci(expectedUci)
    const nextStep = moveStep + 1
    setMoveStep(nextStep)
    setSelectedSquare(null)
    setLegalTargets([])

    const totalUserMoves = getUserMoveCount(currentPuzzle)
    const userMovesPlayed = Math.ceil(nextStep / 2)

    if (userMovesPlayed >= totalUserMoves) {
      // All user moves done — puzzle complete
      setSolved(true)
      clearInterval(timerRef.current)
      const solveTime = (Date.now() - startTimeRef.current) / 1000
      if (!attempted) {
        setAttempted(true)
        recordPuzzleAttempt(userId, currentPuzzle.id, { solved: true, solve_time: solveTime }).catch(console.error)
        setSessionStats(s => ({ ...s, correct: s.correct + 1 }))
      }
      return
    }

    // Gauntlet: intercept before engine response — ask user to find best defensive reply
    if (gauntletMode && nextStep < solutionPath.length && gauntletPhase === 'idle') {
      const pending = { nextStep, newFen }
      setGauntletPhase('fetching')
      setGauntletPendingStep(pending)
      analyzePositionMulti(newFen, 16, 3)
        .then(res => {
          const lines = res.data?.lines || []
          if (lines.length > 0) {
            const best = lines[0]
            setGauntletDefMove({ uci: best.move_uci, san: best.move_san, top_lines: lines, fen: newFen })
            setGauntletPhase('active')
          } else {
            resumeAfterGauntlet(pending)
          }
        })
        .catch(() => resumeAfterGauntlet(pending))
      return
    }

    // Play engine response if available
    if (nextStep < solutionPath.length) {
      setEnginePlaying(true)
      setTimeout(() => {
        const engineMove = solutionPath[nextStep]
        const fenAfterEngine = applyMove(newFen, engineMove)
        setBoardFen(fenAfterEngine)
        setLastMoveUci(engineMove)
        setMoveStep(nextStep + 1)
        setEnginePlaying(false)
      }, 600)
    }
  }, [currentPuzzle, solved, enginePlaying, boardFen, moveStep, attempted, userId, applyMove, getUserMoveCount, gauntletMode, gauntletPhase, resumeAfterGauntlet])

  const handleMove = useCallback((from, to, isClick = false) => {
    if (!currentPuzzle || solved !== null || enginePlaying) return

    // ── Gauntlet active: route all input to gauntlet handler ──
    if (gauntletPhase === 'active') {
      if (isClick) {
        const sq = from
        const fen = boardFen || currentPuzzle.fen
        const nfen = normalizeFen(fen)
        if (!gauntletSelectedSq) {
          const c = new Chess(nfen)
          const piece = c.get(sq)
          const activeColor = nfen.split(' ')[1]
          if (piece && piece.color === activeColor) {
            setGauntletSelectedSq(sq)
            setGauntletLegalTargets(c.moves({ square: sq, verbose: true }).map(m => m.to))
          }
          return
        }
        if (gauntletSelectedSq === sq) {
          setGauntletSelectedSq(null); setGauntletLegalTargets([]); return
        }
        if (gauntletLegalTargets.includes(sq)) {
          handleGauntletMove(gauntletSelectedSq, sq)
          setGauntletSelectedSq(null); setGauntletLegalTargets([])
        } else {
          const c = new Chess(nfen)
          const piece = c.get(sq)
          const activeColor = nfen.split(' ')[1]
          if (piece && piece.color === activeColor) {
            setGauntletSelectedSq(sq)
            setGauntletLegalTargets(c.moves({ square: sq, verbose: true }).map(m => m.to))
          } else {
            setGauntletSelectedSq(null); setGauntletLegalTargets([])
          }
        }
        return
      }
      handleGauntletMove(from, to)
      return
    }

    if (isClick) {
      // ── Ghost Square declaring: user must click all targeted pieces ──
      if (ghostMode && ghostState === 'declaring') {
        const sq = from
        if (ghostTargets.includes(sq) && !ghostFound.includes(sq)) {
          const newFound = [...ghostFound, sq]
          setGhostFound(newFound)
          if (newFound.length >= ghostTargets.length) {
            submitUserMove(ghostFrom, ghostTo)
            setGhostState('idle')
            setGhostFrom(null); setGhostTo(null); setGhostTargets([]); setGhostFound([])
            setSelectedSquare(null); setLegalTargets([])
          }
        }
        return
      }

      const square = from
      const fen = boardFen || currentPuzzle.fen
      const nfen = normalizeFen(fen)
      if (!selectedSquare) {
        const c = new Chess(nfen)
        const piece = c.get(square)
        const activeColor = nfen.split(' ')[1]
        if (piece && piece.color === activeColor) {
          setSelectedSquare(square)
          setLegalTargets(c.moves({ square, verbose: true }).map(m => m.to))
        }
        return
      }
      if (selectedSquare === square) {
        setSelectedSquare(null); setLegalTargets([]); return
      }
      if (legalTargets.includes(square)) {
        if (ghostMode && ghostState === 'idle') {
          // Ghost Square: compute targets before executing
          const targets = computeTargetedPieces(nfen, selectedSquare, square)
          if (targets.length === 0) {
            submitUserMove(selectedSquare, square)
            setSelectedSquare(null); setLegalTargets([])
          } else {
            setGhostFrom(selectedSquare)
            setGhostTo(square)
            setGhostTargets(targets)
            setGhostFound([])
            setGhostState('declaring')
            setSelectedSquare(null); setLegalTargets([])
          }
        } else {
          submitUserMove(selectedSquare, square)
        }
      } else {
        const c = new Chess(nfen)
        const piece = c.get(square)
        const activeColor = nfen.split(' ')[1]
        if (piece && piece.color === activeColor) {
          setSelectedSquare(square)
          setLegalTargets(c.moves({ square, verbose: true }).map(m => m.to))
        } else {
          setSelectedSquare(null); setLegalTargets([])
        }
      }
      return
    }
    submitUserMove(from, to)
  }, [
    currentPuzzle, solved, enginePlaying, boardFen, selectedSquare, legalTargets,
    gauntletPhase, gauntletSelectedSq, gauntletLegalTargets, handleGauntletMove,
    ghostMode, ghostState, ghostFrom, ghostTo, ghostTargets, ghostFound,
    submitUserMove,
  ])

  const handleSanSubmit = useCallback(() => {
    if (!currentPuzzle || solved !== null || enginePlaying) return
    const san = moveInput.trim()
    if (!san) return

    const fen = boardFen || currentPuzzle.fen
    const c = new Chess(normalizeFen(fen))
    let move
    try { move = c.move(san) } catch { move = null }
    if (!move) {
      // Invalid SAN — flash red briefly
      setMoveInputError(true)
      setTimeout(() => setMoveInputError(false), 600)
      return
    }
    setMoveInput('')
    setMoveInputError(false)
    submitUserMove(move.from, move.to)
  }, [currentPuzzle, solved, enginePlaying, boardFen, moveInput, submitUserMove])

  // ---------------------------------------------------------------------------
  // Stoyko Mode logic
  // ---------------------------------------------------------------------------

  const handleGate1Click = useCallback((sq) => {
    if (stoykoState !== 'gate1') return
    if (gate1Found.includes(sq)) return
    if (!gate1Required.includes(sq)) return  // wrong click — silently ignore

    const newFound = [...gate1Found, sq]
    setGate1Found(newFound)
    if (newFound.length >= gate1Required.length) {
      // All CCT + LPDO squares found — unlock puzzle after brief visual pause
      setTimeout(() => setStoykoState('unlocked'), 500)
    }
  }, [stoykoState, gate1Found, gate1Required])

  // ---------------------------------------------------------------------------
  // Derived analyze values
  const analyzeCurrentFen = analyzing
    ? (analyzeIdx >= 0 ? analyzeHistory[analyzeIdx]?.fen_after : analyzeInitialFen)
    : null

  const isAnalyzeAtEnd = analyzeIdx === analyzeHistory.length - 1
  const isAnalyzeInteractive = analyzing && !analyzeEngineThinking && isAnalyzeAtEnd

  const handleAnalyze = useCallback(() => {
    if (!currentPuzzle) return
    const initialFen = normalizeFen(currentPuzzle.fen)
    setAnalyzeHistory([])
    setAnalyzeIdx(-1)
    setAnalyzeInitialFen(initialFen)
    setAnalyzeEngineThinking(false)
    setAnalyzeEval(null)
    setAnalyzeSelectedSq(null)
    setAnalyzeLegalTargets([])
    setAnalyzing(true)
  }, [currentPuzzle])

  const stopAnalyze = useCallback(() => {
    setAnalyzing(false)
    setAnalyzeHistory([])
    setAnalyzeIdx(-1)
    setAnalyzeEngineThinking(false)
    setAnalyzeEval(null)
    setAnalyzeSelectedSq(null)
    setAnalyzeLegalTargets([])
  }, [])

  const handleAnalyzeNav = useCallback((delta) => {
    setAnalyzeSelectedSq(null)
    setAnalyzeLegalTargets([])
    setAnalyzeIdx(idx => {
      const next = Math.max(-1, Math.min(analyzeHistory.length - 1, idx + delta))
      // Update eval display to match the navigated position
      if (next >= 0) setAnalyzeEval(analyzeHistory[next]?.eval_cp ?? null)
      else setAnalyzeEval(null)
      return next
    })
  }, [analyzeHistory])

  // Submit a user move in analyze mode: evaluate → play engine reply
  const submitAnalyzeMove = useCallback(async (from, to) => {
    const fen = analyzeCurrentFen
    if (!fen || analyzeEngineThinking) return

    const c = new Chess(normalizeFen(fen))
    let move
    try { move = c.move({ from, to, promotion: 'q' }) } catch { return }
    if (!move) return

    const fenAfterUser = c.fen()
    const userEntry = {
      fen_before: fen,
      fen_after: fenAfterUser,
      move_uci: from + to,
      move_san: move.san,
      eval_cp: null,
      is_user: true,
    }

    // Branch: replace any forward history
    setAnalyzeHistory(h => {
      const base = analyzeIdx >= 0 ? h.slice(0, analyzeIdx + 1) : []
      return [...base, userEntry]
    })
    setAnalyzeIdx(analyzeIdx >= 0 ? analyzeIdx + 1 : 0)
    setAnalyzeSelectedSq(null)
    setAnalyzeLegalTargets([])
    setAnalyzeEngineThinking(true)

    try {
      const res = await analyzePosition(fenAfterUser, 16)
      const { eval_cp, best_move_uci, best_move_san, game_over } = res.data

      // Update user entry with eval
      setAnalyzeEval(eval_cp)
      setAnalyzeHistory(h => h.map((e, i) => {
        // Find the entry we just added (it's the last one with fen_before === fen)
        if (e.fen_before === fen && e.move_uci === from + to && e.eval_cp === null)
          return { ...e, eval_cp }
        return e
      }))

      if (game_over || !best_move_uci) {
        setAnalyzeEngineThinking(false)
        return
      }

      // Engine plays after short delay
      setTimeout(() => {
        const c2 = new Chess(normalizeFen(fenAfterUser))
        let engineMove
        try {
          engineMove = c2.move({ from: best_move_uci.slice(0, 2), to: best_move_uci.slice(2, 4), promotion: best_move_uci[4] ?? 'q' })
        } catch { setAnalyzeEngineThinking(false); return }

        const fenAfterEngine = c2.fen()
        const engineEntry = {
          fen_before: fenAfterUser,
          fen_after: fenAfterEngine,
          move_uci: best_move_uci,
          move_san: engineMove?.san ?? best_move_san,
          eval_cp: null,   // will be filled on next user move analysis
          is_user: false,
        }
        setAnalyzeHistory(h => [...h, engineEntry])
        setAnalyzeIdx(h => h + 1)   // will be set via functional form below
        setAnalyzeHistory(h => {
          setAnalyzeIdx(h.length - 1)
          return h
        })
        setAnalyzeEngineThinking(false)
      }, 700)
    } catch {
      setAnalyzeEngineThinking(false)
    }
  }, [analyzeCurrentFen, analyzeIdx, analyzeEngineThinking])

  const handleAnalyzeMove = useCallback((from, to, isClick = false) => {
    if (!isAnalyzeInteractive) return

    if (isClick) {
      const sq = from
      if (!analyzeSelectedSq) {
        const c = new Chess(normalizeFen(analyzeCurrentFen))
        const piece = c.get(sq)
        const activeColor = analyzeCurrentFen.split(' ')[1]
        if (piece && piece.color === activeColor) {
          setAnalyzeSelectedSq(sq)
          setAnalyzeLegalTargets(c.moves({ square: sq, verbose: true }).map(m => m.to))
        }
        return
      }
      if (analyzeSelectedSq === sq) {
        setAnalyzeSelectedSq(null); setAnalyzeLegalTargets([]); return
      }
      if (analyzeLegalTargets.includes(sq)) {
        submitAnalyzeMove(analyzeSelectedSq, sq)
      } else {
        const c = new Chess(normalizeFen(analyzeCurrentFen))
        const piece = c.get(sq)
        const activeColor = analyzeCurrentFen.split(' ')[1]
        if (piece && piece.color === activeColor) {
          setAnalyzeSelectedSq(sq)
          setAnalyzeLegalTargets(c.moves({ square: sq, verbose: true }).map(m => m.to))
        } else {
          setAnalyzeSelectedSq(null); setAnalyzeLegalTargets([])
        }
      }
      return
    }
    submitAnalyzeMove(from, to)
  }, [isAnalyzeInteractive, analyzeSelectedSq, analyzeLegalTargets, analyzeCurrentFen, submitAnalyzeMove])

  const handleMotifGuess = useCallback((guessedMotif) => {
    if (!currentPuzzle || motifGuess !== null) return
    setMotifGuess(guessedMotif)
    setMotifResult(guessedMotif === currentPuzzle.motif)
  }, [currentPuzzle, motifGuess])

  const handleNext = useCallback(() => {
    const nextIdx = puzzleIdx + 1
    if (nextIdx >= puzzles.length) {
      loadStats()
      setPhase('done')
    } else {
      setPuzzleIdx(nextIdx)
      setSolved(null)
      setWrongFlash(false)
      setSelectedSquare(null)
      setLegalTargets([])
      setMotifGuess(null)
      setMotifResult(null)
      setAttempted(false)
      setTimer(0)
      setBoardFen(puzzles[nextIdx]?.fen ?? null)
      setMoveStep(0)
      setEnginePlaying(false)
      setLastMoveUci(null)
      setGauntletPhase('idle'); setGauntletDefMove(null); setGauntletPendingStep(null)
      setGauntletSelectedSq(null); setGauntletLegalTargets([])
      setGhostState('idle'); setGhostFrom(null); setGhostTo(null); setGhostTargets([]); setGhostFound([])
    }
  }, [puzzleIdx, puzzles, loadStats])

  const handleTryAgain = useCallback(() => {
    setSolved(null)
    setWrongFlash(false)
    setSelectedSquare(null)
    setLegalTargets([])
    setMoveStep(0)
    setEnginePlaying(false)
    setLastMoveUci(null)
    setBoardFen(currentPuzzle?.fen ?? null)
    setMoveInput('')
    setMoveInputError(false)
    startTimeRef.current = Date.now()
    setTimer(0)
    setAttempted(false)
    setGauntletPhase('idle'); setGauntletDefMove(null); setGauntletPendingStep(null)
    setGauntletSelectedSq(null); setGauntletLegalTargets([])
    setGauntletCoachOpen(false); setGauntletUserNote(''); setGauntletCoachReply(null)
    setGhostState('idle'); setGhostFrom(null); setGhostTo(null); setGhostTargets([]); setGhostFound([])
    // Re-run Stoyko gate on retry
    if (stoykoMode && currentPuzzle) {
      const { required, categories } = computeGate1Squares(currentPuzzle.fen)
      setGate1Required(required)
      setGate1Categories(categories)
      setGate1Found([])
      setStoykoState(required.length > 0 ? 'gate1' : 'unlocked')
    }
  }, [currentPuzzle, stoykoMode])

  const handleSkip = useCallback(() => {
    if (!attempted && currentPuzzle) {
      const solveTime = (Date.now() - startTimeRef.current) / 1000
      recordPuzzleAttempt(userId, currentPuzzle.id, {
        solved: false,
        solve_time: solveTime,
        motif_guess: null,
      }).catch(console.error)
    }
    handleNext()
  }, [currentPuzzle, userId, attempted, handleNext])

  // ---------------------------------------------------------------------------
  // Import handler
  // ---------------------------------------------------------------------------

  const handleImport = async (filename) => {
    setImporting(filename)
    try {
      await startPuzzleImport(filename)
      setPhase('import_running')
    } catch (err) {
      alert(err.response?.data?.detail || err.message)
    } finally {
      setImporting(false)
    }
  }

  // ---------------------------------------------------------------------------
  // Render phases
  // ---------------------------------------------------------------------------

  const sessionAccuracy = sessionStats.correct + sessionStats.wrong > 0
    ? Math.round(100 * sessionStats.correct / (sessionStats.correct + sessionStats.wrong))
    : null

  return (
    <div className="min-h-screen bg-chess-dark text-slate-100 p-4">
      <div className="max-w-5xl mx-auto">

        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <button
            onClick={() => navigate('/')}
            className="flex items-center gap-2 text-slate-400 hover:text-slate-100 transition-colors"
          >
            <ArrowLeft size={18} /> Dashboard
          </button>
          <h1 className="text-xl font-bold text-chess-gold flex items-center gap-2">
            <Target size={20} /> Puzzle Trainer
          </h1>
          <div className="w-24" />
        </div>

        {/* Loading */}
        {phase === 'loading' && (
          <div className="flex items-center justify-center py-32 text-slate-400">
            <RefreshCw size={20} className="animate-spin mr-3" />
            Loading…
          </div>
        )}

        {/* Import needed */}
        {phase === 'import_needed' && (
          <BookImportScreen books={books} importing={importing} onImport={handleImport} />
        )}

        {/* Import running */}
        {phase === 'import_running' && (
          <div className="flex flex-col items-center justify-center py-32 text-center">
            <RefreshCw size={48} className="text-chess-gold animate-spin mb-6" />
            {importStatus?.queued_total > 0 ? (
              <>
                <h2 className="text-xl font-bold text-white mb-2">Importing Puzzles…</h2>
                <p className="text-slate-400 text-sm mb-6">
                  Engine is analyzing each position at depth 18. This takes a few minutes.
                </p>
                <div className="w-80 bg-slate-700 rounded-full h-3 mb-3 overflow-hidden">
                  <div
                    className="h-3 rounded-full bg-chess-gold transition-all"
                    style={{ width: `${Math.round(100 * importStatus.queued_done / importStatus.queued_total)}%` }}
                  />
                </div>
                <p className="text-xs text-slate-500">
                  {importStatus.queued_done} / {importStatus.queued_total} analyzed
                </p>
              </>
            ) : (
              <>
                <h2 className="text-xl font-bold text-white mb-2">Indexing Puzzles…</h2>
                <p className="text-slate-400 text-sm mb-6">
                  Linking puzzles to this book. Already-analyzed positions are reused instantly.
                </p>
                {importStatus?.resourced > 0 && (
                  <p className="text-xs text-slate-500">{importStatus.resourced} puzzles re-indexed</p>
                )}
              </>
            )}
            {importStatus?.error && (
              <div className="mt-4 flex items-center gap-2 text-red-400 text-sm">
                <AlertTriangle size={16} />
                {importStatus.error}
              </div>
            )}
          </div>
        )}

        {/* Mode selector (ready state) */}
        {phase === 'ready' && (
          <ModeSelector
            mode={mode}
            setMode={setMode}
            tier={tier}
            setTier={setTier}
            pool={pool}
            setPool={setPool}
            books={books}
            motifFocus={motifFocus}
            setMotifFocus={setMotifFocus}
            recommendation={recommendation}
            dueCount={importStatus?.ready ? dueCount : 0}
            importStatus={importStatus}
            importing={importing}
            onImport={handleImport}
            stats={stats}
            onStart={loadSession}
            onLoadStats={loadStats}
            userId={userId}
            stoykoMode={stoykoMode}
            setStoykoMode={setStoykoMode}
            gauntletMode={gauntletMode}
            setGauntletMode={setGauntletMode}
            ghostMode={ghostMode}
            setGhostMode={setGhostMode}
            hideTimer={hideTimer}
            setHideTimer={setHideTimer}
            blindMode={blindMode}
            setBlindMode={setBlindMode}
            trainingRec={trainingRec}
          />
        )}

        {/* Done */}
        {phase === 'done' && (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <CheckCircle size={56} className="text-emerald-400 mb-6" />
            <h2 className="text-2xl font-bold text-white mb-2">Session Complete!</h2>
            <p className="text-slate-400 text-sm mb-2">
              {sessionStats.correct + sessionStats.wrong} puzzles · {sessionStats.correct} correct
              {sessionAccuracy !== null && ` · ${sessionAccuracy}% accuracy`}
            </p>
            {stats && (
              <div className="mt-4 mb-8 grid grid-cols-2 gap-4 w-full max-w-sm">
                <StatBox label="Total attempts" value={stats.total_attempts} />
                <StatBox label="Floor score" value={`${stats.floor_score}%`} accent="text-chess-gold" />
              </div>
            )}
            {stats?.heatmap && Object.keys(stats.heatmap).length > 0 && (
              <div className="mb-8 w-full max-w-lg">
                <h3 className="text-sm font-semibold text-slate-400 mb-3 text-left">Motif Accuracy</h3>
                <div className="grid grid-cols-2 gap-2">
                  {Object.entries(stats.heatmap).map(([motif, d]) => {
                    const meta = MOTIF_META[motif] || MOTIF_META.combination
                    return (
                      <div key={motif} className={`border rounded-lg px-3 py-2 text-xs ${meta.color}`}>
                        <div className="font-semibold mb-0.5">{meta.label}</div>
                        <div className="opacity-80">{d.accuracy}% · {d.attempts} tried · avg {d.avg_time}s</div>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}
            <div className="flex gap-3">
              <button
                onClick={loadSession}
                className="px-6 py-2.5 rounded-xl bg-chess-gold text-chess-dark font-semibold hover:opacity-90"
              >
                Another session
              </button>
              <button
                onClick={() => navigate('/')}
                className="px-6 py-2.5 rounded-xl bg-chess-panel text-slate-300 hover:bg-white/10 transition-colors"
              >
                Dashboard
              </button>
            </div>
          </div>
        )}

        {/* Active session */}
        {phase === 'session' && currentPuzzle && (
          <div>
            {/* Progress bar */}
            <div className="mb-4">
              <div className="flex items-center justify-between text-xs text-slate-500 mb-1">
                <span>{puzzleIdx + 1} / {puzzles.length}</span>
                {sessionAccuracy !== null && (
                  <span className="text-slate-400">{sessionAccuracy}% accuracy this session</span>
                )}
                {dueCount > 0 && mode === 'review' && (
                  <span className="text-yellow-400">{dueCount} due</span>
                )}
              </div>
              <div className="w-full bg-slate-700 rounded-full h-1.5 overflow-hidden">
                <div
                  className="h-1.5 rounded-full bg-chess-gold transition-all"
                  style={{ width: `${((puzzleIdx) / puzzles.length) * 100}%` }}
                />
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Board column */}
              <div>
                <div className="relative">
                <PuzzleBoard
                  puzzle={currentPuzzle}
                  boardFen={analyzing ? analyzeCurrentFen : boardFen}
                  onMove={handleMove}
                  solved={analyzing ? null : solved}
                  wrongFlash={analyzing ? false : wrongFlash}
                  selectedSquare={analyzing ? null : selectedSquare}
                  legalTargets={analyzing ? [] : legalTargets}
                  lastMoveUci={analyzing ? null : lastMoveUci}
                  enginePlaying={analyzing ? false : enginePlaying}
                  analyzeMode={analyzing}
                  analyzeInteractive={isAnalyzeInteractive}
                  analyzeSelectedSq={analyzeSelectedSq}
                  analyzeLegalTargets={analyzeLegalTargets}
                  analyzeLastUci={analyzing && analyzeIdx >= 0 ? analyzeHistory[analyzeIdx]?.move_uci : null}
                  analyzeIsUserMove={analyzing && analyzeIdx >= 0 ? analyzeHistory[analyzeIdx]?.is_user : false}
                  analyzeOnMove={handleAnalyzeMove}
                  gate1Mode={stoykoState === 'gate1'}
                  gate1Required={gate1Required}
                  gate1Categories={gate1Categories}
                  gate1Found={gate1Found}
                  gate1OnClick={handleGate1Click}
                  gauntletPhase={gauntletPhase}
                  gauntletSelectedSq={gauntletSelectedSq}
                  gauntletLegalTargets={gauntletLegalTargets}
                  orientationOverride={
                    gauntletPhase === 'active' || gauntletPhase === 'solved' || gauntletPhase === 'failed'
                      ? (boardOrientation(currentPuzzle.fen) === 'white' ? 'black' : 'white')
                      : null
                  }
                  ghostState={ghostState}
                  ghostTo={ghostTo}
                  ghostTargets={ghostTargets}
                  ghostFound={ghostFound}
                  blindPhase={blindPhase}
                />

                {/* Blind Recognition — scanning countdown (transparent so board is visible) */}
                {blindMode && blindPhase === 'scanning' && (
                  <div className="absolute inset-0 flex items-end justify-center pb-5 pointer-events-none z-10">
                    <div className="bg-black/80 rounded-2xl px-8 py-4 text-center shadow-xl">
                      <p className="text-xs text-slate-400 mb-1 tracking-wide uppercase">Study the position</p>
                      <p className="text-5xl font-bold text-chess-gold leading-none">{blindCountdown}</p>
                    </div>
                  </div>
                )}

                {/* Blind Recognition — motif selection overlay (fully opaque — board hidden) */}
                {blindMode && blindPhase === 'selecting' && (
                  <div className="absolute inset-0 bg-chess-dark rounded-xl z-10 flex flex-col items-center justify-center gap-5 p-6">
                    <div className="flex items-center gap-2 text-slate-200 font-semibold">
                      <Brain size={18} className="text-chess-gold" />
                      What tactic is available?
                    </div>
                    <div className="grid grid-cols-2 gap-3 w-full">
                      {blindOptions.map(motif => {
                        const isCorrect = motif === (currentPuzzle?.motif || 'combination')
                        const isChosen = motif === blindUserMotif
                        let cls = 'bg-slate-800 border-slate-600 text-slate-200 hover:border-chess-gold/50 hover:bg-slate-700 cursor-pointer'
                        if (blindUserMotif !== null) {
                          if (isCorrect) cls = 'bg-emerald-900/60 border-emerald-500 text-emerald-300 cursor-default'
                          else if (isChosen) cls = 'bg-red-900/60 border-red-500 text-red-300 cursor-default'
                          else cls = 'bg-slate-800/40 border-slate-700/50 text-slate-600 cursor-default'
                        }
                        return (
                          <button
                            key={motif}
                            onClick={() => handleBlindMotifSelect(motif)}
                            disabled={blindUserMotif !== null}
                            className={`px-3 py-3 rounded-xl text-sm font-medium border transition-all ${cls}`}
                          >
                            {MOTIF_META[motif]?.label || motif}
                          </button>
                        )
                      })}
                    </div>
                    {blindUserMotif !== null && (
                      <p className={`text-sm font-semibold ${blindCorrect ? 'text-emerald-400' : 'text-red-400'}`}>
                        {blindCorrect
                          ? 'Correct — now find the move!'
                          : `It was ${MOTIF_META[currentPuzzle?.motif]?.label || currentPuzzle?.motif} — study it carefully`}
                      </p>
                    )}
                  </div>
                )}
                </div>

                {/* Timer + info below board */}
                <div className="flex items-center justify-between mt-2 px-1">
                  <span className="text-xs text-slate-500">
                    {currentPuzzle.title || 'Puzzle'}
                    <span className="ml-2 text-slate-600">#{currentPuzzle.id}</span>
                  </span>
                  {!hideTimer && (
                    <span className={`flex items-center gap-1 text-sm font-mono font-semibold ${
                      timer > 30 ? 'text-red-400' : timer > 15 ? 'text-yellow-400' : 'text-slate-300'
                    }`}>
                      <Clock size={13} />
                      {timer}s
                    </span>
                  )}
                </div>

                {/* Ghost Square declaring panel */}
                {ghostMode && ghostState === 'declaring' && (
                  <div className="mt-2 bg-yellow-900/20 border border-yellow-700/40 rounded-xl px-3 py-2">
                    <p className="text-xs text-yellow-300 font-semibold mb-0.5">Ghost Square</p>
                    <p className="text-xs text-slate-400">
                      Destination: <span className="font-mono text-chess-gold">{ghostTo}</span>
                      {ghostTargets.length > 0 && (
                        <> · Click targeted {ghostTargets.length === 1 ? 'piece' : 'pieces'}:{' '}
                          <span className="text-orange-300">{ghostTargets.filter(sq => !ghostFound.includes(sq)).join(' ')}</span>
                          {ghostFound.length > 0 && <span className="text-emerald-400"> ✓{ghostFound.join(' ')}</span>}
                        </>
                      )}
                    </p>
                    <button
                      onClick={() => {
                        setGhostState('idle'); setGhostFrom(null); setGhostTo(null)
                        setGhostTargets([]); setGhostFound([])
                        setSelectedSquare(null); setLegalTargets([])
                      }}
                      className="mt-1 text-xs text-slate-600 hover:text-slate-400 transition-colors"
                    >
                      Cancel
                    </button>
                  </div>
                )}

                {/* SAN text input (hidden during analysis) */}
                {!analyzing && (
                  <div className="mt-3">
                    <div className={`flex items-center gap-2 rounded-xl border px-3 py-2 transition-all ${
                      moveInputError
                        ? 'border-red-500 bg-red-900/20'
                        : solved === null && !enginePlaying
                          ? 'border-slate-600 bg-chess-panel focus-within:border-chess-gold/60'
                          : 'border-slate-700 bg-chess-panel/50 opacity-50'
                    }`}>
                      <Keyboard size={14} className="text-slate-500 shrink-0" />
                      <input
                        ref={moveInputRef}
                        type="text"
                        value={moveInput}
                        onChange={e => { setMoveInput(e.target.value); setMoveInputError(false) }}
                        onKeyDown={e => { if (e.key === 'Enter') handleSanSubmit() }}
                        disabled={solved !== null || enginePlaying}
                        placeholder={
                          enginePlaying ? 'Engine thinking…'
                          : solved !== null ? ''
                          : (() => {
                              const total = getUserMoveCount(currentPuzzle)
                              const current = Math.floor(moveStep / 2) + 1
                              return total > 1 ? `Move ${current} of ${total} — type SAN (e.g. Rxd7)` : 'Type your move (e.g. Rxd7)'
                            })()
                        }
                        className="flex-1 bg-transparent text-slate-100 text-sm placeholder:text-slate-600 outline-none font-mono"
                        autoComplete="off"
                        spellCheck={false}
                      />
                      {moveInput.trim() && (
                        <button
                          onClick={handleSanSubmit}
                          className="shrink-0 px-2.5 py-1 rounded-lg bg-chess-gold text-chess-dark text-xs font-bold hover:opacity-90 transition-opacity"
                        >
                          OK
                        </button>
                      )}
                    </div>
                  </div>
                )}

                {/* Analyze eval bar + nav (shown during analysis) */}
                {analyzing && (
                  <div className="mt-3 space-y-2">
                    <EvalBar evalCp={analyzeEval} thinking={analyzeEngineThinking} />
                    <div className="flex items-center gap-1 justify-between">
                      <div className="flex gap-1">
                        <button onClick={() => handleAnalyzeNav(-1)} disabled={analyzeIdx < 0}
                          className="p-1.5 rounded-lg bg-chess-panel hover:bg-white/10 text-slate-300 disabled:opacity-30">
                          <ChevronLeft size={15} />
                        </button>
                        <button onClick={() => handleAnalyzeNav(1)} disabled={isAnalyzeAtEnd}
                          className="p-1.5 rounded-lg bg-chess-panel hover:bg-white/10 text-slate-300 disabled:opacity-30">
                          <ChevronRight size={15} />
                        </button>
                      </div>
                      <span className="text-xs text-slate-500">
                        {analyzeEngineThinking ? 'Engine thinking…' : isAnalyzeInteractive ? 'Make a move' : 'Viewing history'}
                      </span>
                      <button onClick={stopAnalyze}
                        className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-chess-panel hover:bg-white/10 text-red-400 text-xs transition-colors">
                        <StopCircle size={12} /> Exit
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {/* Info column */}
              <div className="flex flex-col gap-4">
                {/* Stoyko Gate 1 — CCT + LPDO scan */}
                {stoykoState === 'gate1' && (() => {
                  const checks   = gate1Required.filter(sq => gate1Categories[sq] === 'check')
                  const captures = gate1Required.filter(sq => gate1Categories[sq] === 'capture')
                  const loose    = gate1Required.filter(sq => gate1Categories[sq] === 'lpdo')
                  const foundChecks   = gate1Found.filter(sq => gate1Categories[sq] === 'check').length
                  const foundCaptures = gate1Found.filter(sq => gate1Categories[sq] === 'capture').length
                  const foundLoose    = gate1Found.filter(sq => gate1Categories[sq] === 'lpdo').length
                  return (
                    <div className="bg-amber-900/25 border border-amber-700/50 rounded-xl p-4">
                      <div className="flex items-center gap-2 text-amber-300 font-semibold mb-2">
                        <Shield size={16} /> CCT Scan
                      </div>
                      <p className="text-slate-400 text-xs mb-3 leading-relaxed">
                        Before solving, click all <span className="text-blue-300 font-semibold">check</span> destinations,
                        {' '}<span className="text-red-300 font-semibold">capture</span> squares, and
                        {' '}<span className="text-amber-300 font-semibold">loose pieces</span> (attacked &amp; undefended).
                      </p>
                      <div className="grid grid-cols-3 gap-2 mb-3">
                        {[
                          { label: 'Checks',   found: foundChecks,   total: checks.length,   color: 'text-blue-300' },
                          { label: 'Captures', found: foundCaptures, total: captures.length, color: 'text-red-300' },
                          { label: 'Loose',    found: foundLoose,    total: loose.length,    color: 'text-amber-300' },
                        ].map(({ label, found, total, color }) => total > 0 && (
                          <div key={label} className="bg-slate-800/60 rounded-lg px-2 py-1.5 text-center">
                            <p className={`text-xs font-semibold ${color}`}>{label}</p>
                            <p className="text-sm font-mono font-bold text-white">{found}/{total}</p>
                          </div>
                        ))}
                      </div>
                      <div className="flex items-center gap-2">
                        <div className="flex-1 bg-slate-700 rounded-full h-1.5 overflow-hidden">
                          <div
                            className="h-1.5 rounded-full bg-amber-400 transition-all"
                            style={{ width: gate1Required.length > 0 ? `${100 * gate1Found.length / gate1Required.length}%` : '0%' }}
                          />
                        </div>
                        <span className="text-xs text-amber-300 font-mono shrink-0">
                          {gate1Found.length}/{gate1Required.length}
                        </span>
                      </div>
                    </div>
                  )
                })()}

              {/* Blind Recognition status */}
                {blindMode && blindPhase === 'scanning' && (
                  <div className="bg-chess-gold/10 border border-chess-gold/30 rounded-xl px-4 py-3 flex items-center gap-3">
                    <Brain size={16} className="text-chess-gold shrink-0" />
                    <p className="text-sm text-slate-300">
                      Study the position — you have <span className="font-bold text-chess-gold">{blindCountdown}s</span> before the board hides.
                    </p>
                  </div>
                )}
                {blindMode && blindPhase === 'selecting' && (
                  <div className="bg-chess-gold/10 border border-chess-gold/30 rounded-xl px-4 py-3 flex items-center gap-3">
                    <Brain size={16} className="text-chess-gold shrink-0" />
                    <p className="text-sm text-slate-300">
                      {blindUserMotif === null
                        ? 'Board hidden — select the tactic you spotted.'
                        : blindCorrect ? 'Correct! Board restoring…' : 'Wrong motif — board restoring…'}
                    </p>
                  </div>
                )}

              {/* Gauntlet panel */}
                {gauntletPhase !== 'idle' && (
                  <GauntletPanel
                    phase={gauntletPhase}
                    defMove={gauntletDefMove}
                    coachOpen={gauntletCoachOpen}
                    setCoachOpen={setGauntletCoachOpen}
                    userNote={gauntletUserNote}
                    setUserNote={setGauntletUserNote}
                    coachReply={gauntletCoachReply}
                    coachLoading={gauntletCoachLoading}
                    onAskCoach={handleAskGauntletCoach}
                    onSkip={() => resumeAfterGauntlet(gauntletPendingStep)}
                    onTryAgain={() => {
                      setGauntletPhase('active')
                      setGauntletSelectedSq(null); setGauntletLegalTargets([])
                      // restore board to position before defense attempt
                      if (gauntletDefMove?.fen) setBoardFen(gauntletDefMove.fen)
                    }}
                  />
                )}

              {/* Puzzle info / Analyze header */}
                <div className="bg-chess-panel rounded-xl p-4">
                  <div className="flex items-center justify-between mb-2">
                    <TierBadge tier={currentPuzzle.difficulty_tier} />
                    <span className="text-xs text-slate-500">
                      {boardOrientation(currentPuzzle.fen) === 'white' ? 'White' : 'Black'} to move
                    </span>
                  </div>
                  {analyzing ? (
                    <p className="text-blue-300 text-sm font-medium">
                      Analysis mode — make any move, the engine will reply
                    </p>
                  ) : gauntletPhase === 'active' ? (
                    <p className="text-violet-300 text-sm font-medium">
                      Board flipped — play the best defensive response as {boardOrientation(currentPuzzle.fen) === 'white' ? 'Black' : 'White'}.
                    </p>
                  ) : gauntletPhase === 'fetching' ? (
                    <p className="text-slate-400 text-sm italic flex items-center gap-1.5">
                      <RefreshCw size={12} className="animate-spin" /> Querying engine for best defense…
                    </p>
                  ) : (() => {
                    const total = getUserMoveCount(currentPuzzle)
                    const played = Math.floor(moveStep / 2)
                    const current = played + 1
                    return (
                      <p className="text-slate-300 text-sm">
                        {enginePlaying
                          ? <span className="text-slate-400 italic">Engine responding…</span>
                          : total > 1
                            ? <>Find the winning combination — <span className="font-semibold text-chess-gold">move {current} of {total}</span></>
                            : <>Find the best move for <span className="font-semibold">{boardOrientation(currentPuzzle.fen)}</span>.</>
                        }
                      </p>
                    )
                  })()}
                  {!analyzing && currentPuzzle.attempts > 0 && (
                    <p className="text-xs text-slate-500 mt-1">
                      Seen {currentPuzzle.attempts}× · {currentPuzzle.correct} correct
                    </p>
                  )}
                </div>

                {/* Analyze move list */}
                {analyzing && (
                  <AnalyzeMoveList
                    history={analyzeHistory}
                    currentIdx={analyzeIdx}
                    onSelect={idx => {
                      setAnalyzeIdx(idx)
                      setAnalyzeSelectedSq(null)
                      setAnalyzeLegalTargets([])
                      if (idx >= 0) setAnalyzeEval(analyzeHistory[idx]?.eval_cp ?? null)
                      else setAnalyzeEval(null)
                    }}
                  />
                )}

                {/* Correct feedback */}
                {solved === true && (
                  <div className="bg-emerald-900/30 border border-emerald-700/40 rounded-xl p-4">
                    <div className="flex items-center gap-2 text-emerald-400 font-semibold mb-2">
                      <CheckCircle size={18} /> Correct!
                    </div>
                    <p className="text-slate-300 text-sm mb-3">
                      {getUserMoveCount(currentPuzzle) > 1
                        ? <>Combination: <span className="font-mono font-bold text-emerald-300">{(currentPuzzle.solution_path || [currentPuzzle.best_move_uci]).slice(0, getUserMoveCount(currentPuzzle) * 2 - 1).join(' ')}</span></>
                        : <>Best move: <span className="font-mono font-bold text-emerald-300">{currentPuzzle.best_move_san || currentPuzzle.best_move_uci}</span></>
                      }
                    </p>

                    {/* Motif reveal */}
                    <div className="mb-3">
                      <MotifBadge motif={currentPuzzle.motif} />
                    </div>

                    {/* Motif question */}
                    {motifGuess === null && (
                      <div>
                        <p className="text-xs text-slate-400 mb-2">Did you see this coming? Name the motif:</p>
                        <div className="flex flex-wrap gap-1.5">
                          {MOTIF_KEYS.map(m => (
                            <button
                              key={m}
                              onClick={() => handleMotifGuess(m)}
                              className="px-2.5 py-1 text-xs rounded-lg bg-slate-700 text-slate-300 hover:bg-slate-600 transition-colors"
                            >
                              {MOTIF_META[m].label}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}

                    {motifGuess !== null && (
                      <div className={`text-xs mt-1 font-medium ${motifResult ? 'text-emerald-400' : 'text-red-400'}`}>
                        {motifResult
                          ? 'Correct motif!'
                          : `It was a ${MOTIF_META[currentPuzzle.motif]?.label || currentPuzzle.motif}`}
                      </div>
                    )}
                  </div>
                )}

                {/* Wrong feedback */}
                {solved === false && (() => {
                  const solutionPath = currentPuzzle.solution_path || [currentPuzzle.best_move_uci]
                  const remainingUci = solutionPath.slice(moveStep)
                  const remainingSan = uciListToSan(boardFen || currentPuzzle.fen, remainingUci)
                  const expectedSan = remainingSan[0] || currentPuzzle.best_move_san || currentPuzzle.best_move_uci
                  const userMoveNum = Math.floor(moveStep / 2) + 1
                  return (
                    <div className="bg-red-900/30 border border-red-700/40 rounded-xl p-4">
                      <div className="flex items-center gap-2 text-red-400 font-semibold mb-2">
                        <XCircle size={18} /> Not quite
                      </div>
                      <p className="text-slate-300 text-sm mb-1">
                        {moveStep === 0 ? 'Best move' : `Your move ${userMoveNum}`}:{' '}
                        <span className="font-mono font-bold text-red-300">{expectedSan}</span>
                      </p>
                      {remainingSan.length > 1 && (
                        <p className="text-xs text-slate-400 font-mono mb-3 leading-relaxed">
                          Full line: <span className="text-slate-300">{remainingSan.join(' ')}</span>
                        </p>
                      )}
                      <div className="flex items-center justify-between">
                        <MotifBadge motif={currentPuzzle.motif} />
                        <button
                          onClick={handleAnalyze}
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-900/50 border border-blue-700/50 text-blue-300 text-xs font-medium hover:bg-blue-800/60 transition-colors"
                        >
                          <Play size={11} /> Analyze
                        </button>
                      </div>
                    </div>
                  )
                })()}

                {/* Action buttons */}
                <div className="flex gap-3 mt-auto">
                  {solved === null ? (
                    <button
                      onClick={handleSkip}
                      className="flex-1 py-2.5 rounded-lg bg-chess-panel hover:bg-white/10 text-slate-400 text-sm transition-colors"
                    >
                      Skip
                    </button>
                  ) : solved === false ? (
                    <>
                      <button
                        onClick={handleTryAgain}
                        className="flex-1 py-2.5 rounded-lg bg-chess-panel hover:bg-white/10 text-slate-300 text-sm transition-colors"
                      >
                        Try again
                      </button>
                      {!analyzing && (
                        <button
                          onClick={handleAnalyze}
                          className="flex-1 py-2.5 rounded-lg bg-blue-900/50 border border-blue-700/50 hover:bg-blue-800/60 text-blue-300 text-sm font-medium transition-colors flex items-center justify-center gap-1.5"
                        >
                          <Play size={13} /> Analyze
                        </button>
                      )}
                      <button
                        onClick={handleNext}
                        className="flex-1 py-2.5 rounded-lg bg-chess-panel hover:bg-white/10 text-slate-400 text-sm transition-colors"
                      >
                        {puzzleIdx + 1 >= puzzles.length ? 'Finish' : 'Next'}
                      </button>
                    </>
                  ) : (
                    <button
                      onClick={handleNext}
                      className="flex-1 py-2.5 rounded-lg bg-emerald-700 hover:bg-emerald-600 text-white font-medium text-sm transition-colors"
                    >
                      {puzzleIdx + 1 >= puzzles.length ? 'Finish session' : 'Next puzzle'}
                    </button>
                  )}
                </div>

                {/* Session mini-stats */}
                <div className="grid grid-cols-3 gap-2">
                  <MiniStat label="Correct" value={sessionStats.correct} color="text-emerald-400" />
                  <MiniStat label="Wrong" value={sessionStats.wrong} color="text-red-400" />
                  <MiniStat label="Accuracy" value={sessionAccuracy !== null ? `${sessionAccuracy}%` : '—'} color="text-chess-gold" />
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Eval bar
// ---------------------------------------------------------------------------

function EvalBar({ evalCp, thinking }) {
  // evalCp is from white's perspective. Positive = white winning.
  // Map to a percentage: 50% = equal, 0% = black dominating, 100% = white dominating
  const clamp = v => Math.max(-600, Math.min(600, v ?? 0))
  const pct = thinking || evalCp === null
    ? 50
    : 50 + 50 * Math.tanh(clamp(evalCp) / 250)

  const isMate = Math.abs(evalCp ?? 0) >= 9000
  const label = thinking ? '…'
    : evalCp === null ? '='
    : isMate ? (evalCp > 0 ? 'M' : '-M')
    : evalCp >= 0 ? `+${(evalCp / 100).toFixed(1)}` : (evalCp / 100).toFixed(1)

  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-3 bg-slate-800 rounded-full overflow-hidden border border-slate-700">
        <div
          className="h-full bg-white rounded-full transition-all duration-500"
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className={`text-xs font-mono font-bold w-10 text-right ${
        thinking ? 'text-slate-500'
        : (evalCp ?? 0) >= 0 ? 'text-slate-100' : 'text-slate-400'
      }`}>
        {label}
      </span>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Analyze move list
// ---------------------------------------------------------------------------

function AnalyzeMoveList({ history, currentIdx, onSelect }) {
  if (history.length === 0) {
    return (
      <div className="bg-chess-panel rounded-xl p-3 text-xs text-slate-500 text-center">
        No moves yet — play on the board
      </div>
    )
  }

  // Pair moves: [user, engine] per row
  const rows = []
  for (let i = 0; i < history.length; i += 2) {
    rows.push({ userEntry: history[i], engineEntry: history[i + 1], userIdx: i, engineIdx: i + 1 })
  }

  return (
    <div className="bg-chess-panel rounded-xl p-3 max-h-52 overflow-y-auto">
      <div className="text-xs text-slate-500 mb-2">Move list</div>
      <div className="space-y-0.5">
        {rows.map(({ userEntry, engineEntry, userIdx, engineIdx }, rowIdx) => (
          <div key={rowIdx} className="flex items-center gap-1 text-xs font-mono">
            <span className="text-slate-600 w-5 shrink-0">{rowIdx + 1}.</span>
            <button
              onClick={() => onSelect(userIdx)}
              className={`px-2 py-0.5 rounded transition-colors ${
                currentIdx === userIdx
                  ? 'bg-chess-gold text-chess-dark font-bold'
                  : 'text-chess-gold hover:bg-white/10'
              }`}
            >
              {userEntry.move_san}
            </button>
            {engineEntry && (
              <button
                onClick={() => onSelect(engineIdx)}
                className={`px-2 py-0.5 rounded transition-colors ${
                  currentIdx === engineIdx
                    ? 'bg-blue-700 text-white font-bold'
                    : 'text-blue-300 hover:bg-white/10'
                }`}
              >
                {engineEntry.move_san}
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Mode selector screen
// ---------------------------------------------------------------------------

function ModeSelector({ mode, setMode, tier, setTier, pool, setPool, books, motifFocus, setMotifFocus, recommendation, dueCount, importStatus, importing, onImport, stats, onStart, onLoadStats, userId, stoykoMode, setStoykoMode, gauntletMode, setGauntletMode, ghostMode, setGhostMode, hideTimer, setHideTimer, blindMode, setBlindMode, trainingRec }) {
  useEffect(() => { onLoadStats() }, [])

  return (
    <div className="max-w-2xl mx-auto">
      {/* Stats overview */}
      {stats && (
        <div className="grid grid-cols-3 gap-3 mb-6">
          <StatBox label="Total attempts" value={stats.total_attempts} />
          <StatBox label="Due now" value={stats.due_count} accent="text-yellow-400" />
          <StatBox label="Floor score" value={`${stats.floor_score}%`} accent="text-chess-gold" />
        </div>
      )}

      {/* Tactics score + recommendation from game profile */}
      {recommendation && (
        <div className="bg-chess-panel rounded-xl p-4 mb-6">
          <div className="flex items-start justify-between gap-4 mb-3">
            <div>
              <p className="text-xs text-slate-500 mb-0.5">Tactics score (from games)</p>
              {recommendation.tactics_score != null ? (
                <div className="flex items-center gap-2">
                  <span className={`text-2xl font-bold ${
                    recommendation.tactics_score >= 70 ? 'text-emerald-400'
                    : recommendation.tactics_score >= 50 ? 'text-yellow-400'
                    : 'text-red-400'
                  }`}>{Math.round(recommendation.tactics_score)}</span>
                  <span className="text-slate-500 text-sm">/100</span>
                </div>
              ) : (
                <span className="text-slate-500 text-sm">No games analyzed yet</span>
              )}
            </div>
            {recommendation.recommended_motif && (
              <div className="text-right">
                <p className="text-xs text-slate-500 mb-0.5">Recommended focus</p>
                <span className={`inline-block text-xs font-semibold px-2.5 py-1 rounded-lg border ${MOTIF_META[recommendation.recommended_motif]?.color || 'bg-slate-700 text-slate-300 border-slate-600'}`}>
                  {MOTIF_META[recommendation.recommended_motif]?.label || recommendation.recommended_motif}
                </span>
                {recommendation.reason && (
                  <p className="text-xs text-slate-500 mt-1">{recommendation.reason}</p>
                )}
              </div>
            )}
          </div>
          {recommendation.recommended_motif && (
            <button
              onClick={() => setMotifFocus(
                motifFocus === recommendation.recommended_motif ? null : recommendation.recommended_motif
              )}
              className={`w-full py-2 rounded-lg text-sm font-medium transition-colors ${
                motifFocus === recommendation.recommended_motif
                  ? 'bg-chess-gold text-chess-dark'
                  : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
              }`}
            >
              {motifFocus === recommendation.recommended_motif
                ? `Focusing on ${MOTIF_META[recommendation.recommended_motif]?.label} puzzles`
                : `Focus on ${MOTIF_META[recommendation.recommended_motif]?.label} (${recommendation.motif_puzzle_count} puzzles)`}
            </button>
          )}
        </div>
      )}

      {/* Training mode recommendation banner */}
      {trainingRec?.has_profile && trainingRec.reasons?.length > 0 && (
        <div className="bg-chess-panel rounded-xl p-4 mb-6 border border-slate-600">
          <p className="text-xs text-slate-500 uppercase tracking-wider mb-2 font-semibold">Recommended for you</p>
          <ul className="space-y-1 mb-3">
            {trainingRec.reasons.map((r, i) => (
              <li key={i} className="text-xs text-slate-300 flex items-start gap-2">
                <span className="text-chess-gold mt-0.5">▸</span>{r}
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap gap-2">
            {trainingRec.recommend_personal && trainingRec.personal_puzzle_count > 0 && (
              <button
                onClick={() => setPool('__personal__')}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                  pool === '__personal__' ? 'bg-chess-gold text-chess-dark' : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
                }`}
              >
                <Target size={12} /> From My Games ({trainingRec.personal_puzzle_count})
              </button>
            )}
            {trainingRec.recommend_blind && (
              <button
                onClick={() => setBlindMode(v => !v)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                  blindMode ? 'bg-chess-gold text-chess-dark' : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
                }`}
              >
                <Brain size={12} /> Blind Recognition
              </button>
            )}
            {trainingRec.recommend_gauntlet && (
              <button
                onClick={() => setGauntletMode(v => !v)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                  gauntletMode ? 'bg-violet-500 text-white' : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
                }`}
              >
                <Swords size={12} /> Gauntlet
              </button>
            )}
            {trainingRec.recommend_ghost && (
              <button
                onClick={() => setGhostMode(v => !v)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                  ghostMode ? 'bg-yellow-500 text-chess-dark' : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
                }`}
              >
                <Eye size={12} /> Ghost Square
              </button>
            )}
          </div>
        </div>
      )}

      {/* Mode cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
        <ModeCard
          active={mode === 'review'}
          onClick={() => setMode('review')}
          title="Daily Review"
          description="Spaced repetition — due cards first, new puzzles when done."
          badge={dueCount > 0 ? `${dueCount} due` : null}
          badgeColor="bg-yellow-900/60 text-yellow-300"
          icon={<RefreshCw size={20} />}
        />
        <ModeCard
          active={mode === 'woodpecker'}
          onClick={() => setMode('woodpecker')}
          title="Woodpecker Sprint"
          description="Repetition training — hammer patterns until they're automatic."
          icon={<Zap size={20} />}
        />
      </div>

      {/* Pool selector */}
      <div className="bg-chess-panel rounded-xl p-4 mb-6">
        <p className="text-sm text-slate-400 mb-3">Puzzle pool:</p>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => setPool(null)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              pool === null ? 'bg-chess-gold text-chess-dark' : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
            }`}
          >
            All Books
          </button>
          {trainingRec?.personal_puzzle_count > 0 && (
            <button
              onClick={() => setPool(pool === '__personal__' ? null : '__personal__')}
              className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                pool === '__personal__' ? 'bg-chess-gold text-chess-dark' : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
              }`}
            >
              <Target size={14} /> My Games ({trainingRec.personal_puzzle_count})
            </button>
          )}
          {books.filter(b => b.ready).map(b => (
            <div key={b.source} className="flex items-center gap-1">
              <button
                onClick={() => setPool(b.source)}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                  pool === b.source ? 'bg-chess-gold text-chess-dark' : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
                }`}
              >
                {b.label}
              </button>
              <button
                onClick={() => onImport(b.filename)}
                disabled={!!importing}
                title="Re-import (updates motifs & solution paths)"
                className="p-1.5 rounded-lg bg-slate-700 hover:bg-slate-600 text-slate-500 hover:text-slate-300 disabled:opacity-40 transition-colors"
              >
                {importing === b.filename
                  ? <RefreshCw size={12} className="animate-spin" />
                  : <RefreshCw size={12} />}
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* Tier selector (woodpecker only) */}
      {mode === 'woodpecker' && (
        <div className="bg-chess-panel rounded-xl p-4 mb-6">
          <p className="text-sm text-slate-400 mb-3">Difficulty tier:</p>
          <div className="flex gap-2">
            {[null, 1, 2, 3].map(t => (
              <button
                key={t ?? 'all'}
                onClick={() => setTier(t)}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                  tier === t
                    ? 'bg-chess-gold text-chess-dark'
                    : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
                }`}
              >
                {t === null ? 'All' : t === 1 ? 'Easy' : t === 2 ? 'Medium' : 'Hard'}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Import more books */}
      {books.filter(b => !b.ready && !b.importing).length > 0 && (
        <div className="bg-chess-panel rounded-xl p-4 mb-6">
          <p className="text-sm text-slate-400 mb-3">Available to import:</p>
          <div className="flex flex-col gap-2">
            {books.filter(b => !b.ready && !b.importing).map(b => (
              <div key={b.source} className="flex items-center justify-between gap-3">
                <span className="text-xs text-slate-300 truncate">{b.label}</span>
                <button
                  onClick={() => onImport(b.filename)}
                  disabled={!!importing}
                  className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-700 hover:bg-slate-600 text-slate-300 text-xs font-medium transition-colors disabled:opacity-50"
                >
                  {importing === b.filename
                    ? <><RefreshCw size={12} className="animate-spin" /> Starting…</>
                    : <><Zap size={12} /> Import</>}
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Motif heatmap */}
      {stats?.heatmap && Object.keys(stats.heatmap).length > 0 && (
        <div className="bg-chess-panel rounded-xl p-4 mb-6">
          <h3 className="text-sm font-semibold text-chess-gold mb-3 flex items-center gap-2">
            <BarChart2 size={16} /> Motif Accuracy
          </h3>
          <div className="grid grid-cols-2 gap-2">
            {Object.entries(stats.heatmap).map(([motif, d]) => {
              const meta = MOTIF_META[motif] || MOTIF_META.combination
              const acc = d.accuracy
              return (
                <div key={motif} className={`border rounded-lg px-3 py-2 text-xs ${meta.color}`}>
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-semibold">{meta.label}</span>
                    <span className="font-bold">{acc}%</span>
                  </div>
                  <div className="w-full bg-black/30 rounded-full h-1.5 overflow-hidden">
                    <div className="h-1.5 rounded-full bg-current opacity-70 transition-all" style={{ width: `${acc}%` }} />
                  </div>
                  <div className="mt-1 opacity-70">{d.attempts} tried · avg {d.avg_time}s</div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Blind Recognition toggle */}
      <div className={`rounded-xl p-4 mb-4 border transition-all ${
        blindMode ? 'bg-chess-gold/10 border-chess-gold/40' : 'bg-chess-panel border-slate-700'
      }`}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Brain size={16} className={blindMode ? 'text-chess-gold' : 'text-slate-500'} />
            <div>
              <p className={`text-sm font-semibold ${blindMode ? 'text-chess-gold' : 'text-slate-300'}`}>
                Blind Recognition
              </p>
              <p className="text-xs text-slate-500 leading-tight">
                5s to study, then identify the motif from 4 options before playing
              </p>
            </div>
          </div>
          <button
            onClick={() => setBlindMode(v => !v)}
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors shrink-0 ${
              blindMode ? 'bg-chess-gold' : 'bg-slate-600'
            }`}
          >
            <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
              blindMode ? 'translate-x-6' : 'translate-x-1'
            }`} />
          </button>
        </div>
      </div>

      {/* Stoyko Mode toggle */}
      <div className={`rounded-xl p-4 mb-4 border transition-all ${
        stoykoMode
          ? 'bg-amber-900/20 border-amber-700/50'
          : 'bg-chess-panel border-slate-700'
      }`}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Shield size={16} className={stoykoMode ? 'text-amber-400' : 'text-slate-500'} />
            <div>
              <p className={`text-sm font-semibold ${stoykoMode ? 'text-amber-300' : 'text-slate-300'}`}>
                Stoyko Mode
              </p>
              <p className="text-xs text-slate-500 leading-tight">
                Before solving: identify loose pieces (Gate 1) &amp; predict the best reply (Gate 3)
              </p>
            </div>
          </div>
          <button
            onClick={() => setStoykoMode(v => !v)}
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors shrink-0 ${
              stoykoMode ? 'bg-amber-500' : 'bg-slate-600'
            }`}
          >
            <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
              stoykoMode ? 'translate-x-6' : 'translate-x-1'
            }`} />
          </button>
        </div>
      </div>

      {/* Defensive Gauntlet toggle */}
      <div className={`rounded-xl p-4 mb-4 border transition-all ${
        gauntletMode ? 'bg-violet-900/20 border-violet-700/50' : 'bg-chess-panel border-slate-700'
      }`}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Swords size={16} className={gauntletMode ? 'text-violet-400' : 'text-slate-500'} />
            <div>
              <p className={`text-sm font-semibold ${gauntletMode ? 'text-violet-300' : 'text-slate-300'}`}>
                Defensive Gauntlet
              </p>
              <p className="text-xs text-slate-500 leading-tight">
                After each move, flip and find the best defensive reply before continuing
              </p>
            </div>
          </div>
          <button
            onClick={() => setGauntletMode(v => !v)}
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors shrink-0 ${
              gauntletMode ? 'bg-violet-500' : 'bg-slate-600'
            }`}
          >
            <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
              gauntletMode ? 'translate-x-6' : 'translate-x-1'
            }`} />
          </button>
        </div>
      </div>

      {/* Ghost Square toggle */}
      <div className={`rounded-xl p-4 mb-4 border transition-all ${
        ghostMode ? 'bg-yellow-900/20 border-yellow-700/50' : 'bg-chess-panel border-slate-700'
      }`}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Eye size={16} className={ghostMode ? 'text-yellow-400' : 'text-slate-500'} />
            <div>
              <p className={`text-sm font-semibold ${ghostMode ? 'text-yellow-300' : 'text-slate-300'}`}>
                Ghost Square
              </p>
              <p className="text-xs text-slate-500 leading-tight">
                Before moving, declare the destination and click all pieces your move attacks
              </p>
            </div>
          </div>
          <button
            onClick={() => setGhostMode(v => !v)}
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors shrink-0 ${
              ghostMode ? 'bg-yellow-500' : 'bg-slate-600'
            }`}
          >
            <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
              ghostMode ? 'translate-x-6' : 'translate-x-1'
            }`} />
          </button>
        </div>
      </div>

      {/* Hide Timer toggle */}
      <div className={`rounded-xl p-4 mb-4 border transition-all ${
        hideTimer ? 'bg-slate-800 border-slate-600' : 'bg-chess-panel border-slate-700'
      }`}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <EyeOff size={16} className={hideTimer ? 'text-slate-300' : 'text-slate-500'} />
            <div>
              <p className="text-sm font-semibold text-slate-300">Hide Timer</p>
              <p className="text-xs text-slate-500 leading-tight">
                Remove the clock display to reduce time pressure
              </p>
            </div>
          </div>
          <button
            onClick={() => setHideTimer(v => !v)}
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors shrink-0 ${
              hideTimer ? 'bg-slate-400' : 'bg-slate-600'
            }`}
          >
            <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
              hideTimer ? 'translate-x-6' : 'translate-x-1'
            }`} />
          </button>
        </div>
      </div>

      <button
        onClick={onStart}
        className="w-full py-3.5 rounded-xl bg-chess-gold text-chess-dark font-bold text-base hover:opacity-90 transition-opacity flex items-center justify-center gap-2"
      >
        <Zap size={20} />
        {mode === 'review' ? 'Start Review Session' : 'Start Woodpecker Sprint'}
        <ChevronRight size={18} />
      </button>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Gauntlet panel
// ---------------------------------------------------------------------------

function GauntletPanel({ phase, defMove, coachOpen, setCoachOpen, userNote, setUserNote, coachReply, coachLoading, onAskCoach, onSkip, onTryAgain }) {
  if (phase === 'fetching') {
    return (
      <div className="bg-violet-900/20 border border-violet-700/40 rounded-xl p-4">
        <div className="flex items-center gap-2 text-violet-300 text-sm">
          <RefreshCw size={13} className="animate-spin" />
          Querying Stockfish for best defensive reply…
        </div>
      </div>
    )
  }

  if (phase === 'solved') {
    return (
      <div className="bg-emerald-900/20 border border-emerald-700/40 rounded-xl p-4">
        <div className="flex items-center gap-2 text-emerald-400 font-semibold mb-1">
          <CheckCircle size={15} /> Correct defense!
        </div>
        <p className="text-xs text-slate-400">
          <span className="font-mono text-violet-300">{defMove?.san}</span> — well spotted. Resuming puzzle…
        </p>
      </div>
    )
  }

  if (phase === 'active') {
    return (
      <div className="bg-violet-900/20 border border-violet-700/40 rounded-xl p-4">
        <div className="flex items-center gap-2 text-violet-300 font-semibold mb-2">
          <Swords size={15} /> Defensive Gauntlet
        </div>
        <p className="text-slate-300 text-sm mb-3 leading-relaxed">
          Board flipped — you're playing as the <span className="font-semibold">opponent</span>.
          Find the best defensive response.
        </p>
        <button
          onClick={onSkip}
          className="text-xs text-slate-500 hover:text-slate-300 transition-colors"
        >
          Skip gauntlet
        </button>
      </div>
    )
  }

  if (phase === 'failed') {
    return (
      <div className="bg-red-900/20 border border-red-700/40 rounded-xl p-4 space-y-3">
        <div className="flex items-center gap-2 text-red-400 font-semibold">
          <XCircle size={15} /> Not the strongest defense
        </div>
        <p className="text-sm text-slate-300">
          Best response:{' '}
          <span className="font-mono font-bold text-violet-300">{defMove?.san}</span>
        </p>

        {/* Top engine lines */}
        {(defMove?.top_lines?.length ?? 0) > 0 && (
          <div className="space-y-1 text-xs font-mono">
            <p className="text-slate-500 font-sans">Top lines (Stockfish):</p>
            {defMove.top_lines.map((line, i) => (
              <div key={i} className="text-slate-400">
                <span className="text-slate-600">{i + 1}. </span>
                <span className="text-violet-300">{line.move_san}</span>
                <span className="text-slate-600 ml-1">
                  ({Math.abs(line.score_cp) >= 9000 ? 'M' : (line.score_cp / 100).toFixed(1)})
                </span>
                {(line.pv_san?.length ?? 0) > 1 && (
                  <span className="ml-1 text-slate-600">{line.pv_san.slice(1, 4).join(' ')}</span>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Coach section */}
        {!coachOpen ? (
          <button
            onClick={() => setCoachOpen(true)}
            className="flex items-center gap-1.5 text-xs text-violet-400 hover:text-violet-300 transition-colors"
          >
            <MessageSquare size={12} /> Ask coach to explain
          </button>
        ) : (
          <div className="space-y-2">
            <textarea
              value={userNote}
              onChange={e => setUserNote(e.target.value)}
              placeholder="What were you thinking? (optional)"
              className="w-full text-xs bg-slate-800 border border-slate-600 rounded-lg p-2 text-slate-300 placeholder:text-slate-600 outline-none resize-none focus:border-violet-700/60"
              rows={2}
            />
            {coachReply ? (
              <div className="text-xs text-slate-300 leading-relaxed bg-slate-800/50 rounded-lg p-2 border border-slate-700">
                {coachReply}
              </div>
            ) : (
              <button
                onClick={onAskCoach}
                disabled={coachLoading}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-violet-900/50 border border-violet-700/50 text-violet-300 text-xs font-medium hover:bg-violet-800/60 transition-colors disabled:opacity-50"
              >
                {coachLoading
                  ? <><RefreshCw size={11} className="animate-spin" /> Coach thinking…</>
                  : <><Zap size={11} /> Get explanation</>}
              </button>
            )}
          </div>
        )}

        <div className="flex gap-2 pt-1">
          <button
            onClick={onTryAgain}
            className="flex-1 py-1.5 rounded-lg bg-chess-panel hover:bg-white/10 text-slate-300 text-xs transition-colors"
          >
            Try again
          </button>
          <button
            onClick={onSkip}
            className="flex-1 py-1.5 rounded-lg bg-chess-panel hover:bg-white/10 text-slate-500 text-xs transition-colors"
          >
            Skip defense
          </button>
        </div>
      </div>
    )
  }

  return null
}

// ---------------------------------------------------------------------------
// Book import screen
// ---------------------------------------------------------------------------

function BookImportScreen({ books, importing, onImport }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <Target size={56} className="text-slate-600 mb-6" />
      <h2 className="text-2xl font-bold text-white mb-2">Puzzle Library Not Loaded</h2>
      <p className="text-slate-400 text-sm mb-8 max-w-md">
        Choose a puzzle book to import. The engine analyzes each position and classifies its motif
        (fork, pin, checkmate, etc.). Runs once, takes a few minutes.
      </p>
      {books.length === 0 ? (
        <p className="text-slate-500 text-sm">No PGN files found in games_db/.</p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 w-full max-w-2xl">
          {books.map(b => (
            <button
              key={b.source}
              onClick={() => !importing && onImport(b.filename)}
              disabled={!!importing}
              className="text-left p-5 rounded-xl border-2 border-slate-700 bg-chess-panel hover:border-chess-gold/60 transition-all disabled:opacity-50"
            >
              <div className="flex items-center gap-2 mb-2">
                {importing === b.filename
                  ? <RefreshCw size={16} className="animate-spin text-chess-gold" />
                  : <Zap size={16} className="text-chess-gold" />}
                <span className="font-semibold text-white text-sm truncate">{b.label}</span>
              </div>
              <p className="text-xs text-slate-500">{b.filename}</p>
            </button>
          ))}
        </div>
      )}
      <p className="text-xs text-slate-600 mt-6">
        Drop any .pgn file into games_db/ and restart the backend to see it here.
      </p>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Small helper components
// ---------------------------------------------------------------------------

function ModeCard({ active, onClick, title, description, badge, badgeColor, icon }) {
  return (
    <button
      onClick={onClick}
      className={`text-left p-4 rounded-xl border-2 transition-all ${
        active
          ? 'border-chess-gold bg-chess-gold/10'
          : 'border-slate-700 bg-chess-panel hover:border-slate-500'
      }`}
    >
      <div className="flex items-center justify-between mb-2">
        <div className={`${active ? 'text-chess-gold' : 'text-slate-400'}`}>{icon}</div>
        {badge && (
          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${badgeColor}`}>
            {badge}
          </span>
        )}
      </div>
      <h3 className={`font-semibold text-sm mb-1 ${active ? 'text-white' : 'text-slate-200'}`}>{title}</h3>
      <p className="text-xs text-slate-500 leading-relaxed">{description}</p>
    </button>
  )
}

function MotifBadge({ motif }) {
  const meta = MOTIF_META[motif] || MOTIF_META.combination
  return (
    <span className={`inline-flex items-center px-2.5 py-1 rounded-lg border text-xs font-semibold ${meta.color}`}>
      {meta.label}
    </span>
  )
}

function TierBadge({ tier }) {
  const configs = {
    1: 'bg-green-900/50 text-green-300 border-green-700',
    2: 'bg-yellow-900/50 text-yellow-300 border-yellow-700',
    3: 'bg-red-900/50 text-red-300 border-red-700',
  }
  const labels = { 1: 'Easy', 2: 'Medium', 3: 'Hard' }
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded border text-xs font-medium ${configs[tier] || configs[1]}`}>
      {labels[tier] || 'Easy'}
    </span>
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

function MiniStat({ label, value, color }) {
  return (
    <div className="bg-chess-panel/50 rounded-lg p-2 text-center">
      <p className={`text-lg font-bold ${color}`}>{value}</p>
      <p className="text-xs text-slate-600">{label}</p>
    </div>
  )
}
