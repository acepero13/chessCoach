"""
Calculation Drills — opponent response training from user's own game mistakes.

Drill flow:
  1. Position is set AFTER the user's blunder/mistake — opponent is to move.
  2. User predicts opponent's best reply, then their own reply, etc. (2–4 plies).
  3. On reveal: user's line is compared move-by-move against the engine.
"""
import chess
from datetime import datetime, timedelta
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from pydantic import BaseModel
from typing import Optional

from app.database import get_db
from app.models import Game, GameAnalysis, DrillResult
from app.engine.stockfish import get_engine

router = APIRouter(prefix="/drills", tags=["drills"])


def _fen_after_move(fen: str, move_uci: str) -> str | None:
    try:
        board = chess.Board(fen)
        move = chess.Move.from_uci(move_uci)
        if move not in board.legal_moves:
            return None
        board.push(move)
        return board.fen()
    except Exception:
        return None


@router.get("/{user_id}/positions")
async def get_drill_positions(
    user_id: int,
    include_mistakes: bool = False,
    limit: int = 10,
    db: AsyncSession = Depends(get_db),
):
    """
    Return drill positions from the user's analyzed games.
    Each position is AFTER the user's blunder/mistake — the opponent is to move.
    Deduplicates by post-move FEN to avoid identical positions from transpositions.
    """
    games_result = await db.execute(select(Game).where(Game.user_id == user_id))
    games = games_result.scalars().all()

    positions = []
    seen_fens: set[str] = set()

    for game in games:
        analysis_result = await db.execute(
            select(GameAnalysis).where(GameAnalysis.game_id == game.id)
        )
        analysis = analysis_result.scalar_one_or_none()
        if not analysis or analysis.status.value != "complete":
            continue

        evals = analysis.move_evaluations or []
        user_color = game.user_color

        for i, e in enumerate(evals):
            if e.get("color") != user_color:
                continue
            cls = e.get("classification", "")
            if cls != "blunder" and not (include_mistakes and cls == "mistake"):
                continue
            if not e.get("move_uci"):
                continue
            if e.get("centipawn_loss", 0) < 50:
                continue

            fen_after = _fen_after_move(e["fen"], e["move_uci"])
            if not fen_after or fen_after in seen_fens:
                continue
            seen_fens.add(fen_after)

            positions.append({
                "game_id": game.id,
                "move_index": i,
                "fen_before": e["fen"],
                "move_san": e.get("move_san", ""),
                "move_uci": e["move_uci"],
                "fen_after": fen_after,
                "classification": cls,
                "centipawn_loss": round(e.get("centipawn_loss", 0)),
                "move_number": e.get("move_number", 0),
                "user_color": user_color,
                "opponent_color": "black" if user_color == "white" else "white",
                "white_player": game.white_player or "White",
                "black_player": game.black_player or "Black",
                "result": str(game.result.value) if game.result else "?",
            })
            if len(positions) >= limit:
                break
        if len(positions) >= limit:
            break

    return {"positions": positions, "total": len(positions)}


class ApplyMoveRequest(BaseModel):
    fen: str
    move_uci: str   # e.g. "e2e4" or "e7e8q" for promotion


@router.post("/apply-move")
async def apply_move(req: ApplyMoveRequest):
    """
    Validate and apply a UCI move. Returns the resulting FEN and SAN notation.
    Used by the frontend to advance the board one move at a time.
    """
    try:
        board = chess.Board(req.fen)
        move = chess.Move.from_uci(req.move_uci)
        if move not in board.legal_moves:
            # Try queen promotion if it's a pawn push to back rank
            if len(req.move_uci) == 4:
                promo = chess.Move.from_uci(req.move_uci + "q")
                if promo in board.legal_moves:
                    move = promo
                else:
                    return {"legal": False, "fen_after": None, "move_san": None}
            else:
                return {"legal": False, "fen_after": None, "move_san": None}
        san = board.san(move)
        board.push(move)
        return {"legal": True, "fen_after": board.fen(), "move_san": san}
    except Exception:
        return {"legal": False, "fen_after": None, "move_san": None}


class EvaluateLineRequest(BaseModel):
    fen: str
    user_line: list[str]       # UCI moves entered by the user
    user_id: Optional[int] = None
    game_id: Optional[int] = None
    classification: Optional[str] = None   # "blunder" | "mistake" (for stats)
    centipawn_loss: Optional[float] = None


