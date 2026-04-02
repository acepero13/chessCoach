"""
Puzzle Trainer router.

Endpoints:
  POST /puzzles/import        — Parse PGN and queue engine analysis (background task)
  GET  /puzzles/import-status — Progress tracking
  GET  /puzzles/session/{uid} — Next N puzzles (SR review or Woodpecker mode)
  POST /puzzles/attempt       — Record attempt, update SR schedule
  GET  /puzzles/stats/{uid}   — Motif heatmap + floor stability score
"""
import io
import os
import chess
import chess.pgn
from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks
from pydantic import BaseModel
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db, AsyncSessionLocal
from app.models import Puzzle, PuzzleProgress, PuzzleAttempt, PerformanceProfile, GameAnalysis, Game, AnalysisStatus
from app.engine.stockfish import get_engine
from app.llm.explainer import explain_gauntlet_defense
from app.patterns.tactical_detectors import (
    _move_creates_fork, _move_creates_pin,
    _move_creates_discovered_attack, _is_hanging, PIECE_VALUES,
)

router = APIRouter(prefix="/puzzles", tags=["puzzles"])


def _canonical_fen(fen: str) -> str:
    """Normalise to a 6-part FEN with halfmove=0, fullmove≥1.

    Handles PGN files that store 4-part, 5-part, or 6-part FENs with
    fullmove=0 (illegal — chess.js rejects it).
    """
    parts = fen.strip().split()
    # Pad to 6 parts
    if len(parts) == 4:           # position turn castling ep
        parts += ["0", "1"]
    elif len(parts) == 5:         # position turn castling ep fullmove  (no halfmove)
        parts.insert(4, "0")      # insert halfmove=0 before fullmove
    if len(parts) == 6:
        if parts[5] == "0":       # fullmove must be ≥1
            parts[5] = "1"
    return " ".join(parts)


_GAMES_DB_DIR = os.path.normpath(
    os.path.join(os.path.dirname(__file__), "..", "..", "..", "games_db")
)


def _list_pgn_files() -> list[dict]:
    """Scan games_db/ and return metadata for every .pgn file found."""
    if not os.path.isdir(_GAMES_DB_DIR):
        return []
    entries = []
    for fname in sorted(os.listdir(_GAMES_DB_DIR)):
        if not fname.lower().endswith(".pgn"):
            continue
        entries.append({
            "filename": fname,
            "label": fname[:-4],          # strip .pgn for display
            "source": fname,              # filename is the unique source key in the DB
            "path": os.path.join(_GAMES_DB_DIR, fname),
        })
    return entries

# ---------------------------------------------------------------------------
# Motif detection
# ---------------------------------------------------------------------------

def _detect_motif(fen: str, best_uci: str) -> tuple[str, int]:
    """Return (motif, difficulty_tier)."""
    board = chess.Board(fen)
    try:
        move = chess.Move.from_uci(best_uci)
    except Exception:
        return "combination", 3

    test = board.copy()
    test.push(move)

    if test.is_checkmate():
        return "checkmate", 3
    if _move_creates_fork(board, move):
        return "fork", 1
    if _move_creates_pin(board, move):
        return "pin", 2
    if _move_creates_discovered_attack(board, move):
        return "discovered_attack", 2
    if test.is_check():
        return "check", 2
    if board.is_capture(move):
        target = board.piece_at(move.to_square)
        if target and _is_hanging(board, move.to_square):
            return "hanging_piece", 1
        mover = board.piece_at(move.from_square)
        if mover and target:
            if PIECE_VALUES.get(mover.piece_type, 0) > PIECE_VALUES.get(target.piece_type, 0):
                return "sacrifice", 3
    return "combination", 3


# ---------------------------------------------------------------------------
# SR helpers
# ---------------------------------------------------------------------------

def _next_review(solve_time: float, solved: bool) -> tuple[datetime, float, str]:
    """Return (next_review_at, interval_days, confidence) based on spec."""
    now = datetime.utcnow()
    if not solved or solve_time > 30:
        return now + timedelta(hours=1), 0.042, "none"   # 1h ≈ 0.042 days
    if solve_time <= 10:
        return now + timedelta(days=7), 7.0, "high"
    return now + timedelta(days=1), 1.0, "medium"


# ---------------------------------------------------------------------------
# PGN metadata helpers
# ---------------------------------------------------------------------------

