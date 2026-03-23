import axios from 'axios'

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || 'http://localhost:8000',
  timeout: 180000,   // 3 min — engine (depth 20) + LLM (40 s timeout) + margin
})

// Games
export const importLichess = (username, maxGames = 40, perfType) =>
  api.post('/games/import/lichess', { username, max_games: maxGames, perf_type: perfType })

export const importChessCom = (username, maxGames = 40, year, month) =>
  api.post('/games/import/chessdotcom', { username, max_games: maxGames, year, month })

export const importPgn = (username, file) => {
  const form = new FormData()
  form.append('file', file)
  return api.post(`/games/import/pgn?username=${encodeURIComponent(username)}`, form)
}

export const getGame = (gameId) =>
  api.get(`/games/${gameId}`)

export const listGames = (userId) =>
  api.get(`/games/list/${userId}`)

export const analyzeGames = (gameIds, depth = 18) =>
  api.post('/games/analyze', { game_ids: gameIds, depth })

export const getGameAnalysis = (gameId) =>
  api.get(`/games/analysis/${gameId}`)

export const getAnalysisStatus = (userId) =>
  api.get(`/games/analysis-status/${userId}`)

// Profile
export const computeProfile = (userId) =>
  api.post(`/profile/${userId}/compute`)

export const getLatestProfile = (userId) =>
  api.get(`/profile/${userId}/latest`)

export const selectGames = (userId, n = 7) =>
  api.get(`/profile/${userId}/select-games`, { params: { n } })

export const getProfileHistory = (userId) =>
  api.get(`/profile/${userId}/history`)

export const getPatternStats = (userId) =>
  api.get(`/profile/${userId}/pattern-stats`)

export const getProgress = (userId) =>
  api.get(`/profile/${userId}/progress`)

export const getPatternDrill = (userId, patternType) =>
  api.get(`/profile/${userId}/pattern-drill`, { params: { pattern_type: patternType } })

export const getPatternTip = (userId, patternType, samplePositions) =>
  api.post(`/profile/${userId}/pattern-tip`, { pattern_type: patternType, sample_positions: samplePositions })

export const getPatternExplain = (userId, patternType, position) =>
  api.post(`/profile/${userId}/pattern-explain`, {
    pattern_type: patternType,
    user_move_san: position.user_move_san,
    best_move_san: position.best_move_san,
    engine_pv_san: position.engine_pv_san || [],
    tactic_explanation: position.tactic_explanation || '',
    centipawn_loss: position.centipawn_loss || 0,
  })

// Coaching
export const startSession = (userId, gameId) =>
  api.post('/coaching/session/start', { user_id: userId, game_id: gameId })

export const submitAnswer = (sessionId, candidateMovesSelected, userAnswer = '', skipped = false) =>
  api.post(`/coaching/session/${sessionId}/answer`, {
    candidate_moves_selected: candidateMovesSelected,
    user_answer: userAnswer,
    skipped,
  })

export const getSession = (sessionId) =>
  api.get(`/coaching/session/${sessionId}`)

export const closeCoachingSession = (sessionId) =>
  api.post(`/coaching/session/${sessionId}/close`)

export const getCognitiveProfile = (userId) =>
  api.get(`/profile/${userId}/cognitive-profile`)

export const getOpponentProfile = (userId) =>
  api.get(`/profile/${userId}/opponent-profile`)

export const getTrends = (userId) =>
  api.get(`/profile/${userId}/trends`)

// Training
export const generatePlan = (userId) =>
  api.post(`/training/${userId}/generate-plan`)

export const getLatestPlan = (userId) =>
  api.get(`/training/${userId}/latest-plan`)

export const getPerformanceSummary = (userId) =>
  api.post(`/training/${userId}/summary`)

// Self-Analysis (Guided Annotation)
export const startAnnotationSession = (userId, gameId, timeBudget) =>
  api.post('/selfanalysis/start', { user_id: userId, game_id: gameId, time_budget_minutes: timeBudget })

export const submitAnnotation = (sessionId, payload) =>
  api.post(`/selfanalysis/session/${sessionId}/annotate`, payload)

export const saveDraftAnnotation = (sessionId, payload) =>
  api.post(`/selfanalysis/session/${sessionId}/save-draft`, payload)

export const completeAnnotationSession = (sessionId, feelings = null) =>
  api.post(`/selfanalysis/session/${sessionId}/complete`, { game_feelings: feelings })

export const getAnnotationSession = (sessionId) =>
  api.get(`/selfanalysis/session/${sessionId}`)

export const getLatestSessionForGame = (gameId) =>
  api.get(`/selfanalysis/game/${gameId}/latest-session`)

export const getCoachReview = (sessionId) =>
  api.get(`/selfanalysis/session/${sessionId}/coach-review`)

export const sendCoachChat = (sessionId, moveIndex, messages) =>
  api.post(`/selfanalysis/session/${sessionId}/chat`, {
    move_index: moveIndex,
    messages,
  })

export const submitCoachReviewReply = (sessionId, payload) =>
  api.post(`/selfanalysis/session/${sessionId}/coach-review/reply`, payload)

export const listUserSessions = (userId) =>
  api.get(`/selfanalysis/user/${userId}/sessions`)

export const submitRootCause = (sessionId, moveIndex, rootCause) =>
  api.post(`/selfanalysis/session/${sessionId}/root-cause`, { move_index: moveIndex, root_cause: rootCause })

export const exportAnnotatedPgn = (sessionId) =>
  api.get(`/selfanalysis/session/${sessionId}/export-pgn`, { responseType: 'blob' })

// Mental Tutor
export const getMentalScenarios = (userId, limit = 10) =>
  api.get(`/mental-tutor/${userId}/scenarios`, { params: { limit } })

export const startMentalSession = (userId, gameId, moveIndex, maxMoves = 6) =>
  api.post('/mental-tutor/session/start', {
    user_id: userId,
    game_id: gameId,
    move_index: moveIndex,
    max_moves: maxMoves,
  })

export const playMentalMove = (sessionId, moveUci, moveTimeMs = 0) =>
  api.post(`/mental-tutor/session/${sessionId}/move`, {
    move_uci: moveUci,
    move_time_ms: moveTimeMs,
  })

export const completeMentalSession = (sessionId) =>
  api.post(`/mental-tutor/session/${sessionId}/complete`)

// Admin
export const resetDatabase = () =>
  api.delete('/admin/reset')
