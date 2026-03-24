import { useRef, useMemo, useEffect } from 'react'
import { DOT_COLOR } from '../../pages/selfanalysis/constants'

function MoveCell({ move, isCurrent, annotatedMoves, onSelect, currentRef }) {
  if (!move) return <span className="flex-1 min-w-0" />

  const reveal = annotatedMoves?.[move.move_index]
  const dotColor = move.is_user_move && reveal
    ? (DOT_COLOR[reveal.classification] ?? '#94a3b8')
    : null

  return (
    <button
      ref={currentRef}
      onClick={() => onSelect(move.globalIdx)}
      className={`flex-1 min-w-0 flex items-center gap-1 px-1.5 py-0.5 rounded text-left text-xs font-mono transition-colors ${
        isCurrent
          ? 'bg-chess-gold text-chess-dark font-bold'
          : move.is_user_move
            ? 'text-white hover:bg-slate-700'
            : 'text-slate-400 hover:bg-slate-800'
      }`}
    >
      {dotColor && (
        <span
          className="w-1.5 h-1.5 rounded-full flex-shrink-0"
          style={{ backgroundColor: dotColor }}
        />
      )}
      {move.is_user_move && !dotColor && (
        <span className="w-1.5 h-1.5 rounded-full flex-shrink-0 border border-slate-600" />
      )}
      <span className="truncate">{move.move_san}</span>
    </button>
  )
}

export default function MoveList({ allGameMoves, navIdx, annotatedMoves, onSelect }) {
  const currentRef = useRef(null)

  // Group moves into rows: { moveNumber, white, black }
  const rows = useMemo(() => {
    const result = []
    let i = 0
    while (i < allGameMoves.length) {
      const m = allGameMoves[i]
      const row = { moveNumber: m.move_number, white: null, black: null }

      if (m.color === 'white') {
        row.white = { ...m, globalIdx: i }
        i++
        if (i < allGameMoves.length && allGameMoves[i].color === 'black') {
          row.black = { ...allGameMoves[i], globalIdx: i }
          i++
        }
      } else {
        // Black opens (e.g. game resumed mid-game) — show with ellipsis for white
        row.black = { ...m, globalIdx: i }
        i++
      }
      result.push(row)
    }
    return result
  }, [allGameMoves])

  // Auto-scroll active move into view
  useEffect(() => {
    currentRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [navIdx])

  return (
    <div className="bg-chess-panel rounded-xl mt-3 overflow-hidden">
      <div className="max-h-40 overflow-y-auto p-1.5 select-none">
        {rows.map((row, ri) => (
          <div key={ri} className="flex items-center gap-0.5">
            {/* Move number */}
            <span className="text-slate-600 text-xs w-6 text-right flex-shrink-0 pr-1">
              {row.moveNumber}.
            </span>

            <MoveCell
              move={row.white}
              isCurrent={row.white?.globalIdx === navIdx}
              annotatedMoves={annotatedMoves}
              onSelect={onSelect}
              currentRef={row.white?.globalIdx === navIdx ? currentRef : null}
            />
            <MoveCell
              move={row.black}
              isCurrent={row.black?.globalIdx === navIdx}
              annotatedMoves={annotatedMoves}
              onSelect={onSelect}
              currentRef={row.black?.globalIdx === navIdx ? currentRef : null}
            />
          </div>
        ))}
      </div>
    </div>
  )
}
