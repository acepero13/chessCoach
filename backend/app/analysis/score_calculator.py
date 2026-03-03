"""
Deterministic computation of all 9 performance scores from game analyses.
All scores normalized to 0–100.

Design principles:
- Every metric is computed from user_evals only (never from game-level aggregates
  that mix both colors).
- No score can be permanently anchored near 0 due to a formula error.
- Single-game analyses produce meaningful scores (not just 0 or 100).
- Neutral (50) is returned only when there is genuinely no data.

Strategy sub-scores (K/M/S/P/BvN):
  K — King safety  : early castling timing (structural king shelter indicator)
  M — Material     : user-only avg centipawn loss (win-probability formula)
  S — Space        : strategic positional drift per game
  P — Pawn struct  : doubled/isolated pawns + weak squares created
  BvN              : bishop-vs-knight trade quality (from pattern detector)
"""
import math
from dataclasses import dataclass, field, asdict

# ---------------------------------------------------------------------------
# Lichess win-probability helpers
# ---------------------------------------------------------------------------

def _win_prob(cp_from_mover: float) -> float:
    """Win probability (0–100) for the mover given eval in centipawns."""
    return 50.0 + 50.0 * (2.0 / (1.0 + math.exp(-0.00368208 * cp_from_mover)) - 1.0)


def _move_accuracy(eval_before: float, eval_after: float) -> float:
    """
    Lichess-style move accuracy using win-probability change.
    Both eval_before and eval_after are from the mover's perspective (cp).
    Returns 0–100.
    """
    wp_loss = max(0.0, _win_prob(eval_before) - _win_prob(eval_after))
    return max(0.0, 103.1668 * math.exp(-0.04354 * wp_loss) - 3.1669)


def _is_endgame_from_fen(fen: str) -> bool:
    """
    Detect endgame by material, not move number.
    Counts pieces from the FEN position string — no chess library needed.
    Endgame: no queens remain, or at most 1 queen with very few pieces.
    More reliable than move_num >= 30 (some games enter endgame by move 20,
    others still have heavy pieces at move 40).
    """
    if not fen:
        return False
    pos = fen.split()[0]   # only the piece-placement field
    queens  = pos.count('Q') + pos.count('q')
    rooks   = pos.count('R') + pos.count('r')
    bishops = pos.count('B') + pos.count('b')
    knights = pos.count('N') + pos.count('n')
    major_minor = rooks + bishops + knights
    return queens == 0 or (queens == 1 and major_minor <= 4) or major_minor <= 3


# ---------------------------------------------------------------------------
# Raw metric buckets
# ---------------------------------------------------------------------------

@dataclass
class RawMetrics:
    # --- Attack ---
    attacking_moves_good: int = 0       # best/good moves in non-losing positions
    attacking_moves_total: int = 0      # all moves in non-losing positions
    avg_eval_gain_attacking: float = 0.0
    mate_threats_created: int = 0

    # --- Defense ---
    blunders_under_pressure: int = 0    # blunders when eval_before < -150
    mistakes_under_pressure: int = 0    # mistakes when eval_before < -150
    moves_under_pressure: int = 0       # all moves when eval_before < -150

    # --- Opening (accuracy of first 10 moves, Lichess win-prob formula) ---
    opening_accuracy_sum: float = 0.0
    games_with_opening: int = 0
    opening_mistakes: int = 0
    opening_moves_total: int = 0

    # --- Strategy — K (King safety): castling timing + never-castled penalty ---
    user_blunders: int = 0              # user's blunders (informational, not used in K)
    user_moves_total: int = 0           # user's total moves
    castling_early_games: int = 0       # games where user castled by move 15
    games_never_castled: int = 0        # games where user never castled at all

    # --- Strategy — M (Material): user-only centipawn loss ---
    user_cp_loss_sum: float = 0.0       # sum of user's cp losses

    # --- Strategy — S (Space): positional drift ---
    strategic_drifts: int = 0

    # --- Strategy — P (Pawn structure) ---
    pawn_structure_errors: int = 0      # doubled/isolated pawns created on mistakes
    weak_square_creations: int = 0      # new weak squares created on mistakes

    # --- Strategy — BvN (Bishop vs Knight trade quality) ---
    bvn_trades_total: int = 0           # total B×N or N×B trades detected
    bad_bvn_trades: int = 0             # trades that were positionally poor

    # --- Endgame ---
    endgame_winning_conversions: int = 0
    endgame_winning_total: int = 0
    endgame_blunders: int = 0
    endgame_moves_total: int = 0

    # --- Tactics (Lichess-style: user response after opponent blunder) ---
    tactical_moments_found: int = 0
    tactical_moments_missed: int = 0

    # --- Tactics (proactive: missed patterns + shots found by user) ---
    proactive_tactics_found: int = 0    # tactical_shot_found patterns
    proactive_tactics_missed: int = 0   # missed_fork/pin/checkmate/hanging patterns

    # --- Time management ---
    has_time_data: bool = False
    blunders_time_trouble: int = 0
    moves_time_trouble: int = 0

    # --- Conversion ---
    winning_games_converted: int = 0
    winning_games_total: int = 0
    blunders_while_winning: int = 0     # games (not moves) where user blundered while winning

    # --- Mental stability ---
    blunder_clusters: int = 0
    eval_collapses: int = 0

    games_analyzed: int = 0


