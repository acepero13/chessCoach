import { useState } from 'react'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import Dashboard from './pages/Dashboard'
import CoachingSession from './pages/CoachingSession'
import TrainingPlan from './pages/TrainingPlan'
import SelfAnalysis from './pages/SelfAnalysis'
import SelfAnalysisStats from './pages/SelfAnalysisStats'
import ReviewedGames from './pages/ReviewedGames'
import GameReview from './pages/GameReview'
import MentalTutor from './pages/MentalTutor'
import MentalTutorStats from './pages/MentalTutorStats'
import Drills from './pages/Drills'
import Review from './pages/Review'
import EndgameAnalysis from './pages/EndgameAnalysis'

export default function App() {
  const [userId, setUserIdState] = useState(() => {
    const stored = localStorage.getItem('chessTutorUserId')
    return stored ? Number(stored) : null
  })
  const [username, setUsernameState] = useState(
    () => localStorage.getItem('chessTutorUsername') || ''
  )

  const setUser = (id, name) => {
    setUserIdState(id)
    if (id) localStorage.setItem('chessTutorUserId', String(id))
    else localStorage.removeItem('chessTutorUserId')
    if (name) {
      setUsernameState(name)
      localStorage.setItem('chessTutorUsername', name)
    } else if (name === null) {
      setUsernameState('')
      localStorage.removeItem('chessTutorUsername')
    }
  }

  return (
    <BrowserRouter>
      <Routes>
        <Route
          path="/"
          element={<Dashboard userId={userId} username={username} setUser={setUser} />}
        />
        <Route
          path="/coaching/:gameId"
          element={<CoachingSession />}
        />
        <Route
          path="/training"
          element={<TrainingPlan userId={userId} />}
        />
        <Route
          path="/self-analysis/:gameId"
          element={<SelfAnalysis userId={userId} />}
        />
        <Route
          path="/reviewed-games"
          element={<ReviewedGames userId={userId} />}
        />
        <Route
          path="/game/:gameId"
          element={<GameReview userId={userId} />}
        />
        <Route
          path="/mental-tutor"
          element={<MentalTutor userId={userId} />}
        />
        <Route
          path="/mental-tutor-stats"
          element={<MentalTutorStats userId={userId} />}
        />
        <Route
          path="/drills"
          element={<Drills userId={userId} />}
        />
        <Route
          path="/review"
          element={<Review userId={userId} />}
        />
        <Route
          path="/self-analysis-stats"
          element={<SelfAnalysisStats userId={userId} />}
        />
        <Route
          path="/endgame"
          element={<EndgameAnalysis userId={userId} />}
        />
      </Routes>
    </BrowserRouter>
  )
}
