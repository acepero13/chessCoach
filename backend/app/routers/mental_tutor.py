"""
Mental Tutor — Winning position conversion training with mental behavior analysis.
"""
import chess
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from pydantic import BaseModel

from app.database import get_db
from app.models import Game, GameAnalysis, AnalysisStatus, MentalTutorSession
from app.engine.stockfish import get_engine, classify_move
from app.llm.explainer import generate_mental_coaching

router = APIRouter(prefix="/mental-tutor", tags=["mental-tutor"])

WINNING_EVAL_MIN = 200    # +2.0 pawns minimum
WINNING_EVAL_MAX = 900    # below trivial mate
MIN_MOVE_NUMBER = 8
ENGINE_DEPTH = 12

# In-memory board state per session (keyed by session_id)
_session_boards: dict[int, dict] = {}


def _classify_mental_errors(moves_data: list[dict], starting_eval: float) -> list[dict]:
    """Deterministic mental behavior classification."""
    user_moves = [m for m in moves_data if m.get("is_user_move")]
    if not user_moves:
        return []

    errors = []

    # 1. RUSHING: quick move + suboptimal quality
    times = [m["move_time_ms"] for m in user_moves if m.get("move_time_ms", 0) > 500]
    avg_time = sum(times) / len(times) if times else 0
    for i, m in enumerate(user_moves):
        t = m.get("move_time_ms", 0)
        cp_loss = m.get("cp_loss", 0)
        if avg_time > 1000 and 0 < t < avg_time * 0.35 and cp_loss >= 60:
            errors.append({
                "type": "rushing",
                "move_index": i,
                "move_san": m.get("move_san", ""),
                "description": f"You played {m.get('move_san', 'this move')} very quickly despite having a winning position — rushing when ahead often throws away the advantage.",
                "severity": min(cp_loss / 120.0, 1.0),
            })

    # 2. RELAXATION: gradual eval drop over 3 consecutive user moves (no single blunder)
    if len(user_moves) >= 3:
        for i in range(len(user_moves) - 2):
            window = user_moves[i:i+3]
            losses = [m.get("cp_loss", 0) for m in window]
            if all(20 <= l < 80 for l in losses) and sum(losses) >= 90:
                errors.append({
                    "type": "relaxation",
                    "move_index": i,
                    "move_san": "",
                    "description": "Your advantage gradually eroded over several moves without a single clear blunder — a sign of passive or careless play when ahead.",
                    "severity": min(sum(losses) / 250.0, 1.0),
                })
                break

    # 3. OVERCOMPLICATION: large cp_loss from commanding position
    for i, m in enumerate(user_moves):
        cp_loss = m.get("cp_loss", 0)
        eval_before = m.get("eval_before", starting_eval)
        if cp_loss >= 100 and eval_before >= 300:
            errors.append({
                "type": "overcomplication",
                "move_index": i,
                "move_san": m.get("move_san", ""),
                "description": f"With a commanding advantage (+{eval_before/100:.1f}), you chose a move that unnecessarily complicated the position when a simpler approach would have maintained the win.",
                "severity": min(cp_loss / 150.0, 1.0),
            })

    # 4. TILT: error followed by another error
    high_loss = [i for i, m in enumerate(user_moves) if m.get("cp_loss", 0) >= 80]
    for idx in high_loss:
        if idx + 1 < len(user_moves) and user_moves[idx + 1].get("cp_loss", 0) >= 60:
            errors.append({
                "type": "tilt",
                "move_index": idx,
                "move_san": user_moves[idx].get("move_san", ""),
                "description": "After your first mistake, you made another poor move immediately — a sign that one error destabilized your decision-making.",
                "severity": 0.85,
            })

    # Deduplicate — keep highest severity per type
    seen: dict[str, dict] = {}
    for e in sorted(errors, key=lambda x: -x["severity"]):
        if e["type"] not in seen:
            seen[e["type"]] = e

    return list(seen.values())


def _compute_result(eval_progression: list[float], starting_eval: float) -> str:
    if not eval_progression:
        return "unknown"
    final_eval = eval_progression[-1]
    min_eval = min(eval_progression)
    if final_eval >= 150:
        return "converted"
    elif min_eval <= 0:
        return "failed"
    return "partial"


def _restore_board(session: MentalTutorSession) -> chess.Board:
    board = chess.Board(session.starting_fen)
    for m in (session.moves_data or []):
        try:
            board.push(chess.Move.from_uci(m["move_uci"]))
        except Exception:
            pass
    return board