def _clamp(value: float, lo: float = 0.0, hi: float = 100.0) -> float:
    return round(max(lo, min(hi, value)), 1)


# ---------------------------------------------------------------------------
# Individual score functions
# ---------------------------------------------------------------------------

def compute_attack_score(m: RawMetrics) -> float:
    """
    How well the player executes when they have the initiative.
    Combines: rate of good attacking moves + eval gain quality + mate threats.
    """
    if m.attacking_moves_total == 0:
        return 50.0

    execution_rate = m.attacking_moves_good / m.attacking_moves_total
    # Reduced from max 40 → max 20: eval gain is noisy and risks double-counting
    # with execution_rate (good moves raise both). Execution rate gets more weight.
    eval_quality = _clamp(m.avg_eval_gain_attacking / 4.0, 0, 20)  # 80cp avg → 20pts
    mate_bonus = min(10.0, m.mate_threats_created * 2.0)

    score = execution_rate * 70 + eval_quality + mate_bonus
    return _clamp(score)


def compute_defense_score(m: RawMetrics) -> float:
    """
    How well the player avoids errors when under real pressure (eval < -150cp).
    Blunders count fully; mistakes count at half weight (they still matter under pressure).
    """
    if m.moves_under_pressure == 0:
        return 50.0

    weighted_errors = m.blunders_under_pressure + 0.5 * m.mistakes_under_pressure
    weighted_error_rate = weighted_errors / m.moves_under_pressure
    score = (1.0 - weighted_error_rate) * 100
    return _clamp(score)


def compute_opening_score(m: RawMetrics) -> float:
    """
    Average accuracy of the user's first 10 moves using the Lichess
    win-probability formula per move. The win-prob formula already encodes
    both the frequency and severity of errors, so no separate mistake-rate
    component is needed.
    """
    if m.games_with_opening == 0:
        return 50.0

    return _clamp(m.opening_accuracy_sum / m.games_with_opening)


