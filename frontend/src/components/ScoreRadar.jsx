import {
  RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis,
  ResponsiveContainer, Tooltip
} from 'recharts'

const SCORE_LABELS = {
  attack: 'Attack',
  defense: 'Defense',
  opening: 'Opening',
  strategy: 'Strategy',
  endgame: 'Endgame',
  tactics: 'Tactics',
  time_management: 'Time',
  conversion: 'Conversion',
  mental_stability: 'Mental',
}

function scoreColor(score) {
  if (score >= 70) return '#4ade80'
  if (score >= 50) return '#facc15'
  return '#ef4444'
}

export default function ScoreRadar({ scores }) {
  if (!scores) return null

  const data = Object.entries(SCORE_LABELS).map(([key, label]) => ({
    subject: label,
    score: Math.round(scores[key] ?? 50),
    fullMark: 100,
  }))

  return (
    <div className="bg-chess-panel rounded-xl p-4">
      <h2 className="text-lg font-semibold text-chess-gold mb-2 text-center">Performance Profile</h2>
      <ResponsiveContainer width="100%" height={320}>
        <RadarChart data={data}>
          <PolarGrid stroke="#334155" />
          <PolarAngleAxis
            dataKey="subject"
            tick={{ fill: '#94a3b8', fontSize: 12 }}
          />
          <PolarRadiusAxis
            angle={90}
            domain={[0, 100]}
            tick={{ fill: '#64748b', fontSize: 10 }}
          />
          <Radar
            name="Score"
            dataKey="score"
            stroke="#e2b96f"
            fill="#e2b96f"
            fillOpacity={0.25}
          />
          <Tooltip
            contentStyle={{ background: '#1e293b', border: 'none', borderRadius: 8 }}
            labelStyle={{ color: '#e2b96f' }}
            formatter={(val) => [`${val}/100`, 'Score']}
          />
        </RadarChart>
      </ResponsiveContainer>

      {/* Score grid */}
      <div className="grid grid-cols-3 gap-2 mt-2">
        {data.map(({ subject, score }) => (
          <div key={subject} className="flex flex-col items-center">
            <span
              className="text-xl font-bold"
              style={{ color: scoreColor(score) }}
            >
              {score}
            </span>
            <span className="text-xs text-slate-400">{subject}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
