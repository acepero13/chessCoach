"""
Performance profile computation and retrieval.
"""
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.database import get_db
from app.models import Game, GameAnalysis, PerformanceProfile, AnalysisStatus
from app.analysis.score_calculator import compute_all_scores
from app.analysis.game_selector import select_critical_games
from app.schemas.profile import PerformanceScoresResponse, ProfileSummary
from app.llm.explainer import generate_pattern_tip, explain_single_tactic

def _compute_archetype(scores: dict) -> str:
    """Determine player archetype from performance scores. Fully deterministic."""
    t = scores.get("tactics", 50)
    ms = scores.get("mental_stability", 50)
    d = scores.get("defense", 50)
    a = scores.get("attack", 50)
    o = scores.get("opening", 50)
    s = scores.get("strategy", 50)
    e = scores.get("endgame", 50)
    c = scores.get("conversion", 50)

    if ms < 40:
        return "Unstable Under Pressure"
    if t > 65 and ms < 50:
        return "Tactical but Impulsive"
    if d > 65 and a < 45:
        return "Solid but Passive"
    if o > 70 and (s + e) / 2 < 50:
        return "Strong Opening, Weak Conversion"
    if t > 60 and c < 50:
        return "Good Calculator, Poor Converter"
    if a > 65 and d < 45:
        return "Attacking but Defensively Fragile"
    if all(v >= 60 for v in scores.values()):
        return "Well-Rounded"
    weakest = min(scores, key=lambda k: scores[k])
    labels = {
        "tactics": "Tactical Vision",
        "strategy": "Strategic Understanding",
        "endgame": "Endgame Technique",
        "opening": "Opening Knowledge",
        "mental_stability": "Mental Resilience",
        "conversion": "Conversion Skills",
        "attack": "Attacking Play",
        "defense": "Defensive Play",
        "time_management": "Time Management",
    }
    return f"Developing {labels.get(weakest, weakest.replace('_', ' ').title())}"


def _compute_traits(scores: dict, pattern_counts: dict, total_games: int) -> list[str]:
    """Compute behavioral traits from scores and pattern frequencies."""
    traits = []
    n = max(total_games, 1)

    def rate(k):
        return pattern_counts.get(k, 0) / n

    if rate("hanging_piece_missed") > 0.25 or rate("missed_fork") > 0.2:
        traits.append("Threat-blind")
    if scores.get("mental_stability", 50) < 45:
        traits.append("Tilts under pressure")
    if scores.get("attack", 50) > 65 and scores.get("conversion", 50) < 50:
        traits.append("Over-aggressive")
    if scores.get("defense", 50) > 65 and scores.get("attack", 50) < 45:
        traits.append("Solid but passive")
    if scores.get("endgame", 50) < 45:
        traits.append("Endgame weakness")
    if scores.get("opening", 50) > 70:
        traits.append("Opening strength")
    if scores.get("defense", 50) > 70:
        traits.append("Reliable defender")
    if scores.get("tactics", 50) > 70:
        traits.append("Tactically sharp")
    if scores.get("strategy", 50) > 70:
        traits.append("Positionally aware")

    return traits[:5]


def _compute_opponent_segments(games_list, analyses_list) -> dict:
    """
    Segment game performance by opponent relative strength.
    Returns {"weaker": {...}, "equal": {...}, "stronger": {...}}.
    """
    game_map = {g.id: g for g in games_list}
    segments: dict[str, list] = {"weaker": [], "equal": [], "stronger": []}

    for a in analyses_list:
        g = game_map.get(a.game_id)
        if not g:
            continue
        user_elo = g.white_elo if g.user_color == "white" else g.black_elo
        opp_elo = g.black_elo if g.user_color == "white" else g.white_elo
        if not user_elo or not opp_elo:
            continue

        diff = opp_elo - user_elo
        seg = "weaker" if diff < -200 else "stronger" if diff > 200 else "equal"

        evals = a.move_evaluations or []
        user_evals = [e for e in evals if e.get("color") == g.user_color]
        blunders = sum(1 for e in user_evals if e.get("classification") == "blunder")
        avg_cp = (
            sum(min(e.get("centipawn_loss", 0), 500) for e in user_evals) / max(len(user_evals), 1)
        ) if user_evals else 0

        segments[seg].append({
            "won": g.result.value == "win" if g.result else False,
            "blunders": blunders,
            "avg_cp_loss": avg_cp,
        })

    result = {}
    for seg_name, seg_games in segments.items():
        n = len(seg_games)
        if not n:
            continue
        result[seg_name] = {
            "games": n,
            "win_rate": round(sum(1 for g in seg_games if g["won"]) / n * 100),
            "avg_cp_loss": round(sum(g["avg_cp_loss"] for g in seg_games) / n),
            "avg_blunders": round(sum(g["blunders"] for g in seg_games) / n, 1),
        }
    return result


