import { ChevronLeft, PenLine } from 'lucide-react'
import { TIME_BUDGETS } from './constants'

export default function SetupPhase({ timeBudget, setTimeBudget, customBudget, setCustomBudget, onStart, loading, error, onBack }) {
  return (
    <div className="min-h-screen bg-chess-dark p-6">
      <div className="max-w-lg mx-auto">
        <button onClick={onBack} className="flex items-center gap-1 text-slate-400 hover:text-white text-sm mb-6">
          <ChevronLeft size={16} /> Dashboard
        </button>
        <div className="bg-chess-panel rounded-xl p-6">
          <h1 className="text-2xl font-bold text-chess-gold mb-1 flex items-center gap-2">
            <PenLine size={22} /> Self-Analysis
          </h1>
          <p className="text-slate-400 text-sm mb-6">
            Review your own moves and write your reasoning <strong>before</strong> the engine reveals the truth.
            Navigate the full game with ← → arrows; annotate your own moves at any pace.
          </p>

          <div className="mb-6">
            <label className="text-sm text-slate-300 font-medium block mb-3">Time budget</label>
            <div className="flex gap-2 flex-wrap">
              {TIME_BUDGETS.map(b => (
                <button key={b}
                  onClick={() => { setTimeBudget(b); setCustomBudget('') }}
                  className={`px-5 py-2 rounded-lg border text-sm font-medium transition-colors ${
                    timeBudget === b && !customBudget
                      ? 'bg-chess-gold text-chess-dark border-chess-gold'
                      : 'border-slate-600 text-slate-400 hover:border-chess-gold hover:text-white'
                  }`}
                >
                  {b} min
                </button>
              ))}
              <div className="flex items-center gap-2">
                <input
                  type="number" min={1} max={180} value={customBudget}
                  onChange={e => { setCustomBudget(e.target.value); setTimeBudget(0) }}
                  placeholder="Custom"
                  className="w-24 bg-chess-dark border border-slate-600 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-chess-gold"
                />
                <span className="text-slate-500 text-sm">min</span>
              </div>
            </div>
          </div>

          {error && (
            <div className="p-3 bg-red-900/40 border border-red-700 rounded-lg text-red-300 text-sm mb-4">
              {error}
            </div>
          )}

          <button
            onClick={onStart}
            disabled={loading || (timeBudget === 0 && !customBudget)}
            className="w-full bg-chess-gold text-chess-dark font-bold py-3 rounded-xl hover:opacity-90 disabled:opacity-50 text-base"
          >
            {loading ? 'Starting…' : 'Start Session'}
          </button>
        </div>
      </div>
    </div>
  )
}
