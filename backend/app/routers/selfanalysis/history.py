"""
Session retrieval endpoints: latest session for a game, and user session list.
"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, desc

from app.database import get_db
from app.models import Game, GameAnalysis, AnnotationSession
from .utils import _build_all_game_moves

router = APIRouter()


@router.get("/game/{game_id}/latest-session")
async def get_latest_session_for_game(
    game_id: int,
    db: AsyncSession = Depends(get_db),
):
    """
    Return the latest annotation session for a game, with full state for resuming.
    Raises 404 if no session exists yet.
    """
    session_result = await db.execute(
        select(AnnotationSession)
        .where(AnnotationSession.game_id == game_id)
        .order_by(desc(AnnotationSession.started_at))
        .limit(1)
    )
    session = session_result.scalar_one_or_none()
    if not session:
        raise HTTPException(status_code=404, detail="No session found for this game")

    game_result = await db.execute(select(Game).where(Game.id == game_id))
    game = game_result.scalar_one_or_none()
    if not game:
        raise HTTPException(status_code=404, detail="Game not found")

    analysis_result = await db.execute(
        select(GameAnalysis).where(GameAnalysis.game_id == game_id)
    )
    analysis = analysis_result.scalar_one_or_none()

    # Reconstruct all game moves from the full analysis
    all_game_moves = []
    user_color = game.user_color
    if analysis and analysis.status.value == "complete":
        evals = analysis.move_evaluations or []
        all_game_moves, _ = _build_all_game_moves(evals, user_color)

    total_user_moves = len(session.focused_move_indices or [])
    suggested_minutes_per_move = round(
        session.time_budget_minutes / max(1, total_user_moves), 1
    )
    moves_data = session.moves_data or []
    # Only count truly submitted (non-draft) entries as annotated
    annotated_move_indices = [m["move_index"] for m in moves_data if not m.get("draft", False)]

    return {
        "session_id": session.id,
        "game_id": game_id,
        "completed": session.completed,
        "white_player": game.white_player,
        "black_player": game.black_player,
        "user_color": user_color,
        "game_result": game.result.value if game.result else None,
        "time_budget_minutes": session.time_budget_minutes,
        "suggested_minutes_per_move": suggested_minutes_per_move,
        "total_user_moves": total_user_moves,
        "all_game_moves": all_game_moves,
        "annotated_move_indices": annotated_move_indices,
        "moves_data": moves_data,
        "reflection": session.reflection,
        "game_feelings": session.game_feelings,
        "questionnaire_coaching": session.questionnaire_coaching,
    }


@router.get("/user/{user_id}/sessions")
async def list_user_sessions(
    user_id: int,
    db: AsyncSession = Depends(get_db),
):
    """
    List all annotation sessions for a user, newest first.
    Returns summary cards suitable for a history view.
    """
    sessions_result = await db.execute(
        select(AnnotationSession)
        .where(AnnotationSession.user_id == user_id)
        .order_by(desc(AnnotationSession.started_at))
    )
    sessions = sessions_result.scalars().all()

    items = []
    for s in sessions:
        game_result = await db.execute(select(Game).where(Game.id == s.game_id))
        game = game_result.scalar_one_or_none()
        if not game:
            continue

        moves_data = s.moves_data or []
        submitted = [m for m in moves_data if not m.get("draft", False)]
        reflection = s.reflection or {}

        pattern_counts: dict[str, int] = {}
        for m in submitted:
            for p in (m.get("patterns") or []):
                ptype = p.get("type", "")
                if ptype:
                    pattern_counts[ptype] = pattern_counts.get(ptype, 0) + 1

        items.append({
            "session_id": s.id,
            "game_id": s.game_id,
            "white_player": game.white_player,
            "black_player": game.black_player,
            "user_color": game.user_color,
            "game_result": game.result.value if game.result else None,
            "completed": s.completed,
            "started_at": s.started_at.isoformat() if s.started_at else None,
            "completed_at": s.completed_at.isoformat() if s.completed_at else None,
            "moves_reviewed": len(submitted),
            "total_user_moves": len(s.focused_move_indices or []),
            "eval_accuracy_score": reflection.get("eval_accuracy_score"),
            "candidate_quality_score": reflection.get("candidate_quality_score"),
            "tactical_awareness_score": reflection.get("tactical_awareness_score"),
            "confidence_calibration_score": reflection.get("confidence_calibration_score"),
            "top_patterns": sorted(pattern_counts.items(), key=lambda x: -x[1])[:3],
        })

    return {"sessions": items, "total": len(items)}
