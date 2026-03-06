"""
Batch game analyzer. Orchestrates: engine analysis → pattern detection → score computation.

Key design: each game creates its own DB session so this can safely run in a
FastAPI background task (the request-scoped session is already closed by then).
"""
import asyncio
import math
from datetime import datetime
from sqlalchemy import select

from app.database import AsyncSessionLocal
from app.models import GameAnalysis, AnalysisStatus
from app.engine.stockfish import get_engine, MoveEval
from app.patterns.tactical_detectors import detect_tactical_patterns
from app.patterns.strategic_detectors import detect_strategic_patterns


def _compute_accuracy(move_evals: list[MoveEval]) -> float:
    if not move_evals:
        return 0.0
    avg_loss = sum(e.centipawn_loss for e in move_evals) / len(move_evals)
    accuracy = 103.1668 * math.exp(-0.04354 * avg_loss) - 3.1669
    return round(max(0.0, min(100.0, accuracy)), 1)


async def analyze_game(game_id: int, pgn_text: str, depth: int) -> GameAnalysis:
    """
    Run full analysis pipeline for a single game.
    Opens its own DB session so it's safe to call from a background task.
    """
    engine = await get_engine()
    move_evals = await engine.analyse_game(pgn_text, depth=depth)

    move_eval_dicts = [
        {
            "fen": e.fen,
            "move_uci": e.move_uci,
            "move_san": e.move_san,
            "eval_before": e.eval_before,
            "eval_after": e.eval_after,
            "best_move_uci": e.best_move_uci,
            "best_move_san": e.best_move_san,
            "eval_best": e.eval_best,
            "centipawn_loss": e.centipawn_loss,
            "classification": e.classification,
            "is_capture": e.is_capture,
            "is_check": e.is_check,
            "move_number": e.move_number,
            "color": e.color,
            "pv_san": e.pv_san or [],
        }
        for e in move_evals
    ]

    tactical_patterns = detect_tactical_patterns(move_evals)
    strategic_patterns = detect_strategic_patterns(move_evals)
    all_patterns = tactical_patterns + strategic_patterns

    blunders = sum(1 for e in move_evals if e.classification == "blunder")
    mistakes = sum(1 for e in move_evals if e.classification == "mistake")
    inaccuracies = sum(1 for e in move_evals if e.classification == "inaccuracy")
    avg_loss = (
        sum(e.centipawn_loss for e in move_evals) / len(move_evals)
        if move_evals else 0.0
    )
    accuracy = _compute_accuracy(move_evals)

    async with AsyncSessionLocal() as db:
        result = await db.execute(
            select(GameAnalysis).where(GameAnalysis.game_id == game_id)
        )
        analysis = result.scalar_one_or_none()

        if analysis is None:
            analysis = GameAnalysis(game_id=game_id)
            db.add(analysis)

        analysis.status = AnalysisStatus.complete
        analysis.depth = depth
        analysis.move_evaluations = move_eval_dicts
        analysis.patterns_detected = all_patterns
        analysis.centipawn_loss_avg = round(avg_loss, 2)
        analysis.blunder_count = blunders
        analysis.mistake_count = mistakes
        analysis.inaccuracy_count = inaccuracies
        analysis.accuracy = accuracy
        analysis.completed_at = datetime.utcnow()

        await db.commit()
        await db.refresh(analysis)
        return analysis


async def _mark_running(game_id: int):
    async with AsyncSessionLocal() as db:
        result = await db.execute(
            select(GameAnalysis).where(GameAnalysis.game_id == game_id)
        )
        analysis = result.scalar_one_or_none()
        if analysis is None:
            analysis = GameAnalysis(game_id=game_id, status=AnalysisStatus.running)
            db.add(analysis)
        else:
            analysis.status = AnalysisStatus.running
        await db.commit()


async def _mark_failed(game_id: int, error: str):
    async with AsyncSessionLocal() as db:
        result = await db.execute(
            select(GameAnalysis).where(GameAnalysis.game_id == game_id)
        )
        analysis = result.scalar_one_or_none()
        if analysis:
            analysis.status = AnalysisStatus.failed
            await db.commit()


async def batch_analyze(game_ids: list[int], pgn_map: dict[int, str], depth: int):
    """
    Analyze games sequentially (engine is a singleton; parallel access is serialized
    via the engine lock, but sequential is cleaner and avoids thundering herd).
    Safe to call from a FastAPI background task.
    """
    for game_id in game_ids:
        await _mark_running(game_id)
        try:
            await analyze_game(game_id=game_id, pgn_text=pgn_map[game_id], depth=depth)
            print(f"[analysis] Game {game_id} complete")
        except Exception as exc:
            print(f"[analysis] Game {game_id} failed: {exc}")
            await _mark_failed(game_id, str(exc))