# Maps [White "..."] header values (lower-cased) → internal motif labels.
# Each distinct tactical concept gets its own key so motif heatmaps are meaningful.
_WHITE_HEADER_TO_MOTIF: dict[str, str] = {
    # Checkmate patterns
    "mate in 1": "checkmate",
    "mate in 2": "checkmate",
    "mate in 3": "checkmate",
    "mate in 4": "checkmate",
    "mate in 5": "checkmate",
    "checkmate": "checkmate",
    # Elementary tactics (each gets its own category)
    "pin": "pin",
    "fork": "fork",
    "double attack": "fork",
    "skewer": "skewer",
    "discovered attack": "discovered_attack",
    "discovered check": "discovered_attack",
    "double check": "discovered_attack",
    "hanging piece": "hanging_piece",
    "missing piece": "hanging_piece",
    "loose piece": "hanging_piece",
    "deflection": "deflection",
    "decoy": "deflection",
    "luring": "deflection",
    "overloading": "overloading",
    "overloaded piece": "overloading",
    "clearance": "clearance",
    "clearance sacrifice": "clearance",
    "interference": "interference",
    "zwischenzug": "zwischenzug",
    "intermezzo": "zwischenzug",
    "in-between move": "zwischenzug",
    "x-ray": "x_ray",
    "x-ray attack": "x_ray",
    "removing the guard": "deflection",
    "removing the defender": "deflection",
    "sacrifice": "sacrifice",
    "promotion": "promotion",
    "queening": "promotion",
    # Broader / mixed
    "drawing tactics": "combination",
    "mixed motifs: white": "combination",
    "mixed motifs: black": "combination",
    "curiosities": "combination",
    "illustrative position": "combination",
    "battery": "combination",
    "combination": "combination",
}


def _parse_pgn_solution(game) -> tuple[list[str], str | None, int | None]:
    """
    Extract solution from a PGN game object.
    Returns (solution_uci, motif, difficulty_tier).

    - solution_uci: list of UCI move strings from the mainline (empty if no moves)
    - motif: mapped from [White "..."] header, or None
    - difficulty_tier: 1/2/3 based on number of user moves, or None
    """
    # Motif from White header
    white_hdr = game.headers.get("White", "").strip()
    motif = _WHITE_HEADER_TO_MOTIF.get(white_hdr.lower())

    # Solution moves from mainline
    solution_uci: list[str] = []
    try:
        board = game.board()
        for move in game.mainline_moves():
            solution_uci.append(move.uci())
            board.push(move)
    except Exception:
        solution_uci = []

    # Difficulty tier: number of moves the *solver* plays = ceil(len / 2)
    difficulty_tier = None
    if solution_uci:
        user_moves = (len(solution_uci) + 1) // 2
        difficulty_tier = 1 if user_moves == 1 else (2 if user_moves == 2 else 3)

    return solution_uci, motif, difficulty_tier


# ---------------------------------------------------------------------------
# Background import
# ---------------------------------------------------------------------------

_import_state: dict = {
    "total": 0, "analyzed": 0, "running": False, "error": None,
    "current_source": None, "resourced": 0,
}


