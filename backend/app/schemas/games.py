from pydantic import BaseModel, Field
from datetime import datetime
from typing import Optional
from enum import Enum


class ImportSource(str, Enum):
    lichess = "lichess"
    chessdotcom = "chessdotcom"
    pgn_upload = "pgn_upload"


class LichessImportRequest(BaseModel):
    username: str
    max_games: int = Field(default=40, ge=1, le=200)
    perf_type: Optional[str] = None     # "blitz", "rapid", "classical", etc.


class ChessComImportRequest(BaseModel):
    username: str
    max_games: int = Field(default=40, ge=1, le=200)
    year: Optional[int] = None
    month: Optional[int] = None


class GameResponse(BaseModel):
    id: int
    external_id: Optional[str]
    source: str
    white_player: Optional[str]
    black_player: Optional[str]
    white_elo: Optional[int]
    black_elo: Optional[int]
    result: Optional[str]
    user_color: Optional[str]
    opening_eco: Optional[str]
    opening_name: Optional[str]
    time_control: Optional[str]
    played_at: Optional[datetime]
    has_analysis: bool

    class Config:
        from_attributes = True


class AnalyzeRequest(BaseModel):
    game_ids: list[int]
    depth: int = Field(default=18, ge=10, le=24)


class AnalysisStatusResponse(BaseModel):
    game_id: int
    status: str
    accuracy: Optional[float]
    blunder_count: Optional[int]
    mistake_count: Optional[int]
    inaccuracy_count: Optional[int]
    centipawn_loss_avg: Optional[float]
