# ♟️ ChessTutor — Opponent Response & Calculation Trainer (Specification)

## 1. Purpose

Train the user to:
- Anticipate opponent responses
- Calculate forcing lines accurately
- Avoid one-move thinking
- Improve depth and completeness of calculation

---

## 2. Core Problem

Current weakness:

User thinks:
> “My move works”

But misses:
> “What is my opponent’s best reply?”

---

## 3. Feature Overview

The system:
1. Collects positions from user games where:
   - Blunders occurred
   - Mistakes occurred (optional, configurable)
2. Replays them as calculation drills
3. Forces user to calculate:
   - Opponent’s best response
   - Continuation for 2–4 moves
4. Evaluates:
   - Accuracy
   - Depth
   - Completeness

---

## 4. Input Selection

### Source Positions

From analyzed games:

- Blunders (required)
- Mistakes (optional toggle)
- Missed tactics (optional)

---

### Position Criteria

Select positions where:
- A strong opponent response exists
- The position is not trivial
- There is a forcing or critical line

---

## 5. Drill Types

### 1. Opponent Move Prediction (Core)

Prompt:

> “You played X. What should your opponent play?”

---

### 2. Full Line Calculation

Prompt:

> “Calculate the best line for both sides.”

---

### 3. Forced Sequence Mode

Prompt:

> “Find the forcing sequence (checks, captures, threats).”

---

## 6. UX Flow

### Step 1: Scenario Introduction

Show:
- Board position
- Context:

> “In the game, you played X and made a mistake.”

---

### Step 2: Prompt

> “What is your opponent’s best move?”

---

### Step 3: User Input

User enters:
- First opponent move

---

### Step 4: Continue Line

System asks:

> “What happens next?”

Repeat for:
- 2–4 plies (configurable)

---

### Step 5: Reveal

After completion:
- Show full best line
- Show evaluation

---

## 7. Input Methods (UX Design)

### Move Entry

- Click on board (preferred)
- Optional notation input

---

### Line Building UI

Display:

- Move list:
  - Opponent move → User reply → Opponent → User

---

### Undo / Edit

- Allow corrections before submission

---

## 8. Evaluation Logic

### Metrics

#### 1. First Move Accuracy
- Did user find best opponent move?

---

#### 2. Line Accuracy
- Correct sequence vs engine line

---

#### 3. Depth Reached
- How many moves correctly predicted

---

#### 4. Missed Critical Moves
- Missed:
  - checks
  - captures
  - threats

---

## 9. Error Classification

### Categories

- Missed forcing move
- Stopped calculation too early
- Incorrect evaluation of position
- Ignored opponent threat

---

## 10. Feedback Output

### Structure

1. Correct line
2. Where user deviated
3. Why it matters

---

### Example

> “You missed your opponent’s forcing move Qh5+. This is a check that creates immediate threats. Your calculation stopped before considering forcing moves.”

---

## 11. Coaching Layer

Tie into thinking system:

- “You calculated your idea, but not your opponent’s response.”
- “You did not consider forcing moves first.”

---

## 12. Difficulty Scaling

### Beginner
- 1–2 moves deep
- Hints:
  - “Look for checks”

---

### Intermediate
- 2–3 moves
- No hints

---

### Advanced
- 3–5 moves
- Complex positions
- Multiple branches

---

## 13. Training Modes

### Mode 1: Your Mistakes (Primary)
- Personal positions
- Highest relevance

---

### Mode 2: Mixed Set
- Combine:
  - user mistakes
  - curated tactical positions

---

### Mode 3: Blitz Simulation
- Time-limited calculation

---

## 14. Integration with Existing System

---

## Thinking Layer

Enhance:
- Detect shallow calculation
- Detect opponent blindness

---

## Cognitive Profile

Add traits:
- “Does not consider opponent responses”
- “Stops calculation early”

---

## Memory Layer

Track:
- Repeated calculation errors
- Improvement in depth

---

## Training Plan Generator

Assign:
- Calculation drills when:
  - tactics low
  - thinking errors detected

---

## Pre-Game Coaching

Generate reminders:

> “Before every move, ask: what is my opponent’s best reply?”

---

## 15. UX Design Principles

### 1. Active Thinking
- No multiple choice for main mode

---

### 2. Progressive Depth
- Build line step-by-step

---

### 3. Immediate Feedback
- Show where calculation failed

---

### 4. Realism
- Use user’s own positions

---

## 16. Advanced Features (Optional)

### Branching Lines
- If user deviates, explore alternative

---

### “Why Not?” Mode
- Compare user move vs best move

---

### Visualization Training
- Hide board after first move
- Force mental calculation

---

## 17. Success Criteria

- Improved ability to predict opponent moves
- Increased calculation depth
- Reduced one-move blunders
- Improved tactics score

---

## 18. Final Outcome

Before:

> “I didn’t see that move”

After:

> “I should have checked forcing moves — I stopped calculation too early”

---

## 19. Strategic Impact

This feature trains:

- Calculation discipline
- Opponent awareness
- Deep thinking

It directly complements:

- Tactical detection
- Thinking reconstruction
- Mental stability training

---
**This drills section should be added to the training plan system, allowing users to focus on improving their calculation and opponent response anticipation skills.**