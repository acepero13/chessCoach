"""
Coach chat and coach review endpoints.
"""
import chess
import asyncio
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.database import get_db
from app.models import Game, GameAnalysis, AnnotationSession
from app.engine.stockfish import get_engine
from app.llm.explainer import coach_chat_turn, generate_review_comment, generate_review_reply
from .utils import _validated_patterns, _eval_verdict, _pv_uci_to_san
from .schemas import CoachChatRequest, CoachReviewReplyRequest

router = APIRouter()


@router.post("/session/{session_id}/chat")
async def coach_chat(
    session_id: int,
    req: CoachChatRequest,
    db: AsyncSession = Depends(get_db),
):
    """
    One turn of interactive chat with the coach for a specific position.
    The LLM can call evaluate_move and get_alternatives engine tools.
    """
    session_result = await db.execute(
        select(AnnotationSession).where(AnnotationSession.id == session_id)
    )
    session = session_result.scalar_one_or_none()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

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
    fen = move_eval["fen"]

    patterns = _validated_patterns(
        analysis.patterns_detected or [],
        move_eval.get("move_number", 0),
        fen,
        move_eval.get("best_move_uci", ""),
    )

    position_context = {
        "move_san":        move_eval.get("move_san", ""),
        "classification":  move_eval.get("classification", ""),
        "centipawn_loss":  move_eval.get("centipawn_loss", 0.0),
        "engine_best_move": move_eval.get("best_move_san", ""),
        "engine_pv_san":   move_eval.get("pv_san", [])[:4],
        "patterns":        patterns,
    }

    engine = await get_engine()

    async def engine_callback(tool_name: str, args: dict) -> str:
        if tool_name == "evaluate_move":
            move_san = args.get("move_san", "").strip()
            if not move_san:
                return "No move provided."
            try:
                board = chess.Board(fen)
                move_obj = board.parse_san(move_san)
                result = await engine.evaluate_move(
                    fen=fen,
                    move_uci=move_obj.uci(),
                    eval_before=move_eval.get("eval_before"),
                )
                cp = result["centipawn_loss"]
                cls = result["classification"]
                return (
                    f"{move_san}: {cls} ({cp:.0f} cp loss from best). "
                    f"Eval after: {result['eval_after']:.0f} cp."
                )
            except Exception as e:
                return f"Could not evaluate '{move_san}': {e}"

        elif tool_name == "get_alternatives":
            num = min(4, max(1, int(args.get("num_lines", 3))))
            try:
                lines = await engine.get_multipv(fen, num_pv=num, depth=20)
                if not lines:
                    return "No alternatives found."
                parts = []
                for line in lines:
                    pv = " ".join(line.get("pv_san", [])[:4])
                    cp = line.get("score_cp", 0)
                    parts.append(f"{line['move_san']} ({cp:+.0f}cp): {pv}")
                return "\n".join(parts)
            except Exception as e:
                return f"Engine error: {e}"

        return f"Unknown tool: {tool_name}"

    reply = await coach_chat_turn(
        conversation=req.messages,
        fen=fen,
        position_context=position_context,
        engine_callback=engine_callback,
    )

    return {"reply": reply or "Coach is unavailable — try again later."}


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
        norm_user_candidates = [c.rstrip("+#") for c in user_candidates]
        move_san = move.get("move_san", "")
        user_played_best = bool(
            engine_best and move_san and (
                move_san == engine_best or
                move_san.rstrip("+#") == engine_best.rstrip("+#")
            )
        )
        best_in_candidates = user_played_best or bool(
            engine_best and (
                engine_best in user_candidates or
                engine_best.rstrip("+#") in norm_user_candidates
            )
        )
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
            "color": move.get("color", "white"),
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
            "engine_best_move_uci": move.get("engine_best_move_uci", ""),
            "engine_pv_san": engine_pv,
            "engine_multipv": move.get("engine_multipv"),
            "patterns": patterns,
            "coach_comment": comment,
        }

    # Exclude unsaved drafts — only review fully submitted moves
    submitted_moves = [m for m in moves_data if not m.get("draft", False)]
    if not submitted_moves:
        return {"review_items": [], "total": 0}
    # Run all LLM calls concurrently (they queue on the local GPU but don't block the loop)
    review_items = await asyncio.gather(*[build_item(m) for m in submitted_moves])

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
