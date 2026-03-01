import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { BookOpen, Target, Calendar, RefreshCw, ChevronRight } from 'lucide-react'
import ScoreRadar from '../components/ScoreRadar'
import GameImport from '../components/GameImport'
import GameList from '../components/GameList'
import {
  listGames, getLatestProfile, computeProfile, selectGames
} from '../api/client'

export default function Dashboard({ userId, username, setUser }) {
  const navigate = useNavigate()
  const [games, setGames] = useState([])
  const [profile, setProfile] = useState(null)
  const [loading, setLoading] = useState(false)
  const [computingProfile, setComputingProfile] = useState(false)
  const [tab, setTab] = useState(userId ? 'overview' : 'import')

  const fetchData = async (uid) => {
    if (!uid) return
    setLoading(true)
    try {
      const [gRes, pRes] = await Promise.allSettled([
        listGames(uid),
        getLatestProfile(uid),
      ])
      if (gRes.status === 'fulfilled') setGames(gRes.value.data)
      if (pRes.status === 'fulfilled') setProfile(pRes.value.data)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { fetchData(userId) }, [userId])

  const handleImported = async (newUserId, importedUsername) => {
    setUser(newUserId, importedUsername)
    await fetchData(newUserId)
  }

  const handleComputeProfile = async () => {
    setComputingProfile(true)
    try {
      await computeProfile(userId)
      await fetchData(userId)
    } catch (e) {
      alert(e.response?.data?.detail || e.message)
    } finally {
      setComputingProfile(false)
    }
  }

  const handleStartCoaching = async () => {
    try {
      const res = await selectGames(userId)
      const firstGame = res.data.selected_games?.[0]
      if (firstGame) {
        navigate(`/coaching/${firstGame.game_id}`, {
          state: { selectedGames: res.data.selected_games, userId }
        })
      }
    } catch (e) {
      alert('Run analysis first to get game recommendations.')
    }
  }

  const scores = profile
    ? {
        attack: profile.attack_score,
        defense: profile.defense_score,
        opening: profile.opening_score,
        strategy: profile.strategy_score,
        endgame: profile.endgame_score,
        tactics: profile.tactics_score,
        time_management: profile.time_management_score,
        conversion: profile.conversion_score,
        mental_stability: profile.mental_stability_score,
      }
    : null

  const analyzedCount = games.filter(g => g.has_analysis).length

  return (
    <div className="min-h-screen bg-chess-dark p-6">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-3xl font-bold text-chess-gold">♟ Chess Coach</h1>
            <p className="text-slate-400 text-sm mt-1">
              {username || (userId ? `User #${userId}` : 'Not signed in')} ·{' '}
              {games.length} games imported · {analyzedCount} analyzed
            </p>
          </div>
          {profile && (
            <button
              onClick={handleComputeProfile}
              disabled={computingProfile}
              className="flex items-center gap-2 text-sm text-slate-400 hover:text-chess-gold transition-colors"
            >
              <RefreshCw size={14} className={computingProfile ? 'animate-spin' : ''} />
              Recompute profile
            </button>
          )}
        </div>

        {/* Action cards (only when profile exists) */}
        {profile && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
            <ActionCard
              icon={<BookOpen size={20} />}
              title="Start Coaching Session"
              description="Review your most instructive games interactively"
              onClick={handleStartCoaching}
            />
            <ActionCard
              icon={<Calendar size={20} />}
              title="Create Training Plan"
              description="Get a 4-week plan based on your weaknesses"
              onClick={() => navigate('/training')}
            />
            <ActionCard
              icon={<Target size={20} />}
              title="View Analysis"
              description={`${analyzedCount} games analyzed at depth 18`}
              onClick={() => setTab('games')}
            />
          </div>
        )}

        {/* Tabs */}
        <div className="flex gap-1 mb-4 bg-chess-panel rounded-lg p-1 w-fit">
          {['overview', 'import', 'games'].map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors capitalize ${
                tab === t ? 'bg-chess-accent text-white' : 'text-slate-400 hover:text-white'
              }`}
            >
              {t}
            </button>
          ))}
        </div>

        {/* Tab content */}
        {tab === 'overview' && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {scores ? (
              <ScoreRadar scores={scores} />
            ) : (
              <NoProfileCard
                analyzedCount={analyzedCount}
                onCompute={handleComputeProfile}
                computing={computingProfile}
                onImport={() => setTab('import')}
              />
            )}

            {profile && (
              <div className="bg-chess-panel rounded-xl p-4">
                <h2 className="text-lg font-semibold text-chess-gold mb-3">Profile Summary</h2>
                <div className="space-y-2">
                  {Object.entries(scores)
                    .sort((a, b) => a[1] - b[1])
                    .map(([key, val]) => (
                      <ScoreBar key={key} label={key.replace('_', ' ')} score={val} />
                    ))}
                </div>
                <p className="text-xs text-slate-500 mt-3">
                  Based on {profile.games_analyzed} analyzed games
                </p>
              </div>
            )}
          </div>
        )}

        {tab === 'import' && (
          <GameImport userId={userId} username={username} onImported={handleImported} />
        )}

        {tab === 'games' && (
          <GameList games={games} userId={userId} onAnalyzed={() => fetchData(userId)} />
        )}
      </div>
    </div>
  )
}

function ActionCard({ icon, title, description, onClick }) {
  return (
    <button
      onClick={onClick}
      className="flex items-start gap-3 bg-chess-panel rounded-xl p-4 text-left hover:bg-chess-accent/50 transition-colors group"
    >
      <div className="text-chess-gold mt-0.5 flex-shrink-0">{icon}</div>
      <div className="flex-1">
        <div className="font-semibold text-white text-sm">{title}</div>
        <div className="text-slate-400 text-xs mt-0.5">{description}</div>
      </div>
      <ChevronRight size={16} className="text-slate-600 group-hover:text-chess-gold transition-colors mt-0.5" />
    </button>
  )
}

function ScoreBar({ label, score }) {
  const color = score >= 70 ? '#4ade80' : score >= 50 ? '#facc15' : '#ef4444'
  return (
    <div className="flex items-center gap-3">
      <span className="text-xs text-slate-400 capitalize w-28 flex-shrink-0">{label}</span>
      <div className="flex-1 bg-slate-700 rounded-full h-2">
        <div
          className="h-2 rounded-full transition-all"
          style={{ width: `${score}%`, backgroundColor: color }}
        />
      </div>
      <span className="text-xs font-bold w-8 text-right" style={{ color }}>
        {Math.round(score)}
      </span>
    </div>
  )
}

function NoProfileCard({ analyzedCount, onCompute, computing, onImport }) {
  return (
    <div className="bg-chess-panel rounded-xl p-8 flex flex-col items-center justify-center text-center">
      {analyzedCount === 0 ? (
        <>
          <p className="text-slate-400 mb-4">No games analyzed yet.</p>
          <button
            onClick={onImport}
            className="bg-chess-gold text-chess-dark font-semibold px-6 py-2 rounded-lg hover:opacity-90"
          >
            Import Games
          </button>
        </>
      ) : (
        <>
          <p className="text-slate-400 mb-2">{analyzedCount} games analyzed.</p>
          <p className="text-slate-500 text-sm mb-4">Compute your performance profile to see your scores.</p>
          <button
            onClick={onCompute}
            disabled={computing}
            className="bg-chess-gold text-chess-dark font-semibold px-6 py-2 rounded-lg hover:opacity-90 disabled:opacity-50"
          >
            {computing ? 'Computing…' : 'Compute Profile'}
          </button>
        </>
      )}
    </div>
  )
}
