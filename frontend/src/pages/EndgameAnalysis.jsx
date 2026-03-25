import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  ChevronLeft, Swords, AlertTriangle, TrendingUp, TrendingDown,
  Brain, ChevronDown, ChevronUp, RefreshCw,
} from 'lucide-react'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell,
} from 'recharts'
import { getEndgameProfile } from '../api/client'
import { streamPost } from '../api/sse'
import Md from '../components/Md'

// ── Constants ────────────────────────────────────────────────────────────────

const CATEGORY_META = {
  king_pawn:   { label: 'King & Pawn',    color: '#facc15', bg: 'bg-yellow-900/30 border-yellow-700/40' },
  rook:        { label: 'Rook Endgames',  color: '#60a5fa', bg: 'bg-blue-900/30 border-blue-700/40'   },
  minor_piece: { label: 'Minor Piece',    color: '#a78bfa', bg: 'bg-purple-900/30 border-purple-700/40' },
  queen:       { label: 'Queen Endgames', color: '#f472b6', bg: 'bg-pink-900/30 border-pink-700/40'   },
}

const MENTAL_LABELS = {
  rushing_when_winning:        'Rushing when winning',
  loss_of_focus_after_mistake: 'Loss of focus after mistake',
  overcomplication:            'Overcomplication',
}

const scoreColor = (s) => s >= 65 ? '#4ade80' : s >= 45 ? '#facc15' : '#ef4444'

// ── Sub-components ────────────────────────────────────────────────────────────

function StatPill({ label, value, sub }) {
  return (
    <div className="bg-chess-panel rounded-xl p-3 sm:p-4 text-center">
      <div className="text-xs text-slate-400 mb-1">{label}</div>
      <div className="text-xl sm:text-2xl font-bold text-chess-gold">{value}</div>
      {sub && <div className="text-xs text-slate-500 mt-0.5">{sub}</div>}
    </div>
  )
}

function Pct({ value }) {
  if (value == null) return <span className="text-slate-500 text-xs">—</span>
  const pct = Math.round(value * 100)
  const color = pct >= 60 ? 'text-green-400' : pct >= 40 ? 'text-yellow-400' : 'text-red-400'
  return <span className={`font-semibold ${color}`}>{pct}%</span>
}

