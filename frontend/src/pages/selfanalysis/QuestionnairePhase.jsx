import {
  FEELING_TAGS, PLAN_OPTIONS, TIME_PRESSURE_OPTIONS, OPENING_PREP_OPTIONS,
} from './constants'
import { RadioPills, QSection, QField } from '../../components/selfanalysis/SharedUI'

export default function QuestionnairePhase({ feelings, setFeelings, gameResult, onComplete, loading, error }) {
  const resultWord = gameResult === 'win' ? 'won' : gameResult === 'loss' ? 'lost' : gameResult === 'draw' ? 'drew' : null
  const resultPhrase = resultWord ? `you ${resultWord}` : 'this result'

  const toggleTag = (tag) => {
    setFeelings(prev => ({
      ...prev,
      feelings: prev.feelings.includes(tag)
        ? prev.feelings.filter(t => t !== tag)
        : [...prev.feelings, tag],
    }))
  }

  const set = (field) => (e) => setFeelings(prev => ({ ...prev, [field]: e.target.value }))
  const setRadio = (field) => (val) => setFeelings(prev => ({ ...prev, [field]: val }))

  const hasRequired = feelings.result_reason.trim() && feelings.takeaway.trim() && feelings.plan_adherence && feelings.time_pressure && feelings.opening_prep

  const buildPayload = () => {
    const out = {}
    if (feelings.feelings.length > 0) out.feelings = feelings.feelings
    if (feelings.result_reason.trim()) out.result_reason = feelings.result_reason.trim()
    if (feelings.key_moment.trim()) out.key_moment = feelings.key_moment.trim()
    if (feelings.takeaway.trim()) out.takeaway = feelings.takeaway.trim()
    if (feelings.would_do_differently.trim()) out.would_do_differently = feelings.would_do_differently.trim()
    if (feelings.plan_adherence) out.plan_adherence = feelings.plan_adherence
    if (feelings.time_pressure) out.time_pressure = feelings.time_pressure
    if (feelings.opening_prep) out.opening_prep = feelings.opening_prep
    if (feelings.extra_note.trim()) out.extra_note = feelings.extra_note.trim()
    return Object.keys(out).length > 0 ? out : null
  }

  const textareaClass = "w-full bg-chess-dark border border-slate-700 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-chess-gold resize-none"

  return (
    <div className="min-h-screen bg-chess-dark p-3 sm:p-6">
      <div className="max-w-xl mx-auto">
        <div className="bg-chess-panel rounded-xl p-6">
          <h2 className="text-xl font-bold text-chess-gold mb-1">Reflect on This Game</h2>
          <p className="text-slate-400 text-sm mb-6">
            Answer a few questions — the coach will compare your self-assessment to the engine data.
          </p>

          <div className="flex flex-col gap-6">

            {/* Section 1: Outcome */}
            <QSection title="Outcome">
              <QField label={`What was the main reason ${resultPhrase}?`} required>
                <textarea
                  value={feelings.result_reason}
                  onChange={set('result_reason')}
                  rows={3}
                  placeholder="Describe what you think decided the game…"
                  className={textareaClass}
                />
              </QField>
              <QField label="Was there a specific moment where the game turned?">
                <textarea
                  value={feelings.key_moment}
                  onChange={set('key_moment')}
                  rows={2}
                  placeholder="e.g. After Bxh7+ I panicked and spent 8 minutes…"
                  className={textareaClass}
                />
              </QField>
            </QSection>

            {/* Section 2: Your Process */}
            <QSection title="Your Process">
              <QField label="Were you following a clear plan?" required>
                <RadioPills options={PLAN_OPTIONS} value={feelings.plan_adherence} onChange={setRadio('plan_adherence')} />
              </QField>
              <QField label="Did time pressure affect your decisions?" required>
                <RadioPills options={TIME_PRESSURE_OPTIONS} value={feelings.time_pressure} onChange={setRadio('time_pressure')} />
              </QField>
              <QField label="How was your opening preparation?" required>
                <RadioPills options={OPENING_PREP_OPTIONS} value={feelings.opening_prep} onChange={setRadio('opening_prep')} />
              </QField>
            </QSection>

            {/* Section 3: Learning */}
            <QSection title="Learning">
              <QField label="What's your #1 takeaway from this game?" required>
                <textarea
                  value={feelings.takeaway}
                  onChange={set('takeaway')}
                  rows={2}
                  placeholder="The most important thing you learned…"
                  className={textareaClass}
                />
              </QField>
              <QField label="If you could replay this game, what would you change?">
                <textarea
                  value={feelings.would_do_differently}
                  onChange={set('would_do_differently')}
                  rows={2}
                  placeholder="A specific decision or approach you'd do differently…"
                  className={textareaClass}
                />
              </QField>
            </QSection>

            {/* Section 4: Feelings */}
            <QSection title="Feelings">
              <QField label="How did you feel?">
                <div className="flex flex-wrap gap-2">
                  {FEELING_TAGS.map(tag => (
                    <button
                      key={tag}
                      type="button"
                      onClick={() => toggleTag(tag)}
                      className={`text-sm px-3 py-1.5 rounded-full border transition-colors ${
                        feelings.feelings.includes(tag)
                          ? 'bg-chess-gold text-chess-dark border-chess-gold font-semibold'
                          : 'border-slate-600 text-slate-400 hover:border-chess-gold hover:text-white'
                      }`}
                    >
                      {tag}
                    </button>
                  ))}
                </div>
              </QField>
              <QField label="Extra note">
                <textarea
                  value={feelings.extra_note}
                  onChange={set('extra_note')}
                  rows={2}
                  placeholder="Anything else about how you played today…"
                  className={textareaClass}
                />
              </QField>
            </QSection>

          </div>

          {error && (
            <div className="p-2 bg-red-900/40 border border-red-700 rounded-lg text-red-300 text-xs mt-4">{error}</div>
          )}

          <div className="flex items-center gap-3 mt-6">
            <button
              onClick={() => onComplete(buildPayload())}
              disabled={loading || !hasRequired}
              className="flex-1 bg-chess-gold text-chess-dark font-bold py-2.5 rounded-xl hover:opacity-90 disabled:opacity-50"
            >
              {loading ? 'Saving…' : 'Finish Session'}
            </button>
            <button
              onClick={() => onComplete(null)}
              disabled={loading}
              className="text-slate-500 text-sm hover:text-white px-3 transition-colors disabled:opacity-50"
            >
              Skip
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
