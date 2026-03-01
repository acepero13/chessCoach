# ♟ Guided Self-Annotation Mode
Implementation Specification

This document defines the implementation of the
"Guided Self-Annotation" feature.

This mode trains the user's analytical thinking,
not just move accuracy.

The system must:
- Hide engine until user commits analysis
- Track thinking quality
- Allow marking critical moments
- Respect user-defined time budget
- Produce high-quality annotated output

Stockfish 18 remains mandatory.
LLM remains explanation layer only.

---

# 1. FEATURE OVERVIEW

The user analyzes their own game move-by-move.

Core UX ideas:

1. User chooses:
   - Total time budget (e.g. 20, 40, 60 minutes)
2. User proceeds move by move.
3. User can mark any move as:
   "Critical"
4. System prioritizes deep analysis on marked moves.
5. Engine is hidden until user submits reasoning.
6. Final output is a high-quality annotated game.

---

# 2. USER FLOW

## Step 1 – Start Session

User selects:

[ Self-Annotation Mode ]

User chooses:

- Total time to invest:
  - 15 min (Quick Review)
  - 30 min (Standard)
  - 60 min (Deep Work)
  - Custom value

System calculates:

- Recommended moves to focus on
- Suggested time per move
- Suggested number of critical moments

---

## Step 2 – Move-by-Move Interface

For each move:

User can:

- Write free annotation
- Add candidate moves (max 3)
- Evaluate position (winning/slightly better/equal/worse/losing)
- Mark move as:
  [ ] Critical

If marked critical:
- System flags for deeper evaluation
- Extra engine depth used later
- Extra reflection questions triggered

---

## Step 3 – Engine Reveal Phase

After user submits annotation for a move:

System reveals:

- Engine best move
- Evaluation before/after
- Centipawn loss
- Tactical motifs detected
- MultiPV lines (limited)

LLM generates explanation comparing:

User reasoning vs Engine truth

---

# 3. TIME BUDGET SYSTEM

## 3.1 Time Allocation Logic

If user selects 30 minutes:

System calculates:

- Base moves to review:
  - All blunders
  - All mistakes
  - User-marked critical moves
  - 2–3 random non-critical positions

Time distribution example:

30 min session:
- 60% → critical moves
- 30% → mistakes
- 10% → strategic turning points

System displays:

"Recommended: 3–4 minutes per critical position"

---

## 3.2 Smart Position Selection

If game has 40 moves:

System does NOT require annotation of all moves.

Instead:

Priority ranking:

1. User-marked critical
2. Engine blunders
3. Large eval swings
4. Complex equal positions

System builds a focused review list
based on time budget.

---

# 4. CRITICAL MOVE MECHANISM

User can mark any move as "Critical".

Critical move effects:

- Analyzed at higher engine depth (25 instead of 20)
- MultiPV >= 4
- Extra motif detection
- LLM gives deeper explanation
- Stored as high-importance position

Database must track:

- user_marked_critical (boolean)
- engine_critical (boolean)
- combined_critical_score (float)

---

# 5. DATA MODEL

## annotation_sessions
- id
- user_id
- game_id
- time_budget_minutes
- started_at
- completed_at
- total_moves_reviewed
- critical_moves_count

## annotation_moves
- id
- session_id
- move_number
- fen
- user_annotation_text
- user_candidate_moves (json)
- user_evaluation_label
- user_confidence
- user_marked_critical (bool)
- engine_eval_before
- engine_eval_after
- centipawn_loss
- engine_best_move
- explanation_json

## reflection_summary
- session_id
- evaluation_accuracy_score
- candidate_quality_score
- tactical_awareness_score
- confidence_calibration_score
- thinking_pattern_notes

---

# 6. SCORING METRICS

This feature unlocks advanced thinking metrics.

---

## 6.1 Evaluation Accuracy Score

Compare user evaluation vs engine evaluation.

Map evaluation categories to numeric:

winning = +3
better = +1
equal = 0
worse = -1
losing = -3

Compare to engine score bucket.

Compute deviation.

Normalize to 0–100.

---

## 6.2 Candidate Move Quality Score

Check if engine best move exists in user candidates.

Score:
- Best move listed → full credit
- Engine 2nd best listed → partial credit
- None → 0

---

## 6.3 Tactical Awareness Score

If motif exists and user marked move critical:
+ positive signal

If motif exists and user ignored:
- negative signal

---

## 6.4 Confidence Calibration Score

Compare:

High confidence + wrong evaluation → penalty
Low confidence + correct evaluation → neutral
High confidence + correct → reward

Track over time.

---

# 7. END RESULT: HIGH-QUALITY ANNOTATED GAME

After session completes:

System generates final annotated output including:

- User comments
- Engine comments
- Tactical motifs
- Missed ideas
- Reflection summary
- Thinking profile

Export formats:

- Annotated PGN
- Markdown
- PDF (future milestone)

---

# 8. FRONTEND UX REQUIREMENTS

## Annotation Interface

Left:
- Chessboard

Right:
- Annotation panel

Bottom:
- Progress bar
- Time remaining
- Moves remaining
- Critical move counter

Engine info hidden until submit.

---

## Session Completion Screen

Show:

- Evaluation accuracy graph
- Critical move accuracy
- Thinking strengths
- Thinking weaknesses
- Recommended next training focus

Buttons:

[ Export Annotated Game ]
[ Generate Training Plan From This Session ]
[ Review Another Game ]

---

# 9. ENGINE REQUIREMENTS

Stockfish 18:

Standard moves:
- depth 20
- MultiPV 2

Critical moves:
- depth 25+
- MultiPV 4

All evaluations cached by FEN + depth.

---

# 10. MILESTONES

---

## Milestone 1 – Core Session System

- Annotation session DB
- Move-by-move UI
- Engine reveal logic
- Critical move flag
- Time budget selection

Deliverable:
User can complete annotated session.

---

## Milestone 2 – Thinking Metrics Engine

- Evaluation accuracy
- Candidate move scoring
- Confidence calibration
- Session summary generation

Deliverable:
Reflection dashboard per session.

---

## Milestone 3 – Advanced Critical Move Handling

- Dynamic depth adjustment
- Critical priority scoring
- Smart move selection by time budget

Deliverable:
Optimized focused review flow.

---

## Milestone 4 – Export + Integration

- Annotated PGN export
- Training plan integration
- Long-term thinking trend tracking

---

# 11. SUCCESS CRITERIA

Feature must:

- Prevent premature engine reveal
- Encourage structured thinking
- Fit within user time budget
- Produce meaningful reflection
- Improve evaluation accuracy over 10+ sessions

---

# 12. DESIGN PHILOSOPHY

This mode trains:

- How to evaluate
- How to calculate
- How to reflect
- How to think critically

The engine provides truth.
The LLM provides guidance.
The user provides thinking.

The result:
A high-quality self-annotated game with measurable cognitive improvement.