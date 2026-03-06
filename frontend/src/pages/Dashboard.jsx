import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { BookOpen, Target, Calendar, RefreshCw, ChevronRight, PenLine, History, Trash2, AlertTriangle } from 'lucide-react'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  BarChart, Bar, Cell, ResponsiveContainer,
} from 'recharts'
import ScoreRadar from '../components/ScoreRadar'
import GameImport from '../components/GameImport'
import GameList from '../components/GameList'
import {
  listGames, getLatestProfile, computeProfile, selectGames,
  getProfileHistory, getPatternStats, resetDatabase,
} from '../api/client'

// ── Pattern label mapping ────────────────────────────────────────────────────

const PATTERN_LABELS = {
  fork: 'Fork (missed)',
  pin: 'Pin (missed)',
  hanging_piece_missed: 'Hanging piece (missed)',
  missed_checkmate: 'Missed checkmate',
  missed_fork: 'Missed fork',
  missed_pin: 'Missed pin',
  tactical_shot_found: 'Tactical shot found',
  pawn_structure_weakened: 'Pawn structure weakened',
  isolated_pawn_created: 'Isolated pawn',
  weak_squares_created: 'Weak squares',
  strategic_drift: 'Strategic drift',
  bishop_knight_trade_bad: 'Poor B×N trade',
  bishop_knight_trade_ok: 'Good B×N trade',
  checkmate_threat: 'Checkmate threat created',
}

const PATTERN_COLOR = (type) => {
  if (['fork', 'pin', 'missed_checkmate', 'missed_fork', 'missed_pin', 'hanging_piece_missed'].includes(type)) return '#ef4444'
  if (['tactical_shot_found', 'checkmate_threat'].includes(type)) return '#4ade80'
  if (['bishop_knight_trade_bad', 'pawn_structure_weakened', 'isolated_pawn_created', 'weak_squares_created', 'strategic_drift'].includes(type)) return '#f97316'
  return '#94a3b8'
}

// Score history: which scores to plot and their colors
const SCORE_LINES = [
  { key: 'tactics', color: '#e2b96f', label: 'Tactics' },
  { key: 'strategy', color: '#a78bfa', label: 'Strategy' },
  { key: 'endgame', color: '#60a5fa', label: 'Endgame' },
  { key: 'opening', color: '#34d399', label: 'Opening' },
  { key: 'mental_stability', color: '#f87171', label: 'Mental Stability' },
]

// ── Main component ───────────────────────────────────────────────────────────

