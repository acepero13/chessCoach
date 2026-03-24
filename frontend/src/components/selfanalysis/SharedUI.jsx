import { useState, useEffect, useRef } from 'react'
import {
  ChevronDown, CheckCircle, XCircle, AlertCircle,
  Bold, Italic, List, Brain, Info, Download,
} from 'lucide-react'
import Md from '../Md'
import {
  ROOT_CAUSE_OPTIONS, ROOT_CAUSE_COLORS, ROOT_CAUSE_LABELS,
} from '../../pages/selfanalysis/constants'

// ── RootCausePicker ───────────────────────────────────────────────────────────
// Shown in the reveal panel after a mistake/blunder. One question: "why didn't you play X?"
export function RootCausePicker({ moveIndex, bestMove, selected, onSelect }) {
  return (
    <div className="border-t border-slate-700 pt-3 mt-1">
      <p className="text-xs text-slate-400 mb-2.5">
        Engine played{' '}
        <span className="font-mono text-white font-semibold">{bestMove}</span>
        {' '}— why didn't you?
      </p>
      <div className="flex flex-col gap-1.5">
        {ROOT_CAUSE_OPTIONS.map(opt => (
          <button
            key={opt.value}
            onClick={() => onSelect(moveIndex, opt.value)}
            className={`text-left px-3 py-2 rounded-lg border text-sm transition-all ${
              selected === opt.value
                ? 'bg-indigo-900/50 border-indigo-500 text-indigo-100'
                : 'border-slate-700 text-slate-400 hover:border-slate-500 hover:text-white bg-chess-dark'
            }`}
          >
            <span className="font-medium block leading-tight">{opt.label}</span>
            <span className="text-xs opacity-60">{opt.desc}</span>
          </button>
        ))}
      </div>
      {selected && (
        <p className="text-xs text-indigo-400 mt-2 flex items-center gap-1">
          <CheckCircle size={11} /> Saved — will appear in your thinking profile
        </p>
      )}
    </div>
  )
}

// ── ThinkingProfile ───────────────────────────────────────────────────────────
// Shown in the complete screen. Visualizes root cause distribution + LLM narrative.
export function ThinkingProfile({ profile }) {
  const { root_cause_distribution = {}, total_classified = 0, total_mistakes = 0, narrative } = profile

  const data = Object.entries(root_cause_distribution)
    .sort(([, a], [, b]) => b - a)
    .map(([key, count]) => ({
      key,
      label: ROOT_CAUSE_LABELS[key] || key,
      count,
      color: ROOT_CAUSE_COLORS[key] || '#94a3b8',
      pct: total_classified > 0 ? Math.round((count / total_classified) * 100) : 0,
    }))

  const unclassified = total_mistakes - total_classified

  return (
    <div className="bg-chess-panel rounded-xl p-4 mb-6 border border-indigo-900/40">
      <div className="flex items-center gap-2 mb-1">
        <Brain size={16} className="text-indigo-400" />
        <h3 className="text-sm font-semibold text-indigo-300">Thinking Profile</h3>
        <span className="text-xs text-slate-500 ml-auto">
          {total_classified}/{total_mistakes} mistakes classified
        </span>
      </div>
      <p className="text-xs text-slate-500 mb-4">
        Why you missed the engine's best move — classified by you after each reveal
      </p>

      {data.length === 0 ? (
        <p className="text-sm text-slate-500 italic">
          Classify your mistakes in the reveal panel to see your thinking profile.
        </p>
      ) : (
        <>
          <div className="flex flex-col gap-2.5 mb-4">
            {data.map(d => (
              <div key={d.key} className="flex items-center gap-2">
                <div className="text-xs text-slate-300 w-36 flex-shrink-0 leading-tight">{d.label}</div>
                <div className="flex-1 h-4 bg-chess-dark rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all"
                    style={{ width: `${d.pct}%`, backgroundColor: d.color + 'cc' }}
                  />
                </div>
                <div className="text-xs text-slate-500 w-8 text-right">{d.count}×</div>
              </div>
            ))}
          </div>

          {unclassified > 0 && (
            <p className="text-xs text-slate-600 mb-3">
              {unclassified} mistake{unclassified !== 1 ? 's' : ''} not yet classified
            </p>
          )}

          {narrative && (
            <div className="border-t border-slate-700 pt-3">
              <Md text={narrative} className="text-sm text-slate-300 leading-relaxed" />
            </div>
          )}
        </>
      )}
    </div>
  )
}

