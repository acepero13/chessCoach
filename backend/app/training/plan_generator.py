"""
Deterministic 4-week training plan generator.
Fully derived from the performance profile and raw metrics — no randomness.

Every task names the exact resource (Lichess theme, book chapter, tool) and
what to do, so the player never has to guess.
"""
from dataclasses import dataclass


@dataclass
class Task:
    """A single concrete training activity."""
    label: str          # resource + what to do, e.g. "lichess.org/practice: K+P endings (10 pos)"
    duration_min: int
    category: str       # "tactics" | "strategy" | "endgame" | "opening" | "games" | "review"
    instructions: str   # step-by-step guidance shown inline (never hidden)


@dataclass
class DailySession:
    day: int
    tasks: list[Task]
    estimated_minutes: int
    focus_areas: list[str]


@dataclass
class Week:
    week_number: int
    theme: str
    subtitle: str
    daily_sessions: list[DailySession]
    total_minutes: int
    recommended_time_control: str


@dataclass
class TrainingPlan:
    weeks: list[Week]
    primary_weakness: str
    secondary_weakness: str
    notes: list[str]
    total_hours: float


# ---------------------------------------------------------------------------
# Task pools — lists of rotating concrete activities per domain.
# label:        includes the tool/resource name so player knows where to go.
# instructions: step-by-step "how to do this session".
# ---------------------------------------------------------------------------

# ── Endgame ─────────────────────────────────────────────────────────────────

ENDGAME_POOL = [
    Task(
        label="lichess.org/practice — King & Pawn endings (10 positions)",
        duration_min=15,
        category="endgame",
        instructions=(
            "Go to lichess.org/practice → Endgame → King & Pawn. "
            "Solve 10 positions. Aim for 100% — these are the most recurring endings. "
            "If you fail one, reset and try again before looking at the answer."
        ),
    ),
    Task(
        label="De la Villa '100 Endgames' — Ch.1–3: K+P opposition (read + solve)",
        duration_min=20,
        category="endgame",
        instructions=(
            "Work through each diagram with a real board. "
            "Cover the solution and spend at least 2 minutes calculating before revealing it. "
            "Chapters 1–3 cover key squares, opposition, and the pawn promotion race."
        ),
    ),
    Task(
        label="lichess.org/practice — Rook endings: Lucena & Philidor (10 positions)",
        duration_min=20,
        category="endgame",
        instructions=(
            "Go to lichess.org/practice → Endgame → Rook endings. "
            "Focus on the Lucena (winning) and Philidor (drawing) positions — they appear in ~60% of rook endgames. "
            "De la Villa ch.4–6 has detailed explanations if you get stuck."
        ),
    ),
    Task(
        label="Lichess puzzles: Endgame theme — 15 puzzles",
        duration_min=15,
        category="endgame",
        instructions=(
            "lichess.org/training → Themes → Endgame. "
            "After each wrong answer, spend 60 seconds understanding why the solution works before moving on. "
            "Track how many you solve on the first attempt — your target is 70%+."
        ),
    ),
    Task(
        label="Silman 'Complete Endgame Course' — your rating chapter (30 min read)",
        duration_min=30,
        category="endgame",
        instructions=(
            "Find the chapter matching your current rating range. "
            "Read one section, then set up each position on a board and play it out vs Stockfish. "
            "This book is structured so you only study what's relevant at your level."
        ),
    ),
]

# ── Endgame: category-specific pools ────────────────────────────────────────

ROOK_ENDGAME_POOL = [
    Task(
        label="lichess.org/practice — Lucena position (10 positions)",
        duration_min=15,
        category="endgame",
        instructions=(
            "lichess.org/practice → Endgame → Rook endings → Lucena. "
            "The Lucena is the fundamental winning technique in rook endgames. "
            "Master 'building a bridge' — this position decides ~40% of rook endgames."
        ),
    ),
    Task(
        label="lichess.org/practice — Philidor position (10 positions)",
        duration_min=15,
        category="endgame",
        instructions=(
            "lichess.org/practice → Endgame → Rook endings → Philidor. "
            "The Philidor is the key drawing technique when defending. "
            "Rule: keep the rook on the 6th rank until the enemy king advances, then switch to checks."
        ),
    ),
    Task(
        label="De la Villa '100 Endgames' — Ch.4–8: Rook endings (read + solve)",
        duration_min=25,
        category="endgame",
        instructions=(
            "Work through each diagram with a board. "
            "These chapters cover Lucena, Philidor, and rook activity principles. "
            "Key rule: in rook endgames, activity of the rook > material count."
        ),
    ),
    Task(
        label="Lichess puzzles: Rook Endgame theme — 15 puzzles",
        duration_min=15,
        category="endgame",
        instructions=(
            "lichess.org/training → Themes → RookEndgame. "
            "After each puzzle: identify whether it was a Lucena-type (winning) or Philidor-type (saving). "
            "This is the most critical endgame category to master."
        ),
    ),
]

