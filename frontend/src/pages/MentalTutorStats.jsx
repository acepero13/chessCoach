import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  ChevronLeft, Brain, Trophy, XCircle, MinusCircle,
  Zap, Flame, AlertTriangle, CheckCircle,
} from 'lucide-react'
import {
  BarChart, Bar, Cell, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  LineChart, Line, ReferenceLine,
} from 'recharts'
import { getMentalStats } from '../api/client'
import { streamPost } from '../api/sse'
import Md from '../components/Md'

const ERROR_META = {
  rushing:          { label: 'Rushing',          color: '#fb923c', icon: Zap },
  overcomplication: { label: 'Overcomplication',  color: '#c084fc', icon: Flame },
  relaxation:       { label: 'Loss of Focus',     color: '#60a5fa', icon: MinusCircle },
  tilt:             { label: 'Tilt',              color: '#f87171', icon: AlertTriangle },
}

const RESULT_META = {
  converted: { label: 'Converted', color: '#4ade80' },
  failed:    { label: 'Failed',    color: '#f87171' },
  partial:   { label: 'Partial',   color: '#fbbf24' },
}

function StatCard({ label, value, sub, color = 'text-chess-gold' }) {
  return (
    <div className="bg-chess-panel rounded-xl p-4 text-center">
      <div className="text-xs text-slate-400 mb-1">{label}</div>
      <div className={`text-2xl font-bold ${color}`}>{value}</div>
      {sub && <div className="text-xs text-slate-500 mt-0.5">{sub}</div>}
    </div>
  )
}