router = APIRouter(prefix="/profile", tags=["profile"])


@router.post("/{user_id}/compute")
async def compute_profile(user_id: int, db: AsyncSession = Depends(get_db)):
    """
    Compute (or recompute) performance profile from all analyzed games.
    """
    # Fetch all completed analyses for user's games
    games_result = await db.execute(
        select(Game).where(Game.user_id == user_id)
    )
    games = games_result.scalars().all()
    game_ids = [g.id for g in games]

    if not game_ids:
        raise HTTPException(status_code=404, detail="No games found for user")

    analyses_result = await db.execute(
        select(GameAnalysis).where(
            GameAnalysis.game_id.in_(game_ids),
            GameAnalysis.status == AnalysisStatus.complete,
        )
    )
    analyses = analyses_result.scalars().all()

    if not analyses:
        raise HTTPException(status_code=400, detail="No completed analyses found. Run batch analysis first.")

    game_result_map = {g.id: g.result.value if g.result else "draw" for g in games}
    game_color_map = {g.id: g.user_color for g in games}

    analysis_dicts = []
    for a in analyses:
        d = {
            "game_id": a.game_id,
            "move_evaluations": a.move_evaluations or [],
            "patterns_detected": a.patterns_detected or [],
            "blunder_count": a.blunder_count or 0,
            "mistake_count": a.mistake_count or 0,
            "centipawn_loss_avg": a.centipawn_loss_avg or 0.0,
            "accuracy": a.accuracy or 0.0,
            "result": game_result_map.get(a.game_id, "draw"),
            "user_color": game_color_map.get(a.game_id, "white"),
        }
        analysis_dicts.append(d)

    scores = compute_all_scores(analysis_dicts)

    # Save profile
    profile = PerformanceProfile(
        user_id=user_id,
        games_analyzed=len(analyses),
        attack_score=scores.attack,
        defense_score=scores.defense,
        opening_score=scores.opening,
        strategy_score=scores.strategy,
        endgame_score=scores.endgame,
        tactics_score=scores.tactics,
        time_management_score=scores.time_management,
        conversion_score=scores.conversion,
        mental_stability_score=scores.mental_stability,
        raw_metrics=scores.raw_metrics,
    )
    db.add(profile)
    await db.commit()
    await db.refresh(profile)

    return {
        "profile_id": profile.id,
        "games_analyzed": len(analyses),
        "scores": {
            "attack": scores.attack,
            "defense": scores.defense,
            "opening": scores.opening,
            "strategy": scores.strategy,
            "endgame": scores.endgame,
            "tactics": scores.tactics,
            "time_management": scores.time_management,
            "conversion": scores.conversion,
            "mental_stability": scores.mental_stability,
        }
    }


@router.get("/{user_id}/latest", response_model=PerformanceScoresResponse)
async def get_latest_profile(user_id: int, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(PerformanceProfile)
        .where(PerformanceProfile.user_id == user_id)
        .order_by(PerformanceProfile.created_at.desc())
        .limit(1)
    )
    profile = result.scalar_one_or_none()
    if not profile:
        raise HTTPException(status_code=404, detail="No profile found. Run batch analysis first.")
    return profile