KING_PAWN_POOL = [
    Task(
        label="lichess.org/practice — King & Pawn endings: Opposition (10 positions)",
        duration_min=15,
        category="endgame",
        instructions=(
            "lichess.org/practice → Endgame → King & Pawn → Opposition. "
            "Opposition is the foundation of all K+P endings. "
            "Rule: the king with the opposition controls key squares; the enemy king must step aside."
        ),
    ),
    Task(
        label="lichess.org/practice — King & Pawn endings: Key Squares (10 positions)",
        duration_min=15,
        category="endgame",
        instructions=(
            "lichess.org/practice → Endgame → King & Pawn → Key Squares. "
            "If your king reaches a key square, the pawn promotes regardless. "
            "Memorise the key squares for e-, d-, and f-pawns — they appear in every game."
        ),
    ),
    Task(
        label="De la Villa '100 Endgames' — Ch.1–3: K+P opposition and key squares (solve)",
        duration_min=20,
        category="endgame",
        instructions=(
            "Work through every diagram. Cover the solution and try for 2 minutes before revealing. "
            "Chapters 1–3 cover opposition, triangulation, and the pawn race — "
            "the three ideas that decide 90% of K+P endings."
        ),
    ),
    Task(
        label="Lichess puzzles: Pawn Endgame theme — 15 puzzles",
        duration_min=15,
        category="endgame",
        instructions=(
            "lichess.org/training → Themes → PawnEndgame. "
            "Before each puzzle, ask: which side has the opposition? Who wins the pawn race? "
            "These two questions resolve most pawn endings."
        ),
    ),
]

MINOR_PIECE_POOL = [
    Task(
        label="lichess.org/practice — Bishop endings (10 positions)",
        duration_min=15,
        category="endgame",
        instructions=(
            "lichess.org/practice → Endgame → Bishop endings. "
            "Key rule: wrong-coloured bishop cannot stop a rook pawn from the corner. "
            "Always check: are both bishops the same colour as the promotion square?"
        ),
    ),
    Task(
        label="De la Villa '100 Endgames' — Minor piece chapter (read + solve)",
        duration_min=20,
        category="endgame",
        instructions=(
            "Focus on bishop vs knight technique. "
            "Rule: bishops dominate open positions (few pawns), knights excel in closed ones. "
            "After reading: review one of your recent minor piece endings in Lichess analysis."
        ),
    ),
]

ENDGAME_COLLAPSE_TASK = Task(
    label="Conversion drill — play winning endgame positions vs Stockfish (no take-backs)",
    duration_min=20,
    category="endgame",
    instructions=(
        "Set up a winning endgame position from your games in Lichess board editor. "
        "Play it out vs Stockfish level 5 with no take-backs. "
        "Goal: do NOT rush. Make each move purposefully. "
        "If you blunder, note the position — this is your collapse pattern."
    ),
)

# ── Tactics — themed pools ───────────────────────────────────────────────────

PIN_POOL = [
    Task(
        label="Lichess puzzles: Pin theme — 20 puzzles",
        duration_min=15,
        category="tactics",
        instructions=(
            "lichess.org/training → Themes → Pin. "
            "Before solving, identify: (a) which piece is pinned, (b) what it is pinned against. "
            "If you solve it in under 10 s, note that you recognised the pattern — good sign."
        ),
    ),
    Task(
        label="Lichess puzzles: Skewer theme — 15 puzzles",
        duration_min=12,
        category="tactics",
        instructions=(
            "lichess.org/training → Themes → Skewer. "
            "Skewers are reverse pins: the valuable piece is in front. "
            "After each puzzle, ask: could I have set up this tactic in my games?"
        ),
    ),
]

FORK_POOL = [
    Task(
        label="Lichess puzzles: Fork theme — 20 puzzles",
        duration_min=15,
        category="tactics",
        instructions=(
            "lichess.org/training → Themes → Fork. "
            "Focus on knight forks (most common) but also bishop and pawn double-attacks. "
            "Before each move, scan ALL squares your knight could jump to."
        ),
    ),
    Task(
        label="Lichess puzzles: Double Attack theme — 15 puzzles",
        duration_min=12,
        category="tactics",
        instructions=(
            "lichess.org/training → Themes → DoubleCheck or Knight. "
            "A fork is a double-attack — practice spotting undefended pieces before calculating. "
            "Aim for 80% accuracy."
        ),
    ),
]

HANGING_POOL = [
    Task(
        label="Lichess puzzles: Hanging Piece theme — 20 puzzles",
        duration_min=12,
        category="tactics",
        instructions=(
            "lichess.org/training → Themes → HangingPiece. "
            "Rule: before every move in your games, scan all opponent pieces and ask 'is anything undefended?' "
            "This drill builds that habit."
        ),
    ),
]