def compute_strategy_score(m: RawMetrics) -> float:
    """
    Strategy score: K + M + S + P + BvN composite.

    K — King safety   (25%): early castling timing (structural king shelter)
    M — Material      (30%): user-only avg centipawn loss (win-prob calibrated)
    S — Space         (20%): strategic positional drift events per game
    P — Pawn struct   (20%): pawn errors + weak square creations
    BvN               (5%) : bishop-vs-knight trade quality (neutral if no data)

    All sub-scores 0–100; weights sum to 1.0.
    """
    if m.games_analyzed == 0:
        return 50.0

    # K — King safety: early castling rewarded; never castling penalized.
    # Base 50 = neutral (late castlers who always castled get 50, which is fair —
    # delaying castling is sometimes correct). Never-castled games get a real penalty.
    castling_rate = m.castling_early_games / m.games_analyzed
    never_castled_rate = m.games_never_castled / m.games_analyzed
    k_score = _clamp(50.0 + castling_rate * 30.0 - never_castled_rate * 40.0)

    # M — Material (user-only avg cp loss)
    if m.user_moves_total > 0:
        user_avg_cp = m.user_cp_loss_sum / m.user_moves_total
        # Exponential decay: 0cp=100, 28cp≈65, 46cp≈50, 100cp≈22
        m_score = _clamp(100.0 * math.exp(-0.015 * user_avg_cp))
    else:
        m_score = 50.0

    # S — Space (positional drift): reduced penalty coefficient so dynamic/maneuvering
    # players aren't over-penalized. Drift threshold was also raised to 150cp in detector.
    drift_per_game = m.strategic_drifts / m.games_analyzed
    s_score = _clamp(100.0 - drift_per_game * 8.0)

    # P — Pawn structure + weak squares
    pawn_per_game = m.pawn_structure_errors / m.games_analyzed
    weak_per_game = m.weak_square_creations / m.games_analyzed
    pawn_score = _clamp(100.0 - pawn_per_game * 12.0)  # 0=100, ~8/game=0 (was *20, 0 at 5/game)
    weak_score = _clamp(100.0 - weak_per_game * 6.0)   # 0=100, ~16/game=0 (was *10, 0 at 10/game)
    p_score = _clamp(pawn_score * 0.6 + weak_score * 0.4)

    # BvN — Bishop vs Knight trade quality
    if m.bvn_trades_total > 0:
        bad_rate = m.bad_bvn_trades / m.bvn_trades_total
        bvn_score = _clamp((1.0 - bad_rate) * 100.0)
    else:
        bvn_score = 50.0  # neutral — no trades detected

    return _clamp(
        k_score   * 0.25
        + m_score * 0.30
        + s_score * 0.20
        + p_score * 0.20
        + bvn_score * 0.05
    )


def compute_endgame_score(m: RawMetrics) -> float:
    components = []

    if m.endgame_winning_total > 0:
        conv = m.endgame_winning_conversions / m.endgame_winning_total
        components.append(conv * 60)

    if m.endgame_moves_total > 0:
        blunder_rate = m.endgame_blunders / m.endgame_moves_total
        components.append((1 - blunder_rate) * 40)

    if not components:
        return 50.0

    return _clamp(sum(components))


def compute_tactics_score(m: RawMetrics) -> float:
    """
    Fraction of tactical moments handled correctly.
    A tactical moment = user's first move after the opponent blunders.

    Note: proactive patterns (missed_fork/pin/hanging from the detector) fire on too
    many positions where the user played a reasonable alternative, producing false-positive
    counts that swamp the signal. Opportunism alone is a cleaner, better-calibrated metric.
    """
    total = m.tactical_moments_found + m.tactical_moments_missed
    if total == 0:
        return 50.0

    return _clamp(m.tactical_moments_found / total * 100)


def compute_time_management_score(m: RawMetrics) -> float:
    if not m.has_time_data or m.moves_time_trouble == 0:
        return 50.0

    blunder_rate = m.blunders_time_trouble / m.moves_time_trouble
    return _clamp((1.0 - blunder_rate) * 100)


def compute_conversion_score(m: RawMetrics) -> float:
    if m.winning_games_total == 0:
        return 50.0

    conversion_rate = m.winning_games_converted / m.winning_games_total
    # blunders_while_winning is a per-game count (not per-move), so normalize by
    # winning_games_total to get a rate. This prevents longer games from being
    # penalized more just because they had more moves while winning.
    blunder_game_rate = m.blunders_while_winning / m.winning_games_total
    blunder_penalty = blunder_game_rate * 30.0   # 0% rate → +30 bonus, 100% → 0

    score = conversion_rate * 70 + (30 - blunder_penalty)
    return _clamp(score)


def compute_mental_stability_score(m: RawMetrics) -> float:
    if m.games_analyzed == 0:
        return 50.0

    cluster_per_game = m.blunder_clusters / m.games_analyzed
    collapse_per_game = m.eval_collapses / m.games_analyzed

    cluster_score = _clamp(100 - cluster_per_game * 40)
    collapse_score = _clamp(100 - collapse_per_game * 25)

    return _clamp(cluster_score * 0.5 + collapse_score * 0.5)


# ---------------------------------------------------------------------------
# Output dataclass
# ---------------------------------------------------------------------------

