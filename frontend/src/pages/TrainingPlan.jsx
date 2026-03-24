import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  ChevronLeft, Dumbbell, Clock, Target, BookOpen, Swords, Brain, Trophy, Zap,
} from 'lucide-react'
import { generatePlan, getLatestPlan } from '../api/client'
import { streamPost } from '../api/sse'
import Md from '../components/Md'

const DAY_NAMES = ['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

const CATEGORY_STYLE = {
  tactics:  { color: 'text-chess-gold',  bg: 'bg-yellow-900/30 border-yellow-700/40',  Icon: Target   },
  strategy: { color: 'text-purple-400',  bg: 'bg-purple-900/30 border-purple-700/40',  Icon: Brain    },
  endgame:  { color: 'text-blue-400',    bg: 'bg-blue-900/30   border-blue-700/40',    Icon: Swords   },
  opening:  { color: 'text-teal-400',    bg: 'bg-teal-900/30   border-teal-700/40',    Icon: BookOpen },
  games:    { color: 'text-green-400',   bg: 'bg-green-900/30  border-green-700/40',   Icon: Trophy   },
  review:   { color: 'text-orange-400',  bg: 'bg-orange-900/30 border-orange-700/40',  Icon: Zap      },
}

function TaskCard({ task }) {
  const style = CATEGORY_STYLE[task.category] || CATEGORY_STYLE.tactics
  const { Icon } = style

  return (
    <div className={`rounded-lg border p-3 ${style.bg}`}>
      <div className="flex items-start gap-2">
        <Icon size={13} className={`${style.color} mt-0.5 flex-shrink-0`} />
        <div className="flex-1 min-w-0">
          {/* Label with duration inline */}
          <div className={`text-sm font-semibold leading-snug ${style.color}`}>
            {task.duration_min > 0 && (
              <span className="font-mono text-xs font-normal opacity-60 mr-1.5">
                {task.duration_min} min ·
              </span>
            )}
            {task.label}
          </div>
          {/* Instructions always visible */}
          {task.instructions && (
            <p className="text-xs text-slate-400 mt-1.5 leading-relaxed">
              {task.instructions}
            </p>
          )}
        </div>
      </div>
    </div>
  )
}

function DayColumn({ session }) {
  const isRest = session.estimated_minutes === 0
  return (
    <div className={`p-2 min-h-36 ${isRest ? 'bg-slate-900/40' : ''}`}>
      <div className="text-xs text-slate-500 font-medium mb-2 text-center">
        {DAY_NAMES[session.day]}
      </div>
      {isRest ? (
        <div className="text-xs text-slate-600 text-center mt-4">Rest</div>
      ) : (
        <div className="space-y-1.5">
          {(session.tasks || []).map((task, i) => (
            <TaskPill key={i} task={task} />
          ))}
          <div className="flex items-center gap-1 mt-1.5">
            <Clock size={8} className="text-slate-600" />
            <span className="text-slate-600 text-xs">{session.estimated_minutes}m</span>
          </div>
        </div>
      )}
    </div>
  )
}

// Compact pill for the weekly calendar grid
function TaskPill({ task }) {
  const style = CATEGORY_STYLE[task.category] || CATEGORY_STYLE.tactics
  const { Icon } = style
  return (
    <div className={`flex items-center gap-1 ${style.color}`}>
      <Icon size={9} className="flex-shrink-0" />
      <span className="text-xs leading-tight truncate" title={task.label}>
        {task.duration_min > 0 ? `${task.duration_min}m` : ''} {task.label.split(' — ')[0].split(' (')[0]}
      </span>
    </div>
  )
}

function WeekCard({ week }) {
  const [open, setOpen] = useState(week.week_number === 1)
  const [dayDetail, setDayDetail] = useState(null)  // day number for expanded detail

  return (
    <div className="bg-chess-panel rounded-xl overflow-hidden">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between p-4 hover:bg-chess-accent/20 transition-colors"
      >
        <div className="text-left">
          <div className="text-chess-gold font-bold">Week {week.week_number}</div>
          <div className="text-sm text-slate-300">{week.theme}</div>
          {week.subtitle && (
            <div className="text-xs text-slate-500 mt-0.5">{week.subtitle}</div>
          )}
        </div>
        <div className="text-right flex-shrink-0 ml-4">
          <div className="text-sm text-slate-300">{Math.round(week.total_minutes / 60 * 10) / 10}h total</div>
          <div className="text-xs text-slate-500">{week.recommended_time_control}</div>
        </div>
      </button>

      {open && (
        <div className="border-t border-slate-700">
          {/* Compact calendar grid */}
          <div className="grid grid-cols-7 divide-x divide-slate-800 border-b border-slate-700">
            {week.daily_sessions.map(session => (
              <button
                key={session.day}
                onClick={() => setDayDetail(d => d === session.day ? null : session.day)}
                className={`text-left transition-colors ${
                  dayDetail === session.day ? 'bg-chess-accent/30' : 'hover:bg-chess-accent/10'
                }`}
              >
                <DayColumn session={session} />
              </button>
            ))}
          </div>

          {/* Expanded day detail */}
          {dayDetail !== null && (() => {
            const session = week.daily_sessions.find(s => s.day === dayDetail)
            if (!session || !session.tasks?.length) return null
            return (
              <div className="p-4 bg-chess-dark/40">
                <div className="flex items-center gap-2 mb-3">
                  <span className="text-sm font-semibold text-white">{DAY_NAMES[dayDetail]} — Full Plan</span>
                  <span className="text-xs text-slate-500">{session.estimated_minutes} min total</span>
                </div>
                <div className="space-y-2">
                  {session.tasks.map((task, i) => (
                    <TaskCard key={i} task={task} />
                  ))}
                </div>
              </div>
            )
          })()}
        </div>
      )}
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
    setSummary('')
    setLoadingSummary(true)
    try {
      await streamPost(
        `/training/${userId}/summary-stream`,
        null,
        chunk => setSummary(prev => prev + chunk),
      )
    } catch (e) {
      alert(e.message)
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
        {(summary || loadingSummary) && (
          <div className="bg-chess-panel rounded-xl p-5 mb-6">
            <h2 className="text-chess-gold font-semibold mb-3">Coach Analysis</h2>
            {summary ? (
              <div>
                <Md text={summary} className="text-slate-300 text-sm leading-relaxed" />
                {loadingSummary && <span className="animate-pulse text-chess-gold">▌</span>}
              </div>
            ) : (
              <p className="text-slate-500 text-sm animate-pulse">Coach is analysing…</p>
            )}
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
