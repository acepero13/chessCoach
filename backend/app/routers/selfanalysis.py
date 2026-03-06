"""
Guided Self-Annotation Mode endpoints.
Users review their own game move-by-move, writing annotations and candidate moves
BEFORE the engine reveal. Engine evaluation stays hidden until user commits reasoning.
"""
import chess
import re
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, desc
from pydantic import BaseModel, Field
from typing import Optional, Any

from sqlalchemy.orm.attributes import flag_modified

from app.database import get_db
from app.models import Game, GameAnalysis, AnnotationSession
import asyncio
from app.llm.explainer import explain_annotation, generate_review_comment, generate_review_reply, analyze_questionnaire, coach_chat_turn
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


def _strip_html(text: str) -> str:
    """Strip HTML tags from user annotation before passing to LLM."""
    if not text:
        return text
    return re.sub(r'<[^>]+>', ' ', text).strip()


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
            # Engine data from batch analysis — available for every move
            "best_move_uci": e.get("best_move_uci", ""),
            "best_move_san": e.get("best_move_san", ""),
            "eval_before": e.get("eval_before", 0.0),
            "eval_after": e.get("eval_after", 0.0),
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


class SaveDraftRequest(BaseModel):
    move_index: int
    user_annotation: str = ""
    user_candidates: list[str] = Field(default_factory=list)
    user_eval_label: str = ""
    user_confidence: int = 0
    user_marked_critical: bool = False
    user_squares: dict[str, Any] = Field(default_factory=dict)
    user_arrows: list[dict[str, Any]] = Field(default_factory=list)
    signal_flags: dict[str, Any] = Field(default_factory=dict)
    mistake_reason: str = ""


class AnnotateRequest(BaseModel):
    move_index: int
    user_annotation: str = ""
    user_candidates: list[str] = []
    user_eval_label: str = ""       # "winning"/"better"/"equal"/"worse"/"losing"
    user_confidence: int = 0        # 1–5, 0 = not set
    user_marked_critical: bool = False
    user_squares: dict[str, Any] = Field(default_factory=dict)   # { square: cssColor }
    user_arrows: list[dict[str, Any]] = Field(default_factory=list)  # [{startSquare, endSquare, color}]
    signal_flags: dict[str, Any] = Field(default_factory=dict)   # { lpdo, geometry, kingSafety }
    mistake_reason: str = ""        # "tactical_blindness"/"laziness"/"impatience"/"noise_overload"


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

    # LLM explanation — runs after engine data is already committed.
    # If it times out or fails, the reveal still works; explanation is just empty.
    explanation = await explain_annotation(
        move_san=move_eval.get("move_san", ""),
        best_move_san=best_move_san,
        centipawn_loss=centipawn_loss,
        classification=classification,
        user_annotation=_strip_html(req.user_annotation),
        user_eval_label=req.user_eval_label,
        eval_verdict=verdict,
        user_candidates=req.user_candidates,
        engine_pv_san=pv_san,
        patterns=patterns,
    )

    # Patch explanation into the stored entry if LLM succeeded
    if explanation:
        move_entry["explanation"] = explanation
        session.moves_data = moves_data  # already mutated in place above
        flag_modified(session, "moves_data")
        await db.commit()

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
        "explanation": explanation,
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


class CompleteSessionRequest(BaseModel):
    game_feelings: Optional[dict] = None   # {tags: list[str], note: str}


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

    # Load game result for the prompt
    game_q = await db.execute(select(Game).where(Game.id == session.game_id))
    game_obj = game_q.scalar_one_or_none()
    game_result_str = game_obj.result.value if game_obj and game_obj.result else "unknown"

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


class CoachReviewReplyRequest(BaseModel):
    move_index: int
    move_san: str
    engine_best_move: str
    engine_pv_san: list[str]
    coach_comment: str
    user_response: str


class CoachChatRequest(BaseModel):
    move_index: int
    messages: list[dict]   # [{role: "user"|"assistant", content: str}]


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
    # Only count truly submitted (non-draft) entries as annotated
    annotated_move_indices = [m["move_index"] for m in moves_data if not m.get("draft", False)]

    return {
        "session_id": session.id,
        "game_id": game_id,
        "completed": session.completed,
        "white_player": game.white_player,
        "black_player": game.black_player,
        "user_color": user_color,
        "game_result": game.result.value if game.result else None,
        "time_budget_minutes": session.time_budget_minutes,
        "suggested_minutes_per_move": suggested_minutes_per_move,
        "total_user_moves": total_user_moves,
        "all_game_moves": all_game_moves,
        "annotated_move_indices": annotated_move_indices,
        "moves_data": moves_data,
        "reflection": session.reflection,
        "game_feelings": session.game_feelings,
        "questionnaire_coaching": session.questionnaire_coaching,
    }


@router.get("/user/{user_id}/sessions")
async def list_user_sessions(
    user_id: int,
    db: AsyncSession = Depends(get_db),
):
    """
    List all annotation sessions for a user, newest first.
    Returns summary cards suitable for a history view.
    """
    sessions_result = await db.execute(
        select(AnnotationSession)
        .where(AnnotationSession.user_id == user_id)
        .order_by(desc(AnnotationSession.started_at))
    )
    sessions = sessions_result.scalars().all()

    items = []
    for s in sessions:
        game_result = await db.execute(select(Game).where(Game.id == s.game_id))
        game = game_result.scalar_one_or_none()
        if not game:
            continue

        moves_data = s.moves_data or []
        submitted = [m for m in moves_data if not m.get("draft", False)]
        reflection = s.reflection or {}

        pattern_counts: dict[str, int] = {}
        for m in submitted:
            for p in (m.get("patterns") or []):
                ptype = p.get("type", "")
                if ptype:
                    pattern_counts[ptype] = pattern_counts.get(ptype, 0) + 1

        items.append({
            "session_id": s.id,
            "game_id": s.game_id,
            "white_player": game.white_player,
            "black_player": game.black_player,
            "user_color": game.user_color,
            "game_result": game.result.value if game.result else None,
            "completed": s.completed,
            "started_at": s.started_at.isoformat() if s.started_at else None,
            "completed_at": s.completed_at.isoformat() if s.completed_at else None,
            "moves_reviewed": len(submitted),
            "total_user_moves": len(s.focused_move_indices or []),
            "eval_accuracy_score": reflection.get("eval_accuracy_score"),
            "candidate_quality_score": reflection.get("candidate_quality_score"),
            "tactical_awareness_score": reflection.get("tactical_awareness_score"),
            "confidence_calibration_score": reflection.get("confidence_calibration_score"),
            "top_patterns": sorted(pattern_counts.items(), key=lambda x: -x[1])[:3],
        })

    return {"sessions": items, "total": len(items)}