export default function MentalTutorStats({ userId }) {
  const navigate = useNavigate()
  const [stats, setStats] = useState(null)
  const [loading, setLoading] = useState(true)
  const [coaching, setCoaching] = useState('')
  const [coachLoading, setCoachLoading] = useState(false)

  useEffect(() => {
    getMentalStats(userId)
      .then(r => setStats(r.data))
      .catch(() => setStats({ total_sessions: 0 }))
      .finally(() => setLoading(false))
  }, [userId])

  const handleCoaching = async () => {
    setCoaching('')
    setCoachLoading(true)
    try {
      await streamPost(
        `/mental-tutor/${userId}/stats/coaching-stream`,
        null,
        chunk => setCoaching(prev => prev + chunk),
      )
    } catch (e) {
      setCoaching('Coach unavailable: ' + e.message)
    } finally {
      setCoachLoading(false)
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-chess-dark flex items-center justify-center text-slate-400 animate-pulse">
        Loading…
      </div>
    )
  }

  if (!stats || stats.total_sessions === 0) {
    return (
      <div className="min-h-screen bg-chess-dark p-6">
        <div className="max-w-4xl mx-auto">
          <div className="flex items-center gap-4 mb-6">
            <button onClick={() => navigate('/mental-tutor')} className="flex items-center gap-1 text-slate-400 hover:text-white text-sm">
              <ChevronLeft size={16} /> Mental Tutor
            </button>
            <h1 className="text-2xl font-bold text-chess-gold flex items-center gap-2">
              <Brain size={24} /> Mental Tutor Stats
            </h1>
          </div>
          <div className="bg-chess-panel rounded-xl p-10 text-center">
            <p className="text-slate-400 mb-2">No completed sessions yet.</p>
            <p className="text-slate-500 text-sm">Complete mental tutor sessions to see your statistics here.</p>
            <button
              onClick={() => navigate('/mental-tutor')}
              className="mt-4 bg-chess-gold text-chess-dark font-semibold px-5 py-2 rounded-lg text-sm hover:opacity-90"
            >
              Start Training
            </button>
          </div>
        </div>
      </div>
    )
  }

  const { total_sessions, results_breakdown, conversion_rate, clean_sessions,
          mental_error_counts, most_common_error, avg_eval_change, trend } = stats

  // Bar chart data for mental errors
  const errorBarData = Object.entries(mental_error_counts || {})
    .filter(([, v]) => v > 0 || true)
    .map(([key, count]) => ({
      name: ERROR_META[key]?.label || key,
      count,
      fill: ERROR_META[key]?.color || '#64748b',
    }))

  // Results bar data
  const resultBarData = Object.entries(results_breakdown || {}).map(([key, count]) => ({
    name: RESULT_META[key]?.label || key,
    count,
    fill: RESULT_META[key]?.color || '#64748b',
  }))

  // Trend line data
  const trendData = (trend || []).map((t, i) => ({
    session: i + 1,
    eval_change: t.eval_change,
    result: t.result,
  }))

  const convColor = conversion_rate >= 60 ? 'text-green-400' : conversion_rate >= 40 ? 'text-amber-400' : 'text-red-400'
  const changeColor = avg_eval_change >= 0 ? 'text-green-400' : 'text-red-400'

  return (
    <div className="min-h-screen bg-chess-dark p-6">
      <div className="max-w-4xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center gap-4">
          <button onClick={() => navigate('/mental-tutor')} className="flex items-center gap-1 text-slate-400 hover:text-white text-sm">
            <ChevronLeft size={16} /> Mental Tutor
          </button>
          <h1 className="text-2xl font-bold text-chess-gold flex items-center gap-2">
            <Brain size={24} /> Mental Tutor Stats
          </h1>
        </div>

        {/* Overview cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <StatCard label="Sessions" value={total_sessions} />
          <StatCard label="Conversion Rate" value={`${conversion_rate}%`} color={convColor} />
          <StatCard
            label="Clean Sessions"
            value={`${clean_sessions}/${total_sessions}`}
            sub="no mental errors"
            color="text-blue-400"
          />
          <StatCard
            label="Avg Eval Change"
            value={`${avg_eval_change >= 0 ? '+' : ''}${avg_eval_change} cp`}
            sub="per session"
            color={changeColor}
          />
        </div>

        {/* Results breakdown */}
        <div className="bg-chess-panel rounded-xl p-5">
          <h2 className="text-chess-gold font-semibold mb-4">Session Results</h2>
          <div className="grid grid-cols-3 gap-3 mb-4">
            {Object.entries(results_breakdown || {}).map(([key, count]) => {
              const meta = RESULT_META[key] || { label: key, color: '#64748b' }
              const Icon = key === 'converted' ? CheckCircle : key === 'failed' ? XCircle : MinusCircle
              return (
                <div key={key} className="bg-chess-dark/60 rounded-lg p-3 text-center">
                  <Icon size={18} className="mx-auto mb-1" style={{ color: meta.color }} />
                  <div className="text-lg font-bold" style={{ color: meta.color }}>{count}</div>
                  <div className="text-xs text-slate-400">{meta.label}</div>
                </div>
              )
            })}
          </div>
          <ResponsiveContainer width="100%" height={100}>
            <BarChart data={resultBarData} layout="vertical" barSize={18}>
              <XAxis type="number" tick={{ fontSize: 10, fill: '#64748b' }} />
              <YAxis type="category" dataKey="name" tick={{ fontSize: 11, fill: '#94a3b8' }} width={75} />
              <Tooltip
                contentStyle={{ backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: 8 }}
                formatter={v => [v, 'Sessions']}
              />
              <Bar dataKey="count" radius={4}>
                {resultBarData.map((entry, i) => (
                  <Cell key={i} fill={entry.fill} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Mental error frequency */}
        <div className="bg-chess-panel rounded-xl p-5">
          <h2 className="text-chess-gold font-semibold mb-1">Mental Error Frequency</h2>
          <p className="text-slate-500 text-xs mb-4">How often each error type appears across sessions (max 1 per session per type)</p>
          {most_common_error && (
            <div className="mb-3 flex items-center gap-2">
              <span className="text-xs text-slate-400">Most common:</span>
              <span className="text-sm font-semibold" style={{ color: ERROR_META[most_common_error]?.color }}>
                {ERROR_META[most_common_error]?.label || most_common_error}
              </span>
            </div>
          )}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
            {Object.entries(mental_error_counts || {}).map(([key, count]) => {
              const meta = ERROR_META[key] || { label: key, color: '#64748b', icon: AlertTriangle }
              const Icon = meta.icon
              const pct = total_sessions > 0 ? Math.round(count / total_sessions * 100) : 0
              return (
                <div key={key} className="bg-chess-dark/60 rounded-lg p-3 text-center">
                  <Icon size={16} className="mx-auto mb-1" style={{ color: meta.color }} />
                  <div className="text-lg font-bold" style={{ color: meta.color }}>{count}</div>
                  <div className="text-xs text-slate-400">{meta.label}</div>
                  <div className="text-xs text-slate-600 mt-0.5">{pct}% of sessions</div>
                </div>
              )
            })}
          </div>
          <ResponsiveContainer width="100%" height={120}>
            <BarChart data={errorBarData} barSize={30}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
              <XAxis dataKey="name" tick={{ fontSize: 10, fill: '#94a3b8' }} />
              <YAxis tick={{ fontSize: 10, fill: '#64748b' }} allowDecimals={false} />
              <Tooltip
                contentStyle={{ backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: 8 }}
                formatter={v => [v, 'Occurrences']}
              />
              <Bar dataKey="count" radius={4}>
                {errorBarData.map((entry, i) => (
                  <Cell key={i} fill={entry.fill} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Trend */}
        {trendData.length > 1 && (
          <div className="bg-chess-panel rounded-xl p-5">
            <h2 className="text-chess-gold font-semibold mb-4">Eval Change Trend (last {trendData.length} sessions)</h2>
            <p className="text-slate-500 text-xs mb-3">Positive = you maintained/grew your advantage. Negative = you lost material.</p>
            <ResponsiveContainer width="100%" height={160}>
              <LineChart data={trendData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                <XAxis dataKey="session" tick={{ fontSize: 10, fill: '#64748b' }} label={{ value: 'Session', position: 'insideBottom', fill: '#64748b', fontSize: 10 }} />
                <YAxis tick={{ fontSize: 10, fill: '#64748b' }} />
                <Tooltip
                  contentStyle={{ backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: 8 }}
                  formatter={v => [`${v >= 0 ? '+' : ''}${v} cp`, 'Eval Change']}
                  labelFormatter={l => `Session ${l}`}
                />
                <ReferenceLine y={0} stroke="#64748b" strokeDasharray="3 3" />
                <Line type="monotone" dataKey="eval_change" stroke="#e2b96f" strokeWidth={2} dot={{ r: 3, fill: '#e2b96f' }} connectNulls />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}

        {/* Recent sessions list */}
        {trend && trend.length > 0 && (
          <div className="bg-chess-panel rounded-xl p-5">
            <h2 className="text-chess-gold font-semibold mb-4">Recent Sessions</h2>
            <div className="space-y-2">
              {[...trend].reverse().slice(0, 10).map((t, i) => {
                const resultMeta = RESULT_META[t.result] || { label: t.result, color: '#64748b' }
                const Icon = t.result === 'converted' ? CheckCircle : t.result === 'failed' ? XCircle : MinusCircle
                return (
                  <div key={i} className="flex items-center gap-3 py-2 border-b border-slate-800 last:border-0">
                    <Icon size={14} style={{ color: resultMeta.color }} className="flex-shrink-0" />
                    <span className="text-sm font-semibold w-20" style={{ color: resultMeta.color }}>
                      {resultMeta.label}
                    </span>
                    <div className="flex flex-wrap gap-1.5 flex-1">
                      {t.error_types.length === 0 ? (
                        <span className="text-xs text-green-600">Clean</span>
                      ) : t.error_types.map((et, j) => (
                        <span key={j} className="text-xs px-1.5 py-0.5 rounded-full bg-slate-800"
                          style={{ color: ERROR_META[et]?.color || '#94a3b8' }}>
                          {ERROR_META[et]?.label || et}
                        </span>
                      ))}
                    </div>
                    {t.eval_change !== null && (
                      <span className={`text-xs font-mono flex-shrink-0 ${t.eval_change >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                        {t.eval_change >= 0 ? '+' : ''}{t.eval_change} cp
                      </span>
                    )}
                    {t.date && (
                      <span className="text-xs text-slate-600 flex-shrink-0">
                        {new Date(t.date).toLocaleDateString()}
                      </span>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* Coach Assessment */}
        <div className="bg-chess-panel rounded-xl p-5">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-chess-gold font-semibold">Coach's Assessment</h2>
            <button
              onClick={handleCoaching}
              disabled={coachLoading}
              className="text-sm border border-chess-gold text-chess-gold px-4 py-1.5 rounded-lg hover:bg-chess-gold/10 disabled:opacity-50 transition-colors"
            >
              {coachLoading ? 'Analysing…' : coaching ? 'Refresh' : 'Analyse'}
            </button>
          </div>
          {(coaching || coachLoading) ? (
            coaching ? (
              <div>
                <Md text={coaching} />
                {coachLoading && <span className="animate-pulse text-chess-gold">▌</span>}
              </div>
            ) : (
              <p className="text-slate-500 text-sm animate-pulse">Coach is analysing…</p>
            )
          ) : (
            <p className="text-slate-500 text-sm">Click "Analyse" to get personalised coaching feedback based on your mental error patterns.</p>
          )}
        </div>
      </div>
    </div>
  )
}
