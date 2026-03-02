"""
Interactive coaching session endpoints.
"""
import chess
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from pydantic import BaseModel
from typing import Optional

from app.database import get_db
from app.models import Game, GameAnalysis, CoachingSession, PerformanceProfile
from app.llm.explainer import explain_mistake, generate_position_question, generate_session_summary
from app.engine.stockfish import get_engine
from app.patterns.tactical_detectors import _is_hanging


def _pv_uci_to_san(fen: str, pv_uci: list[str]) -> list[str]:
    """Convert a UCI principal variation to SAN notation from the given FEN."""
    board = chess.Board(fen)
    san_moves = []
    for uci in pv_uci:
        try:
            move = chess.Move.from_uci(uci)
            san_moves.append(board.san(move))
            board.push(move)
        except Exception:
            break
    return san_moves


def _validated_patterns(
    all_patterns: list[dict],
    move_number: int,
    fen: str,
    best_move_uci: str,
) -> list[dict]:
    """
    Return patterns for a move, filtering out stale false positives from old analyses.
    Specifically: 'hanging_piece_missed' is suppressed when the engine's best move is
    not actually a capture of a hanging piece.
    """
    result = []
    for p in all_patterns:
        if p.get("move_number") != move_number:
            continue
        if p.get("type") == "hanging_piece_missed" and best_move_uci:
            try:
                board = chess.Board(fen)
                bm = chess.Move.from_uci(best_move_uci)
                if not (board.is_capture(bm) and _is_hanging(board, bm.to_square)):
                    continue  # suppress stale false positive
            except Exception:
                pass
        result.append(p)
    return result

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

    # Build session summary from aggregated game data
    critical_evals = [evals[i] for i in critical_indices]
    total_mistakes = sum(1 for e in critical_evals if e["classification"] == "mistake")
    total_blunders = sum(1 for e in critical_evals if e["classification"] == "blunder")
    worst_move = max(critical_evals, key=lambda e: e.get("centipawn_loss", 0), default=None)
    worst_move_summary = (
        {
            "move_san": worst_move["move_san"],
            "centipawn_loss": worst_move["centipawn_loss"],
            "classification": worst_move["classification"],
        }
        if worst_move else None
    )
    # Collect top pattern types from this game
    all_patterns = analysis.patterns_detected or []
    user_pattern_types = [
        p["type"] for p in all_patterns if p.get("color") == user_color
    ]
    pattern_counts: dict[str, int] = {}
    for pt in user_pattern_types:
        pattern_counts[pt] = pattern_counts.get(pt, 0) + 1
    top_patterns = [pt for pt, _ in sorted(pattern_counts.items(), key=lambda x: x[1], reverse=True)[:3]]

    opponent = game.black_player if user_color == "white" else game.white_player
    session_summary = await generate_session_summary(
        user_color=user_color,
        opponent=opponent or "opponent",
        result=game.result or "unknown",
        total_mistakes=total_mistakes,
        total_blunders=total_blunders,
        top_pattern_types=top_patterns,
        worst_move=worst_move_summary,
    )

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
    patterns_at_move = _validated_patterns(
        analysis.patterns_detected or [],
        move_eval["move_number"],
        move_eval["fen"],
        move_eval.get("best_move_uci", ""),
    )

    question_data = await generate_position_question(
        fen=move_eval["fen"],
        pattern_type=patterns_at_move[0]["type"] if patterns_at_move else "general",
        move_number=move_eval["move_number"],
        color=move_eval["color"],
        best_move_san=move_eval.get("best_move_san", ""),
        centipawn_loss=move_eval.get("centipawn_loss", 0.0),
        classification=move_eval.get("classification", "mistake"),
    )

    return {
        "session_id": session.id,
        "session_summary": session_summary,
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

    # Get engine best move details and convert PV to SAN for the LLM
    engine = await get_engine()
    engine_info = await engine.get_best_move(move_eval["fen"])
    pv_uci = engine_info.get("pv", [])[:5]
    pv_san = _pv_uci_to_san(move_eval["fen"], pv_uci)

    # Validate stored patterns — filter out stale false positives from old analyses
    best_move_uci = engine_info.get("best_move_uci") or move_eval.get("best_move_uci", "")
    patterns_at_move = _validated_patterns(
        analysis.patterns_detected or [],
        move_eval["move_number"],
        move_eval["fen"],
        best_move_uci,
    )

    user_elo = game.white_elo if user_color == "white" else game.black_elo
    user_rating = user_elo or 1200

    # Try to parse the student's typed answer as a legal chess move and evaluate it
    student_move_san = ""
    student_cp_loss = None
    student_classification = ""
    fen = move_eval["fen"]
    board = chess.Board(fen)
    student_move_obj = None

    raw_answer = req.user_answer.strip()
    # Try SAN first, then UCI
    for parser in (board.parse_san, chess.Move.from_uci):
        try:
            candidate = parser(raw_answer)
            if candidate in board.legal_moves:
                student_move_obj = candidate
                break
        except Exception:
            pass

    if student_move_obj:
        student_move_san = board.san(student_move_obj)
        eval_result = await engine.evaluate_move(
            fen=fen,
            move_uci=student_move_obj.uci(),
            eval_before=move_eval.get("eval_before"),
        )
        student_cp_loss = eval_result["centipawn_loss"]
        student_classification = eval_result["classification"]

    # Generate explanation — includes LLM assessment of user's written reasoning
    explanation = await explain_mistake(
        move_san=move_eval["move_san"],
        best_move_san=move_eval["best_move_san"],
        fen=fen,
        centipawn_loss=move_eval["centipawn_loss"],
        classification=move_eval["classification"],
        patterns=patterns_at_move,
        engine_pv_san=pv_san,
        user_rating=user_rating,
        student_move_san=student_move_san,
        student_cp_loss=student_cp_loss,
        student_classification=student_classification,
        user_answer_text=req.user_answer,
    )

    # Save interaction
    interaction = {
        "move_index": critical_indices[current_idx],
        "move_san": move_eval["move_san"],
        "user_answer": req.user_answer,
        "student_move_san": student_move_san,
        "student_cp_loss": student_cp_loss,
        "student_classification": student_classification,
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
        next_patterns = _validated_patterns(
            analysis.patterns_detected or [],
            next_eval["move_number"],
            next_eval["fen"],
            next_eval.get("best_move_uci", ""),
        )
        next_question_data = await generate_position_question(
            fen=next_eval["fen"],
            pattern_type=next_patterns[0]["type"] if next_patterns else "general",
            move_number=next_eval["move_number"],
            color=next_eval["color"],
            best_move_san=next_eval.get("best_move_san", ""),
            centipawn_loss=next_eval.get("centipawn_loss", 0.0),
            classification=next_eval.get("classification", "mistake"),
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
        # User's original written answer (for display in the reveal panel)
        "user_answer_text": req.user_answer,
        # Game move (what was actually played)
        "game_move": move_eval["move_san"],
        "eval_swing": move_eval["centipawn_loss"],
        "classification": move_eval["classification"],
        # Student's typed suggestion (if it was a legal move)
        "student_move": student_move_san or None,
        "student_cp_loss": student_cp_loss,
        "student_classification": student_classification or None,
        # Engine
        "engine_best_move": move_eval["best_move_san"],
        "engine_line": pv_san,
        "patterns_detected": patterns_at_move,
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
