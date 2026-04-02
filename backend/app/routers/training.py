"""
Training plan endpoints.
"""
import json
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, Integer as SAInteger, cast as sa_cast
from app.database import get_db
from app.models import PerformanceProfile, TrainingPlan, Game, GameAnalysis, PuzzleAttempt, PuzzleProgress, Puzzle
from app.training.plan_generator import generate_training_plan, plan_to_dict
from app.llm.explainer import generate_batch_summary, stream_batch_summary
from app.llm.coach_memory import get_or_create_memory
from app.analysis.endgame_analyzer import analyze_endgame_performance

router = APIRouter(prefix="/training", tags=["training"])


@router.post("/{user_id}/generate-plan")
async def generate_plan(user_id: int, db: AsyncSession = Depends(get_db)):
    """Generate a 4-week training plan from the user's latest performance profile."""
    result = await db.execute(
        select(PerformanceProfile)
        .where(PerformanceProfile.user_id == user_id)
        .order_by(PerformanceProfile.created_at.desc())
        .limit(1)
    )
    profile = result.scalar_one_or_none()
    if not profile:
        raise HTTPException(status_code=404, detail="No profile found. Run analysis first.")

    profile_dict = {
        "attack_score": profile.attack_score,
        "defense_score": profile.defense_score,
        "opening_score": profile.opening_score,
        "strategy_score": profile.strategy_score,
        "endgame_score": profile.endgame_score,
        "tactics_score": profile.tactics_score,
        "time_management_score": profile.time_management_score,
        "conversion_score": profile.conversion_score,
        "mental_stability_score": profile.mental_stability_score,
    }

    # Compute endgame profile to feed category-specific drills
    eg_rows = await db.execute(
        select(Game, GameAnalysis)
        .join(GameAnalysis, GameAnalysis.game_id == Game.id)
        .where(Game.user_id == user_id, GameAnalysis.status == "complete")
    )
    endgame_profile = None
    try:
        games_data = [
            {"result": g.result, "user_color": g.user_color, "move_evaluations": a.move_evaluations or []}
            for g, a in eg_rows.all()
        ]
        if games_data:
            endgame_profile = analyze_endgame_performance(games_data)
    except Exception:
        pass  # non-critical — plan still works without it

    # Build puzzle stats for the plan generator
    puzzle_stats: dict | None = None
    try:
        now = datetime.now(timezone.utc)

        # Per-motif attempt accuracy (keyed by puzzle's actual motif)
        motif_rows = await db.execute(
            select(
                Puzzle.motif,
                func.count(PuzzleAttempt.id).label("attempts"),
                func.sum(sa_cast(PuzzleAttempt.solved, SAInteger)).label("correct"),
            )
            .join(Puzzle, Puzzle.id == PuzzleAttempt.puzzle_id)
            .where(
                PuzzleAttempt.user_id == user_id,
                Puzzle.motif.isnot(None),
            )
            .group_by(Puzzle.motif)
        )
        motif_accuracy: dict[str, float] = {}
        motif_attempts: dict[str, int] = {}
        for row in motif_rows.all():
            motif = row[0]
            attempts = row[1] or 0
            correct = row[2] or 0
            if motif and attempts > 0:
                motif_accuracy[motif] = correct / attempts
                motif_attempts[motif] = attempts

        # Recommended motif: lowest accuracy with ≥5 attempts; fallback to most attempts
        ranked = sorted(
            [(m, acc) for m, acc in motif_accuracy.items() if motif_attempts.get(m, 0) >= 5],
            key=lambda x: x[1],
        )
        recommended_motif = ranked[0][0] if ranked else (
            max(motif_attempts, key=motif_attempts.get) if motif_attempts else None
        )

        # Due puzzles count
        due_result = await db.execute(
            select(func.count(PuzzleProgress.id)).where(
                PuzzleProgress.user_id == user_id,
                PuzzleProgress.next_review_at <= now,
            )
        )
        due_count = due_result.scalar() or 0

        puzzle_stats = {
            "motif_accuracy": motif_accuracy,
            "motif_attempts": motif_attempts,
            "recommended_motif": recommended_motif,
            "due_count": due_count,
        }
    except Exception:
        pass  # non-critical — plan still works without puzzle stats

    plan = generate_training_plan(profile_dict, raw_metrics=profile.raw_metrics or {}, endgame_profile=endgame_profile, puzzle_stats=puzzle_stats)
    plan_dict = plan_to_dict(plan)

    # Save plan
    training_plan = TrainingPlan(
        user_id=user_id,
        profile_id=profile.id,
        plan_data=plan_dict,
    )
    db.add(training_plan)
    await db.commit()
    await db.refresh(training_plan)

    # Tell coach memory a plan was assigned — the coach will ask about it next session
    memory = await get_or_create_memory(user_id, db)
    memory.training_plan_pending = True
    await db.commit()

    return {"plan_id": training_plan.id, "plan": plan_dict}