@router.get("/{user_id}/history")
async def get_profile_history(user_id: int, db: AsyncSession = Depends(get_db)):
    """Return all profile snapshots for a user, oldest first (for trend charts)."""
    result = await db.execute(
        select(PerformanceProfile)
        .where(PerformanceProfile.user_id == user_id)
        .order_by(PerformanceProfile.created_at.asc())
    )
    profiles = result.scalars().all()
    return [
        {
            "id": p.id,
            "created_at": p.created_at.isoformat() if p.created_at else None,
            "games_analyzed": p.games_analyzed,
            "attack": p.attack_score,
            "defense": p.defense_score,
            "opening": p.opening_score,
            "strategy": p.strategy_score,
            "endgame": p.endgame_score,
            "tactics": p.tactics_score,
            "time_management": p.time_management_score,
            "conversion": p.conversion_score,
            "mental_stability": p.mental_stability_score,
        }
        for p in profiles
    ]


SCORE_FIELDS = [
    ("attack", "attack_score"),
    ("defense", "defense_score"),
    ("opening", "opening_score"),
    ("strategy", "strategy_score"),
    ("endgame", "endgame_score"),
    ("tactics", "tactics_score"),
    ("time_management", "time_management_score"),
    ("conversion", "conversion_score"),
    ("mental_stability", "mental_stability_score"),
]

NEGATIVE_PATTERNS = {
    "fork", "pin", "hanging_piece_missed", "missed_checkmate",
    "missed_fork", "missed_pin", "pawn_structure_weakened",
    "isolated_pawn_created", "weak_squares_created", "strategic_drift",
    "bishop_knight_trade_bad",
}


@router.get("/{user_id}/progress")
async def get_progress(user_id: int, db: AsyncSession = Depends(get_db)):
    """
    Compare the two most recent profiles and return score deltas and
    top recurring negative patterns (with per-game counts).
    """
    # ── Last 2 profiles ──────────────────────────────────────────────
    profiles_result = await db.execute(
        select(PerformanceProfile)
        .where(PerformanceProfile.user_id == user_id)
        .order_by(PerformanceProfile.created_at.desc())
        .limit(2)
    )
    profiles = profiles_result.scalars().all()

    deltas = {}
    biggest_improvement = None
    biggest_decline = None

    if len(profiles) >= 2:
        current, previous = profiles[0], profiles[1]
        for key, col in SCORE_FIELDS:
            d = round(getattr(current, col) - getattr(previous, col), 1)
            deltas[key] = d
        if deltas:
            best_key = max(deltas, key=lambda k: deltas[k])
            worst_key = min(deltas, key=lambda k: deltas[k])
            if deltas[best_key] > 0:
                biggest_improvement = {"score": best_key, "delta": deltas[best_key]}
            if deltas[worst_key] < 0:
                biggest_decline = {"score": worst_key, "delta": deltas[worst_key]}

    # ── Recurring negative patterns with per-game counts ─────────────
    games_result = await db.execute(select(Game).where(Game.user_id == user_id))
    games = games_result.scalars().all()
    game_ids = [g.id for g in games]
    game_color_map = {g.id: g.user_color for g in games}

    pattern_game_counts: dict[str, int] = {}
    total_games = 0

    if game_ids:
        analyses_result = await db.execute(
            select(GameAnalysis).where(
                GameAnalysis.game_id.in_(game_ids),
                GameAnalysis.status == AnalysisStatus.complete,
            )
        )
        analyses = analyses_result.scalars().all()
        total_games = len(analyses)

        for a in analyses:
            user_color = game_color_map.get(a.game_id, "white")
            seen_in_game: set[str] = set()
            for p in (a.patterns_detected or []):
                if p.get("color") == user_color:
                    ptype = p.get("type", "unknown")
                    if ptype in NEGATIVE_PATTERNS and ptype not in seen_in_game:
                        seen_in_game.add(ptype)
                        pattern_game_counts[ptype] = pattern_game_counts.get(ptype, 0) + 1

    recurring = sorted(
        [
            {
                "type": k,
                "games": v,
                "pct": round(v / total_games * 100) if total_games else 0,
            }
            for k, v in pattern_game_counts.items()
        ],
        key=lambda x: -x["games"],
    )[:5]

    return {
        "has_previous": len(profiles) >= 2,
        "deltas": deltas,
        "biggest_improvement": biggest_improvement,
        "biggest_decline": biggest_decline,
        "recurring_patterns": recurring,
        "total_games": total_games,
    }


