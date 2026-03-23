# ♟️ ChessTutor — Imbalance & Plan Engine (Strategy Module Specification)

## 1. Purpose

Introduce a **Positional Understanding Layer** that enables ChessTutor to:
- Analyze positions in terms of **imbalances**
- Derive **strategic plans**
- Evaluate moves based on **plan consistency**, not just engine evaluation

This bridges the gap between:
- Engine-based tactical accuracy (current strength)
- Human-like strategic reasoning (missing piece)

---

## 2. Core Concept

### Current System
- Engine → Best move  
- System → Classifies mistake  

### New System
1. Analyze position → identify imbalances  
2. Derive plan from imbalances  
3. Evaluate move → does it follow the plan?  
4. Explain in human strategic terms  

---

## 3. Feature Overview

### Backend
- Imbalance detection
- Plan generation
- Plan consistency evaluation

### Frontend
- Visual imbalance display
- Plan explanation UI
- Interactive strategy training mode

---

# 4. Imbalance Detection System

## Purpose
Extract human-relevant positional features from each position.

---

## Core Imbalances (Phase 1)

### 1. Material
- Equal / White better / Black better

### 2. King Safety
- Safe / Slightly exposed / Unsafe

Signals:
- Pawn shield integrity
- Open files near king
- Enemy piece proximity

---

### 3. Piece Activity
- Active / Passive

Signals:
- Mobility
- Centralization
- Coordination

---

### 4. Pawn Structure
- Healthy / Weak

Signals:
- Isolated pawns
- Doubled pawns
- Passed pawns

---

### 5. Space Advantage
- Equal / White more / Black more

Signals:
- Controlled squares in opponent half

---

## Output Format

```json
{
  "imbalances": {
    "material": "equal",
    "king_safety": "black_unsafe",
    "piece_activity": "white_better",
    "pawn_structure": "equal",
    "space": "white_more"
  }
}
```
5. Plan Generation Engine
Purpose
Translate imbalances into actionable plans.
Plan Types (Phase 1)
Attack king
Improve worst piece

112/1203/22/26, 12:46 PM
ChessTutor Feature Enhancement
Simplify position
Open the center
Restrict opponent
Mapping Logic
Examples:
Opponent king unsafe → Attack king
Better pawn structure → Simplify
Better activity → Maintain pressure
Space advantage → Restrict opponent
Output
JSON
{
"recommended_plans": [
"attack_king",
"improve_worst_piece"
]
}
6. Plan Consistency Evaluation
Purpose
Evaluate moves based on whether they align with the position’s plan.
Categories
Aligned Move
Neutral Move
Plan Violation

113/1203/22/26, 12:46 PM
ChessTutor Feature Enhancement
Examples
Aligned
Attacking when opponent king is weak
Neutral
Move does not harm plan but does not improve it
Violation
Ignores the main imbalance
Output
JSON
{
"plan_consistency": "violation",
"reason": "move does not address king safety"
}
7. Coaching Output Rules
Required Explanation Flow
1. Describe the position
2. Identify key imbalance
3. Suggest plan
4. Evaluate move
Example
“Black’s king is unsafe and White has more active pieces. The correct plan is to
attack. Your move does not contribute to this plan.”
Constraints

114/1203/22/26, 12:46 PM
ChessTutor Feature Enhancement
LLM must use:
imbalance data
plan labels
Must NOT invent strategic concepts
8. Frontend — GUI Specification
8.1 Coaching View (Game Review)
New Panel: “Position Understanding”
Layout
Right-side panel (below evaluation or next to it)
Section 1: Imbalances
Display as labeled indicators:
King Safety: Black unsafe
Piece Activity: White better
Pawn Structure: =
Space: ↑ White advantage
⚠️
✅
Section 2: Plan
Display:
Plan: Attack the king
Subtext:
“Exploit weak king and active pieces”
Section 3: Move Feedback

115/1203/22/26, 12:46 PM
ChessTutor Feature Enhancement
“Your move: Plan Violation”
Short explanation
UX Behavior
Always visible in review
Collapsible for simplicity
8.2 Interactive Coaching Mode
Step Flow
1. Show position
2. Ask:
“What matters most in this position?”
UI Input (Multiple Choice)
King safety
Pawn structure
Piece activity
Material
Space
Next Step
“What is your plan?”
Options:
Attack
Simplify
Improve pieces
Restrict

116/1203/22/26, 12:46 PM
ChessTutor Feature Enhancement
Then
“Now choose a move”
Feedback Flow
Compare:
chosen imbalance
chosen plan
chosen move
Output
Correct / partially correct / incorrect
Explanation
8.3 Strategy Training Mode
Entry Point
Dashboard → “Train Strategy”
Session Structure
Each exercise:
1. Position
2. Identify imbalance
3. Choose plan
4. Play move
Scoring
Imbalance recognition accuracy
Plan selection accuracy
Move alignment

117/1203/22/26, 12:46 PM
ChessTutor Feature Enhancement
9. Integration with Existing Systems
Thinking Layer
Add checks:
Did user identify correct imbalance?
Did user choose correct plan?
Cognitive Profile
Add traits:
“Ignores key imbalances”
“Chooses inconsistent plans”
Memory Layer
Track:
Repeated strategic errors
Improvement over time
Training Plan Generator
Assign:
Strategy drills
Imbalance recognition exercises
10. Minimal Viable Version
Phase 1
Detect:
King safety
Piece activity

118/1203/22/26, 12:46 PM
ChessTutor Feature Enhancement
Plans:
Attack
Improve pieces
Phase 2
Add pawn structure
Add simplification logic
Phase 3
Add advanced features:
Weak squares
Outposts
Open files
11. Success Criteria
The feature is successful if:
Users correctly identify imbalances
Plan consistency improves
Fewer random or purposeless moves
Strategy score improves
12. Final Outcome
Before:
“This move is slightly worse”
After:
“This position is about attacking the king. Your move ignored this, which is why it
is ineffective.”

119/1203/22/26, 12:46 PM
13. Strategic Impact
ChessTutor Feature Enhancement
This module enables ChessTutor to:
Teach how to think
Not just what to play
Combine:
Engine strength
Human understanding
    

