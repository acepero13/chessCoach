"""
Session lifecycle endpoints: start, annotate, save-draft, root-cause, complete, get.
"""
import chess
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.orm.attributes import flag_modified

from app.database import get_db
from app.models import Game, GameAnalysis, AnnotationSession
from app.engine.stockfish import get_engine
from app.llm.explainer import generate_thinking_profile, analyze_questionnaire
from .utils import (
    LABEL_MAP,
    _engine_bucket,
    _eval_verdict,
    _fen_after_move,
    _build_all_game_moves,
    _validated_patterns,
)
from .schemas import (
    StartAnnotationRequest,
    AnnotateRequest,
    SaveDraftRequest,
    RootCauseRequest,
    CompleteSessionRequest,
    VALID_ROOT_CAUSES,
)

router = APIRouter()


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
        "game_result": game.result.value if game.result else None,
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

    # Always get top engine lines (like Lichess): 3 for normal moves, 4 for critical
    num_pv = 4 if req.user_marked_critical else 3
    depth = 25 if req.user_marked_critical else 20
    engine_multipv = await engine.get_multipv(fen_before, num_pv=num_pv, depth=depth)
    pv_san = engine_multipv[0].get("pv_san", []) if engine_multipv else []

    best_move_san = move_eval.get("best_move_san", "")
    best_move_uci_val = move_eval.get("best_move_uci", "")
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

    # Build move entry (without explanation yet) and persist engine data immediately.
    # This ensures the reveal is saved even if the subsequent LLM call times out.
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
        "user_squares": req.user_squares,
        "user_arrows": req.user_arrows,
        "signal_flags": req.signal_flags,
        "mistake_reason": req.mistake_reason,
        "engine_eval_before": engine_eval_before,
        "engine_eval_after": engine_eval_after,
        "centipawn_loss": centipawn_loss,
        "classification": classification,
        "engine_best_move": best_move_san,
        "engine_best_move_uci": best_move_uci_val,
        "engine_pv_san": pv_san,
        "engine_multipv": engine_multipv,
        "patterns": patterns,
        "eval_verdict": verdict,
        "explanation": "",
        "draft": False,   # explicitly mark as submitted so save-draft can never overwrite it
    }

    moves_data = list(session.moves_data or [])
    existing_indices = [m["move_index"] for m in moves_data]
    if req.move_index in existing_indices:
        pos = existing_indices.index(req.move_index)
        moves_data[pos] = move_entry
    else:
        moves_data.append(move_entry)
    session.moves_data = moves_data
    flag_modified(session, "moves_data")
    await db.commit()

    # Return immediately — explanation is fetched separately via /explain-stream.
    return {
        "engine_eval_before": engine_eval_before,
        "engine_eval_after": engine_eval_after,
        "centipawn_loss": centipawn_loss,
        "classification": classification,
        "engine_best_move": best_move_san,
        "engine_best_move_uci": best_move_uci_val,
        "engine_pv_san": pv_san,
        "engine_multipv": engine_multipv,
        "patterns": patterns,
        "explanation": "",
        "eval_verdict": verdict,
        "user_squares": req.user_squares,
        "user_arrows": req.user_arrows,
    }


@router.post("/session/{session_id}/save-draft")
async def save_draft(
    session_id: int,
    req: SaveDraftRequest,
    db: AsyncSession = Depends(get_db),
):
    """
    Persist annotation form data without triggering engine analysis.
    Called automatically on navigation (fire-and-forget from the frontend).
    Never overwrites a submitted (non-draft) move entry.
    """
    session_result = await db.execute(
        select(AnnotationSession).where(AnnotationSession.id == session_id)
    )
    session = session_result.scalar_one_or_none()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    moves_data = list(session.moves_data or [])
    existing_idx_map = {m["move_index"]: i for i, m in enumerate(moves_data)}

    draft_entry = {
        "move_index": req.move_index,
        "user_annotation": req.user_annotation,
        "user_candidates": req.user_candidates,
        "user_eval_label": req.user_eval_label,
        "user_confidence": req.user_confidence,
        "user_marked_critical": req.user_marked_critical,
        "user_squares": req.user_squares,
        "user_arrows": req.user_arrows,
        "signal_flags": req.signal_flags,
        "mistake_reason": req.mistake_reason,
        "draft": True,
    }

    if req.move_index in existing_idx_map:
        pos = existing_idx_map[req.move_index]
        if moves_data[pos].get("draft", False):
            # Replace existing draft entry
            moves_data[pos] = draft_entry
        # If already submitted (draft key absent or False), leave it untouched
    else:
        moves_data.append(draft_entry)

    session.moves_data = moves_data
    flag_modified(session, "moves_data")
    await db.commit()
    return {"ok": True}


@router.post("/session/{session_id}/root-cause")
async def save_root_cause(
    session_id: int,
    req: RootCauseRequest,
    db: AsyncSession = Depends(get_db),
):
    """
    Save the player's post-reveal classification of why they missed the best move.
    Called after the engine reveal for mistakes/blunders. Fire-and-forget from frontend.
    """
    if req.root_cause not in VALID_ROOT_CAUSES:
        raise HTTPException(status_code=400, detail=f"Invalid root_cause: {req.root_cause}")

    session_result = await db.execute(
        select(AnnotationSession).where(AnnotationSession.id == session_id)
    )
    session = session_result.scalar_one_or_none()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    moves_data = list(session.moves_data or [])
    idx_map = {m["move_index"]: i for i, m in enumerate(moves_data)}

    if req.move_index not in idx_map:
        raise HTTPException(status_code=404, detail="Move not found in session")

    moves_data[idx_map[req.move_index]]["root_cause"] = req.root_cause
    session.moves_data = moves_data
    flag_modified(session, "moves_data")
    await db.commit()
    return {"ok": True}


