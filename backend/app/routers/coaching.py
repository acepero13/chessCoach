"""
Interactive coaching session endpoints.
"""
import asyncio
import chess
import random
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from pydantic import BaseModel
from typing import Optional

from app.database import get_db
from app.models import Game, GameAnalysis, CoachingSession, PerformanceProfile
from app.llm.explainer import explain_mistake, generate_position_question, generate_session_summary
from app.llm.coach_memory import (
    get_or_create_memory, generate_coach_opening,
    generate_game_arc, generate_mental_note, update_memory_after_session,
)
from app.engine.stockfish import get_engine
from app.patterns.tactical_detectors import _is_hanging
from app.patterns.imbalance_detector import (
    detect_imbalances, generate_plans, evaluate_plan_consistency,
    imbalances_to_display, PLAN_LABELS, PLAN_SUBTEXTS,
)


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

async def _get_candidate_moves(fen: str, engine, n_engine: int = 3, n_distractors: int = 5) -> list[dict]:
    """
    Get candidate moves for thinking capture: engine top N + random legal distractors.
    Returns list of {san, uci, is_engine_top}, shuffled.
    """
    board = chess.Board(fen)
    legal = list(board.legal_moves)

    # Engine top moves via MultiPV (lighter depth for speed)
    engine_lines = await engine.get_multipv(fen, num_pv=n_engine, depth=15)
    engine_uci_set = {l["move_uci"] for l in engine_lines}

    candidates = [
        {"san": l["move_san"], "uci": l["move_uci"], "is_engine_top": True}
        for l in engine_lines
    ]

    # Add distractor moves: random legal moves not in engine top
    non_engine = [m for m in legal if m.uci() not in engine_uci_set]
    random.shuffle(non_engine)
    for m in non_engine[:n_distractors]:
        try:
            candidates.append({
                "san": board.san(m),
                "uci": m.uci(),
                "is_engine_top": False,
            })
        except Exception:
            pass

    random.shuffle(candidates)
    return candidates


def _classify_thinking_errors(
    candidate_moves_selected: list[str],   # SANs selected by the user
    best_move_san: str,
    engine_top_sans: list[str],            # SANs of engine's top N moves
) -> list[dict]:
    """Classify thinking errors based on user's candidate selections."""
    if not candidate_moves_selected:
        return []

    errors = []

    # Missed Candidate: engine best not in user's selections
    if best_move_san and best_move_san not in candidate_moves_selected:
        errors.append({
            "type": "missed_candidate",
            "description": f"The engine's best move ({best_move_san}) was not in your candidate list.",
        })

    # Tunnel Vision: only 1 candidate selected
    if len(candidate_moves_selected) == 1:
        errors.append({
            "type": "tunnel_vision",
            "description": "You considered only one candidate move — try to generate at least 2–3 options before deciding.",
        })

    return errors


def _build_position_understanding(fen: str, user_color_str: str) -> dict:
    """Detect imbalances, generate plans, and build the full position understanding dict."""
    try:
        board = chess.Board(fen)
        uc = chess.WHITE if user_color_str == "white" else chess.BLACK
        imbalances = detect_imbalances(board, uc)
        plans = generate_plans(imbalances, uc)
        display = imbalances_to_display(imbalances, uc)
        plan_info = [
            {
                "key": p,
                "label": PLAN_LABELS.get(p, p.replace("_", " ").title()),
                "subtext": PLAN_SUBTEXTS.get(p, ""),
            }
            for p in plans
        ]
        return {
            "imbalances": imbalances,
            "imbalances_display": display,
            "recommended_plans": plans,
            "plans_display": plan_info,
        }
    except Exception as e:
        print(f"[imbalance] Detection failed: {e}")
        return {
            "imbalances": {},
            "imbalances_display": [],
            "recommended_plans": [],
            "plans_display": [],
        }


router = APIRouter(prefix="/coaching", tags=["coaching"])


