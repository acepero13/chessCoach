"""
Game import endpoints: Lichess, Chess.com, PGN upload.
"""
import io
import chess.pgn
import httpx
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, BackgroundTasks
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.database import get_db
from app.models import Game, GameAnalysis, ImportSource, GameResult, AnalysisStatus, User
from app.schemas.games import (
    LichessImportRequest, ChessComImportRequest,
    GameResponse, AnalyzeRequest, AnalysisStatusResponse
)
from app.config import settings

router = APIRouter(prefix="/games", tags=["games"])


async def _get_or_create_user(username: str, db: AsyncSession) -> User:
    result = await db.execute(select(User).where(User.username == username))
    user = result.scalar_one_or_none()
    if user is None:
        user = User(username=username)
        db.add(user)
        await db.commit()
        await db.refresh(user)
    return user


def _parse_pgn_headers(pgn_text: str) -> dict:
    """Extract key headers from a PGN string."""
    game = chess.pgn.read_game(io.StringIO(pgn_text))
    if not game:
        return {}
    headers = game.headers
    return {
        "white": headers.get("White", ""),
        "black": headers.get("Black", ""),
        "white_elo": int(headers.get("WhiteElo", 0) or 0),
        "black_elo": int(headers.get("BlackElo", 0) or 0),
        "result": headers.get("Result", "*"),
        "eco": headers.get("ECO", ""),
        "opening": headers.get("Opening", ""),
        "time_control": headers.get("TimeControl", ""),
        "date": headers.get("Date", ""),
        "site": headers.get("Site", ""),
        "event_id": headers.get("Site", "").split("/")[-1] if "/" in headers.get("Site", "") else "",
    }


def _result_to_enum(result_str: str, user_color: str) -> GameResult:
    if result_str == "1-0":
        return GameResult.win if user_color == "white" else GameResult.loss
    elif result_str == "0-1":
        return GameResult.loss if user_color == "white" else GameResult.win
    return GameResult.draw


@router.post("/import/lichess")
async def import_lichess_games(
    req: LichessImportRequest,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
):
    """Fetch games from Lichess API for a given username."""
    user = await _get_or_create_user(req.username, db)

    params = {
        "max": req.max_games,
        "moves": "true",
        "clocks": "true",
        "opening": "true",
        "pgnInJson": "false",
    }
    if req.perf_type:
        params["perfType"] = req.perf_type

    try:
        async with httpx.AsyncClient(timeout=60.0) as client:
            resp = await client.get(
                f"{settings.lichess_api_base}/games/user/{req.username}",
                params=params,
                headers={"Accept": "application/x-chess-pgn"},
            )
            resp.raise_for_status()
            pgn_data = resp.text
    except httpx.HTTPError as e:
        raise HTTPException(status_code=502, detail=f"Lichess API error: {e}")

    # Split multiple PGNs
    pgn_games = _split_pgns(pgn_data)
    imported = []

    for pgn_text in pgn_games:
        headers = _parse_pgn_headers(pgn_text)
        if not headers:
            continue

        external_id = headers.get("event_id") or headers.get("site", "")
        user_color = "white" if headers["white"].lower() == req.username.lower() else "black"

        # Skip duplicates
        existing = await db.execute(
            select(Game).where(Game.external_id == external_id, Game.user_id == user.id)
        )
        if existing.scalar_one_or_none():
            continue

        result_enum = _result_to_enum(headers["result"], user_color)
        played_at = _parse_date(headers.get("date", ""))

        game = Game(
            user_id=user.id,
            external_id=external_id,
            source=ImportSource.lichess,
            pgn=pgn_text,
            white_player=headers["white"],
            black_player=headers["black"],
            white_elo=headers["white_elo"] or None,
            black_elo=headers["black_elo"] or None,
            result=result_enum,
            user_color=user_color,
            opening_eco=headers["eco"],
            opening_name=headers["opening"],
            time_control=headers["time_control"],
            played_at=played_at,
        )
        db.add(game)
        imported.append(game)

    await db.commit()
    return {"imported": len(imported), "user_id": user.id}


