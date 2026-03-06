"""
Performance profile computation and retrieval.
"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.database import get_db
from app.models import Game, GameAnalysis, PerformanceProfile, AnalysisStatus
from app.analysis.score_calculator import compute_all_scores
from app.analysis.game_selector import select_critical_games
from app.schemas.profile import PerformanceScoresResponse, ProfileSummary

router = APIRouter(prefix="/profile", tags=["profile"])


@router.post("/{user_id}/compute")
async def compute_profile(user_id: int, db: AsyncSession = Depends(get_db)):
    """
    Compute (or recompute) performance profile from all analyzed games.
    """
    # Fetch all completed analyses for user's games
    games_result = await db.execute(
        select(Game).where(Game.user_id == user_id)
    )
    games = games_result.scalars().all()
    game_ids = [g.id for g in games]

    if not game_ids:
        raise HTTPException(status_code=404, detail="No games found for user")

    analyses_result = await db.execute(
        select(GameAnalysis).where(
            GameAnalysis.game_id.in_(game_ids),
            GameAnalysis.status == AnalysisStatus.complete,
        )
    )
    analyses = analyses_result.scalars().all()

    if not analyses:
        raise HTTPException(status_code=400, detail="No completed analyses found. Run batch analysis first.")

    game_result_map = {g.id: g.result.value if g.result else "draw" for g in games}
    game_color_map = {g.id: g.user_color for g in games}

    analysis_dicts = []
    for a in analyses:
        d = {
            "game_id": a.game_id,
            "move_evaluations": a.move_evaluations or [],
            "patterns_detected": a.patterns_detected or [],
            "blunder_count": a.blunder_count or 0,
            "mistake_count": a.mistake_count or 0,
            "centipawn_loss_avg": a.centipawn_loss_avg or 0.0,
            "accuracy": a.accuracy or 0.0,
            "result": game_result_map.get(a.game_id, "draw"),
            "user_color": game_color_map.get(a.game_id, "white"),
        }
        analysis_dicts.append(d)

    scores = compute_all_scores(analysis_dicts)

    # Save profile
    profile = PerformanceProfile(
        user_id=user_id,
        games_analyzed=len(analyses),
        attack_score=scores.attack,
        defense_score=scores.defense,
        opening_score=scores.opening,
        strategy_score=scores.strategy,
        endgame_score=scores.endgame,
        tactics_score=scores.tactics,
        time_management_score=scores.time_management,
        conversion_score=scores.conversion,
        mental_stability_score=scores.mental_stability,
        raw_metrics=scores.raw_metrics,
    )
    db.add(profile)
    await db.commit()
    await db.refresh(profile)

    return {
        "profile_id": profile.id,
        "games_analyzed": len(analyses),
        "scores": {
            "attack": scores.attack,
            "defense": scores.defense,
            "opening": scores.opening,
            "strategy": scores.strategy,
            "endgame": scores.endgame,
            "tactics": scores.tactics,
            "time_management": scores.time_management,
            "conversion": scores.conversion,
            "mental_stability": scores.mental_stability,
        }
    }


@router.get("/{user_id}/latest", response_model=PerformanceScoresResponse)
async def get_latest_profile(user_id: int, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(PerformanceProfile)
        .where(PerformanceProfile.user_id == user_id)
        .order_by(PerformanceProfile.created_at.desc())
        .limit(1)
    )
    profile = result.scalar_one_or_none()
    if not profile:
        raise HTTPException(status_code=404, detail="No profile found. Run batch analysis first.")
    return profile


@router.get("/{user_id}/history")
async def get_profile_history(user_id: int, db: AsyncSession = Depends(get_db)):
    """Return all profile snapshots for a user, oldest first (for trend charts)."""
    result = await db.execute(
        select(PerformanceProfile)
        .where(PerformanceProfile.user_id == user_id)
        .order_by(PerformanceProfile.created_at.asc())
    )
    profiles = result.scalars().all()
    return [
        {
            "id": p.id,
            "created_at": p.created_at.isoformat() if p.created_at else None,
            "games_analyzed": p.games_analyzed,
            "attack": p.attack_score,
            "defense": p.defense_score,
            "opening": p.opening_score,
            "strategy": p.strategy_score,
            "endgame": p.endgame_score,
            "tactics": p.tactics_score,
            "time_management": p.time_management_score,
            "conversion": p.conversion_score,
            "mental_stability": p.mental_stability_score,
        }
        for p in profiles
    ]


@router.get("/{user_id}/pattern-stats")
async def get_pattern_stats(user_id: int, db: AsyncSession = Depends(get_db)):
    """Aggregate user-side pattern counts across all analyzed games."""
    games_result = await db.execute(select(Game).where(Game.user_id == user_id))
    games = games_result.scalars().all()
    game_ids = [g.id for g in games]

    if not game_ids:
        return {"patterns": [], "total_games": 0}

    analyses_result = await db.execute(
        select(GameAnalysis).where(
            GameAnalysis.game_id.in_(game_ids),
            GameAnalysis.status == AnalysisStatus.complete,
        )
    )
    analyses = analyses_result.scalars().all()
    game_color_map = {g.id: g.user_color for g in games}

    pattern_counts: dict[str, int] = {}
    for a in analyses:
        user_color = game_color_map.get(a.game_id, "white")
        for p in (a.patterns_detected or []):
            if p.get("color") == user_color:
                ptype = p.get("type", "unknown")
                pattern_counts[ptype] = pattern_counts.get(ptype, 0) + 1

    patterns = sorted(
        [{"type": k, "count": v} for k, v in pattern_counts.items()],
        key=lambda x: -x["count"],
    )
    return {"patterns": patterns, "total_games": len(analyses)}


@router.get("/{user_id}/select-games")
async def select_games_for_coaching(
    user_id: int,
    n: int = 7,
    db: AsyncSession = Depends(get_db),
):
    """Select the most instructive games for a coaching session."""
    # Get latest profile
    profile_result = await db.execute(
        select(PerformanceProfile)
        .where(PerformanceProfile.user_id == user_id)
        .order_by(PerformanceProfile.created_at.desc())
        .limit(1)
    )
    profile = profile_result.scalar_one_or_none()
    if not profile:
        raise HTTPException(status_code=404, detail="Profile not found. Run analysis first.")

    profile_scores = {
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

    # Get all analyses
    games_result = await db.execute(
        select(Game).where(Game.user_id == user_id)
    )
    games = games_result.scalars().all()
    game_ids = [g.id for g in games]

    analyses_result = await db.execute(
        select(GameAnalysis).where(
            GameAnalysis.game_id.in_(game_ids),
            GameAnalysis.status == AnalysisStatus.complete,
        )
    )
    analyses = analyses_result.scalars().all()

    game_map = {g.id: g for g in games}
    analysis_dicts = [
        {
            "game_id": a.game_id,
            "move_evaluations": a.move_evaluations or [],
            "patterns_detected": a.patterns_detected or [],
            "blunder_count": a.blunder_count or 0,
            "centipawn_loss_avg": a.centipawn_loss_avg or 0.0,
            "result": game_map[a.game_id].result.value if game_map[a.game_id].result else "draw",
            "user_color": game_map[a.game_id].user_color or "white",
        }
        for a in analyses if a.game_id in game_map
    ]

    selected = select_critical_games(profile_scores, analysis_dicts, n=n)

    return {
        "selected_games": [
            {
                "game_id": gs.game_id,
                "relevance_score": gs.relevance_score,
                "weaknesses_manifested": gs.weaknesses_manifested,
                "centipawn_loss_avg": gs.centipawn_loss_avg,
                "blunder_count": gs.blunder_count,
            }
            for gs in selected
        ]
    }
