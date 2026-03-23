"""
Spaced-Repetition Review — personal puzzle bank.

Cards are seeded from:
  - CoachingSession.interactions  (coaching blunders reviewed with the coach)
  - AnnotationSession.moves_data  (self-analysis mistakes)
  - DrillResult rows              (drill positions, linked back to game analysis)

SM-2-style scheduling:
  Correct:  interval *= ease_factor  (min 1 day → 3 → 7 → 14 → 30)
  Wrong:    reset to interval=1, repetition_count=0
"""
import chess
from datetime import datetime, timedelta
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from pydantic import BaseModel

from app.database import get_db
from app.models import (
    ReviewCard, CoachingSession, AnnotationSession,
    Game, GameAnalysis,
)

router = APIRouter(prefix="/review", tags=["review"])

# Fixed interval ladder (days) — SM-2 simplified
_INTERVALS = [1, 3, 7, 14, 30, 60]


def _next_interval(card: ReviewCard, correct: bool) -> int:
    if not correct:
        return 1
    idx = min(card.repetition_count, len(_INTERVALS) - 1)
    return _INTERVALS[idx]


def _fen_side(fen: str) -> str:
    """Return 'white' or 'black' based on the side to move in the FEN."""
    try:
        return "white" if chess.Board(fen).turn == chess.WHITE else "black"
    except Exception:
        return "white"


# ---------------------------------------------------------------------------
# Seed helpers
# ---------------------------------------------------------------------------

async def _seed_from_coaching(user_id: int, db: AsyncSession, existing_fens: set[str]) -> list[ReviewCard]:
    """
    Coaching interactions store move_index + game_id but not the FEN directly.
    We look up the FEN and best move from the game's move_evaluations.
    """
    q = await db.execute(
        select(CoachingSession).where(CoachingSession.user_id == user_id)
    )
    sessions = q.scalars().all()
    cards = []
    for session in sessions:
        # Fetch game analysis once per session
        analysis_q = await db.execute(
            select(GameAnalysis).where(GameAnalysis.game_id == session.game_id)
        )
        analysis = analysis_q.scalar_one_or_none()
        if not analysis or analysis.status.value != "complete":
            continue
        evals = analysis.move_evaluations or []

        game_q = await db.execute(select(Game).where(Game.id == session.game_id))
        game = game_q.scalar_one_or_none()
        user_color = game.user_color if game else "white"

        for interaction in (session.interactions or []):
            move_idx = interaction.get("move_index")
            classification = interaction.get("classification", "")
            cp_loss = interaction.get("centipawn_loss", 0)
            if move_idx is None or classification not in ("blunder", "mistake"):
                continue
            if move_idx >= len(evals):
                continue
            e = evals[move_idx]
            fen = e.get("fen", "")
            best_uci = e.get("best_move_uci", "")
            best_san = e.get("best_move_san", "")
            if not fen or not best_uci:
                continue
            if fen in existing_fens:
                continue
            existing_fens.add(fen)
            cards.append(ReviewCard(
                user_id=user_id,
                fen=fen,
                correct_move_uci=best_uci,
                correct_move_san=best_san,
                user_color=user_color,
                source="coaching",
                error_type=classification,
                centipawn_loss=cp_loss,
                engine_pv_san=e.get("pv_san", e.get("engine_pv_san", [])),
                next_review_at=datetime.utcnow(),
            ))
    return cards


async def _seed_from_selfanalysis(user_id: int, db: AsyncSession, existing_fens: set[str]) -> list[ReviewCard]:
    """
    Self-analysis moves_data uses fields: fen_before, engine_best_move_uci,
    engine_best_move (SAN), engine_pv_san, classification, centipawn_loss, color.
    """
    q = await db.execute(
        select(AnnotationSession).where(
            AnnotationSession.user_id == user_id,
            AnnotationSession.completed == True,
        )
    )
    sessions = q.scalars().all()
    cards = []
    for session in sessions:
        for move_data in (session.moves_data or []):
            if move_data.get("draft"):
                continue
            fen = move_data.get("fen_before", "")
            best_uci = move_data.get("engine_best_move_uci", "")
            best_san = move_data.get("engine_best_move", "")
            classification = move_data.get("classification", "")
            cp_loss = move_data.get("centipawn_loss", 0)
            user_color = move_data.get("color", "")
            if not fen or not best_uci:
                continue
            if fen in existing_fens:
                continue
            if classification not in ("blunder", "mistake"):
                continue
            existing_fens.add(fen)
            cards.append(ReviewCard(
                user_id=user_id,
                fen=fen,
                correct_move_uci=best_uci,
                correct_move_san=best_san,
                user_color=user_color or _fen_side(fen),
                source="selfanalysis",
                error_type=classification,
                centipawn_loss=cp_loss,
                engine_pv_san=move_data.get("engine_pv_san", []),
                next_review_at=datetime.utcnow(),
            ))
    return cards