@router.get("/{user_id}/pattern-stats")
async def get_pattern_stats(user_id: int, db: AsyncSession = Depends(get_db)):
    """Aggregate user-side pattern counts across all analyzed games."""
    games_result = await db.execute(select(Game).where(Game.user_id == user_id))
    games = games_result.scalars().all()
    game_ids = [g.id for g in games]

    if not game_ids:
        return {"patterns": [], "total_games": 0}

    analyses_result = await db.execute(
        select(GameAnalysis).where(
            GameAnalysis.game_id.in_(game_ids),
            GameAnalysis.status == AnalysisStatus.complete,
        )
    )
    analyses = analyses_result.scalars().all()
    game_color_map = {g.id: g.user_color for g in games}

    pattern_counts: dict[str, int] = {}
    for a in analyses:
        user_color = game_color_map.get(a.game_id, "white")
        for p in (a.patterns_detected or []):
            if p.get("color") == user_color:
                ptype = p.get("type", "unknown")
                pattern_counts[ptype] = pattern_counts.get(ptype, 0) + 1

    patterns = sorted(
        [{"type": k, "count": v} for k, v in pattern_counts.items()],
        key=lambda x: -x["count"],
    )
    return {"patterns": patterns, "total_games": len(analyses)}


@router.get("/{user_id}/select-games")
async def select_games_for_coaching(
    user_id: int,
    n: int = 7,
    db: AsyncSession = Depends(get_db),
):
    """Select the most instructive games for a coaching session."""
    # Get latest profile
    profile_result = await db.execute(
        select(PerformanceProfile)
        .where(PerformanceProfile.user_id == user_id)
        .order_by(PerformanceProfile.created_at.desc())
        .limit(1)
    )
    profile = profile_result.scalar_one_or_none()
    if not profile:
        raise HTTPException(status_code=404, detail="Profile not found. Run analysis first.")

    profile_scores = {
        "attack_score": profile.attack_score,
        "defense_score": profile.defense_score,
        "opening_score": profile.opening_score,
        "strategy_score": profile.strategy_score,
        "endgame_score": profile.endgame_score,
        "tactics_score": profile.tactics_score,
        "time_management_score": profile.time_management_score,
        "conversion_score": profile.conversion_score,
        "mental_stability_score": profile.mental_stability_score,
    }

    # Get all analyses
    games_result = await db.execute(
        select(Game).where(Game.user_id == user_id)
    )
    games = games_result.scalars().all()
    game_ids = [g.id for g in games]

    analyses_result = await db.execute(
        select(GameAnalysis).where(
            GameAnalysis.game_id.in_(game_ids),
            GameAnalysis.status == AnalysisStatus.complete,
        )
    )
    analyses = analyses_result.scalars().all()

    game_map = {g.id: g for g in games}
    analysis_dicts = [
        {
            "game_id": a.game_id,
            "move_evaluations": a.move_evaluations or [],
            "patterns_detected": a.patterns_detected or [],
            "blunder_count": a.blunder_count or 0,
            "centipawn_loss_avg": a.centipawn_loss_avg or 0.0,
            "result": game_map[a.game_id].result.value if game_map[a.game_id].result else "draw",
            "user_color": game_map[a.game_id].user_color or "white",
        }
        for a in analyses if a.game_id in game_map
    ]

    selected = select_critical_games(profile_scores, analysis_dicts, n=n)

    return {
        "selected_games": [
            {
                "game_id": gs.game_id,
                "relevance_score": gs.relevance_score,
                "weaknesses_manifested": gs.weaknesses_manifested,
                "centipawn_loss_avg": gs.centipawn_loss_avg,
                "blunder_count": gs.blunder_count,
            }
            for gs in selected
        ]
    }