@dataclass
class PerformanceScores:
    attack: float = 50.0
    defense: float = 50.0
    opening: float = 50.0
    strategy: float = 50.0
    endgame: float = 50.0
    tactics: float = 50.0
    time_management: float = 50.0
    conversion: float = 50.0
    mental_stability: float = 50.0
    raw_metrics: dict = field(default_factory=dict)


# ---------------------------------------------------------------------------
# Main aggregation
# ---------------------------------------------------------------------------

def compute_all_scores(analyses: list[dict]) -> PerformanceScores:
    """
    Aggregate metrics across all game analyses and compute the 9 scores.

    Each analysis dict must contain:
    - move_evaluations : list of move eval dicts (see batch_analyzer / stockfish.py)
    - patterns_detected: list of pattern dicts
    - result           : "win" | "loss" | "draw"
    - user_color       : "white" | "black"  (falls back to eval-sign heuristic if missing)
    """
    m = RawMetrics()
    m.games_analyzed = len(analyses)

    for analysis in analyses:
        evals: list[dict] = analysis.get("move_evaluations", [])
        patterns: list[dict] = analysis.get("patterns_detected", [])
        result = analysis.get("result", "draw")

        # ----------------------------------------------------------------
        # Determine user color
        # ----------------------------------------------------------------
        user_color = analysis.get("user_color")
        if not user_color:
            if evals:
                final_eval = evals[-1].get("eval_after", 0)
                user_color = "white" if final_eval > 0 else "black"
            else:
                user_color = "white"

        # ----------------------------------------------------------------
        # Per-move metrics (user moves only)
        # ----------------------------------------------------------------
        user_evals = [e for e in evals if e.get("color") == user_color]

        castled_early = False   # per-game flag: castled by move 15
        castled_at_all = False  # per-game flag: castled at any point

        for e in user_evals:
            cp_loss    = e.get("centipawn_loss", 0.0)
            eval_before = e.get("eval_before", 0.0)
            eval_after  = e.get("eval_after", 0.0)
            cls        = e.get("classification", "good")
            move_san   = e.get("move_san", "")
            move_num   = e.get("move_number", 1)

            # Strategy — K: user-only blunder count and castling timing
            # Cap cp_loss at 500 for M-score to avoid mate evaluations (±10000cp)
            # skewing the material average. Classification still uses raw value.
            m.user_moves_total += 1
            m.user_cp_loss_sum += min(cp_loss, 500.0)
            if cls == "blunder":
                m.user_blunders += 1
            if move_san in ("O-O", "O-O-O"):
                castled_at_all = True
                if move_num <= 15 and not castled_early:
                    castled_early = True

            # Attack: positions where user has the initiative (equal or slightly worse)
            # Threshold -30 captures aggressive play from equal positions too;
            # the old threshold of +50 missed initiative in balanced games entirely.
            if eval_before > -30:
                m.attacking_moves_total += 1
                if cls in ("best", "good"):
                    m.attacking_moves_good += 1
                    gain = eval_after - eval_before
                    if gain > 0:
                        m.avg_eval_gain_attacking += gain
                if e.get("is_check") and cls in ("best", "good"):
                    m.mate_threats_created += 1

            # Defense: under real pressure (down by more than 1.5 pawns)
            if eval_before < -150:
                m.moves_under_pressure += 1
                if cls == "blunder":
                    m.blunders_under_pressure += 1
                elif cls == "mistake":
                    m.mistakes_under_pressure += 1

            # Opening: first 10 moves
            if move_num <= 10:
                m.opening_moves_total += 1
                if cls in ("mistake", "blunder"):
                    m.opening_mistakes += 1

            # Endgame: detected by material (piece count from FEN), not move number.
            # move_num >= 30 is unreliable: some games enter the endgame by move 20,
            # others still have heavy pieces on move 40.
            if _is_endgame_from_fen(e.get("fen", "")):
                m.endgame_moves_total += 1
                if cls == "blunder":
                    m.endgame_blunders += 1

            # Mental stability: large eval collapses
            if cp_loss > 250:
                m.eval_collapses += 1

        # Castling timing per game
        if castled_early:
            m.castling_early_games += 1
        if not castled_at_all:
            m.games_never_castled += 1

        # ----------------------------------------------------------------
        # Tactics: accuracy of user's response right after opponent blunders
        # ----------------------------------------------------------------
        opponent_color = "black" if user_color == "white" else "white"
        all_sorted = sorted(
            evals,
            key=lambda e: (e.get("move_number", 0), 0 if e.get("color") == "white" else 1)
        )
        for idx, ev in enumerate(all_sorted):
            if ev.get("color") != opponent_color:
                continue
            if ev.get("classification") != "blunder":
                continue
            user_response = next(
                (e for e in all_sorted[idx + 1:] if e.get("color") == user_color),
                None
            )
            if user_response is None:
                continue
            resp_cls = user_response.get("classification", "good")
            if resp_cls in ("best", "good"):
                m.tactical_moments_found += 1
            else:
                m.tactical_moments_missed += 1

        # ----------------------------------------------------------------
        # Patterns → strategy sub-scores (S, P, BvN)
        # ----------------------------------------------------------------
        for p in patterns:
            ptype = p.get("type", "")
            if ptype in ("pawn_structure_weakened", "isolated_pawn_created"):
                m.pawn_structure_errors += 1
            elif ptype == "weak_squares_created":
                m.weak_square_creations += 1
            elif ptype == "strategic_drift":
                m.strategic_drifts += 1
            elif ptype == "tactical_shot_found":
                m.proactive_tactics_found += 1
            elif ptype in ("missed_fork", "missed_pin", "missed_checkmate", "hanging_piece_missed"):
                m.proactive_tactics_missed += 1
            elif ptype in ("bishop_knight_trade_bad", "bishop_knight_trade_ok"):
                m.bvn_trades_total += 1
                if ptype == "bishop_knight_trade_bad":
                    m.bad_bvn_trades += 1

        # ----------------------------------------------------------------
        # Opening: per-game accuracy (Lichess win-prob formula)
        # ----------------------------------------------------------------
        opening_move_accs = [
            _move_accuracy(e.get("eval_before", 0.0), e.get("eval_after", 0.0))
            for e in user_evals
            if e.get("move_number", 0) <= 10
        ]
        if opening_move_accs:
            m.opening_accuracy_sum += sum(opening_move_accs) / len(opening_move_accs)
            m.games_with_opening += 1

        # ----------------------------------------------------------------
        # Conversion: games where user had a winning advantage (any phase)
        # ----------------------------------------------------------------
        winning_moves = [e for e in user_evals if e.get("eval_before", 0) > 200]
        if winning_moves:
            m.winning_games_total += 1
            if result == "win":
                m.winning_games_converted += 1
            # Count per game (binary), not per move — prevents longer games being
            # penalized more just because they had more moves while winning.
            if any(e.get("classification") == "blunder" for e in winning_moves):
                m.blunders_while_winning += 1

        # ----------------------------------------------------------------
        # Endgame: winning positions specifically in the endgame (material-based)
        # ----------------------------------------------------------------
        endgame_winning_moves = [
            e for e in user_evals
            if e.get("eval_before", 0) > 200 and _is_endgame_from_fen(e.get("fen", ""))
        ]
        if endgame_winning_moves:
            m.endgame_winning_total += 1
            if result == "win":
                m.endgame_winning_conversions += 1

        # ----------------------------------------------------------------
        # Mental stability: blunder clusters (2+ blunders in 3-move window)
        # Non-overlapping: skip past each detected cluster to avoid double-counting.
        # ----------------------------------------------------------------
        ci = 0
        while ci < len(user_evals) - 2:
            window = user_evals[ci:ci + 3]
            if sum(1 for e in window if e.get("classification") == "blunder") >= 2:
                m.blunder_clusters += 1
                ci += 3  # jump past this cluster
            else:
                ci += 1

    # Normalize accumulated sums
    if m.attacking_moves_good > 0:
        m.avg_eval_gain_attacking /= m.attacking_moves_good

    return PerformanceScores(
        attack=compute_attack_score(m),
        defense=compute_defense_score(m),
        opening=compute_opening_score(m),
        strategy=compute_strategy_score(m),
        endgame=compute_endgame_score(m),
        tactics=compute_tactics_score(m),
        time_management=compute_time_management_score(m),
        conversion=compute_conversion_score(m),
        mental_stability=compute_mental_stability_score(m),
        raw_metrics=asdict(m),
    )
