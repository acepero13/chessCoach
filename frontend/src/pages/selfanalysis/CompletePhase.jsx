import { useState } from 'react'
import { Trophy, PenLine, MessageSquare, Download } from 'lucide-react'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell
} from 'recharts'
import Md from '../../components/Md'
import { ScoreCard, ThinkingProfile } from '../../components/selfanalysis/SharedUI'

export default function CompletePhase({ reflection, gameResult, onDashboard, onNewSession, onCoachReview, onReviewAnnotations, onExport, onExportPgn, reviewLoading, error }) {
  const [reflectionsOpen, setReflectionsOpen] = useState(false)

  if (!reflection) {
    return (
      <div className="min-h-screen bg-chess-dark flex items-center justify-center">
        <div className="text-chess-gold animate-pulse">Loading results…</div>
      </div>
    )
  }

  const scores = [
    { name: 'Eval Accuracy', value: reflection.eval_accuracy_score, color: '#facc15' },
    { name: 'Candidate Quality', value: reflection.candidate_quality_score, color: '#4ade80' },
    { name: 'Tactical Awareness', value: reflection.tactical_awareness_score, color: '#60a5fa' },
    { name: 'Confidence Cal.', value: reflection.confidence_calibration_score, color: '#f472b6' },
  ]

  const q = reflection.game_feelings || {}
  const resultWord = gameResult === 'win' ? 'won' : gameResult === 'loss' ? 'lost' : gameResult === 'draw' ? 'drew' : null

  // Build label→value pairs for filled questionnaire fields
  const reflectionRows = [
    { label: `Why you ${resultWord || 'played'}`, value: q.result_reason },
    { label: 'Key turning point', value: q.key_moment },
    { label: 'Takeaway', value: q.takeaway },
    { label: 'Would do differently', value: q.would_do_differently },
    { label: 'Plan adherence', value: q.plan_adherence?.replace('_', ' ') },
    { label: 'Time pressure', value: q.time_pressure?.replace('_', ' ') },
    { label: 'Opening prep', value: q.opening_prep?.replace('_', ' ') },
    { label: 'Extra note', value: q.extra_note },
  ].filter(r => r.value && String(r.value).trim())

  const feelingTags = q.feelings || []

  return (
    <div className="min-h-screen bg-chess-dark p-3 sm:p-6">
      <div className="max-w-2xl mx-auto">
        <div className="flex items-center gap-3 mb-6">
          <Trophy size={32} className="text-chess-gold" />
          <div>
            <h1 className="text-2xl font-bold text-white">Session Complete</h1>
            <p className="text-slate-400 text-sm">
              {reflection.moves_reviewed} of {reflection.total_moves} moves annotated
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-6">
          {scores.map(s => <ScoreCard key={s.name} label={s.name} score={s.value} color={s.color} />)}
        </div>

        <div className="bg-chess-panel rounded-xl p-4 mb-6">
          <h3 className="text-sm font-semibold text-slate-300 mb-3">Score Breakdown</h3>
          <ResponsiveContainer width="100%" height={180}>
            <BarChart data={scores} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
              <XAxis dataKey="name" tick={{ fill: '#94a3b8', fontSize: 11 }} />
              <YAxis domain={[0, 100]} tick={{ fill: '#94a3b8', fontSize: 11 }} />
              <Tooltip contentStyle={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 8 }} labelStyle={{ color: '#f1f5f9' }} />
              <Bar dataKey="value" radius={[4, 4, 0, 0]}>
                {scores.map((s, i) => <Cell key={i} fill={s.color} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        {reflection.thinking_notes?.length > 0 && (
          <div className="bg-chess-panel rounded-xl p-4 mb-6">
            <h3 className="text-sm font-semibold text-chess-gold mb-2">Coaching Notes</h3>
            <ul className="space-y-1.5">
              {reflection.thinking_notes.map((note, i) => (
                <li key={i} className="text-sm text-slate-300 flex gap-2">
                  <span className="text-chess-gold mt-0.5 flex-shrink-0">·</span>
                  <span><Md text={note} /></span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Coach on Your Reflection — LLM questionnaire analysis */}
        {reflection.questionnaire_coaching && (
          <div className="bg-chess-panel rounded-xl p-4 mb-6 border border-chess-gold/20">
            <div className="flex items-center gap-2 mb-3">
              <MessageSquare size={16} className="text-chess-gold" />
              <h3 className="text-sm font-semibold text-chess-gold">Coach on Your Reflection</h3>
            </div>
            <Md text={reflection.questionnaire_coaching} className="text-sm text-slate-300 leading-relaxed" />
          </div>
        )}

        {/* Your Reflections — collapsible */}
        {(reflectionRows.length > 0 || feelingTags.length > 0) && (
          <div className="bg-chess-panel rounded-xl p-4 mb-6">
            <button
              onClick={() => setReflectionsOpen(v => !v)}
              className="w-full flex items-center justify-between text-sm font-semibold text-slate-300 hover:text-white transition-colors"
            >
              <span>Your Reflections</span>
              <span className="text-slate-500 text-xs">{reflectionsOpen ? '▴' : '▾'}</span>
            </button>

            {reflectionsOpen && (
              <div className="mt-3 flex flex-col gap-2.5">
                {feelingTags.length > 0 && (
                  <div>
                    <div className="text-xs text-slate-500 mb-1">Feelings</div>
                    <div className="flex flex-wrap gap-1.5">
                      {feelingTags.map((tag, i) => (
                        <span key={i} className="text-xs px-2.5 py-1 rounded-full bg-slate-700 text-slate-200">{tag}</span>
                      ))}
                    </div>
                  </div>
                )}
                {reflectionRows.map((row, i) => (
                  <div key={i}>
                    <div className="text-xs text-slate-500 mb-0.5">{row.label}</div>
                    <p className="text-sm text-slate-300 italic">"{row.value}"</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Thinking Profile — root cause distribution + LLM narrative */}
        {reflection.thinking_profile && (
          <ThinkingProfile profile={reflection.thinking_profile} />
        )}

        {/* Coach Review CTA */}
        <div className="bg-chess-panel rounded-xl p-4 mb-6 border border-slate-700">
          <div className="flex items-start gap-3">
            <MessageSquare size={20} className="text-chess-gold mt-0.5 flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <h3 className="text-sm font-semibold text-white mb-1">Coach Review</h3>
              <p className="text-xs text-slate-400 mb-3">
                The coach will review your annotations move-by-move, identify gaps in reasoning, ask Socratic
                questions, and reinforce chess principles — all backed by the engine.
              </p>
              {error && (
                <div className="p-2 bg-red-900/40 border border-red-700 rounded-lg text-red-300 text-xs mb-3">
                  {error}
                </div>
              )}
              <button
                onClick={onCoachReview}
                disabled={reviewLoading}
                className="flex items-center gap-2 bg-chess-gold text-chess-dark font-semibold px-4 py-2 rounded-lg hover:opacity-90 disabled:opacity-50 text-sm"
              >
                <MessageSquare size={14} />
                {reviewLoading ? 'Preparing review…' : 'Start Coach Review'}
              </button>
            </div>
          </div>
        </div>

        <div className="flex gap-3 flex-wrap">
          <button onClick={onDashboard} className="flex-1 bg-slate-700 text-white font-semibold py-3 rounded-xl hover:bg-slate-600 transition-colors">
            Back to Dashboard
          </button>
          <button onClick={onReviewAnnotations} className="flex-1 border border-chess-gold/50 text-chess-gold hover:bg-chess-gold/10 font-semibold py-3 rounded-xl transition-colors flex items-center justify-center gap-2">
            <PenLine size={15} /> Review Annotations
          </button>
          <button onClick={onNewSession} className="flex-1 border border-slate-600 text-slate-300 hover:text-white hover:border-slate-400 font-semibold py-3 rounded-xl transition-colors">
            New Session
          </button>
        </div>

        <button
          onClick={onExportPgn}
          className="w-full mt-2 flex items-center justify-center gap-2 border border-slate-600 text-slate-400 hover:text-white hover:border-slate-400 font-medium py-2.5 rounded-xl transition-colors text-sm"
        >
          <Download size={15} /> Export as PGN (Lichess)
        </button>
        <button
          onClick={onExport}
          className="w-full mt-1 flex items-center justify-center gap-2 border border-slate-700 text-slate-500 hover:text-slate-300 hover:border-slate-600 font-medium py-2.5 rounded-xl transition-colors text-sm"
        >
          <Download size={15} /> Export as Markdown
        </button>
      </div>
    </div>
  )
}