export default function Dashboard({ userId, username, setUser }) {
  const navigate = useNavigate()
  const [games, setGames] = useState([])
  const [profile, setProfile] = useState(null)
  const [loading, setLoading] = useState(false)
  const [computingProfile, setComputingProfile] = useState(false)
  const [tab, setTab] = useState(userId ? 'overview' : 'import')
  const [showResetConfirm, setShowResetConfirm] = useState(false)
  const [resetting, setResetting] = useState(false)

  // Insights data
  const [profileHistory, setProfileHistory] = useState([])
  const [patternStats, setPatternStats] = useState(null)
  const [insightsLoading, setInsightsLoading] = useState(false)

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

  const fetchInsights = async (uid) => {
    if (!uid) return
    setInsightsLoading(true)
    try {
      const [histRes, patRes] = await Promise.allSettled([
        getProfileHistory(uid),
        getPatternStats(uid),
      ])
      if (histRes.status === 'fulfilled') setProfileHistory(histRes.value.data)
      if (patRes.status === 'fulfilled') setPatternStats(patRes.value.data)
    } finally {
      setInsightsLoading(false)
    }
  }

  useEffect(() => { fetchData(userId) }, [userId])

  // Load insights when tab is opened
  useEffect(() => {
    if (tab === 'insights' && userId && !profileHistory.length && !patternStats) {
      fetchInsights(userId)
    }
  }, [tab, userId])

  const handleImported = async (newUserId, importedUsername) => {
    setUser(newUserId, importedUsername)
    await fetchData(newUserId)
  }

  const handleComputeProfile = async () => {
    setComputingProfile(true)
    try {
      await computeProfile(userId)
      await fetchData(userId)
      // Refresh insights too if loaded
      if (profileHistory.length || patternStats) fetchInsights(userId)
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
        navigate(`/coaching/${firstGame.game_id}`, { state: { selectedGames: res.data.selected_games, userId } })
      }
    } catch {
      alert('Run analysis first to get game recommendations.')
    }
  }

  const handleResetDatabase = async () => {
    setResetting(true)
    try {
      await resetDatabase()
      setUser(null, null)
      setGames([])
      setProfile(null)
      setProfileHistory([])
      setPatternStats(null)
      setTab('import')
    } catch (e) {
      alert(e.response?.data?.detail || e.message)
    } finally {
      setResetting(false)
      setShowResetConfirm(false)
    }
  }

  const handleStartSelfAnalysis = async () => {
    try {
      const res = await selectGames(userId)
      const firstGame = res.data.selected_games?.[0]
      if (firstGame) navigate(`/self-analysis/${firstGame.game_id}`)
    } catch {
      alert('Run analysis first to get game recommendations.')
    }
  }

  const scores = profile ? {
    attack: profile.attack_score,
    defense: profile.defense_score,
    opening: profile.opening_score,
    strategy: profile.strategy_score,
    endgame: profile.endgame_score,
    tactics: profile.tactics_score,
    time_management: profile.time_management_score,
    conversion: profile.conversion_score,
    mental_stability: profile.mental_stability_score,
  } : null

  const analyzedCount = games.filter(g => g.has_analysis).length
  const TABS = ['overview', 'insights', 'import', 'games']

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
          <div className="flex items-center gap-4">
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
            <button
              onClick={() => setShowResetConfirm(true)}
              className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-red-400 transition-colors"
              title="Delete all data"
            >
              <Trash2 size={14} />
              Reset DB
            </button>
          </div>
        </div>

        {/* Reset confirmation modal */}
        {showResetConfirm && (
          <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50">
            <div className="bg-chess-panel border border-slate-700 rounded-xl p-6 max-w-sm w-full mx-4 shadow-2xl">
              <div className="flex items-center gap-3 mb-3">
                <AlertTriangle size={22} className="text-red-400 flex-shrink-0" />
                <h2 className="text-lg font-semibold text-white">Reset database?</h2>
              </div>
              <p className="text-slate-400 text-sm mb-5">
                This will permanently delete <span className="text-white font-medium">all users, games, analyses, profiles, coaching sessions, and training plans</span>. There is no undo.
              </p>
              <div className="flex gap-3">
                <button
                  onClick={() => setShowResetConfirm(false)}
                  disabled={resetting}
                  className="flex-1 px-4 py-2 rounded-lg bg-slate-700 text-slate-200 text-sm font-medium hover:bg-slate-600 transition-colors disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  onClick={handleResetDatabase}
                  disabled={resetting}
                  className="flex-1 px-4 py-2 rounded-lg bg-red-600 text-white text-sm font-semibold hover:bg-red-500 transition-colors disabled:opacity-50"
                >
                  {resetting ? 'Deleting…' : 'Yes, delete everything'}
                </button>
              </div>
            </div>
          </div>
        )}


        {/* Action cards */}
        {profile && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
            <ActionCard icon={<BookOpen size={20} />} title="Start Coaching Session" description="Review your most instructive games interactively" onClick={handleStartCoaching} />
            <ActionCard icon={<PenLine size={20} />} title="Self-Analysis" description="Annotate your own moves before the engine reveals" onClick={handleStartSelfAnalysis} />
            <ActionCard icon={<Calendar size={20} />} title="Create Training Plan" description="Get a 4-week plan based on your weaknesses" onClick={() => navigate('/training')} />
            <ActionCard icon={<History size={20} />} title="Reviewed Games" description="See all your self-analysis sessions and scores" onClick={() => navigate('/reviewed-games')} />
          </div>
        )}

        {/* Tabs */}
        <div className="flex gap-1 mb-4 bg-chess-panel rounded-lg p-1 w-fit">
          {TABS.map(t => (
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
              <NoProfileCard analyzedCount={analyzedCount} onCompute={handleComputeProfile} computing={computingProfile} onImport={() => setTab('import')} />
            )}

            {profile && (
              <div className="bg-chess-panel rounded-xl p-4">
                <h2 className="text-lg font-semibold text-chess-gold mb-3">Profile Summary</h2>
                <div className="space-y-2">
                  {Object.entries(scores)
                    .sort((a, b) => a[1] - b[1])
                    .map(([key, val]) => (
                      <ScoreBar key={key} label={key.replace(/_/g, ' ')} score={val} />
                    ))}
                </div>
                <p className="text-xs text-slate-500 mt-3">Based on {profile.games_analyzed} analyzed games</p>
              </div>
            )}
          </div>
        )}

        {tab === 'insights' && (
          <InsightsTab
            profileHistory={profileHistory}
            patternStats={patternStats}
            loading={insightsLoading}
            onRefresh={() => fetchInsights(userId)}
          />
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

// ── Insights tab ─────────────────────────────────────────────────────────────

function InsightsTab({ profileHistory, patternStats, loading, onRefresh }) {
  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <span className="text-slate-400">Loading insights…</span>
      </div>
    )
  }

  if (!profileHistory.length && !patternStats?.patterns?.length) {
    return (
      <div className="bg-chess-panel rounded-xl p-8 text-center text-slate-400">
        <p className="mb-2">No insights yet.</p>
        <p className="text-sm text-slate-500">Import and analyze games, then compute your profile to see insights here.</p>
      </div>
    )
  }

  // Score history chart data
  const historyData = profileHistory.map((p, i) => ({
    label: profileHistory.length === 1 ? 'Current' : `#${i + 1}`,
    date: p.created_at ? new Date(p.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : `#${i + 1}`,
    ...SCORE_LINES.reduce((acc, s) => ({ ...acc, [s.key]: Math.round(p[s.key]) }), {}),
  }))

  // Pattern frequency chart data (top 10)
  const patternData = (patternStats?.patterns || [])
    .slice(0, 10)
    .map(p => ({
      name: PATTERN_LABELS[p.type] || p.type.replace(/_/g, ' '),
      type: p.type,
      count: p.count,
    }))

  return (
    <div className="space-y-6">
      {/* Score history */}
      <div className="bg-chess-panel rounded-xl p-4">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-chess-gold">Score History</h2>
          {profileHistory.length > 0 && (
            <span className="text-xs text-slate-500">{profileHistory.length} snapshot{profileHistory.length !== 1 ? 's' : ''}</span>
          )}
        </div>

        {profileHistory.length < 2 ? (
          <div className="text-slate-500 text-sm py-4 text-center">
            Recompute your profile after more games to see your progress over time.
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={historyData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
              <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#64748b' }} />
              <YAxis domain={[0, 100]} tick={{ fontSize: 10, fill: '#64748b' }} tickCount={6} />
              <Tooltip
                contentStyle={{ backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: 8 }}
                labelStyle={{ color: '#94a3b8', fontSize: 11 }}
                itemStyle={{ fontSize: 11 }}
              />
              <Legend wrapperStyle={{ fontSize: 11, paddingTop: 8 }} />
              {SCORE_LINES.map(s => (
                <Line
                  key={s.key}
                  type="monotone"
                  dataKey={s.key}
                  name={s.label}
                  stroke={s.color}
                  strokeWidth={2}
                  dot={{ r: 3, fill: s.color }}
                  activeDot={{ r: 5 }}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* Pattern frequency */}
      {patternData.length > 0 && (
        <div className="bg-chess-panel rounded-xl p-4">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-chess-gold">Pattern Frequency</h2>
            <span className="text-xs text-slate-500">
              {patternStats?.total_games || 0} games analyzed · your moves only
            </span>
          </div>
          <ResponsiveContainer width="100%" height={Math.max(180, patternData.length * 32)}>
            <BarChart data={patternData} layout="vertical" margin={{ left: 8, right: 24 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" horizontal={false} />
              <XAxis type="number" tick={{ fontSize: 10, fill: '#64748b' }} allowDecimals={false} />
              <YAxis
                type="category"
                dataKey="name"
                width={170}
                tick={{ fontSize: 10, fill: '#94a3b8' }}
              />
              <Tooltip
                contentStyle={{ backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: 8 }}
                labelStyle={{ color: '#94a3b8', fontSize: 11 }}
                formatter={(v, _name, { payload }) => [v, PATTERN_LABELS[payload.type] || payload.type]}
              />
              <Bar dataKey="count" radius={[0, 4, 4, 0]}>
                {patternData.map((entry) => (
                  <Cell key={entry.type} fill={PATTERN_COLOR(entry.type)} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
          <div className="flex gap-4 mt-3 text-xs text-slate-500">
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-red-500" /> Missed tactics / errors</span>
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-orange-500" /> Positional issues</span>
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-green-400" /> Strengths</span>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Helper components ─────────────────────────────────────────────────────────

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
        <div className="h-2 rounded-full transition-all" style={{ width: `${score}%`, backgroundColor: color }} />
      </div>
      <span className="text-xs font-bold w-8 text-right" style={{ color }}>{Math.round(score)}</span>
    </div>
  )
}

function NoProfileCard({ analyzedCount, onCompute, computing, onImport }) {
  return (
    <div className="bg-chess-panel rounded-xl p-8 flex flex-col items-center justify-center text-center">
      {analyzedCount === 0 ? (
        <>
          <p className="text-slate-400 mb-4">No games analyzed yet.</p>
          <button onClick={onImport} className="bg-chess-gold text-chess-dark font-semibold px-6 py-2 rounded-lg hover:opacity-90">
            Import Games
          </button>
        </>
      ) : (
        <>
          <p className="text-slate-400 mb-2">{analyzedCount} games analyzed.</p>
          <p className="text-slate-500 text-sm mb-4">Compute your performance profile to see your scores.</p>
          <button onClick={onCompute} disabled={computing} className="bg-chess-gold text-chess-dark font-semibold px-6 py-2 rounded-lg hover:opacity-90 disabled:opacity-50">
            {computing ? 'Computing…' : 'Compute Profile'}
          </button>
        </>
      )}
    </div>
  )
}