async def _run_import(source: str, pgn_path: str) -> None:
    global _import_state
    _import_state.update(running=True, error=None, total=0, analyzed=0, resourced=0, current_source=source)
    try:
        if not os.path.exists(pgn_path):
            raise FileNotFoundError(f"PGN not found: {pgn_path}")

        with open(pgn_path) as f:
            pgn_text = f.read()

        # Phase 1 — parse & insert/re-source puzzles (fast, no engine)
        # Puzzles whose solution is encoded in the PGN skip Phase 2 entirely.
        new_ids: list[int] = []
        async with AsyncSessionLocal() as db:
            reader = io.StringIO(pgn_text)
            while True:
                game = chess.pgn.read_game(reader)
                if game is None:
                    break
                fen = game.headers.get("FEN")
                if not fen:
                    continue
                fen = _canonical_fen(fen)
                title = game.headers.get("Event", "Puzzle")

                # Extract solution + motif directly from PGN when available
                solution_uci, pgn_motif, pgn_tier = _parse_pgn_solution(game)

                # Lookup by canonical FEN prefix to handle legacy 5/6-part FENs in DB
                fen_prefix = " ".join(fen.split()[:4])
                existing = (await db.execute(
                    select(Puzzle).where(Puzzle.fen.like(f"{fen_prefix}%"))
                )).scalar_one_or_none()
                if existing:
                    updated = False
                    if existing.source != source:
                        existing.source = source
                        _import_state["resourced"] += 1
                        updated = True
                    if solution_uci:
                        # PGN mainline is the ground truth — always overrides engine PV
                        board = chess.Board(fen)
                        if existing.best_move_uci != solution_uci[0]:
                            existing.best_move_uci = solution_uci[0]
                            existing.best_move_san = board.san(chess.Move.from_uci(solution_uci[0]))
                            updated = True
                        if existing.solution_path != solution_uci:
                            existing.solution_path = solution_uci
                            updated = True
                        if pgn_motif and existing.motif != pgn_motif:
                            existing.motif = pgn_motif
                            updated = True
                        if pgn_tier and existing.difficulty_tier != pgn_tier:
                            existing.difficulty_tier = pgn_tier
                            updated = True
                    continue

                # New puzzle
                board = chess.Board(fen)
                p = Puzzle(source=source, fen=fen, title=title)
                if solution_uci:
                    # PGN provides the solution — no engine needed
                    p.best_move_uci = solution_uci[0]
                    p.best_move_san = board.san(chess.Move.from_uci(solution_uci[0]))
                    p.solution_path = solution_uci
                    p.motif = pgn_motif or "combination"
                    p.difficulty_tier = pgn_tier or 2
                    # Already complete — no Phase 2 needed; still track count
                    db.add(p)
                    await db.flush()
                    _import_state["analyzed"] += 1  # count as done
                else:
                    # No PGN solution → queue for engine analysis
                    db.add(p)
                    await db.flush()
                    new_ids.append(p.id)
            await db.commit()

        _import_state["total"] = _import_state["analyzed"] + len(new_ids)

        # Phase 2 — engine analysis for puzzles without a PGN solution (slow)
        engine = await get_engine()
        for puzzle_id in new_ids:
            async with AsyncSessionLocal() as db:
                p = await db.get(Puzzle, puzzle_id)
                if not p:
                    _import_state["analyzed"] += 1
                    continue
                try:
                    board = chess.Board(p.fen)
                    info = await engine._analyse(board, depth=18)
                    pv = info.get("pv", [])
                    if pv:
                        best = pv[0]
                        p.best_move_uci = best.uci()
                        p.best_move_san = board.san(best)
                        # Store full PV (up to 5 moves) as UCI strings
                        p.solution_path = [m.uci() for m in pv[:9]]
                        motif, tier = _detect_motif(p.fen, p.best_move_uci)
                        p.motif = motif
                        p.difficulty_tier = tier
                except Exception:
                    p.motif = "combination"
                    p.difficulty_tier = 2
                await db.commit()
            _import_state["analyzed"] += 1

    except Exception as e:
        _import_state["error"] = str(e)
    finally:
        _import_state["running"] = False


@router.post("/import")
async def import_puzzles(background_tasks: BackgroundTasks, filename: str):
    """Import a PGN file from games_db/ by its filename."""
    if _import_state["running"]:
        raise HTTPException(409, "Import already running")
    # Security: reject path traversal
    if os.sep in filename or filename.startswith(".") or not filename.lower().endswith(".pgn"):
        raise HTTPException(400, "Invalid filename")
    pgn_path = os.path.join(_GAMES_DB_DIR, filename)
    if not os.path.isfile(pgn_path):
        raise HTTPException(404, f"File not found in games_db: {filename}")
    background_tasks.add_task(_run_import, filename, pgn_path)
    return {"message": f"Import started: {filename}", "filename": filename, "source": filename}


@router.get("/books")
async def list_books(db: AsyncSession = Depends(get_db)):
    """Return all PGN files in games_db/ with their import status."""
    pgn_files = _list_pgn_files()
    result = []
    for info in pgn_files:
        count = await db.scalar(
            select(func.count(Puzzle.id)).where(Puzzle.source == info["source"])
        ) or 0
        analyzed = await db.scalar(
            select(func.count(Puzzle.id)).where(
                Puzzle.source == info["source"], Puzzle.best_move_uci.isnot(None)
            )
        ) or 0
        result.append({
            "filename": info["filename"],
            "source": info["source"],
            "label": info["label"],
            "total": count,
            "analyzed": analyzed,
            "ready": count > 0 and count == analyzed,
            "importing": _import_state["running"] and _import_state.get("current_source") == info["source"],
        })
    return result