MATE_POOL = [
    Task(
        label="Lichess puzzles: Checkmate Patterns — 20 puzzles (mate in 1–3)",
        duration_min=15,
        category="tactics",
        instructions=(
            "lichess.org/training → Themes → Mate. "
            "Focus on back-rank mates, smothered mates, and queen+knight mates first — "
            "they are the most common patterns at club level."
        ),
    ),
    Task(
        label="Lichess puzzles: Back Rank Mate theme — 15 puzzles",
        duration_min=12,
        category="tactics",
        instructions=(
            "lichess.org/training → Themes → BackRankMate. "
            "After each puzzle, check: in my own games, is my back rank defended? "
            "Make it a habit to ask this every 5 moves."
        ),
    ),
]

DEFENSE_POOL = [
    Task(
        label="Lichess puzzles: Defense theme — 15 puzzles",
        duration_min=15,
        category="tactics",
        instructions=(
            "lichess.org/training → Themes → Defense. "
            "These positions require finding the only saving move under attack. "
            "Practice the habit: 'what is my opponent threatening right now?'"
        ),
    ),
]

# Generic fallback tactics (used when no specific pattern data)
GENERIC_TACTICS_POOL = [
    Task(
        label="Lichess Puzzle Storm — 5-minute run",
        duration_min=10,
        category="tactics",
        instructions=(
            "lichess.org/storm. "
            "After the run, review every puzzle you got wrong. "
            "Categorise them: which theme keeps tripping you up? Focus next session there."
        ),
    ),
    Task(
        label="Lichess puzzles: Mixed — 20 puzzles (no hints)",
        duration_min=15,
        category="tactics",
        instructions=(
            "lichess.org/training → no theme filter. "
            "Disable hints and move suggestions. "
            "After each wrong answer, write one sentence explaining what you missed."
        ),
    ),
]

# ── Strategy ─────────────────────────────────────────────────────────────────

PAWN_STRUCTURE_POOL = [
    Task(
        label="Lichess puzzles: Isolated Pawn / Pawn Endgame themes — 15 puzzles",
        duration_min=15,
        category="strategy",
        instructions=(
            "lichess.org/training → Themes → IsolatedPawn or PawnEndgame. "
            "Ask after each: did the pawn structure determine the result? How?"
        ),
    ),
    Task(
        label="Silman 'How to Reassess Your Chess' — Ch. Pawn Structure (30 min read)",
        duration_min=30,
        category="strategy",
        instructions=(
            "Read one section of the pawn structure chapter. "
            "Set up each example on a board and try to find the plan before reading it. "
            "Focus on: isolated pawn as weakness vs. dynamic compensation."
        ),
    ),
]

WEAK_SQUARES_POOL = [
    Task(
        label="Lichess puzzles: Outpost / Weak Square theme — 15 puzzles",
        duration_min=15,
        category="strategy",
        instructions=(
            "lichess.org/training → Themes → Outpost. "
            "Before each puzzle, identify all weak squares (squares your opponent cannot defend with pawns). "
            "A knight on an outpost can decide games single-handedly."
        ),
    ),
]

PROPHYLAXIS_POOL = [
    Task(
        label="Silman 'How to Reassess Your Chess' — Prophylaxis chapter (30 min read)",
        duration_min=30,
        category="strategy",
        instructions=(
            "Read and set up every diagram. Before turning the page, ask: "
            "'what is my opponent's best plan?' and write it down. "
            "Nimzowitsch's rule: stop the opponent's plans before executing your own."
        ),
    ),
    Task(
        label="Lichess puzzles: Quiet Move / Prophylaxis theme — 10 puzzles",
        duration_min=15,
        category="strategy",
        instructions=(
            "lichess.org/training → Themes → QuietMove. "
            "These puzzles have no captures — purely positional. "
            "Spend 3+ minutes on each; the answer requires seeing the opponent's future threat."
        ),
    ),
]

BVN_POOL = [
    Task(
        label="Silman 'How to Reassess Your Chess' — Bishop vs Knight imbalances (30 min)",
        duration_min=30,
        category="strategy",
        instructions=(
            "Read the Bishop vs Knight chapter and set up each example. "
            "Key rule: bishops prefer open positions (few center pawns), "
            "knights prefer closed positions (fixed pawn chains). "
            "Review your last 3 B×N trades in analysis — were they correct?"
        ),
    ),
    Task(
        label="Lichess puzzles: Bishop vs Knight — 10 strategic positions",
        duration_min=15,
        category="strategy",
        instructions=(
            "Search lichess.org/training for 'Bishop' or 'Knight' theme. "
            "For each position: before solving, decide if the position is open or closed, "
            "then decide which piece is better. Check if your assessment was right."
        ),
    ),
]

