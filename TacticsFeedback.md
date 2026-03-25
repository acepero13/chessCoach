This is actually a very solid implementation — you’re already doing a lot of things right that many people get wrong.

But your intuition is probably correct:
👉 it’s systematically missing or misclassifying tactics in subtle ways.

Let me go through this like a code + concept review and point out where accuracy likely breaks.

🧠 The biggest conceptual limitation
❗ You only look at one move (best_move)
_move_creates_fork(board, best_move)
_move_creates_pin(board, best_move)

👉 This assumes:

“The tactic is visible immediately after the best move”

But in reality:

🔥 Most tactics are multi-move

Examples:

fork happens on move 2
pin is created, but only exploitable later
sacrifice → tactic appears later

👉 Your system will miss:

best move: sacrifice
next move: fork

You classify:
→ ❌ not a fork
→ maybe “tactical_shot_found” (if lucky)

⚠️ Issue 1 — Fork detection is too strict (and sometimes wrong)
if target_val >= landing_val or _is_hanging(test, sq)
Problems:
Many real forks are NOT immediately profitable
classic knight fork where both pieces are defended
still winning because opponent cannot save both
You require:
profitable_attacks >= 2

👉 This misses:

“threat forks” (very common in human play)
forks where value emerges next move
🔧 Fix idea

Instead of:

“can capture profitably now”

Use:

“attacks multiple high-value targets AND engine eval improves significantly”

⚠️ Issue 2 — Pin detection is too naive
test.is_pinned(not color, sq)

This detects:
👉 absolute pins to king only

You miss:

pins to queen (very common!)
“practical pins” (piece can't move due to tactic)
🔥 Example you miss:
bishop pins knight to queen → winning tactic

👉 Your code:
→ ❌ not a pin

🔧 Fix idea

Detect:

alignment: attacker → piece → valuable piece behind

Not just king pins.

⚠️ Issue 3 — No notion of forcing moves

You don’t check:

check
capture sequences
threats

But tactics are usually:

forcing sequences (checks, captures, threats)

Result:

You misclassify:

sacrifices
mating attacks
discovered attacks
⚠️ Issue 4 — Single-label restriction
# At most ONE missed-tactic pattern

This is great for UX, but bad for correctness.

Example:

move misses fork + pin

You record:
→ only fork

👉 This biases your stats and learning system.

⚠️ Issue 5 — Hanging piece logic is actually strong 👍

This part is surprisingly good:

generate_legal_moves(to_mask=...)

👉 You correctly:

avoid pinned attackers
check legality

But:

Limitation:

You only detect:

“engine best move captures hanging piece”

You miss:

creating hanging pieces
removing defenders
⚠️ Issue 6 — No discovered attacks

You completely miss a major motif:

discovered attack
discovered check

These are:
👉 VERY common in tactics

⚠️ Issue 7 — Evaluation gap ≠ tactic type

You rely heavily on:

ev.centipawn_loss > threshold

But:

positional improvements can also be 80–150 cp
some tactics are small eval swings

👉 This causes:

false positives
missed subtle tactics
🧪 Where your system is probably inaccurate
❌ Under-detection
multi-move tactics
discovered attacks
queen pins
sacrifice-based tactics
❌ Misclassification
fork vs hanging piece
pin vs positional pressure
❌ Over-simplification
forcing everything into one label
🚀 How to significantly improve (without ML yet)
🔥 1. Look at PV (principal variation)

Instead of:

test.push(best_move)

Do:

for move in pv[:3-5]:
    simulate
    detect motifs

👉 This alone will massively improve accuracy

🔥 2. Add discovered attack detection

Simple heuristic:

if piece moves and reveals attack from behind:
    discovered attack

This is low effort, high impact.

🔥 3. Improve fork definition

Instead of “immediate profitability”:

if attacks >= 2 valuable pieces:
    AND eval improves significantly
🔥 4. Add “tactical sequence” category

When no motif fits:

"type": "tactical_sequence"

Better than mislabeling.

🔥 5. Use engine signals more

Stockfish already gives hints:

mate score
depth
PV

👉 You can detect:

forced sequences
sacrifices
🤖 Where ML could actually help you

Your current system is:

rule-based + engine-assisted

ML could help with:

1. Motif classification from position + PV
input: FEN + PV
output: motif probabilities
2. Replace brittle rules like:
_move_creates_fork
_move_creates_pin
💡 My honest take

You are already at a very strong baseline.

👉 The main issue is NOT “wrong logic”
👉 It’s that:

chess tactics are inherently multi-move and contextual

🎯 If I were you (practical roadmap)
Step 1 (biggest gain)

✅ Extend from 1 move → PV (3–5 moves)

Step 2

✅ Add:

discovered attack
queen pins
Step 3

✅ Relax fork definition

Step 4 (optional but powerful)

✅ Log:

your detected motif
actual PV

Then manually inspect ~50 cases

👉 You’ll quickly see patterns of failure