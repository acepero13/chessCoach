"""
Guided Self-Annotation Mode endpoints.
Users review their own game move-by-move, writing annotations and candidate moves
BEFORE the engine reveal. Engine evaluation stays hidden until user commits reasoning.
"""
import chess
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, desc
from pydantic import BaseModel
from typing import Optional

from app.database import get_db
from app.models import Game, GameAnalysis, AnnotationSession
import asyncio
from app.llm.explainer import explain_annotation, generate_review_comment, generate_review_reply
from app.engine.stockfish import get_engine
from app.patterns.tactical_detectors import _is_hanging

router = APIRouter(prefix="/selfanalysis", tags=["selfanalysis"])

# ──────────────────────────────────────────────
# Helpers
# ──────────────────────────────────────────────

LABEL_MAP = {"winning": 3, "better": 1, "equal": 0, "worse": -1, "losing": -3}


def _engine_bucket(cp: float) -> int:
    if cp > 200:
        return 3
    if cp > 50:
        return 1
    if cp > -50:
        return 0
    if cp > -200:
        return -1
    return -3


def _eval_verdict(user_label: str, engine_eval_before: float) -> str:
    """Deterministic verdict: was the user's position evaluation correct?"""
    if user_label not in LABEL_MAP:
        return "assessment not recorded"
    user_num = LABEL_MAP[user_label]
    engine_num = _engine_bucket(engine_eval_before)
    diff = abs(user_num - engine_num)
    if diff == 0:
        return "correct"
    if diff == 1:
        return "slightly off"
    return "significantly off"


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
    """Filter stale false positives from stored patterns."""
    result = []
    for p in all_patterns:
        if p.get("move_number") != move_number:
            continue
        if p.get("type") == "hanging_piece_missed" and best_move_uci:
            try:
                board = chess.Board(fen)
                bm = chess.Move.from_uci(best_move_uci)
                if not (board.is_capture(bm) and _is_hanging(board, bm.to_square)):
                    continue
            except Exception:
                pass
        result.append(p)
    return result


def _fen_after_move(fen_before: str, move_uci: str) -> str:
    """Return FEN after playing a move from a FEN position."""
    board = chess.Board(fen_before)
    move = chess.Move.from_uci(move_uci)
    board.push(move)
    return board.fen()


def _build_all_game_moves(evals: list, user_color: str) -> tuple[list, list]:
    """
    Build the full list of game moves (both colors) with is_user_move flag.
    Returns (all_game_moves, user_eval_indices).
    """
    all_game_moves = []
    user_eval_indices = []
    for i, e in enumerate(evals):
        is_user = e.get("color") == user_color
        classification = e.get("classification", "good")
        priority = "high" if is_user and classification in ("mistake", "blunder") else "normal"
        fen_after = _fen_after_move(e["fen"], e["move_uci"]) if e.get("move_uci") else e["fen"]
        all_game_moves.append({
            "move_index": i,
            "move_number": e.get("move_number", 0),
            "fen_before": e["fen"],
            "fen_after": fen_after,
            "move_san": e.get("move_san", ""),
            "color": e.get("color", ""),
            "is_user_move": is_user,
            "classification": classification,
            "centipawn_loss": e.get("centipawn_loss", 0.0),
            "priority": priority,
        })
        if is_user:
            user_eval_indices.append(i)
    return all_game_moves, user_eval_indices


# ──────────────────────────────────────────────
# Request models
# ──────────────────────────────────────────────

class StartAnnotationRequest(BaseModel):
    user_id: int
    game_id: int
    time_budget_minutes: int = 30


class AnnotateRequest(BaseModel):
    move_index: int
    user_annotation: str = ""
    user_candidates: list[str] = []
    user_eval_label: str = ""       # "winning"/"better"/"equal"/"worse"/"losing"
    user_confidence: int = 0        # 1–5, 0 = not set
    user_marked_critical: bool = False


# ──────────────────────────────────────────────
# Endpoints
# ──────────────────────────────────────────────

