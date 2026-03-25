import { GitBranch, Pin, Crown, Crosshair, Zap, AlertOctagon } from 'lucide-react'

export const EVAL_OPTIONS = [
  { value: 'winning', label: 'Winning' },
  { value: 'better', label: 'Slightly Better' },
  { value: 'equal', label: 'Equal' },
  { value: 'worse', label: 'Slightly Worse' },
  { value: 'losing', label: 'Losing' },
]

export const TIME_BUDGETS = [15, 30, 60]

export const SIGNAL_CHECKS = [
  { key: 'lpdo',       label: 'LPDO',        desc: 'Any loose (undefended) pieces that could be captured?' },
  { key: 'geometry',   label: 'Geometry',    desc: 'Pieces aligned on the same rank / file / diagonal as the opponent\'s King?' },
  { key: 'kingSafety', label: 'King Safety', desc: 'Is f2/f7 or h2/h7 weak? Open lines toward either King?' },
]

export const MISTAKE_REASONS = [
  { value: 'tactical_blindness', label: 'Tactical Blindness', desc: "Didn't see the signal" },
  { value: 'laziness',           label: 'Laziness',           desc: 'Thought it was "good enough"' },
  { value: 'impatience',         label: 'Impatience',         desc: 'Wanted to finish quickly' },
  { value: 'noise_overload',     label: 'Noise Overload',     desc: 'Position got messy and I panicked' },
]

// Post-reveal root cause classification (the important one — submitted AFTER seeing the engine move)
export const ROOT_CAUSE_OPTIONS = [
  { value: 'never_considered',      label: "Never considered it",            desc: "I didn't generate this move as a candidate at all" },
  { value: 'rejected_wrong_reason', label: "Saw it — but rejected it wrongly", desc: 'I had the idea but talked myself out of it incorrectly' },
  { value: 'miscalculated',         label: "Calculated it wrong",            desc: 'I saw it and calculated, but got the answer wrong' },
  { value: 'plan_disconnect',       label: "Was focused on a different plan", desc: "I was looking elsewhere entirely — never considered this direction" },
  { value: 'time_pressure',         label: "Time / pressure",                desc: "I didn't have time to look properly" },
]

export const ROOT_CAUSE_COLORS = {
  never_considered:      '#f87171',
  rejected_wrong_reason: '#fb923c',
  miscalculated:         '#facc15',
  plan_disconnect:       '#a78bfa',
  time_pressure:         '#94a3b8',
}

export const ROOT_CAUSE_LABELS = {
  never_considered:      'Never considered',
  rejected_wrong_reason: 'Rejected wrongly',
  miscalculated:         'Calculated wrong',
  plan_disconnect:       'Different plan',
  time_pressure:         'Time pressure',
}

// ── Tactic badge metadata ─────────────────────────────────────────────────────

export const TACTIC_META = {
  missed_fork:              { label: 'Missed Fork',       icon: GitBranch,    color: 'bg-orange-900/80 border-orange-500 text-orange-300', iconClass: 'text-orange-400' },
  missed_pin:               { label: 'Missed Pin',         icon: Pin,          color: 'bg-purple-900/80 border-purple-500 text-purple-300', iconClass: 'text-purple-400' },
  missed_checkmate:         { label: 'Missed Mate',        icon: Crown,        color: 'bg-red-900/80 border-red-500 text-red-300',          iconClass: 'text-red-400'    },
  missed_discovered_attack: { label: 'Missed Discovery',   icon: Zap,          color: 'bg-blue-900/80 border-blue-500 text-blue-300',       iconClass: 'text-blue-400'   },
  hanging_piece_missed:     { label: 'Free Piece',         icon: Crosshair,    color: 'bg-yellow-900/80 border-yellow-500 text-yellow-300', iconClass: 'text-yellow-400' },
  blunder_hanging:          { label: 'Piece Left Hanging', icon: AlertOctagon, color: 'bg-red-900/80 border-red-600 text-red-300',          iconClass: 'text-red-500'    },
  tactical_shot_found:      { label: 'Tactic Found!',      icon: Zap,          color: 'bg-green-900/80 border-green-500 text-green-300',    iconClass: 'text-green-400'  },
}

// ── Arrow helpers ─────────────────────────────────────────────────────────────

// Engine best-line arrow colors: rank 1 = darkest, rank 4 = lightest
export const ENGINE_ARROW_COLORS = [
  'rgba(0, 140, 0, 0.92)',
  'rgba(50, 170, 50, 0.68)',
  'rgba(100, 190, 80, 0.48)',
  'rgba(150, 210, 100, 0.30)',
]

// Square highlight color cycle on right-click: orange → red → green → clear
export const HIGHLIGHT_COLORS = [
  'rgba(255, 170, 0, 0.55)',
  'rgba(220, 50, 50, 0.55)',
  'rgba(20, 160, 80, 0.55)',
]

// Dot color based on classification (only shown after annotation)
export const DOT_COLOR = {
  blunder:    '#ef4444',
  mistake:    '#f97316',
  inaccuracy: '#facc15',
  good:       '#4ade80',
  best:       '#60a5fa',
}

export const FEELING_TAGS = [
  'Focused', 'Confident', 'Prepared',
  'Nervous', 'Tired', 'Rushed',
  'Tilted', 'Unprepared', 'Pressured',
  'Lucky', 'Unlucky',
]

export const PLAN_OPTIONS = [
  { value: 'always', label: 'Always' },
  { value: 'mostly', label: 'Mostly' },
  { value: 'reacting', label: 'Mostly reacting' },
  { value: 'no_plan', label: 'No plan' },
]

export const TIME_PRESSURE_OPTIONS = [
  { value: 'not_at_all', label: 'Not at all' },
  { value: 'slightly', label: 'Slightly' },
  { value: 'significantly', label: 'Significantly' },
]

export const OPENING_PREP_OPTIONS = [
  { value: 'solid', label: 'Solid' },
  { value: 'ok', label: 'Acceptable' },
  { value: 'poor', label: 'Poor' },
  { value: 'winging_it', label: 'Winging it' },
]
