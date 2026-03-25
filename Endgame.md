# ♟️ ChessTutor — Endgame Category & Collapse Analysis Module (Specification)

## 1. Purpose

Provide a structured, coach-like understanding of the user’s endgame performance by:

- Classifying endgames into meaningful categories
- Measuring performance per category
- Detecting **collapse under pressure**, especially in winning positions
- Generating actionable, human-like coaching insights

---

## 2. Core Concept

Instead of:

> “Your endgame is weak”

The system provides:

> “You struggle specifically in rook endgames and often collapse when converting winning positions.”

---

## 3. Feature Overview

The module introduces:

### Backend
- Endgame phase detection
- Endgame category classification
- Performance tracking per category
- Collapse detection logic

### Frontend
- Endgame profile dashboard
- Category breakdown visualization
- Drill entry points per category

---

## 4. Endgame Phase Detection

## Definition

A position is considered an **endgame** if one or more conditions are met:

- No queens on the board  
- Total material below threshold (configurable)  
- Simplified piece configuration  

---

## Example Rule

```text
Endgame if:
- No queens OR
- Total material value ≤ threshold (e.g., ≤ 14 points excluding kings)

``` 
```
{
  "phase": "endgame"
}
```

## 5. Endgame Category Classification
Categories (Phase 1)
1. King & Pawn Endgames
Only kings and pawns remain
2. Rook Endgames
At least one rook per side (no queens)
3. Minor Piece Endgames
Only bishops/knights (no rooks or queens)
4. Queen Endgames
Queens present with limited material
5. Conversion Endgames
Positions with evaluation ≥ +2.0
6. Defensive Endgames
Positions with evaluation ≤ -1.5


```json
{
  "endgame_type": "rook_endgame"
}
```

### 6. Metrics per Category

Track performance per endgame type:

1. Conversion Rate
% of winning positions (eval ≥ +2) converted into wins
2. Holding Rate
% of worse positions (eval ≤ -1.5) saved (draw/win)
3. Accuracy
Average centipawn loss in endgames
4. Blunder Rate
Blunders per endgame
5. Moves to Conversion
Number of moves needed to convert winning positions
6. Evaluation Stability
Variance of evaluation across moves

```json
{
  "rook_endgame": {
    "conversion_rate": 0.42,
    "holding_rate": 0.55,
    "avg_cpl": 65,
    "blunder_rate": 0.18
  }
}
```

### 7. Collapse Detection System
Purpose

Detect when a user fails under pressure, especially in winning positions.

Definition of Collapse

A collapse occurs when:

Evaluation drops significantly from a winning position
Multiple mistakes occur in sequence
Behavior indicates loss of control
Detection Signals
1. Evaluation Drop

`eval ≥ +2 → eval ≤ 0 within N moves` 

2. Blunder Clustering
`>=2 mistales/blunders within 3-5 moves`
3. Time Pressure (if data available)
```json
{
  "collapse": true,
  "type": "conversion_failure",
  "pattern": "rushed_moves_after_advantage"
}
```
#8 8. Mental Pattern Mapping

Map collapses to mental categories:

- Rushing when winning
- Fear of simplification
- Loss of focus after mistake
- Overcomplication

```json
{
  "collapse_pattern": "rushing_when_winning"
}
```

Coaching Output Rules
Required Structure
Identify endgame type
Highlight performance issue
Link to mental behavior
Suggest improvement
Example Outputs

“You convert only 42% of winning rook endgames.”

“In rook endgames, you often rush when winning, leading to unnecessary mistakes.”

“Your king and pawn endgame technique is inconsistent, especially in pawn races.”

Constraints
Must be based on:
measured metrics
detected patterns
No hallucinated explanations
10. Frontend — GUI Specification
10.1 Endgame Profile Dashboard
Section Title

“Your Endgame Profile”

Display
Category Breakdown
King & Pawn → score
Rook Endgames → score ⚠️
Minor Piece → score
Queen Endgames → score
Conversion → score ❗
Defense → score
Visualization
Bar chart OR radar chart
Highlight weakest category
Interaction

Click category → opens detailed view

10.2 Category Detail View
Display
Conversion rate
Holding rate
Blunder rate
Collapse frequency
Insights Panel

Show:

Key weaknesses
Mental patterns
Example

“You frequently collapse in winning rook endgames due to rushed decisions.”

10.3 Drill Entry Points

Each category provides:

Buttons
“Train this category”
“Review mistakes”
Drill Types
Conversion Drill
Convert winning positions
Defense Drill
Hold worse positions
Technique Drill
Specific patterns (future extension)
11. Integration with Existing System
Scoring Engine
Feed into:
Endgame score
Mental stability
Conversion score
Mental Module
Link collapses to mental traits
Guided Calculation
Use endgame positions for deeper calculation training
Imbalance Engine
Evaluate:
pawn structure
king activity
passed pawns
Coaching Memory

Track:

recurring failures per category
improvement trends
Training Plan Generator

Assign:

targeted endgame drills
based on weakest categories
Pre-Game Coaching

Generate goals:

“If you reach a rook endgame, focus on simplifying and avoiding rushed moves.”

12. Minimal Viable Version (MVP)
Phase 1
Detect:
rook endgames
pawn endgames
Track:
conversion rate
blunders
Show simple breakdown
Phase 2
Add collapse detection
Add mental pattern classification
Phase 3
Add advanced motifs:
Lucena
Philidor
Opposition
13. Success Criteria

The feature is successful if:

Users understand which endgames they struggle with
Conversion rates improve
Collapse frequency decreases
Mental stability score improves
14. Final Outcome

Before:

“Your endgame is weak”

After:

“You struggle to convert winning rook endgames and tend to rush when ahead, leading to collapses.”

15. Strategic Impact

This module enables ChessTutor to:

Provide precise, actionable endgame coaching
Connect technical play with mental behavior
Deliver human-like insights instead of generic scores