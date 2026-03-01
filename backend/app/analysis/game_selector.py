"""
Game selection algorithm: pick 5–8 critical games based on user's weakest performance areas.
"""
from dataclasses import dataclass


DOMAIN_PATTERN_MAP = {
    "tactics": ["missed_fork", "missed_pin", "hanging_piece_missed", "missed_checkmate", "blunder_hanging"],
    "strategy": ["pawn_structure_weakened", "isolated_pawn_created", "weak_squares_created", "strategic_drift"],
    "endgame": [],       # Endgame detected via move_number + eval, not patterns
    "opening": [],       # Opening detected via move_number
    "attack": ["tactical_shot_found"],
    "defense": [],
    "conversion": [],
    "mental_stability": ["blunder_clusters"],
}

SCORE_FIELDS = {
    "attack": "attack_score",
    "defense": "defense_score",
    "opening": "opening_score",
    "strategy": "strategy_score",
    "endgame": "endgame_score",
    "tactics": "tactics_score",
    "time_management": "time_management_score",
    "conversion": "conversion_score",
    "mental_stability": "mental_stability_score",
}


@dataclass
class GameScore:
    game_id: int
    relevance_score: float
    weaknesses_manifested: list[str]
    centipawn_loss_avg: float
    blunder_count: int


def select_critical_games(
    profile_scores: dict,
    game_analyses: list[dict],
    n: int = 7,
) -> list[GameScore]:
    """
    Select the most instructive games based on the user's weakest areas.

    profile_scores: dict with keys matching SCORE_FIELDS values
    game_analyses: list of dicts with game_id, patterns_detected, centipawn_loss_avg,
                   blunder_count, mistake_count, move_evaluations
    n: number of games to select (5–8)
    """
    # Identify the 2 weakest domains
    domain_scores = {
        domain: profile_scores.get(field, 50.0)
        for domain, field in SCORE_FIELDS.items()
    }
    sorted_domains = sorted(domain_scores.items(), key=lambda x: x[1])
    weakest_domains = [d for d, _ in sorted_domains[:3]]
    weak_patterns = set()
    for domain in weakest_domains:
        weak_patterns.update(DOMAIN_PATTERN_MAP.get(domain, []))

    scored_games: list[GameScore] = []

    for ga in game_analyses:
        patterns = ga.get("patterns_detected", [])
        pattern_types = [p["type"] for p in patterns]
        evals = ga.get("move_evaluations", [])
        blunders = ga.get("blunder_count", 0)
        avg_loss = ga.get("centipawn_loss_avg", 0.0)

        relevance = 0.0
        manifested = []

        # Score for weak-domain patterns present
        for ptype in pattern_types:
            if ptype in weak_patterns:
                relevant_pattern = next((p for p in patterns if p["type"] == ptype), None)
                if relevant_pattern:
                    relevance += relevant_pattern.get("severity", 0.3) * 30
                    if ptype not in manifested:
                        manifested.append(ptype)

        # Endgame weakness: check if game had endgame positions
        if "endgame" in weakest_domains:
            endgame_moves = [e for e in evals if e["move_number"] >= 30]
            endgame_blunders = sum(1 for e in endgame_moves if e["classification"] == "blunder")
            if endgame_blunders > 0:
                relevance += endgame_blunders * 10
                manifested.append("endgame_blunder")

        # Opening weakness: mistakes in first 10 moves
        if "opening" in weakest_domains:
            opening_mistakes = [
                e for e in evals
                if e["move_number"] <= 10 and e["classification"] in ("mistake", "blunder")
            ]
            if opening_mistakes:
                relevance += len(opening_mistakes) * 12
                manifested.append("opening_mistake")

        # Conversion weakness: had winning position but didn't convert
        if "conversion" in weakest_domains:
            had_winning = any(e["eval_before"] > 200 for e in evals)
            result = ga.get("result", "")
            if had_winning and result != "win":
                relevance += 25
                manifested.append("conversion_failure")

        # Boost high-blunder, high-loss games as instructive
        relevance += min(20.0, blunders * 5.0)
        relevance += min(10.0, avg_loss / 20.0)

        if relevance > 0:
            scored_games.append(GameScore(
                game_id=ga["game_id"],
                relevance_score=round(relevance, 2),
                weaknesses_manifested=manifested,
                centipawn_loss_avg=avg_loss,
                blunder_count=blunders,
            ))

    # Sort by relevance descending, pick top n
    scored_games.sort(key=lambda x: x.relevance_score, reverse=True)
    return scored_games[:n]