export function FoldableSection({ title, children, defaultOpen = false }) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="border border-slate-700 rounded-lg overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-3 py-2 text-xs font-semibold text-slate-300 hover:text-chess-gold hover:bg-slate-800/40 transition-colors select-none"
      >
        <span>{title}</span>
        <ChevronDown size={14} className={`transition-transform duration-150 ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="px-3 pb-3 pt-1 flex flex-col gap-2">
          {children}
        </div>
      )}
    </div>
  )
}

// ── RichTextEditor ────────────────────────────────────────────────────────────
// Contenteditable div with a Bold / Italic / List toolbar.
// `defaultValue` is HTML; `onChange` fires with the current innerHTML string.
export function RichTextEditor({ defaultValue, onChange, placeholder }) {
  const editorRef = useRef(null)

  // Set initial HTML once on mount (defaultValue changes when navigating)
  useEffect(() => {
    if (editorRef.current) {
      editorRef.current.innerHTML = defaultValue || ''
    }
    // intentionally runs only when the editor key changes (parent uses key=)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const exec = (cmd) => {
    document.execCommand(cmd, false, null)
    editorRef.current?.focus()
    onChange?.(editorRef.current?.innerHTML || '')
  }

  const handleInput = () => {
    onChange?.(editorRef.current?.innerHTML || '')
  }

  return (
    <div className="flex flex-col gap-1">
      {/* Toolbar */}
      <div className="flex gap-1">
        {[
          { icon: <Bold size={12} />, cmd: 'bold', title: 'Bold (Ctrl+B)' },
          { icon: <Italic size={12} />, cmd: 'italic', title: 'Italic (Ctrl+I)' },
          { icon: <List size={12} />, cmd: 'insertUnorderedList', title: 'Bullet list' },
        ].map(({ icon, cmd, title }) => (
          <button
            key={cmd}
            type="button"
            title={title}
            onMouseDown={e => { e.preventDefault(); exec(cmd) }}
            className="p-1.5 rounded border border-slate-700 text-slate-400 hover:text-white hover:border-slate-500 transition-colors"
          >
            {icon}
          </button>
        ))}
      </div>
      {/* Editor */}
      <div
        ref={editorRef}
        contentEditable
        suppressContentEditableWarning
        onInput={handleInput}
        data-placeholder={placeholder}
        className="w-full min-h-[72px] bg-chess-dark border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-chess-gold prose-chess empty:before:content-[attr(data-placeholder)] empty:before:text-slate-500"
        style={{ lineHeight: '1.5' }}
      />
    </div>
  )
}

// ── ExportDropdown ─────────────────────────────────────────────────────────────
export function ExportDropdown({ onExportPgn, onExportMd }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)

  useEffect(() => {
    if (!open) return
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(v => !v)}
        className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full border border-slate-600 text-slate-400 hover:border-slate-400 hover:text-white transition-colors"
      >
        <Download size={12} /> Export <ChevronDown size={11} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 z-50 bg-slate-800 border border-slate-600 rounded-lg shadow-xl overflow-hidden min-w-[160px]">
          <button
            onClick={() => { onExportPgn(); setOpen(false) }}
            className="w-full flex items-center gap-2 px-3 py-2 text-xs text-slate-300 hover:bg-slate-700 hover:text-white transition-colors"
          >
            <Download size={12} /> PGN (Lichess)
          </button>
          <button
            onClick={() => { onExportMd(); setOpen(false) }}
            className="w-full flex items-center gap-2 px-3 py-2 text-xs text-slate-300 hover:bg-slate-700 hover:text-white transition-colors"
          >
            <Download size={12} /> Markdown
          </button>
        </div>
      )}
    </div>
  )
}

// ── BoardLegend ───────────────────────────────────────────────────────────────
// Small info icon that shows a hover tooltip explaining board drawing controls.
export function BoardLegend() {
  const [open, setOpen] = useState(false)
  return (
    <div className="relative inline-flex">
      <button
        type="button"
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        className="text-slate-500 hover:text-slate-300 transition-colors"
        aria-label="Board controls help"
      >
        <Info size={13} />
      </button>
      {open && (
        <div className="absolute top-full right-0 mt-2 w-56 z-50 bg-slate-800 border border-slate-600 rounded-lg p-3 text-xs text-slate-300 shadow-xl pointer-events-none">
          {/* Arrow pointing up */}
          <div className="absolute bottom-full right-2 border-4 border-transparent border-b-slate-600" />
          <div className="font-semibold text-white mb-2">Board controls</div>
          <ul className="flex flex-col gap-1.5">
            <li><span className="text-chess-gold font-mono">Right-drag</span> — draw an arrow</li>
            <li><span className="text-chess-gold font-mono">Right-click square</span> — cycle highlight color</li>
            <li><span className="text-chess-gold font-mono">Left-click</span> — clear drawn arrows</li>
            <li><span className="text-chess-gold font-mono">Arrows + highlights</span> are saved when you submit</li>
          </ul>
        </div>
      )}
    </div>
  )
}

export function PlayerLabel({ name, isUser }) {
  return (
    <div className="flex items-center gap-2 px-1 py-0.5">
      <div className={`w-2 h-2 rounded-full ${isUser ? 'bg-chess-gold' : 'bg-slate-500'}`} />
      <span className={`text-sm font-medium ${isUser ? 'text-chess-gold' : 'text-slate-400'}`}>
        {name || '—'}
      </span>
      {isUser && <span className="text-xs text-slate-500">(you)</span>}
    </div>
  )
}

export function InfoBox({ label, value, valueClass = 'text-white' }) {
  return (
    <div className="bg-chess-dark rounded-lg p-2">
      <div className="text-xs text-slate-500 mb-0.5">{label}</div>
      <div className={`font-medium ${valueClass}`}>{value || '—'}</div>
    </div>
  )
}

export function ScoreCard({ label, score, color }) {
  return (
    <div className="bg-chess-panel rounded-xl p-4 flex flex-col items-center">
      <div className="text-3xl font-bold mb-1" style={{ color }}>{score}</div>
      <div className="text-xs text-slate-400 text-center">{label}</div>
      <div className="w-full bg-slate-700 rounded-full h-1.5 mt-2">
        <div className="h-1.5 rounded-full" style={{ width: `${score}%`, backgroundColor: color }} />
      </div>
    </div>
  )
}

export function NavBtn({ onClick, disabled, children, title }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      className="p-1.5 rounded-lg border border-slate-700 text-slate-400 hover:text-white hover:border-slate-500 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
    >
      {children}
    </button>
  )
}

export function EvalVerdictBadge({ verdict }) {
  if (!verdict) return null
  const cfg = {
    correct:            { icon: CheckCircle,   cls: 'text-green-400',  label: 'Eval correct' },
    'slightly off':     { icon: AlertCircle,   cls: 'text-yellow-400', label: 'Slightly off' },
    'significantly off':{ icon: XCircle,       cls: 'text-red-400',    label: 'Eval wrong' },
  }
  const c = cfg[verdict]
  if (!c) return null
  const Icon = c.icon
  return (
    <span className={`flex items-center gap-1 text-xs font-medium ${c.cls}`}>
      <Icon size={13} /> {c.label}
    </span>
  )
}

export function RadioPills({ options, value, onChange }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map(opt => (
        <button
          key={opt.value}
          type="button"
          onClick={() => onChange(value === opt.value ? '' : opt.value)}
          className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${
            value === opt.value
              ? 'bg-chess-gold text-chess-dark border-chess-gold font-semibold'
              : 'border-slate-600 text-slate-400 hover:border-chess-gold hover:text-white'
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  )
}

export function QSection({ title, children }) {
  return (
    <div>
      <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3 pb-1 border-b border-slate-700">
        {title}
      </div>
      <div className="flex flex-col gap-4">
        {children}
      </div>
    </div>
  )
}

export function QField({ label, required, children }) {
  return (
    <div>
      <label className="text-sm text-slate-300 block mb-1.5">
        {label}
        {!required && <span className="text-slate-600 text-xs ml-1">(optional)</span>}
      </label>
      {children}
    </div>
  )
}