DRIFT_POOL = [
    Task(
        label="Lichess puzzles: Quiet Move / Strategic theme — 10 puzzles",
        duration_min=15,
        category="strategy",
        instructions=(
            "lichess.org/training → Themes → QuietMove. "
            "These require long-range thinking. Rule for your games: "
            "every 5 moves, stop and write (mentally) your next 3-move plan."
        ),
    ),
]

# ── Opening ───────────────────────────────────────────────────────────────────

OPENING_POOL = [
    Task(
        label="Lichess opening explorer — review your 3 most-played openings",
        duration_min=20,
        category="opening",
        instructions=(
            "lichess.org/analysis → Opening Explorer → My Games. "
            "Find the line where you lose most often. "
            "Look up what the engine suggests at move 5–10. Learn that line by heart."
        ),
    ),
    Task(
        label="Chessable — 30-min session on your chosen opening course",
        duration_min=30,
        category="opening",
        instructions=(
            "Open your Chessable course. Do not skip variations. "
            "After each line, close the browser and replay it from memory. "
            "Repetition > reading: the goal is to not have to think in the first 10 moves."
        ),
    ),
    Task(
        label="Lichess puzzles: Opening theme — 10 puzzles",
        duration_min=12,
        category="opening",
        instructions=(
            "lichess.org/training → Themes → Opening. "
            "These are tactics that arise directly from opening mistakes. "
            "Know these patterns so you can punish your opponent's early errors."
        ),
    ),
]

# ── Time management ───────────────────────────────────────────────────────────

TIME_POOL = [
    Task(
        label="Lichess Puzzle Rush — 3-minute mode (builds speed under pressure)",
        duration_min=10,
        category="tactics",
        instructions=(
            "lichess.org/rush. Choose 3-minute Survival mode. "
            "Aim for 20+ correct puzzles. "
            "This directly trains decision speed — the skill that prevents time trouble."
        ),
    ),
    Task(
        label="3 blitz games (3+2) — check the clock graph after each game",
        duration_min=30,
        category="games",
        instructions=(
            "Play 3+2 on Lichess. After each game, open the game review and check the "
            "move-time graph at the bottom. Identify the move where you started burning time. "
            "Ask: could I have made that decision faster with a simpler rule?"
        ),
    ),
    Task(
        label="Lichess Puzzle Storm — 3-minute run with 30-second moves only",
        duration_min=10,
        category="tactics",
        instructions=(
            "lichess.org/storm. Self-rule: allow max 30 seconds per puzzle. "
            "If you don't see it in 30 s, guess and move on. "
            "The goal is to break the habit of endless calculation for obvious moves."
        ),
    ),
    Task(
        label="Timed practice games (10+5) — never fall below 1 minute on clock",
        duration_min=35,
        category="games",
        instructions=(
            "Play 2 games at 10+5 on Lichess. Personal rule: never let your clock drop below 1 min. "
            "If you are about to, make the 'good enough' move rather than the perfect one. "
            "Review: did time pressure cause any blunders? Note the positions."
        ),
    ),
]

# ── Mental stability ───────────────────────────────────────────────────────────

MENTAL_POOL = [
    Task(
        label="Replay your 2 worst games in ChessTutor — find where the collapse started",
        duration_min=20,
        category="review",
        instructions=(
            "Open the games with the highest blunder count in your analysis. "
            "Find the exact move where the evaluation started to collapse. "
            "Ask: was this after a previous mistake? This is the 'tilt point'. "
            "Recognising it is the first step to stopping it."
        ),
    ),
    Task(
        label="1 classical game (15+10) — write your plan before every move",
        duration_min=35,
        category="games",
        instructions=(
            "Before each move, take 5 seconds and mentally complete: "
            "'My plan is ___ because ___'. "
            "After a blunder: before your next move, breathe for 10 s and re-scan the whole board. "
            "No rushing after mistakes — that is when the second blunder happens."
        ),
    ),
    Task(
        label="Post-game ritual: score yourself on focus (1–5) after every rated game",
        duration_min=5,
        category="review",
        instructions=(
            "After each game this week, write or type: "
            "(a) focus score 1–5, (b) one moment you lost focus, (c) what triggered it. "
            "After 7 games you will have a clear pattern. Awareness precedes change."
        ),
    ),
    Task(
        label="Lichess puzzles (25 mixed) — no take-backs, no hints",
        duration_min=20,
        category="tactics",
        instructions=(
            "lichess.org/training, puzzle mode with hints off. "
            "Rule: commit to every move. Do not 'trial-and-error'. "
            "This trains deliberate decision-making — the same discipline needed when you're losing."
        ),
    ),
]

# ── Defense ───────────────────────────────────────────────────────────────────

