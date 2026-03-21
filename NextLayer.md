# 🧠 ChessTutor — Coaching System + UX Specification

This document defines the next evolution of ChessTutor into a **real coaching system** by introducing:

1. Thinking Reconstruction (decision-making)
2. Cognitive Profile (player identity)
3. Plan-Based Explanation (strategic understanding)
4. Opponent-Based Feedback (context awareness)
5. Pre-Game Coaching (intentional play)
6. Longitudinal Memory (continuity over time)
7. Frontend UX for Thinking Capture (low-friction interaction)

---

# 1. Thinking Process Reconstruction (Core Feature)

## Purpose
Capture *how the user thinks*, not just what they play.

---

## Core UX Principle

> Ask only when it matters, and make it fast.

- Do NOT ask on every move
- Ask only in **critical positions**
- Keep interaction under **5–10 seconds**
- Always allow skipping

---

## Trigger System (When to Ask)

Prompt user input only in high-value situations:

- Blunders (large eval drop)
- Missed winning opportunities
- Tactical turning points
- Critical evaluation swings

### Limits
- Max 3–5 prompts per game
- Adjustable intensity:
  - Light: 1–2 prompts
  - Normal: 3–4 prompts
  - Deep: 5+ prompts

---

## Interaction Flow

### Step 1: Soft Prompt

Use a lightweight overlay or side panel:

> “Quick check: what were you considering here?”

---

### Step 2: Candidate Move Input (Fast)

- Show 6–8 legal moves as clickable buttons
- Include:
  - Engine top moves
  - Some distractor moves
- Allow:
  - Tap to select (1–3 moves)
  - Optional manual input

---

### Step 3: Optional Depth (Collapsed by Default)

Expandable sections:
- “Add calculation (optional)”
- “Add reasoning (optional)”

---

### Step 4: Skip Option

Always visible:
> “Skip”

---

## Input Levels (Adaptive UX)

### Beginner
- Only candidate moves

### Intermediate
- Candidate moves
- Optional reasoning

### Advanced
- Candidate moves
- Calculation lines
- Optional evaluation guess (“Who is better?”)

---

## Backend Logic

Compare:
- User candidate moves vs engine top moves
- User reasoning vs actual threats
- Depth of calculation
- Evaluation differences

---

## Thinking Error Categories

### Candidate Errors
- Missed Candidate
- Tunnel Vision

### Threat Awareness
- Ignored Opponent Threat

### Calculation
- Shallow Calculation
- Missing continuation

### Evaluation
- Wrong Evaluation

---

## Feedback Flow

1. User inputs thinking
2. System may ask 1–2 guiding questions:
   - “What is your opponent threatening?”
3. THEN reveal:
   - Engine move
   - Explanation

---

## Coaching Output Style

Instead of:
> “You missed a fork”

Say:
> “You didn’t consider the best move in your candidate list.”

---

## Constraints

- LLM must NOT invent errors
- Only explain detected issues
- Must reference:
  - candidate moves
  - engine data

---

# 2. Personalized Cognitive Profile

## Purpose
Create a consistent **player identity model**.

---

## Concept

Each player has:
- 1 Archetype
- 3–5 Traits

---

## Inputs

- 9 performance scores
- Pattern frequencies
- Thinking error frequencies
- Blunder timing
- Optional: time usage

---

## Archetypes (Examples)

- Tactical but Impulsive
- Solid but Passive
- Strong Opening, Weak Middlegame
- Good Calculator, Poor Evaluator
- Unstable Under Pressure

---

## Traits (Multi-label)

- Narrow thinker
- Threat-blind
- Tilts under pressure
- Over-aggressive
- Passive vs stronger players

---

## UX Representation

### Dashboard Section

**“Your Playing Style”**

- Archetype
- 3 traits

Example:
- Tactical but Impulsive  
- Rushes decisions  
- Misses opponent threats  
- Strong attacking instinct  

---

## Coaching Behavior

Use in explanations:

> “This fits your pattern — you tend to rush decisions.”

---

## Update Frequency

- After batch analysis
- Every ~10 games

---

# 3. Explain Plans, Not Just Moves

## Purpose
Teach **ideas**, not just moves.

---

## Concept

Moves = surface  
Plans = understanding

---

## Plan Types

- Central Break
- King-side Attack
- Minority Attack
- Piece Improvement
- Prophylaxis

---