@router.get("/import-status")
async def import_status(db: AsyncSession = Depends(get_db)):
    total_in_db = await db.scalar(select(func.count(Puzzle.id))) or 0
    analyzed = await db.scalar(
        select(func.count(Puzzle.id)).where(Puzzle.best_move_uci.isnot(None))
    ) or 0
    return {
        "running": _import_state["running"],
        "total_in_db": total_in_db,
        "analyzed": analyzed,
        "queued_total": _import_state["total"],
        "queued_done": _import_state["analyzed"],
        "resourced": _import_state["resourced"],
        "error": _import_state["error"],
        "ready": (not _import_state["running"]) and total_in_db > 0 and analyzed == total_in_db,
    }


# ---------------------------------------------------------------------------
# Session
# ---------------------------------------------------------------------------

def _puzzle_dict(p: Puzzle, prog) -> dict:
    return {
        "id": p.id,
        "fen": p.fen,
        "title": p.title,
        "best_move_uci": p.best_move_uci,
        "best_move_san": p.best_move_san,
        "solution_path": p.solution_path or [p.best_move_uci] if p.best_move_uci else [],
        "motif": p.motif,
        "difficulty_tier": p.difficulty_tier,
        "source": p.source,
        "attempts": prog.attempts if prog else 0,
        "correct": prog.correct if prog else 0,
        "confidence": prog.confidence if prog else None,
    }


@router.get("/session/{user_id}")
async def get_session(
    user_id: int,
    n: int = 20,
    mode: str = "review",   # "review" | "woodpecker"
    tier: int = None,
    source: str = None,     # None = all, or a source string (filename)
    motif: str = None,      # None = all, or specific motif to focus on
    db: AsyncSession = Depends(get_db),
):
    now = datetime.utcnow()

    if mode == "woodpecker":
        q = (
            select(Puzzle, PuzzleProgress)
            .outerjoin(
                PuzzleProgress,
                (PuzzleProgress.puzzle_id == Puzzle.id) & (PuzzleProgress.user_id == user_id),
            )
            .where(Puzzle.best_move_uci.isnot(None))
        )
        if tier:
            q = q.where(Puzzle.difficulty_tier == tier)
        if source:
            q = q.where(Puzzle.source == source)
        if motif:
            q = q.where(Puzzle.motif == motif)
        q = q.order_by(PuzzleProgress.attempts.asc().nullsfirst(), Puzzle.id.asc()).limit(n)
    else:
        # Due for review
        q = (
            select(Puzzle, PuzzleProgress)
            .join(PuzzleProgress,
                  (PuzzleProgress.puzzle_id == Puzzle.id) & (PuzzleProgress.user_id == user_id))
            .where(Puzzle.best_move_uci.isnot(None), PuzzleProgress.next_review_at <= now)
        )
        if source:
            q = q.where(Puzzle.source == source)
        if motif:
            q = q.where(Puzzle.motif == motif)
        q = q.order_by(PuzzleProgress.next_review_at.asc()).limit(n)

    rows = (await db.execute(q)).all()

    # Fallback: serve unseen puzzles (exclude any already attempted by this user)
    if not rows:
        seen_ids = (await db.execute(
            select(PuzzleProgress.puzzle_id).where(PuzzleProgress.user_id == user_id)
        )).scalars().all()

        q2 = (
            select(Puzzle)
            .where(Puzzle.best_move_uci.isnot(None))
            .order_by(Puzzle.difficulty_tier.asc(), Puzzle.id.asc())
        )
        if seen_ids:
            q2 = q2.where(Puzzle.id.notin_(seen_ids))
        if tier:
            q2 = q2.where(Puzzle.difficulty_tier == tier)
        if source:
            q2 = q2.where(Puzzle.source == source)
        if motif:
            q2 = q2.where(Puzzle.motif == motif)
        q2 = q2.limit(n)
        puzzles = (await db.execute(q2)).scalars().all()
        return {"puzzles": [_puzzle_dict(p, None) for p in puzzles], "mode": mode, "due": 0}

    # Count total due (for review mode header)
    due_total = await db.scalar(
        select(func.count(PuzzleProgress.id))
        .where(PuzzleProgress.user_id == user_id, PuzzleProgress.next_review_at <= now)
    ) or 0

    return {
        "puzzles": [_puzzle_dict(p, prog) for p, prog in rows],
        "mode": mode,
        "due": due_total,
    }