DEFENSE_DRILL_POOL = [
    Task(
        label="Lichess puzzles: Defense theme — 20 puzzles (only-moves under attack)",
        duration_min=20,
        category="tactics",
        instructions=(
            "lichess.org/training → Themes → Defense. "
            "Before each puzzle: identify every threat. List them. Then find the defense. "
            "Building the habit: 'what is my opponent threatening?' before every reply."
        ),
    ),
    Task(
        label="Lichess puzzles: Defensive Move / Desperado theme — 15 puzzles",
        duration_min=15,
        category="tactics",
        instructions=(
            "lichess.org/training → Themes → Desperado. "
            "These feature sacrificing a lost piece for maximum damage — "
            "recognise when your opponent has this resource so you don't walk into it."
        ),
    ),
]

# ── Attack ────────────────────────────────────────────────────────────────────

ATTACK_POOL = [
    Task(
        label="Lichess puzzles: Attack theme — 20 puzzles",
        duration_min=15,
        category="tactics",
        instructions=(
            "lichess.org/training → Themes → Attack. "
            "Before each puzzle, identify the weakest square around the enemy king. "
            "Successful attacks usually target one square repeatedly."
        ),
    ),
    Task(
        label="Lichess puzzles: Sacrifice theme — 15 puzzles",
        duration_min=15,
        category="tactics",
        instructions=(
            "lichess.org/training → Themes → Sacrifice. "
            "After each puzzle: what did the sacrifice gain? (open file, exposed king, tempo?) "
            "In your games: look for these patterns when the king has not castled."
        ),
    ),
]

# ── Games (standard) ─────────────────────────────────────────────────────────

LIGHT_GAMES = Task(
    label="2 rated rapid games (10+5) on Lichess",
    duration_min=30,
    category="games",
    instructions="Focus on applying today's drill theme in the game. Note any positions where it arose.",
)

HEAVY_GAMES = Task(
    label="3–4 rated rapid games (10+5) on Lichess",
    duration_min=60,
    category="games",
    instructions="Mid-week game block. After each game, spend 2 min identifying your worst decision.",
)

SELF_REVIEW_TASK = Task(
    label="Review your worst game this week — annotate 5 key moments in ChessTutor",
    duration_min=25,
    category="review",
    instructions=(
        "Open the game with the most blunders in ChessTutor's self-analysis. "
        "For each key moment: write what you were thinking, then compare to the engine. "
        "This is the single most effective improvement habit."
    ),
)

# ---------------------------------------------------------------------------
# Time controls
# ---------------------------------------------------------------------------

TIME_CONTROLS = {
    "tactics": "Bullet (1+0) — pattern speed training",
    "endgame": "Classical (15+10) — calculation precision",
    "opening": "Rapid (10+5) — opening practice",
    "strategy": "Classical (15+10) — strategic understanding",
    "defense": "Rapid (10+5)",
    "mental_stability": "Rapid (10+5) — focus on decision quality, not speed",
    "time_management": "Blitz (3+2) — practise under time pressure",
    "conversion": "Classical (15+10)",
    "default": "Rapid (10+5)",
}

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _get_score(profile: dict, key: str) -> float:
    return profile.get(f"{key}_score", profile.get(key, 50.0))


def _identify_weaknesses(profile: dict) -> list[tuple[str, float]]:
    domains = [
        "attack", "defense", "opening", "strategy",
        "endgame", "tactics", "time_management", "conversion", "mental_stability"
    ]
    scored = [(d, _get_score(profile, d)) for d in domains]
    return sorted(scored, key=lambda x: x[1])


def _pool_for(weakness: str, raw: dict, endgame_profile: dict | None = None) -> list[Task]:
    """Return the ranked task pool for a weakness domain."""
    if weakness == "tactics":
        # Build a pool ordered by frequency of each missed pattern
        counts = {
            "pin":     raw.get("missed_pins", 0),
            "fork":    raw.get("missed_forks", 0),
            "hanging": raw.get("hanging_pieces_missed", 0),
            "mate":    raw.get("missed_checkmates", 0),
        }
        ordered = sorted(counts.items(), key=lambda x: -x[1])
        pool: list[Task] = []
        for name, count in ordered:
            if count > 0:
                if name == "pin":    pool.extend(PIN_POOL)
                elif name == "fork": pool.extend(FORK_POOL)
                elif name == "hanging": pool.extend(HANGING_POOL)
                elif name == "mate": pool.extend(MATE_POOL)
        if not pool:
            pool = GENERIC_TACTICS_POOL[:]
        return pool

    if weakness == "strategy":
        counts = {
            "pawn":    raw.get("pawn_structure_errors", 0),
            "weak":    raw.get("weak_square_creations", 0),
            "bvn":     raw.get("bad_bvn_trades", 0),
            "drift":   raw.get("strategic_drifts", 0),
        }
        ordered = sorted(counts.items(), key=lambda x: -x[1])
        pool = []
        for name, count in ordered:
            if count > 0:
                if name == "pawn":  pool.extend(PAWN_STRUCTURE_POOL)
                elif name == "weak": pool.extend(WEAK_SQUARES_POOL)
                elif name == "bvn":  pool.extend(BVN_POOL)
                elif name == "drift": pool.extend(DRIFT_POOL + PROPHYLAXIS_POOL)
        if not pool:
            pool = PROPHYLAXIS_POOL + PAWN_STRUCTURE_POOL
        return pool

    if weakness in ("endgame", "conversion"):
        # Use category-specific pool if endgame profile data is available
        if endgame_profile:
            weakest_cat = endgame_profile.get("weakest_category")
            collapses   = endgame_profile.get("collapse_count", 0)
            pool: list[Task] = []
            if weakest_cat == "rook":
                pool = ROOK_ENDGAME_POOL[:]
            elif weakest_cat == "king_pawn":
                pool = KING_PAWN_POOL[:]
            elif weakest_cat == "minor_piece":
                pool = MINOR_PIECE_POOL[:]
            else:
                pool = ENDGAME_POOL[:]
            # Add conversion drill if collapses detected
            if collapses > 0:
                pool.insert(1, ENDGAME_COLLAPSE_TASK)
            return pool
        return ENDGAME_POOL[:]

    if weakness == "opening":
        return OPENING_POOL[:]

    if weakness == "defense":
        return DEFENSE_DRILL_POOL[:]

    if weakness == "mental_stability":
        return MENTAL_POOL[:]

    if weakness == "time_management":
        return TIME_POOL[:]

    if weakness == "attack":
        return ATTACK_POOL[:]

    return GENERIC_TACTICS_POOL[:]