@router.post("/evaluate")
async def evaluate_drill_line(req: EvaluateLineRequest, db: AsyncSession = Depends(get_db)):
    """
    Compare the user's predicted line against the engine's best line.
    Returns per-move results, accuracy score, and error classification.
    """
    if not req.user_line:
        raise HTTPException(status_code=400, detail="user_line is empty")

    engine = await get_engine()
    lines = await engine.get_multipv(req.fen, num_pv=1, depth=20)
    if not lines:
        raise HTTPException(status_code=500, detail="Engine analysis failed")

    engine_pv_san = lines[0].get("pv_san", [])

    # Rebuild engine PV as UCI for comparison
    pv_board = chess.Board(req.fen)
    engine_pv_uci: list[str] = []
    for san in engine_pv_san:
        try:
            m = pv_board.parse_san(san)
            engine_pv_uci.append(m.uci())
            pv_board.push(m)
        except Exception:
            break

    # Compare user line vs engine line move by move
    move_results = []
    eval_board = chess.Board(req.fen)

    for i, user_uci in enumerate(req.user_line):
        engine_uci = engine_pv_uci[i] if i < len(engine_pv_uci) else None
        engine_san = engine_pv_san[i] if i < len(engine_pv_san) else None

        try:
            user_move = chess.Move.from_uci(user_uci)
            if user_move not in eval_board.legal_moves:
                break
            user_san = eval_board.san(user_move)
        except Exception:
            break

        matched = (user_uci == engine_uci)

        error_type = None
        if not matched and engine_uci:
            try:
                eng_move = chess.Move.from_uci(engine_uci)
                if eval_board.is_legal(eng_move):
                    if eval_board.gives_check(eng_move):
                        error_type = "missed_check"
                    elif eval_board.is_capture(eng_move):
                        error_type = "missed_capture"
                    else:
                        error_type = "missed_best_move"
            except Exception:
                error_type = "missed_best_move"

        move_results.append({
            "ply": i + 1,
            "user_move": user_san,
            "engine_move": engine_san,
            "matched": matched,
            "error_type": error_type,
        })
        eval_board.push(user_move)

    depth_reached = len(move_results)
    correct_moves = sum(1 for r in move_results if r["matched"])
    accuracy = round(correct_moves / max(1, depth_reached) * 100)

    errors = [r["error_type"] for r in move_results if r["error_type"]]
    missed_forcing = any(e in ("missed_check", "missed_capture") for e in errors)

    if accuracy == 100:
        error_classification = "good_calculation"
        feedback = "Excellent! You accurately predicted the engine's best line."
    elif missed_forcing:
        error_classification = "missed_forcing_move"
        feedback = "You missed a forcing move. Always check checks and captures first before other moves."
    elif accuracy >= 50:
        error_classification = "partial_calculation"
        feedback = "Good effort — you found part of the line but deviated from the engine's best choice."
    else:
        error_classification = "incorrect_evaluation"
        feedback = "Your line diverged significantly from the engine. Focus on forcing moves and opponent threats."

    # Persist result for stats (fire-and-forget style — never blocks the response)
    if req.user_id:
        try:
            record = DrillResult(
                user_id=req.user_id,
                game_id=req.game_id,
                classification=req.classification,
                centipawn_loss=req.centipawn_loss,
                accuracy=accuracy,
                correct_moves=correct_moves,
                depth_reached=depth_reached,
                error_classification=error_classification,
                missed_forcing_move=missed_forcing,
            )
            db.add(record)
            await db.commit()
        except Exception as e:
            print(f"[drills] Failed to save drill result: {e}")

    return {
        "engine_line": engine_pv_san,
        "move_results": move_results,
        "depth_reached": depth_reached,
        "correct_moves": correct_moves,
        "accuracy": accuracy,
        "missed_forcing_move": missed_forcing,
        "error_classification": error_classification,
        "feedback": feedback,
    }


@router.get("/{user_id}/stats")
async def get_drill_stats(user_id: int, db: AsyncSession = Depends(get_db)):
    """
    Aggregated drill statistics for a user.
    Returns overall accuracy, trend, error breakdown, and improvement delta.
    """
    results_q = await db.execute(
        select(DrillResult)
        .where(DrillResult.user_id == user_id)
        .order_by(DrillResult.created_at.asc())
    )
    results = results_q.scalars().all()

    if not results:
        return {"total": 0, "has_data": False}

    accuracies = [r.accuracy for r in results]
    total = len(results)
    avg_accuracy = round(sum(accuracies) / total)

    # Trend: last 10 vs first 10 (if enough data)
    improvement = None
    if total >= 6:
        first_half = accuracies[:max(1, total // 3)]
        last_half  = accuracies[-max(1, total // 3):]
        improvement = round(sum(last_half) / len(last_half) - sum(first_half) / len(first_half))

    # Error breakdown
    error_counts: dict[str, int] = {}
    for r in results:
        ec = r.error_classification or "unknown"
        error_counts[ec] = error_counts.get(ec, 0) + 1

    missed_forcing_count = sum(1 for r in results if r.missed_forcing_move)

    # Recent accuracy trend (last 20, grouped for chart)
    recent = results[-20:]
    trend = [
        {"index": i + 1, "accuracy": r.accuracy, "date": r.created_at.strftime("%m/%d")}
        for i, r in enumerate(recent)
    ]

    # Best and worst sessions
    best  = max(accuracies)
    worst = min(accuracies)

    # Avg depth reached
    avg_depth = round(sum(r.depth_reached for r in results) / total, 1)

    # Streak: consecutive perfect drills (accuracy == 100) from the end
    perfect_streak = 0
    for r in reversed(results):
        if r.accuracy == 100:
            perfect_streak += 1
        else:
            break

    return {
        "has_data": True,
        "total": total,
        "avg_accuracy": avg_accuracy,
        "best": best,
        "worst": worst,
        "improvement": improvement,    # positive = getting better
        "avg_depth": avg_depth,
        "missed_forcing_count": missed_forcing_count,
        "missed_forcing_pct": round(missed_forcing_count / total * 100),
        "error_counts": error_counts,
        "perfect_streak": perfect_streak,
        "trend": trend,
    }
