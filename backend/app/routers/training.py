"""
Training plan endpoints.
"""
import json
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.database import get_db
from app.models import PerformanceProfile, TrainingPlan
from app.training.plan_generator import generate_training_plan, plan_to_dict
from app.llm.explainer import generate_batch_summary, stream_batch_summary
from app.llm.coach_memory import get_or_create_memory

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

    plan = generate_training_plan(profile_dict, raw_metrics=profile.raw_metrics or {})
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
    result = await db.execute(
        select(TrainingPlan)
        .where(TrainingPlan.user_id == user_id)
        .order_by(TrainingPlan.created_at.desc())
        .limit(1)
    )
    plan = result.scalar_one_or_none()
    if not plan:
        raise HTTPException(status_code=404, detail="No training plan found.")
    return {"plan_id": plan.id, "plan": plan.plan_data, "created_at": plan.created_at}


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