def _warmup_for(primary: str, raw: dict) -> Task:
    """Return a themed warmup task based on the primary weakness."""
    if primary in ("endgame", "conversion"):
        return Task(
            label="lichess.org/practice — Endgame warm-up (5 positions)",
            duration_min=10,
            category="endgame",
            instructions=(
                "lichess.org/practice → Endgame. Pick any category. "
                "5 quick positions to activate endgame pattern recognition before the main drill."
            ),
        )
    if primary == "tactics":
        # Theme the warmup to the top missed pattern
        top = max(
            [("pin", raw.get("missed_pins", 0)), ("fork", raw.get("missed_forks", 0)),
             ("hanging", raw.get("hanging_pieces_missed", 0)), ("mate", raw.get("missed_checkmates", 0))],
            key=lambda x: x[1],
        )
        theme_map = {
            "pin":     ("Pin theme", "lichess.org/training → Themes → Pin. 10 quick puzzles."),
            "fork":    ("Fork theme", "lichess.org/training → Themes → Fork. 10 quick puzzles."),
            "hanging": ("HangingPiece theme", "lichess.org/training → Themes → HangingPiece. 10 quick puzzles."),
            "mate":    ("Mate theme", "lichess.org/training → Themes → Mate. 10 quick puzzles."),
        }
        name, hint = theme_map.get(top[0], ("Mixed", "lichess.org/training. 10 mixed puzzles."))
        return Task(
            label=f"Lichess puzzles: {name} — 10 puzzles (warm-up)",
            duration_min=10,
            category="tactics",
            instructions=hint,
        )
    if primary == "mental_stability":
        return Task(
            label="Lichess puzzles: 10 mixed puzzles — no hints, no take-backs",
            duration_min=10,
            category="tactics",
            instructions=(
                "lichess.org/training, hints off. "
                "Treat each puzzle like a real game decision: commit, don't second-guess. "
                "Builds the deliberate thinking habit needed for stability."
            ),
        )
    if primary == "time_management":
        return Task(
            label="Lichess Puzzle Storm — 3-minute run",
            duration_min=5,
            category="tactics",
            instructions=(
                "lichess.org/storm. 3-minute run as warm-up. "
                "Builds speed for the time-pressure training that follows."
            ),
        )
    # Default warmup
    return Task(
        label="Lichess puzzles: 10 mixed puzzles (warm-up)",
        duration_min=10,
        category="tactics",
        instructions=(
            "lichess.org/training. No theme filter. "
            "After each failure, note the theme. Over a week you will see your pattern gaps."
        ),
    )