@router.post("/start")
async def start_annotation_session(
    req: StartAnnotationRequest,
    db: AsyncSession = Depends(get_db),
):
    """
    Start a new self-annotation session for a game.
    Returns session_id, all user moves (with FEN-after, priority), and time advisory.
    """
    # Verify game exists
    game_result = await db.execute(select(Game).where(Game.id == req.game_id))
    game = game_result.scalar_one_or_none()
    if not game:
        raise HTTPException(status_code=404, detail="Game not found")

    # Verify analysis is complete
    analysis_result = await db.execute(
        select(GameAnalysis).where(GameAnalysis.game_id == req.game_id)
    )
    analysis = analysis_result.scalar_one_or_none()
    if not analysis or analysis.status.value != "complete":
        raise HTTPException(status_code=400, detail="Game not yet analyzed")

    evals = analysis.move_evaluations or []
    user_color = game.user_color  # "white" or "black"

    all_game_moves, user_eval_indices = _build_all_game_moves(evals, user_color)

    if not user_eval_indices:
        raise HTTPException(status_code=400, detail="No user moves found in analysis")

    total_user_moves = len(user_eval_indices)
    suggested_minutes_per_move = round(
        req.time_budget_minutes / max(1, total_user_moves), 1
    )

    # Create session
    session = AnnotationSession(
        user_id=req.user_id,
        game_id=req.game_id,
        time_budget_minutes=req.time_budget_minutes,
        focused_move_indices=user_eval_indices,
        moves_data=[],
        completed=False,
    )
    db.add(session)
    await db.commit()
    await db.refresh(session)

    return {
        "session_id": session.id,
        "game_id": req.game_id,
        "white_player": game.white_player,
        "black_player": game.black_player,
        "user_color": user_color,
        "time_budget_minutes": req.time_budget_minutes,
        "suggested_minutes_per_move": suggested_minutes_per_move,
        "total_user_moves": total_user_moves,
        "all_game_moves": all_game_moves,
    }


