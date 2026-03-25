"""
Endgame phase detection, category classification, and performance analysis.

Reuses _is_endgame_from_fen() logic from score_calculator (FEN string counting,
no chess library required — keeps this module fast and dependency-free).
"""
from __future__ import annotations
import math
from typing import Optional

# ---------------------------------------------------------------------------
# Phase detection (mirrors score_calculator._is_endgame_from_fen)
# ---------------------------------------------------------------------------

def _is_endgame(fen: str) -> bool:
    if not fen:
        return False
    pos = fen.split()[0]
    queens      = pos.count('Q') + pos.count('q')
    rooks       = pos.count('R') + pos.count('r')
    bishops     = pos.count('B') + pos.count('b')
    knights     = pos.count('N') + pos.count('n')
    major_minor = rooks + bishops + knights
    return queens == 0 or (queens == 1 and major_minor <= 4) or major_minor <= 3


def _classify_category(fen: str) -> str:
    """Return structural endgame category from FEN piece placement."""
    if not fen:
        return "mixed"
    pos = fen.split()[0]
    has_q = 'Q' in pos or 'q' in pos
    has_r = 'R' in pos or 'r' in pos
    has_b = 'B' in pos or 'b' in pos
    has_n = 'N' in pos or 'n' in pos
    if has_q:
        return "queen"
    if has_r:
        return "rook"
    if has_b or has_n:
        return "minor_piece"
    return "king_pawn"


CATEGORY_LABELS = {
    "king_pawn":    "King & Pawn",
    "rook":         "Rook Endgames",
    "minor_piece":  "Minor Piece",
    "queen":        "Queen Endgames",
}

MENTAL_PATTERN_LABELS = {
    "rushing_when_winning":      "Rushing when winning",
    "loss_of_focus_after_mistake": "Loss of focus after mistake",
    "overcomplication":          "Overcomplication",
}

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _user_won(result) -> Optional[bool]:
    """
    GameResult enum is already from user's perspective:
      win → True, loss → False, draw/unknown → None
    """
    # Accept both enum values and raw strings
    val = result.value if hasattr(result, "value") else str(result)
    if val == "win":
        return True
    if val == "loss":
        return False
    return None  # draw


def _stdev(values: list[float]) -> float:
    if len(values) < 2:
        return 0.0
    mean = sum(values) / len(values)
    return math.sqrt(sum((x - mean) ** 2 for x in values) / len(values))


def _category_score(avg_cpl: float, blunder_rate: float, conversion_rate: Optional[float]) -> float:
    """Produce a 0-100 score for a category."""
    cpl_score       = max(0.0, 100.0 - avg_cpl * 0.5)
    blunder_penalty = blunder_rate * 400.0   # 25 % blunder rate → -100
    conv_bonus      = (conversion_rate if conversion_rate is not None else 0.5) * 30.0
    return round(max(0.0, min(100.0, cpl_score - blunder_penalty + conv_bonus - 15.0)), 1)


# ---------------------------------------------------------------------------
# Collapse detection
# ---------------------------------------------------------------------------

def _detect_collapse(
    moves: list[dict],
    user_color: str,
    endgame_set: set[int],
) -> Optional[dict]:
    """Return first collapse event found in the game's endgame, or None."""

    # User's endgame moves in order (index, move_dict)
    user_eg = [(i, m) for i, m in enumerate(moves)
               if i in endgame_set and m.get("color") == user_color]
    if len(user_eg) < 3:
        return None

    # --- Signal 1: eval drop from +2 to ≤ 0 within 5 user moves ---
    for j, (_, m) in enumerate(user_eg):
        # eval_before is from mover's POV; for user's own moves this equals user POV
        eval_u = m.get("eval_before", 0)
        if eval_u >= 200:
            future = user_eg[j + 1: j + 6]
            for _, fm in future:
                if fm.get("eval_before", 0) <= 0:
                    # Collapse — classify mental pattern
                    errors = sum(
                        1 for _, wm in user_eg[j: j + 6]
                        if wm.get("classification") in ("blunder", "mistake")
                    )
                    pattern = "rushing_when_winning" if errors >= 2 else "overcomplication"
                    return {
                        "type": "conversion_failure",
                        "pattern": pattern,
                        "move_number": m.get("move_number"),
                        "eval_peak": round(eval_u / 100, 2),
                    }

    # --- Signal 2: blunder cluster — 2+ errors in 5-move window ---
    eg_all = [(i, m) for i, m in enumerate(moves) if i in endgame_set]
    for j in range(max(0, len(eg_all) - 4)):
        window = eg_all[j: j + 5]
        user_errors = [
            m for _, m in window
            if m.get("color") == user_color
            and m.get("classification") in ("blunder", "mistake")
        ]
        if len(user_errors) >= 2:
            user_cls = [m.get("classification") for m in user_errors]
            consecutive = any(
                user_cls[k] == "blunder" and user_cls[k + 1] in ("blunder", "mistake")
                for k in range(len(user_cls) - 1)
            )
            pattern = "loss_of_focus_after_mistake" if consecutive else "rushing_when_winning"
            start_move = eg_all[j][1].get("move_number")
            return {
                "type":         "blunder_cluster",
                "pattern":      pattern,
                "move_number":  start_move,
                "eval_peak":    None,
            }

    return None


