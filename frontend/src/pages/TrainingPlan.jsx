import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { ChevronLeft, Dumbbell, Clock, Target, BookOpen, Swords } from 'lucide-react'
import { generatePlan, getLatestPlan, getPerformanceSummary } from '../api/client'

const DAY_NAMES = ['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

function WeekCard({ week }) {
  const [open, setOpen] = useState(week.week_number === 1)

  return (
    <div className="bg-chess-panel rounded-xl overflow-hidden">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between p-4 hover:bg-chess-accent/20 transition-colors"
      >
        <div className="text-left">
          <div className="text-chess-gold font-bold">Week {week.week_number}</div>
          <div className="text-sm text-slate-400">{week.theme}</div>
        </div>
        <div className="text-right">
          <div className="text-sm text-slate-300">{Math.round(week.total_minutes / 60 * 10) / 10}h total</div>
          <div className="text-xs text-slate-500">{week.recommended_time_control}</div>
        </div>
      </button>

      {open && (
        <div className="border-t border-slate-700">
          <div className="grid grid-cols-7 divide-x divide-slate-800">
            {week.daily_sessions.map(session => (
              <DayColumn key={session.day} session={session} />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function DayColumn({ session }) {
  const isRest = session.estimated_minutes === 0
  return (
    <div className={`p-2 min-h-32 ${isRest ? 'bg-slate-900/40' : ''}`}>
      <div className="text-xs text-slate-500 font-medium mb-2 text-center">
        {DAY_NAMES[session.day]}
      </div>
      {isRest ? (
        <div className="text-xs text-slate-600 text-center">Rest</div>
      ) : (
        <div className="space-y-1.5">
          {session.tactics_puzzles > 0 && (
            <Pill icon={<Target size={10} />} text={`${session.tactics_puzzles} puzzles`} color="text-chess-gold" />
          )}
          {session.endgame_drills && (
            <Pill icon={<Swords size={10} />} text="Endgame" color="text-blue-400" />
          )}
          {session.opening_review && (
            <Pill icon={<BookOpen size={10} />} text="Opening" color="text-purple-400" />
          )}
          {session.rated_games > 0 && (
            <Pill icon={<Target size={10} />} text={`${session.rated_games} games`} color="text-green-400" />
          )}
          {session.self_review && (
            <Pill icon={<BookOpen size={10} />} text="Review" color="text-orange-400" />
          )}
          <div className="flex items-center gap-1 mt-1">
            <Clock size={8} className="text-slate-600" />
            <span className="text-slate-600 text-xs">{session.estimated_minutes}m</span>
          </div>
        </div>
      )}
    </div>
  )
}

function Pill({ icon, text, color }) {
  return (
    <div className={`flex items-center gap-1 ${color}`}>
      {icon}
      <span className="text-xs">{text}</span>
    </div>
  )
}

export default function TrainingPlan({ userId }) {
  const navigate = useNavigate()
  const [plan, setPlan] = useState(null)
  const [summary, setSummary] = useState(null)
  const [loading, setLoading] = useState(true)
  const [generating, setGenerating] = useState(false)
  const [loadingSummary, setLoadingSummary] = useState(false)

  useEffect(() => {
    const fetch = async () => {
      try {
        const res = await getLatestPlan(userId)
        setPlan(res.data.plan)
      } catch {
        // No plan yet
      } finally {
        setLoading(false)
      }
    }
    fetch()
  }, [userId])

  const handleGenerate = async () => {
    setGenerating(true)
    try {
      const res = await generatePlan(userId)
      setPlan(res.data.plan)
    } catch (e) {
      alert(e.response?.data?.detail || e.message)
    } finally {
      setGenerating(false)
    }
  }

  const handleSummary = async () => {
    setLoadingSummary(true)
    try {
      const res = await getPerformanceSummary(userId)
      setSummary(res.data.summary)
    } catch (e) {
      alert(e.response?.data?.detail || e.message)
    } finally {
      setLoadingSummary(false)
    }
  }

  return (
    <div className="min-h-screen bg-chess-dark p-6">
      <div className="max-w-5xl mx-auto">
        {/* Header */}
        <div className="flex items-center gap-4 mb-6">
          <button
            onClick={() => navigate('/')}
            className="flex items-center gap-1 text-slate-400 hover:text-white text-sm"
          >
            <ChevronLeft size={16} /> Dashboard
          </button>
          <h1 className="text-2xl font-bold text-chess-gold flex items-center gap-2">
            <Dumbbell size={24} /> Training Plan
          </h1>
        </div>

        {/* Actions */}
        <div className="flex gap-3 mb-6">
          <button
            onClick={handleGenerate}
            disabled={generating}
            className="bg-chess-gold text-chess-dark font-semibold px-5 py-2 rounded-lg hover:opacity-90 disabled:opacity-50 text-sm"
          >
            {generating ? 'Generating…' : plan ? 'Regenerate Plan' : 'Generate 4-Week Plan'}
          </button>
          <button
            onClick={handleSummary}
            disabled={loadingSummary}
            className="border border-chess-gold text-chess-gold font-semibold px-5 py-2 rounded-lg hover:bg-chess-gold/10 disabled:opacity-50 text-sm"
          >
            {loadingSummary ? 'Generating…' : 'AI Performance Summary'}
          </button>
        </div>

        {/* AI Summary */}
        {summary && (
          <div className="bg-chess-panel rounded-xl p-5 mb-6">
            <h2 className="text-chess-gold font-semibold mb-3">Coach Analysis</h2>
            <p className="text-slate-300 text-sm leading-relaxed whitespace-pre-line">{summary}</p>
          </div>
        )}

        {loading ? (
          <div className="text-slate-400 text-center py-10">Loading…</div>
        ) : !plan ? (
          <div className="bg-chess-panel rounded-xl p-10 text-center">
            <p className="text-slate-400 mb-4">No training plan yet. Generate one based on your performance profile.</p>
            <p className="text-slate-500 text-sm">Requires at least one complete batch analysis.</p>
          </div>
        ) : (
          <div className="space-y-4">
            {/* Plan overview */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <StatCard label="Primary Focus" value={plan.primary_weakness?.replace('_', ' ')} />
              <StatCard label="Secondary Focus" value={plan.secondary_weakness?.replace('_', ' ')} />
              <StatCard label="Total Training" value={`${plan.total_hours}h`} />
            </div>

            {/* Notes */}
            {plan.notes?.length > 0 && (
              <div className="bg-chess-accent/20 border border-chess-accent rounded-xl p-4">
                <h3 className="text-chess-gold font-semibold text-sm mb-2">Coach Notes</h3>
                <ul className="space-y-1">
                  {plan.notes.map((note, i) => (
                    <li key={i} className="text-slate-300 text-sm">• {note}</li>
                  ))}
                </ul>
              </div>
            )}

            {/* Weeks */}
            <div className="space-y-3">
              {plan.weeks?.map(week => (
                <WeekCard key={week.week_number} week={week} />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function StatCard({ label, value }) {
  return (
    <div className="bg-chess-panel rounded-xl p-4 text-center">
      <div className="text-xs text-slate-400 mb-1 capitalize">{label}</div>
      <div className="text-lg font-bold text-chess-gold capitalize">{value}</div>
    </div>
  )
}