# ---------------------------------------------------------------------------
# Attempt
# ---------------------------------------------------------------------------

@router.post("/attempt")
async def record_attempt(
    user_id: int,
    puzzle_id: int,
    solved: bool,
    solve_time: float,
    motif_guess: str = None,
    db: AsyncSession = Depends(get_db),
):
    puzzle = await db.get(Puzzle, puzzle_id)
    if not puzzle:
        raise HTTPException(404, "Puzzle not found")

    motif_correct = (motif_guess and motif_guess == puzzle.motif) or None

    db.add(PuzzleAttempt(
        user_id=user_id, puzzle_id=puzzle_id,
        solved=solved, solve_time=solve_time,
        motif_guess=motif_guess, motif_correct=motif_correct,
    ))

    puzzle.total_attempts = (puzzle.total_attempts or 0) + 1
    if solved:
        puzzle.total_correct = (puzzle.total_correct or 0) + 1

    res = await db.execute(
        select(PuzzleProgress).where(
            PuzzleProgress.user_id == user_id, PuzzleProgress.puzzle_id == puzzle_id
        )
    )
    prog = res.scalar_one_or_none()
    next_rev, interval, confidence = _next_review(solve_time, solved)

    if prog is None:
        db.add(PuzzleProgress(
            user_id=user_id, puzzle_id=puzzle_id,
            next_review_at=next_rev, interval_days=interval, confidence=confidence,
            attempts=1, correct=1 if solved else 0, last_solve_time=solve_time,
            repetition_count=1 if solved else 0,
        ))
    else:
        prog.attempts = (prog.attempts or 0) + 1
        if solved:
            prog.correct = (prog.correct or 0) + 1
            prog.repetition_count = (prog.repetition_count or 0) + 1
            prog.ease_factor = min(3.0, max(1.3, (prog.ease_factor or 2.5) + 0.1))
        else:
            prog.repetition_count = 0
            prog.ease_factor = max(1.3, (prog.ease_factor or 2.5) - 0.2)
        prog.next_review_at = next_rev
        prog.interval_days = interval
        prog.confidence = confidence
        prog.last_solve_time = solve_time

    await db.commit()
    return {
        "motif": puzzle.motif,
        "motif_correct": motif_correct,
        "next_review_at": next_rev.isoformat(),
        "interval_days": interval,
        "confidence": confidence,
    }


# ---------------------------------------------------------------------------
# Stats
# ---------------------------------------------------------------------------

@router.get("/stats/{user_id}")
async def get_stats(user_id: int, db: AsyncSession = Depends(get_db)):
    rows = (await db.execute(
        select(Puzzle.motif, PuzzleAttempt.solved, PuzzleAttempt.solve_time)
        .join(PuzzleAttempt, PuzzleAttempt.puzzle_id == Puzzle.id)
        .where(PuzzleAttempt.user_id == user_id)
    )).all()

    motif_stats: dict[str, dict] = {}
    for motif, solved, t in rows:
        s = motif_stats.setdefault(motif or "combination", {"a": 0, "c": 0, "t": 0.0})
        s["a"] += 1
        if solved:
            s["c"] += 1
        s["t"] += t or 0

    heatmap = {
        motif: {
            "accuracy": round(100 * s["c"] / s["a"]) if s["a"] else 0,
            "attempts": s["a"],
            "avg_time": round(s["t"] / s["a"], 1) if s["a"] else 0,
        }
        for motif, s in motif_stats.items()
    }

    # Floor score = tier-1 accuracy
    tier1 = (await db.execute(
        select(PuzzleAttempt.solved)
        .join(Puzzle, Puzzle.id == PuzzleAttempt.puzzle_id)
        .where(PuzzleAttempt.user_id == user_id, Puzzle.difficulty_tier == 1)
    )).scalars().all()
    floor_score = round(100 * sum(1 for s in tier1 if s) / len(tier1)) if tier1 else 0

    now = datetime.utcnow()
    due = await db.scalar(
        select(func.count(PuzzleProgress.id))
        .where(PuzzleProgress.user_id == user_id, PuzzleProgress.next_review_at <= now)
    ) or 0
    total = await db.scalar(
        select(func.count(PuzzleAttempt.id)).where(PuzzleAttempt.user_id == user_id)
    ) or 0

    return {"heatmap": heatmap, "floor_score": floor_score, "due_count": due, "total_attempts": total}


