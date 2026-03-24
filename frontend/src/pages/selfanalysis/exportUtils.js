import { ENGINE_ARROW_COLORS } from './constants'

export function stripHtml(html) {
  if (!html) return ''
  const el = document.createElement('div')
  el.innerHTML = html
  return el.textContent || el.innerText || ''
}

/**
 * Builds the full markdown export string from all session data.
 * Accepts the same shape used by the main SelfAnalysis component state.
 */
export function buildMarkdownExport({ allGameMoves, annotatedMoves, sessionMeta, reflection, reviewItems, reviewResponses }) {
  const date = new Date().toISOString().slice(0, 10)
  const white = sessionMeta?.white_player || 'White'
  const black = sessionMeta?.black_player || 'Black'
  const userColor = sessionMeta?.user_color || 'white'
  const lines = []

  // ── Header ──
  lines.push(`# Self-Analysis: ${white} vs ${black}`)
  lines.push('')
  lines.push(`**Date:** ${date}`)
  lines.push(`**You played as:** ${userColor.charAt(0).toUpperCase() + userColor.slice(1)}`)
  lines.push('')
  lines.push('---')
  lines.push('')

  // ── PGN with inline annotations ──
  lines.push('## PGN with Annotations')
  lines.push('')
  lines.push('```')
  lines.push('[Event "Self-Analysis"]')
  lines.push(`[Date "${date}"]`)
  lines.push(`[White "${white}"]`)
  lines.push(`[Black "${black}"]`)
  lines.push('')

  let pgnText = ''
  let prevMoveNumber = null
  for (const move of allGameMoves) {
    const { move_number, color, move_san, move_index } = move
    const reveal = annotatedMoves[move_index]
    if (color === 'white') {
      pgnText += `${move_number}. `
    } else if (prevMoveNumber !== move_number) {
      pgnText += `${move_number}... `
    }
    prevMoveNumber = move_number
    pgnText += move_san
    const commentParts = []
    if (reveal?.user_annotation) {
      const text = stripHtml(reveal.user_annotation).trim()
      if (text) commentParts.push(`[You] ${text}`)
    }
    if (reveal?.explanation) {
      commentParts.push(`[Coach] ${reveal.explanation.trim()}`)
    }
    if (commentParts.length > 0) {
      const comment = commentParts.join(' | ').replace(/[{}]/g, '')
      pgnText += ` { ${comment} } `
    } else {
      pgnText += ' '
    }
  }

  lines.push(pgnText.trim())
  lines.push('```')
  lines.push('')
  lines.push('---')
  lines.push('')

  // ── Move-by-move annotations ──
  const annotatedList = allGameMoves.filter(m => m.is_user_move && annotatedMoves[m.move_index])
  if (annotatedList.length > 0) {
    lines.push('## Move-by-Move Annotations')
    lines.push('')
    for (const move of annotatedList) {
      const reveal = annotatedMoves[move.move_index]
      const cls = reveal.classification || ''
      const cpLoss = reveal.centipawn_loss ? `${Math.round(reveal.centipawn_loss)} cp` : null
      let header = `### Move ${move.move_number} · \`${move.move_san}\``
      if (cls) header += ` — *${cls}${cpLoss ? ` · ${cpLoss}` : ''}*`
      lines.push(header)
      lines.push('')

      if (reveal.user_eval_label) {
        lines.push(`**Your assessment:** ${reveal.user_eval_label}`)
      }
      if (reveal.eval_verdict) {
        lines.push(`**Eval accuracy:** ${reveal.eval_verdict}`)
      }

      const signals = [
        { key: 'lpdo', label: 'LPDO' },
        { key: 'geometry', label: 'Geometry' },
        { key: 'kingSafety', label: 'King Safety' },
      ].filter(s => reveal.signal_flags?.[s.key]).map(s => s.label)
      if (signals.length > 0) {
        lines.push(`**Signals checked:** ${signals.join(', ')}`)
      }

      if (reveal.user_candidates?.length > 0) {
        const cands = reveal.user_candidates.map(c =>
          c === reveal.engine_best_move ? `${c} ✓` : c
        )
        lines.push(`**Candidates considered:** ${cands.join(', ')}`)
      }

      if (reveal.mistake_reason) {
        const reasons = {
          tactical_blindness: 'Tactical Blindness',
          laziness: 'Laziness',
          impatience: 'Impatience',
          noise_overload: 'Noise Overload',
        }
        lines.push(`**Root cause:** ${reasons[reveal.mistake_reason] ?? reveal.mistake_reason}`)
      }

      if (reveal.user_annotation) {
        const text = stripHtml(reveal.user_annotation).trim()
        if (text) {
          lines.push('')
          lines.push('**Your thinking:**')
          lines.push('')
          lines.push(text)
        }
      }

      lines.push('')
      if (reveal.engine_best_move) {
        lines.push(`**Engine best move:** \`${reveal.engine_best_move}\``)
      }
      if (cpLoss) {
        lines.push(`**Centipawn loss:** ${cpLoss}`)
      }
      if (reveal.engine_pv_san?.length > 0) {
        lines.push(`**Engine line:** ${reveal.engine_pv_san.join(' ')}`)
      }
      if (reveal.patterns?.length > 0) {
        lines.push(`**Patterns:** ${reveal.patterns.map(p => p.type?.replace(/_/g, ' ')).join(', ')}`)
      }
      if (reveal.explanation) {
        lines.push('')
        lines.push('**Coach explanation:**')
        lines.push('')
        lines.push(reveal.explanation.trim())
      }

      lines.push('')
      lines.push('---')
      lines.push('')
    }
  }

  // ── Post-game reflection ──
  if (reflection?.game_feelings) {
    const q = reflection.game_feelings
    lines.push('## Post-Game Reflection')
    lines.push('')
    if (q.feelings?.length > 0) {
      lines.push(`**Feelings:** ${q.feelings.join(', ')}`)
    }
    const qFields = [
      { key: 'result_reason', label: 'Why this result' },
      { key: 'key_moment', label: 'Key turning point' },
      { key: 'takeaway', label: 'Takeaway' },
      { key: 'would_do_differently', label: 'Would do differently' },
      { key: 'plan_adherence', label: 'Plan adherence' },
      { key: 'time_pressure', label: 'Time pressure' },
      { key: 'opening_prep', label: 'Opening prep' },
      { key: 'extra_note', label: 'Extra note' },
    ]
    for (const { key, label } of qFields) {
      if (q[key]) lines.push(`**${label}:** ${String(q[key]).replace(/_/g, ' ')}`)
    }
    if (reflection.questionnaire_coaching) {
      lines.push('')
      lines.push('**Coach on your reflection:**')
      lines.push('')
      lines.push(reflection.questionnaire_coaching.trim())
    }
    lines.push('')
    lines.push('---')
    lines.push('')
  }

  // ── Session scores ──
  if (reflection) {
    lines.push('## Session Scores')
    lines.push('')
    const scores = [
      { name: 'Eval Accuracy', value: reflection.eval_accuracy_score },
      { name: 'Candidate Quality', value: reflection.candidate_quality_score },
      { name: 'Tactical Awareness', value: reflection.tactical_awareness_score },
      { name: 'Confidence Calibration', value: reflection.confidence_calibration_score },
    ]
    lines.push('| Score | Value |')
    lines.push('|-------|-------|')
    for (const s of scores) {
      if (s.value != null) lines.push(`| ${s.name} | ${s.value}/100 |`)
    }
    if (reflection.thinking_notes?.length > 0) {
      lines.push('')
      lines.push('**Coaching notes:**')
      lines.push('')
      for (const note of reflection.thinking_notes) {
        lines.push(`- ${note}`)
      }
    }
    lines.push('')
    lines.push('---')
    lines.push('')
  }

  // ── Coach review Q&A ──
  if (reviewItems?.length > 0) {
    lines.push('## Coach Review Q&A')
    lines.push('')
    for (const item of reviewItems) {
      const resp = reviewResponses?.[item.move_index]
      lines.push(`### Move ${item.move_number} · \`${item.move_san}\``)
      lines.push('')
      if (item.coach_comment) {
        lines.push('**Coach:**')
        lines.push('')
        lines.push(item.coach_comment.trim())
        lines.push('')
      }
      if (resp?.response) {
        lines.push('**Your response:**')
        lines.push('')
        lines.push(resp.response.trim())
        lines.push('')
      }
      if (resp?.reply) {
        lines.push('**Coach reply:**')
        lines.push('')
        lines.push(resp.reply.trim())
        lines.push('')
      }
      lines.push('---')
      lines.push('')
    }
  }

  return lines.join('\n')
}