async def _seed_from_drills(user_id: int, db: AsyncSession, existing_fens: set[str]) -> list[ReviewCard]:
    """Pull blunder positions directly from game analysis (same source as drills)."""
    games_q = await db.execute(select(Game).where(Game.user_id == user_id))
    games = games_q.scalars().all()
    cards = []
    for game in games:
        analysis_q = await db.execute(
            select(GameAnalysis).where(GameAnalysis.game_id == game.id)
        )
        analysis = analysis_q.scalar_one_or_none()
        if not analysis or analysis.status.value != "complete":
            continue
        for e in (analysis.move_evaluations or []):
            if e.get("color") != game.user_color:
                continue
            if e.get("classification") not in ("blunder", "mistake"):
                continue
            if e.get("centipawn_loss", 0) < 80:
                continue
            fen = e.get("fen", "")
            best_uci = e.get("best_move_uci", "")
            best_san = e.get("best_move_san", "")
            if not fen or not best_uci:
                continue
            if fen in existing_fens:
                continue
            existing_fens.add(fen)
            cards.append(ReviewCard(
                user_id=user_id,
                fen=fen,
                correct_move_uci=best_uci,
                correct_move_san=best_san,
                user_color=game.user_color,
                source="drill",
                error_type=e.get("classification", "blunder"),
                centipawn_loss=e.get("centipawn_loss", 0),
                engine_pv_san=e.get("pv_san", e.get("engine_pv_san", [])),
                next_review_at=datetime.utcnow(),
            ))
    return cards


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.post("/{user_id}/seed")
async def seed_review_cards(user_id: int, db: AsyncSession = Depends(get_db)):
    """
    Scan coaching sessions, self-analysis sessions, and game analyses for
    blunders/mistakes and create ReviewCards for any not already in the bank.
    Returns the number of new cards added.
    """
    # Collect already-stored FENs to avoid duplicates
    existing_q = await db.execute(
        select(ReviewCard.fen).where(ReviewCard.user_id == user_id)
    )
    existing_fens: set[str] = set(existing_q.scalars().all())

    coaching_cards = await _seed_from_coaching(user_id, db, existing_fens)
    sa_cards = await _seed_from_selfanalysis(user_id, db, existing_fens)
    drill_cards = await _seed_from_drills(user_id, db, existing_fens)

    all_new = coaching_cards + sa_cards + drill_cards
    for card in all_new:
        db.add(card)
    await db.commit()

    return {
        "added": len(all_new),
        "from_coaching": len(coaching_cards),
        "from_selfanalysis": len(sa_cards),
        "from_drills": len(drill_cards),
    }


@router.get("/{user_id}/due")
async def get_due_cards(
    user_id: int,
    limit: int = 20,
    db: AsyncSession = Depends(get_db),
):
    """Return cards due for review today (next_review_at <= now), oldest first."""
    now = datetime.utcnow()
    q = await db.execute(
        select(ReviewCard)
        .where(ReviewCard.user_id == user_id, ReviewCard.next_review_at <= now)
        .order_by(ReviewCard.next_review_at.asc())
        .limit(limit)
    )
    cards = q.scalars().all()

    return {
        "due": [
            {
                "id": c.id,
                "fen": c.fen,
                "correct_move_uci": c.correct_move_uci,
                "correct_move_san": c.correct_move_san,
                "user_color": c.user_color,
                "source": c.source,
                "error_type": c.error_type,
                "centipawn_loss": c.centipawn_loss,
                "engine_pv_san": c.engine_pv_san or [],
                "repetition_count": c.repetition_count,
                "interval_days": c.interval_days,
            }
            for c in cards
        ],
        "total_due": len(cards),
    }


@router.get("/{user_id}/stats")
async def get_review_stats(user_id: int, db: AsyncSession = Depends(get_db)):
    """Overall review bank stats."""
    now = datetime.utcnow()
    all_q = await db.execute(
        select(ReviewCard).where(ReviewCard.user_id == user_id)
    )
    cards = all_q.scalars().all()
    if not cards:
        return {"total": 0, "due_now": 0, "mastered": 0, "has_data": False}

    due_now = sum(1 for c in cards if c.next_review_at <= now)
    mastered = sum(1 for c in cards if c.repetition_count >= 3)

    source_counts: dict[str, int] = {}
    for c in cards:
        source_counts[c.source or "unknown"] = source_counts.get(c.source or "unknown", 0) + 1

    return {
        "has_data": True,
        "total": len(cards),
        "due_now": due_now,
        "mastered": mastered,
        "source_counts": source_counts,
    }


class AnswerRequest(BaseModel):
    correct: bool   # True if user found the right move


@router.post("/card/{card_id}/answer")
async def answer_card(
    card_id: int,
    req: AnswerRequest,
    db: AsyncSession = Depends(get_db),
):
    """
    Mark a review card as answered correctly or incorrectly.
    Updates interval and schedules the next review.
    """
    q = await db.execute(select(ReviewCard).where(ReviewCard.id == card_id))
    card = q.scalar_one_or_none()
    if not card:
        raise HTTPException(status_code=404, detail="Card not found")

    now = datetime.utcnow()
    card.last_reviewed_at = now

    if req.correct:
        card.repetition_count += 1
        card.interval_days = _next_interval(card, correct=True)
    else:
        card.repetition_count = 0
        card.interval_days = 1

    card.next_review_at = now + timedelta(days=card.interval_days)
    await db.commit()

    return {
        "interval_days": card.interval_days,
        "repetition_count": card.repetition_count,
        "next_review_at": card.next_review_at.isoformat(),
    }