## Detection Logic

A plan is identified when:
- Multiple moves align toward a goal
- Structure or lines are changed
- Position features support a strategy

---

## Output

- Plan type
- Plan goal
- Supporting moves

---

## UX Change

### Before:
- “Best move: d4”

### After:
- “Plan: Central Break”
- Then explanation

---

## Visual Enhancements

- Highlight opened lines
- Show attacked squares
- Show king exposure

---

## Interaction

User can toggle:
- Show plan
- Show best move
- Show continuation

---

## Coaching Output Example

> “This is a central break. The idea is to open the position because your opponent’s king is unsafe.”

---

## Constraints

- LLM must use detected plan labels
- No invented strategies

---

# 4. Opponent-Based Feedback

## Purpose
Detect how behavior changes with opponent strength.

---

## Inputs

- Opponent rating
- Game result
- Performance metrics

---

## Segmentation

- Weaker opponents
- Equal strength
- Stronger opponents

---

## Metrics per Group

- Attack score
- Blunder rate
- Evaluation swings
- Time usage
- Conversion rate

---

## Detection Examples

- Lower aggression vs stronger → passive under pressure
- Higher blunders vs stronger → pressure mistakes
- Over-aggression vs weaker → overconfidence

---

## UX Representation

### Dashboard Section

**“How you play vs opponents”**

- Visual comparisons
- Key insights

---

## Coaching Output

> “Against stronger players, your attack score drops significantly.”

---

# 5. Pre-Game Coaching

## Purpose
Encourage **intentional play**.

---

## UX Design

### Before Game

Show a lightweight card:

- Focus: “Watch for hanging pieces”
- Reminder: “Check opponent threats before every move”

Optional:
- “Set personal goal”

---

## Rules

- Do NOT block gameplay
- Do NOT require input

---

## After Game

Evaluate:

- Goal achieved
- Improved
- Not achieved

---

## Coaching Output

> “You reduced blunders — good progress.”

---

# 6. Longitudinal Coaching Memory

## Purpose
Create **continuity over time**.

---

## Stored Data

- Motif frequencies
- Thinking errors
- Phase weaknesses
- Timestamps

---

## Tracking

For each issue:
- Total occurrences
- Recent occurrences
- Trend:
  - Improving
  - Stable
  - Worsening

---

## Trend Logic

Compare:
- Last 5–10 games
- Previous 5–10 games

---

## UX Representation

### “Your Progress”

- Recurring issues
- Trends

---

## Coaching Behavior

> “This is the 5th time you missed a pin recently.”

> “This used to be a major issue, but it’s improving.”

---

## UX Rule

- Show only when relevant
- Avoid overload

---

# 7. Frontend UX for Thinking Capture (CRITICAL)

## Core Principles

### 1. Minimize Friction
- Fast input (tap > typing)
- Optional depth
- Always allow skip

---

### 2. Ask Less, Ask Better
- Only in key moments
- Not every move

---

### 3. Progressive Disclosure
- Simple by default
- Advanced options expandable

---

### 4. Delay Answers
- Ask questions before engine reveal
- Encourage thinking

---

### 5. Contextual Feedback
Use:
- Player profile
- Memory
- Opponent data

---

## Interaction Design Summary

| Step | UX Behavior |
|------|------------|
| Trigger | Only at critical positions |
| Prompt | “What were you considering?” |
| Input | Clickable moves (fast) |
| Depth | Optional expansion |
| Skip | Always available |
| Feedback | Delayed, guided |
| Result | Process-focused explanation |

---

# 🧩 System Architecture Overview

## 1. Thinking Layer
- Captures user decision-making
- Classifies thinking errors

---

## 2. Identity Layer
- Player archetype
- Behavioral traits
- Opponent-based adjustments

---

## 3. Memory Layer
- Tracks recurring issues
- Detects trends
- Builds narrative

---

## 4. UX Layer (New)
- Smart prompting system
- Low-friction interaction
- Adaptive depth

---

# 🚀 Final Transformation

### Before
> “You made a mistake.”

### After
> “You considered too few candidate moves here, which is a recurring pattern—especially under pressure.”

---

# 🎯 Key Outcome

You are no longer building:
- an analysis tool

You are building:
- a **real chess coach**

---

# Next Steps (Optional)

- UI wireframes (React components & flows)
- Prompt templates for LLM grounding
- Data schema for new layers