class StartSessionRequest(BaseModel):
    user_id: int
    game_id: int


class AnswerRequest(BaseModel):
    user_answer: str = ""
    candidate_moves_selected: list[str] = []   # SANs of moves the user selected
    skipped: bool = False


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

    # Fetch latest profile scores for the coach opening
    profile_result = await db.execute(
        select(PerformanceProfile)
        .where(PerformanceProfile.user_id == req.user_id)
        .order_by(PerformanceProfile.created_at.desc())
        .limit(1)
    )
    profile = profile_result.scalar_one_or_none()
    current_scores = {}
    if profile:
        current_scores = {
            "attack":           profile.attack_score,
            "defense":          profile.defense_score,
            "opening":          profile.opening_score,
            "strategy":         profile.strategy_score,
            "endgame":          profile.endgame_score,
            "tactics":          profile.tactics_score,
            "time_management":  profile.time_management_score,
            "conversion":       profile.conversion_score,
            "mental_stability": profile.mental_stability_score,
        }

    # Coach memory: fetch/create, then generate personalized opening + game arc
    memory = await get_or_create_memory(req.user_id, db)
    game_info = {
        "opponent":      opponent or "opponent",
        "result":        str(game.result.value) if game.result else "unknown",
        "opening_name":  game.opening_name or "",
        "user_color":    user_color,
    }

    # Get first critical move (needed before spawning LLM tasks)
    first_idx = critical_indices[0]
    move_eval = evals[first_idx]
    patterns_at_move = _validated_patterns(
        analysis.patterns_detected or [],
        move_eval["move_number"],
        move_eval["fen"],
        move_eval.get("best_move_uci", ""),
    )

    # Get engine singleton (fast — already running)
    engine = await get_engine()

    # Run all LLM calls + engine MultiPV concurrently — previously sequential ~210s, now ~70s
    (coach_opening, game_arc, session_summary, question_data), candidate_moves = await asyncio.gather(
        asyncio.gather(
            generate_coach_opening(memory, current_scores, game_info),
            generate_game_arc(evals, user_color, game_info["result"]),
            generate_session_summary(
                user_color=user_color,
                opponent=opponent or "opponent",
                result=game.result or "unknown",
                total_mistakes=total_mistakes,
                total_blunders=total_blunders,
                top_pattern_types=top_patterns,
                worst_move=worst_move_summary,
            ),
            generate_position_question(
                fen=move_eval["fen"],
                pattern_type=patterns_at_move[0]["type"] if patterns_at_move else "general",
                move_number=move_eval["move_number"],
                color=move_eval["color"],
                best_move_san=move_eval.get("best_move_san", ""),
                centipawn_loss=move_eval.get("centipawn_loss", 0.0),
                classification=move_eval.get("classification", "mistake"),
            ),
        ),
        _get_candidate_moves(move_eval["fen"], engine),
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

    position_understanding = _build_position_understanding(move_eval["fen"], user_color)

    return {
        "session_id": session.id,
        "coach_opening": coach_opening,
        "game_arc": game_arc,
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
        "candidate_moves": candidate_moves,
        "position_understanding": position_understanding,
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

    # Classify thinking errors
    engine_top_sans = [move_eval.get("best_move_san", "")]  # engine best
    thinking_errors = _classify_thinking_errors(
        req.candidate_moves_selected,
        move_eval.get("best_move_san", ""),
        engine_top_sans,
    )

    # Position understanding (imbalances + plans) for the current position
    current_pu = _build_position_understanding(fen, user_color)

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
        thinking_errors=thinking_errors,
        imbalances=current_pu.get("imbalances"),
        recommended_plans=current_pu.get("recommended_plans"),
    )

    # Plan consistency: evaluate the move actually played in the game
    plan_consistency = None
    if current_pu["recommended_plans"] and move_eval.get("move_uci"):
        try:
            board_for_pc = chess.Board(fen)
            uc_color = chess.WHITE if user_color == "white" else chess.BLACK
            plan_consistency = evaluate_plan_consistency(
                move_eval["move_uci"],
                board_for_pc,
                current_pu["recommended_plans"],
                uc_color,
            )
        except Exception as e:
            print(f"[imbalance] Plan consistency failed: {e}")

    # Mental coaching note: player blundered from a winning position
    mental_note = None
    if move_eval["classification"] == "blunder" and move_eval.get("eval_before", 0) > 200:
        memory = await get_or_create_memory(session.user_id, db)
        mental_note = await generate_mental_note(
            move_san=move_eval["move_san"],
            eval_before=move_eval["eval_before"],
            classification=move_eval["classification"],
            recurring_patterns=memory.recurring_patterns or [],
        )

    # Save interaction (include eval_before so memory update can detect winning blunders)
    interaction = {
        "move_index": critical_indices[current_idx],
        "move_san": move_eval["move_san"],
        "eval_before": move_eval.get("eval_before", 0),
        "user_answer": req.user_answer,
        "candidate_moves_selected": req.candidate_moves_selected,
        "thinking_errors": thinking_errors,
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
        next_candidate_moves = await _get_candidate_moves(next_eval["fen"], engine)
        next_position = {
            "fen": next_eval["fen"],
            "move_number": next_eval["move_number"],
            "color": next_eval["color"],
            "eval_before": next_eval["eval_before"],
            "white_player": game.white_player,
            "black_player": game.black_player,
            "user_color": game.user_color,
        }
        next_pu = _build_position_understanding(next_eval["fen"], user_color)
        next_question = {**next_question_data, "candidate_moves": next_candidate_moves, "position_understanding": next_pu}

    return {
        "explanation": explanation,
        "mental_note": mental_note,
        # User's original written answer (for display in the reveal panel)
        "user_answer_text": req.user_answer,
        # Candidate moves the user selected (for display in the reveal panel)
        "candidate_moves_selected": req.candidate_moves_selected,
        # Thinking errors detected
        "thinking_errors": thinking_errors,
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
        # Position understanding (imbalances + plans + plan consistency)
        "position_understanding": current_pu,
        "plan_consistency": plan_consistency,
        "completed": is_complete,
        "next_position": next_position,
        "next_question": next_question,
        "progress": {
            "reviewed": current_idx + 1,
            "total": len(critical_indices),
        }
    }


@router.post("/session/{session_id}/close")
async def close_coaching_session(session_id: int, db: AsyncSession = Depends(get_db)):
    """
    Called by the frontend when the player leaves the session.
    Updates coach memory with patterns seen, score deltas, and increments session count.
    Safe to call multiple times (idempotent on session data).
    """
    session_result = await db.execute(select(CoachingSession).where(CoachingSession.id == session_id))
    session = session_result.scalar_one_or_none()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    # Fetch latest profile scores
    profile_result = await db.execute(
        select(PerformanceProfile)
        .where(PerformanceProfile.user_id == session.user_id)
        .order_by(PerformanceProfile.created_at.desc())
        .limit(1)
    )
    profile = profile_result.scalar_one_or_none()
    current_scores = {}
    if profile:
        current_scores = {
            "attack":           profile.attack_score,
            "defense":          profile.defense_score,
            "opening":          profile.opening_score,
            "strategy":         profile.strategy_score,
            "endgame":          profile.endgame_score,
            "tactics":          profile.tactics_score,
            "time_management":  profile.time_management_score,
            "conversion":       profile.conversion_score,
            "mental_stability": profile.mental_stability_score,
        }

    memory = await get_or_create_memory(session.user_id, db)
    # Coach asked about the training plan in the opening — mark it acknowledged
    memory.training_plan_pending = False
    await update_memory_after_session(
        memory=memory,
        interactions=session.interactions or [],
        game_id=session.game_id,
        current_scores=current_scores,
        db=db,
    )
    return {"ok": True, "sessions_completed": memory.sessions_completed}


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