@router.post("/import/chessdotcom")
async def import_chessdotcom_games(
    req: ChessComImportRequest,
    db: AsyncSession = Depends(get_db),
):
    """Fetch games from Chess.com API for a given username."""
    user = await _get_or_create_user(req.username, db)

    from datetime import date
    today = date.today()
    year = req.year or today.year
    month = req.month or today.month

    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            url = f"{settings.chessdotcom_api_base}/player/{req.username}/games/{year}/{month:02d}"
            resp = await client.get(url, headers={"User-Agent": "ChessTutor/1.0"})
            resp.raise_for_status()
            data = resp.json()
    except httpx.HTTPError as e:
        raise HTTPException(status_code=502, detail=f"Chess.com API error: {e}")

    games_data = data.get("games", [])[:req.max_games]
    imported = []

    for gdata in games_data:
        pgn_text = gdata.get("pgn", "")
        if not pgn_text:
            continue

        external_id = str(gdata.get("url", "").split("/")[-1])
        user_color = "white" if gdata.get("white", {}).get("username", "").lower() == req.username.lower() else "black"

        existing = await db.execute(
            select(Game).where(Game.external_id == external_id, Game.user_id == user.id)
        )
        if existing.scalar_one_or_none():
            continue

        headers = _parse_pgn_headers(pgn_text)
        white_info = gdata.get("white", {})
        black_info = gdata.get("black", {})

        result_str = "1-0" if white_info.get("result") == "win" else (
            "0-1" if black_info.get("result") == "win" else "1/2-1/2"
        )
        result_enum = _result_to_enum(result_str, user_color)

        game = Game(
            user_id=user.id,
            external_id=external_id,
            source=ImportSource.chessdotcom,
            pgn=pgn_text,
            white_player=white_info.get("username", ""),
            black_player=black_info.get("username", ""),
            white_elo=white_info.get("rating"),
            black_elo=black_info.get("rating"),
            result=result_enum,
            user_color=user_color,
            opening_eco=headers.get("eco", ""),
            opening_name=headers.get("opening", ""),
            time_control=gdata.get("time_control", ""),
            played_at=datetime.fromtimestamp(gdata.get("end_time", 0)) if gdata.get("end_time") else None,
        )
        db.add(game)
        imported.append(game)

    await db.commit()
    return {"imported": len(imported), "user_id": user.id}


@router.post("/import/pgn")
async def import_pgn_file(
    username: str,
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
):
    """Import games from an uploaded PGN file."""
    user = await _get_or_create_user(username, db)
    content = await file.read()
    pgn_data = content.decode("utf-8", errors="replace")
    pgn_games = _split_pgns(pgn_data)

    imported = []
    for pgn_text in pgn_games:
        headers = _parse_pgn_headers(pgn_text)
        if not headers:
            continue

        # Determine user's color from PGN headers (same logic as Lichess import)
        white_name = headers.get("white", "")
        user_color = "white" if white_name.lower() == username.lower() else "black"
        result_enum = _result_to_enum(headers.get("result", "*"), user_color)

        game = Game(
            user_id=user.id,
            source=ImportSource.pgn_upload,
            pgn=pgn_text,
            white_player=headers.get("white", ""),
            black_player=headers.get("black", ""),
            white_elo=headers.get("white_elo") or None,
            black_elo=headers.get("black_elo") or None,
            result=result_enum,
            user_color=user_color,
            opening_eco=headers.get("eco", ""),
            opening_name=headers.get("opening", ""),
            time_control=headers.get("time_control", ""),
            played_at=_parse_date(headers.get("date", "")),
        )
        db.add(game)
        imported.append(game)

    await db.commit()
    return {"imported": len(imported), "user_id": user.id}


@router.get("/list/{user_id}", response_model=list[GameResponse])
async def list_games(user_id: int, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Game).where(Game.user_id == user_id))
    games = result.scalars().all()
    responses = []
    for g in games:
        analysis = await db.execute(
            select(GameAnalysis).where(GameAnalysis.game_id == g.id)
        )
        ana = analysis.scalar_one_or_none()
        responses.append(GameResponse(
            id=g.id,
            external_id=g.external_id,
            source=g.source.value,
            white_player=g.white_player,
            black_player=g.black_player,
            white_elo=g.white_elo,
            black_elo=g.black_elo,
            result=g.result.value if g.result else None,
            user_color=g.user_color,
            opening_eco=g.opening_eco,
            opening_name=g.opening_name,
            time_control=g.time_control,
            played_at=g.played_at,
            has_analysis=ana is not None and ana.status.value == "complete",
        ))
    return responses