@router.post("/session/{session_id}/complete")
async def complete_session(
    session_id: int,
    req: CompleteSessionRequest = CompleteSessionRequest(),
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
    annotated = [m for m in moves_data if not m.get("draft", False)]  # exclude unsaved drafts

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
    def _norm_san(s: str) -> str:
        """Strip check/checkmate symbols for lenient comparison."""
        return s.rstrip("+#") if s else s

    candidate_scores = []
    for m in annotated:
        candidates = [c for c in (m.get("user_candidates") or []) if c]
        multipv = m.get("engine_multipv")
        best_move = m.get("engine_best_move", "")
        if not candidates:
            continue
        norm_candidates = [_norm_san(c) for c in candidates]
        if best_move in candidates or _norm_san(best_move) in norm_candidates:
            candidate_scores.append(100)
        elif multipv and len(multipv) >= 2:
            rank2_moves = [line["move_san"] for line in multipv[1:3]]
            if any(r in candidates or _norm_san(r) in norm_candidates for r in rank2_moves):
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

    # ── Thinking profile — aggregate post-reveal root causes ──
    mistake_moves = [m for m in annotated if m.get("classification") in ("mistake", "blunder")]
    root_cause_dist: dict[str, int] = {}
    for m in mistake_moves:
        rc = m.get("root_cause", "")
        if rc:
            root_cause_dist[rc] = root_cause_dist.get(rc, 0) + 1
    total_classified = sum(root_cause_dist.values())
    dominant_cause = (
        max(root_cause_dist, key=root_cause_dist.get)
        if root_cause_dist else None
    )
    thinking_profile: dict = {
        "root_cause_distribution": root_cause_dist,
        "total_classified": total_classified,
        "total_mistakes": len(mistake_moves),
        "dominant_cause": dominant_cause,
        "narrative": None,
    }

    reflection = {
        "eval_accuracy_score": eval_accuracy_score,
        "candidate_quality_score": candidate_quality_score,
        "tactical_awareness_score": tactical_awareness_score,
        "confidence_calibration_score": confidence_calibration_score,
        "thinking_notes": thinking_notes,
        "thinking_profile": thinking_profile,
        "moves_reviewed": len(annotated),
        "total_moves": len(session.focused_move_indices or []),
    }

    # Load game result (needed for both thinking profile and questionnaire coaching)
    game_q = await db.execute(select(Game).where(Game.id == session.game_id))
    game_obj = game_q.scalar_one_or_none()
    game_result_str = game_obj.result.value if game_obj and game_obj.result else "unknown"

    # ── Thinking profile narrative (LLM) ──
    if total_classified >= 2 and dominant_cause:
        profile_narrative = await generate_thinking_profile(
            root_cause_distribution=root_cause_dist,
            total_classified=total_classified,
            dominant_cause=dominant_cause,
            game_result=game_result_str,
        )
        if profile_narrative:
            thinking_profile["narrative"] = profile_narrative
            reflection["thinking_profile"] = thinking_profile

    session.reflection = reflection
    if req.game_feelings:
        session.game_feelings = req.game_feelings

    # ── Questionnaire coaching from LLM ──
    # Extract worst moves and pattern types for grounded LLM context
    worst_moves_sorted = sorted(
        [m for m in moves_data if m.get("centipawn_loss", 0) > 0],
        key=lambda m: m.get("centipawn_loss", 0),
        reverse=True,
    )[:3]
    worst_moves_brief = [
        {
            "move_san": m["move_san"],
            "centipawn_loss": m["centipawn_loss"],
            "classification": m["classification"],
        }
        for m in worst_moves_sorted
    ]
    pattern_types = list({
        p["type"]
        for m in moves_data
        for p in (m.get("patterns") or [])
    })

    q = req.game_feelings or {}
    # Only call LLM if there's substantive questionnaire content to analyze
    has_questionnaire = bool(
        q.get("result_reason", "").strip() or q.get("takeaway", "").strip()
    )
    if has_questionnaire:
        questionnaire_coaching = await analyze_questionnaire(
            game_result=game_result_str,
            result_reason=q.get("result_reason", ""),
            key_moment=q.get("key_moment", ""),
            takeaway=q.get("takeaway", ""),
            would_do_differently=q.get("would_do_differently", ""),
            plan_adherence=q.get("plan_adherence", ""),
            time_pressure=q.get("time_pressure", ""),
            opening_prep=q.get("opening_prep", ""),
            worst_moves=worst_moves_brief,
            pattern_types=pattern_types,
        )
    else:
        questionnaire_coaching = None
    session.questionnaire_coaching = questionnaire_coaching
    flag_modified(session, "questionnaire_coaching")

    session.completed = True
    session.completed_at = datetime.utcnow()
    await db.commit()

    return {
        **reflection,
        "game_feelings": session.game_feelings,
        "questionnaire_coaching": questionnaire_coaching,
    }


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