# ---------------------------------------------------------------------------
# Main analysis entry point
# ---------------------------------------------------------------------------

def analyze_endgame_performance(games_data: list[dict]) -> dict:
    """
    Analyze endgame performance across all analyzed games.

    Each element of games_data must contain:
      - result        : GameResult enum (win/loss/draw) or string
      - user_color    : "white" | "black"
      - move_evaluations : list[dict] from batch_analyzer

    Returns a full endgame profile dict.
    """
    # Per-category accumulators
    cat_acc: dict[str, dict] = {
        cat: {
            "game_ids":       set(),
            "cpl_list":       [],
            "blunders":       0,
            "user_moves":     0,
            "winning_outcomes": [],   # True/False/None per game that had ≥+2 pos
            "worse_outcomes":   [],   # True/False/None per game that had ≤-1.5 pos
            "collapse_count": 0,
        }
        for cat in CATEGORY_LABELS
    }

    collapses: list[dict] = []
    mental_patterns: dict[str, int] = {k: 0 for k in MENTAL_PATTERN_LABELS}
    total_endgame_games = 0

    for game_idx, game in enumerate(games_data):
        user_color = game.get("user_color", "white")
        moves: list[dict] = game.get("move_evaluations") or []
        if not moves:
            continue

        # Find endgame moves
        eg_indices = {i for i, m in enumerate(moves) if _is_endgame(m.get("fen", ""))}
        if not eg_indices:
            continue

        total_endgame_games += 1
        outcome = _user_won(game.get("result"))

        # Primary category = first endgame FEN
        first_idx = min(eg_indices)
        cat = _classify_category(moves[first_idx].get("fen", ""))
        if cat not in cat_acc:
            cat = "rook"  # fallback

        # User's endgame moves only
        user_eg_moves = [m for i, m in enumerate(moves)
                         if i in eg_indices and m.get("color") == user_color]
        if not user_eg_moves:
            continue

        cpl_list = [min(m.get("centipawn_loss", 0), 500) for m in user_eg_moves]
        blunders = sum(1 for m in user_eg_moves if m.get("classification") == "blunder")

        # Eval from user POV (for user's own moves, eval_before is already from their POV)
        user_evals = [m.get("eval_before", 0) for m in user_eg_moves]
        had_winning = any(e >= 200 for e in user_evals)
        had_worse   = any(e <= -150 for e in user_evals)

        acc = cat_acc[cat]
        acc["game_ids"].add(game_idx)
        acc["cpl_list"].extend(cpl_list)
        acc["blunders"] += blunders
        acc["user_moves"] += len(user_eg_moves)
        if had_winning:
            acc["winning_outcomes"].append(outcome)
        if had_worse:
            acc["worse_outcomes"].append(outcome)

        # Collapse detection
        collapse = _detect_collapse(moves, user_color, eg_indices)
        if collapse:
            collapses.append({**collapse, "category": cat})
            acc["collapse_count"] += 1
            pat = collapse.get("pattern")
            if pat in mental_patterns:
                mental_patterns[pat] += 1

    # Build per-category summary
    categories: dict[str, dict] = {}
    for cat, acc in cat_acc.items():
        n_games = len(acc["game_ids"])
        if n_games == 0:
            continue

        avg_cpl      = sum(acc["cpl_list"]) / len(acc["cpl_list"]) if acc["cpl_list"] else 0.0
        blunder_rate = acc["blunders"] / acc["user_moves"] if acc["user_moves"] > 0 else 0.0

        winning = [x for x in acc["winning_outcomes"] if x is not None]
        conv_rate = (sum(1 for w in winning if w) / len(winning)) if winning else None

        worse = acc["worse_outcomes"]
        hold_rate = (sum(1 for w in worse if w is not False) / len(worse)) if worse else None

        categories[cat] = {
            "label":           CATEGORY_LABELS[cat],
            "games":           n_games,
            "avg_cpl":         round(avg_cpl, 1),
            "blunder_rate":    round(blunder_rate, 3),
            "conversion_rate": round(conv_rate, 2) if conv_rate is not None else None,
            "holding_rate":    round(hold_rate, 2)  if hold_rate is not None else None,
            "collapse_count":  acc["collapse_count"],
            "score":           _category_score(avg_cpl, blunder_rate, conv_rate),
        }

    scored = [(cat, v["score"]) for cat, v in categories.items()]
    weakest = min(scored, key=lambda x: x[1])[0] if scored else None
    best    = max(scored, key=lambda x: x[1])[0] if scored else None

    return {
        "total_endgame_games":   total_endgame_games,
        "total_games_analyzed":  len(games_data),
        "categories":            categories,
        "weakest_category":      weakest,
        "best_category":         best,
        "collapses":             collapses[:20],
        "collapse_count":        len(collapses),
        "mental_patterns":       mental_patterns,
    }