export function classificationClass(c) {
  const map = {
    best: 'text-blue-400', good: 'text-green-400',
    inaccuracy: 'text-yellow-400', mistake: 'text-orange-400', blunder: 'text-red-400',
  }
  return map[c] || 'text-slate-300'
}

export function classificationBg(c) {
  const map = {
    best: 'bg-blue-900/40 border-blue-700', good: 'bg-green-900/40 border-green-700',
    inaccuracy: 'bg-yellow-900/40 border-yellow-700',
    mistake: 'bg-orange-900/40 border-orange-700', blunder: 'bg-red-900/40 border-red-700',
  }
  return map[c] || 'bg-slate-800 border-slate-600'
}

// Convert centipawns to pawn-unit string (+3.2 / -4.0), handles mate scores
export function fmtEval(cp) {
  if (cp == null) return '?'
  if (Math.abs(cp) >= 9000) return cp > 0 ? '+M' : '-M'
  const pawns = cp / 100
  return `${pawns > 0 ? '+' : ''}${pawns.toFixed(1)}`
}

// Engine stores evals from the MOVER's perspective (positive = mover winning).
// For display we always use WHITE's perspective (positive = white winning),
// matching Lichess and every standard chess GUI.
export function toWhitePov(cp, color) {
  if (cp == null) return null
  return color === 'black' ? -cp : cp
}