@router.post("/session/{session_id}/annotate")
async def annotate_move(
    session_id: int,
    req: AnnotateRequest,
    db: AsyncSession = Depends(get_db),
):
    """
    Submit annotation for a move and receive engine reveal.
    Returns engine evaluation, best move, PV, patterns, and LLM explanation.
    """
    session_result = await db.execute(
        select(AnnotationSession).where(AnnotationSession.id == session_id)
    )
    session = session_result.scalar_one_or_none()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    if req.move_index not in session.focused_move_indices:
        raise HTTPException(status_code=400, detail="move_index not in this session's moves")

    # Load analysis
    analysis_result = await db.execute(
        select(GameAnalysis).where(GameAnalysis.game_id == session.game_id)
    )
    analysis = analysis_result.scalar_one_or_none()
    if not analysis:
        raise HTTPException(status_code=404, detail="Analysis not found")

    evals = analysis.move_evaluations or []
    if req.move_index >= len(evals):
        raise HTTPException(status_code=400, detail="move_index out of range")

    move_eval = evals[req.move_index]
    fen_before = move_eval["fen"]
    move_uci = move_eval.get("move_uci", "")
    fen_after = _fen_after_move(fen_before, move_uci) if move_uci else fen_before

    engine = await get_engine()

    # Deeper analysis for critical positions
    engine_multipv = None
    if req.user_marked_critical:
        engine_multipv = await engine.get_multipv(fen_before, num_pv=4, depth=25)
        pv_uci = []
        best_move_san_engine = move_eval.get("best_move_san", "")
        if engine_multipv:
            # Get PV from top line
            top_line = engine_multipv[0]
            pv_uci_from_multipv = top_line.get("pv_san", [])  # already SAN
            pv_san = pv_uci_from_multipv
        else:
            pv_san = []
    else:
        engine_info = await engine.get_best_move(fen_before, depth=20)
        pv_uci = engine_info.get("pv", [])[:5]
        pv_san = _pv_uci_to_san(fen_before, pv_uci)

    best_move_san = move_eval.get("best_move_san", "")
    engine_eval_before = move_eval.get("eval_before", 0.0)
    engine_eval_after = move_eval.get("eval_after", 0.0)
    centipawn_loss = move_eval.get("centipawn_loss", 0.0)
    classification = move_eval.get("classification", "good")

    # Validate patterns
    patterns = _validated_patterns(
        analysis.patterns_detected or [],
        move_eval.get("move_number", 0),
        fen_before,
        move_eval.get("best_move_uci", ""),
    )

    # Deterministic eval verdict
    verdict = _eval_verdict(req.user_eval_label, engine_eval_before)

    # LLM explanation
    explanation = await explain_annotation(
        move_san=move_eval.get("move_san", ""),
        best_move_san=best_move_san,
        centipawn_loss=centipawn_loss,
        classification=classification,
        user_annotation=req.user_annotation,
        user_eval_label=req.user_eval_label,
        eval_verdict=verdict,
        user_candidates=req.user_candidates,
        engine_pv_san=pv_san,
        patterns=patterns,
    )

    # Build move entry for storage
    move_entry = {
        "move_index": req.move_index,
        "move_number": move_eval.get("move_number", 0),
        "fen_before": fen_before,
        "fen_after": fen_after,
        "move_san": move_eval.get("move_san", ""),
        "color": move_eval.get("color", ""),
        "user_annotation": req.user_annotation,
        "user_candidates": req.user_candidates,
        "user_eval_label": req.user_eval_label,
        "user_confidence": req.user_confidence,
        "user_marked_critical": req.user_marked_critical,
        "engine_eval_before": engine_eval_before,
        "engine_eval_after": engine_eval_after,
        "centipawn_loss": centipawn_loss,
        "classification": classification,
        "engine_best_move": best_move_san,
        "engine_pv_san": pv_san,
        "engine_multipv": engine_multipv,
        "patterns": patterns,
        "explanation": explanation,
    }

    # Append to session moves_data
    moves_data = list(session.moves_data or [])
    # Replace if already annotated (re-submit), else append
    existing_indices = [m["move_index"] for m in moves_data]
    if req.move_index in existing_indices:
        pos = existing_indices.index(req.move_index)
        moves_data[pos] = move_entry
    else:
        moves_data.append(move_entry)
    session.moves_data = moves_data
    await db.commit()

    return {
        "engine_eval_before": engine_eval_before,
        "engine_eval_after": engine_eval_after,
        "centipawn_loss": centipawn_loss,
        "classification": classification,
        "engine_best_move": best_move_san,
        "engine_pv_san": pv_san,
        "engine_multipv": engine_multipv,
        "patterns": patterns,
        "explanation": explanation,
        "eval_verdict": verdict,
    }


