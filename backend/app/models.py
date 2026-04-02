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


class AnnotationSession(Base):
    __tablename__ = "annotation_sessions"

    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    game_id = Column(Integer, ForeignKey("games.id"), nullable=False)
    time_budget_minutes = Column(Integer, default=30)
    focused_move_indices = Column(JSON, default=list)   # list[int]: indices into move_evaluations
    moves_data = Column(JSON, default=list)             # list[dict]: per-move annotation + engine data
    reflection = Column(JSON)                           # {eval_accuracy, candidate_quality, ...}
    game_feelings = Column(JSON)                        # full questionnaire JSON
    questionnaire_coaching = Column(JSON)               # LLM coaching feedback on questionnaire
    completed = Column(Boolean, default=False)
    started_at = Column(DateTime, default=datetime.utcnow)
    completed_at = Column(DateTime)


class CoachMemory(Base):
    """Persistent coach memory — what the coach knows about this player across sessions."""
    __tablename__ = "coach_memory"

    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, unique=True)

    # Coach's evolving understanding of the player
    player_narrative = Column(Text)                  # 1-2 sentence coach note: who is this player
    recurring_patterns = Column(JSON, default=list)  # ["rushes when winning", "misses forks", ...]
    last_session_focus = Column(JSON)                # {patterns, key_lesson, game_id, session_number}
    previous_scores = Column(JSON)                   # last known profile scores for delta computation

    sessions_completed = Column(Integer, default=0)
    training_plan_pending = Column(Boolean, default=False)  # plan assigned but not acknowledged
    last_seen = Column(DateTime)
    updated_at = Column(DateTime, default=datetime.utcnow)


class MentalTutorSession(Base):
    __tablename__ = "mental_tutor_sessions"

    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    game_id = Column(Integer, ForeignKey("games.id"), nullable=True)
    starting_fen = Column(Text, nullable=False)
    starting_eval = Column(Float)
    user_color = Column(String(5))
    max_moves = Column(Integer, default=6)
    moves_data = Column(JSON, default=list)
    eval_progression = Column(JSON, default=list)
    mental_errors = Column(JSON, default=list)
    result = Column(String(20), default="in_progress")  # "converted"/"failed"/"partial"/"in_progress"
    coaching = Column(Text)
    game_result = Column(String(10))  # actual game result
    completed = Column(Boolean, default=False)
    started_at = Column(DateTime, default=datetime.utcnow)
    completed_at = Column(DateTime)


class DrillResult(Base):
    """One completed calculation drill (one position evaluated)."""
    __tablename__ = "drill_results"

    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    game_id = Column(Integer, ForeignKey("games.id"), nullable=True)
    # Position context
    classification = Column(String(20))         # "blunder" | "mistake"
    centipawn_loss = Column(Float)
    # Result
    accuracy = Column(Integer)                  # 0–100
    correct_moves = Column(Integer)
    depth_reached = Column(Integer)
    error_classification = Column(String(40))   # "good_calculation" | "missed_forcing_move" | …
    missed_forcing_move = Column(Boolean, default=False)
    created_at = Column(DateTime, default=datetime.utcnow)


class ReviewCard(Base):
    """Spaced-repetition puzzle card — one critical position the user must solve."""
    __tablename__ = "review_cards"

    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)

    # Position
    fen = Column(Text, nullable=False)
    correct_move_uci = Column(String(10), nullable=False)   # e.g. "e2e4"
    correct_move_san = Column(String(20))                   # e.g. "e4"
    user_color = Column(String(5))                          # "white" | "black"

    # Context (for the reveal screen)
    source = Column(String(20))          # "coaching" | "selfanalysis" | "drill"
    error_type = Column(String(40))      # missed_fork, blunder, etc.
    centipawn_loss = Column(Float)
    engine_pv_san = Column(JSON)         # first few engine moves for reveal

    # SM-2 scheduling
    repetition_count = Column(Integer, default=0)   # times answered correctly in a row
    interval_days = Column(Integer, default=1)       # current interval
    ease_factor = Column(Float, default=2.5)         # SM-2 ease
    next_review_at = Column(DateTime, nullable=False)
    last_reviewed_at = Column(DateTime)

    created_at = Column(DateTime, default=datetime.utcnow)


class Puzzle(Base):
    __tablename__ = "puzzles"
    id = Column(Integer, primary_key=True)
    source = Column(String(100), nullable=False)
    fen = Column(Text, nullable=False, unique=True)
    title = Column(String(200))
    best_move_uci = Column(String(10))       # None until engine analyzed
    best_move_san = Column(String(20))
    solution_path = Column(JSON)             # Full PV as list of UCI strings, e.g. ["e2e4","e7e5","d2d4"]
    motif = Column(String(40))               # fork, pin, discovered_attack, checkmate, hanging_piece, sacrifice, combination, check
    difficulty_tier = Column(Integer, default=1)  # 1=easy, 2=medium, 3=hard
    total_attempts = Column(Integer, default=0)
    total_correct = Column(Integer, default=0)
    created_at = Column(DateTime, default=datetime.utcnow)


class PuzzleProgress(Base):
    __tablename__ = "puzzle_progress"
    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    puzzle_id = Column(Integer, ForeignKey("puzzles.id"), nullable=False)
    next_review_at = Column(DateTime, nullable=False, default=datetime.utcnow)
    interval_days = Column(Float, default=0)
    ease_factor = Column(Float, default=2.5)
    repetition_count = Column(Integer, default=0)
    attempts = Column(Integer, default=0)
    correct = Column(Integer, default=0)
    last_solve_time = Column(Float)
    confidence = Column(String(10))          # "high", "medium", "none"
    created_at = Column(DateTime, default=datetime.utcnow)


class PuzzleAttempt(Base):
    __tablename__ = "puzzle_attempts"
    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    puzzle_id = Column(Integer, ForeignKey("puzzles.id"), nullable=False)
    solved = Column(Boolean, nullable=False)
    solve_time = Column(Float, nullable=False)
    motif_guess = Column(String(40))
    motif_correct = Column(Boolean)
    created_at = Column(DateTime, default=datetime.utcnow)