# ---------------------------------------------------------------------------
# Recommendation
# ---------------------------------------------------------------------------

# Maps game analysis pattern types → puzzle motif
_PATTERN_TO_MOTIF = {
    "missed_fork": "fork",
    "fork": "fork",
    "missed_pin": "pin",
    "pin": "pin",
    "hanging_piece_missed": "hanging_piece",
    "missed_checkmate": "checkmate",
    "checkmate_threat": "checkmate",
}


@router.get("/recommendation/{user_id}")
async def get_recommendation(user_id: int, db: AsyncSession = Depends(get_db)):
    """Return a recommended motif to focus on, based on puzzle history + game profile."""

    # --- 1. Puzzle accuracy per motif (from attempts) ---
    attempt_rows = (await db.execute(
        select(Puzzle.motif, PuzzleAttempt.solved)
        .join(PuzzleAttempt, PuzzleAttempt.puzzle_id == Puzzle.id)
        .where(PuzzleAttempt.user_id == user_id)
    )).all()

    motif_acc: dict[str, dict] = {}
    for motif, solved in attempt_rows:
        m = motif or "combination"
        s = motif_acc.setdefault(m, {"a": 0, "c": 0})
        s["a"] += 1
        if solved:
            s["c"] += 1

    # --- 2. Game pattern stats (missed tactics in real games) ---
    profile = (await db.execute(
        select(PerformanceProfile)
        .where(PerformanceProfile.user_id == user_id)
        .order_by(PerformanceProfile.created_at.desc())
        .limit(1)
    )).scalar_one_or_none()

    tactics_score = profile.tactics_score if profile else None

    # Count missed tactical patterns from game analyses
    game_pattern_score: dict[str, int] = {}
    games_res = await db.execute(
        select(Game.id, Game.user_color).where(Game.user_id == user_id)
    )
    game_color_map = {row.id: row.user_color for row in games_res}
    analyses = (await db.execute(
        select(GameAnalysis).where(GameAnalysis.game_id.in_(list(game_color_map.keys())))
    )).scalars().all()
    for a in analyses:
        user_color = game_color_map.get(a.game_id, "white")
        for p in (a.patterns_detected or []):
            if p.get("color") == user_color:
                ptype = p.get("type", "")
                puzzle_motif = _PATTERN_TO_MOTIF.get(ptype)
                if puzzle_motif:
                    game_pattern_score[puzzle_motif] = game_pattern_score.get(puzzle_motif, 0) + 1

    # --- 3. Pick recommendation ---
    # Priority: motifs with worst puzzle accuracy (min 5 attempts), then most missed in games
    TACTICAL_MOTIFS = ["fork", "pin", "hanging_piece", "discovered_attack", "checkmate"]

    recommended_motif = None
    reason = None

    # From puzzle history: find worst-accuracy motif (min 5 attempts)
    worst_acc = 101
    for m in TACTICAL_MOTIFS:
        s = motif_acc.get(m)
        if s and s["a"] >= 5:
            acc = 100 * s["c"] / s["a"]
            if acc < worst_acc:
                worst_acc = acc
                recommended_motif = m
                reason = f"{round(acc)}% accuracy in puzzle practice"

    # Fall back to game pattern stats if no puzzle data
    if recommended_motif is None and game_pattern_score:
        recommended_motif = max(game_pattern_score, key=lambda m: game_pattern_score[m])
        count = game_pattern_score[recommended_motif]
        reason = f"missed {count}× in your games"

    # Count available puzzles for recommended motif
    motif_count = 0
    if recommended_motif:
        motif_count = await db.scalar(
            select(func.count(Puzzle.id))
            .where(Puzzle.motif == recommended_motif, Puzzle.best_move_uci.isnot(None))
        ) or 0

    return {
        "tactics_score": tactics_score,
        "recommended_motif": recommended_motif,
        "reason": reason,
        "motif_puzzle_count": motif_count,
        "puzzle_accuracy": {
            m: round(100 * s["c"] / s["a"]) if s["a"] else 0
            for m, s in motif_acc.items()
        },
        "game_pattern_misses": game_pattern_score,
    }