export function uciToSquares(uci) {
  if (!uci || uci.length < 4) return null
  return { from: uci.slice(0, 2), to: uci.slice(2, 4) }
}

// Build a reveal-entry from a stored moves_data record (used when loading/resuming a session).
// This is the shape that annotatedMoves[] expects, matching what submitAnnotation() returns live.
export function _moveDataToReveal(m) {
  return {
    engine_eval_before: m.engine_eval_before,
    engine_eval_after: m.engine_eval_after,
    centipawn_loss: m.centipawn_loss,
    classification: m.classification,
    engine_best_move: m.engine_best_move,
    engine_best_move_uci: m.engine_best_move_uci,
    engine_pv_san: m.engine_pv_san,
    engine_multipv: m.engine_multipv,
    patterns: m.patterns,
    explanation: m.explanation,
    eval_verdict: m.eval_verdict || null,   // restored — new sessions store this; old sessions get null
    user_annotation: m.user_annotation || '',
    user_candidates: m.user_candidates || [],
    user_eval_label: m.user_eval_label || '',
    signal_flags: m.signal_flags || {},
    mistake_reason: m.mistake_reason || '',
    root_cause: m.root_cause || '',
  }
}

// revealData = annotatedMoves entry (has multipv); moveData = allGameMoves entry (has best_move_uci)
export function buildEngineArrows(revealData, moveData) {
  // Prefer multipv from reveal (richer, fresher analysis)
  if (revealData?.engine_multipv?.length > 0) {
    return revealData.engine_multipv
      .map((line, i) => {
        const sq = uciToSquares(line.move_uci)
        if (!sq) return null
        return {
          startSquare: sq.from,
          endSquare: sq.to,
          color: ENGINE_ARROW_COLORS[i] ?? ENGINE_ARROW_COLORS.at(-1),
        }
      })
      .filter(Boolean)
  }
  // Fall back to single best move (from reveal or batch analysis)
  const uci = revealData?.engine_best_move_uci || moveData?.best_move_uci
  const sq = uciToSquares(uci)
  if (!sq) return []
  return [{ startSquare: sq.from, endSquare: sq.to, color: ENGINE_ARROW_COLORS[0] }]
}

// Find the index into `items` where the game evaluation collapsed.
// 1. Tipping point: position was not losing (eval_before >= -100) but the move
//    caused a large drop (centipawn_loss >= 150), making it losing (eval_after <= -200).
// 2. If no tipping point, fall back to the first blunder.
// 3. Last resort: the single worst centipawn loss.
export function findCollapseIdx(items) {
  // Tipping-point pass
  let best = null
  for (let i = 0; i < items.length; i++) {
    const it = items[i]
    const evBefore = it.engine_eval_before ?? 0
    const evAfter  = it.engine_eval_after  ?? 0
    const cpLoss   = it.centipawn_loss      ?? 0
    if (evBefore >= -100 && cpLoss >= 150 && evAfter <= -200) {
      if (!best || cpLoss > (items[best].centipawn_loss ?? 0)) best = i
    }
  }
  if (best !== null) return best

  // First blunder
  const blunderIdx = items.findIndex(it => it.classification === 'blunder')
  if (blunderIdx !== -1) return blunderIdx

  // Worst centipawn loss
  let worstIdx = 0
  for (let i = 1; i < items.length; i++) {
    if ((items[i].centipawn_loss ?? 0) > (items[worstIdx].centipawn_loss ?? 0)) worstIdx = i
  }
  return worstIdx
}