def _week_subtitle(weakness: str, raw: dict, endgame_profile: dict | None = None) -> str:
    if weakness == "tactics":
        parts = []
        if raw.get("missed_pins", 0):     parts.append(f"{raw['missed_pins']} missed pin(s)")
        if raw.get("missed_forks", 0):    parts.append(f"{raw['missed_forks']} missed fork(s)")
        if raw.get("hanging_pieces_missed", 0): parts.append(f"{raw['hanging_pieces_missed']} hanging piece(s) missed")
        if raw.get("missed_checkmates", 0): parts.append(f"{raw['missed_checkmates']} missed mate(s)")
        return ("Pattern gaps detected: " + ", ".join(parts)) if parts else "Tactical accuracy below threshold"

    if weakness == "strategy":
        parts = []
        if raw.get("pawn_structure_errors", 0): parts.append(f"{raw['pawn_structure_errors']} pawn structure error(s)")
        if raw.get("weak_square_creations", 0): parts.append(f"{raw['weak_square_creations']} weak square(s) created")
        if raw.get("bad_bvn_trades", 0):        parts.append(f"{raw['bad_bvn_trades']} poor B vs N trade(s)")
        if raw.get("strategic_drifts", 0):      parts.append(f"{raw['strategic_drifts']} positional drift(s)")
        return ("Positional issues: " + ", ".join(parts)) if parts else "Strategic understanding needs work"

    if weakness in ("endgame", "conversion"):
        if endgame_profile:
            cats = endgame_profile.get("categories", {})
            weakest_cat = endgame_profile.get("weakest_category")
            cat_data = cats.get(weakest_cat, {})
            label = cat_data.get("label", weakest_cat or "endgame")
            conv = cat_data.get("conversion_rate")
            collapses = endgame_profile.get("collapse_count", 0)
            parts = [f"Weakest in {label}"]
            if conv is not None:
                parts.append(f"{round(conv * 100)}% conversion rate")
            if collapses > 0:
                parts.append(f"{collapses} collapse event(s)")
            return " — ".join(parts)
        wt = raw.get("winning_games_total", 0)
        if wt:
            wc = raw.get("winning_games_converted", 0)
            return f"Converted only {wc}/{wt} winning endgames — technique drill needed"
        return "Endgame accuracy below threshold — K+P and Rook endings first"

    if weakness == "opening":
        m = raw.get("opening_mistakes", 0)
        return f"{m} early inaccuracy(-ies) — repertoire gaps to close" if m else "Opening accuracy below threshold"

    if weakness == "defense":
        b = raw.get("blunders_under_pressure", 0)
        return f"{b} blunder(s) under pressure — defensive resource recognition" if b else "Defensive solidity needs work"

    if weakness == "mental_stability":
        c = raw.get("blunder_clusters", 0)
        return f"{c} blunder cluster(s) — position collapse after a mistake" if c else "Consistency and focus issues"

    if weakness == "time_management":
        bt = raw.get("blunders_time_trouble", 0)
        return f"{bt} blunder(s) in time trouble — pacing and speed drills" if bt else "Time management needs work"

    if weakness == "attack":
        return "Attack execution score below threshold — tactical pattern drills"

    return f"{weakness.replace('_', ' ')} improvement needed"


# ---------------------------------------------------------------------------
# Week builder
# ---------------------------------------------------------------------------

