import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  LineChart, Line, ResponsiveContainer, Cell, Legend,
} from 'recharts'
import {
  ArrowLeft, BarChart2, TrendingUp, AlertTriangle,
  Target, Brain, BookOpen, ChevronDown, ChevronUp, MessageSquare,
} from 'lucide-react'
import { getSelfAnalysisStats } from '../api/client'
import { streamPost } from '../api/sse'
import Md from '../components/Md'

// ── Helpers ─────────────────────────────────────────────────────────────────

function scoreColor(v) {
  if (v == null) return '#64748b'
  if (v >= 75) return '#22c55e'
  if (v >= 50) return '#eab308'
  return '#ef4444'
}

function ScoreBar({ label, value, max = 100 }) {
  const pct = value != null ? Math.round((value / max) * 100) : 0
  const color = scoreColor(value)
  return (
    <div>
      <div className="flex justify-between text-xs mb-1">
        <span className="text-slate-400">{label}</span>
        <span className="font-mono font-bold" style={{ color }}>{value != null ? value : '—'}</span>
      </div>
      <div className="h-2 bg-slate-700 rounded-full overflow-hidden">
        <div
          className="h-full rounded-full transition-all"
          style={{ width: `${pct}%`, backgroundColor: color }}
        />
      </div>
    </div>
  )
}

function StatCard({ icon, label, value, sub, color = 'text-chess-gold' }) {
  return (
    <div className="bg-chess-panel border border-slate-700 rounded-lg p-4 flex flex-col gap-1">
      <div className={`flex items-center gap-2 text-xs text-slate-400 mb-1`}>
        <span className={color}>{icon}</span>
        {label}
      </div>
      <div className="text-2xl font-bold text-white">{value ?? '—'}</div>
      {sub && <div className="text-xs text-slate-500">{sub}</div>}
    </div>
  )
}

function Section({ title, icon, children, defaultOpen = true }) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="bg-chess-panel border border-slate-700 rounded-lg overflow-hidden">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-5 py-3 hover:bg-slate-800/40 transition-colors"
      >
        <div className="flex items-center gap-2 text-sm font-semibold text-white">
          <span className="text-chess-gold">{icon}</span>
          {title}
        </div>
        {open ? <ChevronUp size={16} className="text-slate-400" /> : <ChevronDown size={16} className="text-slate-400" />}
      </button>
      {open && <div className="px-5 pb-5 pt-2">{children}</div>}
    </div>
  )
}

const SCORE_KEYS = [
  { key: 'eval_accuracy', label: 'Eval Accuracy', color: '#eab308' },
  { key: 'candidate_quality', label: 'Candidate Quality', color: '#22c55e' },
  { key: 'tactical_awareness', label: 'Tactical Awareness', color: '#3b82f6' },
  { key: 'confidence_calibration', label: 'Confidence Calibration', color: '#ec4899' },
]

const CLS_COLORS = {
  good: '#22c55e',
  inaccuracy: '#eab308',
  mistake: '#f97316',
  blunder: '#ef4444',
}

const CLS_LABELS = {
  good: 'Good',
  inaccuracy: 'Inaccuracy',
  mistake: 'Mistake',
  blunder: 'Blunder',
}

// Custom tooltip for the trend chart
function TrendTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-slate-900 border border-slate-700 rounded p-3 text-xs space-y-1">
      <div className="text-slate-400 mb-1">Session {label}</div>
      {payload.map(p => (
        <div key={p.dataKey} className="flex justify-between gap-4">
          <span style={{ color: p.color }}>{p.name}</span>
          <span className="font-mono font-bold text-white">{p.value}</span>
        </div>
      ))}
    </div>
  )
}

// ── Main component ──────────────────────────────────────────────────────────