@router.post("/session/{session_id}/complete")
async def complete_session(
    session_id: int,
    db: AsyncSession = Depends(get_db),
):
    """
    Mark session as complete and compute reflection scores.
    """
    session_result = await db.execute(
        select(AnnotationSession).where(AnnotationSession.id == session_id)
    )
    session = session_result.scalar_one_or_none()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    moves_data = session.moves_data or []
    annotated = [m for m in moves_data]  # all stored entries were submitted (not skipped)

    # ── Eval accuracy (0–100) ──
    eval_scores = []
    for m in annotated:
        label = m.get("user_eval_label", "")
        if label not in LABEL_MAP:
            continue
        user_num = LABEL_MAP[label]
        engine_num = _engine_bucket(m.get("engine_eval_before", 0.0))
        score = max(0, 100 - abs(user_num - engine_num) * 20)
        eval_scores.append(score)
    eval_accuracy_score = round(sum(eval_scores) / len(eval_scores)) if eval_scores else 0

    # ── Candidate quality (0–100) ──
    candidate_scores = []
    for m in annotated:
        candidates = [c for c in (m.get("user_candidates") or []) if c]
        multipv = m.get("engine_multipv")
        best_move = m.get("engine_best_move", "")
        if not candidates:
            continue
        if best_move in candidates:
            candidate_scores.append(100)
        elif multipv and len(multipv) >= 2:
            rank2_moves = [line["move_san"] for line in multipv[1:3]]
            if any(r in candidates for r in rank2_moves):
                candidate_scores.append(50)
            else:
                candidate_scores.append(0)
        else:
            candidate_scores.append(0)
    candidate_quality_score = round(sum(candidate_scores) / len(candidate_scores)) if candidate_scores else 0

    # ── Tactical awareness (0–100) ──
    pattern_moves = [m for m in annotated if m.get("patterns")]
    total_pattern_moves = len(pattern_moves)
    hits = sum(1 for m in pattern_moves if m.get("user_marked_critical"))
    misses = total_pattern_moves - hits
    if total_pattern_moves > 0:
        tactical_awareness_score = round(50 + (hits - misses) / total_pattern_moves * 50)
        tactical_awareness_score = max(0, min(100, tactical_awareness_score))
    else:
        tactical_awareness_score = 50  # neutral if no tactical positions

    # ── Confidence calibration (0–100) ──
    confidence_scores = []
    for m in annotated:
        conf = m.get("user_confidence", 0)
        if not conf:
            continue
        label = m.get("user_eval_label", "")
        if label not in LABEL_MAP:
            continue
        user_num = LABEL_MAP[label]
        engine_num = _engine_bucket(m.get("engine_eval_before", 0.0))
        correct = abs(user_num - engine_num) <= 1
        high_confidence = conf >= 4
        if high_confidence and correct:
            confidence_scores.append(100)
        elif high_confidence and not correct:
            confidence_scores.append(0)
        else:
            confidence_scores.append(60)  # low confidence is neutral
    confidence_calibration_score = round(sum(confidence_scores) / len(confidence_scores)) if confidence_scores else 50

    # ── Thinking notes ──
    thinking_notes = []
    if eval_accuracy_score >= 70:
        thinking_notes.append("Good position evaluation — you have a solid sense of the board.")
    elif eval_accuracy_score < 40:
        thinking_notes.append("Position evaluation needs work — practice identifying who stands better.")

    if candidate_quality_score >= 70:
        thinking_notes.append("Strong candidate move selection — the engine's ideas were in your thinking.")
    elif candidate_quality_score < 40:
        thinking_notes.append("Try to widen your candidate moves — important options were missed.")

    if tactical_awareness_score >= 70:
        thinking_notes.append("Good tactical awareness — you spotted the critical moments.")
    elif tactical_awareness_score < 40:
        thinking_notes.append("Work on identifying tactical patterns — many critical positions weren't flagged.")

    if confidence_calibration_score < 40:
        thinking_notes.append("Calibrate your confidence — you were certain when you shouldn't have been.")

    reflection = {
        "eval_accuracy_score": eval_accuracy_score,
        "candidate_quality_score": candidate_quality_score,
        "tactical_awareness_score": tactical_awareness_score,
        "confidence_calibration_score": confidence_calibration_score,
        "thinking_notes": thinking_notes,
        "moves_reviewed": len(annotated),
        "total_moves": len(session.focused_move_indices or []),
    }

    session.reflection = reflection
    session.completed = True
    session.completed_at = datetime.utcnow()
    await db.commit()

    return reflection


@router.get("/session/{session_id}")
async def get_session(
    session_id: int,
    db: AsyncSession = Depends(get_db),
):
    """Return session state."""
    session_result = await db.execute(
        select(AnnotationSession).where(AnnotationSession.id == session_id)
    )
    session = session_result.scalar_one_or_none()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    return {
        "session_id": session.id,
        "game_id": session.game_id,
        "completed": session.completed,
        "moves_reviewed": len(session.moves_data or []),
        "focused_moves_count": len(session.focused_move_indices or []),
        "reflection": session.reflection,
    }


class CoachReviewReplyRequest(BaseModel):
    move_index: int
    move_san: str
    engine_best_move: str
    engine_pv_san: list[str]
    coach_comment: str
    user_response: str