@router.get("/{user_id}/latest-plan")
async def get_latest_plan(user_id: int, db: AsyncSession = Depends(get_db)):
    plan_result = await db.execute(
        select(TrainingPlan)
        .where(TrainingPlan.user_id == user_id)
        .order_by(TrainingPlan.created_at.desc())
        .limit(1)
    )
    plan = plan_result.scalar_one_or_none()
    if not plan:
        raise HTTPException(status_code=404, detail="No training plan found.")

    # Check if plan is stale (profile updated after plan was generated)
    profile_result = await db.execute(
        select(PerformanceProfile)
        .where(PerformanceProfile.user_id == user_id)
        .order_by(PerformanceProfile.created_at.desc())
        .limit(1)
    )
    profile = profile_result.scalar_one_or_none()
    stale = profile is not None and profile.created_at > plan.created_at

    return {
        "plan_id": plan.id,
        "plan": plan.plan_data,
        "created_at": plan.created_at,
        "stale": stale,
    }


@router.post("/{user_id}/summary")
async def get_performance_summary(user_id: int, db: AsyncSession = Depends(get_db)):
    """Generate an LLM-powered narrative summary from the performance profile."""
    result = await db.execute(
        select(PerformanceProfile)
        .where(PerformanceProfile.user_id == user_id)
        .order_by(PerformanceProfile.created_at.desc())
        .limit(1)
    )
    profile = result.scalar_one_or_none()
    if not profile:
        raise HTTPException(status_code=404, detail="No profile found.")

    scores = {
        "attack": profile.attack_score,
        "defense": profile.defense_score,
        "opening": profile.opening_score,
        "strategy": profile.strategy_score,
        "endgame": profile.endgame_score,
        "tactics": profile.tactics_score,
        "time_management": profile.time_management_score,
        "conversion": profile.conversion_score,
        "mental_stability": profile.mental_stability_score,
    }

    raw = profile.raw_metrics or {}
    # Build representative patterns from raw metrics
    patterns = []
    if raw.get("missed_forks", 0) > 0:
        patterns.extend([{"type": "missed_fork"}] * raw["missed_forks"])
    if raw.get("missed_pins", 0) > 0:
        patterns.extend([{"type": "missed_pin"}] * raw["missed_pins"])
    if raw.get("strategic_drifts", 0) > 0:
        patterns.extend([{"type": "strategic_drift"}] * raw["strategic_drifts"])

    summary = await generate_batch_summary(
        scores=scores,
        top_patterns=patterns,
        games_analyzed=profile.games_analyzed,
        raw_metrics=raw,
    )

    return {"summary": summary, "scores": scores}


@router.post("/{user_id}/summary-stream")
async def get_performance_summary_stream(user_id: int, db: AsyncSession = Depends(get_db)):
    """Stream an LLM-powered narrative summary from the performance profile."""
    result = await db.execute(
        select(PerformanceProfile)
        .where(PerformanceProfile.user_id == user_id)
        .order_by(PerformanceProfile.created_at.desc())
        .limit(1)
    )
    profile = result.scalar_one_or_none()
    if not profile:
        raise HTTPException(status_code=404, detail="No profile found.")

    scores = {
        "attack": profile.attack_score,
        "defense": profile.defense_score,
        "opening": profile.opening_score,
        "strategy": profile.strategy_score,
        "endgame": profile.endgame_score,
        "tactics": profile.tactics_score,
        "time_management": profile.time_management_score,
        "conversion": profile.conversion_score,
        "mental_stability": profile.mental_stability_score,
    }

    raw = profile.raw_metrics or {}
    patterns = []
    if raw.get("missed_forks", 0) > 0:
        patterns.extend([{"type": "missed_fork"}] * raw["missed_forks"])
    if raw.get("missed_pins", 0) > 0:
        patterns.extend([{"type": "missed_pin"}] * raw["missed_pins"])
    if raw.get("strategic_drifts", 0) > 0:
        patterns.extend([{"type": "strategic_drift"}] * raw["strategic_drifts"])

    async def event_stream():
        async for chunk in stream_batch_summary(
            scores=scores,
            top_patterns=patterns,
            games_analyzed=profile.games_analyzed,
            raw_metrics=raw,
        ):
            yield f"data: {json.dumps({'text': chunk})}\n\n"
        yield "data: [DONE]\n\n"

    return StreamingResponse(event_stream(), media_type="text/event-stream")