function CategoryCard({ catKey, data, isWeakest, isBest }) {
  const [open, setOpen] = useState(isWeakest)
  const meta = CATEGORY_META[catKey] || { label: catKey, color: '#94a3b8', bg: 'bg-slate-800' }

  return (
    <div className={`rounded-xl border ${meta.bg} overflow-hidden`}>
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between p-3 sm:p-4 hover:bg-white/5 transition-colors"
      >
        <div className="flex items-center gap-3">
          <div
            className="w-2.5 h-2.5 rounded-full flex-shrink-0"
            style={{ backgroundColor: meta.color }}
          />
          <div className="text-left">
            <div className="font-semibold text-white text-sm">{meta.label}</div>
            <div className="text-xs text-slate-400">{data.games} game{data.games !== 1 ? 's' : ''}</div>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {isWeakest && (
            <span className="text-xs bg-red-900/60 text-red-300 border border-red-700/40 px-2 py-0.5 rounded-full">
              Weakest
            </span>
          )}
          {isBest && !isWeakest && (
            <span className="text-xs bg-green-900/60 text-green-300 border border-green-700/40 px-2 py-0.5 rounded-full">
              Best
            </span>
          )}
          <span className="text-lg font-bold" style={{ color: scoreColor(data.score) }}>
            {Math.round(data.score)}
          </span>
          {open ? <ChevronUp size={14} className="text-slate-500" /> : <ChevronDown size={14} className="text-slate-500" />}
        </div>
      </button>

      {open && (
        <div className="px-4 pb-4 border-t border-white/10">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-3">
            <MetricBox label="Avg CPL" value={data.avg_cpl} unit="cp" />
            <MetricBox label="Blunder rate" value={`${(data.blunder_rate * 100).toFixed(1)}%`} />
            <div className="bg-chess-dark/40 rounded-lg p-2.5 text-center">
              <div className="text-xs text-slate-400 mb-1">Conversion</div>
              <div className="text-base font-bold"><Pct value={data.conversion_rate} /></div>
            </div>
            <div className="bg-chess-dark/40 rounded-lg p-2.5 text-center">
              <div className="text-xs text-slate-400 mb-1">Holding</div>
              <div className="text-base font-bold"><Pct value={data.holding_rate} /></div>
            </div>
          </div>
          {data.collapse_count > 0 && (
            <div className="mt-3 flex items-center gap-2 text-xs text-orange-300 bg-orange-900/20 border border-orange-700/30 rounded-lg px-3 py-2">
              <AlertTriangle size={12} />
              {data.collapse_count} collapse event{data.collapse_count !== 1 ? 's' : ''} detected in this category
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function MetricBox({ label, value, unit }) {
  return (
    <div className="bg-chess-dark/40 rounded-lg p-2.5 text-center">
      <div className="text-xs text-slate-400 mb-1">{label}</div>
      <div className="text-base font-bold text-white">
        {value}{unit && <span className="text-xs text-slate-400 ml-0.5">{unit}</span>}
      </div>
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function EndgameAnalysis({ userId }) {
  const navigate = useNavigate()
  const [profile, setProfile] = useState(null)
  const [loading, setLoading]     = useState(true)
  const [error, setError]         = useState(null)
  const [coaching, setCoaching]   = useState(null)
  const [coachLoading, setCoachLoading] = useState(false)

  const load = async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await getEndgameProfile(userId)
      setProfile(res.data)
    } catch (e) {
      setError(e.response?.data?.detail || e.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { if (userId) load() }, [userId])

  const handleCoaching = async () => {
    setCoaching('')
    setCoachLoading(true)
    try {
      await streamPost(
        `/endgame/${userId}/coaching-stream`,
        null,
        chunk => setCoaching(prev => prev + chunk),
      )
    } catch (e) {
      setCoaching(`Error: ${e.message}`)
    } finally {
      setCoachLoading(false)
    }
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-chess-dark p-3 sm:p-6">
      <div className="max-w-3xl mx-auto">

        {/* Header */}
        <div className="flex items-center gap-4 mb-6">
          <button
            onClick={() => navigate('/')}
            className="flex items-center gap-1 text-slate-400 hover:text-white text-sm"
          >
            <ChevronLeft size={16} /> Dashboard
          </button>
          <h1 className="text-xl sm:text-2xl font-bold text-chess-gold flex items-center gap-2">
            <Swords size={22} /> Endgame Analysis
          </h1>
          <button
            onClick={load}
            disabled={loading}
            className="ml-auto text-slate-400 hover:text-white"
            title="Refresh"
          >
            <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>

        {loading && (
          <div className="text-slate-400 text-center py-16">Analysing your endgames…</div>
        )}

        {error && !loading && (
          <div className="bg-red-900/30 border border-red-700 rounded-xl p-6 text-center text-red-300">
            {error}
          </div>
        )}

        {profile && !loading && (
          <>
            {/* Overview pills */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
              <StatPill
                label="Endgame games"
                value={profile.total_endgame_games}
                sub={`of ${profile.total_games_analyzed} analyzed`}
              />
              <StatPill
                label="Categories"
                value={Object.keys(profile.categories).length}
              />
              <StatPill
                label="Collapses"
                value={profile.collapse_count}
                sub={profile.collapse_count > 0 ? 'detected' : 'none detected'}
              />
              <StatPill
                label="Weakest"
                value={CATEGORY_META[profile.weakest_category]?.label ?? '—'}
              />
            </div>

            {/* Score bar chart */}
            {Object.keys(profile.categories).length > 0 && (
              <div className="bg-chess-panel rounded-xl p-4 mb-6">
                <h2 className="text-sm font-semibold text-chess-gold mb-3">Category Scores</h2>
                <ResponsiveContainer width="100%" height={160}>
                  <BarChart
                    data={Object.entries(profile.categories).map(([k, v]) => ({
                      name: CATEGORY_META[k]?.label ?? k,
                      score: Math.round(v.score),
                      color: CATEGORY_META[k]?.color ?? '#94a3b8',
                    }))}
                    margin={{ top: 4, right: 8, left: -20, bottom: 0 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                    <XAxis dataKey="name" tick={{ fill: '#94a3b8', fontSize: 10 }} />
                    <YAxis domain={[0, 100]} tick={{ fill: '#94a3b8', fontSize: 10 }} />
                    <Tooltip
                      contentStyle={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 8 }}
                      labelStyle={{ color: '#f1f5f9' }}
                      formatter={(v) => [`${v} / 100`, 'Score']}
                    />
                    <Bar dataKey="score" radius={[4, 4, 0, 0]}>
                      {Object.entries(profile.categories).map(([k]) => (
                        <Cell key={k} fill={scoreColor(profile.categories[k].score)} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}

            {/* Category detail cards */}
            <div className="space-y-3 mb-6">
              <h2 className="text-sm font-semibold text-slate-300">Category Breakdown</h2>
              {Object.entries(profile.categories).map(([k, v]) => (
                <CategoryCard
                  key={k}
                  catKey={k}
                  data={v}
                  isWeakest={k === profile.weakest_category}
                  isBest={k === profile.best_category}
                />
              ))}
            </div>

            {/* Mental patterns */}
            {profile.collapse_count > 0 && (
              <div className="bg-chess-panel rounded-xl p-4 mb-6">
                <div className="flex items-center gap-2 mb-3">
                  <Brain size={16} className="text-chess-gold" />
                  <h2 className="text-sm font-semibold text-chess-gold">Mental Patterns in Collapses</h2>
                </div>
                <div className="space-y-2">
                  {Object.entries(profile.mental_patterns)
                    .filter(([, v]) => v > 0)
                    .sort((a, b) => b[1] - a[1])
                    .map(([k, v]) => (
                      <div key={k} className="flex items-center justify-between">
                        <span className="text-sm text-slate-300">
                          {MENTAL_LABELS[k] ?? k}
                        </span>
                        <span className="text-xs font-semibold text-orange-300 bg-orange-900/30 px-2 py-0.5 rounded-full">
                          {v}×
                        </span>
                      </div>
                    ))
                  }
                  {Object.values(profile.mental_patterns).every(v => v === 0) && (
                    <p className="text-sm text-slate-500">No mental patterns detected in your endgames.</p>
                  )}
                </div>
              </div>
            )}

            {/* Coach insights */}
            <div className="bg-chess-panel rounded-xl p-4 mb-6 border border-chess-gold/20">
              <div className="flex items-center gap-2 mb-3">
                <Swords size={16} className="text-chess-gold" />
                <h2 className="text-sm font-semibold text-chess-gold">Coach Analysis</h2>
              </div>
              {coaching != null ? (
                <div>
                  <Md text={coaching} className="text-sm text-slate-300 leading-relaxed" />
                  {coachLoading && <span className="animate-pulse text-chess-gold">▌</span>}
                </div>
              ) : (
                <div>
                  <p className="text-xs text-slate-400 mb-3">
                    Get a personalised coaching report based on your endgame data.
                  </p>
                  <button
                    onClick={handleCoaching}
                    disabled={coachLoading}
                    className="bg-chess-gold text-chess-dark font-semibold px-4 py-2 rounded-lg hover:opacity-90 disabled:opacity-50 text-sm"
                  >
                    {coachLoading ? 'Analysing…' : 'Get Coach Feedback'}
                  </button>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
