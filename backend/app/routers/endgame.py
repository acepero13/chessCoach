"""Endgame analysis router."""
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
import json

from ..database import get_db
from ..models import Game, GameAnalysis
from ..analysis.endgame_analyzer import analyze_endgame_performance
from ..llm.explainer import stream_endgame_coaching

router = APIRouter(prefix="/endgame", tags=["endgame"])


async def _load_games_data(user_id: int, db: AsyncSession) -> list[dict]:
    result = await db.execute(
        select(Game, GameAnalysis)
        .join(GameAnalysis, GameAnalysis.game_id == Game.id)
        .where(Game.user_id == user_id, GameAnalysis.status == "complete")
    )
    rows = result.all()
    return [
        {
            "result":           game.result,
            "user_color":       game.user_color,
            "move_evaluations": analysis.move_evaluations or [],
        }
        for game, analysis in rows
    ]


@router.get("/{user_id}/profile")
async def get_endgame_profile(user_id: int, db: AsyncSession = Depends(get_db)):
    games_data = await _load_games_data(user_id, db)
    if not games_data:
        raise HTTPException(404, "No analyzed games found")
    return analyze_endgame_performance(games_data)


@router.post("/{user_id}/coaching-stream")
async def endgame_coaching_stream(user_id: int, db: AsyncSession = Depends(get_db)):
    games_data = await _load_games_data(user_id, db)
    if not games_data:
        raise HTTPException(404, "No analyzed games found")

    profile = analyze_endgame_performance(games_data)

    async def event_stream():
        async for chunk in stream_endgame_coaching(profile):
            yield f"data: {json.dumps({'text': chunk})}\n\n"
        yield "data: [DONE]\n\n"

    return StreamingResponse(event_stream(), media_type="text/event-stream")
