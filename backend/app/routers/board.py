"""
Free-play analysis board — real-time Stockfish evaluation of any position.
Used by the Puzzle Trainer's "Analyze" mode to evaluate user moves and reply
with the engine's best response.
"""
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
import chess

from app.engine.stockfish import get_engine

router = APIRouter(prefix="/board", tags=["board"])


class AnalyzeRequest(BaseModel):
    fen: str
    depth: int = 16   # lighter than game analysis depth — needs to feel instant


class AnalyzeMultiRequest(BaseModel):
    fen: str
    depth: int = 16
    num_lines: int = 3


@router.post("/analyze-multi")
async def analyze_position_multi(req: AnalyzeMultiRequest):
    """
    Get top N principal variations for a position via Stockfish MultiPV.
    Used by the Defensive Gauntlet to surface the best defensive responses.
    Returns:
      - lines: [{rank, move_san, move_uci, score_cp, pv_san}]
      - game_over: bool
    """
    try:
        board = chess.Board(req.fen)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid FEN")

    if board.is_game_over():
        return {"lines": [], "game_over": True}

    engine = await get_engine()
    lines = await engine.get_multipv(req.fen, num_pv=max(1, min(req.num_lines, 5)), depth=req.depth)
    return {"lines": lines, "game_over": False}


@router.post("/analyze")
async def analyze_position(req: AnalyzeRequest):
    """
    Evaluate a position with Stockfish.
    Returns:
      - eval_cp: centipawns from WHITE's perspective (positive = white winning)
      - best_move_uci / best_move_san: engine's top reply
      - pv_san: principal variation (up to 5 moves, SAN)
      - game_over: true if the position is terminal
    """
    try:
        board = chess.Board(req.fen)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid FEN")

    if board.is_game_over():
        outcome = board.outcome()
        return {
            "eval_cp": 0,
            "best_move_uci": None,
            "best_move_san": None,
            "pv_san": [],
            "game_over": True,
            "outcome": outcome.result() if outcome else "*",
        }

    engine = await get_engine()
    result = await engine.get_best_move(req.fen, depth=req.depth)

    # get_best_move returns score from the MOVER's perspective; normalise to white's POV
    score_cp = result["score_cp"]
    if board.turn == chess.BLACK:
        score_cp = -score_cp

    # Build PV in SAN from the current position
    pv_san: list[str] = []
    try:
        b = board.copy()
        for uci in (result.get("pv") or []):
            m = chess.Move.from_uci(uci)
            pv_san.append(b.san(m))
            b.push(m)
    except Exception:
        pass

    return {
        "eval_cp": round(score_cp, 1),
        "best_move_uci": result["best_move_uci"],
        "best_move_san": result["best_move_san"],
        "pv_san": pv_san,
        "game_over": False,
    }
