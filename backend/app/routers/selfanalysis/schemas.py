"""
Pydantic request models for self-analysis endpoints.
"""
from pydantic import BaseModel, Field
from typing import Optional, Any


VALID_ROOT_CAUSES = {
    "never_considered", "rejected_wrong_reason",
    "miscalculated", "plan_disconnect", "time_pressure",
}


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


class RootCauseRequest(BaseModel):
    move_index: int
    root_cause: str


class CompleteSessionRequest(BaseModel):
    game_feelings: Optional[dict] = None   # {tags: list[str], note: str}


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