@router.get("/session/{session_id}/coach-review")
async def get_coach_review(
    session_id: int,
    db: AsyncSession = Depends(get_db),
):
    """
    Generate the full coach review for a self-analysis session.
    One item per annotated move — includes coaching comment backed by engine data.
    LLM calls are run concurrently.
    """
    session_result = await db.execute(
        select(AnnotationSession).where(AnnotationSession.id == session_id)
    )
    session = session_result.scalar_one_or_none()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    moves_data = session.moves_data or []
    if not moves_data:
        return {"review_items": [], "total": 0}

    async def build_item(move: dict) -> dict:
        user_eval_label = move.get("user_eval_label", "")
        engine_eval_before = move.get("engine_eval_before", 0.0)
        verdict = _eval_verdict(user_eval_label, engine_eval_before)

        user_candidates = [c for c in (move.get("user_candidates") or []) if c]
        engine_best = move.get("engine_best_move", "")
        engine_pv = move.get("engine_pv_san", []) or []
        best_in_candidates = bool(engine_best and engine_best in user_candidates)
        patterns = move.get("patterns", []) or []

        comment = await generate_review_comment(
            move_san=move.get("move_san", ""),
            classification=move.get("classification", "good"),
            centipawn_loss=move.get("centipawn_loss", 0.0),
            user_annotation=move.get("user_annotation", ""),
            user_eval_label=user_eval_label,
            eval_verdict=verdict,
            engine_best_move=engine_best,
            engine_pv_san=engine_pv,
            best_in_candidates=best_in_candidates,
            patterns=patterns,
        )

        return {
            "move_index": move.get("move_index"),
            "move_san": move.get("move_san", ""),
            "move_number": move.get("move_number", 0),
            "fen_before": move.get("fen_before", ""),
            "classification": move.get("classification", ""),
            "centipawn_loss": move.get("centipawn_loss", 0.0),
            "engine_eval_before": engine_eval_before,
            "engine_eval_after": move.get("engine_eval_after", 0.0),
            "user_annotation": move.get("user_annotation", ""),
            "user_eval_label": user_eval_label,
            "user_candidates": user_candidates,
            "eval_verdict": verdict,
            "best_in_candidates": best_in_candidates,
            "engine_best_move": engine_best,
            "engine_pv_san": engine_pv,
            "engine_multipv": move.get("engine_multipv"),
            "patterns": patterns,
            "coach_comment": comment,
        }

    # Run all LLM calls concurrently (they queue on the local GPU but don't block the loop)
    review_items = await asyncio.gather(*[build_item(m) for m in moves_data])

    return {"review_items": list(review_items), "total": len(review_items)}


@router.post("/session/{session_id}/coach-review/reply")
async def coach_review_reply(
    session_id: int,
    req: CoachReviewReplyRequest,
    db: AsyncSession = Depends(get_db),
):
    """Handle the user's response to a coaching question during review."""
    session_result = await db.execute(
        select(AnnotationSession).where(AnnotationSession.id == session_id)
    )
    session = session_result.scalar_one_or_none()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    reply = await generate_review_reply(
        move_san=req.move_san,
        engine_best_move=req.engine_best_move,
        engine_pv_san=req.engine_pv_san,
        coach_comment=req.coach_comment,
        user_response=req.user_response,
    )

    return {"coach_reply": reply}


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
    annotated_move_indices = [m["move_index"] for m in moves_data]

    return {
        "session_id": session.id,
        "game_id": game_id,
        "completed": session.completed,
        "white_player": game.white_player,
        "black_player": game.black_player,
        "user_color": user_color,
        "time_budget_minutes": session.time_budget_minutes,
        "suggested_minutes_per_move": suggested_minutes_per_move,
        "total_user_moves": total_user_moves,
        "all_game_moves": all_game_moves,
        "annotated_move_indices": annotated_move_indices,
        "moves_data": moves_data,
        "reflection": session.reflection,
    }