@router.get("/{user_id}/scenarios")
async def get_scenarios(user_id: int, limit: int = 10, db: AsyncSession = Depends(get_db)):
    """Find winning positions from analyzed games for training scenarios."""
    games_result = await db.execute(
        select(Game).where(Game.user_id == user_id).order_by(Game.played_at.desc())
    )
    games = games_result.scalars().all()
    game_map = {g.id: g for g in games}
    game_ids = [g.id for g in games]

    if not game_ids:
        return {"scenarios": []}

    analyses_result = await db.execute(
        select(GameAnalysis).where(
            GameAnalysis.game_id.in_(game_ids),
            GameAnalysis.status == AnalysisStatus.complete,
        )
    )
    analyses = analyses_result.scalars().all()

    scenarios = []
    for a in analyses:
        g = game_map.get(a.game_id)
        if not g:
            continue
        user_color = g.user_color or "white"
        evals = a.move_evaluations or []

        best_pos = None
        best_score = 0

        for i, e in enumerate(evals):
            if e.get("color") != user_color:
                continue
            ev = e.get("eval_before", 0)
            mn = e.get("move_number", 0)
            if WINNING_EVAL_MIN <= ev <= WINNING_EVAL_MAX and mn >= MIN_MOVE_NUMBER:
                later = [
                    evals[j].get("eval_before", 0)
                    for j in range(i + 1, min(i + 12, len(evals)))
                    if evals[j].get("color") == user_color
                ]
                max_drop = max((ev - x for x in later), default=0)
                score = ev + max_drop * 0.6
                if score > best_score:
                    best_score = score
                    best_pos = (i, e, max_drop)

        if best_pos:
            idx, move_eval, max_drop = best_pos
            failed = max_drop > 100 or (g.result and g.result.value in ("loss", "draw"))
            eval_cp = round(move_eval["eval_before"])
            scenarios.append({
                "game_id": g.id,
                "move_index": idx,
                "fen": move_eval["fen"],
                "eval_cp": eval_cp,
                "move_number": move_eval["move_number"],
                "user_color": user_color,
                "game_result": g.result.value if g.result else "unknown",
                "failed_to_convert": bool(failed),
                "white_player": g.white_player or "White",
                "black_player": g.black_player or "Black",
            })

    scenarios.sort(key=lambda s: (not s["failed_to_convert"], -s["eval_cp"]))
    return {"scenarios": scenarios[:limit]}


class StartSessionRequest(BaseModel):
    user_id: int
    game_id: int
    move_index: int
    max_moves: int = 6


@router.post("/session/start")
async def start_session(req: StartSessionRequest, db: AsyncSession = Depends(get_db)):
    """Start a mental tutor training session from a winning position."""
    game_result = await db.execute(select(Game).where(Game.id == req.game_id))
    game = game_result.scalar_one_or_none()
    if not game:
        raise HTTPException(status_code=404, detail="Game not found")

    analysis_result = await db.execute(
        select(GameAnalysis).where(GameAnalysis.game_id == req.game_id)
    )
    analysis = analysis_result.scalar_one_or_none()
    if not analysis or analysis.status.value != "complete":
        raise HTTPException(status_code=400, detail="Game not analyzed")

    evals = analysis.move_evaluations or []
    if req.move_index >= len(evals):
        raise HTTPException(status_code=400, detail="Invalid move index")

    move_eval = evals[req.move_index]
    starting_fen = move_eval["fen"]
    starting_eval = float(move_eval["eval_before"])

    # Derive the active color directly from the FEN — this is authoritative.
    # game.user_color can be stale/wrong for older imported games.
    start_board = chess.Board(starting_fen)
    user_color = "white" if start_board.turn == chess.WHITE else "black"

    session = MentalTutorSession(
        user_id=req.user_id,
        game_id=req.game_id,
        starting_fen=starting_fen,
        starting_eval=starting_eval,
        user_color=user_color,
        max_moves=req.max_moves,
        game_result=game.result.value if game.result else "unknown",
        result="in_progress",
        moves_data=[],
        eval_progression=[round(starting_eval)],
    )
    db.add(session)
    await db.commit()
    await db.refresh(session)

    board = chess.Board(starting_fen)
    _session_boards[session.id] = {"board": board, "eval_before": starting_eval}

    failed = game.result and game.result.value in ("loss", "draw")
    context = f"You are winning (+{starting_eval / 100:.1f}). Convert this position."
    if failed:
        context += f" In the actual game, you {game.result.value} — this is your chance to practice conversion."

    return {
        "session_id": session.id,
        "fen": starting_fen,
        "eval_cp": round(starting_eval),
        "user_color": user_color,
        "max_moves": req.max_moves,
        "context": context,
        "failed_to_convert": bool(failed),
    }


class MoveRequest(BaseModel):
    move_uci: str
    move_time_ms: int = 0