export default function SelfAnalysisStats({ userId }) {
  const navigate = useNavigate()
  const [stats, setStats] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [coaching, setCoaching] = useState(null)
  const [coachingLoading, setCoachingLoading] = useState(false)

  useEffect(() => {
    if (!userId) return
    getSelfAnalysisStats(userId)
      .then(res => setStats(res.data))
      .catch(e => setError(e.response?.data?.detail || e.message))
      .finally(() => setLoading(false))
  }, [userId])

  // ── Trend data: index each session 1..N for the X axis
  const trendData = (stats?.score_trends || []).map((s, i) => ({
    idx: i + 1,
    ...SCORE_KEYS.reduce((acc, { key }) => {
      acc[key] = s[key] ?? null
      return acc
    }, {}),
  }))

  // ── Pattern freq: top 10
  const patterns = (stats?.pattern_frequency || []).slice(0, 10)

  // ── Classification bar data
  const clsData = Object.entries(stats?.classification_breakdown || {}).map(([k, v]) => ({
    name: CLS_LABELS[k] || k,
    count: v,
    fill: CLS_COLORS[k] || '#64748b',
  }))

  // ── Root cause data
  const rcData = (stats?.root_cause_distribution || [])

  // ── Eval verdict data
  const evData = Object.entries(stats?.eval_verdict_distribution || {})
    .filter(([, v]) => v > 0)
    .map(([k, v]) => ({ name: k, count: v }))

  // ── Improvement areas: avg scores sorted ascending (worst first)
  const avgScores = stats?.avg_scores || {}
  const improvementAreas = SCORE_KEYS
    .filter(({ key }) => avgScores[key] != null)
    .sort((a, b) => avgScores[a.key] - avgScores[b.key])

  // ──────────────────────────────────────────────────────────────────────────

  if (!userId) {
    return (
      <div className="min-h-screen bg-chess-dark text-white flex items-center justify-center">
        <p className="text-slate-400">Please set up your profile on the dashboard first.</p>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-chess-dark text-white">
      {/* Header */}
      <div className="border-b border-slate-800 bg-chess-panel">
        <div className="max-w-5xl mx-auto px-4 py-4 flex items-center gap-3">
          <button
            onClick={() => navigate('/')}
            className="text-slate-400 hover:text-white transition-colors"
          >
            <ArrowLeft size={20} />
          </button>
          <BarChart2 size={20} className="text-chess-gold" />
          <h1 className="text-lg font-bold">Self-Analysis Statistics</h1>
          {stats && (
            <span className="ml-auto text-xs text-slate-500">
              {stats.total_sessions} session{stats.total_sessions !== 1 ? 's' : ''}
            </span>
          )}
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-4 py-6 space-y-6">

        {loading && (
          <div className="text-center py-20 text-slate-400">Loading statistics…</div>
        )}

        {error && (
          <div className="text-center py-20 text-red-400">Error: {error}</div>
        )}

        {!loading && !error && stats?.total_sessions === 0 && (
          <div className="text-center py-20 text-slate-400">
            <BarChart2 size={40} className="mx-auto mb-3 opacity-30" />
            <p>No completed self-analysis sessions yet.</p>
            <p className="text-sm mt-1">Complete a session to see your statistics.</p>
          </div>
        )}

        {!loading && !error && stats?.total_sessions > 0 && (
          <>
            {/* ── Overview cards ── */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <StatCard
                icon={<BookOpen size={14} />}
                label="Sessions completed"
                value={stats.total_sessions}
              />
              <StatCard
                icon={<Target size={14} />}
                label="Moves reviewed"
                value={stats.total_moves_reviewed}
              />
              <StatCard
                icon={<AlertTriangle size={14} />}
                label="Avg centipawn loss"
                value={stats.avg_centipawn_loss != null ? `${stats.avg_centipawn_loss} cp` : null}
                sub="capped at 500 cp per move"
                color="text-orange-400"
              />
              <StatCard
                icon={<TrendingUp size={14} />}
                label="Error rate"
                value={stats.mistake_rate != null ? `${stats.mistake_rate}%` : null}
                sub="inaccuracies + mistakes + blunders"
                color="text-red-400"
              />
            </div>

            {/* ── LLM coaching narrative ── */}
            <Section title="Coach's Assessment" icon={<MessageSquare size={15} />}>
              {coaching ? (
                <div>
                  <Md text={coaching} className="text-sm text-slate-300 leading-relaxed" />
                  {coachingLoading && (
                    <span className="inline-block w-1.5 h-4 bg-chess-gold animate-pulse ml-0.5 align-middle" />
                  )}
                </div>
              ) : (
                <div className="flex flex-col items-start gap-3">
                  <p className="text-sm text-slate-400">
                    Get a personalised coaching report based on your statistics — patterns, priority areas, and a concrete action for this week.
                  </p>
                  <button
                    onClick={() => {
                      setCoachingLoading(true)
                      setCoaching('')
                      streamPost(
                        `/selfanalysis/user/${userId}/stats/coaching`,
                        null,
                        chunk => setCoaching(prev => prev + chunk),
                      )
                        .catch(() => setCoaching('_(Coach unavailable — Ollama not reachable)_'))
                        .finally(() => setCoachingLoading(false))
                    }}
                    disabled={coachingLoading}
                    className="flex items-center gap-2 px-4 py-2 bg-chess-gold text-chess-dark text-sm font-semibold rounded-lg hover:bg-yellow-400 transition-colors disabled:opacity-50 disabled:cursor-wait"
                  >
                    <MessageSquare size={14} />
                    {coachingLoading ? 'Generating…' : 'Get Coach Assessment'}
                  </button>
                </div>
              )}
            </Section>

            {/* ── Average scores ── */}
            <Section title="Average Scores" icon={<Target size={15} />}>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {SCORE_KEYS.map(({ key, label }) => (
                  <ScoreBar key={key} label={label} value={avgScores[key]} />
                ))}
              </div>
            </Section>

            {/* ── Areas to improve ── */}
            {improvementAreas.length > 0 && (
              <Section title="Priority Areas to Improve" icon={<Brain size={15} />}>
                <div className="space-y-2">
                  {improvementAreas.map(({ key, label, color }, i) => {
                    const val = avgScores[key]
                    const isWeak = val != null && val < 60
                    return (
                      <div key={key} className="flex items-center gap-3">
                        <span className="text-xs text-slate-500 w-5 text-right">{i + 1}.</span>
                        <div className="flex-1">
                          <div className="flex justify-between text-xs mb-0.5">
                            <span className={isWeak ? 'text-white font-medium' : 'text-slate-400'}>{label}</span>
                            <span className="font-mono" style={{ color: scoreColor(val) }}>{val ?? '—'}</span>
                          </div>
                          <div className="h-1.5 bg-slate-700 rounded-full overflow-hidden">
                            <div
                              className="h-full rounded-full"
                              style={{ width: `${val ?? 0}%`, backgroundColor: color }}
                            />
                          </div>
                        </div>
                        {isWeak && (
                          <span className="text-xs text-orange-400 font-medium">needs work</span>
                        )}
                      </div>
                    )
                  })}
                </div>
                {improvementAreas.length > 0 && (
                  <p className="text-xs text-slate-500 mt-4">
                    Focus on the top items — they represent the biggest gains available.
                  </p>
                )}
              </Section>
            )}

            {/* ── Score trends ── */}
            {trendData.length > 1 && (
              <Section title="Score Trends" icon={<TrendingUp size={15} />}>
                <ResponsiveContainer width="100%" height={200}>
                  <LineChart data={trendData} margin={{ top: 4, right: 8, left: -24, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                    <XAxis
                      dataKey="idx"
                      tick={{ fontSize: 11, fill: '#94a3b8' }}
                      label={{ value: 'Session', position: 'insideBottom', offset: -2, fontSize: 10, fill: '#64748b' }}
                    />
                    <YAxis domain={[0, 100]} tick={{ fontSize: 11, fill: '#94a3b8' }} />
                    <Tooltip content={<TrendTooltip />} />
                    <Legend wrapperStyle={{ fontSize: 11, paddingTop: 8 }} />
                    {SCORE_KEYS.map(({ key, label, color }) => (
                      <Line
                        key={key}
                        type="monotone"
                        dataKey={key}
                        name={label}
                        stroke={color}
                        strokeWidth={2}
                        dot={{ r: 3 }}
                        connectNulls
                      />
                    ))}
                  </LineChart>
                </ResponsiveContainer>
              </Section>
            )}

            {/* ── Pattern frequency ── */}
            {patterns.length > 0 && (
              <Section title="Pattern Frequency" icon={<BarChart2 size={15} />}>
                <p className="text-xs text-slate-500 mb-4">
                  Patterns detected across all your reviewed moves. Recurring patterns are your recurring weaknesses.
                </p>
                <ResponsiveContainer width="100%" height={patterns.length * 36 + 20}>
                  <BarChart
                    data={patterns}
                    layout="vertical"
                    margin={{ left: 8, right: 32, top: 0, bottom: 0 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="#334155" horizontal={false} />
                    <XAxis type="number" tick={{ fontSize: 11, fill: '#94a3b8' }} allowDecimals={false} />
                    <YAxis
                      type="category"
                      dataKey="label"
                      width={160}
                      tick={{ fontSize: 11, fill: '#94a3b8' }}
                    />
                    <Tooltip
                      formatter={(val, name) => [val, 'Occurrences']}
                      contentStyle={{ background: '#0f172a', border: '1px solid #334155', fontSize: 12 }}
                    />
                    <Bar dataKey="count" radius={[0, 4, 4, 0]}>
                      {patterns.map((p, i) => {
                        const isBad = p.type.includes('bad') || p.type.startsWith('missed') || p.type.startsWith('hanging')
                        const isGood = p.type.includes('ok') || p.type === 'fork' || p.type === 'pin' || p.type === 'checkmate_threat'
                        const fill = isBad ? '#ef4444' : isGood ? '#22c55e' : '#f97316'
                        return <Cell key={i} fill={fill} />
                      })}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
                <div className="flex gap-4 mt-3 text-xs text-slate-500">
                  <span><span className="inline-block w-2 h-2 rounded-sm bg-red-500 mr-1" />Weaknesses</span>
                  <span><span className="inline-block w-2 h-2 rounded-sm bg-orange-500 mr-1" />Structural issues</span>
                  <span><span className="inline-block w-2 h-2 rounded-sm bg-green-500 mr-1" />Strengths detected</span>
                </div>
              </Section>
            )}

            {/* ── Classification breakdown ── */}
            {clsData.length > 0 && (
              <Section title="Move Classification Breakdown" icon={<AlertTriangle size={15} />} defaultOpen={false}>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <ResponsiveContainer width="100%" height={180}>
                      <BarChart data={clsData} margin={{ top: 4, right: 8, left: -24, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                        <XAxis dataKey="name" tick={{ fontSize: 11, fill: '#94a3b8' }} />
                        <YAxis tick={{ fontSize: 11, fill: '#94a3b8' }} allowDecimals={false} />
                        <Tooltip
                          formatter={val => [val, 'Moves']}
                          contentStyle={{ background: '#0f172a', border: '1px solid #334155', fontSize: 12 }}
                        />
                        <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                          {clsData.map((d, i) => <Cell key={i} fill={d.fill} />)}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                  <div className="flex flex-col justify-center gap-3">
                    {clsData.map(d => {
                      const total = clsData.reduce((s, x) => s + x.count, 0)
                      const pct = total > 0 ? Math.round(d.count / total * 100) : 0
                      return (
                        <div key={d.name} className="flex items-center gap-2">
                          <div className="w-3 h-3 rounded-sm flex-shrink-0" style={{ backgroundColor: d.fill }} />
                          <span className="text-sm text-slate-300 flex-1">{d.name}</span>
                          <span className="font-mono text-sm text-white">{d.count}</span>
                          <span className="text-xs text-slate-500 w-8 text-right">{pct}%</span>
                        </div>
                      )
                    })}
                  </div>
                </div>
              </Section>
            )}

            {/* ── Root cause distribution ── */}
            {rcData.length > 0 && (
              <Section title="Mistake Root Causes" icon={<Brain size={15} />} defaultOpen={false}>
                <p className="text-xs text-slate-500 mb-4">
                  Why your mistakes happened — classified during review.
                </p>
                <div className="space-y-3">
                  {rcData.map(rc => {
                    const total = rcData.reduce((s, x) => s + x.count, 0)
                    const pct = total > 0 ? Math.round(rc.count / total * 100) : 0
                    return (
                      <div key={rc.type}>
                        <div className="flex justify-between text-xs mb-1">
                          <span className="text-slate-300">{rc.label}</span>
                          <span className="text-slate-400 font-mono">{rc.count} ({pct}%)</span>
                        </div>
                        <div className="h-2 bg-slate-700 rounded-full overflow-hidden">
                          <div
                            className="h-full bg-violet-500 rounded-full"
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                      </div>
                    )
                  })}
                </div>
              </Section>
            )}

            {/* ── Eval verdict + Candidate stats ── */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
              {evData.length > 0 && (
                <Section title="Position Evaluation Accuracy" icon={<Target size={15} />} defaultOpen={false}>
                  <div className="space-y-2">
                    {[
                      { key: 'correct', label: 'Correct assessment', color: '#22c55e' },
                      { key: 'slightly off', label: 'Slightly off', color: '#eab308' },
                      { key: 'significantly off', label: 'Significantly off', color: '#ef4444' },
                    ].map(({ key, label, color }) => {
                      const val = stats?.eval_verdict_distribution?.[key] || 0
                      const total = Object.values(stats?.eval_verdict_distribution || {}).reduce((s, v) => s + v, 0)
                      const pct = total > 0 ? Math.round(val / total * 100) : 0
                      return (
                        <div key={key}>
                          <div className="flex justify-between text-xs mb-1">
                            <span className="text-slate-300">{label}</span>
                            <span className="font-mono" style={{ color }}>{val} ({pct}%)</span>
                          </div>
                          <div className="h-2 bg-slate-700 rounded-full overflow-hidden">
                            <div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: color }} />
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </Section>
              )}

              {stats?.candidate_stats?.moves_with_candidates > 0 && (
                <Section title="Candidate Move Quality" icon={<BookOpen size={15} />} defaultOpen={false}>
                  <div className="space-y-4">
                    <div className="text-center py-2">
                      <div
                        className="text-4xl font-bold font-mono"
                        style={{ color: scoreColor(stats.candidate_stats.best_move_found_pct) }}
                      >
                        {stats.candidate_stats.best_move_found_pct ?? '—'}%
                      </div>
                      <div className="text-xs text-slate-400 mt-1">best move found or played</div>
                    </div>
                    <div className="grid grid-cols-2 gap-3 text-center">
                      <div className="bg-slate-800/50 rounded p-3">
                        <div className="text-lg font-bold font-mono text-white">
                          {stats.candidate_stats.avg_candidates_per_move ?? '—'}
                        </div>
                        <div className="text-xs text-slate-400 mt-0.5">avg candidates/move</div>
                      </div>
                      <div className="bg-slate-800/50 rounded p-3">
                        <div className="text-lg font-bold font-mono text-white">
                          {stats.candidate_stats.moves_with_candidates}
                        </div>
                        <div className="text-xs text-slate-400 mt-0.5">moves with candidates</div>
                      </div>
                    </div>
                  </div>
                </Section>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