# ---------------------------------------------------------------------------
# Personal Puzzles (from user's own game mistakes)
# ---------------------------------------------------------------------------

# Maps patterns_detected type → puzzle motif label
_PERSONAL_PATTERN_TO_MOTIF = {
    "missed_fork": "fork",
    "fork": "fork",
    "missed_pin": "pin",
    "pin": "pin",
    "hanging_piece_missed": "hanging_piece",
    "hanging_piece": "hanging_piece",
    "missed_checkmate": "checkmate",
    "checkmate_threat": "checkmate",
    "missed_discovered_attack": "discovered_attack",
    "discovered_attack": "discovered_attack",
    "missed_sacrifice": "sacrifice",
    "tactical_shot_found": "combination",
}


@router.get("/personal/{user_id}")
async def get_personal_puzzles(
    user_id: int,
    limit: int = 30,
    db: AsyncSession = Depends(get_db),
):
    """
    Build a puzzle set from the user's own game mistakes/blunders.
    Positions are extracted from GameAnalysis.move_evaluations (classification=mistake|blunder).
    Puzzle records with source='personal' are created/reused; solution_path comes from pv_uci.
    Returns up to `limit` puzzles ordered by centipawn_loss desc (worst mistakes first).
    """
    # Gather all user games and their analyses
    games_res = await db.execute(
        select(Game.id, Game.user_color).where(Game.user_id == user_id)
    )
    game_color_map: dict[int, str] = {row.id: row.user_color for row in games_res}
    if not game_color_map:
        return {"puzzles": [], "personal_count": 0}

    analyses = (await db.execute(
        select(GameAnalysis).where(
            GameAnalysis.game_id.in_(list(game_color_map.keys())),
            GameAnalysis.status == AnalysisStatus.complete,
        )
    )).scalars().all()

    # Collect candidate positions: (centipawn_loss, game_id, move_eval_dict, motif)
    candidates: list[tuple[int, int, dict, str]] = []
    for analysis in analyses:
        user_color = game_color_map.get(analysis.game_id, "white")
        move_evals: list[dict] = analysis.move_evaluations or []
        patterns: list[dict] = analysis.patterns_detected or []

        # Build FEN → motif mapping from patterns detected at that move
        fen_to_motif: dict[str, str] = {}
        for p in patterns:
            if p.get("color") == user_color and p.get("fen"):
                ptype = p.get("type", "")
                motif = _PERSONAL_PATTERN_TO_MOTIF.get(ptype)
                if motif:
                    fen_to_motif[p["fen"]] = motif

        for ev in move_evals:
            if ev.get("color") != user_color:
                continue
            if ev.get("classification") not in ("mistake", "blunder"):
                continue
            if not ev.get("fen") or not ev.get("best_move_uci"):
                continue
            cp_loss = ev.get("centipawn_loss", 0) or 0
            motif = fen_to_motif.get(ev["fen"])
            if not motif:
                # Fall back to engine-based detection
                motif, _ = _detect_motif(ev["fen"], ev["best_move_uci"])
            candidates.append((cp_loss, analysis.game_id, ev, motif))

    # Sort by centipawn_loss descending, take top `limit`
    candidates.sort(key=lambda x: -x[0])
    candidates = candidates[:limit]

    if not candidates:
        return {"puzzles": [], "personal_count": 0}

    # Upsert Puzzle records for each candidate
    puzzle_ids: list[int] = []
    for cp_loss, game_id, ev, motif in candidates:
        fen = ev["fen"]
        best_uci = ev["best_move_uci"]
        best_san = ev.get("best_move_san", "")
        pv_uci: list[str] = ev.get("pv_uci") or [best_uci]
        solution_path = pv_uci[:5] if pv_uci else [best_uci]
        tier = 3 if ev.get("classification") == "blunder" else 2
        title = f"Your game #{game_id} — move {ev.get('move_number', '?')} ({ev.get('classification', 'mistake')})"

        existing = (await db.execute(
            select(Puzzle).where(Puzzle.fen == fen, Puzzle.source == "personal")
        )).scalar_one_or_none()

        if existing:
            # Refresh solution if we have a better pv
            if len(solution_path) > len(existing.solution_path or []):
                existing.solution_path = solution_path
                existing.best_move_uci = best_uci
                existing.best_move_san = best_san
                existing.motif = motif
                existing.difficulty_tier = tier
            puzzle_ids.append(existing.id)
        else:
            p = Puzzle(
                source="personal",
                fen=fen,
                title=title,
                best_move_uci=best_uci,
                best_move_san=best_san,
                solution_path=solution_path,
                motif=motif,
                difficulty_tier=tier,
            )
            db.add(p)
            await db.flush()
            puzzle_ids.append(p.id)

    await db.commit()

    if not puzzle_ids:
        return {"puzzles": [], "personal_count": 0}

    # Load puzzles + progress
    rows = (await db.execute(
        select(Puzzle, PuzzleProgress)
        .outerjoin(
            PuzzleProgress,
            (PuzzleProgress.puzzle_id == Puzzle.id) & (PuzzleProgress.user_id == user_id),
        )
        .where(Puzzle.id.in_(puzzle_ids))
        .order_by(Puzzle.difficulty_tier.desc(), Puzzle.id.asc())
    )).all()

    return {
        "puzzles": [_puzzle_dict(p, prog) for p, prog in rows],
        "personal_count": len(rows),
    }


