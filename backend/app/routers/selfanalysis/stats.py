"""
Aggregate statistics endpoint.
"""
from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.database import get_db
from app.models import AnnotationSession

router = APIRouter()

_PATTERN_LABELS = {
    "fork": "Fork",
    "pin": "Pin",
    "hanging_piece": "Hanging piece",
    "hanging_piece_missed": "Hanging piece (missed)",
    "checkmate_threat": "Mate threat",
    "missed_checkmate": "Missed mate",
    "missed_fork": "Missed fork",
    "missed_pin": "Missed pin",
    "pawn_structure_weakened": "Pawn structure",
    "isolated_pawn_created": "Isolated pawn",
    "weak_squares_created": "Weak squares",
    "strategic_drift": "Strategic drift",
    "bishop_knight_trade_bad": "Poor B×N trade",
    "bishop_knight_trade_ok": "Good B×N trade",
}

_ROOT_CAUSE_LABELS_STATS = {
    "never_considered":      "Never considered it",
    "rejected_wrong_reason": "Rejected for wrong reason",
    "miscalculated":         "Miscalculated",
    "plan_disconnect":       "Plan disconnect",
    "time_pressure":         "Time pressure",
}


@router.get("/user/{user_id}/stats")
async def get_user_stats(
    user_id: int,
    db: AsyncSession = Depends(get_db),
):
    """
    Aggregate statistics across all completed self-analysis sessions for a user.
    Returns pattern frequencies, score trends, classification breakdown,
    root cause distribution, and candidate quality metrics.
    """
    sessions_result = await db.execute(
        select(AnnotationSession)
        .where(
            AnnotationSession.user_id == user_id,
            AnnotationSession.completed == True,  # noqa: E712
        )
        .order_by(AnnotationSession.completed_at)
    )
    sessions = sessions_result.scalars().all()

    if not sessions:
        return {
            "total_sessions": 0,
            "total_moves_reviewed": 0,
            "score_trends": [],
            "avg_scores": {},
            "pattern_frequency": [],
            "classification_breakdown": {},
            "root_cause_distribution": {},
            "eval_verdict_distribution": {},
            "candidate_stats": {},
            "avg_centipawn_loss": None,
            "mistake_rate": None,
        }

    # Accumulators
    score_trends = []
    pattern_counts: dict[str, int] = {}
    classification_counts: dict[str, int] = {"good": 0, "inaccuracy": 0, "mistake": 0, "blunder": 0}
    root_cause_counts: dict[str, int] = {}
    eval_verdict_counts: dict[str, int] = {"correct": 0, "slightly off": 0, "significantly off": 0}
    total_cp_loss = 0.0
    total_cp_moves = 0
    total_moves_reviewed = 0
    total_candidates_moves = 0
    total_candidates_sum = 0
    best_in_candidates_count = 0

    eval_keys = ["eval_accuracy_score", "candidate_quality_score", "tactical_awareness_score", "confidence_calibration_score"]
    score_sums: dict[str, float] = {k: 0.0 for k in eval_keys}
    score_counts: dict[str, int] = {k: 0 for k in eval_keys}

    for s in sessions:
        reflection = s.reflection or {}
        moves_data = s.moves_data or []
        submitted = [m for m in moves_data if not m.get("draft", False)]
        total_moves_reviewed += len(submitted)

        # Score trend entry
        trend_entry: dict = {
            "session_id": s.id,
            "date": s.completed_at.isoformat() if s.completed_at else None,
        }
        for k in eval_keys:
            val = reflection.get(k)
            short = k.replace("_score", "")
            trend_entry[short] = val
            if val is not None:
                score_sums[k] += val
                score_counts[k] += 1
        score_trends.append(trend_entry)

        for m in submitted:
            # Patterns
            for p in (m.get("patterns") or []):
                ptype = p.get("type", "")
                if ptype:
                    pattern_counts[ptype] = pattern_counts.get(ptype, 0) + 1

            # Classification
            cls = m.get("classification", "")
            if cls in classification_counts:
                classification_counts[cls] += 1

            # Root cause
            rc = m.get("root_cause", "")
            if rc:
                root_cause_counts[rc] = root_cause_counts.get(rc, 0) + 1

            # Eval verdict
            ev = m.get("eval_verdict", "")
            if ev in eval_verdict_counts:
                eval_verdict_counts[ev] += 1

            # Centipawn loss (cap at 500 to avoid mate scores skewing avg)
            cp = m.get("centipawn_loss")
            if cp is not None:
                total_cp_loss += min(float(cp), 500.0)
                total_cp_moves += 1

            # Candidate quality
            candidates = [c for c in (m.get("user_candidates") or []) if c]
            if candidates:
                total_candidates_moves += 1
                total_candidates_sum += len(candidates)
                engine_best = m.get("engine_best_move", "")
                move_san = m.get("move_san", "")
                norm_candidates = [c.rstrip("+#") for c in candidates]
                played_best = bool(
                    engine_best and move_san and (
                        move_san == engine_best or
                        move_san.rstrip("+#") == engine_best.rstrip("+#")
                    )
                )
                found = played_best or bool(
                    engine_best and (
                        engine_best in candidates or
                        engine_best.rstrip("+#") in norm_candidates
                    )
                )
                if found:
                    best_in_candidates_count += 1

    # Build pattern_frequency with labels, sorted by count
    pattern_frequency = [
        {
            "type": ptype,
            "label": _PATTERN_LABELS.get(ptype, ptype.replace("_", " ").title()),
            "count": count,
        }
        for ptype, count in sorted(pattern_counts.items(), key=lambda x: -x[1])
    ]

    # Root cause with labels
    root_cause_distribution = [
        {
            "type": rc,
            "label": _ROOT_CAUSE_LABELS_STATS.get(rc, rc.replace("_", " ").title()),
            "count": cnt,
        }
        for rc, cnt in sorted(root_cause_counts.items(), key=lambda x: -x[1])
    ]

    avg_scores = {
        k.replace("_score", ""): round(score_sums[k] / score_counts[k], 1)
        for k in eval_keys
        if score_counts[k] > 0
    }

    total_non_good = (
        classification_counts["inaccuracy"] +
        classification_counts["mistake"] +
        classification_counts["blunder"]
    )
    mistake_rate = (
        round(total_non_good / total_moves_reviewed * 100, 1)
        if total_moves_reviewed > 0 else None
    )

    payload = {
        "total_sessions": len(sessions),
        "total_moves_reviewed": total_moves_reviewed,
        "score_trends": score_trends,
        "avg_scores": avg_scores,
        "pattern_frequency": pattern_frequency,
        "classification_breakdown": classification_counts,
        "root_cause_distribution": root_cause_distribution,
        "eval_verdict_distribution": eval_verdict_counts,
        "candidate_stats": {
            "moves_with_candidates": total_candidates_moves,
            "best_move_found_count": best_in_candidates_count,
            "best_move_found_pct": round(
                best_in_candidates_count / total_candidates_moves * 100, 1
            ) if total_candidates_moves > 0 else None,
            "avg_candidates_per_move": round(
                total_candidates_sum / total_candidates_moves, 1
            ) if total_candidates_moves > 0 else None,
        },
        "avg_centipawn_loss": round(total_cp_loss / total_cp_moves, 1) if total_cp_moves > 0 else None,
        "mistake_rate": mistake_rate,
    }

    return payload