def _compute_tactic_explanation(fen: str, best_move_uci: str, pattern_type: str, user_color: str) -> str:
    """
    Deterministically describe WHERE the tactic is for a given pattern.
    Returns a concrete sentence e.g. "After g6, the pawn attacks the knight on f5 and the bishop on h5."
    """
    import chess
    if not fen or not best_move_uci:
        return ""
    try:
        board = chess.Board(fen)
        move = chess.Move.from_uci(best_move_uci)
        color = chess.WHITE if user_color == "white" else chess.BLACK
        piece = board.piece_at(move.from_square)
        if piece is None:
            return ""
        piece_name = chess.piece_name(piece.piece_type)
        best_san = board.san(move)

        test = board.copy()
        test.push(move)
        landing = move.to_square

        if pattern_type in ("missed_fork", "fork"):
            attacked = []
            for sq in chess.SQUARES:
                p = test.piece_at(sq)
                if (
                    p and p.color != color
                    and p.piece_type in (chess.QUEEN, chess.ROOK, chess.BISHOP, chess.KNIGHT, chess.KING)
                    and bool(test.attacks(landing) & chess.BB_SQUARES[sq])
                ):
                    attacked.append(f"{chess.piece_name(p.piece_type)} on {chess.square_name(sq)}")
            if len(attacked) >= 2:
                targets = " and the ".join(attacked)
                return f"After {best_san}, the {piece_name} simultaneously attacks the {targets}."
            elif len(attacked) == 1:
                return f"After {best_san}, the {piece_name} attacks the {attacked[0]}."

        elif pattern_type in ("missed_pin", "pin"):
            for sq in chess.SQUARES:
                p = test.piece_at(sq)
                if p and p.color != color and test.is_pinned(not color, sq):
                    king_sq = test.king(not color)
                    return (
                        f"After {best_san}, the {chess.piece_name(p.piece_type)} on "
                        f"{chess.square_name(sq)} is pinned to the king on {chess.square_name(king_sq)}."
                    )

        elif pattern_type == "hanging_piece_missed":
            target = board.piece_at(move.to_square)
            if target:
                return (
                    f"The {chess.piece_name(target.piece_type)} on {chess.square_name(move.to_square)} "
                    f"was undefended — {best_san} wins it for free."
                )

        elif pattern_type == "missed_checkmate":
            return f"{best_san} delivers checkmate immediately."

    except Exception:
        pass
    return ""


def _hanging_squares(fen: str, user_color: str) -> list[str]:
    """
    Return algebraic names of opponent squares that are hanging
    (can be profitably captured by user_color).
    Only minor pieces and above (value >= 3).
    """
    import chess
    from app.patterns.tactical_detectors import _is_hanging, PIECE_VALUES
    try:
        board = chess.Board(fen)
        # Make it user_color's turn so _is_hanging evaluates from their perspective
        color = chess.WHITE if user_color == "white" else chess.BLACK
        board.turn = color
        squares = []
        opponent = not color
        for sq in chess.SQUARES:
            piece = board.piece_at(sq)
            if (
                piece
                and piece.color == opponent
                and PIECE_VALUES.get(piece.piece_type, 0) >= 3
                and _is_hanging(board, sq)
            ):
                squares.append(chess.square_name(sq))
        return squares
    except Exception:
        return []


