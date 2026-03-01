from pydantic import BaseModel
from datetime import datetime
from typing import Optional


class PerformanceScoresResponse(BaseModel):
    id: int
    user_id: int
    games_analyzed: int
    attack_score: float
    defense_score: float
    opening_score: float
    strategy_score: float
    endgame_score: float
    tactics_score: float
    time_management_score: float
    conversion_score: float
    mental_stability_score: float
    created_at: datetime

    class Config:
        from_attributes = True


class ProfileSummary(BaseModel):
    profile: PerformanceScoresResponse
    top_weaknesses: list[str]
    top_strengths: list[str]
    summary_text: Optional[str] = None
