"""
SSE streaming endpoints: explain-stream and stats/coaching.
"""
import json
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.orm.attributes import flag_modified

from app.database import get_db
from app.models import GameAnalysis, AnnotationSession
from app.llm.explainer import stream_explain_annotation, stream_stats_coaching
from .utils import _strip_html
from .schemas import AnnotateRequest
from .stats import get_user_stats

router = APIRouter()


@router.post("/session/{session_id}/explain-stream")
async def explain_stream(
    session_id: int,
    req: AnnotateRequest,
    db: AsyncSession = Depends(get_db),
):
    """
    Stream the LLM explanation for a submitted annotation move.
    The caller already has engine reveal data from /annotate.
    Streams SSE chunks: data: {"text": "…"}\\n\\n  then  data: [DONE]\\n\\n
    Also patches the final explanation into moves_data when streaming completes.
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
    best_move_san = move_eval.get("best_move_san", "") or move_eval.get("best_move_uci", "")
    centipawn_loss = float(move_eval.get("centipawn_loss", 0.0))
    classification = move_eval.get("classification", "good")
    pv_san = move_eval.get("pv_san", [])

    # Reconstruct patterns from stored moves_data (already computed by /annotate)
    moves_data = list(session.moves_data or [])
    stored_entry = next((m for m in moves_data if m.get("move_index") == req.move_index), {})
    patterns = stored_entry.get("patterns", [])

    async def _sse_generator():
        accumulated = []
        async for chunk in stream_explain_annotation(
            move_san=move_eval.get("move_san", ""),
            best_move_san=best_move_san,
            centipawn_loss=centipawn_loss,
            classification=classification,
            user_annotation=_strip_html(req.user_annotation),
            user_eval_label=req.user_eval_label or "unknown",
            eval_verdict=stored_entry.get("eval_verdict", ""),
            user_candidates=req.user_candidates or [],
            engine_pv_san=pv_san,
            patterns=patterns,
            user_color=move_eval.get("color", ""),
        ):
            accumulated.append(chunk)
            yield f"data: {json.dumps({'text': chunk})}\n\n"

        # Patch final explanation into DB
        full_explanation = "".join(accumulated)
        if full_explanation and stored_entry:
            stored_entry["explanation"] = full_explanation
            session.moves_data = moves_data
            flag_modified(session, "moves_data")
            await db.commit()

        yield "data: [DONE]\n\n"

    return StreamingResponse(
        _sse_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",  # disable nginx buffering
        },
    )


@router.post("/user/{user_id}/stats/coaching")
async def get_stats_coaching(
    user_id: int,
    db: AsyncSession = Depends(get_db),
):
    """
    On-demand LLM coaching narrative streamed as SSE.
    Kept separate from GET /stats so the stats page loads instantly.
    Streams: data: {"text": "…"}\\n\\n  …  data: [DONE]\\n\\n
    """
    stats_payload = await get_user_stats(user_id, db)

    async def _sse():
        async for chunk in stream_stats_coaching(stats_payload):
            yield f"data: {json.dumps({'text': chunk})}\n\n"
        yield "data: [DONE]\n\n"

    return StreamingResponse(
        _sse(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
