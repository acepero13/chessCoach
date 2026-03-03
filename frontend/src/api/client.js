import axios from 'axios'

const api = axios.create({
  baseURL: 'http://localhost:8000',
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

// Coaching
export const startSession = (userId, gameId) =>
  api.post('/coaching/session/start', { user_id: userId, game_id: gameId })

export const submitAnswer = (sessionId, userAnswer) =>
  api.post(`/coaching/session/${sessionId}/answer`, { user_answer: userAnswer })

export const getSession = (sessionId) =>
  api.get(`/coaching/session/${sessionId}`)

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

export const completeAnnotationSession = (sessionId, feelings = null) =>
  api.post(`/selfanalysis/session/${sessionId}/complete`, { game_feelings: feelings })

export const getAnnotationSession = (sessionId) =>
  api.get(`/selfanalysis/session/${sessionId}`)

export const getLatestSessionForGame = (gameId) =>
  api.get(`/selfanalysis/game/${gameId}/latest-session`)

export const getCoachReview = (sessionId) =>
  api.get(`/selfanalysis/session/${sessionId}/coach-review`)

export const submitCoachReviewReply = (sessionId, payload) =>
  api.post(`/selfanalysis/session/${sessionId}/coach-review/reply`, payload)