# ---------------------------------------------------------------------------
# Training Mode Recommendation
# ---------------------------------------------------------------------------

@router.get("/training-recommendation/{user_id}")
async def get_training_mode_recommendation(user_id: int, db: AsyncSession = Depends(get_db)):
    """
    Based on the user's PerformanceProfile, recommend which training modes to enable
    in the Puzzle Trainer and whether personal puzzles would be most useful.
    """
    profile = (await db.execute(
        select(PerformanceProfile)
        .where(PerformanceProfile.user_id == user_id)
        .order_by(PerformanceProfile.created_at.desc())
        .limit(1)
    )).scalar_one_or_none()

    if not profile:
        return {
            "has_profile": False,
            "recommend_personal": False,
            "recommend_blind": False,
            "recommend_gauntlet": False,
            "recommend_ghost": False,
            "reasons": [],
        }

    reasons: list[str] = []
    recommend_personal = False
    recommend_blind = False
    recommend_gauntlet = False
    recommend_ghost = False

    t = profile.tactics_score or 0
    d = profile.defense_score or 0
    ms = profile.mental_stability_score or 0
    s = profile.strategy_score or 0

    if t < 65:
        recommend_personal = True
        recommend_blind = True
        reasons.append(f"Tactics score {round(t)}/100 — pattern recognition training recommended")
    if d < 60 or ms < 55:
        recommend_gauntlet = True
        reasons.append(
            f"Defense {round(d)}/100 & stability {round(ms)}/100 — defensive calculation training recommended"
        )
    if s < 60:
        recommend_ghost = True
        reasons.append(f"Strategy score {round(s)}/100 — Ghost Square (attack awareness) training recommended")

    # Always recommend personal puzzles if any weakness
    if reasons:
        recommend_personal = True

    # Count how many personal puzzles exist
    personal_count = await db.scalar(
        select(func.count(Puzzle.id)).where(Puzzle.source == "personal")
    ) or 0

    return {
        "has_profile": True,
        "recommend_personal": recommend_personal,
        "recommend_blind": recommend_blind,
        "recommend_gauntlet": recommend_gauntlet,
        "recommend_ghost": recommend_ghost,
        "personal_puzzle_count": personal_count,
        "scores": {
            "tactics": round(t),
            "defense": round(d),
            "mental_stability": round(ms),
            "strategy": round(s),
        },
        "reasons": reasons,
    }


# ---------------------------------------------------------------------------
# Gauntlet Coach
# ---------------------------------------------------------------------------

class GauntletCoachRequest(BaseModel):
    fen: str
    user_move_san: str
    best_move_san: str
    top_lines: list[dict] = []
    user_note: str = ""


@router.post("/gauntlet-coach")
async def gauntlet_coach(req: GauntletCoachRequest):
    """
    LLM explanation of a failed defensive attempt in Gauntlet mode.
    Returns a plain-text coaching explanation grounded in engine lines.
    """
    explanation = await explain_gauntlet_defense(
        fen=req.fen,
        user_move_san=req.user_move_san,
        best_move_san=req.best_move_san,
        top_lines=req.top_lines,
        user_note=req.user_note,
    )
    return {"explanation": explanation}