@router.post("/session/{session_id}/move")
async def play_move(session_id: int, req: MoveRequest, db: AsyncSession = Depends(get_db)):
    """Play a user move; engine responds. Returns new FEN + eval."""
    session_result = await db.execute(
        select(MentalTutorSession).where(MentalTutorSession.id == session_id)
    )
    session = session_result.scalar_one_or_none()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    if session.completed:
        raise HTTPException(status_code=400, detail="Session already completed")

    # Restore board
    state = _session_boards.get(session_id)
    if not state:
        board = _restore_board(session)
        eval_before = (session.eval_progression or [session.starting_eval])[-1]
        state = {"board": board, "eval_before": float(eval_before)}
        _session_boards[session_id] = state

    board: chess.Board = state["board"]
    eval_before: float = state["eval_before"]

    # Validate move
    try:
        user_move = chess.Move.from_uci(req.move_uci)
        if user_move not in board.legal_moves:
            raise HTTPException(status_code=400, detail="Illegal move")
        user_move_san = board.san(user_move)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid move UCI")

    engine = await get_engine()

    # Apply user move
    board.push(user_move)

    # Evaluate after user's move (now opponent's turn — negate for user's perspective)
    info_opp = await engine.get_best_move(board.fen(), depth=ENGINE_DEPTH)
    eval_after_user = -info_opp["score_cp"]
    cp_loss = max(0.0, eval_before - eval_after_user)
    user_classification = classify_move(cp_loss)

    # Record user move
    moves_data = list(session.moves_data or [])
    moves_data.append({
        "move_uci": req.move_uci,
        "move_san": user_move_san,
        "is_user_move": True,
        "cp_loss": round(cp_loss),
        "eval_before": round(eval_before),
        "eval_after": round(eval_after_user),
        "move_time_ms": req.move_time_ms,
    })

    user_move_count = sum(1 for m in moves_data if m.get("is_user_move"))
    is_complete = user_move_count >= session.max_moves or board.is_game_over()

    engine_move_san = None
    new_fen = board.fen()
    new_eval = eval_after_user

    if not is_complete and not board.is_game_over():
        engine_uci = info_opp.get("best_move_uci")
        # Fallback: pick first legal move if engine returned nothing
        if not engine_uci:
            first_legal = next(iter(board.legal_moves), None)
            engine_uci = first_legal.uci() if first_legal else None
        if engine_uci:
            try:
                eng_move = chess.Move.from_uci(engine_uci)
                if eng_move in board.legal_moves:
                    engine_move_san = board.san(eng_move)
                    board.push(eng_move)
                    new_fen = board.fen()

                    if not board.is_game_over():
                        info_user = await engine.get_best_move(board.fen(), depth=ENGINE_DEPTH)
                        new_eval = info_user["score_cp"]

                    moves_data.append({
                        "move_uci": engine_uci,
                        "move_san": engine_move_san,
                        "is_user_move": False,
                        "eval_after": round(new_eval),
                    })
                else:
                    # Engine move illegal — board state corrupted; end session
                    is_complete = True
            except Exception:
                is_complete = True  # don't leave board in unplayable state

    state["eval_before"] = new_eval

    eval_progression = list(session.eval_progression or [])
    eval_progression.append(round(new_eval))

    session.moves_data = moves_data
    session.eval_progression = eval_progression

    if is_complete or board.is_game_over():
        session.completed = True
        session.completed_at = datetime.utcnow()
        session.result = _compute_result(eval_progression, session.starting_eval)
        _session_boards.pop(session_id, None)

    await db.commit()

    return {
        "user_move_san": user_move_san,
        "user_cp_loss": round(cp_loss),
        "user_classification": user_classification,
        "engine_move_san": engine_move_san,
        "new_fen": new_fen,
        "new_eval_cp": round(new_eval),
        "move_count": user_move_count,
        "max_moves": session.max_moves,
        "is_complete": is_complete or board.is_game_over(),
    }


@router.post("/session/{session_id}/complete")
async def complete_session(session_id: int, db: AsyncSession = Depends(get_db)):
    """Finish session, classify mental errors, generate coaching feedback."""
    session_result = await db.execute(
        select(MentalTutorSession).where(MentalTutorSession.id == session_id)
    )
    session = session_result.scalar_one_or_none()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    if not session.completed:
        session.completed = True
        session.completed_at = datetime.utcnow()
        eval_progression = list(session.eval_progression or [session.starting_eval])
        session.result = _compute_result(eval_progression, session.starting_eval)

    mental_errors = _classify_mental_errors(session.moves_data or [], session.starting_eval)
    session.mental_errors = mental_errors

    eval_progression = session.eval_progression or [session.starting_eval]
    final_eval = float(eval_progression[-1]) if eval_progression else session.starting_eval

    coaching = await generate_mental_coaching(
        mental_errors=mental_errors,
        result=session.result or "unknown",
        starting_eval=session.starting_eval,
        final_eval=final_eval,
        game_result=session.game_result or "unknown",
    )
    session.coaching = coaching
    _session_boards.pop(session_id, None)

    await db.commit()

    user_moves = [m for m in (session.moves_data or []) if m.get("is_user_move")]

    return {
        "session_id": session_id,
        "result": session.result,
        "mental_errors": mental_errors,
        "eval_progression": eval_progression,
        "moves_played": [m["move_san"] for m in user_moves],
        "coaching": coaching or "",
        "starting_eval": session.starting_eval,
        "final_eval": final_eval,
    }


@router.get("/session/{session_id}")
async def get_session_state(session_id: int, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(MentalTutorSession).where(MentalTutorSession.id == session_id)
    )
    session = result.scalar_one_or_none()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    return {
        "session_id": session.id,
        "completed": session.completed,
        "result": session.result,
        "move_count": sum(1 for m in (session.moves_data or []) if m.get("is_user_move")),
        "max_moves": session.max_moves,
        "eval_progression": session.eval_progression,
    }