@router.get("/{user_id}/pattern-drill")
async def get_pattern_drill(
    user_id: int,
    pattern_type: str = Query(...),
    db: AsyncSession = Depends(get_db),
):
    """
    Return all positions (FEN + engine best move) where the user exhibited
    a specific pattern type. Sorted by severity descending.
    """
    games_result = await db.execute(select(Game).where(Game.user_id == user_id))
    games = games_result.scalars().all()
    game_ids = [g.id for g in games]
    game_color_map = {g.id: g.user_color for g in games}

    if not game_ids:
        return {"positions": [], "pattern_type": pattern_type}

    analyses_result = await db.execute(
        select(GameAnalysis).where(
            GameAnalysis.game_id.in_(game_ids),
            GameAnalysis.status == AnalysisStatus.complete,
        )
    )
    analyses = analyses_result.scalars().all()

    positions = []
    for a in analyses:
        user_color = game_color_map.get(a.game_id, "white")
        raw_evals = a.move_evaluations or []
        stored_patterns = a.patterns_detected or []

        # Build eval lookup by (move_number, color) for enrichment
        eval_by_move: dict[tuple[int, str], dict] = {
            (e["move_number"], e["color"]): e
            for e in raw_evals
            if "move_number" in e and "color" in e
        }

        # Use stored patterns — these are what the progress/count endpoints use,
        # so the positions returned here always match the game counts shown in the UI.
        for p in stored_patterns:
            if p.get("type") != pattern_type:
                continue
            if p.get("color") != user_color:
                continue

            move_num = p.get("move_number")
            ev = eval_by_move.get((move_num, user_color), {})
            fen = p.get("fen", "")
            best_uci = ev.get("best_move_uci", "")

            reveal_squares: list[str] = []
            if pattern_type in ("hanging_piece_missed", "missed_fork", "missed_pin", "fork", "pin"):
                reveal_squares = _hanging_squares(fen, user_color)

            positions.append({
                "game_id": a.game_id,
                "move_number": move_num,
                "fen": fen,
                "user_move_san": p.get("move_san", "?"),
                "best_move_san": ev.get("best_move_san", "?"),
                "best_move_uci": best_uci,
                "centipawn_loss": round(ev.get("centipawn_loss", 0)),
                "description": p.get("description", ""),
                "severity": p.get("severity", 0.0),
                "user_color": user_color,
                "reveal_squares": reveal_squares,
                "tactic_explanation": _compute_tactic_explanation(fen, best_uci, pattern_type, user_color),
                "engine_pv_san": ev.get("pv_san", [])[:4],
            })

    positions.sort(key=lambda x: -x["severity"])
    return {"positions": positions, "pattern_type": pattern_type}


class PatternTipRequest(BaseModel):
    pattern_type: str
    sample_positions: list[dict]


@router.post("/{user_id}/pattern-tip")
async def get_pattern_tip(user_id: int, body: PatternTipRequest):
    """Ask the LLM for practical tips on how to spot/avoid a recurring pattern."""
    tip = await generate_pattern_tip(body.pattern_type, body.sample_positions)
    return {"tip": tip or "LLM unavailable — try again later."}


class PatternExplainRequest(BaseModel):
    pattern_type: str
    user_move_san: str
    best_move_san: str
    engine_pv_san: list[str] = []
    tactic_explanation: str = ""
    centipawn_loss: float = 0.0


@router.post("/{user_id}/pattern-explain")
async def get_pattern_explain(user_id: int, body: PatternExplainRequest):
    """Ask the LLM to explain a single tactic position concretely."""
    explanation = await explain_single_tactic(
        pattern_type=body.pattern_type,
        user_move_san=body.user_move_san,
        best_move_san=body.best_move_san,
        engine_pv_san=body.engine_pv_san,
        tactic_explanation=body.tactic_explanation,
        centipawn_loss=body.centipawn_loss,
    )
    return {"explanation": explanation or "LLM unavailable — try again later."}


@router.get("/{user_id}/cognitive-profile")
async def get_cognitive_profile(user_id: int, db: AsyncSession = Depends(get_db)):
    """Return deterministic player archetype and traits from latest profile."""
    profile_result = await db.execute(
        select(PerformanceProfile)
        .where(PerformanceProfile.user_id == user_id)
        .order_by(PerformanceProfile.created_at.desc())
        .limit(1)
    )
    profile = profile_result.scalar_one_or_none()
    if not profile:
        raise HTTPException(status_code=404, detail="No profile found.")

    scores = {
        "attack": profile.attack_score,
        "defense": profile.defense_score,
        "opening": profile.opening_score,
        "strategy": profile.strategy_score,
        "endgame": profile.endgame_score,
        "tactics": profile.tactics_score,
        "time_management": profile.time_management_score,
        "conversion": profile.conversion_score,
        "mental_stability": profile.mental_stability_score,
    }

    # Collect pattern counts from raw_metrics if stored, else query
    raw = profile.raw_metrics or {}
    pattern_counts = raw.get("pattern_counts", {})
    total_games = profile.games_analyzed or 1

    archetype = _compute_archetype(scores)
    traits = _compute_traits(scores, pattern_counts, total_games)

    return {
        "archetype": archetype,
        "traits": traits,
        "scores": scores,
        "games_analyzed": total_games,
    }


