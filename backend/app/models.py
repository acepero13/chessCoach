from datetime import datetime
from sqlalchemy import (
    Column, Integer, String, Float, Boolean, Text,
    DateTime, ForeignKey, JSON, Enum as SAEnum
)
from sqlalchemy.orm import relationship
import enum
from app.database import Base


class ImportSource(str, enum.Enum):
    lichess = "lichess"
    chessdotcom = "chessdotcom"
    pgn_upload = "pgn_upload"


class GameResult(str, enum.Enum):
    win = "win"
    loss = "loss"
    draw = "draw"


class AnalysisStatus(str, enum.Enum):
    pending = "pending"
    running = "running"
    complete = "complete"
    failed = "failed"


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True)
    username = Column(String(100), nullable=False, unique=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    games = relationship("Game", back_populates="user", cascade="all, delete-orphan")
    profiles = relationship("PerformanceProfile", back_populates="user", cascade="all, delete-orphan")
    training_plans = relationship("TrainingPlan", back_populates="user", cascade="all, delete-orphan")


class Game(Base):
    __tablename__ = "games"

    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    external_id = Column(String(100))           # Lichess/Chess.com game ID
    source = Column(SAEnum(ImportSource), nullable=False)
    pgn = Column(Text, nullable=False)
    white_player = Column(String(100))
    black_player = Column(String(100))
    white_elo = Column(Integer)
    black_elo = Column(Integer)
    result = Column(SAEnum(GameResult))
    user_color = Column(String(5))              # "white" or "black"
    opening_eco = Column(String(10))
    opening_name = Column(String(200))
    time_control = Column(String(50))
    played_at = Column(DateTime)
    created_at = Column(DateTime, default=datetime.utcnow)

    analysis = relationship("GameAnalysis", back_populates="game", uselist=False, cascade="all, delete-orphan")
    user = relationship("User", back_populates="games")


class GameAnalysis(Base):
    __tablename__ = "game_analyses"

    id = Column(Integer, primary_key=True)
    game_id = Column(Integer, ForeignKey("games.id"), nullable=False)
    status = Column(SAEnum(AnalysisStatus), default=AnalysisStatus.pending)
    depth = Column(Integer)
    move_evaluations = Column(JSON)     # List of {move, fen, eval_before, eval_after, classification, best_move}
    patterns_detected = Column(JSON)    # List of {type, move_number, severity, description}
    centipawn_loss_avg = Column(Float)
    blunder_count = Column(Integer, default=0)
    mistake_count = Column(Integer, default=0)
    inaccuracy_count = Column(Integer, default=0)
    accuracy = Column(Float)
    created_at = Column(DateTime, default=datetime.utcnow)
    completed_at = Column(DateTime)

    game = relationship("Game", back_populates="analysis")


class PerformanceProfile(Base):
    __tablename__ = "performance_profiles"

    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    games_analyzed = Column(Integer, default=0)

    # 9 performance scores (0-100)
    attack_score = Column(Float, default=50.0)
    defense_score = Column(Float, default=50.0)
    opening_score = Column(Float, default=50.0)
    strategy_score = Column(Float, default=50.0)
    endgame_score = Column(Float, default=50.0)
    tactics_score = Column(Float, default=50.0)
    time_management_score = Column(Float, default=50.0)
    conversion_score = Column(Float, default=50.0)
    mental_stability_score = Column(Float, default=50.0)

    # Raw metrics stored for transparency
    raw_metrics = Column(JSON)

    created_at = Column(DateTime, default=datetime.utcnow)
    user = relationship("User", back_populates="profiles")


class CoachingSession(Base):
    __tablename__ = "coaching_sessions"

    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    game_id = Column(Integer, ForeignKey("games.id"), nullable=False)
    current_move_index = Column(Integer, default=0)
    completed = Column(Boolean, default=False)
    interactions = Column(JSON, default=list)   # List of {move_index, user_answer, engine_best, explanation}
    created_at = Column(DateTime, default=datetime.utcnow)


class TrainingPlan(Base):
    __tablename__ = "training_plans"

    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    profile_id = Column(Integer, ForeignKey("performance_profiles.id"), nullable=False)
    plan_data = Column(JSON)        # Full 4-week structured plan
    created_at = Column(DateTime, default=datetime.utcnow)

    user = relationship("User", back_populates="training_plans")
