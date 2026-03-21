# 🧠 ChessTutor — Winning Position + Mental Behavior Trainer (Specification)

## 1. Purpose

Train the user to:
- Convert winning positions reliably
- Maintain mental stability when ahead
- Avoid common psychological mistakes (rushing, overcomplicating, relaxing too early)

---

## 2. Core Insight

Many players:
- Reach winning positions (eval > +2)
- Fail to convert them

This is **not primarily a calculation problem**, but a **mental + decision-making problem**.

---

## 3. Feature Overview

The system:
1. Detects winning positions from real games
2. Replays them as training scenarios
3. Observes user decisions under “winning pressure”
4. Classifies mental behavior
5. Provides coaching focused on *conversion discipline*

---

## 4. Inputs

### From Engine Analysis
- Evaluation per move
- Best move + top alternatives
- Phase (opening/middlegame/endgame)
- Tactical vs quiet position classification

### From Game Data
- Move timestamps (if available)
- Game result
- Move sequence after winning position

### From User (during training)
- Moves played in scenario
- Time spent per move
- Optional thinking input (candidate moves)

---

## 5. Winning Position Detection

### Definition

A position is considered “winning” if:
- Evaluation ≥ +2.0 for the player

### Filtering Rules

Only select positions where:
- Advantage is *not trivial mate*
- There are still decisions to make (not forced line)
- Position is instructive (multiple reasonable moves)

---

## 6. Scenario Generation

Each scenario contains:
- Starting position (FEN)
- Game context:
  - “You are winning”
  - Optional: “You later lost/drew this game”
- Hidden engine evaluation

---

## 7. Training Flow (UX)

### Step 1: Scenario Introduction

Show:
> “You reached a winning position. Convert it.”

Optional:
> “In the actual game, you failed to convert.”

---

### Step 2: Play Phase

User plays:
- 3–10 moves (configurable)
- Against:
  - Engine (low depth) OR
  - Precomputed best-line continuation

Track:
- Moves played
- Time per move
- Eval progression

---

### Step 3: Optional Thinking Capture

Occasionally prompt:
> “What are you trying to achieve here?”

(Use same low-friction UX from thinking system)

---

### Step 4: Reveal + Review

After sequence:
- Show eval graph
- Show best line
- Show key mistakes

---

## 8. Mental Behavior Classification

### Core Categories

#### 1. Rushing
- Fast moves in winning position
- Especially after reaching advantage

#### 2. Overcomplication
- Choosing complex lines when simple wins exist
- Avoiding simplification

#### 3. Relaxation / Loss of Focus
- Gradual eval drop without tactical reason
- Passive or careless moves

#### 4. Fear of Conversion
- Avoiding exchanges that lead to winning endgames
- Not simplifying when clearly better

#### 5. Tilt After Mistake
- One mistake followed by multiple errors

---

## 9. Detection Logic (Conceptual)

### Rushing
- Move time significantly below user average
- Combined with suboptimal move

---

### Overcomplication
- Engine recommends simplification
- User chooses high-variance line

---

### Relaxation
- Eval slowly decreases across multiple moves
- No clear tactical justification

---

### Fear
- Avoiding:
  - exchanges
  - simplification
- Staying in complex positions unnecessarily

---

### Tilt
- Error followed by:
  - faster moves
  - additional errors

---

## 10. Output (Structured)

Per scenario:
- Final result (converted / failed / partial)
- List of mental errors
- Severity
- Supporting evidence

---

## 11. Coaching Output

### Key Principle

Focus on **behavior**, not just moves.

---

### Examples

Instead of:
> “You played the wrong move”

Say:

- “You rushed this move despite having a winning position.”
- “You avoided simplifying into a clearly winning endgame.”
- “After your first mistake, your play became unstable.”

---

## 12. Metrics

Track per user:

### Conversion Metrics
- % of winning positions converted
- Moves to conversion
- Eval drop during conversion

---

### Mental Metrics
- Rushing frequency
- Overcomplication frequency
- Post-mistake collapse rate

---

## 13. Integration with Existing System

### Scoring System
- Feed into:
  - Mental Stability
  - Conversion score

---

### Cognitive Profile
Add traits:
- “Struggles to convert winning positions”
- “Rushed decisions when ahead”
- “Avoids simplification”

---

### Coaching Memory
Track:
- Missed conversions
- Recurring mental errors

---

### Pre-Game Coaching

Generate goals like:
- “If you are winning, simplify the position”
- “Take extra time before each move when ahead”

---

## 14. UX Design Principles

### 1. Realistic Pressure
- Do NOT show evaluation during play
- Simulate real game conditions

---

### 2. Short Scenarios
- Keep sessions focused (3–10 moves)

---

### 3. Clear Goal
Always frame as:
> “Convert the position”

---

### 4. Immediate Feedback
- Show what went wrong immediately after scenario

---

## 15. Advanced Extensions (Optional)

### Time Pressure Mode
- Limited time per move

---

### “Play Like Carlsen” Mode
- Emphasis on:
  - simplification
  - endgame conversion

---

### Difficulty Scaling
- Easier:
  - clear winning plans
- Harder:
  - technical positions
  - small advantages

---

## 16. Success Criteria

The feature is successful if:

- User’s conversion rate improves
- Eval drop in winning positions decreases
- Mental stability score improves
- User reports:
  > “I know what to do when I’m winning”

---

## 17. Final Outcome

The system transforms:

Before:
> “You were winning but lost”

After:
> “You rushed and avoided simplification — this is why you failed to convert.”

---

## 18. Strategic Value

This feature:
- Directly targets a **high-impact weakness**
- Trains a **rarely addressed skill**
- Strongly differentiates ChessTutor from other tools

---
