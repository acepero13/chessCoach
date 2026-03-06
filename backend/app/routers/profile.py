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
from app.engine.stockfish import MoveEval
from app.patterns.tactical_detectors import detect_tactical_patterns
from app.patterns.strategic_detectors import detect_strategic_patterns

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
        if not raw_evals:
            continue

        # Re-run pattern detection fresh from stored move_evaluations.
        # Stored patterns_detected may be stale from older (buggy) detection code.
        # This is pure Python — no engine calls — so it's fast.
        move_evals = [
            MoveEval(
                fen=e["fen"], move_uci=e["move_uci"], move_san=e["move_san"],
                eval_before=e["eval_before"], eval_after=e["eval_after"],
                best_move_uci=e["best_move_uci"], best_move_san=e["best_move_san"],
                eval_best=e["eval_best"], centipawn_loss=e["centipawn_loss"],
                classification=e["classification"], is_capture=e["is_capture"],
                is_check=e["is_check"], move_number=e["move_number"], color=e["color"],
            )
            for e in raw_evals
            if all(k in e for k in ("fen", "move_uci", "move_san", "eval_before",
                                    "eval_after", "best_move_uci", "best_move_san",
                                    "eval_best", "centipawn_loss", "classification",
                                    "is_capture", "is_check", "move_number", "color"))
        ]

        fresh_patterns = detect_tactical_patterns(move_evals) + detect_strategic_patterns(move_evals)

        # Build eval lookup by (move_number, color) to avoid fullmove_number collision
        eval_by_move: dict[tuple[int, str], dict] = {
            (e["move_number"], e["color"]): e
            for e in raw_evals
            if "move_number" in e and "color" in e
        }

        for p in fresh_patterns:
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
