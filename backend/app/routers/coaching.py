"""
Interactive coaching session endpoints.
"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from pydantic import BaseModel
from typing import Optional

from app.database import get_db
from app.models import Game, GameAnalysis, CoachingSession, PerformanceProfile
from app.llm.explainer import explain_mistake, generate_position_question
from app.engine.stockfish import get_engine

router = APIRouter(prefix="/coaching", tags=["coaching"])


class StartSessionRequest(BaseModel):
    user_id: int
    game_id: int


class AnswerRequest(BaseModel):
    user_answer: str


@router.post("/session/start")
async def start_coaching_session(
    req: StartSessionRequest,
    db: AsyncSession = Depends(get_db),
):
    """Start a new coaching session for a game."""
    # Verify game and analysis exist
    game_result = await db.execute(select(Game).where(Game.id == req.game_id))
    game = game_result.scalar_one_or_none()
    if not game:
        raise HTTPException(status_code=404, detail="Game not found")

    analysis_result = await db.execute(
        select(GameAnalysis).where(GameAnalysis.game_id == req.game_id)
    )
    analysis = analysis_result.scalar_one_or_none()
    if not analysis or analysis.status.value != "complete":
        raise HTTPException(status_code=400, detail="Game not yet analyzed")

    # Find critical moves — only the user's mistakes and blunders
    evals = analysis.move_evaluations or []
    user_color = game.user_color  # "white" or "black"
    critical_indices = [
        i for i, e in enumerate(evals)
        if e["classification"] in ("mistake", "blunder")
        and e.get("color") == user_color
    ]

    if not critical_indices:
        return {"message": "No critical moves found in this game", "session_id": None}

    # Create session
    session = CoachingSession(
        user_id=req.user_id,
        game_id=req.game_id,
        current_move_index=0,
        interactions=[],
    )
    db.add(session)
    await db.commit()
    await db.refresh(session)

    # Get first critical move
    first_idx = critical_indices[0]
    move_eval = evals[first_idx]
    patterns_at_move = [
        p for p in (analysis.patterns_detected or [])
        if p.get("move_number") == move_eval["move_number"]
    ]

    question_data = await generate_position_question(
        fen=move_eval["fen"],
        pattern_type=patterns_at_move[0]["type"] if patterns_at_move else "general",
        move_number=move_eval["move_number"],
        color=move_eval["color"],
    )

    return {
        "session_id": session.id,
        "total_critical_moves": len(critical_indices),
        "current_position": {
            "fen": move_eval["fen"],
            "move_number": move_eval["move_number"],
            "color": move_eval["color"],
            "eval_before": move_eval["eval_before"],
            "white_player": game.white_player,
            "black_player": game.black_player,
            "user_color": game.user_color,
        },
        "question": question_data["question"],
        "hint": question_data["hint"],
        "question_type": question_data["question_type"],
        "hide_evaluation": True,
    }


@router.post("/session/{session_id}/answer")
async def submit_answer(
    session_id: int,
    req: AnswerRequest,
    db: AsyncSession = Depends(get_db),
):
    """Submit the user's answer and get the coaching explanation."""
    session_result = await db.execute(
        select(CoachingSession).where(CoachingSession.id == session_id)
    )
    session = session_result.scalar_one_or_none()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    if session.completed:
        return {"message": "Session already completed"}

    # Get analysis and game (needed for user_color and player names)
    analysis_result = await db.execute(
        select(GameAnalysis).where(GameAnalysis.game_id == session.game_id)
    )
    analysis = analysis_result.scalar_one_or_none()
    evals = analysis.move_evaluations or []

    game_result = await db.execute(select(Game).where(Game.id == session.game_id))
    game = game_result.scalar_one_or_none()
    user_color = game.user_color if game else "white"

    critical_indices = [
        i for i, e in enumerate(evals)
        if e["classification"] in ("mistake", "blunder")
        and e.get("color") == user_color
    ]

    current_idx = session.current_move_index
    if current_idx >= len(critical_indices):
        session.completed = True
        await db.commit()
        return {"message": "All critical positions reviewed!", "completed": True}

    move_eval = evals[critical_indices[current_idx]]
    patterns_at_move = [
        p for p in (analysis.patterns_detected or [])
        if p.get("move_number") == move_eval["move_number"]
    ]

    # Get engine best move details
    engine = await get_engine()
    engine_info = await engine.get_best_move(move_eval["fen"])
    pv_moves = engine_info.get("pv", [])[:5]

    user_elo = game.white_elo if user_color == "white" else game.black_elo
    user_rating = user_elo or 1200

    # Generate explanation
    explanation = await explain_mistake(
        move_san=move_eval["move_san"],
        best_move_san=move_eval["best_move_san"],
        fen=move_eval["fen"],
        centipawn_loss=move_eval["centipawn_loss"],
        classification=move_eval["classification"],
        patterns=patterns_at_move,
        engine_pv=pv_moves,
        user_rating=user_rating,
    )

    # Save interaction
    interaction = {
        "move_index": critical_indices[current_idx],
        "move_san": move_eval["move_san"],
        "user_answer": req.user_answer,
        "engine_best": move_eval["best_move_san"],
        "centipawn_loss": move_eval["centipawn_loss"],
        "classification": move_eval["classification"],
        "explanation": explanation,
        "patterns": patterns_at_move,
    }
    interactions = list(session.interactions or [])
    interactions.append(interaction)
    session.interactions = interactions
    session.current_move_index = current_idx + 1

    # Check if session complete
    is_complete = session.current_move_index >= len(critical_indices)
    session.completed = is_complete

    await db.commit()

    # Prepare next position if not complete
    next_position = None
    next_question = None
    if not is_complete:
        next_idx = critical_indices[session.current_move_index]
        next_eval = evals[next_idx]
        next_patterns = [
            p for p in (analysis.patterns_detected or [])
            if p.get("move_number") == next_eval["move_number"]
        ]
        next_question_data = await generate_position_question(
            fen=next_eval["fen"],
            pattern_type=next_patterns[0]["type"] if next_patterns else "general",
            move_number=next_eval["move_number"],
            color=next_eval["color"],
        )
        next_position = {
            "fen": next_eval["fen"],
            "move_number": next_eval["move_number"],
            "color": next_eval["color"],
            "eval_before": next_eval["eval_before"],
            "white_player": game.white_player,
            "black_player": game.black_player,
            "user_color": game.user_color,
        }
        next_question = next_question_data

    return {
        "explanation": explanation,
        "engine_best_move": move_eval["best_move_san"],
        "eval_swing": move_eval["centipawn_loss"],
        "classification": move_eval["classification"],
        "patterns_detected": patterns_at_move,
        "engine_line": pv_moves,
        "completed": is_complete,
        "next_position": next_position,
        "next_question": next_question,
        "progress": {
            "reviewed": current_idx + 1,
            "total": len(critical_indices),
        }
    }


@router.get("/session/{session_id}")
async def get_session(session_id: int, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(CoachingSession).where(CoachingSession.id == session_id)
    )
    session = result.scalar_one_or_none()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    return {
        "session_id": session.id,
        "game_id": session.game_id,
        "completed": session.completed,
        "current_move_index": session.current_move_index,
        "interactions_count": len(session.interactions or []),
    }