def _build_week(
    week_num: int,
    primary: str,
    secondary: str,
    primary_score: float,
    raw: dict,
    profile: dict,
    endgame_profile: dict | None = None,
) -> Week:
    primary_pool   = _pool_for(primary, raw, endgame_profile)
    secondary_pool = _pool_for(secondary, raw, endgame_profile)
    warmup = _warmup_for(primary, raw)

    time_control = TIME_CONTROLS.get(primary, TIME_CONTROLS["default"])
    subtitle = _week_subtitle(primary, raw, endgame_profile)

    themes = {
        1: f"Foundation — identify your {primary.replace('_', ' ')} gaps",
        2: f"Drilling — targeted {primary.replace('_', ' ')} & {secondary.replace('_', ' ')} exercises",
        3: f"Integration — mixed practice, emphasis on {primary.replace('_', ' ')}",
        4: "Consolidation — rated games + self-review",
    }
    theme = themes.get(week_num, f"Week {week_num}")

    sessions = []
    for day in range(1, 8):
        if day == 7:
            sessions.append(DailySession(day=day, tasks=[], estimated_minutes=0, focus_areas=[]))
            continue

        tasks: list[Task] = [warmup]

        # Primary drill — rotate through pool across the week
        if primary_pool:
            tasks.append(primary_pool[(day - 1) % len(primary_pool)])

        # Secondary drill on alternating days
        if secondary_pool and day % 2 == 0:
            tasks.append(secondary_pool[(day - 1) % len(secondary_pool)])

        # Games block — only add anchor if the day's drills don't already include games
        already_has_games = any(t.category == "games" for t in tasks)
        if day == 6:
            # Saturday: drop any game anchor already added; end with self-review
            tasks = [t for t in tasks if t.category != "games"]
            tasks.append(SELF_REVIEW_TASK)
        elif already_has_games and day in (4, 5):
            # Heavy game day: consolidate into one heavy block
            tasks = [t for t in tasks if t.category != "games"]
            tasks.append(HEAVY_GAMES)
        elif not already_has_games:
            tasks.append(HEAVY_GAMES if day in (4, 5) else LIGHT_GAMES)

        total_min = sum(t.duration_min for t in tasks)
        sessions.append(DailySession(
            day=day,
            tasks=tasks,
            estimated_minutes=total_min,
            focus_areas=[primary, secondary],
        ))

    total_minutes = sum(s.estimated_minutes for s in sessions)
    return Week(
        week_number=week_num,
        theme=theme,
        subtitle=subtitle,
        daily_sessions=sessions,
        total_minutes=total_minutes,
        recommended_time_control=time_control,
    )


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def generate_training_plan(
    profile: dict,
    raw_metrics: dict | None = None,
    endgame_profile: dict | None = None,
) -> TrainingPlan:
    raw = raw_metrics or {}
    weaknesses = _identify_weaknesses(profile)
    primary_weakness, primary_score = weaknesses[0]
    secondary_weakness, secondary_score = weaknesses[1]

    weeks = [
        _build_week(
            week_num=wn,
            primary=primary_weakness,
            secondary=secondary_weakness,
            primary_score=primary_score,
            raw=raw,
            profile=profile,
            endgame_profile=endgame_profile,
        )
        for wn in range(1, 5)
    ]

    total_hours = sum(w.total_minutes for w in weeks) / 60

    notes = []
    if primary_score < 40:
        notes.append(
            f"Critical weakness in {primary_weakness.replace('_', ' ')} "
            f"(score {primary_score:.0f}/100) — prioritise this above everything else this month."
        )
    if _get_score(profile, "tactics") < 60:
        notes.append(
            "Tactics below 60 — do the warm-up puzzles every day BEFORE any other exercise."
        )
    if _get_score(profile, "time_management") < 50:
        notes.append(
            "Time management issues — always play with a clock. "
            "Never use unlimited time in practice games."
        )
    if raw.get("bad_bvn_trades", 0) > 1:
        notes.append(
            f"{raw['bad_bvn_trades']} poor Bishop vs Knight trades detected. "
            "Rule: bishops prefer open positions (few pawns), knights prefer closed ones."
        )
    if raw.get("blunder_clusters", 0) > 0:
        notes.append(
            f"{raw['blunder_clusters']} blunder cluster(s) found — after any mistake, "
            "stop, breathe, re-scan the whole board before your next move."
        )
    if endgame_profile:
        cats = endgame_profile.get("categories", {})
        weakest_cat = endgame_profile.get("weakest_category")
        collapses = endgame_profile.get("collapse_count", 0)
        mental = endgame_profile.get("mental_patterns", {})
        if weakest_cat and weakest_cat in cats:
            cat_data = cats[weakest_cat]
            label = cat_data.get("label", weakest_cat)
            conv = cat_data.get("conversion_rate")
            conv_str = f" ({round(conv * 100)}% conversion)" if conv is not None else ""
            notes.append(
                f"Your weakest endgame category is {label}{conv_str}. "
                "Drills this week are targeted specifically at this area."
            )
        if collapses > 0:
            top_pattern = max(mental.items(), key=lambda x: x[1], default=(None, 0))[0]
            pattern_desc = {
                "rushing_when_winning": "rushing when you have a winning advantage",
                "loss_of_focus_after_mistake": "losing focus after a mistake",
                "overcomplication": "overcomplicating winning positions",
            }.get(top_pattern, "mental pressure in endgames")
            notes.append(
                f"{collapses} endgame collapse(s) detected — primarily caused by {pattern_desc}. "
                "Conversion drills are included to address this directly."
            )
    elif raw.get("endgame_blunders", 0) > 0 or _get_score(profile, "endgame") < 55:
        notes.append(
            "Endgame technique is weak. Start with De la Villa '100 Endgames You Must Know' "
            "and lichess.org/practice → Endgame — 15 minutes daily, every day."
        )

    return TrainingPlan(
        weeks=weeks,
        primary_weakness=primary_weakness,
        secondary_weakness=secondary_weakness,
        notes=notes,
        total_hours=round(total_hours, 1),
    )


def plan_to_dict(plan: TrainingPlan) -> dict:
    def task_dict(t: Task) -> dict:
        return {
            "label": t.label,
            "duration_min": t.duration_min,
            "category": t.category,
            "instructions": t.instructions,
        }

    def session_dict(s: DailySession) -> dict:
        return {
            "day": s.day,
            "tasks": [task_dict(t) for t in s.tasks],
            "estimated_minutes": s.estimated_minutes,
            "focus_areas": s.focus_areas,
        }

    def week_dict(w: Week) -> dict:
        return {
            "week_number": w.week_number,
            "theme": w.theme,
            "subtitle": w.subtitle,
            "daily_sessions": [session_dict(s) for s in w.daily_sessions],
            "total_minutes": w.total_minutes,
            "recommended_time_control": w.recommended_time_control,
        }

    return {
        "primary_weakness": plan.primary_weakness,
        "secondary_weakness": plan.secondary_weakness,
        "notes": plan.notes,
        "total_hours": plan.total_hours,
        "weeks": [week_dict(w) for w in plan.weeks],
    }