@router.get("/{user_id}/opponent-profile")
async def get_opponent_profile(user_id: int, db: AsyncSession = Depends(get_db)):
    """Return performance segmented by opponent strength (weaker/equal/stronger)."""
    games_result = await db.execute(select(Game).where(Game.user_id == user_id))
    games = games_result.scalars().all()
    game_ids = [g.id for g in games]

    if not game_ids:
        return {"segments": {}, "has_elo_data": False}

    analyses_result = await db.execute(
        select(GameAnalysis).where(
            GameAnalysis.game_id.in_(game_ids),
            GameAnalysis.status == AnalysisStatus.complete,
        )
    )
    analyses = analyses_result.scalars().all()

    segments = _compute_opponent_segments(games, analyses)
    has_elo = any(
        (g.white_elo and g.black_elo) for g in games
    )
    return {"segments": segments, "has_elo_data": has_elo}


@router.get("/{user_id}/trends")
async def get_trends(user_id: int, db: AsyncSession = Depends(get_db)):
    """
    Compare pattern frequency in last 10 games vs previous 10 games.
    Returns trend direction (improving/worsening/stable) per pattern.
    """
    games_result = await db.execute(
        select(Game).where(Game.user_id == user_id).order_by(Game.played_at.asc(), Game.id.asc())
    )
    games = games_result.scalars().all()
    game_ids = [g.id for g in games]

    if not game_ids:
        return {"trends": [], "recent_games": 0, "previous_games": 0}

    analyses_result = await db.execute(
        select(GameAnalysis).where(
            GameAnalysis.game_id.in_(game_ids),
            GameAnalysis.status == AnalysisStatus.complete,
        )
    )
    analyses = analyses_result.scalars().all()
    analysis_map = {a.game_id: a for a in analyses}

    # Build sorted list of (game, analysis) pairs
    pairs = [
        (g, analysis_map[g.id])
        for g in games
        if g.id in analysis_map
    ]

    n = len(pairs)
    recent_pairs = pairs[-10:]
    previous_pairs = pairs[max(0, n - 20):-10] if n > 10 else []

    def pattern_rate(game_analysis_pairs):
        counts: dict[str, int] = {}
        total = len(game_analysis_pairs)
        if not total:
            return {}, total
        for g, a in game_analysis_pairs:
            user_color = g.user_color
            seen: set[str] = set()
            for p in (a.patterns_detected or []):
                if p.get("color") == user_color:
                    ptype = p.get("type", "")
                    if ptype and ptype not in seen:
                        seen.add(ptype)
                        counts[ptype] = counts.get(ptype, 0) + 1
        return {k: v / total for k, v in counts.items()}, total

    recent_rates, n_recent = pattern_rate(recent_pairs)
    prev_rates, n_prev = pattern_rate(previous_pairs)

    all_patterns = set(recent_rates) | set(prev_rates)
    trend_list = []
    for pt in all_patterns:
        r = recent_rates.get(pt, 0.0)
        p = prev_rates.get(pt, 0.0)
        change = r - p
        # Skip very rare patterns
        if r < 0.05 and abs(change) < 0.05:
            continue
        if change < -0.08:
            trend = "improving"
        elif change > 0.08:
            trend = "worsening"
        else:
            trend = "stable"
        trend_list.append({
            "type": pt,
            "recent_rate": round(r, 2),
            "previous_rate": round(p, 2),
            "trend": trend,
            "change": round(change, 2),
        })

    trend_list.sort(key=lambda x: -x["recent_rate"])
    return {
        "trends": trend_list[:10],
        "recent_games": n_recent,
        "previous_games": n_prev,
    }