@router.post("/analyze")
async def analyze_games(
    req: AnalyzeRequest,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
):
    """Trigger batch analysis for selected game IDs."""
    from app.analysis.batch_analyzer import batch_analyze
    from app.engine.stockfish import get_engine

    # Check engine availability before accepting the request
    try:
        await get_engine()
    except Exception as e:
        raise HTTPException(
            status_code=503,
            detail=f"Stockfish engine not available: {e}. Check STOCKFISH_PATH setting."
        )

    # Fetch all games
    result = await db.execute(select(Game).where(Game.id.in_(req.game_ids)))
    games = {g.id: g for g in result.scalars().all()}

    missing = [gid for gid in req.game_ids if gid not in games]
    if missing:
        raise HTTPException(status_code=404, detail=f"Games not found: {missing}")

    pgn_map = {gid: g.pgn for gid, g in games.items()}

    # background_tasks uses the running event loop — safe because batch_analyze
    # creates its own DB sessions and does NOT use the request-scoped `db`.
    background_tasks.add_task(
        batch_analyze,
        game_ids=req.game_ids,
        pgn_map=pgn_map,
        depth=req.depth,
    )

    return {"message": f"Analysis started for {len(req.game_ids)} games", "game_ids": req.game_ids}


@router.get("/analysis-status/{user_id}")
async def get_analysis_status(user_id: int, db: AsyncSession = Depends(get_db)):
    """Return counts of pending/running/complete/failed analyses for a user's games."""
    games_result = await db.execute(select(Game).where(Game.user_id == user_id))
    game_ids = [g.id for g in games_result.scalars().all()]

    if not game_ids:
        return {"pending": 0, "running": 0, "complete": 0, "failed": 0, "total": 0}

    analyses_result = await db.execute(
        select(GameAnalysis).where(GameAnalysis.game_id.in_(game_ids))
    )
    analyses = analyses_result.scalars().all()

    counts = {"pending": 0, "running": 0, "complete": 0, "failed": 0}
    for a in analyses:
        counts[a.status.value] = counts.get(a.status.value, 0) + 1

    return {**counts, "total": len(game_ids)}


@router.get("/analysis/{game_id}")
async def get_game_analysis(game_id: int, db: AsyncSession = Depends(get_db)):
    """Get the full analysis result for a game."""
    result = await db.execute(
        select(GameAnalysis).where(GameAnalysis.game_id == game_id)
    )
    analysis = result.scalar_one_or_none()
    if not analysis:
        raise HTTPException(status_code=404, detail="Analysis not found")

    return {
        "game_id": game_id,
        "status": analysis.status.value,
        "depth": analysis.depth,
        "accuracy": analysis.accuracy,
        "blunder_count": analysis.blunder_count,
        "mistake_count": analysis.mistake_count,
        "inaccuracy_count": analysis.inaccuracy_count,
        "centipawn_loss_avg": analysis.centipawn_loss_avg,
        "move_evaluations": analysis.move_evaluations,
        "patterns_detected": analysis.patterns_detected,
        "completed_at": analysis.completed_at,
    }


def _split_pgns(pgn_data: str) -> list[str]:
    """Split a multi-game PGN string into individual game strings."""
    games = []
    current = []
    for line in pgn_data.splitlines():
        if line.startswith("[Event ") and current:
            game_text = "\n".join(current).strip()
            if game_text:
                games.append(game_text)
            current = []
        current.append(line)
    if current:
        game_text = "\n".join(current).strip()
        if game_text:
            games.append(game_text)
    return games


def _parse_date(date_str: str):
    """Try to parse PGN date format YYYY.MM.DD."""
    if not date_str or date_str == "????.??.??":
        return None
    try:
        parts = date_str.replace("-", ".").split(".")
        if len(parts) >= 3 and all(p.isdigit() for p in parts[:3]):
            return datetime(int(parts[0]), int(parts[1]), int(parts[2]))
    except (ValueError, IndexError):
        pass
    return None
